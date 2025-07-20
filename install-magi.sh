#!/bin/bash

echo "================================================================================="
echo " The Magi - Master Installation Script"
echo "================================================================================="
echo "This script will set up the complete development environment for The Magi."
echo

# Always know the project root
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "[Magi Installer] Working directory set to: $(pwd)"
echo

# ---------------------------------------------------------------------------------
# Step 1: System Dependency Verification
# ---------------------------------------------------------------------------------
echo "[Magi Installer] Step 1: Verifying system dependencies..."

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js is not installed or not in your PATH."
    echo "        Please install it from https://nodejs.org and ensure it's in your PATH."
    exit 1
fi
NODE_VERSION=$(node -v)
echo "  [OK] Node.js found: $NODE_VERSION"

# Check for npm
if ! command -v npm &> /dev/null; then
    echo "[ERROR] npm is not installed or not in your PATH."
    exit 1
fi
NPM_VERSION=$(npm -v)
echo "  [OK] npm found: $NPM_VERSION"

# Check for Python
if ! command -v python3 &> /dev/null && ! command -v python &> /dev/null; then
    echo "[ERROR] Python is not installed or not in your PATH."
    echo "        Please install Python 3.11 from https://www.python.org/"
    echo "        Ensure Python is in your PATH."
    exit 1
fi

# Use python3 if available, otherwise python
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
else
    PYTHON_CMD="python"
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1)
echo "  [OK] Python found: $PYTHON_VERSION (Python 3.11 is recommended for TTS)"

