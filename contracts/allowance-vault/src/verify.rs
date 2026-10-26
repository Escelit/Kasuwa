//! Cryptographic verification and message hashing for Kasuwa PaymentAuthorizations.
//!
//! # Protocol Compliance
//! Implements the signed message construction specified in `docs/protocol.md` §3.1:
//! `SHA-256(domain_tag || canonical_bytes(PaymentAuth) || contract_id || network_id)`
//!
//! # Signature Scheme
//! Signatures use secp256r1 (NIST P-256) over SHA-256 with mandatory low-S normalization
//! ($s \le \lfloor n / 2 \rfloor$). High-S signatures are rejected to eliminate ECDSA
//! signature malleability (Threat T11).
//!
//! # Host Function Failure Handling (ADR-006)
//! Soroban's `env.crypto().secp256r1_verify` raises a `HostError(Crypto, InvalidInput)`
//! on invalid signatures. In-contract self-invocation via `try_invoke_contract` is disallowed
//! by the Soroban runtime (`Context, InvalidAction`). Therefore, this module strictly
//! pre-validates all structural properties (version, uncompressed key prefix, low-S, address)
//! before calling the host function. In production, the relayer pre-validates signatures
//! before submission (see `docs/adr/ADR-006-secp256r1-verification-error-handling.md`).

use crate::types::{PaymentAuth, RejectReason};
use soroban_sdk::{address_payload::AddressPayload, crypto::Hash, Address, Bytes, BytesN, Env};

/// 22-byte domain separation tag for payment authorization signed messages.
pub const DOMAIN_TAG: &[u8] = b"kasuwa-v1:payment-auth";

/// Half curve order floor(n / 2) for secp256r1 (NIST P-256).
pub const SECP256R1_HALF_N: [u8; 32] = [
    0x7F, 0xFF, 0xFF, 0xFF, 0x80, 0x00, 0x00, 0x00, 0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF,
    0xDE, 0x73, 0x7D, 0x56, 0xD3, 0x8B, 0xCE, 0xF2, 0x79, 0xDC, 0x65, 0x61, 0x7E, 0x31, 0x92, 0xA8,
];

/// Extracts the raw 32 bytes of a Stellar account or contract address.
pub fn address_to_bytes(address: &Address) -> Option<BytesN<32>> {
    match address.to_payload() {
        Some(AddressPayload::AccountIdPublicKeyEd25519(bytes)) => Some(bytes),
        Some(AddressPayload::ContractIdHash(bytes)) => Some(bytes),
        _ => None,
    }
}

/// Checks whether an ECDSA signature is normalized to canonical low-S form ($s \le \lfloor n / 2 \rfloor$).
pub fn is_low_s(signature: &BytesN<64>) -> bool {
    let mut sig_bytes = [0u8; 64];
    signature.copy_into_slice(&mut sig_bytes);
    let s = &sig_bytes[32..64];
    s <= &SECP256R1_HALF_N
}

/// Encodes a `PaymentAuth` into canonical binary bytes for hashing.
///
/// Layout:
/// - version (1 byte, u8)
/// - allowance_id (8 bytes, u64 BE)
/// - payment_id (16 bytes, raw)
/// - merchant (32 bytes, raw account/contract bytes)
/// - amount (1-10 bytes, unsigned LEB128 varint)
/// - issued_at (5 bytes, u40 BE)
/// - expires_at (5 bytes, u40 BE)
pub fn encode_payment_auth_canonical(env: &Env, auth: &PaymentAuth) -> Option<Bytes> {
    let merchant_bytes = address_to_bytes(&auth.merchant)?;

    let mut canonical = Bytes::new(env);
    // 1. version
    canonical.push_back(auth.version as u8);

    // 2. allowance_id (8 bytes BE)
    let allowance_bytes = auth.allowance_id.to_be_bytes();
    for b in allowance_bytes {
        canonical.push_back(b);
    }

    // 3. payment_id (16 bytes)
    for b in auth.payment_id.to_array() {
        canonical.push_back(b);
    }

    // 4. merchant (32 bytes)
    for b in merchant_bytes.to_array() {
        canonical.push_back(b);
    }

    // 5. amount (LEB128 varint)
    if auth.amount < 0 {
        return None;
    }
    let mut amount_val = auth.amount as u64;
    while amount_val >= 0x80 {
        canonical.push_back(((amount_val & 0x7f) as u8) | 0x80);
        amount_val >>= 7;
    }
    canonical.push_back((amount_val & 0x7f) as u8);

    // 6. issued_at (5 bytes u40 BE)
    canonical.push_back(((auth.issued_at >> 32) & 0xff) as u8);
    canonical.push_back(((auth.issued_at >> 24) & 0xff) as u8);
    canonical.push_back(((auth.issued_at >> 16) & 0xff) as u8);
    canonical.push_back(((auth.issued_at >> 8) & 0xff) as u8);
    canonical.push_back((auth.issued_at & 0xff) as u8);

    // 7. expires_at (5 bytes u40 BE)
    canonical.push_back(((auth.expires_at >> 32) & 0xff) as u8);
    canonical.push_back(((auth.expires_at >> 24) & 0xff) as u8);
    canonical.push_back(((auth.expires_at >> 16) & 0xff) as u8);
    canonical.push_back(((auth.expires_at >> 8) & 0xff) as u8);
    canonical.push_back((auth.expires_at & 0xff) as u8);

    Some(canonical)
}

/// Constructs the domain-separated message and computes its 32-byte SHA-256 digest:
/// `SHA-256(domain_tag || canonical_bytes(PaymentAuth) || contract_id || network_id)`
pub fn compute_payment_auth_digest(
    env: &Env,
    auth: &PaymentAuth,
    contract_id: &BytesN<32>,
    network_id: &BytesN<32>,
) -> Option<Hash<32>> {
    let canonical = encode_payment_auth_canonical(env, auth)?;
    let mut msg = Bytes::new(env);

    for b in DOMAIN_TAG {
        msg.push_back(*b);
    }
    msg.append(&canonical);
    for b in contract_id.to_array() {
        msg.push_back(b);
    }
    for b in network_id.to_array() {
        msg.push_back(b);
    }

    Some(env.crypto().sha256(&msg))
}

/// Verifies a `PaymentAuth` signature using Soroban's secp256r1 host function.
///
/// Pre-validates version, key format, low-S normalization, and merchant address.
/// Then invokes `env.crypto().secp256r1_verify` on the computed digest.
pub fn verify_authorization(
    env: &Env,
    device_key: &BytesN<65>,
    auth: &PaymentAuth,
    signature: &BytesN<64>,
    contract_id: &BytesN<32>,
    network_id: &BytesN<32>,
) -> Result<(), RejectReason> {
    // 1. Check version
    if auth.version != 1 {
        return Err(RejectReason::BadSignature);
    }

    // 2. Check uncompressed SEC-1 public key prefix (0x04)
    if device_key.to_array()[0] != 0x04 {
        return Err(RejectReason::BadSignature);
    }

    // 3. Enforce low-S
    if !is_low_s(signature) {
        return Err(RejectReason::BadSignature);
    }

    // 4. Ensure merchant address can be resolved to raw 32 bytes
    if address_to_bytes(&auth.merchant).is_none() {
        return Err(RejectReason::WrongMerchant);
    }

    // 5. Compute message digest
    let digest = compute_payment_auth_digest(env, auth, contract_id, network_id)
        .ok_or(RejectReason::BadSignature)?;

    // 6. Host verification: verifies secp256r1 signature over 32-byte digest
    env.crypto()
        .secp256r1_verify(device_key, &digest, signature);
    Ok(())
}
