@echo off
setlocal
 title PRONTO Install
if not exist "%~dp0com.pronto.ppro\manage-install.ps1" (
 echo PRONTO package not found. Extract the complete download before running this file.
 pause
 exit /b 1
)
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0com.pronto.ppro\manage-install.ps1" -Action Install
set "prontoExit=%ERRORLEVEL%"
echo.
pause
exit /b %prontoExit%