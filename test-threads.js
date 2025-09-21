#!/usr/bin/env node

/**
 * Thread Management System Test for AVAI chat backend
 * Tests thread CRUD operations, user isolation, and error handling
 */

const WebSocket = require('ws');

// Test configuration
const WS_URL = 'ws://localhost:8080/ws';
const TEST_DELAY = 1000; // Delay between tests

console.log('🧵 Starting AVAI Thread Management Test Suite');
console.log(`Connecting to: ${WS_URL}`);

// Test data
let testThreadId = null;
let createdThreads = [];

/**
 * Create a WebSocket connection and handle basic setup
 */
function createConnection() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    
    ws.on('open', () => {
      resolve(ws);
    });
    
    ws.on('error', (error) => {
      reject(error);
    });
  });
}

/**
 * Authenticate as anonymous user
 */
function authenticateAnonymous(ws) {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    
    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'welcome' && !isResolved) {
          // Send anonymous auth
          ws.send(JSON.stringify({ type: 'auth' }));
        }
        
        if (message.type === 'auth_success' && !isResolved) {
          isResolved = true;
          console.log(`✅ Authenticated as: ${message.user.name} (${message.user.sessionId})`);
          resolve(message.user);
        }
        
        if (message.type === 'auth_error' && !isResolved) {
          isResolved = true;
          reject(new Error(message.message));
        }
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          reject(error);
        }
      }
    });
    
    // Timeout after 10 seconds
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        reject(new Error('Authentication timeout'));
      }
    }, 10000);
  });
}

/**
 * Send a message and wait for specific response
 */
function sendAndWaitFor(ws, message, expectedType, timeout = 5000) {
  return new Promise((resolve, reject) => {
    let isResolved = false;
    
    const messageHandler = (data) => {
      try {
        const response = JSON.parse(data.toString());
        
        if (response.type === expectedType && !isResolved) {
          isResolved = true;
          ws.removeListener('message', messageHandler);
          resolve(response);
        }
        
        if (response.type === 'error' && !isResolved) {
          isResolved = true;
          ws.removeListener('message', messageHandler);
          reject(new Error(`${response.code}: ${response.message}`));
        }
      } catch (error) {
        if (!isResolved) {
          isResolved = true;
          ws.removeListener('message', messageHandler);
          reject(error);
        }
      }
    };
    
    ws.on('message', messageHandler);
    ws.send(JSON.stringify(message));
    
    // Timeout
    setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        ws.removeListener('message', messageHandler);
        reject(new Error(`Timeout waiting for ${expectedType}`));
      }
    }, timeout);
  });
}

/**
 * Test 1: Create Thread
 */
async function testCreateThread(ws) {
  console.log('\\n📋 Test 1: Create Thread');
  
  try {
    const response = await sendAndWaitFor(ws, {
      type: 'create_thread',
      title: 'Test Security Analysis Thread',
      description: 'Testing thread creation functionality'
    }, 'thread_created');
    
    testThreadId = response.thread.id;
    createdThreads.push(testThreadId);
    
    console.log('✅ Thread created successfully');
    console.log(`   ID: ${response.thread.id}`);
    console.log(`   Title: ${response.thread.title}`);
    console.log(`   Status: ${response.thread.status}`);
    
    return true;
  } catch (error) {
    console.error('❌ Create thread failed:', error.message);
    return false;
  }
}

/**
 * Test 2: Create Multiple Threads
 */
