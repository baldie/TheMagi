#!/bin/bash

echo "🧪 TESTING SERVER BINDING"
echo "========================="

# Start the integration test in background
echo "Starting integration test..."
timeout 45 npm run test:integration &
TEST_PID=$!

# Wait a bit for server to start
echo "Waiting 25 seconds for server startup..."
sleep 25

echo "🔍 Checking what's listening on port 8080:"
ss -tulnp | grep 8080 || echo "❌ NOTHING listening on port 8080!"

echo ""
echo "🔍 Testing direct connection to port 8080:"
timeout 5 bash -c "echo 'GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n' | nc 127.0.0.1 8080" 2>&1 || echo "❌ Connection to port 8080 FAILED!"

echo ""
echo "🔍 All processes with 8080 in command line:"
ps aux | grep 8080 || echo "No processes found with 8080"

echo ""
echo "🔍 All node processes:"
ps aux | grep node | grep -v grep

echo ""
echo "🧪 Cleaning up..."
kill $TEST_PID 2>/dev/null

echo "🧪 Test complete!"