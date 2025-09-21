#!/bin/bash

# Railway Deployment Script with Environment Variables
# This script sets all required environment variables and deploys to Railway

echo "🚀 Starting Railway deployment with environment variables..."

# Check if railway CLI is installed
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Installing..."
    npm install -g @railway/cli
fi

# Navigate to project directory
cd /home/code_monkey/Projects/Startup/avai-backend

echo "📝 Setting environment variables..."

# Set all environment variables
railway variables set DATABASE_URL="postgresql://postgres:O5sLwcMgftSk96fa@db.oscnavzuxxuirufvzemc.supabase.co:5432/postgres"

railway variables set SUPABASE_URL="https://oscnavzuxxuirufvzemc.supabase.co"

railway variables set SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY25hdnp1eHh1aXJ1ZnZ6ZW1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTgyNTQ1MzAsImV4cCI6MjA3MzgzMDUzMH0.A6EQWlVWswaWEfXViYJas3NYg5uU9ENvu6Pq2rTqkgc"

railway variables set SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9zY25hdnp1eHh1aXJ1ZnZ6ZW1jIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODI1NDUzMCwiZXhwIjoyMDczODMwNTMwfQ.O5mKWLTT04V-SemqKKkd9NBOWaOTzsQr3R8yPHmO98k"

railway variables set CLERK_SECRET_KEY="sk_test_QmpjasQsiKyNFJbUqnPXqi7LwuVpWI6EOwMoE1TQwS"

railway variables set NODE_ENV="production"

railway variables set NODE_OPTIONS="--max-old-space-size=256"

railway variables set PORT="3000"

echo "✅ Environment variables set successfully!"

echo "🔄 Deploying to Railway..."

# Deploy the application
railway up --detach

echo "⏳ Waiting for deployment to complete..."
sleep 30

echo "🏥 Checking health status..."
curl -s https://avai-backend-production.up.railway.app/health | jq -r '.status'

echo "🎉 Deployment complete!"
echo "🔗 Health Check: https://avai-backend-production.up.railway.app/health"
echo "🔗 WebSocket: wss://avai-backend-production.up.railway.app/ws"