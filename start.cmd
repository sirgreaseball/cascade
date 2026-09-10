@echo off
rem Cascade - one-click start on Windows. Double-click this file.
rem Installs dependencies the first time, builds an optimised version, opens the browser.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get the LTS version from https://nodejs.org and run this again.
  pause
  exit /b 1
)
if not exist node_modules (
  echo Installing dependencies - first run only...
  call npm install --no-audit --no-fund || goto :fail
)
echo Building Cascade...
call npm run build || goto :fail
echo Starting Cascade at http://localhost:3000
start "" http://localhost:3000
call npm run start
exit /b 0
:fail
echo Something went wrong. Scroll up for the error message.
pause
exit /b 1
