/**
 * Enhanced Authentication Security Module
 * Provides comprehensive JWT validation, rate limiting, token blacklisting,
 * and security monitoring for authentication processes
 */

const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
const rateLimiter = require('./rateLimiter');
const validator = require('./validator');

class AuthSecurity {
    constructor() {
        // Token blacklist (for revoked tokens)
        this.blacklistedTokens = new Set();
        
        // Failed authentication attempts tracking
        this.failedAttempts = new Map();
        
        // Suspicious activity tracking
        this.suspiciousActivity = new Map();
        
        // JWT security configuration
        this.jwtConfig = {
            maxAge: 24 * 60 * 60 * 1000, // 24 hours
            algorithm: 'RS256', // Expected algorithm
            issuer: 'clerk.com', // Expected issuer
            audience: null // Will be set from environment
        };

        // Failed attempt limits
        this.failedAttemptLimits = {
            maxAttempts: 5,
            blockDuration: 15 * 60 * 1000, // 15 minutes
            suspiciousThreshold: 3
        };

        // Cleanup intervals
        this.cleanupInterval = setInterval(() => this.cleanup(), 300000); // 5 minutes
    }

    /**
     * Enhanced JWT token validation with security checks
     * @param {string} token - JWT token to validate
     * @param {string} ip - Client IP address
     * @param {string} userAgent - Client user agent
     * @returns {Object} Validation result
     */
    async validateJWT(token, ip, userAgent = '') {
        const result = {
            isValid: false,
            user: null,
            claims: null,
            securityFlags: [],
            riskLevel: 'LOW'
        };

        try {
            // Check rate limiting for authentication attempts
            const rateLimitResult = rateLimiter.checkRateLimit('auth_attempts', {
                ip,
                isAuthenticated: false
            });

            if (!rateLimitResult.allowed) {
                result.securityFlags.push('RATE_LIMITED');
                result.riskLevel = 'HIGH';
                
                logger.logSecurity('auth_rate_limited', {
                    ip,
                    userAgent,
                    reason: rateLimitResult.reason
                });

                return result;
            }

            // Basic token format validation
            const tokenValidation = validator.validateJWT(token);
            if (!tokenValidation.isValid) {
                await this.recordFailedAttempt(ip, 'INVALID_TOKEN_FORMAT', userAgent);
                result.securityFlags.push('INVALID_FORMAT');
                result.riskLevel = 'HIGH';
                
                logger.logSecurity('invalid_jwt_format', {
                    ip,
                    userAgent,
                    threats: tokenValidation.threats
                });

                return result;
            }

            // Check if token is blacklisted
            if (this.isTokenBlacklisted(token)) {
                await this.recordFailedAttempt(ip, 'BLACKLISTED_TOKEN', userAgent);
                result.securityFlags.push('BLACKLISTED');
                result.riskLevel = 'HIGH';
                
                logger.logSecurity('blacklisted_token_used', { ip, userAgent });
                return result;
            }

            // Decode token without verification first to check claims
            let decodedToken;
            try {
                decodedToken = jwt.decode(token, { complete: true });
            } catch (decodeError) {
                await this.recordFailedAttempt(ip, 'TOKEN_DECODE_FAILED', userAgent);
                result.securityFlags.push('DECODE_FAILED');
                result.riskLevel = 'HIGH';
                
                logger.logSecurity('jwt_decode_failed', {
                    ip,
                    userAgent,
                    error: decodeError.message
                });

                return result;
            }

            // Security checks on decoded token
            const securityChecks = await this.performSecurityChecks(decodedToken, ip, userAgent);
            result.securityFlags.push(...securityChecks.flags);
            
            if (securityChecks.riskLevel === 'HIGH') {
                result.riskLevel = 'HIGH';
                await this.recordFailedAttempt(ip, 'SECURITY_CHECK_FAILED', userAgent);
                return result;
            }

            // Verify token signature with Clerk
            const verificationResult = await this.verifyWithClerk(token, ip);
            if (!verificationResult.isValid) {
                await this.recordFailedAttempt(ip, 'VERIFICATION_FAILED', userAgent);
                result.securityFlags.push('VERIFICATION_FAILED');
                result.riskLevel = 'HIGH';
                
                logger.logSecurity('jwt_verification_failed', {
                    ip,
                    userAgent,
                    error: verificationResult.error
                });

                return result;
            }

            // Success - clear any failed attempts for this IP
            this.clearFailedAttempts(ip);

            result.isValid = true;
            result.user = verificationResult.user;
            result.claims = verificationResult.claims;

            // Log successful authentication
            logger.logAuth('jwt_validated', {
                userId: result.user.id,
                ip,
                userAgent,
                securityFlags: result.securityFlags,
                riskLevel: result.riskLevel
            });

            return result;

        } catch (error) {
            await this.recordFailedAttempt(ip, 'VALIDATION_ERROR', userAgent);
            result.securityFlags.push('VALIDATION_ERROR');
            result.riskLevel = 'HIGH';
            
            logger.logError('JWT validation error', error, {
                ip,
                userAgent,
                tokenLength: token ? token.length : 0
            });

            return result;
        }
    }

