# ADR-004: Timestamps Instead of Ledger Numbers

## Status
Accepted

## Context
Decentralized ledgers sequence events by block/ledger sequence numbers. However, offline clients:
- Have no live connection to Soroban RPC nodes to know the current ledger number.
- Cannot reliably estimate future ledger closing times when network congestion or closing intervals fluctuate.
- Possess internal real-time hardware clocks (RTC), which are periodically synchronized to cellular towers or GPS.

## Decision
All protocol time fields—`valid_until`, `issued_at`, `expires_at`, and `close_requested_at`—are expressed as **Unix timestamps in seconds** (wall-clock time), never ledger numbers.
- Contract rules compare against the Soroban environment's `env.ledger().timestamp()`.
- Customer authorizations encode timestamps as 40-bit unsigned integers (`u40`), providing millisecond-free timestamp precision through year 36,812.

## Consequences
- **Positive**: Both merchant and customer devices can independently evaluate expiration offline using their native device clocks.
- **Positive**: Predictable customer experience ("valid for 24 hours" vs "valid for 17,280 ledgers").
- **Mitigation for Clock Skew**: A customer who backdates `issued_at` only makes their authorization expire sooner; forward-dating is rejected on-chain if $\text{issued\_at} > \text{valid\_until}$. A merchant with a significantly drifted clock only risks rejecting valid payments or holding expired ones.
