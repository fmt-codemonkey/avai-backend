# AVAI Chat System with AI Canister Integration

## Overview

The AVAI WebSocket backend now features a complete chat message handling system with bidirectional AI canister integration. This system serves as a message broker between frontend users and your AI canister, providing real-time message processing, database persistence, and intelligent routing.

## Architecture

```
Frontend Users <---> AVAI WebSocket Backend <---> AI Canister
                            |
                            v
                     Supabase Database
```

### Core Components

1. **WebSocket Server** (`src/server.js`)
   - Handles client connections and authentication
   - Routes messages to appropriate handlers
   - Manages rate limiting and validation
   - Coordinates between users and AI canister

2. **Chat Handler** (`src/handlers/chat.js`)
   - Processes user messages and typing indicators
   - Validates and sanitizes message content
   - Saves messages to database
   - Builds conversation context for AI processing

3. **AI Canister Handler** (`src/handlers/ai-canister.js`)
   - Manages AI canister authentication
   - Forwards user messages to AI canister
   - Processes AI responses and saves to database
   - Routes AI responses back to users

4. **Database Functions** (`src/database.js`)
   - Message CRUD operations
   - Conversation history management
   - Thread ownership validation
   - Token estimation and metadata handling

## AI Canister Integration Flow

### 1. AI Canister Connection & Authentication

Your AI canister connects to the WebSocket backend and authenticates:

```javascript
// AI Canister connects to: wss://websocket.avai.life/ws
const message = {
  type: 'ai_auth',
  service_key: 'avai_canister_2025_secure_key_x9k2p8w7q5m3n1',
  canister_id: 'your-canister-id'
};
```

**Backend Response:**
```javascript
{
  type: 'ai_auth_success',
  canister_id: 'your-canister-id',
  status: 'authenticated',
  capabilities: ['message_processing', 'response_generation', 'context_analysis'],
  timestamp: '2025-01-22T12:00:00.000Z'
}
```

### 2. User Message Processing

When a user sends a message:

1. **User sends message** → WebSocket backend
2. **Backend validates** and saves message to database
3. **Backend builds conversation context** (recent messages + system prompt)
4. **Backend forwards to AI canister**:

```javascript
{
  type: 'process_message',
  message_id: 'user_msg_12345',
  thread_id: 'thread_67890',
  user_id: 'user_abc123',
  content: 'Hello AI, can you help me?',
  content_type: 'text',
  conversation_context: [
    {
      role: 'system',
      content: 'You are AVAI, an advanced AI assistant...',
      content_type: 'text',
      timestamp: '2025-01-22T12:00:00.000Z'
    },
    {
      role: 'user',
      content: 'Previous message...',
      content_type: 'text',
      timestamp: '2025-01-22T11:59:00.000Z'
    },
    {
      role: 'user',
      content: 'Hello AI, can you help me?',
      content_type: 'text',
      timestamp: '2025-01-22T12:00:00.000Z'
    }
  ],
  timestamp: '2025-01-22T12:00:00.000Z',
  priority: 'normal'
}
```

### 3. AI Response Handling

Your AI canister processes the message and responds:

```javascript
{
  type: 'ai_response',
  message_id: 'user_msg_12345',           // Original user message ID
  thread_id: 'thread_67890',
  user_id: 'user_abc123',
  response_content: 'Hello! I\'d be happy to help you...',
  content_type: 'text',
  processing_time_ms: 1500,
  confidence_score: 0.95,
  model_used: 'avai-model-v1'
}
```

**Backend processes AI response:**
1. Saves AI response to database
2. Updates original message with processing metadata
3. Finds user connection and forwards response
4. Acknowledges receipt to AI canister

### 4. Status Updates & Health Checks

Your AI canister can send periodic status updates:

```javascript
{
  type: 'ai_status',
  status: 'operational',
  queue_size: 3,
  processing_capacity: 10,
  uptime: '2h 15m'
}
```

## Message Types

### From Frontend Users

| Type | Description | Required Fields |
|------|-------------|----------------|
| `send_message` | Send chat message | `thread_id`, `content` |
| `typing` | Typing indicator | `thread_id`, `typing` |

### AI Canister Messages

| Type | Description | Required Fields |
|------|-------------|----------------|
| `ai_auth` | Authenticate canister | `service_key`, `canister_id` |
| `ai_response` | Process user response | `message_id`, `thread_id`, `response_content` |
| `ai_status` | Status update | `status` |
| `ping` | Health check | - |

## Database Schema

### Messages Table
```sql
messages (
  id UUID PRIMARY KEY,
  thread_id UUID REFERENCES threads(id),
  user_id UUID REFERENCES users(id) NULL, -- NULL for AI messages
  role TEXT NOT NULL, -- 'user' or 'assistant'
  content TEXT NOT NULL,
  content_type TEXT DEFAULT 'text',
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
)
```

### Key Metadata Fields
- `client_message_id`: Original client message ID
- `ai_processed`: Whether message was processed by AI
- `ai_response_id`: ID of corresponding AI response
- `processing_time_ms`: AI processing time
- `model_used`: AI model that generated response
- `generated_by`: Source system ('avai_canister')

## Rate Limiting

- **General messages**: 100 messages per minute per connection
- **Chat messages**: 60 messages per minute per connection (stricter)
- **Message size limit**: 10KB per message

## Error Handling

Common error codes:
- `INVALID_SERVICE_KEY`: AI canister authentication failed
- `INVALID_MESSAGE_CONTENT`: Message validation failed
- `THREAD_ACCESS_DENIED`: User doesn't own thread
- `CHAT_RATE_LIMIT_EXCEEDED`: Too many messages
- `AI_CANISTER_UNAVAILABLE`: AI service not connected

## Testing

### Run AI Canister Integration Tests
```bash
node test-ai-canister.js
```

### Run Chat Message Tests
```bash
node test-chat-messages.js
```

### Manual Testing
1. Start server: `npm start`
2. Connect your AI canister to `ws://localhost:8080/ws`
3. Authenticate with service key
4. Connect frontend user and send messages
5. Verify AI responses are forwarded correctly

## Environment Variables

Required in `.env`:
```
AI_SERVICE_KEY=avai_canister_2025_secure_key_x9k2p8w7q5m3n1
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_key
CLERK_PUBLISHABLE_KEY=your_clerk_key
```

## Production Considerations

1. **Security**: Change AI_SERVICE_KEY in production
2. **Scaling**: Consider load balancing for multiple AI canisters
3. **Monitoring**: Add comprehensive logging and metrics
4. **Backup**: Ensure message persistence and backup strategies
5. **Rate Limiting**: Adjust limits based on usage patterns

## WebSocket Endpoints

- **Production**: `wss://websocket.avai.life/ws`
- **Development**: `ws://localhost:8080/ws`
- **Health Check**: `http://localhost:8080/health`

## Next Steps

Your AI canister should:
1. Connect to the WebSocket endpoint
2. Authenticate using the service key
3. Listen for `process_message` events
4. Respond with `ai_response` messages
5. Send periodic `ai_status` updates
6. Handle connection errors and reconnection

The backend is now fully equipped to serve as your message broker between users and the AI canister!