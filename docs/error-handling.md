# AVAI WebSocket Backend - Error Handling & Validation System

## Overview

This document describes the comprehensive error handling, logging, validation, and security system implemented for the AVAI WebSocket backend. The system provides production-ready error management with graceful degradation, structured logging, input validation, rate limiting, and security threat detection.

## Architecture

### Core Components

1. **Logger (`src/utils/logger.js`)** - Structured logging with metadata
2. **Validator (`src/utils/validation.js`)** - Input validation and sanitization
3. **Error Handler (`src/utils/errorHandler.js`)** - Centralized error processing
4. **Rate Limiter (`src/utils/rateLimiter.js`)** - Request rate limiting

### Error Flow

```text
Incoming Request/Message
         ↓
   Input Validation
         ↓
   Security Checks
         ↓
    Rate Limiting
         ↓
   Business Logic
         ↓ (if error)
  Error Classification
         ↓
   Error Formatting
         ↓
   Response Sending
         ↓
      Logging
```

## Error Types & Classification

### Error Categories

| Error Type | HTTP Code | Retryable | Description |
|------------|-----------|-----------|-------------|
| `VALIDATION_ERROR` | 400 | No | Invalid input data |
| `AUTHENTICATION_ERROR` | 401 | No | Authentication failed |
| `AUTHORIZATION_ERROR` | 403 | No | Access denied |
| `RATE_LIMIT_ERROR` | 429 | Yes | Rate limit exceeded |
| `DATABASE_ERROR` | 500 | Yes | Database operation failed |
| `AI_CONNECTION_ERROR` | 503 | Yes | AI service unavailable |
| `WEBSOCKET_ERROR` | 500 | No | WebSocket operation failed |
| `INTERNAL_ERROR` | 500 | No | Internal server error |
| `NETWORK_ERROR` | 503 | Yes | Network connectivity issue |
| `TIMEOUT_ERROR` | 504 | Yes | Operation timeout |

### Error Response Format

```json
{
  "success": false,
  "error": {
    "type": "VALIDATION_ERROR",
    "message": "Input validation failed",
    "requestId": "req_1234567890_abc123def",
    "timestamp": "2024-01-15T10:30:00.000Z",
    "retryable": false,
    "details": {
      "validationErrors": ["field 'content' is required"],
      "field": "content"
    }
  },
  "messageId": "msg_456789"
}
```

## Logging System

### Log Levels

- **ERROR**: Critical errors requiring immediate attention
- **WARN**: Warning conditions that should be monitored
- **INFO**: General operational information
- **DEBUG**: Detailed debugging information

### Log Categories

1. **WebSocket Events**: Connection lifecycle, message processing
2. **Database Operations**: CRUD operations, performance metrics
3. **AI Interactions**: AI service communication, response handling
4. **Authentication**: Login attempts, session management
5. **Rate Limiting**: Request throttling, limit enforcement
6. **Validation**: Input validation results, security threats

### Log Output Locations

- **Console**: Development environment with colors
- **Files**: Production environment with rotation
  - `logs/YYYY-MM-DD.log` - General application logs
  - `logs/YYYY-MM-DD-errors.log` - Error-only logs

### Sample Log Entry

```json
{
  "timestamp": "2024-01-15T10:30:00.000Z",
  "level": "info",
  "message": "WebSocket event",
  "pid": 12345,
  "hostname": "server-01",
  "metadata": {
    "event": "message_received",
    "connectionId": "conn_abc123",
    "userId": "usr_xyz789",
    "messageType": "send_message",
    "dataSize": 256
  }
}
```

## Validation System

### Message Validation

All incoming WebSocket messages undergo comprehensive validation:

1. **Structure Validation**: JSON format, required fields
2. **Type Validation**: Message type whitelist
3. **Content Validation**: Field-specific rules
4. **Security Validation**: XSS, injection prevention
5. **Size Validation**: Message size limits

### Supported Message Types

