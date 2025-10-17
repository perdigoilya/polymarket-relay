import { generateSignature } from './hmac.js';

const CLOB_BASE_URL = 'https://clob.polymarket.com';

/**
 * Generate browser-like headers for Polymarket API requests
 * to bypass Cloudflare WAF blocks
 */
function getBrowserHeaders(address, apiKey, passphrase, timestamp, signature) {
  return {
    'Accept': 'application/json',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9',
    'Content-Type': 'application/json',
    'Origin': 'https://polymarket.com',
    'Referer': 'https://polymarket.com/',
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-site',
    'POLY_ADDRESS': address,
    'POLY_API_KEY': apiKey,
    'POLY_PASSPHRASE': passphrase,
    'POLY_TIMESTAMP': timestamp.toString(),
    'POLY_SIGNATURE': signature
  };
}

/**
 * Attempt a single trade with given address and credentials
 * 
 * @returns {Promise<{success: boolean, data?: any, error?: string, status: number}>}
 */
export async function attemptTrade(address, apiKey, secret, passphrase, signedOrder) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify(signedOrder);
  
  // Generate HMAC signature: POST/order{timestamp}{body}
  const signature = generateSignature(secret, 'POST', '/order', timestamp, body);
  
  const headers = getBrowserHeaders(address, apiKey, passphrase, timestamp, signature);
  
  console.log(`→ Attempting trade with address ${address.slice(0, 6)}...${address.slice(-4)}`);
  
  try {
    const response = await fetch(`${CLOB_BASE_URL}/order`, {
      method: 'POST',
      headers,
      body
    });
    
    const responseText = await response.text();
    let data;
    
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }
    
    console.log(`← Response ${response.status}:`, data);
    
    return {
      success: response.ok,
      data,
      error: !response.ok ? (data.error || data.message || responseText) : undefined,
      status: response.status
    };
  } catch (error) {
    console.error(`✗ Trade attempt failed:`, error.message);
    return {
      success: false,
      error: error.message,
      status: 500
    };
  }
}

/**
 * Execute trade with dual-address retry logic
 * Tries owner address first, falls back to funder on 403
 * 
 * @param {Object} credentials - User credentials from database
 * @param {Object} signedOrder - Signed order from client
 * @param {string} ownerAddress - User's EOA wallet address
 * @param {string} funderAddress - Proxy wallet address (optional)
 * @returns {Promise<{success: boolean, orderId?: string, error?: string, attemptedWith?: string}>}
 */
export async function executeTrade(credentials, signedOrder, ownerAddress, funderAddress) {
  const { api_key, secret, passphrase } = credentials;
  
  // Attempt 1: Try with owner address
  let result = await attemptTrade(ownerAddress, api_key, secret, passphrase, signedOrder);
  
  // If 403 and we have a different funder address, retry with funder
  if (result.status === 403 && funderAddress && funderAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
    console.log('⚠️  Owner address blocked (403), retrying with funder address...');
    
    // Small delay before retry to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 350));
    
    result = await attemptTrade(funderAddress, api_key, secret, passphrase, signedOrder);
    result.attemptedWith = 'funder';
  } else {
    result.attemptedWith = 'owner';
  }
  
  if (result.success && result.data?.orderID) {
    return {
      success: true,
      orderId: result.data.orderID,
      attemptedWith: result.attemptedWith
    };
  }
  
  return {
    success: false,
    error: result.error || 'Trade failed',
    status: result.status,
    attemptedWith: result.attemptedWith
  };
}

/**
 * Check trading status for a user
 * 
 * @returns {Promise<{tradingEnabled: boolean, closedOnly?: boolean, error?: string}>}
 */
export async function checkTradingStatus(address, apiKey, secret, passphrase) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = generateSignature(secret, 'GET', '/auth/ban-status/closed-only', timestamp);
  
  const headers = getBrowserHeaders(address, apiKey, passphrase, timestamp, signature);
  delete headers['Content-Type']; // GET request
  
  try {
    const response = await fetch(`${CLOB_BASE_URL}/auth/ban-status/closed-only`, {
      method: 'GET',
      headers
    });
    
    if (!response.ok) {
      return { tradingEnabled: false, error: `Status check failed: ${response.status}` };
    }
    
    const data = await response.json();
    
    return {
      tradingEnabled: !data.closedOnly,
      closedOnly: data.closedOnly
    };
  } catch (error) {
    return { tradingEnabled: false, error: error.message };
  }
}
