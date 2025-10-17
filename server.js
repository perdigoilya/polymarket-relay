import express from "express";
import fetch from "node-fetch";
import crypto from "crypto";

const app = express();

// --- CORS (uncomment and set your Lovable origin if browser calls relay directly) ---
// app.use((req, res, next) => {
//   res.setHeader("Access-Control-Allow-Origin", "https://<your-lovable-domain>");
//   res.setHeader("Access-Control-Allow-Headers", "content-type, x-relay-key");
//   res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
//   if (req.method === "OPTIONS") return res.sendStatus(204);
//   next();
// });

app.use(express.json({ limit: "1mb" }));
app.use(express.text({ type: "application/json", limit: "1mb" }));

const CLOB = "https://clob.polymarket.com";
const ENV = process.env.NODE_ENV || "prod";
const RELAY_KEY = process.env.RELAY_KEY || ""; // set in platform env

// Simple in-memory store (swap to Redis/DB later if needed)
const STORE = new Map();
const rowKey = (eoa) => `polymarket:${ENV}:${String(eoa).toLowerCase()}`;

const tsSec = () => String(Math.floor(Date.now() / 1000));
const isB64 = (s) => /^[A-Za-z0-9+/]+={0,2}$/.test(s || "");
const hmacB64 = (secret, pre) => {
  // secret may already be base64 from Polymarket
  const key = isB64(secret) ? Buffer.from(secret, "base64") : Buffer.from(secret, "utf8");
  return crypto.createHmac("sha256", key).update(pre, "utf8").digest("base64"); // STANDARD base64
};
const okRelay = (req, res) => {
  if (req.headers["x-relay-key"] !== RELAY_KEY) {
    res.status(401).json({ ok: false, error: "Unauthorized relay" });
    return false;
  }
  return true;
};

// ----- L1: create/derive → inline verify → store -----
app.post("/polymarket/auth-create", async (req, res) => {
  if (!okRelay(req, res)) return;
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const { address, timestamp, nonce = 0, eip712Signature } = body || {};
    if (!address || !timestamp || !eip712Signature) {
      return res.status(400).json({ ok: false, error: "Missing L1 inputs" });
    }
    const L1 = {
      "content-type": "application/json",
      accept: "application/json",
      POLY_ADDRESS: address,
      POLY_SIGNATURE: eip712Signature,
      POLY_TIMESTAMP: String(timestamp), // epoch SECONDS
      POLY_NONCE: String(nonce)
    };

    // Try create
    let r = await fetch(`${CLOB}/auth/api-key`, { method: "POST", headers: L1, body: "{}" });
    let up = await r.text(); try { up = JSON.parse(up); } catch {}
    if (!r.ok) {
      // Fallback derive
      r = await fetch(`${CLOB}/auth/derive-api-key`, { method: "GET", headers: L1 });
      up = await r.text(); try { up = JSON.parse(up); } catch {}
      if (!r.ok) {
        const a = await fetch(`${CLOB}/auth/access-status?address=${address}`);
        let aJSON = await a.text(); try { aJSON = JSON.parse(aJSON); } catch {}
        return res.status(r.status).json({ ok: false, where: "derive", upstream: up, accessStatus: aJSON });
      }
    }

    const { key, secret, passphrase } = up || {};
    if (!key || !secret || !passphrase) {
      return res.status(502).json({ ok: false, error: "Malformed API-key response", upstream: up });
    }

    // Inline L2 verify (no DB yet)
    const eoa = address;
    const ts = tsSec();
    const pre = `GET/auth/api-keys${ts}`;
    const sig = hmacB64(secret, pre);
    const L2 = {
      accept: "application/json",
      POLY_ADDRESS: eoa,
      POLY_API_KEY: key,
      POLY_PASSPHRASE: passphrase,
      POLY_TIMESTAMP: ts,
      POLY_SIGNATURE: sig
    };
    const v = await fetch(`${CLOB}/auth/api-keys`, { method: "GET", headers: L2 });
    let vJSON = await v.text(); try { vJSON = JSON.parse(vJSON); } catch {}
    if (!v.ok) {
      return res.status(v.status).json({
        ok: false,
        where: "verify",
        upstream: vJSON,
        sent: { keySfx: key.slice(-6), passSfx: passphrase.slice(-4), ts, pre }
      });
    }

    // Store tuple
    STORE.set(rowKey(eoa), { key, secret, pass: passphrase, owner: eoa.toLowerCase() });
    return res.json({ ok: true, owner: eoa, keySuffix: key.slice(-6), passSuffix: passphrase.slice(-4) });

  } catch (e) {
    return res.status(500).json({ ok: false, error: "RelayCrash", message: e?.message });
  }
});

// ----- L2 sanity: closed_only -----
app.get("/polymarket/l2-sanity", async (req, res) => {
  if (!okRelay(req, res)) return;
  try {
    const eoa = String(req.query.address || "");
    const row = STORE.get(rowKey(eoa));
    if (!row) return res.status(400).json({ ok: false, error: "No creds for EOA" });

    const ts = tsSec();
    const pre = `GET/auth/ban-status/closed-only${ts}`;
    const sig = hmacB64(row.secret, pre);
    const hdr = {
      accept: "application/json",
      POLY_ADDRESS: eoa,
      POLY_API_KEY: row.key,
      POLY_PASSPHRASE: row.pass,
      POLY_TIMESTAMP: ts,
      POLY_SIGNATURE: sig
    };
    const r = await fetch(`${CLOB}/auth/ban-status/closed-only`, { headers: hdr });
    let up = await r.text(); try { up = JSON.parse(up); } catch {}
    return res.status(r.status).json({
      ok: r.ok, status: r.status, upstream: up,
      sent: { keySfx: row.key.slice(-6), passSfx: row.pass.slice(-4), ts, pre }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "RelayCrash", message: e?.message });
  }
});

// ----- L2 place order -----
app.post("/polymarket/order", async (req, res) => {
  if (!okRelay(req, res)) return;
  try {
    const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const parsed = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eoa = String(parsed?.address || "");
    const row = STORE.get(rowKey(eoa));
    if (!row) return res.status(400).json({ ok: false, error: "No creds for EOA" });

    const ts = tsSec();
    const pre = `POST/order${ts}${body}`; // EXACT bytes you send
    const sig = hmacB64(row.secret, pre);
    const hdr = {
      accept: "application/json",
      "content-type": "application/json",
      POLY_ADDRESS: eoa,
      POLY_API_KEY: row.key,
      POLY_PASSPHRASE: row.pass,
      POLY_TIMESTAMP: ts,
      POLY_SIGNATURE: sig
    };

    const r = await fetch(`${CLOB}/order`, { method: "POST", headers: hdr, body });
    let up = await r.text(); try { up = JSON.parse(up); } catch {}
    return res.status(r.status).json({
      ok: r.ok, status: r.status, upstream: up,
      sent: { keySfx: row.key.slice(-6), passSfx: row.pass.slice(-4), ts, pre }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: "RelayCrash", message: e?.message });
  }
});

app.listen(process.env.PORT || 3000, () =>
  console.log("Relay up on", process.env.PORT || 3000)
);
