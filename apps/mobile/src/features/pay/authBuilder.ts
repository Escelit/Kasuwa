/**
 * Authorization builder: constructs and signs a PaymentAuthorization.
 *
 * Offline-capable: no network calls. The caller provides the allowance snapshot
 * and the DeviceKey implementation.
 */
import { type PaymentRequest, type PaymentAuthorization, buildSigningMessage } from '@kasuwa/protocol';
import { type DeviceKeyInterface as DeviceKey } from '../../native/DeviceKey';
import { getConfig } from '../../config/env';

/** How long (seconds) an authorization is valid by default. */
export const DEFAULT_AUTH_TTL_SECONDS = 48 * 3600; // 48 hours

export interface BuildAuthOptions {
  request: PaymentRequest;
  allowanceId: bigint;
  deviceKey: DeviceKey;
  keyAlias: string;
  biometricPrompt: string;
  /** Optional override for expiry TTL in seconds. Defaults to DEFAULT_AUTH_TTL_SECONDS. */
  ttlSeconds?: number;
}

/**
 * Generates a cryptographically random 16-byte payment_id.
 */
function randomPaymentId(): Uint8Array {
  const buf = new Uint8Array(16);
  // globalThis.crypto is available in RN (Hermes) and Jest (Node 19+)
  (globalThis.crypto as Crypto).getRandomValues(buf);
  return buf;
}

/**
 * Builds and signs a PaymentAuthorization offline.
 *
 * Steps:
 *  1. Generate a random 16-byte payment_id.
 *  2. Set issuedAt = now (unix seconds), expiresAt = issuedAt + ttlSeconds.
 *  3. Build the canonical message and compute the SHA-256 digest.
 *  4. Sign the digest with the hardware-backed device key (biometric prompt).
 *  5. Return the complete PaymentAuthorization.
 *
 * This function does NOT update the spend counter — callers must do that.
 */
export async function buildAuthorization(
  opts: BuildAuthOptions,
): Promise<PaymentAuthorization> {
  const config = getConfig();

  // Pre-computed network_id from passphrase SHA-256
  const networkIdHex =
    process.env['EXPO_PUBLIC_NETWORK_ID_HEX'] ??
    'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472';
  const contractId =
    process.env['EXPO_PUBLIC_VAULT_CONTRACT_ID_HEX'] ??
    config.vaultContractId;

  const paymentId = randomPaymentId();
  const issuedAt = Math.floor(Date.now() / 1000);
  const ttl = opts.ttlSeconds ?? DEFAULT_AUTH_TTL_SECONDS;
  const expiresAt = issuedAt + ttl;

  const partialAuth = {
    version: 1 as const,
    allowanceId: opts.allowanceId,
    paymentId,
    merchant: opts.request.merchant,
    amount: opts.request.amount,
    issuedAt,
    expiresAt,
  };

  const ctx = {
    contractId: Buffer.from(contractId.replace(/^0x/, ''), 'hex'),
    networkId: Buffer.from(networkIdHex, 'hex'),
  };

  const digest = buildSigningMessage(partialAuth, ctx.contractId, ctx.networkId);

  const signature = await opts.deviceKey.sign(
    opts.keyAlias,
    digest,
    opts.biometricPrompt,
  );

  return { ...partialAuth, signature };
}
