# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

The Magi is a personal AI system featuring three distinct AI personas (Caspar, Melchior, Balthazar) that deliberate together to provide intelligent responses. The system runs on Windows using WSL and consists of:

- **Orchestrator Service**: Central deliberation engine managing three AI personas
- **Conduit Service**: API interface to Ollama for AI model interactions  
- **UI Service**: Angular frontend for user interaction
- **TTS Service**: Text-to-speech functionality (Python-based)

## Architecture

The system follows a microservices architecture:

1. **Orchestrator** (`services/orchestrator/`): Main service that coordinates deliberation between three AI personas using different models (Mistral, Gemma, Llama2)
2. **Conduit** (`services/conduit/`): Wrapper service around Ollama API for AI model communication
3. **UI** (`ui/`): Angular 20 frontend that communicates via WebSocket to trigger deliberations
4. **TTS Service** (`services/tts_microservice/`): Python-based text-to-speech service

## Common Commands

### Installation & Setup
```bash
# Initial setup
./install-magi.bat

# Start the system
./start-magi.bat
```

### System Management
```bash
# Check system status in real-time
./scripts/system-status.bat

# Run startup diagnostics
./scripts/diagnose-startup.bat

# Fix TTS service issues
./services/tts/fix_tts.bat

# Clear TTS service instances
./scripts/clear-tts-instances.bat

# Check specific port status and service health
./scripts/check-port.bat 8000 "TTS Service"
./scripts/check-port.bat 8080 "Orchestrator"
./scripts/check-port.bat 4200 "UI Service"

# Test TTS service specifically
./scripts/test-tts.bat

# Debug TTS startup issues
./scripts/debug-tts-startup.bat

# Check Python virtual environment
./scripts/check-python-venv.bat
```

### Development Commands

#### Orchestrator Service
```bash
cd services/orchestrator
npm run build          # Build TypeScript
npm run start          # Start with compiled JS
npm run dev            # Start with hot reload
npm run format         # Format code with Prettier
npm run format:check   # Check formatting
```

#### Conduit Service
```bash
cd services/conduit
npm run build          # Build TypeScript
npm run start          # Start service
```

#### UI Service
```bash
cd ui
npm run start          # Start Angular dev server (port 4200)
npm run build          # Build for production
npm run test           # Run tests
npm run watch          # Build and watch for changes
```

## Key Components

### Magi Personas
- **Caspar** (Mistral): Temperature 0.7, primary voice for responses
- **Melchior** (Gemma): Temperature 0.9, creative/intuitive perspective  
- **Balthazar** (Llama2): Temperature 0.2, logical/analytical perspective

Each persona has its own personality file in `services/orchestrator/src/personalities/`

### Communication Flow
1. UI sends WebSocket message to Orchestrator (port 8080)
2. Orchestrator triggers deliberation process
3. Each Magi persona contacted via Conduit service
4. Final response spoken via TTS service
5. Response sent back to UI via WebSocket

### Configuration
- Orchestrator runs on port 8080 (HTTP/WebSocket)
- UI development server runs on port 4200
- TTS service runs on port 8000 (Chatterbox TTS)
- Conduit service URL configured in `services/orchestrator/src/config.ts`

### Startup Process
1. **start-magi.bat** verifies system requirements (Node.js, Python, WSL, Ollama)
2. Installs dependencies if needed (UI and Orchestrator npm packages)
3. Starts TTS service with comprehensive dependency checking
4. Waits for TTS to become healthy with detailed status monitoring (up to 6 minutes)
5. Starts Orchestrator service and waits for initialization (up to 30 seconds)
6. Starts UI service and waits for it to be ready
7. Opens UI in browser once all services are running

**Enhanced Features**:
- **Automatic dependency installation**: Missing Python packages are installed automatically
- **Detailed status reporting**: Real-time feedback on initialization stages
- **Intelligent error handling**: Distinguishes between temporary delays and permanent failures
- **Robust port checking**: Verifies service health, not just port occupation
- **Extended timeouts**: Accommodates large model downloads (10+ minutes on first run)

**TTS Service States**:
- `starting`: Service is initializing
- `checking_dependencies`: Verifying Python packages
- `configuring_device`: Setting up CPU/GPU for model
- `downloading_model`: First-time model download (can take 10+ minutes)
- `initializing`: Model loading in progress
- `healthy`: Service ready for requests
- `failed`: Permanent failure requiring manual intervention

## Development Notes

- All services use TypeScript with similar tsconfig setups
- Orchestrator uses Winston for logging
- UI uses Angular 20 with RxJS for reactive programming
- CORS configured to allow UI dev server (localhost:4200)
- System initialization includes diagnostics and Magi loading phases
- WebSocket used for real-time communication between UI and backend

## Testing

- Orchestrator: No tests currently configured
- Conduit: No tests currently configured  
- UI: Jasmine/Karma test suite (`npm run test`)

## Coding guidance

 - **Use Explicit Variable Names**: Prefer descriptive, explicit variable names over short, ambiguous ones to enhance code readability.
 - **No Unnecessary Updates**: Don't suggest updates or changes to files when there are no actual modifications needed.
 - **Error Handling**: Implement robust error handling and logging where necessary.
 - **Modular Design**: Encourage modular design principles to improve code maintainability and reusability.
 - **Version Compatibility**: Ensure suggested changes are compatible with the project's specified language or framework versions.
 - **Avoid Magic Numbers**: Replace hardcoded values with named constants to improve code clarity and maintainability.
 - **Simplicity**: Try to provide the simplest approach and avoid overly complex solutions.
 - **Terminal use**: I am running on a windows pc, using WSL, so before you default to using powershell, consider the command you plan to run and consider opening a WSL terminal if needed. You cannot concatenate commands in Powershell with the && operator. You will instead need to run multiple commands
 - **Blast area**: Always think about what other areas of the code might be affected by the changes you are proposing and modify the code accordingly