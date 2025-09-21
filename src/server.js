require('dotenv').config();

// Import production configuration
const { getProductionConfig } = require('./config/production');
const productionConfig = getProductionConfig();

// Get production-optimized server configuration
const wsConfig = productionConfig.getWebSocketConfig();

const fastify = require('fastify')({ 
  logger: false, // Disable default logger, we'll use our custom logger
  requestIdLogLabel: 'reqId',
  requestIdHeader: 'x-request-id',
  ...wsConfig.server
});

// Import utilities
const logger = require('./utils/logger');
const validator = require('./utils/validation');
const errorHandler = require('./utils/errorHandler');
const rateLimiter = require('./utils/rateLimiter');

// Import security modules
const securityRateLimiter = require('./security/rateLimiter');
const securityValidator = require('./security/validator');
const authSecurity = require('./security/authSecurity');

// Import database and auth
const { testConnection, upsertUser, updateUserActivity } = require('./database');
const { authenticateRequest } = require('./auth');

// Import handlers
const { handleAuth, isValidConnection, getUserDisplayInfo, needsReauth } = require('./handlers/auth');
const { handleThreadMessage } = require('./handlers/threads');
const { handleChatMessage } = require('./handlers/chat');
const { 
  handleAICanisterMessage, 
  forwardMessageToAI, 
  isAICanisterAvailable,
  handleAICanisterDisconnect 
} = require('./handlers/ai-canister');
const { AIConnectionManager } = require('./handlers/ai');
const { v4: uuidv4 } = require('uuid');

// Global connection tracking
const connections = new Map();

// Initialize AI Connection Manager
const aiManager = new AIConnectionManager();

// Register WebSocket plugin
fastify.register(require('@fastify/websocket'));

// CORS configuration using production config
fastify.register(require('@fastify/cors'), productionConfig.getCorsConfig());

// Initialize comprehensive health checker
const { HealthChecker } = require('./health/healthCheck');
const healthChecker = new HealthChecker({
  timeout: 10000,
  retries: 2,
  intervalMs: 30000
});

// Health check endpoints
fastify.get('/health', async (request, reply) => {
  try {
    const healthStatus = await healthChecker.performHealthCheck();
    
    // Set appropriate HTTP status code based on health
    if (healthStatus.status === 'healthy') {
      reply.code(200);
    } else if (healthStatus.status === 'degraded') {
      reply.code(503);
    } else {
      reply.code(503);
    }
    
    return healthStatus;
  } catch (error) {
    const handledError = errorHandler.handleInternalError(error, 'health_check');
    logger.error('Health check error', {
      error: error.message,
      stack: error.stack,
      requestId: request.id
    });
    
    reply.code(500);
    return {
      status: 'error',
      timestamp: new Date().toISOString(),
      error: 'Health check failed',
      requestId: request.id
    };
  }
});

// Detailed health check endpoint for Railway monitoring
fastify.get('/health/detailed', async (request, reply) => {
  try {
    const detailedHealth = await healthChecker.performDetailedHealthCheck();
    
    if (detailedHealth.status === 'healthy') {
      reply.code(200);
    } else {
      reply.code(503);
    }
    
    return detailedHealth;
  } catch (error) {
    logger.error('Detailed health check error', { error: error.message });
    reply.code(500);
    return { status: 'error', error: 'Detailed health check failed' };
  }
});

// Root route - API info and status
fastify.get('/', async (request, reply) => {
  return {
    name: 'AVAI WebSocket Backend',
    version: process.env.npm_package_version || '1.0.0',
    status: 'running',
    platform: productionConfig.getAllConfig().environment.platform || 'generic',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      websocket: '/ws',
      metrics: '/metrics'
    }
  };
});

// Individual service health checks
fastify.get('/health/database', async (request, reply) => {
  try {
    const dbHealth = await healthChecker.checkDatabaseHealth();
    reply.code(dbHealth.healthy ? 200 : 503);
    return dbHealth;
  } catch (error) {
    reply.code(500);
    return { healthy: false, error: error.message };
  }
});

fastify.get('/health/memory', async (request, reply) => {
  try {
    const memoryHealth = await healthChecker.checkMemoryHealth();
    reply.code(memoryHealth.healthy ? 200 : 503);
    return memoryHealth;
  } catch (error) {
    reply.code(500);
    return { healthy: false, error: error.message };
  }
});

