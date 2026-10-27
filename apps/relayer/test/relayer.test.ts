/**
 * Tests for the relayer: API contract, pre-validation, idempotency, auth.
 *
 * Uses Fastify's inject() — no real server is started.
 */
import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import {
  encodePaymentAuthorization,
  type PaymentAuthorization,
} from '@kasuwa/protocol';
import { buildApp } from '../src/app.js';
import { _clearStore } from '../src/settlementStore.js';
import { _clearQueue } from '../src/queue.js';

// ─── Test helpers ─────────────────────────────────────────────────────────────

const TEST_API_KEY = 'test-key-abc123';

// Minimal valid PaymentAuthorization (not cryptographically valid — sig check
// is skipped in Commit 7 since devicePublicKeyHex = null in preValidate)
function makeAuthB64(overrides: Partial<PaymentAuthorization> = {}): string {
  const now = Math.floor(Date.now() / 1000);
  const auth: PaymentAuthorization = {
    version: 1,
    allowanceId: 42n,
    paymentId: new Uint8Array(16).fill(0xaa),
    merchant: new Uint8Array(32).fill(0x22),
    amount: 1_000_000n,
    issuedAt: now - 60,
    expiresAt: now + 3600,
    signature: new Uint8Array(64).fill(0x01), // not verified in Commit 7
    ...overrides,
  };
  const bytes = encodePaymentAuthorization(auth);
  return Buffer.from(bytes).toString('base64url');
}

// Minimal env for config
process.env['STELLAR_NETWORK_PASSPHRASE'] = 'Test SDF Network ; September 2015';
process.env['SOROBAN_RPC_URL'] = 'https://soroban-testnet.stellar.org';
process.env['VAULT_CONTRACT_ID'] = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
process.env['DATABASE_URL'] = 'postgresql://localhost:5432/kasuwa_test';
process.env['RELAYER_API_KEYS'] = TEST_API_KEY;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ NODE_ENV: 'test' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  _clearStore();
  _clearQueue();
});

// ─── Health routes ────────────────────────────────────────────────────────────

describe('GET /healthz', () => {
  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ok' });
  });
});

describe('GET /readyz', () => {
  it('returns 200 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ status: 'ready' });
  });
});

// ─── API-key authentication ───────────────────────────────────────────────────

describe('POST /v1/settlements — authentication', () => {
  it('returns 401 when no API key is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      payload: { authorizations: [makeAuthB64()] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when wrong API key is provided', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: 'Bearer wrong-key' },
      payload: { authorizations: [makeAuthB64()] },
    });
    expect(res.statusCode).toBe(401);
  });

  it('accepts valid API key in Authorization: Bearer header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [makeAuthB64()] },
    });
    expect(res.statusCode).toBe(202);
  });

  it('accepts valid API key in X-Api-Key header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { authorizations: [makeAuthB64()] },
    });
    expect(res.statusCode).toBe(202);
  });
});

// ─── POST /v1/settlements — happy path ───────────────────────────────────────

describe('POST /v1/settlements — happy path', () => {
  it('returns 202 with accepted result for valid authorization', async () => {
    const b64 = makeAuthB64();
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [b64] },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body) as { results: Array<{ paymentId: string; status: string }> };
    expect(body.results).toHaveLength(1);
    expect(body.results[0]!.status).toBe('accepted');
    expect(body.results[0]!.paymentId).toMatch(/^[0-9a-f]{32}$/);
  });

  it('returns immediately (non-blocking) — status is accepted, not settled', async () => {
    const b64 = makeAuthB64({ paymentId: new Uint8Array(16).fill(0x55) });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [b64] },
    });

    const body = JSON.parse(res.body) as { results: Array<{ status: string }> };
    expect(body.results[0]!.status).toBe('accepted'); // not 'settled'
  });

  it('handles a batch of multiple valid authorizations', async () => {
    const items = [
      makeAuthB64({ paymentId: new Uint8Array(16).fill(0x01) }),
      makeAuthB64({ paymentId: new Uint8Array(16).fill(0x02) }),
      makeAuthB64({ paymentId: new Uint8Array(16).fill(0x03) }),
    ];
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: items },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body) as { results: unknown[] };
    expect(body.results).toHaveLength(3);
  });
});

