import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let db;

/**
 * Initialize database connection
 * Uses SQLite for development, PostgreSQL for production
 */
export async function initDatabase() {
  const isProduction = process.env.DATABASE_URL || process.env.NODE_ENV === 'production';
  
  if (isProduction) {
    console.log('📊 Connecting to PostgreSQL...');
    const pg = await import('pg');
    const { Pool } = pg.default;
    
    db = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL?.includes('localhost') ? false : { rejectUnauthorized: false }
    });
    
    await createPostgresSchema();
  } else {
    console.log('📊 Using SQLite for development...');
    const sqlite = await import('better-sqlite3');
    const Database = sqlite.default;
    
    const dbPath = join(__dirname, '..', 'dev.db');
    db = new Database(dbPath);
    
    createSqliteSchema();
  }
  
  console.log('✅ Database initialized');
}

/**
 * Create SQLite schema
 */
function createSqliteSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      secret TEXT NOT NULL,
      passphrase TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      funder_address TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_wallet_address ON user_credentials(wallet_address);
  `);
}

/**
 * Create PostgreSQL schema
 */
async function createPostgresSchema() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_credentials (
      user_id TEXT PRIMARY KEY,
      api_key TEXT NOT NULL,
      secret TEXT NOT NULL,
      passphrase TEXT NOT NULL,
      wallet_address TEXT NOT NULL,
      funder_address TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE INDEX IF NOT EXISTS idx_wallet_address ON user_credentials(wallet_address);
  `);
}

/**
 * Get database instance
 */
export function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

/**
 * Check if using PostgreSQL
 */
export function isPostgres() {
  return !!(process.env.DATABASE_URL || process.env.NODE_ENV === 'production');
}
