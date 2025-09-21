const { createClient } = require('@supabase/supabase-js');
const { Pool } = require('pg');
const { getCacheManager } = require('./performance/cacheManager');
const { getQueryOptimizer } = require('./performance/queryOptimizer');

// Initialize performance optimizations
const cacheManager = getCacheManager({
  l1MaxSize: 2000,           // Increased for database operations
  l2MaxSize: 20000,          // Large L2 cache for database results
  l1TTL: 180,                // 3 minutes for hot data
  l2TTL: 900,                // 15 minutes for warm data
  metricsEnabled: true,
  warmingEnabled: true
});

const queryOptimizer = getQueryOptimizer({
  poolMax: 25,               // Increased for high concurrent load
  poolMin: 8,                // Minimum connections
  queryCache: true,
  cacheSize: 2000,
  cacheTTL: 600000,          // 10 minutes
  slowQueryThreshold: 500,   // 500ms threshold
  batchEnabled: true,
  maxBatchSize: 500,
  monitoringEnabled: true
});

// Initialize optimized Supabase client with performance settings
const supabaseClient = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'x-client-info': 'avai-backend-optimized'
      }
    }
  }
);

// PostgreSQL connection pool for direct SQL operations (optional)
let pgPool = null;

if (process.env.DATABASE_URL && process.env.DATABASE_URL !== 'postgresql://postgres:[YOUR_PASSWORD]@db.oscnavzuxxuirufvzemc.supabase.co:5432/postgres') {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 25,                    // Maximum connections
    min: 8,                     // Minimum connections
    idleTimeoutMillis: 30000,   // 30 seconds
    connectionTimeoutMillis: 10000, // 10 seconds
    maxUses: 7500,              // Connection reuse limit
    allowExitOnIdle: true,
    statement_timeout: 30000,   // 30 second query timeout
    query_timeout: 30000        // 30 second query timeout
  });
} else {
  console.log('⚠️  DATABASE_URL not configured - using Supabase client only');
}

// Performance monitoring
let dbMetrics = {
  totalQueries: 0,
  cachedQueries: 0,
  avgResponseTime: 0,
  slowQueries: 0,
  errors: 0,
  connectionPoolStats: {
    totalConnections: 0,
    idleConnections: 0,
    waitingClients: 0
  }
};

// ========================================
// PERFORMANCE OPTIMIZATION HELPERS
// ========================================

/**
 * Execute optimized query with caching and performance monitoring
 * @param {Function} queryFunction - Supabase query function
 * @param {string} cacheKey - Cache key for result caching
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Query result with performance metrics
 */
async function executeOptimizedQuery(queryFunction, cacheKey, options = {}) {
  const startTime = Date.now();
  
  try {
    // Check cache first if enabled
    if (options.cache !== false && cacheKey) {
      const cached = await cacheManager.get(cacheKey);
      if (cached.cached) {
        dbMetrics.cachedQueries++;
        return {
          data: cached.data,
          cached: true,
          responseTime: Date.now() - startTime,
          source: 'cache'
        };
      }
    }

    // Execute query with performance tracking
    const result = await queryFunction();
    const responseTime = Date.now() - startTime;
    
    // Update metrics
    dbMetrics.totalQueries++;
    dbMetrics.avgResponseTime = ((dbMetrics.avgResponseTime * (dbMetrics.totalQueries - 1)) + responseTime) / dbMetrics.totalQueries;
    
    if (responseTime > 500) {
      dbMetrics.slowQueries++;
      console.warn(`🐌 Slow query detected: ${responseTime}ms for key: ${cacheKey}`);
    }

    // Cache successful results
    if (!result.error && cacheKey && options.cache !== false) {
      const ttl = options.cacheTTL || (responseTime > 100 ? 300 : 180); // Cache longer for slower queries
      await cacheManager.set(cacheKey, result, { ttl });
    }

    return {
      ...result,
      cached: false,
      responseTime,
      source: 'database'
    };

  } catch (error) {
    dbMetrics.errors++;
    console.error('Query execution error:', error);
    return { error: error.message, responseTime: Date.now() - startTime };
  }
}

/**
 * Batch execute multiple queries for improved performance
 * @param {Array} operations - Array of query operations
 * @param {Object} options - Batch options
 * @returns {Promise<Array>} Array of results
 */
