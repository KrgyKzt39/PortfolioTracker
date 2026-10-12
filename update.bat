@echo off
setlocal EnableExtensions
rem Updates Portfolio Tracker to the latest version on GitHub.
rem Keeps your data (data\) and keys (.env); backs up the database first.

rem Run from a temporary copy: this file itself gets replaced during the update.
if /i not "%~1"=="--run" (
  copy /y "%~f0" "%TEMP%\pt-update-run.bat" >nul
  "%TEMP%\pt-update-run.bat" --run "%~dp0."
)
cd /d "%~2" || (echo Could not open the app folder. & pause & exit /b 1)
title Update Portfolio Tracker

set "BRANCH=claude/keen-goodall-7je98z"
set "ZIP_URL=https://github.com/KrgyKzt39/PortfolioTracker/archive/refs/heads/%BRANCH%.zip"
set "WORK=%TEMP%\pt-update"

echo.
echo  Update Portfolio Tracker
echo  ------------------------
echo  Downloads the latest version. Your holdings (data\) and keys (.env) are kept.
echo.
echo  Close the app's black window first if it is open.
echo.
pause

rem ---- 1. Back up the database --------------------------------------------
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
if exist "data\portfolio.db" (
  if not exist "data\backups" mkdir "data\backups"
  copy /y "data\portfolio.db" "data\backups\pre-update-%STAMP%.db" >nul || (echo Backup failed, nothing was changed. & pause & exit /b 1)
  if exist "data\portfolio.db-wal" copy /y "data\portfolio.db-wal" "data\backups\pre-update-%STAMP%.db-wal" >nul
  echo [1/3] Backed up your data to data\backups\pre-update-%STAMP%.db
) else (
  echo [1/3] No database yet, nothing to back up.
)

rem ---- 2. Download and unpack ---------------------------------------------
echo [2/3] Downloading the latest version...
if exist "%WORK%" rmdir /s /q "%WORK%"
mkdir "%WORK%"
powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -UseBasicParsing '%ZIP_URL%' -OutFile '%WORK%\update.zip'; Expand-Archive -Force '%WORK%\update.zip' '%WORK%\src'"
if errorlevel 1 (
  echo Download failed. Check your internet connection and try again. Nothing was changed.
  pause & exit /b 1
)
set "SRC="
for /d %%d in ("%WORK%\src\*") do set "SRC=%%d"
if not defined SRC (echo The download was empty. Nothing was changed. & pause & exit /b 1)

rem ---- 3. Copy over the app (never touching data, keys or installed packages) --
echo [3/3] Updating files...
robocopy "%SRC%" "%CD%" /E /NFL /NDL /NJH /NJS /NP /XD data .venv node_modules dist .git /XF .env >nul
if errorlevel 8 (echo Copying files failed. Your data is untouched. & pause & exit /b 1)
rem Force a fresh build of the web app on the next start.
if exist "frontend\dist" rmdir /s /q "frontend\dist"
rmdir /s /q "%WORK%" 2>nul

echo.
echo  Updated. Starting the app...
echo.
call start.bat
exit /b
