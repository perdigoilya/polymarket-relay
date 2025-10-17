import express from 'express';
import { getDb, isPostgres } from '../db/init.js';
import { authenticateRequest, rateLimiter } from '../middleware/auth.js';
import { executeTrade, checkTradingStatus } from '../utils/polymarket.js';

const router = express.Router();

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
 * GET /api/polymarket/credentials/:userId
 * Get user credentials (for debugging only - remove in production)
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
    
    // Mask sensitive data
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
 * POST /api/polymarket/trade
 * Execute trade with dual-address retry logic
 */
router.post('/trade', authenticateRequest, rateLimiter, async (req, res) => {
  try {
    const { userId, signedOrder, walletAddress, funderAddress, credentials: providedCreds } = req.body;
    
    console.log('📝 Trade request received:', {
      hasUserId: !!userId,
      hasSignedOrder: !!signedOrder,
      hasWalletAddress: !!walletAddress,
      hasProvidedCreds: !!providedCreds,
      credsKeys: providedCreds ? Object.keys(providedCreds) : []
    });
    
    if (!signedOrder || !walletAddress) {
      return res.status(400).json({ error: 'Missing required fields: signedOrder, walletAddress' });
    }
    
    let credentials;
    
    // PRIORITY 1: Use credentials provided directly in request body
    if (providedCreds && providedCreds.api_key && providedCreds.secret && providedCreds.passphrase) {
      credentials = providedCreds;
      console.log('✅ Using provided credentials from request body');
    } else if (userId) {
      // PRIORITY 2: Try to fetch from database as fallback
      console.log('🔍 No valid credentials in request, trying database lookup...');
      const db = getDb();
      
      if (isPostgres()) {
        const { rows } = await db.query('SELECT * FROM user_credentials WHERE user_id = $1', [userId]);
        credentials = rows[0];
      } else {
        credentials = db.prepare('SELECT * FROM user_credentials WHERE user_id = ?').get(userId);
      }
      
      if (credentials) {
        console.log('✅ Fetched credentials from database');
      } else {
        console.log('❌ No credentials found in database');
      }
    }
    
    if (!credentials) {
      console.error('❌ CREDENTIALS ERROR: No credentials available');
      return res.status(404).json({ error: 'Credentials not found. Please connect your wallet first.' });
    }
    
    if (!credentials.api_key || !credentials.secret || !credentials.passphrase) {
      console.error('❌ INCOMPLETE CREDENTIALS:', { 
        hasApiKey: !!credentials.api_key, 
        hasSecret: !!credentials.secret, 
        hasPassphrase: !!credentials.passphrase 
      });
      return res.status(400).json({ error: 'Incomplete credentials. Missing api_key, secret, or passphrase.' });
    }
    
    console.log(`📝 Executing trade for user ${userId.slice(0, 8)}...`);
    console.log(`   Token: ${signedOrder.tokenId}`);
    console.log(`   Side: ${signedOrder.side === 0 ? 'BUY' : 'SELL'}`);
    console.log(`   Amount: ${signedOrder.makerAmount}`);
    
    // Execute trade with dual-address retry
    const result = await executeTrade(
      credentials,
      signedOrder,
      walletAddress,
      funderAddress || credentials.funder_address
    );
    
    if (result.success) {
      console.log(`✅ Trade successful! Order ID: ${result.orderId}`);
      res.json({
        success: true,
        orderId: result.orderId,
        attemptedWith: result.attemptedWith
      });
    } else {
      console.error(`❌ Trade failed:`, result.error);
      res.status(result.status || 400).json({
        success: false,
        error: result.error,
        attemptedWith: result.attemptedWith
      });
    }
  } catch (error) {
    console.error('Error executing trade:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/polymarket/status
 * Check if user's trading is enabled
 */
router.get('/status', authenticateRequest, async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId parameter' });
    }
    
    const db = getDb();
    let credentials;
    
    if (isPostgres()) {
      const { rows } = await db.query('SELECT * FROM user_credentials WHERE user_id = $1', [userId]);
      credentials = rows[0];
    } else {
      credentials = db.prepare('SELECT * FROM user_credentials WHERE user_id = ?').get(userId);
    }
    
    if (!credentials) {
      return res.status(404).json({ error: 'Credentials not found' });
    }
    
    const status = await checkTradingStatus(
      credentials.wallet_address,
      credentials.api_key,
      credentials.secret,
      credentials.passphrase
    );
    
    res.json(status);
  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

export default router;
