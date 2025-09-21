/**
 * AVAI WebSocket Backend - Production Configuration Manager
 * 
 * Comprehensive production configuration system for Railway deployment.
 * Handles environment validation, CORS, logging, WebSocket configuration,
 * and Railway-specific optimizations.
 * 
 * Features:
 * - Production environment validation
 * - Railway-specific configurations
 * - CORS policy management
 * - WebSocket optimization settings
 * - Health check configuration
 * - Performance tuning for Railway limits
 */

class ProductionConfig {
    constructor() {
        // Environment detection
        this.isProduction = process.env.NODE_ENV === 'production';
        this.isDevelopment = process.env.NODE_ENV === 'development';
        this.isTest = process.env.NODE_ENV === 'test';
        
        // Railway-specific settings
        this.port = process.env.PORT || 8080;
        this.host = '0.0.0.0'; // Railway requirement
        this.railwayUrl = process.env.RAILWAY_STATIC_URL;
        this.railwayEnvironment = process.env.RAILWAY_ENVIRONMENT_NAME || 'production';
        
        // Performance settings for Railway
        this.maxConnections = parseInt(process.env.MAX_CONNECTIONS || '1000');
        this.connectionTimeout = parseInt(process.env.CONNECTION_TIMEOUT || '30000');
        this.keepAliveTimeout = parseInt(process.env.KEEP_ALIVE_TIMEOUT || '65000');
        this.bodyLimit = parseInt(process.env.BODY_LIMIT || '1048576'); // 1MB
        
        // Initialize configuration
        this.validateEnvironment();
        
        console.log(`🔧 Production Config initialized - Environment: ${process.env.NODE_ENV}, Railway: ${!!this.railwayUrl}`);
    }

    /**
     * Validate production environment variables
     * @throws {Error} If required environment variables are missing
     */
    validateEnvironment() {
        const requiredVars = [
            'SUPABASE_URL',
            'SUPABASE_SERVICE_ROLE_KEY',
            'CLERK_SECRET_KEY'
        ];

        const missingVars = requiredVars.filter(varName => !process.env[varName]);
        
        if (missingVars.length > 0) {
            const error = `❌ Missing required environment variables: ${missingVars.join(', ')}`;
            console.error(error);
            
            if (this.isProduction) {
                throw new Error(error);
            } else {
                console.warn('⚠️ Running in development mode with missing environment variables');
            }
        }

        // Validate URL formats
        this.validateUrlFormat('SUPABASE_URL', process.env.SUPABASE_URL);
        
        if (process.env.AVAI_CANISTER_WS_URL) {
            this.validateUrlFormat('AVAI_CANISTER_WS_URL', process.env.AVAI_CANISTER_WS_URL, ['ws:', 'wss:']);
        }

        console.log('✅ Environment validation completed');
    }

    /**
     * Validate URL format
     * @param {string} varName - Environment variable name
     * @param {string} url - URL to validate
     * @param {Array} allowedProtocols - Allowed URL protocols
     */
    validateUrlFormat(varName, url, allowedProtocols = ['http:', 'https:']) {
        if (!url) return;
        
        try {
            const parsedUrl = new URL(url);
            if (!allowedProtocols.includes(parsedUrl.protocol)) {
                throw new Error(`Invalid protocol for ${varName}: ${parsedUrl.protocol}`);
            }
        } catch (error) {
            const errorMsg = `❌ Invalid URL format for ${varName}: ${error.message}`;
            console.error(errorMsg);
            
            if (this.isProduction) {
                throw new Error(errorMsg);
            }
        }
    }

    /**
     * Get production logging configuration
     * @returns {Object} Logging configuration
     */
    getLoggingConfig() {
        return {
            level: this.isProduction 
                ? (process.env.LOG_LEVEL || 'warn')
                : (process.env.LOG_LEVEL || 'info'),
            format: this.isProduction ? 'json' : 'pretty',
            timestamp: true,
            
            // Railway-optimized settings
            colorize: !this.isProduction,
            prettyPrint: !this.isProduction,
            
            // Log rotation for production
            logRotation: this.isProduction ? {
                enabled: true,
                maxFiles: 5,
                maxSize: '10m',
                datePattern: 'YYYY-MM-DD'
            } : false,
            
            // Performance metrics logging
            metrics: {
                enabled: this.isProduction,
                interval: 60000, // 1 minute
                includeSystem: true,
                includeCustom: true
            },
            
            // Error tracking
            errorTracking: {
                enabled: this.isProduction,
                sampleRate: 1.0,
                includeStack: true,
                includeContext: true
            }
        };
    }

