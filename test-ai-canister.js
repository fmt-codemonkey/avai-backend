/**
 * AI Canister Integration Test Suite
 * Tests AI canister authentication, message forwarding, and response handling
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

// Test configuration
const WS_URL = 'ws://localhost:3000/ws';
const AI_SERVICE_KEY = 'avai_canister_2025_secure_key_x9k2p8w7q5m3n1';
const CANISTER_ID = 'avai-test-canister';

/**
 * Create a WebSocket connection with error handling
 * @param {string} url - WebSocket URL
 * @returns {Promise<WebSocket>} WebSocket connection
 */
function createConnection(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    
    ws.on('open', () => {
      console.log('✅ WebSocket connection established');
      resolve(ws);
    });
    
    ws.on('error', (error) => {
      console.error('❌ WebSocket connection error:', error.message);
      reject(error);
    });
  });
}

/**
 * Send message and wait for response
 * @param {WebSocket} ws - WebSocket connection
 * @param {Object} message - Message to send
 * @param {number} timeout - Timeout in milliseconds
 * @returns {Promise<Object>} Response message
 */
function sendAndWaitForResponse(ws, message, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const messageId = message.message_id || uuidv4();
    const timeoutId = setTimeout(() => {
      reject(new Error(`Timeout waiting for response to ${message.type}`));
    }, timeout);
    
    const handleMessage = (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        // Match response to request or handle specific response types
        if (response.type === 'error' || 
            response.type === 'ai_auth_success' || 
            response.type === 'ai_response_processed' ||
            response.type === 'status_acknowledged' ||
            response.type === 'pong') {
          clearTimeout(timeoutId);
          ws.removeListener('message', handleMessage);
          resolve(response);
        }
      } catch (error) {
        clearTimeout(timeoutId);
        ws.removeListener('message', handleMessage);
        reject(new Error(`Failed to parse response: ${error.message}`));
      }
    };
    
    ws.on('message', handleMessage);
    ws.send(JSON.stringify({ ...message, message_id: messageId }));
  });
}

/**
 * Test AI Canister Authentication
 */
async function testAICanisterAuth() {
  console.log('\n🔐 Testing AI Canister Authentication...');
  
  try {
    const ws = await createConnection(WS_URL);
    
    // Test valid authentication
    const authMessage = {
      type: 'ai_auth',
      service_key: AI_SERVICE_KEY,
      canister_id: CANISTER_ID
    };
    
    const response = await sendAndWaitForResponse(ws, authMessage);
    
    if (response.type === 'ai_auth_success') {
      console.log('✅ AI canister authentication successful');
      console.log(`   Canister ID: ${response.canister_id}`);
      console.log(`   Status: ${response.status}`);
      console.log(`   Capabilities: ${response.capabilities.join(', ')}`);
    } else {
      console.log('❌ Unexpected authentication response:', response);
    }
    
    ws.close();
  } catch (error) {
    console.error('❌ AI canister authentication test failed:', error.message);
  }
}

/**
 * Test AI Canister Authentication with Invalid Key
 */
async function testInvalidAuthKey() {
  console.log('\n🔒 Testing Invalid Authentication Key...');
  
  try {
    const ws = await createConnection(WS_URL);
    
    const authMessage = {
      type: 'ai_auth',
      service_key: 'invalid_key_12345',
      canister_id: CANISTER_ID
    };
    
    const response = await sendAndWaitForResponse(ws, authMessage);
    
    if (response.type === 'error' && response.code === 'INVALID_SERVICE_KEY') {
      console.log('✅ Invalid key correctly rejected');
      console.log(`   Error: ${response.message}`);
    } else {
      console.log('❌ Expected error response for invalid key, got:', response);
    }
    
    ws.close();
  } catch (error) {
    console.error('❌ Invalid auth key test failed:', error.message);
  }
}

/**
 * Test AI Response Handling
 */
