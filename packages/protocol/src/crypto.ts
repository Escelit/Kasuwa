import crypto from 'node:crypto';
import { ProtocolError, ProtocolErrorCode } from './errors.js';
import { PaymentAuth, PaymentAuthorization, DOMAIN_TAG } from './types.js';
import { encodePaymentAuthCanonical } from './codec.js';

/**
 * secp256r1 (NIST P-256) curve order n.
 */
export const SECP256R1_N =
  0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551n;

/**
 * Half curve order floor(n / 2) for low-S normalization.
 */
export const SECP256R1_HALF_N = SECP256R1_N >> 1n;

/**
 * Standard SPKI header for uncompressed secp256r1 / prime256v1 public keys (26 bytes).
 */
const SPKI_P256_HEADER = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex',
);

/**
 * Converts a Uint8Array or hex string into a Buffer, with optional length validation.
 */
function toBuffer(val: Uint8Array | string, name: string, expectedLen?: number): Buffer {
  let buf: Buffer;
  if (typeof val === 'string') {
    const clean = val.startsWith('0x') ? val.slice(2) : val;
    buf = Buffer.from(clean, 'hex');
  } else if (val instanceof Uint8Array) {
    buf = Buffer.from(val.buffer, val.byteOffset, val.byteLength);
  } else {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_LENGTH,
      `Expected Uint8Array or hex string for ${name}`,
    );
  }

  if (expectedLen !== undefined && buf.length !== expectedLen) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_LENGTH,
      `${name} must be exactly ${expectedLen} bytes, got ${buf.length}`,
    );
  }
  return buf;
}

/**
 * Builds the 32-byte domain-separated SHA-256 digest to be signed by the customer key.
 *
 * digest = SHA-256(domain_tag || canonical_bytes(PaymentAuth) || contract_id || network_id)
 *
 * @param auth - Unsigned PaymentAuth or complete PaymentAuthorization.
 * @param contractId - 32-byte AllowanceVault contract ID.
 * @param networkId - 32-byte Stellar network identifier (SHA-256 of network passphrase).
 * @returns 32-byte SHA-256 digest Uint8Array.
 */
export function buildSigningMessage(
  auth: PaymentAuth | PaymentAuthorization,
  contractId: Uint8Array | string,
  networkId: Uint8Array | string,
): Uint8Array {
  const contractIdBuf = toBuffer(contractId, 'contractId', 32);
  const networkIdBuf = toBuffer(networkId, 'networkId', 32);

  const canonicalBytes = encodePaymentAuthCanonical(auth);
  const domainTagBuf = Buffer.from(DOMAIN_TAG, 'utf8');

  const hasher = crypto.createHash('sha256');
  hasher.update(domainTagBuf);
  hasher.update(canonicalBytes);
  hasher.update(contractIdBuf);
  hasher.update(networkIdBuf);

  return new Uint8Array(hasher.digest());
}

/**
 * Converts an ASN.1 DER-encoded ECDSA signature to raw 64-byte r || s format.
 *
 * @param derSig - DER-encoded signature bytes.
 * @returns 64-byte raw signature Uint8Array (r[32] || s[32]).
 */
