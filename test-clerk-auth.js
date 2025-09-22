#!/usr/bin/env node

/**
 * Simple WebSocket Test for Clerk Authentication
 * Tests both anonymous and Clerk token authentication
 */

const WebSocket = require('ws');

const WS_URL = 'ws://localhost:8080/ws';

// Mock Clerk token (this would normally come from getToken() in the frontend)
const MOCK_CLERK_TOKEN = 'eyJhbGciOiJSUzI1NiIsImtpZCI6Imluc18yalF4S0JOTklVRHNJVGVsWGYzVnVXVlhFeTEiLCJ0eXAiOiJKV1QifQ.eyJhenAiOiJodHRwczovL3plZWQtcGFuZ29saW4tNzcuY2xlcmsuYWNjb3VudHMuZGV2IiwiZXhwIjoxNzU4NTA3MjU5LCJpYXQiOjE3NTg1MDcxOTksImlzcyI6Imh0dHBzOi8vemVlZC1wYW5nb2xpbi03Ny5jbGVyay5hY2NvdW50cy5kZXYiLCJqdGkiOiJmNzU4MTE2MzBhNGZkODMzODQ3MCIsIm5iZiI6MTc1ODUwNzE4OSwic2lkIjoic2Vzc18yalF4S0JOTklVRHNJVGVsWGYzVnVXVlhFeTEiLCJzdWIiOiJ1c2VyXzJqUXhLQk5OSVVEc0lUZWxYZjNWdVdWWEV5MSJ9';

function testWebSocketAuth() {
  console.log('🧪 Starting WebSocket Authentication Tests\n');

  // Test 1: Anonymous Authentication
  console.log('📋 Test 1: Anonymous Authentication');
  testAnonymousAuth(() => {
    // Test 2: Clerk Token Authentication
    console.log('\n📋 Test 2: Clerk Token Authentication');
    testClerkAuth(() => {
      console.log('\n✅ All tests completed!');
      process.exit(0);
    });
  });
}

function testAnonymousAuth(callback) {
  const ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Send anonymous authentication
    const authMessage = {
      type: 'authenticate',
      anonymous: true,
      messageId: Date.now().toString()
    };
    
    console.log('📤 Sending anonymous auth request...');
    ws.send(JSON.stringify(authMessage));
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📨 Received:', message.type);
    
    if (message.type === 'auth_success') {
      console.log('✅ Anonymous authentication successful!');
      console.log(`   User: ${message.user.name} (ID: ${message.user.id})`);
      console.log(`   Session: ${message.user.sessionId}`);
      console.log(`   Is Anonymous: ${message.user.isAnonymous}`);
      
      ws.close();
      setTimeout(callback, 100);
    } else if (message.type === 'error' || message.type === 'auth_error') {
      console.log('❌ Anonymous authentication failed:', message.message);
      ws.close();
      setTimeout(callback, 100);
    }
  });

  ws.on('error', (error) => {
    console.log('❌ WebSocket error:', error.message);
    setTimeout(callback, 100);
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
  });
}

function testClerkAuth(callback) {
  const ws = new WebSocket(WS_URL);
  
  ws.on('open', () => {
    console.log('✅ WebSocket connected');
    
    // Send Clerk token authentication
    const authMessage = {
      type: 'authenticate',
      token: MOCK_CLERK_TOKEN,
      messageId: Date.now().toString()
    };
    
    console.log('📤 Sending Clerk token auth request...');
    ws.send(JSON.stringify(authMessage));
  });

  ws.on('message', (data) => {
    const message = JSON.parse(data.toString());
    console.log('📨 Received:', message.type);
    
    if (message.type === 'auth_success') {
      console.log('✅ Clerk authentication successful!');
      console.log(`   User: ${message.user.name} (${message.user.email})`);
      console.log(`   ID: ${message.user.id}`);
      console.log(`   Is Authenticated: ${message.user.isAuthenticated}`);
      
      // Test sending a message
      console.log('📤 Testing message sending...');
      const testMessage = {
        type: 'send_message',
        content: 'Hello from authenticated user!',
        threadId: 'test-thread',
        messageId: Date.now().toString()
      };
      
      ws.send(JSON.stringify(testMessage));
    } else if (message.type === 'error' || message.type === 'auth_error') {
      console.log('❌ Clerk authentication failed:', message.message);
      console.log('   This is expected if using a mock/expired token');
      ws.close();
      setTimeout(callback, 100);
    } else if (message.type === 'message_saved') {
      console.log('✅ Message sent successfully!');
      ws.close();
      setTimeout(callback, 100);
    }
  });

  ws.on('error', (error) => {
    console.log('❌ WebSocket error:', error.message);
    setTimeout(callback, 100);
  });

  ws.on('close', () => {
    console.log('🔌 WebSocket connection closed');
  });
}

// Start tests
testWebSocketAuth();