/**
 * Pre-validation of PaymentAuthorization payloads before they are queued.
 *
 * Runs entirely in-process with no database or chain calls.
 * Any item that fails pre-validation is returned to the caller with a reason
 * and is never enqueued (README T12: spam resistance).
 */
import {
  decodePaymentAuthorization,
  verifyAuthorization,
  type PaymentAuthorization,
  type VerificationContext,
  ProtocolError,
} from '@kasuwa/protocol';

export interface PreValidateInput {
  /** base64url-encoded raw PaymentAuthorization bytes */
  encoded: string;
  /** Device public key for this allowance (65-byte uncompressed, hex). null = skip sig check */
  devicePublicKeyHex: string | null;
  ctx: VerificationContext;
  nowSeconds?: number;
}

export type PreValidateOk = {
  ok: true;
  auth: PaymentAuthorization;
  paymentIdHex: string;
};

export type PreValidateErr = {
  ok: false;
  reason: string;
};

export type PreValidateResult = PreValidateOk | PreValidateErr;

function base64urlToBytes(s: string): Uint8Array {
  // Convert base64url to standard base64, then decode
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return new Uint8Array(Buffer.from(padded, 'base64'));
}

export function preValidate(input: PreValidateInput): PreValidateResult {
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);

  // ── 1. Decode ─────────────────────────────────────────────────────────────
  let auth: PaymentAuthorization;
  try {
    const bytes = base64urlToBytes(input.encoded);
    auth = decodePaymentAuthorization(bytes);
  } catch (err) {
    const msg = err instanceof ProtocolError ? err.message : String(err);
    return { ok: false, reason: `Decode failed: ${msg}` };
  }

  // ── 2. Expiry ─────────────────────────────────────────────────────────────
  if (auth.expiresAt <= now) {
    return {
      ok: false,
      reason: `Authorization already expired at ${auth.expiresAt} (now: ${now})`,
    };
  }

  // ── 3. Merchant address format ────────────────────────────────────────────
  if (auth.merchant.length !== 32) {
    return {
      ok: false,
      reason: `Invalid merchant address length: ${auth.merchant.length} (expected 32)`,
    };
  }

  // ── 4. Signature (optional — skipped when public key is unavailable) ──────
  if (input.devicePublicKeyHex !== null) {
    try {
      const pubkeyBytes = Buffer.from(input.devicePublicKeyHex, 'hex');
      const valid = verifyAuthorization(auth, pubkeyBytes, input.ctx);
      if (!valid) {
        return { ok: false, reason: 'Signature verification failed' };
      }
    } catch (err) {
      return { ok: false, reason: `Signature check error: ${String(err)}` };
    }
  }

  const paymentIdHex = Buffer.from(auth.paymentId).toString('hex');
  return { ok: true, auth, paymentIdHex };
}
