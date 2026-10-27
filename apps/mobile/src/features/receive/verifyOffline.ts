/**
 * Offline verification logic for the merchant side.
 *
 * All checks run locally without network access.
 * Returns a typed result for each check so the UI can show granular feedback.
 *
 * Check order (matches README):
 *  1. Signature valid for the allowance's device key (from snapshot cache)
 *  2. merchant == this merchant
 *  3. amount == requested amount
 *  4. expires_at in the future
 *  5. payment_id not already in local outbox
 */
import {
  type PaymentAuthorization,
  type PaymentRequest,
  verifyAuthorization,
  type VerificationContext,
} from '@kasuwa/protocol';

export type VerifyCheckId =
  | 'signature'
  | 'merchant_match'
  | 'amount_match'
  | 'not_expired'
  | 'no_replay';

export type VerifyCheckStatus = 'pass' | 'fail' | 'unknown';

export interface VerifyCheckResult {
  id: VerifyCheckId;
  status: VerifyCheckStatus;
  /** Human-readable detail for the merchant UI */
  detail: string;
}

export interface OfflineVerifyResult {
  /** true only if ALL checks passed */
  allPassed: boolean;
  checks: VerifyCheckResult[];
}

export interface OfflineVerifyOptions {
  auth: PaymentAuthorization;
  request: PaymentRequest;
  /** 65-byte uncompressed P-256 public key from the allowance snapshot. null = allowance unknown. */
  devicePublicKey: Uint8Array | null;
  /** Merchant's own Stellar address (raw 32 bytes) */
  merchantAddress: Uint8Array;
  /** Set of payment_ids already in the outbox (hex strings) */
  outboxPaymentIds: Set<string>;
  ctx: VerificationContext;
  /** Current unix timestamp (defaults to Date.now()/1000) */
  nowSeconds?: number;
}

/**
 * Runs all offline checks on a scanned PaymentAuthorization.
 * Pure function — no I/O.
 */
export function verifyOffline(opts: OfflineVerifyOptions): OfflineVerifyResult {
  const now = opts.nowSeconds ?? Math.floor(Date.now() / 1000);
  const checks: VerifyCheckResult[] = [];

  // ── Check 1: Signature ───────────────────────────────────────────────────
  if (opts.devicePublicKey === null) {
    checks.push({
      id: 'signature',
      status: 'unknown',
      detail:
        'Allowance not in local cache — cannot verify signature. ' +
        'Sync with indexer when online. Accepting is high-risk.',
    });
  } else {
    let sigValid = false;
    try {
      sigValid = verifyAuthorization(opts.auth, opts.devicePublicKey, opts.ctx);
    } catch {
      sigValid = false;
    }
    checks.push({
      id: 'signature',
      status: sigValid ? 'pass' : 'fail',
      detail: sigValid
        ? 'Signature verified against allowance device key.'
        : 'Signature verification FAILED. This authorization may be forged or corrupted.',
    });
  }

  // ── Check 2: Merchant match ──────────────────────────────────────────────
  const merchantHex = Buffer.from(opts.merchantAddress).toString('hex');
  const authMerchantHex = Buffer.from(opts.auth.merchant).toString('hex');
  const merchantMatch = merchantHex === authMerchantHex;
  checks.push({
    id: 'merchant_match',
    status: merchantMatch ? 'pass' : 'fail',
    detail: merchantMatch
      ? 'Payment is addressed to this merchant.'
      : `Merchant mismatch: authorization is for ${authMerchantHex}, not this merchant (${merchantHex}).`,
  });

  // ── Check 3: Amount match ────────────────────────────────────────────────
  const amountMatch = opts.auth.amount === opts.request.amount;
  checks.push({
    id: 'amount_match',
    status: amountMatch ? 'pass' : 'fail',
    detail: amountMatch
      ? `Amount matches: ${opts.auth.amount} base units.`
      : `Amount mismatch: authorization has ${opts.auth.amount}, request had ${opts.request.amount}.`,
  });

  // ── Check 4: Expiry ──────────────────────────────────────────────────────
  const notExpired = opts.auth.expiresAt > now;
  checks.push({
    id: 'not_expired',
    status: notExpired ? 'pass' : 'fail',
    detail: notExpired
      ? `Authorization valid until ${new Date(opts.auth.expiresAt * 1000).toISOString()}.`
      : `Authorization expired at ${new Date(opts.auth.expiresAt * 1000).toISOString()} (${now - opts.auth.expiresAt}s ago).`,
  });

  // ── Check 5: Replay protection ───────────────────────────────────────────
  const paymentIdHex = Buffer.from(opts.auth.paymentId).toString('hex');
  const isReplay = opts.outboxPaymentIds.has(paymentIdHex);
  checks.push({
    id: 'no_replay',
    status: isReplay ? 'fail' : 'pass',
    detail: isReplay
      ? `Payment ID ${paymentIdHex} is already in the outbox. This is a duplicate.`
      : `Payment ID ${paymentIdHex} is new.`,
  });

  const allPassed = checks.every((c) => c.status === 'pass');
  return { allPassed, checks };
}
