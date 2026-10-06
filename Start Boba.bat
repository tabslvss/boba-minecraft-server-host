@echo off
REM ==========================================================
REM  Boba Minecraft Server Host Tool - launcher
REM  Double-click this file to open the app.
REM ==========================================================
title Boba Minecraft Server Host Tool
cd /d "%~dp0"

REM 1) Check that Node.js is installed (needed once, to run the app)
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Your browser will open the download page. Install the "LTS" version,
  echo  then double-click "Start Boba.bat" again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b
)

REM 2) First run only: download the app's parts (about 1-2 minutes)
if not exist "node_modules\electron\dist\electron.exe" (
  echo.
  echo  First start: installing Boba's parts. This only happens once...
  echo.
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Install failed. Check your internet and try again.
    pause
    exit /b
  )
)

REM 3) Open the app (this window closes by itself)
start "" "node_modules\electron\dist\electron.exe" .
exit /b
