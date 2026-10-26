use crate::types::{PaymentAuth, RejectReason, SettleResult, VaultError};
use crate::verify::{address_to_bytes, compute_payment_auth_digest};
use crate::AllowanceVault;
use p256::ecdsa::signature::hazmat::PrehashSigner;
use p256::pkcs8::DecodePrivateKey;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, BytesN, Env,
};

const TEST_PKCS8: &str = "308187020100301306072a8648ce3d020106082a8648ce3d030107046d306b020101042089aade911074130cddf3aedd6e59f4372dd1c953c73cd28b7398b28f73beafbba14403420004e802e2689071e7b0726c0c5ea1fb8cd9ee11b91ea05605d456a2e257fb311cbbc56f14c8218617d44277760655e156a3cc32eac09ac0b09237c9db6745159d0d";
const TEST_PUBKEY: &str = "04e802e2689071e7b0726c0c5ea1fb8cd9ee11b91ea05605d456a2e257fb311cbbc56f14c8218617d44277760655e156a3cc32eac09ac0b09237c9db6745159d0d";

struct TestFixture {
    env: Env,
    vault_id: Address,
    vault_client: crate::AllowanceVaultClient<'static>,
    token_client: token::Client<'static>,
    #[allow(dead_code)]
    token_admin: token::StellarAssetClient<'static>,

    token_address: Address,
    admin: Address,
    owner: Address,
    merchant: Address,
    device_key: BytesN<65>,
    signing_key: p256::ecdsa::SigningKey,
}

impl TestFixture {
    fn setup() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        // Advance ledger timestamp to a realistic non-zero value
        env.ledger().set_timestamp(1700000000);

        let admin = Address::generate(&env);
        let owner = Address::generate(&env);
        let merchant = Address::generate(&env);

        let token_admin_addr = Address::generate(&env);
        let token_contract = env.register_stellar_asset_contract_v2(token_admin_addr);
        let token_address = token_contract.address();
        let token_client = token::Client::new(&env, &token_address);
        let token_admin = token::StellarAssetClient::new(&env, &token_address);

        let vault_id = env.register(AllowanceVault, ());
        let vault_client = crate::AllowanceVaultClient::new(&env, &vault_id);

        // Protocol config: min 1 USDC (1_000_000), max 1000 USDC, max_payment_ttl = 86400, grace = 3600
        vault_client.initialize(&admin, &86400, &3600, &1_000_000, &1_000_000_000);

        let pkcs8_bytes = hex::decode(TEST_PKCS8).unwrap();
        let signing_key = p256::ecdsa::SigningKey::from_pkcs8_der(&pkcs8_bytes).unwrap();

        let mut pub_arr = [0u8; 65];
        hex::decode_to_slice(TEST_PUBKEY, &mut pub_arr).unwrap();
        let device_key = BytesN::from_array(&env, &pub_arr);

        // Fund owner with 100 USDC
        token_admin.mint(&owner, &100_000_000);

        Self {
            env,
            vault_id,
            vault_client,
            token_client,
            token_admin,
            token_address,
            admin,
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
fn test_initialize_and_create_allowance() {
    let f = TestFixture::setup();

    // Re-initialization should fail
    let double_init =
        f.vault_client
            .try_initialize(&f.admin, &86400, &3600, &1_000_000, &1_000_000_000);
    assert_eq!(double_init, Err(Ok(VaultError::AlreadyInitialized)));

    let valid_until = f.env.ledger().timestamp() + 7 * 86400; // 7 days
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &50_000_000, // 50 USDC
        &valid_until,
        &f.device_key,
        &10_000_000, // 10 USDC cap
    );

    assert_eq!(allowance_id, 1);
    assert_eq!(f.token_client.balance(&f.vault_id), 50_000_000);
    assert_eq!(f.token_client.balance(&f.owner), 50_000_000);
}

#[test]
fn test_top_up_allowance() {
    let f = TestFixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &20_000_000,
        &valid_until,
        &f.device_key,
        &5_000_000,
    );

    f.vault_client.top_up(&allowance_id, &15_000_000);

    assert_eq!(f.token_client.balance(&f.vault_id), 35_000_000);
    assert_eq!(f.token_client.balance(&f.owner), 65_000_000);
}

#[test]
fn test_settle_happy_path() {
    let f = TestFixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &50_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    let payment_id = BytesN::from_array(&f.env, &[0x01; 16]);
    let auth = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: payment_id.clone(),
        merchant: f.merchant.clone(),
        amount: 8_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let signature = f.sign_auth(&auth);

    let result = f.vault_client.settle(&auth, &signature);
    assert_eq!(result, SettleResult::Settled);

    // Merchant received exactly 8 USDC
    assert_eq!(f.token_client.balance(&f.merchant), 8_000_000);
    // Vault balance reduced to 42 USDC
    assert_eq!(f.token_client.balance(&f.vault_id), 42_000_000);
}

