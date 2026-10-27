/**
 * Merchant risk assessment engine for Kasuwa.
 *
 * Pure functions, no I/O. Returns a risk assessment to help merchants
 * decide whether to accept an offline payment. The engine WARNS; it
 * never blocks — the merchant is always the decision-maker.
 *
 * See docs/merchant-risk-policy.md for policy documentation.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** A snapshot of an allowance as last seen by the merchant's indexer sync. */
export interface AllowanceSnapshot {
  /** Allowance ID (stringified u64) */
  allowanceId: string;
  /** Allowance owner's Stellar address */
  owner: string;
  /** Total size of the allowance when created (in token base units) */
  totalSize: bigint;
  /** Age of the allowance in seconds since creation */
  ageSeconds: number;
  /** Total number of previous shortfall records on-chain for this device key */
  shortfallCount: number;
  /** Total shortfall amount recorded on-chain (cumulative, token base units) */
  totalShortfall: bigint;
  /** Unix timestamp when this snapshot was last synced (0 = never synced) */
  snapshotTimestampSeconds: number;
}

/** Unsettled exposure: authorizations accepted but not yet on-chain. */
export interface UnsettledExposure {
  /** Total amount of authorizations accepted but not yet settled (token base units) */
  totalUnsettled: bigint;
  /** Number of distinct authorizations not yet settled */
  count: number;
}

/** A merchant risk policy tier. */
export interface RiskTier {
  /** Human-readable tier name (e.g., "unknown", "known", "trusted") */
  name: string;
  /** Maximum amount to accept for a single payment on this tier (token base units) */
  maxSinglePayment: bigint;
  /** Maximum cumulative exposure per allowance (token base units) */
  maxExposure: bigint;
  /**
   * Minimum allowance age (seconds) required to reach this tier.
   * 0 means no minimum age.
   */
  minAgeSeconds: number;
  /**
   * Maximum number of on-chain shortfalls allowed for this tier.
   * null means any number is acceptable for this tier.
   */
  maxShortfallCount: number | null;
}

/** A full merchant risk policy. */
export interface RiskPolicy {
  /** Policy schema version */
  version: number;
  /**
   * How stale a snapshot is allowed to be (seconds) before the
   * allowance is treated as "unknown". 0 = any age is acceptable.
   */
  maxSnapshotStalenessSeconds: number;
  /** Tiers, evaluated in order. First matching tier applies. */
  tiers: RiskTier[];
  /**
   * Absolute hard ceiling regardless of tier (token base units).
   * null = no absolute ceiling.
   */
  absoluteMaxSinglePayment: bigint | null;
  /** Absolute maximum exposure per allowance regardless of tier. */
  absoluteMaxExposure: bigint | null;
}

/** Risk assessment result returned to the merchant. */
export interface RiskAssessment {
  /** Aggregated risk level. */
  level: 'green' | 'amber' | 'red';
  /**
   * Human-readable reasons. Always non-empty for amber/red.
   * May include informational notes for green.
   */
  reasons: string[];
  /**
   * Maximum amount the engine recommends accepting for this payment,
   * given policy and unsettled exposure. The merchant may override.
   * 0n means the engine recommends refusing.
   */
  maxRecommended: bigint;
  /** The tier that was matched (undefined = no tier matched or unknown allowance). */
  matchedTier?: string;
}

// ─── Default policy ────────────────────────────────────────────────────────────

/**
 * Default merchant risk policy.
 *
 * Amounts are in token base units (e.g., USDC with 7 decimals).
 *   1 USDC = 10_000_000 base units
 *
 * Tiers (evaluated in order, first match wins):
 *  1. trusted: clean history (0 shortfalls), ≥7 days old, up to 5 USDC/payment
 *  2. known:   no shortfalls, ≥1 day old, up to 2 USDC/payment
 *  3. basic:   any known allowance (has a snapshot), up to 1 USDC/payment
 * Unknown allowances (no snapshot or stale snapshot): 0 USDC recommended.
 *
 * Documented in docs/merchant-risk-policy.md.
 */
export const DEFAULT_RISK_POLICY: RiskPolicy = {
  version: 1,
  maxSnapshotStalenessSeconds: 24 * 3600, // 24 hours
  tiers: [
    {
      name: 'trusted',
      maxSinglePayment: 50_000_000n,   // 5 USDC
      maxExposure: 100_000_000n,        // 10 USDC
      minAgeSeconds: 7 * 24 * 3600,    // 7 days
      maxShortfallCount: 0,
    },
    {
      name: 'known',
      maxSinglePayment: 20_000_000n,   // 2 USDC
      maxExposure: 50_000_000n,         // 5 USDC
      minAgeSeconds: 24 * 3600,        // 1 day
      maxShortfallCount: 0,
    },
    {
      name: 'basic',
      maxSinglePayment: 10_000_000n,   // 1 USDC
      maxExposure: 20_000_000n,         // 2 USDC
      minAgeSeconds: 0,
      maxShortfallCount: null,          // any shortfall history allowed
    },
  ],
  absoluteMaxSinglePayment: 50_000_000n,  // 5 USDC hard ceiling
  absoluteMaxExposure: 100_000_000n,       // 10 USDC hard ceiling
};

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Assesses the risk of accepting an offline payment.
 *
 * @param snapshot     Allowance snapshot from the merchant's local cache.
 *                     If null, the allowance is completely unknown.
 * @param policy       Merchant risk policy.
 * @param exposure     Existing unsettled exposure for this allowance.
 * @param requestedAmount  Amount the customer wants to pay (token base units).
 * @param nowSeconds   Current unix timestamp. Defaults to Date.now()/1000.
 * @returns RiskAssessment
 */
