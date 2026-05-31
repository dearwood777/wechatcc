@echo off
title 停止微信桥接
echo 正在停止微信-Claude 桥接...
echo.

powershell -Command "Get-Process node | Where-Object { $_.CommandLine -like '*auto_bridge*' } | Stop-Process -Force"

echo 桥接已停止。
echo.
pause
