# Railway Environment Variables Configuration

## Complete Environment Variables for Railway Dashboard

Copy and paste these **exact** environment variables into your Railway project:

### Database Configuration
```
DATABASE_URL=postgresql://postgres:O5sLwcMgftSk96fa@db.oscnavzuxxuirufvzemc.supabase.co:5432/postgres
SUPABASE_URL=https://oscnavzuxxuirufvzemc.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY25hdnp1eHh1aXJ1ZnZ6ZW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyNTQ1MzAsImV4cCI6MjA3MzgzMDUzMH0.A6EQWlVWswaWEfXViYJas3NYg5uU9ENvu6Pq2rTqkgc
```

### Authentication
```
CLERK_SECRET_KEY=sk_test_QmpjasQsiKyNFJbUqnPXqi7LwuVpWI6EOwMoE1TQwS
```

### Runtime Configuration
```
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=256
PORT=3000
```

## How to Configure in Railway:

1. **Go to Railway Dashboard**: https://railway.app/dashboard
2. **Select your project**: avai-backend-production
3. **Go to Variables tab**
4. **Add each variable above** using the "New Variable" button
5. **Deploy** the service after adding all variables

## Required Clerk Secret Key:

You still need to add your Clerk secret key. Get it from:
1. Go to https://dashboard.clerk.dev/
2. Select your project
3. Go to "API Keys" 
4. Copy the "Secret key" (starts with `sk_`)
5. Add it as `CLERK_SECRET_KEY` in Railway

## After Configuration:

Once all variables are set and deployed:

1. **Health Check**: https://avai-backend-production.up.railway.app/health
   - Should show `"status": "healthy"`
   - Database should show `"healthy": true`

2. **WebSocket Test**: On https://avai-xi.vercel.app/chat console:
   ```javascript
   const ws = new WebSocket('wss://avai-backend-production.up.railway.app/ws');
   ws.onopen = () => console.log('✅ Connected!');
   ws.onmessage = (e) => console.log('📨 Message:', e.data);
   ws.onerror = (e) => console.log('❌ Error:', e);
   ```

## Environment Variables Summary:
- ✅ DATABASE_URL (Supabase PostgreSQL connection)
- ✅ SUPABASE_URL (Project URL)  
- ✅ SUPABASE_ANON_KEY (API Key)
- ✅ CLERK_SECRET_KEY (Clerk authentication)
- ✅ NODE_ENV=production
- ✅ NODE_OPTIONS=--max-old-space-size=256
- ✅ PORT=3000