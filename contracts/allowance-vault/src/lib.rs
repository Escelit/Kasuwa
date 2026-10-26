#![no_std]

pub mod storage;
pub mod types;
pub mod verify;

use crate::types::{
    Allowance, Config, PaymentAuth, RejectReason, SettleResult, ShortfallRecord, Status, VaultError,
};
use soroban_sdk::{contract, contractimpl, symbol_short, token, Address, BytesN, Env};

#[contract]
pub struct AllowanceVault;

#[contractimpl]
#[allow(deprecated)]
impl AllowanceVault {
    /// One-time initialization of protocol configuration.
    ///
    /// # Invariant & Non-Custodial Powers
    /// The admin address set here holds strictly administrative metadata.
    /// The admin CANNOT touch, withdraw, freeze, or redirect escrowed allowance funds.
    pub fn initialize(
        env: Env,
        admin: Address,
        max_payment_ttl: u64,
        grace_period: u64,
        min_allowance: i128,
        max_allowance: i128,
    ) -> Result<(), VaultError> {
        if storage::has_config(&env) {
            return Err(VaultError::AlreadyInitialized);
        }

        if min_allowance <= 0 || max_allowance < min_allowance || max_payment_ttl == 0 {
            return Err(VaultError::InvalidAmount);
        }

        let config = Config {
            admin: admin.clone(),
            max_payment_ttl,
            grace_period,
            min_allowance,
            max_allowance,
        };
        storage::set_config(&env, &config);

        env.events().publish(
            (symbol_short!("init"), admin),
            (max_payment_ttl, grace_period, min_allowance, max_allowance),
        );

        Ok(())
    }

    /// Creates and escrows a new offline allowance.
    ///
    /// Requires owner authorization and transfers `amount` tokens from owner into contract custody.
    pub fn create_allowance(
        env: Env,
        owner: Address,
        token: Address,
        amount: i128,
        valid_until: u64,
        device_key: BytesN<65>,
        per_payment_cap: i128,
    ) -> Result<u64, VaultError> {
        owner.require_auth();

        let config = storage::get_config(&env)?;

        // Validate amount
        if amount < config.min_allowance || amount > config.max_allowance {
            return Err(VaultError::InvalidAmount);
        }

        // Validate valid_until
        let now = env.ledger().timestamp();
        if valid_until <= now {
            return Err(VaultError::InvalidWindow);
        }

        // Validate per_payment_cap
        if per_payment_cap <= 0 || per_payment_cap > amount {
            return Err(VaultError::InvalidCap);
        }

        // Validate device key SEC-1 format (must be 0x04 uncompressed)
        if device_key.to_array()[0] != 0x04 {
            return Err(VaultError::InvalidCap);
        }

        // Transfer tokens from customer into contract escrow
        let contract_address = env.current_contract_address();
        token::Client::new(&env, &token).transfer(&owner, &contract_address, &amount);

        // Allocate monotonic ID
        let allowance_id = storage::next_allowance_id(&env)?;

        let allowance = Allowance {
            owner: owner.clone(),
            token: token.clone(),
            device_key,
            balance: amount,
            per_payment_cap,
            valid_until,
            close_requested_at: None,
            status: Status::Active,
        };

        storage::set_allowance(&env, allowance_id, &allowance);

        env.events().publish(
            (symbol_short!("created"), allowance_id),
            (owner, token, amount, valid_until, per_payment_cap),
        );

        Ok(allowance_id)
    }

    /// Adds funds to an existing active allowance.
    ///
    /// Requires owner authorization. Only permitted while allowance is Active.
    /// Does NOT shorten any valid_until or close window.
    pub fn top_up(env: Env, allowance_id: u64, amount: i128) -> Result<(), VaultError> {
        let mut allowance =
            storage::get_allowance(&env, allowance_id).ok_or(VaultError::AllowanceNotFound)?;

        allowance.owner.require_auth();

        if allowance.status != Status::Active {
            return Err(VaultError::AllowanceNotActive);
        }

        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }

        allowance.balance = allowance
            .balance
            .checked_add(amount)
            .ok_or(VaultError::ArithmeticOverflow)?;

