# Polymarket Trading Relay Server

A relay server for Polymarket CLOB API trading, using the official `@polymarket/clob-client`.

## Why a Relay Server?

Polymarket's CLOB API uses Cloudflare bot protection that blocks requests from:
- Browser frontends (CORS + bot detection)
- Most cloud providers (AWS Lambda, Vercel, Supabase Edge Functions, etc.)

**Solution**: Run this relay server on infrastructure with a **whitelisted IP address**.

## Architecture

```
Frontend (Browser)
    ↓ [wallet signs order]
    ↓
Edge Function (validates user auth)
    ↓ [forwards with API_SECRET_KEY]
    ↓
Relay Server (whitelisted IP + official ClobClient)
    ↓ [authenticated with L2 API credentials]
    ↓
Polymarket CLOB API ✅
```

## Quick Start

### 1. Install Dependencies

```bash
cd relay
npm install
```

Required packages:
- `@polymarket/clob-client` - Official Polymarket client
- `ethers` - Ethereum wallet library
- `express`, `cors`, `dotenv` - Server framework
- `pg` or `better-sqlite3` - Database

### 2. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```bash
# Authentication (generate with: openssl rand -base64 32)
API_SECRET_KEY=your_secret_key_here

# Wallet for signing (REQUIRED - this wallet signs on behalf of users)
WALLET_PRIVATE_KEY=0xYourPrivateKeyHere

# Frontend URL for CORS
FRONTEND_URL=https://your-app.lovable.app
```

### 3. Get Your Egress IP

Start the server and check your public IP:

```bash
npm start

# In another terminal:
curl http://localhost:3001/api/polymarket/ip
```

Example response:
```json
{
  "success": true,
  "egressIp": "54.188.71.94",
  "message": "This is the IP address that Polymarket sees from this relay server",
  "instructions": "Contact Polymarket support to whitelist this IP for CLOB API access"
}
```

### 4. Request IP Whitelisting from Polymarket

**Critical Step**: Your relay server's IP must be whitelisted by Polymarket.

Contact: **support@polymarket.com**

Template email:
```
Subject: IP Whitelist Request for Trading Application

Hello Polymarket,

I'm building a prediction markets trading application and need to whitelist 
my server IP for CLOB API access.

IP Address: [YOUR_EGRESS_IP]
Use Case: Prediction markets trading platform using official clob-client
Application: https://your-app.lovable.app

Thank you!
```

## Deployment Options

### Option 1: VPS (Recommended)

Deploy to a VPS with a **static IP**:
- **DigitalOcean** Droplet
- **Linode** VPS
- **Vultr** Cloud Compute
- **AWS EC2** (with Elastic IP)

**Why VPS?** You control the IP address and it won't change.

### Option 2: Dedicated Server

For production, use a dedicated server with a guaranteed static IP.

### ⚠️ NOT Recommended

These platforms use dynamic/shared IPs that get blocked:
- ❌ Vercel
- ❌ Netlify
- ❌ Railway (shared egress)
- ❌ Render (shared egress)

## API Endpoints

### Get Server IP
```bash
GET /api/polymarket/ip

Response:
{
  "success": true,
  "egressIp": "54.188.71.94",
  "instructions": "Contact Polymarket support to whitelist this IP..."
}
```

### Health Check
```bash
GET /api/polymarket/health

Response:
{
  "success": true,
  "service": "polymarket-relay",
  "version": "2.0.0",
  "client": "@polymarket/clob-client v4.22.7",
  "timestamp": "2025-10-17T05:55:00.000Z"
}
```

### Execute Trade
```bash
POST /api/polymarket/trade
Authorization: Bearer YOUR_API_SECRET_KEY

Body:
{
  "userId": "user-uuid",
  "walletAddress": "0x...",
  "signedOrder": {
    "salt": "123...",
    "maker": "0x...",
    "signer": "0x...",
    "taker": "0x0000000000000000000000000000000000000000",
    "tokenId": "456...",
    "makerAmount": "1000000",
    "takerAmount": "500000",
    "expiration": "1234567890",
    "nonce": "1234567890",
    "feeRateBps": "0",
    "side": 0,
    "signatureType": 2,
    "signature": "0x..."
  },
  "credentials": {
    "api_key": "...",
    "secret": "...",
    "passphrase": "..."
  }
}

Response:
{
  "success": true,
  "data": {
    "orderID": "0x...",
    "status": "LIVE"
  }
}
```

## Integration with Lovable App

Update your Edge Function to use the relay:

```typescript
// In supabase/functions/polymarket-trade/index.ts

const RELAY_URL = Deno.env.get('RELAY_URL') || 'http://localhost:3001';
const RELAY_SECRET = Deno.env.get('API_SECRET_KEY');

const relayResponse = await fetch(`${RELAY_URL}/api/polymarket/trade`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${RELAY_SECRET}`,
  },
  body: JSON.stringify({
    userId: user.id,
    walletAddress,
    signedOrder,
    credentials: {
      api_key: creds.api_credentials_key,
      secret: creds.api_credentials_secret,
      passphrase: creds.api_credentials_passphrase,
    }
  }),
});
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `API_SECRET_KEY` | ✅ | Shared secret for authentication |
| `WALLET_PRIVATE_KEY` | ✅ | Private key for ClobClient signing |
| `FRONTEND_URL` | ✅ | Your Lovable app URL (for CORS) |
| `PORT` | ❌ | Server port (default: 3001) |
| `CLOB_API_URL` | ❌ | Polymarket API URL (default: https://clob.polymarket.com) |
| `DATABASE_URL` | ❌ | PostgreSQL connection (optional, uses SQLite if not set) |

## Security Checklist

- ✅ Never commit `.env` to git
- ✅ Generate strong `API_SECRET_KEY`: `openssl rand -base64 32`
- ✅ Use HTTPS in production
- ✅ Implement rate limiting (built-in: 10 req/min per user)
- ✅ Restrict CORS to your frontend only
- ✅ Store credentials encrypted in database
- ✅ Use static IP that won't change

## Troubleshooting

### Still Getting 403 Errors?

1. **Check your egress IP**:
   ```bash
   curl https://your-relay.com/api/polymarket/ip
   ```

2. **Verify IP is whitelisted**: Contact Polymarket support

3. **Check Cloudflare Ray ID** in error response - send to Polymarket

### Authentication Errors?

Ensure `API_SECRET_KEY` matches between:
- Your Edge Function (`API_SECRET_KEY` secret in Supabase)
- Your Relay Server (`.env` file)

### ClobClient Errors?

Make sure `WALLET_PRIVATE_KEY` is set and valid:
```bash
# Check if private key is loaded
curl http://localhost:3001/api/polymarket/health
```

## Monitoring

### Check Server Status
```bash
curl https://your-relay.com/api/polymarket/health
```

### Check Egress IP Hasn't Changed
```bash
curl https://your-relay.com/api/polymarket/ip
```

Set up monitoring to alert you if the IP changes!

## Support

For issues:
1. Check server logs
2. Verify IP is still whitelisted
3. Test with `curl` commands above
4. Contact Polymarket support if blocked

## License

MIT
