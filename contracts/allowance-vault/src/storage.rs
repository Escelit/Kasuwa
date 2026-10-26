//! Storage management and TTL extension helpers for the Kasuwa AllowanceVault.
//!
//! # Non-Custodial Security Notice
//! This module encapsulates all direct storage reads and writes for the `AllowanceVault`
//! contract. Administrators configured in [`crate::types::Config`] are strictly protocol
//! operators and have NO programmatic access or storage mutations that can touch,
//! reallocate, freeze, or redirect escrowed funds. Funds can only be moved according
//! to valid customer signatures or the deterministic, time-locked reclaim mechanism.
//!
//! # Storage Model
//! - **Instance Storage**:
//!   - `DataKey::Config`: Singleton protocol parameters.
//!   - `DataKey::AllowanceCounter`: Monotonic ID counter for newly created allowances.
//! - **Persistent Storage**:
//!   - `DataKey::Allowance(u64)`: Persistent allowance state per customer deposit.
//!   - `DataKey::UsedPayment(u64, BytesN<16>)`: Replay-prevention markers for used payment IDs.
//!   - `DataKey::Shortfalls(BytesN<65>)`: Audit trail of unpaid shortfalls keyed by device key.
//!
//! All read and write operations apply TTL extensions (`extend_instance_ttl` or
//! `extend_persistent_ttl`) to ensure live records are not archived prematurely.

use crate::types::{Allowance, Config, ShortfallRecord, VaultError};
use soroban_sdk::{contracttype, BytesN, Env, Vec};

/// Minimum ledgers remaining before extending TTL (~1 day at 5s/ledger).
pub const STORAGE_TTL_THRESHOLD: u32 = 17_280;
/// Extension duration in ledgers (~30 days at 5s/ledger).
pub const STORAGE_TTL_EXTEND: u32 = 518_400;

/// Storage keys for the contract.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    /// Singleton protocol configuration in instance storage.
    Config,
    /// Monotonic allowance ID counter in instance storage.
    AllowanceCounter,
    /// Allowance record in persistent storage: u64 -> Allowance.
    Allowance(u64),
    /// Used payment marker in persistent storage: (allowance_id, payment_id) -> bool.
    UsedPayment(u64, BytesN<16>),
    /// Shortfalls attributed to a device key: BytesN<65> -> Vec<ShortfallRecord>.
    Shortfalls(BytesN<65>),
}

// ---------------------------------------------------------------------------
// TTL Extension Helpers
// ---------------------------------------------------------------------------

/// Extends the TTL for instance storage entries (Config, AllowanceCounter).
pub fn extend_instance_ttl(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(STORAGE_TTL_THRESHOLD, STORAGE_TTL_EXTEND);
}

/// Extends the TTL for a persistent storage key if it exists.
pub fn extend_persistent_ttl(env: &Env, key: &DataKey) {
    if env.storage().persistent().has(key) {
        env.storage()
            .persistent()
            .extend_ttl(key, STORAGE_TTL_THRESHOLD, STORAGE_TTL_EXTEND);
    }
}

// ---------------------------------------------------------------------------
// Config Storage (Instance)
// ---------------------------------------------------------------------------

/// Returns true if protocol configuration has already been initialized.
pub fn has_config(env: &Env) -> bool {
    let has = env.storage().instance().has(&DataKey::Config);
    if has {
        extend_instance_ttl(env);
    }
    has
}

/// Reads the protocol configuration from instance storage.
pub fn get_config(env: &Env) -> Result<Config, VaultError> {
    extend_instance_ttl(env);
    env.storage()
        .instance()
        .get(&DataKey::Config)
        .ok_or(VaultError::NotInitialized)
}

/// Stores the protocol configuration in instance storage.
pub fn set_config(env: &Env, config: &Config) {
    env.storage().instance().set(&DataKey::Config, config);
    extend_instance_ttl(env);
}

// ---------------------------------------------------------------------------
// Allowance Counter Storage (Instance)
// ---------------------------------------------------------------------------

/// Returns the current allowance counter without incrementing.
pub fn get_allowance_counter(env: &Env) -> u64 {
    extend_instance_ttl(env);
    env.storage()
        .instance()
        .get(&DataKey::AllowanceCounter)
        .unwrap_or(0u64)
}

