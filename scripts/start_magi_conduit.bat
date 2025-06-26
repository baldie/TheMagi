@echo off
echo Cleaning up any processes using port 11434...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":11434"') do (
    if not "%%a"=="0" (
        echo Terminating process with PID: %%a
        taskkill /F /PID %%a 2>nul
    )
)

echo Resetting Windows TCP/IP stack...
netsh int ip delete arpcache >nul 2>&1
netsh winsock reset >nul 2>&1
netsh int ip reset >nul 2>&1

echo Ensuring WSL environment is clean...
wsl --shutdown
timeout /t 2 > nul

echo Terminating any WSL instances...
taskkill /F /IM "wslhost.exe" 2>nul
timeout /t 2 > nul

echo Starting Magi Conduit (Ollama) service within WSL...
wsl -e bash -c "sudo service docker stop 2>/dev/null || true; sudo pkill -9 ollama 2>/dev/null || true; sudo rm -f /tmp/ollama.sock 2>/dev/null || true; ollama serve" &

echo Waiting for Magi Conduit to start...
timeout /t 5 > nul

echo Verifying models are accessible...
wsl -e bash -c "ollama list"
if errorlevel 1 (
    echo Failed to verify models. Please check the error message above.
    pause
    exit /b 1
)

echo Magi Conduit is running and models are accessible.
echo Press Ctrl+C to stop the service.
pause 