export function assessRisk(
  snapshot: AllowanceSnapshot | null,
  policy: RiskPolicy,
  exposure: UnsettledExposure,
  requestedAmount: bigint,
  nowSeconds?: number,
): RiskAssessment {
  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const reasons: string[] = [];

  // ── 1. Unknown allowance ──────────────────────────────────────────────────
  if (snapshot === null) {
    return {
      level: 'red',
      reasons: [
        'Allowance is unknown — no snapshot in local cache. ' +
        'Sync with the indexer when online before accepting.',
      ],
      maxRecommended: 0n,
    };
  }

  // ── 2. Stale snapshot ─────────────────────────────────────────────────────
  const snapshotAge = snapshot.snapshotTimestampSeconds > 0
    ? now - snapshot.snapshotTimestampSeconds
    : Infinity;

  const isStale =
    policy.maxSnapshotStalenessSeconds > 0 &&
    snapshotAge > policy.maxSnapshotStalenessSeconds;

  if (isStale) {
    reasons.push(
      `Snapshot is stale (${Math.floor(snapshotAge / 3600)}h old, max allowed: ` +
      `${policy.maxSnapshotStalenessSeconds / 3600}h). Data may not reflect actual balance.`,
    );
  }

  // ── 3. Shortfall history ──────────────────────────────────────────────────
  if (snapshot.shortfallCount > 0) {
    reasons.push(
      `Device has ${snapshot.shortfallCount} on-chain shortfall record(s) ` +
      `totalling ${snapshot.totalShortfall} base units. This customer has previously overspent.`,
    );
  }

  // ── 4. Find best matching tier ────────────────────────────────────────────
  let matchedTier: RiskTier | null = null;
  for (const tier of policy.tiers) {
    const meetsAge = snapshot.ageSeconds >= tier.minAgeSeconds;
    const meetsShortfall =
      tier.maxShortfallCount === null ||
      snapshot.shortfallCount <= tier.maxShortfallCount;

    if (meetsAge && meetsShortfall) {
      matchedTier = tier;
      break;
    }
  }

  if (matchedTier === null) {
    // No tier matched — treat as effectively unknown
    reasons.push('No risk tier matched this allowance. Recommend refusing.');
    return {
      level: 'red',
      reasons,
      maxRecommended: 0n,
    };
  }

  // ── 5. Exposure check ─────────────────────────────────────────────────────
  const projectedExposure = exposure.totalUnsettled + requestedAmount;
  const effectiveMaxExposure = minBigInt(
    matchedTier.maxExposure,
    policy.absoluteMaxExposure ?? matchedTier.maxExposure,
  );
  const effectiveMaxSingle = minBigInt(
    matchedTier.maxSinglePayment,
    policy.absoluteMaxSinglePayment ?? matchedTier.maxSinglePayment,
  );

  if (requestedAmount > effectiveMaxSingle) {
    reasons.push(
      `Payment amount (${requestedAmount}) exceeds the tier '${matchedTier.name}' ` +
      `single-payment cap (${effectiveMaxSingle}).`,
    );
  }

  if (projectedExposure > effectiveMaxExposure) {
    reasons.push(
      `Projected exposure (${projectedExposure}) would exceed the tier '${matchedTier.name}' ` +
      `exposure cap (${effectiveMaxExposure}).`,
    );
  }

  // ── 6. Derive maxRecommended ──────────────────────────────────────────────
  const remainingExposureRoom =
    effectiveMaxExposure > exposure.totalUnsettled
      ? effectiveMaxExposure - exposure.totalUnsettled
      : 0n;

  const maxRecommended = minBigInt(effectiveMaxSingle, remainingExposureRoom);

  // ── 7. Compute level ──────────────────────────────────────────────────────
  const hasErrors =
    requestedAmount > effectiveMaxSingle ||
    projectedExposure > effectiveMaxExposure;

  let level: 'green' | 'amber' | 'red';
  if (hasErrors) {
    level = 'red';
  } else if (
    isStale ||
    snapshot.shortfallCount > 0 ||
    matchedTier.name === 'basic'
  ) {
    level = 'amber';
  } else {
    level = 'green';
  }

  // Always emit at least one reason so callers can display context.
  if (reasons.length === 0) {
    reasons.push(
      `Allowance matched tier '${matchedTier.name}'. ` +
      `${exposure.count} unsettled authorization(s) for ${exposure.totalUnsettled} base units.`,
    );
  } else if (level === 'amber' && matchedTier.name === 'basic' &&
             !reasons.some((r) => r.includes('basic'))) {
    reasons.push(
      `Allowance matched the '${matchedTier.name}' tier (low confidence). ` +
      `Consider syncing allowance history when online.`,
    );
  }

  return {
    level,
    reasons,
    maxRecommended,
    matchedTier: matchedTier.name,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function minBigInt(a: bigint, b: bigint): bigint {
  return a < b ? a : b;
}