/// Increments the allowance counter with checked arithmetic and returns the new ID.
pub fn next_allowance_id(env: &Env) -> Result<u64, VaultError> {
    let current = get_allowance_counter(env);
    let next = current
        .checked_add(1)
        .ok_or(VaultError::ArithmeticOverflow)?;
    env.storage()
        .instance()
        .set(&DataKey::AllowanceCounter, &next);
    extend_instance_ttl(env);
    Ok(next)
}

// ---------------------------------------------------------------------------
// Allowance Storage (Persistent)
// ---------------------------------------------------------------------------

/// Checks if an allowance exists in persistent storage.
pub fn has_allowance(env: &Env, id: u64) -> bool {
    let key = DataKey::Allowance(id);
    let has = env.storage().persistent().has(&key);
    if has {
        extend_persistent_ttl(env, &key);
    }
    has
}

/// Loads an allowance from persistent storage without extending TTL (pure view).
pub fn get_allowance_view(env: &Env, id: u64) -> Option<Allowance> {
    let key = DataKey::Allowance(id);
    env.storage().persistent().get(&key)
}

/// Loads an allowance from persistent storage, extending TTL if present.
pub fn get_allowance(env: &Env, id: u64) -> Option<Allowance> {
    let key = DataKey::Allowance(id);
    let allowance: Option<Allowance> = env.storage().persistent().get(&key);
    if allowance.is_some() {
        extend_persistent_ttl(env, &key);
    }
    allowance
}

/// Stores or updates an allowance in persistent storage and extends TTL.
pub fn set_allowance(env: &Env, id: u64, allowance: &Allowance) {
    let key = DataKey::Allowance(id);
    env.storage().persistent().set(&key, allowance);
    extend_persistent_ttl(env, &key);
}

/// Explicitly extends persistent TTL for an allowance entry.
pub fn extend_allowance_ttl(env: &Env, id: u64) {
    let key = DataKey::Allowance(id);
    if env.storage().persistent().has(&key) {
        extend_persistent_ttl(env, &key);
    }
}

// ---------------------------------------------------------------------------
// Used Payment IDs (Persistent)
// Keyed by (allowance_id, payment_id)
// ---------------------------------------------------------------------------

/// Checks if a payment ID has already been settled or attempted for an allowance.
pub fn is_payment_used(env: &Env, allowance_id: u64, payment_id: &BytesN<16>) -> bool {
    let key = DataKey::UsedPayment(allowance_id, payment_id.clone());
    let used = env.storage().persistent().has(&key);
    if used {
        extend_persistent_ttl(env, &key);
    }
    used
}

/// Marks a payment ID as used for an allowance in persistent storage.
pub fn mark_payment_used(env: &Env, allowance_id: u64, payment_id: &BytesN<16>) {
    let key = DataKey::UsedPayment(allowance_id, payment_id.clone());
    env.storage().persistent().set(&key, &true);
    extend_persistent_ttl(env, &key);
}

// ---------------------------------------------------------------------------
// Shortfall Records (Persistent)
// Keyed by device_key -> Vec<ShortfallRecord>
// ---------------------------------------------------------------------------

/// Retrieves the shortfall history recorded against a device key without extending TTL (pure view).
pub fn get_shortfalls_view(env: &Env, device_key: &BytesN<65>) -> Vec<ShortfallRecord> {
    let key = DataKey::Shortfalls(device_key.clone());
    env.storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env))
}

/// Retrieves the shortfall history recorded against a device key.
pub fn get_shortfalls(env: &Env, device_key: &BytesN<65>) -> Vec<ShortfallRecord> {
    let key = DataKey::Shortfalls(device_key.clone());
    let records = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    extend_persistent_ttl(env, &key);
    records
}

/// Records a new shortfall against a device key in persistent storage.
pub fn record_shortfall(env: &Env, device_key: &BytesN<65>, record: &ShortfallRecord) {
    let key = DataKey::Shortfalls(device_key.clone());
    let mut records: Vec<ShortfallRecord> = env
        .storage()
        .persistent()
        .get(&key)
        .unwrap_or_else(|| Vec::new(env));
    records.push_back(record.clone());
    env.storage().persistent().set(&key, &records);
    extend_persistent_ttl(env, &key);
}
