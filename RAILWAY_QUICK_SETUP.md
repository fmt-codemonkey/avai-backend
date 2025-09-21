## 🚀 COMPLETE RAILWAY ENVIRONMENT VARIABLES

Copy these EXACT variables to your Railway dashboard:

DATABASE_URL=postgresql://postgres:O5sLwcMgftSk96fa@db.oscnavzuxxuirufvzemc.supabase.co:5432/postgres
SUPABASE_URL=https://oscnavzuxxuirufvzemc.supabase.co
SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY25hdnp1eHh1aXJ1ZnZ6ZW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyNTQ1MzAsImV4cCI6MjA3MzgzMDUzMH0.A6EQWlVWswaWEfXViYJas3NYg5uU9ENvu6Pq2rTqkgc
CLERK_SECRET_KEY=sk_test_QmpjasQsiKyNFJbUqnPXqi7LwuVpWI6EOwMoE1TQwS
NODE_ENV=production
NODE_OPTIONS=--max-old-space-size=256
PORT=3000

## 🔧 RAILWAY SETUP INSTRUCTIONS:

1. Go to: https://railway.app/dashboard
2. Select: avai-backend-production project  
3. Click: Variables tab
4. Add each variable above using "New Variable" button
5. Deploy the service
6. Wait for deployment to complete
7. Test: https://avai-backend-production.up.railway.app/health

## ⚡ AFTER DEPLOYMENT SUCCESS:

Test WebSocket on https://avai-xi.vercel.app/chat console:

```javascript
const ws = new WebSocket('wss://avai-backend-production.up.railway.app/ws');
ws.onopen = () => console.log('✅ WebSocket Connected!');
ws.onmessage = (e) => console.log('📨 Message:', JSON.parse(e.data));
ws.onerror = (e) => console.log('❌ Error:', e);
```

Expected first message:
```json
{
  "type": "welcome", 
  "message": "Connected to AVAI chat server - please authenticate"
}
```