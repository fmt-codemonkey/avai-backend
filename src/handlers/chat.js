/**
 * Chat Message Handler for AVAI WebSocket Backend
 * Handles user chat messages, validation, persistence, and AI preparation
 */

const { 
  insertMessage, 
  getConversationHistory, 
  incrementThreadMessageCount, 
  validateThreadOwnership,
  getThreadById,
  estimateTokenCount 
} = require('../database');
const { v4: uuidv4 } = require('uuid');

// Import error handling utilities
const logger = require('../utils/logger');
const validator = require('../utils/validation');
const errorHandler = require('../utils/errorHandler');
const rateLimiter = require('../utils/rateLimiter');

// Import security modules
const securityValidator = require('../security/validator');
const securityRateLimiter = require('../security/rateLimiter');

/**
 * Send success response to WebSocket connection
 * @param {Object} connection - WebSocket connection object
 * @param {string} type - Response type
 * @param {Object} data - Response data
 * @param {string} messageId - Original message ID for correlation
 */
function sendSuccess(connection, type, data, messageId = null) {
  try {
    const response = {
      type,
      success: true,
      ...data,
      timestamp: new Date().toISOString()
    };
    
    if (messageId) {
      response.messageId = messageId;
    }
    
    connection.socket.send(JSON.stringify(response));
    
    logger.debug('Chat response sent', {
      responseType: type,
      connectionId: connection.id,
      userId: connection.user?.id,
      messageId
    });
  } catch (sendError) {
    logger.error('Failed to send success response', {
      connectionId: connection.id,
      userId: connection.user?.id,
      error: sendError.message,
      responseType: type
    });
  }
}

/**
 * Validate message content and structure
 * @param {Object} message - Message object to validate
 * @param {Object} connection - Connection object for context
 * @returns {Object} Validation result with success status and details
 */
function validateMessageContent(message, connection) {
  try {
    // Enhanced security validation for chat messages
    const securityValidation = securityValidator.validateChatMessage(message);
    
    if (!securityValidation.isValid) {
      logger.logSecurity('chat_message_security_violation', {
        connectionId: connection.id,
        userId: connection.user?.id,
        ip: connection.ip,
        threats: securityValidation.threats,
        riskLevel: securityValidation.riskLevel,
        messageType: message.type
      });
      
      return {
        valid: false,
        errors: securityValidation.threats.map(t => t.description),
        sanitized: null,
        securityThreats: securityValidation.threats,
        riskLevel: securityValidation.riskLevel
      };
    }
    
    // Use sanitized message from security validation
    const sanitizedMessage = securityValidation.sanitizedData;
    
    // Legacy validation for backward compatibility
    const messageValidation = validator.validateMessage(sanitizedMessage);
    if (!messageValidation.success) {
      return { 
        valid: false, 
        errors: messageValidation.errors,
        sanitized: null
      };
    }
    
    // Additional chat-specific validation
    const { threadId, content, content_type = 'text' } = messageValidation.sanitized;
    const errors = [];
    
    // Validate content type
    const validContentTypes = ['text', 'markdown', 'code', 'json'];
    if (content_type && !validContentTypes.includes(content_type)) {
      errors.push(`content_type must be one of: ${validContentTypes.join(', ')}`);
    }
    
    // Legacy security check (secondary validation)
    const legacySecurityCheck = validator.checkSecurityThreats(content);
    if (!legacySecurityCheck.safe) {
      logger.warn('Legacy security threat detected in message content', {
        connectionId: connection.id,
        userId: connection.user?.id,
        threats: legacySecurityCheck.threats,
        threadId
      });
      errors.push('Message contains potentially harmful content');
    }
    
    return {
      valid: errors.length === 0,
      errors,
      sanitized: messageValidation.sanitized,
      securityThreats: securityCheck.threats
    };
    
  } catch (validationError) {
    logger.error('Message validation error', {
      connectionId: connection.id,
      userId: connection.user?.id,
      error: validationError.message,
      message: message
    });
    
    return {
      valid: false,
      errors: ['Message validation failed'],
      sanitized: null
    };
  }
}

