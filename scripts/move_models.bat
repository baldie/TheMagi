@echo off
echo Ensuring WSL environment is clean...
wsl --shutdown
timeout /t 2 > nul

echo Moving Ollama models to default location...
wsl -e bash -c "sudo service docker stop 2>/dev/null || true && sudo pkill -9 ollama 2>/dev/null || true && mkdir -p ~/.ollama/models && sudo cp -r /usr/share/ollama/.ollama/models/* ~/.ollama/models/ 2>/dev/null || true && sudo chown -R $USER:$USER ~/.ollama && echo 'Models moved successfully to ~/.ollama/models'"

if errorlevel 1 (
    echo Failed to move models. Please check the error message above.
    pause
    exit /b 1
)

echo Models have been moved to the default location.
echo You can now start the Magi application.
pause 