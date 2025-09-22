/**
 * Advanced Multi-Tier Rate Limiter
 * Implements sliding window algorithm with multiple rate limiting tiers
 * - User-based limiting (authenticated users)
 * - Anonymous user limiting 
 * - IP-based limiting
 * - Global system limiting
 */

const logger = require('../utils/logger');

class RateLimiter {
    constructor() {
        // Storage for rate limiting data
        this.userLimits = new Map();
        this.anonymousLimits = new Map();
        this.ipLimits = new Map();
        this.globalLimits = {
            connections: 0,
            messages: [],
            maxConnections: 1000,
            maxMessagesPerSecond: 100
        };
        
        // Rate limit configurations
        this.limits = {
            authenticated: {
                messages: { count: 60, window: 60000 }, // 60 per minute
                messagesHourly: { count: 1000, window: 3600000 }, // 1000 per hour
                threads: { count: 50, window: 3600000 }, // 50 threads per hour
                connections: { count: 10, window: 60000 } // 10 connections per minute
            },
            anonymous: {
                messages: { count: 10, window: 60000 }, // 10 per minute
                messagesHourly: { count: 100, window: 3600000 }, // 100 per hour
                threads: { count: 5, window: 3600000 }, // 5 threads per hour
                connections: { count: 3, window: 60000 } // 3 connections per minute
            },
            ip: {
                connections: { count: 20, window: 60000 }, // 20 connections per minute
                messages: { count: 200, window: 60000 }, // 200 messages per minute
                auth_attempts: { count: 20, window: 60000 } // 20 auth attempts per minute (increased for testing)
            },
            global: {
                maxConnections: 1000,
                maxMessagesPerSecond: 100
            }
        };

        // Cleanup intervals
        this.cleanupInterval = setInterval(() => this.cleanup(), 60000); // Cleanup every minute
    }

    /**
     * Check rate limit for a specific action
     * @param {string} type - Type of action (message, connection, thread, auth)
     * @param {Object} context - Context containing userId, connectionId, ip
     * @returns {Object} {allowed: boolean, remaining: number, resetIn: number, reason?: string}
     */
    checkRateLimit(type, context) {
        const { userId, connectionId, ip, isAuthenticated = false } = context;
        const now = Date.now();

        try {
            // 1. Check global limits first
            const globalCheck = this.checkGlobalLimits(type, now);
            if (!globalCheck.allowed) {
                logger.logSecurity('rate_limit_exceeded', {
                    type: 'global',
                    action: type,
                    context,
                    reason: globalCheck.reason
                });
                return globalCheck;
            }

            // 2. Check IP-based limits
            const ipCheck = this.checkIpLimits(type, ip, now);
            if (!ipCheck.allowed) {
                logger.logSecurity('rate_limit_exceeded', {
                    type: 'ip',
                    action: type,
                    ip,
                    reason: ipCheck.reason
                });
                return ipCheck;
            }

            // 3. Check user-specific limits
            let userCheck;
            if (isAuthenticated && userId) {
                userCheck = this.checkUserLimits(type, userId, now, 'authenticated');
            } else {
                const identifier = userId || connectionId || ip;
                userCheck = this.checkUserLimits(type, identifier, now, 'anonymous');
            }

            if (!userCheck.allowed) {
                logger.logSecurity('rate_limit_exceeded', {
                    type: isAuthenticated ? 'user' : 'anonymous',
                    action: type,
                    userId: isAuthenticated ? userId : undefined,
                    connectionId: !isAuthenticated ? connectionId : undefined,
                    reason: userCheck.reason
                });
                return userCheck;
            }

            // All checks passed - record the action
            this.recordAction(type, context, now);

            return {
                allowed: true,
                remaining: userCheck.remaining,
                resetIn: userCheck.resetIn
            };

        } catch (error) {
            logger.logError('Rate limiter error', error, { type, context });
            // Fail open for system errors, but log the issue
            return { allowed: true, remaining: 0, resetIn: 60000 };
        }
    }

    /**
     * Check global system limits
     */
    checkGlobalLimits(type, now) {
        const limits = this.limits.global;

        if (type === 'connection') {
            if (this.globalLimits.connections >= limits.maxConnections) {
                return {
                    allowed: false,
                    remaining: 0,
                    resetIn: 60000,
                    reason: 'Global connection limit exceeded'
                };
            }
        }

        if (type === 'message') {
            // Clean old messages from the last second
            this.globalLimits.messages = this.globalLimits.messages.filter(
                timestamp => now - timestamp < 1000
            );

            if (this.globalLimits.messages.length >= limits.maxMessagesPerSecond) {
                return {
                    allowed: false,
                    remaining: 0,
                    resetIn: 1000,
                    reason: 'Global message rate limit exceeded'
                };
            }
        }

        return { allowed: true };
    }

