import { ProtocolError, ProtocolErrorCode } from './errors.js';
import {
  PaymentRequest,
  PaymentAuthorization,
  PaymentAuth,
  PROTOCOL_VERSION,
} from './types.js';
import { encodeVarint, decodeVarint, MAX_U64 } from './varint.js';

const MAX_U40 = 1099511627775; // 2^40 - 1

/**
 * Writes an unsigned 40-bit integer into a 5-byte big-endian buffer.
 */
function writeUInt40BE(value: number): Uint8Array {
  if (value < 0 || value > MAX_U40 || !Number.isInteger(value)) {
    throw new ProtocolError(
      ProtocolErrorCode.VALUE_OUT_OF_RANGE,
      `u40 value out of range [0, 2^40-1]: ${value}`,
    );
  }
  const buf = new Uint8Array(5);
  buf[0] = Math.floor(value / 0x100000000) & 0xff;
  buf[1] = (value >>> 24) & 0xff;
  buf[2] = (value >>> 16) & 0xff;
  buf[3] = (value >>> 8) & 0xff;
  buf[4] = value & 0xff;
  return buf;
}

/**
 * Reads an unsigned 40-bit integer from 5 big-endian bytes.
 */
function readUInt40BE(data: Uint8Array, offset: number): number {
  if (offset + 5 > data.length) {
    throw new ProtocolError(
      ProtocolErrorCode.TRUNCATED,
      `Cannot read u40 at offset ${offset}, buffer too short`,
    );
  }
  const high = data[offset]!;
  const b1 = data[offset + 1]!;
  const b2 = data[offset + 2]!;
  const b3 = data[offset + 3]!;
  const b4 = data[offset + 4]!;
  return high * 0x100000000 + ((b1 << 24) >>> 0) + (b2 << 16) + (b3 << 8) + b4;
}

/**
 * Encodes a PaymentRequest into binary wire format.
 *
 * @param req - PaymentRequest object.
 * @returns Serialized binary Uint8Array.
 */
export function encodePaymentRequest(req: PaymentRequest): Uint8Array {
  if (req.version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      ProtocolErrorCode.UNSUPPORTED_VERSION,
      `Unsupported version: ${req.version}`,
    );
  }
  if (req.merchant.length !== 32) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_LENGTH,
      `Merchant address must be 32 bytes, got ${req.merchant.length}`,
    );
  }
  if (req.requestId.length !== 8) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_LENGTH,
      `Request ID must be 8 bytes, got ${req.requestId.length}`,
    );
  }
  if (req.tokenHint < 0 || req.tokenHint > 255) {
    throw new ProtocolError(
      ProtocolErrorCode.VALUE_OUT_OF_RANGE,
      `Token hint must be u8, got ${req.tokenHint}`,
    );
  }
  if (req.expiresAt < 0 || req.expiresAt > 0xffffffff) {
    throw new ProtocolError(
      ProtocolErrorCode.VALUE_OUT_OF_RANGE,
      `expiresAt must be u32, got ${req.expiresAt}`,
    );
  }

  const amountVarint = encodeVarint(req.amount);
  const totalLen = 1 + 32 + amountVarint.length + 1 + 8 + 4;
  const out = new Uint8Array(totalLen);
  let offset = 0;

  out[offset++] = req.version;
  out.set(req.merchant, offset);
  offset += 32;

  out.set(amountVarint, offset);
  offset += amountVarint.length;

  out[offset++] = req.tokenHint & 0xff;

  out.set(req.requestId, offset);
  offset += 8;

  out[offset++] = (req.expiresAt >>> 24) & 0xff;
  out[offset++] = (req.expiresAt >>> 16) & 0xff;
  out[offset++] = (req.expiresAt >>> 8) & 0xff;
  out[offset++] = req.expiresAt & 0xff;

  return out;
}

/**
 * Decodes a binary wire payload into a PaymentRequest object.
 * Enforces strict parsing: rejects trailing bytes and non-canonical encodings.
 *
 * @param data - Serialized binary data.
 * @returns Deserialized PaymentRequest.
 */
export function decodePaymentRequest(data: Uint8Array): PaymentRequest {
  if (data.length < 47) {
    throw new ProtocolError(
      ProtocolErrorCode.TRUNCATED,
      `PaymentRequest payload too short: ${data.length} bytes (min 47)`,
    );
  }

  let offset = 0;
  const version = data[offset++]!;
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      ProtocolErrorCode.UNSUPPORTED_VERSION,
      `Unsupported protocol version: ${version}`,
    );
  }

  const merchant = data.slice(offset, offset + 32);
  offset += 32;

  const { value: amount, bytesRead: varintLen } = decodeVarint(data, offset);
  offset += varintLen;

  if (offset + 13 > data.length) {
    throw new ProtocolError(
      ProtocolErrorCode.TRUNCATED,
      'Unexpected end of data reading PaymentRequest tail fields',
    );
  }

  const tokenHint = data[offset++]!;
  const requestId = data.slice(offset, offset + 8);
  offset += 8;

  const expiresAt =
    ((data[offset]! << 24) >>> 0) +
    (data[offset + 1]! << 16) +
    (data[offset + 2]! << 8) +
    data[offset + 3]!;
  offset += 4;

  if (offset !== data.length) {
    throw new ProtocolError(
      ProtocolErrorCode.TRAILING_BYTES,
      `Trailing bytes in PaymentRequest: ${data.length - offset} excess bytes`,
    );
  }

  return {
    version,
    merchant,
    amount,
    tokenHint,
    requestId,
    expiresAt,
  };
}

