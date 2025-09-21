#!/usr/bin/env node

/**
 * Health Check and Error Handling Test Script
 * Tests the comprehensive error handling system for AVAI WebSocket Backend
 */

const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');

class ErrorHandlingTester {
  constructor(serverUrl = 'ws://localhost:8080/ws') {
    this.serverUrl = serverUrl;
    this.testResults = [];
    this.ws = null;
  }

  /**
   * Run all error handling tests
   */
  async runTests() {
    console.log('🚀 Starting AVAI Error Handling Tests...\n');

    try {
      // Test 1: Connection establishment
      await this.testConnection();
      
      // Test 2: Invalid JSON handling
      await this.testInvalidJSON();
      
      // Test 3: Message validation
      await this.testMessageValidation();
      
      // Test 4: Rate limiting
      await this.testRateLimit();
      
      // Test 5: Authentication errors
      await this.testAuthenticationErrors();
      
      // Test 6: Security threat detection
      await this.testSecurityThreats();
      
      // Test 7: Large message handling
      await this.testLargeMessages();
      
      // Test 8: Graceful error recovery
      await this.testErrorRecovery();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
    } finally {
      await this.cleanup();
      this.printResults();
    }
  }

  /**
   * Test WebSocket connection establishment
   */
  async testConnection() {
    return new Promise((resolve, reject) => {
      console.log('📡 Testing connection establishment...');
      
      this.ws = new WebSocket(this.serverUrl);
      
      const timeout = setTimeout(() => {
        this.addResult('Connection', false, 'Connection timeout');
        reject(new Error('Connection timeout'));
      }, 5000);
      
      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.addResult('Connection', true, 'Successfully connected to WebSocket server');
        console.log('✅ Connection established\n');
        resolve();
      });
      
      this.ws.on('error', (error) => {
        clearTimeout(timeout);
        this.addResult('Connection', false, `Connection failed: ${error.message}`);
        reject(error);
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'welcome') {
            console.log('📨 Received welcome message:', message.message);
          }
        } catch (parseError) {
          // Ignore parsing errors for this test
        }
      });
    });
  }

  /**
   * Test invalid JSON message handling
   */
  async testInvalidJSON() {
    return new Promise((resolve) => {
      console.log('🔍 Testing invalid JSON handling...');
      
      let errorReceived = false;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'error' && !message.success) {
            errorReceived = true;
            this.addResult('Invalid JSON', true, 'Server correctly rejected invalid JSON');
            console.log('✅ Invalid JSON properly handled\n');
            this.ws.removeListener('message', messageHandler);
            resolve();
          }
        } catch (parseError) {
          // Expected for malformed responses
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Send invalid JSON
      this.ws.send('{ invalid json }');
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!errorReceived) {
          this.addResult('Invalid JSON', false, 'No error response received for invalid JSON');
          console.log('❌ Invalid JSON not properly handled\n');
        }
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 3000);
    });
  }

  /**
   * Test message validation
   */
  async testMessageValidation() {
    return new Promise((resolve) => {
      console.log('🔍 Testing message validation...');
      
      let validationTests = 0;
      let validationPassed = 0;
      const expectedTests = 3;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'error' && !message.success) {
            validationTests++;
            validationPassed++;
            console.log(`✅ Validation error correctly caught: ${message.error?.message || 'Unknown error'}`);
            
            if (validationTests >= expectedTests) {
              this.completeValidationTest(validationPassed, expectedTests);
              this.ws.removeListener('message', messageHandler);
              resolve();
            }
          }
        } catch (parseError) {
          // Ignore parsing errors
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Test 1: Missing message type
      this.ws.send(JSON.stringify({
        content: "Hello world"
      }));
      
      // Test 2: Invalid message type
      this.ws.send(JSON.stringify({
        type: "invalid_type",
        content: "Hello world"
      }));
      
      // Test 3: Missing required fields for send_message
      this.ws.send(JSON.stringify({
        type: "send_message"
        // Missing threadId and content
      }));
      
      // Timeout after 5 seconds
      setTimeout(() => {
        this.completeValidationTest(validationPassed, expectedTests);
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 5000);
    });
  }

  /**
   * Complete validation test
   */
  completeValidationTest(passed, total) {
    if (passed >= total) {
      this.addResult('Message Validation', true, `All ${total} validation tests passed`);
      console.log('✅ Message validation working correctly\n');
    } else {
      this.addResult('Message Validation', false, `Only ${passed}/${total} validation tests passed`);
      console.log('❌ Message validation issues detected\n');
    }
  }

  /**
   * Test rate limiting
   */
  async testRateLimit() {
    return new Promise((resolve) => {
      console.log('🔍 Testing rate limiting...');
      
      let rateLimitTriggered = false;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.error && message.error.type === 'RATE_LIMIT_ERROR') {
            rateLimitTriggered = true;
            this.addResult('Rate Limiting', true, 'Rate limit correctly enforced');
            console.log('✅ Rate limiting working correctly\n');
            this.ws.removeListener('message', messageHandler);
            resolve();
          }
        } catch (parseError) {
          // Ignore parsing errors
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Send many messages rapidly to trigger rate limit
      for (let i = 0; i < 150; i++) {
        this.ws.send(JSON.stringify({
          type: "heartbeat",
          messageId: uuidv4()
        }));
      }
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!rateLimitTriggered) {
          this.addResult('Rate Limiting', false, 'Rate limit not triggered after sending 150 rapid messages');
          console.log('❌ Rate limiting not working\n');
        }
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 3000);
    });
  }

  /**
   * Test authentication error handling
   */
  async testAuthenticationErrors() {
    return new Promise((resolve) => {
      console.log('🔍 Testing authentication error handling...');
      
      let authErrorReceived = false;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.error && message.error.type === 'AUTHENTICATION_ERROR') {
            authErrorReceived = true;
            this.addResult('Authentication Errors', true, 'Authentication error correctly handled');
            console.log('✅ Authentication error handling working\n');
            this.ws.removeListener('message', messageHandler);
            resolve();
          }
        } catch (parseError) {
          // Ignore parsing errors
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Send invalid authentication
      this.ws.send(JSON.stringify({
        type: "authenticate",
        token: "invalid.jwt.token",
        messageId: uuidv4()
      }));
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!authErrorReceived) {
          this.addResult('Authentication Errors', false, 'No authentication error received for invalid token');
          console.log('❌ Authentication error handling not working\n');
        }
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 3000);
    });
  }

  /**
   * Test security threat detection
   */
  async testSecurityThreats() {
    return new Promise((resolve) => {
      console.log('🔍 Testing security threat detection...');
      
      let securityErrorReceived = false;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.error && message.error.message && 
              message.error.message.includes('harmful content')) {
            securityErrorReceived = true;
            this.addResult('Security Threats', true, 'Security threat correctly detected');
            console.log('✅ Security threat detection working\n');
            this.ws.removeListener('message', messageHandler);
            resolve();
          }
        } catch (parseError) {
          // Ignore parsing errors
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Send message with security threat
      this.ws.send(JSON.stringify({
        type: "send_message",
        threadId: uuidv4(),
        content: "<script>alert('XSS attack')</script>",
        messageId: uuidv4()
      }));
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!securityErrorReceived) {
          this.addResult('Security Threats', false, 'Security threat not detected');
          console.log('❌ Security threat detection not working\n');
        }
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 3000);
    });
  }

  /**
   * Test large message handling
   */
  async testLargeMessages() {
    return new Promise((resolve) => {
      console.log('🔍 Testing large message handling...');
      
      let sizeLimitErrorReceived = false;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.error && (
              message.error.message?.includes('exceeds maximum') ||
              message.error.message?.includes('too large')
            )) {
            sizeLimitErrorReceived = true;
            this.addResult('Large Messages', true, 'Large message correctly rejected');
            console.log('✅ Large message handling working\n');
            this.ws.removeListener('message', messageHandler);
            resolve();
          }
        } catch (parseError) {
          // Ignore parsing errors
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Create a very large message (15KB)
      const largeContent = 'A'.repeat(15 * 1024);
      
      this.ws.send(JSON.stringify({
        type: "send_message",
        threadId: uuidv4(),
        content: largeContent,
        messageId: uuidv4()
      }));
      
      // Timeout after 3 seconds
      setTimeout(() => {
        if (!sizeLimitErrorReceived) {
          this.addResult('Large Messages', false, 'Large message size limit not enforced');
          console.log('❌ Large message handling not working\n');
        }
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 3000);
    });
  }

  /**
   * Test error recovery
   */
  async testErrorRecovery() {
    return new Promise((resolve) => {
      console.log('🔍 Testing error recovery...');
      
      let recoverySuccessful = false;
      
      const messageHandler = (data) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'heartbeat_ack') {
            recoverySuccessful = true;
            this.addResult('Error Recovery', true, 'Connection recovered after errors');
            console.log('✅ Error recovery working\n');
            this.ws.removeListener('message', messageHandler);
            resolve();
          }
        } catch (parseError) {
          // Ignore parsing errors
        }
      };
      
      this.ws.on('message', messageHandler);
      
      // Send several invalid messages followed by a valid one
      this.ws.send('invalid json 1');
      this.ws.send('invalid json 2');
      this.ws.send(JSON.stringify({ type: "invalid_type" }));
      
      // Then send a valid message
      setTimeout(() => {
        this.ws.send(JSON.stringify({
          type: "heartbeat",
          messageId: uuidv4()
        }));
      }, 1000);
      
      // Timeout after 5 seconds
      setTimeout(() => {
        if (!recoverySuccessful) {
          this.addResult('Error Recovery', false, 'Connection did not recover after errors');
          console.log('❌ Error recovery not working\n');
        }
        this.ws.removeListener('message', messageHandler);
        resolve();
      }, 5000);
    });
  }

  /**
   * Add test result
   */
  addResult(testName, passed, details) {
    this.testResults.push({
      test: testName,
      passed,
      details,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Clean up resources
   */
  async cleanup() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
    }
  }

  /**
   * Print test results summary
   */
  printResults() {
    console.log('\n' + '='.repeat(60));
    console.log('🎯 ERROR HANDLING TEST RESULTS');
    console.log('='.repeat(60));
    
    let passed = 0;
    let total = this.testResults.length;
    
    this.testResults.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      console.log(`${status} ${result.test}: ${result.details}`);
      if (result.passed) passed++;
    });
    
    console.log('='.repeat(60));
    console.log(`📊 SUMMARY: ${passed}/${total} tests passed (${Math.round((passed/total)*100)}%)`);
    
    if (passed === total) {
      console.log('🎉 All error handling tests passed! System is production-ready.');
    } else {
      console.log('⚠️  Some tests failed. Review error handling implementation.');
    }
    
    console.log('='.repeat(60));
  }
}

// Run tests if this script is executed directly
if (require.main === module) {
  const serverUrl = process.argv[2] || 'ws://localhost:8080/ws';
  const tester = new ErrorHandlingTester(serverUrl);
  
  tester.runTests().catch(error => {
    console.error('Test execution failed:', error);
    process.exit(1);
  });
}

module.exports = ErrorHandlingTester;