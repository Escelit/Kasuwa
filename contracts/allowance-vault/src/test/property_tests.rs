use crate::types::{PaymentAuth, RejectReason, SettleResult, Status, VaultError};
use crate::verify::{address_to_bytes, compute_payment_auth_digest};
use crate::AllowanceVault;
use p256::ecdsa::signature::hazmat::PrehashSigner;
use p256::pkcs8::DecodePrivateKey;
use proptest::prelude::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env,
};
use std::collections::HashSet;
use std::vec::Vec as StdVec;

const TEST_PKCS8: &str = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b020101042089aade911074130cddf3aedd6e59f4372dd1c953c73cd28b7398b28f73beafbba14403420004e802e2689071e7b0726c0c5ea1fb8cd9ee11b91ea05605d456a2e257fb311cbbc56f14c8218617d44277760655e156a3cc32eac09ac0b09237c9db6745159d0d";
const TEST_PUBKEY: &str = "04e802e2689071e7b0726c0c5ea1fb8cd9ee11b91ea05605d456a2e257fb311cbbc56f14c8218617d44277760655e156a3cc32eac09ac0b09237c9db6745159d0d";

#[derive(Clone, Debug)]
enum Step {
    TopUp(i128),
    SettleValid { amount: i128, id_idx: u8 },
    SettleInvalidSig { amount: i128, id_idx: u8 },
    SettleOverCap { id_idx: u8 },
    RequestClose,
    AdvanceTime(u64),
    Reclaim,
}

fn step_strategy() -> impl Strategy<Value = Step> {
    prop_oneof![
        // Top up between 1 USDC and 50 USDC
        (1_000_000i128..=50_000_000i128).prop_map(Step::TopUp),
        // Valid settlement with small pool of 8 payment IDs to trigger replays
        (1_000_000i128..=10_000_000i128, 0u8..8u8)
            .prop_map(|(amount, id_idx)| Step::SettleValid { amount, id_idx }),
        // Invalid signature attempt
        (1_000_000i128..=10_000_000i128, 0u8..8u8)
            .prop_map(|(amount, id_idx)| Step::SettleInvalidSig { amount, id_idx }),
        // Over cap attempt (15 USDC > 10 USDC cap)
        (0u8..8u8).prop_map(|id_idx| Step::SettleOverCap { id_idx }),
        // Request close
        Just(Step::RequestClose),
        // Advance time from 10 minutes to 3 days
        (600u64..=259200u64).prop_map(Step::AdvanceTime),
        // Attempt reclaim
        Just(Step::Reclaim),
    ]
}