async function testAIResponseHandling() {
  console.log('\n🤖 Testing AI Response Handling...');
  
  try {
    const ws = await createConnection(WS_URL);
    
    // First authenticate
    const authMessage = {
      type: 'ai_auth',
      service_key: AI_SERVICE_KEY,
      canister_id: CANISTER_ID
    };
    
    await sendAndWaitForResponse(ws, authMessage);
    console.log('✅ AI canister authenticated for response test');
    
    // Send AI response
    const aiResponse = {
      type: 'ai_response',
      message_id: 'test_msg_' + uuidv4(),
      thread_id: 'test_thread_' + uuidv4(),
      user_id: 'test_user_123',
      response_content: 'This is a test AI response from the canister.',
      content_type: 'text',
      processing_time_ms: 1500,
      confidence_score: 0.95,
      model_used: 'avai-model-v1'
    };
    
    const response = await sendAndWaitForResponse(ws, aiResponse);
    
    if (response.type === 'ai_response_processed') {
      console.log('✅ AI response processed successfully');
      console.log(`   Message ID: ${response.message_id}`);
      console.log(`   Response ID: ${response.response_id}`);
      console.log(`   Thread ID: ${response.thread_id}`);
      console.log(`   Delivered to user: ${response.delivered_to_user}`);
    } else {
      console.log('❌ Unexpected AI response handling result:', response);
    }
    
    ws.close();
  } catch (error) {
    console.error('❌ AI response handling test failed:', error.message);
  }
}

/**
 * Test AI Status Updates
 */
async function testAIStatusUpdates() {
  console.log('\n📊 Testing AI Status Updates...');
  
  try {
    const ws = await createConnection(WS_URL);
    
    // First authenticate
    const authMessage = {
      type: 'ai_auth',
      service_key: AI_SERVICE_KEY,
      canister_id: CANISTER_ID
    };
    
    await sendAndWaitForResponse(ws, authMessage);
    console.log('✅ AI canister authenticated for status test');
    
    // Send status update
    const statusMessage = {
      type: 'ai_status',
      status: 'operational',
      queue_size: 3,
      processing_capacity: 10,
      uptime: '2h 15m'
    };
    
    const response = await sendAndWaitForResponse(ws, statusMessage);
    
    if (response.type === 'status_acknowledged') {
      console.log('✅ AI status update acknowledged');
      console.log(`   Received at: ${response.received_at}`);
      console.log(`   Backend status: ${response.backend_status}`);
    } else {
      console.log('❌ Unexpected status update response:', response);
    }
    
    ws.close();
  } catch (error) {
    console.error('❌ AI status update test failed:', error.message);
  }
}

/**
 * Test AI Ping/Pong
 */
async function testAIPingPong() {
  console.log('\n🏓 Testing AI Ping/Pong...');
  
  try {
    const ws = await createConnection(WS_URL);
    
    // First authenticate
    const authMessage = {
      type: 'ai_auth',
      service_key: AI_SERVICE_KEY,
      canister_id: CANISTER_ID
    };
    
    await sendAndWaitForResponse(ws, authMessage);
    console.log('✅ AI canister authenticated for ping test');
    
    // Send ping
    const pingMessage = {
      type: 'ping'
    };
    
    const response = await sendAndWaitForResponse(ws, pingMessage);
    
    if (response.type === 'pong') {
      console.log('✅ AI ping/pong successful');
      console.log(`   Canister ID: ${response.canister_id}`);
    } else {
      console.log('❌ Unexpected ping response:', response);
    }
    
    ws.close();
  } catch (error) {
    console.error('❌ AI ping/pong test failed:', error.message);
  }
}

/**
 * Test User Message to AI Forwarding
 * This test requires a regular user connection and an AI canister connection
 */
