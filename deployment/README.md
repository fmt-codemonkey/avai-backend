# AVAI WebSocket Backend - Deployment Scripts

This directory contains comprehensive deployment automation for Railway platform.

## 📁 Files Overview

- **`verify.js`** - Deployment verification and health checking
- **`test-local.js`** - Local development testing
- **`deploy.js`** - Automated Railway deployment
- **`rollback.js`** - Emergency rollback management

## 🚀 Quick Start

### Deploy to Railway
```bash
npm run deploy
```

### Test Locally
```bash
npm run test:local
```

### Verify Deployment
```bash
npm run test
```

### Emergency Rollback
```bash
npm run rollback
```

## 📋 Detailed Usage

### 1. Deployment Verification (`verify.js`)

Comprehensive health checking for deployed applications.

**Features:**
- Basic and detailed health checks
- WebSocket connection testing
- Performance benchmarking
- Database connectivity verification
- Memory usage monitoring
- Error handling validation

**Usage:**
```bash
# Verify current deployment
node deployment/verify.js

# Verify specific URL
node deployment/verify.js https://your-app.railway.app

# Environment variable (automatic)
RAILWAY_STATIC_URL=https://your-app.railway.app npm test
```

**Test Coverage:**
- ✅ Basic Health Check
- ✅ Detailed Health Check
- ✅ Database Health Check
- ✅ Memory Health Check
- ✅ Metrics Endpoint
- ✅ WebSocket Connection
- ✅ WebSocket Authentication
- ✅ Error Handling
- ✅ Performance Benchmarks

### 2. Local Testing (`test-local.js`)

Development environment testing before deployment.

**Features:**
- Environment variable validation
- Development configuration checks
- Local database testing
- CORS configuration verification
- Pre-deployment validation

**Usage:**
```bash
npm run test:local
```

**Additional Tests:**
- Environment Variables
- Development Configuration
- Local Database Connection
- Development CORS

### 3. Automated Deployment (`deploy.js`)

Complete deployment automation for Railway.

**Features:**
- Pre-deployment validation
- Automated Railway deployment
- Post-deployment verification
- Automatic rollback on failure
- Comprehensive logging

**Usage:**
```bash
# Standard deployment
npm run deploy

# Verification only (no deployment)
node deployment/deploy.js --verify-only

# Skip local tests (faster)
node deployment/deploy.js --skip-tests

# Deploy with custom timeout
node deployment/deploy.js --timeout 600000
```

**Deployment Flow:**
1. 🔍 Pre-deployment checks
   - Railway CLI verification
   - Environment validation
   - Local tests execution
   - Git status check
   - Configuration validation

2. 🚄 Railway deployment
   - Upload to Railway
   - Wait for deployment completion
   - Get deployment URL

3. ✅ Post-deployment verification
   - Service initialization wait
   - Comprehensive health checks
   - Performance validation

4. 🎯 Finalization
   - Deployment summary
   - Info saving
   - Success reporting

### 4. Rollback Management (`rollback.js`)

Emergency rollback utility with multiple strategies.

**Features:**
- Interactive rollback selection
- Git-based rollback
- Deployment history analysis
- Automatic verification
- Safety confirmations

**Usage:**
```bash
# Interactive rollback
npm run rollback

# Rollback to previous commit
node deployment/rollback.js --previous

# Rollback to specific commit
node deployment/rollback.js --commit abc1234

# Force rollback (skip confirmations)
node deployment/rollback.js --force --previous

# Rollback without verification
node deployment/rollback.js --no-verify --previous
```

**Rollback Options:**
1. Previous commit (HEAD~1)
2. Select from recent commits
3. Custom commit hash
4. Cancel operation

## 🔧 Configuration

### Environment Variables

**Required:**
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Supabase service role key
- `CLERK_SECRET_KEY` - Clerk authentication secret

**Optional:**
- `RAILWAY_STATIC_URL` - Railway deployment URL (auto-detected)
- `LOG_LEVEL` - Logging level (info, warn, error)
- `MAX_CONNECTIONS` - Maximum WebSocket connections
- `CONNECTION_TIMEOUT` - Connection timeout in milliseconds

### Railway Configuration

