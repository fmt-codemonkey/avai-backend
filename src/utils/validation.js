/**
 * Input Validation and Sanitization System for AVAI WebSocket Backend
 * Provides comprehensive validation, sanitization, and security checks
 */

const crypto = require('crypto');

// UUID helper functions to handle ES module compatibility
let uuidModule = null;

async function loadUUID() {
  if (!uuidModule) {
    try {
      uuidModule = await import('uuid');
    } catch (error) {
      // Fallback to older CommonJS version if available
      try {
        uuidModule = require('uuid');
      } catch (fallbackError) {
        console.error('Unable to load UUID module:', error, fallbackError);
        throw new Error('UUID module not available');
      }
    }
  }
  return uuidModule;
}

// Synchronous UUID functions using crypto.randomUUID (Node.js 14.17.0+)
function uuidv4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback UUID v4 generation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function validateUUID(uuid) {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }
  // UUID v4 regex pattern
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(uuid);
}

class Validator {
  constructor() {
    this.maxMessageLength = parseInt(process.env.MAX_MESSAGE_LENGTH) || 5000;
    this.maxThreadTitleLength = parseInt(process.env.MAX_THREAD_TITLE_LENGTH) || 200;
    this.allowedMessageTypes = [
      'send_message',
      'typing_indicator',
      'create_thread',
      'get_threads',
      'get_thread_messages',
      'delete_thread',
      'update_thread_title',
      'authenticate',
      'heartbeat'
    ];
  }

