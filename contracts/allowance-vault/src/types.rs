//! Type definitions for the Kasuwa AllowanceVault smart contract.
//!
//! # Security & Non-Custodial Invariant
//! All escrowed funds are held strictly in non-custodial custody by the vault contract.
//! The administrator powers configured in [`Config`] are strictly administrative and
//! protocol-level (immutable parameter storage, protocol operational boundaries).
//! No administrator function or role has the power or ability to move, withdraw,
//! redirect, or alter escrowed allowance funds. Funds can ONLY move to the merchant
//! explicitly signed by the customer's hardware-backed key in a [`PaymentAuth`],
//! or back to the original allowance owner via `reclaim` once the reclaim window passes.

use soroban_sdk::{contracterror, contracttype, Address, BytesN};

/// Status of an allowance lifecycle.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum Status {
    /// Allowance is active: payments can be issued and settled, top-ups allowed.
    Active = 0,
    /// Owner requested close: no new top-ups allowed; settlement of issued authorizations
    /// continues until the reclaim window opens.
    Closing = 1,
    /// Allowance is closed: unspent funds reclaimed by owner; no further settlements allowed.
    Closed = 2,
}

/// An escrowed allowance deposited by a customer.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Allowance {
    /// The depositor who owns the allowance and can top up, close, or reclaim unspent funds.
    pub owner: Address,
    /// The token address (e.g. USDC SAC) escrowed in this allowance.
    pub token: Address,
    /// Uncompressed secp256r1 public key (65 bytes: 0x04 || X[32] || Y[32]) of the customer's device.
    pub device_key: BytesN<65>,
    /// Remaining, unspent token balance in base units.
    pub balance: i128,
    /// Maximum amount that can be authorized in any single payment from this allowance.
    pub per_payment_cap: i128,
    /// Unix timestamp (seconds) until which authorizations can be issued.
    pub valid_until: u64,
    /// Unix timestamp (seconds) when the owner requested close, if any.
    pub close_requested_at: Option<u64>,
    /// Current lifecycle status.
    pub status: Status,
}

/// Signed payment authorization presented by a customer to a merchant.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PaymentAuth {
    /// Wire protocol version (must be 1).
    pub version: u32,
    /// On-chain identifier of the customer's allowance.
    pub allowance_id: u64,
    /// Unique 128-bit random identifier preventing replay attacks.
    pub payment_id: BytesN<16>,
    /// Merchant address bound as the sole recipient of the funds.
    pub merchant: Address,
    /// Payment amount in token base units.
    pub amount: i128,
    /// Unix timestamp (seconds) when payment was authorized.
    pub issued_at: u64,
    /// Unix timestamp (seconds) when payment expires.
    pub expires_at: u64,
}

/// Result of attempting to settle a payment authorization.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SettleResult {
    /// Fully paid to the merchant.
    Settled,
    /// Partially paid due to insufficient allowance balance: (paid, shortfall).
    Partial(i128, i128),
    /// Rejected without moving funds.
    Rejected(RejectReason),
}

/// Specific, non-reverting reason for settlement rejection.
#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub enum RejectReason {
    /// Cryptographic signature verification failed or signature not in canonical low-S form.
    BadSignature = 0,
    /// Payment authorization has expired based on current ledger timestamp.
    Expired = 1,
    /// Authorized amount exceeds the allowance's per-payment cap.
    OverCap = 2,
    /// Payment ID has already been settled or attempted on this allowance.
    Replay = 3,
    /// Allowance ID was not found or is in an invalid/closed state.
    UnknownAllowance = 4,
    /// Settlement transaction caller/recipient does not match the merchant in authorization.
    WrongMerchant = 5,
    /// Invalid authorization window (issued after valid_until or duration > max_payment_ttl).
    BadWindow = 6,
    /// Allowance balance is zero; payment cannot be honored.
    Insufficient = 7,
}

/// Immutable protocol configuration set during `initialize`.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    /// Protocol administrator address (cannot touch escrowed funds).
    pub admin: Address,
    /// Maximum allowed payment authorization lifetime (`expires_at - issued_at`).
    pub max_payment_ttl: u64,
    /// Grace period added to the reclaim window after expiry to ensure merchants can settle.
    pub grace_period: u64,
    /// Minimum initial allowance deposit.
    pub min_allowance: i128,
    /// Maximum allowed allowance deposit.
    pub max_allowance: i128,
}

/// An on-chain shortfall record attributed to a customer device key.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ShortfallRecord {
    /// Allowance under which the shortfall occurred.
    pub allowance_id: u64,
    /// Merchant who received less than authorized.
    pub merchant: Address,
    /// Unpaid shortfall amount in token base units.
    pub amount: i128,
    /// Unix timestamp when the shortfall was recorded.
    pub timestamp: u64,
}

/// Custom contract errors for fatal operational failures.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    /// Contract is already initialized.
    AlreadyInitialized = 1,
    /// Contract has not been initialized yet.
    NotInitialized = 2,
    /// Allowance deposit amount is outside [min_allowance, max_allowance].
    InvalidAmount = 3,
    /// Valid until timestamp is in the past or invalid.
    InvalidWindow = 4,
    /// Per-payment cap is non-positive or exceeds allowance amount.
    InvalidCap = 5,
    /// Allowance does not exist.
    AllowanceNotFound = 6,
    /// Allowance is not in Active status.
    AllowanceNotActive = 7,
    /// Allowance is already closed.
    AlreadyClosed = 8,
    /// Reclaim attempted before the required settlement and grace window elapsed.
    ReclaimTooEarly = 9,
    /// Checked arithmetic overflow or underflow occurred.
    ArithmeticOverflow = 10,
    /// Caller is not authorized.
    Unauthorized = 11,
    /// Batch exceeds maximum allowed size.
    BatchTooLarge = 12,
}
