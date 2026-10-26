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
    max_payment_ttl: u64,
    grace_period: u64,
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

        let max_payment_ttl = 86400; // 24 hours
        let grace_period = 3600; // 1 hour
        vault_client.initialize(
            &admin,
            &max_payment_ttl,
            &grace_period,
            &1_000_000,
            &1_000_000_000,
        );

        stellar_admin.mint(&owner, &100_000_000);

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
            max_payment_ttl,
            grace_period,
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
fn test_reclaim_exact_boundary_seconds() {
    let f = Fixture::setup();

    let valid_until = 1700100000;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &30_000_000,
        &valid_until,
        &f.device_key,
        &5_000_000,
    );

    // Exact boundary = valid_until + max_payment_ttl + grace_period
    let earliest_reclaim = valid_until + f.max_payment_ttl + f.grace_period;
    assert_eq!(earliest_reclaim, 1700190000);

    // 1 second BEFORE boundary -> MUST FAIL
    f.env.ledger().set_timestamp(earliest_reclaim - 1);
    let early_attempt = f.vault_client.try_reclaim(&allowance_id);
    assert_eq!(early_attempt, Err(Ok(VaultError::ReclaimTooEarly)));
    assert_eq!(f.token_client.balance(&f.vault_id), 30_000_000);

    // EXACTLY AT boundary -> MUST SUCCEED
    f.env.ledger().set_timestamp(earliest_reclaim);
    let reclaimed = f.vault_client.reclaim(&allowance_id);
    assert_eq!(reclaimed, 30_000_000);
    assert_eq!(f.token_client.balance(&f.owner), 100_000_000);
    assert_eq!(f.token_client.balance(&f.vault_id), 0);
}

#[test]
fn test_reclaim_after_request_close() {
    let f = Fixture::setup();

    let valid_until = 1700100000;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &40_000_000,
        &valid_until,
        &f.device_key,
        &5_000_000,
    );

    // Owner requests close later at close_requested_at = 1700120000 (> valid_until)
    let close_time = 1700120000;
    f.env.ledger().set_timestamp(close_time);
    f.vault_client.request_close(&allowance_id);

    // Boundary is max(valid_until, close_time) + ttl + grace = 1700120000 + 86400 + 3600 = 1700210000
    let earliest_reclaim = close_time + f.max_payment_ttl + f.grace_period;

    // 1 second before
    f.env.ledger().set_timestamp(earliest_reclaim - 1);
    assert_eq!(
        f.vault_client.try_reclaim(&allowance_id),
        Err(Ok(VaultError::ReclaimTooEarly))
    );

    // Exact boundary
    f.env.ledger().set_timestamp(earliest_reclaim);
    assert_eq!(f.vault_client.reclaim(&allowance_id), 40_000_000);
}

#[test]
fn test_settle_during_closing_and_fails_after_closed() {
    let f = Fixture::setup();

    let valid_until = 1700100000;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &50_000_000,
        &valid_until,
        &f.device_key,
        &10_000_000,
    );

    // Request close
    f.env.ledger().set_timestamp(1700050000);
    f.vault_client.request_close(&allowance_id);

    // Payment authorized prior to close/expiry can still settle during Closing
    let auth = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x55; 16]),
        merchant: f.merchant.clone(),
        amount: 8_000_000,
        issued_at: 1700040000,
        expires_at: 1700080000,
    };
    let signature = f.sign_auth(&auth);

    // Settlement succeeds during Closing!
    let res = f.vault_client.settle(&auth, &signature);
    assert_eq!(res, SettleResult::Settled);
    assert_eq!(f.token_client.balance(&f.merchant), 8_000_000);
    assert_eq!(f.token_client.balance(&f.vault_id), 42_000_000);

    // Advance past reclaim window and reclaim
    let reclaim_time = valid_until + f.max_payment_ttl + f.grace_period;
    f.env.ledger().set_timestamp(reclaim_time);
    f.vault_client.reclaim(&allowance_id);

    // After Closed, subsequent settle attempt returns Rejected(UnknownAllowance)
    let auth_after_close = PaymentAuth {
        version: 1,
        allowance_id,
        payment_id: BytesN::from_array(&f.env, &[0x66; 16]),
        merchant: f.merchant.clone(),
        amount: 5_000_000,
        issued_at: 1700040000,
        expires_at: 1700080000,
    };
    let sig2 = f.sign_auth(&auth_after_close);
    let res_after = f.vault_client.settle(&auth_after_close, &sig2);
    assert_eq!(
        res_after,
        SettleResult::Rejected(RejectReason::UnknownAllowance)
    );
}

#[test]
fn test_double_reclaim_safe() {
    let f = Fixture::setup();

    let valid_until = 1700050000;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &25_000_000,
        &valid_until,
        &f.device_key,
        &5_000_000,
    );

    let reclaim_time = valid_until + f.max_payment_ttl + f.grace_period;
    f.env.ledger().set_timestamp(reclaim_time);

    // First reclaim moves funds
    assert_eq!(f.vault_client.reclaim(&allowance_id), 25_000_000);

    // Second reclaim is idempotent-safe: returns error without moving funds
    let second = f.vault_client.try_reclaim(&allowance_id);
    assert_eq!(second, Err(Ok(VaultError::AlreadyClosed)));
}

#[test]
fn test_top_up_after_request_close_fails() {
    let f = Fixture::setup();

    let valid_until = 1700100000;
    let allowance_id = f.vault_client.create_allowance(
        &f.owner,
        &f.token_address,
        &20_000_000,
        &valid_until,
        &f.device_key,
        &5_000_000,
    );

    f.vault_client.request_close(&allowance_id);

    // Top up after close requested must fail
    let attempt = f.vault_client.try_top_up(&allowance_id, &10_000_000);
    assert_eq!(attempt, Err(Ok(VaultError::AllowanceNotActive)));
}