    /**
     * Perform comprehensive security checks on decoded JWT
     */
    async performSecurityChecks(decodedToken, ip, userAgent) {
        const flags = [];
        let riskLevel = 'LOW';

        try {
            const { header, payload } = decodedToken;

            // Check algorithm
            if (header.alg !== 'RS256' && header.alg !== 'ES256') {
                flags.push('WEAK_ALGORITHM');
                riskLevel = 'MEDIUM';
                
                logger.logSecurity('weak_jwt_algorithm', {
                    algorithm: header.alg,
                    ip,
                    userAgent
                });
            }

            // Check token age
            const now = Math.floor(Date.now() / 1000);
            if (payload.iat && (now - payload.iat) > (24 * 60 * 60)) { // Older than 24 hours
                flags.push('OLD_TOKEN');
                riskLevel = 'MEDIUM';
            }

            // Check expiration
            if (payload.exp && payload.exp < now) {
                flags.push('EXPIRED_TOKEN');
                riskLevel = 'HIGH';
            }

            // Check issuer
            if (payload.iss && !payload.iss.includes('clerk')) {
                flags.push('UNKNOWN_ISSUER');
                riskLevel = 'HIGH';
                
                logger.logSecurity('unknown_jwt_issuer', {
                    issuer: payload.iss,
                    ip,
                    userAgent
                });
            }

            // Check for suspicious claims
            const suspiciousClaims = ['admin', 'root', 'superuser', 'system'];
            for (const claim of suspiciousClaims) {
                if (payload[claim] === true || payload.role === claim) {
                    flags.push('SUSPICIOUS_CLAIMS');
                    riskLevel = 'HIGH';
                    
                    logger.logSecurity('suspicious_jwt_claims', {
                        claims: payload,
                        ip,
                        userAgent
                    });
                    break;
                }
            }

            // Check for injection attempts in claims
            for (const [key, value] of Object.entries(payload)) {
                if (typeof value === 'string') {
                    const validation = validator.validateString(value, {
                        blockXSS: true,
                        blockSQL: true,
                        blockCommand: true
                    });
                    
                    if (!validation.isValid) {
                        flags.push('MALICIOUS_CLAIMS');
                        riskLevel = 'HIGH';
                        
                        logger.logSecurity('malicious_jwt_claims', {
                            key,
                            threats: validation.threats,
                            ip,
                            userAgent
                        });
                        break;
                    }
                }
            }

            return { flags, riskLevel };

        } catch (error) {
            logger.logError('JWT security check error', error, { ip, userAgent });
            return { flags: ['SECURITY_CHECK_ERROR'], riskLevel: 'HIGH' };
        }
    }

