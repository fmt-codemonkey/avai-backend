const fastify = require('fastify')({ logger: true });

// Register WebSocket support
fastify.register(require('@fastify/websocket'));

// Simple test WebSocket endpoint
fastify.get('/simple-ws', { websocket: true }, (connection, request) => {
  console.log('WebSocket connection established');
  
  connection.send(JSON.stringify({
    type: 'connection_success',
    message: 'WebSocket is working!',
    timestamp: new Date().toISOString()
  }));
  
  connection.on('message', (message) => {
    console.log('Received:', message.toString());
    connection.send(JSON.stringify({
      type: 'echo',
      data: message.toString(),
      timestamp: new Date().toISOString()
    }));
  });
  
  connection.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Simple health check
fastify.get('/simple-health', async (request, reply) => {
  return { status: 'ok', timestamp: new Date().toISOString() };
});

// Start server
const start = async () => {
  try {
    const port = process.env.PORT || 3000;
    await fastify.listen({ port: port, host: '0.0.0.0' });
    console.log(`Server listening on port ${port}`);
  } catch (err) {
    console.error('Error starting server:', err);
    process.exit(1);
  }
};

start();