#[test]
fn test_settle_partial_and_insufficient() {
    let f = TestFixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &10_000_000, // 10 USDC deposit
        &valid_until,
        &f.device_key,
        &10_000_000, // 10 USDC cap
    );

    // Payment 1: 7 USDC -> Settled (3 USDC remains)
    let p1 = BytesN::from_array(&f.env, &[0x11; 16]);
    let auth1 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: p1,
        merchant: f.merchant.clone(),
        amount: 7_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    assert_eq!(
        f.vault_client.settle(&auth1, &f.sign_auth(&auth1)),
        SettleResult::Settled
    );
    assert_eq!(f.token_client.balance(&f.merchant), 7_000_000);

    // Payment 2: 5 USDC -> Partial: paid 3 USDC, shortfall 2 USDC
    let p2 = BytesN::from_array(&f.env, &[0x22; 16]);
    let auth2 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: p2,
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let res2 = f.vault_client.settle(&auth2, &f.sign_auth(&auth2));
    assert_eq!(res2, SettleResult::Partial(3_000_000, 2_000_000));
    assert_eq!(f.token_client.balance(&f.merchant), 10_000_000);
    assert_eq!(f.token_client.balance(&f.vault_id), 0);

    // Payment 3: 4 USDC -> Insufficient: paid 0, shortfall 4 USDC
    let p3 = BytesN::from_array(&f.env, &[0x33; 16]);
    let auth3 = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: p3,
        merchant: f.merchant.clone(),
        amount: 4_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let res3 = f.vault_client.settle(&auth3, &f.sign_auth(&auth3));
    assert_eq!(res3, SettleResult::Rejected(RejectReason::Insufficient));
}

#[test]
fn test_settle_replay_rejected() {
    let f = TestFixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &20_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    let payment_id = BytesN::from_array(&f.env, &[0x77; 16]);
    let auth = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id,
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let signature = f.sign_auth(&auth);

    // First attempt settles
    assert_eq!(
        f.vault_client.settle(&auth, &signature),
        SettleResult::Settled
    );

    // Replay attempt rejected
    assert_eq!(
        f.vault_client.settle(&auth, &signature),
        SettleResult::Rejected(RejectReason::Replay)
    );
}

#[test]
fn test_settle_racing_payments_first_wins() {
    let f = TestFixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &10_000_000, // 10 USDC total
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    let merchant_b = Address::generate(&f.env);

    // Two payments racing for the entire remaining 10 USDC
    let auth_a = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x0a; 16]),
        merchant: f.merchant.clone(),
        amount: 10_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let auth_b = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x0b; 16]),
        merchant: merchant_b.clone(),
        amount: 10_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };

    let sig_a = f.sign_auth(&auth_a);
    let sig_b = f.sign_auth(&auth_b);

    // A arrives first
    assert_eq!(
        f.vault_client.settle(&auth_a, &sig_a),
        SettleResult::Settled
    );
    assert_eq!(f.token_client.balance(&f.merchant), 10_000_000);

    // B arrives second -> Rejected(Insufficient)
    assert_eq!(
        f.vault_client.settle(&auth_b, &sig_b),
        SettleResult::Rejected(RejectReason::Insufficient)
    );
    assert_eq!(f.token_client.balance(&merchant_b), 0);
}

#[test]
fn test_all_reject_reasons_dedicated() {
    let f = TestFixture::setup();

    let valid_until = f.env.ledger().timestamp() + 86400;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &50_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000, // cap: 10 USDC
    );

    // 1. UnknownAllowance
    let auth_unknown = PaymentAuth {
        version: 1,
        allowance_id: 999,
        payment_id: BytesN::from_array(&f.env, &[0x01; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    assert_eq!(
        f.vault_client
            .settle(&auth_unknown, &f.sign_auth(&auth_unknown)),
        SettleResult::Rejected(RejectReason::UnknownAllowance)
    );

    // 2. BadSignature (wrong version)
    let auth_bad_ver = PaymentAuth {
        version: 2,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x02; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    assert_eq!(
        f.vault_client
            .settle(&auth_bad_ver, &f.sign_auth(&auth_bad_ver)),
        SettleResult::Rejected(RejectReason::BadSignature)
    );

    // 3. BadSignature (high-S signature)
    let auth_valid = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x03; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    let normal_sig = f.sign_auth(&auth_valid);
    let mut high_s_bytes = [0u8; 64];
    normal_sig.copy_into_slice(&mut high_s_bytes);
    high_s_bytes[32] = 0xFF; // Corrupt S to high-S
    let high_s_sig = BytesN::from_array(&f.env, &high_s_bytes);
    assert_eq!(
        f.vault_client.settle(&auth_valid, &high_s_sig),
        SettleResult::Rejected(RejectReason::BadSignature)
    );

    // 4. Expired (ledger time past auth.expires_at)
    let auth_expired = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x04; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp() - 7200,
        expires_at: f.env.ledger().timestamp() - 3600, // expired 1 hr ago
    };
    assert_eq!(
        f.vault_client
            .settle(&auth_expired, &f.sign_auth(&auth_expired)),
        SettleResult::Rejected(RejectReason::Expired)
    );

    // 5. BadWindow (issued_at > valid_until)
    let auth_future = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x05; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: valid_until + 100, // after valid_until
        expires_at: valid_until + 200,
    };
    assert_eq!(
        f.vault_client
            .settle(&auth_future, &f.sign_auth(&auth_future)),
        SettleResult::Rejected(RejectReason::BadWindow)
    );

    // 5b. BadWindow (duration > max_payment_ttl of 86400)
    let auth_long_window = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x06; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 86401, // 1 sec over max TTL
    };
    assert_eq!(
        f.vault_client
            .settle(&auth_long_window, &f.sign_auth(&auth_long_window)),
        SettleResult::Rejected(RejectReason::BadWindow)
    );

    // 6. OverCap (amount > per_payment_cap of 10 USDC)
    let auth_overcap = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x07; 16]),
        merchant: f.merchant.clone(),
        amount: 10_000_001, // 1 unit over cap
        issued_at: f.env.ledger().timestamp(),
        expires_at: f.env.ledger().timestamp() + 3600,
    };
    assert_eq!(
        f.vault_client
            .settle(&auth_overcap, &f.sign_auth(&auth_overcap)),
        SettleResult::Rejected(RejectReason::OverCap)
    );
}
