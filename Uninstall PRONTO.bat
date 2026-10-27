@echo off
setlocal
title Uninstall PRONTO for Adobe Premiere Pro
echo ============================================================
echo   Uninstalling PRONTO for Adobe Premiere Pro...
echo ============================================================
echo.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0com.pronto.ppro\setup.ps1" -Action Uninstall
set EXIT_CODE=%ERRORLEVEL%
echo.
pause
exit /b %EXIT_CODE%
