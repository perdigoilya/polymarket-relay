/**
 * Authentication and rate limiting middleware
 */

const API_SECRET = process.env.API_SECRET_KEY || 'dev-secret-key-change-in-production';

// In-memory rate limiter (use Redis in production for multiple instances)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 10;

/**
 * Authenticate requests from Lovable app
 */
export function authenticateRequest(req, res, next) {
  const authHeader = req.headers.authorization;
  
  console.log('🔐 AUTH DEBUG:', {
    hasAuthHeader: !!authHeader,
    authHeaderPreview: authHeader ? authHeader.slice(0, 20) + '...' : 'none',
    hasApiSecret: !!API_SECRET,
    apiSecretPreview: API_SECRET ? API_SECRET.slice(0, 8) + '...' : 'none',
    nodeEnv: process.env.NODE_ENV
  });
  
  if (!authHeader) {
    console.error('❌ Missing authorization header');
    return res.status(401).json({ error: 'Missing authorization header' });
  }
  
  // Support both "Bearer <token>" and "Bearer <jwt>" formats
  const token = authHeader.replace(/^Bearer\s+/i, '');
  
  console.log('🔍 Token comparison:', {
    receivedTokenPreview: token.slice(0, 8) + '...',
    expectedTokenPreview: API_SECRET.slice(0, 8) + '...',
    tokensMatch: token === API_SECRET,
    isJWT: token.includes('.')
  });
  
  // For development, accept any token
  // In production, validate JWT from Supabase or check API secret
  if (process.env.NODE_ENV === 'production') {
    // Simple API key check (enhance with JWT validation if needed)
    if (token !== API_SECRET && !token.includes('.')) { // Allow JWTs (contain dots)
      console.error('❌ AUTH FAILED: Invalid API key');
      return res.status(403).json({ error: 'Invalid API key' });
    }
  }
  
  console.log('✅ Authentication successful');
  next();
}

/**
 * Rate limiter middleware
 * Limits requests per userId to prevent abuse
 */
export function rateLimiter(req, res, next) {
  const { userId } = req.body || req.query;
  
  if (!userId) {
    return res.status(400).json({ error: 'Missing userId for rate limiting' });
  }
  
  const now = Date.now();
  const userKey = `ratelimit:${userId}`;
  
  // Get or initialize user's request log
  let requests = rateLimitMap.get(userKey) || [];
  
  // Remove expired requests (outside window)
  requests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
  
  // Check if limit exceeded
  if (requests.length >= RATE_LIMIT_MAX_REQUESTS) {
    const oldestRequest = requests[0];
    const retryAfter = Math.ceil((RATE_LIMIT_WINDOW - (now - oldestRequest)) / 1000);
    
    return res.status(429).json({ 
      error: 'Rate limit exceeded',
      retryAfter,
      limit: RATE_LIMIT_MAX_REQUESTS,
      window: RATE_LIMIT_WINDOW / 1000
    });
  }
  
  // Add current request
  requests.push(now);
  rateLimitMap.set(userKey, requests);
  
  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  res.setHeader('X-RateLimit-Remaining', RATE_LIMIT_MAX_REQUESTS - requests.length);
  res.setHeader('X-RateLimit-Reset', new Date(now + RATE_LIMIT_WINDOW).toISOString());
  
  next();
}

/**
 * Clean up rate limit map periodically
 */
setInterval(() => {
  const now = Date.now();
  for (const [key, requests] of rateLimitMap.entries()) {
    const validRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
    if (validRequests.length === 0) {
      rateLimitMap.delete(key);
    } else {
      rateLimitMap.set(key, validRequests);
    }
  }
}, RATE_LIMIT_WINDOW);
