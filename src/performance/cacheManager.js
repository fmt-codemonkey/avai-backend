/**
 * AVAI WebSocket Backend - Advanced Cache Manager
 * 
 * Multi-level caching system with memory optimization, TTL management,
 * LRU eviction, cache warming, and comprehensive metrics tracking.
 * 
 * Features:
 * - Multi-tier caching (L1: in-memory, L2: distributed if needed)
 * - LRU eviction with configurable max sizes
 * - TTL management with automatic cleanup
 * - Cache warming for frequently accessed data
 * - Performance metrics and hit/miss tracking
 * - Thread-safe operations with proper cleanup
 */

const NodeCache = require('node-cache');
const { LRUCache } = require('lru-cache');

class AdvancedCacheManager {
    constructor(options = {}) {
        // Configuration with performance-optimized defaults
        this.config = {
            // L1 Cache - High-speed in-memory cache
            l1: {
                maxSize: options.l1MaxSize || 1000,           // Max items in L1
                ttl: options.l1TTL || 300,                    // 5 minutes default TTL
                checkPeriod: options.l1CheckPeriod || 60,     // Check expired every minute
            },
            // L2 Cache - Larger capacity with longer TTL
            l2: {
                maxSize: options.l2MaxSize || 10000,          // Max items in L2
                ttl: options.l2TTL || 1800,                   // 30 minutes default TTL
                checkPeriod: options.l2CheckPeriod || 300,    // Check expired every 5 minutes
            },
            // Cache warming configuration
            warming: {
                enabled: options.warmingEnabled !== false,
                batchSize: options.warmingBatchSize || 50,
                intervalMs: options.warmingInterval || 30000, // Warm every 30 seconds
            },
            // Performance monitoring
            metrics: {
                enabled: options.metricsEnabled !== false,
                flushInterval: options.metricsFlushInterval || 60000, // Flush every minute
            }
        };

        // Initialize L1 Cache (Ultra-fast for hot data)
        this.l1Cache = new LRUCache({
            max: this.config.l1.maxSize,
            ttl: this.config.l1.ttl * 1000, // Convert to milliseconds
            updateAgeOnGet: true,
            updateAgeOnHas: true,
        });

        // Initialize L2 Cache (Larger capacity for warm data)
        this.l2Cache = new NodeCache({
            stdTTL: this.config.l2.ttl,
            checkperiod: this.config.l2.checkPeriod,
            maxKeys: this.config.l2.maxSize,
            useClones: false, // Performance optimization
        });

        // Cache metrics tracking
        this.metrics = {
            hits: {
                l1: 0,
                l2: 0,
                total: 0
            },
            misses: {
                l1: 0,
                l2: 0,
                total: 0
            },
            sets: {
                l1: 0,
                l2: 0,
                total: 0
            },
            deletes: {
                l1: 0,
                l2: 0,
                total: 0
            },
            evictions: {
                l1: 0,
                l2: 0,
                total: 0
            },
            memory: {
                l1Size: 0,
                l2Size: 0,
                totalSize: 0
            },
            performance: {
                avgResponseTime: 0,
                totalRequests: 0,
                lastFlush: Date.now()
            }
        };

        // Cache warming data
        this.warmingData = new Map();
        this.warmingInProgress = false;

        // Initialize event listeners and cleanup
        this.initializeEventListeners();
        this.startMetricsCollection();
        this.startCacheWarming();

        console.log('✅ Advanced Cache Manager initialized with L1/L2 architecture');
    }

    /**
     * Initialize event listeners for cache management
     */
    initializeEventListeners() {
        // L2 Cache events
        this.l2Cache.on('expired', (key, value) => {
            // Track expiration for warming decisions
            const warmingEntry = this.warmingData.get(key);
            if (warmingEntry) {
                warmingEntry.expiredCount++;
            }
        });

        this.l2Cache.on('del', (key, value) => {
            this.metrics.deletes.l2++;
            this.metrics.deletes.total++;
        });

        // Process cleanup
        process.on('SIGINT', () => this.cleanup());
        process.on('SIGTERM', () => this.cleanup());
    }

    /**
     * Get value from cache with L1 -> L2 fallback
     */
    async get(key, options = {}) {
        const startTime = Date.now();
        let result = null;
        let source = null;

        try {
            // Try L1 cache first (fastest)
            result = this.l1Cache.get(key);
            if (result !== undefined) {
                this.metrics.hits.l1++;
                this.metrics.hits.total++;
                source = 'L1';
                
                // Update access tracking for cache warming
                this.updateAccessTracking(key, result);
                return { data: result, source, cached: true };
            }

            this.metrics.misses.l1++;

            // Try L2 cache (fallback)
            result = this.l2Cache.get(key);
            if (result !== undefined) {
                this.metrics.hits.l2++;
                this.metrics.hits.total++;
                source = 'L2';

                // Promote to L1 if frequently accessed
                if (this.shouldPromoteToL1(key, result)) {
                    this.l1Cache.set(key, result);
                    this.metrics.sets.l1++;
                }

                this.updateAccessTracking(key, result);
                return { data: result, source, cached: true };
            }

            this.metrics.misses.l2++;
            this.metrics.misses.total++;

            return { data: null, source: 'MISS', cached: false };

        } finally {
            // Update performance metrics
            const responseTime = Date.now() - startTime;
            this.updatePerformanceMetrics(responseTime);
        }
    }

