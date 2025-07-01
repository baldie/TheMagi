@echo off
setlocal EnableDelayedExpansion

echo [Dev Env] Starting Magi Development Environment...

:: Check if Node.js is installed
echo [Dev Env] Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [Dev Env] ERROR: Node.js is not installed or not in PATH
    echo [Dev Env] Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if npm is installed
echo [Dev Env] Checking for npm...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [Dev Env] ERROR: npm is not installed or not in PATH
    pause
    exit /b 1
)

goto :main

:: Function to check if a port is in use
:checkPort
set "port=%~1"
echo [Dev Env] Checking for usage of port %port%...
netstat -ano | findstr ":%port%" | findstr "LISTENING" >nul
exit /b %ERRORLEVEL%

:: Kill process on a specific port if it exists
:killPort
set "port=%~1"
echo [Dev Env] Checking for processes on port %port%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%port%" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        echo [Dev Env] Terminating existing process on port %port% with PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
exit /b 0

:main
:: --- Install dependencies if needed ---
echo [Dev Env] Checking and installing dependencies...

:: Launcher dependencies
if not exist "launcher\node_modules" (
    echo [Dev Env] Installing Launcher dependencies...
    pushd launcher
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo [Dev Env] ERROR: Failed to install Launcher dependencies
        popd
        pause
        exit /b 1
    )
    popd
)

:: UI dependencies
if not exist "ui\node_modules" (
    echo [Dev Env] Installing UI dependencies...
    pushd ui
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo [Dev Env] ERROR: Failed to install UI dependencies
        popd
        pause
        exit /b 1
    )
    popd
)

:: --- Start Launcher Service ---
echo [Dev Env] Checking for existing Launcher service on port 3000...
call :killPort 3000

echo [Dev Env] Starting Launcher service...
pushd launcher
start "Magi Launcher" cmd /k "color 0A && echo Starting Magi Launcher... && npm start"
if !ERRORLEVEL! NEQ 0 (
    echo [Dev Env] ERROR: Failed to start Launcher service
    popd
    pause
    exit /b 1
)
popd

:: Wait for launcher to be available
echo [Dev Env] Waiting for Launcher to initialize...
:waitForLauncher
timeout /t 2 >nul
call :checkPort 3000
if !ERRORLEVEL! NEQ 0 (
    echo [Dev Env] Waiting for Launcher to start...
    goto waitForLauncher
)
echo [Dev Env] Launcher is running.

:: --- Start UI Application ---
echo [Dev Env] Checking for existing UI service on port 4200...
call :killPort 4200

echo [Dev Env] Starting UI application...
pushd ui
start "Magi UI" cmd /k "color 0B && echo Starting Magi UI... && npm start"
if !ERRORLEVEL! NEQ 0 (
    echo [Dev Env] ERROR: Failed to start UI application
    popd
    pause
    exit /b 1
)
popd

:: Wait for UI to be available
echo [Dev Env] Waiting for UI to initialize...
:waitForUI
timeout /t 2 >nul
call :checkPort 4200
if !ERRORLEVEL! NEQ 0 (
    echo [Dev Env] Waiting for UI to start...
    goto waitForUI
)
echo [Dev Env] UI is running.

:: --- Launch UI in Browser ---
echo [Dev Env] Opening UI in default browser...
timeout /t 2 >nul
start http://localhost:4200

echo [Dev Env] All services started successfully!
echo [Dev Env] UI: http://localhost:4200
echo [Dev Env] Launcher: http://localhost:3000

endlocal 