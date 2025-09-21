const fastify = require('fastify')({ logger: true });

// Register WebSocket plugin
fastify.register(require('@fastify/websocket'));

// Simple WebSocket route (exactly like the main server)
try {
  console.log('Registering WebSocket route...');
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    console.log('WebSocket connection established');
    
    // Send welcome message
    socket.send(JSON.stringify({
      type: 'welcome',
      message: 'Hello from test server!'
    }));
    
    // Handle messages
    socket.on('message', (messageBuffer) => {
      const message = messageBuffer.toString();
      console.log('Received message:', message);
      socket.send(`Echo: ${message}`);
    });
    
    socket.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
  console.log('WebSocket route registered successfully');
} catch (setupError) {
  console.error('WebSocket setup error:', setupError);
}

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 3001, host: '0.0.0.0' });
    console.log('✅ Test WebSocket server listening on port 3001');
  } catch (err) {
    console.error('Server start error:', err);
    process.exit(1);
  }
};

start();