const { 
  createThread, 
  getUserThreads, 
  getThreadById, 
  getThreadMessages, 
  archiveThread, 
  pinThread,
  updateThreadActivity
} = require('../database');
const { v4: uuidv4 } = require('uuid');

/**
 * Validate UUID format
 * @param {string} uuid - UUID string to validate
 * @returns {boolean} True if valid UUID
 */
function isValidUUID(uuid) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

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
  
  logger.warn(`Thread operation error: ${code} - ${message}`);
  connection.socket.send(JSON.stringify(errorResponse));
}

/**
 * Handle create thread request
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 */
async function handleCreateThread(connection, message, logger) {
  try {
    const { title, description } = message;
    
    // Validate required fields
    if (!title || typeof title !== 'string' || title.trim().length === 0) {
      sendError(connection, 'INVALID_TITLE', 'Thread title is required and must be non-empty', logger);
      return;
    }
    
    if (title.trim().length > 255) {
      sendError(connection, 'TITLE_TOO_LONG', 'Thread title must be 255 characters or less', logger);
      return;
    }
    
    if (description && typeof description === 'string' && description.length > 1000) {
      sendError(connection, 'DESCRIPTION_TOO_LONG', 'Thread description must be 1000 characters or less', logger);
      return;
    }
    
    // Create thread in database
    const result = await createThread(
      connection.user.id, 
      title, 
      description || null
    );
    
    if (result.error) {
      sendError(connection, 'CREATE_FAILED', result.error, logger);
      return;
    }
    
    // Send success response
    const response = {
      type: 'thread_created',
      thread: {
        id: result.data.id,
        title: result.data.title,
        description: result.data.description,
        created_at: result.data.created_at,
        status: result.data.status,
        is_pinned: result.data.is_pinned,
        message_count: result.data.message_count
      },
      timestamp: new Date().toISOString()
    };
    
    connection.socket.send(JSON.stringify(response));
    logger.info(`Thread created successfully: ${result.data.id} for user: ${connection.user.id}`);
    
  } catch (error) {
    logger.error('Create thread handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Failed to create thread', logger);
  }
}

/**
 * Handle get threads request
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 */
async function handleGetThreads(connection, message, logger) {
  try {
    const { limit = 50 } = message;
    
    // Validate limit
    const parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      sendError(connection, 'INVALID_LIMIT', 'Limit must be a number between 1 and 100', logger);
      return;
    }
    
    // Get user's threads
    const result = await getUserThreads(connection.user.id, parsedLimit);
    
    if (result.error) {
      sendError(connection, 'FETCH_FAILED', result.error, logger);
      return;
    }
    
    // Send threads list
    const response = {
      type: 'threads_list',
      threads: result.data.map(thread => ({
        id: thread.id,
        title: thread.title,
        description: thread.description,
        status: thread.status,
        is_pinned: thread.is_pinned,
        message_count: thread.message_count,
        last_message_at: thread.last_message_at,
        created_at: thread.created_at,
        updated_at: thread.updated_at
      })),
      total: result.data.length,
      timestamp: new Date().toISOString()
    };
    
    connection.socket.send(JSON.stringify(response));
    logger.info(`Sent ${result.data.length} threads to user: ${connection.user.id}`);
    
  } catch (error) {
    logger.error('Get threads handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Failed to fetch threads', logger);
  }
}

/**
 * Handle get thread history request
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 */
async function handleGetHistory(connection, message, logger) {
  try {
    const { thread_id, limit = 100 } = message;
    
    // Validate thread_id
    if (!thread_id || !isValidUUID(thread_id)) {
      sendError(connection, 'INVALID_THREAD_ID', 'Valid thread ID is required', logger);
      return;
    }
    
    // Validate limit
    const parsedLimit = parseInt(limit);
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 500) {
      sendError(connection, 'INVALID_LIMIT', 'Limit must be a number between 1 and 500', logger);
      return;
    }
    
    // Get thread messages with ownership validation
    const result = await getThreadMessages(thread_id, connection.user.id, parsedLimit);
    
    if (result.error) {
      if (result.error.includes('not found') || result.error.includes('access denied')) {
        sendError(connection, 'THREAD_NOT_FOUND', 'Thread not found or access denied', logger);
      } else {
        sendError(connection, 'FETCH_FAILED', result.error, logger);
      }
      return;
    }
    
    // Send thread history
    const response = {
      type: 'thread_history',
      thread_id: thread_id,
      messages: result.data.map(msg => ({
        id: msg.id,
        role: msg.role,
        content: msg.content,
        content_type: msg.content_type,
        token_count: msg.token_count,
        model_used: msg.model_used,
        processing_time_ms: msg.processing_time_ms,
        confidence_score: msg.confidence_score,
        created_at: msg.created_at,
        metadata: msg.metadata
      })),
      total: result.data.length,
      timestamp: new Date().toISOString()
    };
    
    connection.socket.send(JSON.stringify(response));
    logger.info(`Sent ${result.data.length} messages for thread ${thread_id} to user: ${connection.user.id}`);
    
  } catch (error) {
    logger.error('Get history handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Failed to fetch thread history', logger);
  }
}

