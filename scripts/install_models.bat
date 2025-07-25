@echo off
echo Installing required Ollama models...

echo.
echo Reading model configuration from models.json...

REM Check for local override first, then default
set "MODELS_CONFIG_FILE=..\models.json"
if exist "..\models.local.json" (
    echo Using local model configuration override: models.local.json
    set "MODELS_CONFIG_FILE=..\models.local.json"
) else if exist "..\models.json" (
    echo Using default model configuration: models.json
    set "MODELS_CONFIG_FILE=..\models.json"
) else (
    echo ERROR: Neither models.json nor models.local.json found in parent directory!
    echo Please ensure at least models.json is in the project root.
    pause
    exit /b 1
)

REM Get model list from JSON using Node.js
for /f "tokens=*" %%i in ('node -e "const config = require(process.argv[1]); const allModels = [...config.models, ...(config.additional_models || [])]; allModels.forEach(model => console.log(model.name + '|' + (model.magi ? model.magi : 'additional')));" "%MODELS_CONFIG_FILE%"') do (
    for /f "tokens=1,2 delims=|" %%a in ("%%i") do (
        echo.
        echo Installing %%a ^(%%b^)...
        wsl -e ollama pull %%a
        if errorlevel 1 (
            echo Failed to install %%a model.
            echo You can try installing it manually with: wsl -e ollama pull %%a
            REM Don't exit - continue with other models
        ) else (
            echo Successfully installed %%a
        )
    )
)

echo.
echo Model installation complete!
echo Current model list:
wsl -e ollama list

pause 