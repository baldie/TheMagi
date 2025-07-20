#!/bin/bash

echo "[Magi Conduit] Starting Ollama service for Magi Conduit..."

# Determine which Ollama binary to use
OLLAMA_LOCAL_BIN="$(dirname "$(pwd)")/services/conduit/CUDA/bin/ollama"
if [ -f "$OLLAMA_LOCAL_BIN" ]; then
    OLLAMA_CMD="$OLLAMA_LOCAL_BIN"
    echo "[Magi Conduit] Using local GPU-enabled Ollama installation."
elif command -v ollama &> /dev/null; then
    OLLAMA_CMD="ollama"
    echo "[Magi Conduit] Using system Ollama installation."
else
    echo "ERROR: Ollama not found in PATH or local installation"
    echo "       Please run ./install-magi.sh first to install Ollama and AI models."
    exit 1
fi

# Set up environment variables
MODELS_DIR="$(dirname "$(pwd)")/.models"
export OLLAMA_MODELS="$MODELS_DIR"

# Ollama performance optimization environment variables
export OLLAMA_NUM_THREADS=8
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_MAX_QUEUE=256
export OLLAMA_CONTEXT_LENGTH=4096

# Check if Ollama service is already running
if curl -s http://localhost:11434/api/version > /dev/null; then
    echo "[Magi Conduit] Ollama service already running."
    exit 0
fi

echo "[Magi Conduit] Starting Ollama service..."
CUDA_VISIBLE_DEVICES=0 OLLAMA_MODELS="$MODELS_DIR" $OLLAMA_CMD serve &
OLLAMA_PID=$!
sleep 5  # Give time for GPU initialization

# Verify Ollama started
if ! curl -s http://localhost:11434/api/version > /dev/null; then
    echo "ERROR: Failed to start Ollama service"
    echo "       Please check if Ollama is properly installed."
    kill $OLLAMA_PID 2>/dev/null
    exit 1
fi

echo "[Magi Conduit] Ollama service started successfully."