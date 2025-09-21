const fastify = require('fastify')({ logger: false });

// Register WebSocket plugin
fastify.register(require('@fastify/websocket'));

// Test WebSocket route that doesn't depend on database
fastify.get('/test-ws', { websocket: true }, (connection, request) => {
  console.log('Test WebSocket connection established');
  
  // Send welcome message
  connection.send(JSON.stringify({
    type: 'test_welcome',
    message: 'Test WebSocket connection successful!',
    timestamp: new Date().toISOString()
  }));
  
  // Handle messages
  connection.on('message', (message) => {
    const data = JSON.parse(message.toString());
    console.log('Received test message:', data);
    
    connection.send(JSON.stringify({
      type: 'test_echo',
      original: data,
      timestamp: new Date().toISOString()
    }));
  });
  
  connection.on('close', () => {
    console.log('Test WebSocket connection closed');
  });
});

// Health check that doesn't depend on database
fastify.get('/test-health', async (request, reply) => {
  return {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    message: 'Test server is running',
    websocket_available: true
  };
});

// Start test server
const start = async () => {
  try {
    const port = process.env.PORT || 3001;
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🧪 Test WebSocket server started on port ${port}`);
    console.log(`🔗 Test WebSocket: ws://localhost:${port}/test-ws`);
    console.log(`🏥 Test Health: http://localhost:${port}/test-health`);
  } catch (error) {
    console.error('Test server startup failed:', error);
    process.exit(1);
  }
};

start();