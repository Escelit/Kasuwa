/**
 * Tests for the offline verification logic.
 *
 * Each check has at least one passing and one failing test.
 * Tampered QR payloads are rejected.
 */
import {
  verifyOffline,
  type OfflineVerifyOptions,
} from '../verifyOffline';
import {
  buildSigningMessage,
  type PaymentAuthorization,
  type PaymentRequest,
} from '@kasuwa/protocol';
import { SoftwareDeviceKey } from '../../../native/SoftwareDeviceKey';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const CONTRACT_ID = Buffer.from(
  '1111111111111111111111111111111111111111111111111111111111111111',
  'hex',
);
const NETWORK_ID = Buffer.from(
  'cee0302d59844d32bdca915c8203dd44b33fbb7edc19051ea37abedf28ecd472',
  'hex',
);
const CTX = { contractId: CONTRACT_ID, networkId: NETWORK_ID };

const MERCHANT_ADDR = new Uint8Array(32).fill(0x22);
const OTHER_MERCHANT = new Uint8Array(32).fill(0x33);
const ALIAS = 'verify-offline-test-' + Date.now();

const NOW = 1_700_000_000;

let publicKey: Uint8Array;
let validAuth: PaymentAuthorization;
const validRequest: PaymentRequest = {
  version: 1,
  merchant: MERCHANT_ADDR,
  amount: 1_000_000n,
  tokenHint: 0,
  requestId: new Uint8Array(8).fill(0x01),
  expiresAt: NOW + 600,
};

beforeAll(async () => {
  const { publicKey: pk } = await SoftwareDeviceKey.generate(ALIAS, { requireBiometric: false });
  publicKey = pk;

  const partialAuth = {
    version: 1 as const,
    allowanceId: 42n,
    paymentId: new Uint8Array(16).fill(0xaa),
    merchant: MERCHANT_ADDR,
    amount: 1_000_000n,
    issuedAt: NOW - 60,
    expiresAt: NOW + 3600,
  };

  const digest = buildSigningMessage(partialAuth, CONTRACT_ID, NETWORK_ID);
  const signature = await SoftwareDeviceKey.sign(ALIAS, digest, 'Test');
  validAuth = { ...partialAuth, signature };
});

afterAll(async () => {
  await SoftwareDeviceKey.delete(ALIAS);
});

function baseOpts(overrides: Partial<OfflineVerifyOptions> = {}): OfflineVerifyOptions {
  return {
    auth: validAuth,
    request: validRequest,
    devicePublicKey: publicKey,
    merchantAddress: MERCHANT_ADDR,
    outboxPaymentIds: new Set(),
    ctx: CTX,
    nowSeconds: NOW,
    ...overrides,
  };
}

// ─── Full happy path ──────────────────────────────────────────────────────────

describe('verifyOffline — happy path', () => {
  it('all checks pass for a valid authorization', () => {
    const result = verifyOffline(baseOpts());
    expect(result.allPassed).toBe(true);
    for (const check of result.checks) {
      expect(check.status).toBe('pass');
    }
  });
});

// ─── Check 1: Signature ───────────────────────────────────────────────────────

describe('Check 1: signature', () => {
  it('passes for correct signature + correct public key', () => {
    const result = verifyOffline(baseOpts());
    const sigCheck = result.checks.find((c) => c.id === 'signature')!;
    expect(sigCheck.status).toBe('pass');
  });

  it('fails for wrong public key', async () => {
    const { publicKey: wrongKey } = await SoftwareDeviceKey.generate(ALIAS + '-w2', {
      requireBiometric: false,
    });
    await SoftwareDeviceKey.delete(ALIAS + '-w2');

    const result = verifyOffline(baseOpts({ devicePublicKey: wrongKey }));
    const sigCheck = result.checks.find((c) => c.id === 'signature')!;
    expect(sigCheck.status).toBe('fail');
    expect(result.allPassed).toBe(false);
  });

  it('returns unknown when devicePublicKey is null (allowance unknown)', () => {
    const result = verifyOffline(baseOpts({ devicePublicKey: null }));
    const sigCheck = result.checks.find((c) => c.id === 'signature')!;
    expect(sigCheck.status).toBe('unknown');
    expect(result.allPassed).toBe(false);
  });

  it('fails when signature bytes are tampered', () => {
    const tamperedSig = new Uint8Array(validAuth.signature);
    tamperedSig[0] ^= 0xff; // flip bits
    const tamperedAuth: PaymentAuthorization = { ...validAuth, signature: tamperedSig };
    const result = verifyOffline(baseOpts({ auth: tamperedAuth }));
    const sigCheck = result.checks.find((c) => c.id === 'signature')!;
    expect(sigCheck.status).toBe('fail');
  });
});

// ─── Check 2: Merchant match ─────────────────────────────────────────────────

