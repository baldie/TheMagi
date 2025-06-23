@echo off
ECHO Starting The Magi Development Environment...

ECHO Starting TTS Microservice in WSL...
:: Start the Python TTS service in a new window via WSL
start "TTS Service" wsl --cd ./services/tts_microservice/ bash -c "source .venv/bin/activate && uvicorn main:app --reload"

ECHO Starting Orchestrator...
:: Navigate to the orchestrator directory and start the main app
cd orchestrator
npm run start