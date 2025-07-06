#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Running all tests for TheMagi project...${NC}\n"

# Track overall success
OVERALL_SUCCESS=true

# Function to run a test and report results
run_test() {
    local service_name="$1"
    local test_command="$2"
    local directory="$3"
    local show_output="$4"
    
    echo -e "${YELLOW}Testing $service_name...${NC}"
    cd "$directory"
    
    if [ "$show_output" = "verbose" ]; then
        if eval "$test_command"; then
            echo -e "${GREEN}✅ $service_name tests passed${NC}"
        else
            echo -e "${RED}❌ $service_name tests failed${NC}"
            OVERALL_SUCCESS=false
        fi
    else
        if eval "$test_command" > /dev/null 2>&1; then
            echo -e "${GREEN}✅ $service_name tests passed${NC}"
        else
            echo -e "${RED}❌ $service_name tests failed${NC}"
            echo -e "${YELLOW}Re-running with output to show error:${NC}"
            eval "$test_command"
            OVERALL_SUCCESS=false
        fi
    fi
    echo
}

# Get the project root directory
PROJECT_ROOT="/home/baldie/David/Project/TheMagi"

# Test each service
run_test "Orchestrator" "npm test" "$PROJECT_ROOT/services/orchestrator"
run_test "Conduit" "npm test" "$PROJECT_ROOT/services/conduit"

# Test UI with Chrome headless
if command -v google-chrome &> /dev/null || command -v chromium-browser &> /dev/null || command -v chromium &> /dev/null; then
    run_test "UI" "npm test -- --watch=false --browsers=ChromeHeadless" "$PROJECT_ROOT/ui"
else
    echo -e "${YELLOW}⚠️  UI tests skipped (Chrome not available)${NC}"
    echo -e "${YELLOW}   Run 'install-magi.sh' to install Chrome and enable UI testing${NC}"
    echo
fi

# Python TTS tests (check for virtual environment and pytest)
cd "$PROJECT_ROOT/services/tts"
if [ -f "venv/bin/activate" ]; then
    echo -e "${YELLOW}Testing TTS (using virtual environment)...${NC}"
    # Test using the virtual environment
    if bash -c "source venv/bin/activate && command -v pytest &> /dev/null && pytest test_tts_service.py" > /dev/null 2>&1; then
        echo -e "${GREEN}✅ TTS tests passed${NC}"
    else
        echo -e "${RED}❌ TTS tests failed${NC}"
        echo -e "${YELLOW}Re-running with output to show error:${NC}"
        bash -c "source venv/bin/activate && pytest test_tts_service.py"
        OVERALL_SUCCESS=false
    fi
    echo
elif command -v pytest &> /dev/null; then
    run_test "TTS" "pytest test_tts_service.py" "$PROJECT_ROOT/services/tts"
else
    echo -e "${YELLOW}⚠️  TTS tests skipped (pytest not available and no virtual environment)${NC}"
    echo -e "${YELLOW}   Run 'install-magi.sh' to set up the Python environment${NC}"
    echo
fi

# Final result
if [ "$OVERALL_SUCCESS" = true ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}💥 Some tests failed!${NC}"
    exit 1
fi