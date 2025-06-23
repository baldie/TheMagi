# The Magi TTS Microservice

A FastAPI-based text-to-speech microservice for The Magi AI system, providing distinct voices for three AI personas: **Balthazar** (Male), **Melchior** (Female), and **Caspar** (Unisex).

## Features

- 🎭 **Three Distinct Voices**: Each persona has a unique voice personality
- ⚡ **FastAPI Performance**: High-performance async API with automatic documentation
- 🎵 **Coqui AI TTS**: Professional-grade speech synthesis using Coqui AI's TTS library
- 🚀 **Production Ready**: Proper error handling, logging, and health checks
- 📚 **Auto Documentation**: Swagger/OpenAPI documentation automatically generated

## Voice Personas

| Persona | Voice Type | Description | Model |
|---------|------------|-------------|-------|
| **Balthazar** | Male | Wise and authoritative | `tts_models/en/vctk/p225` |
| **Melchior** | Female | Warm and nurturing | `tts_models/en/vctk/p228` |
| **Caspar** | Unisex | Balanced and neutral | `tts_models/en/vctk/p232` |

## Installation

### Prerequisites

- WSL (Windows Subsystem for Linux) environment
- Internet connection (for model downloads)
- Sudo access in WSL

### Quick Setup (Recommended)

1. **Navigate to the service directory in WSL:**
   ```bash
   cd /mnt/c/Users/David/TheMagi/services/tts_microservice
   ```

2. **Run the automated setup script:**
   ```bash
   chmod +x setup_tts.sh
   ./setup_tts.sh
   ```

3. **Start the service:**
   ```bash
   chmod +x start_service.sh
   ./start_service.sh
   ```

The setup script will automatically:
- Install Python 3 and required system packages
- Create a virtual environment
- Install all Python dependencies
- Set up the TTS models

### Alternative Setup (Python 3.11 - Better TTS Compatibility)

If you encounter TTS installation issues with Python 3.12, use Python 3.11:

```bash
cd /mnt/c/Users/David/TheMagi/services/tts_microservice
chmod +x setup_python311.sh
./setup_python311.sh
```

### Manual Setup

If you prefer to set up manually:

1. **Navigate to the service directory:**
   ```bash
   cd /mnt/c/Users/David/TheMagi/services/tts_microservice
   ```

2. **Install system dependencies:**
   ```bash
   sudo apt update
   sudo apt install -y python3 python3-pip python3-venv build-essential python3-dev
   ```

3. **Create a virtual environment:**
   ```bash
   python3 -m venv venv
   source venv/bin/activate
   ```

4. **Install Python dependencies:**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

5. **Run the service:**
   ```bash
   python main.py
   ```

The service will start on `http://localhost:8000` and automatically download the required TTS models on first run.

## API Endpoints

### Base URL
```
http://localhost:8000
```

### Endpoints

#### `GET /`
Service information and available personas.

#### `GET /health`
Health check endpoint.

#### `GET /api/personas`
Get detailed information about available personas and their voice configurations.

#### `POST /api/generate-speech`
Generate speech from text using a specific persona's voice.

**Request Body:**
```json
{
  "text": "Hello, I am Balthazar from The Magi AI system.",
  "persona": "Balthazar"
}
```

**Response:**
- **Success (200)**: Raw audio data in WAV format
- **Error (400)**: Invalid persona or request
- **Error (500)**: TTS generation failure

## Usage Examples

### Using curl

```bash
# Generate speech with Balthazar's voice
curl -X POST "http://localhost:8000/api/generate-speech" \
  -H "Content-Type: application/json" \
  -d '{"text": "Welcome to The Magi AI system.", "persona": "Balthazar"}' \
  --output balthazar_speech.wav

# Generate speech with Melchior's voice
curl -X POST "http://localhost:8000/api/generate-speech" \
  -H "Content-Type: application/json" \
  -d '{"text": "I am Melchior, your AI assistant.", "persona": "Melchior"}' \
  --output melchior_speech.wav

# Generate speech with Caspar's voice
curl -X POST "http://localhost:8000/api/generate-speech" \
  -H "Content-Type: application/json" \
  -d '{"text": "Caspar here, ready to assist you.", "persona": "Caspar"}' \
  --output caspar_speech.wav
```

### Using Python

```python
import requests

# Generate speech
response = requests.post(
    "http://localhost:8000/api/generate-speech",
    json={
        "text": "Hello from The Magi AI system!",
        "persona": "Balthazar"
    }
)

if response.status_code == 200:
    # Save the audio
    with open("speech.wav", "wb") as f:
        f.write(response.content)
    print("Speech generated successfully!")
else:
    print(f"Error: {response.json()}")
```

