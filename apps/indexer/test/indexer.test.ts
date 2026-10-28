import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKasuwaDb } from '@kasuwa/db';
import { IngestionService, IngestionEvent, SorobanRpcEventStreamer } from '../src/ingestion.js';
import { buildIndexerApp } from '../src/app.js';
import { computeBalanceBucket } from '../src/bucketing.js';
import { FastifyInstance } from 'fastify';

// Mock recorded event fixtures
const RECORDED_FIXTURE_EVENTS: IngestionEvent[] = [
  {
    id: 'evt-1',
    ledger: 1001,
    ledgerClosedAt: 1700000000,
    contractId: 'CVAULT123',
    eventType: 'created',
    allowanceId: '10',
    data: {
      owner: 'GOWNER111',
      token: 'USDC',
      deviceKeyHex: '04' + '11'.repeat(64),
      amount: '40000000', // 40 USDC (Bucket: 10-50)
      perPaymentCap: '10000000',
      validUntil: 1700600000,
    },
  },
  {
    id: 'evt-2',
    ledger: 1002,
    ledgerClosedAt: 1700000010,
    contractId: 'CVAULT123',
    eventType: 'settle',
    allowanceId: '10',
    paymentId: 'pay-abc-1',
    data: {
      merchant: 'GMERCHANT_AAA',
      amount: '35000000', // 35 USDC spent -> leaves 5 USDC (Bucket: 1-10)
      paid: '35000000',
      settleResult: 'Settled',
    },
  },
];

describe('apps/indexer - Event Ingestion & Restart-Safety', () => {
  let db: InMemoryKasuwaDb;
  let service: IngestionService;

  beforeEach(() => {
    db = new InMemoryKasuwaDb();
    service = new IngestionService({
      db,
      config: {
        NODE_ENV: 'test',
        PORT: 3002,
        HOST: '0.0.0.0',
        STELLAR_NETWORK: 'testnet',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
        VAULT_CONTRACT_ID: 'CVAULT123',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        CONFIRMATION_DEPTH: 1,
      },
    });
  });

  it('ingests events from a recorded fixture and updates allowance balance and settlement tables', async () => {
    await service.ingestEvents(RECORDED_FIXTURE_EVENTS, 'cursor-chk-1');

    // 1. Allowance table updated
    const allowance = await db.allowances.get('10');
    expect(allowance).not.toBeNull();
    expect(allowance?.owner).toBe('GOWNER111');
    expect(allowance?.balance).toBe('5000000'); // 40 - 35 = 5 USDC
    expect(computeBalanceBucket(allowance?.balance!)).toBe('1-10');

    // 2. Settlement table updated
    const settlement = await db.settlements.get('pay-abc-1');
    expect(settlement).not.toBeNull();
    expect(settlement?.status).toBe('settled');
    expect(settlement?.paid).toBe('35000000');
    expect(settlement?.merchant).toBe('GMERCHANT_AAA');

    // 3. Cursor updated
    const cursor = await db.cursor.get();
    expect(cursor?.lastLedger).toBe(1002);
    expect(cursor?.lastCursor).toBe('cursor-chk-1');
  });

  it('handles restart mid-stream idempotently without losing state or skipping events', async () => {
    // Process step 1
    await service.ingestEvents([RECORDED_FIXTURE_EVENTS[0]!], 'cursor-part-1');
    let cursor = await db.cursor.get();
    expect(cursor?.lastLedger).toBe(1001);

    // Simulate service restart: restart with mock streamer
    const streamer: SorobanRpcEventStreamer = {
      getLatestLedger: async () => 1005,
      fetchEvents: async (startLedger, resumeCursor) => {
        expect(startLedger).toBe(1002); // Resumes from lastLedger + 1
        expect(resumeCursor).toBe('cursor-part-1');
        return {
          events: [RECORDED_FIXTURE_EVENTS[1]!],
          latestLedger: 1005,
          cursor: 'cursor-final',
        };
      },
    };

    const restartedService = new IngestionService({
      db,
      config: {
        NODE_ENV: 'test',
        PORT: 3002,
        HOST: '0.0.0.0',
        STELLAR_NETWORK: 'testnet',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
        VAULT_CONTRACT_ID: 'CVAULT123',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        CONFIRMATION_DEPTH: 1,
      },
      streamer,
    });

    const pollResult = await restartedService.poll();
    expect(pollResult.ingested).toBe(1);

    const allowance = await db.allowances.get('10');
    expect(allowance?.balance).toBe('5000000');
    expect(computeBalanceBucket(allowance?.balance!)).toBe('1-10');
  });

  it('handles duplicate event delivery safely (idempotency)', async () => {
    // Deliver event twice
    await service.ingestEvents([RECORDED_FIXTURE_EVENTS[0]!]);
    await service.ingestEvents([RECORDED_FIXTURE_EVENTS[0]!]);

    const allowance = await db.allowances.get('10');
    expect(allowance?.balance).toBe('40000000'); // Did not double-create or corrupt
  });
});

describe('apps/indexer - Fastify Read API & Acceptance Criteria', () => {
  let db: InMemoryKasuwaDb;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new InMemoryKasuwaDb();
    app = await buildIndexerApp({ db });
    await app.ready();
  });

  it('acceptance criteria: settling a batch writes rows into db and snapshot endpoint reflects new balance bucket', async () => {
    const service = new IngestionService({
      db,
      config: {
        NODE_ENV: 'test',
        PORT: 3002,
        HOST: '0.0.0.0',
        STELLAR_NETWORK: 'testnet',
        SOROBAN_RPC_URL: 'https://soroban-testnet.stellar.org',
        VAULT_CONTRACT_ID: 'CVAULT123',
        DATABASE_URL: 'postgresql://localhost:5432/test',
        CONFIRMATION_DEPTH: 1,
      },
    });

    // 1. Initial allowance creation: 40 USDC (Bucket: 10-50)
    await service.ingestEvents([RECORDED_FIXTURE_EVENTS[0]!]);

    let res = await app.inject({ method: 'GET', url: '/v1/snapshots' });
    expect(res.statusCode).toBe(200);
    let body = JSON.parse(res.body);
    expect(body.snapshots.length).toBe(1);
    expect(body.snapshots[0].allowance_id).toBe('10');
    expect(body.snapshots[0].balance_bucket).toBe('10-50');

    // 2. Relayer settles a batch: 35 USDC spent -> leaves 5 USDC (Bucket transitions to 1-10)
    await service.ingestEvents([RECORDED_FIXTURE_EVENTS[1]!]);

    res = await app.inject({ method: 'GET', url: '/v1/snapshots' });
    expect(res.statusCode).toBe(200);
    body = JSON.parse(res.body);
    expect(body.snapshots[0].balance_bucket).toBe('1-10'); // New balance bucket reflected!

    // 3. GET /v1/allowances/:id
    const singleRes = await app.inject({ method: 'GET', url: '/v1/allowances/10' });
    expect(singleRes.statusCode).toBe(200);
    const single = JSON.parse(singleRes.body);
    expect(single.balance_bucket).toBe('1-10');
    expect(single.owner).toBe('GOWNER111');

    // 4. GET /v1/merchants/:address/settlements
    const settlementsRes = await app.inject({
      method: 'GET',
      url: '/v1/merchants/GMERCHANT_AAA/settlements',
    });
    expect(settlementsRes.statusCode).toBe(200);
    const settlementsBody = JSON.parse(settlementsRes.body);
    expect(settlementsBody.total).toBe(1);
    expect(settlementsBody.settlements[0].paymentId).toBe('pay-abc-1');
  });
});
