@echo OFF
echo "Setting up TTS Microservice..."

:: Set the base directory to the location of this script
set "BASE_DIR=%~dp0"
set "VENV_DIR=%BASE_DIR%venv"

:: Load ffmpeg path from .env file if it exists
set "FFMPEG_BIN="
if exist "..\..\\.env" (
    for /F "tokens=1,2 delims==" %%G in (..\..\\.env) do (
        if "%%G"=="FFMPEG_PATH" set "FFMPEG_BIN=%%H"
    )
)

:: If no .env file, try to find ffmpeg in tools directory
if not defined FFMPEG_BIN (
    for /F "tokens=*" %%G in ('dir /b /s /ad "..\..\tools\ffmpeg\*bin"') do set "FFMPEG_BIN=%%G"
)

:: Set ffmpeg in PATH if found
if defined FFMPEG_BIN (
    set "PATH=%FFMPEG_BIN%;%PATH%"
    echo "Using ffmpeg from: %FFMPEG_BIN%"
)

:: Create a virtual environment if it doesn't exist
if not exist "%VENV_DIR%" (
    echo "Creating virtual environment..."
    python -m venv "%VENV_DIR%"
)

:: Create a batch file to set environment variables for the virtual environment
echo @echo OFF > "%VENV_DIR%\Scripts\env.bat"
if defined FFMPEG_BIN (
    echo set "PATH=%FFMPEG_BIN%;%%PATH%%" >> "%VENV_DIR%\Scripts\env.bat"
)
echo set "PYTHONPATH=%BASE_DIR%;%%PYTHONPATH%%" >> "%VENV_DIR%\Scripts\env.bat"

:: Modify activate.bat to call our env.bat
findstr /c:"call env.bat" "%VENV_DIR%\Scripts\activate.bat" > nul
if errorlevel 1 (
    echo call "%%~dp0env.bat" >> "%VENV_DIR%\Scripts\activate.bat"
)

:: Activate the virtual environment and install dependencies
echo "Activating virtual environment and installing dependencies..."
call "%VENV_DIR%\Scripts\activate.bat"

:: Verify ffmpeg is accessible
ffmpeg -version > nul 2>&1
if errorlevel 1 (
    echo "WARNING: ffmpeg is not accessible. Please ensure ffmpeg is installed."
) else (
    echo "ffmpeg is accessible in the virtual environment"
)

pip install --upgrade pip
pip install -r "%BASE_DIR%requirements.txt"

echo "TTS Microservice setup complete." 