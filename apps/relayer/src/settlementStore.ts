/**
 * In-memory settlement record store (stub for Commit 7).
 *
 * In Commit 8 this is replaced by the Postgres-backed packages/db layer.
 * The interface is the same so the routes don't change.
 */
import { type PaymentAuthorization } from '@kasuwa/protocol';

export type SettlementStatus = 'accepted' | 'submitting' | 'settled' | 'failed';

export interface SettlementRecord {
  paymentId: string;
  allowanceId: string;
  merchant: string;
  amount: bigint;
  expiresAt: number;
  status: SettlementStatus;
  rawBytesB64: string;
  acceptedAt: number;
  updatedAt: number;
  onChainResult: string | null;
  error: string | null;
}

// Keyed by paymentId hex
const store = new Map<string, SettlementRecord>();

/** Returns [record, isNew] */
export function upsertRecord(
  paymentIdHex: string,
  auth: PaymentAuthorization,
  rawB64: string,
): [SettlementRecord, boolean] {
  const existing = store.get(paymentIdHex);
  if (existing) return [existing, false]; // idempotent

  const now = Math.floor(Date.now() / 1000);
  const record: SettlementRecord = {
    paymentId: paymentIdHex,
    allowanceId: auth.allowanceId.toString(),
    merchant: Buffer.from(auth.merchant).toString('hex'),
    amount: auth.amount,
    expiresAt: auth.expiresAt,
    status: 'accepted',
    rawBytesB64: rawB64,
    acceptedAt: now,
    updatedAt: now,
    onChainResult: null,
    error: null,
  };
  store.set(paymentIdHex, record);
  return [record, true];
}

export function getRecord(paymentIdHex: string): SettlementRecord | undefined {
  return store.get(paymentIdHex);
}

export function updateRecord(
  paymentIdHex: string,
  updates: Partial<Pick<SettlementRecord, 'status' | 'onChainResult' | 'error'>>,
): void {
  const rec = store.get(paymentIdHex);
  if (!rec) return;
  Object.assign(rec, updates, { updatedAt: Math.floor(Date.now() / 1000) });
}

/** For tests: clear all state */
export function _clearStore(): void {
  store.clear();
}
