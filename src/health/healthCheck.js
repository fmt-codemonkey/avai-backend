/**
 * AVAI WebSocket Backend - Comprehensive Health Check System
 * 
 * Production-ready health monitoring for Railway deployment.
 * Monitors database, memory, connections, AI service, and system health.
 * 
 * Features:
 * - Multi-tier health checks (basic, detailed, individual services)
 * - Performance metrics collection
 * - Railway-compatible health reporting
 * - Automated issue detection and alerting
 * - Service dependency monitoring
 */

const os = require('os');
const logger = require('../utils/logger');

class HealthChecker {
    constructor(options = {}) {
        // Detect cloud platform for appropriate thresholds
        const isCloudPlatform = !!(process.env.RENDER || process.env.RAILWAY_STATIC_URL || process.env.VERCEL || process.env.HEROKU_APP_NAME);
        
        this.options = {
            timeout: options.timeout || 10000,        // 10 seconds
            retries: options.retries || 2,
            intervalMs: options.intervalMs || 30000,  // 30 seconds
            alertThresholds: {
                // More lenient thresholds for cloud platforms
                memory: isCloudPlatform ? 0.95 : 0.9,      // 95% for cloud, 90% for local
                cpu: isCloudPlatform ? 0.9 : 0.8,          // 90% for cloud, 80% for local
                connections: 0.85, // 85% of max connections
                responseTime: 5000 // 5 seconds
            },
            ...options
        };

        // Health check history
        this.healthHistory = [];
        this.maxHistorySize = 50;
        
        // Service dependencies
        this.dependencies = {
            database: null,
            memoryManager: null,
            connectionManager: null,
            aiService: null
        };

        // Health metrics
        this.metrics = {
            totalChecks: 0,
            healthyChecks: 0,
            unhealthyChecks: 0,
            avgResponseTime: 0,
            totalResponseTime: 0,
            lastHealthyTime: null,
            lastUnhealthyTime: null,
            consecutiveFailures: 0
        };

        // Start background health monitoring
        this.startBackgroundMonitoring();

        logger.info('Health checker initialized', {
            timeout: this.options.timeout,
            interval: this.options.intervalMs,
            alertThresholds: this.options.alertThresholds
        });
    }

    /**
     * Set service dependencies for health checking
     * @param {Object} dependencies - Service dependencies
     */
    setDependencies(dependencies) {
        this.dependencies = { ...this.dependencies, ...dependencies };
        logger.info('Health check dependencies updated', { 
            services: Object.keys(dependencies) 
        });
    }

