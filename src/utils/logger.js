/**
 * Enhanced Structured Logging System for AVAI WebSocket Backend
 * Production-ready logging with Railway optimization, JSON formatting, and performance monitoring
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

class Logger {
  constructor() {
    this.logLevel = this.getLogLevel();
    this.isProduction = process.env.NODE_ENV === 'production';
    this.isDevelopment = process.env.NODE_ENV === 'development';
    this.isRailway = !!process.env.RAILWAY_STATIC_URL;
    this.logLevels = { error: 0, warn: 1, info: 2, debug: 3 };
    this.currentLevel = this.logLevels[this.logLevel];
    
    // Railway deployment info
    this.deploymentInfo = {
      service: 'avai-websocket',
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      railwayEnvironment: process.env.RAILWAY_ENVIRONMENT_NAME,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID,
      serviceId: process.env.RAILWAY_SERVICE_ID,
      hostname: os.hostname(),
      pid: process.pid,
      nodeVersion: process.version
    };
    
    // Performance metrics
    this.metrics = {
      logsWritten: 0,
      errorsLogged: 0,
      lastLogTime: Date.now(),
      avgLogSize: 0,
      totalLogSize: 0
    };
    
    // Log rotation for production
    this.logRotation = {
      enabled: this.isProduction,
      maxFiles: 5,
      maxSize: 10 * 1024 * 1024, // 10MB
      currentSize: 0
    };
    
    // Request correlation
    this.requestContext = new Map();
    
    // Initialize logging system
    this.initializeLogging();
  }

  /**
   * Initialize logging system with production optimizations
   */
  initializeLogging() {
    // Create logs directory only for local development
    if (!this.isRailway && !this.isProduction) {
      this.logsDir = path.join(process.cwd(), 'logs');
      this.ensureLogsDirectory();
    }
    
    // Start metrics collection for production
    if (this.isProduction) {
      setInterval(() => {
        this.flushMetrics();
      }, 60000); // Every minute
    }
    
    console.log(`📋 Logger initialized - Level: ${this.logLevel}, Production: ${this.isProduction}, Railway: ${this.isRailway}`);
  }

  /**
   * Get log level from environment with production defaults
   */
  getLogLevel() {
    let defaultLevel = 'info';
    
    // Production defaults to 'warn' for performance
    if (this.isProduction) {
      defaultLevel = 'warn';
    }
    
    const level = process.env.LOG_LEVEL || defaultLevel;
    const validLevels = ['error', 'warn', 'info', 'debug'];
    return validLevels.includes(level) ? level : defaultLevel;
  }

  /**
   * Ensure logs directory exists (local development only)
   */
  ensureLogsDirectory() {
    try {
      if (!fs.existsSync(this.logsDir)) {
        fs.mkdirSync(this.logsDir, { recursive: true });
      }
    } catch (error) {
      console.error('Failed to create logs directory:', error);
    }
  }

  /**
   * Set request context for correlation
   * @param {string} requestId - Request ID
   * @param {Object} context - Request context
   */
  setRequestContext(requestId, context) {
    this.requestContext.set(requestId, {
      ...context,
      timestamp: Date.now()
    });
    
    // Clean up old contexts (prevent memory leaks)
    if (this.requestContext.size > 1000) {
      const entries = Array.from(this.requestContext.entries());
      const old = entries.filter(([_, ctx]) => Date.now() - ctx.timestamp > 300000); // 5 minutes
      old.forEach(([id]) => this.requestContext.delete(id));
    }
  }

  /**
   * Get request context
   * @param {string} requestId - Request ID
   * @returns {Object} Request context
   */
  getRequestContext(requestId) {
    return this.requestContext.get(requestId) || {};
  }

  /**
   * Format log entry with Railway-optimized structure
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   * @returns {Object} Formatted log entry
   */
  formatLogEntry(level, message, metadata = {}) {
    const timestamp = new Date().toISOString();
    
    // Base log entry with Railway compatibility
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: this.deploymentInfo.service,
      version: this.deploymentInfo.version,
      environment: this.deploymentInfo.environment,
      message,
      
      // Railway-specific fields
      ...(this.isRailway && {
        railway: {
          environment: this.deploymentInfo.railwayEnvironment,
          deploymentId: this.deploymentInfo.deploymentId,
          serviceId: this.deploymentInfo.serviceId
        }
      }),
      
      // System information
      system: {
        hostname: this.deploymentInfo.hostname,
        pid: this.deploymentInfo.pid,
        nodeVersion: this.deploymentInfo.nodeVersion,
        uptime: Math.floor(process.uptime()),
        memoryUsage: this.isProduction ? this.getMemoryUsage() : undefined
      }
    };

    // Add request context if available
    if (metadata.requestId) {
      const context = this.getRequestContext(metadata.requestId);
      if (Object.keys(context).length > 0) {
        logEntry.request = context;
      }
    }

    // Add metadata
    if (Object.keys(metadata).length > 0) {
      logEntry.metadata = metadata;
    }

    // Add performance timing if available
    if (metadata.duration_ms) {
      logEntry.performance = {
        duration_ms: metadata.duration_ms,
        slow: metadata.duration_ms > 1000
      };
    }

    return logEntry;
  }

  /**
   * Get memory usage information
   * @returns {Object} Memory usage stats
   */
  getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
      heapUsed: Math.round(usage.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(usage.heapTotal / 1024 / 1024), // MB
      external: Math.round(usage.external / 1024 / 1024), // MB
      rss: Math.round(usage.rss / 1024 / 1024) // MB
    };
  }

  /**
   * Write log with Railway optimization and performance tracking
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} metadata - Additional metadata
   */
  writeLog(level, message, metadata = {}) {
    // Skip if log level is too low
    if (this.logLevels[level] > this.currentLevel) {
      return;
    }

    const startTime = Date.now();
    const logEntry = this.formatLogEntry(level, message, metadata);
    
    try {
      // Railway and production: JSON output to stdout
      if (this.isRailway || this.isProduction) {
        const logString = JSON.stringify(logEntry);
        console.log(logString);
        
        // Update metrics
        this.updateMetrics(level, logString.length);
        
      } else {
        // Development: Pretty formatted output
        this.writeFormattedLog(level, message, logEntry, metadata);
      }

      // Write to file only in local development
      if (!this.isRailway && !this.isProduction && this.logsDir) {
        this.writeToFile(level, JSON.stringify(logEntry));
      }

    } catch (error) {
      // Fallback logging if main logging fails
      console.error('Logging error:', error.message);
      console.log(`[${level.toUpperCase()}] ${message}`);
    }
  }

  /**
   * Write formatted log for development
   * @param {string} level - Log level
   * @param {string} message - Log message
   * @param {Object} logEntry - Full log entry
   * @param {Object} metadata - Additional metadata
   */
  writeFormattedLog(level, message, logEntry, metadata) {
    const colors = {
      error: '\x1b[31m',   // Red
      warn: '\x1b[33m',    // Yellow
      info: '\x1b[36m',    // Cyan
      debug: '\x1b[35m'    // Magenta
    };
    const reset = '\x1b[0m';
    const timestamp = new Date().toLocaleTimeString();
    
    // Main log line
    console.log(`${colors[level]}[${level.toUpperCase()}]${reset} ${timestamp} ${message}`);
    
    // Metadata if present
    if (Object.keys(metadata).length > 0) {
      console.log('  └─', JSON.stringify(metadata, null, 2));
    }
    
    // Performance info if slow
    if (metadata.duration_ms && metadata.duration_ms > 1000) {
      console.log(`  └─ ⏱️  ${metadata.duration_ms}ms (SLOW)`);
    }
  }

  /**
   * Update logging metrics
   * @param {string} level - Log level
   * @param {number} size - Log entry size
   */
  updateMetrics(level, size) {
    this.metrics.logsWritten++;
    this.metrics.totalLogSize += size;
    this.metrics.avgLogSize = this.metrics.totalLogSize / this.metrics.logsWritten;
    this.metrics.lastLogTime = Date.now();
    
    if (level === 'error') {
      this.metrics.errorsLogged++;
    }
  }

  /**
   * Flush metrics to logs
   */
  flushMetrics() {
    if (this.metrics.logsWritten === 0) return;
    
    const metricsEntry = {
      timestamp: new Date().toISOString(),
      level: 'INFO',
      service: this.deploymentInfo.service,
      message: 'Logging metrics',
      metrics: {
        ...this.metrics,
        errorRate: this.metrics.errorsLogged / this.metrics.logsWritten,
        logsPerMinute: this.metrics.logsWritten // Reset every minute
      }
    };
    
    console.log(JSON.stringify(metricsEntry));
    
    // Reset counters
    this.metrics.logsWritten = 0;
    this.metrics.errorsLogged = 0;
  }

  /**
   * Write log to file
   * @param {string} level - Log level
   * @param {string} logString - Formatted log string
   */
  writeToFile(level, logString) {
    try {
      const date = new Date().toISOString().split('T')[0];
      const filename = path.join(this.logsDir, `${date}.log`);
      const errorFilename = path.join(this.logsDir, `${date}-errors.log`);

      // Write to general log file
      fs.appendFileSync(filename, logString + '\n');

      // Write errors to separate error log file
      if (level === 'error') {
        fs.appendFileSync(errorFilename, logString + '\n');
      }
    } catch (error) {
      console.error('Failed to write to log file:', error);
    }
  }

  /**
   * Log error level messages
   * @param {string} message - Error message
   * @param {Object} metadata - Additional metadata
   */
  error(message, metadata = {}) {
    this.writeLog('error', message, {
      ...metadata,
      stack: metadata.error?.stack || metadata.stack
    });
  }

  /**
   * Log warning level messages
   * @param {string} message - Warning message
   * @param {Object} metadata - Additional metadata
   */
  warn(message, metadata = {}) {
    this.writeLog('warn', message, metadata);
  }

  /**
   * Log info level messages
   * @param {string} message - Info message
   * @param {Object} metadata - Additional metadata
   */
  info(message, metadata = {}) {
    this.writeLog('info', message, metadata);
  }

  /**
   * Log debug level messages
   * @param {string} message - Debug message
   * @param {Object} metadata - Additional metadata
   */
  debug(message, metadata = {}) {
    this.writeLog('debug', message, metadata);
  }

  /**
   * Log WebSocket events
   * @param {string} event - Event type
   * @param {string} connectionId - Connection ID
   * @param {string} userId - User ID
   * @param {Object} data - Event data
   */
  logWebSocketEvent(event, connectionId, userId = null, data = {}) {
    this.info('WebSocket event', {
      event,
      connectionId,
      userId,
      userType: userId ? 'authenticated' : 'anonymous',
      messageType: data.type || 'unknown',
      dataSize: JSON.stringify(data).length
    });
  }

  /**
   * Log database operations
   * @param {string} operation - Database operation type
   * @param {string} table - Database table
   * @param {string} userId - User ID
   * @param {boolean} success - Operation success status
   * @param {number} duration - Operation duration in ms
   * @param {Object} metadata - Additional metadata
   */
  logDatabaseOperation(operation, table, userId = null, success, duration, metadata = {}) {
    const level = success ? 'info' : 'error';
    this[level]('Database operation', {
      operation,
      table,
      userId,
      success,
      duration_ms: duration,
      ...metadata
    });
  }

  /**
   * Log AI interactions
   * @param {string} action - AI action type
   * @param {string} threadId - Thread ID
   * @param {string} userId - User ID
   * @param {boolean} success - Operation success status
   * @param {number} processingTime - Processing time in ms
   * @param {Object} metadata - Additional metadata
   */
  logAIInteraction(action, threadId, userId = null, success, processingTime = null, metadata = {}) {
    const level = success ? 'info' : 'warn';
    this[level]('AI interaction', {
      action,
      threadId,
      userId,
      success,
      processing_time_ms: processingTime,
      ...metadata
    });
  }

  /**
   * Log authentication events
   * @param {boolean} success - Authentication success status
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {string} error - Error message if failed
   * @param {Object} metadata - Additional metadata
   */
  logAuthentication(success, userId = null, connectionId, error = null, metadata = {}) {
    const level = success ? 'info' : 'warn';
    this[level]('Authentication attempt', {
      success,
      userId,
      connectionId,
      error,
      authMethod: metadata.anonymous ? 'anonymous' : 'jwt',
      ...metadata
    });
  }

  /**
   * Log rate limiting events
   * @param {string} userId - User ID
   * @param {string} connectionId - Connection ID
   * @param {string} endpoint - Endpoint or operation
   * @param {boolean} exceeded - Whether rate limit was exceeded
   * @param {Object} metadata - Additional metadata
   */
  logRateLimit(userId = null, connectionId, endpoint, exceeded, metadata = {}) {
    const level = exceeded ? 'warn' : 'debug';
    this[level]('Rate limit check', {
      userId,
      connectionId,
      endpoint,
      exceeded,
      ...metadata
    });
  }

  /**
   * Log connection events
   * @param {string} event - Connection event type
   * @param {string} connectionId - Connection ID
   * @param {string} userId - User ID
   * @param {Object} metadata - Additional metadata
   */
  logConnection(event, connectionId, userId = null, metadata = {}) {
    this.info('Connection event', {
      event,
      connectionId,
      userId,
      ...metadata
    });
  }

  /**
   * Log validation events
   * @param {string} type - Validation type
   * @param {boolean} success - Validation success
   * @param {Array} errors - Validation errors
   * @param {Object} metadata - Additional metadata
   */
  logValidation(type, success, errors = [], metadata = {}) {
    const level = success ? 'debug' : 'warn';
    this[level]('Input validation', {
      validation_type: type,
      success,
      errors,
      ...metadata
    });
  }

  /**
   * Create performance timer
   * @param {string} operation - Operation name
   * @returns {Object} Timer object with end method
   */
  createTimer(operation) {
    const start = Date.now();
    return {
      end: (metadata = {}) => {
        const duration = Date.now() - start;
        this.debug('Performance timing', {
          operation,
          duration_ms: duration,
          ...metadata
        });
        return duration;
      }
    };
  }

  /**
   * Log system health metrics with Railway optimization
   * @param {Object} metrics - System health metrics
   */
  logHealthMetrics(metrics) {
    this.info('System health check', {
      ...metrics,
      memory_usage: this.getMemoryUsage(),
      uptime: Math.floor(process.uptime()),
      environment: this.deploymentInfo.environment,
      railway: this.isRailway
    });
  }

  /**
   * Log deployment events
   * @param {string} event - Deployment event type
   * @param {Object} metadata - Deployment metadata
   */
  logDeployment(event, metadata = {}) {
    this.info('Deployment event', {
      event,
      deploymentInfo: this.deploymentInfo,
      ...metadata
    });
  }

  /**
   * Log performance metrics
   * @param {Object} metrics - Performance metrics
   */
  logPerformanceMetrics(metrics) {
    this.info('Performance metrics', {
      ...metrics,
      memory: this.getMemoryUsage(),
      uptime: Math.floor(process.uptime()),
      loggingStats: {
        totalLogs: this.metrics.logsWritten,
        avgLogSize: Math.round(this.metrics.avgLogSize),
        errorRate: this.metrics.errorsLogged / Math.max(1, this.metrics.logsWritten)
      }
    });
  }

  /**
   * Log performance operation timing
   * @param {string} operation - Operation name
   * @param {number} duration - Duration in ms
   * @param {Object} metadata - Additional metadata
   */
  logPerformance(operation, duration, metadata = {}) {
    this.info(`Performance: ${operation}`, {
      duration: duration,
      operation: operation,
      ...metadata
    });
  }

  /**
   * Log security events with enhanced metadata
   * @param {string} event - Security event type
   * @param {string} severity - Event severity
   * @param {Object} metadata - Security metadata
   */
  logSecurityEvent(event, severity = 'medium', metadata = {}) {
    const level = severity === 'high' ? 'error' : 'warn';
    this[level]('Security event', {
      securityEvent: event,
      severity,
      timestamp: new Date().toISOString(),
      ...metadata
    });
  }

  /**
   * Log Railway-specific events
   * @param {string} event - Railway event type
   * @param {Object} metadata - Railway metadata
   */
  logRailwayEvent(event, metadata = {}) {
    if (!this.isRailway) return;
    
    this.info('Railway event', {
      railwayEvent: event,
      environment: this.deploymentInfo.railwayEnvironment,
      deploymentId: this.deploymentInfo.deploymentId,
      serviceId: this.deploymentInfo.serviceId,
      ...metadata
    });
  }

  /**
   * Create performance timer with enhanced tracking
   * @param {string} operation - Operation name
   * @param {Object} context - Operation context
   * @returns {Object} Timer object with end method
   */
  createPerformanceTimer(operation, context = {}) {
    const start = Date.now();
    const startCpu = process.cpuUsage();
    
    return {
      end: (metadata = {}) => {
        const duration = Date.now() - start;
        const cpuUsage = process.cpuUsage(startCpu);
        
        const performanceData = {
          operation,
          duration_ms: duration,
          cpu_usage: {
            user: Math.round(cpuUsage.user / 1000), // Convert to ms
            system: Math.round(cpuUsage.system / 1000)
          },
          ...context,
          ...metadata
        };
        
        // Log slow operations
        if (duration > 1000) {
          this.warn('Slow operation detected', performanceData);
        } else if (this.logLevel === 'debug') {
          this.debug('Performance timing', performanceData);
        }
        
        return duration;
      }
    };
  }

  /**
   * Log error with stack trace and context
   * @param {Error} error - Error object
   * @param {string} context - Error context
   * @param {Object} metadata - Additional metadata
   */
  logError(error, context = 'Unknown', metadata = {}) {
    this.error(`Error in ${context}: ${error.message}`, {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code
      },
      context,
      ...metadata
    });
  }

  /**
   * Log structured business events
   * @param {string} eventType - Business event type
   * @param {string} action - Action performed
   * @param {Object} data - Event data
   */
  logBusinessEvent(eventType, action, data = {}) {
    this.info('Business event', {
      eventType,
      action,
      timestamp: new Date().toISOString(),
      ...data
    });
  }

  /**
   * Get logger statistics
   * @returns {Object} Logger statistics
   */
  getStats() {
    return {
      config: {
        level: this.logLevel,
        isProduction: this.isProduction,
        isRailway: this.isRailway
      },
      metrics: this.metrics,
      deployment: this.deploymentInfo,
      performance: {
        activeContexts: this.requestContext.size,
        memoryUsage: this.getMemoryUsage()
      }
    };
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    console.log('🧹 Cleaning up logger resources...');
    this.flushMetrics();
    this.requestContext.clear();
    console.log('✅ Logger cleanup completed');
  }
}

// Export singleton instance
const logger = new Logger();

// Graceful shutdown handling
process.on('SIGINT', () => logger.cleanup());
process.on('SIGTERM', () => logger.cleanup());
process.on('beforeExit', () => logger.cleanup());

module.exports = logger;