  /**
   * Validate WebSocket message structure
   * @param {Object} message - Raw message object
   * @returns {Object} Validation result with success status and errors
   */
  validateMessage(message) {
    const errors = [];

    // Check if message is an object
    if (!message || typeof message !== 'object') {
      return {
        success: false,
        errors: ['Message must be a valid JSON object'],
        sanitized: null
      };
    }

    // Validate required fields
    if (!message.type) {
      errors.push('Message type is required');
    } else if (typeof message.type !== 'string') {
      errors.push('Message type must be a string');
    } else if (!this.allowedMessageTypes.includes(message.type)) {
      errors.push(`Invalid message type: ${message.type}`);
    }

    // Validate message structure based on type
    if (message.type) {
      const typeValidation = this.validateMessageByType(message);
      errors.push(...typeValidation.errors);
    }

    // Sanitize the message
    const sanitized = this.sanitizeMessage(message);

    return {
      success: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * Validate message based on its type
   * @param {Object} message - Message object
   * @returns {Object} Type-specific validation result
   */
  validateMessageByType(message) {
    const errors = [];

    switch (message.type) {
      case 'send_message':
        errors.push(...this.validateSendMessage(message));
        break;
      case 'typing_indicator':
        errors.push(...this.validateTypingIndicator(message));
        break;
      case 'create_thread':
        errors.push(...this.validateCreateThread(message));
        break;
      case 'get_thread_messages':
        errors.push(...this.validateGetThreadMessages(message));
        break;
      case 'delete_thread':
      case 'update_thread_title':
        errors.push(...this.validateThreadOperation(message));
        break;
      case 'authenticate':
        errors.push(...this.validateAuthenticate(message));
        break;
      case 'get_threads':
      case 'heartbeat':
        // These messages don't require additional validation
        break;
      default:
        errors.push(`Unknown message type: ${message.type}`);
    }

    return { errors };
  }

  /**
   * Validate send_message type
   * @param {Object} message - Message object
   * @returns {Array} Validation errors
   */
  validateSendMessage(message) {
    const errors = [];

    if (!message.content || typeof message.content !== 'string') {
      errors.push('Message content is required and must be a string');
    } else if (message.content.length === 0) {
      errors.push('Message content cannot be empty');
    } else if (message.content.length > this.maxMessageLength) {
      errors.push(`Message content exceeds maximum length of ${this.maxMessageLength} characters`);
    }

    if (!message.threadId) {
      errors.push('Thread ID is required for send_message');
    } else if (!this.validateUUID(message.threadId)) {
      errors.push('Thread ID must be a valid UUID');
    }

    return errors;
  }

  /**
   * Validate typing_indicator type
   * @param {Object} message - Message object
   * @returns {Array} Validation errors
   */
  validateTypingIndicator(message) {
    const errors = [];

    if (!message.threadId) {
      errors.push('Thread ID is required for typing_indicator');
    } else if (!this.validateUUID(message.threadId)) {
      errors.push('Thread ID must be a valid UUID');
    }

    if (message.isTyping !== undefined && typeof message.isTyping !== 'boolean') {
      errors.push('isTyping must be a boolean value');
    }

    return errors;
  }

  /**
   * Validate create_thread type
   * @param {Object} message - Message object
   * @returns {Array} Validation errors
   */
  validateCreateThread(message) {
    const errors = [];

    if (message.title) {
      if (typeof message.title !== 'string') {
        errors.push('Thread title must be a string');
      } else if (message.title.length > this.maxThreadTitleLength) {
        errors.push(`Thread title exceeds maximum length of ${this.maxThreadTitleLength} characters`);
      }
    }

    if (!message.initialMessage || typeof message.initialMessage !== 'string') {
      errors.push('Initial message is required and must be a string');
    } else if (message.initialMessage.length === 0) {
      errors.push('Initial message cannot be empty');
    } else if (message.initialMessage.length > this.maxMessageLength) {
      errors.push(`Initial message exceeds maximum length of ${this.maxMessageLength} characters`);
    }

    return errors;
  }

  /**
   * Validate get_thread_messages type
   * @param {Object} message - Message object
   * @returns {Array} Validation errors
   */
  validateGetThreadMessages(message) {
    const errors = [];

    if (!message.threadId) {
      errors.push('Thread ID is required for get_thread_messages');
    } else if (!this.validateUUID(message.threadId)) {
      errors.push('Thread ID must be a valid UUID');
    }

    if (message.limit !== undefined) {
      if (!Number.isInteger(message.limit) || message.limit < 1 || message.limit > 100) {
        errors.push('Limit must be an integer between 1 and 100');
      }
    }

    if (message.offset !== undefined) {
      if (!Number.isInteger(message.offset) || message.offset < 0) {
        errors.push('Offset must be a non-negative integer');
      }
    }

    return errors;
  }

  /**
   * Validate thread operations (delete, update)
   * @param {Object} message - Message object
   * @returns {Array} Validation errors
   */
  validateThreadOperation(message) {
    const errors = [];

    if (!message.threadId) {
      errors.push('Thread ID is required');
    } else if (!this.validateUUID(message.threadId)) {
      errors.push('Thread ID must be a valid UUID');
    }

    if (message.type === 'update_thread_title') {
      if (!message.title || typeof message.title !== 'string') {
        errors.push('New title is required and must be a string');
      } else if (message.title.length > this.maxThreadTitleLength) {
        errors.push(`Thread title exceeds maximum length of ${this.maxThreadTitleLength} characters`);
      }
    }

    return errors;
  }

  /**
   * Validate authenticate type
   * @param {Object} message - Message object
   * @returns {Array} Validation errors
   */
  validateAuthenticate(message) {
    const errors = [];

    if (!message.token && !message.anonymous) {
      errors.push('Either token or anonymous flag must be provided');
    }

    if (message.token && typeof message.token !== 'string') {
      errors.push('Token must be a string');
    }

    if (message.anonymous !== undefined && typeof message.anonymous !== 'boolean') {
      errors.push('Anonymous flag must be a boolean');
    }

    return errors;
  }

  /**
   * Validate UUID format
   * @param {string} uuid - UUID string to validate
   * @returns {boolean} True if valid UUID
   */
  validateUUID(uuid) {
    return validateUUID(uuid);
  }

  /**
   * Sanitize message content
   * @param {Object} message - Message object to sanitize
   * @returns {Object} Sanitized message object
   */
  sanitizeMessage(message) {
    if (!message || typeof message !== 'object') {
      return null;
    }

    const sanitized = { ...message };

    // Sanitize string fields
    Object.keys(sanitized).forEach(key => {
      if (typeof sanitized[key] === 'string') {
        sanitized[key] = this.sanitizeString(sanitized[key]);
      }
    });

    return sanitized;
  }

  /**
   * Sanitize string content
   * @param {string} str - String to sanitize
   * @returns {string} Sanitized string
   */
  sanitizeString(str) {
    if (typeof str !== 'string') {
      return str;
    }

    return str
      .trim() // Remove leading/trailing whitespace
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Remove control characters
      .slice(0, this.maxMessageLength); // Truncate if too long
  }

  /**
   * Sanitize HTML content to prevent XSS
   * @param {string} html - HTML string to sanitize
   * @returns {string} Sanitized HTML string
   */
  sanitizeHTML(html) {
    if (typeof html !== 'string') {
      return html;
    }

    // Basic HTML sanitization - remove script tags and event handlers
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
      .replace(/\s*on\w+\s*=\s*[^\s>]*/gi, '')
      .replace(/javascript:/gi, '')
      .replace(/vbscript:/gi, '')
      .replace(/data:/gi, '');
  }

  /**
   * Validate and sanitize user input for database operations
   * @param {Object} data - User input data
   * @param {Array} requiredFields - Required field names
   * @param {Object} fieldTypes - Field type definitions
   * @returns {Object} Validation result
   */
  validateUserInput(data, requiredFields = [], fieldTypes = {}) {
    const errors = [];
    const sanitized = {};

    // Check required fields
    requiredFields.forEach(field => {
      if (!data || data[field] === undefined || data[field] === null) {
        errors.push(`${field} is required`);
      }
    });

    // Validate and sanitize fields
    Object.keys(data || {}).forEach(field => {
      const value = data[field];
      const expectedType = fieldTypes[field];

      if (expectedType && typeof value !== expectedType) {
        errors.push(`${field} must be of type ${expectedType}`);
        return;
      }

      // Sanitize based on type
      if (typeof value === 'string') {
        sanitized[field] = this.sanitizeString(value);
      } else {
        sanitized[field] = value;
      }
    });

    return {
      success: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * Validate pagination parameters
   * @param {number} limit - Limit parameter
   * @param {number} offset - Offset parameter
   * @returns {Object} Validation result
   */
  validatePagination(limit, offset) {
    const errors = [];
    const sanitized = {};

    // Validate limit
    if (limit !== undefined) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
        errors.push('Limit must be an integer between 1 and 100');
      } else {
        sanitized.limit = limit;
      }
    } else {
      sanitized.limit = 20; // Default limit
    }

    // Validate offset
    if (offset !== undefined) {
      if (!Number.isInteger(offset) || offset < 0) {
        errors.push('Offset must be a non-negative integer');
      } else {
        sanitized.offset = offset;
      }
    } else {
      sanitized.offset = 0; // Default offset
    }

    return {
      success: errors.length === 0,
      errors,
      sanitized
    };
  }

  /**
   * Generate safe UUID
   * @returns {string} Valid UUID v4
   */
  generateUUID() {
    return uuidv4();
  }

  /**
   * Validate email format
   * @param {string} email - Email string to validate
   * @returns {boolean} True if valid email format
   */
  validateEmail(email) {
    if (!email || typeof email !== 'string') {
      return false;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate URL format
   * @param {string} url - URL string to validate
   * @returns {boolean} True if valid URL format
   */
  validateURL(url) {
    if (!url || typeof url !== 'string') {
      return false;
    }
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check for potential security threats in text
   * @param {string} text - Text to check
   * @returns {Object} Security check result
   */
  checkSecurityThreats(text) {
    if (typeof text !== 'string') {
      return { threats: [], safe: true };
    }

    const threats = [];
    
    // Check for SQL injection patterns
    const sqlPatterns = [
      /(\bUNION\b.*\bSELECT\b)/i,
      /(\bSELECT\b.*\bFROM\b)/i,
      /(\bINSERT\b.*\bINTO\b)/i,
      /(\bDELETE\b.*\bFROM\b)/i,
      /(\bDROP\b.*\bTABLE\b)/i,
      /(\b(OR|AND)\b.*=.*)/i
    ];

    sqlPatterns.forEach(pattern => {
      if (pattern.test(text)) {
        threats.push('Potential SQL injection attempt');
      }
    });

    // Check for XSS patterns
    const xssPatterns = [
      /<script[^>]*>.*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe[^>]*>/gi
    ];

    xssPatterns.forEach(pattern => {
      if (pattern.test(text)) {
        threats.push('Potential XSS attempt');
      }
    });

    // Check for command injection
    const cmdPatterns = [
      /[\|;&$`<>]/,
      /\b(rm|del|format|sudo|su)\b/i
    ];

    cmdPatterns.forEach(pattern => {
      if (pattern.test(text)) {
        threats.push('Potential command injection attempt');
      }
    });

    return {
      threats: [...new Set(threats)], // Remove duplicates
      safe: threats.length === 0
    };
  }
}

// Export singleton instance
module.exports = new Validator();