async function executeBatchQueries(operations, options = {}) {
  console.log(`📦 Executing batch of ${operations.length} queries`);
  
  try {
    const batchResult = await queryOptimizer.executeBatch(operations, {
      batchSize: options.batchSize || 100,
      concurrency: options.concurrency || 5
    });

    return batchResult.results;
  } catch (error) {
    console.error('Batch query execution failed:', error);
    throw error;
  }
}

/**
 * Get paginated results with optimization
 * @param {Object} queryBuilder - Supabase query builder
 * @param {Object} pagination - Pagination options
 * @returns {Promise<Object>} Paginated results with metadata
 */
async function getPaginatedResults(queryBuilder, pagination = {}) {
  const {
    page = 1,
    limit = 50,
    orderBy = 'created_at',
    orderDirection = 'desc',
    countTotal = false
  } = pagination;

  const offset = (page - 1) * limit;
  const maxLimit = Math.min(limit, 1000); // Prevent excessive queries

  try {
    // Build optimized query
    let query = queryBuilder
      .order(orderBy, { ascending: orderDirection === 'asc' })
      .range(offset, offset + maxLimit - 1);

    // Execute query
    const { data, error, count } = await query;

    if (error) {
      return { error: error.message };
    }

    // Get total count if requested (cached for performance)
    let totalCount = null;
    if (countTotal) {
      const countCacheKey = `count:${queryBuilder.constructor.name}:${JSON.stringify(pagination)}`;
      const countResult = await executeOptimizedQuery(
        async () => {
          const { count: totalCount, error: countError } = await queryBuilder
            .select('*', { count: 'exact', head: true });
          return { data: totalCount, error: countError };
        },
        countCacheKey,
        { cacheTTL: 120 } // Cache count for 2 minutes
      );
      
      totalCount = countResult.data;
    }

    return {
      data: data || [],
      pagination: {
        page,
        limit: maxLimit,
        offset,
        total: totalCount,
        hasMore: data && data.length === maxLimit,
        totalPages: totalCount ? Math.ceil(totalCount / maxLimit) : null
      }
    };

  } catch (error) {
    console.error('Paginated query error:', error);
    return { error: error.message };
  }
}

/**
 * Test database connectivity with performance monitoring
 * @returns {Promise<boolean>} True if connection is successful
 */
async function testConnection() {
  const startTime = Date.now();
  
  try {
    // Test Supabase connection
    const { data, error } = await supabaseClient
      .from('users')
      .select('count')
      .limit(1);
    
    if (error) {
      console.error('Database connection test failed:', error.message);
      return false;
    }

    // Test PostgreSQL pool connection (if available)
    if (pgPool) {
      const client = await pgPool.connect();
      await client.query('SELECT 1');
      client.release();
      console.log(`📊 Pool stats - Total: ${pgPool.totalCount}, Idle: ${pgPool.idleCount}, Waiting: ${pgPool.waitingCount}`);
    }

    const responseTime = Date.now() - startTime;
    console.log(`✅ Database connection test successful (${responseTime}ms) - using Supabase client`);
    
    return true;
  } catch (error) {
    console.error('Database connection test error:', error.message);
    return false;
  }
}

/**
 * Insert a new user into the database
 * @param {Object} userData - User data object
 * @param {string} userData.id - User ID (from Clerk)
 * @param {string} userData.email - User email
 * @param {string} userData.name - User display name
 * @returns {Promise<Object>} Created user object or error
 */