// ─── POST /v1/settlements — validation ───────────────────────────────────────

describe('POST /v1/settlements — pre-validation', () => {
  it('returns invalid for a malformed base64url payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: ['not-valid-base64url!!!'] },
    });

    const body = JSON.parse(res.body) as {
      results: Array<{ status: string; reason?: string }>;
    };
    expect(body.results[0]!.status).toBe('invalid');
    expect(body.results[0]!.reason).toBeDefined();
  });

  it('returns invalid for an expired authorization', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = makeAuthB64({
      paymentId: new Uint8Array(16).fill(0x77),
      issuedAt: now - 7200,
      expiresAt: now - 1, // already expired
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [expired] },
    });

    const body = JSON.parse(res.body) as {
      results: Array<{ status: string; reason?: string }>;
    };
    expect(body.results[0]!.status).toBe('invalid');
    expect(body.results[0]!.reason).toMatch(/expired/i);
  });

  it('returns 400 when batch exceeds MAX_BATCH_SIZE', async () => {
    const items = Array.from({ length: 51 }, (_, i) => {
      const pid = new Uint8Array(16);
      pid[0] = i;
      return makeAuthB64({ paymentId: pid });
    });

    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: items },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/batch too large/i);
  });

  it('returns 400 for empty authorizations array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [] },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 400 for missing authorizations field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { wrong_field: 'foo' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('mixed batch: valid items accepted, invalid items rejected independently', async () => {
    const items = [
      makeAuthB64({ paymentId: new Uint8Array(16).fill(0x11) }),
      'garbage-not-base64url',
    ];

    const res = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: items },
    });

    expect(res.statusCode).toBe(202);
    const body = JSON.parse(res.body) as {
      results: Array<{ status: string }>;
    };
    expect(body.results[0]!.status).toBe('accepted');
    expect(body.results[1]!.status).toBe('invalid');
  });
});

// ─── POST /v1/settlements — idempotency ──────────────────────────────────────

describe('POST /v1/settlements — idempotency', () => {
  it('duplicate submission returns accepted without double-queueing', async () => {
    const b64 = makeAuthB64({ paymentId: new Uint8Array(16).fill(0xcc) });

    const res1 = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [b64] },
    });
    const res2 = await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [b64] },
    });

    expect(res1.statusCode).toBe(202);
    expect(res2.statusCode).toBe(202);

    // Both return accepted
    const body1 = JSON.parse(res1.body) as { results: Array<{ status: string }> };
    const body2 = JSON.parse(res2.body) as { results: Array<{ status: string }> };
    expect(body1.results[0]!.status).toBe('accepted');
    expect(body2.results[0]!.status).toBe('accepted');

    // Only queued once
    const { _getQueuedJobs } = await import('../src/queue.js');
    expect(_getQueuedJobs()).toHaveLength(1);
  });
});

// ─── GET /v1/settlements/:paymentId ──────────────────────────────────────────

describe('GET /v1/settlements/:paymentId', () => {
  it('returns the settlement record after submission', async () => {
    const pid = new Uint8Array(16).fill(0xdd);
    const b64 = makeAuthB64({ paymentId: pid });
    const paymentIdHex = Buffer.from(pid).toString('hex');

    await app.inject({
      method: 'POST',
      url: '/v1/settlements',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
      payload: { authorizations: [b64] },
    });

    const res = await app.inject({
      method: 'GET',
      url: `/v1/settlements/${paymentIdHex}`,
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body) as { paymentId: string; status: string };
    expect(body.paymentId).toBe(paymentIdHex);
    expect(body.status).toBe('accepted');
  });

  it('returns 404 for unknown paymentId', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/settlements/deadbeefdeadbeefdeadbeefdeadbeef',
      headers: { authorization: `Bearer ${TEST_API_KEY}` },
    });

    expect(res.statusCode).toBe(404);
  });
});
