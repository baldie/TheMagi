@echo off
echo Installing required Ollama models...

echo.
echo Installing llama3.2:3b-instruct-q8_0...
wsl -e ollama pull llama3.2:3b-instruct-q8_0
if errorlevel 1 (
    echo Failed to install llama3.2:3b-instruct-q8_0 model.
    pause
    exit /b 1
)

echo.
echo Installing gemma3:4b...
wsl -e ollama pull gemma3:4b
if errorlevel 1 (
    echo Failed to install gemma3:4b model.
    pause
    exit /b 1
)

echo.
echo Installing qwen2.5vl:3b...
wsl -e ollama pull qwen2.5vl:3b
if errorlevel 1 (
    echo Failed to install qwen2.5vl:3b model.
    pause
    exit /b 1
)

echo.
echo All models installed successfully!
echo Current model list:
wsl -e ollama list

pause 