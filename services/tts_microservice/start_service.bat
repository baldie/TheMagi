@echo off
REM This script activates the Python virtual environment and starts the TTS FastAPI server.
REM It is intended to be called by the main orchestrator application.

REM Change to the script's directory
cd /d "%~dp0"

ECHO [TTS Service] Activating Python virtual environment...
call venv\Scripts\activate.bat
if errorlevel 1 (
    ECHO [TTS Service] ERROR: Failed to activate virtual environment.
    exit /b 1
)

ECHO [TTS Service] Starting FastAPI server with Uvicorn on port 8000...
ECHO [TTS Service] (Setting environment variables to suppress dependency warnings)
set HF_HUB_DISABLE_SYMLINKS_WARNING=1
python -m uvicorn main:app --host 0.0.0.0 --port 8000 