/**
 * Build conversation context for AI processing
 * @param {string} threadId - Thread ID
 * @param {string} userId - User ID (optional)
 * @param {number} contextLimit - Maximum number of messages to include
 * @returns {Promise<Object>} Conversation context object formatted for AVAI Canister
 */
async function buildConversationContext(threadId, userId = null, contextLimit = 20) {
  const timer = logger.createTimer('build_conversation_context');
  
  try {
    logger.debug('Building conversation context', {
      threadId,
      userId,
      contextLimit
    });
    
    // Get recent conversation history with error handling
    const historyResult = await errorHandler.executeWithRetry(
      () => getConversationHistory(threadId, contextLimit),
      { operation: 'get_conversation_history', threadId, userId },
      2,
      1000
    );
    
    if (historyResult.error) {
      logger.error('Failed to get conversation history', {
        threadId,
        userId,
        error: historyResult.error
      });
      timer.end({ success: false, error: 'history_fetch_failed' });
      return { error: historyResult.error };
    }
    
    const messages = historyResult.data || [];
    
    // Get thread information for context
    const threadResult = await errorHandler.executeWithRetry(
      () => getThreadById(threadId),
      { operation: 'get_thread_by_id', threadId, userId },
      2,
      1000
    );
    
    const threadTitle = threadResult.data?.title || 'Conversation';
    
    // Format messages for AVAI Canister API
    const formattedMessages = messages.map(msg => ({
      role: msg.role,
      content: validator.sanitizeString(msg.content), // Sanitize content
      timestamp: msg.created_at
    }));
    
    // AVAI system prompt - security-focused AI assistant
    const systemPrompt = `You are AVAI, a security-focused AI assistant specialized in code analysis, vulnerability detection, and cybersecurity best practices. You provide detailed, actionable security advice.

Core capabilities:
- Code security analysis and vulnerability detection
- Cybersecurity best practices and recommendations
- Threat modeling and risk assessment
- Secure coding guidelines and patterns
- Infrastructure security analysis
- Privacy and compliance guidance

Communication style:
- Be conversational yet professional
- Provide detailed explanations with actionable steps
- Use code examples when relevant
- Ask clarifying questions to better understand security context
- Format responses with markdown for clarity
- Prioritize security implications in all recommendations

Current conversation context:
- Thread: ${validator.sanitizeString(threadTitle)}
- Messages in context: ${messages.length}
- User engagement: ${userId ? 'authenticated' : 'anonymous'}`;

    // Calculate token estimates
    const contentForTokens = [systemPrompt, ...formattedMessages.map(m => m.content)].join(' ');
    const estimatedTokens = estimateTokenCount(contentForTokens);
    
    // Build context in AVAI Canister format
    const conversationContext = {
      conversation_id: threadId,
      user_id: userId,
      system_prompt: systemPrompt,
      messages: formattedMessages,
      context_metadata: {
        thread_title: threadTitle,
        user_tier: "free", // Default tier
        timestamp: new Date().toISOString(),
        message_count: messages.length,
        estimated_tokens: estimatedTokens
      }
    };
    
    logger.debug('Conversation context built successfully', {
      threadId,
      userId,
      messageCount: messages.length,
      estimatedTokens,
      contextSize: JSON.stringify(conversationContext).length
    });
    
    timer.end({ 
      success: true, 
      messageCount: messages.length, 
      estimatedTokens 
    });
    
    return { 
      conversationContext,
      message_count: messages.length,
      estimated_tokens: estimatedTokens
    };
    
  } catch (error) {
    logger.error('Failed to build conversation context', {
      threadId,
      userId,
      error: error.message,
      stack: error.stack
    });
    
    timer.end({ success: false, error: error.message });
    return { error: error.message };
  }
}