        // Transfer funds from owner to contract
        let contract_address = env.current_contract_address();
        token::Client::new(&env, &allowance.token).transfer(
            &allowance.owner,
            &contract_address,
            &amount,
        );

        storage::set_allowance(&env, allowance_id, &allowance);

        env.events().publish(
            (symbol_short!("top_up"), allowance_id),
            (allowance.owner, amount, allowance.balance),
        );

        Ok(())
    }

    /// Requests premature close of an active allowance (e.g. lost phone).
    ///
    /// Requires owner authorization. Transitions status from Active to Closing.
    /// Freezes further top-ups, but allows already-issued offline authorizations to settle
    /// until the reclaim settlement window elapses.
    pub fn request_close(env: Env, allowance_id: u64) -> Result<(), VaultError> {
        let mut allowance =
            storage::get_allowance(&env, allowance_id).ok_or(VaultError::AllowanceNotFound)?;

        allowance.owner.require_auth();

        if allowance.status != Status::Active {
            return Err(VaultError::AllowanceNotActive);
        }

        let now = env.ledger().timestamp();
        allowance.status = Status::Closing;
        allowance.close_requested_at = Some(now);

        storage::set_allowance(&env, allowance_id, &allowance);

        env.events().publish(
            (symbol_short!("close_req"), allowance_id),
            (allowance.owner, now),
        );

        Ok(())
    }

    /// Reclaims unspent escrowed funds back to the allowance owner.
    ///
    /// Requires owner authorization. Allowed only after:
    /// `now >= max(valid_until, close_requested_at.unwrap_or(0)) + max_payment_ttl + grace`
    ///
    /// Moves remaining balance to owner and marks allowance Closed.
    /// Idempotent-safe: subsequent calls return Err(VaultError::AlreadyClosed) without moving funds.
    pub fn reclaim(env: Env, allowance_id: u64) -> Result<i128, VaultError> {
        let mut allowance =
            storage::get_allowance(&env, allowance_id).ok_or(VaultError::AllowanceNotFound)?;

        allowance.owner.require_auth();

        if allowance.status == Status::Closed {
            return Err(VaultError::AlreadyClosed);
        }

        let config = storage::get_config(&env)?;
        let close_req = allowance.close_requested_at.unwrap_or(0);
        let base_time = allowance.valid_until.max(close_req);

        let window_end = base_time
            .checked_add(config.max_payment_ttl)
            .and_then(|t| t.checked_add(config.grace_period))
            .ok_or(VaultError::ArithmeticOverflow)?;

        let now = env.ledger().timestamp();
        if now < window_end {
            return Err(VaultError::ReclaimTooEarly);
        }

        let remaining = allowance.balance;
        allowance.balance = 0;
        allowance.status = Status::Closed;
        storage::set_allowance(&env, allowance_id, &allowance);

        if remaining > 0 {
            let contract_address = env.current_contract_address();
            token::Client::new(&env, &allowance.token).transfer(
                &contract_address,
                &allowance.owner,
                &remaining,
            );
        }

        env.events().publish(
            (symbol_short!("reclaim"), allowance_id),
            (allowance.owner, remaining),
        );

        Ok(remaining)
    }

    /// Settles an authorized payment on-chain.
    ///
    /// Permissionless: anyone (relayer, merchant, third party) may submit authorizations.
    /// Checks conditions in strict sequence and returns a `SettleResult` rather than panicking.
    pub fn settle(env: Env, auth: PaymentAuth, signature: BytesN<64>) -> SettleResult {
        // 1. Check allowance exists and is not closed
        let mut allowance = match storage::get_allowance(&env, auth.allowance_id) {
            Some(a) => {
                if a.status == Status::Closed {
                    return SettleResult::Rejected(RejectReason::UnknownAllowance);
                }
                a
            }
            None => return SettleResult::Rejected(RejectReason::UnknownAllowance),
        };

        // 2. Check protocol version
        if auth.version != 1 {
            return SettleResult::Rejected(RejectReason::BadSignature);
        }

        // 3. Check signature valid against device_key
        let contract_id = match verify::address_to_bytes(&env.current_contract_address()) {
            Some(id) => id,
            None => return SettleResult::Rejected(RejectReason::BadSignature),
        };
        let network_id = env.ledger().network_id();

        if verify::verify_authorization(
            &env,
            &allowance.device_key,
            &auth,
            &signature,
            &contract_id,
            &network_id,
        )
        .is_err()
        {
            return SettleResult::Rejected(RejectReason::BadSignature);
        }

        // 4. Check expiration: now <= expires_at
        let now = env.ledger().timestamp();
        if now > auth.expires_at {
            return SettleResult::Rejected(RejectReason::Expired);
        }

        // 5. Check authorization window
        let config = match storage::get_config(&env) {
            Ok(c) => c,
            Err(_) => return SettleResult::Rejected(RejectReason::UnknownAllowance),
        };
        if auth.issued_at > allowance.valid_until
            || auth.expires_at.saturating_sub(auth.issued_at) > config.max_payment_ttl
        {
            return SettleResult::Rejected(RejectReason::BadWindow);
        }

        // 6. Check per_payment_cap
        if auth.amount <= 0 || auth.amount > allowance.per_payment_cap {
            return SettleResult::Rejected(RejectReason::OverCap);
        }

        // 7. Check replay protection
        if storage::is_payment_used(&env, auth.allowance_id, &auth.payment_id) {
            return SettleResult::Rejected(RejectReason::Replay);
        }

        // Settlement execution with checked arithmetic
        if allowance.balance >= auth.amount {
            // Full settlement
            allowance.balance = match allowance.balance.checked_sub(auth.amount) {
                Some(b) => b,
                None => return SettleResult::Rejected(RejectReason::Insufficient),
            };

            storage::set_allowance(&env, auth.allowance_id, &allowance);
            storage::mark_payment_used(&env, auth.allowance_id, &auth.payment_id);

            let contract_address = env.current_contract_address();
            token::Client::new(&env, &allowance.token).transfer(
                &contract_address,
                &auth.merchant,
                &auth.amount,
            );

            env.events().publish(
                (symbol_short!("settle"), auth.allowance_id, auth.payment_id),
                (auth.merchant, auth.amount, 0u32 /* Settled */),
            );

            SettleResult::Settled
        } else if allowance.balance > 0 {
            // Partial settlement
            let paid = allowance.balance;
            let shortfall = match auth.amount.checked_sub(paid) {
                Some(s) => s,
                None => return SettleResult::Rejected(RejectReason::Insufficient),
            };

            allowance.balance = 0;
            storage::set_allowance(&env, auth.allowance_id, &allowance);
            storage::mark_payment_used(&env, auth.allowance_id, &auth.payment_id);

            let record = ShortfallRecord {
                allowance_id: auth.allowance_id,
                merchant: auth.merchant.clone(),
                amount: shortfall,
                timestamp: now,
            };
            storage::record_shortfall(&env, &allowance.device_key, &record);

            let contract_address = env.current_contract_address();
            token::Client::new(&env, &allowance.token).transfer(
                &contract_address,
                &auth.merchant,
                &paid,
            );

            env.events().publish(
                (symbol_short!("settle"), auth.allowance_id, auth.payment_id),
                (auth.merchant, paid, shortfall, 1u32 /* Partial */),
            );

            SettleResult::Partial(paid, shortfall)
        } else {
            // Insufficient balance (balance == 0)
            let shortfall = auth.amount;
            storage::mark_payment_used(&env, auth.allowance_id, &auth.payment_id);

            let record = ShortfallRecord {
                allowance_id: auth.allowance_id,
                merchant: auth.merchant.clone(),
                amount: shortfall,
                timestamp: now,
            };
            storage::record_shortfall(&env, &allowance.device_key, &record);

            env.events().publish(
                (symbol_short!("settle"), auth.allowance_id, auth.payment_id),
                (
                    auth.merchant,
                    0i128,
                    shortfall,
                    2u32, /* Insufficient */
                ),
            );

            SettleResult::Rejected(RejectReason::Insufficient)
        }
    }
}

#[cfg(test)]
extern crate std;

#[cfg(test)]
mod test;
