/**
 * OutboxRepository: SQLite persistence for the merchant outbox.
 *
 * Idempotent inserts: duplicate payment_id returns the existing row.
 * All state transitions go through outboxReducer before persisting.
 */
import { getDb } from '../../db/database';
import {
  outboxReducer,
  type OutboxEntry,
  type OutboxAction,
  type OutboxStatus,
} from './outboxReducer';

// ─── Row → domain mapping ─────────────────────────────────────────────────────

interface OutboxRow {
  id: number;
  payment_id: string;
  allowance_id: string;
  raw_bytes: Uint8Array;
  amount: string;
  merchant: string;
  expires_at: number;
  status: string;
  attempts: number;
  last_error: string | null;
  result_code: string | null;
  paid: string | null;
  shortfall: string | null;
  created_at: number;
  updated_at: number;
}

function rowToEntry(row: OutboxRow): OutboxEntry {
  return {
    id: row.id,
    paymentId: row.payment_id,
    allowanceId: row.allowance_id,
    rawBytes: row.raw_bytes,
    amount: BigInt(row.amount),
    merchant: row.merchant,
    expiresAt: row.expires_at,
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    lastError: row.last_error,
    resultCode: row.result_code,
    paid: row.paid !== null ? BigInt(row.paid) : null,
    shortfall: row.shortfall !== null ? BigInt(row.shortfall) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ─── Repository ───────────────────────────────────────────────────────────────

/**
 * Inserts a new outbox entry. If payment_id already exists, returns the
 * existing row unchanged (idempotent).
 */
export async function insertOutboxEntry(
  entry: Omit<OutboxEntry, 'id' | 'status' | 'attempts' | 'lastError' | 'resultCode' | 'paid' | 'shortfall' | 'createdAt' | 'updatedAt'>,
): Promise<OutboxEntry> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);

  // Check for existing entry (idempotency)
  const existing = await db.getFirstAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE payment_id = ?',
    [entry.paymentId],
  );
  if (existing) return rowToEntry(existing);

  await db.runAsync(
    `INSERT INTO outbox
       (payment_id, allowance_id, raw_bytes, amount, merchant, expires_at,
        status, attempts, last_error, result_code, paid, shortfall, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, NULL, NULL, ?, ?)`,
    [
      entry.paymentId,
      entry.allowanceId,
      entry.rawBytes,
      entry.amount.toString(),
      entry.merchant,
      entry.expiresAt,
      now,
      now,
    ],
  );

  const row = await db.getFirstAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE payment_id = ?',
    [entry.paymentId],
  );
  if (!row) throw new Error(`Failed to insert outbox entry ${entry.paymentId}`);
  return rowToEntry(row);
}

/**
 * Applies an action to a stored entry and persists the resulting state.
 */
export async function applyOutboxAction(
  paymentId: string,
  action: OutboxAction,
): Promise<OutboxEntry> {
  const db = await getDb();
  const row = await db.getFirstAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE payment_id = ?',
    [paymentId],
  );
  if (!row) throw new Error(`Outbox entry not found: ${paymentId}`);
  const current = rowToEntry(row);
  const next = outboxReducer(current, action);

  await db.runAsync(
    `UPDATE outbox SET
       status = ?, attempts = ?, last_error = ?,
       result_code = ?, paid = ?, shortfall = ?, updated_at = ?
     WHERE payment_id = ?`,
    [
      next.status,
      next.attempts,
      next.lastError,
      next.resultCode,
      next.paid !== null ? next.paid.toString() : null,
      next.shortfall !== null ? next.shortfall.toString() : null,
      next.updatedAt,
      paymentId,
    ],
  );

  return next;
}

/**
 * Returns all entries in a given status, ordered by expiresAt ascending
 * (nearest expiry first — settles most urgent first).
 */
export async function getOutboxByStatus(status: OutboxStatus): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox WHERE status = ? ORDER BY expires_at ASC',
    [status],
  );
  return rows.map(rowToEntry);
}

/**
 * Returns all entries not in a terminal state (queued, submitting, failed_retry).
 */
export async function getPendingOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    `SELECT * FROM outbox
     WHERE status IN ('queued', 'submitting', 'failed_retry')
     ORDER BY expires_at ASC`,
  );
  return rows.map(rowToEntry);
}

/**
 * Returns all outbox entries for display (all statuses).
 */
export async function getAllOutboxEntries(): Promise<OutboxEntry[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<OutboxRow>(
    'SELECT * FROM outbox ORDER BY created_at DESC',
  );
  return rows.map(rowToEntry);
}

/**
 * Marks all expired queued/failed_retry entries as 'expired'.
 * Called periodically and at app start.
 */
export async function markExpiredEntries(nowSeconds?: number): Promise<number> {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const db = await getDb();
  const result = await db.runAsync(
    `UPDATE outbox
     SET status = 'expired', last_error = 'Authorization expired before settlement',
         updated_at = ?
     WHERE status IN ('queued', 'failed_retry') AND expires_at <= ?`,
    [now, now],
  );
  return result.changes;
}

/**
 * Returns a Set of all payment_ids in the outbox (for replay detection).
 */
export async function getOutboxPaymentIdSet(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ payment_id: string }>(
    'SELECT payment_id FROM outbox',
  );
  return new Set(rows.map((r) => r.payment_id));
}

/**
 * Serializes all pending (non-terminal, non-expired) entries to a JSON
 * backup payload. Used for the export/backup feature.
 */
export async function exportPendingEntries(): Promise<string> {
  const entries = await getPendingOutboxEntries();
  const exportable = entries.map((e) => ({
    paymentId: e.paymentId,
    allowanceId: e.allowanceId,
    rawBytesHex: Buffer.from(e.rawBytes).toString('hex'),
    amount: e.amount.toString(),
    merchant: e.merchant,
    expiresAt: e.expiresAt,
    createdAt: e.createdAt,
  }));
  return JSON.stringify(exportable, null, 2);
}
