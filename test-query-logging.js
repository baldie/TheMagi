const WebSocket = require('ws');

// Simple test to demonstrate the enhanced query logging
const ws = new WebSocket('ws://localhost:8080');

ws.on('open', function open() {
  console.log('Connected to Magi WebSocket server');
  
  // Send a test query
  const testQuery = "How can I improve my productivity while working from home?";
  console.log('Sending test query:', testQuery);
  
  ws.send(JSON.stringify({
    type: 'start-magi',
    data: {
      inquiry: testQuery
    }
  }));
});

ws.on('message', function message(data) {
  const parsed = JSON.parse(data);
  console.log('Received message type:', parsed.type);
  
  if (parsed.type === 'deliberation-complete') {
    console.log('Deliberation response:', parsed.data.response);
    ws.close();
  } else if (parsed.type === 'log') {
    // Show log messages in real-time
    console.log('LOG:', parsed.data);
  }
});

ws.on('error', function error(err) {
  console.error('WebSocket error:', err);
});

ws.on('close', function close() {
  console.log('Disconnected from Magi WebSocket server');
  process.exit(0);
});