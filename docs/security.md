# AVAI WebSocket Backend - Security Documentation

## Overview

The AVAI WebSocket backend implements comprehensive production-grade security measures to protect against various threats while maintaining high performance for legitimate users. This document outlines all security features, configurations, and best practices.

## Security Architecture

### Multi-Layer Security Model

```
┌─────────────────────────────────────────────┐
│               Client Request                │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│          Connection Security                │
│  • IP Rate Limiting                        │
│  • Global Connection Limits               │
│  • Pre-connection Validation              │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│         Authentication Security             │
│  • Enhanced JWT Validation                 │
│  • Failed Attempt Tracking                │
│  • IP Blocking                            │
│  • Token Blacklisting                     │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│          Message Security                   │
│  • Content Validation                      │
│  • XSS/SQL/Command Injection Detection    │
│  • Input Sanitization                     │
│  • Size Limits                           │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│           Rate Limiting                     │
│  • Multi-tier Limits                      │
│  • User/Anonymous/IP/Global               │
│  • Sliding Window Algorithm              │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│         Application Logic                   │
└─────────────────────────────────────────────┘
```

## Security Modules

### 1. Advanced Rate Limiter (`src/security/rateLimiter.js`)

**Purpose**: Multi-tier rate limiting with sliding window algorithm

**Features**:
- **User-based limiting**: Different limits for authenticated vs anonymous users
- **IP-based limiting**: Prevent abuse from specific IP addresses
- **Global limiting**: System-wide protection against DDoS
- **Operation-specific limits**: Different limits for messages, connections, auth attempts

**Rate Limits**:

| User Type | Messages/Min | Messages/Hour | Threads/Hour | Connections/Min |
|-----------|--------------|---------------|--------------|-----------------|
| Authenticated | 60 | 1,000 | 50 | 10 |
| Anonymous | 10 | 100 | 5 | 3 |
| Per IP | 200/min | - | - | 20 |
| Global | 100/sec | - | - | 1,000 total |

**API**:
```javascript
const rateLimiter = require('./security/rateLimiter');

// Check rate limit
const result = rateLimiter.checkRateLimit('message', {
    userId: 'user123',
    connectionId: 'conn456',
    ip: '192.168.1.1',
    isAuthenticated: true
});

if (!result.allowed) {
    // Handle rate limit exceeded
    console.log(`Rate limited: ${result.reason}`);
    console.log(`Retry after: ${result.resetIn}ms`);
}
```

### 2. Security Validator (`src/security/validator.js`)

**Purpose**: Comprehensive threat detection and input validation

**Detection Capabilities**:
- **XSS (Cross-Site Scripting)**: Detects script tags, event handlers, malicious URLs
- **SQL Injection**: Identifies SQL keywords, union attacks, comment patterns
- **Command Injection**: Finds shell metacharacters, command chaining
- **Path Traversal**: Detects directory traversal attempts
- **Suspicious Keywords**: Identifies potentially dangerous function calls

**Security Patterns**:

