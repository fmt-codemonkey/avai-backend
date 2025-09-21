const fastify = require('fastify')({ logger: false });

fastify.register(require('@fastify/websocket'));

// Correct Fastify WebSocket v11+ pattern
fastify.get('/ws', { websocket: true }, (ws, request) => {
  console.log('WS object type:', typeof ws);
  console.log('WS properties:', Object.keys(ws));
  console.log('WS has send?', typeof ws.send);
  console.log('WS has on?', typeof ws.on);
  
  // Try different access patterns
  if (ws.ws) {
    console.log('ws.ws type:', typeof ws.ws);
    console.log('ws.ws send?', typeof ws.ws.send);
  }
  
  try {
    ws.send('Hello from WebSocket!');
  } catch (e) {
    console.log('ws.send error:', e.message);
    try {
      ws.ws.send('Hello from ws.ws!');
    } catch (e2) {
      console.log('ws.ws.send error:', e2.message);
    }
  }
});

const start = async () => {
  try {
    await fastify.listen({ port: 9000, host: '0.0.0.0' });
    console.log('Test server running on port 9000');
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

start();