@echo off
echo ==============================================
echo Installing Dependencies...
echo ==============================================
call npm install

echo.
echo ==============================================
echo Starting The Server...
echo ==============================================

:: Start browser after a brief delay
start "" http://localhost:3000

:: Start the node application
node server.js
pause
