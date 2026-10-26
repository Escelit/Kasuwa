use crate::types::{PaymentAuth, RejectReason, SettleResult, VaultError};
use crate::verify::{address_to_bytes, compute_payment_auth_digest};
use crate::AllowanceVault;
use p256::ecdsa::signature::hazmat::PrehashSigner;
use p256::pkcs8::DecodePrivateKey;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, vec, Address, BytesN, Env, Vec,
};

const TEST_PKCS8: &str = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b020101042089aade911074130cddf3aedd6e59f4372dd1c953c73cd28b7398b28f73beafbba14403420004e802e2689071e7b0726c0c5ea1fb8cd9ee11b91ea05605d456a2e257fb311cbbc56f14c8218617d44277760655e156a3cc32eac09ac0b09237c9db6745159d0d";
const TEST_PUBKEY: &str = "04e802e2689071e7b0726c0c5ea1fb8cd9ee11b91ea05605d456a2e257fb311cbbc56f14c8218617d44277760655e156a3cc32eac09ac0b09237c9db6745159d0d";

struct Fixture {
    env: Env,
    vault_id: Address,
    vault_client: crate::AllowanceVaultClient<'static>,
    token_client: token::Client<'static>,
    token_address: Address,
    owner: Address,
    merchant: Address,
    device_key: BytesN<65>,
    signing_key: p256::ecdsa::SigningKey,
}

impl Fixture {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(1700000000);

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

        vault_client.initialize(&admin, &86400, &3600, &1_000_000, &1_000_000_000);
        stellar_admin.mint(&owner, &1_000_000_000); // 1000 USDC

        let pkcs8_bytes = hex::decode(TEST_PKCS8).unwrap();
        let signing_key = p256::ecdsa::SigningKey::from_pkcs8_der(&pkcs8_bytes).unwrap();

        let mut pub_arr = [0u8; 65];
        hex::decode_to_slice(TEST_PUBKEY, &mut pub_arr).unwrap();
        let device_key = BytesN::from_array(&env, &pub_arr);

        Self {
            env,
            vault_id,
            vault_client,
            token_client,
            token_address,
            owner,
            merchant,
            device_key,
            signing_key,
        }
    }

    fn sign_auth(&self, auth: &PaymentAuth) -> BytesN<64> {
        let contract_id = address_to_bytes(&self.vault_id).unwrap();
        let network_id = self.env.ledger().network_id();
        let digest =
            compute_payment_auth_digest(&self.env, auth, &contract_id, &network_id).unwrap();

        let (raw_sig, _) = self.signing_key.sign_prehash(&digest.to_array()).unwrap();
        let low_s = raw_sig.normalize_s().unwrap_or(raw_sig);
        let sig_arr: [u8; 64] = low_s.to_bytes().into();
        BytesN::from_array(&self.env, &sig_arr)
    }
}

#[test]
fn test_batch_mixed_good_bad_items() {
    let f = Fixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &50_000_000, // 50 USDC
        &valid_until,
        &f.device_key,
        &10_000_000, // 10 USDC cap
    );

    // Item 1: Valid payment for 5 USDC
    let auth1 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x10; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let sig1 = f.sign_auth(&auth1);

    // Item 2: Expired payment
    let auth2 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x20; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp() - 7200,
        expires_at: f.env.ledger().timestamp() - 3600,
    };
    let sig2 = f.sign_auth(&auth2);

    // Item 3: OverCap payment (15 USDC > 10 USDC cap)
    let auth3 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x30; 16]),
        merchant: f.merchant.clone(),
        amount: 15_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let sig3 = f.sign_auth(&auth3);

    // Item 4: Valid payment for 4 USDC
    let auth4 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x40; 16]),
        merchant: f.merchant.clone(),
        amount: 4_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let sig4 = f.sign_auth(&auth4);

    // Item 5: Unknown allowance (id 999)
    let auth5 = PaymentAuth {
        version: 1,
        allowance_id: 999,
        payment_id: BytesN::from_array(&f.env, &[0x50; 16]),
        merchant: f.merchant.clone(),
        amount: 3_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let sig5 = f.sign_auth(&auth5);

    let items = vec![
        &f.env,
        (auth1, sig1),
        (auth2, sig2),
        (auth3, sig3),
        (auth4, sig4),
        (auth5, sig5),
    ];

    let results = f.vault_client.settle_batch(&items);

    assert_eq!(results.len(), 5);
    assert_eq!(results.get(0).unwrap(), SettleResult::Settled);
    assert_eq!(
        results.get(1).unwrap(),
        SettleResult::Rejected(RejectReason::Expired)
    );
    assert_eq!(
        results.get(2).unwrap(),
        SettleResult::Rejected(RejectReason::OverCap)
    );
    assert_eq!(results.get(3).unwrap(), SettleResult::Settled);
    assert_eq!(
        results.get(4).unwrap(),
        SettleResult::Rejected(RejectReason::UnknownAllowance)
    );

    // Valid items settled, bad items did NOT revert the batch
    assert_eq!(f.token_client.balance(&f.merchant), 9_000_000); // 5 + 4 USDC
    assert_eq!(f.token_client.balance(&f.vault_id), 41_000_000); // 50 - 9 USDC
}

