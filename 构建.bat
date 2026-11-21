@echo off
cd /d "%~dp0"
echo [1/4] Installing dependencies...
call npm install
if errorlevel 1 (
  echo Failed to install dependencies
  pause
  exit /b 1
)
echo [2/4] Building...
call npm run build
if errorlevel 1 (
  echo Build failed
  pause
  exit /b 1
)
echo [3/4] Preparing built-in upstream services...
python ".\prepare-upstream.py"
if errorlevel 1 (
  echo Preparing upstream services failed
  pause
  exit /b 1
)
echo [4/4] Packing ZIP...
python ".\pack.py"
if errorlevel 1 (
  echo Packing failed
  pause
  exit /b 1
)
echo.
echo Build done:
echo   Folder: kz-plugin-music-front\
echo   ZIP:    kz-plugin-music-front-v*.zip
echo   (built-in upstream services are included)
echo.
echo NOTE: This script does NOT copy to kakake\plugins - migrate manually.
pause
