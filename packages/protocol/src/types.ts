/**
 * Current Kasuwa wire protocol version.
 */
export const PROTOCOL_VERSION = 1;

/**
 * Domain separation tag prepended to all signed PaymentAuth digests.
 */
export const DOMAIN_TAG = 'kasuwa-v1:payment-auth';

/**
 * Merchant-generated offline payment request (QR #1).
 */
export interface PaymentRequest {
  /** Protocol version byte (must be 1 for Protocol v1) */
  version: number;
  /** 32-byte raw recipient address (public key or contract address) */
  merchant: Uint8Array;
  /** Requested payment amount in token base units */
  amount: bigint;
  /** Registry index for token selection (0 = default USDC SAC) */
  tokenHint: number;
  /** 8-byte merchant invoice / random request reference */
  requestId: Uint8Array;
  /** Expiration timestamp in unix seconds (32-bit unsigned integer) */
  expiresAt: number;
}

/**
 * Canonical unsigned payment authorization payload.
 */
export interface PaymentAuth {
  /** Protocol version byte (must be 1) */
  version: number;
  /** 64-bit on-chain allowance identifier */
  allowanceId: bigint;
  /** 16-byte random unique payment identifier */
  paymentId: Uint8Array;
  /** 32-byte merchant recipient address */
  merchant: Uint8Array;
  /** Payment amount in token base units */
  amount: bigint;
  /** Timestamp when authorization was signed (unix seconds, 40-bit unsigned int) */
  issuedAt: number;
  /** Timestamp when authorization expires (unix seconds, 40-bit unsigned int) */
  expiresAt: number;
}

/**
 * Customer-generated offline payment authorization (QR #2).
 */
export interface PaymentAuthorization extends PaymentAuth {
  /** Raw 64-byte secp256r1 signature (r || s, normalized to low-S) */
  signature: Uint8Array;
}

/**
 * Verification context containing network and contract identifiers.
 */
export interface VerificationContext {
  /** 32-byte AllowanceVault contract ID (raw or hex string) */
  contractId: Uint8Array | string;
  /** 32-byte Stellar network ID (SHA-256 of network passphrase; raw or hex string) */
  networkId: Uint8Array | string;
}
