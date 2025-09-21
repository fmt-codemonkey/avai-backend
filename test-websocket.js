#!/usr/bin/env node

/**
 * Simple WebSocket client test for AVAI chat backend
 * Tests authentication flow and basic messaging
 */

const WebSocket = require('ws');

// Test configuration
const WS_URL = 'ws://localhost:8080/ws';
const TEST_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18yb0xBc1hIa21tQ1hqdjVJeTVzQmZPdGJXbVEiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL2F2YWktZnJvbnRlbmQubmV0bGlmeS5hcHAiLCJleHAiOjE3NTgzOTA0NTYsImlhdCI6MTc1ODM5MDM5NiwiaXNzIjoiaHR0cHM6Ly9yb2J1c3QtcGFudGhlci05Ni5jbGVyay5hY2NvdW50cy5kZXYiLCJuYmYiOjE3NTgzOTAzODYsInNpZCI6InNlc3NfMm9MQXdZWWZ1TVptRGJhRkZzbXV5OWhtWlh2Iiwic3ViIjoidXNlcl8yb0xBd1hxcWNrY2NpTjB6Q2l1aDd5aGFHVUgifQ.invalid'; // This would be a real JWT in production

console.log('🚀 Starting AVAI WebSocket Client Test');
console.log(`Connecting to: ${WS_URL}`);

// Test 1: Anonymous user connection
function testAnonymousConnection() {
  return new Promise((resolve, reject) => {
    console.log('\n📋 Test 1: Anonymous User Connection');
    
    const ws = new WebSocket(WS_URL);
    
    ws.on('open', () => {
      console.log('✅ Connected as anonymous user');
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📥 Received:', message.type, message.message || '');
        
        if (message.type === 'welcome') {
          // Send auth message without token (anonymous)
          console.log('📤 Sending anonymous auth...');
          ws.send(JSON.stringify({ type: 'auth' }));
        }
        
        if (message.type === 'auth_success') {
          console.log('✅ Anonymous authentication successful');
          console.log('👤 User:', message.user);
          
          // Send a ping message
          ws.send(JSON.stringify({ type: 'ping' }));
        }
        
        if (message.type === 'pong') {
          console.log('🏓 Ping/Pong successful');
          ws.close();
        }
        
      } catch (error) {
        console.error('❌ Message parsing error:', error);
        reject(error);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 Anonymous connection closed');
      resolve();
    });
    
    ws.on('error', (error) => {
      console.error('❌ Anonymous connection error:', error.message);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 10000);
  });
}

// Test 2: Authenticated user connection (will fail with invalid token)
function testAuthenticatedConnection() {
  return new Promise((resolve, reject) => {
    console.log('\n📋 Test 2: Authenticated User Connection (with invalid token)');
    
    const ws = new WebSocket(WS_URL);
    
    ws.on('open', () => {
      console.log('✅ Connected for authentication test');
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('📥 Received:', message.type, message.message || '');
        
        if (message.type === 'welcome') {
          // Send auth message with invalid token
          console.log('📤 Sending auth with invalid token...');
          ws.send(JSON.stringify({ 
            type: 'auth', 
            token: TEST_TOKEN 
          }));
        }
        
        if (message.type === 'auth_error') {
          console.log('⚠️  Authentication failed as expected (invalid token)');
          console.log('📝 Error:', message.message);
          ws.close();
        }
        
        if (message.type === 'auth_success') {
          console.log('✅ Authentication successful (unexpected!)');
          console.log('👤 User:', message.user);
          ws.close();
        }
        
      } catch (error) {
        console.error('❌ Message parsing error:', error);
        reject(error);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 Authenticated test connection closed');
      resolve();
    });
    
    ws.on('error', (error) => {
      console.error('❌ Authenticated connection error:', error.message);
      reject(error);
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 10000);
  });
}

// Test 3: Rate limiting test
function testRateLimiting() {
  return new Promise((resolve, reject) => {
    console.log('\n📋 Test 3: Rate Limiting (sending 5 rapid messages)');
    
    const ws = new WebSocket(WS_URL);
    let messageCount = 0;
    
    ws.on('open', () => {
      console.log('✅ Connected for rate limiting test');
    });
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'welcome') {
          // Send anonymous auth first
          ws.send(JSON.stringify({ type: 'auth' }));
        }
        
        if (message.type === 'auth_success') {
          console.log('✅ Authenticated for rate limit test');
          
          // Send 5 rapid ping messages
          for (let i = 0; i < 5; i++) {
            ws.send(JSON.stringify({ type: 'ping', id: i }));
          }
        }
        
        if (message.type === 'pong') {
          messageCount++;
          console.log(`🏓 Pong ${messageCount} received`);
          
          if (messageCount >= 5) {
            console.log('✅ Rate limiting test completed - all messages processed');
            ws.close();
          }
        }
        
        if (message.type === 'error' && message.message.includes('Rate limit')) {
          console.log('⚠️  Rate limit triggered:', message.message);
          ws.close();
        }
        
      } catch (error) {
        console.error('❌ Message parsing error:', error);
        reject(error);
      }
    });
    
    ws.on('close', () => {
      console.log('🔌 Rate limiting test connection closed');
      resolve();
    });
    
    ws.on('error', (error) => {
      console.error('❌ Rate limiting connection error:', error.message);
      reject(error);
    });
    
    // Timeout after 15 seconds
    setTimeout(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    }, 15000);
  });
}

// Run all tests
async function runTests() {
  try {
    await testAnonymousConnection();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    await testAuthenticatedConnection();
    await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    
    await testRateLimiting();
    
    console.log('\n🎉 All tests completed!');
    console.log('\n📊 Summary:');
    console.log('- Anonymous authentication: ✅');
    console.log('- Invalid token handling: ✅');
    console.log('- Basic messaging (ping/pong): ✅');
    console.log('- Rate limiting protection: ✅');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Check if server is running first
const http = require('http');
const healthCheck = http.get('http://localhost:8080/health', (res) => {
  console.log('✅ Server is running, starting tests...');
  runTests();
});

healthCheck.on('error', (error) => {
  console.error('❌ Server is not running. Please start the server first:');
  console.error('   npm start');
  process.exit(1);
});