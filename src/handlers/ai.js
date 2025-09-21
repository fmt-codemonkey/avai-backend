/**
 * AI Connection Manager for AVAI WebSocket Backend
 * Manages WebSocket connection to AVAI Canister with reconnection logic
 */

const ReconnectingWebSocket = require('reconnecting-websocket');
const WS = require('ws');
const { v4: uuidv4 } = require('uuid');
const { 
  insertMessage, 
  incrementThreadMessageCount, 
  getThreadById 
} = require('../database');

class AIConnectionManager {
  constructor() {
    this.aiSocket = null;
    this.connectionState = 'disconnected'; // 'connected', 'connecting', 'disconnected', 'error'
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.pendingRequests = new Map(); // Track requests waiting for AI responses
    this.userConnections = new Map(); // Track user WebSocket connections
    this.logger = null;
    this.heartbeatInterval = null;
    this.responseTimeout = 30000; // 30 seconds timeout for AI responses
  }

  /**
   * Set logger instance
   * @param {Object} logger - Logger instance
   */
  setLogger(logger) {
    this.logger = logger;
  }

  /**
   * Set user connections map reference
   * @param {Map} connections - User WebSocket connections
   */
  setUserConnections(connections) {
    this.userConnections = connections;
  }

  /**
   * Log message with fallback to console
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} extra - Extra data
   */
  log(level, message, extra = null) {
    if (this.logger) {
      this.logger[level](message, extra);
    } else {
      console[level === 'error' ? 'error' : 'log'](`[AI] ${message}`, extra);
    }
  }

  /**
   * Connect to AVAI Canister WebSocket
   */
  async connectToAI() {
    try {
      const wsUrl = process.env.AVAI_CANISTER_WS_URL;
      
      if (!wsUrl || wsUrl === 'wss://your-avai-canister-websocket-url') {
        this.log('warn', 'AVAI_CANISTER_WS_URL not configured properly. AI features will be disabled.');
        this.connectionState = 'disabled';
        return false;
      }

      this.log('info', `Connecting to AVAI Canister at ${wsUrl}`);
      this.connectionState = 'connecting';

      // Create ReconnectingWebSocket with options
      const options = {
        WebSocket: WS,
        connectionTimeout: 10000,
        maxRetries: this.maxReconnectAttempts,
        maxReconnectionDelay: 30000,
        minReconnectionDelay: 1000,
        reconnectionDelayGrowFactor: 1.3,
        debug: false
      };

      this.aiSocket = new ReconnectingWebSocket(wsUrl, [], options);

      // Set up event handlers
      this.aiSocket.addEventListener('open', () => {
        this.handleConnectionOpen();
      });

      this.aiSocket.addEventListener('message', (event) => {
        this.handleAIMessage(event);
      });

      this.aiSocket.addEventListener('close', (event) => {
        this.handleConnectionClose(event);
      });

      this.aiSocket.addEventListener('error', (error) => {
        this.handleAIError(error);
      });

      return true;

    } catch (error) {
      this.log('error', 'Failed to initialize AI connection:', error);
      this.connectionState = 'error';
      return false;
    }
  }

  /**
   * Handle successful connection to AI
   */
  handleConnectionOpen() {
    this.log('info', 'Connected to AVAI Canister successfully');
    this.connectionState = 'connected';
    this.reconnectAttempts = 0;
    
    // Start heartbeat
    this.startHeartbeat();
    
    // Process any pending requests
    this.processPendingRequests();
  }

  /**
   * Handle AI WebSocket messages
   * @param {Object} event - WebSocket message event
   */
  handleAIMessage(event) {
    try {
      const message = JSON.parse(event.data);
      this.log('debug', 'Received AI message:', { type: message.type });

      switch (message.type) {
        case 'response':
          this.handleAIResponse(message);
          break;
        case 'error':
          this.handleAIErrorResponse(message);
          break;
        case 'pong':
          this.log('debug', 'Received pong from AI canister');
          break;
        default:
          this.log('warn', `Unknown AI message type: ${message.type}`, message);
      }
    } catch (error) {
      this.log('error', 'Failed to parse AI message:', error);
    }
  }

  /**
   * Handle connection close
   * @param {Object} event - Close event
   */
  handleConnectionClose(event) {
    this.log('warn', `AI connection closed. Code: ${event.code}, Reason: ${event.reason}`);
    this.connectionState = 'disconnected';
    this.stopHeartbeat();
    
    // Fail all pending requests
    this.failPendingRequests('AI connection lost');
  }

