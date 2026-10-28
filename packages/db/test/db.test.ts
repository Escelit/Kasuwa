import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryKasuwaDb } from '../src/index.js';

describe('packages/db - Schema and InMemoryKasuwaDb', () => {
  let db: InMemoryKasuwaDb;

  beforeEach(() => {
    db = new InMemoryKasuwaDb();
  });

  it('manages allowances lifecycle: created, top up, status update, snapshot feed', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.allowances.upsert({
      id: '1',
      owner: 'GOWNER123',
      token: 'USDC',
      deviceKeyHex: '04aabbcc',
      balance: '50000000',
      perPaymentCap: '10000000',
      validUntil: now + 86400,
      status: 'Active',
      createdAt: now,
      updatedAt: now,
    });

    const record = await db.allowances.get('1');
    expect(record).not.toBeNull();
    expect(record?.balance).toBe('50000000');
    expect(record?.status).toBe('Active');

    // Update balance on top up
    await db.allowances.updateBalance('1', '70000000');
    const updated = await db.allowances.get('1');
    expect(updated?.balance).toBe('70000000');

    // Snapshots feed
    const snapshots = await db.allowances.listSnapshots(0);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]?.id).toBe('1');
  });

  it('records settlements and lists by merchant with pagination', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.settlements.upsert({
      paymentId: 'pay-001',
      allowanceId: '1',
      merchant: 'GMERCHANT_AAA',
      amount: '5000000',
      expiresAt: now + 3600,
      status: 'settled',
      paid: '5000000',
      shortfall: '0',
      acceptedAt: now - 100,
      updatedAt: now,
    });

    await db.settlements.upsert({
      paymentId: 'pay-002',
      allowanceId: '1',
      merchant: 'GMERCHANT_AAA',
      amount: '8000000',
      expiresAt: now + 3600,
      status: 'partial',
      paid: '3000000',
      shortfall: '5000000',
      acceptedAt: now - 50,
      updatedAt: now,
    });

    const merchantSettlements = await db.settlements.listByMerchant('GMERCHANT_AAA', 10, 0);
    expect(merchantSettlements.total).toBe(2);
    expect(merchantSettlements.items.length).toBe(2);
    expect(merchantSettlements.items[0]?.paymentId).toBe('pay-002'); // Most recent first
  });

  it('records shortfalls and tracks device key shortfall aggregates', async () => {
    const now = Math.floor(Date.now() / 1000);
    await db.shortfalls.record({
      deviceKeyHex: '04devicekey123',
      allowanceId: '1',
      merchant: 'GMERCHANT',
      amount: '2000000',
      timestamp: now,
    });
    await db.shortfalls.record({
      deviceKeyHex: '04devicekey123',
      allowanceId: '1',
      merchant: 'GMERCHANT',
      amount: '3000000',
      timestamp: now + 10,
    });

    const agg = await db.shortfalls.countForDeviceKey('04devicekey123');
    expect(agg.count).toBe(2);
    expect(agg.totalAmount).toBe('5000000');
  });

  it('tracks restart-safe indexer cursor checkpoints', async () => {
    expect(await db.cursor.get()).toBeNull();
    await db.cursor.set(12345, 'cursor_token_xyz');
    const saved = await db.cursor.get();
    expect(saved?.lastLedger).toBe(12345);
    expect(saved?.lastCursor).toBe('cursor_token_xyz');
  });
});