// Metrics endpoint for Railway monitoring
fastify.get('/metrics', async (request, reply) => {
  try {
    const metrics = await healthChecker.getMetrics();
    reply.code(200);
    return metrics;
  } catch (error) {
    reply.code(500);
    return { error: 'Failed to get metrics' };
  }
});

// Message size validation
function validateMessageSize(messageBuffer) {
  const maxSize = parseInt(process.env.MAX_MESSAGE_SIZE) || (10 * 1024); // 10KB default limit
  if (messageBuffer.length > maxSize) {
    return { 
      isValid: false, 
      error: `Message exceeds maximum size of ${Math.round(maxSize / 1024)}KB` 
    };
  }
  return { isValid: true };
}

// Cleanup inactive connections periodically
setInterval(() => {
  const now = Date.now();
  const timeout = parseInt(process.env.CONNECTION_TIMEOUT) || (30 * 60 * 1000); // 30 minutes default
  let cleanedCount = 0;
  
  for (const [connectionId, conn] of connections.entries()) {
    if (now - conn.lastActivity > timeout) {
      logger.logConnection('cleanup_inactive', connectionId, conn.user?.id, {
        inactiveTime: now - conn.lastActivity,
        userType: conn.isAnonymous ? 'anonymous' : 'authenticated'
      });
      
      // Close connection if still open
      try {
        if (conn.socket && conn.socket.readyState === conn.socket.OPEN) {
          conn.socket.close(1000, 'Connection inactive');
        }
      } catch (closeError) {
        logger.warn('Error closing inactive connection', {
          connectionId,
          error: closeError.message
        });
      }
      
      connections.delete(connectionId);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    logger.info('Connection cleanup completed', {
      cleanedConnections: cleanedCount,
      activeConnections: connections.size
    });
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// WebSocket route for chat connections
try {
  fastify.get('/ws', { websocket: true }, (socket, request) => {
    const connectionId = uuidv4();
    const connectionTime = Date.now();
    const clientIP = request.ip;
    const userAgent = request.headers['user-agent'] || '';
    
    try {
      // Pre-connection security checks
      const connectionRateLimit = securityRateLimiter.checkRateLimit('connection', {
        ip: clientIP,
        isAuthenticated: false
      });
      
      if (!connectionRateLimit.allowed) {
        logger.logSecurity('connection_rate_limited', {
          ip: clientIP,
          userAgent,
          reason: connectionRateLimit.reason
        });
        
        socket.close(1013, 'Connection rate limit exceeded');
        return;
      }
      
      // Check if IP is blocked due to failed auth attempts
      const ipStatus = authSecurity.isIPBlocked(clientIP);
      if (ipStatus.blocked) {
        logger.logSecurity('blocked_ip_connection_attempt', {
          ip: clientIP,
          userAgent,
          blockedUntil: ipStatus.blockedUntil,
          remainingTime: ipStatus.remainingTime
        });
        
        socket.close(1013, 'IP temporarily blocked');
        return;
      }
      
      logger.logConnection('new_connection', connectionId, null, {
        userAgent,
        origin: request.headers.origin,
        ip: clientIP,
        rateLimitRemaining: connectionRateLimit.remaining
      });
      
      // Initialize connection object
      const connObj = {
        id: connectionId,
        socket: socket, // In Fastify WebSocket v11+, first param is the socket
        user: null,
        isAuthenticated: false,
        isAnonymous: false,
        connectionTime: connectionTime,
        lastActivity: connectionTime,
        authTime: null,
        messageCount: 0,
        errorCount: 0,
        ip: clientIP,
        userAgent: userAgent,
        securityFlags: [],
        riskLevel: 'LOW'
      };
      
      // Store connection
      connections.set(connectionId, connObj);
      
      logger.info('WebSocket connection established', {
        connectionId,
        activeConnections: connections.size,
        userAgent: request.headers['user-agent']
      });

      // Send welcome message with error handling
      try {
        // In Fastify WebSocket, connection is the socket directly
        socket.send(JSON.stringify({
          type: 'welcome',
          message: 'Connected to AVAI chat server - please authenticate',
          connectionId: connectionId,
          timestamp: new Date().toISOString(),
          serverVersion: process.env.npm_package_version || '1.0.0'
        }));
      } catch (sendError) {
        logger.error('Failed to send welcome message', {
          connectionId,
          error: sendError.message
        });
      }

      // Handle incoming messages
      socket.on('message', async (messageBuffer) => {
        const messageTimer = logger.createTimer('message_processing');
        
        try {
          // Update last activity
          connObj.lastActivity = Date.now();
          connObj.messageCount++;
          
          // Validate message size
          const sizeValidation = validateMessageSize(messageBuffer);
          if (!sizeValidation.isValid) {
            const error = errorHandler.handleValidationError(
              [sizeValidation.error],
              { connectionId, field: 'messageSize', messageSize: messageBuffer.length }
            );
            errorHandler.sendErrorResponse(socket, error);
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'message_too_large' });
            return;
          }
          
          // Parse message first to get type for rate limiting
          let message;
          try {
            message = JSON.parse(messageBuffer.toString());
          } catch (parseError) {
            const error = errorHandler.handleValidationError(
              ['Invalid JSON format'],
              { connectionId, parseError: parseError.message }
            );
            errorHandler.sendErrorResponse(socket, error);
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'invalid_json' });
            return;
          }
          
          // Enhanced security validation
          const securityValidation = securityValidator.validateInput(message, {
            blockXSS: true,
            blockSQL: true,
            blockCommand: true,
            blockPath: true
          });
          
          if (!securityValidation.isValid) {
            connObj.securityFlags.push(...securityValidation.threats.map(t => t.type));
            connObj.riskLevel = securityValidation.riskLevel;
            
            logger.logSecurity('message_security_violation', {
              connectionId,
              userId: connObj.user?.id,
              ip: connObj.ip,
              threats: securityValidation.threats,
              riskLevel: securityValidation.riskLevel,
              messageType: message.type
            });
            
            const securityError = {
              type: 'error',
              error_type: 'SECURITY_VIOLATION',
              message: 'Message contains potentially harmful content',
              timestamp: new Date().toISOString(),
              threats: securityValidation.threats.map(t => t.type)
            };
            
            try {
              socket.send(JSON.stringify(securityError));
            } catch (sendError) {
              logger.error('Failed to send security error response', {
                connectionId,
                error: sendError.message
              });
            }
            
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'security_violation' });
            return;
          }
          
          // Use sanitized message
          message = securityValidation.sanitizedData;
          
          // Legacy validation for backward compatibility
          const validation = validator.validateMessage(message);
          if (!validation.success) {
            const error = errorHandler.handleValidationError(
              validation.errors,
              { 
                connectionId, 
                userId: connObj.user?.id,
                messageType: message.type,
                originalMessage: message 
              }
            );
            errorHandler.sendErrorResponse(socket, error);
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'validation_failed' });
            return;
          }
          
          // Enhanced rate limiting
          const rateLimitContext = {
            userId: connObj.user?.id,
            connectionId: connectionId,
            ip: connObj.ip,
            isAuthenticated: connObj.isAuthenticated
          };
          
          const securityRateLimit = securityRateLimiter.checkRateLimit('message', rateLimitContext);
          
          if (!securityRateLimit.allowed) {
            logger.logSecurity('message_rate_limited', {
              connectionId,
              userId: connObj.user?.id,
              ip: connObj.ip,
              messageType: message.type,
              reason: securityRateLimit.reason
            });
            
            const rateLimitError = {
              type: 'error',
              error_type: 'RATE_LIMIT',
              message: 'Rate limit exceeded',
              retry_after: Math.ceil(securityRateLimit.resetIn / 1000),
              timestamp: new Date().toISOString()
            };
            
            try {
              socket.send(JSON.stringify(rateLimitError));
            } catch (sendError) {
              logger.error('Failed to send rate limit error response', {
                connectionId,
                error: sendError.message
              });
            }
            
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'rate_limited' });
            return;
          }
          
          // Legacy rate limiting for backward compatibility
          const rateLimitResult = rateLimiter.checkWebSocketMessage(
            connObj.user?.id,
            connectionId,
            message.type,
            connObj.isAnonymous
          );
          
          if (!rateLimitResult.allowed) {
            errorHandler.sendErrorResponse(socket, rateLimitResult.error);
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'legacy_rate_limited' });
            return;
          }
          
          // Log incoming message
          logger.logWebSocketEvent('message_received', connectionId, connObj.user?.id, {
            type: message.type,
            messageCount: connObj.messageCount,
            authenticated: connObj.isAuthenticated,
            anonymous: connObj.isAnonymous
          });

          // Check if this is an AI canister connection attempt
          if (message.type === 'ai_auth' || connObj.isAICanister) {
            try {
              await handleAICanisterMessage(connObj, message, logger, connections);
              messageTimer.end({ success: true, messageType: message.type });
            } catch (aiError) {
              const error = errorHandler.handleAIConnectionError(aiError, 'ai_canister_message', {
                connectionId,
                messageType: message.type
              });
              errorHandler.sendErrorResponse(socket, error);
              connObj.errorCount++;
              messageTimer.end({ success: false, error: 'ai_canister_error' });
            }
            return;
          }

          // Route messages by type with comprehensive error handling
          try {
            switch (message.type) {
              case 'authenticate':
                await handleAuth(connObj, message, logger);
                if (connObj.user) {
                  connObj.authTime = Date.now();
                  logger.logAuthentication(
                    true, 
                    connObj.user.id, 
                    connectionId, 
                    null,
                    { anonymous: connObj.isAnonymous }
                  );
                }
                messageTimer.end({ success: true, messageType: message.type });
                break;
                
              case 'heartbeat':
                try {
                  socket.send(JSON.stringify({
                    type: 'heartbeat_ack',
                    timestamp: new Date().toISOString(),
                    serverTime: Date.now()
                  }));
                  messageTimer.end({ success: true, messageType: message.type });
                } catch (sendError) {
                  throw new Error(`Failed to send heartbeat acknowledgment: ${sendError.message}`);
                }
                break;
                
              // Chat message operations
              case 'send_message':
              case 'typing_indicator':
                await handleChatMessage(connObj, message, logger, connections, aiManager, connectionId);
                messageTimer.end({ success: true, messageType: message.type });
                break;
                
              // Thread management operations
              case 'create_thread':
              case 'get_threads':
              case 'get_thread_messages':
              case 'delete_thread':
              case 'update_thread_title':
                await handleThreadMessage(connObj, message, logger);
                messageTimer.end({ success: true, messageType: message.type });
                break;
                
              default:
                const error = errorHandler.handleValidationError(
                  [`Unknown message type: ${message.type}`],
                  { connectionId, messageType: message.type, userId: connObj.user?.id }
                );
                errorHandler.sendErrorResponse(socket, error);
                connObj.errorCount++;
                messageTimer.end({ success: false, error: 'unknown_message_type' });
            }
          } catch (handlerError) {
            const error = errorHandler.handleInternalError(handlerError, `handle_${message.type}`, {
              connectionId,
              userId: connObj.user?.id,
              messageType: message.type
            });
            errorHandler.sendErrorResponse(socket, error);
            connObj.errorCount++;
            messageTimer.end({ success: false, error: 'handler_error' });
          }
          
        } catch (unexpectedError) {
          // Handle any unexpected errors during message processing
          const error = errorHandler.handleInternalError(unexpectedError, 'message_processing', {
            connectionId,
            userId: connObj.user?.id,
            messageCount: connObj.messageCount,
            errorCount: connObj.errorCount
          });
          
          errorHandler.sendErrorResponse(socket, error);
          connObj.errorCount++;
          messageTimer.end({ success: false, error: 'unexpected_error' });
          
          // If too many errors, consider closing the connection
          if (connObj.errorCount > 10) {
            logger.warn('Connection exceeded error threshold', {
              connectionId,
              userId: connObj.user?.id,
              errorCount: connObj.errorCount,
              messageCount: connObj.messageCount
            });
            
            try {
              socket.close(1003, 'Too many errors');
            } catch (closeError) {
              logger.error('Failed to close problematic connection', {
                connectionId,
                error: closeError.message
              });
            }
          }
        }
      });

      // Handle connection close
      socket.on('close', (code, reason) => {
        const userInfo = getUserDisplayInfo(connObj);
        const connectionDuration = Date.now() - connObj.connectionTime;
        
        // Handle AI canister disconnect
        if (connObj.isAICanister) {
          try {
            handleAICanisterDisconnect(logger);
          } catch (aiDisconnectError) {
            logger.error('Error handling AI canister disconnect', {
              connectionId,
              error: aiDisconnectError.message
            });
          }
        }
        
        // Decrement connection count in rate limiter
        securityRateLimiter.decrementConnection({
          ip: connObj.ip,
          userId: connObj.user?.id,
          connectionId: connectionId
        });
        
        logger.logConnection('connection_closed', connectionId, connObj.user?.id, {
          closeCode: code,
          closeReason: reason ? reason.toString() : 'No reason provided',
          duration: connectionDuration,
          messageCount: connObj.messageCount,
          errorCount: connObj.errorCount,
          userType: connObj.isAnonymous ? 'anonymous' : 'authenticated',
          wasAuthenticated: connObj.isAuthenticated,
          securityFlags: connObj.securityFlags,
          riskLevel: connObj.riskLevel,
          ip: connObj.ip
        });
        
        // Cleanup
        connections.delete(connectionId);
        
        logger.info('WebSocket connection closed', {
          connectionId,
          userInfo,
          closeCode: code,
          duration: connectionDuration,
          messagesProcessed: connObj.messageCount,
          errorsEncountered: connObj.errorCount,
          activeConnections: connections.size,
          securityInfo: {
            flags: connObj.securityFlags,
            riskLevel: connObj.riskLevel
          }
        });
      });

      // Handle connection errors
      socket.on('error', (error) => {
        const userInfo = getUserDisplayInfo(connObj);
        const wsError = errorHandler.handleWebSocketError(error, 'connection_error', {
          connectionId,
          userId: connObj.user?.id,
          wsReadyState: socket.readyState,
          messageCount: connObj.messageCount,
          errorCount: connObj.errorCount
        });
        
        connObj.errorCount++;
        
        logger.error('WebSocket connection error', {
          connectionId,
          userInfo,
          error: error.message,
          wsReadyState: socket.readyState,
          errorCount: connObj.errorCount
        });
      });

    } catch (setupError) {
      const error = errorHandler.handleWebSocketError(setupError, 'connection_setup', {
        connectionId,
        requestHeaders: request.headers,
        ip: request.ip
      });
      
      logger.error('WebSocket setup error', {
        connectionId,
        error: setupError.message,
        stack: setupError.stack,
        requestHeaders: request.headers,
        ip: request.ip
      });
      
      // Try to close the connection safely
      try {
        if (socket && typeof socket.close === 'function') {
          socket.close(1011, 'Server error during setup');
        }
      } catch (closeError) {
        logger.error('Error closing WebSocket connection after setup error', {
          connectionId,
          closeError: closeError.message
        });
      }
      
      // Cleanup on error
      connections.delete(connectionId);
    }
  });
} catch (setupError) {
  console.error('WebSocket setup error:', setupError);
}
// Error handler
fastify.setErrorHandler(async (error, request, reply) => {
  const handledError = errorHandler.handleInternalError(error, 'fastify_error_handler', {
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: request.id
  });
  
  logger.error('Fastify error handler', {
    error: error.message,
    stack: error.stack,
    method: request.method,
    url: request.url,
    requestId: request.id,
    statusCode: error.statusCode || 500
  });
  
  // Format error response
  const errorResponse = errorHandler.formatErrorResponse(
    handledError, 
    process.env.NODE_ENV === 'development'
  );
  
  reply.status(handledError.statusCode || 500).send({
    ...errorResponse,
    requestId: request.id
  });
});

