/**
 * DeviceKey: TypeScript interface for hardware-backed secp256r1 signing.
 *
 * iOS:     Secure Enclave P-256, non-exportable, biometric/passcode-gated.
 * Android: Keystore StrongBox (fall back to TEE) EC P-256, biometric-gated.
 *
 * The native layer returns DER-encoded signatures.
 * This module converts DER → raw r||s and normalizes to low-S using
 * @kasuwa/protocol before returning to callers.
 *
 * KEY INVALIDATION:
 *   Both platforms may invalidate a key if biometric enrollment changes
 *   (e.g., a new fingerprint is added). When a key is invalidated:
 *   - sign() will throw DeviceKeyError with code KEY_INVALIDATED.
 *   - The customer should be directed to create a new allowance.
 *   - The old allowance remains reclaimable after its settlement window.
 *   See: docs/manual-testing.md § Key Invalidation.
 *
 * SIGNING CONTRACT:
 *   sign() receives a precomputed 32-byte SHA-256 digest.
 *   - iOS SecKeyCreateSignature with kSecKeyAlgorithmECDSASignatureDigestX962SHA256
 *     signs the raw digest WITHOUT re-hashing (Apple docs: "The data to be signed
 *     is the digest ... not the message itself").
 *   - Android Signature("SHA256withECDSA") DOES hash internally; to sign a
 *     pre-hashed digest we use NONEwithECDSA instead.
 *   The native implementations must guarantee the signature covers exactly the
 *   32-byte digest passed in.
 */
export interface DeviceKey {
  /**
   * Generates (or retrieves if already exists) a hardware-backed P-256 key pair.
   *
   * @param alias     Stable key alias stored in Keystore / Secure Enclave.
   * @param opts.requireBiometric  Whether biometric authentication is required
   *                               before each use of the key.
   * @returns Uncompressed 65-byte secp256r1 public key (0x04 || X || Y).
   */
  generate(
    alias: string,
    opts: { requireBiometric: boolean },
  ): Promise<{ publicKey: Uint8Array }>;

  /**
   * Signs a 32-byte digest with the named hardware key.
   *
   * The returned signature is raw 64-byte r||s, normalized to low-S form.
   * DER conversion and low-S normalization happen in this layer using
   * @kasuwa/protocol's derToRaw + normalizeLowS.
   *
   * @param alias   Key alias (must already exist via generate()).
   * @param digest  Exactly 32 bytes — the precomputed SHA-256 digest.
   * @param prompt  Human-readable biometric prompt string shown to the user.
   * @returns 64-byte raw secp256r1 signature (r||s, low-S).
   */
  sign(
    alias: string,
    digest: Uint8Array,
    prompt: string,
  ): Promise<Uint8Array>;

  /**
   * Returns true if a key with the given alias exists in the key store.
   */
  exists(alias: string): Promise<boolean>;

  /**
   * Permanently deletes the key with the given alias from the key store.
   * This cannot be undone. The corresponding allowance becomes unreclaimable
   * by the normal signing path; the customer must wait for the reclaim window.
   */
  delete(alias: string): Promise<void>;
}

/** Error codes surfaced by the DeviceKey module. */
export enum DeviceKeyErrorCode {
  /** The requested key alias does not exist. */
  KEY_NOT_FOUND = 'KEY_NOT_FOUND',
  /** Biometric/passcode authentication failed or was cancelled. */
  AUTH_FAILED = 'AUTH_FAILED',
  /** The key was invalidated (biometric enrollment changed). */
  KEY_INVALIDATED = 'KEY_INVALIDATED',
  /** digest is not exactly 32 bytes. */
  INVALID_DIGEST = 'INVALID_DIGEST',
  /** Platform-level error (OS call failed). */
  PLATFORM_ERROR = 'PLATFORM_ERROR',
  /**
   * Attempted to use the hardware module in a context where it isn't
   * available (simulator / test). Use SoftwareDeviceKey instead.
   */
  HARDWARE_UNAVAILABLE = 'HARDWARE_UNAVAILABLE',
}

export class DeviceKeyError extends Error {
  public readonly code: DeviceKeyErrorCode;
  constructor(code: DeviceKeyErrorCode, message: string) {
    super(`[DeviceKeyError:${code}] ${message}`);
    this.name = 'DeviceKeyError';
    this.code = code;
    Object.setPrototypeOf(this, DeviceKeyError.prototype);
  }
}