```javascript
// XSS Patterns
<script>, javascript:, on*= attributes, <iframe>, eval(), setTimeout()

// SQL Injection Patterns  
SELECT, INSERT, UNION, --, ;, ', OR 1=1, UNION SELECT

// Command Injection Patterns
|, ;, &, `, $(, ${, &&, ||, combined with system commands

// Path Traversal Patterns
../, ..\, %2e%2e, directory traversal sequences

// Suspicious Keywords
eval, exec, system, shell_exec, base64_decode, file_get_contents
```

**API**:
```javascript
const validator = require('./security/validator');

// Validate input
const result = validator.validateInput(userInput, {
    blockXSS: true,
    blockSQL: true, 
    blockCommand: true,
    blockPath: true
});

if (!result.isValid) {
    console.log('Security threats detected:', result.threats);
    console.log('Risk level:', result.riskLevel);
}

// Use sanitized data
const safeData = result.sanitizedData;
```

### 3. Authentication Security (`src/security/authSecurity.js`)

**Purpose**: Enhanced JWT validation and authentication protection

**Features**:
- **Enhanced JWT Validation**: Comprehensive token structure and content analysis
- **Failed Attempt Tracking**: Monitor and block suspicious authentication patterns
- **IP Blocking**: Temporary blocks after repeated failures
- **Token Blacklisting**: Revoke compromised tokens
- **Security Event Logging**: Detailed audit trail

**Security Checks**:
- Token format validation (3-part structure)
- Base64URL encoding verification
- Token length validation (50-2000 characters)
- Algorithm verification (RS256/ES256 expected)
- Token age and expiration checks
- Issuer validation (must contain 'clerk')
- Malicious content detection in claims
- Suspicious role/permission checks

**Failed Attempt Handling**:
- **5 failed attempts per IP per minute** → IP blocked for 15 minutes
- **3+ failures** → Marked as suspicious activity
- Automatic cleanup of old attempt records
- Exponential backoff for repeated failures

**API**:
```javascript
const authSecurity = require('./security/authSecurity');

// Validate JWT
const result = await authSecurity.validateJWT(token, clientIP, userAgent);

if (!result.isValid) {
    console.log('Authentication failed:', result.securityFlags);
    console.log('Risk level:', result.riskLevel);
} else {
    console.log('User authenticated:', result.user);
}

// Check IP status
const ipStatus = authSecurity.getSecurityStatus(clientIP);
console.log('IP risk level:', ipStatus.riskLevel);
```

## Implementation Details

### WebSocket Connection Security

**Pre-connection Validation** (`src/server.js`):
```javascript
// 1. Check connection rate limits
const connectionRateLimit = securityRateLimiter.checkRateLimit('connection', {
    ip: clientIP,
    isAuthenticated: false
});

// 2. Check if IP is blocked
const ipStatus = authSecurity.isIPBlocked(clientIP);

// 3. Allow/deny connection
if (!connectionRateLimit.allowed || ipStatus.blocked) {
    connection.close(1013, 'Connection denied');
}
```

**Connection Tracking**:
- Each connection gets unique security context
- IP address, user agent, and risk level tracking
- Security flags accumulated during session
- Automatic cleanup on disconnect

### Message Processing Security

**Enhanced Validation Pipeline**:
```javascript
// 1. Security validation
const securityValidation = securityValidator.validateInput(message);

// 2. Rate limiting
const rateLimitResult = securityRateLimiter.checkRateLimit('message', context);

// 3. Content-specific validation
const contentValidation = securityValidator.validateChatMessage(message);

// 4. Legacy validation (backward compatibility)
const legacyValidation = validator.validateMessage(sanitizedMessage);
```

**Error Response Format**:
```json
{
  "type": "error",
  "error_type": "SECURITY_VIOLATION" | "RATE_LIMIT" | "AUTH_FAILED",
  "message": "Human readable description",
  "retry_after": 30,
  "timestamp": "2025-09-21T10:30:00.000Z",
  "threats": ["XSS_ATTEMPT", "SQL_INJECTION"]
}
```

### Authentication Flow Security

**Enhanced JWT Process**:
```javascript
// 1. IP blocking check
const ipStatus = authSecurity.isIPBlocked(clientIP);

// 2. Authentication rate limiting
const authRateLimit = rateLimiter.checkRateLimit('auth_attempts', { ip: clientIP });

// 3. Comprehensive JWT validation
const jwtResult = await authSecurity.validateJWT(token, clientIP, userAgent);

// 4. Security flag tracking
connection.securityFlags = jwtResult.securityFlags;
connection.riskLevel = jwtResult.riskLevel;
```

## Security Configuration

### Environment Variables

```bash
# Rate Limiting
MAX_MESSAGE_SIZE=10240                    # 10KB max message size
CONNECTION_TIMEOUT=1800000                # 30 minutes
MAX_CONNECTIONS_PER_IP=20                 # 20 connections per IP per minute
MAX_GLOBAL_CONNECTIONS=1000               # Global connection limit

# Authentication
CLERK_SECRET_KEY=sk_test_...              # Clerk authentication key
JWT_MAX_AGE=86400000                      # 24 hours JWT max age
AUTH_RATE_LIMIT=5                         # 5 auth attempts per minute per IP

# Security
SECURITY_LOG_LEVEL=info                   # Security event logging level
BLOCK_DURATION=900000                     # 15 minutes IP block duration
THREAT_DETECTION_ENABLED=true             # Enable threat detection
```

### Rate Limit Configuration

Modify limits in `src/security/rateLimiter.js`:

```javascript
this.limits = {
    authenticated: {
        messages: { count: 60, window: 60000 },        // 60/min
        messagesHourly: { count: 1000, window: 3600000 }, // 1000/hour
        threads: { count: 50, window: 3600000 },       // 50/hour
        connections: { count: 10, window: 60000 }      // 10/min
    },
    anonymous: {
        messages: { count: 10, window: 60000 },        // 10/min
        messagesHourly: { count: 100, window: 3600000 }, // 100/hour
        threads: { count: 5, window: 3600000 },        // 5/hour
        connections: { count: 3, window: 60000 }       // 3/min
    },
    // ... customize as needed
};
```

## Security Monitoring

### Security Events

All security events are logged with structured data:

```javascript
// Rate limiting events
logger.logSecurity('rate_limit_exceeded', {
    type: 'user',
    action: 'message',
    userId: 'user123',
    ip: '192.168.1.1',
    reason: 'Message rate limit exceeded'
});

// Authentication security events
logger.logSecurity('auth_failed', {
    ip: '192.168.1.1',
    userAgent: 'Mozilla/5.0...',
    reason: 'Invalid JWT format',
    securityFlags: ['INVALID_FORMAT']
});

// Threat detection events
logger.logSecurity('security_violation', {
    connectionId: 'conn123',
    userId: 'user456',
    threats: ['XSS_ATTEMPT'],
    riskLevel: 'HIGH',
    content: 'sanitized content preview'
});
```

### Metrics and Monitoring

**Rate Limiter Status**:
```javascript
const status = rateLimiter.getStatus({
    userId: 'user123',
    ip: '192.168.1.1',
    isAuthenticated: true
});

console.log('Global connections:', status.global.connections);
console.log('IP message count:', status.ip.messages);
console.log('User remaining limits:', status.user);
```

**Authentication Security Metrics**:
```javascript
const metrics = authSecurity.getSecurityMetrics();

console.log('Failed attempts last hour:', metrics.failedAttempts.lastHour);
console.log('Blocked IPs:', metrics.blockedIPs);
console.log('Blacklisted tokens:', metrics.blacklistedTokens);
```

## Testing Security

### Running Security Tests

```bash
# Run comprehensive security test suite
node tests/security-test-suite.js

# Test specific server
node tests/security-test-suite.js ws://localhost:8080/ws

# Run with debugging
DEBUG=security:* node tests/security-test-suite.js
```

### Test Categories

1. **Rate Limiting Tests**: Anonymous/authenticated limits, connection limits, auth attempt limits
2. **Security Validation Tests**: XSS, SQL injection, command injection, path traversal
3. **Authentication Security Tests**: JWT format validation, malformed tokens, empty tokens
4. **Connection Limit Tests**: Global connection limits, IP-based limits
5. **Content Security Tests**: Large message blocking, suspicious keyword detection
6. **JWT Security Tests**: Malicious JWT payloads, extremely long tokens
7. **IP Blocking Tests**: Failed attempt accumulation, temporary blocks
8. **Suspicious Activity Tests**: Pattern detection across multiple messages

### Manual Security Testing

**Test XSS Protection**:
```bash
# Using wscat
wscat -c ws://localhost:8080/ws
> {"type":"authenticate","anonymous":true}
> {"type":"send_message","threadId":"test-123","content":"<script>alert('XSS')</script>"}
# Should receive SECURITY_VIOLATION error
```

**Test Rate Limiting**:
```bash
# Send messages rapidly
for i in {1..15}; do
  echo '{"type":"send_message","threadId":"test-123","content":"Message '$i'"}' | wscat -c ws://localhost:8080/ws
done
# Should receive RATE_LIMIT error after limit exceeded
```

**Test Authentication Security**:
```bash
# Test invalid JWT
wscat -c ws://localhost:8080/ws
> {"type":"authenticate","token":"invalid.jwt.token"}
# Should receive AUTH_FAILED error
```

## Production Deployment Security

### Recommended Security Headers

```javascript
// Add to your reverse proxy (nginx/apache) or application
app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
});
```

### Network Security

```nginx
# Example nginx configuration
server {
    listen 443 ssl http2;
    
    # Rate limiting at nginx level
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req zone=api burst=20 nodelay;
    
    # Connection limiting
    limit_conn_zone $binary_remote_addr zone=addr:10m;
    limit_conn addr 10;
    
    # WebSocket specific
    location /ws {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        
        # Timeouts
        proxy_read_timeout 86400;
        proxy_send_timeout 86400;
    }
}
```

### Monitoring and Alerting

**Log Analysis**:
```bash
# Monitor security events
tail -f logs/security.log | grep "SECURITY_VIOLATION\|RATE_LIMIT\|AUTH_FAILED"

