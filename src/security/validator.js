/**
 * Comprehensive Security Validator
 * Detects and prevents various security threats including:
 * - XSS (Cross-Site Scripting)
 * - SQL Injection
 * - Command Injection
 * - Path Traversal
 * - JWT validation
 * - Input sanitization
 */

const logger = require('../utils/logger');

class SecurityValidator {
    constructor() {
        // XSS patterns
        this.xssPatterns = [
            /<script[^>]*>.*?<\/script>/gi,
            /javascript:/gi,
            /on\w+\s*=/gi,
            /<iframe[^>]*>.*?<\/iframe>/gi,
            /<object[^>]*>.*?<\/object>/gi,
            /<embed[^>]*>/gi,
            /<link[^>]*>/gi,
            /<meta[^>]*>/gi,
            /expression\s*\(/gi,
            /vbscript:/gi,
            /livescript:/gi,
            /mocha:/gi,
            /<\s*svg[^>]*>/gi,
            /data:text\/html/gi,
            /eval\s*\(/gi,
            /setTimeout\s*\(/gi,
            /setInterval\s*\(/gi
        ];

        // SQL Injection patterns
        this.sqlPatterns = [
            /(\b(select|insert|update|delete|drop|create|alter|exec|execute|union|or|and)\b)/gi,
            /('|(\\'))|(;)|(--)|(\s)|\/\*|\*\//gi,
            /\b(union\s+(all\s+)?select)\b/gi,
            /\b(select\s+.*\s+from)\b/gi,
            /\b(insert\s+into)\b/gi,
            /\b(update\s+.*\s+set)\b/gi,
            /\b(delete\s+from)\b/gi,
            /\b(drop\s+(table|database))\b/gi,
            /\b(create\s+(table|database))\b/gi,
            /\b(alter\s+table)\b/gi,
            /(\bor\b|\band\b)\s+\w+\s*=\s*\w+/gi,
            /'\s*(or|and)\s+.*?=/gi,
            /=\s*'\s*(or|and)/gi
        ];

        // Command Injection patterns
        this.commandPatterns = [
            /[;&|`$(){}[\]\\]/g,
            /\$\(.+\)/g,
            /`[^`]*`/g,
            /\$\{[^}]*\}/g,
            /\|\s*(ls|cat|pwd|whoami|id|ps|netstat|wget|curl|nc|ncat|bash|sh|zsh|fish|csh|tcsh)/gi,
            /;\s*(ls|cat|pwd|whoami|id|ps|netstat|wget|curl|nc|ncat|bash|sh|zsh|fish|csh|tcsh)/gi,
            /&&\s*(ls|cat|pwd|whoami|id|ps|netstat|wget|curl|nc|ncat|bash|sh|zsh|fish|csh|tcsh)/gi,
            /\|\|\s*(ls|cat|pwd|whoami|id|ps|netstat|wget|curl|nc|ncat|bash|sh|zsh|fish|csh|tcsh)/gi
        ];

        // Path Traversal patterns
        this.pathTraversalPatterns = [
            /\.\.[\/\\]/g,
            /[\/\\]\.\.[\/\\]/g,
            /%2e%2e[\/\\]/gi,
            /%252e%252e[\/\\]/gi,
            /\.\.%2f/gi,
            /\.\.%5c/gi,
            /%2e%2e%2f/gi,
            /%2e%2e%5c/gi
        ];

        // Suspicious keywords that might indicate malicious activity
        this.suspiciousKeywords = [
            'eval', 'exec', 'system', 'shell_exec', 'passthru', 'popen',
            'proc_open', 'file_get_contents', 'readfile', 'include', 'require',
            'base64_decode', 'base64_encode', 'urldecode', 'rawurldecode',
            'serialize', 'unserialize', 'phpinfo', 'show_source', 'highlight_file',
            'fopen', 'fwrite', 'fputs', 'fgets', 'fgetcsv', 'fclose',
            'file_put_contents', 'move_uploaded_file', 'copy', 'unlink',
            'rmdir', 'mkdir', 'chmod', 'chown', 'chgrp'
        ];

        // Content type validation
        this.maxMessageLength = 10000; // 10KB max message size
        this.maxFieldLength = 1000;
        this.maxNestedDepth = 10;
    }

    /**
     * Comprehensive security validation for incoming data
     * @param {any} data - Data to validate
     * @param {Object} context - Validation context
     * @returns {Object} Validation result with risk assessment
     */
    validateInput(data, context = {}) {
        try {
            const result = {
                isValid: true,
                riskLevel: 'LOW',
                threats: [],
                sanitizedData: null,
                warnings: []
            };

            // Basic validation
            if (data === null || data === undefined) {
                result.sanitizedData = data;
                return result;
            }

            // Check data size
            const sizeCheck = this.checkDataSize(data);
            if (!sizeCheck.isValid) {
                result.isValid = false;
                result.riskLevel = 'HIGH';
                result.threats.push({
                    type: 'SIZE_VIOLATION',
                    description: sizeCheck.reason,
                    severity: 'HIGH'
                });
                return result;
            }

            // Validate based on data type
            if (typeof data === 'string') {
                return this.validateString(data, context);
            } else if (typeof data === 'object') {
                return this.validateObject(data, context);
            } else {
                result.sanitizedData = data;
                return result;
            }

        } catch (error) {
            logger.logError('Security validation error', error, { data, context });
            return {
                isValid: false,
                riskLevel: 'HIGH',
                threats: [{
                    type: 'VALIDATION_ERROR',
                    description: 'Security validation failed',
                    severity: 'HIGH'
                }],
                sanitizedData: null,
                warnings: ['Validation error occurred']
            };
        }
    }

    /**
     * Validate string content for security threats
     */
    validateString(str, context = {}) {
        const result = {
            isValid: true,
            riskLevel: 'LOW',
            threats: [],
            sanitizedData: str,
            warnings: []
        };

        if (!str || typeof str !== 'string') {
            return result;
        }

        // Check string length
        if (str.length > this.maxMessageLength) {
            result.isValid = false;
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'SIZE_VIOLATION',
                description: `String too long: ${str.length} characters`,
                severity: 'HIGH'
            });
            return result;
        }

        // Check for XSS patterns
        const xssCheck = this.checkXSS(str);
        if (xssCheck.detected) {
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'XSS_ATTEMPT',
                description: 'Potential XSS attack detected',
                severity: 'HIGH',
                patterns: xssCheck.patterns
            });
            
            if (context.blockXSS !== false) {
                result.isValid = false;
            }
        }

        // Check for SQL injection
        const sqlCheck = this.checkSQLInjection(str);
        if (sqlCheck.detected) {
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'SQL_INJECTION',
                description: 'Potential SQL injection detected',
                severity: 'HIGH',
                patterns: sqlCheck.patterns
            });
            
