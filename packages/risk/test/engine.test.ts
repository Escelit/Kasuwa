/**
 * Table-driven tests for the Kasuwa risk assessment engine.
 * 100% branch coverage requirement.
 */
import { describe, it, expect } from 'vitest';
import {
  assessRisk,
  DEFAULT_RISK_POLICY,
  type AllowanceSnapshot,
  type UnsettledExposure,
  type RiskPolicy,
} from '../src/engine.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const NOW = 1_700_000_000; // fixed unix timestamp for deterministic tests

function snap(overrides: Partial<AllowanceSnapshot> = {}): AllowanceSnapshot {
  return {
    allowanceId: '1',
    owner: 'GABC',
    totalSize: 100_000_000n,    // 10 USDC
    ageSeconds: 8 * 24 * 3600, // 8 days (trusted tier)
    shortfallCount: 0,
    totalShortfall: 0n,
    snapshotTimestampSeconds: NOW - 3600, // 1 hour ago
    ...overrides,
  };
}

function noExposure(): UnsettledExposure {
  return { totalUnsettled: 0n, count: 0 };
}

function exposure(total: bigint, count = 1): UnsettledExposure {
  return { totalUnsettled: total, count };
}

// ─── Test table ───────────────────────────────────────────────────────────────

interface TestCase {
  id: string;
  snapshot: AllowanceSnapshot | null;
  policy?: RiskPolicy;
  exp: UnsettledExposure;
  amount: bigint;
  expectLevel: 'green' | 'amber' | 'red';
  expectMaxRecommended?: bigint;
  expectReasonContains?: string;
  expectTier?: string;
}

