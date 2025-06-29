@echo OFF
SETLOCAL EnableDelayedExpansion

REM =================================================================================
REM The Magi - Master Installation Script
REM This script orchestrates the entire setup process for The Magi system.
REM =================================================================================

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
ECHO   1. Installing ffmpeg for audio processing (if needed)
ECHO   2. Setting up the TTS (Text-to-Speech) service
ECHO   3. Installing all Node.js dependencies for the main orchestrator
ECHO   4. Verifying the complete setup
ECHO =================================================================================
pause

:: Set up ffmpeg
ECHO [1/4] Setting up ffmpeg...

:: Initialize variables
SET "FFMPEG_BIN_PATH="
SET "TOOLS_DIR=%~dp0tools"
SET "FFMPEG_DIR=!TOOLS_DIR!\\ffmpeg"
SET "FFMPEG_ZIP=!FFMPEG_DIR!\\ffmpeg.zip"
SET "NEED_TERMINAL_RESTART=0"
SET "DOWNLOAD_URL=https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"

:CHECK_SYSTEM_PATH
:: --- 1. Check if ffmpeg is already in the system PATH ---
ECHO [INFO] Checking for existing ffmpeg in system PATH...
where ffmpeg >nul 2>&1
IF !ERRORLEVEL! EQU 0 (
    FOR /F "tokens=*" %%F IN ('where ffmpeg') DO (
        SET "FFMPEG_BIN_PATH=%%~dpF"
        ECHO [SUCCESS] Found system-wide ffmpeg at: !FFMPEG_BIN_PATH!
        GOTO FFMPEG_DONE
    )
)

:CHECK_LOCAL_INSTALL
:: --- 2. Check if ffmpeg exists in tools directory ---
ECHO [INFO] Checking for local ffmpeg installation...
FOR /R "!FFMPEG_DIR!" %%F IN (ffmpeg.exe) DO (
    IF EXIST "%%F" (
        SET "FFMPEG_BIN_PATH=%%~dpF"
        ECHO [SUCCESS] Found local ffmpeg at: !FFMPEG_BIN_PATH!
        SET "NEED_TERMINAL_RESTART=1"
        GOTO UPDATE_PATH
    )
)

:PREPARE_DOWNLOAD
:: Create necessary directories
IF NOT EXIST "!TOOLS_DIR!" MKDIR "!TOOLS_DIR!"
IF NOT EXIST "!FFMPEG_DIR!" MKDIR "!FFMPEG_DIR!"

:: Remove existing zip if it exists (it might be corrupted)
IF EXIST "!FFMPEG_ZIP!" (
    ECHO [INFO] Removing existing ffmpeg archive...
    DEL "!FFMPEG_ZIP!" >nul 2>&1
)

:DOWNLOAD_FFMPEG
:: Download ffmpeg
ECHO [INFO] Downloading ffmpeg from !DOWNLOAD_URL!...
powershell -Command "& { $ProgressPreference = 'SilentlyContinue'; try { Invoke-WebRequest -Uri '!DOWNLOAD_URL!' -OutFile '!FFMPEG_ZIP!' -ErrorAction Stop; Write-Host '[SUCCESS] Download completed.' } catch { Write-Host '[ERROR] Download failed: ' $_.Exception.Message; exit 1 } }"
IF !ERRORLEVEL! NEQ 0 (
    ECHO [ERROR] Failed to download ffmpeg.
    ECHO         Please check your internet connection and try again.
    pause
    EXIT /B 1
)

:: Verify the downloaded file exists and has size greater than 0
IF NOT EXIST "!FFMPEG_ZIP!" (
    ECHO [ERROR] Download failed - zip file not found.
    pause
    EXIT /B 1
)
FOR %%I IN ("!FFMPEG_ZIP!") DO IF %%~zI LEQ 0 (
    ECHO [ERROR] Download failed - zip file is empty.
    DEL "!FFMPEG_ZIP!" >nul 2>&1
    pause
    EXIT /B 1
)

