/**
 * Error codes thrown by the Kasuwa protocol encoder, decoder, and verifier.
 */
export enum ProtocolErrorCode {
  TRUNCATED = 'TRUNCATED',
  TRAILING_BYTES = 'TRAILING_BYTES',
  UNSUPPORTED_VERSION = 'UNSUPPORTED_VERSION',
  INVALID_LENGTH = 'INVALID_LENGTH',
  OVERSIZE_VARINT = 'OVERSIZE_VARINT',
  NON_CANONICAL_VARINT = 'NON_CANONICAL_VARINT',
  INVALID_SIGNATURE = 'INVALID_SIGNATURE',
  INVALID_DER = 'INVALID_DER',
  INVALID_KEY = 'INVALID_KEY',
  VALUE_OUT_OF_RANGE = 'VALUE_OUT_OF_RANGE',
}

/**
 * Custom error class for all protocol-level serialization, deserialization,
 * and verification failures.
 */
export class ProtocolError extends Error {
  public readonly code: ProtocolErrorCode;

  constructor(code: ProtocolErrorCode, message: string) {
    super(`[ProtocolError:${code}] ${message}`);
    this.name = 'ProtocolError';
    this.code = code;
    Object.setPrototypeOf(this, ProtocolError.prototype);
  }
}