# Count security events by type
cat logs/security.log | jq -r '.event_type' | sort | uniq -c

# Monitor IP blocking
cat logs/security.log | grep "ip_blocked" | jq -r '.ip' | sort | uniq -c
```

**Alerts to Set Up**:
- High rate of security violations from single IP
- Unusual number of authentication failures
- Global rate limits being approached
- Suspicious activity patterns
- Failed database connections affecting security

### Security Incident Response

**Immediate Actions**:
1. **IP Blocking**: Temporarily block offending IP addresses
2. **Token Revocation**: Blacklist compromised JWT tokens
3. **Rate Limit Adjustment**: Temporarily reduce limits if under attack
4. **Connection Limiting**: Reduce max connections during DDoS

**Investigation Steps**:
1. Analyze security logs for attack patterns
2. Check authentication failure patterns
3. Review rate limiting effectiveness
4. Examine any security validation bypasses
5. Assess system performance impact

**Recovery Actions**:
1. Clear rate limiters for legitimate users
2. Remove temporary IP blocks
3. Update security rules based on learnings
4. Adjust rate limits if needed
5. Notify users if service was impacted

## Security Maintenance

### Regular Tasks

**Weekly**:
- Review security event logs
- Monitor rate limiting effectiveness
- Check for new threat patterns
- Update blacklisted tokens if needed

**Monthly**:
- Analyze security metrics trends
- Review and update security patterns
- Test security response procedures
- Update documentation

**Quarterly**:
- Full security audit
- Penetration testing
- Review and update rate limits
- Security training updates

### Security Updates

**Updating Security Patterns**:
```javascript
// Add new XSS patterns to src/security/validator.js
this.xssPatterns.push(/new-dangerous-pattern/gi);

