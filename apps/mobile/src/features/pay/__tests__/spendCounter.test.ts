/**
 * Tests for the spend counter reducer and checkCanIssue.
 */
import {
  spendCounterReducer,
  checkCanIssue,
  availableBalance,
  type SpendCounterState,
} from '../spendCounter';

const BASE: SpendCounterState = {
  allowanceId: '42',
  cachedBalance: 10_000_000n, // 10 USDC (7 decimals)
  perPaymentCap: 2_000_000n,  // 2 USDC
  localSpent: 0n,
};

describe('spendCounterReducer', () => {
  describe('COMMIT', () => {
    it('reduces available balance', () => {
      const next = spendCounterReducer(BASE, { type: 'COMMIT', amount: 500_000n });
      expect(next.localSpent).toBe(500_000n);
      expect(availableBalance(next)).toBe(9_500_000n);
    });

    it('allows up to the per-payment cap', () => {
      const next = spendCounterReducer(BASE, { type: 'COMMIT', amount: 2_000_000n });
      expect(next.localSpent).toBe(2_000_000n);
    });

    it('throws when amount exceeds per-payment cap', () => {
      expect(() =>
        spendCounterReducer(BASE, { type: 'COMMIT', amount: 2_000_001n }),
      ).toThrow('exceeds per_payment_cap');
    });

    it('throws when amount exceeds available balance', () => {
      const state: SpendCounterState = { ...BASE, localSpent: 9_500_000n };
      expect(() =>
        spendCounterReducer(state, { type: 'COMMIT', amount: 1_000_000n }),
      ).toThrow('available balance');
    });

    it('throws on non-positive amount', () => {
      expect(() =>
        spendCounterReducer(BASE, { type: 'COMMIT', amount: 0n }),
      ).toThrow('must be positive');
    });

    it('allows committing entire available balance in multiple steps', () => {
      let state = BASE;
      state = spendCounterReducer(state, { type: 'COMMIT', amount: 2_000_000n });
      state = spendCounterReducer(state, { type: 'COMMIT', amount: 2_000_000n });
      state = spendCounterReducer(state, { type: 'COMMIT', amount: 2_000_000n });
      state = spendCounterReducer(state, { type: 'COMMIT', amount: 2_000_000n });
      state = spendCounterReducer(state, { type: 'COMMIT', amount: 2_000_000n });
      expect(state.localSpent).toBe(10_000_000n);
      expect(availableBalance(state)).toBe(0n);
    });
  });

  describe('RELEASE', () => {
    it('increases available balance', () => {
      const state = { ...BASE, localSpent: 3_000_000n };
      const next = spendCounterReducer(state, { type: 'RELEASE', amount: 1_000_000n });
      expect(next.localSpent).toBe(2_000_000n);
    });

    it('throws when release would go negative', () => {
      const state = { ...BASE, localSpent: 500_000n };
      expect(() =>
        spendCounterReducer(state, { type: 'RELEASE', amount: 600_000n }),
      ).toThrow('negative');
    });

    it('throws on non-positive amount', () => {
      expect(() =>
        spendCounterReducer(BASE, { type: 'RELEASE', amount: 0n }),
      ).toThrow('must be positive');
    });
  });

  describe('SETTLE', () => {
    it('reduces both cachedBalance and localSpent', () => {
      const state = { ...BASE, localSpent: 2_000_000n };
      const next = spendCounterReducer(state, { type: 'SETTLE', amount: 2_000_000n });
      expect(next.cachedBalance).toBe(8_000_000n);
      expect(next.localSpent).toBe(0n);
    });

    it('clamps localSpent to 0 when settled amount > localSpent', () => {
      const state = { ...BASE, localSpent: 500_000n };
      const next = spendCounterReducer(state, { type: 'SETTLE', amount: 1_000_000n });
      expect(next.localSpent).toBe(0n);
      expect(next.cachedBalance).toBe(9_000_000n);
    });
  });

  describe('SYNC_BALANCE', () => {
    it('updates cachedBalance without touching localSpent', () => {
      const state = { ...BASE, localSpent: 1_000_000n };
      const next = spendCounterReducer(state, { type: 'SYNC_BALANCE', balance: 12_000_000n });
      expect(next.cachedBalance).toBe(12_000_000n);
      expect(next.localSpent).toBe(1_000_000n);
    });
  });
});

describe('checkCanIssue', () => {
  it('returns null when within cap and balance', () => {
    expect(checkCanIssue(BASE, 1_000_000n)).toBeNull();
  });

  it('returns error when amount > per-payment cap', () => {
    expect(checkCanIssue(BASE, 3_000_000n)).toMatch('per-payment cap');
  });

  it('returns error when amount > available balance', () => {
    const state = { ...BASE, localSpent: 9_500_000n };
    expect(checkCanIssue(state, 1_000_000n)).toMatch('available balance');
  });

  it('returns error for zero amount', () => {
    expect(checkCanIssue(BASE, 0n)).toMatch('must be positive');
  });

  it('returns null at exactly the per-payment cap', () => {
    expect(checkCanIssue(BASE, 2_000_000n)).toBeNull();
  });
});

describe('availableBalance', () => {
  it('returns cachedBalance - localSpent', () => {
    const state = { ...BASE, localSpent: 3_000_000n };
    expect(availableBalance(state)).toBe(7_000_000n);
  });

  it('clamps to 0 when localSpent > cachedBalance (defensive)', () => {
    const state = { ...BASE, localSpent: 11_000_000n };
    expect(availableBalance(state)).toBe(0n);
  });
});
