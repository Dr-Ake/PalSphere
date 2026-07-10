@echo off
setlocal EnableExtensions
title PalSphere Server Studio - Uninstaller
cd /d "%~dp0"

fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator permission to remove firewall and startup integration...
  set "PALSPHERE_UNINSTALLER=%~f0"
  powershell.exe -NoLogo -NoProfile -Command "Start-Process -FilePath $env:PALSPHERE_UNINSTALLER -Verb RunAs"
  if errorlevel 1 (
    echo Administrator permission was canceled or unavailable.
    pause
    exit /b 1
  )
  exit /b 0
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Uninstall-PalSphere.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo PalSphere uninstall did not complete. Review the error above.
pause
exit /b %RESULT%
