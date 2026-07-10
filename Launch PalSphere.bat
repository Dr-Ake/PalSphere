@echo off
setlocal EnableExtensions
title PalSphere Server Studio
cd /d "%~dp0"

if not exist "%~dp0server\PalServer.exe" (
  echo PalSphere is not installed yet.
  echo Run "Install PalSphere.bat" first.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0manager\launch-manager.ps1"
if errorlevel 1 (
  echo.
  echo PalSphere could not start. Run "Install PalSphere.bat" to repair the installation.
  pause
  exit /b 1
)
exit /b 0
