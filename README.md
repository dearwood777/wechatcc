# WeChat ↔ Claude AI 全自动桥接

通过微信官方 iLink Bot API，将微信消息转发给 Claude AI 处理，支持文字聊天、命令执行、语音消息识别。

## 功能特点

- **文字聊天** — 微信发消息，Claude AI 自动回复
- **语音消息** — 自动下载 → 解密 → Silk 解码 → Whisper 语音识别（GPU 加速）
- **命令执行** — Claude 可通过 Bash 工具执行系统命令（查 IP、看时间、装软件等）
- **全自动** — 轮询微信消息，无需手动操作

## 文件说明

| 文件 | 说明 |
|------|------|
| `auto_bridge.mjs` | **主桥接程序**（Node.js 运行，核心逻辑） |
| `whisper_stt.py` | **语音识别脚本**（faster-whisper，GPU 加速） |
| `config.mjs` | 配置文件（含 iLink Bot 凭证）— **已 gitignore，需自行创建** |
| `config.example.mjs` | 配置示例，复制后填入真实凭据即可 |
| `启动微信聊天.bat` | Windows 一键启动脚本 |
| `package.json` | npm 依赖声明 |
| `whisper-models/tiny-model/` | faster-whisper tiny 模型（不含 model.bin，需单独下载） |

## 前置依赖

- **Node.js** v18+（推荐 v20+）
- **Claude Code CLI**：`npm install -g @anthropic-ai/claude-code`，并登录账号
- **微信 iLink Bot**：关注公众号 "ClawBot" 注册，获取 Token
- **网络**：需要能访问 `ilinkai.weixin.qq.com`（微信 API）和 `api.anthropic.com`（Claude API）

## 快速开始

### 1. 安装依赖

```bash
# Node.js 依赖
npm install

# Python 语音识别依赖
pip install faster-whisper nvidia-cublas-cu12
```

### 2. 配置凭证

```bash
# 复制配置模板，填入你的真实 Token 和 UserID
cp config.example.mjs config.mjs
# 然后编辑 config.mjs，填入 iLink Bot 凭据
```

### 3. 下载语音模型

```bash
# 创建模型目录
mkdir -p whisper-models/tiny-model

# 下载 tiny 模型文件（约 72MB）
# 如果在中国大陆，可能需要代理
curl -L -o whisper-models/tiny-model/model.bin ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/model.bin

# 下载其他模型文件
curl -L -o whisper-models/tiny-model/config.json ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/config.json
curl -L -o whisper-models/tiny-model/tokenizer.json ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/tokenizer.json
curl -L -o whisper-models/tiny-model/vocabulary.txt ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/vocabulary.txt
```

### 4. 启动桥接

```bash
node auto_bridge.mjs
```

或双击 `启动微信聊天.bat`（Windows 后台运行）。

### 5. 微信测试

给 ClawBot 发消息，例如：
- "几点了" → 返回当前时间
- "帮我看下IP" → 执行 `ipconfig`
- "外网IP是多少" → 获取公网 IP
- "C盘空间" → 查看磁盘使用情况
- 直接发语音 → 自动识别并回复

## 语音识别流程

微信语音消息 → CDN 下载加密数据 → AES-128-ECB 解密 → Silk v3 解码 → WAV → faster-whisper (GPU) → 文字 → Claude AI

详细说明见 [部署文档](./docs/README.md)。

## 注意事项

1. **Token 安全**：`config.mjs` 包含 iLink Bot 凭证，已加入 `.gitignore`，**不要提交到公共仓库**
2. **模型文件**：`model.bin`（~72MB）未纳入 git，首次使用需手动下载
3. **GPU 加速**：如果使用 NVIDIA GPU，需要安装 CUDA 12.x 和 cuBLAS 12，否则会自动回退到 CPU（慢 5-10 倍）
4. **显存**：Whisper tiny 模型约占用 1GB 显存，请确保有足够空闲
5. **日志**：运行日志写入 `wechat_bridge.log`，排查问题先看这里

## 技术栈

- **消息收发**：微信 iLink Bot API（`ilinkai.weixin.qq.com`）
- **语音编解码**：Silk v3（`silk-wasm` npm 包）
- **语音识别**：faster-whisper（CTranslate2，GPU/CPU）
- **AI 处理**：Claude Code CLI（`claude -p` 非交互模式）
- **运行环境**：Node.js + Python 3

## License

MIT
