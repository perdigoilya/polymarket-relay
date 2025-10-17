# Polymarket Relay Server

External relay service for bypassing Cloudflare WAF blocks when trading on Polymarket CLOB API.

## Features

- ✅ **Dual-address retry logic**: Tries owner address first, falls back to funder on 403
- ✅ **HMAC-SHA256 signing**: Exact port from working Edge Function logic
- ✅ **Browser-like headers**: Full set to bypass Cloudflare WAF
- ✅ **Secure credential storage**: Per-user API keys, secrets, and passphrases
- ✅ **Rate limiting**: 10 requests/min per userId
- ✅ **API authentication**: Shared secret between Lovable app and relay
- ✅ **PostgreSQL or SQLite**: Auto-detect based on environment

## Quick Start

### Development (Local)

```bash
# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your settings
# (For local dev, defaults work fine)

# Start server
npm run dev
```

Server will run on `http://localhost:3001`

### Production Deployment

#### Option 1: Railway

1. Create new project on [Railway](https://railway.app)
2. Connect your GitHub repository
3. Add PostgreSQL database service
4. Set environment variables:
   ```
   NODE_ENV=production
   DATABASE_URL=<auto-provided-by-railway>
   API_SECRET_KEY=<generate-with-openssl-rand-base64-32>
   FRONTEND_URL=https://your-lovable-app.lovable.app
   ```
5. Deploy automatically on push

#### Option 2: Render

1. Create new Web Service on [Render](https://render.com)
2. Connect your GitHub repository
3. Set build command: `npm install`
4. Set start command: `npm start`
5. Add PostgreSQL database
6. Set environment variables (same as Railway)

## API Endpoints

### 1. Health Check
```bash
GET /health

Response:
{
  "status": "ok",
  "timestamp": 1234567890,
  "uptime": 123.456
}
```

### 2. Store Credentials
```bash
POST /api/polymarket/credentials
Headers:
  Authorization: Bearer <your-api-secret>
Body:
{
  "userId": "user-uuid",
  "apiKey": "poly-api-key",
  "secret": "poly-secret",
  "passphrase": "poly-passphrase",
  "walletAddress": "0x...",
  "funderAddress": "0x..." (optional)
}

Response:
{
  "success": true
}
```

### 3. Execute Trade
```bash
POST /api/polymarket/trade
Headers:
  Authorization: Bearer <your-api-secret>
Body:
{
  "userId": "user-uuid",
  "signedOrder": {
    "salt": "...",
    "maker": "0x...",
    "signer": "0x...",
    "taker": "0x0000000000000000000000000000000000000000",
    "tokenId": "123...",
    "makerAmount": "1000000",
    "takerAmount": "500000",
    "expiration": "1234567890",
    "nonce": "1234567890",
    "feeRateBps": "0",
    "side": 0,
    "signatureType": 2,
    "signature": "0x..."
  },
  "walletAddress": "0x...",
  "funderAddress": "0x..." (optional)
}

Response (success):
{
  "success": true,
  "orderId": "abc123...",
  "attemptedWith": "owner" | "funder"
}

Response (error):
{
  "success": false,
  "error": "Trade failed: insufficient balance",
  "attemptedWith": "owner" | "funder"
}
```

### 4. Check Trading Status
```bash
GET /api/polymarket/status?userId=user-uuid
Headers:
  Authorization: Bearer <your-api-secret>

Response:
{
  "tradingEnabled": true,
  "closedOnly": false
}
```

### 5. Delete Credentials
```bash
DELETE /api/polymarket/credentials/:userId
Headers:
  Authorization: Bearer <your-api-secret>

Response:
{
  "success": true
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3001` |
| `NODE_ENV` | Environment (`development` or `production`) | `development` |
| `DATABASE_URL` | PostgreSQL connection string (production only) | SQLite in dev |
| `API_SECRET_KEY` | Shared secret for authentication | `dev-secret-key...` |
| `FRONTEND_URL` | Your Lovable app URL for CORS | - |

## Database Schema

```sql
CREATE TABLE user_credentials (
  user_id TEXT PRIMARY KEY,
  api_key TEXT NOT NULL,
  secret TEXT NOT NULL,
  passphrase TEXT NOT NULL,
  wallet_address TEXT NOT NULL,
  funder_address TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_wallet_address ON user_credentials(wallet_address);
```

## Security Notes

- Never commit `.env` file to version control
- Generate a strong `API_SECRET_KEY` for production: `openssl rand -base64 32`
- Use HTTPS in production (automatic on Railway/Render)
- Credentials are stored encrypted at rest in PostgreSQL
- Rate limiting prevents abuse (10 requests/min per user)
- CORS is configured to only allow your Lovable app

## Integration with Lovable App

Update your Lovable app to use the relay:

1. Add relay URL to environment:
   ```bash
   VITE_RELAY_URL=https://your-relay.railway.app
   ```

2. Update trade function in `src/pages/MarketDetail.tsx`:
   ```typescript
   const relayUrl = import.meta.env.VITE_RELAY_URL;
   const response = await fetch(`${relayUrl}/api/polymarket/trade`, {
     method: 'POST',
     headers: {
       'Content-Type': 'application/json',
       'Authorization': `Bearer ${YOUR_API_SECRET}`
     },
     body: JSON.stringify({
       userId: user.id,
       signedOrder,
       walletAddress: address,
       funderAddress
     })
   });
   ```

3. Update credential storage in `ConnectPolymarketDialog.tsx`

## Troubleshooting

### Port already in use
```bash
# Kill process on port 3001
lsof -ti:3001 | xargs kill -9

# Or use a different port
PORT=3002 npm run dev
```

### Database errors
```bash
# Reset SQLite database (development)
rm dev.db
npm run dev

# Check PostgreSQL connection (production)
psql $DATABASE_URL
```

### CORS errors
Ensure `FRONTEND_URL` in `.env` matches your Lovable app URL exactly (no trailing slash).

## Support

For issues or questions, check the logs:
- Development: Console output
- Production: Railway/Render logs dashboard
