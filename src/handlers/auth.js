const { verifyJWT, extractUser, createAnonymousUser } = require('../auth');
const { upsertUser, updateUserActivity } = require('../database');
const { v4: uuidv4 } = require('uuid');

// Import error handling utilities
const logger = require('../utils/logger');
const validator = require('../utils/validation');
const errorHandler = require('../utils/errorHandler');
const rateLimiter = require('../utils/rateLimiter');

// Import security modules
const authSecurity = require('../security/authSecurity');
const securityValidator = require('../security/validator');

/**
 * Handle WebSocket authentication messages
 * @param {Object} connection - WebSocket connection object
 * @param {Object} message - Parsed message object
 * @returns {Promise<void>}
 */
async function handleAuth(connection, message) {
  const timer = logger.createTimer('handle_auth');
  const messageId = message.messageId || uuidv4();
  
  try {
    const { token, anonymous } = message;
    
    // Enhanced security checks before processing
    
    // Check if IP is blocked
    const ipStatus = authSecurity.isIPBlocked(connection.ip);
    if (ipStatus.blocked) {
      const blockError = {
        type: 'error',
        error_type: 'AUTH_FAILED',
        message: 'IP temporarily blocked due to failed authentication attempts',
        retry_after: Math.ceil(ipStatus.remainingTime / 1000),
        timestamp: new Date().toISOString(),
        messageId
      };
      
      connection.socket.send(JSON.stringify(blockError));
      timer.end({ success: false, error: 'ip_blocked' });
      return;
    }
    
    // Check authentication rate limit before processing
    const rateLimitResult = rateLimiter.checkAuthenticationLimit(connection.id, true);
    if (!rateLimitResult.allowed) {
      errorHandler.sendErrorResponse(connection.socket, rateLimitResult.error, messageId);
      timer.end({ success: false, error: 'rate_limited' });
      return;
    }
    
    logger.logWebSocketEvent('auth_attempt', connection.id, null, {
      hasToken: !!token,
      anonymous: !!anonymous,
      ip: connection.remoteAddress
    });
    
    // Handle anonymous authentication
    if (anonymous || !token) {
      try {
        const sessionId = `anon_${Date.now()}_${validator.generateUUID().substring(0, 8)}`;
        const anonymousUser = createAnonymousUser(sessionId);
        
        // Store user data on connection
        connection.user = anonymousUser;
        connection.isAuthenticated = false;
        connection.isAnonymous = true;
        connection.authTime = Date.now();
        
        logger.logAuthentication(true, null, connection.id, null, {
          anonymous: true,
          sessionId: anonymousUser.sessionId
        });
        
        // Send success response
        const response = {
          type: 'auth_success',
          success: true,
          user: {
            id: anonymousUser.id,
            sessionId: anonymousUser.sessionId,
            name: anonymousUser.name,
            isAnonymous: true,
            isAuthenticated: false
          },
          timestamp: new Date().toISOString(),
          messageId
        };
        
        connection.socket.send(JSON.stringify(response));
        
        logger.info('Anonymous user authenticated', {
          connectionId: connection.id,
          sessionId: anonymousUser.sessionId,
          userAgent: connection.userAgent
        });
        
        timer.end({ success: true, authType: 'anonymous' });
        return;
        
      } catch (anonError) {
        const error = errorHandler.handleAuthenticationError(
          'Failed to create anonymous user session',
          { connectionId: connection.id, error: anonError.message }
        );
        
        rateLimiter.recordRequest(connection.id, 'authenticate', false, true);
        errorHandler.sendErrorResponse(connection.socket, error, messageId);
        timer.end({ success: false, error: 'anonymous_creation_failed' });
        return;
      }
    }

    // Enhanced JWT validation with security checks
    if (typeof token !== 'string' || token.trim().length === 0) {
      await authSecurity.recordFailedAttempt(
        connection.ip, 
        'INVALID_TOKEN_FORMAT', 
        connection.userAgent
      );
      
      const error = errorHandler.handleAuthenticationError(
        'Invalid token format',
        { connectionId: connection.id, tokenProvided: !!token }
      );
      
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'invalid_token_format' });
      return;
    }

    // Comprehensive JWT security validation
    let jwtValidationResult;
    try {
      jwtValidationResult = await authSecurity.validateJWT(
        token,
        connection.ip,
        connection.userAgent
      );
    } catch (jwtError) {
      await authSecurity.recordFailedAttempt(
        connection.ip, 
        'JWT_VALIDATION_ERROR', 
        connection.userAgent
      );
      
      const error = errorHandler.handleAuthenticationError(
        'JWT validation failed',
        { connectionId: connection.id, error: jwtError.message }
      );
      
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'jwt_validation_error' });
      return;
    }
    
    if (!jwtValidationResult.isValid) {
      // Failed attempt already recorded in authSecurity.validateJWT
      
      const authError = {
        type: 'error',
        error_type: 'AUTH_FAILED',
        message: 'Authentication failed',
        timestamp: new Date().toISOString(),
        messageId,
        securityFlags: jwtValidationResult.securityFlags,
        riskLevel: jwtValidationResult.riskLevel
      };
      
      connection.socket.send(JSON.stringify(authError));
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      timer.end({ success: false, error: 'jwt_validation_failed' });
      return;
    }

    // Legacy verification for backward compatibility
    let verificationResult;
    try {
      verificationResult = await errorHandler.executeWithRetry(
        () => verifyJWT(token),
        { operation: 'verify_jwt', connectionId: connection.id },
        2,
        1000
      );
    } catch (verifyError) {
      const error = errorHandler.handleAuthenticationError(
        'Token verification failed',
        { connectionId: connection.id, error: verifyError.message }
      );
      
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'token_verification_failed' });
      return;
    }

    // Extract full user data
    let userResult;
    try {
      userResult = await errorHandler.executeWithRetry(
        () => extractUser(token),
        { operation: 'extract_user', connectionId: connection.id },
        2,
        1000
      );
    } catch (extractError) {
      const error = errorHandler.handleAuthenticationError(
        'Failed to extract user information',
        { connectionId: connection.id, error: extractError.message }
      );
      
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'user_extraction_failed' });
      return;
    }
    
    if (!userResult.isAuthenticated || userResult.error) {
      const error = errorHandler.handleAuthenticationError(
        userResult.error || 'Failed to retrieve user information',
        { 
          connectionId: connection.id, 
          extractionError: userResult.error,
          isAuthenticated: userResult.isAuthenticated 
        }
      );
      
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'user_data_invalid' });
      return;
    }

    // Validate user data
    const userValidation = validator.validateUserInput(userResult.user, ['id', 'email'], {
      id: 'string',
      email: 'string',
      name: 'string'
    });
    
    if (!userValidation.success) {
      const error = errorHandler.handleValidationError(
        userValidation.errors,
        { connectionId: connection.id, field: 'user_data' }
      );
      
      rateLimiter.recordRequest(connection.id, 'authenticate', false, false);
      errorHandler.sendErrorResponse(connection.socket, error, messageId);
      timer.end({ success: false, error: 'user_data_validation_failed' });
      return;
    }

    // Upsert user in the database with error handling
    try {
      const upsertResult = await errorHandler.executeWithRetry(
        () => upsertUser(userResult.user),
        { operation: 'upsert_user', userId: userResult.user.id, connectionId: connection.id },
        3,
        1000
      );
      
      if (upsertResult.error) {
        logger.warn('Failed to upsert user, continuing with authentication', {
          connectionId: connection.id,
          userId: userResult.user.id,
          error: upsertResult.error
        });
      } else {
        logger.logDatabaseOperation(
          'upsert_user',
          'users',
          userResult.user.id,
          true,
          timer.end(),
          { connectionId: connection.id }
        );
      }
    } catch (upsertError) {
      logger.warn('User upsert failed, continuing with authentication', {
        connectionId: connection.id,
        userId: userResult.user.id,
        error: upsertError.message
      });
      // Continue with authentication even if user upsert fails
    }

    // Store user data on connection with security information
    connection.user = jwtValidationResult.user || userResult.user;
    connection.isAuthenticated = true;
    connection.isAnonymous = false;
    connection.token = token;
    connection.authTime = Date.now();
    connection.securityFlags = jwtValidationResult.securityFlags || [];
    connection.riskLevel = jwtValidationResult.riskLevel || 'LOW';
    
    // Clear any failed attempts for this IP on successful auth
    authSecurity.clearFailedAttempts(connection.ip);
    
    // Record successful authentication
    rateLimiter.recordRequest(connection.id, 'authenticate', true, false);
    
    logger.logAuthentication(true, connection.user.id, connection.id, null, {
      email: connection.user.email,
      name: connection.user.name,
      authMethod: 'jwt',
      securityFlags: connection.securityFlags,
      riskLevel: connection.riskLevel,
      ip: connection.ip
    });
    
    // Send success response
    const response = {
      type: 'auth_success',
      success: true,
      user: {
        id: userResult.user.id,
        email: userResult.user.email,
        name: userResult.user.name,
        firstName: userResult.user.firstName,
        lastName: userResult.user.lastName,
        username: userResult.user.username,
        imageUrl: userResult.user.imageUrl,
        isAnonymous: false,
        isAuthenticated: true
      },
      timestamp: new Date().toISOString(),
      messageId
    };
    
    connection.socket.send(JSON.stringify(response));
    
    logger.info('User authenticated successfully', {
      connectionId: connection.id,
      userId: userResult.user.id,
      email: userResult.user.email,
      name: userResult.user.name
    });
    
    timer.end({ success: true, authType: 'jwt', userId: userResult.user.id });
    
  } catch (error) {
    const handledError = errorHandler.handleInternalError(error, 'handle_auth', {
      connectionId: connection.id,
      hasToken: !!message.token,
      anonymous: !!message.anonymous
    });
    
    // Record failed authentication attempt
    rateLimiter.recordRequest(connection.id, 'authenticate', false, !message.token);
    
    errorHandler.sendErrorResponse(connection.socket, handledError, messageId);
    timer.end({ success: false, error: 'unexpected_error' });
  }
}

