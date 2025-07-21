#!/bin/bash

# A more robust script to shut down all Magi-related services, including lingering "zombie" processes.

echo "🛑 Starting forceful shutdown of all Magi services..."
echo "----------------------------------------------------"

# List of service patterns to kill.
# We are now including the specific service commands.
services=(
    "tts_server.py"
    "orchestrator"
    "tavily-mcp"
    "ollama serve"
    "uvicorn"
)

# Loop through the services and kill them
for service in "${services[@]}"; do
    echo "🔎 Searching for and stopping '$service'..."
    # Use pgrep to check if the process exists, excluding the grep process itself
    if pgrep -f "$service" > /dev/null; then
        pkill -9 -f "$service"
        echo "✅ '$service' processes have been terminated."
    else
        echo "⚪ '$service' not found or already stopped."
    fi
done

# --- Special handling for the UI server on a specific port ---
PORT_NUMBER=4200
echo "🔎 Searching for UI server on port $PORT_NUMBER..."

PID=$(lsof -t -i :$PORT_NUMBER)

if [ -z "$PID" ]; then
  echo "⚪ UI server already stopped."
else
  echo " KILLING UI server (PID: $PID) on port $PORT_NUMBER..."
  kill -9 $PID
  echo "✅ UI server terminated."
fi

echo "----------------------------------------------------"
echo "✅ Shutdown complete. All Magi services should be offline."