/**
 * Centralized Error Handling System for AVAI WebSocket Backend
 * Provides error classification, formatting, and response handling
 */

const logger = require('./logger');

class ErrorHandler {
  constructor() {
    this.errorTypes = {
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
      AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
      DATABASE_ERROR: 'DATABASE_ERROR',
      AI_CONNECTION_ERROR: 'AI_CONNECTION_ERROR',
      RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
      WEBSOCKET_ERROR: 'WEBSOCKET_ERROR',
      INTERNAL_ERROR: 'INTERNAL_ERROR',
      NETWORK_ERROR: 'NETWORK_ERROR',
      TIMEOUT_ERROR: 'TIMEOUT_ERROR'
    };

    this.httpStatusCodes = {
      [this.errorTypes.VALIDATION_ERROR]: 400,
      [this.errorTypes.AUTHENTICATION_ERROR]: 401,
      [this.errorTypes.AUTHORIZATION_ERROR]: 403,
      [this.errorTypes.RATE_LIMIT_ERROR]: 429,
      [this.errorTypes.DATABASE_ERROR]: 500,
      [this.errorTypes.AI_CONNECTION_ERROR]: 503,
      [this.errorTypes.WEBSOCKET_ERROR]: 500,
      [this.errorTypes.INTERNAL_ERROR]: 500,
      [this.errorTypes.NETWORK_ERROR]: 503,
      [this.errorTypes.TIMEOUT_ERROR]: 504
    };

    this.retryableErrors = new Set([
      this.errorTypes.DATABASE_ERROR,
      this.errorTypes.AI_CONNECTION_ERROR,
      this.errorTypes.NETWORK_ERROR,
      this.errorTypes.TIMEOUT_ERROR
    ]);
  }

  /**
   * Create a standardized error object
   * @param {string} type - Error type
   * @param {string} message - Error message
   * @param {Object} details - Additional error details
   * @param {Error} originalError - Original error object
   * @returns {Object} Standardized error object
   */
  createError(type, message, details = {}, originalError = null) {
    const error = {
      type,
      message,
      timestamp: new Date().toISOString(),
      requestId: details.requestId || this.generateRequestId(),
      statusCode: this.httpStatusCodes[type] || 500,
      retryable: this.retryableErrors.has(type),
      details
    };

    if (originalError) {
      error.originalMessage = originalError.message;
      error.stack = originalError.stack;
    }

    return error;
  }

  /**
   * Generate unique request ID
   * @returns {string} Unique request ID
   */
  generateRequestId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Handle validation errors
   * @param {Array} validationErrors - Array of validation error messages
   * @param {Object} context - Error context
   * @returns {Object} Formatted validation error
   */
  handleValidationError(validationErrors, context = {}) {
    const error = this.createError(
      this.errorTypes.VALIDATION_ERROR,
      'Input validation failed',
      {
        validationErrors,
        field: context.field,
        value: context.value,
        ...context
      }
    );

    logger.logValidation('message', false, validationErrors, {
      connectionId: context.connectionId,
      userId: context.userId,
      messageType: context.messageType
    });

    return error;
  }

  /**
   * Handle authentication errors
   * @param {string} reason - Authentication failure reason
   * @param {Object} context - Error context
   * @returns {Object} Formatted authentication error
   */
  handleAuthenticationError(reason, context = {}) {
    const error = this.createError(
      this.errorTypes.AUTHENTICATION_ERROR,
      'Authentication failed',
      {
        reason,
        tokenPresent: !!context.token,
        ...context
      }
    );

    logger.logAuthentication(false, context.userId, context.connectionId, reason, {
      errorType: 'authentication_failed',
      reason
    });

    return error;
  }

  /**
   * Handle authorization errors
   * @param {string} resource - Resource being accessed
   * @param {string} action - Action being performed
   * @param {Object} context - Error context
   * @returns {Object} Formatted authorization error
   */
  handleAuthorizationError(resource, action, context = {}) {
    const error = this.createError(
      this.errorTypes.AUTHORIZATION_ERROR,
      'Access denied',
      {
        resource,
        action,
        userId: context.userId,
        ...context
      }
    );

    logger.warn('Authorization denied', {
      userId: context.userId,
      connectionId: context.connectionId,
      resource,
      action,
      reason: 'insufficient_permissions'
    });

    return error;
  }

  /**
   * Handle database errors
   * @param {Error} dbError - Database error object
   * @param {string} operation - Database operation
   * @param {Object} context - Error context
   * @returns {Object} Formatted database error
   */
  handleDatabaseError(dbError, operation, context = {}) {
    const isConnectionError = this.isDatabaseConnectionError(dbError);
    const isConstraintError = this.isDatabaseConstraintError(dbError);

    const error = this.createError(
      this.errorTypes.DATABASE_ERROR,
      isConnectionError ? 'Database connection failed' : 'Database operation failed',
      {
        operation,
        table: context.table,
        isConnectionError,
        isConstraintError,
        errorCode: dbError.code,
        ...context
      },
      dbError
    );

    logger.logDatabaseOperation(
      operation,
      context.table || 'unknown',
      context.userId,
      false,
      context.duration || 0,
      {
        error: dbError.message,
        errorCode: dbError.code,
        connectionId: context.connectionId
      }
    );

    return error;
  }