/**
 * Handle send_message WebSocket messages
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Object} aiManager - AI Connection Manager instance (optional)
 * @param {string} connectionId - WebSocket connection ID for AI responses
 */
async function handleSendMessage(connection, message, aiManager = null, connectionId = null) {
  const timer = logger.createTimer('handle_send_message');
  const messageId = message.messageId || uuidv4();
  
  try {
    logger.logWebSocketEvent('send_message_start', connectionId, connection.user?.id, {
      threadId: message.threadId,
      hasContent: !!message.content,
      contentLength: message.content?.length || 0
    });
    
    // Enhanced rate limiting for chat messages
    const rateLimitContext = {
      userId: connection.user?.id,
      connectionId: connectionId,
      ip: connection.ip,
      isAuthenticated: connection.isAuthenticated
    };
    
    const securityRateLimit = securityRateLimiter.checkRateLimit('message', rateLimitContext);
    
    if (!securityRateLimit.allowed) {
      logger.logSecurity('chat_message_rate_limited', {
        connectionId,
        userId: connection.user?.id,
        ip: connection.ip,
        reason: securityRateLimit.reason
      });
      
      const rateLimitError = {
        type: 'error',
        error_type: 'RATE_LIMIT',
        message: 'Chat message rate limit exceeded',
        retry_after: Math.ceil(securityRateLimit.resetIn / 1000),
        timestamp: new Date().toISOString(),
        messageId
      };
      
      connection.socket.send(JSON.stringify(rateLimitError));
      timer.end({ success: false, error: 'security_rate_limited' });
      return;
    }
    
    // Legacy AI interaction rate limit (secondary check)
    const aiRateLimit = rateLimiter.checkAIInteractionLimit(
      connection.user?.id,
      connectionId,
      connection.isAnonymous
    );
    
    if (!aiRateLimit.allowed) {
      errorHandler.sendErrorResponse(connection.socket, aiRateLimit.error, messageId);
      timer.end({ success: false, error: 'ai_rate_limited' });
      return;
    }
    
    // Validate message content
    const validation = validateMessageContent(message, connection);
    if (!validation.valid) {
      const error = errorHandler.handleValidationError(validation.errors, {
        connectionId,
        userId: connection.user?.id,
        messageType: message.type,
        securityThreats: validation.securityThreats
      });
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'validation_failed' });
      return;
    }
    
    const { threadId, content, content_type = 'text' } = validation.sanitized;
    const userId = connection.user ? (connection.user.isAnonymous ? null : connection.user.id) : null;
    
    // Validate thread ownership with error handling
    if (userId) {
      try {
        const ownershipResult = await errorHandler.executeWithRetry(
          () => validateThreadOwnership(threadId, userId),
          { operation: 'validate_thread_ownership', threadId, userId },
          2,
          1000
        );
        
        if (ownershipResult.error) {
          const error = errorHandler.handleAuthorizationError('thread', 'access', {
            connectionId,
            userId,
            threadId,
            reason: ownershipResult.error
          });
          errorHandler.sendErrorResponse(connection.socket, error, messageId);
          timer.end({ success: false, error: 'access_denied' });
          return;
        }
      } catch (ownershipError) {
        const error = errorHandler.handleDatabaseError(ownershipError, 'validate_thread_ownership', {
          connectionId,
          userId,
          threadId
        });
        errorHandler.sendErrorResponse(connection.socket, error, messageId);
        timer.end({ success: false, error: 'ownership_check_failed' });
        return;
      }
    }
    
    // Check if thread exists
    try {
      const threadResult = await errorHandler.executeWithRetry(
        () => getThreadById(threadId),
        { operation: 'get_thread_by_id', threadId, userId },
        2,
        1000
      );
      
      if (threadResult.error) {
        const error = errorHandler.handleValidationError(['Thread does not exist'], {
          connectionId,
          userId,
          threadId
        });
        errorHandler.sendErrorResponse(connection.socket, error, messageId);
        timer.end({ success: false, error: 'thread_not_found' });
        return;
      }
    } catch (threadError) {
      const error = errorHandler.handleDatabaseError(threadError, 'get_thread_by_id', {
        connectionId,
        userId,
        threadId
      });
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'thread_check_failed' });
      return;
    }
    
    // Save user message to database with error handling
    let messageResult;
    try {
      messageResult = await errorHandler.executeWithRetry(
        () => insertMessage(
          threadId,
          userId,
          'user',
          content,
          content_type,
          {
            client_message_id: messageId,
            user_agent: connection.userAgent || 'unknown',
            ip_address: connection.remoteAddress || 'unknown',
            estimated_tokens: estimateTokenCount(content)
          }
        ),
        { operation: 'insert_message', threadId, userId },
        3,
        1000
      );
      
      if (messageResult.error) {
        throw new Error(`Database operation failed: ${messageResult.error}`);
      }
      
      // Log successful database operation
      logger.logDatabaseOperation('insert_message', 'messages', userId, true, timer.end(), {
        connectionId,
        threadId,
        messageId: messageResult.data.id
      });
      
    } catch (saveError) {
      const error = errorHandler.handleDatabaseError(saveError, 'insert_message', {
        connectionId,
        userId,
        threadId,
        table: 'messages'
      });
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'message_save_failed' });
      return;
    }
    
    // Update thread message count
    try {
      await errorHandler.executeWithRetry(
        () => incrementThreadMessageCount(threadId),
        { operation: 'increment_thread_message_count', threadId, userId },
        2,
        1000
      );
    } catch (countError) {
      logger.warn('Failed to update thread message count', {
        connectionId,
        userId,
        threadId,
        error: countError.message
      });
      // Non-critical error, continue processing
    }
    
    // Send confirmation to user
    sendSuccess(connection, 'message_sent', {
      message_id: messageResult.data.id,
      thread_id: threadId,
      content: content,
      content_type: content_type,
      saved_at: messageResult.data.created_at
    }, messageId);
    
    // Process with AI if available
    if (aiManager && aiManager.isAvailable && aiManager.isAvailable() && connectionId) {
      try {
        // Record AI interaction attempt
        rateLimiter.recordAIInteraction(userId, connectionId, true, connection.isAnonymous);
        
        // Build conversation context for AI (including the just-saved message)
        const contextResult = await buildConversationContext(threadId, userId);
        
        if (contextResult.error) {
          logger.warn('Failed to build conversation context', {
            connectionId,
            userId,
            threadId,
            error: contextResult.error
          });
          
          const error = errorHandler.handleInternalError(
            new Error(contextResult.error),
            'build_conversation_context',
            { connectionId, userId, threadId }
          );
          errorHandler.sendErrorResponse(connection.socket, error, messageId);
          timer.end({ success: false, error: 'context_build_failed' });
          return;
        }
        
        // Log AI interaction start
        logger.logAIInteraction('context_send', threadId, userId, true, null, {
          connectionId,
          messageCount: contextResult.message_count,
          estimatedTokens: contextResult.estimated_tokens
        });
        
        // Send context to AI for processing
        const aiSuccess = await aiManager.sendToAI(
          contextResult.conversationContext,
          connectionId,
          threadId,
          userId
        );
        
        if (!aiSuccess) {
          logger.warn('Failed to send message to AI', {
            connectionId,
            userId,
            threadId,
            messageId: messageResult.data.id
          });
          
          // Record failed AI interaction
          rateLimiter.recordAIInteraction(userId, connectionId, false, connection.isAnonymous);
        }
        
      } catch (aiError) {
        const error = errorHandler.handleAIConnectionError(aiError, 'send_to_ai', {
          connectionId,
          userId,
          threadId,
          messageId: messageResult.data.id
        });
        
        // Record failed AI interaction
        rateLimiter.recordAIInteraction(userId, connectionId, false, connection.isAnonymous);
        
        // Send error notification to user
        errorHandler.sendErrorResponse(connection.socket, error, messageId);
        timer.end({ success: false, error: 'ai_processing_failed' });
        return;
      }
    } else if (aiManager && !aiManager.isAvailable()) {
      // AI is configured but not available
      logger.info('AI service not available', {
        connectionId,
        userId,
        threadId,
        messageId: messageResult.data.id
      });
      
      sendSuccess(connection, 'ai_unavailable', {
        message_id: messageResult.data.id,
        thread_id: threadId,
        reason: 'AI service temporarily unavailable'
      }, messageId);
    }
    
    timer.end({ success: true, messageId: messageResult.data.id });
    
  } catch (error) {
    const handledError = errorHandler.handleInternalError(error, 'handle_send_message', {
      connectionId,
      userId: connection.user?.id,
      messageId,
      threadId: message.threadId
    });
    
    errorHandler.sendErrorResponse(connection.socket, handledError, messageId);
    timer.end({ success: false, error: 'unexpected_error' });
  }
}