    /**
     * Get production CORS configuration
     * @returns {Object} CORS configuration
     */
    getCorsConfig() {
        const productionOrigins = [
            this.railwayUrl,
            'https://avai.chat',
            'https://www.avai.chat',
            'https://app.avai.chat',
            /^https:\/\/.*\.avai\.chat$/,
            /^https:\/\/.*\.railway\.app$/
        ].filter(Boolean);

        const developmentOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://127.0.0.1:3000',
            'http://127.0.0.1:3001',
            /^http:\/\/localhost:\d+$/,
            /^http:\/\/127\.0\.0\.1:\d+$/
        ];

        return {
            origin: this.isProduction ? productionOrigins : [...productionOrigins, ...developmentOrigins],
            credentials: true,
            methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
            allowedHeaders: [
                'Content-Type',
                'Authorization',
                'X-Requested-With',
                'Accept',
                'Origin',
                'X-Client-Info',
                'X-Request-ID'
            ],
            exposedHeaders: [
                'X-Response-Time',
                'X-Request-ID',
                'X-Rate-Limit-Remaining',
                'X-Rate-Limit-Reset'
            ],
            maxAge: this.isProduction ? 86400 : 300 // 24 hours in production, 5 minutes in dev
        };
    }

    /**
     * Get WebSocket configuration optimized for Railway
     * @returns {Object} WebSocket configuration
     */
    getWebSocketConfig() {
        return {
            // Connection settings
            maxConnections: this.maxConnections,
            connectionTimeout: this.connectionTimeout,
            
            // Railway-optimized timeouts
            pingTimeout: 30000,    // 30 seconds
            pingInterval: 25000,   // 25 seconds
            upgradeTimeout: 10000, // 10 seconds
            
            // Message handling
            maxPayload: 1024 * 1024, // 1MB
            compression: this.isProduction ? 'gzip' : false,
            
            // Performance optimization
            perMessageDeflate: this.isProduction ? {
                threshold: 1024,
                concurrencyLimit: 10,
                memLevel: 7
            } : false,
            
            // Connection management
            clientTracking: true,
            maxBackpressure: 64 * 1024, // 64KB
            
            // Railway-specific settings
            server: {
                port: this.port,
                host: this.host,
                keepAliveTimeout: this.keepAliveTimeout,
                headersTimeout: this.keepAliveTimeout + 5000,
                bodyLimit: this.bodyLimit,
                
                // Production optimizations
                ignoreTrailingSlash: true,
                ignoreDuplicateSlashes: true,
                caseSensitive: false,
                
                // Request ID for tracing
                genReqId: () => `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
            }
        };
    }

    /**
     * Get health check configuration
     * @returns {Object} Health check configuration
     */
    getHealthCheckConfig() {
        return {
            // Basic health check settings
            path: '/health',
            timeout: 10000,        // 10 seconds
            interval: 30000,       // 30 seconds
            
            // Detailed health checks
            checks: {
                database: {
                    enabled: true,
                    timeout: 5000,
                    retries: 2
                },
                memory: {
                    enabled: true,
                    threshold: 0.9,    // 90% memory usage alert
                    critical: 0.95     // 95% memory usage critical
                },
                connections: {
                    enabled: true,
                    maxConnections: this.maxConnections,
                    warningThreshold: 0.8  // 80% of max connections
                },
                aiService: {
                    enabled: !!process.env.AVAI_CANISTER_WS_URL,
                    timeout: 3000,
                    retries: 1
                }
            },
            
            // Metrics collection
            metrics: {
                enabled: true,
                collectInterval: 30000,    // 30 seconds
                retentionPeriod: 3600000,  // 1 hour
                includeSystem: true,
                includeApplication: true
            },
            
            // Railway-specific health reporting
            railway: {
                enabled: !!this.railwayUrl,
                reportInterval: 60000,     // 1 minute
                includeDeploymentInfo: true
            }
        };
    }

    /**
     * Get security configuration for production
     * @returns {Object} Security configuration
     */
    getSecurityConfig() {
        return {
            // Rate limiting
            rateLimiting: {
                enabled: true,
                strictMode: this.isProduction,
                
                // Connection limits
                connectionLimits: {
                    perIP: this.isProduction ? 10 : 50,
                    global: this.maxConnections,
                    windowMs: 60000 // 1 minute
                },
                
                // Message limits
                messageLimits: {
                    authenticated: this.isProduction ? 60 : 120,  // per minute
                    anonymous: this.isProduction ? 10 : 30,       // per minute
                    windowMs: 60000 // 1 minute
                }
            },
            
            // Input validation
            validation: {
                strictMode: this.isProduction,
                maxMessageSize: 10000,     // 10KB
                maxThreadTitleLength: 200,
                sanitizeInput: true
            },
            
            // Authentication
            authentication: {
                required: this.isProduction,
                jwtVerification: {
                    strict: this.isProduction,
                    clockTolerance: 60,     // 60 seconds
                    maxAge: '24h'
                }
            }
        };
    }

    /**
     * Get performance configuration for Railway
     * @returns {Object} Performance configuration
     */
    getPerformanceConfig() {
        return {
            // Caching
            cache: {
                enabled: true,
                l1Size: this.isProduction ? 2000 : 1000,
                l2Size: this.isProduction ? 20000 : 10000,
                ttl: {
                    l1: this.isProduction ? 180 : 300,    // 3-5 minutes
                    l2: this.isProduction ? 900 : 1800    // 15-30 minutes
                }
            },
            
            // Database
            database: {
                poolSize: {
                    min: this.isProduction ? 8 : 5,
                    max: this.isProduction ? 25 : 15
                },
                queryTimeout: 30000,    // 30 seconds
                connectionTimeout: 10000, // 10 seconds
                idleTimeout: 30000      // 30 seconds
            },
            
            // Memory management
            memory: {
                maxHeapSize: '512m',    // Railway limit
                gcInterval: 120000,     // 2 minutes
                leakDetection: this.isProduction,
                monitoring: true
            },
            
            // Railway-specific optimizations
            railway: {
                maxConcurrency: 100,
                requestTimeout: 30000,
                gracefulShutdownTimeout: 10000
            }
        };
    }

    /**
     * Get all configuration for the application
     * @returns {Object} Complete configuration object
     */
    getAllConfig() {
        return {
            environment: {
                isProduction: this.isProduction,
                isDevelopment: this.isDevelopment,
                nodeEnv: process.env.NODE_ENV,
                railwayEnvironment: this.railwayEnvironment
            },
            server: {
                port: this.port,
                host: this.host,
                railwayUrl: this.railwayUrl
            },
            logging: this.getLoggingConfig(),
            cors: this.getCorsConfig(),
            websocket: this.getWebSocketConfig(),
            health: this.getHealthCheckConfig(),
            security: this.getSecurityConfig(),
            performance: this.getPerformanceConfig()
        };
    }

    /**
     * Log configuration summary
     */
    logConfigSummary() {
        const summary = {
            environment: process.env.NODE_ENV,
            railway: !!this.railwayUrl,
            port: this.port,
            maxConnections: this.maxConnections,
            securityEnabled: this.isProduction,
            cachingEnabled: true,
            healthChecksEnabled: true
        };

        console.log('📋 Production Configuration Summary:');
        console.log(JSON.stringify(summary, null, 2));
    }
}

// Singleton instance
let productionConfigInstance = null;

function getProductionConfig() {
    if (!productionConfigInstance) {
        productionConfigInstance = new ProductionConfig();
    }
    return productionConfigInstance;
}

module.exports = {
    ProductionConfig,
    getProductionConfig
};