            if (context.blockSQL !== false) {
                result.isValid = false;
            }
        }

        // Check for command injection
        const cmdCheck = this.checkCommandInjection(str);
        if (cmdCheck.detected) {
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'COMMAND_INJECTION',
                description: 'Potential command injection detected',
                severity: 'HIGH',
                patterns: cmdCheck.patterns
            });
            
            if (context.blockCommand !== false) {
                result.isValid = false;
            }
        }

        // Check for path traversal
        const pathCheck = this.checkPathTraversal(str);
        if (pathCheck.detected) {
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'PATH_TRAVERSAL',
                description: 'Potential path traversal detected',
                severity: 'HIGH',
                patterns: pathCheck.patterns
            });
            
            if (context.blockPath !== false) {
                result.isValid = false;
            }
        }

        // Check for suspicious keywords
        const keywordCheck = this.checkSuspiciousKeywords(str);
        if (keywordCheck.detected) {
            result.riskLevel = result.riskLevel === 'HIGH' ? 'HIGH' : 'MEDIUM';
            result.threats.push({
                type: 'SUSPICIOUS_CONTENT',
                description: 'Suspicious keywords detected',
                severity: 'MEDIUM',
                keywords: keywordCheck.keywords
            });
            
            if (context.warnOnly === false) {
                result.warnings.push('Suspicious content detected');
            }
        }

        // Sanitize the string if threats were found but not blocking
        if (result.threats.length > 0 && result.isValid) {
            result.sanitizedData = this.sanitizeString(str);
            result.warnings.push('Content was sanitized');
        }

        return result;
    }

    /**
     * Validate object structure and contents
     */
    validateObject(obj, context = {}, depth = 0) {
        const result = {
            isValid: true,
            riskLevel: 'LOW',
            threats: [],
            sanitizedData: {},
            warnings: []
        };

        if (depth > this.maxNestedDepth) {
            result.isValid = false;
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'NESTED_DEPTH_VIOLATION',
                description: `Object nesting too deep: ${depth}`,
                severity: 'HIGH'
            });
            return result;
        }

        try {
            for (const [key, value] of Object.entries(obj)) {
                // Validate key
                const keyValidation = this.validateString(key, { ...context, blockXSS: true });
                if (!keyValidation.isValid) {
                    result.isValid = false;
                    result.riskLevel = 'HIGH';
                    result.threats.push({
                        type: 'MALICIOUS_KEY',
                        description: `Invalid object key: ${key}`,
                        severity: 'HIGH'
                    });
                    continue;
                }

                // Validate value recursively
                let valueValidation;
                if (typeof value === 'object' && value !== null) {
                    valueValidation = this.validateObject(value, context, depth + 1);
                } else {
                    valueValidation = this.validateInput(value, context);
                }

                // Merge results
                if (!valueValidation.isValid) {
                    result.isValid = false;
                }
                
                if (valueValidation.riskLevel === 'HIGH') {
                    result.riskLevel = 'HIGH';
                } else if (valueValidation.riskLevel === 'MEDIUM' && result.riskLevel === 'LOW') {
                    result.riskLevel = 'MEDIUM';
                }

                result.threats.push(...valueValidation.threats);
                result.warnings.push(...valueValidation.warnings);

                // Use sanitized data
                result.sanitizedData[keyValidation.sanitizedData] = valueValidation.sanitizedData;
            }

            return result;

        } catch (error) {
            logger.logError('Object validation error', error, { obj, context, depth });
            return {
                isValid: false,
                riskLevel: 'HIGH',
                threats: [{
                    type: 'VALIDATION_ERROR',
                    description: 'Object validation failed',
                    severity: 'HIGH'
                }],
                sanitizedData: null,
                warnings: ['Object validation error']
            };
        }
    }

    /**
     * Check data size constraints
     */
    checkDataSize(data) {
        try {
            const serialized = JSON.stringify(data);
            if (serialized.length > this.maxMessageLength) {
                return {
                    isValid: false,
                    reason: `Data too large: ${serialized.length} bytes`
                };
            }
            return { isValid: true };
        } catch (error) {
            return {
                isValid: false,
                reason: 'Failed to serialize data'
            };
        }
    }

    /**
     * Check for XSS patterns
     */
    checkXSS(str) {
        const patterns = [];
        let detected = false;

        for (const pattern of this.xssPatterns) {
            if (pattern.test(str)) {
                detected = true;
                patterns.push(pattern.source);
            }
        }

        return { detected, patterns };
    }

    /**
     * Check for SQL injection patterns
     */
    checkSQLInjection(str) {
        const patterns = [];
        let detected = false;

        for (const pattern of this.sqlPatterns) {
            if (pattern.test(str)) {
                detected = true;
                patterns.push(pattern.source);
            }
        }

        return { detected, patterns };
    }

    /**
     * Check for command injection patterns
     */
    checkCommandInjection(str) {
        const patterns = [];
        let detected = false;

        for (const pattern of this.commandPatterns) {
            if (pattern.test(str)) {
                detected = true;
                patterns.push(pattern.source);
            }
        }

        return { detected, patterns };
    }

    /**
     * Check for path traversal patterns
     */
    checkPathTraversal(str) {
        const patterns = [];
        let detected = false;

        for (const pattern of this.pathTraversalPatterns) {
            if (pattern.test(str)) {
                detected = true;
                patterns.push(pattern.source);
            }
        }

        return { detected, patterns };
    }

    /**
     * Check for suspicious keywords
     */
    checkSuspiciousKeywords(str) {
        const keywords = [];
        let detected = false;

        const lowerStr = str.toLowerCase();
        for (const keyword of this.suspiciousKeywords) {
            if (lowerStr.includes(keyword)) {
                detected = true;
                keywords.push(keyword);
            }
        }

        return { detected, keywords };
    }

    /**
     * Sanitize string by removing/escaping dangerous content
     */
    sanitizeString(str) {
        let sanitized = str;

        // HTML escape
        sanitized = sanitized
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;');

        // Remove null bytes
        sanitized = sanitized.replace(/\0/g, '');

        // Remove or escape potentially dangerous characters
        sanitized = sanitized.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

        return sanitized;
    }

    /**
     * Validate JWT token format and structure
     */
    validateJWT(token) {
        const result = {
            isValid: true,
            riskLevel: 'LOW',
            threats: [],
            warnings: []
        };

        if (!token || typeof token !== 'string') {
            result.isValid = false;
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'INVALID_JWT_FORMAT',
                description: 'JWT token is missing or not a string',
                severity: 'HIGH'
            });
            return result;
        }

        // Basic JWT format check (3 parts separated by dots)
        const parts = token.split('.');
        if (parts.length !== 3) {
            result.isValid = false;
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'INVALID_JWT_FORMAT',
                description: 'JWT must have exactly 3 parts',
                severity: 'HIGH'
            });
            return result;
        }

        // Check token length (reasonable bounds)
        if (token.length < 50 || token.length > 2000) {
            result.isValid = false;
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'INVALID_JWT_LENGTH',
                description: `JWT token length suspicious: ${token.length}`,
                severity: 'HIGH'
            });
            return result;
        }

        // Check for base64url format in each part
        const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
        for (let i = 0; i < parts.length; i++) {
            if (!base64UrlPattern.test(parts[i])) {
                result.isValid = false;
                result.riskLevel = 'HIGH';
                result.threats.push({
                    type: 'INVALID_JWT_ENCODING',
                    description: `JWT part ${i + 1} has invalid base64url encoding`,
                    severity: 'HIGH'
                });
                return result;
            }
        }

        // Additional security checks on token content
        const contentCheck = this.validateString(token, {
            blockXSS: true,
            blockSQL: true,
            blockCommand: true
        });

        if (!contentCheck.isValid || contentCheck.threats.length > 0) {
            result.isValid = false;
            result.riskLevel = 'HIGH';
            result.threats.push({
                type: 'MALICIOUS_JWT_CONTENT',
                description: 'JWT contains potentially malicious content',
                severity: 'HIGH'
            });
        }

        return result;
    }

    /**
     * Validate message content specifically for chat messages
     */
    validateChatMessage(message) {
        const context = {
            blockXSS: true,
            blockSQL: true,
            blockCommand: true,
            blockPath: true,
            warnOnly: false
        };

        const validation = this.validateInput(message, context);

        // Additional chat-specific validations
        if (validation.isValid && typeof message === 'object') {
            // Check required fields
            if (!message.content || typeof message.content !== 'string') {
                validation.isValid = false;
                validation.threats.push({
                    type: 'INVALID_MESSAGE_FORMAT',
                    description: 'Message content is required and must be a string',
                    severity: 'HIGH'
                });
            }

            // Check content length
            if (message.content && message.content.length > 5000) {
                validation.isValid = false;
                validation.threats.push({
                    type: 'MESSAGE_TOO_LONG',
                    description: `Message content too long: ${message.content.length} characters`,
                    severity: 'MEDIUM'
                });
            }

            // Validate thread_id format if present
            if (message.thread_id) {
                const uuidPattern = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
                if (!uuidPattern.test(message.thread_id)) {
                    validation.isValid = false;
                    validation.threats.push({
                        type: 'INVALID_THREAD_ID',
                        description: 'Invalid thread ID format',
                        severity: 'HIGH'
                    });
                }
            }
        }

        return validation;
    }

    /**
     * Get security assessment summary
     */
    getSecurityAssessment(validationResult) {
        const assessment = {
            riskScore: 0,
            riskLevel: validationResult.riskLevel,
            isBlocked: !validationResult.isValid,
            threatCount: validationResult.threats.length,
            highSeverityThreats: validationResult.threats.filter(t => t.severity === 'HIGH').length,
            recommendations: []
        };

        // Calculate risk score
        validationResult.threats.forEach(threat => {
            switch (threat.severity) {
                case 'HIGH':
                    assessment.riskScore += 10;
                    break;
                case 'MEDIUM':
                    assessment.riskScore += 5;
                    break;
                case 'LOW':
                    assessment.riskScore += 1;
                    break;
            }
        });

        // Generate recommendations
        if (assessment.highSeverityThreats > 0) {
            assessment.recommendations.push('Block request immediately');
            assessment.recommendations.push('Log security incident');
            assessment.recommendations.push('Consider IP blocking if repeated');
        } else if (assessment.threatCount > 0) {
            assessment.recommendations.push('Sanitize content before processing');
            assessment.recommendations.push('Increase monitoring for this user');
        }

        return assessment;
    }
}

// Create singleton instance
const securityValidator = new SecurityValidator();

module.exports = securityValidator;