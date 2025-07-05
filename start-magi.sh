#!/bin/bash

echo "[Magi System] Starting The Magi Environment..."

# Check for Node.js and npm first
if ! command -v node &> /dev/null; then
    echo "ERROR: Node.js not found in PATH"
    exit 1
fi

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found in PATH"
    exit 1
fi

echo "[Magi System] Node.js and npm found."

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
        exit 1
    fi
    popd > /dev/null
fi

echo
echo "[Magi System] Starting Orchestrator, press CTRL+C in this window to shut down the Magi."
echo

# Start the orchestrator in the current window. This will block the script.
cd services/orchestrator
npm start

echo "[Magi System] Orchestrator has shut down."