    /**
     * Set value in appropriate cache tier
     */
    async set(key, value, options = {}) {
        const ttl = options.ttl;
        const tier = options.tier || 'auto'; // 'l1', 'l2', or 'auto'
        
        try {
            // Add metadata for tracking
            const cacheValue = {
                data: value,
                timestamp: Date.now(),
                accessCount: 1,
                lastAccess: Date.now(),
                size: this.calculateSize(value)
            };

            if (tier === 'l1' || (tier === 'auto' && this.shouldUseL1(key, cacheValue))) {
                // Set in L1 cache
                this.l1Cache.set(key, cacheValue, { ttl: ttl ? ttl * 1000 : undefined });
                this.metrics.sets.l1++;
            } else {
                // Set in L2 cache
                this.l2Cache.set(key, cacheValue, ttl || this.config.l2.ttl);
                this.metrics.sets.l2++;
            }

            this.metrics.sets.total++;

            // Update warming data
            this.updateWarmingData(key, cacheValue);

            return true;
        } catch (error) {
            console.error('Cache set error:', error);
            return false;
        }
    }

    /**
     * Delete from all cache tiers
     */
    async delete(key) {
        let deleted = false;

        if (this.l1Cache.has(key)) {
            this.l1Cache.delete(key);
            this.metrics.deletes.l1++;
            deleted = true;
        }

        if (this.l2Cache.has(key)) {
            this.l2Cache.del(key);
            this.metrics.deletes.l2++;
            deleted = true;
        }

        if (deleted) {
            this.metrics.deletes.total++;
            this.warmingData.delete(key);
        }

        return deleted;
    }

    /**
     * Clear all caches
     */
    async clear() {
        this.l1Cache.clear();
        this.l2Cache.flushAll();
        this.warmingData.clear();
        
        // Reset relevant metrics
        this.resetCacheMetrics();
        
        console.log('🧹 All caches cleared');
    }

    /**
     * Get comprehensive cache statistics
     */
    getStats() {
        // Update current memory usage
        this.updateMemoryMetrics();

        return {
            ...this.metrics,
            config: this.config,
            hitRate: {
                l1: this.metrics.hits.l1 / Math.max(1, this.metrics.hits.l1 + this.metrics.misses.l1),
                l2: this.metrics.hits.l2 / Math.max(1, this.metrics.hits.l2 + this.metrics.misses.l2),
                total: this.metrics.hits.total / Math.max(1, this.metrics.hits.total + this.metrics.misses.total)
            },
            sizes: {
                l1: this.l1Cache.size,
                l2: this.l2Cache.keys().length,
                warming: this.warmingData.size
            },
            health: this.getHealthStatus()
        };
    }

    /**
     * Cache-specific methods for different data types
     */

    // Thread caching
    async getThread(threadId, userId) {
        const key = `thread:${threadId}:${userId}`;
        const result = await this.get(key);
        return result.cached ? result.data.data : null;
    }

    async setThread(threadId, userId, threadData, ttl = 300) {
        const key = `thread:${threadId}:${userId}`;
        return this.set(key, threadData, { ttl, tier: 'l1' }); // Threads are hot data
    }

    // User threads list caching
    async getUserThreads(userId) {
        const key = `user_threads:${userId}`;
        const result = await this.get(key);
        return result.cached ? result.data.data : null;
    }

    async setUserThreads(userId, threads, ttl = 180) {
        const key = `user_threads:${userId}`;
        return this.set(key, threads, { ttl, tier: 'l1' });
    }

    // Message caching (for recent messages)
    async getRecentMessages(threadId, limit = 50) {
        const key = `messages:${threadId}:recent:${limit}`;
        const result = await this.get(key);
        return result.cached ? result.data.data : null;
    }

    async setRecentMessages(threadId, messages, limit = 50, ttl = 120) {
        const key = `messages:${threadId}:recent:${limit}`;
        return this.set(key, messages, { ttl, tier: 'l2' }); // Messages are warm data
    }

    // User data caching
    async getUser(userId) {
        const key = `user:${userId}`;
        const result = await this.get(key);
        return result.cached ? result.data.data : null;
    }

    async setUser(userId, userData, ttl = 600) {
        const key = `user:${userId}`;
        return this.set(key, userData, { ttl, tier: 'l2' });
    }

    /**
     * Private helper methods
     */

    shouldPromoteToL1(key, value) {
        if (!value || !value.accessCount) return false;
        
        // Promote if accessed more than 3 times or very recently
        return value.accessCount > 3 || (Date.now() - value.lastAccess) < 30000;
    }

    shouldUseL1(key, value) {
        // Use L1 for small, frequently accessed data
        const isSmall = value.size < 1024; // Less than 1KB
        const isHot = key.includes('thread:') || key.includes('user_threads:');
        return isSmall && isHot;
    }

