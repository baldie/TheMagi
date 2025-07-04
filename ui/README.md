# The Magi UI

This project is the user interface for The Magi system. It is an [Angular](https://angular.dev/) application that provides a visual interface for interacting with the three Magi personas: Balthasar, Casper, and Melchior.

## Features

- Real-time communication with the Magi orchestrator via WebSocket
- Audio playback support for Magi responses
- Dynamic status monitoring of all services
- Interactive command interface
- Visual representation of each Magi's status
- System log display and monitoring

## Prerequisites

Before you begin, ensure you have the following installed:
* [Node.js](https://nodejs.org/) (which includes npm)
* [Angular CLI](https://angular.dev/tools/cli)

## Installation

The UI is typically installed as part of the main Magi system using `install-magi.bat`. However, if you need to install it separately:

1. Navigate to the `ui` directory
2. Install the dependencies:
   ```bash
   npm install
   ```

## Development Server

To start the UI service:

1. Ensure the Magi orchestrator service is running (should be available at `http://localhost:8080`)
2. Start the development server:
   ```bash
   npm start
   ```
3. Open your browser and navigate to `http://localhost:4200/`

The application will automatically reload if you change any of the source files.

## Architecture

The UI consists of several key components:

- **Base Magi Component**: Common functionality shared across all Magi personas
- **Individual Magi Components**: Specific implementations for Balthasar, Casper, and Melchior
- **WebSocket Service**: Handles real-time communication with the orchestrator
- **Audio Service**: Manages audio playback for Magi responses

## Service Integration

The UI integrates with several backend services:

- **Orchestrator** (`http://localhost:8080`): Main control service
- **TTS Service** (via orchestrator): Handles text-to-speech conversion
- **Health Monitoring**: Checks service status every 5 seconds

## Building for Production

To build the project for production deployment:

```bash
npm run build
```

The build artifacts will be stored in the `dist/ui/` directory.

## Development

### Running Tests

To execute the unit tests via [Karma](https://karma-runner.github.io):

```bash
npm test
```

### Code Style

The project uses Prettier for code formatting with specific overrides for Angular templates:
```json
{
  "overrides": [
    {
      "files": "*.html",
      "options": {
        "parser": "angular"
      }
    }
  ]
}
```

## Troubleshooting

Common issues and solutions:

1. **UI shows "Orchestrator Unavailable"**
   - Ensure the orchestrator service is running on port 8080
   - Check the orchestrator's health endpoint at `http://localhost:8080/health`

2. **No Audio Playback**
   - Ensure your browser allows audio playback
   - Check that the TTS service is running and accessible

3. **WebSocket Connection Failed**
   - Verify the orchestrator service is running
   - Check for any firewall restrictions on WebSocket connections
