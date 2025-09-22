/**
 * Clerk Configuration for Fastify Backend
 * Using official Clerk tools and best practices
 */

const { createClerkClient } = require('@clerk/backend');

// Initialize Clerk client with environment variables
const clerk = createClerkClient({
  secretKey: process.env.CLERK_SECRET_KEY
});

/**
 * Verify Clerk JWT token
 * @param {string} token - JWT token from Clerk
 * @returns {Promise<Object>} User data or null if invalid
 */
async function verifyClerkToken(token) {
  try {
    if (!token) {
      return null;
    }

    // Remove Bearer prefix if present
    const cleanToken = token.replace('Bearer ', '');
    
    // Use Clerk's JWT verification method
    const payload = await clerk.verifyJwt(cleanToken);
    
    if (!payload || !payload.sub) {
      return null;
    }

    // Get user details from Clerk using the user ID from JWT
    const user = await clerk.users.getUser(payload.sub);
    
    return {
      id: user.id,
      email: user.emailAddresses?.[0]?.emailAddress,
      name: user.firstName && user.lastName 
        ? `${user.firstName} ${user.lastName}` 
        : user.username || user.emailAddresses?.[0]?.emailAddress || 'User',
      firstName: user.firstName,
      lastName: user.lastName,
      username: user.username,
      imageUrl: user.imageUrl,
      createdAt: user.createdAt,
      lastSignInAt: user.lastSignInAt
    };
  } catch (error) {
    console.error('Clerk token verification failed:', error.message);
    return null;
  }
}

/**
 * Create authentication middleware for Fastify routes
 */
function createAuthMiddleware() {
  return async function authMiddleware(request, reply) {
    const token = request.headers.authorization;
    
    if (!token) {
      reply.code(401).send({ error: 'Missing authorization token' });
      return;
    }

    const user = await verifyClerkToken(token);
    
    if (!user) {
      reply.code(401).send({ error: 'Invalid or expired token' });
      return;
    }

    // Attach user to request
    request.user = user;
  };
}

module.exports = {
  clerk,
  verifyClerkToken,
  createAuthMiddleware
};