Ensure these files exist in your project root:
- `railway.json` - Railway deployment configuration
- `Procfile` - Process definition
- `.railwayignore` - Deployment exclusions

### Package.json Scripts

Required scripts in `package.json`:
```json
{
  "scripts": {
    "start": "node src/server.js",
    "deploy": "node deployment/deploy.js",
    "test": "node deployment/verify.js",
    "test:local": "node deployment/test-local.js",
    "rollback": "node deployment/rollback.js",
    "health": "curl $RAILWAY_STATIC_URL/health || echo 'Health check failed'"
  }
}
```

## 🛡️ Safety Features

### Pre-deployment Checks
- Railway CLI authentication
- Environment variable validation
- Local test execution
- Git repository status
- Configuration file verification

### Post-deployment Verification
- Health endpoint testing
- WebSocket functionality
- Database connectivity
- Performance benchmarks
- Error handling validation

### Rollback Safety
- Confirmation prompts
- Git state preservation
- Deployment verification
- Automatic restoration on failure

## 📊 Monitoring and Logging

### Health Endpoints
- `/health` - Basic health check
- `/health/detailed` - Comprehensive service status
- `/health/database` - Database connectivity
- `/health/memory` - Memory usage
- `/metrics` - Performance metrics

### Logging
All deployment operations are logged with:
- Timestamps
- Step-by-step progress
- Error details
- Performance metrics
- Deployment summaries

### Deployment History
Deployment information is saved to `.railway-deployment.json`:
```json
{
  "version": "abc1234",
  "url": "https://your-app.railway.app",
  "timestamp": "2025-09-21T04:30:00.000Z",
  "duration": 45000,
  "success": true,
  "steps": [...]
}
```

## 🚨 Troubleshooting

### Common Issues

**Railway CLI Not Found:**
```bash
npm install -g @railway/cli
railway login
```

**Environment Variables Missing:**
- Check `.env` file exists
- Verify all required variables are set
- Use `railway variables` to check Railway environment

**Deployment Timeout:**
- Check Railway build logs: `railway logs`
- Increase timeout: `--timeout 600000`
- Verify server starts correctly locally

**Health Checks Failing:**
- Check server logs: `railway logs`
- Verify database connectivity
- Test endpoints manually

**Rollback Issues:**
- Ensure git repository is clean
- Check Railway deployment history
- Verify target commit exists

### Debug Commands
```bash
# Check Railway status
railway status

# View logs
railway logs

# Check domains
railway domains

# Test health locally
curl http://localhost:8080/health

# Test deployed health
curl $RAILWAY_STATIC_URL/health
```

## 📈 Performance Considerations

### Deployment Speed
- Average deployment time: 2-5 minutes
- Pre-deployment checks: 30-60 seconds
- Railway upload: 1-2 minutes
- Service initialization: 30-60 seconds
- Post-deployment verification: 1-2 minutes

### Resource Usage
- Memory limit: 512MB (Railway free tier)
- CPU: Shared (Railway free tier)
- Build timeout: 10 minutes
- Runtime timeout: 30 seconds per request

### Optimization Tips
- Use `.railwayignore` to exclude unnecessary files
- Minimize dependencies in `package.json`
- Use production NODE_ENV
- Enable compression for WebSocket connections
- Implement proper health checks

## 🔒 Security

### Best Practices
- Never commit secrets to git
- Use Railway environment variables
- Implement proper authentication
- Validate all inputs
- Use HTTPS in production
- Monitor for security issues

### Environment Security
- Rotate secrets regularly
- Use least-privilege access
- Monitor access logs
- Implement rate limiting
- Use secure WebSocket connections (WSS)

## 📚 Additional Resources

- [Railway Documentation](https://docs.railway.app/)
- [Node.js Deployment Guide](https://docs.railway.app/deploy/nodejs)
- [Environment Variables](https://docs.railway.app/develop/variables)
- [Custom Domains](https://docs.railway.app/deploy/custom-domains)
- [Monitoring](https://docs.railway.app/deploy/monitoring)

---

## 🆘 Support

If you encounter issues:
1. Check this README
2. Review Railway logs: `railway logs`
3. Test locally: `npm run test:local`
4. Verify configuration files
5. Check environment variables

For emergencies, use the rollback system:
```bash
npm run rollback
```