async function insertUser(userData) {
  try {
    const { data, error } = await supabaseClient
      .from('users')
      .insert([{
        id: userData.id,
        email: userData.email,
        name: userData.name,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error inserting user:', error.message);
      return { error: error.message };
    }

    console.log('User inserted successfully:', data.id);
    return { data };
  } catch (error) {
    console.error('Insert user error:', error.message);
    return { error: error.message };
  }
}

/**
 * Get user by ID from the database
 * @param {string} userId - User ID to retrieve
 * @returns {Promise<Object>} User object or error
 */
async function getUser(userId) {
  try {
    const { data, error } = await supabaseClient
      .from('users')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { data: null }; // User not found
      }
      console.error('Error getting user:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Get user error:', error.message);
    return { error: error.message };
  }
}

/**
 * Insert a new message into the database
 * @param {Object} messageData - Message data object
 * @param {string} messageData.id - Message ID (UUID)
 * @param {string} messageData.userId - User ID (nullable for anonymous users)
 * @param {string} messageData.content - Message content
 * @param {string} messageData.chatId - Chat session ID
 * @param {string} messageData.type - Message type ('user' or 'assistant')
 * @returns {Promise<Object>} Created message object or error
 */
async function insertMessage(messageData) {
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .insert([{
        id: messageData.id,
        user_id: messageData.userId || null,
        content: messageData.content,
        chat_id: messageData.chatId,
        type: messageData.type,
        created_at: new Date().toISOString()
      }])
      .select()
      .single();

    if (error) {
      console.error('Error inserting message:', error.message);
      return { error: error.message };
    }

    console.log('Message inserted successfully:', data.id);
    return { data };
  } catch (error) {
    console.error('Insert message error:', error.message);
    return { error: error.message };
  }
}

/**
 * Get messages for a specific chat
 * @param {string} chatId - Chat session ID
 * @param {number} limit - Maximum number of messages to retrieve (default: 50)
 * @param {number} offset - Number of messages to skip (default: 0)
 * @returns {Promise<Object>} Array of message objects or error
 */
async function getMessages(chatId, limit = 50, offset = 0) {
  try {
    const { data, error } = await supabaseClient
      .from('messages')
      .select(`
        *,
        users (
          id,
          name,
          email
        )
      `)
      .eq('chat_id', chatId)
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('Error getting messages:', error.message);
      return { error: error.message };
    }

    return { data: data || [] };
  } catch (error) {
    console.error('Get messages error:', error.message);
    return { error: error.message };
  }
}

// ========================================
// THREAD MANAGEMENT FUNCTIONS
// ========================================

/**
 * Create a new thread for a user
 * @param {string} userId - User ID (clerk_user_id)
 * @param {string} title - Thread title
 * @param {string} description - Optional thread description
 * @returns {Promise<Object>} Created thread object or error
 */
async function createThread(userId, title, description = null) {
  try {
    const { data, error } = await supabaseClient
      .from('threads')
      .insert([{
        user_id: userId,
        title: title.trim(),
        description: description ? description.trim() : null,
        status: 'active',
        is_pinned: false,
        message_count: 0,
        last_message_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {}
      }])
      .select()
      .single();

    if (error) {
      console.error('Error creating thread:', error.message);
      return { error: error.message };
    }

    console.log('Thread created successfully:', data.id);
    return { data };
  } catch (error) {
    console.error('Create thread error:', error.message);
    return { error: error.message };
  }
}

/**
 * Get all threads for a user with caching and pagination
 * @param {string} userId - User ID (clerk_user_id)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Array of thread objects or error
 */
async function getUserThreads(userId, options = {}) {
  const {
    limit = 50,
    page = 1,
    includeArchived = false,
    orderBy = 'last_message_at',
    orderDirection = 'desc'
  } = options;

  const cacheKey = `user_threads:${userId}:${JSON.stringify(options)}`;

  try {
    return await executeOptimizedQuery(
      async () => {
        let query = supabaseClient
          .from('threads')
          .select('id, title, description, status, is_pinned, message_count, last_message_at, created_at, updated_at')
          .eq('user_id', userId);

        // Filter archived threads unless requested
        if (!includeArchived) {
          query = query.neq('status', 'archived');
        }

        // Apply custom ordering with pinned threads prioritized
        if (orderBy === 'last_message_at') {
          query = query
            .order('is_pinned', { ascending: false }) // Pinned threads first
            .order('last_message_at', { ascending: orderDirection === 'asc' });
        } else {
          query = query
            .order('is_pinned', { ascending: false })
            .order(orderBy, { ascending: orderDirection === 'asc' });
        }

        // Apply pagination
        return await getPaginatedResults(query, { page, limit, orderBy, orderDirection });
      },
      cacheKey,
      { 
        cache: true, 
        cacheTTL: 120 // Cache for 2 minutes as threads change frequently
      }
    );

  } catch (error) {
    console.error('Get user threads error:', error.message);
    return { error: error.message };
  }
}

/**
 * Get a specific thread by ID with ownership validation
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID for ownership validation
 * @returns {Promise<Object>} Thread object or error
 */
