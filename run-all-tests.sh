#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🧪 Running all tests for TheMagi project (mirroring GitHub Actions)...${NC}\n"

# Parse command line arguments
SKIP_INTEGRATION=false
for arg in "$@"; do
    case $arg in
        -skip-integration)
            SKIP_INTEGRATION=true
            echo -e "${YELLOW}⏭️  Skipping integration tests as requested${NC}\n"
            ;;
    esac
done

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

# Get the project root directory dynamically
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$SCRIPT_DIR"

# Root install (matches CI root npm ci for ESLint config)
run_test "Root npm install" "npm ci" "$PROJECT_ROOT"

# Orchestrator: install, build, lint, test (integration tests conditional)
if [ "$SKIP_INTEGRATION" = true ]; then
    run_test "Orchestrator" "npm ci && npm run build && npm run lint && SKIP_INTEGRATION=true npm test" "$PROJECT_ROOT/services/orchestrator"
else
    run_test "Orchestrator" "npm ci && npm run build && npm run lint && npm test && npm run test:integration" "$PROJECT_ROOT/services/orchestrator"
fi

# Conduit: install, build, lint, test
run_test "Conduit" "npm ci && npm run build && npm run lint && npm test" "$PROJECT_ROOT/services/conduit"

# UI: install, build, lint, test with ChromeHeadless (as in CI)
run_test "UI" "npm ci && npm run build && npm run lint && npm test -- --watch=false --browsers=ChromeHeadless" "$PROJECT_ROOT/ui"

# Python TTS tests (always prepare venv and run CI-equivalent checks)
TTS_DIR="$PROJECT_ROOT/services/tts"
PY_BIN="python3"
if ! command -v python3 >/dev/null 2>&1; then PY_BIN="python"; fi

echo -e "${YELLOW}Setting up Python environment for TTS...${NC}"
# Quiet setup: suppress pip output; on failure, re-run verbosely to show errors
if (cd "$TTS_DIR" && bash -lc "$PY_BIN -m venv venv && source venv/bin/activate && pip install -q --upgrade pip && pip install -q -r requirements.txt" > /dev/null 2>&1); then
    :
else
    echo -e "${RED}Failed to set up Python environment for TTS${NC}"
    echo -e "${YELLOW}Re-running setup with output to show error:${NC}"
    (cd "$TTS_DIR" && bash -lc "$PY_BIN -m venv venv && source venv/bin/activate && pip install --upgrade pip && pip install -r requirements.txt")
    OVERALL_SUCCESS=false
fi

echo -e "${YELLOW}Testing TTS...${NC}"
if bash -lc "cd '$TTS_DIR' && source venv/bin/activate && python -m py_compile *.py && flake8 *.py && black --check *.py && pytest test_tts_service.py -v" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ TTS tests passed${NC}"
else
    echo -e "${RED}❌ TTS tests failed${NC}"
    echo -e "${YELLOW}Re-running with output to show error:${NC}"
    bash -lc "cd '$TTS_DIR' && source venv/bin/activate && python -m py_compile *.py && flake8 *.py && black --check *.py && pytest test_tts_service.py -v"
    OVERALL_SUCCESS=false
fi
echo

# Final result
if [ "$OVERALL_SUCCESS" = true ]; then
    echo -e "${GREEN}🎉 All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}💥 Some tests failed!${NC}"
    exit 1
fi