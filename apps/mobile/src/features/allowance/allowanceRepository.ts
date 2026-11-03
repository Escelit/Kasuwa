import { getDb } from '../../db/database';

export interface CustomerAllowanceRecord {
  allowanceId: string;
  owner: string;
  token: string;
  deviceKeyHex: string;
  balance: bigint;
  perPaymentCap: bigint;
  validUntil: number;
  status: 'Active' | 'Closing' | 'Closed' | 'Reclaimed';
  localSpent: bigint;
  lastSyncedAt?: number | null;
  createdAt: number;
  updatedAt: number;
}

interface AllowanceRow {
  allowance_id: string;
  owner: string;
  token: string;
  device_key_hex: string;
  balance: string;
  per_payment_cap: string;
  valid_until: number;
  status: string;
  local_spent: string;
  last_synced_at: number | null;
  created_at: number;
  updated_at: number;
}

function rowToRecord(r: AllowanceRow): CustomerAllowanceRecord {
  return {
    allowanceId: r.allowance_id,
    owner: r.owner,
    token: r.token,
    deviceKeyHex: r.device_key_hex,
    balance: BigInt(r.balance),
    perPaymentCap: BigInt(r.per_payment_cap),
    validUntil: r.valid_until,
    status: r.status as CustomerAllowanceRecord['status'],
    localSpent: BigInt(r.local_spent || '0'),
    lastSyncedAt: r.last_synced_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function getActiveAllowance(): Promise<CustomerAllowanceRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<AllowanceRow>(
    `SELECT * FROM allowance_cache WHERE status IN ('Active', 'Closing') ORDER BY created_at DESC LIMIT 1`,
  );
  return row ? rowToRecord(row) : null;
}

export async function saveAllowance(record: CustomerAllowanceRecord): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `INSERT OR REPLACE INTO allowance_cache
     (allowance_id, owner, token, device_key_hex, balance, per_payment_cap,
      valid_until, status, local_spent, last_synced_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      record.allowanceId,
      record.owner,
      record.token,
      record.deviceKeyHex,
      record.balance.toString(),
      record.perPaymentCap.toString(),
      record.validUntil,
      record.status,
      record.localSpent.toString(),
      record.lastSyncedAt ?? now,
      record.createdAt,
      now,
    ],
  );
}

export async function recordSpend(allowanceId: string, amount: bigint): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = await db.getFirstAsync<AllowanceRow>(
    `SELECT * FROM allowance_cache WHERE allowance_id = ?`,
    [allowanceId],
  );
  if (!row) return;

  const currentSpent = BigInt(row.local_spent || '0');
  const newSpent = currentSpent + amount;
  await db.runAsync(
    `UPDATE allowance_cache SET local_spent = ?, updated_at = ? WHERE allowance_id = ?`,
    [newSpent.toString(), now, allowanceId],
  );
}

export async function topUpAllowance(allowanceId: string, amount: bigint): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const row = await db.getFirstAsync<AllowanceRow>(
    `SELECT * FROM allowance_cache WHERE allowance_id = ?`,
    [allowanceId],
  );
  if (!row) return;

  const currentBal = BigInt(row.balance);
  const newBal = currentBal + amount;
  await db.runAsync(
    `UPDATE allowance_cache SET balance = ?, updated_at = ? WHERE allowance_id = ?`,
    [newBal.toString(), now, allowanceId],
  );
}

export async function requestCloseAllowance(allowanceId: string): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `UPDATE allowance_cache SET status = 'Closing', updated_at = ? WHERE allowance_id = ?`,
    [now, allowanceId],
  );
}

export async function reclaimAllowance(allowanceId: string): Promise<void> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  await db.runAsync(
    `UPDATE allowance_cache SET status = 'Closed', balance = '0', updated_at = ? WHERE allowance_id = ?`,
    [now, allowanceId],
  );
}
