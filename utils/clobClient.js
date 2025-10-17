// Polymarket CLOB Client wrapper using official @polymarket/clob-client
import { ClobClient } from '@polymarket/clob-client';
import { ethers } from 'ethers';

/**
 * Initialize ClobClient with API credentials
 * @param {Object} credentials
 * @param {string} credentials.apiKey - Polymarket API key
 * @param {string} credentials.secret - Polymarket API secret
 * @param {string} credentials.passphrase - Polymarket API passphrase
 * @param {string} credentials.walletAddress - EOA wallet address
 * @param {string} privateKey - Private key for wallet (for signing)
 * @returns {ClobClient}
 */
export function createClobClient({ apiKey, secret, passphrase, walletAddress }, privateKey) {
  const clobApiUrl = process.env.CLOB_API_URL || 'https://clob.polymarket.com';
  const chainId = 137; // Polygon mainnet

  // Create wallet from private key
  const wallet = new ethers.Wallet(privateKey);

  // Verify wallet address matches
  if (wallet.address.toLowerCase() !== walletAddress.toLowerCase()) {
    throw new Error(`Wallet address mismatch: expected ${walletAddress}, got ${wallet.address}`);
  }

  // Create enhanced wallet with required methods
  const enhancedWallet = {
    ...wallet,
    _signTypedData: async (domain, types, value) => wallet.signTypedData(domain, types, value),
    getAddress: async () => wallet.address,
  };

  // Create API credentials object
  const apiCreds = {
    key: apiKey,
    secret: secret,
    passphrase: passphrase,
  };

  // Initialize ClobClient
  const client = new ClobClient(
    clobApiUrl,
    chainId,
    enhancedWallet,
    apiCreds
  );

  console.log(`✓ ClobClient initialized for ${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`);
  
  return client;
}

/**
 * Place an order using ClobClient
 * @param {ClobClient} client
 * @param {Object} signedOrder - The signed order from frontend
 * @returns {Promise<Object>}
 */
export async function placeOrder(client, signedOrder) {
  try {
    console.log('→ Placing order via ClobClient...');
    
    // The order is already signed by the frontend, we just need to post it
    const result = await client.postOrder(signedOrder);
    
    console.log('✓ Order placed successfully:', result);
    return { success: true, data: result };
  } catch (error) {
    console.error('✗ Order placement failed:', error);
    throw error;
  }
}
