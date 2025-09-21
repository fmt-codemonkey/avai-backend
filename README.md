# AVAI WebSocket Backend

A production-ready Node.js + Fastify WebSocket server with comprehensive error handling, AI integration, and real-time chat functionality for the AVAI security-focused chat application.

## Features

✅ **Production-Ready Security Hardening**

- Multi-tier rate limiting (user/anonymous/IP/global)
- Advanced threat detection (XSS, SQL injection, command injection)
- Enhanced JWT validation with security checks
- IP blocking and failed attempt tracking
- Input sanitization and content validation
- Comprehensive security event logging

✅ **AI-Powered Conversations**

- AVAI Canister integration with security focus
- Intelligent response generation
- Context-aware conversation management
- Real-time AI interaction with threat analysis

✅ **Robust Authentication & Authorization**

- Enhanced JWT token validation and security checks
- Token blacklisting and revocation support
- Anonymous user support with rate limiting
- Failed authentication attempt tracking
- IP-based blocking for suspicious activity

✅ **Advanced Rate Limiting**

- Sliding window algorithm for accurate limiting
- Authenticated users: 60 messages/min, 1000/hour
- Anonymous users: 10 messages/min, 100/hour
- IP limits: 20 connections/min, 200 messages/min
- Global limits: 1000 connections, 100 messages/sec

✅ **Comprehensive Error Handling**

- Structured logging with security event tracking
- Graceful error recovery and retry logic
- Circuit breakers and fallback mechanisms
- Performance monitoring and alerting

✅ **WebSocket Security**

- Pre-connection security validation
- Message content scanning and sanitization
- Connection limits and active monitoring
- Real-time threat detection and blocking

## Quick Start

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Environment Setup**
   The `.env` file is already configured with:
   ```
   PORT=8080
   NODE_ENV=development
   SUPABASE_URL=https://oscnavzuxxuirufvzemc.supabase.co
   SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   CLERK_SECRET_KEY=sk_test_QmpjasQsiKyNFJbUqnPXqi7LwuVpWI6EOwMoE1TQwS
   ```

3. **Start the server**
   ```bash
   # Development mode (with auto-restart)
   npm run dev
   
   # Production mode
   npm start
   ```

## API Endpoints

### Health Check
```
GET /health
```
Returns server status, database connectivity, and system information.

### WebSocket Connection
```
WS /ws
```
Establishes a WebSocket connection for real-time chat.

## WebSocket Usage

### Authentication Headers
- **Authenticated users**: Include `Authorization: Bearer <jwt_token>`
- **Anonymous users**: Include `x-session-id: <session_id>` (optional)

### Example WebSocket Connection

```javascript
// Authenticated user
const ws = new WebSocket('ws://localhost:8080/ws', {
  headers: {
    'Authorization': 'Bearer your-jwt-token'
  }
});

// Anonymous user
const ws = new WebSocket('ws://localhost:8080/ws', {
  headers: {
    'x-session-id': 'unique-session-id'
  }
});

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Received:', data);
};

ws.send(JSON.stringify({
  type: 'message',
  content: 'Hello, AVAI!',
  chatId: 'chat-session-id'
}));
```

## Project Structure

```
src/
├── server.js    # Main Fastify server with WebSocket
├── database.js  # Supabase client and database operations
└── auth.js      # Clerk authentication and JWT verification
```

## Database Schema

The server expects the following Supabase tables:

### Users Table
```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Messages Table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT REFERENCES users(id),
  content TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('user', 'assistant')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 8080) | No |
| `NODE_ENV` | Environment (development/production) | No |
| `SUPABASE_URL` | Supabase project URL | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key | Yes |
| `CLERK_SECRET_KEY` | Clerk secret key for JWT verification | Yes |

## Production Considerations

1. **CORS Configuration**: Update the allowed origins in `src/server.js`
2. **SSL/TLS**: Use HTTPS in production
3. **Rate Limiting**: Consider adding rate limiting middleware
4. **Monitoring**: Set up proper logging and monitoring
5. **Database**: Ensure Supabase tables are created with proper indexes

## Architecture

### Core Components

- **WebSocket Server**: Fastify-based real-time communication
- **AI Integration**: AVAI Canister connection with intelligent responses
- **Database**: Supabase integration for data persistence
- **Authentication**: Clerk authentication with anonymous support
- **Error Handling**: Comprehensive error management and logging
- **Rate Limiting**: Configurable request throttling
- **Validation**: Input sanitization and security checks

### Key Features

✅ **Production-Ready Error Handling**

- Structured logging with metadata
- Comprehensive input validation
- Security threat detection
- Rate limiting and abuse prevention
- Graceful error recovery

✅ **AI-Powered Conversations**

- AVAI Canister integration
- Intelligent response generation
- Context-aware conversation management
- Real-time AI interaction

✅ **Robust Authentication**

- JWT token verification
- Anonymous user support
- Session management
- Access control

✅ **Scalable WebSocket Architecture**

- Connection management
- Message routing
- Real-time communication
- Thread-based conversations

## Security

This backend implements comprehensive **production-grade security** measures:

### 🛡️ Security Features

- **Multi-tier Rate Limiting**: Prevents abuse with sliding window algorithm
- **Advanced Threat Detection**: XSS, SQL injection, command injection protection
- **Enhanced JWT Security**: Comprehensive token validation and blacklisting
- **IP Blocking**: Automatic blocking of suspicious IP addresses
- **Content Validation**: Real-time message scanning and sanitization
- **Security Event Logging**: Detailed audit trail for all security events

### 🔒 Rate Limits

| User Type | Messages/Min | Messages/Hour | Connections/Min |
|-----------|--------------|---------------|-----------------|
| Authenticated | 60 | 1,000 | 10 |
| Anonymous | 10 | 100 | 3 |
| Per IP | 200 | - | 20 |
| Global System | 100/sec | - | 1,000 total |

### 🚨 Threat Protection

- **XSS Prevention**: Blocks script tags, event handlers, malicious URLs
- **SQL Injection**: Detects SQL keywords, union attacks, comment patterns  
- **Command Injection**: Prevents shell metacharacters and command chaining
- **Path Traversal**: Blocks directory traversal attempts
- **Suspicious Content**: Identifies dangerous function calls and patterns

## Testing

### Security Test Suite

```bash
# Run comprehensive security tests
node tests/security-test-suite.js

# Test specific server
node tests/security-test-suite.js ws://localhost:8080/ws
```

### Error Handling Tests

```bash
# Run comprehensive error handling tests
node tests/error-handling-test.js

# Test specific server
node tests/error-handling-test.js ws://localhost:8080/ws
```

### Manual Testing

Use any WebSocket client (e.g., websocat, wscat) to test:

```bash
# Install wscat
npm install -g wscat

# Connect to server
wscat -c ws://localhost:8080/ws

# Send test message
{"type":"authenticate","anonymous":true}
```

## Documentation

- [Error Handling & Validation System](docs/error-handling.md) - Comprehensive guide to error handling
- [API Reference](docs/error-handling.md#api-reference) - WebSocket message types and responses
- [Production Deployment](docs/error-handling.md#production-considerations) - Scaling and monitoring guidance

## Development

### Project Structure

```text
src/
├── server.js              # Main server and WebSocket handling
├── database.js            # Supabase database operations
├── auth.js                # Authentication utilities
├── utils/
│   ├── logger.js          # Structured logging system
│   ├── validation.js      # Input validation and security
│   ├── errorHandler.js    # Centralized error handling
│   └── rateLimiter.js     # Request rate limiting
├── handlers/
│   ├── auth.js            # Authentication message handling
│   ├── chat.js            # Chat message processing
│   ├── threads.js         # Thread management
│   └── ai.js              # AI integration
tests/
├── error-handling-test.js # Comprehensive error handling tests
docs/
└── error-handling.md      # Detailed error handling documentation
```

```bash
# Start in development mode with auto-restart
npm run dev

# The server will be available at:
# HTTP: http://localhost:8080
# WebSocket: ws://localhost:8080/ws
# Health: http://localhost:8080/health
```# Latest deployment Sun Sep 21 08:31:06 AM EDT 2025