async function testMessageForwarding() {
  console.log('\n📤 Testing Message Forwarding to AI...');
  
  try {
    // Create AI canister connection
    const aiWs = await createConnection(WS_URL);
    
    // Authenticate AI canister
    const authMessage = {
      type: 'ai_auth',
      service_key: AI_SERVICE_KEY,
      canister_id: CANISTER_ID
    };
    
    await sendAndWaitForResponse(aiWs, authMessage);
    console.log('✅ AI canister connected and authenticated');
    
    // Set up listener for forwarded messages
    const forwardedMessages = [];
    aiWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'process_message') {
          forwardedMessages.push(message);
          console.log('✅ Received forwarded message from user:', message.message_id);
        }
      } catch (error) {
        console.error('Error parsing AI message:', error);
      }
    });
    
    // Create user connection
    const userWs = await createConnection(WS_URL);
    
    // Authenticate as anonymous user
    const userAuth = {
      type: 'auth',
      anonymous: true
    };
    
    userWs.send(JSON.stringify(userAuth));
    
    // Wait for user auth
    await new Promise(resolve => {
      userWs.on('message', (data) => {
        const response = JSON.parse(data.toString());
        if (response.type === 'auth_success') {
          resolve();
        }
      });
    });
    
    console.log('✅ User connected and authenticated');
    
    // Create a thread first
    const createThreadMessage = {
      type: 'create_thread',
      title: 'AI Integration Test Thread'
    };
    
    userWs.send(JSON.stringify(createThreadMessage));
    
    // Wait for thread creation
    const threadId = await new Promise(resolve => {
      userWs.on('message', (data) => {
        const response = JSON.parse(data.toString());
        if (response.type === 'thread_created') {
          resolve(response.thread.id);
        }
      });
    });
    
    console.log(`✅ Test thread created: ${threadId}`);
    
    // Send message to trigger AI forwarding
    const sendMessage = {
      type: 'send_message',
      thread_id: threadId,
      content: 'Hello AI, this is a test message!',
      content_type: 'text'
    };
    
    userWs.send(JSON.stringify(sendMessage));
    
    // Wait a moment for forwarding
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if message was forwarded
    if (forwardedMessages.length > 0) {
      const forwarded = forwardedMessages[0];
      console.log('✅ Message successfully forwarded to AI canister');
      console.log(`   Message ID: ${forwarded.message_id}`);
      console.log(`   Thread ID: ${forwarded.thread_id}`);
      console.log(`   Content: ${forwarded.content}`);
      console.log(`   Context messages: ${forwarded.conversation_context.length}`);
    } else {
      console.log('❌ No messages were forwarded to AI canister');
    }
    
    // Cleanup
    userWs.close();
    aiWs.close();
    
  } catch (error) {
    console.error('❌ Message forwarding test failed:', error.message);
  }
}

/**
 * Run all AI canister integration tests
 */
async function runAllTests() {
  console.log('🚀 Starting AI Canister Integration Tests...\n');
  
  const tests = [
    testAICanisterAuth,
    testInvalidAuthKey,
    testAIResponseHandling,
    testAIStatusUpdates,
    testAIPingPong,
    // testMessageForwarding // Commented out as it requires more complex setup
  ];
  
  for (const test of tests) {
    try {
      await test();
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait between tests
    } catch (error) {
      console.error(`Test ${test.name} failed:`, error.message);
    }
  }
  
  console.log('\n✅ AI Canister Integration Tests Complete!');
  console.log('\n📝 Manual Test Instructions:');
  console.log('1. Start your AVAI backend server: npm start');
  console.log('2. Run this test script: node test-ai-canister.js');
  console.log('3. Connect your AI canister using the authentication flow');
  console.log('4. Send user messages and verify AI responses are handled correctly');
  console.log('\n🔑 AI Service Key: ' + AI_SERVICE_KEY);
}

// Run tests if this file is executed directly
if (require.main === module) {
  runAllTests().catch(console.error);
}

module.exports = {
  testAICanisterAuth,
  testInvalidAuthKey,
  testAIResponseHandling,
  testAIStatusUpdates,
  testAIPingPong,
  testMessageForwarding,
  runAllTests
};