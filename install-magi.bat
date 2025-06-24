@echo off
ECHO ===================================
ECHO  INSTALLING THE MAGI DEPENDENCIES
ECHO ===================================
ECHO.

ECHO [1/2] Installing Orchestrator (Node.js) dependencies...
ECHO This may take a moment...
cd orchestrator
call npm install
if errorlevel 1 goto :error
cd ..
ECHO ... Orchestrator dependencies installed successfully.
ECHO.

ECHO [2/2] Installing TTS Microservice (Python) dependencies...
ECHO This will download the TTS models and may take several minutes...

cd services\tts_microservice

ECHO Checking for Python...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo "Python not found, please install Python 3 and ensure it is in your PATH"
    goto :error
)

ECHO Creating Python virtual environment...
python -m venv venv
if %errorlevel% neq 0 (
    echo "Failed to create Python virtual environment"
    goto :error
)

ECHO Installing Python dependencies...
call venv\Scripts\activate.bat
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo "Failed to install Python dependencies"
    goto :error
)

cd ..\..

ECHO ... TTS Microservice dependencies installed successfully.
ECHO.
ECHO ===================================
ECHO      INSTALLATION COMPLETE
ECHO ===================================
ECHO You can now run the application by executing start-magi.bat
ECHO.
goto :eof

:error
ECHO.
ECHO ===================================
ECHO      INSTALLATION FAILED
ECHO ===================================
ECHO Please review the error messages above to troubleshoot.
ECHO.

:eof
pause 