fn run_property_sequence(steps: StdVec<Step>) {
    let env = Env::default();
    env.mock_all_auths();
    let start_time = 1700000000u64;
    env.ledger().set_timestamp(start_time);

    let admin = Address::generate(&env);
    let owner = Address::generate(&env);
    let merchant = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_contract = env.register_stellar_asset_contract_v2(token_admin);
    let token_address = token_contract.address();
    let token_client = token::Client::new(&env, &token_address);
    let stellar_admin = token::StellarAssetClient::new(&env, &token_address);

    let vault_id = env.register(AllowanceVault, ());
    let vault_client = crate::AllowanceVaultClient::new(&env, &vault_id);

    let max_payment_ttl = 86400u64; // 24 hours
    let grace_period = 3600u64; // 1 hour
    vault_client.initialize(
        &admin,
        &max_payment_ttl,
        &grace_period,
        &1_000_000,
        &1_000_000_000,
    );

    // Initial deposit: 100 USDC; Per-payment cap: 10 USDC; Valid until: start + 7 days
    let initial_deposit = 100_000_000i128;
    let cap = 10_000_000i128;
    let valid_until = start_time + 7 * 86400;

    // Mint huge pool to owner for repeated top-ups
    stellar_admin.mint(&owner, &10_000_000_000);

    let pkcs8_bytes = hex::decode(TEST_PKCS8).unwrap();
    let signing_key = p256::ecdsa::SigningKey::from_pkcs8_der(&pkcs8_bytes).unwrap();
    let mut pub_arr = [0u8; 65];
    hex::decode_to_slice(TEST_PUBKEY, &mut pub_arr).unwrap();
    let device_key = BytesN::from_array(&env, &pub_arr);

    let allowance_id = vault_client.create_allowance(
        &owner,
        &token_address,
        &initial_deposit,
        &valid_until,
        &device_key,
        &cap,
    );

    let sign_auth_fn = |auth: &PaymentAuth| -> BytesN<64> {
        let contract_id = address_to_bytes(&vault_id).unwrap();
        let network_id = env.ledger().network_id();
        let digest = compute_payment_auth_digest(&env, auth, &contract_id, &network_id).unwrap();
        let (raw_sig, _) = signing_key.sign_prehash(&digest.to_array()).unwrap();
        let low_s = raw_sig.normalize_s().unwrap_or(raw_sig);
        let sig_arr: [u8; 64] = low_s.to_bytes().into();
        BytesN::from_array(&env, &sig_arr)
    };

    // Tracking model variables
    let mut deposited = initial_deposit;
    let mut settled_sum = 0i128;
    let mut reclaimed_sum = 0i128;
    let mut settled_payment_ids = HashSet::new();

    for step in steps {
        match step {
            Step::TopUp(amount) => {
                let res = vault_client.try_top_up(&allowance_id, &amount);
                if res.is_ok() {
                    deposited += amount;
                }
            }
            Step::SettleValid { amount, id_idx } => {
                let mut p_bytes = [0u8; 16];
                p_bytes[0] = id_idx;
                let payment_id = BytesN::from_array(&env, &p_bytes);

                let auth = PaymentAuth {
                    version: 1,
                    allowance_id,
                    payment_id: payment_id.clone(),
                    merchant: merchant.clone(),
                    amount,
                    issued_at: env.ledger().timestamp(),
                    expires_at: env.ledger().timestamp() + 3600,
                };
                let sig = sign_auth_fn(&auth);

                let result = vault_client.settle(&auth, &sig);
                match result {
                    SettleResult::Settled => {
                        // Invariant 2: a payment_id settles at most once
                        assert!(
                            settled_payment_ids.insert(p_bytes),
                            "Invariant 2 violated: payment_id settled more than once!"
                        );
                        // Invariant 5: no single payment exceeds cap
                        assert!(amount <= cap, "Invariant 5 violated: payment exceeded cap!");
                        settled_sum += amount;
                    }
                    SettleResult::Partial(paid, _) => {
                        // Invariant 2: a payment_id settles at most once
                        assert!(
                            settled_payment_ids.insert(p_bytes),
                            "Invariant 2 violated: payment_id settled more than once!"
                        );
                        // Invariant 5: no single payment exceeds cap
                        assert!(
                            paid <= cap,
                            "Invariant 5 violated: partial paid exceeded cap!"
                        );
                        settled_sum += paid;
                    }
                    SettleResult::Rejected(_) => {}
                }
            }
            Step::SettleInvalidSig { amount, id_idx } => {
                let mut p_bytes = [0u8; 16];
                p_bytes[0] = id_idx;
                let payment_id = BytesN::from_array(&env, &p_bytes);

                let auth = PaymentAuth {
                    version: 1,
                    allowance_id,
                    payment_id,
                    merchant: merchant.clone(),
                    amount,
                    issued_at: env.ledger().timestamp(),
                    expires_at: env.ledger().timestamp() + 3600,
                };
                // High S invalid signature
                let mut bad_sig = [0u8; 64];
                bad_sig[32] = 0xFF;
                let sig = BytesN::from_array(&env, &bad_sig);

                let result = vault_client.settle(&auth, &sig);
                assert!(
                    matches!(
                        result,
                        SettleResult::Rejected(RejectReason::BadSignature)
                            | SettleResult::Rejected(RejectReason::UnknownAllowance)
                    ),
                    "Expected BadSignature or UnknownAllowance, got {:?}",
                    result
                );
            }
            Step::SettleOverCap { id_idx } => {
                let mut p_bytes = [0u8; 16];
                p_bytes[0] = id_idx;
                let payment_id = BytesN::from_array(&env, &p_bytes);

                let auth = PaymentAuth {
                    version: 1,
                    allowance_id,
                    payment_id,
                    merchant: merchant.clone(),
                    amount: cap + 1_000_000, // 1 USDC over cap
                    issued_at: env.ledger().timestamp(),
                    expires_at: env.ledger().timestamp() + 3600,
                };
                let sig = sign_auth_fn(&auth);

                let result = vault_client.settle(&auth, &sig);
                assert!(
                    matches!(
                        result,
                        SettleResult::Rejected(RejectReason::OverCap)
                            | SettleResult::Rejected(RejectReason::BadWindow)
                            | SettleResult::Rejected(RejectReason::UnknownAllowance)
                    ),
                    "Expected OverCap, BadWindow, or UnknownAllowance, got {:?}",
                    result
                );
            }
            Step::RequestClose => {
                let _ = vault_client.try_request_close(&allowance_id);
            }
            Step::AdvanceTime(secs) => {
                let now = env.ledger().timestamp();
                env.ledger().set_timestamp(now + secs);
            }
            Step::Reclaim => {
                let allowance = vault_client.get_allowance(&allowance_id).unwrap();
                let close_req = allowance.close_requested_at.unwrap_or(0);
                let base = allowance.valid_until.max(close_req);
                let earliest = base + max_payment_ttl + grace_period;
                let now = env.ledger().timestamp();

                if allowance.status == Status::Closed {
                    let attempt = vault_client.try_reclaim(&allowance_id);
                    assert_eq!(attempt, Err(Ok(VaultError::AlreadyClosed)));
                } else if now < earliest {
                    // Invariant 4: reclaim is impossible before the window
                    let attempt = vault_client.try_reclaim(&allowance_id);
                    assert_eq!(
                        attempt,
                        Err(Ok(VaultError::ReclaimTooEarly)),
                        "Invariant 4 violated: reclaim succeeded before window!"
                    );
                } else {
                    let res = vault_client.reclaim(&allowance_id);
                    reclaimed_sum += res;
                }
            }
        }
    }

    // FINAL INVARIANT ASSERTIONS ACROSS THE ENTIRE SEQUENCE:

    let allowance = vault_client.get_allowance(&allowance_id).unwrap();
    let current_balance = allowance.balance;

    // Invariant 1: sum(settled) + balance + reclaimed == sum(deposited)
    assert_eq!(
        settled_sum + current_balance + reclaimed_sum,
        deposited,
        "Invariant 1 violated: sum(settled) + balance + reclaimed != sum(deposited)"
    );

    // Invariant 1b: Token contract escrow balance matches internal balance exactly
    assert_eq!(
        token_client.balance(&vault_id),
        current_balance,
        "Escrow token balance does not match contract internal balance!"
    );

    // Invariant 3: Funds only ever flow to the merchant named inside signature or back to owner
    assert_eq!(
        token_client.balance(&merchant),
        settled_sum,
        "Invariant 3 violated: merchant token balance != settled_sum"
    );

    // Invariant 6: No admin-callable function changes an escrowed balance
    assert_eq!(
        token_client.balance(&admin),
        0,
        "Invariant 6 violated: admin received funds from escrow!"
    );
}

proptest! {
    #![proptest_config(ProptestConfig {
        // Run 1000 cases locally; CI runs 100 cases
        cases: if std::env::var("CI").is_ok() { 100 } else { 1000 },
        max_shrink_iters: 1000,
        .. ProptestConfig::default()
    })]

    #[test]
    fn prop_test_protocol_invariants(steps in prop::collection::vec(step_strategy(), 1..30)) {
        run_property_sequence(steps);
    }
}
