#!/usr/bin/env node

const WebSocket = require('ws');

const WS_URL = 'wss://avai-backend.onrender.com/ws';

console.log('🔗 Testing WebSocket connection to:', WS_URL);
console.log('⏳ Connecting...');

const ws = new WebSocket(WS_URL);

ws.on('open', function open() {
  console.log('✅ WebSocket connected successfully!');
  
  // Test authentication
  console.log('🔐 Testing authentication...');
  const authMessage = {
    type: 'auth',
    token: 'test-token-will-fail'
  };
  
  ws.send(JSON.stringify(authMessage));
});

ws.on('message', function message(data) {
  console.log('📨 Received:', data.toString());
});

ws.on('error', function error(err) {
  console.log('❌ WebSocket error:', err.message);
  process.exit(1);
});

ws.on('close', function close(code, reason) {
  console.log('🔌 WebSocket closed. Code:', code, 'Reason:', reason?.toString() || 'No reason');
  process.exit(0);
});

// Timeout after 10 seconds
setTimeout(() => {
  console.log('⏰ Connection timeout - closing');
  ws.close();
}, 10000);