# Check for python3-venv on Debian/Ubuntu systems
if command -v apt &> /dev/null; then
    echo "  - Checking for python3-venv package..."
    # Get Python version to install the correct venv package
    PYTHON_VER=$($PYTHON_CMD -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
    VENV_PACKAGE="python${PYTHON_VER}-venv"
    
    # Test if we can create a temporary venv
    TEMP_VENV_TEST="/tmp/test_venv_$$"
    if ! $PYTHON_CMD -m venv "$TEMP_VENV_TEST" &> /dev/null; then
        echo "    [WARNING] python3-venv not available. Installing $VENV_PACKAGE..."
        sudo apt update && sudo apt install -y "$VENV_PACKAGE"
        if [ $? -ne 0 ]; then
            echo "[ERROR] Failed to install $VENV_PACKAGE package."
            echo "        Please run: sudo apt install $VENV_PACKAGE"
            exit 1
        fi
        echo "    [OK] $VENV_PACKAGE installed successfully."
    else
        echo "    [OK] python3-venv is available."
    fi
    # Clean up test venv
    rm -rf "$TEMP_VENV_TEST" 2>/dev/null
fi

# Check for Git
if ! command -v git &> /dev/null; then
    echo "[ERROR] Git is not installed or not in your PATH."
    echo "        Git is required to install some Python dependencies."
    echo "        Please install it from https://git-scm.com/"
    exit 1
fi
echo "  [OK] Git found."

# Check for Chrome (for running UI tests)
echo "  - Checking for Chrome browser for UI testing..."
if command -v google-chrome &> /dev/null; then
    CHROME_VERSION=$(google-chrome --version 2>/dev/null || echo "unknown")
    echo "    [OK] Chrome found: $CHROME_VERSION"
elif command -v chromium-browser &> /dev/null; then
    CHROME_VERSION=$(chromium-browser --version 2>/dev/null || echo "unknown")
    echo "    [OK] Chromium found: $CHROME_VERSION"
elif command -v chromium &> /dev/null; then
    CHROME_VERSION=$(chromium --version 2>/dev/null || echo "unknown")
    echo "    [OK] Chromium found: $CHROME_VERSION"
else
    echo "    [INFO] Chrome/Chromium not found. Installing for UI testing..."
    
    # Install Chrome based on the distribution
    if command -v apt &> /dev/null; then
        # Debian/Ubuntu
        echo "    Installing Google Chrome on Debian/Ubuntu..."
        wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
        echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" | sudo tee /etc/apt/sources.list.d/google-chrome.list
        sudo apt update
        sudo apt install -y google-chrome-stable
        
        if command -v google-chrome &> /dev/null; then
            echo "    [OK] Google Chrome installed successfully."
        else
            echo "    [WARNING] Chrome installation may have failed. UI tests may not work."
        fi
        
    elif command -v yum &> /dev/null || command -v dnf &> /dev/null; then
        # RHEL/CentOS/Fedora
        echo "    Installing Google Chrome on RHEL/CentOS/Fedora..."
        
        # Use dnf if available, otherwise yum
        if command -v dnf &> /dev/null; then
            PKG_MANAGER="dnf"
        else
            PKG_MANAGER="yum"
        fi
        
        # Create repo file
        cat << 'EOF' | sudo tee /etc/yum.repos.d/google-chrome.repo
[google-chrome]
name=google-chrome
baseurl=http://dl.google.com/linux/chrome/rpm/stable/x86_64
enabled=1
gpgcheck=1
gpgkey=https://dl.google.com/linux/linux_signing_key.pub
EOF
        
        sudo $PKG_MANAGER install -y google-chrome-stable
        
        if command -v google-chrome &> /dev/null; then
            echo "    [OK] Google Chrome installed successfully."
        else
            echo "    [WARNING] Chrome installation may have failed. UI tests may not work."
        fi
        
    elif command -v pacman &> /dev/null; then
        # Arch Linux
        echo "    Installing Chromium on Arch Linux..."
        sudo pacman -S --noconfirm chromium
        
        if command -v chromium &> /dev/null; then
            echo "    [OK] Chromium installed successfully."
        else
            echo "    [WARNING] Chromium installation may have failed. UI tests may not work."
        fi
        
    else
        echo "    [WARNING] Unknown package manager. Cannot auto-install Chrome."
        echo "             Please install Chrome or Chromium manually for UI testing."
        echo "             Chrome: https://www.google.com/chrome/"
        echo "             Chromium: Available in most package managers"
    fi
fi

# Check for CUDA/GPU support
echo "  - Checking for CUDA support..."
if command -v nvidia-smi &> /dev/null; then
    GPU_INFO=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
    if [ -n "$GPU_INFO" ]; then
        echo "    [OK] NVIDIA GPU detected: $GPU_INFO"
        if command -v nvcc &> /dev/null; then
            CUDA_VERSION=$(nvcc --version | grep "release" | sed 's/.*release \([0-9.]*\).*/\1/')
            echo "    [OK] CUDA Toolkit found: $CUDA_VERSION"
        else
            echo "    [INFO] CUDA Toolkit not found. PyTorch will use CPU."
            echo "           For GPU acceleration, install CUDA Toolkit."
        fi
    else
        echo "    [INFO] NVIDIA GPU not detected or drivers not working."
    fi
else
    echo "    [INFO] nvidia-smi not found. No NVIDIA GPU support detected."
fi

# Check system requirements
echo "  - Checking system requirements..."

# Check available disk space (need at least 10GB for models and dependencies)
AVAILABLE_SPACE=$(df -BG . | tail -1 | awk '{print $4}' | sed 's/G//')
if [ "$AVAILABLE_SPACE" -lt 10 ]; then
    echo "[WARNING] Low disk space detected: ${AVAILABLE_SPACE}GB available."
    echo "          At least 10GB recommended for AI models and dependencies."
    echo "          Consider freeing up disk space before continuing."
    read -p "Continue anyway? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "[ABORTED] Installation cancelled due to insufficient disk space."
        exit 1
    fi
else
    echo "    [OK] Sufficient disk space: ${AVAILABLE_SPACE}GB available."
fi

# Check available RAM (recommend at least 8GB)
TOTAL_RAM=$(free -m | awk 'NR==2{printf "%.0f", $2/1024}')
if [ "$TOTAL_RAM" -lt 8 ]; then
    echo "[WARNING] Low RAM detected: ${TOTAL_RAM}GB total."
    echo "          At least 8GB RAM recommended for optimal AI model performance."
    echo "          The system may run slowly or experience memory issues."
else
    echo "    [OK] Sufficient RAM: ${TOTAL_RAM}GB total."
fi

# Check CPU cores
CPU_CORES=$(nproc)
if [ "$CPU_CORES" -lt 4 ]; then
    echo "[WARNING] Limited CPU cores: $CPU_CORES cores detected."
    echo "          At least 4 cores recommended for good performance."
else
    echo "    [OK] CPU cores: $CPU_CORES cores detected."
fi

echo "[Magi Installer] System requirements check complete."
echo

# ---------------------------------------------------------------------------------
# Step 2: Node.js Dependency Installation
# ---------------------------------------------------------------------------------
echo "[Magi Installer] Step 2: Installing Node.js dependencies..."

echo "  - Installing Orchestrator dependencies..."
pushd services/orchestrator > /dev/null
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install Orchestrator dependencies. Check logs for details."
    popd > /dev/null
    exit 1
fi
popd > /dev/null
echo "    [OK] Orchestrator dependencies installed."

echo "  - Creating data directories for Magi services..."
mkdir -p .magi-data/personal-data-index
echo "    [OK] Created .magi-data directory for personal data storage."

echo "  - Installing UI dependencies..."
pushd ui > /dev/null
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install UI dependencies. Check logs for details."
    popd > /dev/null
    exit 1
fi

# Install testing dependencies
echo "  - Installing UI testing dependencies..."
npm install --save-dev @types/jest jest @jest/globals jest-environment-jsdom jest-preset-angular ts-jest @angular-eslint/eslint-plugin @angular-eslint/eslint-plugin-template @angular-eslint/template-parser @typescript-eslint/utils@latest
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install UI testing dependencies. Check logs for details."
    popd > /dev/null
    exit 1
fi

popd > /dev/null
echo "    [OK] UI dependencies installed."

echo "  - Installing Conduit dependencies..."
pushd services/conduit > /dev/null
npm install
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install Conduit dependencies. Check logs for details."
    popd > /dev/null
    exit 1
fi
npm run build
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to build Conduit service. Check logs for details."
    popd > /dev/null
    exit 1
fi
popd > /dev/null
echo "    [OK] Conduit dependencies installed and built."
echo "[Magi Installer] All Node.js dependencies installed successfully."
echo

# ---------------------------------------------------------------------------------
# Step 3: Ollama Installation and Setup
# ---------------------------------------------------------------------------------
echo "[Magi Installer] Step 3: Installing and configuring Ollama for AI models..."

# Check if local GPU-enabled Ollama exists
OLLAMA_LOCAL_DIR="$(pwd)/services/conduit/CUDA"
OLLAMA_BIN="$OLLAMA_LOCAL_DIR/bin/ollama"

if [ -f "$OLLAMA_BIN" ]; then
    OLLAMA_VERSION=$($OLLAMA_BIN --version 2>/dev/null || echo "unknown")
    echo "  [OK] Local GPU-enabled Ollama found: $OLLAMA_VERSION"
    echo "  [INFO] Using local installation at: services/conduit/CUDA/"
elif command -v ollama &> /dev/null; then
    OLLAMA_VERSION=$(ollama --version 2>/dev/null || echo "unknown")
    echo "  [OK] System Ollama found: $OLLAMA_VERSION"
    echo "  [WARNING] System Ollama may not have optimal GPU support."
    echo "  [INFO] Consider using local GPU-enabled installation for better performance."
    OLLAMA_BIN="ollama"
else
    echo "  - Installing GPU-enabled Ollama locally..."
    
    # Create local directory
    mkdir -p "$OLLAMA_LOCAL_DIR"
    cd "$OLLAMA_LOCAL_DIR"
    
    # Download and extract Ollama with GPU support
    echo "    Downloading Ollama (this may take a few minutes)..."
    curl -L https://github.com/ollama/ollama/releases/download/v0.9.6/ollama-linux-amd64.tgz -o ollama.tgz
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to download Ollama. Please check your internet connection."
        cd ..
        rm -rf "$OLLAMA_LOCAL_DIR"
        exit 1
    fi
    
    # Extract and set permissions
    tar -xzf ollama.tgz
    chmod +x bin/ollama
    rm ollama.tgz
    cd ..
    
    echo "    [OK] GPU-enabled Ollama installed locally at: services/conduit/CUDA/"
    OLLAMA_BIN="$OLLAMA_BIN"
fi

# Create models directory
MODELS_DIR="$(pwd)/.models"
mkdir -p "$MODELS_DIR"
echo "  - Models directory created at: $MODELS_DIR"

# Set environment variables for GPU support and models directory
export OLLAMA_MODELS="$MODELS_DIR"
export CUDA_VISIBLE_DEVICES=0

# Ollama performance optimization environment variables
export OLLAMA_NUM_THREADS=8
export OLLAMA_NUM_PARALLEL=2
export OLLAMA_MAX_LOADED_MODELS=3
export OLLAMA_KEEP_ALIVE=30m
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_MAX_QUEUE=256
export OLLAMA_CONTEXT_LENGTH=4096

echo "  - Set OLLAMA_MODELS environment variable to: $MODELS_DIR"
echo "  - Set CUDA_VISIBLE_DEVICES=0 for GPU support"
echo "  - Set Ollama performance optimization variables"

# Start Ollama service if not running
echo "  - Checking Ollama service status..."
if ! pgrep -f "ollama serve" > /dev/null; then
    echo "    Starting GPU-enabled Ollama service..."
    
    # Check for GPU support
    if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
        echo "    [INFO] NVIDIA GPU detected, enabling GPU acceleration"
        GPU_INFO=$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)
        echo "    [INFO] GPU: $GPU_INFO"
    else
        echo "    [WARNING] No NVIDIA GPU detected, using CPU mode"
    fi
    
    # Start Ollama with environment variables
    CUDA_VISIBLE_DEVICES=0 OLLAMA_MODELS="$MODELS_DIR" OLLAMA_NUM_THREADS=8 OLLAMA_NUM_PARALLEL=2 OLLAMA_MAX_LOADED_MODELS=3 OLLAMA_KEEP_ALIVE=30m OLLAMA_KV_CACHE_TYPE=q8_0 OLLAMA_FLASH_ATTENTION=1 OLLAMA_MAX_QUEUE=256 OLLAMA_CONTEXT_LENGTH=4096 $OLLAMA_BIN serve &
    OLLAMA_PID=$!
    sleep 10  # Allow more time for GPU initialization
    
    # Verify Ollama is responding
    if ! curl -s http://localhost:11434/api/version > /dev/null; then
        echo "[ERROR] Ollama service failed to start properly."
        kill $OLLAMA_PID 2>/dev/null
        exit 1
    fi
    echo "    [OK] Ollama service started (PID: $OLLAMA_PID)"
