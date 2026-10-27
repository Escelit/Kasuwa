# Merchant Risk Policy

> Version 1 — matches `DEFAULT_RISK_POLICY` in `packages/risk/src/engine.ts`.

## Overview

Because the merchant cannot see on-chain state at the moment of sale, the risk
engine gives guard rails that run entirely offline. The engine **warns**; it
never blocks. The merchant is always the decision-maker.

All amounts below are in token base units. For USDC (7 decimals): 1 USDC = 10 000 000 base units.

---

## Tiers (evaluated in order — first match wins)

| Tier | Min age | Max shortfalls | Max single payment | Max cumulative exposure |
|---|---|---|---|---|
| **trusted** | 7 days | 0 | 5 USDC (50 000 000) | 10 USDC (100 000 000) |
| **known** | 1 day | 0 | 2 USDC (20 000 000) | 5 USDC (50 000 000) |
| **basic** | 0 | any | 1 USDC (10 000 000) | 2 USDC (20 000 000) |

If no tier matches (or the snapshot is unknown), the engine returns **red** with `maxRecommended = 0`.

### Absolute ceilings (override tier limits)

| Ceiling | Value |
|---|---|
| `absoluteMaxSinglePayment` | 5 USDC (50 000 000) |
| `absoluteMaxExposure` | 10 USDC (100 000 000) |

---

## Snapshot staleness

If the merchant's cached snapshot is older than **24 hours** the engine returns **amber** regardless of tier, indicating that the balance data may be stale.

Set `maxSnapshotStalenessSeconds: 0` in a custom policy to disable staleness checks.

---

## Risk levels

| Level | Meaning |
|---|---|
| 🟢 **green** | Within tier limits, no shortfall history, fresh snapshot. Proceed normally. |
| 🟡 **amber** | Stale snapshot, shortfall history, or basic tier. Merchant should apply discretion. |
| 🔴 **red** | Unknown allowance, over cap, or over exposure. Engine recommends refusing. |

---

## Exposure tracking

The app tracks the **sum of all accepted, unsettled authorizations** per allowance.
This is a local view: nearby merchants who also accepted from the same customer are not
visible. Auto-settle as soon as connectivity returns to shrink the window.

---

## Customising the policy

Policies are plain objects conforming to the `RiskPolicy` interface in
`packages/risk/src/engine.ts`. Pass a custom policy to `assessRisk()`.

Example — conservative policy accepting nothing from unknown allowances and up to
0.50 USDC from known ones:

```ts
import { assessRisk, DEFAULT_RISK_POLICY, type RiskPolicy } from '@kasuwa/risk';

const conservativePolicy: RiskPolicy = {
  ...DEFAULT_RISK_POLICY,
  tiers: [
    {
      name: 'trusted',
      maxSinglePayment: 5_000_000n,   // 0.50 USDC
      maxExposure:      10_000_000n,  // 1 USDC
      minAgeSeconds:    14 * 24 * 3600,
      maxShortfallCount: 0,
    },
  ],
  absoluteMaxSinglePayment: 5_000_000n,
  absoluteMaxExposure: 10_000_000n,
};

const result = assessRisk(snapshot, conservativePolicy, exposure, requestedAmount);
```

---

## What the engine cannot do

- It cannot see what other merchants have accepted offline against the same allowance.
- It cannot see the real-time on-chain balance (only the last synced snapshot).
- It does not prevent double-spend — see README.md § "The honest framing: bound, don't prevent".
