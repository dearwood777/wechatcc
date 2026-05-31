@echo off
title WeChat-Claude 桥接
cd /d "%~dp0"

echo 正在启动微信-Claude 自动桥接...
echo.

start /MIN "WeChat-Bridge" node "auto_bridge.mjs"

echo 桥接已启动！可在微信 ClawBot 中直接和 Claude 对话。
echo.
echo 日志文件: %~dp0wechat_bridge.log
echo.
echo 按任意键关闭此窗口（桥接会继续后台运行）
pause >nul
