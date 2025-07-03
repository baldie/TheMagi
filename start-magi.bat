@echo off
setlocal EnableDelayedExpansion

echo [Magi System] Starting The Magi Environment...

:: Check if Node.js is installed
echo [Magi System] Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [Magi System] ERROR: Node.js is not installed or not in PATH
    echo [Magi System] Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

:: Check if npm is installed
echo [Magi System] Checking for npm...
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [Magi System] ERROR: npm is not installed or not in PATH
    pause
    exit /b 1
)

:: Check for WSL
wsl --version >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo WSL is not installed. Please install WSL and try again.
    pause
    exit /b 1
)

:: Check for Ollama installation
echo [Magi System] Checking for Ollama installation...
set "OLLAMA_FOUND=0"

:: Check for Ollama in WSL first
echo [Magi System] Checking for Ollama in WSL...
wsl -e which ollama >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [Magi System] Ollama found in WSL
    set "OLLAMA_FOUND=1"
    set "OLLAMA_LOCATION=WSL"
) else (
    :: Check for Ollama in Windows PATH
    echo [Magi System] Checking for Ollama in Windows PATH...
    where ollama >nul 2>&1
    if !ERRORLEVEL! EQU 0 (
        echo [Magi System] Ollama found in Windows PATH
        set "OLLAMA_FOUND=1"
        set "OLLAMA_LOCATION=Windows"
    ) else (
        :: Check common Windows installation paths
        echo [Magi System] Checking common Ollama installation paths...
        if exist "%USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe" (
            echo [Magi System] Ollama found at %USERPROFILE%\AppData\Local\Programs\Ollama\ollama.exe
            set "OLLAMA_FOUND=1"
            set "OLLAMA_LOCATION=Local"
        ) else if exist "%PROGRAMFILES%\Ollama\ollama.exe" (
            echo [Magi System] Ollama found at %PROGRAMFILES%\Ollama\ollama.exe
            set "OLLAMA_FOUND=1"
            set "OLLAMA_LOCATION=ProgramFiles"
        ) else (
            :: Check if Ollama service is running (indicates installation)
            echo [Magi System] Checking if Ollama service is running...
            curl -s http://localhost:11434 >nul 2>&1
            if !ERRORLEVEL! EQU 0 (
                echo [Magi System] Ollama service is running on localhost:11434
                set "OLLAMA_FOUND=1"
                set "OLLAMA_LOCATION=Service"
            )
        )
    )
)

if "%OLLAMA_FOUND%"=="0" (
    echo [Magi System] ERROR: Ollama is not installed or not running
    echo [Magi System] Please install Ollama from https://ollama.com/download
    echo [Magi System] Or ensure the Ollama service is running
    pause
    exit /b 1
) else (
    echo [Magi System] Ollama detected at: %OLLAMA_LOCATION%
)

:: Check for models directory
if not exist ".models" (
    echo [Magi System] Models directory not found. Running model installation...
    call scripts\install_models.bat
    if %ERRORLEVEL% NEQ 0 (
        echo [Magi System] ERROR: Failed to install models
        pause
        exit /b 1
    )
)

goto :main

:: Function to check if a port is in use
:checkPort
set "port=%~1"
echo [Magi System] Checking for usage of port %port%...
netstat -ano | findstr ":%port%" | findstr "LISTENING" >nul
exit /b %ERRORLEVEL%

:: Kill process on a specific port if it exists
:killPort
set "port=%~1"
echo [Magi System] Checking for processes on port %port%...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":%port%" ^| findstr "LISTENING"') do (
    if not "%%a"=="0" (
        echo [Magi System] Terminating existing process on port %port% with PID: %%a
        taskkill /F /PID %%a >nul 2>&1
    )
)
exit /b 0

:main
:: --- Install dependencies if needed ---
echo [Magi System] Checking and installing dependencies...

:: UI dependencies
if not exist "ui\node_modules" (
    echo [Magi System] Installing UI dependencies...
    pushd ui
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo [Magi System] ERROR: Failed to install UI dependencies
        popd
        pause
        exit /b 1
    )
    popd
)

:: Orchestrator dependencies
if not exist "services\orchestrator\node_modules" (
    echo [Magi System] Installing Orchestrator dependencies...
    pushd services\orchestrator
    call npm install
    if !ERRORLEVEL! NEQ 0 (
        echo [Magi System] ERROR: Failed to install Orchestrator dependencies
        popd
        pause
        exit /b 1
    )
    popd
)

:: --- Start TTS Service ---
echo [Magi System] Starting TTS service...
pushd services\tts
start "Magi TTS" cmd /k "start_service.bat"
popd

:: --- Start Orchestrator Service ---
echo [Magi System] Checking for existing Orchestrator service on port 8080...
call :killPort 8080

echo [Magi System] Starting Orchestrator service...
pushd services\orchestrator
start "Magi Orchestrator" cmd /k "npm start"
if !ERRORLEVEL! NEQ 0 (
    echo [Magi System] ERROR: Failed to start Orchestrator service
    popd
    pause
    exit /b 1
)
popd


:: --- Start UI Application ---
echo [Magi System] Checking for existing UI service on port 4200...
call :killPort 4200

echo [Magi System] Starting UI application...
pushd ui
start "Magi UI" cmd /k "color 0B && echo Starting Magi UI... && npm start"
if !ERRORLEVEL! NEQ 0 (
    echo [Magi System] ERROR: Failed to start UI application
    popd
    pause
    exit /b 1
)
popd

:: Wait for UI to be available
echo [Magi System] Waiting for UI to initialize...
:waitForUI
timeout /t 2 >nul
call :checkPort 4200
if !ERRORLEVEL! NEQ 0 (
    echo [Magi System] Waiting for UI to start...
    goto waitForUI
)
echo [Magi System] UI is running.

:: --- Launch UI in Browser ---
echo [Magi System] Opening UI in default browser...
timeout /t 2 >nul
start http://localhost:4200

echo [Magi System] All services started successfully!
echo [Magi System] UI: http://localhost:4200
echo [Magi System] Orchestrator: http://localhost:8080

endlocal