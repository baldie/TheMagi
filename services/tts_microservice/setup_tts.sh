#!/bin/bash

# The Magi TTS Microservice Setup Script
# A robust, idempotent setup script that works with Python 3.11 for best TTS compatibility

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

print_status "$BLUE" "Setting up The Magi TTS Microservice..."
echo ""

# Check if we're in the correct directory
if [ ! -f "main.py" ] || [ ! -f "requirements.txt" ]; then
    print_error "Please run this script from the tts_microservice directory"
    print_status "$BLUE" "Current directory: $(pwd)"
    print_status "$BLUE" "Expected files: main.py, requirements.txt"
    print_status "$BLUE" "Usage: cd /path/to/tts_microservice && ./setup_tts.sh"
    exit 1
fi

# Check if Python 3.11 is already available
if command -v python3.11 &> /dev/null; then
    print_success "Python 3.11 is already available"
    python3.11_version=$(python3.11 --version 2>&1)
    print_status "$BLUE" "Found: $python3.11_version"
else
    print_status "$BLUE" "Python 3.11 not found, installing via deadsnakes PPA..."
    
    # Check if we can use sudo
    if ! sudo -n true 2>/dev/null; then
        print_warning "Sudo access required for Python 3.11 installation"
        print_status "$BLUE" "Please run: sudo apt update && sudo apt install -y software-properties-common && sudo add-apt-repository -y ppa:deadsnakes/ppa && sudo apt update && sudo apt install -y python3.11 python3.11-venv"
        print_status "$BLUE" "Then run this script again."
        exit 1
    fi
    
    # Install Python 3.11 via deadsnakes PPA
    print_status "$BLUE" "Adding deadsnakes PPA..."
    sudo apt update
    sudo apt install -y software-properties-common
    sudo add-apt-repository -y ppa:deadsnakes/ppa
    sudo apt update
    
    print_status "$BLUE" "Installing Python 3.11..."
    sudo apt install -y python3.11 python3.11-venv
    
    if ! command -v python3.11 &> /dev/null; then
        print_error "Failed to install Python 3.11"
        exit 1
    fi
    
    print_success "Python 3.11 installed successfully"
fi

# Check if virtual environment exists and is valid
if [ -d "venv" ]; then
    print_status "$BLUE" "Virtual environment exists, checking if it's valid..."
    
    if [ -f "venv/bin/python" ] && [ -f "venv/bin/pip" ]; then
        # Check if it's using Python 3.11
        venv_python_version=$(venv/bin/python --version 2>&1)
        if [[ "$venv_python_version" == *"Python 3.11"* ]]; then
            print_success "Virtual environment is valid and using Python 3.11"
            
            # Check if packages are already installed
            if source venv/bin/activate && python -c "import fastapi, uvicorn, pydantic" 2>/dev/null; then
                print_success "Core packages are already installed"
                
                # Check TTS specifically
                if python -c "import TTS" 2>/dev/null; then
                    print_success "TTS is already installed"
                    print_success "Setup is complete! You can run: ./start_service.sh"
                    exit 0
                else
                    print_warning "TTS not found, will install it now"
                fi
            else
                print_warning "Some packages missing, will install them"
            fi
        else
            print_warning "Virtual environment is not using Python 3.11, recreating..."
            rm -rf venv
        fi
    else
        print_warning "Virtual environment appears corrupted, recreating..."
        rm -rf venv
    fi
fi

# Create virtual environment with Python 3.11
print_status "$BLUE" "Creating virtual environment with Python 3.11..."
python3.11 -m venv venv

if [ ! -f "venv/bin/activate" ]; then
    print_error "Failed to create virtual environment"
    print_status "$BLUE" "This might be due to missing python3.11-venv package"
    print_status "$BLUE" "Try: sudo apt install python3.11-venv"
    exit 1
fi

print_success "Virtual environment created with Python 3.11"

# Activate virtual environment
print_status "$BLUE" "Activating virtual environment..."
source venv/bin/activate

# Verify activation and Python version
if [ "$VIRTUAL_ENV" != "$(pwd)/venv" ]; then
    print_error "Failed to activate virtual environment"
    exit 1
fi

python_version=$(python --version)
print_success "Virtual environment activated: $python_version"

# Upgrade pip
print_status "$BLUE" "Upgrading pip..."
pip install --upgrade pip

# Install core dependencies first
print_status "$BLUE" "Installing core dependencies..."
pip install fastapi uvicorn[standard] pydantic

# Install TTS (should work well with Python 3.11)
print_status "$BLUE" "Installing TTS library..."
print_status "$BLUE" "This may take several minutes as TTS has many dependencies..."

if pip install TTS; then
    print_success "TTS installed successfully"
else
    print_error "TTS installation failed"
    print_status "$BLUE" "This is unexpected with Python 3.11. Please check your internet connection."
    exit 1
fi

# Verify installation
print_status "$BLUE" "Verifying installation..."

# Test core packages
if python -c "import fastapi, uvicorn, pydantic; print('Core packages: OK')"; then
    print_success "Core packages verified"
else
    print_error "Core packages verification failed"
    exit 1
fi

# Test TTS
if python -c "import TTS; print('TTS: OK')"; then
    print_success "TTS verified"
else
    print_error "TTS verification failed"
    exit 1
fi

# Create start script if it doesn't exist
if [ ! -f "start_service.sh" ]; then
    print_status "$BLUE" "Creating start_service.sh..."
    cat > start_service.sh << 'EOF'
#!/bin/bash

# The Magi TTS Microservice Quick Start Script

# Color codes for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${BLUE}[INFO]${NC} Starting The Magi TTS Microservice..."
echo ""

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}[WARNING]${NC} Virtual environment not found!"
    echo "Please run setup_tts.sh first to set up the environment."
    exit 1
fi

# Activate virtual environment
echo -e "${BLUE}[INFO]${NC} Activating virtual environment..."
source venv/bin/activate

# Check if main.py exists
if [ ! -f "main.py" ]; then
    echo -e "${YELLOW}[ERROR]${NC} main.py not found!"
    exit 1
fi

echo -e "${BLUE}[INFO]${NC} Starting TTS service..."
echo -e "${BLUE}[INFO]${NC} Service will be available at: http://localhost:8000"
echo -e "${BLUE}[INFO]${NC} API documentation: http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}[NOTE]${NC} Press Ctrl+C to stop the service"
echo ""

# Run the service
python main.py
EOF
    chmod +x start_service.sh
    print_success "start_service.sh created"
fi

print_success "=== The Magi TTS Microservice Setup Complete ==="
echo ""
print_status "$BLUE" "Next steps:"
echo "  1. Start the service: ./start_service.sh"
echo "  2. Service will be available at: http://localhost:8000"
echo "  3. API documentation: http://localhost:8000/docs"
echo ""
print_warning "Note: On first run, TTS models will be downloaded (~100-500MB each)"
echo "  This may take several minutes depending on your internet connection."
echo ""
print_success "The Magi AI system is ready for multi-agent operations!" 