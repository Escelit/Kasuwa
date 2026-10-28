# Storage Tiers & State Archival Policy

This document specifies the Soroban storage model, TTL extension strategy, and state archival policies for the `allowance-vault` smart contract.

---

## 1. Soroban Storage Tiers in AllowanceVault

Soroban categorizes state into three storage tiers: **Instance**, **Persistent**, and **Temporary**. `allowance-vault` uses Instance and Persistent storage:

| Storage Type | Key / Entry | Lifetime & Eviction Policy | Touch Extension |
|---|---|---|---|
| **Instance** | `Config`, Monotonic allowance counter | Lives with the contract instance. Active indefinitely as long as contract is funded. | Extended on contract touches and admin updates. |
| **Persistent** | `Allowance(id)` | Must persist throughout the active, closing, and settlement window. | Extended on `create_allowance`, `top_up`, `settle`, and `extend_ttl`. |
| **Persistent** | `UsedPaymentId(allowance_id, payment_id)` | Replay prevention table. Safe to expire after `valid_until + max_payment_ttl`. | Extended on every settlement touch. |
| **Persistent** | `Shortfalls(device_key)` | Permanent audit trail of overspends attributed to hardware keys. | Extended when new shortfall is recorded. |

---

## 2. TTL Extension Strategy

Soroban ledgers require entries to be periodically bumped to prevent state archival.

### Automatic Extension on Touch
Whenever an allowance entry is modified (`top_up`, `request_close`, `settle`, `reclaim`), `storage::extend_allowance_ttl` and `storage::extend_instance_ttl` are called:

- **Threshold**: 100,000 ledgers (~5.7 days at 5s ledger close time).
- **Extension**: 500,000 ledgers (~28.9 days).

### Permissionless Maintenance: `extend_ttl`
Anyone (the owner, merchant, indexer, or relayer) can call:
```rust
pub fn extend_ttl(env: Env, allowance_id: u64) -> Result<(), VaultError>
```
This permissionless helper prevents allowance records from being archived even if no payments occur for an extended period.

---

## 3. Safe State Eviction for Replay Records

A major optimization in Kasuwa is that `used_payment_ids` do **not** need to be stored forever:

1. Every `PaymentAuthorization` contains an `expires_at` timestamp.
2. The contract enforces `issued_at <= valid_until` and `expires_at - issued_at <= max_payment_ttl`.
3. Once `allowance.valid_until + max_payment_ttl` has passed, any authorization issued against that allowance is mathematically guaranteed to have expired.
4. Therefore, after the reclaim countdown elapses, the `used_payment_ids` entries can be safely archived or left to expire without risking replay attacks.

---

## 4. Rent Budgeting

Creating an allowance deposits a small rent buffer in XLM as part of the initial transaction resources. For typical 7-day allowances, the persistent entry rent cost is negligible (< 0.05 XLM).
