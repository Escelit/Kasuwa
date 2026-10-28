# Security Policy

The Kasuwa team takes the security of smart contracts, cryptographic protocols, and hardware key storage very seriously.

---

## Reporting a Vulnerability

**Do not report security vulnerabilities through public GitHub issues, pull requests, or public discussions.**

If you believe you have discovered a vulnerability, please report it privately:

- **Email**: `security@kasuwa.example.com` (Placeholder contact for disclosures; monitor mailbox)
- **Encryption**: If sensitive proof-of-concept code is attached, please request our PGP public key in your initial reach-out.

### Please Include:

1. Description of the vulnerability, including attack vector and potential impact.
2. Step-by-step reproduction instructions or a minimal executable proof-of-concept.
3. Relevant components (`contracts/allowance-vault`, `packages/protocol`, `apps/mobile/src/native/`, `apps/relayer`).
4. Any proposed remediation or patches.

### Response Timeline

- **Initial Acknowledgment**: Within **72 hours** of receipt.
- **Triage & Assessment**: Within **5 business days** with an severity rating.
- **Coordination**: We will work with you to verify the fix and coordinate a public release with attribution.

---

## Supported Versions

| Component | Version | Supported |
|---|---|---|
| `contracts/allowance-vault` | v0.1.x / Protocol v1 | ✅ |
| `@kasuwa/protocol` | v0.1.x | ✅ |
| `@kasuwa/relayer` | v0.1.x | ✅ |
| `@kasuwa/indexer` | v0.1.x | ✅ |
| `@kasuwa/mobile` | Pre-alpha | ⚠️ Experimental |

---

## Threat Model & Scope Boundaries

Please review `docs/threat-model.md` and `README.md` § "Security model and threat analysis" before reporting.

### Out of Scope by Design:
- **Offline Double-Spending within Escrow Bounds**: Kasuwa explicitly **bounds and attributes** offline double-spending risk rather than claiming to prevent it. A customer deliberately overspending their escrowed allowance across multiple offline merchants is the intended, documented trade-off of an offline-first system.
- **Attacks on Compromised OS**: Vulnerabilities requiring rooted/jailbroken devices where the operating system kernel is fully compromised.
