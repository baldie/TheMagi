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
echo Installing gemma3:4b...
wsl -e ollama pull gemma3:4b
if errorlevel 1 (
    echo Failed to install gemma3 model.
    pause
    exit /b 1
)

echo.
echo Tagging gemma3:4b as gemma for compatibility...
wsl -e ollama tag gemma3:4b gemma
wsl -e ollama rm gemma3:4b

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