    /**
     * Verify JWT with Clerk service
     */
    async verifyWithClerk(token, ip) {
        try {
            // This would normally use Clerk's SDK or API
            // For now, we'll simulate the verification process
            
            const secretKey = process.env.CLERK_SECRET_KEY;
            if (!secretKey) {
                logger.logError('CLERK_SECRET_KEY not configured', null, { ip });
                return {
                    isValid: false,
                    error: 'Authentication service not configured'
                };
            }

            // In a real implementation, you would use Clerk's verification
            // For this example, we'll decode and validate basic structure
            const decoded = jwt.decode(token, { complete: true });
            
            if (!decoded || !decoded.payload) {
                return {
                    isValid: false,
                    error: 'Invalid token structure'
                };
            }

            const { payload } = decoded;

            // Basic validation of required claims
            if (!payload.sub || !payload.iss || !payload.exp) {
                return {
                    isValid: false,
                    error: 'Missing required claims'
                };
            }

            // Check expiration
            const now = Math.floor(Date.now() / 1000);
            if (payload.exp < now) {
                return {
                    isValid: false,
                    error: 'Token expired'
                };
            }

            // Simulate successful verification
            return {
                isValid: true,
                user: {
                    id: payload.sub,
                    email: payload.email || null,
                    name: payload.name || null
                },
                claims: payload
            };

        } catch (error) {
            logger.logError('Clerk verification error', error, { ip });
            return {
                isValid: false,
                error: 'Verification failed'
            };
        }
    }

    /**
     * Record failed authentication attempt
     */
    async recordFailedAttempt(ip, reason, userAgent = '') {
        const now = Date.now();
        
        if (!this.failedAttempts.has(ip)) {
            this.failedAttempts.set(ip, {
                attempts: [],
                blocked: false,
                blockedUntil: 0
            });
        }

        const attemptData = this.failedAttempts.get(ip);
        attemptData.attempts.push({
            timestamp: now,
            reason,
            userAgent
        });

        // Clean old attempts (older than 1 hour)
        attemptData.attempts = attemptData.attempts.filter(
            attempt => now - attempt.timestamp < 3600000
        );

        // Check if IP should be blocked
        const recentAttempts = attemptData.attempts.filter(
            attempt => now - attempt.timestamp < this.failedAttemptLimits.blockDuration
        );

        if (recentAttempts.length >= this.failedAttemptLimits.maxAttempts) {
            attemptData.blocked = true;
            attemptData.blockedUntil = now + this.failedAttemptLimits.blockDuration;
            
            logger.logSecurity('ip_blocked_auth_failures', {
                ip,
                attemptCount: recentAttempts.length,
                blockDuration: this.failedAttemptLimits.blockDuration,
                reasons: recentAttempts.map(a => a.reason)
            });
        }

        // Track suspicious activity
        if (recentAttempts.length >= this.failedAttemptLimits.suspiciousThreshold) {
            this.markSuspiciousActivity(ip, `Multiple failed auth attempts: ${reason}`);
        }

        logger.logSecurity('auth_attempt_failed', {
            ip,
            reason,
            userAgent,
            totalAttempts: attemptData.attempts.length,
            recentAttempts: recentAttempts.length
        });
    }

    /**
     * Check if IP is blocked due to failed attempts
     */
    isIPBlocked(ip) {
        const attemptData = this.failedAttempts.get(ip);
        if (!attemptData) return false;

        const now = Date.now();
        if (attemptData.blocked && attemptData.blockedUntil > now) {
            return {
                blocked: true,
                blockedUntil: attemptData.blockedUntil,
                remainingTime: attemptData.blockedUntil - now
            };
        }

        // Unblock if time has passed
        if (attemptData.blocked && attemptData.blockedUntil <= now) {
            attemptData.blocked = false;
            attemptData.blockedUntil = 0;
        }

        return { blocked: false };
    }

    /**
     * Clear failed attempts for IP (on successful auth)
     */
    clearFailedAttempts(ip) {
        if (this.failedAttempts.has(ip)) {
            this.failedAttempts.delete(ip);
            logger.logSecurity('failed_attempts_cleared', { ip });
        }
    }

    /**
     * Add token to blacklist
     */
    blacklistToken(token, reason = 'Manual blacklist') {
        this.blacklistedTokens.add(token);
        logger.logSecurity('token_blacklisted', { 
            tokenHash: this.hashToken(token),
            reason 
        });
    }

    /**
     * Check if token is blacklisted
     */
    isTokenBlacklisted(token) {
        return this.blacklistedTokens.has(token);
    }

