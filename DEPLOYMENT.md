# AVAI WebSocket Backend - Production Deployment Guide

Complete guide for deploying the AVAI WebSocket backend to Railway platform with comprehensive production configurations.

## 📋 Table of Contents

1. [Quick Start](#quick-start)
2. [Prerequisites](#prerequisites)
3. [Environment Setup](#environment-setup)
4. [Railway Configuration](#railway-configuration)
5. [Deployment Process](#deployment-process)
6. [Post-Deployment](#post-deployment)
7. [Monitoring & Maintenance](#monitoring--maintenance)
8. [Troubleshooting](#troubleshooting)
9. [Security Considerations](#security-considerations)

## 🚀 Quick Start

For experienced users:

```bash
# 1. Setup environment
cp .env.template .env
# Edit .env with your credentials

# 2. Install Railway CLI
npm install -g @railway/cli
railway login

# 3. Create Railway project
railway init

# 4. Set environment variables
railway variables set NODE_ENV=production
railway variables set SUPABASE_URL=your-url
railway variables set SUPABASE_SERVICE_ROLE_KEY=your-key
railway variables set CLERK_SECRET_KEY=your-key

# 5. Deploy
npm run deploy
```

## 📋 Prerequisites

### Required Accounts & Services

1. **Railway Account** - [https://railway.app](https://railway.app)
   - Free tier provides: 512MB RAM, $5/month credit
   - Pro tier recommended for production

2. **Supabase Project** - [https://supabase.com](https://supabase.com)
   - PostgreSQL database with real-time features
   - Authentication (if not using Clerk exclusively)

3. **Clerk Account** - [https://clerk.com](https://clerk.com)
   - User authentication and management
   - WebSocket authentication tokens

4. **AVAI Canister** (Optional) - Internet Computer
   - AI service integration
   - WebSocket endpoint for AI features

### Local Development Setup

```bash
# Node.js 18+ and npm 8+
node --version  # Should be >= 18.0.0
npm --version   # Should be >= 8.0.0

# Install Railway CLI
npm install -g @railway/cli

# Verify installation
railway --version
```

## ⚙️ Environment Setup

### 1. Create Environment Configuration

```bash
# Copy template
cp .env.template .env

# Edit with your credentials
nano .env  # or your preferred editor
```

### 2. Required Environment Variables

**Essential for Railway deployment:**

```bash
# Node.js Environment
NODE_ENV=production
PORT=8080
HOST=0.0.0.0

# Supabase (Required)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Clerk Authentication (Required)
CLERK_SECRET_KEY=sk_live_...
```

### 3. Optional Performance Variables

```bash
# WebSocket Optimization
MAX_CONNECTIONS=1000
CONNECTION_TIMEOUT=30000
WS_COMPRESSION=true

# Database Pool
DB_POOL_MIN=8
DB_POOL_MAX=25

# Caching
CACHE_L1_SIZE=2000
CACHE_L2_SIZE=20000

# Logging
LOG_LEVEL=warn
LOG_FORMAT=json
```

### 4. Getting Your Credentials

**Supabase:**
1. Go to [Supabase Dashboard](https://app.supabase.com)
2. Select your project
3. Go to Settings → API
4. Copy URL and service_role key

**Clerk:**
1. Go to [Clerk Dashboard](https://dashboard.clerk.com)
2. Select your application
3. Go to API Keys
4. Copy the Secret Key (starts with `sk_live_`)

## 🚄 Railway Configuration

### 1. Railway CLI Setup

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login to Railway
railway login

# Initialize project
railway init
# Choose "Create new project"
# Select "Empty project"
# Name your project (e.g., "avai-backend")
```

### 2. Link to Existing Project (if applicable)

```bash
# If you already have a Railway project
railway link [project-id]

# Or connect to existing
railway connect
```

### 3. Set Environment Variables

**Option A: Using Railway CLI**
```bash
railway variables set NODE_ENV=production
railway variables set SUPABASE_URL=https://your-project.supabase.co
railway variables set SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIs...
railway variables set CLERK_SECRET_KEY=sk_live_...
railway variables set MAX_CONNECTIONS=1000
railway variables set LOG_LEVEL=warn
```

**Option B: Using Railway Dashboard**
1. Go to [Railway Dashboard](https://railway.app/dashboard)
2. Select your project
3. Go to Variables tab
4. Add each environment variable

**Option C: Bulk Import from File**
```bash
# Create railway-vars.txt with KEY=VALUE pairs
railway variables set --from-file railway-vars.txt
```

### 4. Configure Custom Domain (Optional)

```bash
# Add custom domain
railway domain add yourdomain.com

# Or use Railway-provided domain
railway domain
```

## 🚀 Deployment Process

### 1. Pre-Deployment Validation

```bash
# Test locally first
npm run test:local

# Check environment variables
railway variables

# Verify Railway connection
railway status
```

### 2. Automated Deployment

```bash
# Full automated deployment with verification
npm run deploy

# Manual Railway deployment (basic)
npm run deploy:railway

# Verification only (no deployment)
npm run verify
```

### 3. Manual Deployment Steps

If automated deployment fails:

```bash
# 1. Verify configuration
railway status

# 2. Deploy manually
railway up

# 3. Monitor deployment
railway logs --follow

# 4. Verify health
curl https://your-app.railway.app/health
```

### 4. Deployment Options

**Standard Deployment:**
```bash
npm run deploy
```

**Skip Local Tests:**
```bash
node deployment/deploy.js --skip-tests
```

**Extended Timeout:**
```bash
node deployment/deploy.js --timeout 600000
```

**Verification Only:**
```bash
npm run verify
```

## ✅ Post-Deployment

### 1. Health Check Verification

```bash
# Basic health check
curl https://your-app.railway.app/health

# Detailed health check
curl https://your-app.railway.app/health/detailed

# Database health
curl https://your-app.railway.app/health/database

# Memory health
curl https://your-app.railway.app/health/memory

# Metrics
curl https://your-app.railway.app/metrics
```

### 2. WebSocket Testing

```javascript
// Test WebSocket connection
const ws = new WebSocket('wss://your-app.railway.app/ws');

ws.onopen = () => {
  console.log('Connected');
  // Send authentication
  ws.send(JSON.stringify({
    type: 'authenticate',
    anonymous: true
  }));
};

ws.onmessage = (event) => {
  console.log('Received:', JSON.parse(event.data));
};
```

### 3. Performance Validation

```bash
# Run comprehensive verification
npm test

# Check response times
curl -w "@curl-format.txt" -o /dev/null -s https://your-app.railway.app/health

# Monitor resource usage
railway logs --filter="memory\|cpu"
```

### 4. Domain Configuration

```bash
# Check assigned domains
railway domain

# Test domain resolution
nslookup your-app.railway.app
```

## 📊 Monitoring & Maintenance

### 1. Railway Monitoring

**Built-in Metrics:**
- CPU usage
- Memory usage
- Network I/O
- Request count
- Response times

**Access via:**
```bash
# Railway dashboard
open https://railway.app/dashboard

# CLI metrics
railway logs --filter="metrics"
```

### 2. Application Health Monitoring

**Health Endpoints:**
- `/health` - Basic health status
- `/health/detailed` - Comprehensive service status
- `/health/database` - Database connectivity
- `/health/memory` - Memory usage
- `/metrics` - Performance metrics

**Monitoring Script:**
```bash
#!/bin/bash
# health-monitor.sh
URL="https://your-app.railway.app"

while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" $URL/health)
  if [ $STATUS -ne 200 ]; then
    echo "$(date): Health check failed with status $STATUS"
    # Send alert (email, Slack, etc.)
  else
    echo "$(date): Health check passed"
  fi
  sleep 60
done
```

### 3. Log Management

```bash
# View recent logs
railway logs

# Follow logs in real-time
railway logs --follow

# Filter by level
railway logs --filter="ERROR\|WARN"

# Export logs
railway logs --since=1h > logs.txt
```

### 4. Performance Optimization

**Memory Management:**
```bash
# Monitor memory usage
railway logs --filter="memory"

# Check for memory leaks
railway logs --filter="heap\|gc"
```

**Database Performance:**
```bash
# Monitor database queries
railway logs --filter="query\|database"

# Check connection pool status
curl https://your-app.railway.app/health/database
```

### 5. Scaling Considerations

**Railway Scaling:**
- Railway auto-scales based on demand
- Monitor resource usage in dashboard
- Consider upgrading plan for higher limits

**Application Scaling:**
- WebSocket connections: Max 1000 (configurable)
- Database pool: 8-25 connections
- Memory limit: 512MB (Railway free tier)

## 🚨 Troubleshooting

### Common Issues

**1. Deployment Fails**
```bash
# Check Railway status
railway status

# View build logs
railway logs --build

# Verify environment variables
railway variables

# Common fixes:
railway variables set NODE_ENV=production
railway redeploy
```

**2. Health Checks Fail**
```bash
# Check application logs
railway logs --filter="ERROR"

# Test endpoints manually
curl -v https://your-app.railway.app/health

# Common causes:
# - Missing environment variables
# - Database connection issues
# - Port binding problems (ensure HOST=0.0.0.0)
```

**3. WebSocket Connection Issues**
```bash
# Check WebSocket endpoint
curl -i -N -H "Connection: Upgrade" \
     -H "Upgrade: websocket" \
     -H "Sec-WebSocket-Key: test" \
     https://your-app.railway.app/ws

# Common fixes:
# - Verify WSS (secure WebSocket) in production
# - Check CORS configuration
# - Validate authentication tokens
```

**4. Database Connection Problems**
```bash
# Test database health
curl https://your-app.railway.app/health/database

# Check Supabase status
curl https://your-project.supabase.co/rest/v1/

# Verify credentials:
echo $SUPABASE_URL
echo $SUPABASE_SERVICE_ROLE_KEY | head -c 50
```

**5. High Memory Usage**
```bash
# Monitor memory
railway logs --filter="memory\|heap"

# Check for leaks
curl https://your-app.railway.app/health/memory

# Restart service
railway restart
```

### Debug Commands

```bash
# Full system status
railway status --json

# Environment check
railway variables --json

# Service health
curl -s https://your-app.railway.app/health | jq .

# Performance metrics
curl -s https://your-app.railway.app/metrics | jq .
```

### Emergency Procedures

**Service Down:**
```bash
# Quick restart
railway restart

# Rollback to previous version
npm run rollback

# Force redeploy
railway up --force
```

**Database Issues:**
```bash
# Check Supabase dashboard
open https://app.supabase.com

# Test connection directly
curl -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
     "$SUPABASE_URL/rest/v1/"
```

## 🔒 Security Considerations

### 1. Environment Variables Security

```bash
# Never commit .env files
echo ".env" >> .gitignore
echo ".env.*" >> .gitignore

# Use Railway secrets management
railway variables set --secret DATABASE_PASSWORD=xxx

# Rotate keys regularly
# Update Clerk and Supabase keys every 90 days
```

### 2. HTTPS/WSS Enforcement

Railway automatically provides HTTPS, but ensure:

```javascript
// In production, always use WSS
const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const wsUrl = `${wsProtocol}//${window.location.host}/ws`;
```

### 3. Rate Limiting Configuration

```bash
# Set appropriate limits
railway variables set RATE_LIMIT_AUTHENTICATED=60
railway variables set RATE_LIMIT_ANONYMOUS=10
railway variables set MAX_CONNECTIONS=1000
```

### 4. Input Validation

Ensure all inputs are validated:
- Message size limits
- Content sanitization
- Authentication token validation
- UUID format verification

### 5. CORS Configuration

```bash
# Set production origins
railway variables set CORS_ORIGINS="https://yourdomain.com,https://www.yourdomain.com"

# Enable credentials for authentication
railway variables set CORS_CREDENTIALS=true
```

### 6. Monitoring & Alerting

Set up monitoring for:
- Failed authentication attempts
- Rate limit violations
- Unusual traffic patterns
- Error rates
- Memory usage spikes

## 🔄 Rollback Procedures

### Automatic Rollback

```bash
# Interactive rollback
npm run rollback

# Rollback to previous commit
node deployment/rollback.js --previous

# Rollback to specific commit
node deployment/rollback.js --commit abc1234
```

### Manual Rollback

```bash
# 1. Get deployment history
git log --oneline -10

# 2. Checkout previous working commit
git checkout HEAD~1

# 3. Deploy
railway up

# 4. Verify
curl https://your-app.railway.app/health
```

## 📈 Performance Tuning

### Railway-Specific Optimizations

```bash
# Memory optimization
railway variables set NODE_OPTIONS="--max-old-space-size=512"

# Connection optimization
railway variables set MAX_CONNECTIONS=1000
railway variables set CONNECTION_TIMEOUT=30000

# WebSocket optimization
railway variables set WS_COMPRESSION=true
railway variables set WS_MAX_PAYLOAD=1048576
```

### Database Optimization

```bash
# Connection pooling
railway variables set DB_POOL_MIN=8
railway variables set DB_POOL_MAX=25
railway variables set DB_CONNECTION_TIMEOUT=10000

# Query optimization
railway variables set DB_QUERY_TIMEOUT=30000
```

### Caching Configuration

```bash
# Multi-level caching
railway variables set CACHE_L1_SIZE=2000
railway variables set CACHE_L2_SIZE=20000
railway variables set CACHE_L1_TTL=180
railway variables set CACHE_L2_TTL=900
```

## 📞 Support Resources

- **Railway Documentation**: [https://docs.railway.app](https://docs.railway.app)
- **Railway Discord**: [https://discord.gg/railway](https://discord.gg/railway)
- **Supabase Documentation**: [https://supabase.com/docs](https://supabase.com/docs)
- **Clerk Documentation**: [https://clerk.com/docs](https://clerk.com/docs)

### Emergency Contacts

- **Railway Status**: [https://status.railway.app](https://status.railway.app)
- **Supabase Status**: [https://status.supabase.com](https://status.supabase.com)

---

## 📋 Deployment Checklist

Before deploying to production:

- [ ] Environment variables configured in Railway
- [ ] Supabase database setup and accessible
- [ ] Clerk authentication configured
- [ ] Local tests passing (`npm run test:local`)
- [ ] Health endpoints responding
- [ ] WebSocket connections working
- [ ] CORS configured for production domains
- [ ] Monitoring and alerting setup
- [ ] Backup/rollback procedures tested
- [ ] Security review completed
- [ ] Performance benchmarks established

After deployment:

- [ ] Health checks passing
- [ ] WebSocket functionality verified  
- [ ] Database connectivity confirmed
- [ ] Authentication flows working
- [ ] Performance metrics within acceptable ranges
- [ ] Logs showing no critical errors
- [ ] Custom domain configured (if applicable)
- [ ] Monitoring dashboards accessible
- [ ] Team notified of successful deployment

🎉 **Congratulations!** Your AVAI WebSocket backend is now running in production on Railway!