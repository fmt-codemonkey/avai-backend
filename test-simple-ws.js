#!/usr/bin/env node

/**
 * Simple server test to verify WebSocket functionality
 * This bypasses all the complex logging and AI systems
 */

const fastify = require('fastify')({ 
  logger: false,
  http2: false  // Force HTTP/1.1 for WebSocket compatibility
});

// Register WebSocket plugin
fastify.register(require('@fastify/websocket'));

// Simple CORS
fastify.register(require('@fastify/cors'), {
  origin: ['https://avai-xi.vercel.app', 'http://localhost:3000'],
  credentials: true
});

// Health check
fastify.get('/health', async (request, reply) => {
  return { status: 'healthy', timestamp: new Date().toISOString() };
});

// Simple WebSocket route
fastify.get('/ws', { websocket: true }, (connection, request) => {
  console.log('New WebSocket connection from:', request.ip);
  
  // Send welcome message
  connection.send(JSON.stringify({
    type: 'welcome',
    message: 'Connected to simplified AVAI server',
    timestamp: new Date().toISOString()
  }));

  // Handle messages
  connection.on('message', (messageBuffer) => {
    try {
      const message = JSON.parse(messageBuffer.toString());
      console.log('Received message:', message);
      
      // Echo back
      connection.send(JSON.stringify({
        type: 'response',
        original: message,
        timestamp: new Date().toISOString()
      }));
    } catch (error) {
      console.error('Message parsing error:', error);
    }
  });

  connection.on('close', () => {
    console.log('WebSocket connection closed');
  });

  connection.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start server
const start = async () => {
  try {
    const port = process.env.PORT || 8080;
    const host = '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`✅ Simplified AVAI server running on http://${host}:${port}`);
    console.log(`✅ WebSocket endpoint: ws://${host}:${port}/ws`);
    console.log(`✅ Health check: http://${host}:${port}/health`);
  } catch (error) {
    console.error('❌ Server startup failed:', error);
    process.exit(1);
  }
};

start();