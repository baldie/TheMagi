@echo off
setlocal

echo [Magi System] Starting The Magi Environment...

:: Check for Node.js and npm first
where node >nul 2>&1 || (echo ERROR: Node.js not found in PATH & pause & exit /b 1)
where npm >nul 2>&1 || (echo ERROR: npm not found in PATH & pause & exit /b 1)
echo [Magi System] Node.js and npm found.

:: Install dependencies if node_modules are missing
if not exist "ui/node_modules" (
    echo [Magi System] Installing UI dependencies...
    pushd ui
    call npm install
    if !ERRORLEVEL! NEQ 0 (popd & echo ERROR: UI dependency installation failed & pause & exit /b 1)
    popd
)
if not exist "services/orchestrator/node_modules" (
    echo [Magi System] Installing Orchestrator dependencies...
    pushd services/orchestrator
    call npm install
    if !ERRORLEVEL! NEQ 0 (popd & echo ERROR: Orchestrator dependency installation failed & pause & exit /b 1)
    popd
)

echo.
echo [Magi System] Starting Orchestrator, press CTRL+C in this window to shut down the Magi.
echo.

:: Start the orchestrator in the current window. This will block the script.
cd services/orchestrator
call npm start

echo [Magi System] Orchestrator has shut down.
endlocal