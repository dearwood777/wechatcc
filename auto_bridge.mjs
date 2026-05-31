// WeChat -> Claude 全自动桥接 v4 (用 node 运行)
// 支持语音消息识别 + 真正的命令执行！
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'url';
import { decode as silkDecode } from 'silk-wasm';

import { BASE_URL, CDN_BASE_URL, TOKEN, USER_ID } from './config.mjs';
// 使用脚本所在目录存储状态文件
const DIR = fileURLToPath(new URL('.', import.meta.url));
const STATE_FILE = DIR + 'wechat_state.json';
const HISTORY_FILE = DIR + 'wechat_history.json';
const LOG_FILE = DIR + 'wechat_bridge.log';

// Claude CLI 额外参数：允许执行命令+跳过权限
const CLAUDE_ARGS = '--allowedTools Bash --permission-mode bypassPermissions';

function log(msg) {
  const ts = new Date().toLocaleString();
  const line = `[${ts}] ${msg}\n`;
  fs.appendFileSync(LOG_FILE, line);
  process.stderr.write(line);
}

function loadJSON(path, def) {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return def; }
}
function saveJSON(path, data) {
  fs.writeFileSync(path, JSON.stringify(data, null, 2));
}

// ---- 语音消息处理相关 ----

/** 解析 AES key（支持 base64 原始字节或 hex 字符串两种格式） */
function parseAesKey(aesKeyBase64) {
  const decoded = Buffer.from(aesKeyBase64, 'base64');
  if (decoded.length === 16) return decoded;
  if (decoded.length === 32 && /^[0-9a-fA-F]{32}$/.test(decoded.toString('ascii'))) {
    return Buffer.from(decoded.toString('ascii'), 'hex');
  }
  throw new Error(`无效的 aes_key: ${decoded.length} 字节`);
}

/** 从 CDN 下载并解密语音文件，返回原始 silk 数据 */
async function downloadVoice(encryptQueryParam, aesKey) {
  const url = `${CDN_BASE_URL}/download?encrypted_query_param=${encodeURIComponent(encryptQueryParam)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`CDN 下载失败: HTTP ${resp.status}`);
  const ciphertext = Buffer.from(await resp.arrayBuffer());
  const keyBuf = parseAesKey(aesKey);
  const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuf, null);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** PCM s16le 数据添加 WAV 头 */
function pcmToWav(pcmData, sampleRate) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = (sampleRate * numChannels * bitsPerSample) / 8;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const dataSize = pcmData.length;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write('WAVE', 8);
  wav.write('fmt ', 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(numChannels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(dataSize, 40);
  pcmData.copy(wav, 44);
  return wav;
}

/** 语音消息全流程处理：下载→解密→silk解码→Whisper STT */
async function transcribeVoice(voiceItem) {
  if (!voiceItem?.media?.encrypt_query_param || !voiceItem.media?.aes_key) {
    log('语音消息缺少 media 信息');
    return null;
  }
  try {
    log('语音消息：下载+解密中...');
    const silkData = await downloadVoice(voiceItem.media.encrypt_query_param, voiceItem.media.aes_key);
    log(`语音消息：已解码 silk (${silkData.length} 字节)，正在转 PCM...`);

    const decoded = await silkDecode(silkData, 24000);
    log(`语音消息：PCM 解码完成 (${decoded.data.length} 字节, ${decoded.duration}ms)`);

    const wavDir = path.join(DIR, 'voice-cache');
    if (!fs.existsSync(wavDir)) fs.mkdirSync(wavDir, { recursive: true });
    const wavPath = path.join(wavDir, `voice_${Date.now()}.wav`);
    const wavData = pcmToWav(Buffer.from(decoded.data), 24000);
    fs.writeFileSync(wavPath, wavData);

    log('语音消息：Whisper 识别中...');
    const whisperScript = path.join(DIR, 'whisper_stt.py');
    const result = execSync(`python "${whisperScript}" "${wavPath}"`, {
      encoding: 'utf8',
      timeout: 120000,
    }).trim();

    // 清理临时文件
    try { fs.unlinkSync(wavPath); } catch {}
    // 清理空目录
    try { const files = fs.readdirSync(wavDir); if (files.length === 0) fs.rmdirSync(wavDir); } catch {}

    if (result) {
      log(`<< 语音识别结果: ${result.slice(0, 100)}`);
      return result;
    }
    log('语音识别返回空结果');
    return null;
  } catch (e) {
    log(`语音消息处理失败: ${e.message}`);
    return null;
  }
}

async function poll() {
  const state = loadJSON(STATE_FILE, { seq: 7, buf: '' });
  const resp = await fetch(BASE_URL + '/ilink/bot/getupdates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({
      get_updates_buf: state.buf,
      base_info: { channel_version: '0.1.0' },
    }),
    signal: AbortSignal.timeout(25000),
  });
  const data = await resp.json();
  if (data.get_updates_buf) state.buf = data.get_updates_buf;

  const msgs = (data.msgs || []).filter(m => m.from_user_id === USER_ID && m.seq > state.seq);
  if (msgs.length > 0) {
    state.seq = msgs[msgs.length - 1].seq;
    saveJSON(STATE_FILE, state);
  }
  return msgs;
}

async function sendReply(text) {
  const clean = text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~#>`]+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, 2000);

  const resp = await fetch(BASE_URL + '/ilink/bot/sendmessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'AuthorizationType': 'ilink_bot_token',
      'Authorization': 'Bearer ' + TOKEN,
    },
    body: JSON.stringify({
      msg: {
        to_user_id: USER_ID,
        from_user_id: '',
        client_id: Date.now() + '-' + Math.random().toString(36).slice(2),
        message_type: 2,
        message_state: 2,
        context_token: '',
        item_list: [{ type: 1, text_item: { text: clean } }],
      },
      base_info: { channel_version: '0.1.0' },
    }),
  });
  return resp.ok;
}