### Using TypeScript/JavaScript

```typescript
// Generate speech
const response = await fetch('http://localhost:8000/api/generate-speech', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    text: 'Hello from The Magi AI system!',
    persona: 'Balthazar'
  })
});

if (response.ok) {
  const audioBlob = await response.blob();
  const audioUrl = URL.createObjectURL(audioBlob);
  
  // Play the audio
  const audio = new Audio(audioUrl);
  audio.play();
} else {
  const error = await response.json();
  console.error('Error:', error);
}
```

## API Documentation

Once the service is running, you can access the interactive API documentation:

- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Configuration

### Voice Models

The voice models are configured in the `VOICE_CONFIG` dictionary in `main.py`. You can modify the model paths to use different voices:

```python
VOICE_CONFIG = {
    "Balthazar": "tts_models/en/vctk/p225",  # Male voice
    "Melchior": "tts_models/en/vctk/p228",   # Female voice
    "Caspar": "tts_models/en/vctk/p232"      # Unisex voice
}
```

### Available Models

Coqui AI TTS provides many pre-trained models. You can explore available models at: https://tts.readthedocs.io/en/latest/models.html

## Performance Notes

- **First Run**: Models are downloaded automatically (~100-500MB each)
- **GPU Acceleration**: Automatically detected and used if available
- **Memory Usage**: Each model requires ~1-2GB RAM when loaded
- **Response Time**: ~1-3 seconds for typical text lengths

## Troubleshooting

### Common Issues

1. **TTS Installation Fails (Python 3.12)**
   ```bash
   # Use Python 3.11 for better TTS compatibility
   ./setup_python311.sh
   
   # Or try manual installation
   pip install TTS --no-deps
   pip install torch torchaudio
   pip install TTS
   ```

2. **Python Command Not Found**
   ```bash
   # Use python3 instead of python
   python3 main.py
   
   # Or create a symlink
   sudo ln -sf /usr/bin/python3 /usr/bin/python
   ```

3. **Virtual Environment Issues**
   ```bash
   # Install python3-venv
   sudo apt install python3-venv
   
   # Recreate virtual environment
   rm -rf venv
   python3 -m venv venv
   source venv/bin/activate
   ```

4. **Model Download Fails**
   - Ensure stable internet connection
   - Check available disk space (models are ~100-500MB each)
   - Try running with `--verbose` flag for detailed logs

5. **Out of Memory**
   - Reduce number of loaded models
   - Use CPU-only mode if GPU memory is limited
   - Restart the service to free memory

6. **Audio Quality Issues**
   - Ensure input text is properly formatted
   - Avoid very long texts (max 1000 characters)
   - Check that the correct persona is specified

### WSL-Specific Issues

1. **Permission Denied**
   ```bash
   # Make scripts executable
   chmod +x setup_tts.sh start_service.sh
   ```

2. **Package Installation Fails**
   ```bash
   # Update package lists
   sudo apt update
   
   # Install specific Python version packages
   sudo apt install python3.12-venv  # or your Python version
   ```

3. **TTS Compatibility Issues**
   ```bash
   # Check Python version
   python3 --version
   
   # If using Python 3.12, consider downgrading to 3.11
   sudo apt install python3.11 python3.11-venv
   python3.11 -m venv venv
   ```

### Logs

The service provides detailed logging. Check the console output for:
- Model loading progress
- API request details
- Error messages and stack traces

## Development

### Running in Development Mode

```bash
# Activate virtual environment
source venv/bin/activate

# Run with auto-reload
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

### Testing

```bash
# Test the health endpoint
curl http://localhost:8000/health

# Test persona information
curl http://localhost:8000/api/personas

# Test speech generation
curl -X POST "http://localhost:8000/api/generate-speech" \
  -H "Content-Type: application/json" \
  -d '{"text": "Test message", "persona": "Balthazar"}' \
  --output test.wav
```

## Scripts

### `setup_tts.sh`
Automated setup script that handles all installation steps with fallback options.

### `setup_python311.sh`
Alternative setup script using Python 3.11 for better TTS compatibility.

### `start_service.sh`
Quick start script to run the service after setup.

### `requirements_fallback.txt`
Fallback requirements with flexible version constraints.

## License

This project is part of The Magi AI system.

## Support

For issues and questions related to The Magi TTS microservice, please refer to the main project documentation. 