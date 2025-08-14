#!/bin/bash

echo "🔍 Starting Phantom WebSocket Server Debug Session"
echo "=================================================="

# Function to monitor processes
monitor_processes() {
    echo "📊 Processes listening on port 8080:"
    ss -tulnp | grep 8080 || echo "   No processes found on port 8080"
    echo ""
}

# Function to monitor for a few seconds
monitor_loop() {
    local duration=$1
    local interval=2
    local count=$((duration / interval))
    
    echo "🔄 Monitoring port 8080 for ${duration} seconds..."
    for i in $(seq 1 $count); do
        echo "--- Check $i/$count ---"
        monitor_processes
        sleep $interval
    done
}

echo "🚀 Step 1: Initial port check"
monitor_processes

echo "🚀 Step 2: Starting integration test in background..."
timeout 45 npm run test:integration -- --runInBand --verbose --silent=false &
TEST_PID=$!

echo "🚀 Step 3: Monitoring during test startup (first 20 seconds)..."
monitor_loop 20

echo "🚀 Step 4: Checking if test is still running..."
if kill -0 $TEST_PID 2>/dev/null; then
    echo "✅ Test still running, monitoring for another 15 seconds..."
    monitor_loop 15
else
    echo "❌ Test completed or failed early"
fi

echo "🚀 Step 5: Final port check"
monitor_processes

echo "🚀 Step 6: Cleanup - killing test if still running"
kill $TEST_PID 2>/dev/null || echo "Test already completed"

echo ""
echo "🔍 Debug session complete!"
echo "Check the output above for:"
echo "  - Whether any process binds to port 8080"
echo "  - HTTP request logs (🌐🌐🌐) from the Express server"  
echo "  - WebSocket upgrade requests (🔄🔄🔄)"
echo "  - WebSocket connections (🚀🚀🚀)"