- `authenticate` - User authentication
- `heartbeat` - Connection keepalive
- `send_message` - Chat message sending
- `typing_indicator` - Typing status
- `create_thread` - Thread creation
- `get_threads` - Thread listing
- `get_thread_messages` - Message history
- `delete_thread` - Thread deletion
- `update_thread_title` - Thread title update

### Validation Rules

```javascript
// Example validation for send_message
{
  type: "send_message",          // Required, must be valid type
  threadId: "uuid-v4",          // Required, valid UUID
  content: "string",            // Required, 1-5000 chars
  content_type: "text",         // Optional, enum: text|markdown|code|json
  messageId: "uuid-v4"          // Optional, for correlation
}
```

### Security Checks

- **XSS Prevention**: Script tag detection, event handler removal
- **SQL Injection**: Pattern detection for SQL keywords
- **Command Injection**: Shell command pattern detection
- **Content Sanitization**: HTML encoding, character filtering

## Rate Limiting

### Rate Limit Tiers

| Operation | Anonymous Limit | Authenticated Limit | Window |
|-----------|----------------|-------------------|---------|
| General Messages | 20/min | 60/min | 1 minute |
| Send Message | 15/min | 30/min | 1 minute |
| Create Thread | 5/min | 10/min | 1 minute |
| Authentication | 5 attempts | 5 attempts | 15 minutes |
| AI Interactions | 10/min | 20/min | 1 minute |
| Database Operations | 50/min | 100/min | 1 minute |

### Rate Limit Response

```json
{
  "success": false,
  "error": {
    "type": "RATE_LIMIT_ERROR",
    "message": "Rate limit exceeded",
    "details": {
      "limit": 30,
      "windowMs": 60000,
      "retryAfter": 45
    }
  }
}
```

## Error Recovery & Retry Logic

### Retry Strategy

- **Exponential Backoff**: Base delay × 2^(attempt-1)
- **Maximum Retries**: 3 attempts for retryable errors
- **Maximum Delay**: 30 seconds between attempts
- **Jitter**: Random delay variation to prevent thundering herd

### Retryable Operations

1. Database connections and queries
2. AI service communication
3. External API calls
4. File system operations

### Example Retry Implementation

```javascript
const result = await errorHandler.executeWithRetry(
  () => databaseOperation(),
  { operation: 'user_lookup', userId: 'usr_123' },
  3,  // max retries
  1000 // base delay ms
);
```

## Performance Monitoring

### Metrics Tracked

- **Connection Metrics**: Active connections, connection duration
- **Message Metrics**: Messages per second, processing time
- **Error Metrics**: Error rates by type, error recovery success
- **Database Metrics**: Query performance, connection pool status
- **AI Metrics**: Response times, availability percentage

### Health Check Endpoint

`GET /health` returns comprehensive system status:

```json
{
  "status": "ok",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "version": "1.0.0",
  "environment": "production",
  "database": "connected",
  "ai": {
    "connected": true,
    "connectionCount": 1
  },
  "uptime": 86400,
  "activeConnections": 42,
  "rateLimiter": {
    "activeWindows": 156,
    "totalRequests": 5432
  },
  "memory": {
    "rss": 134217728,
    "heapTotal": 67108864,
    "heapUsed": 45088768
  }
}
```

## Configuration

### Environment Variables

```bash
# Logging
LOG_LEVEL=info                    # error|warn|info|debug
NODE_ENV=production              # development|production

# Rate Limiting
RATE_LIMIT_DEFAULT_MAX=60        # Requests per window
RATE_LIMIT_DEFAULT_WINDOW_MS=60000 # Window duration
RATE_LIMIT_ANONYMOUS_MAX=20      # Anonymous user limit

# Message Limits
MAX_MESSAGE_LENGTH=5000          # Characters
MAX_MESSAGE_SIZE=10240           # Bytes
MAX_THREAD_TITLE_LENGTH=200      # Characters

# Connection Settings
CONNECTION_TIMEOUT=1800000       # 30 minutes in ms
```

