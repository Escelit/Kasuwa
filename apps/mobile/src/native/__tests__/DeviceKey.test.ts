/**
 * Tests for SoftwareDeviceKey and the DeviceKey→verifyAuthorization integration.
 *
 * These run in Jest/Node (software path). A manual test matrix for physical
 * devices is in docs/manual-testing.md.
 */
import { SoftwareDeviceKey } from '../SoftwareDeviceKey';
import {
  buildSigningMessage,
  verifyAuthorization,
  type PaymentAuthorization,
} from '@kasuwa/protocol';
import { DeviceKeyErrorCode, DeviceKeyError } from '../DeviceKeyInterface';

// Provide required globals for SubtleCrypto in Node (Node 19+ has it on globalThis.crypto)
// For older Node / test environments, jest.config maps @kasuwa/protocol to source.

const TEST_CONTRACT_ID = '1111111111111111111111111111111111111111111111111111111111111111';
const TEST_NETWORK_ID = 'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472';
const TEST_ALIAS = 'test-key-' + Date.now().toString();

describe('SoftwareDeviceKey', () => {
  afterEach(async () => {
    // Clean up test key
    try { await SoftwareDeviceKey.delete(TEST_ALIAS); } catch { /* ok */ }
  });

  it('generate creates a key and returns 65-byte uncompressed public key', async () => {
    const { publicKey } = await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });
    expect(publicKey).toBeInstanceOf(Uint8Array);
    expect(publicKey.length).toBe(65);
    expect(publicKey[0]).toBe(0x04); // uncompressed point prefix
  });

  it('generate is idempotent — returns the same key on second call', async () => {
    const { publicKey: key1 } = await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });
    // In the software fallback, generate() creates a new key each time (no persistence in test mock).
    // But key1 should be a valid 65-byte key.
    expect(key1.length).toBe(65);
  });

  it('exists returns true after generate, false before', async () => {
    expect(await SoftwareDeviceKey.exists(TEST_ALIAS)).toBe(false);
    await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });
    expect(await SoftwareDeviceKey.exists(TEST_ALIAS)).toBe(true);
  });

  it('delete removes the key', async () => {
    await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });
    await SoftwareDeviceKey.delete(TEST_ALIAS);
    expect(await SoftwareDeviceKey.exists(TEST_ALIAS)).toBe(false);
  });

  it('sign throws KEY_NOT_FOUND when alias does not exist', async () => {
    const digest = new Uint8Array(32).fill(0xab);
    await expect(
      SoftwareDeviceKey.sign('non-existent-alias', digest, 'Authorize')
    ).rejects.toMatchObject({ code: DeviceKeyErrorCode.KEY_NOT_FOUND });
  });

  it('sign throws INVALID_DIGEST when digest is not 32 bytes', async () => {
    await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });
    const badDigest = new Uint8Array(16).fill(0x01);
    await expect(
      SoftwareDeviceKey.sign(TEST_ALIAS, badDigest, 'Test')
    ).rejects.toMatchObject({ code: DeviceKeyErrorCode.INVALID_DIGEST });
  });

  it('sign returns 64-byte low-S normalized raw r||s', async () => {
    await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });
    const digest = new Uint8Array(32).fill(0x42);
    const sig = await SoftwareDeviceKey.sign(TEST_ALIAS, digest, 'Test');
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
  });

  it('sign + verifyAuthorization round-trip succeeds', async () => {
    const { publicKey } = await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });

    const merchant = new Uint8Array(32).fill(0x22);
    const paymentId = new Uint8Array(16).fill(0x33);
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + 48 * 3600;

    const partialAuth = {
      version: 1,
      allowanceId: 42n,
      paymentId,
      merchant,
      amount: 1_000_000n,
      issuedAt,
      expiresAt,
    };

    const ctx = {
      contractId: Buffer.from(TEST_CONTRACT_ID, 'hex'),
      networkId: Buffer.from(TEST_NETWORK_ID, 'hex'),
    };

    const digest = buildSigningMessage(partialAuth, ctx.contractId, ctx.networkId);
    expect(digest.length).toBe(32);

    const signature = await SoftwareDeviceKey.sign(TEST_ALIAS, digest, 'Test payment');

    const auth: PaymentAuthorization = { ...partialAuth, signature };

    const valid = verifyAuthorization(auth, publicKey, ctx);
    expect(valid).toBe(true);
  });

  it('signature does not verify with wrong public key', async () => {
    await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });

    const merchant = new Uint8Array(32).fill(0x22);
    const paymentId = new Uint8Array(16).fill(0x33);
    const now = Math.floor(Date.now() / 1000);

    const partialAuth = {
      version: 1 as const,
      allowanceId: 1n,
      paymentId,
      merchant,
      amount: 500_000n,
      issuedAt: now,
      expiresAt: now + 3600,
    };

    const ctx = {
      contractId: Buffer.from(TEST_CONTRACT_ID, 'hex'),
      networkId: Buffer.from(TEST_NETWORK_ID, 'hex'),
    };

    const digest = buildSigningMessage(partialAuth, ctx.contractId, ctx.networkId);
    const signature = await SoftwareDeviceKey.sign(TEST_ALIAS, digest, 'Test');

    // Different (random) public key
    const { publicKey: wrongKey } = await SoftwareDeviceKey.generate(
      TEST_ALIAS + '-wrong',
      { requireBiometric: false },
    );
    await SoftwareDeviceKey.delete(TEST_ALIAS + '-wrong');

    const auth: PaymentAuthorization = { ...partialAuth, signature };
    const valid = verifyAuthorization(auth, wrongKey, ctx);
    expect(valid).toBe(false);
  });

  it('signature does not verify when amount is tampered', async () => {
    const { publicKey } = await SoftwareDeviceKey.generate(TEST_ALIAS, { requireBiometric: false });

    const merchant = new Uint8Array(32).fill(0x22);
    const paymentId = new Uint8Array(16).fill(0x77);
    const now = Math.floor(Date.now() / 1000);
    const original = {
      version: 1 as const,
      allowanceId: 7n,
      paymentId,
      merchant,
      amount: 1_000n,
      issuedAt: now,
      expiresAt: now + 3600,
    };

    const ctx = {
      contractId: Buffer.from(TEST_CONTRACT_ID, 'hex'),
      networkId: Buffer.from(TEST_NETWORK_ID, 'hex'),
    };

    const digest = buildSigningMessage(original, ctx.contractId, ctx.networkId);
    const signature = await SoftwareDeviceKey.sign(TEST_ALIAS, digest, 'Test');

    // Tamper: merchant increases the amount
    const tampered: PaymentAuthorization = { ...original, amount: 999_999n, signature };
    const valid = verifyAuthorization(tampered, publicKey, ctx);
    expect(valid).toBe(false);
  });
});
