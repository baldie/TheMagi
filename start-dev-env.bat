@echo off
setlocal

echo [Dev Env] This script will start the Magi Launcher and the UI application.
echo [Dev Env] Each service will open in a new terminal window.

:: --- Start Launcher Service (Idempotent) ---
echo [Dev Env] Checking for existing Launcher service on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":3000"') do (
    if not "%%a"=="0" (
        echo [Dev Env] Terminating existing Launcher process with PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)

echo [Dev Env] Starting new Launcher service in a new window...
pushd launcher
start "Magi Launcher" cmd /c "npm install && npm start"
popd

:: Give the launcher a moment to start up
echo [Dev Env] Waiting for Launcher to initialize...
timeout /t 5 >nul

:: --- Start UI Application ---
echo [Dev Env] Starting UI application in a new window...
pushd ui
start "Magi UI" cmd /c "npm start"
popd

echo [Dev Env] All services started.

endlocal 