/**
 * Serializes the canonical unsigned PaymentAuth fields for cryptographic hashing.
 *
 * canonical_bytes = version (1) || allowance_id (8 BE) || payment_id (16) ||
 *                   merchant (32) || amount (varint) || issued_at (5 BE) || expires_at (5 BE)
 *
 * @param auth - PaymentAuth or PaymentAuthorization struct.
 * @returns Canonical Uint8Array bytes.
 */
export function encodePaymentAuthCanonical(
  auth: PaymentAuth | PaymentAuthorization,
): Uint8Array {
  if (auth.version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      ProtocolErrorCode.UNSUPPORTED_VERSION,
      `Unsupported version: ${auth.version}`,
    );
  }
  if (auth.paymentId.length !== 16) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_LENGTH,
      `Payment ID must be 16 bytes, got ${auth.paymentId.length}`,
    );
  }
  if (auth.merchant.length !== 32) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_LENGTH,
      `Merchant address must be 32 bytes, got ${auth.merchant.length}`,
    );
  }
  if (auth.allowanceId < 0n || auth.allowanceId > MAX_U64) {
    throw new ProtocolError(
      ProtocolErrorCode.VALUE_OUT_OF_RANGE,
      `Allowance ID must be u64, got ${auth.allowanceId}`,
    );
  }

  const amountVarint = encodeVarint(auth.amount);
  const issuedAtBytes = writeUInt40BE(auth.issuedAt);
  const expiresAtBytes = writeUInt40BE(auth.expiresAt);

  const totalLen = 1 + 8 + 16 + 32 + amountVarint.length + 5 + 5;
  const out = new Uint8Array(totalLen);
  let offset = 0;

  out[offset++] = auth.version;

  // allowance_id (u64 BE)
  let a = auth.allowanceId;
  for (let i = 7; i >= 0; i--) {
    out[offset + i] = Number(a & 0xffn);
    a >>= 8n;
  }
  offset += 8;

  out.set(auth.paymentId, offset);
  offset += 16;

  out.set(auth.merchant, offset);
  offset += 32;

  out.set(amountVarint, offset);
  offset += amountVarint.length;

  out.set(issuedAtBytes, offset);
  offset += 5;

  out.set(expiresAtBytes, offset);
  offset += 5;

  return out;
}

/**
 * Encodes a complete PaymentAuthorization into binary wire format.
 *
 * @param auth - Complete PaymentAuthorization including signature.
 * @returns Serialized binary Uint8Array.
 */
export function encodePaymentAuthorization(
  auth: PaymentAuthorization,
): Uint8Array {
  if (auth.signature.length !== 64) {
    throw new ProtocolError(
      ProtocolErrorCode.INVALID_SIGNATURE,
      `Signature must be 64 bytes, got ${auth.signature.length}`,
    );
  }

  const canonical = encodePaymentAuthCanonical(auth);
  const out = new Uint8Array(canonical.length + 64);
  out.set(canonical, 0);
  out.set(auth.signature, canonical.length);
  return out;
}

/**
 * Decodes a binary wire payload into a PaymentAuthorization object.
 * Enforces strict parsing: rejects trailing bytes, truncated data, and non-canonical varints.
 *
 * @param data - Serialized binary data.
 * @returns Deserialized PaymentAuthorization.
 */
export function decodePaymentAuthorization(
  data: Uint8Array,
): PaymentAuthorization {
  if (data.length < 132) {
    throw new ProtocolError(
      ProtocolErrorCode.TRUNCATED,
      `PaymentAuthorization payload too short: ${data.length} bytes (min 132)`,
    );
  }

  let offset = 0;
  const version = data[offset++]!;
  if (version !== PROTOCOL_VERSION) {
    throw new ProtocolError(
      ProtocolErrorCode.UNSUPPORTED_VERSION,
      `Unsupported protocol version: ${version}`,
    );
  }

  // allowance_id (u64 BE)
  let allowanceId = 0n;
  for (let i = 0; i < 8; i++) {
    allowanceId = (allowanceId << 8n) | BigInt(data[offset++]!);
  }

  const paymentId = data.slice(offset, offset + 16);
  offset += 16;

  const merchant = data.slice(offset, offset + 32);
  offset += 32;

  const { value: amount, bytesRead: varintLen } = decodeVarint(data, offset);
  offset += varintLen;

  if (offset + 74 > data.length) {
    throw new ProtocolError(
      ProtocolErrorCode.TRUNCATED,
      'Unexpected end of data reading tail fields in PaymentAuthorization',
    );
  }

  const issuedAt = readUInt40BE(data, offset);
  offset += 5;

  const expiresAt = readUInt40BE(data, offset);
  offset += 5;

  const signature = data.slice(offset, offset + 64);
  offset += 64;

  if (offset !== data.length) {
    throw new ProtocolError(
      ProtocolErrorCode.TRAILING_BYTES,
      `Trailing bytes in PaymentAuthorization: ${data.length - offset} excess bytes`,
    );
  }

  return {
    version,
    allowanceId,
    paymentId,
    merchant,
    amount,
    issuedAt,
    expiresAt,
    signature,
  };
}
