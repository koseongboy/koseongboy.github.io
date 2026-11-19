@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 포트폴리오 편집 모드를 시작합니다. 창을 닫거나 편집 화면의 [⏻ 끄기]를 누르면 종료돼요.
node tools\editor\server.js
rem 정상 종료(⏻ 끄기)면 창을 바로 닫고, 오류로 멈췄을 때만 내용을 볼 수 있게 대기
if errorlevel 1 pause