  /**
   * Handle AI connection errors
   * @param {Error} aiError - AI connection error
   * @param {string} action - AI action being performed
   * @param {Object} context - Error context
   * @returns {Object} Formatted AI connection error
   */
  handleAIConnectionError(aiError, action, context = {}) {
    const isConnectionError = this.isNetworkError(aiError);
    const isTimeoutError = this.isTimeoutError(aiError);

    const errorType = isTimeoutError ? 
      this.errorTypes.TIMEOUT_ERROR : 
      this.errorTypes.AI_CONNECTION_ERROR;

    const error = this.createError(
      errorType,
      isTimeoutError ? 'AI service timeout' : 'AI service unavailable',
      {
        action,
        threadId: context.threadId,
        isConnectionError,
        isTimeoutError,
        aiServiceUrl: context.aiServiceUrl,
        ...context
      },
      aiError
    );

    logger.logAIInteraction(
      action,
      context.threadId,
      context.userId,
      false,
      context.processingTime,
      {
        error: aiError.message,
        connectionId: context.connectionId,
        aiServiceUrl: context.aiServiceUrl
      }
    );

    return error;
  }

  /**
   * Handle rate limiting errors
   * @param {string} endpoint - Rate limited endpoint
   * @param {number} limit - Rate limit
   * @param {number} windowMs - Rate limit window in ms
   * @param {Object} context - Error context
   * @returns {Object} Formatted rate limit error
   */
  handleRateLimitError(endpoint, limit, windowMs, context = {}) {
    const error = this.createError(
      this.errorTypes.RATE_LIMIT_ERROR,
      'Rate limit exceeded',
      {
        endpoint,
        limit,
        windowMs,
        retryAfter: Math.ceil(windowMs / 1000),
        ...context
      }
    );

    logger.logRateLimit(
      context.userId,
      context.connectionId,
      endpoint,
      true,
      {
        limit,
        windowMs,
        currentCount: context.currentCount
      }
    );

    return error;
  }

  /**
   * Handle WebSocket errors
   * @param {Error} wsError - WebSocket error
   * @param {string} operation - WebSocket operation
   * @param {Object} context - Error context
   * @returns {Object} Formatted WebSocket error
   */
  handleWebSocketError(wsError, operation, context = {}) {
    const error = this.createError(
      this.errorTypes.WEBSOCKET_ERROR,
      'WebSocket operation failed',
      {
        operation,
        wsReadyState: context.wsReadyState,
        connectionId: context.connectionId,
        ...context
      },
      wsError
    );

    logger.error('WebSocket error', {
      operation,
      connectionId: context.connectionId,
      userId: context.userId,
      error: wsError.message,
      wsReadyState: context.wsReadyState
    });

    return error;
  }

  /**
   * Handle internal server errors
   * @param {Error} internalError - Internal error object
   * @param {string} operation - Operation being performed
   * @param {Object} context - Error context
   * @returns {Object} Formatted internal error
   */
  handleInternalError(internalError, operation, context = {}) {
    const error = this.createError(
      this.errorTypes.INTERNAL_ERROR,
      'Internal server error',
      {
        operation,
        ...context
      },
      internalError
    );

    logger.error('Internal server error', {
      operation,
      connectionId: context.connectionId,
      userId: context.userId,
      error: internalError.message,
      stack: internalError.stack
    });

    return error;
  }

  /**
   * Format error for WebSocket response
   * @param {Object} error - Error object
   * @param {boolean} includeStack - Whether to include stack trace
   * @returns {Object} Formatted error response
   */
  formatErrorResponse(error, includeStack = false) {
    const response = {
      success: false,
      error: {
        type: error.type,
        message: error.message,
        requestId: error.requestId,
        timestamp: error.timestamp,
        retryable: error.retryable
      }
    };

    // Include additional details for client
    if (error.details) {
      const clientDetails = { ...error.details };
      
      // Remove sensitive information
      delete clientDetails.stack;
      delete clientDetails.originalMessage;
      delete clientDetails.userId; // Don't send back to client
      
      if (Object.keys(clientDetails).length > 0) {
        response.error.details = clientDetails;
      }
    }

    // Include stack trace only in development
    if (includeStack && process.env.NODE_ENV === 'development' && error.stack) {
      response.error.stack = error.stack;
    }

    return response;
  }