/**
 * Handle pin/unpin thread request
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 */
async function handlePinThread(connection, message, logger) {
  try {
    const { thread_id, is_pinned } = message;
    
    // Validate thread_id
    if (!thread_id || !isValidUUID(thread_id)) {
      sendError(connection, 'INVALID_THREAD_ID', 'Valid thread ID is required', logger);
      return;
    }
    
    // Validate is_pinned
    if (typeof is_pinned !== 'boolean') {
      sendError(connection, 'INVALID_PIN_STATUS', 'is_pinned must be a boolean value', logger);
      return;
    }
    
    // Pin/unpin thread with ownership validation
    const result = await pinThread(thread_id, connection.user.id, is_pinned);
    
    if (result.error) {
      if (result.error.includes('not found') || result.error.includes('access denied')) {
        sendError(connection, 'THREAD_NOT_FOUND', 'Thread not found or access denied', logger);
      } else {
        sendError(connection, 'UPDATE_FAILED', result.error, logger);
      }
      return;
    }
    
    // Send success response
    const response = {
      type: 'thread_updated',
      thread_id: thread_id,
      is_pinned: result.data.is_pinned,
      updated_at: result.data.updated_at,
      timestamp: new Date().toISOString()
    };
    
    connection.socket.send(JSON.stringify(response));
    logger.info(`Thread ${is_pinned ? 'pinned' : 'unpinned'}: ${thread_id} for user: ${connection.user.id}`);
    
  } catch (error) {
    logger.error('Pin thread handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Failed to update thread pin status', logger);
  }
}

/**
 * Handle archive thread request
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 */
async function handleArchiveThread(connection, message, logger) {
  try {
    const { thread_id } = message;
    
    // Validate thread_id
    if (!thread_id || !isValidUUID(thread_id)) {
      sendError(connection, 'INVALID_THREAD_ID', 'Valid thread ID is required', logger);
      return;
    }
    
    // Archive thread with ownership validation
    const result = await archiveThread(thread_id, connection.user.id);
    
    if (result.error) {
      if (result.error.includes('not found') || result.error.includes('access denied')) {
        sendError(connection, 'THREAD_NOT_FOUND', 'Thread not found or access denied', logger);
      } else {
        sendError(connection, 'ARCHIVE_FAILED', result.error, logger);
      }
      return;
    }
    
    // Send success response
    const response = {
      type: 'thread_archived',
      thread_id: thread_id,
      status: result.data.status,
      updated_at: result.data.updated_at,
      timestamp: new Date().toISOString()
    };
    
    connection.socket.send(JSON.stringify(response));
    logger.info(`Thread archived: ${thread_id} for user: ${connection.user.id}`);
    
  } catch (error) {
    logger.error('Archive thread handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Failed to archive thread', logger);
  }
}

/**
 * Main thread message handler - routes thread-related messages
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} logger - Logger instance
 */
async function handleThreadMessage(connection, message, logger) {
  try {
    // For thread operations, check authentication requirements:
    // - Read operations (get_threads, get_history) allow anonymous users
    // - Write operations (create_thread, pin_thread, archive_thread) require full authentication
    const readOnlyOperations = ['get_threads', 'get_history'];
    const requiresFullAuth = !readOnlyOperations.includes(message.type);
    
    if (requiresFullAuth && !connection.isAuthenticated) {
      connection.socket.send(JSON.stringify({
        type: 'error',
        code: 'AUTHENTICATION_REQUIRED',
        message: 'User must be authenticated for thread operations',
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    // Anonymous users can only read, not create/modify
    if (!connection.isAuthenticated && !readOnlyOperations.includes(message.type)) {
      connection.socket.send(JSON.stringify({
        type: 'error',
        code: 'AUTHENTICATION_REQUIRED',
        message: 'Authentication required for thread modifications',
        timestamp: new Date().toISOString()
      }));
      return;
    }
    
    // Route to appropriate handler based on message type
    switch (message.type) {
      case 'create_thread':
        await handleCreateThread(connection, message, logger);
        break;
        
      case 'get_threads':
        await handleGetThreads(connection, message, logger);
        break;
        
      case 'get_history':
        await handleGetHistory(connection, message, logger);
        break;
        
      case 'pin_thread':
        await handlePinThread(connection, message, logger);
        break;
        
      case 'archive_thread':
        await handleArchiveThread(connection, message, logger);
        break;
        
      default:
        sendError(connection, 'UNKNOWN_THREAD_OPERATION', `Unknown thread operation: ${message.type}`, logger);
    }
    
  } catch (error) {
    logger.error('Thread message handler error:', error);
    sendError(connection, 'INTERNAL_ERROR', 'Internal server error processing thread operation', logger);
  }
}

module.exports = {
  handleThreadMessage,
  handleCreateThread,
  handleGetThreads,
  handleGetHistory,
  handlePinThread,
  handleArchiveThread,
  isValidUUID,
  sendError
};