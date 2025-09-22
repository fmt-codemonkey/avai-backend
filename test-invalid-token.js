const WebSocket = require('ws');

console.log('🚀 Testing WebSocket with invalid Clerk token...');
const ws = new WebSocket('ws://localhost:8080/ws');

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  ws.send(JSON.stringify({
    type: 'authenticate',
    token: 'invalid_clerk_token_for_testing',
    messageId: 'test-' + Date.now()
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📨 Received:', message.type);
  
  if (message.type === 'auth_success') {
    console.log('❌ Unexpected success with invalid token');
    process.exit(1);
  } else if (message.type === 'error') {
    console.log('✅ Correctly rejected invalid token');
    console.log('📋 Error:', message.message);
    process.exit(0);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

setTimeout(() => {
  console.log('⏰ Test timeout');
  process.exit(1);
}, 8000);