// Not found handler
fastify.setNotFoundHandler(async (request, reply) => {
  logger.warn('Route not found', {
    method: request.method,
    url: request.url,
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: request.id
  });
  
  reply.status(404).send({
    error: 'Not Found',
    message: `Route ${request.method} ${request.url} not found`,
    timestamp: new Date().toISOString(),
    requestId: request.id
  });
});

// Graceful shutdown handling
const gracefulShutdown = async (signal) => {
  logger.info(`Received ${signal}. Starting graceful shutdown...`, {
    signal,
    activeConnections: connections.size,
    uptime: process.uptime()
  });
  
  try {
    // Notify all active connections of shutdown
    const shutdownMessage = JSON.stringify({
      type: 'server_shutdown',
      message: 'Server is shutting down gracefully',
      timestamp: new Date().toISOString()
    });
    
    for (const [connectionId, connObj] of connections.entries()) {
      try {
        if (connObj.socket && connObj.socket.readyState === connObj.socket.OPEN) {
          connObj.socket.send(shutdownMessage);
          setTimeout(() => {
            connObj.socket.close(1001, 'Server shutdown');
          }, 1000);
        }
      } catch (notifyError) {
        logger.warn('Failed to notify connection of shutdown', {
          connectionId,
          error: notifyError.message
        });
      }
    }
    
    // Disconnect AI manager
    if (aiManager) {
      try {
        aiManager.disconnect();
        logger.info('AI Connection Manager disconnected');
      } catch (aiError) {
        logger.error('Error disconnecting AI manager', {
          error: aiError.message
        });
      }
    }
    
    // Shutdown health checker
    try {
      if (healthChecker) {
        healthChecker.stopBackgroundMonitoring();
        logger.info('Health checker shutdown completed');
      }
    } catch (healthError) {
      logger.error('Error shutting down health checker', {
        error: healthError.message
      });
    }

    // Shutdown rate limiter
    try {
      rateLimiter.shutdown();
      logger.info('Rate limiter shutdown completed');
    } catch (rateLimiterError) {
      logger.error('Error shutting down rate limiter', {
        error: rateLimiterError.message
      });
    }
    
    // Close server with production timeout
    const shutdownTimeout = productionConfig.isProduction ? 10000 : 5000;
    const shutdownTimer = setTimeout(() => {
      logger.error('Forced shutdown due to timeout');
      process.exit(1);
    }, shutdownTimeout);
    
    await fastify.close();
    clearTimeout(shutdownTimer);
    logger.info('Server closed successfully');
    process.exit(0);
  } catch (shutdownError) {
    logger.error('Error during shutdown', {
      error: shutdownError.message,
      stack: shutdownError.stack
    });
    process.exit(1);
  }
};

