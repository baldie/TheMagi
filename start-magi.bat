@echo off
SETLOCAL

ECHO [Magi System] Starting up...

:: --- Check for .env file and FFMPEG_PATH ---
IF NOT EXIST .env (
    ECHO [Magi System] ERROR: The .env file is missing.
    ECHO This file is required to locate the ffmpeg installation for audio playback.
    ECHO Please run the main installation script first:
    ECHO.
    ECHO     install-magi.bat
    ECHO.
    pause
    EXIT /B 1
)
:: ---------------------------------------------

ECHO [Magi System] Launching Orchestrator...
ECHO This will start all necessary background services.
cd orchestrator
call npm run start

ENDLOCAL