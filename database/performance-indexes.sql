-- AVAI WebSocket Backend - Performance Database Indexes
-- Run these commands in Supabase SQL Editor for optimal query performance

-- =====================================================
-- PERFORMANCE INDEXES FOR THREADS TABLE
-- =====================================================

-- Index for user-specific thread queries ordered by update time
-- Optimizes: SELECT * FROM threads WHERE user_id = ? ORDER BY updated_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threads_user_updated 
ON threads(user_id, updated_at DESC);

-- Index for user's pinned threads with last message ordering
-- Optimizes: SELECT * FROM threads WHERE user_id = ? AND is_pinned = true ORDER BY last_message_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threads_user_pinned 
ON threads(user_id, is_pinned DESC, last_message_at DESC);

-- Index for status-based thread queries with user filtering
-- Optimizes: SELECT * FROM threads WHERE status = ? AND user_id = ? ORDER BY last_message_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threads_status_user 
ON threads(status, user_id, last_message_at DESC);

-- Index for active threads (most common query pattern)
-- Optimizes: SELECT * FROM threads WHERE user_id = ? AND status = 'active' ORDER BY last_message_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threads_user_active_recent
ON threads(user_id, status, last_message_at DESC) 
WHERE status = 'active';

-- Index for thread message count updates
-- Optimizes: UPDATE threads SET message_count = ? WHERE id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_threads_id_message_count
ON threads(id, message_count);

-- =====================================================
-- PERFORMANCE INDEXES FOR MESSAGES TABLE
-- =====================================================

-- Index for thread-specific message queries ordered by creation time
-- Optimizes: SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_created 
ON messages(thread_id, created_at ASC);

-- Index for thread messages with role filtering (user vs assistant)
-- Optimizes: SELECT * FROM messages WHERE thread_id = ? AND role = ? ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_role_created 
ON messages(thread_id, role, created_at DESC);

-- General index for message ordering (for pagination)
-- Optimizes: SELECT * FROM messages ORDER BY created_at DESC LIMIT ? OFFSET ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_created_at_btree 
ON messages USING btree(created_at DESC);

-- Index for message content search (if full-text search is needed)
-- Optimizes: SELECT * FROM messages WHERE thread_id = ? AND content ILIKE '%?%'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_content
ON messages(thread_id, content);

-- Index for message metadata queries (AI processing metrics)
-- Optimizes: SELECT * FROM messages WHERE thread_id = ? AND metadata->>'model_used' = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_metadata
ON messages(thread_id, ((metadata->>'model_used')::text));

-- Index for recent messages by role (for context building)
-- Optimizes: SELECT * FROM messages WHERE thread_id = ? AND role = 'user' ORDER BY created_at DESC LIMIT ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_messages_thread_role_recent
ON messages(thread_id, role, created_at DESC)
WHERE role IN ('user', 'assistant');

-- =====================================================
-- PERFORMANCE INDEXES FOR USERS TABLE
-- =====================================================

-- Primary lookup index for Clerk user ID (most common query)
-- Optimizes: SELECT * FROM users WHERE clerk_user_id = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_clerk_id 
ON users(clerk_user_id);

-- Index for user activity tracking
-- Optimizes: SELECT * FROM users ORDER BY last_active_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_last_active 
ON users(last_active_at DESC);

-- Index for user tier-based queries
-- Optimizes: SELECT * FROM users WHERE tier = ? ORDER BY created_at DESC
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_tier_created
ON users(tier, created_at DESC);

-- Index for email-based lookups (if needed)
-- Optimizes: SELECT * FROM users WHERE email = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email
ON users(email);

-- Composite index for active user queries
-- Optimizes: SELECT * FROM users WHERE last_active_at > ? AND tier = ?
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_active_tier
ON users(last_active_at, tier);

-- =====================================================
-- ADDITIONAL PERFORMANCE OPTIMIZATIONS
-- =====================================================

-- Enable auto-vacuum for better performance
-- (Run these as superuser or use Supabase dashboard settings)

-- Analyze tables to update statistics for query planner
ANALYZE threads;
ANALYZE messages;
ANALYZE users;

-- Update table statistics for better query planning
-- This helps PostgreSQL choose optimal execution plans
UPDATE pg_stat_user_tables SET n_tup_upd = n_tup_upd WHERE schemaname = 'public';

-- =====================================================
-- INDEX MONITORING QUERIES
-- =====================================================

-- Monitor index usage to ensure indexes are being used
-- Run these periodically to check index effectiveness:

/*
-- Check index usage statistics
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch,
    idx_scan
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;

-- Check table scan statistics
SELECT 
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    idx_tup_fetch,
    n_tup_ins,
    n_tup_upd,
    n_tup_del
FROM pg_stat_user_tables 
WHERE schemaname = 'public';

-- Find unused indexes (candidates for removal)
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes 
WHERE idx_scan = 0 
AND schemaname = 'public'
ORDER BY tablename, indexname;

-- Check index sizes
SELECT 
    schemaname,
    tablename,
    indexname,
    pg_size_pretty(pg_relation_size(indexrelid)) as index_size
FROM pg_stat_user_indexes 
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
*/

-- =====================================================
-- PERFORMANCE TUNING NOTES
-- =====================================================

/*
PERFORMANCE IMPACT:
- These indexes will significantly speed up common query patterns
- Each index adds some overhead to INSERT/UPDATE operations
- Monitor index usage and remove unused indexes if found

MAINTENANCE:
- PostgreSQL automatically maintains these indexes
- CONCURRENTLY option allows index creation without blocking
- Regular ANALYZE helps maintain optimal query performance

MONITORING:
- Use the monitoring queries above to track index effectiveness
- Consider adding application-level query performance logging
- Monitor slow query logs in Supabase dashboard

SCALING CONSIDERATIONS:
- As data grows, consider partitioning large tables
- Monitor index bloat and rebuild if necessary
- Consider partial indexes for specific query patterns
*/