else
    echo "    [OK] Ollama service already running."
fi

# Download required AI models
echo "  - Downloading required AI models (this may take several minutes)..."
echo "    Note: Models will be stored in $MODELS_DIR"

echo "    Downloading Qwen2.5 7B model..."
timeout 600 $OLLAMA_BIN pull qwen2.5:7b-instruct-q6_k
if [ $? -ne 0 ]; then
    echo "[WARNING] Failed to download Qwen2.5 model. You may need to download it manually."
    echo "          Run: $OLLAMA_BIN pull qwen2.5:7b-instruct-q6_k"
fi

echo "    Downloading Gemma3n E2B model..."
timeout 600 $OLLAMA_BIN pull gemma3n:e2b
if [ $? -ne 0 ]; then
    echo "[WARNING] Failed to download Gemma3n model. You may need to download it manually."
    echo "          Run: $OLLAMA_BIN pull gemma3n:e2b"
fi

echo "    Downloading Llama3.2 3B model..."
timeout 600 $OLLAMA_BIN pull llama3.2:3b
if [ $? -ne 0 ]; then
    echo "[WARNING] Failed to download Llama3.2 model. You may need to download it manually."
    echo "          Run: $OLLAMA_BIN pull llama3.2:3b"
fi

echo "    Downloading nomic-embed-text model for embeddings..."
timeout 600 $OLLAMA_BIN pull nomic-embed-text
if [ $? -ne 0 ]; then
    echo "[WARNING] Failed to download nomic-embed-text model. You may need to download it manually."
    echo "          Run: $OLLAMA_BIN pull nomic-embed-text"