:EXTRACT_FFMPEG
ECHO [INFO] Extracting ffmpeg...
:: First, try to validate the zip file
powershell -Command "& { try { $zip = [System.IO.Compression.ZipFile]::OpenRead('!FFMPEG_ZIP!'); $zip.Dispose(); Write-Host '[SUCCESS] Zip file validation successful.' } catch { Write-Host '[ERROR] Invalid or corrupted zip file.'; exit 1 } }"
IF !ERRORLEVEL! NEQ 0 (
    ECHO [ERROR] The downloaded zip file appears to be corrupted.
    ECHO         Deleting corrupted file and retrying download...
    DEL "!FFMPEG_ZIP!" >nul 2>&1
    GOTO DOWNLOAD_FFMPEG
)

:: If validation passed, attempt extraction
powershell -Command "& { $ProgressPreference = 'SilentlyContinue'; try { Expand-Archive -Path '!FFMPEG_ZIP!' -DestinationPath '!FFMPEG_DIR!' -Force -ErrorAction Stop } catch { Write-Host '[ERROR] Extraction failed: ' $_.Exception.Message; exit 1 } }"
IF !ERRORLEVEL! NEQ 0 (
    ECHO [ERROR] Failed to extract ffmpeg.
    ECHO         Deleting corrupted files and retrying download...
    DEL "!FFMPEG_ZIP!" >nul 2>&1
    GOTO DOWNLOAD_FFMPEG
)

:: Clean up zip file after successful extraction
DEL "!FFMPEG_ZIP!" >nul 2>&1

:: Find the extracted ffmpeg.exe
FOR /R "!FFMPEG_DIR!" %%F IN (ffmpeg.exe) DO (
    IF EXIST "%%F" (
        SET "FFMPEG_BIN_PATH=%%~dpF"
        SET "NEED_TERMINAL_RESTART=1"
        GOTO UPDATE_PATH
    )
)

ECHO [ERROR] Could not find ffmpeg.exe after extraction.
ECHO         This might be due to an unexpected archive structure.
ECHO         Please report this issue.
pause
EXIT /B 1

:UPDATE_PATH
:: Add ffmpeg to current session PATH
SET "PATH=!FFMPEG_BIN_PATH!;!PATH!"

:: Create a .env file to store the ffmpeg path
ECHO FFMPEG_PATH=!FFMPEG_BIN_PATH!> .env
ECHO [SUCCESS] .env file created with ffmpeg path.

:: Add ffmpeg path to PowerShell profile for permanent access
ECHO [INFO] Adding ffmpeg to PowerShell profile...
SET "PS_COMMAND=$ffmpegPath = '!FFMPEG_BIN_PATH!'; $profileFile = $PROFILE; if (-not (Test-Path (Split-Path $profileFile -Parent))) { New-Item -ItemType Directory -Path (Split-Path $profileFile -Parent) -Force | Out-Null }; if (-not (Test-Path $profileFile)) { New-Item -ItemType File -Path $profileFile -Force | Out-Null }; if (-not (Select-String -Path $profileFile -Pattern ([regex]::Escape($ffmpegPath)) -Quiet)) { Add-Content -Path $profileFile -Value ('`n# Add The Magi project ffmpeg to PATH`n$env:Path = ''{0};'' + $env:Path' -f $ffmpegPath) }"
powershell -NoProfile -ExecutionPolicy Bypass -Command "!PS_COMMAND!"

:FFMPEG_DONE
:: Verify ffmpeg is now accessible
ffmpeg -version >nul 2>&1
IF !ERRORLEVEL! NEQ 0 (
    ECHO [ERROR] ffmpeg verification failed. Please restart your terminal and try again.
    pause
    EXIT /B 1
)

IF !NEED_TERMINAL_RESTART! EQU 1 (
    ECHO [IMPORTANT] ffmpeg has been added to your PATH.
    ECHO            You will need to restart your terminal for this change to take effect.
    ECHO            However, this script will continue using the current session's updated PATH.
    ECHO.
)

ECHO [SUCCESS] ffmpeg setup complete.

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
where ffmpeg >nul 2>&1
IF !ERRORLEVEL! NEQ 0 (
    ECHO [ERROR] ffmpeg is not accessible in the current session.
    ECHO         Please restart your terminal and try running the script again.
    pause
    EXIT /B 1
)

ECHO.
ECHO The Magi installation complete!
IF !NEED_TERMINAL_RESTART! EQU 1 (
    ECHO.
    ECHO REMINDER: You will need to restart your terminal for ffmpeg to be
    ECHO          accessible in new terminal windows.
)
ECHO.
pause

ENDLOCAL 