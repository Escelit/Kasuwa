/**
 * Tests for the outbox state machine reducer.
 * Covers all transitions, terminal states, and illegal transition throws.
 */
import {
  outboxReducer,
  isTerminal,
  isExpired,
  type OutboxEntry,
  type OutboxStatus,
} from '../outboxReducer';

const NOW = 1_700_000_000;

function makeEntry(
  status: OutboxStatus,
  overrides: Partial<OutboxEntry> = {},
): OutboxEntry {
  return {
    paymentId: 'aabbccdd00112233aabbccdd00112233',
    allowanceId: '42',
    rawBytes: new Uint8Array(64),
    amount: 1_000_000n,
    merchant: 'GMERCHANT',
    expiresAt: NOW + 3600,
    status,
    attempts: 0,
    lastError: null,
    resultCode: null,
    paid: null,
    shortfall: null,
    createdAt: NOW - 60,
    updatedAt: NOW - 60,
    ...overrides,
  };
}

describe('outboxReducer transitions', () => {
  // ── SUBMIT_START ─────────────────────────────────────────────────────────
  it('queued → submitting on SUBMIT_START', () => {
    const e = makeEntry('queued');
    const next = outboxReducer(e, { type: 'SUBMIT_START' });
    expect(next.status).toBe('submitting');
    expect(next.attempts).toBe(1);
  });

  it('failed_retry → submitting on SUBMIT_START (via RESET then START)', () => {
    const e = makeEntry('failed_retry');
    const reset = outboxReducer(e, { type: 'RESET_TO_QUEUED' });
    expect(reset.status).toBe('queued');
    const next = outboxReducer(reset, { type: 'SUBMIT_START' });
    expect(next.status).toBe('submitting');
    expect(next.attempts).toBe(1);
  });

  it('increments attempts on each SUBMIT_START', () => {
    let e = makeEntry('queued');
    e = outboxReducer(e, { type: 'SUBMIT_START' });
    // simulate failure and retry
    e = outboxReducer(e, { type: 'SUBMIT_FAILURE', error: 'timeout' });
    e = outboxReducer(e, { type: 'RESET_TO_QUEUED' });
    e = outboxReducer(e, { type: 'SUBMIT_START' });
    expect(e.attempts).toBe(2);
  });

  // ── SUBMIT_SUCCESS ────────────────────────────────────────────────────────
  it('submitting → settled on SUBMIT_SUCCESS(Settled)', () => {
    const e = makeEntry('submitting');
    const next = outboxReducer(e, {
      type: 'SUBMIT_SUCCESS',
      resultCode: 'Settled',
      paid: 1_000_000n,
      shortfall: 0n,
    });
    expect(next.status).toBe('settled');
    expect(next.paid).toBe(1_000_000n);
    expect(next.shortfall).toBe(0n);
    expect(next.lastError).toBeNull();
  });

  it('submitting → partial on SUBMIT_SUCCESS(Partial(...))', () => {
    const e = makeEntry('submitting');
    const next = outboxReducer(e, {
      type: 'SUBMIT_SUCCESS',
      resultCode: 'Partial(800000, 200000)',
      paid: 800_000n,
      shortfall: 200_000n,
    });
    expect(next.status).toBe('partial');
  });

  it('submitting → rejected on SUBMIT_SUCCESS(BadSignature)', () => {
    const e = makeEntry('submitting');
    const next = outboxReducer(e, {
      type: 'SUBMIT_SUCCESS',
      resultCode: 'BadSignature',
      paid: 0n,
      shortfall: 0n,
    });
    expect(next.status).toBe('rejected');
  });

  it('submitting → rejected on SUBMIT_SUCCESS(Expired)', () => {
    const e = makeEntry('submitting');
    const next = outboxReducer(e, {
      type: 'SUBMIT_SUCCESS',
      resultCode: 'Expired',
      paid: 0n,
      shortfall: 0n,
    });
    expect(next.status).toBe('rejected');
  });

  // ── SUBMIT_FAILURE ────────────────────────────────────────────────────────
  it('submitting → failed_retry on SUBMIT_FAILURE', () => {
    const e = makeEntry('submitting');
    const next = outboxReducer(e, { type: 'SUBMIT_FAILURE', error: 'network timeout' });
    expect(next.status).toBe('failed_retry');
    expect(next.lastError).toBe('network timeout');
  });

  // ── MARK_EXPIRED ──────────────────────────────────────────────────────────
  it('queued → expired on MARK_EXPIRED', () => {
    const e = makeEntry('queued');
    const next = outboxReducer(e, { type: 'MARK_EXPIRED' });
    expect(next.status).toBe('expired');
    expect(next.lastError).toMatch(/expired/i);
  });

  it('submitting → expired on MARK_EXPIRED', () => {
    const e = makeEntry('submitting');
    const next = outboxReducer(e, { type: 'MARK_EXPIRED' });
    expect(next.status).toBe('expired');
  });

  it('failed_retry → expired on MARK_EXPIRED', () => {
    const e = makeEntry('failed_retry');
    const next = outboxReducer(e, { type: 'MARK_EXPIRED' });
    expect(next.status).toBe('expired');
  });

  // ── RESET_TO_QUEUED ───────────────────────────────────────────────────────
  it('failed_retry → queued on RESET_TO_QUEUED', () => {
    const e = makeEntry('failed_retry', { lastError: 'prev error' });
    const next = outboxReducer(e, { type: 'RESET_TO_QUEUED' });
    expect(next.status).toBe('queued');
    expect(next.lastError).toBeNull();
  });

  // ── Illegal transitions ───────────────────────────────────────────────────
  it('throws on settled → submitting', () => {
    const e = makeEntry('settled');
    expect(() => outboxReducer(e, { type: 'SUBMIT_START' })).toThrow(
      'Illegal outbox transition',
    );
  });

  it('throws on partial → queued', () => {
    const e = makeEntry('partial');
    expect(() => outboxReducer(e, { type: 'RESET_TO_QUEUED' })).toThrow(
      'Illegal outbox transition',
    );
  });

  it('throws on rejected → submitting', () => {
    const e = makeEntry('rejected');
    expect(() => outboxReducer(e, { type: 'SUBMIT_START' })).toThrow(
      'Illegal outbox transition',
    );
  });

  it('throws on expired → queued', () => {
    const e = makeEntry('expired');
    expect(() => outboxReducer(e, { type: 'RESET_TO_QUEUED' })).toThrow(
      'Illegal outbox transition',
    );
  });

  it('throws on queued → failed_retry directly (must go via submitting)', () => {
    const e = makeEntry('queued');
    expect(() =>
      outboxReducer(e, { type: 'SUBMIT_FAILURE', error: 'bad' }),
    ).toThrow('Illegal outbox transition');
  });
});

describe('isTerminal', () => {
  it('settled is terminal', () => expect(isTerminal('settled')).toBe(true));
  it('partial is terminal', () => expect(isTerminal('partial')).toBe(true));
  it('rejected is terminal', () => expect(isTerminal('rejected')).toBe(true));
  it('expired is terminal', () => expect(isTerminal('expired')).toBe(true));
  it('queued is not terminal', () => expect(isTerminal('queued')).toBe(false));
  it('submitting is not terminal', () => expect(isTerminal('submitting')).toBe(false));
  it('failed_retry is not terminal', () => expect(isTerminal('failed_retry')).toBe(false));
});

describe('isExpired', () => {
  it('returns true when expiresAt <= now', () => {
    const e = makeEntry('queued', { expiresAt: NOW - 1 });
    expect(isExpired(e, NOW)).toBe(true);
  });

  it('returns true when expiresAt == now', () => {
    const e = makeEntry('queued', { expiresAt: NOW });
    expect(isExpired(e, NOW)).toBe(true);
  });

  it('returns false when expiresAt > now', () => {
    const e = makeEntry('queued', { expiresAt: NOW + 1 });
    expect(isExpired(e, NOW)).toBe(false);
  });
});
