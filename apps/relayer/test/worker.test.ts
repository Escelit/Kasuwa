import { describe, it, expect, beforeEach } from 'vitest';
import { Keypair } from '@stellar/stellar-sdk';
import { encodePaymentAuthorization, type PaymentAuthorization } from '@kasuwa/protocol';
import { RejectReason, SettleResult } from '@kasuwa/sdk';
import { LocalKeySigner } from '../src/signers/LocalKeySigner.js';
import { KmsSigner } from '../src/signers/KmsSigner.js';
import { ChannelManager } from '../src/channels/ChannelManager.js';
import { BatchBuilder, BatchItem } from '../src/batch/BatchBuilder.js';
import { SettlementWorker, SettlementRpcInterface } from '../src/worker/SettlementWorker.js';
import { getRecord, upsertRecord, _clearStore } from '../src/settlementStore.js';
import { globalMetrics } from '../src/metrics/MetricsCollector.js';
import { loadConfig } from '../src/config.js';

process.env['STELLAR_NETWORK_PASSPHRASE'] = 'Test SDF Network ; September 2015';
process.env['SOROBAN_RPC_URL'] = 'https://soroban-testnet.stellar.org';
process.env['VAULT_CONTRACT_ID'] = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';
process.env['DATABASE_URL'] = 'postgresql://localhost:5432/kasuwa_test';
process.env['RELAYER_API_KEYS'] = 'test-key-abc123';

function createMockAuth(overrides: Partial<PaymentAuthorization> = {}): BatchItem {
  const now = Math.floor(Date.now() / 1000);
  const paymentId = new Uint8Array(16);
  paymentId.set([Math.floor(Math.random() * 255), Math.floor(Math.random() * 255)]);

  const auth: PaymentAuthorization = {
    version: 1,
    allowanceId: 100n,
    paymentId,
    merchant: new Uint8Array(32).fill(0x33),
    amount: 10_000_000n, // 10 USDC
    issuedAt: now - 300,
    expiresAt: now + 3600,
    signature: new Uint8Array(64).fill(0x01),
    ...overrides,
  };

  const encodedBytes = encodePaymentAuthorization(auth);
  const rawBytesB64 = Buffer.from(encodedBytes).toString('base64url');
  const paymentIdHex = Buffer.from(auth.paymentId).toString('hex');

  // Register in store as accepted
  upsertRecord(paymentIdHex, auth, rawBytesB64);

  return {
    paymentId: paymentIdHex,
    rawBytesB64,
    auth,
  };
}

describe('Signer Implementations', () => {
  it('LocalKeySigner signs on testnet / local', async () => {
    const kp = Keypair.random();
    const signer = new LocalKeySigner(kp, 'testnet');
    expect(await signer.getPublicKey()).toBe(kp.publicKey());
  });

  it('LocalKeySigner strictly refuses to run on mainnet', () => {
    const kp = Keypair.random();
    expect(() => new LocalKeySigner(kp, 'mainnet')).toThrow(/SECURITY INVARIANT VIOLATION/);
  });

  it('KmsSigner exposes key and provides informative stub', async () => {
    const kms = new KmsSigner({ keyId: 'alias/kasuwa-relayer-fee-payer' });
    expect(await kms.getPublicKey()).toBeTruthy();
  });
});

describe('ChannelManager', () => {
  it('manages channel account pool acquisition and sequence locking', async () => {
    const kps = [Keypair.random(), Keypair.random()];
    const manager = new ChannelManager(kps, 'https://soroban-testnet.stellar.org');

    expect(manager.getPoolSize()).toBe(2);
    expect(manager.getAvailableCount()).toBe(2);

    const c1 = await manager.acquireChannel();
    expect(c1.isBusy).toBe(true);
    expect(manager.getAvailableCount()).toBe(1);

    const c2 = await manager.acquireChannel();
    expect(c2.isBusy).toBe(true);
    expect(manager.getAvailableCount()).toBe(0);

    // Pool exhausted
    await expect(manager.acquireChannel()).rejects.toThrow(/Channel accounts exhausted/);

    // Release restores availability
    await manager.releaseChannel(c1);
    expect(manager.getAvailableCount()).toBe(1);

    const health = manager.getHealth();
    expect(health.length).toBe(2);
    expect(health[0]!.publicKey).toBe(kps[0]!.publicKey());
  });
});

describe('BatchBuilder', () => {
  it('groups items into batches bounded by maxBatchSize and ordered by expiry proximity', () => {
    const now = Math.floor(Date.now() / 1000);
    const item1 = createMockAuth({ expiresAt: now + 5000 });
    const item2 = createMockAuth({ expiresAt: now + 1000 }); // expiring sooner
    const item3 = createMockAuth({ expiresAt: now + 3000 });

    const batches = BatchBuilder.groupIntoBatches([item1, item2, item3], 2);
    expect(batches.length).toBe(2);
    expect(batches[0]!.length).toBe(2);
    // Prioritized soonest expiry first
    expect(batches[0]![0]!.paymentId).toBe(item2.paymentId);
    expect(batches[0]![1]!.paymentId).toBe(item3.paymentId);
    expect(batches[1]![0]!.paymentId).toBe(item1.paymentId);
  });

  it('caps batches at contract max limit (25)', () => {
    const items = Array.from({ length: 30 }, () => createMockAuth());
    const batches = BatchBuilder.groupIntoBatches(items, 50); // requested 50, but contract limit is 25
    expect(batches[0]!.length).toBe(25);
    expect(batches[1]!.length).toBe(5);
  });
});

