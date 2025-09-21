/**
 * AI Canister Handler for AVAI WebSocket Backend
 * Handles AI canister authentication and message routing
 */

const { 
  insertMessage, 
  getConversationHistory, 
  updateMessageMetadata,
  incrementThreadMessageCount 
} = require('../database');

// Track AI canister connection
let aiCanisterConnection = null;

/**
 * Send error response to WebSocket connection
 * @param {Object} connection - WebSocket connection object
 * @param {string} code - Error code
 * @param {string} message - Error message
 * @param {Object} logger - Logger instance
 */
function sendError(connection, code, message, logger) {
  const errorResponse = {
    type: 'error',
    code,
    message,
    timestamp: new Date().toISOString()
  };
  
  logger.warn(`AI canister error: ${code} - ${message}`);
  connection.socket.send(JSON.stringify(errorResponse));
}

/**
 * Send success response to WebSocket connection
 * @param {Object} connection - WebSocket connection object
 * @param {string} type - Response type
 * @param {Object} data - Response data
 * @param {Object} logger - Logger instance
 */
function sendSuccess(connection, type, data, logger) {
  const response = {
    type,
    ...data,
    timestamp: new Date().toISOString()
  };
  
  logger.info(`AI canister operation: ${type}`);
  connection.socket.send(JSON.stringify(response));
}

/**
 * Authenticate AI canister connection
 * @param {Object} connection - WebSocket connection object
 * @param {Object} message - Authentication message
 * @param {Object} logger - Logger instance
 */
async function authenticateAICanister(connection, message, logger) {
  try {
    const { service_key, canister_id } = message;
    
    // Validate AI service key
    if (!service_key || service_key !== process.env.AI_SERVICE_KEY) {
      sendError(connection, 'INVALID_SERVICE_KEY', 'Invalid AI service authentication key', logger);
      return false;
    }
    
    // Set connection as AI canister
    connection.isAICanister = true;
    connection.canisterId = canister_id || 'avai-main';
    connection.authenticatedAt = new Date().toISOString();
    
    // Store AI canister connection globally
    aiCanisterConnection = connection;
    
    logger.info(`AI canister authenticated: ${connection.canisterId}`);
    
    // Send authentication success
    sendSuccess(connection, 'ai_auth_success', {
      canister_id: connection.canisterId,
      status: 'authenticated',
      capabilities: ['message_processing', 'response_generation', 'context_analysis']
    }, logger);
    
    return true;
  } catch (error) {
    logger.error('AI canister authentication error:', error);
    sendError(connection, 'AUTH_ERROR', 'Authentication failed', logger);
    return false;
  }
}

/**
 * Forward user message to AI canister for processing
 * @param {string} messageId - Message ID
 * @param {string} threadId - Thread ID
 * @param {string} userId - User ID (nullable)
 * @param {string} content - Message content
 * @param {string} contentType - Content type
 * @param {Object} conversationContext - Conversation context
 * @param {Object} logger - Logger instance
 */
async function forwardMessageToAI(messageId, threadId, userId, content, contentType, conversationContext, logger) {
  try {
    if (!aiCanisterConnection || aiCanisterConnection.socket.readyState !== 1) {
      logger.warn('AI canister not connected - message will be queued');
      return { error: 'AI canister not available' };
    }
    
    // Prepare message for AI processing
    const aiMessage = {
      type: 'process_message',
      message_id: messageId,
      thread_id: threadId,
      user_id: userId,
      content: content,
      content_type: contentType,
      conversation_context: conversationContext,
      timestamp: new Date().toISOString(),
      priority: 'normal'
    };
    
    // Send to AI canister
    aiCanisterConnection.socket.send(JSON.stringify(aiMessage));
    
    logger.info(`Message forwarded to AI canister: ${messageId}`);
    return { success: true };
    
  } catch (error) {
    logger.error('Error forwarding message to AI:', error);
    return { error: error.message };
  }
}

/**
 * Handle AI response from canister
 * @param {Object} connection - AI canister connection
 * @param {Object} message - AI response message
 * @param {Object} logger - Logger instance
 * @param {Map} connections - All WebSocket connections
 */