// Listen for shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception - Server will exit', {
    error: error.message,
    stack: error.stack,
    activeConnections: connections.size
  });
  
  // Try graceful shutdown
  setTimeout(() => {
    process.exit(1);
  }, 5000);
  
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection - Server will exit', {
    reason: reason instanceof Error ? reason.message : String(reason),
    stack: reason instanceof Error ? reason.stack : undefined,
    promise: promise.toString(),
    activeConnections: connections.size
  });
  
  // Try graceful shutdown
  setTimeout(() => {
    process.exit(1);
  }, 5000);
  
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
const start = async () => {
  const startupTimer = logger.createTimer('server_startup');
  
  try {
    logger.info('Starting AVAI WebSocket server...', {
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development',
      pid: process.pid
    });
    
    // Test database connection on startup
    const dbTimer = logger.createTimer('database_connection_test');
    const dbConnected = await testConnection();
    dbTimer.end({ success: dbConnected });
    
    if (!dbConnected) {
      logger.warn('Database connection failed, but server will continue to start');
    } else {
      logger.info('Database connection established successfully');
    }

    // Use production configuration for server settings
    const port = productionConfig.port;
    const host = productionConfig.host;

    // Initialize health checker with dependencies
    healthChecker.setDependencies({
      database: { testConnection },
      connectionManager: { getConnections: () => connections },
      aiService: aiManager
    });

    // Start health monitoring
    if (productionConfig.isProduction) {
      healthChecker.startBackgroundMonitoring();
      logger.info('Background health monitoring started');
    }

    await fastify.listen({ port, host });
    
    // Log comprehensive startup information
    logger.info('AVAI chat server started successfully', {
      port,
      host,
      websocketEndpoint: `ws://${host}:${port}/ws`,
      healthEndpoint: `http://${host}:${port}/health`,
      detailedHealthEndpoint: `http://${host}:${port}/health/detailed`,
      metricsEndpoint: `http://${host}:${port}/metrics`,
      environment: process.env.NODE_ENV || 'development',
      railwayUrl: productionConfig.railwayUrl,
      maxConnections: productionConfig.maxConnections,
      productionMode: productionConfig.isProduction
    });

    // Log production configuration summary
    if (productionConfig.isProduction) {
      productionConfig.logConfigSummary();
    }
    
    // Initialize AI connection manager
    try {
      aiManager.setLogger(logger);
      aiManager.setUserConnections(connections);
      
      // Connect to AI canister with retry logic
      const aiTimer = logger.createTimer('ai_connection_setup');
      const aiConnected = await errorHandler.executeWithRetry(
        () => aiManager.connectToAI(),
        { operation: 'ai_canister_connection' },
        3,
        2000
      );
      
      aiTimer.end({ success: aiConnected });
      
      if (aiConnected) {
        logger.info('AI Connection Manager initialized successfully');
      } else {
        logger.warn('AI Connection Manager initialization failed - continuing without AI features');
      }
    } catch (aiError) {
      logger.error('Failed to initialize AI Connection Manager', {
        error: aiError.message,
        stack: aiError.stack
      });
      logger.warn('Server will continue without AI features');
    }
    
    // Log startup completion
    const startupDuration = startupTimer.end({ success: true });
    logger.info('Server startup completed', {
      startupTime: startupDuration,
      memoryUsage: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development'
    });
    
  } catch (startupError) {
    const error = errorHandler.handleInternalError(startupError, 'server_startup');
    
    logger.error('Server startup failed', {
      error: startupError.message,
      stack: startupError.stack,
      pid: process.pid
    });
    
    startupTimer.end({ success: false, error: startupError.message });
    console.error('Server startup failed:', startupError);
    process.exit(1);
  }
};

// Start the server
start();

module.exports = fastify;