    /**
     * Check IP-based limits
     */
    checkIpLimits(type, ip, now) {
        if (!ip) return { allowed: true };

        if (!this.ipLimits.has(ip)) {
            this.ipLimits.set(ip, {
                connections: [],
                messages: [],
                auth_attempts: []
            });
        }

        const ipData = this.ipLimits.get(ip);
        const limitConfig = this.limits.ip[type];

        if (!limitConfig) return { allowed: true };

        // Clean old entries
        ipData[type] = ipData[type].filter(
            timestamp => now - timestamp < limitConfig.window
        );

        if (ipData[type].length >= limitConfig.count) {
            const oldestEntry = Math.min(...ipData[type]);
            const resetIn = limitConfig.window - (now - oldestEntry);

            return {
                allowed: false,
                remaining: 0,
                resetIn: Math.max(resetIn, 0),
                reason: `IP ${type} limit exceeded`
            };
        }

        return {
            allowed: true,
            remaining: limitConfig.count - ipData[type].length,
            resetIn: limitConfig.window
        };
    }

    /**
     * Check user-specific limits (authenticated or anonymous)
     */
    checkUserLimits(type, identifier, now, userType) {
        if (!identifier) return { allowed: true };

        const limitsMap = userType === 'authenticated' ? this.userLimits : this.anonymousLimits;
        const limitConfigs = this.limits[userType];

        if (!limitsMap.has(identifier)) {
            limitsMap.set(identifier, {
                messages: [],
                messagesHourly: [],
                threads: [],
                connections: []
            });
        }

        const userData = limitsMap.get(identifier);

        // Check all relevant limits for this action
        const checks = [];

        if (type === 'message') {
            // Check minute limit
            checks.push({
                name: 'messages',
                config: limitConfigs.messages,
                data: userData.messages
            });
            // Check hourly limit
            checks.push({
                name: 'messagesHourly',
                config: limitConfigs.messagesHourly,
                data: userData.messagesHourly
            });
        } else if (limitConfigs[type]) {
            checks.push({
                name: type,
                config: limitConfigs[type],
                data: userData[type]
            });
        }

        for (const check of checks) {
            // Clean old entries
            check.data = check.data.filter(
                timestamp => now - timestamp < check.config.window
            );

            if (check.data.length >= check.config.count) {
                const oldestEntry = Math.min(...check.data);
                const resetIn = check.config.window - (now - oldestEntry);

                return {
                    allowed: false,
                    remaining: 0,
                    resetIn: Math.max(resetIn, 0),
                    reason: `${userType} ${check.name} limit exceeded`
                };
            }
        }

        // Calculate remaining and reset time for the most restrictive limit
        let minRemaining = Infinity;
        let maxResetIn = 0;

        for (const check of checks) {
            const remaining = check.config.count - check.data.length;
            if (remaining < minRemaining) {
                minRemaining = remaining;
                maxResetIn = check.config.window;
            }
        }

        return {
            allowed: true,
            remaining: minRemaining === Infinity ? 100 : minRemaining,
            resetIn: maxResetIn
        };
    }

    /**
     * Record an action after rate limit checks pass
     */
    recordAction(type, context, now) {
        const { userId, connectionId, ip, isAuthenticated = false } = context;

        // Record global action
        if (type === 'connection') {
            this.globalLimits.connections++;
        } else if (type === 'message') {
            this.globalLimits.messages.push(now);
        }

        // Record IP action
        if (ip && this.limits.ip[type]) {
            if (!this.ipLimits.has(ip)) {
                this.ipLimits.set(ip, {
                    connections: [],
                    messages: [],
                    auth_attempts: []
                });
            }
            this.ipLimits.get(ip)[type].push(now);
        }

        // Record user action
        const identifier = userId || connectionId || ip;
        if (identifier) {
            const limitsMap = isAuthenticated ? this.userLimits : this.anonymousLimits;
            
            if (!limitsMap.has(identifier)) {
                limitsMap.set(identifier, {
                    messages: [],
                    messagesHourly: [],
                    threads: [],
                    connections: []
                });
            }

            const userData = limitsMap.get(identifier);
            
            if (type === 'message') {
                userData.messages.push(now);
                userData.messagesHourly.push(now);
            } else if (userData[type]) {
                userData[type].push(now);
            }
        }
    }