function getSystemContext() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hours = now.getHours();
  const minutes = now.getMinutes();
  const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const weekday = weekdays[now.getDay()];
  let ctx = `当前时间: ${year}年${month}月${day}日 ${weekday} ${hours.toString().padStart(2,'0')}:${minutes.toString().padStart(2,'0')}\n`;
  try {
    ctx += `主机名: ${execSync('hostname',{encoding:'utf8',timeout:3000}).trim()}\n`;
  } catch {}
  return ctx;
}

function getClaudeResponse(userMessage, history) {
  let chatContext = '';
  const recent = history.slice(-10);
  for (const h of recent) {
    chatContext += `${h.role}: ${h.text}\n`;
  }

  const sysContext = getSystemContext();
  // 不再需要预执行命令，Claude 自己会通过 Bash 工具执行
  // 只需要告诉它可以做什么

  const prompt = `你是一个微信AI助手，正在和用户通过微信聊天。

当前系统信息：
${sysContext}

聊天记录:
${chatContext}
用户的最新消息: ${userMessage}

你可以使用 Bash 工具执行任何命令来获取系统信息、网络信息等。用户可能让你查看IP、时间、系统配置、执行命令等。
请用自然友好的语气回复，简洁一些（微信不适合长文），不用markdown格式。直接回复。`;

  const tryExec = (args) => {
    try {
      return execSync(`claude -p ${JSON.stringify(prompt)} --print ${args}`, {
        encoding: 'utf8',
        timeout: 120000,
        env: { ...process.env },
      }).trim();
    } catch { return null; }
  };

  // 优先用带工具的模式，失败则回退到纯文本
  let result = tryExec(CLAUDE_ARGS);
  if (!result) {
    log('工具模式失败，回退到纯文本模式');
    result = tryExec('');
  }
  if (result) return result;

  log('所有尝试都失败');
  return '抱歉，我处理出错了，请稍后再试。';
}

// 主循环
log('=== WeChat-Claude 自动桥接 v4 启动（语音识别+命令执行）===');
log(`用户ID: ${USER_ID}`);
log(`API: ${BASE_URL}`);

let history = loadJSON(HISTORY_FILE, []);

async function mainLoop() {
  let pollCount = 0;
  let errorCount = 0;
  while (true) {
    try {
      const msgs = await poll();
      pollCount++;
      errorCount = 0;

      if (msgs.length > 0) {
        for (const m of msgs) {
          const items = m.item_list || [];

          // 提取文本内容：文字消息直接取，语音消息用微信自动转写的文字
          let text = '';
          let hasVoice = false;
          let hasOtherMedia = false;

          for (const item of items) {
            if (item.type === 1 && item.text_item?.text) {
              // 文字消息
              text += (text ? '\n' : '') + item.text_item.text;
            } else if (item.type === 3 && item.voice_item) {
              // 语音消息
              hasVoice = true;
              if (item.voice_item.text) {
                // 微信自带转写文字（部分消息有）
                text += (text ? '\n' : '') + item.voice_item.text;
                log(`<< 语音消息(微信已转文字): ${item.voice_item.text}`);
              } else {
                // 走 Whisper 语音识别
                log('<< 语音消息(Whisper识别中)...');
                const transcribed = await transcribeVoice(item.voice_item);
                if (transcribed) {
                  text += (text ? '\n' : '') + transcribed;
                  log(`<< 语音转文字: ${transcribed}`);
                } else {
                  log('<< 语音识别失败');
                }
              }
            } else if (item.type === 2 || item.type === 4 || item.type === 5) {
              // 图片/文件/视频 - 不支持
              hasOtherMedia = true;
            }
          }

          // 只有图片/文件/视频，没有文字内容
          if (!text && hasOtherMedia) {
            log('<< 收到图片/文件/视频消息（暂不支持）');
            await sendReply('暂时还不支持图片/文件/视频消息哦，请发文字给我吧～');
            continue;
          }

          // 语音消息转写失败
          if (!text && hasVoice) {
            log('<< 语音消息（识别失败）');
            await sendReply('我暂时没听清你说什么，能发文字给我吗？');
            continue;
          }

          // 完全没有内容
          if (!text) {
            log(`<< 收到空消息 原始:${JSON.stringify(m).slice(0,500)}`);
            continue;
          }

          log(`<< 收到: ${text}`);

          history.push({ role: 'user', text, time: Date.now() });
          if (history.length > 20) history = history.slice(-20);
          saveJSON(HISTORY_FILE, history);

          log('Claude思考中...');
          const reply = getClaudeResponse(text, history);
          log(`>> Claude: ${reply.slice(0, 150)}`);

          history.push({ role: 'assistant', text: reply, time: Date.now() });
          saveJSON(HISTORY_FILE, history);

          await sendReply(reply);
          log('>> 已发送到微信');
        }
      }

      if (pollCount % 60 === 0) log(`运行中... (已轮询${pollCount}次)`);
    } catch (e) {
      if (e.name !== 'AbortError') {
        errorCount++;
        log(`错误(${errorCount}): ${e.message}`);
        if (errorCount > 5) {
          log('连续错误超过5次，等待30秒...');
          await new Promise(r => setTimeout(r, 30000));
          errorCount = 0;
        }
      }
    }
    await new Promise(r => setTimeout(r, 3000));
  }
}

mainLoop().catch(e => {
  log(`致命: ${e.message}`);
  process.exit(1);
});