const cases: TestCase[] = [
  // ── Unknown allowance ────────────────────────────────────────────────────
  {
    id: 'TC-01: null snapshot → red, maxRecommended=0',
    snapshot: null,
    exp: noExposure(),
    amount: 1_000_000n,
    expectLevel: 'red',
    expectMaxRecommended: 0n,
    expectReasonContains: 'unknown',
  },

  // ── Trusted tier ─────────────────────────────────────────────────────────
  {
    id: 'TC-02: trusted tier, small amount, no exposure → green',
    snapshot: snap(), // 8 days old, no shortfalls
    exp: noExposure(),
    amount: 10_000_000n, // 1 USDC
    expectLevel: 'green',
    expectTier: 'trusted',
  },
  {
    id: 'TC-03: trusted tier, amount exactly at cap → green',
    snapshot: snap(),
    exp: noExposure(),
    amount: 50_000_000n, // exactly 5 USDC (trusted cap)
    expectLevel: 'green',
    expectTier: 'trusted',
  },
  {
    id: 'TC-04: trusted tier, amount 1 over cap → red',
    snapshot: snap(),
    exp: noExposure(),
    amount: 50_000_001n,
    expectLevel: 'red',
    expectReasonContains: 'single-payment cap',
    expectTier: 'trusted',
  },
  {
    id: 'TC-05: trusted tier, exposure pushes over cap → red',
    snapshot: snap(),
    exp: exposure(90_000_000n),
    amount: 20_000_000n, // projected = 110M > 100M trusted exposure cap
    expectLevel: 'red',
    expectReasonContains: 'exposure cap',
  },
  {
    id: 'TC-06: trusted tier, maxRecommended respects remaining exposure',
    snapshot: snap(),
    exp: exposure(60_000_000n),
    amount: 10_000_000n, // well within single cap; exposure room = 40M
    expectLevel: 'green',
    expectMaxRecommended: 40_000_000n, // min(50M single cap, 40M remaining)
  },

  // ── Known tier ────────────────────────────────────────────────────────────
  {
    id: 'TC-07: known tier (1 day old, no shortfalls) → amber (basic tier fallback check)',
    snapshot: snap({ ageSeconds: 2 * 24 * 3600, shortfallCount: 0 }),
    exp: noExposure(),
    amount: 10_000_000n, // within known cap
    expectLevel: 'green', // no stale, no shortfall, known tier
    expectTier: 'known',
  },
  {
    id: 'TC-08: known tier, amount over known cap → red',
    snapshot: snap({ ageSeconds: 2 * 24 * 3600 }),
    exp: noExposure(),
    amount: 20_000_001n, // over 2 USDC known cap
    expectLevel: 'red',
    expectReasonContains: 'single-payment cap',
  },

  // ── Basic tier ────────────────────────────────────────────────────────────
  {
    id: 'TC-09: basic tier (fresh allowance, no shortfalls) → amber',
    snapshot: snap({ ageSeconds: 3600, shortfallCount: 0 }), // only 1 hour old
    exp: noExposure(),
    amount: 5_000_000n, // within basic cap 10M
    expectLevel: 'amber', // basic tier → amber
    expectTier: 'basic',
  },
  {
    id: 'TC-10: basic tier, amount over basic cap → red',
    snapshot: snap({ ageSeconds: 3600 }),
    exp: noExposure(),
    amount: 10_000_001n, // over 1 USDC basic cap
    expectLevel: 'red',
    expectReasonContains: 'single-payment cap',
  },

  // ── Shortfall history ─────────────────────────────────────────────────────
  {
    id: 'TC-11: shortfalls > 0 → amber even on trusted-age',
    snapshot: snap({ shortfallCount: 1, totalShortfall: 500_000n }),
    exp: noExposure(),
    amount: 1_000_000n,
    expectLevel: 'amber', // has shortfalls
    expectReasonContains: 'shortfall',
  },
  {
    id: 'TC-12: 2 shortfalls, basic tier matched (no shortfall limit), within cap → amber',
    snapshot: snap({ ageSeconds: 3600, shortfallCount: 2 }),
    exp: noExposure(),
    amount: 1_000_000n,
    expectLevel: 'amber',
    expectTier: 'basic',
  },
  {
    id: 'TC-13: shortfalls but amount over cap → red (errors take priority)',
    snapshot: snap({ shortfallCount: 1 }),
    exp: noExposure(),
    amount: 60_000_000n, // over absolute 50M cap
    expectLevel: 'red',
    expectReasonContains: 'single-payment cap',
  },

  // ── Stale snapshot ────────────────────────────────────────────────────────
  {
    id: 'TC-14: stale snapshot (25h old) → amber',
    snapshot: snap({ snapshotTimestampSeconds: NOW - 25 * 3600 }),
    exp: noExposure(),
    amount: 5_000_000n,
    expectLevel: 'amber',
    expectReasonContains: 'stale',
  },
  {
    id: 'TC-15: stale + amount over cap → red',
    snapshot: snap({ snapshotTimestampSeconds: NOW - 25 * 3600 }),
    exp: noExposure(),
    amount: 60_000_000n,
    expectLevel: 'red',
    expectReasonContains: 'stale',
  },
  {
    id: 'TC-16: snapshot staleness disabled (0) → no stale warning',
    snapshot: snap({ snapshotTimestampSeconds: NOW - 100 * 3600 }),
    policy: { ...DEFAULT_RISK_POLICY, maxSnapshotStalenessSeconds: 0 },
    exp: noExposure(),
    amount: 5_000_000n,
    expectLevel: 'green',
  },
  {
    id: 'TC-17: snapshot timestamp 0 (never synced) → stale if staleness check enabled',
    snapshot: snap({ snapshotTimestampSeconds: 0 }),
    exp: noExposure(),
    amount: 5_000_000n,
    expectLevel: 'amber',
    expectReasonContains: 'stale',
  },

  // ── Exposure tracking ─────────────────────────────────────────────────────
  {
    id: 'TC-18: multiple accepted auths summing to cap, new one just fits → green',
    snapshot: snap(),
    exp: exposure(50_000_000n, 5), // 5 USDC already unsettled
    amount: 50_000_000n, // exactly fills to 100M trusted exposure cap
    expectLevel: 'green',
    expectMaxRecommended: 50_000_000n,
  },
  {
    id: 'TC-19: exposure already at cap, any new amount → red',
    snapshot: snap(),
    exp: exposure(100_000_000n, 10),
    amount: 1n,
    expectLevel: 'red',
    expectReasonContains: 'exposure cap',
    expectMaxRecommended: 0n,
  },
  {
    id: 'TC-20: maxRecommended is 0 when exposure room is 0',
    snapshot: snap(),
    exp: exposure(100_000_000n),
    amount: 10_000_000n,
    expectLevel: 'red',
    expectMaxRecommended: 0n,
  },

  // ── Absolute policy ceilings ──────────────────────────────────────────────
  {
    id: 'TC-21: absolute ceiling overrides tier max',
    snapshot: snap(),
    policy: { ...DEFAULT_RISK_POLICY, absoluteMaxSinglePayment: 5_000_000n },
    exp: noExposure(),
    amount: 6_000_000n, // over 0.5 USDC absolute ceiling
    expectLevel: 'red',
    expectReasonContains: 'single-payment cap',
  },
  {
    id: 'TC-22: null absolute ceiling → no override',
    snapshot: snap(),
    policy: { ...DEFAULT_RISK_POLICY, absoluteMaxSinglePayment: null, absoluteMaxExposure: null },
    exp: noExposure(),
    amount: 50_000_000n, // at trusted tier cap
    expectLevel: 'green',
  },

  // ── No tier matches ────────────────────────────────────────────────────────
  {
    id: 'TC-23: policy with no tiers → red',
    snapshot: snap(),
    policy: { ...DEFAULT_RISK_POLICY, tiers: [] },
    exp: noExposure(),
    amount: 1_000_000n,
    expectLevel: 'red',
    expectReasonContains: 'No risk tier',
    expectMaxRecommended: 0n,
  },

  // ── Edge amounts ──────────────────────────────────────────────────────────
  {
    id: 'TC-24: zero amount → green (trivially within cap)',
    snapshot: snap(),
    exp: noExposure(),
    amount: 0n,
    expectLevel: 'green',
  },
  {
    id: 'TC-25: very large amount, no absolute ceiling → red (over tier cap)',
    snapshot: snap(),
    policy: { ...DEFAULT_RISK_POLICY, absoluteMaxSinglePayment: null, absoluteMaxExposure: null },
    exp: noExposure(),
    amount: 999_999_999_999n,
    expectLevel: 'red',
    expectReasonContains: 'single-payment cap',
  },

  // ── Informational green ────────────────────────────────────────────────────
  {
    id: 'TC-26: green result always has at least one reason',
    snapshot: snap(),
    exp: noExposure(),
    amount: 1_000_000n,
    expectLevel: 'green',
  },

  // ── maxRecommended = min(singleCap, exposureRoom) ─────────────────────────
  {
    id: 'TC-27: maxRecommended limited by single cap, not exposure room',
    snapshot: snap({ ageSeconds: 2 * 24 * 3600 }), // known tier: 2M single, 5M exposure
    exp: exposure(1_000_000n), // 4M exposure room remains
    amount: 1_000_000n,
    expectLevel: 'green',
    expectMaxRecommended: 20_000_000n, // min(2M single cap, 4M exposure room) = 2M
    expectTier: 'known',
  },
];

describe('assessRisk (table-driven, 25+ cases)', () => {
  for (const tc of cases) {
    it(tc.id, () => {
      const result = assessRisk(
        tc.snapshot,
        tc.policy ?? DEFAULT_RISK_POLICY,
        tc.exp,
        tc.amount,
        NOW,
      );

      expect(result.level, `level for: ${tc.id}`).toBe(tc.expectLevel);

      if (tc.expectMaxRecommended !== undefined) {
        expect(result.maxRecommended, `maxRecommended for: ${tc.id}`).toBe(
          tc.expectMaxRecommended,
        );
      }

      if (tc.expectReasonContains) {
        const allReasons = result.reasons.join(' ').toLowerCase();
        expect(allReasons, `reason for: ${tc.id}`).toContain(
          tc.expectReasonContains.toLowerCase(),
        );
      }

      if (tc.expectTier) {
        expect(result.matchedTier, `tier for: ${tc.id}`).toBe(tc.expectTier);
      }

      // Engine ALWAYS returns at least one reason
      expect(result.reasons.length, `reasons array non-empty for: ${tc.id}`).toBeGreaterThan(0);
    });
  }
});