async function handleAIResponse(connection, message, logger, connections) {
  try {
    const { 
      message_id, 
      thread_id, 
      user_id, 
      response_content, 
      content_type = 'text',
      processing_time_ms,
      confidence_score,
      model_used 
    } = message;
    
    // Validate required fields
    if (!message_id || !thread_id || !response_content) {
      sendError(connection, 'INVALID_AI_RESPONSE', 'Missing required fields in AI response', logger);
      return;
    }
    
    // Save AI response to database
    const aiMessageResult = await insertMessage(
      thread_id,
      null, // AI messages don't have a user_id
      'assistant',
      response_content,
      content_type,
      {
        original_message_id: message_id,
        model_used: model_used,
        processing_time_ms: processing_time_ms,
        confidence_score: confidence_score,
        generated_by: 'avai_canister',
        generated_at: new Date().toISOString()
      }
    );
    
    if (aiMessageResult.error) {
      logger.error('Failed to save AI response:', aiMessageResult.error);
      sendError(connection, 'DATABASE_ERROR', 'Failed to save AI response', logger);
      return;
    }
    
    // Update thread message count
    await incrementThreadMessageCount(thread_id);
    
    // Update original message metadata with AI processing info
    if (message_id) {
      await updateMessageMetadata(message_id, {
        ai_processed: true,
        ai_response_id: aiMessageResult.data.id,
        processing_completed_at: new Date().toISOString(),
        processing_time_ms: processing_time_ms,
        model_used: model_used
      });
    }
    
    // Find user connection and send AI response
    const userConnection = findUserConnectionByThread(thread_id, user_id, connections);
    if (userConnection) {
      const aiResponse = {
        type: 'ai_response',
        message_id: aiMessageResult.data.id,
        thread_id: thread_id,
        content: response_content,
        content_type: content_type,
        model_used: model_used,
        processing_time: processing_time_ms ? `${processing_time_ms}ms` : null,
        confidence_score: confidence_score,
        timestamp: new Date().toISOString()
      };
      
      userConnection.socket.send(JSON.stringify(aiResponse));
      logger.info(`AI response sent to user: ${user_id || 'anonymous'} in thread ${thread_id}`);
    } else {
      logger.warn(`User connection not found for thread ${thread_id}, user ${user_id}`);
    }
    
    // Acknowledge receipt to AI canister
    sendSuccess(connection, 'ai_response_processed', {
      message_id: message_id,
      response_id: aiMessageResult.data.id,
      thread_id: thread_id,
      delivered_to_user: !!userConnection
    }, logger);
    
  } catch (error) {
    logger.error('Handle AI response error:', error);
    sendError(connection, 'PROCESSING_ERROR', 'Failed to process AI response', logger);
  }
}

/**
 * Find user connection by thread and user ID
 * @param {string} threadId - Thread ID
 * @param {string} userId - User ID
 * @param {Map} connections - All WebSocket connections
 * @returns {Object|null} User connection object
 */
function findUserConnectionByThread(threadId, userId, connections) {
  for (const [connectionId, conn] of connections.entries()) {
    if (conn.isAICanister) continue; // Skip AI canister connection
    
    if (userId) {
      // For authenticated users, match by user ID
      if (conn.user && conn.user.id === userId) {
        return conn;
      }
    } else {
      // For anonymous users, we need to track active threads differently
      // This is a simplified approach - in production you might want more sophisticated tracking
      if (conn.user && conn.user.isAnonymous) {
        return conn; // Return first anonymous connection (simplified)
      }
    }
  }
  return null;
}

/**
 * Handle AI canister status update
 * @param {Object} connection - AI canister connection
 * @param {Object} message - Status message
 * @param {Object} logger - Logger instance
 */
async function handleAIStatus(connection, message, logger) {
  try {
    const { status, queue_size, processing_capacity, uptime } = message;
    
    logger.info(`AI canister status: ${status}, queue: ${queue_size}, capacity: ${processing_capacity}`);
    
    // Acknowledge status update
    sendSuccess(connection, 'status_acknowledged', {
      received_at: new Date().toISOString(),
      backend_status: 'operational'
    }, logger);
    
  } catch (error) {
    logger.error('Handle AI status error:', error);
    sendError(connection, 'STATUS_ERROR', 'Failed to process status update', logger);
  }
}

/**
 * Main AI canister message handler
 * @param {Object} connection - WebSocket connection object
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 * @param {Map} connections - All WebSocket connections
 */
async function handleAICanisterMessage(connection, message, logger, connections) {
  try {
    // Route message based on type
    switch (message.type) {
      case 'ai_auth':
        await authenticateAICanister(connection, message, logger);
        break;
        
      case 'ai_response':
        await handleAIResponse(connection, message, logger, connections);
        break;
        
      case 'ai_status':
        await handleAIStatus(connection, message, logger);
        break;
        
      case 'ping':
        sendSuccess(connection, 'pong', { 
          canister_id: connection.canisterId 
        }, logger);
        break;
        
      default:
        sendError(connection, 'UNKNOWN_AI_MESSAGE_TYPE', `Unknown AI message type: ${message.type}`, logger);
    }
    
  } catch (error) {
    logger.error('AI canister message handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Failed to process AI canister message', logger);
  }
}

/**
 * Check if AI canister is connected and available
 * @returns {boolean} True if AI canister is available
 */
function isAICanisterAvailable() {
  return aiCanisterConnection && 
         aiCanisterConnection.socket && 
         aiCanisterConnection.socket.readyState === 1;
}

/**
 * Get AI canister status
 * @returns {Object} AI canister status information
 */
function getAICanisterStatus() {
  return {
    connected: isAICanisterAvailable(),
    canister_id: aiCanisterConnection?.canisterId || null,
    authenticated_at: aiCanisterConnection?.authenticatedAt || null,
    connection_state: aiCanisterConnection?.socket?.readyState || null
  };
}

/**
 * Handle AI canister disconnect
 * @param {Object} logger - Logger instance
 */
function handleAICanisterDisconnect(logger) {
  if (aiCanisterConnection) {
    logger.warn(`AI canister disconnected: ${aiCanisterConnection.canisterId}`);
    aiCanisterConnection = null;
  }
}

module.exports = {
  handleAICanisterMessage,
  authenticateAICanister,
  forwardMessageToAI,
  handleAIResponse,
  isAICanisterAvailable,
  getAICanisterStatus,
  handleAICanisterDisconnect
};