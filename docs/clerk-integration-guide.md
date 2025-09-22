# Clerk Authentication Integration Guide

This guide shows how to properly integrate Clerk authentication in our Next.js + Fastify architecture.

## Backend Configuration

### 1. Environment Variables

Create `.env` file in your backend:

```bash
# Clerk Configuration
CLERK_SECRET_KEY=sk_test_your_secret_key_here
CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here

# Optional: Clerk webhook secret for user events
CLERK_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 2. Backend API Routes with Clerk

```javascript
// src/routes/protected.js
const { getAuth } = require('@clerk/fastify');

// Protected API route
fastify.get('/api/user/profile', {
  preHandler: async (request, reply) => {
    const { userId } = getAuth(request);
    if (!userId) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    request.userId = userId;
  }
}, async (request, reply) => {
  const userProfile = await getUserProfile(request.userId);
  return { user: userProfile };
});

// WebSocket authentication with Clerk token
fastify.register(async function (fastify) {
  fastify.get('/websocket', { websocket: true }, (connection, req) => {
    connection.socket.on('message', async (message) => {
      const data = JSON.parse(message);
      
      if (data.type === 'authenticate') {
        try {
          const { user } = await verifyClerkToken(data.token);
          connection.user = user;
          connection.isAuthenticated = true;
          
          connection.socket.send(JSON.stringify({
            type: 'auth_success',
            user: {
              id: user.id,
              email: user.email,
              name: user.name
            }
          }));
        } catch (error) {
          connection.socket.send(JSON.stringify({
            type: 'auth_error',
            message: 'Authentication failed'
          }));
        }
      }
    });
  });
});
```

### 3. Clerk Token Verification

```javascript
// src/config/clerk.js
const { createClerkClient } = require('@clerk/backend');

const clerkClient = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
});

async function verifyClerkToken(token) {
  try {
    // Verify the token
    const payload = await clerkClient.verifyToken(token);
    
    // Get full user data
    const user = await clerkClient.users.getUser(payload.sub);
    
    return {
      user: {
        id: user.id,
        email: user.emailAddresses[0]?.emailAddress,
        name: user.firstName + ' ' + user.lastName,
        firstName: user.firstName,
        lastName: user.lastName,
        imageUrl: user.imageUrl
      },
      isAuthenticated: true
    };
  } catch (error) {
    throw new Error('Invalid token: ' + error.message);
  }
}

module.exports = { verifyClerkToken, clerkClient };
```

## Frontend Configuration

### 1. Next.js Layout with ClerkProvider

```tsx
// src/app/layout.tsx
import { ClerkProvider } from '@clerk/nextjs';

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <ClerkProvider
      publishableKey={process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
    >
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
```

### 2. Protected API Calls

```tsx
// src/hooks/useAuthenticatedFetch.ts
import { useAuth } from '@clerk/nextjs';

export function useAuthenticatedFetch() {
  const { getToken } = useAuth();

  const authenticatedFetch = async (url: string, options: RequestInit = {}) => {
    const token = await getToken();
    
    return fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
  };

  return { authenticatedFetch };
}
```

### 3. WebSocket with Clerk Authentication

```tsx
// src/hooks/useAuthenticatedWebSocket.ts
import { useAuth, useUser } from '@clerk/nextjs';
import { useEffect, useState } from 'react';

export function useAuthenticatedWebSocket(url: string) {
  const { getToken, isSignedIn } = useAuth();
  const { user } = useUser();
  const [socket, setSocket] = useState<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    if (!isSignedIn) return;

    const connectWebSocket = async () => {
      try {
        const ws = new WebSocket(url);
        
        ws.onopen = async () => {
          console.log('WebSocket connected');
          setIsConnected(true);
          
          // Authenticate with Clerk token
          const token = await getToken();
          if (token) {
            ws.send(JSON.stringify({
              type: 'authenticate',
              token: token
            }));
          }
        };

        ws.onmessage = (event) => {
          const data = JSON.parse(event.data);
          
          if (data.type === 'auth_success') {
            console.log('WebSocket authenticated', data.user);
            setIsAuthenticated(true);
          } else if (data.type === 'auth_error') {
            console.error('WebSocket auth failed', data.message);
            setIsAuthenticated(false);
          }
        };

        ws.onclose = () => {
          console.log('WebSocket disconnected');
          setIsConnected(false);
          setIsAuthenticated(false);
        };

        ws.onerror = (error) => {
          console.error('WebSocket error:', error);
        };

        setSocket(ws);
      } catch (error) {
        console.error('Failed to connect WebSocket:', error);
      }
    };

    connectWebSocket();

    return () => {
      socket?.close();
    };
  }, [isSignedIn, url]);

  const sendMessage = (message: any) => {
    if (socket && isConnected && isAuthenticated) {
      socket.send(JSON.stringify(message));
    } else {
      console.error('WebSocket not ready for sending messages');
    }
  };

  return {
    socket,
    isConnected,
    isAuthenticated,
    sendMessage,
    user
  };
}
```

### 4. Chat Component with Authentication

```tsx
// src/components/AuthenticatedChat.tsx
'use client';