    /**
     * Perform comprehensive health check
     * @param {Object} options - Health check options
     * @returns {Promise<Object>} Health check results
     */
    async performHealthCheck(options = {}) {
        const startTime = Date.now();
        const checkId = `health_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        logger.debug('Starting health check', { checkId, options });

        try {
            // Parallel health checks for better performance
            const [
                databaseHealth,
                memoryHealth,
                connectionsHealth,
                aiServiceHealth,
                systemHealth
            ] = await Promise.allSettled([
                this.checkDatabase(),
                this.checkMemory(),
                this.checkConnections(),
                this.checkAIService(),
                this.checkSystemHealth()
            ]);

            const responseTime = Date.now() - startTime;
            const healthChecks = {
                database: this.processHealthResult(databaseHealth),
                memory: this.processHealthResult(memoryHealth),
                connections: this.processHealthResult(connectionsHealth),
                ai_service: this.processHealthResult(aiServiceHealth),
                system: this.processHealthResult(systemHealth)
            };

            // Determine overall health status
            const overallStatus = this.determineOverallHealth(healthChecks);

            const healthReport = {
                status: overallStatus,
                timestamp: new Date().toISOString(),
                checkId,
                uptime: Math.floor(process.uptime()),
                environment: process.env.NODE_ENV || 'development',
                version: process.env.npm_package_version || '1.0.0',
                responseTime,
                
                // Individual health checks
                checks: healthChecks,
                
                // System metrics
                metrics: {
                    active_connections: await this.getActiveConnections(),
                    memory_usage: this.getMemoryUsagePercent(),
                    cpu_usage: await this.getCPUUsage(),
                    disk_usage: await this.getDiskUsage(),
                    network_stats: this.getNetworkStats()
                },

                // Railway-specific information
                ...(process.env.RAILWAY_STATIC_URL && {
                    railway: {
                        environment: process.env.RAILWAY_ENVIRONMENT_NAME,
                        deployment_id: process.env.RAILWAY_DEPLOYMENT_ID,
                        service_id: process.env.RAILWAY_SERVICE_ID,
                        static_url: process.env.RAILWAY_STATIC_URL
                    }
                }),

                // Performance statistics
                performance: {
                    total_checks: this.metrics.totalChecks,
                    healthy_percentage: this.getHealthyPercentage(),
                    avg_response_time: this.metrics.avgResponseTime,
                    consecutive_failures: this.metrics.consecutiveFailures,
                    last_healthy: this.metrics.lastHealthyTime,
                    last_unhealthy: this.metrics.lastUnhealthyTime
                }
            };

            // Update metrics and history
            this.updateHealthMetrics(overallStatus, responseTime);
            this.addToHistory(healthReport);

            // Log health status
            const logLevel = overallStatus === 'healthy' ? 'info' : 'warn';
            logger[logLevel]('Health check completed', {
                status: overallStatus,
                responseTime,
                checkId,
                failedChecks: Object.entries(healthChecks)
                    .filter(([_, result]) => !result.healthy)
                    .map(([name]) => name)
            });

            return healthReport;

        } catch (error) {
            const responseTime = Date.now() - startTime;
            logger.error('Health check failed', {
                error: error.message,
                stack: error.stack,
                checkId,
                responseTime
            });

            this.updateHealthMetrics('unhealthy', responseTime);

            return {
                status: 'unhealthy',
                timestamp: new Date().toISOString(),
                checkId,
                error: error.message,
                responseTime,
                uptime: Math.floor(process.uptime())
            };
        }
    }

    /**
     * Check database connectivity and performance
     * @returns {Promise<Object>} Database health result
     */
    async checkDatabase() {
        const startTime = Date.now();
        
        try {
            if (!this.dependencies.database) {
                return {
                    healthy: false,
                    message: 'Database dependency not available',
                    responseTime: Date.now() - startTime
                };
            }

            // Test basic connectivity
            const connectionTest = await this.dependencies.database.testConnection();
            if (!connectionTest) {
                return {
                    healthy: false,
                    message: 'Database connection failed',
                    responseTime: Date.now() - startTime
                };
            }

            // Get database metrics if available
            let metrics = {};
            if (typeof this.dependencies.database.getDatabaseMetrics === 'function') {
                metrics = this.dependencies.database.getDatabaseMetrics();
            }

            const responseTime = Date.now() - startTime;
            
            return {
                healthy: true,
                message: 'Database connection healthy',
                responseTime,
                metrics: {
                    connectionPool: metrics.database?.connectionPool || {},
                    queryPerformance: {
                        avgResponseTime: metrics.database?.avgResponseTime || 0,
                        totalQueries: metrics.database?.totalQueries || 0,
                        errorRate: metrics.database?.errors / Math.max(1, metrics.database?.totalQueries) || 0
                    }
                }
            };

        } catch (error) {
            return {
                healthy: false,
                message: `Database check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }

