import crypto from 'crypto';

/**
 * Generate HMAC-SHA256 signature for Polymarket CLOB API
 * Ported from supabase/functions/polymarket-trade/index.ts
 * 
 * @param {string} secret - API secret key
 * @param {string} message - Message to sign (preimage)
 * @returns {string} Base64 encoded signature
 */
export function hmacBase64(secret, message) {
  // Base64url normalization: convert - to + and _ to /
  const normalizedSecret = secret.replace(/-/g, '+').replace(/_/g, '/');
  
  // Create HMAC-SHA256
  const hmac = crypto.createHmac('sha256', normalizedSecret);
  hmac.update(message);
  
  return hmac.digest('base64');
}

/**
 * Generate HMAC signature with automatic preimage construction
 * 
 * @param {string} secret - API secret
 * @param {string} method - HTTP method (GET, POST, etc.)
 * @param {string} path - Request path (e.g., /order, /auth/api-keys)
 * @param {number} timestamp - Unix timestamp in seconds
 * @param {string} body - Request body (empty string for GET)
 * @returns {string} Base64 signature
 */
export function generateSignature(secret, method, path, timestamp, body = '') {
  // Construct preimage: METHOD + PATH + TIMESTAMP + BODY
  const preimage = `${method}${path}${timestamp}${body}`;
  return hmacBase64(secret, preimage);
}

/**
 * Validate signature format
 */
export function isValidSignature(signature) {
  return typeof signature === 'string' && signature.length > 0;
}