/**
 * Handle typing indicator WebSocket messages
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 */
async function handleTypingIndicator(connection, message) {
  const timer = logger.createTimer('handle_typing_indicator');
  const messageId = message.messageId || uuidv4();
  
  try {
    const { threadId, isTyping = false } = message;
    const userId = connection.user ? (connection.user.isAnonymous ? null : connection.user.id) : null;
    
    logger.logWebSocketEvent('typing_indicator', connection.id, userId, {
      threadId,
      isTyping,
      userType: connection.isAnonymous ? 'anonymous' : 'authenticated'
    });
    
    if (!threadId) {
      const error = errorHandler.handleValidationError(
        ['thread_id is required for typing indicators'],
        { connectionId: connection.id, userId, messageType: 'typing_indicator' }
      );
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'missing_thread_id' });
      return;
    }
    
    // Validate UUID format
    if (!validator.validateUUID(threadId)) {
      const error = errorHandler.handleValidationError(
        ['thread_id must be a valid UUID'],
        { connectionId: connection.id, userId, threadId }
      );
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'invalid_thread_id' });
      return;
    }
    
    // Validate thread ownership
    if (userId) {
      try {
        const ownershipResult = await errorHandler.executeWithRetry(
          () => validateThreadOwnership(threadId, userId),
          { operation: 'validate_thread_ownership', threadId, userId },
          2,
          500
        );
        
        if (ownershipResult.error) {
          const error = errorHandler.handleAuthorizationError('thread', 'access', {
            connectionId: connection.id,
            userId,
            threadId,
            reason: ownershipResult.error
          });
          errorHandler.sendErrorResponse(connection.socket, error, messageId);
          timer.end({ success: false, error: 'access_denied' });
          return;
        }
      } catch (ownershipError) {
        const error = errorHandler.handleDatabaseError(ownershipError, 'validate_thread_ownership', {
          connectionId: connection.id,
          userId,
          threadId
        });
        errorHandler.sendErrorResponse(connection.socket, error, messageId);
        timer.end({ success: false, error: 'ownership_check_failed' });
        return;
      }
    }
    
    // Send typing confirmation
    sendSuccess(connection, 'typing_indicator_ack', {
      thread_id: threadId,
      is_typing: isTyping,
      user_id: userId || 'anonymous'
    }, messageId);
    
    logger.debug('Typing indicator processed', {
      connectionId: connection.id,
      userId,
      threadId,
      isTyping,
      userType: connection.isAnonymous ? 'anonymous' : 'authenticated'
    });
    
    timer.end({ success: true, isTyping });
    
  } catch (error) {
    const handledError = errorHandler.handleInternalError(error, 'handle_typing_indicator', {
      connectionId: connection.id,
      userId: connection.user?.id,
      messageId,
      threadId: message.threadId
    });
    
    errorHandler.sendErrorResponse(connection.socket, handledError, messageId);
    timer.end({ success: false, error: 'unexpected_error' });
  }
}

