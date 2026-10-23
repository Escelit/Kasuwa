# ADR-005: Contract Upgradeability Policy

## Status
Accepted

## Context
Smart contract escrow systems must protect user funds against malicious upgrades or unilateral admin expropriation.
The non-negotiable constraints from Kasuwa's architecture state:
- Non-custodial: no administrator function may ever touch or move escrowed allowance funds.
- Reclaim guarantee: customer deposits must always be redeemable by the original owner after the expiration and grace windows pass.

## Decision
1. **Default Immutability**: Production deployments of `AllowanceVault` on mainnet shall be immutable contracts with no upgrade proxy or migration admin by default.
2. **Conditional Upgrade Path (If Configured)**:
   - If an upgrade mechanism is ever deployed, it must be governed by a timelock (minimum 14 days) and a multi-signature threshold.
   - Any upgrade contract MUST NOT possess administrative privileges to drain, reallocate, or transfer escrowed balances.
   - Reclaim pathways for existing allowance holders must remain accessible and functional regardless of upgrade state.

## Consequences
- **Positive**: Strict protection against rug pulls, central operator compromise, and unilateral protocol manipulation.
- **Positive**: Full alignment with non-custodial invariants.
- **Negative**: Bug fixes in contract logic require deploying a new vault instance and migrating users to new allowances after existing allowances close.