describe('Check 2: merchant_match', () => {
  it('passes when auth.merchant === merchantAddress', () => {
    const result = verifyOffline(baseOpts());
    const check = result.checks.find((c) => c.id === 'merchant_match')!;
    expect(check.status).toBe('pass');
  });

  it('fails when auth.merchant differs from merchantAddress', async () => {
    // Build an auth addressed to OTHER_MERCHANT
    const partialAuth = {
      version: 1 as const,
      allowanceId: 1n,
      paymentId: new Uint8Array(16).fill(0xbb),
      merchant: OTHER_MERCHANT,
      amount: 1_000_000n,
      issuedAt: NOW - 60,
      expiresAt: NOW + 3600,
    };
    const digest = buildSigningMessage(partialAuth, CONTRACT_ID, NETWORK_ID);
    const sig = await SoftwareDeviceKey.sign(ALIAS, digest, 'Test');
    const wrongMerchantAuth: PaymentAuthorization = { ...partialAuth, signature: sig };

    const result = verifyOffline(
      baseOpts({ auth: wrongMerchantAuth, merchantAddress: MERCHANT_ADDR }),
    );
    const check = result.checks.find((c) => c.id === 'merchant_match')!;
    expect(check.status).toBe('fail');
    expect(result.allPassed).toBe(false);
  });
});

// ─── Check 3: Amount match ────────────────────────────────────────────────────

describe('Check 3: amount_match', () => {
  it('passes when amounts match', () => {
    const result = verifyOffline(baseOpts());
    const check = result.checks.find((c) => c.id === 'amount_match')!;
    expect(check.status).toBe('pass');
  });

  it('fails when auth.amount != request.amount', async () => {
    // Different amount in the auth
    const partialAuth = {
      version: 1 as const,
      allowanceId: 1n,
      paymentId: new Uint8Array(16).fill(0xcc),
      merchant: MERCHANT_ADDR,
      amount: 999_999n, // different from request 1_000_000n
      issuedAt: NOW - 60,
      expiresAt: NOW + 3600,
    };
    const digest = buildSigningMessage(partialAuth, CONTRACT_ID, NETWORK_ID);
    const sig = await SoftwareDeviceKey.sign(ALIAS, digest, 'Test');
    const wrongAmtAuth: PaymentAuthorization = { ...partialAuth, signature: sig };

    const result = verifyOffline(baseOpts({ auth: wrongAmtAuth }));
    const check = result.checks.find((c) => c.id === 'amount_match')!;
    expect(check.status).toBe('fail');
  });
});

// ─── Check 4: Expiry ──────────────────────────────────────────────────────────

describe('Check 4: not_expired', () => {
  it('passes when expiresAt is in the future', () => {
    const result = verifyOffline(baseOpts());
    const check = result.checks.find((c) => c.id === 'not_expired')!;
    expect(check.status).toBe('pass');
  });

  it('fails when expiresAt is in the past', async () => {
    const expiredAuth: PaymentAuthorization = {
      ...validAuth,
      expiresAt: NOW - 1, // already expired
    };
    const result = verifyOffline(baseOpts({ auth: expiredAuth }));
    const check = result.checks.find((c) => c.id === 'not_expired')!;
    expect(check.status).toBe('fail');
    expect(result.allPassed).toBe(false);
  });

  it('fails when expiresAt == nowSeconds', async () => {
    const expiredAuth: PaymentAuthorization = { ...validAuth, expiresAt: NOW };
    const result = verifyOffline(baseOpts({ auth: expiredAuth }));
    const check = result.checks.find((c) => c.id === 'not_expired')!;
    expect(check.status).toBe('fail');
  });
});

// ─── Check 5: Replay ──────────────────────────────────────────────────────────

describe('Check 5: no_replay', () => {
  it('passes when payment_id is not in outbox', () => {
    const result = verifyOffline(baseOpts({ outboxPaymentIds: new Set() }));
    const check = result.checks.find((c) => c.id === 'no_replay')!;
    expect(check.status).toBe('pass');
  });

  it('fails when payment_id is already in outbox', () => {
    const paymentIdHex = Buffer.from(validAuth.paymentId).toString('hex');
    const result = verifyOffline(
      baseOpts({ outboxPaymentIds: new Set([paymentIdHex]) }),
    );
    const check = result.checks.find((c) => c.id === 'no_replay')!;
    expect(check.status).toBe('fail');
    expect(result.allPassed).toBe(false);
  });
});

// ─── Tampered QR ──────────────────────────────────────────────────────────────

describe('tampered QR payloads are rejected', () => {
  it('amount tampering fails signature check', () => {
    const tampered: PaymentAuthorization = { ...validAuth, amount: 99_999_999n };
    const result = verifyOffline(baseOpts({ auth: tampered }));
    // Signature fails because amount is inside the signed message
    const sigCheck = result.checks.find((c) => c.id === 'signature')!;
    expect(sigCheck.status).toBe('fail');
  });

  it('merchant tampering fails both signature and merchant_match', () => {
    const tampered: PaymentAuthorization = { ...validAuth, merchant: OTHER_MERCHANT };
    const result = verifyOffline(baseOpts({ auth: tampered }));
    expect(result.allPassed).toBe(false);
    const sigCheck = result.checks.find((c) => c.id === 'signature')!;
    const merchantCheck = result.checks.find((c) => c.id === 'merchant_match')!;
    expect(sigCheck.status).toBe('fail');
    expect(merchantCheck.status).toBe('fail');
  });
});