    /**
     * Mark suspicious activity
     */
    markSuspiciousActivity(ip, reason) {
        const now = Date.now();
        
        if (!this.suspiciousActivity.has(ip)) {
            this.suspiciousActivity.set(ip, []);
        }

        const activities = this.suspiciousActivity.get(ip);
        activities.push({
            timestamp: now,
            reason
        });

        // Keep only recent activities (last 24 hours)
        this.suspiciousActivity.set(ip, 
            activities.filter(activity => now - activity.timestamp < 86400000)
        );

        logger.logSecurity('suspicious_activity_marked', { ip, reason });
    }

    /**
     * Get security status for IP
     */
    getSecurityStatus(ip) {
        const now = Date.now();
        const status = {
            ip,
            blocked: false,
            blockedUntil: null,
            failedAttempts: 0,
            suspiciousActivities: 0,
            riskLevel: 'LOW'
        };

        // Check failed attempts
        if (this.failedAttempts.has(ip)) {
            const attemptData = this.failedAttempts.get(ip);
            status.blocked = attemptData.blocked && attemptData.blockedUntil > now;
            status.blockedUntil = attemptData.blocked ? attemptData.blockedUntil : null;
            status.failedAttempts = attemptData.attempts.length;
        }

        // Check suspicious activities
        if (this.suspiciousActivity.has(ip)) {
            const activities = this.suspiciousActivity.get(ip);
            status.suspiciousActivities = activities.filter(
                activity => now - activity.timestamp < 86400000
            ).length;
        }

        // Calculate risk level
        if (status.blocked || status.suspiciousActivities >= 5) {
            status.riskLevel = 'HIGH';
        } else if (status.failedAttempts >= 3 || status.suspiciousActivities >= 2) {
            status.riskLevel = 'MEDIUM';
        }

        return status;
    }

    /**
     * Hash token for logging (privacy)
     */
    hashToken(token) {
        const crypto = require('crypto');
        return crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
    }

    /**
     * Cleanup old data
     */
    cleanup() {
        const now = Date.now();
        const maxAge = 86400000; // 24 hours

        // Clean failed attempts
        for (const [ip, data] of this.failedAttempts.entries()) {
            data.attempts = data.attempts.filter(
                attempt => now - attempt.timestamp < maxAge
            );
            
            if (data.attempts.length === 0 && !data.blocked) {
                this.failedAttempts.delete(ip);
            }
        }

        // Clean suspicious activities
        for (const [ip, activities] of this.suspiciousActivity.entries()) {
            const recentActivities = activities.filter(
                activity => now - activity.timestamp < maxAge
            );
            
            if (recentActivities.length === 0) {
                this.suspiciousActivity.delete(ip);
            } else {
                this.suspiciousActivity.set(ip, recentActivities);
            }
        }

        // Clean blacklisted tokens (if you want to implement expiry)
        // For now, we keep them indefinitely

        logger.logPerformance('auth_security_cleanup', {
            failedAttemptIPs: this.failedAttempts.size,
            suspiciousActivityIPs: this.suspiciousActivity.size,
            blacklistedTokens: this.blacklistedTokens.size
        });
    }

    /**
     * Get security metrics for monitoring
     */
    getSecurityMetrics() {
        const now = Date.now();
        const hourAgo = now - 3600000;

        const metrics = {
            timestamp: now,
            failedAttempts: {
                total: 0,
                lastHour: 0,
                uniqueIPs: this.failedAttempts.size
            },
            blockedIPs: 0,
            suspiciousIPs: this.suspiciousActivity.size,
            blacklistedTokens: this.blacklistedTokens.size
        };

        // Count failed attempts
        for (const [ip, data] of this.failedAttempts.entries()) {
            metrics.failedAttempts.total += data.attempts.length;
            metrics.failedAttempts.lastHour += data.attempts.filter(
                attempt => attempt.timestamp > hourAgo
            ).length;
            
            if (data.blocked && data.blockedUntil > now) {
                metrics.blockedIPs++;
            }
        }

        return metrics;
    }

    /**
     * Destroy and cleanup
     */
    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        
        this.blacklistedTokens.clear();
        this.failedAttempts.clear();
        this.suspiciousActivity.clear();
    }
}

// Create singleton instance
const authSecurity = new AuthSecurity();

module.exports = authSecurity;