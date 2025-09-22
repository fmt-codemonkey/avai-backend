const WebSocket = require('ws');

console.log('🚀 Starting WebSocket test...');
const ws = new WebSocket('ws://localhost:8080/ws');

ws.on('open', () => {
  console.log('✅ WebSocket connected');
  ws.send(JSON.stringify({
    type: 'authenticate',
    anonymous: true,
    messageId: 'test-' + Date.now()
  }));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('📨 Received:', message.type);
  
  if (message.type === 'auth_success') {
    console.log('🎉 Anonymous auth successful');
    console.log('👤 User:', message.user.name, '(Anonymous:', message.user.isAnonymous + ')');
    console.log('🆔 Session ID:', message.user.sessionId);
    process.exit(0);
  } else if (message.type === 'error') {
    console.log('❌ Auth failed:', message.message);
    process.exit(1);
  }
});

ws.on('error', (error) => {
  console.error('❌ WebSocket error:', error.message);
  process.exit(1);
});

ws.on('close', () => {
  console.log('🔌 WebSocket closed');
});

setTimeout(() => {
  console.log('⏰ Test timeout');
  process.exit(1);
}, 8000);