/**
 * Handle analysis request messages - frontend compatibility layer
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - Analysis request message with prompt
 * @param {Object} aiManager - AI Connection Manager instance
 * @param {string} connectionId - WebSocket connection ID
 */
async function handleAnalysisRequest(connection, message, aiManager, connectionId) {
  const timer = logger.createTimer('handle_analysis_request');
  const messageId = message.messageId || uuidv4();
  
  try {
    // Transform analysis_request to send_message format for internal processing
    const transformedMessage = {
      ...message,
      type: 'send_message',
      content: message.prompt, // Map prompt to content
      threadId: message.threadId || uuidv4() // Generate thread ID if not provided
    };
    
    logger.info('Analysis request received', {
      connectionId: connection.id,
      userId: connection.user?.id,
      promptLength: message.prompt?.length,
      clientId: message.client_id,
      messageId
    });
    
    // Use existing send_message handler with transformed message
    await handleSendMessage(connection, transformedMessage, aiManager, connectionId);
    
    timer.end({ success: true, promptLength: message.prompt?.length });
    
  } catch (error) {
    const handledError = errorHandler.handleInternalError(error, 'handle_analysis_request', {
      connectionId: connection.id,
      userId: connection.user?.id,
      messageId,
      clientId: message.client_id
    });
    
    errorHandler.sendErrorResponse(connection.socket, handledError, messageId);
    timer.end({ success: false, error: 'unexpected_error' });
  }
}