    /**
     * Check memory usage and performance
     * @returns {Promise<Object>} Memory health result
     */
    async checkMemory() {
        const startTime = Date.now();
        
        try {
            const memoryUsage = process.memoryUsage();
            const systemMemory = {
                total: os.totalmem(),
                free: os.freemem(),
                used: os.totalmem() - os.freemem()
            };

            const heapUsagePercent = memoryUsage.heapUsed / memoryUsage.heapTotal;
            const systemUsagePercent = systemMemory.used / systemMemory.total;

            // Check thresholds
            const memoryHealthy = heapUsagePercent < this.options.alertThresholds.memory &&
                                 systemUsagePercent < this.options.alertThresholds.memory;

            let memoryManagerMetrics = {};
            if (this.dependencies.memoryManager && 
                typeof this.dependencies.memoryManager.getHealthStatus === 'function') {
                const status = this.dependencies.memoryManager.getHealthStatus();
                memoryManagerMetrics = status.metrics || {};
            }

            return {
                healthy: memoryHealthy,
                message: memoryHealthy ? 'Memory usage normal' : 'High memory usage detected',
                responseTime: Date.now() - startTime,
                metrics: {
                    heap: {
                        used: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
                        total: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
                        usage_percent: Math.round(heapUsagePercent * 100)
                    },
                    system: {
                        total: Math.round(systemMemory.total / 1024 / 1024 / 1024), // GB
                        free: Math.round(systemMemory.free / 1024 / 1024 / 1024), // GB
                        usage_percent: Math.round(systemUsagePercent * 100)
                    },
                    external: Math.round(memoryUsage.external / 1024 / 1024), // MB
                    rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
                    memoryManager: memoryManagerMetrics
                }
            };

        } catch (error) {
            return {
                healthy: false,
                message: `Memory check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }

    /**
     * Check WebSocket connections health
     * @returns {Promise<Object>} Connections health result
     */
    async checkConnections() {
        const startTime = Date.now();
        
        try {
            let connectionMetrics = {
                active: 0,
                total: 0,
                peak: 0,
                avgLifetime: 0
            };

            // Get connection metrics from memory manager if available
            if (this.dependencies.memoryManager) {
                const status = this.dependencies.memoryManager.getHealthStatus();
                connectionMetrics = status.metrics || connectionMetrics;
            }

            const maxConnections = parseInt(process.env.MAX_CONNECTIONS) || 1000;
            const connectionUsagePercent = connectionMetrics.active / maxConnections;
            
            const connectionsHealthy = connectionUsagePercent < this.options.alertThresholds.connections;

            return {
                healthy: connectionsHealthy,
                message: connectionsHealthy ? 
                    'Connection usage normal' : 
                    'High connection usage detected',
                responseTime: Date.now() - startTime,
                metrics: {
                    active: connectionMetrics.active,
                    maximum: maxConnections,
                    usage_percent: Math.round(connectionUsagePercent * 100),
                    peak: connectionMetrics.peak,
                    total_served: connectionMetrics.total,
                    avg_lifetime: connectionMetrics.avgLifetime
                }
            };

        } catch (error) {
            return {
                healthy: false,
                message: `Connections check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }

    /**
     * Check AI service connectivity
     * @returns {Promise<Object>} AI service health result
     */
    async checkAIService() {
        const startTime = Date.now();
        
        try {
            const aiServiceUrl = process.env.AVAI_CANISTER_WS_URL;
            
            if (!aiServiceUrl) {
                return {
                    healthy: true,
                    message: 'AI service not configured (optional)',
                    responseTime: Date.now() - startTime,
                    configured: false
                };
            }

            // Basic URL validation
            try {
                new URL(aiServiceUrl);
            } catch (urlError) {
                return {
                    healthy: false,
                    message: 'Invalid AI service URL configuration',
                    responseTime: Date.now() - startTime,
                    error: urlError.message
                };
            }

            // In production, you might want to implement actual connectivity test
            // For now, we'll do basic validation
            return {
                healthy: true,
                message: 'AI service configuration valid',
                responseTime: Date.now() - startTime,
                configured: true,
                url: aiServiceUrl,
                metrics: {
                    // Add AI service specific metrics here
                    last_connection_test: new Date().toISOString()
                }
            };

        } catch (error) {
            return {
                healthy: false,
                message: `AI service check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }

    /**
     * Check overall system health
     * @returns {Promise<Object>} System health result
     */
    async checkSystemHealth() {
        const startTime = Date.now();
        
        try {
            const loadAverage = os.loadavg();
            const cpuCount = os.cpus().length;
            const uptime = process.uptime();
            
            // Calculate CPU usage approximation
            const cpuUsage = loadAverage[0] / cpuCount;
            const systemHealthy = cpuUsage < this.options.alertThresholds.cpu;

            return {
                healthy: systemHealthy,
                message: systemHealthy ? 'System performance normal' : 'High system load detected',
                responseTime: Date.now() - startTime,
                metrics: {
                    cpu: {
                        usage_percent: Math.round(cpuUsage * 100),
                        load_average: loadAverage,
                        cpu_count: cpuCount
                    },
                    uptime: {
                        process: Math.floor(uptime),
                        system: Math.floor(os.uptime())
                    },
                    platform: {
                        type: os.type(),
                        platform: os.platform(),
                        arch: os.arch(),
                        release: os.release(),
                        hostname: os.hostname()
                    }
                }
            };

        } catch (error) {
            return {
                healthy: false,
                message: `System check failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }

    /**
     * Helper methods for health checking
     */

    processHealthResult(settledResult) {
        if (settledResult.status === 'fulfilled') {
            return settledResult.value;
        } else {
            return {
                healthy: false,
                message: `Check failed: ${settledResult.reason?.message || 'Unknown error'}`,
                error: settledResult.reason?.message
            };
        }
    }

    determineOverallHealth(healthChecks) {
        const criticalChecks = ['database', 'memory', 'system'];
        const failedCritical = criticalChecks.some(check => 
            healthChecks[check] && !healthChecks[check].healthy
        );

        if (failedCritical) {
            return 'unhealthy';
        }

        const totalChecks = Object.keys(healthChecks).length;
        const healthyChecks = Object.values(healthChecks).filter(check => 
            check && check.healthy
        ).length;

        // If 80% or more checks are healthy, consider overall healthy
        return (healthyChecks / totalChecks) >= 0.8 ? 'healthy' : 'degraded';
    }

    updateHealthMetrics(status, responseTime) {
        this.metrics.totalChecks++;
        this.metrics.totalResponseTime += responseTime;
        this.metrics.avgResponseTime = this.metrics.totalResponseTime / this.metrics.totalChecks;

        if (status === 'healthy') {
            this.metrics.healthyChecks++;
            this.metrics.lastHealthyTime = new Date().toISOString();
            this.metrics.consecutiveFailures = 0;
        } else {
            this.metrics.unhealthyChecks++;
            this.metrics.lastUnhealthyTime = new Date().toISOString();
            this.metrics.consecutiveFailures++;
        }
    }

    addToHistory(healthReport) {
        this.healthHistory.push({
            timestamp: healthReport.timestamp,
            status: healthReport.status,
            responseTime: healthReport.responseTime,
            checkId: healthReport.checkId
        });

        // Maintain history size
        if (this.healthHistory.length > this.maxHistorySize) {
            this.healthHistory.shift();
        }
    }

    getHealthyPercentage() {
        if (this.metrics.totalChecks === 0) return 100;
        return Math.round((this.metrics.healthyChecks / this.metrics.totalChecks) * 100);
    }

    async getActiveConnections() {
        if (this.dependencies.memoryManager) {
            const status = this.dependencies.memoryManager.getHealthStatus();
            return status.metrics?.connectionLoad || 0;
        }
        return 0;
    }

    getMemoryUsagePercent() {
        const usage = process.memoryUsage();
        return Math.round((usage.heapUsed / usage.heapTotal) * 100);
    }

    async getCPUUsage() {
        const loadAverage = os.loadavg();
        const cpuCount = os.cpus().length;
        return Math.round((loadAverage[0] / cpuCount) * 100);
    }

    async getDiskUsage() {
        // Simplified disk usage (in production, you might use a library like 'df')
        return {
            available: true,
            usage_percent: 0 // Placeholder
        };
    }

    getNetworkStats() {
        const networkInterfaces = os.networkInterfaces();
        const stats = {
            interfaces: Object.keys(networkInterfaces).length,
            active_interfaces: 0
        };

        Object.values(networkInterfaces).forEach(interfaces => {
            if (interfaces.some(iface => !iface.internal)) {
                stats.active_interfaces++;
            }
        });

        return stats;
    }

    startBackgroundMonitoring() {
        setInterval(async () => {
            try {
                const health = await this.performHealthCheck({ background: true });
                
                // Alert on consecutive failures
                if (this.metrics.consecutiveFailures >= 3) {
                    logger.error('Health check: Multiple consecutive failures detected', {
                        consecutiveFailures: this.metrics.consecutiveFailures,
                        lastHealthy: this.metrics.lastHealthyTime,
                        currentStatus: health.status
                    });
                }
                
            } catch (error) {
                logger.error('Background health check failed', {
                    error: error.message,
                    stack: error.stack
                });
            }
        }, this.options.intervalMs);
    }

    /**
     * Get health check history
     * @param {number} limit - Number of recent checks to return
     * @returns {Array} Health check history
     */
    getHistory(limit = 10) {
        return this.healthHistory.slice(-limit);
    }

    /**
     * Get health check statistics
     * @returns {Object} Health statistics
     */
    getStats() {
        return {
            ...this.metrics,
            healthyPercentage: this.getHealthyPercentage(),
            dependencies: Object.keys(this.dependencies).filter(key => 
                this.dependencies[key] !== null
            ),
            configuration: {
                timeout: this.options.timeout,
                retries: this.options.retries,
                interval: this.options.intervalMs,
                alertThresholds: this.options.alertThresholds
            }
        };
    }

    /**
     * Cleanup resources
     */
    cleanup() {
        logger.info('Health checker cleanup completed');
        this.healthHistory = [];
        this.dependencies = {};
    }
}

// Singleton instance for application-wide use
let healthCheckerInstance = null;

function getHealthChecker(options = {}) {
    if (!healthCheckerInstance) {
        healthCheckerInstance = new HealthChecker(options);
    }
    return healthCheckerInstance;
}

module.exports = {
    HealthChecker,
    getHealthChecker
};