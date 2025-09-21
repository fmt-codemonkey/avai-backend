-- AVAI WebSocket Backend - Database Schema
-- Run this in your Supabase SQL Editor to create the required tables

-- =====================================================
-- USERS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    clerk_user_id TEXT UNIQUE NOT NULL, -- Clerk user ID
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    tier TEXT DEFAULT 'free', -- free, pro, enterprise
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_active_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    profile_data JSONB DEFAULT '{}',
    settings JSONB DEFAULT '{}'
);

-- =====================================================
-- THREADS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title TEXT NOT NULL DEFAULT 'New Chat',
    status TEXT DEFAULT 'active', -- active, archived, deleted
    is_pinned BOOLEAN DEFAULT FALSE,
    message_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_message_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}'
);

-- =====================================================
-- MESSAGES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    metadata JSONB DEFAULT '{}', -- AI model info, processing time, etc.
    
    -- Index for fast thread-based queries
    INDEX idx_messages_thread_created (thread_id, created_at)
);

-- =====================================================
-- BASIC INDEXES FOR PERFORMANCE
-- =====================================================

-- Users table indexes
CREATE INDEX IF NOT EXISTS idx_users_clerk_id ON users(clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_last_active ON users(last_active_at DESC);

-- Threads table indexes
CREATE INDEX IF NOT EXISTS idx_threads_user_updated ON threads(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_threads_user_active ON threads(user_id, status, last_message_at DESC) WHERE status = 'active';

-- Messages table indexes  
CREATE INDEX IF NOT EXISTS idx_messages_thread_created ON messages(thread_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_thread_role ON messages(thread_id, role, created_at DESC);

-- =====================================================
-- UPDATED_AT TRIGGERS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for auto-updating updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_threads_updated_at BEFORE UPDATE ON threads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE threads ENABLE ROW LEVEL SECURITY;  
ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

-- Users can only see their own data
CREATE POLICY "Users can view own data" ON users
    FOR ALL USING (auth.uid()::text = clerk_user_id);

-- Users can only see their own threads
CREATE POLICY "Users can view own threads" ON threads
    FOR ALL USING (user_id IN (SELECT id FROM users WHERE clerk_user_id = auth.uid()::text));

-- Users can only see messages from their own threads
CREATE POLICY "Users can view own messages" ON messages
    FOR ALL USING (thread_id IN (
        SELECT t.id FROM threads t 
        JOIN users u ON t.user_id = u.id 
        WHERE u.clerk_user_id = auth.uid()::text
    ));

-- =====================================================
-- SERVICE ROLE POLICIES (for backend access)
-- =====================================================

-- Allow service role to bypass RLS for backend operations
CREATE POLICY "Service role full access users" ON users
    FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access threads" ON threads  
    FOR ALL TO service_role USING (true);

CREATE POLICY "Service role full access messages" ON messages
    FOR ALL TO service_role USING (true);

-- =====================================================
-- INITIAL DATA
-- =====================================================

-- You can add any initial data here if needed
-- For example, default system settings or admin users

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Run these to verify everything was created correctly:
/*
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('users', 'threads', 'messages');

SELECT indexname FROM pg_indexes 
WHERE schemaname = 'public' 
AND tablename IN ('users', 'threads', 'messages');
*/