### Runtime Configuration

Rate limits and validation rules can be configured via environment variables or configuration files without code changes.

## Security Features

### Input Sanitization

- HTML tag removal and encoding
- JavaScript event handler removal
- URL protocol validation
- Control character filtering

### Security Threat Detection

- Cross-Site Scripting (XSS) patterns
- SQL injection attempts
- Command injection patterns
- Malicious file uploads

### Connection Security

- Rate limiting per connection
- Connection timeout enforcement
- Maximum error threshold per connection
- Graceful connection termination

## Testing

### Error Handling Test Suite

Run comprehensive tests with:

```bash
node tests/error-handling-test.js ws://localhost:8080/ws
```

### Test Coverage

- ✅ Connection establishment
- ✅ Invalid JSON handling
- ✅ Message validation
- ✅ Rate limiting enforcement
- ✅ Authentication errors
- ✅ Security threat detection
- ✅ Large message rejection
- ✅ Error recovery mechanisms

## Deployment Considerations

### Production Setup

1. **Log Management**: Configure log rotation and centralized logging
2. **Monitoring**: Set up alerts for error rates and performance metrics
3. **Rate Limiting**: Adjust limits based on expected traffic
4. **Database**: Configure connection pooling and timeouts
5. **AI Service**: Set up health checks and failover strategies

### Scaling Considerations

- Rate limiting state is in-memory (consider Redis for multi-instance)
- Log files should be rotated and archived
- Database connection pools should be sized appropriately
- AI service should have multiple endpoints for failover

## API Reference

### Logger Methods

```javascript
logger.error(message, metadata)      // Error level logging
logger.warn(message, metadata)       // Warning level logging
logger.info(message, metadata)       // Info level logging
logger.debug(message, metadata)      // Debug level logging

// Specialized logging
logger.logWebSocketEvent(event, connectionId, userId, data)
logger.logDatabaseOperation(operation, table, userId, success, duration, metadata)
logger.logAIInteraction(action, threadId, userId, success, processingTime, metadata)
logger.logAuthentication(success, userId, connectionId, error, metadata)
```

### Error Handler Methods

```javascript
errorHandler.createError(type, message, details, originalError)
errorHandler.handleValidationError(errors, context)
errorHandler.handleAuthenticationError(reason, context)
errorHandler.handleDatabaseError(dbError, operation, context)
errorHandler.sendErrorResponse(ws, error, messageId)
errorHandler.executeWithRetry(operation, context, maxRetries, baseDelay)
```

### Validator Methods

```javascript
validator.validateMessage(message)
validator.validateUUID(uuid)
validator.sanitizeString(str)
validator.checkSecurityThreats(text)
validator.validateUserInput(data, requiredFields, fieldTypes)
```

### Rate Limiter Methods

```javascript
rateLimiter.checkWebSocketMessage(userId, connectionId, messageType, isAnonymous)
rateLimiter.checkAuthenticationLimit(identifier, success)
rateLimiter.recordAIInteraction(userId, connectionId, success, isAnonymous)
rateLimiter.getStatus(identifier, operation, isAnonymous)
```

## Best Practices

### Error Handling

1. Always use structured error objects
2. Include correlation IDs for request tracking
3. Log errors with sufficient context
4. Provide actionable error messages
5. Implement graceful degradation

### Logging

1. Use appropriate log levels
2. Include relevant metadata
3. Avoid logging sensitive information
4. Use structured logging format
5. Monitor log volume and performance

### Validation

1. Validate all input at boundaries
2. Sanitize data before processing
3. Use whitelist approach for validation
4. Implement security threat detection
5. Provide clear validation error messages

### Performance

1. Use async/await for non-blocking operations
2. Implement connection pooling
3. Cache validation results where appropriate
4. Monitor resource usage
5. Implement circuit breakers for external services

This comprehensive error handling system ensures the AVAI WebSocket backend is production-ready with robust error management, security, and observability.