  /**
   * Send error response via WebSocket
   * @param {Object} ws - WebSocket connection
   * @param {Object} error - Error object
   * @param {string} messageId - Original message ID
   */
  sendErrorResponse(ws, error, messageId = null) {
    if (!ws || ws.readyState !== ws.OPEN) {
      logger.warn('Cannot send error response: WebSocket not open', {
        errorType: error.type,
        messageId,
        wsReadyState: ws ? ws.readyState : 'null'
      });
      return;
    }

    const response = this.formatErrorResponse(error);
    
    if (messageId) {
      response.messageId = messageId;
    }

    try {
      ws.send(JSON.stringify(response));
      logger.debug('Error response sent', {
        errorType: error.type,
        messageId,
        requestId: error.requestId
      });
    } catch (sendError) {
      logger.error('Failed to send error response', {
        error: sendError.message,
        originalError: error.type,
        messageId
      });
    }
  }

  /**
   * Check if error is a database connection error
   * @param {Error} error - Error object
   * @returns {boolean} True if connection error
   */
  isDatabaseConnectionError(error) {
    const connectionErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'connection terminated unexpectedly'
    ];
    
    return connectionErrors.some(errType => 
      error.message?.toLowerCase().includes(errType.toLowerCase()) ||
      error.code === errType
    );
  }

  /**
   * Check if error is a database constraint error
   * @param {Error} error - Error object
   * @returns {boolean} True if constraint error
   */
  isDatabaseConstraintError(error) {
    const constraintErrors = ['23505', '23503', '23502', '23514']; // PostgreSQL constraint codes
    return constraintErrors.includes(error.code);
  }

  /**
   * Check if error is a network error
   * @param {Error} error - Error object
   * @returns {boolean} True if network error
   */
  isNetworkError(error) {
    const networkErrors = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ECONNRESET',
      'EPIPE',
      'EHOSTUNREACH'
    ];
    
    return networkErrors.some(errType => 
      error.message?.toLowerCase().includes(errType.toLowerCase()) ||
      error.code === errType
    );
  }

  /**
   * Check if error is a timeout error
   * @param {Error} error - Error object
   * @returns {boolean} True if timeout error
   */
  isTimeoutError(error) {
    return error.message?.toLowerCase().includes('timeout') ||
           error.code === 'ETIMEDOUT';
  }

  /**
   * Determine if operation should be retried
   * @param {Object} error - Error object
   * @param {number} attemptCount - Current attempt count
   * @param {number} maxRetries - Maximum retry attempts
   * @returns {boolean} True if should retry
   */
  shouldRetry(error, attemptCount, maxRetries = 3) {
    return error.retryable && attemptCount < maxRetries;
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attemptCount - Current attempt count
   * @param {number} baseDelay - Base delay in ms
   * @param {number} maxDelay - Maximum delay in ms
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attemptCount, baseDelay = 1000, maxDelay = 30000) {
    const delay = baseDelay * Math.pow(2, attemptCount - 1);
    return Math.min(delay, maxDelay);
  }

  /**
   * Execute operation with retry logic
   * @param {Function} operation - Operation to execute
   * @param {Object} context - Operation context
   * @param {number} maxRetries - Maximum retry attempts
   * @param {number} baseDelay - Base retry delay
   * @returns {Promise} Operation result
   */
  async executeWithRetry(operation, context = {}, maxRetries = 3, baseDelay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      try {
        const result = await operation();
        
        if (attempt > 1) {
          logger.info('Operation succeeded after retry', {
            operation: context.operation,
            attempt,
            ...context
          });
        }
        
        return result;
      } catch (error) {
        lastError = error;
        
        if (attempt <= maxRetries && this.shouldRetry(error, attempt, maxRetries)) {
          const delay = this.calculateRetryDelay(attempt, baseDelay);
          
          logger.warn('Operation failed, retrying', {
            operation: context.operation,
            attempt,
            maxRetries,
            delay,
            error: error.message,
            ...context
          });
          
          await this.sleep(delay);
        } else {
          break;
        }
      }
    }
    
    logger.error('Operation failed after all retries', {
      operation: context.operation,
      attempts: maxRetries + 1,
      error: lastError.message,
      ...context
    });
    
    throw lastError;
  }

  /**
   * Sleep for specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after delay
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Wrap async function with error handling
   * @param {Function} fn - Async function to wrap
   * @param {Object} context - Error context
   * @returns {Function} Wrapped function
   */
  wrapAsync(fn, context = {}) {
    return async (...args) => {
      try {
        return await fn(...args);
      } catch (error) {
        const handledError = this.handleInternalError(error, context.operation, context);
        logger.error('Async function error', {
          function: fn.name,
          error: error.message,
          stack: error.stack,
          ...context
        });
        throw handledError;
      }
    };
  }
}

// Export singleton instance
module.exports = new ErrorHandler();