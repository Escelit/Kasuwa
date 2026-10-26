# ADR-006: secp256r1 Verification Error Handling and Relayer Pre-Validation

## Status
Accepted

## Context
Kasuwa's smart contract specification requires that `settle` and `settle_batch` return per-item result codes (`SettleResult::Rejected(RejectReason::BadSignature)`) rather than aborting or reverting the whole transaction when an invalid authorization is encountered.

However, Soroban's cryptographic host environment presents a fundamental design constraint:
1. **Host Function Trapping**: `env.crypto().secp256r1_verify` invokes the host function `verify_sig_ecdsa_secp256r1`. If the cryptographic signature fails elliptic curve verification, the host raises `HostError(Error(Crypto, InvalidInput))`.
2. **No Guest Exception Handling**: Within Soroban WebAssembly guest code, host traps cannot be caught by guest `catch` or `Result` mechanisms.
3. **Self-Invocation Prohibition**: In Soroban, contract re-entrancy and self-invocation via `env.try_invoke_contract(&env.current_contract_address(), ...)` are strictly prohibited and immediately aborted by the host runtime with `Error(Context, InvalidAction)`. Therefore, wrapping `secp256r1_verify` in an internal sub-invocation is not permitted by the host architecture.

## Decision
We implement a two-layer defense-in-depth architecture:

1. **Guest-Side Pre-Validation in Contract**:
   Before invoking the Soroban host cryptographic function, `verify_authorization` strictly pre-validates all structural properties in guest code:
   - Wire version check (`auth.version == 0x01`).
   - SEC-1 uncompressed public key formatting (`device_key[0] == 0x04`).
   - Canonical Low-S scalar normalization ($s \le \lfloor n / 2 \rfloor$).
   - Merchant address deserialization and recipient matching.
   - Authorization expiration and max payment window validation.
   - Replay protection against previously used payment IDs.
   Any malformed, expired, replayed, or high-S authorization is rejected cleanly with a `RejectReason` code without triggering a host trap.

2. **Off-Chain Relayer Pre-Validation**:
   The Kasuwa relayer service (`apps/relayer`) executes full software-based secp256r1 verification on every authorization prior to batching and on-chain submission. Any item with mathematically invalid ECDSA signatures is filtered and reported to the merchant outbox before touching the ledger.

3. **Auxiliary Verifier Architecture (Future Phase)**:
   If on-chain isolation of computationally invalid signatures without relayer assistance becomes strictly required in future protocol versions, Kasuwa will deploy an external stateless auxiliary contract (`Secp256r1Verifier`) that can be safely invoked via `try_invoke_contract`, allowing host errors from a separate contract address to be caught cleanly.

## Consequences
- **Positive**: Strict low-S and structural checks prevent signature malleability and well-formed invalid inputs from panicking.
- **Positive**: Zero wasted gas from gas griefing on known malformed items.
- **Positive**: Complies with Soroban host architecture and self-invocation restrictions.
- **Negative**: Batches submitted directly by non-relayer clients containing mathematically fabricated P-256 signatures that pass structural checks will cause the transaction to abort at the host level.
