import { ProtocolError, ProtocolErrorCode } from './errors.js';

/**
 * Maximum unsigned 64-bit integer supported for amounts.
 */
export const MAX_U64 = 18446744073709551615n;

/**
 * Encodes an unsigned integer into LEB128 varint bytes.
 *
 * @param value - Non-negative bigint to encode (0 <= value <= 2^64 - 1).
 * @returns Serialized Uint8Array (1 to 10 bytes).
 */
export function encodeVarint(value: bigint): Uint8Array {
  if (value < 0n || value > MAX_U64) {
    throw new ProtocolError(
      ProtocolErrorCode.VALUE_OUT_OF_RANGE,
      `Varint value out of range [0, 2^64-1]: ${value}`,
    );
  }

  const bytes: number[] = [];
  let current = value;
  while (current >= 0x80n) {
    bytes.push(Number(current & 0x7fn) | 0x80);
    current >>= 7n;
  }
  bytes.push(Number(current & 0x7fn));
  return new Uint8Array(bytes);
}

/**
 * Decodes an unsigned LEB128 varint from a byte slice.
 * Enforces canonical encoding (rejects non-terminal zero padding) and max width (10 bytes).
 *
 * @param data - Source byte buffer.
 * @param offset - Offset in data to begin reading varint.
 * @returns Decoded bigint value and total bytes read.
 */
export function decodeVarint(
  data: Uint8Array,
  offset: number,
): { value: bigint; bytesRead: number } {
  let result = 0n;
  let shift = 0n;
  let bytesRead = 0;

  while (true) {
    if (offset + bytesRead >= data.length) {
      throw new ProtocolError(
        ProtocolErrorCode.TRUNCATED,
        `Unexpected end of data reading varint at offset ${offset + bytesRead}`,
      );
    }

    const byte = data[offset + bytesRead]!;
    bytesRead++;

    if (bytesRead > 10) {
      throw new ProtocolError(
        ProtocolErrorCode.OVERSIZE_VARINT,
        'Varint exceeds maximum length of 10 bytes',
      );
    }

    const payload = BigInt(byte & 0x7f);
    result |= payload << shift;

    // Terminal byte check (MSB is 0)
    if ((byte & 0x80) === 0) {
      // Overlong encoding check: if multiple bytes were used and the last byte is 0,
      // the encoding is non-canonical.
      if (bytesRead > 1 && byte === 0) {
        throw new ProtocolError(
          ProtocolErrorCode.NON_CANONICAL_VARINT,
          'Non-canonical overlong varint encoding',
        );
      }
      break;
    }

    shift += 7n;
  }

  if (result > MAX_U64) {
    throw new ProtocolError(
      ProtocolErrorCode.VALUE_OUT_OF_RANGE,
      `Decoded varint exceeds 64-bit range: ${result}`,
    );
  }

  return { value: result, bytesRead };
}
