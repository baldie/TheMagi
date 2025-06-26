@echo OFF
SETLOCAL EnableDelayedExpansion

REM =================================================================================
REM The Magi - Master Installation Script
REM This script orchestrates the entire setup process for The Magi system.
REM =================================================================================

ECHO.
ECHO    Welcome to The Magi Setup
ECHO.
ECHO This script will prepare your system by:
ECHO   1. Installing ffmpeg for audio processing (locally)
ECHO   2. Setting up the TTS (Text-to-Speech) service
ECHO   3. Installing all Node.js dependencies for the main orchestrator
ECHO   4. Verifying the complete setup
ECHO =================================================================================
pause

:: Set up ffmpeg
ECHO [1/4] Setting up ffmpeg...

:: First check if ffmpeg is already in system PATH
where ffmpeg >nul 2>&1
IF !ERRORLEVEL! EQU 0 (
    ECHO ffmpeg is already installed and accessible.
    GOTO FFMPEG_DONE
)

:: Set up local paths in the project directory
SET "TOOLS_DIR=%~dp0tools"
SET "FFMPEG_DIR=!TOOLS_DIR!\ffmpeg"
SET "FFMPEG_ZIP=!FFMPEG_DIR!\ffmpeg.zip"

:: Check for existing ffmpeg installation in our tools directory
IF EXIST "!FFMPEG_DIR!\ffmpeg-*-essentials_build\bin\ffmpeg.exe" (
    :: Find ffmpeg bin directory
    FOR /F "tokens=*" %%G IN ('dir /b /s /ad "!FFMPEG_DIR!\*bin"') DO SET "FFMPEG_BIN=%%G"
    IF DEFINED FFMPEG_BIN (
        ECHO Found existing ffmpeg installation at !FFMPEG_BIN!
        SET "PATH=!FFMPEG_BIN!;!PATH!"
        GOTO FFMPEG_DONE
    )
)

:: If we get here, we need to download ffmpeg
ECHO No existing ffmpeg installation found.

:: Create directories if they don't exist
IF NOT EXIST "!TOOLS_DIR!" MKDIR "!TOOLS_DIR!"
IF NOT EXIST "!FFMPEG_DIR!" MKDIR "!FFMPEG_DIR!"

ECHO Downloading ffmpeg...
powershell -Command "& {Invoke-WebRequest -Uri 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip' -OutFile '!FFMPEG_ZIP!'}"

ECHO Extracting ffmpeg...
powershell -Command "& {Expand-Archive -Path '!FFMPEG_ZIP!' -DestinationPath '!FFMPEG_DIR!' -Force}"

:: Clean up zip file
DEL "!FFMPEG_ZIP!"

:: Find ffmpeg bin directory
FOR /F "tokens=*" %%G IN ('dir /b /s /ad "!FFMPEG_DIR!\*bin"') DO SET "FFMPEG_BIN=%%G"
IF NOT DEFINED FFMPEG_BIN (
    ECHO ERROR: Could not find ffmpeg bin directory
    EXIT /B 1
)

:: Add ffmpeg to current session PATH
SET "PATH=!FFMPEG_BIN!;!PATH!"

:: Create a .env file to store the ffmpeg path for future sessions
ECHO FFMPEG_PATH=!FFMPEG_BIN!> .env
ECHO Created .env file with ffmpeg path

:FFMPEG_DONE
:: Verify ffmpeg installation
ffmpeg -version > nul 2>&1
IF !ERRORLEVEL! NEQ 0 (
    ECHO ERROR: ffmpeg installation failed
    pause
    EXIT /B 1
)
ECHO ffmpeg setup complete.

:: Install Orchestrator dependencies
ECHO [2/4] Setting up Orchestrator...
cd orchestrator
call npm install
cd ..

:: Install TTS Microservice dependencies
ECHO [3/4] Setting up TTS Microservice...
cd services/tts_microservice
call setup_tts.bat
cd ../..

:: Verify installation
ECHO [4/4] Verifying installation...
where ffmpeg > nul 2>&1
IF !ERRORLEVEL! NEQ 0 (
    ECHO ERROR: ffmpeg is not accessible in the current session
    pause
    EXIT /B 1
)

ECHO.
ECHO The Magi installation complete.
ECHO Note: ffmpeg is installed locally in the tools directory.
ECHO       The TTS service will automatically use this local installation.
ECHO.
pause

ENDLOCAL 