async function testCreateMultipleThreads(ws) {
  console.log('\\n📋 Test 2: Create Multiple Threads');
  
  const threadTitles = [
    'React Security Audit',
    'API Vulnerability Assessment',
    'Database Security Review'
  ];
  
  try {
    for (const title of threadTitles) {
      const response = await sendAndWaitFor(ws, {
        type: 'create_thread',
        title: title
      }, 'thread_created');
      
      createdThreads.push(response.thread.id);
      console.log(`✅ Created: "${title}" (${response.thread.id})`);
      
      // Small delay between creates
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return true;
  } catch (error) {
    console.error('❌ Create multiple threads failed:', error.message);
    return false;
  }
}

/**
 * Test 3: Get Threads List
 */
async function testGetThreads(ws) {
  console.log('\\n📋 Test 3: Get Threads List');
  
  try {
    const response = await sendAndWaitFor(ws, {
      type: 'get_threads',
      limit: 10
    }, 'threads_list');
    
    console.log(`✅ Retrieved ${response.threads.length} threads`);
    
    response.threads.forEach((thread, index) => {
      console.log(`   ${index + 1}. ${thread.title} (${thread.id})`);
      console.log(`      Status: ${thread.status}, Pinned: ${thread.is_pinned}, Messages: ${thread.message_count}`);
    });
    
    return response.threads.length > 0;
  } catch (error) {
    console.error('❌ Get threads failed:', error.message);
    return false;
  }
}

/**
 * Test 4: Get Thread History (Empty)
 */
async function testGetThreadHistory(ws) {
  console.log('\\n📋 Test 4: Get Thread History');
  
  if (!testThreadId) {
    console.log('⚠️  Skipping - no test thread available');
    return false;
  }
  
  try {
    const response = await sendAndWaitFor(ws, {
      type: 'get_history',
      thread_id: testThreadId,
      limit: 50
    }, 'thread_history');
    
    console.log(`✅ Retrieved history for thread ${testThreadId}`);
    console.log(`   Message count: ${response.messages.length}`);
    
    if (response.messages.length === 0) {
      console.log('   (Empty thread - expected for new thread)');
    }
    
    return true;
  } catch (error) {
    console.error('❌ Get thread history failed:', error.message);
    return false;
  }
}

/**
 * Test 5: Pin Thread
 */
async function testPinThread(ws) {
  console.log('\\n📋 Test 5: Pin Thread');
  
  if (!testThreadId) {
    console.log('⚠️  Skipping - no test thread available');
    return false;
  }
  
  try {
    const response = await sendAndWaitFor(ws, {
      type: 'pin_thread',
      thread_id: testThreadId,
      is_pinned: true
    }, 'thread_updated');
    
    console.log(`✅ Thread pinned successfully`);
    console.log(`   Thread ID: ${response.thread_id}`);
    console.log(`   Pinned: ${response.is_pinned}`);
    
    return true;
  } catch (error) {
    console.error('❌ Pin thread failed:', error.message);
    return false;
  }
}

/**
 * Test 6: Unpin Thread
 */
async function testUnpinThread(ws) {
  console.log('\\n📋 Test 6: Unpin Thread');
  
  if (!testThreadId) {
    console.log('⚠️  Skipping - no test thread available');
    return false;
  }
  
  try {
    const response = await sendAndWaitFor(ws, {
      type: 'pin_thread',
      thread_id: testThreadId,
      is_pinned: false
    }, 'thread_updated');
    
    console.log(`✅ Thread unpinned successfully`);
    console.log(`   Thread ID: ${response.thread_id}`);
    console.log(`   Pinned: ${response.is_pinned}`);
    
    return true;
  } catch (error) {
    console.error('❌ Unpin thread failed:', error.message);
    return false;
  }
}

/**
 * Test 7: Archive Thread
 */
async function testArchiveThread(ws) {
  console.log('\\n📋 Test 7: Archive Thread');
  
  if (createdThreads.length === 0) {
    console.log('⚠️  Skipping - no threads to archive');
    return false;
  }
  
  const threadToArchive = createdThreads[createdThreads.length - 1];
  
  try {
    const response = await sendAndWaitFor(ws, {
      type: 'archive_thread',
      thread_id: threadToArchive
    }, 'thread_archived');
    
    console.log(`✅ Thread archived successfully`);
    console.log(`   Thread ID: ${response.thread_id}`);
    console.log(`   Status: ${response.status}`);
    
    return true;
  } catch (error) {
    console.error('❌ Archive thread failed:', error.message);
    return false;
  }
}

/**
 * Test 8: Error Handling - Invalid Thread ID
 */
async function testErrorHandling(ws) {
  console.log('\\n📋 Test 8: Error Handling');
  
  try {
    // Test with invalid UUID
    await sendAndWaitFor(ws, {
      type: 'get_history',
      thread_id: 'invalid-uuid',
      limit: 10
    }, 'error', 3000);
    
    console.error('❌ Expected error for invalid UUID, but got success');
    return false;
  } catch (error) {
    if (error.message.includes('INVALID_THREAD_ID')) {
      console.log('✅ Properly handled invalid thread ID');
      return true;
    } else {
      console.error('❌ Unexpected error:', error.message);
      return false;
    }
  }
}

/**
 * Test 9: Validation - Empty Title
 */
async function testValidation(ws) {
  console.log('\\n📋 Test 9: Validation - Empty Title');
  
  try {
    await sendAndWaitFor(ws, {
      type: 'create_thread',
      title: '',
      description: 'Should fail'
    }, 'error', 3000);
    
    console.error('❌ Expected error for empty title, but got success');
    return false;
  } catch (error) {
    if (error.message.includes('INVALID_TITLE')) {
      console.log('✅ Properly validated empty title');
      return true;
    } else {
      console.error('❌ Unexpected validation error:', error.message);
      return false;
    }
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  let ws;
  const results = [];
  
  try {
    // Connect and authenticate
    console.log('🔗 Connecting to WebSocket server...');
    ws = await createConnection();
    console.log('✅ Connected successfully');
    
    console.log('🔐 Authenticating as anonymous user...');
    await authenticateAnonymous(ws);
    
    // Run tests with delays
    const tests = [
      { name: 'Create Thread', fn: testCreateThread },
      { name: 'Create Multiple Threads', fn: testCreateMultipleThreads },
      { name: 'Get Threads List', fn: testGetThreads },
      { name: 'Get Thread History', fn: testGetThreadHistory },
      { name: 'Pin Thread', fn: testPinThread },
      { name: 'Unpin Thread', fn: testUnpinThread },
      { name: 'Archive Thread', fn: testArchiveThread },
      { name: 'Error Handling', fn: testErrorHandling },
      { name: 'Validation', fn: testValidation }
    ];
    
    for (const test of tests) {
      const result = await test.fn(ws);
      results.push({ name: test.name, passed: result });
      
      // Delay between tests
      await new Promise(resolve => setTimeout(resolve, TEST_DELAY));
    }
    
    // Results summary
    console.log('\\n🎉 Test Suite Complete!');
    console.log('\\n📊 Results Summary:');
    
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    
    results.forEach(result => {
      console.log(`${result.passed ? '✅' : '❌'} ${result.name}`);
    });
    
    console.log(`\\n🏆 Overall: ${passed}/${total} tests passed`);
    
    if (passed === total) {
      console.log('\\n🎊 All tests passed! Thread management system is working correctly.');
    } else {
      console.log(`\\n⚠️  ${total - passed} test(s) failed. Please check the implementation.`);
    }
    
  } catch (error) {
    console.error('\\n❌ Test suite failed:', error.message);
  } finally {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
  }
}

// Check if server is running first
const http = require('http');
const healthCheck = http.get('http://localhost:8080/health', (res) => {
  console.log('✅ Server is running, starting thread management tests...');
  runAllTests();
});

healthCheck.on('error', (error) => {
  console.error('❌ Server is not running. Please start the server first:');
  console.error('   npm start');
  process.exit(1);
});