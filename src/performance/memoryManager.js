/**
 * AVAI WebSocket Backend - Memory Manager
 * 
 * Advanced memory management system for WebSocket connections optimization,
 * memory leak detection, garbage collection monitoring, and connection pooling.
 * 
 * Features:
 * - WebSocket connection memory optimization
 * - Memory leak detection and prevention
 * - Garbage collection monitoring and tuning
 * - Connection pool management
 * - Memory usage tracking and alerting
 * - Automatic memory cleanup and recovery
 */

const EventEmitter = require('events');

class MemoryManager extends EventEmitter {
    constructor(options = {}) {
        super();

        // Configuration with memory-optimized defaults
        this.config = {
            // Connection management
            connections: {
                maxConnections: options.maxConnections || 2000,      // Max concurrent connections
                connectionTimeout: options.connectionTimeout || 30000, // 30 seconds
                idleTimeout: options.idleTimeout || 300000,          // 5 minutes
                cleanupInterval: options.cleanupInterval || 60000,   // 1 minute
            },
            // Memory monitoring
            memory: {
                maxHeapUsage: options.maxHeapUsage || 0.85,          // 85% of available heap
                checkInterval: options.memoryCheckInterval || 30000, // 30 seconds
                gcThreshold: options.gcThreshold || 0.75,            // Trigger GC at 75%
                leakThreshold: options.leakThreshold || 50 * 1024 * 1024, // 50MB growth
                alertThreshold: options.alertThreshold || 0.9,       // Alert at 90%
            },
            // Connection pooling
            pool: {
                enabled: options.poolEnabled !== false,
                minConnections: options.minConnections || 10,
                maxIdleTime: options.maxIdleTime || 600000,          // 10 minutes
                reuseConnections: options.reuseConnections !== false,
            },
            // Cleanup and optimization
            cleanup: {
                enabled: options.cleanupEnabled !== false,
                aggressiveMode: options.aggressiveMode || false,
                gcInterval: options.gcInterval || 120000,            // 2 minutes
                memoryDefrag: options.memoryDefrag !== false,
            }
        };

        // Connection tracking
        this.connections = new Map();
        this.connectionPool = [];
        this.connectionMetrics = {
            active: 0,
            total: 0,
            peak: 0,
            avgLifetime: 0,
            totalLifetime: 0,
            closed: 0
        };

        // Memory tracking
        this.memoryMetrics = {
            baseline: process.memoryUsage(),
            current: process.memoryUsage(),
            peak: process.memoryUsage(),
            gc: {
                forced: 0,
                automatic: 0,
                lastGC: Date.now()
            },
            leaks: {
                detected: 0,
                suspected: [],
                lastCheck: Date.now()
            }
        };

        // Performance tracking
        this.performanceMetrics = {
            avgConnectionTime: 0,
            avgMessageProcessTime: 0,
            totalMessages: 0,
            errorsRecovered: 0,
            memoryReclaimed: 0
        };

        // Leak detection data
        this.leakDetection = {
            snapshots: [],
            watchedObjects: new WeakMap(),
            suspiciousGrowth: new Map()
        };

        // Initialize monitoring and cleanup
        this.initializeMonitoring();
        this.startMemoryMonitoring();
        this.startConnectionCleanup();
        this.setupGCOptimization();

        console.log('🧠 Memory Manager initialized with connection pooling and leak detection');
    }

    /**
     * Register a new WebSocket connection
     */
    registerConnection(connectionId, socket, metadata = {}) {
        const connection = {
            id: connectionId,
            socket: socket,
            createdAt: Date.now(),
            lastActivity: Date.now(),
            messageCount: 0,
            bytesTransferred: 0,
            metadata: {
                userId: metadata.userId,
                userAgent: metadata.userAgent,
                ip: metadata.ip,
                authenticated: metadata.authenticated || false,
                ...metadata
            },
            memorySnapshot: this.getConnectionMemorySnapshot()
        };

        this.connections.set(connectionId, connection);
        this.connectionMetrics.active++;
        this.connectionMetrics.total++;
        
        if (this.connectionMetrics.active > this.connectionMetrics.peak) {
            this.connectionMetrics.peak = this.connectionMetrics.active;
        }

        // Set up connection monitoring
        this.setupConnectionMonitoring(connection);

        console.log(`🔗 Connection registered: ${connectionId} (Active: ${this.connectionMetrics.active})`);
        
        return connection;
    }