async function getThreadById(threadId, userId) {
  try {
    const { data, error } = await supabaseClient
      .from('threads')
      .select('*')
      .eq('id', threadId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { error: 'Thread not found or access denied' };
      }
      console.error('Error getting thread by ID:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Get thread by ID error:', error.message);
    return { error: error.message };
  }
}

/**
 * Update thread activity timestamp
 * @param {string} threadId - Thread ID (UUID)
 * @returns {Promise<Object>} Success status or error
 */
async function updateThreadActivity(threadId) {
  try {
    const { data, error } = await supabaseClient
      .from('threads')
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
      .select()
      .single();

    if (error) {
      console.error('Error updating thread activity:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Update thread activity error:', error.message);
    return { error: error.message };
  }
}

/**
 * Get messages for a specific thread with ownership validation and caching
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID for ownership validation
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Array of message objects or error
 */
async function getThreadMessages(threadId, userId, options = {}) {
  const {
    limit = 100,
    page = 1,
    orderDirection = 'asc',
    includeMetadata = true,
    fromCache = true
  } = options;

  const cacheKey = `thread_messages:${threadId}:${userId}:${JSON.stringify(options)}`;

  try {
    // Use cached thread ownership validation
    const threadCacheKey = `thread_ownership:${threadId}:${userId}`;
    const ownershipResult = await executeOptimizedQuery(
      async () => {
        const result = await getThreadById(threadId, userId);
        return result;
      },
      threadCacheKey,
      { cacheTTL: 300 } // Cache ownership for 5 minutes
    );

    if (ownershipResult.error) {
      return ownershipResult;
    }

    // Get messages with caching
    return await executeOptimizedQuery(
      async () => {
        const selectFields = includeMetadata 
          ? 'id, thread_id, role, content, content_type, token_count, model_used, processing_time_ms, confidence_score, created_at, updated_at, metadata'
          : 'id, thread_id, role, content, content_type, created_at';

        let query = supabaseClient
          .from('messages')
          .select(selectFields)
          .eq('thread_id', threadId)
          .order('created_at', { ascending: orderDirection === 'asc' });

        return await getPaginatedResults(query, { page, limit, orderBy: 'created_at', orderDirection });
      },
      fromCache ? cacheKey : null,
      { 
        cache: fromCache,
        cacheTTL: 60 // Cache messages for 1 minute (they change less frequently than threads)
      }
    );

  } catch (error) {
    console.error('Get thread messages error:', error.message);
    return { error: error.message };
  }
}

/**
 * Update thread message count
 * @param {string} threadId - Thread ID (UUID)
 * @returns {Promise<Object>} Updated thread object or error
 */
async function updateThreadMessageCount(threadId) {
  try {
    // Count messages in the thread
    const { count, error: countError } = await supabaseClient
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('thread_id', threadId);

    if (countError) {
      console.error('Error counting thread messages:', countError.message);
      return { error: countError.message };
    }

    // Update the thread's message count
    const { data, error } = await supabaseClient
      .from('threads')
      .update({
        message_count: count || 0,
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
      .select()
      .single();

    if (error) {
      console.error('Error updating thread message count:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Update thread message count error:', error.message);
    return { error: error.message };
  }
}

/**
 * Archive a thread with ownership validation
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID for ownership validation
 * @returns {Promise<Object>} Updated thread object or error
 */
async function archiveThread(threadId, userId) {
  try {
    const { data, error } = await supabaseClient
      .from('threads')
      .update({
        status: 'archived',
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { error: 'Thread not found or access denied' };
      }
      console.error('Error archiving thread:', error.message);
      return { error: error.message };
    }

    console.log('Thread archived successfully:', threadId);
    return { data };
  } catch (error) {
    console.error('Archive thread error:', error.message);
    return { error: error.message };
  }
}

/**
 * Pin or unpin a thread with ownership validation
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID for ownership validation
 * @param {boolean} isPinned - Whether to pin or unpin the thread
 * @returns {Promise<Object>} Updated thread object or error
 */
async function pinThread(threadId, userId, isPinned) {
  try {
    const { data, error } = await supabaseClient
      .from('threads')
      .update({
        is_pinned: isPinned,
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
      .eq('user_id', userId)
      .select()
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return { error: 'Thread not found or access denied' };
      }
      console.error('Error pinning/unpinning thread:', error.message);
      return { error: error.message };
    }

    console.log(`Thread ${isPinned ? 'pinned' : 'unpinned'} successfully:`, threadId);
    return { data };
  } catch (error) {
    console.error('Pin thread error:', error.message);
    return { error: error.message };
  }
}

// ========================================
// USER MANAGEMENT FUNCTIONS
// ========================================

/**
 * Create or update user in the users table using Clerk data
 * @param {Object} clerkUserData - User data from Clerk JWT
 * @returns {Promise<Object>} User object or error
 */
async function upsertUser(clerkUserData) {
  try {
    const userData = {
      clerk_user_id: clerkUserData.id,
      email: clerkUserData.email,
      first_name: clerkUserData.firstName || null,
      last_name: clerkUserData.lastName || null,
      image_url: clerkUserData.imageUrl || null,
      tier: 'free', // Default tier
      last_active_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from('users')
      .upsert([userData], { 
        onConflict: 'clerk_user_id',
        ignoreDuplicates: false 
      })
      .select()
      .single();

    if (error) {
      console.error('Error upserting user:', error.message);
      return { error: error.message };
    }

    console.log('User upserted successfully:', data.clerk_user_id);
    return { data };
  } catch (error) {
    console.error('Upsert user error:', error.message);
    return { error: error.message };
  }
}

/**
 * Update user's last active timestamp
 * @param {string} clerkUserId - Clerk user ID
 * @returns {Promise<Object>} Success status or error
 */
async function updateUserActivity(clerkUserId) {
  try {
    const { data, error } = await supabaseClient
      .from('users')
      .update({
        last_active_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('clerk_user_id', clerkUserId)
      .select()
      .single();

    if (error) {
      console.error('Error updating user activity:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Update user activity error:', error.message);
    return { error: error.message };
  }
}

// ========================================
// MESSAGE MANAGEMENT FUNCTIONS
// ========================================

/**
 * Insert a new message into the messages table with cache invalidation
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID (clerk_user_id or null for anonymous)
 * @param {string} role - Message role ('user', 'assistant', 'system')
 * @param {string} content - Message content
 * @param {string} contentType - Content type ('text', 'markdown', 'code', 'analysis')
 * @param {Object} metadata - Additional metadata object
 * @returns {Promise<Object>} Created message object or error
 */
async function insertMessage(threadId, userId, role, content, contentType = 'text', metadata = {}) {
  const startTime = Date.now();
  
  try {
    const tokenCount = estimateTokenCount(content);
    const messageData = {
      thread_id: threadId,
      role: role,
      content: content.trim(),
      content_type: contentType,
      token_count: tokenCount,
      model_used: null, // Will be set by AI processing
      processing_time_ms: null,
      confidence_score: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: metadata
    };

    const { data, error } = await supabaseClient
      .from('messages')
      .insert([messageData])
      .select()
      .single();

    if (error) {
      console.error('Error inserting message:', error.message);
      return { error: error.message };
    }

    // Invalidate related caches asynchronously
    setImmediate(async () => {
      try {
        // Clear thread messages cache
        await cacheManager.delete(`thread_messages:${threadId}:${userId}`);
        // Clear conversation history cache
        await cacheManager.delete(`conversation_history:${threadId}:${userId}`);
        // Clear user threads cache (for last_message_at update)
        await cacheManager.delete(`user_threads:${userId}`);
      } catch (cacheError) {
        console.warn('Cache invalidation warning:', cacheError.message);
      }
    });

    const processingTime = Date.now() - startTime;
    console.log(`✅ Message inserted successfully: ${data.id} (${processingTime}ms)`);
    
    return { data, processingTime };
  } catch (error) {
    console.error('Insert message error:', error.message);
    return { error: error.message };
  }
}

/**
 * Batch insert messages with optimized performance
 * @param {Array} messages - Array of message objects to insert
 * @param {Object} options - Batch insert options
 * @returns {Promise<Object>} Batch insert results
 */
async function insertMessagesBatch(messages, options = {}) {
  const startTime = Date.now();
  
  try {
    const batchSize = options.batchSize || 100;
    const processedMessages = messages.map(msg => ({
      thread_id: msg.threadId,
      role: msg.role,
      content: msg.content.trim(),
      content_type: msg.contentType || 'text',
      token_count: estimateTokenCount(msg.content),
      model_used: msg.modelUsed || null,
      processing_time_ms: msg.processingTimeMs || null,
      confidence_score: msg.confidenceScore || null,
      created_at: msg.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      metadata: msg.metadata || {}
    }));

    const result = await queryOptimizer.bulkInsert('messages', processedMessages, {
      batchSize
    });

    // Invalidate caches for affected threads
    const affectedThreads = [...new Set(messages.map(m => m.threadId))];
    setImmediate(async () => {
      for (const threadId of affectedThreads) {
        await cacheManager.delete(`thread_messages:${threadId}`);
        await cacheManager.delete(`conversation_history:${threadId}`);
      }
    });

    const processingTime = Date.now() - startTime;
    console.log(`📦 Batch inserted ${result.insertedRecords} messages in ${processingTime}ms`);
    
    return { ...result, processingTime };
  } catch (error) {
    console.error('Batch insert messages error:', error.message);
    return { error: error.message };
  }
}

/**
 * Get conversation history for AI context with ownership validation
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID for ownership validation (nullable for anonymous)
 * @param {number} limit - Maximum number of messages to retrieve (default: 50)
 * @returns {Promise<Object>} Array of message objects formatted for AI or error
 */
async function getConversationHistory(threadId, userId, limit = 50) {
  try {
    // Validate thread ownership if user is authenticated
    if (userId) {
      const threadCheck = await getThreadById(threadId, userId);
      if (threadCheck.error) {
        return threadCheck;
      }
    }

    const { data, error } = await supabaseClient
      .from('messages')
      .select('id, role, content, content_type, token_count, created_at, metadata')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) {
      console.error('Error getting conversation history:', error.message);
      return { error: error.message };
    }

    // Format messages for AI consumption
    const formattedMessages = (data || []).map(msg => ({
      role: msg.role,
      content: msg.content,
      timestamp: msg.created_at,
      content_type: msg.content_type,
      token_count: msg.token_count
    }));

    return { data: formattedMessages };
  } catch (error) {
    console.error('Get conversation history error:', error.message);
    return { error: error.message };
  }
}

/**
 * Update message metadata (for AI processing information)
 * @param {string} messageId - Message ID (UUID)
 * @param {Object} metadata - Metadata object to merge with existing metadata
 * @returns {Promise<Object>} Updated message object or error
 */
async function updateMessageMetadata(messageId, metadata) {
  try {
    // Get current message to merge metadata
    const { data: currentMessage, error: getCurrentError } = await supabaseClient
      .from('messages')
      .select('metadata')
      .eq('id', messageId)
      .single();

    if (getCurrentError) {
      console.error('Error getting current message metadata:', getCurrentError.message);
      return { error: getCurrentError.message };
    }

    // Merge new metadata with existing
    const mergedMetadata = {
      ...(currentMessage.metadata || {}),
      ...metadata,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await supabaseClient
      .from('messages')
      .update({
        metadata: mergedMetadata,
        updated_at: new Date().toISOString()
      })
      .eq('id', messageId)
      .select()
      .single();

    if (error) {
      console.error('Error updating message metadata:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Update message metadata error:', error.message);
    return { error: error.message };
  }
}

/**
 * Increment thread message count and update last message timestamp
 * @param {string} threadId - Thread ID (UUID)
 * @returns {Promise<Object>} Updated thread object or error
 */
async function incrementThreadMessageCount(threadId) {
  try {
    // Get current thread data
    const { data: currentThread, error: getCurrentError } = await supabaseClient
      .from('threads')
      .select('message_count')
      .eq('id', threadId)
      .single();

    if (getCurrentError) {
      console.error('Error getting current thread:', getCurrentError.message);
      return { error: getCurrentError.message };
    }

    const newMessageCount = (currentThread.message_count || 0) + 1;

    const { data, error } = await supabaseClient
      .from('threads')
      .update({
        message_count: newMessageCount,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', threadId)
      .select()
      .single();

    if (error) {
      console.error('Error incrementing thread message count:', error.message);
      return { error: error.message };
    }

    return { data };
  } catch (error) {
    console.error('Increment thread message count error:', error.message);
    return { error: error.message };
  }
}

/**
 * Validate thread ownership for authenticated users
 * @param {string} threadId - Thread ID (UUID)
 * @param {string} userId - User ID (clerk_user_id)
 * @returns {Promise<boolean>} True if user owns thread, false otherwise
 */
async function validateThreadOwnership(threadId, userId) {
  try {
    if (!userId) {
      // Anonymous users cannot own threads
      return false;
    }

    const { data, error } = await supabaseClient
      .from('threads')
      .select('id')
      .eq('id', threadId)
      .eq('user_id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return false; // Thread not found or not owned by user
      }
      console.error('Error validating thread ownership:', error.message);
      return false;
    }

    return !!data;
  } catch (error) {
    console.error('Validate thread ownership error:', error.message);
    return false;
  }
}

/**
 * Enhanced token count estimation with caching
 * @param {string} content - Text content to estimate tokens for
 * @returns {number} Estimated token count
 */
function estimateTokenCount(content) {
  if (!content || typeof content !== 'string') {
    return 0;
  }
  
  // Check cache for repeated content
  const contentHash = simpleHash(content);
  const cacheKey = `token_count:${contentHash}`;
  
  // Simple in-memory cache for token counts
  if (!estimateTokenCount._cache) {
    estimateTokenCount._cache = new Map();
  }
  
  if (estimateTokenCount._cache.has(cacheKey)) {
    return estimateTokenCount._cache.get(cacheKey);
  }
  
  // Enhanced estimation based on content type and complexity
  const charCount = content.length;
  let tokensPerChar = 0.25; // Base rate (4 chars per token)
  
  // Adjust for content complexity
  if (content.includes('```') || content.includes('function') || content.includes('class')) {
    tokensPerChar = 0.22; // Code is denser
  } else if (content.includes('http') || content.includes('www.')) {
    tokensPerChar = 0.3; // URLs are less dense
  } else if (/[^\x00-\x7F]/.test(content)) {
    tokensPerChar = 0.35; // Unicode characters
  }
  
  const estimatedTokens = Math.ceil(charCount * tokensPerChar);
  
  // Cache the result (limit cache size)
  if (estimateTokenCount._cache.size > 1000) {
    const firstKey = estimateTokenCount._cache.keys().next().value;
    estimateTokenCount._cache.delete(firstKey);
  }
  estimateTokenCount._cache.set(cacheKey, estimatedTokens);
  
  return estimatedTokens;
}

/**
 * Simple hash function for caching
 * @param {string} str - String to hash
 * @returns {string} Hash string
 */
function simpleHash(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}

// ========================================
// PERFORMANCE MONITORING AND ANALYTICS
// ========================================

/**
 * Get comprehensive database performance metrics
 * @returns {Object} Performance metrics and statistics
 */
function getDatabaseMetrics() {
  const cacheStats = cacheManager.getStats();
  const queryStats = queryOptimizer.getQueryAnalytics();
  
  return {
    database: {
      ...dbMetrics,
      connectionPool: {
        total: pgPool.totalCount,
        idle: pgPool.idleCount,
        waiting: pgPool.waitingCount,
        max: pgPool.options.max,
        min: pgPool.options.min
      }
    },
    cache: {
      hitRate: cacheStats.hitRate.total,
      size: cacheStats.sizes,
      performance: cacheStats.performance,
      health: cacheStats.health
    },
    queries: {
      performance: queryStats.performance,
      patterns: queryStats.patterns.slice(0, 10), // Top 10 patterns
      cache: queryStats.cache
    },
    optimization: {
      recommendations: generateOptimizationRecommendations(dbMetrics, cacheStats, queryStats)
    }
  };
}

/**
 * Generate performance optimization recommendations
 * @param {Object} dbMetrics - Database metrics
 * @param {Object} cacheStats - Cache statistics
 * @param {Object} queryStats - Query statistics
 * @returns {Array} Array of optimization recommendations
 */
function generateOptimizationRecommendations(dbMetrics, cacheStats, queryStats) {
  const recommendations = [];
  
  // Cache hit rate recommendations
  if (cacheStats.hitRate.total < 0.7) {
    recommendations.push({
      type: 'cache',
      priority: 'high',
      message: 'Cache hit rate is below 70%. Consider increasing cache TTL or cache size.',
      metric: `Current hit rate: ${(cacheStats.hitRate.total * 100).toFixed(1)}%`
    });
  }
  
  // Query performance recommendations
  if (dbMetrics.avgResponseTime > 200) {
    recommendations.push({
      type: 'query',
      priority: 'medium',
      message: 'Average query response time is high. Consider query optimization or indexing.',
      metric: `Average response time: ${dbMetrics.avgResponseTime.toFixed(2)}ms`
    });
  }
  
  // Connection pool recommendations
  const poolUtilization = pgPool.totalCount / pgPool.options.max;
  if (poolUtilization > 0.8) {
    recommendations.push({
      type: 'connection',
      priority: 'high',
      message: 'Connection pool utilization is high. Consider increasing pool size.',
      metric: `Pool utilization: ${(poolUtilization * 100).toFixed(1)}%`
    });
  }
  
  // Error rate recommendations
  const errorRate = dbMetrics.errors / Math.max(1, dbMetrics.totalQueries);
  if (errorRate > 0.05) {
    recommendations.push({
      type: 'reliability',
      priority: 'high',
      message: 'Query error rate is high. Review error logs and query patterns.',
      metric: `Error rate: ${(errorRate * 100).toFixed(1)}%`
    });
  }
  
  return recommendations;
}

/**
 * Warm up frequently accessed data caches
 * @param {string} userId - User ID to warm cache for
 * @returns {Promise<Object>} Cache warming results
 */
async function warmupCaches(userId) {
  console.log(`🔥 Warming up caches for user: ${userId}`);
  const startTime = Date.now();
  const warmedItems = [];
  
  try {
    // Warm user threads cache
    const threadsResult = await getUserThreads(userId, { limit: 20 });
    if (!threadsResult.error && threadsResult.data) {
      warmedItems.push(`user_threads:${userId}`);
      
      // Warm recent thread messages
      const recentThreads = threadsResult.data.slice(0, 5);
      for (const thread of recentThreads) {
        const messagesResult = await getThreadMessages(thread.id, userId, { 
          limit: 50, 
          fromCache: false 
        });
        if (!messagesResult.error) {
          warmedItems.push(`thread_messages:${thread.id}`);
        }
      }
    }
    
    const warmupTime = Date.now() - startTime;
    console.log(`✅ Cache warmup completed: ${warmedItems.length} items in ${warmupTime}ms`);
    
    return {
      warmedItems: warmedItems.length,
      items: warmedItems,
      time: warmupTime
    };
    
  } catch (error) {
    console.error('Cache warmup error:', error);
    return { error: error.message };
  }
}

/**
 * Clean up database connections and caches
 */
async function cleanup() {
  console.log('🧹 Cleaning up database connections and caches...');
  
  try {
    // Close PostgreSQL pool
    await pgPool.end();
    
    // Cleanup cache manager
    if (cacheManager && typeof cacheManager.cleanup === 'function') {
      cacheManager.cleanup();
    }
    
    // Cleanup query optimizer
    if (queryOptimizer && typeof queryOptimizer.cleanup === 'function') {
      queryOptimizer.cleanup();
    }
    
    console.log('✅ Database cleanup completed');
  } catch (error) {
    console.error('Database cleanup error:', error);
  }
}

// Graceful shutdown handling
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
process.on('beforeExit', cleanup);

module.exports = {
  // Core clients and connections
  supabaseClient,
  pgPool,
  
  // Performance optimization utilities
  executeOptimizedQuery,
  executeBatchQueries,
  getPaginatedResults,
  
  // Core database functions
  testConnection,
  insertUser,
  getUser,
  getMessages,
  
  // Thread management functions (optimized)
  createThread,
  getUserThreads,
  getThreadById,
  updateThreadActivity,
  getThreadMessages,
  updateThreadMessageCount,
  archiveThread,
  pinThread,
  
  // User management functions
  upsertUser,
  updateUserActivity,
  
  // Message management functions (optimized)
  insertMessage,
  insertMessagesBatch,
  getConversationHistory,
  updateMessageMetadata,
  incrementThreadMessageCount,
  validateThreadOwnership,
  
  // Performance and monitoring
  getDatabaseMetrics,
  warmupCaches,
  estimateTokenCount,
  cleanup,
  
  // Performance managers (for external access)
  cacheManager,
  queryOptimizer
};