import { useAuthenticatedWebSocket } from '@/hooks/useAuthenticatedWebSocket';
import { SignInButton, useAuth, useUser } from '@clerk/nextjs';
import { useState } from 'react';

export default function AuthenticatedChat() {
  const { isSignedIn } = useAuth();
  const { user } = useUser();
  const [messages, setMessages] = useState<any[]>([]);
  const [inputValue, setInputValue] = useState('');

  const { isConnected, isAuthenticated, sendMessage } = useAuthenticatedWebSocket(
    process.env.NODE_ENV === 'production' 
      ? 'wss://avai-backend-production.onrender.com/websocket'
      : 'ws://localhost:3001/websocket'
  );

  const handleSendMessage = () => {
    if (!inputValue.trim()) return;

    const message = {
      type: 'send_message',
      content: inputValue,
      threadId: 'default',
      messageId: Date.now().toString()
    };

    sendMessage(message);
    
    // Add to local messages
    setMessages(prev => [...prev, {
      id: Date.now(),
      content: inputValue,
      sender: 'user',
      timestamp: new Date().toISOString()
    }]);
    
    setInputValue('');
  };

  if (!isSignedIn) {
    return (
      <div className="flex flex-col items-center justify-center p-8">
        <h2 className="text-xl font-semibold mb-4">Sign in to chat</h2>
        <SignInButton mode="modal">
          <button className="bg-blue-600 text-white px-4 py-2 rounded">
            Sign In
          </button>
        </SignInButton>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-96 border rounded-lg">
      <div className="bg-gray-100 p-4 border-b">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Chat - {user?.firstName} {user?.lastName}</h3>
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`} />
            <span className="text-sm">
              {isAuthenticated ? 'Authenticated' : isConnected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-4 overflow-y-auto">
        {messages.map((message) => (
          <div key={message.id} className="mb-2">
            <div className="font-semibold text-sm">{message.sender}</div>
            <div className="text-gray-700">{message.content}</div>
          </div>
        ))}
      </div>

      <div className="border-t p-4">
        <div className="flex space-x-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
            className="flex-1 border rounded px-3 py-2"
            placeholder="Type your message..."
            disabled={!isAuthenticated}
          />
          <button
            onClick={handleSendMessage}
            disabled={!isAuthenticated || !inputValue.trim()}
            className="bg-blue-600 text-white px-4 py-2 rounded disabled:bg-gray-400"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
```

## Environment Setup

### Frontend (.env.local)
```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

### Backend (.env)
```bash
CLERK_SECRET_KEY=sk_test_your_secret_key_here
CLERK_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

## Testing the Integration

1. **Start backend server**: `npm start`
2. **Start frontend**: `npm run dev`
3. **Sign in** using Clerk authentication
4. **Open browser console** to see WebSocket connection and authentication logs
5. **Send messages** in the chat to test the full flow

## Key Benefits

- ✅ **Secure Authentication**: Uses Clerk's official token verification
- ✅ **Real-time WebSocket**: Authenticated WebSocket connections
- ✅ **User Management**: Full user profile and session management
- ✅ **Production Ready**: Proper error handling and security
- ✅ **TypeScript Support**: Full type safety
- ✅ **Scalable Architecture**: Clean separation of concerns

## Troubleshooting

1. **Token Verification Fails**: Check CLERK_SECRET_KEY is correct
2. **WebSocket Authentication Fails**: Ensure token is passed correctly
3. **CORS Issues**: Update CORS configuration in backend
4. **Environment Variables**: Make sure all keys are set correctly

This integration provides a complete, production-ready authentication system using Clerk's official tools.