    /**
     * Unregister a WebSocket connection
     */
    unregisterConnection(connectionId) {
        const connection = this.connections.get(connectionId);
        if (!connection) return false;

        // Calculate connection metrics
        const lifetime = Date.now() - connection.createdAt;
        this.connectionMetrics.totalLifetime += lifetime;
        this.connectionMetrics.avgLifetime = 
            this.connectionMetrics.totalLifetime / this.connectionMetrics.total;

        // Clean up connection
        this.cleanupConnection(connection);
        this.connections.delete(connectionId);
        this.connectionMetrics.active--;
        this.connectionMetrics.closed++;

        console.log(`🔌 Connection unregistered: ${connectionId} (Active: ${this.connectionMetrics.active}, Lifetime: ${lifetime}ms)`);
        
        return true;
    }

    /**
     * Update connection activity
     */
    updateConnectionActivity(connectionId, messageSize = 0, processingTime = 0) {
        const connection = this.connections.get(connectionId);
        if (!connection) return false;

        connection.lastActivity = Date.now();
        connection.messageCount++;
        connection.bytesTransferred += messageSize;

        // Update performance metrics
        this.performanceMetrics.totalMessages++;
        if (processingTime > 0) {
            const currentAvg = this.performanceMetrics.avgMessageProcessTime;
            const total = this.performanceMetrics.totalMessages;
            this.performanceMetrics.avgMessageProcessTime = 
                ((currentAvg * (total - 1)) + processingTime) / total;
        }

        return true;
    }

    /**
     * Get memory statistics
     */
    getMemoryStats() {
        const current = process.memoryUsage();
        this.memoryMetrics.current = current;

        // Update peak usage
        if (current.heapUsed > this.memoryMetrics.peak.heapUsed) {
            this.memoryMetrics.peak = { ...current };
        }

        return {
            current: current,
            baseline: this.memoryMetrics.baseline,
            peak: this.memoryMetrics.peak,
            growth: {
                heapUsed: current.heapUsed - this.memoryMetrics.baseline.heapUsed,
                heapTotal: current.heapTotal - this.memoryMetrics.baseline.heapTotal,
                external: current.external - this.memoryMetrics.baseline.external,
                rss: current.rss - this.memoryMetrics.baseline.rss
            },
            percentage: {
                heapUsed: current.heapUsed / current.heapTotal,
                heapTotal: current.heapTotal / (current.heapTotal + current.external)
            },
            connections: this.connectionMetrics,
            performance: this.performanceMetrics,
            gc: this.memoryMetrics.gc,
            leaks: this.memoryMetrics.leaks
        };
    }

    /**
     * Force garbage collection if available
     */
    forceGarbageCollection(reason = 'manual') {
        if (global.gc) {
            const beforeGC = process.memoryUsage();
            global.gc();
            const afterGC = process.memoryUsage();
            
            const reclaimed = beforeGC.heapUsed - afterGC.heapUsed;
            this.memoryMetrics.gc.forced++;
            this.memoryMetrics.gc.lastGC = Date.now();
            this.performanceMetrics.memoryReclaimed += reclaimed;

            console.log(`🗑️ Forced GC (${reason}): Reclaimed ${(reclaimed / 1024 / 1024).toFixed(2)}MB`);
            
            return { reclaimed, before: beforeGC, after: afterGC };
        } else {
            console.warn('⚠️ Garbage collection not available (use --expose-gc flag)');
            return null;
        }
    }

    /**
     * Detect memory leaks
     */
    async detectMemoryLeaks() {
        const currentMemory = process.memoryUsage();
        const timestamp = Date.now();

        // Add current snapshot
        this.leakDetection.snapshots.push({
            timestamp,
            memory: currentMemory,
            connections: this.connectionMetrics.active
        });

        // Keep only last 10 snapshots
        if (this.leakDetection.snapshots.length > 10) {
            this.leakDetection.snapshots.shift();
        }

        // Analyze growth patterns
        if (this.leakDetection.snapshots.length >= 3) {
            const analysis = this.analyzeMemoryGrowth();
            
            if (analysis.suspiciousGrowth) {
                this.memoryMetrics.leaks.detected++;
                this.memoryMetrics.leaks.suspected.push({
                    timestamp,
                    growth: analysis.growth,
                    connections: this.connectionMetrics.active,
                    pattern: analysis.pattern
                });

                console.warn(`🚨 Potential memory leak detected: ${(analysis.growth / 1024 / 1024).toFixed(2)}MB growth`);
                
                // Emit leak detection event
                this.emit('memoryLeak', analysis);

                // Trigger recovery if needed
                if (analysis.growth > this.config.memory.leakThreshold) {
                    await this.recoverFromMemoryLeak();
                }
            }
        }

        this.memoryMetrics.leaks.lastCheck = timestamp;
        return this.leakDetection.snapshots[this.leakDetection.snapshots.length - 1];
    }

