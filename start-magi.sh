#!/bin/bash

echo "[Magi System] Starting The Magi Environment..."

# Argument parsing
USE_NODEMON=true
for arg in "$@"; do
  case "$arg" in
    --no-nodemon)
      USE_NODEMON=false
      shift
      ;;
  esac
done

# Environment override (optional)
if [ "${MAGI_NO_NODEMON}" = "true" ]; then
  USE_NODEMON=false
fi

# Check for Node.js and npm first
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found in PATH"
    echo "       Please run ./install-magi.sh first to set up the environment."
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found in PATH"
    echo "       Please run ./install-magi.sh first to set up the environment."
    exit 1
fi

echo "[Magi System] Node.js and npm found."

# Determine which Ollama binary to use
OLLAMA_LOCAL_BIN="$(pwd)/services/conduit/CUDA/bin/ollama"
if [ -f "$OLLAMA_LOCAL_BIN" ]; then
    OLLAMA_CMD="$OLLAMA_LOCAL_BIN"
    echo "[Magi System] Using local GPU-enabled Ollama installation."
elif command -v ollama &> /dev/null; then
    OLLAMA_CMD="ollama"
    echo "[Magi System] Using system Ollama installation."
else
    echo "ERROR: Ollama not found in PATH or local installation"
    echo "       Please run ./install-magi.sh first to install Ollama and AI models."
    exit 1
fi

# Set up environment variables
MODELS_DIR="$(pwd)/.models"
export OLLAMA_MODELS="$MODELS_DIR"
export OLLAMA_HOST="127.0.0.1:11434"

# Ollama performance optimization environment variables
export OLLAMA_NUM_THREADS=8
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_MAX_QUEUE=256
export OLLAMA_CONTEXT_LENGTH=4096

# Check if Ollama service is running
if ! curl -s http://localhost:11434/api/version > /dev/null; then
    echo "[Magi System] Starting Ollama service..."
    CUDA_VISIBLE_DEVICES=0 OLLAMA_MODELS="$MODELS_DIR" OLLAMA_HOST="127.0.0.1:11434" $OLLAMA_CMD serve &
    OLLAMA_PID=$!
    sleep 5  # Give more time for GPU initialization
    
    # Verify Ollama started
    if ! curl -s http://localhost:11434/api/version > /dev/null; then
        echo "ERROR: Failed to start Ollama service"
        echo "       Please check if Ollama is properly installed."
        kill $OLLAMA_PID 2>/dev/null
        exit 1
    fi
    echo "[Magi System] Ollama service started successfully."
else
    echo "[Magi System] Ollama service already running."
fi

# Check for required AI models
echo "[Magi System] Verifying AI models..."

MODELS_OUTPUT=$(OLLAMA_MODELS="$MODELS_DIR" $OLLAMA_CMD list 2>/dev/null)
MISSING_MODELS=""

# Check models from models.json (with local override support)
MODELS_CONFIG_FILE="models.json"
if [ -f "models.local.json" ]; then
    echo "[Magi System] Using local model configuration override: models.local.json"
    MODELS_CONFIG_FILE="models.local.json"
elif [ -f "models.json" ]; then
    MODELS_CONFIG_FILE="models.json"
else
    echo "[ERROR] Neither models.json nor models.local.json found! Cannot verify AI models."
    exit 1
fi

# Get list of required models
REQUIRED_MODEL_NAMES=$(node -e "
    const config = require('./' + process.argv[1]);
    const allModels = [...config.models.map(m => m.name)];
    if (config.additional_models) {
        allModels.push(...config.additional_models.map(m => m.name));
    }
    console.log(allModels.join(' '));
" "$MODELS_CONFIG_FILE")

# Check each model
for model in $REQUIRED_MODEL_NAMES; do
    if ! echo "$MODELS_OUTPUT" | grep -q "$model"; then
        MISSING_MODELS="$MISSING_MODELS $model"
    fi
done

if [ -n "$MISSING_MODELS" ]; then
    echo "WARNING: Missing AI models:$MISSING_MODELS"
    echo "         The Magi may not function properly without all models."
    echo "         Please run ./install-magi.sh to download missing models."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "[ABORTED] Please install missing models first."
        exit 1
    fi
else
    echo "[Magi System] All required AI models found."
fi

# Check Python TTS environment
TTS_DIR="$(pwd)/services/tts"
if [ -d "$TTS_DIR/venv" ]; then
    echo "[Magi System] Python TTS environment found."
    # Quick test of TTS environment
    cd "$TTS_DIR"
    source venv/bin/activate
    python3 -c "import torch, fastapi" 2>/dev/null
    if [ $? -ne 0 ]; then
        echo "WARNING: Python TTS environment may be corrupted."
        echo "         Please run ./install-magi.sh to reinstall dependencies."
    fi
    deactivate
    cd - > /dev/null
else
    echo "WARNING: Python TTS environment not found."
    echo "         Please run ./install-magi.sh to set up the TTS service."
fi

# Install dependencies if node_modules are missing
if [ ! -d "ui/node_modules" ]; then
    echo "[Magi System] Installing UI dependencies..."
    pushd ui > /dev/null
    npm install
    if [ $? -ne 0 ]; then
        popd > /dev/null
        echo "ERROR: UI dependency installation failed"
        exit 1
    fi
    popd > /dev/null
fi

if [ ! -d "services/orchestrator/node_modules" ]; then
    echo "[Magi System] Installing Orchestrator dependencies..."
    pushd services/orchestrator > /dev/null
    npm install
    if [ $? -ne 0 ]; then
        popd > /dev/null
        echo "ERROR: Orchestrator dependency installation failed"
        echo "       Please run ./install-magi.sh for a complete setup."
        exit 1
    fi
    popd > /dev/null
fi

# Check if Conduit service is built
if [ ! -d "services/conduit/dist" ]; then
    echo "[Magi System] Building Conduit service..."
    pushd services/conduit > /dev/null
    if [ ! -d "node_modules" ]; then
        npm install
        if [ $? -ne 0 ]; then
            popd > /dev/null
            echo "ERROR: Conduit dependency installation failed"
            echo "       Please run ./install-magi.sh for a complete setup."
            exit 1
        fi
    fi
    npm run build
    if [ $? -ne 0 ]; then
        popd > /dev/null
        echo "ERROR: Conduit build failed"
        echo "       Please run ./install-magi.sh for a complete setup."
        exit 1
    fi
    popd > /dev/null
fi

echo
if [ "$USE_NODEMON" = true ]; then
  echo "[Magi System] Starting Orchestrator with nodemon (development mode). Press CTRL+C to shut down."
else
  echo "[Magi System] Starting Orchestrator without nodemon (single-run mode). Press CTRL+C to shut down."
fi
echo

# Start the orchestrator in the current window. This will block the script.
cd services/orchestrator
if [ "$USE_NODEMON" = true ]; then
  npm run dev
else
  npm start
fi

echo "[Magi System] Orchestrator has shut down."