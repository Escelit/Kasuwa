export const MIGRATION_001_SQL = `-- Kasuwa relayer + indexer PostgreSQL schema
-- Migration 001: initial schema

-- 1. Allowances tracked from on-chain contract events
CREATE TABLE IF NOT EXISTS allowances (
    id                  TEXT        PRIMARY KEY, -- allowance_id
    owner               TEXT        NOT NULL,
    token               TEXT        NOT NULL,
    device_key_hex      TEXT        NOT NULL,
    balance             NUMERIC     NOT NULL,
    per_payment_cap     NUMERIC     NOT NULL,
    valid_until         BIGINT      NOT NULL,
    close_requested_at  BIGINT,
    status              TEXT        NOT NULL DEFAULT 'Active',
    created_at          BIGINT      NOT NULL,
    updated_at          BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS allowances_owner ON allowances(owner);
CREATE INDEX IF NOT EXISTS allowances_status ON allowances(status);

-- 2. Settlement records written by relayer and indexer
CREATE TABLE IF NOT EXISTS settlements (
    id            BIGSERIAL PRIMARY KEY,
    payment_id    TEXT        NOT NULL UNIQUE,
    allowance_id  TEXT        NOT NULL,
    merchant      TEXT        NOT NULL,
    amount        NUMERIC     NOT NULL,
    expires_at    BIGINT      NOT NULL,
    status        TEXT        NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('accepted','submitting','settled','partial','rejected','failed')),
    paid          NUMERIC,
    shortfall     NUMERIC,
    on_chain_result TEXT,
    raw_bytes     TEXT,
    attempts      INTEGER     NOT NULL DEFAULT 0,
    last_error    TEXT,
    accepted_at   BIGINT      NOT NULL,
    updated_at    BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS settlements_status_expires
    ON settlements(status, expires_at);

CREATE INDEX IF NOT EXISTS settlements_allowance_id
    ON settlements(allowance_id);

CREATE INDEX IF NOT EXISTS settlements_merchant
    ON settlements(merchant);

-- 3. Shortfalls attributed to customer device keys
CREATE TABLE IF NOT EXISTS shortfalls (
    id              BIGSERIAL PRIMARY KEY,
    device_key_hex  TEXT        NOT NULL,
    allowance_id    TEXT        NOT NULL,
    merchant        TEXT        NOT NULL,
    amount          NUMERIC     NOT NULL,
    timestamp       BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS shortfalls_device_key
    ON shortfalls(device_key_hex);

-- 4. Relayer batch submissions log
CREATE TABLE IF NOT EXISTS relayer_submissions (
    id              BIGSERIAL PRIMARY KEY,
    tx_hash         TEXT        NOT NULL UNIQUE,
    channel_account TEXT        NOT NULL,
    batch_size      INTEGER     NOT NULL,
    status          TEXT        NOT NULL,
    submitted_at    BIGINT      NOT NULL,
    completed_at    BIGINT
);

-- 5. Indexer checkpoint cursor for restart-safe streaming
CREATE TABLE IF NOT EXISTS indexer_cursor (
    id          INTEGER     PRIMARY KEY DEFAULT 1,
    last_ledger BIGINT      NOT NULL,
    last_cursor TEXT        NOT NULL,
    updated_at  BIGINT      NOT NULL
);
`;
