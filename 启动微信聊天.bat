@echo off
title WeChat - Claude 桥接 v4
cd /d "%~dp0"

echo ============================================
echo   WeChat - Claude 自动桥接 v4
echo   微信消息 → Claude AI（语音识别+执行命令）
echo ============================================
echo.

:: 检查 node 是否可用
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [错误] 未找到 Node.js！请先安装 Node.js
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

:: 检查 auto_bridge.mjs 是否存在
if not exist "auto_bridge.mjs" (
    echo [错误] 找不到 auto_bridge.mjs！
    echo 请把本 bat 文件和 auto_bridge.mjs 放在同一个文件夹。
    pause
    exit /b 1
)

:: 检查 Claude Code 是否安装
where claude >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [提示] 未检测到 Claude Code，正在安装...
    npm install -g @anthropic-ai/claude-code
    if %ERRORLEVEL% neq 0 (
        echo [错误] Claude Code 安装失败！
        pause
        exit /b 1
    )
)

echo [1/2] 正在启动桥接器（v4 语音识别版）...
start /MIN "WeChat-Bridge" node "auto_bridge.mjs"

:: 等几秒确认启动成功
timeout /t 3 /nobreak >nul

echo [2/2] 桥接器已在后台运行！
echo.
echo ============================================
echo   启动成功
echo.
echo   现在可以用微信给 ClawBot 发消息了！
echo   发送后会通过 Claude AI 自动回复。
echo.
echo   支持的功能:
echo     - 文字聊天
echo     - 语音消息（自动识别转文字）
echo     - 执行命令（查看IP、时间、装软件等）
echo.
echo   测试消息:
echo     "几点了"       - 查看当前时间
echo     "帮我看下IP"    - 查看本机IP
echo     "外网IP是多少"  - 查看公网IP
echo     "C盘空间"       - 查看磁盘空间
echo     "执行任意命令"  - Claude 会自己决定
echo.
echo   日志文件: %~dp0wechat_bridge.log
echo ============================================
echo.
echo 按任意键关闭本窗口（桥接会在后台继续运行）
pause >nul