/**
 * Main chat message handler - routes messages to appropriate handlers
 * @param {Object} connection - WebSocket connection object with user data
 * @param {Object} message - WebSocket message object
 * @param {Map} connections - All WebSocket connections (optional)
 * @param {Object} aiManager - AI Connection Manager instance (optional)
 * @param {string} connectionId - WebSocket connection ID for AI responses
 */
async function handleChatMessage(connection, message, connections = null, aiManager = null, connectionId = null) {
  const timer = logger.createTimer('handle_chat_message');
  const messageId = message.messageId || uuidv4();
  
  try {
    // Validate connection has user data (authenticated or anonymous)
    if (!connection.user) {
      const error = errorHandler.handleAuthenticationError('User authentication required for chat operations', {
        connectionId: connection.id,
        messageType: message.type
      });
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'not_authenticated' });
      return;
    }
    
    logger.logWebSocketEvent('chat_message_route', connectionId, connection.user?.id, {
      messageType: message.type,
      authenticated: connection.isAuthenticated,
      anonymous: connection.isAnonymous
    });
    
    // Route message based on type with comprehensive error handling
    switch (message.type) {
      case 'send_message':
        await handleSendMessage(connection, message, aiManager, connectionId);
        break;
        
      case 'analysis_request':
        await handleAnalysisRequest(connection, message, aiManager, connectionId);
        break;
        
      case 'typing_indicator':
        await handleTypingIndicator(connection, message);
        break;
        
      default:
        const error = errorHandler.handleValidationError(
          [`Unknown chat message type: ${message.type}`],
          { 
            connectionId: connection.id, 
            userId: connection.user?.id,
            messageType: message.type,
            validTypes: ['send_message', 'analysis_request', 'typing_indicator']
          }
        );
        errorHandler.sendErrorResponse(connection.socket, error, messageId);
        timer.end({ success: false, error: 'unknown_message_type' });
        return;
    }
    
    timer.end({ success: true, messageType: message.type });
    
  } catch (error) {
    const handledError = errorHandler.handleInternalError(error, 'handle_chat_message', {
      connectionId: connection.id,
      userId: connection.user?.id,
      messageType: message.type,
      messageId
    });
    
    errorHandler.sendErrorResponse(connection.socket, handledError, messageId);
    timer.end({ success: false, error: 'unexpected_error' });
  }
}

module.exports = {
  handleChatMessage,
  handleSendMessage,
  handleTypingIndicator,
  validateMessageContent,
  buildConversationContext
};