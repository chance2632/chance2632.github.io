@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo ============================================
echo   我的小宇宙 · 个人网站
echo ============================================
echo.
echo 正在启动本地服务，请稍候...
echo 启动后浏览器会自动打开网站。
echo.
echo 【重要】请保持这个窗口打开，关掉它网站就访问不了了。
echo 编辑入口在网页右上角「编辑」按钮。
echo.

start "" http://127.0.0.1:8765/index.html
python -m http.server 8765 --bind 127.0.0.1
pause
