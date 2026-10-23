/**
 * @packageDocumentation
 * Kasuwa Protocol package: serialization, codecs, cryptographic message construction,
 * signature normalization, and verification for offline-first Stellar Soroban payments.
 */

export {
  PROTOCOL_VERSION,
  DOMAIN_TAG,
  type PaymentRequest,
  type PaymentAuth,
  type PaymentAuthorization,
  type VerificationContext,
} from './types.js';

export {
  ProtocolErrorCode,
  ProtocolError,
} from './errors.js';

export {
  MAX_U64,
  encodeVarint,
  decodeVarint,
} from './varint.js';

export {
  encodePaymentRequest,
  decodePaymentRequest,
  encodePaymentAuthCanonical,
  encodePaymentAuthorization,
  decodePaymentAuthorization,
} from './codec.js';

export {
  SECP256R1_N,
  SECP256R1_HALF_N,
  buildSigningMessage,
  derToRaw,
  normalizeLowS,
  verifyAuthorization,
} from './crypto.js';
