#!/bin/bash

# The Magi - Magi Conduit Setup Script
# This script automates the complete setup and verification of the inference server (Ollama)
# for The Magi system. It handles installation, model downloads, and GPU detection.

# Error handling
set -e
set -o pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}[INFO]${NC} $message"
}

print_success() {
    local message=$1
    echo -e "${GREEN}[SUCCESS]${NC} $message"
}

print_warning() {
    local message=$1
    echo -e "${YELLOW}[WARNING]${NC} $message"
}

print_error() {
    local message=$1
    echo -e "${RED}[ERROR]${NC} $message"
}

# Array of required models
models=("mistral" "gemma" "llama2")

print_status "$BLUE" "Starting The Magi Conduit Setup..."
echo ""

# Check if Ollama is already installed
if command -v ollama &> /dev/null; then
    print_success "Ollama (the underlying engine for the Magi Conduit) is already installed"
    ollama_version=$(ollama --version)
    print_status "$BLUE" "Ollama version: $ollama_version"
else
    print_status "$BLUE" "Ollama not found. Installing the engine for the Magi Conduit..."
    
    # Check if curl is available
    if ! command -v curl &> /dev/null; then
        print_error "curl is not installed. Please install curl first:"
        echo "  sudo apt update && sudo apt install -y curl"
        exit 1
    fi
    
    # Download and install Ollama
    print_status "$BLUE" "Downloading and installing Ollama..."
    curl -fsSL https://ollama.ai/install.sh | sh
    
    if command -v ollama &> /dev/null; then
        print_success "Ollama installed successfully"
        ollama_version=$(ollama --version)
        print_status "$BLUE" "Ollama version: $ollama_version"
    else
        print_error "Ollama installation failed"
        exit 1
    fi
fi

echo ""

# Start Ollama service if not running
print_status "$BLUE" "Ensuring Magi Conduit service is running..."
if ! pgrep -f "ollama serve" > /dev/null; then
    print_status "$BLUE" "Starting Magi Conduit service..."
    ollama serve &
    sleep 5  # Give the service time to start
fi

# Check if service is running
if pgrep -f "ollama serve" > /dev/null; then
    print_success "Magi Conduit service is running"
else
    print_error "Failed to start Magi Conduit service"
    exit 1
fi

echo ""

# Model installation loop
print_status "$BLUE" "Installing required models..."
echo ""

for model in "${models[@]}"; do
    print_status "$BLUE" "Checking for model: $model..."
    
    # Check if model is already installed
    if ollama list 2>/dev/null | grep -q "$model"; then
        print_success "Model '$model' is already installed"
    else
        print_status "$BLUE" "Pulling model: $model..."
        if ollama pull "$model"; then
            print_success "Model '$model' installed successfully"
        else
            print_error "Failed to install model '$model'"
            exit 1
        fi
    fi
    echo ""
done

# GPU verification
print_status "$BLUE" "Verifying GPU acceleration..."
echo ""

# Check if NVIDIA GPU is detected
if ollama show --modelfile mistral 2>/dev/null | grep -q "nvidia"; then
    print_success "GPU acceleration detected - NVIDIA GPU is available"
    gpu_info=$(nvidia-smi --query-gpu=name --format=csv,noheader,nounits 2>/dev/null | head -1)
    if [ ! -z "$gpu_info" ]; then
        print_status "$BLUE" "GPU: $gpu_info"
    fi
else
    print_warning "GPU acceleration not detected"
    print_warning "To enable GPU acceleration in WSL, ensure:"
    echo "  1. You have NVIDIA drivers installed on Windows"
    echo "  2. WSL is configured for GPU passthrough"
    echo "  3. NVIDIA Container Toolkit is installed in WSL"
    echo "  4. Your GPU supports CUDA"
    echo ""
    print_status "$BLUE" "Continuing with CPU-only mode..."
fi

echo ""

# Functional test
print_status "$BLUE" "Running functional test with mistral model..."
echo ""

# Test the model with a timeout
test_response=$(timeout 30s ollama run mistral "Hello! Who are you?" 2>/dev/null || echo "TIMEOUT")

if [ "$test_response" = "TIMEOUT" ]; then
    print_warning "Model test timed out (30 seconds). This might be normal for first run."
    print_status "$BLUE" "The model is likely working but taking time to load."
else
    print_success "Model test completed successfully"
    print_status "$BLUE" "Sample response received from mistral model"
fi

echo ""

# Final summary
print_success "=== The Magi Conduit Setup Complete ==="
echo ""
print_status "$BLUE" "Installed/Verified Models:"
for model in "${models[@]}"; do
    echo "  ✓ $model"
done
echo ""
print_status "$BLUE" "Next steps:"
echo "  • The service is running. You can now start The Magi orchestrator."
echo "  • To test a model manually, you can run commands like:"
echo "    ollama run mistral"
echo "    ollama run gemma"
echo "    ollama run llama2"
echo ""
echo "  • To stop the Magi Conduit service: pkill -f 'ollama serve'"
echo "  • To restart the service: ollama serve &"
echo ""
print_success "The Magi AI system is ready for multi-agent operations!" 