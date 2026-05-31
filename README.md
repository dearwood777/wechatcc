# WeChat ↔ Claude AI 全自动桥接

通过微信官方 iLink Bot API，将微信消息转发给 Claude AI 处理，支持文字聊天、命令执行、语音消息识别。

## 功能特点

- **文字聊天** — 微信发消息，Claude AI 自动回复
- **语音消息** — 自动下载 → 解密 → Silk 解码 → Whisper 语音识别（GPU 加速）
- **命令执行** — Claude 可通过 Bash 工具执行系统命令（查 IP、看时间、装软件等）
- **全自动** — 轮询微信消息，无需手动操作

---

## 目录

1. [文件说明](#文件说明)
2. [前置依赖（新电脑需安装）](#前置依赖新电脑需安装)
3. [快速开始](#快速开始)
4. [语音识别流程](#语音识别流程)
5. [配置文件详解](#配置文件详解)
6. [运行原理](#运行原理)
7. [常见问题](#常见问题)
8. [技术栈](#技术栈)

---

## 文件说明

| 文件 | 说明 |
|------|------|
| `auto_bridge.mjs` | **主桥接程序**（Node.js 运行，核心逻辑） |
| `whisper_stt.py` | **语音识别脚本**（faster-whisper，GPU 加速） |
| `config.mjs` | 配置文件（含 iLink Bot 凭证）— **已 gitignore，需自行创建** |
| `config.example.mjs` | 配置示例，复制后填入真实凭据即可 |
| `启动微信聊天.bat` | Windows 一键启动脚本（GBK 编码） |
| `停止微信桥接.bat` | 停止后台运行的桥接进程 |
| `package.json` | npm 依赖声明（silk-wasm） |
| `whisper-models/tiny-model/` | faster-whisper tiny 模型（不含 model.bin，需单独下载） |

---

## 前置依赖（新电脑需安装）

以下是在**全新的 Windows 电脑**上从零搭建所需的全部依赖。

### 1. Node.js（v18+，推荐 v20+）

```bash
# 下载安装包（推荐 LTS 版本）
# https://nodejs.org/  → 下载 Windows 安装包 → 一路 Next 安装

# 验证安装
node --version
npm --version
```

### 2. Claude Code CLI

```bash
# 全局安装 Claude Code
npm install -g @anthropic-ai/claude-code

# 登录 Claude 账号（需要 Anthropic 控制台 API Key）
claude login
# 按提示输入你的 API Key，或浏览器登录授权

# 验证安装
claude --version
```

> **注意**：Claude Code 需要有效的 Anthropic 订阅。登录成功后才能使用 `claude -p` 非交互模式。

### 3. Python（3.9+，推荐 3.13）

```bash
# 下载安装包
# https://www.python.org/downloads/  → 下载 Windows 安装包

# 安装时务必勾选 "Add Python to PATH"
# 验证安装
python --version
pip --version
```

### 4. NVIDIA GPU 驱动 + CUDA（可选，用于语音识别 GPU 加速）

如果电脑有 NVIDIA 显卡并希望语音识别使用 GPU（比 CPU 快 5-10 倍）：

```bash
# 1. 安装 GPU 驱动（已安装可跳过）
# https://www.nvidia.com/Download/index.aspx

# 2. 安装 CUDA Toolkit 12.x
# https://developer.nvidia.com/cuda-downloads
# 注意：CTranslate2（faster-whisper 底层）需要 cuBLAS 12，
# 即使系统装的是 CUDA 13，也需要额外安装 cuBLAS 12 兼容库

# 3. 安装 cuBLAS 12（重要！）
pip install nvidia-cublas-cu12
```

> **无 GPU 也能运行**：如果没有 NVIDIA 显卡，Whisper 会自动回退到 CPU 模式（速度较慢，但可用）。

### 5. 微信 iLink Bot 注册

本桥接使用微信官方的 **iLink Bot** 接口（非网页微信/非协议破解）。

```bash
# 1. 微信搜索公众号 "ClawBot" 并关注
# 2. 在菜单中找到 "注册 Bot" 或类似入口
# 3. 注册后你会得到：
#    - Bot Token（格式类似：xxxxx@im.bot:xxxxxxxxxx）
#    - 你的微信 UserID（格式类似：o9cq80...@im.wechat）
# 4. 保存好这两个信息，后续配置需要填入
```

---

## 快速开始

### 第 1 步：克隆仓库

```bash
git clone https://github.com/dearwood777/wechatcc.git
cd wechatcc
```

或者直接下载 ZIP 解压。

### 第 2 步：安装依赖

```bash
# Node.js 依赖（silk-wasm 用于解码微信语音）
npm install

# Python 依赖（faster-whisper 用于语音识别）
pip install faster-whisper

# GPU 加速支持（有 NVIDIA 显卡时安装）
pip install nvidia-cublas-cu12
```

### 第 3 步：配置凭证

```bash
# 复制配置模板
cp config.example.mjs config.mjs
# Windows 系统用：copy config.example.mjs config.mjs
```

编辑 `config.mjs`，填入在第 5 步中获取的 iLink Bot 凭据：

```javascript
export const BASE_URL = 'https://ilinkai.weixin.qq.com';
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
export const TOKEN = '你的bot_id:secret';    // ← 替换为真实 Token
export const USER_ID = '你的微信用户ID';     // ← 替换为真实 UserID
```

### 第 4 步：下载语音识别模型

```bash
# 创建模型目录
mkdir -p whisper-models/tiny-model

# 下载 model.bin（约 75MB）
# 方式一：使用 curl
curl -L -o whisper-models/tiny-model/model.bin ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/model.bin

# 方式二：使用 Python（推荐，支持代理）
python -c "
import requests
url = 'https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/model.bin'
resp = requests.get(url, stream=True)
with open('whisper-models/tiny-model/model.bin', 'wb') as f:
    for chunk in resp.iter_content(chunk_size=8192):
        f.write(chunk)
print('下载完成')
"
# 如果在中国大陆，可以设置代理环境变量：
# set HTTPS_PROXY=http://127.0.0.1:7890

# 下载其他模型文件（已在仓库中，如果缺少则下载）
curl -L -o whisper-models/tiny-model/config.json ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/config.json
curl -L -o whisper-models/tiny-model/tokenizer.json ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/tokenizer.json
curl -L -o whisper-models/tiny-model/vocabulary.txt ^
  https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/vocabulary.txt
```

### 第 5 步：启动桥接

**方式一：直接运行**

```bash
node auto_bridge.mjs
```

**方式二：双击启动脚本**

双击 `启动微信聊天.bat`（Windows 后台运行，不占用命令行窗口）。

> **注意**：启动脚本会自动检测 Node.js 和 Claude Code 是否安装，如果缺失会提示安装。

**方式三：停止运行**

双击 `停止微信桥接.bat`，或按 `Ctrl+C` 终止终端进程。

### 第 6 步：微信测试

给公众号 **ClawBot** 发送消息，例如：

| 消息 | 预期回复 |
|------|---------|
| "几点了" | 返回当前时间 |
| "帮我看下IP" | 执行 `ipconfig` 返回本机 IP |
| "外网IP是多少" | 获取公网 IP |
| "C盘空间" | 查看 C 盘使用情况 |
| "装个啥软件" | Claude 可以帮你安装软件 |
| 发语音消息 | 自动识别语音内容并回复 |
| "执行任意Linux/Windows命令" | 直接执行 |

---

## 语音识别流程

微信语音消息的完整处理链路：

```
微信语音消息
    ↓
iLink Bot API 拉取消息（含 media.encrypt_query_param + media.aes_key）
    ↓
CDN 下载加密数据（GET /download?encrypted_query_param=...）
    ↓
AES-128-ECB 解密（使用 aes_key）
    ↓
Silk v3 解码（silk-wasm npm 包）
    ↓
PCM → WAV（添加 WAV 文件头）
    ↓
faster-whisper 语音识别（GPU → CPU 回退）
    ↓
识别文字 → 发给 Claude AI 处理
```

### whisper_stt.py 说明

语音识别脚本 `whisper_stt.py`：

- 自动检测 cuBLAS 12 DLL 路径并加入环境变量（解决 CUDA 版本兼容问题）
- 优先尝试 GPU（CUDA + float16），失败则回退到 CPU（int8）
- 使用 tiny 模型（速度最快，显存占用约 1GB）
- 输出识别文字到 stdout，供 Node.js 主程序捕获

### 如果没有 GPU

Whisper 会自动回退到 CPU 模式。CPU 模式下：
- 识别速度约慢 5-10 倍
- 一条 5 秒的语音约需 3-8 秒处理
- 不影响文字聊天功能，仅语音回复会变慢

---

## 配置文件详解

### config.mjs（敏感信息，不提交 git）

```javascript
export const BASE_URL = 'https://ilinkai.weixin.qq.com';       // iLink Bot API 地址
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';  // CDN 媒体下载地址
export const TOKEN = '你的bot_id:secret';                       // iLink Bot Token
export const USER_ID = '你的微信用户ID';                        // 允许回复的微信用户 ID
```

> **安全提示**：`config.mjs` 已加入 `.gitignore`，不会提交到 GitHub。每次在新电脑部署时，都需要创建此文件。

---

## 运行原理

### 主循环（auto_bridge.mjs）

1. **轮询消息**：每 3 秒调用 iLink Bot API 的 `getupdates` 拉取新消息
2. **过滤消息**：只处理来自指定 `USER_ID` 且 `seq` 大于上次处理序号的消息
3. **处理消息**：
   - 文字消息 → 直接发送给 Claude
   - 语音消息 → 下载 → 解密 → 解码 → Whisper 识别 → 转文字后发给 Claude
4. **调用 Claude**：通过 `claude -p "prompt"` 非交互模式调用 Claude，附带系统上下文和聊天记录
5. **发送回复**：将 Claude 的回复通过 `sendmessage` API 发送回微信
6. **持久化**：聊天记录保存在 `wechat_history.json`，断线后继续

### 状态文件说明

| 文件 | 作用 |
|------|------|
| `wechat_state.json` | 记录最后处理的 `seq` 和 `get_updates_buf`，用于断点续传 |
| `wechat_state.json.bak` | 自动备份 |
| `wechat_history.json` | 聊天历史记录（保留最近 20 条） |
| `wechat_bridge.log` | 运行日志，排查问题首选 |
| `voice-cache/` | 语音临时文件目录（自动清理） |

---

## 常见问题

### Q: 启动后没有反应，日志在哪里看？

打开 `wechat_bridge.log` 查看运行日志。正常启动会看到：
```
[2026/5/31 12:00:00] === WeChat-Claude 自动桥接 v4 启动（语音识别+命令执行）===
[2026/5/31 12:00:00] 用户ID: o9cq80...@im.wechat
[2026/5/31 12:00:00] API: https://ilinkai.weixin.qq.com
```

### Q: 收到消息但 Claude 没有回复？

检查以下可能原因：
1. Claude Code 是否已登录：运行 `claude login` 确认
2. 网络能否访问 `api.anthropic.com`（需要科学上网）
3. 日志中是否有 `Claude思考中...` 之后没有结果 → 可能是 API 超时
4. Token 额度是否用完

### Q: Claude 回复说不能执行命令？

确认 Claude 的启动参数包含 `--allowedTools Bash --permission-mode bypassPermissions`。在 `auto_bridge.mjs` 中检查 `CLAUDE_ARGS` 常量。

### Q: 语音消息识别失败怎么办？

1. 检查 Whisper 模型是否下载完整：`whisper-models/tiny-model/model.bin`（约 75MB）
2. 检查 Python 依赖：`pip list | findstr faster-whisper`
3. 查看日志中是否有 `语音消息：Whisper 识别中...` 和后续结果
4. 尝试手动运行语音识别脚本测试：
   ```bash
   python whisper_stt.py 某个音频文件.wav
   ```
5. 如果报 `cublas64_12.dll` 找不到：运行 `pip install nvidia-cublas-cu12`
6. 如果显存不足（需约 1GB 空闲）：关闭其他占用 GPU 的程序

### Q: 批量文件乱码（显示为问号/乱码）？

`启动微信聊天.bat` 使用 GBK（ANSI）编码，适合 Windows 简体中文系统直接双击运行。如果显示乱码：
- 使用文本编辑器（如 VS Code、Notepad++）以 **ANSI/GBK** 编码打开
- 或在命令行中先执行 `chcp 936` 切换到中文编码页再运行

### Q: 如何更新 Claude Code 版本？

```bash
npm update -g @anthropic-ai/claude-code
```

更新不影响桥接功能，可以随时更新。

### Q: 如何让桥接开机自启？

将 `启动微信聊天.bat` 的快捷方式放入 Windows 启动文件夹：
```
shell:startup
```

### Q: 安全方面的注意事项？

1. **Token 泄露**：`config.mjs` 包含微信 Bot 的完整访问权限，**不要**提交到公共仓库或分享
2. **命令执行能力**：Claude 可以执行系统命令，请确保运行环境安全
3. **消息记录**：`wechat_history.json` 包含聊天记录，注意保护隐私
4. **网络流量**：语音消息通过 CDN 传输，文字消息通过 iLink Bot API

---

## 从 GitHub 恢复部署（新电脑速查）

在全新的电脑上，从 GitHub 仓库恢复部署只需以下步骤：

```bash
# 1. 克隆仓库
git clone https://github.com/dearwood777/wechatcc.git
cd wechatcc

# 2. 安装 Node.js 依赖
npm install

# 3. 安装 Python 依赖
pip install faster-whisper
pip install nvidia-cublas-cu12   # GPU 加速（可选）

# 4. 创建配置文件
copy config.example.mjs config.mjs
# 编辑 config.mjs，填入 iLink Bot 的 Token 和 UserID

# 5. 下载 Whisper 模型文件
# 如果仓库已包含模型描述文件，只需下载 model.bin
python -c "
import requests
url = 'https://huggingface.co/Systran/faster-whisper-tiny/resolve/main/model.bin'
resp = requests.get(url, stream=True)
with open('whisper-models/tiny-model/model.bin', 'wb') as f:
    for chunk in resp.iter_content(chunk_size=8192):
        f.write(chunk)
print('model.bin 下载完成')
"

# 6. 确保 Claude Code 已登录
claude login

# 7. 启动
node auto_bridge.mjs
```

> **前提条件**：新电脑需先安装 Node.js、Python、Claude Code（见上面前置依赖章节）。

---

## 技术栈

- **消息收发**：微信 iLink Bot API（`ilinkai.weixin.qq.com`）
- **语音编解码**：Silk v3（`silk-wasm` npm 包）
- **语音识别**：faster-whisper（CTranslate2，GPU/CPU）
- **AI 处理**：Claude Code CLI（`claude -p` 非交互模式）
- **运行环境**：Node.js + Python 3

## License

MIT