  /**
   * Handle AI connection errors
   * @param {Error} error - Error object
   */
  handleAIError(error) {
    this.log('error', 'AI connection error:', error);
    this.connectionState = 'error';
    this.reconnectAttempts++;
    
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.log('error', 'Max reconnection attempts reached. Disabling AI features.');
      this.connectionState = 'disabled';
      this.failPendingRequests('AI service unavailable');
    }
  }

  /**
   * Send conversation context to AI and handle response
   * @param {Object} conversationContext - Formatted conversation context
   * @param {string} userConnectionId - User WebSocket connection ID
   * @param {string} threadId - Thread ID
   * @param {string} userId - User ID
   * @returns {Promise<boolean>} Success status
   */
  async sendToAI(conversationContext, userConnectionId, threadId, userId) {
    try {
      if (this.connectionState !== 'connected') {
        this.log('warn', `Cannot send to AI. Connection state: ${this.connectionState}`);
        this.sendErrorToUser(userConnectionId, threadId, 'AI service temporarily unavailable', 30);
        return false;
      }

      const requestId = uuidv4();
      
      // Prepare AI request
      const aiRequest = {
        type: 'process',
        request_id: requestId,
        conversation_id: threadId,
        user_id: userId,
        timestamp: new Date().toISOString(),
        ...conversationContext
      };

      // Store pending request
      this.pendingRequests.set(requestId, {
        userConnectionId,
        threadId,
        userId,
        timestamp: Date.now(),
        timeoutId: setTimeout(() => {
          this.handleRequestTimeout(requestId);
        }, this.responseTimeout)
      });

      // Send typing indicator to user
      this.sendTypingIndicator(userConnectionId, threadId, true);

      // Send request to AI
      this.aiSocket.send(JSON.stringify(aiRequest));
      
      this.log('info', `Sent conversation to AI. Request ID: ${requestId}, Thread: ${threadId}`);
      return true;

    } catch (error) {
      this.log('error', 'Failed to send to AI:', error);
      this.sendErrorToUser(userConnectionId, threadId, 'Failed to process message', 0);
      return false;
    }
  }

  /**
   * Handle AI response and send to user
   * @param {Object} aiResponse - AI response message
   */
  async handleAIResponse(aiResponse) {
    try {
      const { request_id, conversation_id, response, model_used, confidence_score, processing_time_ms, token_count, metadata } = aiResponse;

      if (!request_id || !this.pendingRequests.has(request_id)) {
        this.log('warn', 'Received AI response for unknown request ID:', request_id);
        return;
      }

      const pendingRequest = this.pendingRequests.get(request_id);
      const { userConnectionId, threadId, userId } = pendingRequest;

      // Clear timeout
      clearTimeout(pendingRequest.timeoutId);
      this.pendingRequests.delete(request_id);

      // Stop typing indicator
      this.sendTypingIndicator(userConnectionId, threadId, false);

      // Validate response
      if (!response || typeof response !== 'string') {
        this.log('error', 'Invalid AI response format:', aiResponse);
        this.sendErrorToUser(userConnectionId, threadId, 'Invalid AI response', 0);
        return;
      }

      // Save AI response to database
      const aiMessageResult = await insertMessage(
        threadId,
        null, // AI messages don't have a user_id
        'assistant',
        response,
        'text',
        {
          model_used: model_used || 'avai-security-v1',
          confidence_score: confidence_score || null,
          processing_time_ms: processing_time_ms || null,
          token_count: token_count || null,
          request_id: request_id,
          ai_metadata: metadata || null,
          generated_by: 'avai_canister',
          generated_at: new Date().toISOString()
        }
      );

      if (aiMessageResult.error) {
        this.log('error', 'Failed to save AI response to database:', aiMessageResult.error);
        this.sendErrorToUser(userConnectionId, threadId, 'Failed to save AI response', 0);
        return;
      }

      // Update thread message count
      await incrementThreadMessageCount(threadId);

      // Send AI response to user
      this.sendAIResponseToUser(userConnectionId, {
        thread_id: threadId,
        message_id: aiMessageResult.data.id,
        content: response,
        model_used: model_used || 'avai-security-v1',
        confidence_score: confidence_score,
        processing_time_ms: processing_time_ms,
        created_at: aiMessageResult.data.created_at
      });

      this.log('info', `AI response processed successfully. Message ID: ${aiMessageResult.data.id}`);

    } catch (error) {
      this.log('error', 'Failed to handle AI response:', error);
      
      // Try to send error to user if we have the connection info
      if (aiResponse.request_id && this.pendingRequests.has(aiResponse.request_id)) {
        const pendingRequest = this.pendingRequests.get(aiResponse.request_id);
        this.sendErrorToUser(pendingRequest.userConnectionId, pendingRequest.threadId, 'Failed to process AI response', 0);
      }
    }
  }

  /**
   * Handle AI error response
   * @param {Object} errorResponse - AI error response
   */
  handleAIErrorResponse(errorResponse) {
    const { request_id, error_message, retry_after } = errorResponse;
    
    if (request_id && this.pendingRequests.has(request_id)) {
      const pendingRequest = this.pendingRequests.get(request_id);
      clearTimeout(pendingRequest.timeoutId);
      this.pendingRequests.delete(request_id);
      
      this.sendTypingIndicator(pendingRequest.userConnectionId, pendingRequest.threadId, false);
      this.sendErrorToUser(
        pendingRequest.userConnectionId, 
        pendingRequest.threadId, 
        error_message || 'AI processing error', 
        retry_after || 0
      );
    }
    
    this.log('warn', 'AI error response:', errorResponse);
  }

  /**
   * Handle request timeout
   * @param {string} requestId - Request ID that timed out
   */
  handleRequestTimeout(requestId) {
    if (this.pendingRequests.has(requestId)) {
      const pendingRequest = this.pendingRequests.get(requestId);
      this.pendingRequests.delete(requestId);
      
      this.sendTypingIndicator(pendingRequest.userConnectionId, pendingRequest.threadId, false);
      this.sendErrorToUser(
        pendingRequest.userConnectionId, 
        pendingRequest.threadId, 
        'AI response timeout - please try again', 
        10
      );
      
      this.log('warn', `AI request timeout. Request ID: ${requestId}`);
    }
  }

  /**
   * Send typing indicator to user
   * @param {string} userConnectionId - User connection ID
   * @param {string} threadId - Thread ID
   * @param {boolean} isTyping - Whether AI is typing
   */
  sendTypingIndicator(userConnectionId, threadId, isTyping) {
    const userConnection = this.findUserConnection(userConnectionId);
    if (userConnection) {
      const message = {
        type: 'ai_typing',
        thread_id: threadId,
        is_typing: isTyping,
        timestamp: new Date().toISOString()
      };
      
      userConnection.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Send AI response to user
   * @param {string} userConnectionId - User connection ID
   * @param {Object} responseData - AI response data
   */
  sendAIResponseToUser(userConnectionId, responseData) {
    const userConnection = this.findUserConnection(userConnectionId);
    if (userConnection) {
      const message = {
        type: 'ai_response',
        ...responseData,
        timestamp: new Date().toISOString()
      };
      
      userConnection.socket.send(JSON.stringify(message));
      this.log('info', `AI response sent to user: ${userConnectionId}`);
    } else {
      this.log('warn', `User connection not found: ${userConnectionId}`);
    }
  }

  /**
   * Send error message to user
   * @param {string} userConnectionId - User connection ID
   * @param {string} threadId - Thread ID
   * @param {string} errorMessage - Error message
   * @param {number} retryAfter - Retry after seconds
   */
  sendErrorToUser(userConnectionId, threadId, errorMessage, retryAfter = 0) {
    const userConnection = this.findUserConnection(userConnectionId);
    if (userConnection) {
      const message = {
        type: 'ai_error',
        thread_id: threadId,
        error: errorMessage,
        retry_after: retryAfter,
        timestamp: new Date().toISOString()
      };
      
      userConnection.socket.send(JSON.stringify(message));
    }
  }

  /**
   * Find user connection by ID
   * @param {string} connectionId - Connection ID
   * @returns {Object|null} User connection object
   */
  findUserConnection(connectionId) {
    return this.userConnections.get(connectionId) || null;
  }

  /**
   * Start heartbeat to keep AI connection alive
   */
  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.connectionState === 'connected' && this.aiSocket) {
        this.aiSocket.send(JSON.stringify({ type: 'ping', timestamp: new Date().toISOString() }));
      }
    }, 30000); // Send ping every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Process pending requests (called after reconnection)
   */
  processPendingRequests() {
    if (this.pendingRequests.size > 0) {
      this.log('info', `Processing ${this.pendingRequests.size} pending AI requests`);
      // For now, we'll fail pending requests on reconnection
      // In production, you might want to retry them
      this.failPendingRequests('Connection restored - please retry your message');
    }
  }

  /**
   * Fail all pending requests
   * @param {string} reason - Failure reason
   */
  failPendingRequests(reason) {
    for (const [requestId, pendingRequest] of this.pendingRequests.entries()) {
      clearTimeout(pendingRequest.timeoutId);
      this.sendTypingIndicator(pendingRequest.userConnectionId, pendingRequest.threadId, false);
      this.sendErrorToUser(pendingRequest.userConnectionId, pendingRequest.threadId, reason, 30);
    }
    this.pendingRequests.clear();
  }

  /**
   * Get current connection state
   * @returns {string} Connection state
   */
  getConnectionState() {
    return this.connectionState;
  }

  /**
   * Check if AI is available for processing
   * @returns {boolean} True if AI is available
   */
  isAvailable() {
    return this.connectionState === 'connected';
  }

  /**
   * Get connection statistics
   * @returns {Object} Connection stats
   */
  getStats() {
    return {
      connectionState: this.connectionState,
      reconnectAttempts: this.reconnectAttempts,
      pendingRequests: this.pendingRequests.size,
      isConnected: this.connectionState === 'connected'
    };
  }

  /**
   * Disconnect from AI canister
   */
  disconnect() {
    this.log('info', 'Disconnecting from AI canister');
    
    this.stopHeartbeat();
    this.failPendingRequests('Service shutting down');
    
    if (this.aiSocket) {
      this.aiSocket.close();
      this.aiSocket = null;
    }
    
    this.connectionState = 'disconnected';
  }
}

module.exports = {
  AIConnectionManager
};