export function derToRaw(derSig: Uint8Array): Uint8Array {
  if (derSig.length < 8) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_DER,
      `DER signature too short: ${derSig.length} bytes`,
    );
  }

  if (derSig[0] !== 0x30) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_DER,
      `Expected sequence tag 0x30, got 0x${derSig[0]?.toString(16)}`,
    );
  }

  let idx = 1;
  let seqLen = derSig[idx++]!;
  if (seqLen & 0x80) {
    const lenBytes = seqLen & 0x7f;
    seqLen = 0;
    for (let i = 0; i < lenBytes; i++) {
      seqLen = (seqLen << 8) | derSig[idx++]!;
    }
  }

  if (derSig[idx++] !== 0x02) {
    throw new ProtocolError(ProtocolErrorCode.INVALID_DER, 'Expected integer tag 0x02 for r');
  }
  const rLen = derSig[idx++]!;
  let rBytes = derSig.subarray(idx, idx + rLen);
  idx += rLen;

  if (derSig[idx++] !== 0x02) {
    throw new ProtocolError(ProtocolErrorCode.INVALID_DER, 'Expected integer tag 0x02 for s');
  }
  const sLen = derSig[idx++]!;
  let sBytes = derSig.subarray(idx, idx + sLen);
  idx += sLen;

  // Strip leading 0x00 padding if present (used in ASN.1 to indicate positive numbers)
  while (rBytes.length > 32 && rBytes[0] === 0x00) {
    rBytes = rBytes.subarray(1);
  }
  while (sBytes.length > 32 && sBytes[0] === 0x00) {
    sBytes = sBytes.subarray(1);
  }

  if (rBytes.length > 32) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_DER,
      `r component exceeds 32 bytes: ${rBytes.length}`,
    );
  }
  if (sBytes.length > 32) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_DER,
      `s component exceeds 32 bytes: ${sBytes.length}`,
    );
  }

  const raw = new Uint8Array(64);
  raw.set(rBytes, 32 - rBytes.length);
  raw.set(sBytes, 64 - sBytes.length);

  return raw;
}

/**
 * Normalizes an ECDSA secp256r1 signature to low-S form:
 * if s > n / 2, replace s with n - s.
 *
 * @param sig - 64-byte raw signature (r[32] || s[32]).
 * @returns 64-byte low-S normalized signature Uint8Array.
 */
export function normalizeLowS(sig: Uint8Array): Uint8Array {
  if (sig.length !== 64) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_SIGNATURE,
      `Signature must be 64 bytes, got ${sig.length}`,
    );
  }

  const sHex = Buffer.from(sig.subarray(32, 64)).toString('hex');
  const s = BigInt(`0x${sHex}`);

  if (s === 0n || s >= SECP256R1_N) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_SIGNATURE,
      `Invalid s scalar in signature: ${sHex}`,
    );
  }

  if (s > SECP256R1_HALF_N) {
    const sLow = SECP256R1_N - s;
    const sLowHex = sLow.toString(16).padStart(64, '0');
    const sLowBuf = Buffer.from(sLowHex, 'hex');

    const normalized = new Uint8Array(64);
    normalized.set(sig.subarray(0, 32), 0);
    normalized.set(sLowBuf, 32);
    return normalized;
  }

  return new Uint8Array(sig);
}

/**
 * Verifies a PaymentAuthorization signature offline using secp256r1.
 *
 * @param auth - Complete PaymentAuthorization including signature.
 * @param pubkey - 65-byte uncompressed (0x04 || X || Y) or 64-byte raw (X || Y) public key.
 * @param ctx - Verification context with contractId and networkId.
 * @returns boolean indicating whether signature is valid.
 */
export function verifyAuthorization(
  auth: PaymentAuthorization,
  pubkey: Uint8Array | string,
  ctx: { contractId: Uint8Array | string; networkId: Uint8Array | string },
): boolean {
  try {
    const pubBuf = toBuffer(pubkey, 'pubkey');
    let uncompressed: Buffer;

    if (pubBuf.length === 65 && pubBuf[0] === 0x04) {
      uncompressed = pubBuf;
    } else if (pubBuf.length === 64) {
      uncompressed = Buffer.concat([Buffer.from([0x04]), pubBuf]);
    } else {
      throw new ProtocolError(
        ProtocolErrorCode.INVALID_KEY,
        `Expected 65-byte uncompressed or 64-byte raw public key, got ${pubBuf.length} bytes`,
      );
    }

    const spkiBuf = Buffer.concat([SPKI_P256_HEADER, uncompressed]);
    const keyObject = crypto.createPublicKey({
      key: spkiBuf,
      format: 'der',
      type: 'spki',
    });

    const digest = buildSigningMessage(auth, ctx.contractId, ctx.networkId);
    const lowSSig = normalizeLowS(auth.signature);

    return crypto.verify(
      'SHA256',
      digest,
      {
        key: keyObject,
        dsaEncoding: 'ieee-p1363',
      },
      lowSSig,
    );
  } catch (err) {
    if (err instanceof ProtocolError) {
      throw err;
    }
    return false;
  }
}
