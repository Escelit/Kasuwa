/**
 * SQLite database initialization for Kasuwa mobile.
 *
 * Opens (or creates) the kasuwa.db SQLite file and runs all pending migrations.
 * Uses expo-sqlite v14 async API.
 */
import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (_db !== null) return _db;
  const db = await SQLite.openDatabaseAsync('kasuwa.db');
  await runMigrations(db);
  _db = db;
  return db;
}

/**
 * Runs all migrations in order.
 * Each migration is idempotent (CREATE TABLE IF NOT EXISTS).
 */
async function runMigrations(db: SQLite.SQLiteDatabase): Promise<void> {
  // Migration 001: outbox table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS outbox (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id    TEXT    NOT NULL UNIQUE,
      allowance_id  TEXT    NOT NULL,
      raw_bytes     BLOB    NOT NULL,
      amount        TEXT    NOT NULL,
      merchant      TEXT    NOT NULL,
      expires_at    INTEGER NOT NULL,
      status        TEXT    NOT NULL DEFAULT 'queued',
      attempts      INTEGER NOT NULL DEFAULT 0,
      last_error    TEXT,
      result_code   TEXT,
      paid          TEXT,
      shortfall     TEXT,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);

  // Migration 002: allowance cache (customer-side)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS allowance_cache (
      allowance_id    TEXT    NOT NULL PRIMARY KEY,
      owner           TEXT    NOT NULL,
      token           TEXT    NOT NULL,
      device_key_hex  TEXT    NOT NULL,
      balance         TEXT    NOT NULL,
      per_payment_cap TEXT    NOT NULL,
      valid_until     INTEGER NOT NULL,
      status          TEXT    NOT NULL,
      local_spent     TEXT    NOT NULL DEFAULT '0',
      last_synced_at  INTEGER,
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL
    );
  `);

  // Migration 003: issued authorization history (customer-side)
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS issued_authorizations (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      payment_id    TEXT    NOT NULL UNIQUE,
      allowance_id  TEXT    NOT NULL,
      merchant      TEXT    NOT NULL,
      amount        TEXT    NOT NULL,
      issued_at     INTEGER NOT NULL,
      expires_at    INTEGER NOT NULL,
      raw_bytes     BLOB    NOT NULL,
      created_at    INTEGER NOT NULL
    );
  `);

  // Migration 004: merchant allowance snapshot cache synced from indexer
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS merchant_allowance_snapshots (
      allowance_id    TEXT    NOT NULL PRIMARY KEY,
      owner           TEXT    NOT NULL,
      balance_bucket  TEXT    NOT NULL,
      valid_until     INTEGER NOT NULL,
      age_seconds     INTEGER NOT NULL,
      shortfall_count INTEGER NOT NULL DEFAULT 0,
      total_shortfall TEXT    NOT NULL DEFAULT '0',
      status          TEXT    NOT NULL,
      last_synced_at  INTEGER NOT NULL,
      device_key_hex  TEXT
    );
    CREATE TABLE IF NOT EXISTS sync_metadata (
      key   TEXT NOT NULL PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}
