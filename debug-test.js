#!/usr/bin/env node

/**
 * Simple debug test to see actual responses
 */

const WebSocket = require('ws');

async function debugTest() {
  console.log('🔍 Debug Test - Checking actual server responses');
  
  const ws = new WebSocket('ws://localhost:8081/ws');
  
  ws.on('open', () => {
    console.log('Connected');
  });
  
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data.toString());
      console.log('📨 Received:', JSON.stringify(message, null, 2));
      
      if (message.type === 'welcome') {
        console.log('🔑 Sending auth...');
        ws.send(JSON.stringify({ type: 'auth' }));
      } else if (message.type === 'auth_success') {
        console.log('🧵 Testing invalid thread ID...');
        ws.send(JSON.stringify({
          type: 'get_history',
          thread_id: 'invalid-uuid',
          limit: 10
        }));
      }
    } catch (error) {
      console.error('Parse error:', error.message);
    }
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error.message);
  });
  
  // Close after 10 seconds
  setTimeout(() => {
    ws.close();
    console.log('🔚 Test complete');
    process.exit(0);
  }, 10000);
}

debugTest();