describe('SettlementWorker - Mixed Batch Acceptance & Per-Item Results', () => {
  beforeEach(() => {
    _clearStore();
  });

  it('settles a mixed batch: good, replayed, over-cap, and expired items without bad items blocking good ones', async () => {
    const now = Math.floor(Date.now() / 1000);

    const goodItem = createMockAuth({ amount: 5_000_000n });
    const replayItem = createMockAuth({ amount: 2_000_000n });
    const overCapItem = createMockAuth({ amount: 99_000_000n });
    const expiredItem = createMockAuth({ expiresAt: now - 100 });
    const partialItem = createMockAuth({ amount: 8_000_000n });

    const batch = [goodItem, replayItem, overCapItem, expiredItem, partialItem];

    // Mocked RPC responses simulating Soroban contract execution
    const mockRpc: SettlementRpcInterface = {
      simulateBatch: async () => ({ minResourceFee: '100' }),
      submitBatch: async () => [
        { tag: 'Settled', values: undefined },
        { tag: 'Rejected', values: [RejectReason.Replay] }, // Already settled (idempotent success)
        { tag: 'Rejected', values: [RejectReason.OverCap] },
        { tag: 'Rejected', values: [RejectReason.Expired] },
        { tag: 'Partial', values: [5_000_000n, 3_000_000n] },
      ],
    };

    const config = loadConfig();
    const channelManager = new ChannelManager([Keypair.random()], config.SOROBAN_RPC_URL);
    const feePayerSigner = new LocalKeySigner(Keypair.random(), 'testnet');

    const worker = new SettlementWorker({
      config,
      channelManager,
      feePayerSigner,
      rpcClient: mockRpc,
    });

    const results = await worker.processBatch(batch);

    expect(results.length).toBe(5);

    // 1. Good item settled in full
    expect(results[0]).toMatchObject({
      paymentId: goodItem.paymentId,
      status: 'settled',
      paid: 5_000_000n,
      shortfall: 0n,
    });
    expect(getRecord(goodItem.paymentId)?.status).toBe('settled');

    // 2. Replay item treated as already settled (idempotent success)
    expect(results[1]).toMatchObject({
      paymentId: replayItem.paymentId,
      status: 'settled',
    });
    expect(getRecord(replayItem.paymentId)?.status).toBe('settled');

    // 3. OverCap rejected
    expect(results[2]).toMatchObject({
      paymentId: overCapItem.paymentId,
      status: 'rejected',
      reason: 'OverCap',
    });
    expect(getRecord(overCapItem.paymentId)?.status).toBe('rejected');

    // 4. Expired rejected
    expect(results[3]).toMatchObject({
      paymentId: expiredItem.paymentId,
      status: 'rejected',
      reason: 'Expired',
    });
    expect(getRecord(expiredItem.paymentId)?.status).toBe('rejected');

    // 5. Partial settlement recorded with paid and shortfall
    expect(results[4]).toMatchObject({
      paymentId: partialItem.paymentId,
      status: 'partial',
      paid: 5_000_000n,
      shortfall: 3_000_000n,
    });
    const partialRec = getRecord(partialItem.paymentId);
    expect(partialRec?.status).toBe('partial');
    expect(partialRec?.paid).toBe(5_000_000n);
    expect(partialRec?.shortfall).toBe(3_000_000n);

    // 6. Metrics recorded correctly
    const metrics = globalMetrics.getSnapshot();
    expect(metrics.perStatusCounts.settled).toBeGreaterThanOrEqual(2);
    expect(metrics.perStatusCounts.partial).toBeGreaterThanOrEqual(1);
    expect(metrics.perStatusCounts.rejected).toBeGreaterThanOrEqual(2);

    // Prometheus format contains metrics
    const prom = globalMetrics.toPrometheusFormat();
    expect(prom).toContain('relayer_settlements_total{status="settled"}');
  });

  it('retries on transient RPC errors and releases channel safely', async () => {
    let attempts = 0;
    const item = createMockAuth();

    const mockRpc: SettlementRpcInterface = {
      simulateBatch: async () => ({ minResourceFee: '100' }),
      submitBatch: async () => {
        attempts++;
        if (attempts === 1) {
          throw new Error('503 Service Unavailable: transient RPC node timeout');
        }
        return [{ tag: 'Settled', values: undefined }];
      },
    };

    const config = loadConfig();
    const channelManager = new ChannelManager([Keypair.random()], config.SOROBAN_RPC_URL);
    const feePayerSigner = new LocalKeySigner(Keypair.random(), 'testnet');

    const worker = new SettlementWorker({
      config,
      channelManager,
      feePayerSigner,
      rpcClient: mockRpc,
    });

    const results = await worker.processBatch([item]);
    expect(attempts).toBe(2); // Retried once and succeeded
    expect(results[0]?.status).toBe('settled');
    expect(channelManager.getAvailableCount()).toBe(1); // Channel released
  });
});