    /**
     * Recover from memory leak
     */
    async recoverFromMemoryLeak() {
        console.log('🚨 Initiating memory leak recovery...');

        try {
            // 1. Clean up idle connections
            const cleanedConnections = await this.cleanupIdleConnections(true);

            // 2. Force garbage collection
            const gcResult = this.forceGarbageCollection('leak-recovery');

            // 3. Clear any internal caches
            this.clearInternalCaches();

            // 4. Reset suspicious growth tracking
            this.leakDetection.suspiciousGrowth.clear();

            this.performanceMetrics.errorsRecovered++;

            console.log(`✅ Memory leak recovery completed: ${cleanedConnections} connections cleaned, ${(gcResult?.reclaimed || 0 / 1024 / 1024).toFixed(2)}MB reclaimed`);

            this.emit('memoryRecovered', {
                connectionsCleared: cleanedConnections,
                memoryReclaimed: gcResult?.reclaimed || 0
            });

        } catch (error) {
            console.error('❌ Memory leak recovery failed:', error);
            this.emit('memoryRecoveryFailed', error);
        }
    }

    /**
     * Optimize connection pool
     */
    optimizeConnectionPool() {
        const now = Date.now();
        let optimized = 0;

        // Remove expired pooled connections
        this.connectionPool = this.connectionPool.filter(conn => {
            if (now - conn.pooledAt > this.config.pool.maxIdleTime) {
                optimized++;
                return false;
            }
            return true;
        });

        // Maintain minimum pool size
        while (this.connectionPool.length < this.config.pool.minConnections) {
            this.connectionPool.push(this.createPooledConnection());
        }

        if (optimized > 0) {
            console.log(`♻️ Connection pool optimized: ${optimized} expired connections removed`);
        }

        return optimized;
    }

    /**
     * Get comprehensive system health status
     */
    getHealthStatus() {
        const memStats = this.getMemoryStats();
        const heapUsage = memStats.percentage.heapUsed;
        const connectionLoad = this.connectionMetrics.active / this.config.connections.maxConnections;
        
        let status = 'excellent';
        let issues = [];

        if (heapUsage > 0.9) {
            status = 'critical';
            issues.push('High memory usage');
        } else if (heapUsage > 0.75) {
            status = status === 'excellent' ? 'warning' : status;
            issues.push('Elevated memory usage');
        }

        if (connectionLoad > 0.9) {
            status = 'critical';
            issues.push('High connection load');
        } else if (connectionLoad > 0.75) {
            status = status === 'excellent' ? 'warning' : status;
            issues.push('Elevated connection load');
        }

        if (this.memoryMetrics.leaks.detected > 0) {
            status = status === 'excellent' ? 'warning' : status;
            issues.push('Memory leaks detected');
        }

        return {
            status,
            issues,
            metrics: {
                heapUsage: heapUsage,
                connectionLoad: connectionLoad,
                avgResponseTime: this.performanceMetrics.avgMessageProcessTime,
                leaksDetected: this.memoryMetrics.leaks.detected
            }
        };
    }

    /**
     * Private helper methods
     */

    initializeMonitoring() {
        // Capture baseline memory usage
        setTimeout(() => {
            this.memoryMetrics.baseline = process.memoryUsage();
            console.log(`📊 Memory baseline established: ${(this.memoryMetrics.baseline.heapUsed / 1024 / 1024).toFixed(2)}MB`);
        }, 5000); // Wait 5 seconds for initialization to complete
    }

    startMemoryMonitoring() {
        setInterval(async () => {
            const memStats = this.getMemoryStats();
            
            // Check for memory alerts
            if (memStats.percentage.heapUsed > this.config.memory.alertThreshold) {
                console.warn(`⚠️ High memory usage: ${(memStats.percentage.heapUsed * 100).toFixed(1)}%`);
                this.emit('memoryAlert', memStats);
            }

            // Trigger GC if needed
            if (memStats.percentage.heapUsed > this.config.memory.gcThreshold) {
                this.forceGarbageCollection('high-usage');
            }

            // Detect leaks
            await this.detectMemoryLeaks();

        }, this.config.memory.checkInterval);
    }

    startConnectionCleanup() {
        setInterval(() => {
            this.cleanupIdleConnections();
            this.optimizeConnectionPool();
        }, this.config.connections.cleanupInterval);
    }

    setupGCOptimization() {
        if (this.config.cleanup.enabled) {
            setInterval(() => {
                if (global.gc) {
                    this.forceGarbageCollection('scheduled');
                }
            }, this.config.cleanup.gcInterval);
        }
    }

