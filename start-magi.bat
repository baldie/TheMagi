@echo off
setlocal

echo [Magi System] Starting up...

:: --- Port Cleanup ---
echo [Magi System] Cleaning up port 11434 to ensure a clean start...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr "LISTENING" ^| findstr ":11434"') do (
    if not "%%a"=="0" (
        echo [Magi System] Terminating stale process with PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
echo [Magi System] Port cleanup complete.

:: Define path to the orchestrator directory
set "ORCHESTRATOR_DIR=%~dp0orchestrator"

echo [Magi System] Launching Orchestrator...
echo This will start all necessary background services.

pushd "%ORCHESTRATOR_DIR%"
echo [Magi System] Building Orchestrator from source...
call npm run build

echo [Magi System] Starting Orchestrator from built files...
call node dist/index.js
popd

endlocal