// Add new suspicious keywords
this.suspiciousKeywords.push('new_dangerous_function');

// Update rate limits
this.limits.authenticated.messages.count = 50; // Reduce if needed
```

**Testing Updates**:
```bash
# Always test security changes
npm test
node tests/security-test-suite.js

# Deploy to staging first
# Monitor security logs after deployment
```

## Security Best Practices

### Development Guidelines

1. **Input Validation**: Always validate and sanitize user input
2. **Rate Limiting**: Apply appropriate limits for all operations
3. **Error Handling**: Don't expose sensitive information in error messages
4. **Logging**: Log security events with sufficient detail for investigation
5. **Testing**: Include security tests in your test suite

### Operational Guidelines

1. **Monitoring**: Continuously monitor security events and metrics
2. **Response**: Have incident response procedures ready
3. **Updates**: Keep security patterns and rules up to date
4. **Documentation**: Maintain current security documentation
5. **Training**: Ensure team understands security measures

### Code Security

```javascript
// Good: Comprehensive validation
const validation = securityValidator.validateInput(userInput, {
    blockXSS: true,
    blockSQL: true,
    blockCommand: true
});

if (!validation.isValid) {
    logger.logSecurity('input_validation_failed', {
        threats: validation.threats,
        riskLevel: validation.riskLevel
    });
    return sendError('Invalid input');
}

// Use sanitized data
const safeData = validation.sanitizedData;

// Bad: Using raw user input
const unsafeQuery = `SELECT * FROM users WHERE name = '${userInput}'`;
```

## Conclusion

The AVAI WebSocket backend implements comprehensive security measures designed to protect against modern threats while maintaining excellent performance for legitimate users. The multi-layer security model provides defense in depth, and the extensive monitoring and testing capabilities ensure ongoing security effectiveness.

Regular monitoring, testing, and updates are essential for maintaining security effectiveness. Follow the guidelines in this document and stay informed about new security threats and best practices.

For security questions or concerns, refer to this documentation or consult with the security team.