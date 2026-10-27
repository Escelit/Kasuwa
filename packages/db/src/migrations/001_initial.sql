-- Kasuwa relayer + indexer PostgreSQL schema
-- Migration 001: initial schema

-- Settlement records written by the relayer
CREATE TABLE IF NOT EXISTS settlements (
    id            BIGSERIAL PRIMARY KEY,
    payment_id    TEXT        NOT NULL UNIQUE,
    allowance_id  TEXT        NOT NULL,
    merchant      TEXT        NOT NULL,  -- hex-encoded 32-byte address
    amount        NUMERIC     NOT NULL,
    expires_at    BIGINT      NOT NULL,  -- unix seconds
    raw_bytes     BYTEA       NOT NULL,  -- raw wire bytes of PaymentAuthorization
    status        TEXT        NOT NULL DEFAULT 'accepted'
                  CHECK (status IN ('accepted','submitting','settled','partial','rejected','failed_retry')),
    attempts      INTEGER     NOT NULL DEFAULT 0,
    last_error    TEXT,
    on_chain_result TEXT,
    paid          NUMERIC,
    shortfall     NUMERIC,
    accepted_at   BIGINT      NOT NULL,
    updated_at    BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS settlements_status_expires
    ON settlements(status, expires_at);

CREATE INDEX IF NOT EXISTS settlements_allowance_id
    ON settlements(allowance_id);

-- Contract events ingested by the indexer
CREATE TABLE IF NOT EXISTS contract_events (
    id            BIGSERIAL PRIMARY KEY,
    ledger_seq    BIGINT      NOT NULL,
    tx_hash       TEXT        NOT NULL,
    event_type    TEXT        NOT NULL,  -- e.g. 'AllowanceCreated', 'PaymentSettled'
    allowance_id  TEXT,
    payment_id    TEXT,
    data_json     JSONB       NOT NULL,
    ingested_at   BIGINT      NOT NULL
);

CREATE INDEX IF NOT EXISTS events_allowance_id ON contract_events(allowance_id);
CREATE INDEX IF NOT EXISTS events_ledger       ON contract_events(ledger_seq);

-- Allowance snapshots synced from the indexer (merchant cache)
CREATE TABLE IF NOT EXISTS allowance_snapshots (
    allowance_id        TEXT        PRIMARY KEY,
    owner               TEXT        NOT NULL,
    device_key_hex      TEXT        NOT NULL,  -- 65-byte uncompressed hex
    total_size          NUMERIC     NOT NULL,
    balance             NUMERIC     NOT NULL,
    per_payment_cap     NUMERIC     NOT NULL,
    valid_until         BIGINT      NOT NULL,
    status              TEXT        NOT NULL,
    shortfall_count     INTEGER     NOT NULL DEFAULT 0,
    total_shortfall     NUMERIC     NOT NULL DEFAULT 0,
    age_seconds         INTEGER     NOT NULL DEFAULT 0,
    snapshot_at         BIGINT      NOT NULL,   -- unix seconds when this row was written
    updated_at          BIGINT      NOT NULL
);
