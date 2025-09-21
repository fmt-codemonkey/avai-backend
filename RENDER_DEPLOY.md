# Render Deployment Instructions

## 1. Create Render Account
Visit https://render.com and sign up

## 2. Connect GitHub Repository
- Link your GitHub account
- Select the `avai-backend` repository

## 3. Environment Variables
Set these in Render dashboard:

```
NODE_ENV=production
DATABASE_URL=postgresql://postgres.oscnavzuxxuirufvzemc:your_password@aws-0-us-east-1.pooler.supabase.com:6543/postgres
SUPABASE_URL=https://oscnavzuxxuirufvzemc.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
SUPABASE_ANON_KEY=your_anon_key
CLERK_SECRET_KEY=your_clerk_secret
PORT=10000
```

## 4. Service Configuration
- **Build Command**: `npm install`
- **Start Command**: `npm start`
- **Environment**: Node.js
- **Plan**: Starter ($7/month)

## 5. Health Check
- **Path**: `/health`
- **Initial delay**: 30 seconds
- **Grace period**: 30 seconds

## 6. Auto-Deploy
Enable auto-deploy on main branch pushes

## 7. WebSocket Support
Render natively supports WebSocket upgrades - no special configuration needed!

## 8. Update Frontend
Once deployed, update frontend WebSocket URL to:
`wss://your-service-name.onrender.com/ws`