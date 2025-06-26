@echo off
echo Installing required Ollama models...

echo.
echo Installing llama2...
wsl -e ollama pull llama2
if errorlevel 1 (
    echo Failed to install llama2 model.
    pause
    exit /b 1
)

echo.
echo Installing gemma...
wsl -e ollama pull gemma
if errorlevel 1 (
    echo Failed to install gemma model.
    pause
    exit /b 1
)

echo.
echo Installing mistral...
wsl -e ollama pull mistral
if errorlevel 1 (
    echo Failed to install mistral model.
    pause
    exit /b 1
)

echo.
echo All models installed successfully!
echo Current model list:
wsl -e ollama list

pause 