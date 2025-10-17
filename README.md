# Polymarket Relay

Server-side relay for Polymarket CLOB calls.
- Keeps L2 secret server-side.
- L1 create/derive → inline verify with `GET /auth/api-keys` → store.
- L2 sanity (`GET /auth/ban-status/closed-only`).
- Place order (`POST /order`) with base64 HMAC signature.

## Endpoints
- POST `/polymarket/auth-create`
- GET  `/polymarket/l2-sanity?address=0xEOA`
- POST `/polymarket/order`

All requests require header: `x-relay-key: <RELAY_KEY>`

## Run
```bash
npm i
RELAY_KEY=<secret> node server.js
