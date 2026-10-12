@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Portfolio Tracker

rem ---- Python -------------------------------------------------------------
set "PY="
where py >nul 2>nul && set "PY=py -3"
if not defined PY where python >nul 2>nul && set "PY=python"
if not defined PY (
  echo Python 3.11+ is required. Install it from https://www.python.org/downloads/ ^(tick "Add to PATH"^).
  pause & exit /b 1
)

if not exist ".venv\Scripts\python.exe" (
  echo [1/4] Creating Python virtual environment...
  %PY% -m venv .venv || (echo Failed to create venv & pause & exit /b 1)
)
set "VPY=.venv\Scripts\python.exe"

fc /b backend\requirements.txt .venv\installed-requirements.txt >nul 2>nul
if errorlevel 1 (
  echo [2/4] Installing backend dependencies...
  "%VPY%" -m pip install --disable-pip-version-check -q -r backend\requirements.txt || (echo pip install failed & pause & exit /b 1)
  copy /y backend\requirements.txt .venv\installed-requirements.txt >nul
) else (
  echo [2/4] Backend dependencies up to date.
)

rem ---- Frontend build -----------------------------------------------------
set "REBUILD="
if /i "%~1"=="--rebuild" set "REBUILD=1"
if not exist "frontend\dist\index.html" set "REBUILD=1"
if defined REBUILD (
  where npm >nul 2>nul || (echo Node.js 20+ is required to build the UI: https://nodejs.org/ & pause & exit /b 1)
  echo [3/4] Building the web app...
  pushd frontend
  rem Reinstall packages when package-lock.json changed (e.g. after update.bat).
  fc /b package-lock.json node_modules\.installed-lock.json >nul 2>nul
  if errorlevel 1 (
    call npm install --no-audit --no-fund || (popd & echo npm install failed & pause & exit /b 1)
    copy /y package-lock.json node_modules\.installed-lock.json >nul
  )
  call npm run build || (popd & echo Build failed & pause & exit /b 1)
  popd
) else (
  echo [3/4] Web app already built. ^(Use "start.bat --rebuild" after updating.^)
)

rem ---- First-run configuration -------------------------------------------
if not exist ".env" (
  copy /y .env.example .env >nul
  echo.
  choice /c YN /m "Allow access from your iPhone on this Wi-Fi network"
  if errorlevel 2 (
    echo Keeping access limited to this PC. Edit .env later to change.
  ) else (
    powershell -NoProfile -Command "(Get-Content .env) -replace '^PT_HOST=.*','PT_HOST=0.0.0.0' | Set-Content .env"
  )
)

rem ---- Run (database is created/migrated automatically) -------------------
echo [4/4] Starting server...
"%VPY%" backend\run.py
pause
