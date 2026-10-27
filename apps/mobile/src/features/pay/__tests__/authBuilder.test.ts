/**
 * Tests for buildAuthorization.
 *
 * Uses the SoftwareDeviceKey so we can run in Jest without native modules.
 */
import {
  decodePaymentAuthorization,
  encodePaymentAuthorization,
  verifyAuthorization,
  type PaymentRequest,
} from '@kasuwa/protocol';
import { SoftwareDeviceKey } from '../../../native/SoftwareDeviceKey';
import { buildAuthorization, DEFAULT_AUTH_TTL_SECONDS } from '../authBuilder';

const ALIAS = 'auth-builder-test-' + Date.now();

// Deterministic test context matching test-vectors
process.env['EXPO_PUBLIC_VAULT_CONTRACT_ID_HEX'] =
  '1111111111111111111111111111111111111111111111111111111111111111';
process.env['EXPO_PUBLIC_NETWORK_ID_HEX'] =
  'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472';

const MERCHANT = new Uint8Array(32).fill(0x22);
const REQUEST_ID = new Uint8Array(8).fill(0x01);

const TEST_REQUEST: PaymentRequest = {
  version: 1,
  merchant: MERCHANT,
  amount: 1_000_000n,
  tokenHint: 0,
  requestId: REQUEST_ID,
  expiresAt: Math.floor(Date.now() / 1000) + 600,
};

let publicKey: Uint8Array;

beforeAll(async () => {
  const { publicKey: pk } = await SoftwareDeviceKey.generate(ALIAS, { requireBiometric: false });
  publicKey = pk;
});

afterAll(async () => {
  await SoftwareDeviceKey.delete(ALIAS);
});

describe('buildAuthorization', () => {
  it('builds a PaymentAuthorization with correct fields', async () => {
    const auth = await buildAuthorization({
      request: TEST_REQUEST,
      allowanceId: 42n,
      deviceKey: SoftwareDeviceKey,
      keyAlias: ALIAS,
      biometricPrompt: 'Authorize test payment',
    });

    expect(auth.version).toBe(1);
    expect(auth.allowanceId).toBe(42n);
    expect(auth.merchant).toEqual(MERCHANT);
    expect(auth.amount).toBe(1_000_000n);
    expect(auth.paymentId.length).toBe(16);
    expect(auth.signature.length).toBe(64);
    expect(auth.expiresAt - auth.issuedAt).toBeGreaterThanOrEqual(DEFAULT_AUTH_TTL_SECONDS - 2);
  });

  it('produces a QR-encodable binary that decodes back correctly', async () => {
    const auth = await buildAuthorization({
      request: TEST_REQUEST,
      allowanceId: 7n,
      deviceKey: SoftwareDeviceKey,
      keyAlias: ALIAS,
      biometricPrompt: 'Test',
    });

    const encoded = encodePaymentAuthorization(auth);
    const decoded = decodePaymentAuthorization(encoded);

    expect(decoded.allowanceId).toBe(auth.allowanceId);
    expect(decoded.amount).toBe(auth.amount);
    expect(Buffer.from(decoded.merchant).toString('hex')).toBe(
      Buffer.from(auth.merchant).toString('hex'),
    );
    expect(Buffer.from(decoded.signature).toString('hex')).toBe(
      Buffer.from(auth.signature).toString('hex'),
    );
  });

  it('produces a signature that verifies with verifyAuthorization', async () => {
    const auth = await buildAuthorization({
      request: TEST_REQUEST,
      allowanceId: 99n,
      deviceKey: SoftwareDeviceKey,
      keyAlias: ALIAS,
      biometricPrompt: 'Test',
    });

    const valid = verifyAuthorization(auth, publicKey, {
      contractId: Buffer.from('1111111111111111111111111111111111111111111111111111111111111111', 'hex'),
      networkId: Buffer.from('cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472', 'hex'),
    });

    expect(valid).toBe(true);
  });

  it('uses different payment_id for each invocation', async () => {
    const auth1 = await buildAuthorization({
      request: TEST_REQUEST,
      allowanceId: 1n,
      deviceKey: SoftwareDeviceKey,
      keyAlias: ALIAS,
      biometricPrompt: 'Test',
    });
    const auth2 = await buildAuthorization({
      request: TEST_REQUEST,
      allowanceId: 1n,
      deviceKey: SoftwareDeviceKey,
      keyAlias: ALIAS,
      biometricPrompt: 'Test',
    });

    expect(Buffer.from(auth1.paymentId).toString('hex')).not.toBe(
      Buffer.from(auth2.paymentId).toString('hex'),
    );
  });

  it('respects custom ttlSeconds', async () => {
    const ttl = 3600;
    const auth = await buildAuthorization({
      request: TEST_REQUEST,
      allowanceId: 1n,
      deviceKey: SoftwareDeviceKey,
      keyAlias: ALIAS,
      biometricPrompt: 'Test',
      ttlSeconds: ttl,
    });

    const actualTtl = auth.expiresAt - auth.issuedAt;
    expect(actualTtl).toBeGreaterThanOrEqual(ttl - 2);
    expect(actualTtl).toBeLessThanOrEqual(ttl + 2);
  });
});
