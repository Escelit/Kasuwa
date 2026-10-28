# Contributing to Kasuwa

Thank you for contributing to Kasuwa! This project exists to enable offline-first digital payments in places where internet connectivity is intermittent, expensive, or absent.

The `README.md` is the single source of truth for protocol invariants, architecture, and threat analysis. Please review it before starting work.

---

## Getting Started & Development Setup

### Prerequisites

| Tool | Version | Purpose |
|---|---|---|
| Node.js | >= 20.0.0 | TypeScript applications and packages |
| pnpm | >= 9.0.0 | Monorepo package manager |
| Rust | stable (>= 1.79.0) | Smart contract compilation and verification |
| Rust Targets | `wasm32v1-none` or `wasm32-unknown-unknown` | Soroban WASM contract target |
| Stellar CLI | >= 21.0.0 | Building, deploying, and generating contract bindings |
| Docker | recent | Local Stellar Quickstart network, PostgreSQL, Redis |

### Initial Installation

```bash
git clone https://github.com/kasuwa/kasuwa.git
cd kasuwa
pnpm install
```

---

## Branching & Commit Conventions

- **Branching**: `main` is always releasable and green. All work happens on short-lived feature branches (`feat/your-feature`, `fix/issue-description`).
- **Conventional Commits**: Every commit message must follow the Conventional Commits specification, enforced by `commitlint` and `husky`:
  - `feat(...)`: New user or protocol feature
  - `fix(...)`: Bug fix
  - `docs(...)`: Documentation changes
  - `test(...)`: Adding or updating tests
  - `refactor(...)`: Code refactoring without behavior change
  - `chore(...)`: Tooling, build config, dependency bumps
- Keep lines in commit message bodies under 80 characters to adhere to commitlint standards.

---

## Testing Strategy & Running Tests

We test at multiple layers. Tests must accompany every change:

```bash
# 1. Workspace TypeScript & Cargo unit tests
pnpm test

# 2. Cross-language protocol test vectors (Rust & TypeScript)
pnpm test:vectors

# 3. Smart contract unit and property tests (Proptest)
cd contracts
cargo test

# 4. End-to-end integration & double-spend bounded loss verification
pnpm test:e2e

# 5. Full workspace linting and formatting checks
pnpm lint
```

---

## How to Change the Protocol (4-Step Process)

Any modification to `PaymentRequest`, `PaymentAuthorization`, or the message digest wire format must follow this exact sequence:

1. **Update the Protocol Specification**: Document wire changes in `docs/protocol.md` and draft an ADR in `docs/adr/`.
2. **Update Test Vectors**: Add or update test vectors in `test-vectors/payment-auth.json`.
3. **Synchronize Implementations**: Update the Rust contract (`contracts/allowance-vault`) and TypeScript protocol codec (`packages/protocol`) simultaneously until `pnpm test:vectors` passes in both environments.
4. **Bump Version Byte**: If the change is not backwards-compatible, increment the protocol `version` byte.

---

## Code Review & Pull Request Guidelines

1. **Keep Pull Requests Focused**: Prefer small, atomic pull requests that are straightforward to review.
2. **Never Weaken Non-Negotiables**:
   - Offline-first: Neither buyer nor seller requires signal at POS.
   - Non-custodial: No admin function may move escrowed funds.
   - Bounded risk: Bounded loss and attribution; we never claim to prevent double-spending offline.
   - Timestamps: Use Unix seconds for expiry, never ledger numbers.
   - Hardware keys: secp256r1 raw 64-byte `r||s`, normalized to low-S.
3. **Document Invariants**: Ensure property tests and invariants are maintained (`sum(settled) + balance + reclaimed == deposited`).

---

## 🔒 Security-Sensitive Areas (Two Reviewers Required)

The following areas directly handle customer value, cryptographic identity, or fund custody. **Pull requests modifying any of these paths require approval from at least two core maintainers** before merging:

| Path | Sensitive Responsibility |
|---|---|
| `contracts/allowance-vault/` | Escrow custody, signature verification, reclaim countdowns, and balance math |
| `packages/protocol/` | Binary serialization, message hashing, domain separation, and low-S normalization |
| `apps/mobile/src/native/` | Secure Enclave (iOS) and Android Keystore / StrongBox hardware key bridges |
| `apps/relayer/src/signers/` | Relayer fee-payer accounts and KMS signing integrations (`infra/kms`) |

Never bypass, weaken, or disable cryptographic checks, signature validation, or timepoint assertions.