fi

echo "  - Verifying model installations..."
AVAILABLE_MODELS=$($OLLAMA_BIN list 2>/dev/null)
echo "$AVAILABLE_MODELS"

# Test GPU functionality if models are available
if echo "$AVAILABLE_MODELS" | grep -q "llama3.2\|qwen2.5\|gemma3n"; then
    echo "  - Testing GPU acceleration..."
    
    # Get a quick test to see if GPU is being used
    sleep 2
    GPU_TEST_RESULT=$(curl -s http://localhost:11434/api/ps 2>/dev/null)
    if echo "$GPU_TEST_RESULT" | grep -q '"size_vram":[0-9]*[^0]'; then
        echo "    [OK] GPU acceleration confirmed (models loaded in VRAM)"
    elif echo "$GPU_TEST_RESULT" | grep -q '"size_vram":0'; then
        echo "    [WARNING] Models using CPU only (size_vram:0)"
        echo "             Check GPU drivers and CUDA installation"
    else
        echo "    [INFO] GPU test inconclusive (no models currently loaded)"
    fi
fi

echo "[Magi Installer] Ollama setup complete."
echo

# ---------------------------------------------------------------------------------
# Step 4: Python TTS Service Setup
# ---------------------------------------------------------------------------------
echo "[Magi Installer] Step 4: Setting up Python environment for TTS service..."

TTS_DIR="$SCRIPT_DIR/services/tts"
if [ ! -d "$TTS_DIR" ]; then
    echo "[ERROR] TTS service directory not found at: $TTS_DIR"
    exit 1
fi

echo "  - Checking for Python virtual environment..."
if [ -d "$TTS_DIR/venv" ] && [ -f "$TTS_DIR/venv/bin/activate" ]; then
    echo "    Virtual environment already exists. Skipping creation."
else
    if [ -d "$TTS_DIR/venv" ]; then
        echo "    Virtual environment exists but is corrupted. Recreating..."
        rm -rf "$TTS_DIR/venv"
    else
        echo "    Virtual environment not found. Creating it now..."
    fi
    $PYTHON_CMD -m venv "$TTS_DIR/venv"
    if [ $? -ne 0 ]; then
        echo "[ERROR] Failed to create Python virtual environment."
        echo "        Please ensure Python and the 'venv' module are working correctly."
        exit 1
    fi
    echo "    [OK] Virtual environment created successfully."
fi

echo "  - Installing Python dependencies from requirements.txt..."
source "$TTS_DIR/venv/bin/activate"

# Upgrade pip first
pip install --upgrade pip

# Install core dependencies first
echo "    Installing core dependencies..."
pip install --timeout 1000 --retries 5 numpy torch torchaudio fastapi uvicorn pydantic requests soundfile python-dotenv

# Check for CUDA and install appropriate PyTorch version
if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
    echo "    Installing PyTorch with CUDA support..."
    pip install --timeout 1000 --retries 3 torch torchaudio --index-url https://download.pytorch.org/whl/cu121
    if [ $? -ne 0 ]; then
        echo "    [WARNING] CUDA PyTorch installation failed, falling back to CPU version..."
        pip install --timeout 1000 --retries 3 torch torchaudio --index-url https://download.pytorch.org/whl/cpu
    fi
else
    echo "    Installing PyTorch CPU version..."
    pip install --timeout 1000 --retries 3 torch torchaudio --index-url https://download.pytorch.org/whl/cpu
fi

# Install remaining dependencies
echo "    Installing remaining dependencies from requirements.txt..."
pip install --timeout 1000 --retries 5 -r "$TTS_DIR/requirements.txt"
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install Python dependencies from requirements.txt."
    echo "        Please check your internet connection and the contents of the requirements file."
    echo "        Some packages may require development tools."
    echo "        Note: Chatterbox TTS installation may take several minutes."
    exit 1
fi

# Install PEFT to fix LoRACompatibleLinear deprecation warning
echo "    Installing PEFT to resolve LoRACompatibleLinear deprecation..."
pip install --timeout 1000 --retries 3 peft
if [ $? -ne 0 ]; then
    echo "[ERROR] Failed to install PEFT dependency."
    echo "        Please check your internet connection."
    exit 1
fi
echo "    [OK] Python dependencies installed successfully."

# Test the TTS service setup
echo "  - Testing TTS service configuration..."
cd "$TTS_DIR"
python3 -c "
import torch
print(f'PyTorch version: {torch.__version__}')
print(f'CUDA available: {torch.cuda.is_available()}')
if torch.cuda.is_available():
    print(f'GPU device: {torch.cuda.get_device_name(0)}')
    print(f'GPU memory: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB')
try:
    import fastapi, uvicorn
    print('FastAPI and Uvicorn: OK')
except ImportError as e:
    print(f'FastAPI/Uvicorn error: {e}')
try:
    from chatterbox.tts import ChatterboxTTS
    print('Chatterbox TTS: OK')
except ImportError:
    print('Chatterbox TTS: Not available (install may still be in progress)')
except Exception as e:
    print(f'Chatterbox TTS error: {e}')
"
echo "    [OK] TTS service test complete."

echo "[Magi Installer] TTS Service setup complete."
echo

# ---------------------------------------------------------------------------------
# Step 5: Service Integration Testing
# ---------------------------------------------------------------------------------
echo "[Magi Installer] Step 5: Testing service integration and connectivity..."

# Test Ollama connectivity
echo "  - Testing Ollama service connectivity..."
if curl -s http://localhost:11434/api/version > /dev/null; then
    echo "    [OK] Ollama service is responding."
else
    echo "[WARNING] Ollama service not responding. You may need to start it manually."
    echo "          Run: $OLLAMA_BIN serve"
fi

# Test if models are available
echo "  - Verifying AI models are downloaded..."
MODELS_OUTPUT=$($OLLAMA_BIN list 2>/dev/null)
if echo "$MODELS_OUTPUT" | grep -q "qwen2.5"; then
    echo "    [OK] Qwen2.5 model available."
else
    echo "[WARNING] Qwen2.5 model not found. Download with: $OLLAMA_BIN pull qwen2.5:7b-instruct-q6_k"
fi

if echo "$MODELS_OUTPUT" | grep -q "gemma3n"; then
    echo "    [OK] Gemma3n model available."
else
    echo "[WARNING] Gemma3n model not found. Download with: $OLLAMA_BIN pull gemma3n:e2b"
fi

if echo "$MODELS_OUTPUT" | grep -q "llama3.2"; then
    echo "    [OK] Llama3.2 model available."
else
    echo "[WARNING] Llama3.2 model not found. Download with: $OLLAMA_BIN pull llama3.2:3b"
fi

if echo "$MODELS_OUTPUT" | grep -q "nomic-embed-text"; then
    echo "    [OK] nomic-embed-text model available."
else
    echo "[WARNING] nomic-embed-text model not found. Download with: $OLLAMA_BIN pull nomic-embed-text"
fi

# Test TypeScript compilation
cd "$SCRIPT_DIR"
echo "  - Testing TypeScript compilation..."
pushd services/orchestrator > /dev/null
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "    [OK] Orchestrator builds successfully."
else
    echo "[WARNING] Orchestrator build failed. Check TypeScript errors."
fi
popd > /dev/null

pushd services/conduit > /dev/null
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "    [OK] Conduit builds successfully."
else
    echo "[WARNING] Conduit build failed. Check TypeScript errors."
fi
popd > /dev/null

pushd ui > /dev/null
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "    [OK] UI builds successfully."
else
    echo "[WARNING] UI build failed. Check for compilation errors."
fi
popd > /dev/null

# Test UI testing capability
echo "  - Testing UI test environment..."
pushd ui > /dev/null
if command -v google-chrome &> /dev/null || command -v chromium-browser &> /dev/null || command -v chromium &> /dev/null; then
    # Run a quick test to see if Chrome headless works
    timeout 30 npm test -- --watch=false --browsers=ChromeHeadless > /dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "    [OK] UI tests can run with Chrome headless."
    else
        echo "    [WARNING] UI tests may have issues. Check Chrome installation."
    fi
else
    echo "    [WARNING] No Chrome browser available. UI tests will be skipped."
fi
popd > /dev/null

# Test Python TTS environment
echo "  - Testing Python TTS environment..."
cd "$TTS_DIR"
source venv/bin/activate
python3 -c "
import sys
try:
    import torch, fastapi, uvicorn
    print('    [OK] Core Python dependencies available.')
except ImportError as e:
    print(f'[WARNING] Missing Python dependency: {e}')
    sys.exit(1)
try:
    from chatterbox.tts import ChatterboxTTS
    print('    [OK] Chatterbox TTS available.')
except ImportError:
    print('[WARNING] Chatterbox TTS not available. May need manual installation.')
except Exception as e:
    print(f'[WARNING] Chatterbox TTS error: {e}')
try:
    import pytest
    print('    [OK] pytest available for testing.')
except ImportError:
    print('[WARNING] pytest not available. Tests will not run.')
" 2>/dev/null

# Test pytest functionality
echo "  - Testing pytest functionality..."
if command -v pytest &> /dev/null; then
    if pytest --version > /dev/null 2>&1; then
        echo "    [OK] pytest is working correctly."
        # Run a quick syntax test
        if pytest --collect-only test_tts_service.py > /dev/null 2>&1; then
            echo "    [OK] TTS test file is valid."
        else
            echo "    [WARNING] TTS test file has issues, but pytest is working."
        fi
    else
        echo "    [WARNING] pytest command failed. Tests may not work properly."
    fi
else
    echo "    [WARNING] pytest command not found in virtual environment."
fi

deactivate

echo "[Magi Installer] Service integration testing complete."
echo
cd "$SCRIPT_DIR"

# ---------------------------------------------------------------------------------
# Finalization
# ---------------------------------------------------------------------------------
echo "================================================================================="
echo " ✨ The Magi Installation Is Complete!"
echo "================================================================================="
echo " Your environment is now ready. To start the system, run:"
echo "     ./start-magi.sh"
echo
echo " To run all tests (including UI tests with Chrome), run:"
echo "     ./run-all-tests.sh"
echo "================================================================================="