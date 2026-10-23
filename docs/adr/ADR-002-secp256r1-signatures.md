# ADR-002: secp256r1 as Primary Signature Scheme

## Status
Accepted

## Context
Kasuwa's threat model assumes customer device keys must be hardware-protected (Threat T8) and non-exportable.
- Standard consumer mobile hardware—iOS Secure Enclave and Android Keystore / StrongBox Keymaster—natively supports NIST P-256 (`secp256r1`) cryptographic key generation and hardware-isolated signing.
- Ed25519 is widely used across Stellar and Soroban accounts, but iOS Secure Enclave does not support Ed25519 key generation or raw private key isolation. Software implementations of Ed25519 would leave private keys vulnerable to extraction on compromised or rooted OS environments.

## Decision
We adopt **`secp256r1`** (NIST P-256 with SHA-256) as the primary signature scheme for all offline customer payment authorizations.
- Verification on-chain uses Soroban's native secp256r1 host functions.
- Keystores providing ASN.1 DER signatures are converted to canonical raw 64-byte `r || s` format with mandatory low-S normalization ($s \le \lfloor n/2 \rfloor$) before QR generation.
- An Ed25519 fallback is maintained only for development environments and specialized hardware.

## Consequences
- **Positive**: Direct hardware protection on billions of standard consumer smartphones.
- **Positive**: Non-exportable keys protected by biometrics (Face ID, Touch ID, fingerprint).
- **Negative**: Secp256r1 verification on-chain requires careful enforcement of low-S normalization to prevent signature malleability.
