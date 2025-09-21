/**
 * Rate Limiting System for AVAI WebSocket Backend
 * Provides configurable rate limiting for different operations and users
 */

const logger = require('./logger');
const errorHandler = require('./errorHandler');

class RateLimiter {
  constructor() {
    this.windows = new Map(); // Store rate limit windows
    this.config = {
      // Default rate limits (requests per minute)
      default: {
        windowMs: 60 * 1000, // 1 minute
        max: 60, // 60 requests per minute
        skipSuccessfulRequests: false
      },
      
      // Message sending limits
      send_message: {
        windowMs: 60 * 1000, // 1 minute
        max: 30, // 30 messages per minute
        skipSuccessfulRequests: false
      },
      
      // Thread operations
      create_thread: {
        windowMs: 60 * 1000, // 1 minute
        max: 10, // 10 new threads per minute
        skipSuccessfulRequests: false
      },
      
      // Authentication attempts
      authenticate: {
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 5, // 5 failed attempts per 15 minutes
        skipSuccessfulRequests: true // Only count failed attempts
      },
      
      // AI interactions
      ai_interaction: {
        windowMs: 60 * 1000, // 1 minute
        max: 20, // 20 AI requests per minute
        skipSuccessfulRequests: false
      },
      
      // Database operations
      database_operation: {
        windowMs: 60 * 1000, // 1 minute
        max: 100, // 100 DB operations per minute
        skipSuccessfulRequests: false
      },
      
      // Anonymous user limits (stricter)
      anonymous: {
        windowMs: 60 * 1000, // 1 minute
        max: 20, // 20 requests per minute for anonymous users
        skipSuccessfulRequests: false
      }
    };

    // Override with environment variables if provided
    this.loadConfigFromEnv();
    
    // Cleanup interval
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000); // Cleanup every 5 minutes
  }

  /**
   * Load rate limit configuration from environment variables
   */
  loadConfigFromEnv() {
    const configKeys = Object.keys(this.config);
    
    configKeys.forEach(key => {
      const envMax = process.env[`RATE_LIMIT_${key.toUpperCase()}_MAX`];
      const envWindow = process.env[`RATE_LIMIT_${key.toUpperCase()}_WINDOW_MS`];
      
      if (envMax && !isNaN(parseInt(envMax))) {
        this.config[key].max = parseInt(envMax);
      }
      
      if (envWindow && !isNaN(parseInt(envWindow))) {
        this.config[key].windowMs = parseInt(envWindow);
      }
    });
  }

  /**
   * Get rate limit key for a user/connection
   * @param {string} identifier - User ID or connection ID
   * @param {string} operation - Operation type
   * @returns {string} Rate limit key
   */
  getRateLimitKey(identifier, operation) {
    return `${identifier}:${operation}`;
  }

  /**
   * Check if request is rate limited
   * @param {string} identifier - User ID or connection ID
   * @param {string} operation - Operation type
   * @param {boolean} isAnonymous - Whether user is anonymous
   * @returns {Object} Rate limit check result
   */
  checkRateLimit(identifier, operation, isAnonymous = false) {
    // Use anonymous limits for anonymous users
    const configKey = isAnonymous ? 'anonymous' : (this.config[operation] ? operation : 'default');
    const config = this.config[configKey];
    
    const key = this.getRateLimitKey(identifier, operation);
    const now = Date.now();
    const windowStart = now - config.windowMs;
    
    // Get or create window for this key
    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }
    
    const requests = this.windows.get(key);
    
    // Remove requests outside the current window
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    this.windows.set(key, validRequests);
    
    // Check if limit exceeded
    const isLimited = validRequests.length >= config.max;
    const remaining = Math.max(0, config.max - validRequests.length);
    const resetTime = validRequests.length > 0 ? 
      Math.max(...validRequests) + config.windowMs : 
      now + config.windowMs;
    
    return {
      allowed: !isLimited,
      limit: config.max,
      remaining,
      resetTime,
      retryAfter: isLimited ? Math.ceil((resetTime - now) / 1000) : 0,
      windowMs: config.windowMs
    };
  }

  /**
   * Record a request attempt
   * @param {string} identifier - User ID or connection ID
   * @param {string} operation - Operation type
   * @param {boolean} success - Whether the request was successful
   * @param {boolean} isAnonymous - Whether user is anonymous
   * @returns {Object} Updated rate limit status
   */
  recordRequest(identifier, operation, success = true, isAnonymous = false) {
    const configKey = isAnonymous ? 'anonymous' : (this.config[operation] ? operation : 'default');
    const config = this.config[configKey];
    
    // Skip recording successful requests if configured to do so
    if (success && config.skipSuccessfulRequests) {
      return this.checkRateLimit(identifier, operation, isAnonymous);
    }
    
    const key = this.getRateLimitKey(identifier, operation);
    const now = Date.now();
    
    // Get or create window for this key
    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }
    
    const requests = this.windows.get(key);
    requests.push(now);
    
    // Clean up old requests
    const windowStart = now - config.windowMs;
    const validRequests = requests.filter(timestamp => timestamp > windowStart);
    this.windows.set(key, validRequests);
    
    // Log rate limit event
    logger.logRateLimit(
      identifier.startsWith('conn_') ? null : identifier,
      identifier.startsWith('conn_') ? identifier : null,
      operation,
      validRequests.length >= config.max,
      {
        currentCount: validRequests.length,
        limit: config.max,
        success,
        isAnonymous
      }
    );
    
    return this.checkRateLimit(identifier, operation, isAnonymous);
  }

  /**
   * Check and record WebSocket message rate limit
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {string} messageType - Message type
   * @param {boolean} isAnonymous - Whether user is anonymous
   * @returns {Object} Rate limit result
   */
  checkWebSocketMessage(userId, connectionId, messageType, isAnonymous = false) {
    const identifier = userId || connectionId;
    const result = this.checkRateLimit(identifier, messageType, isAnonymous);
    
    if (!result.allowed) {
      const error = errorHandler.handleRateLimitError(
        messageType,
        result.limit,
        result.windowMs,
        {
          userId,
          connectionId,
          currentCount: result.limit - result.remaining,
          retryAfter: result.retryAfter
        }
      );
      
      return {
        ...result,
        error
      };
    }
    
    // Record the request
    this.recordRequest(identifier, messageType, true, isAnonymous);
    
    return result;
  }

  /**
   * Check authentication rate limit
   * @param {string} identifier - User identifier (IP, connection ID, etc.)
   * @param {boolean} success - Whether authentication was successful
   * @returns {Object} Rate limit result
   */
  checkAuthenticationLimit(identifier, success = true) {
    const result = this.recordRequest(identifier, 'authenticate', success, true);
    
    if (!result.allowed) {
      const error = errorHandler.handleRateLimitError(
        'authenticate',
        result.limit,
        result.windowMs,
        {
          connectionId: identifier,
          currentCount: result.limit - result.remaining,
          retryAfter: result.retryAfter
        }
      );
      
      return {
        ...result,
        error
      };
    }
    
    return result;
  }

  /**
   * Check AI interaction rate limit
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {boolean} isAnonymous - Whether user is anonymous
   * @returns {Object} Rate limit result
   */
  checkAIInteractionLimit(userId, connectionId, isAnonymous = false) {
    const identifier = userId || connectionId;
    const result = this.checkRateLimit(identifier, 'ai_interaction', isAnonymous);
    
    if (!result.allowed) {
      const error = errorHandler.handleRateLimitError(
        'ai_interaction',
        result.limit,
        result.windowMs,
        {
          userId,
          connectionId,
          currentCount: result.limit - result.remaining,
          retryAfter: result.retryAfter
        }
      );
      
      return {
        ...result,
        error
      };
    }
    
    return result;
  }

  /**
   * Record AI interaction
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {boolean} success - Whether interaction was successful
   * @param {boolean} isAnonymous - Whether user is anonymous
   * @returns {Object} Updated rate limit status
   */
  recordAIInteraction(userId, connectionId, success = true, isAnonymous = false) {
    const identifier = userId || connectionId;
    return this.recordRequest(identifier, 'ai_interaction', success, isAnonymous);
  }

  /**
   * Check database operation rate limit
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {string} operation - Database operation
   * @returns {Object} Rate limit result
   */
  checkDatabaseLimit(userId, connectionId, operation = 'database_operation') {
    const identifier = userId || connectionId;
    const result = this.checkRateLimit(identifier, 'database_operation', !userId);
    
    if (!result.allowed) {
      const error = errorHandler.handleRateLimitError(
        'database_operation',
        result.limit,
        result.windowMs,
        {
          userId,
          connectionId,
          operation,
          currentCount: result.limit - result.remaining,
          retryAfter: result.retryAfter
        }
      );
      
      return {
        ...result,
        error
      };
    }
    
    return result;
  }

  /**
   * Record database operation
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {boolean} success - Whether operation was successful
   * @returns {Object} Updated rate limit status
   */
  recordDatabaseOperation(userId, connectionId, success = true) {
    const identifier = userId || connectionId;
    return this.recordRequest(identifier, 'database_operation', success, !userId);
  }

  /**
   * Get rate limit status for user
   * @param {string} identifier - User ID or connection ID
   * @param {string} operation - Operation type
   * @param {boolean} isAnonymous - Whether user is anonymous
   * @returns {Object} Current rate limit status
   */
  getStatus(identifier, operation, isAnonymous = false) {
    return this.checkRateLimit(identifier, operation, isAnonymous);
  }

  /**
   * Reset rate limit for specific user/operation
   * @param {string} identifier - User ID or connection ID
   * @param {string} operation - Operation type (optional, resets all if not provided)
   */
  resetLimit(identifier, operation = null) {
    if (operation) {
      const key = this.getRateLimitKey(identifier, operation);
      this.windows.delete(key);
      logger.info('Rate limit reset', { identifier, operation });
    } else {
      // Reset all operations for this identifier
      const keysToDelete = [];
      for (const key of this.windows.keys()) {
        if (key.startsWith(`${identifier}:`)) {
          keysToDelete.push(key);
        }
      }
      keysToDelete.forEach(key => this.windows.delete(key));
      logger.info('All rate limits reset', { identifier, operationsReset: keysToDelete.length });
    }
  }

  /**
   * Clean up expired windows
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [key, requests] of this.windows.entries()) {
      const operation = key.split(':')[1];
      const configKey = this.config[operation] ? operation : 'default';
      const windowMs = this.config[configKey].windowMs;
      
      const validRequests = requests.filter(timestamp => timestamp > now - windowMs);
      
      if (validRequests.length === 0) {
        this.windows.delete(key);
        cleanedCount++;
      } else if (validRequests.length < requests.length) {
        this.windows.set(key, validRequests);
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug('Rate limit cleanup completed', {
        windowsCleaned: cleanedCount,
        activeWindows: this.windows.size
      });
    }
  }

  /**
   * Get rate limiter statistics
   * @returns {Object} Rate limiter statistics
   */
  getStats() {
    const stats = {
      activeWindows: this.windows.size,
      totalRequests: 0,
      configuredLimits: {}
    };
    
    // Count total requests across all windows
    for (const requests of this.windows.values()) {
      stats.totalRequests += requests.length;
    }
    
    // Include configured limits
    Object.keys(this.config).forEach(key => {
      stats.configuredLimits[key] = {
        max: this.config[key].max,
        windowMs: this.config[key].windowMs
      };
    });
    
    return stats;
  }

  /**
   * Shutdown rate limiter and cleanup resources
   */
  shutdown() {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    
    this.windows.clear();
    logger.info('Rate limiter shutdown completed');
  }
}

// Export singleton instance
module.exports = new RateLimiter();