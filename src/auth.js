const { createClerkClient } = require('@clerk/clerk-sdk-node');

// Initialize Clerk with secret key
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
});

/**
 * Verify Clerk JWT token
 * @param {string} token - JWT token to verify
 * @returns {Promise<Object>} Verification result with payload or error
 */
async function verifyJWT(token) {
  try {
    if (!token) {
      return { 
        error: 'No token provided',
        isValid: false 
      };
    }

    // Remove 'Bearer ' prefix if present
    const cleanToken = token.replace(/^Bearer\s+/i, '');

    // Verify the token using Clerk
    const payload = await clerk.verifyToken(cleanToken);
    
    if (!payload) {
      return { 
        error: 'Invalid token',
        isValid: false 
      };
    }

    console.log('JWT verification successful for user:', payload.sub);
    return { 
      payload,
      isValid: true 
    };
  } catch (error) {
    console.error('JWT verification error:', error.message);
    return { 
      error: error.message,
      isValid: false 
    };
  }
}

/**
 * Extract user data from verified JWT token
 * @param {string} token - JWT token to extract user data from
 * @returns {Promise<Object>} User data object or error
 */
async function extractUser(token) {
  try {
    // First verify the token
    const verificationResult = await verifyJWT(token);
    
    if (!verificationResult.isValid) {
      return {
        error: verificationResult.error,
        user: null,
        isAuthenticated: false
      };
    }

    const { payload } = verificationResult;
    
    // Get full user details from Clerk
    const user = await clerk.users.getUser(payload.sub);
    
    if (!user) {
      return {
        error: 'User not found',
        user: null,
        isAuthenticated: false
      };
    }

    // Extract relevant user information
    const userData = {
      id: user.id,
      email: user.emailAddresses?.[0]?.emailAddress || null,
      name: user.firstName && user.lastName 
        ? `${user.firstName} ${user.lastName}`.trim()
        : user.username || user.emailAddresses?.[0]?.emailAddress || 'Anonymous User',
      firstName: user.firstName || null,
      lastName: user.lastName || null,
      username: user.username || null,
      imageUrl: user.imageUrl || null,
      createdAt: user.createdAt,
      lastSignInAt: user.lastSignInAt
    };

    console.log('User extracted successfully:', userData.id);
    return {
      user: userData,
      isAuthenticated: true,
      error: null
    };
  } catch (error) {
    console.error('Extract user error:', error.message);
    return {
      error: error.message,
      user: null,
      isAuthenticated: false
    };
  }
}

/**
 * Handle anonymous user creation
 * @param {string} sessionId - Session identifier for anonymous user
 * @returns {Object} Anonymous user object
 */
function createAnonymousUser(sessionId) {
  return {
    id: null,
    sessionId: sessionId,
    email: null,
    name: 'Anonymous User',
    firstName: null,
    lastName: null,
    username: null,
    imageUrl: null,
    createdAt: new Date().toISOString(),
    lastSignInAt: null,
    isAnonymous: true
  };
}

/**
 * Middleware function to authenticate requests
 * @param {Object} request - Fastify request object
 * @returns {Promise<Object>} Authentication result
 */
async function authenticateRequest(request) {
  try {
    const authHeader = request.headers.authorization;
    
    if (!authHeader) {
      // Handle anonymous user
      const sessionId = request.headers['x-session-id'] || `anon_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const anonymousUser = createAnonymousUser(sessionId);
      
      return {
        user: anonymousUser,
        isAuthenticated: false,
        isAnonymous: true,
        error: null
      };
    }

    // Authenticated user
    const result = await extractUser(authHeader);
    
    return {
      user: result.user,
      isAuthenticated: result.isAuthenticated,
      isAnonymous: false,
      error: result.error
    };
  } catch (error) {
    console.error('Authentication middleware error:', error.message);
    return {
      user: null,
      isAuthenticated: false,
      isAnonymous: false,
      error: error.message
    };
  }
}

module.exports = {
  clerk,
  verifyJWT,
  extractUser,
  createAnonymousUser,
  authenticateRequest
};