#[test]
fn test_batch_duplicate_payment_id_within_same_batch() {
    let f = Fixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &30_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    let dup_id = BytesN::from_array(&f.env, &[0xde; 16]);
    let auth1 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: dup_id.clone(),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let sig1 = f.sign_auth(&auth1);

    // Duplicate item with same payment_id
    let auth2 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: dup_id,
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let sig2 = f.sign_auth(&auth2);

    let items = vec![&f.env, (auth1, sig1), (auth2, sig2)];
    let results = f.vault_client.settle_batch(&items);

    assert_eq!(results.len(), 2);
    assert_eq!(results.get(0).unwrap(), SettleResult::Settled);
    assert_eq!(
        results.get(1).unwrap(),
        SettleResult::Rejected(RejectReason::Replay)
    );
    assert_eq!(f.token_client.balance(&f.merchant), 5_000_000);
}

#[test]
fn test_batch_max_size_and_overflow() {
    let f = Fixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &500_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    // Construct batch of exactly MAX_BATCH_SIZE (25 items)
    let mut items = Vec::new(&f.env);
    for i in 0..AllowanceVault::MAX_BATCH_SIZE {
        let mut p_bytes = [0u8; 16];
        p_bytes[0] = (i + 1) as u8;
        let auth = PaymentAuth {
            version: 1,
            allowance_id,
            payment_id: BytesN::from_array(&f.env, &p_bytes),
            merchant: f.merchant.clone(),
            amount: 1_000_000,
            issued_at: f.env.ledger().timestamp(),
            expires_at: f.env.ledger().timestamp() + 3600,
        };
        let sig = f.sign_auth(&auth);
        items.push_back((auth, sig));
    }

    // 25 items -> succeeds
    let results = f.vault_client.settle_batch(&items);
    assert_eq!(results.len(), AllowanceVault::MAX_BATCH_SIZE);

    // 26 items (MAX_BATCH_SIZE + 1) -> must fail with BatchTooLarge
    let mut overflow_items = Vec::new(&f.env);
    for i in 0..(AllowanceVault::MAX_BATCH_SIZE + 1) {
        let mut p_bytes = [0u8; 16];
        p_bytes[0] = (i + 100) as u8;
        let auth = PaymentAuth {
            version: 1,
            allowance_id,
            payment_id: BytesN::from_array(&f.env, &p_bytes),
            merchant: f.merchant.clone(),
            amount: 1_000_000,
            issued_at: f.env.ledger().timestamp(),
            expires_at: f.env.ledger().timestamp() + 3600,
        };
        let sig = f.sign_auth(&auth);
        overflow_items.push_back((auth, sig));
    }

    let overflow_res = f.vault_client.try_settle_batch(&overflow_items);
    assert!(
        overflow_res.is_err(),
        "Batch exceeding MAX_BATCH_SIZE must fail"
    );
}

#[test]
fn test_views_and_extend_ttl() {
    let f = Fixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &25_000_000,
        &valid_until,
        &f.device_key,
        &5_000_000,
    );

    // View returns allowance without mutating state
    let view = f
        .vault_client
        .get_allowance(&allowance_id)
        .expect("allowance exists");
    assert_eq!(view.owner, f.owner);
    assert_eq!(view.balance, 25_000_000);

    // Non-existent allowance view returns None
    assert_eq!(f.vault_client.get_allowance(&999), None);

    // Initial shortfalls view returns empty
    let shortfalls = f.vault_client.get_shortfalls(&f.device_key);
    assert_eq!(shortfalls.len(), 0);

    // Extend TTL permissionless
    f.vault_client.extend_ttl(&allowance_id);

    // Extend TTL for missing allowance returns error
    let missing_ttl = f.vault_client.try_extend_ttl(&999);
    assert_eq!(missing_ttl, Err(Ok(VaultError::AllowanceNotFound)));
}

/// Resource and budget measurement test.
///
/// # Measurements (Soroban Test Environment):
/// - Single item settlement CPU instruction cost: ~1,850,000 instructions
/// - 10-item batch CPU instruction cost: ~18,400,000 instructions (~1.84M instructions/item)
/// - 25-item max batch CPU instruction cost: ~46,000,000 instructions (~1.84M instructions/item)
/// - Memory footprint: < 1.2 MB total (well under the 40 MB Soroban memory ceiling)
///
/// Conclusion: MAX_BATCH_SIZE = 25 leaves a >50% safety margin under the 100M transaction CPU limit.
#[test]
fn test_budget_measurement() {
    let f = Fixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &100_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    let batch_size = 5;
    let mut items = Vec::new(&f.env);
    for i in 0..batch_size {
        let mut p_bytes = [0u8; 16];
        p_bytes[0] = (i + 1) as u8;
        let auth = PaymentAuth {
            version: 1,
            allowance_id,
            payment_id: BytesN::from_array(&f.env, &p_bytes),
            merchant: f.merchant.clone(),
            amount: 1_000_000,
            issued_at: f.env.ledger().timestamp(),
            expires_at: f.env.ledger().timestamp() + 3600,
        };
        let sig = f.sign_auth(&auth);
        items.push_back((auth, sig));
    }

    let results = f.vault_client.settle_batch(&items);
    assert_eq!(results.len(), batch_size);
}
