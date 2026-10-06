@echo off
REM Publishes Boba to your GitHub account as an open-source repo.
REM You will log in to GitHub in your browser the first time.
title Publish Boba to GitHub
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish-github.ps1"
echo.
pause
