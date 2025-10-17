// Polymarket trading routes using official @polymarket/clob-client
import express from 'express';
import { createClobClient, placeOrder } from '../utils/clobClient.js';
import { getDb, isPostgres } from '../db/init.js';
import { authenticateRequest, rateLimiter } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/polymarket/ip
 * Get relay server's public egress IP
 * This IP needs to be whitelisted by Polymarket
 */
router.get('/ip', async (req, res) => {
  try {
    // Check egress IP by calling a service that echoes it back
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    
    res.json({
      success: true,
      egressIp: data.ip,
      message: 'This is the IP address that Polymarket sees from this relay server',
      instructions: 'Contact Polymarket support to whitelist this IP for CLOB API access',
      whitelistRequest: {
        email: 'support@polymarket.com',
        subject: 'IP Whitelist Request for Trading Application',
        body: `Hello Polymarket,\n\nI'm building a trading application and need to whitelist my server IP for CLOB API access.\n\nIP Address: ${data.ip}\nUse Case: Prediction markets trading platform\n\nThank you!`
      }
    });
  } catch (error) {
    console.error('Failed to detect egress IP:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to detect egress IP',
      details: error.message
    });
  }
});

/**
 * POST /api/polymarket/credentials
 * Store or update user credentials
 */
router.post('/credentials', authenticateRequest, async (req, res) => {
  try {
    const { userId, apiKey, secret, passphrase, walletAddress, funderAddress } = req.body;
    
    if (!userId || !apiKey || !secret || !passphrase || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const db = getDb();
    const now = new Date().toISOString();
    
    if (isPostgres()) {
      await db.query(`
        INSERT INTO user_credentials (user_id, api_key, secret, passphrase, wallet_address, funder_address, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (user_id) DO UPDATE SET
          api_key = EXCLUDED.api_key,
          secret = EXCLUDED.secret,
          passphrase = EXCLUDED.passphrase,
          wallet_address = EXCLUDED.wallet_address,
          funder_address = EXCLUDED.funder_address,
          updated_at = EXCLUDED.updated_at
      `, [userId, apiKey, secret, passphrase, walletAddress, funderAddress || null, now]);
    } else {
      db.prepare(`
        INSERT OR REPLACE INTO user_credentials 
        (user_id, api_key, secret, passphrase, wallet_address, funder_address, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(userId, apiKey, secret, passphrase, walletAddress, funderAddress || null, now);
    }
    
    console.log(`✅ Stored credentials for user ${userId.slice(0, 8)}...`);
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error storing credentials:', error);
    res.status(500).json({ error: 'Failed to store credentials' });
  }
});

/**
 * POST /api/polymarket/trade
 * Execute trade using official ClobClient
 */
router.post('/trade', authenticateRequest, rateLimiter, async (req, res) => {
  try {
    const { userId, signedOrder, walletAddress, funderAddress, credentials: providedCreds } = req.body;
    
    console.log('\n[TRADE-RELAY-V2] Processing order:', {
      hasUserId: !!userId,
      hasSignedOrder: !!signedOrder,
      hasWalletAddress: !!walletAddress,
      hasProvidedCreds: !!providedCreds,
      tokenId: signedOrder?.tokenId?.slice(0, 20) + '...'
    });
    
    if (!signedOrder || !walletAddress) {
      return res.status(400).json({ 
        success: false,
        error: 'Missing required fields: signedOrder, walletAddress' 
      });
    }
    
    // Get credentials
    let credentials;
    if (providedCreds && providedCreds.api_key && providedCreds.secret && providedCreds.passphrase) {
      credentials = {
        apiKey: providedCreds.api_key,
        secret: providedCreds.secret,
        passphrase: providedCreds.passphrase,
        walletAddress
      };
      console.log('[TRADE-RELAY-V2] Using provided credentials');
    } else if (userId) {
      const db = getDb();
      let dbCreds;
      
      if (isPostgres()) {
        const { rows } = await db.query('SELECT * FROM user_credentials WHERE user_id = $1', [userId]);
        dbCreds = rows[0];
      } else {
        dbCreds = db.prepare('SELECT * FROM user_credentials WHERE user_id = ?').get(userId);
      }
      
      if (dbCreds) {
        credentials = {
          apiKey: dbCreds.api_key,
          secret: dbCreds.secret,
          passphrase: dbCreds.passphrase,
          walletAddress: dbCreds.wallet_address
        };
        console.log('[TRADE-RELAY-V2] Using stored credentials');
      }
    }
    
    if (!credentials) {
      return res.status(401).json({
        success: false,
        error: 'No credentials available. Please connect your wallet first.'
      });
    }
    
    // Get private key from environment (for signing with ClobClient)
    const privateKey = process.env.WALLET_PRIVATE_KEY || process.env.PRIVATE_KEY;
    if (!privateKey) {
      return res.status(500).json({
        success: false,
        error: 'Server configuration error: WALLET_PRIVATE_KEY not set'
      });
    }
    
    // Create ClobClient and execute trade
    try {
      const client = createClobClient(credentials, privateKey);
      const result = await placeOrder(client, signedOrder);
      
      console.log('[TRADE-RELAY-V2] ✓ Trade successful');
      res.json(result);
      
    } catch (error) {
      const errorMessage = error.message || String(error);
      const isCloudflareBlock = errorMessage.includes('403') || 
                               errorMessage.includes('Cloudflare') ||
                               errorMessage.includes('blocked');
      
      console.error('[TRADE-RELAY-V2] ✗ Trade failed:', errorMessage);
      
      if (isCloudflareBlock) {
        res.status(403).json({
          success: false,
          error: 'Cloudflare 403 - egress blocked',
          cloudflareBlock: true,
          suggestion: 'Relay server IP needs to be whitelisted by Polymarket. Call GET /api/polymarket/ip to see the IP address.'
        });
      } else {
        res.status(500).json({
          success: false,
          error: errorMessage,
          cloudflareBlock: false
        });
      }
    }
    
  } catch (error) {
    console.error('[TRADE-RELAY-V2] Fatal error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Internal server error',
      details: error.message 
    });
  }
});

/**
 * GET /api/polymarket/credentials/:userId
 * Get user credentials (masked)
 */
router.get('/credentials/:userId', authenticateRequest, async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getDb();
    
    let result;
    if (isPostgres()) {
      const { rows } = await db.query('SELECT * FROM user_credentials WHERE user_id = $1', [userId]);
      result = rows[0];
    } else {
      result = db.prepare('SELECT * FROM user_credentials WHERE user_id = ?').get(userId);
    }
    
    if (!result) {
      return res.status(404).json({ error: 'Credentials not found' });
    }
    
    res.json({
      userId: result.user_id,
      walletAddress: result.wallet_address,
      funderAddress: result.funder_address,
      hasCredentials: true,
      createdAt: result.created_at
    });
  } catch (error) {
    console.error('Error fetching credentials:', error);
    res.status(500).json({ error: 'Failed to fetch credentials' });
  }
});

/**
 * DELETE /api/polymarket/credentials/:userId
 * Remove user credentials
 */
router.delete('/credentials/:userId', authenticateRequest, async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getDb();
    
    if (isPostgres()) {
      await db.query('DELETE FROM user_credentials WHERE user_id = $1', [userId]);
    } else {
      db.prepare('DELETE FROM user_credentials WHERE user_id = ?').run(userId);
    }
    
    console.log(`🗑️  Deleted credentials for user ${userId.slice(0, 8)}...`);
    res.json({ success: true });
  } catch (error) {
    console.error('Error deleting credentials:', error);
    res.status(500).json({ error: 'Failed to delete credentials' });
  }
});

/**
 * GET /api/polymarket/health
 * Health check
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    service: 'polymarket-relay',
    version: '2.0.0',
    client: '@polymarket/clob-client v4.22.7',
    timestamp: new Date().toISOString()
  });
});

export default router;
