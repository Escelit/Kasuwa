import {
  pgTable,
  text,
  bigint,
  integer,
  serial,
  numeric,
} from 'drizzle-orm/pg-core';

export const allowances = pgTable('allowances', {
  id: text('id').primaryKey(),
  owner: text('owner').notNull(),
  token: text('token').notNull(),
  deviceKeyHex: text('device_key_hex').notNull(),
  balance: numeric('balance').notNull(),
  perPaymentCap: numeric('per_payment_cap').notNull(),
  validUntil: bigint('valid_until', { mode: 'number' }).notNull(),
  closeRequestedAt: bigint('close_requested_at', { mode: 'number' }),
  status: text('status').notNull().default('Active'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const settlements = pgTable('settlements', {
  id: serial('id').primaryKey(),
  paymentId: text('payment_id').notNull().unique(),
  allowanceId: text('allowance_id').notNull(),
  merchant: text('merchant').notNull(),
  amount: numeric('amount').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  status: text('status').notNull().default('accepted'),
  paid: numeric('paid'),
  shortfall: numeric('shortfall'),
  onChainResult: text('on_chain_result'),
  rawBytes: text('raw_bytes'),
  attempts: integer('attempts').notNull().default(0),
  lastError: text('last_error'),
  acceptedAt: bigint('accepted_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});

export const shortfalls = pgTable('shortfalls', {
  id: serial('id').primaryKey(),
  deviceKeyHex: text('device_key_hex').notNull(),
  allowanceId: text('allowance_id').notNull(),
  merchant: text('merchant').notNull(),
  amount: numeric('amount').notNull(),
  timestamp: bigint('timestamp', { mode: 'number' }).notNull(),
});

export const relayerSubmissions = pgTable('relayer_submissions', {
  id: serial('id').primaryKey(),
  txHash: text('tx_hash').notNull().unique(),
  channelAccount: text('channel_account').notNull(),
  batchSize: integer('batch_size').notNull(),
  status: text('status').notNull(),
  submittedAt: bigint('submitted_at', { mode: 'number' }).notNull(),
  completedAt: bigint('completed_at', { mode: 'number' }),
});

export const indexerCursor = pgTable('indexer_cursor', {
  id: integer('id').primaryKey().default(1),
  lastLedger: bigint('last_ledger', { mode: 'number' }).notNull(),
  lastCursor: text('last_cursor').notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
});