    /**
     * Decrement connection count (called when connection closes)
     */
    decrementConnection(context) {
        const { ip } = context;
        
        // Decrement global connection count
        this.globalLimits.connections = Math.max(0, this.globalLimits.connections - 1);

        logger.logWebSocketEvent('connection_closed', null, null, {
            ip,
            globalConnections: this.globalLimits.connections
        });
    }

    /**
     * Get current rate limit status for monitoring
     */
    getStatus(context) {
        const { userId, connectionId, ip, isAuthenticated = false } = context;
        const now = Date.now();

        const status = {
            global: {
                connections: this.globalLimits.connections,
                maxConnections: this.limits.global.maxConnections,
                messagesInLastSecond: this.globalLimits.messages.filter(
                    t => now - t < 1000
                ).length
            },
            ip: {},
            user: {}
        };

        // IP status
        if (ip && this.ipLimits.has(ip)) {
            const ipData = this.ipLimits.get(ip);
            status.ip = {
                connections: ipData.connections.filter(t => now - t < this.limits.ip.connections.window).length,
                messages: ipData.messages.filter(t => now - t < this.limits.ip.messages.window).length,
                auth_attempts: ipData.auth_attempts.filter(t => now - t < this.limits.ip.auth_attempts.window).length
            };
        }

        // User status
        const identifier = userId || connectionId || ip;
        if (identifier) {
            const limitsMap = isAuthenticated ? this.userLimits : this.anonymousLimits;
            if (limitsMap.has(identifier)) {
                const userData = limitsMap.get(identifier);
                const limits = this.limits[isAuthenticated ? 'authenticated' : 'anonymous'];
                
                status.user = {
                    messages: userData.messages.filter(t => now - t < limits.messages.window).length,
                    messagesHourly: userData.messagesHourly.filter(t => now - t < limits.messagesHourly.window).length,
                    threads: userData.threads.filter(t => now - t < limits.threads.window).length,
                    connections: userData.connections.filter(t => now - t < limits.connections.window).length
                };
            }
        }

        return status;
    }

    /**
     * Clean up old entries to prevent memory leaks
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 3600000; // 1 hour

        // Clean up user limits
        this.cleanupMap(this.userLimits, now, maxAge);
        this.cleanupMap(this.anonymousLimits, now, maxAge);
        this.cleanupMap(this.ipLimits, now, maxAge);

        // Clean up global messages
        this.globalLimits.messages = this.globalLimits.messages.filter(
            timestamp => now - timestamp < 10000 // Keep last 10 seconds
        );

        try {
            if (logger && typeof logger.logPerformance === 'function') {
                logger.logPerformance('rate_limiter_cleanup', 60000, {
                    userEntries: this.userLimits.size,
                    anonymousEntries: this.anonymousLimits.size,
                ipEntries: this.ipLimits.size,
                globalMessages: this.globalLimits.messages.length
            });
        } else {
            console.log('Rate limiter cleanup completed');
        }
        } catch (error) {
            console.error('Rate limiter cleanup error:', error.message);
        }
    }

    /**
     * Clean up a specific map
     */
    cleanupMap(map, now, maxAge) {
        for (const [key, data] of map.entries()) {
            let hasRecentActivity = false;

            for (const [actionType, timestamps] of Object.entries(data)) {
                // Filter out old timestamps
                data[actionType] = timestamps.filter(timestamp => now - timestamp < maxAge);
                
                if (data[actionType].length > 0) {
                    hasRecentActivity = true;
                }
            }

            // Remove entries with no recent activity
            if (!hasRecentActivity) {
                map.delete(key);
            }
        }
    }

    /**
     * Reset limits for testing or admin purposes
     */
    resetLimits(identifier, type = 'all') {
        if (type === 'all' || type === 'user') {
            this.userLimits.delete(identifier);
        }
        if (type === 'all' || type === 'anonymous') {
            this.anonymousLimits.delete(identifier);
        }
        if (type === 'all' || type === 'ip') {
            this.ipLimits.delete(identifier);
        }
        
        logger.logSecurity('rate_limits_reset', { identifier, type });
    }

    /**
     * Destroy the rate limiter and cleanup
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.userLimits.clear();
        this.anonymousLimits.clear();
        this.ipLimits.clear();
    }
}

// Create singleton instance
const rateLimiter = new RateLimiter();

module.exports = rateLimiter;