    setupConnectionMonitoring(connection) {
        // Set up idle timeout
        const idleTimer = setTimeout(() => {
            if (Date.now() - connection.lastActivity > this.config.connections.idleTimeout) {
                console.log(`⏰ Connection ${connection.id} idle timeout`);
                this.closeIdleConnection(connection);
            }
        }, this.config.connections.idleTimeout);

        connection.idleTimer = idleTimer;
    }

    cleanupConnection(connection) {
        if (connection.idleTimer) {
            clearTimeout(connection.idleTimer);
        }

        // Clean up any connection-specific resources
        if (connection.socket && typeof connection.socket.terminate === 'function') {
            connection.socket.terminate();
        }
    }

    async cleanupIdleConnections(aggressive = false) {
        const now = Date.now();
        const idleThreshold = aggressive ? 
            this.config.connections.idleTimeout / 2 : 
            this.config.connections.idleTimeout;

        let cleaned = 0;

        for (const [connectionId, connection] of this.connections.entries()) {
            if (now - connection.lastActivity > idleThreshold) {
                console.log(`🧹 Cleaning up idle connection: ${connectionId}`);
                this.unregisterConnection(connectionId);
                cleaned++;
            }
        }

        return cleaned;
    }

    closeIdleConnection(connection) {
        if (connection.socket && typeof connection.socket.close === 'function') {
            connection.socket.close(1000, 'Idle timeout');
        }
        this.unregisterConnection(connection.id);
    }

    getConnectionMemorySnapshot() {
        const mem = process.memoryUsage();
        return {
            heapUsed: mem.heapUsed,
            timestamp: Date.now()
        };
    }

    analyzeMemoryGrowth() {
        const snapshots = this.leakDetection.snapshots;
        const latest = snapshots[snapshots.length - 1];
        const baseline = snapshots[0];

        const growth = latest.memory.heapUsed - baseline.memory.heapUsed;
        const timespan = latest.timestamp - baseline.timestamp;
        const growthRate = growth / timespan; // bytes per ms

        // Check if growth is suspicious
        const suspiciousGrowth = growth > this.config.memory.leakThreshold && 
                                growthRate > 100; // More than 100 bytes/ms

        return {
            growth,
            growthRate,
            timespan,
            suspiciousGrowth,
            pattern: this.identifyGrowthPattern(snapshots)
        };
    }

    identifyGrowthPattern(snapshots) {
        if (snapshots.length < 3) return 'insufficient-data';

        const growthRates = [];
        for (let i = 1; i < snapshots.length; i++) {
            const growth = snapshots[i].memory.heapUsed - snapshots[i-1].memory.heapUsed;
            const time = snapshots[i].timestamp - snapshots[i-1].timestamp;
            growthRates.push(growth / time);
        }

        const avgGrowthRate = growthRates.reduce((a, b) => a + b, 0) / growthRates.length;
        const variance = growthRates.reduce((acc, rate) => acc + Math.pow(rate - avgGrowthRate, 2), 0) / growthRates.length;

        if (variance < 0.1 && avgGrowthRate > 50) return 'linear-leak';
        if (avgGrowthRate > 100) return 'rapid-growth';
        if (variance > 0.5) return 'erratic-growth';
        return 'normal';
    }

    createPooledConnection() {
        return {
            id: `pool-${Date.now()}-${Math.random()}`,
            pooledAt: Date.now(),
            available: true
        };
    }

    clearInternalCaches() {
        // Clear leak detection history
        this.leakDetection.snapshots = this.leakDetection.snapshots.slice(-2);
        this.leakDetection.suspiciousGrowth.clear();
        
        // Reset some metrics
        this.memoryMetrics.leaks.suspected = this.memoryMetrics.leaks.suspected.slice(-5);
    }

    cleanup() {
        console.log('🧹 Cleaning up memory manager...');
        
        // Close all connections
        for (const [connectionId, connection] of this.connections.entries()) {
            this.cleanupConnection(connection);
        }
        this.connections.clear();
        
        // Clear pools and caches
        this.connectionPool = [];
        this.clearInternalCaches();
        
        console.log('✅ Memory manager cleanup completed');
    }
}

// Singleton instance for application-wide use
let memoryManagerInstance = null;

function getMemoryManager(options = {}) {
    if (!memoryManagerInstance) {
        memoryManagerInstance = new MemoryManager(options);
    }
    return memoryManagerInstance;
}

module.exports = {
    MemoryManager,
    getMemoryManager
};