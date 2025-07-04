@echo off
setlocal EnableDelayedExpansion

echo =================================================================================
echo  The Magi - Master Installation Script
echo =================================================================================
echo This script will set up the complete development environment for The Magi.

cd /d "%~dp0"
echo.
echo [Magi Installer] Working directory set to: %CD%
echo.

:: ---------------------------------------------------------------------------------
:: Step 1: System Dependency Verification
:: ---------------------------------------------------------------------------------
echo [Magi Installer] Step 1: Verifying system dependencies...

:: Check for Node.js
where node >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in your PATH.
    echo         Please install it from https://nodejs.org and ensure it's in your PATH.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('node -v') do set NODE_VERSION=%%i
echo   [OK] Node.js found: !NODE_VERSION!

:: Check for npm
where npm >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] npm is not installed or not in your PATH.
    pause
    exit /b 1
)
for /f "tokens=*" %%i in ('npm -v') do set NPM_VERSION=%%i
echo   [OK] npm found: !NPM_VERSION!

:: Check for Python
where python >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Python is not installed or not in your PATH.
    echo         Please install Python 3.11 from https://www.python.org/
    echo         Ensure you check "Add Python to PATH" during installation.
    pause
    exit /b 1
)
for /f "tokens=2" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
echo   [OK] Python found: !PYTHON_VERSION! (Python 3.11 is recommended for TTS)

:: Check for Git
where git >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Git is not installed or not in your PATH.
    echo         Git is required to install some Python dependencies.
    echo         Please install it from https://git-scm.com/
    pause
    exit /b 1
)
echo   [OK] Git found.

echo [Magi Installer] All system dependencies verified.
echo.

:: ---------------------------------------------------------------------------------
:: Step 2: Node.js Dependency Installation
:: ---------------------------------------------------------------------------------
echo [Magi Installer] Step 2: Installing Node.js dependencies...

echo   - Installing Orchestrator dependencies...
pushd services\orchestrator
call npm install
if !errorLevel! neq 0 (
    echo [ERROR] Failed to install Orchestrator dependencies. Check logs for details.
    popd
    pause
    exit /b 1
)
popd
echo     [OK] Orchestrator dependencies installed.

echo   - Installing UI dependencies...
pushd ui
call npm install
if !errorLevel! neq 0 (
    echo [ERROR] Failed to install UI dependencies. Check logs for details.
    popd
    pause
    exit /b 1
)
popd
echo     [OK] UI dependencies installed.
echo [Magi Installer] All Node.js dependencies installed successfully.
echo.

:: ---------------------------------------------------------------------------------
:: Step 3: Python TTS Service Setup
:: ---------------------------------------------------------------------------------
echo [Magi Installer] Step 3: Setting up Python environment for TTS service...

set TTS_DIR=%CD%\services\tts
if not exist "!TTS_DIR!" (
    echo [ERROR] TTS service directory not found at: !TTS_DIR!
    pause
    exit /b 1
)

echo   - Checking for Python virtual environment...
if exist "!TTS_DIR!\venv\Scripts\activate.bat" (
    echo     Virtual environment already exists. Skipping creation.
) else (
    echo     Virtual environment not found. Creating it now...
    python -m venv "!TTS_DIR!\venv"
    if !errorLevel! neq 0 (
        echo [ERROR] Failed to create Python virtual environment.
        echo         Please ensure Python and the 'venv' module are working correctly.
        pause
        exit /b 1
    )
    echo     [OK] Virtual environment created successfully.
)

echo   - Installing Python dependencies from requirements.txt...
call "!TTS_DIR!\venv\Scripts\activate.bat"
pip install -r "!TTS_DIR!\requirements.txt"
if !errorLevel! neq 0 (
    echo [ERROR] Failed to install Python dependencies from requirements.txt.
    echo         Please check your internet connection and the contents of the requirements file.
    echo         Some packages may require Visual C++ Build Tools.
    pause
    exit /b 1
)
echo     [OK] Python dependencies installed successfully.
echo [Magi Installer] TTS Service setup complete.
echo.

:: ---------------------------------------------------------------------------------
:: Finalization
:: ---------------------------------------------------------------------------------
echo =================================================================================
echo  The Magi Installation Is Complete!
echo =================================================================================
echo.
echo  Your environment is now ready. To start the system, run:
echo.
echo      start-magi.bat
echo.
echo =================================================================================

pause
endlocal 