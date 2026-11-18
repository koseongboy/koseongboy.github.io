@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 포트폴리오 편집 모드를 시작합니다. 창을 닫으면 종료돼요.
node tools\editor\server.js
pause
