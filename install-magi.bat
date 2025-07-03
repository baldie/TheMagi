@echo off
SETLOCAL EnableDelayedExpansion

REM =================================================================================
REM The Magi - Master Installation Script
REM This script orchestrates the entire setup process for The Magi system.
REM =================================================================================

:: Set the script directory as the working directory
cd /d "%~dp0"
echo Working directory set to: %CD%

:: Check if running with administrator privileges
NET SESSION >nul 2>&1
if %errorLevel% == 0 (
    echo Running with administrator privileges...
) else (
    echo This script requires administrator privileges.
    echo Please run as administrator.
    pause
    exit /b 1
)

:: Check for Node.js
node --version > nul 2>&1
if %errorLevel% NEQ 0 (
    echo Node.js is not installed. Please install Node.js and try again.
    pause
    exit /b 1
)

:: Check for Python
python --version > nul 2>&1
if %errorLevel% NEQ 0 (
    echo Python is not installed. Please install Python and try again.
    pause
    exit /b 1
)

:: Check for WSL
wsl --version >nul 2>&1
if %errorLevel% NEQ 0 (
    echo WSL is not installed. Please install WSL and try again.
    pause
    exit /b 1
)

:: Create default .env if it doesn't exist
if not exist .env (
    echo Creating a new .env file with default settings...
    (
        echo # TTS Service Configuration
        echo TTS_API_BASE_URL=http://localhost:8020
        echo.
        echo # Logging Configuration
        echo LOG_LEVEL=info
    ) > .env
    echo.
    echo A new .env file has been created. Please review it if you need to change the default configuration.
) else (
    echo .env file already exists. Skipping creation.
)

ECHO.
ECHO    Welcome to The Magi Setup
ECHO.
ECHO This script will prepare your system by:
ECHO   1. Installing FFmpeg for audio processing (if needed)
ECHO   2. Setting up the TTS (Text-to-Speech) service
ECHO   3. Installing all Node.js dependencies for the services
ECHO   4. Setting up the UI application
ECHO =================================================================================
pause

:: Install FFmpeg
ECHO [1/4] Setting up FFmpeg...
:: Check if FFmpeg is available in PATH or in common install locations
where ffmpeg >nul 2>&1
if !errorLevel! EQU 0 (
    echo FFmpeg is already available in PATH.
) else (
    if exist "C:\ffmpeg\bin\ffmpeg.exe" (
        echo FFmpeg is already installed in C:\ffmpeg.
    ) else (
        echo Installing FFmpeg...
        powershell -ExecutionPolicy Bypass -File "scripts\install_ffmpeg.ps1"
        if !errorLevel! NEQ 0 (
            echo ERROR: Failed to install FFmpeg
            pause
            exit /b 1
        )
    )
)

:: Install TTS Service dependencies
ECHO [2/4] Setting up TTS Service...
echo Current directory: %CD%
echo Checking if services\tts exists...
if exist "services\tts" (
    echo Directory services\tts exists
) else (
    echo ERROR: Directory services\tts does not exist
    pause
    exit /b 1
)
echo Changing to services\tts directory...
pushd services\tts
if !errorLevel! NEQ 0 (
    echo ERROR: Failed to change to services\tts directory
    pause
    exit /b 1
)
echo Now in directory: %CD%
echo Checking if setup_tts.bat exists...
if exist "setup_tts.bat" (
    echo setup_tts.bat exists, running it...
    call setup_tts.bat
) else (
    echo ERROR: setup_tts.bat not found in current directory
    dir
    popd
    pause
    exit /b 1
)
if !errorLevel! NEQ 0 (
    echo ERROR: Failed to set up TTS service
    popd
    pause
    exit /b 1
)
popd

:: Install Orchestrator dependencies
ECHO [3/4] Setting up Orchestrator...
pushd services\orchestrator
call npm install
if !errorLevel! NEQ 0 (
    echo ERROR: Failed to install Orchestrator dependencies
    popd
    pause
    exit /b 1
)
popd

:: Install UI dependencies
ECHO [4/4] Setting up UI...
pushd ui
call npm install
if !errorLevel! NEQ 0 (
    echo ERROR: Failed to install UI dependencies
    popd
    pause
    exit /b 1
)
popd

echo.
echo Installation complete!
echo You can now run start-magi.bat to start the system.
echo.
pause

ENDLOCAL 