@echo off
setlocal EnableExtensions
title PalSphere Server Studio - Installer
cd /d "%~dp0"

if not exist "%~dp0scripts\Install-PalSphere.ps1" (
  echo ERROR: PalSphere installer files are incomplete.
  echo Download and extract the complete release before running this file.
  pause
  exit /b 1
)

fltmc >nul 2>&1
if errorlevel 1 (
  echo Requesting administrator permission for prerequisites, firewall, and startup setup...
  set "PALSPHERE_INSTALLER=%~f0"
  powershell.exe -NoLogo -NoProfile -Command "Start-Process -FilePath $env:PALSPHERE_INSTALLER -Verb RunAs"
  if errorlevel 1 (
    echo Administrator permission was canceled or unavailable.
    pause
    exit /b 1
  )
  exit /b 0
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Install-PalSphere.ps1"
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" (
  echo PalSphere installation did not complete. Review the error above.
) else (
  echo Installation complete. You can use "Launch PalSphere.bat" from now on.
)
echo.
pause
exit /b %RESULT%