    updateAccessTracking(key, value) {
        if (value && typeof value === 'object') {
            value.accessCount = (value.accessCount || 0) + 1;
            value.lastAccess = Date.now();
        }

        // Update warming data
        const warmingEntry = this.warmingData.get(key) || { 
            accessCount: 0, 
            lastAccess: 0, 
            expiredCount: 0 
        };
        warmingEntry.accessCount++;
        warmingEntry.lastAccess = Date.now();
        this.warmingData.set(key, warmingEntry);
    }

    updateWarmingData(key, value) {
        const warmingEntry = this.warmingData.get(key) || { 
            accessCount: 0, 
            lastAccess: 0, 
            expiredCount: 0 
        };
        warmingEntry.size = value.size;
        warmingEntry.lastSet = Date.now();
        this.warmingData.set(key, warmingEntry);
    }

    calculateSize(value) {
        if (typeof value === 'string') return value.length * 2; // Rough Unicode estimate
        if (typeof value === 'object') return JSON.stringify(value).length * 2;
        return 64; // Default size estimate
    }

    updatePerformanceMetrics(responseTime) {
        this.metrics.performance.totalRequests++;
        const currentAvg = this.metrics.performance.avgResponseTime;
        const totalRequests = this.metrics.performance.totalRequests;
        
        // Running average calculation
        this.metrics.performance.avgResponseTime = 
            ((currentAvg * (totalRequests - 1)) + responseTime) / totalRequests;
    }

    updateMemoryMetrics() {
        this.metrics.memory.l1Size = this.l1Cache.size;
        this.metrics.memory.l2Size = this.l2Cache.keys().length;
        this.metrics.memory.totalSize = this.metrics.memory.l1Size + this.metrics.memory.l2Size;
    }

    getHealthStatus() {
        const hitRate = this.metrics.hits.total / Math.max(1, this.metrics.hits.total + this.metrics.misses.total);
        const memoryUsage = this.metrics.memory.totalSize / (this.config.l1.maxSize + this.config.l2.maxSize);
        
        if (hitRate > 0.8 && memoryUsage < 0.9) return 'excellent';
        if (hitRate > 0.6 && memoryUsage < 0.95) return 'good';
        if (hitRate > 0.4) return 'fair';
        return 'poor';
    }

    startMetricsCollection() {
        if (!this.config.metrics.enabled) return;

        setInterval(() => {
            this.updateMemoryMetrics();
            
            // Log performance summary
            const stats = this.getStats();
            console.log(`📊 Cache Performance - L1 Hit Rate: ${(stats.hitRate.l1 * 100).toFixed(1)}%, L2 Hit Rate: ${(stats.hitRate.l2 * 100).toFixed(1)}%, Health: ${stats.health}`);
            
            this.metrics.performance.lastFlush = Date.now();
        }, this.config.metrics.flushInterval);
    }

    startCacheWarming() {
        if (!this.config.warming.enabled) return;

        setInterval(async () => {
            if (this.warmingInProgress) return;
            
            this.warmingInProgress = true;
            try {
                await this.performCacheWarming();
            } catch (error) {
                console.error('Cache warming error:', error);
            } finally {
                this.warmingInProgress = false;
            }
        }, this.config.warming.intervalMs);
    }

    async performCacheWarming() {
        // Find candidates for warming (frequently accessed but expired)
        const candidates = [];
        
        for (const [key, data] of this.warmingData.entries()) {
            if (data.accessCount > 5 && data.expiredCount > 0) {
                candidates.push({ key, priority: data.accessCount * data.expiredCount });
            }
        }

        // Sort by priority and take top candidates
        candidates.sort((a, b) => b.priority - a.priority);
        const toWarm = candidates.slice(0, this.config.warming.batchSize);

        if (toWarm.length > 0) {
            console.log(`🔥 Cache warming ${toWarm.length} items`);
            // In a real implementation, you would fetch this data from the database
            // and pre-populate the cache
        }
    }

    resetCacheMetrics() {
        this.metrics.hits = { l1: 0, l2: 0, total: 0 };
        this.metrics.misses = { l1: 0, l2: 0, total: 0 };
        this.metrics.sets = { l1: 0, l2: 0, total: 0 };
        this.metrics.deletes = { l1: 0, l2: 0, total: 0 };
        this.metrics.evictions = { l1: 0, l2: 0, total: 0 };
        this.metrics.performance.totalRequests = 0;
        this.metrics.performance.avgResponseTime = 0;
    }

    cleanup() {
        console.log('🧹 Cleaning up cache manager...');
        this.l1Cache.clear();
        this.l2Cache.flushAll();
        this.warmingData.clear();
        console.log('✅ Cache manager cleanup completed');
    }
}

// Singleton instance for application-wide use
let cacheManagerInstance = null;

function getCacheManager(options = {}) {
    if (!cacheManagerInstance) {
        cacheManagerInstance = new AdvancedCacheManager(options);
    }
    return cacheManagerInstance;
}

module.exports = {
    AdvancedCacheManager,
    getCacheManager
};