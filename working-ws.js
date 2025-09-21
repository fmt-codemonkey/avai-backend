const fastify = require('fastify')({ logger: true });

// Register WebSocket plugin
fastify.register(require('@fastify/websocket'));

// Simple working WebSocket endpoint
fastify.register(async function (fastify) {
  fastify.get('/ws', { websocket: true }, (socket, req) => {
    console.log('WebSocket connection established');
    console.log('Socket type:', typeof socket);
    console.log('Socket has send?', typeof socket.send);
    
    socket.send('Welcome to AVAI WebSocket!');
    
    socket.on('message', (message) => {
      console.log('Received:', message.toString());
      socket.send(`Echo: ${message.toString()}`);
    });
    
    socket.on('close', () => {
      console.log('WebSocket connection closed');
    });
  });
});

// Health endpoint
fastify.get('/health', async (request, reply) => {
  return { status: 'ok', message: 'WebSocket server running' };
});

// Start server
const start = async () => {
  try {
    await fastify.listen({ port: 9000, host: '0.0.0.0' });
    console.log('✅ WebSocket server listening on port 9000');
  } catch (err) {
    console.error('❌ Error starting server:', err);
    process.exit(1);
  }
};

start();