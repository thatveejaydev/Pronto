@echo off
setlocal
title Install PRONTO for Adobe Premiere Pro
echo ============================================================
echo   Installing PRONTO for Adobe Premiere Pro...
echo ============================================================
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0com.pronto.ppro\setup.ps1" -Action Install
set EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %EXIT_CODE%