/**
 * Validate if a connection is properly authenticated
 * @param {Object} connection - WebSocket connection object
 * @returns {boolean} True if authenticated or anonymous
 */
function isValidConnection(connection) {
  return connection.user && (connection.isAuthenticated || connection.isAnonymous);
}

/**
 * Get user display info for logging
 * @param {Object} connection - WebSocket connection object
 * @returns {string} User display string
 */
function getUserDisplayInfo(connection) {
  if (!connection.user) {
    return 'unknown';
  }
  
  if (connection.isAnonymous) {
    return `anonymous:${connection.user.sessionId}`;
  }
  
  return `${connection.user.id}:${connection.user.email}`;
}

/**
 * Check if connection needs re-authentication
 * @param {Object} connection - WebSocket connection object
 * @returns {boolean} True if re-auth is needed
 */
function needsReauth(connection) {
  if (!connection.user) {
    return true;
  }
  
  // Anonymous users don't need re-auth
  if (connection.isAnonymous) {
    return false;
  }
  
  // Authenticated users should re-auth every hour
  const authTime = connection.authTime || connection.connectionTime;
  const hourInMs = 60 * 60 * 1000;
  
  return (Date.now() - authTime) > hourInMs;
}

module.exports = {
  handleAuth,
  isValidConnection,
  getUserDisplayInfo,
  needsReauth
};