# ADR-001: Custom Signed Message Instead of Native Soroban Auth Entries

## Status
Accepted

## Context
Soroban provides native authorization entries (`soroban_sdk::auth`) for authorizing contract calls. While native auth entries are native to on-chain transaction submission, they present severe drawbacks when used for offline-first, camera-mediated peer-to-peer payments:
1. **Payload Size**: Native `AddressWithNonce` and authorization trees require extensive serialization that inflates QR code density well beyond the scanning reliability threshold of low-end smartphone cameras.
2. **Ledger Sequence Dependencies**: Native Soroban auth entries are bound to ledger sequence numbers and expiration ledgers. An offline device with no internet connection cannot observe current ledger sequence numbers.
3. **Complex Construction**: Constructing native invocation authorization envelopes without network RPC access is complex, error-prone, and fragile on resource-constrained mobile hardware.

## Decision
Kasuwa defines an explicit, compact domain-separated signed message:
$$\text{digest} = \text{SHA-256}(\text{domain\_tag} \parallel \text{canonical\_bytes}(PaymentAuth) \parallel \text{contract\_id} \parallel \text{network\_id})$$

The signature is verified explicitly inside the contract host using Soroban's cryptographic host functions.

## Consequences
- **Positive**: Payload sizes stay tiny (~132–141 bytes), producing low-density, easily scannable QR codes.
- **Positive**: Full offline autonomy; neither party needs access to current ledger sequence numbers.
- **Positive**: Strict domain separation prevents cross-network and cross-contract signature replay.
- **Negative**: The contract must manage replay protection (`payment_id`) and expiration logic manually rather than delegating nonce tracking to the host runtime.
