## Project Overview

The Magi is a personal AI system featuring three distinct AI personas (Caspar, Melchior, Balthazar) that deliberate together to provide intelligent guidance to the user.

More detail on the project can be found in the [project-context.md](project-context.md) file in the root directory

## Architecture

The system follows a microservices architecture:

1. **Orchestrator** (`services/orchestrator/`): Main service that coordinates deliberation between three AI personas using different models (Mistral, Gemma, Llama2)
2. **Conduit** (`services/conduit/`): Wrapper service around Ollama API for AI model communication
3. **UI** (`ui/`): Angular 20 frontend that communicates via WebSocket to the orchestrator and displays status of the system visually to the user
4. **TTS Service** (`services/tts/`): Python-based text-to-speech service

### Startup process
1. start-magi script launches the orchestrator service
2. the orchestrator servcie then starts
    - TTS service
    - Conduit service
    - UI backend service

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

## Development Notes

- All services use TypeScript with similar tsconfig setups
- Orchestrator uses Winston for logging
- UI uses Angular 20 with RxJS for reactive programming
- CORS configured to allow UI dev server (localhost:4200)
- System initialization includes diagnostics and Magi loading phases
- WebSocket used for real-time communication between UI and backend
- The locations of the models are in a .models folder in the project root (not uploaded to git)

## Testing

- There are Github actions configured to run tests on all pushes
- All tests can be run by running the `run-all-tests.sh` script

## Coding guidance
1. First think through the problem, read the codebase for relevant files, and write a plan to tasks/todo.md.
2. The plan should have a list of todo items that you can check off as you complete them
3. Then, begin working on the todo items, marking them as complete as you go.
4. Please every step of the way just give me a high level explanation of what changes you made
5. Make every task and code change you do as simple as possible. We want to avoid making any massive or complex changes. Every change should impact as little code as possible. Everything is about simplicity.
6. instead of "spec" in the test file name, this project will use "test" in the file name