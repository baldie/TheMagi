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
