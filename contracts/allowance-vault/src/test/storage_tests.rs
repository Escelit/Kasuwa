use crate::storage::{
    extend_allowance_ttl, extend_instance_ttl, extend_persistent_ttl, get_allowance,
    get_allowance_counter, get_config, get_shortfalls, has_allowance, has_config, is_payment_used,
    mark_payment_used, next_allowance_id, record_shortfall, set_allowance, set_config, DataKey,
};
use crate::types::{Allowance, Config, ShortfallRecord, Status, VaultError};
use crate::AllowanceVault;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

fn setup_env() -> (Env, Address) {
    let env = Env::default();
    let contract_id = env.register(AllowanceVault, ());
    (env, contract_id)
}

#[test]
fn test_config_lifecycle() {
    let (env, contract_id) = setup_env();

    env.as_contract(&contract_id, || {
        assert!(!has_config(&env));
        assert_eq!(get_config(&env), Err(VaultError::NotInitialized));

        let admin = Address::generate(&env);
        let config = Config {
            admin: admin.clone(),
            max_payment_ttl: 86400,
            grace_period: 3600,
            min_allowance: 1_000_000,
            max_allowance: 100_000_000,
        };

        set_config(&env, &config);
        assert!(has_config(&env));

        let retrieved = get_config(&env).expect("Config should be present");
        assert_eq!(retrieved.admin, admin);
        assert_eq!(retrieved.max_payment_ttl, 86400);
        assert_eq!(retrieved.grace_period, 3600);
        assert_eq!(retrieved.min_allowance, 1_000_000);
        assert_eq!(retrieved.max_allowance, 100_000_000);
    });
}

#[test]
fn test_allowance_counter_increments() {
    let (env, contract_id) = setup_env();

    env.as_contract(&contract_id, || {
        assert_eq!(get_allowance_counter(&env), 0);

        let id1 = next_allowance_id(&env).expect("id 1");
        assert_eq!(id1, 1);
        assert_eq!(get_allowance_counter(&env), 1);

        let id2 = next_allowance_id(&env).expect("id 2");
        assert_eq!(id2, 2);
        assert_eq!(get_allowance_counter(&env), 2);

        let id3 = next_allowance_id(&env).expect("id 3");
        assert_eq!(id3, 3);
        assert_eq!(get_allowance_counter(&env), 3);
    });
}

#[test]
fn test_allowance_crud_and_status() {
    let (env, contract_id) = setup_env();

    env.as_contract(&contract_id, || {
        let owner = Address::generate(&env);
        let token = Address::generate(&env);
        let device_key = BytesN::from_array(&env, &[0x04; 65]);

        let id = 101u64;
        assert!(!has_allowance(&env, id));
        assert_eq!(get_allowance(&env, id), None);

        let mut allowance = Allowance {
            owner: owner.clone(),
            token: token.clone(),
            device_key: device_key.clone(),
            balance: 50_000_000,
            per_payment_cap: 5_000_000,
            valid_until: 1800000000,
            close_requested_at: None,
            status: Status::Active,
        };

        set_allowance(&env, id, &allowance);
        assert!(has_allowance(&env, id));

        let stored = get_allowance(&env, id).expect("allowance exists");
        assert_eq!(stored.owner, owner);
        assert_eq!(stored.balance, 50_000_000);
        assert_eq!(stored.status, Status::Active);

        // Checked deduction of funds
        let payment_amount = 4_000_000i128;
        allowance.balance = allowance
            .balance
            .checked_sub(payment_amount)
            .expect("checked sub");
        set_allowance(&env, id, &allowance);

        let updated = get_allowance(&env, id).expect("updated allowance");
        assert_eq!(updated.balance, 46_000_000);

        // Transition status to Closing
        allowance.status = Status::Closing;
        allowance.close_requested_at = Some(1750000000);
        set_allowance(&env, id, &allowance);

        let closing = get_allowance(&env, id).expect("closing allowance");
        assert_eq!(closing.status, Status::Closing);
        assert_eq!(closing.close_requested_at, Some(1750000000));
    });
}

#[test]
fn test_used_payment_id_tracking() {
    let (env, contract_id) = setup_env();

    env.as_contract(&contract_id, || {
        let allowance_id = 42u64;
        let p1 = BytesN::from_array(&env, &[0xaa; 16]);
        let p2 = BytesN::from_array(&env, &[0xbb; 16]);

        assert!(!is_payment_used(&env, allowance_id, &p1));
        assert!(!is_payment_used(&env, allowance_id, &p2));

        mark_payment_used(&env, allowance_id, &p1);

        assert!(is_payment_used(&env, allowance_id, &p1));
        assert!(!is_payment_used(&env, allowance_id, &p2));

        // Different allowance with same payment_id is isolated
        let other_allowance = 43u64;
        assert!(!is_payment_used(&env, other_allowance, &p1));
    });
}

#[test]
fn test_shortfall_records_audit_trail() {
    let (env, contract_id) = setup_env();

    env.as_contract(&contract_id, || {
        let device_key = BytesN::from_array(&env, &[0x07; 65]);
        let other_key = BytesN::from_array(&env, &[0x08; 65]);

        let initial = get_shortfalls(&env, &device_key);
        assert_eq!(initial.len(), 0);

        let merchant_a = Address::generate(&env);
        let merchant_b = Address::generate(&env);

        let r1 = ShortfallRecord {
            allowance_id: 1,
            merchant: merchant_a.clone(),
            amount: 500_000,
            timestamp: 1700000100,
        };
        record_shortfall(&env, &device_key, &r1);

        let r2 = ShortfallRecord {
            allowance_id: 1,
            merchant: merchant_b.clone(),
            amount: 1_200_000,
            timestamp: 1700000200,
        };
        record_shortfall(&env, &device_key, &r2);

        let records = get_shortfalls(&env, &device_key);
        assert_eq!(records.len(), 2);
        assert_eq!(records.get(0).unwrap(), r1);
        assert_eq!(records.get(1).unwrap(), r2);

        // Other device has zero shortfalls
        assert_eq!(get_shortfalls(&env, &other_key).len(), 0);
    });
}

#[test]
fn test_ttl_extension_helpers() {
    let (env, contract_id) = setup_env();

    env.as_contract(&contract_id, || {
        // Test instance TTL extension
        extend_instance_ttl(&env);

        // Test persistent TTL extension
        let key = DataKey::Allowance(1);
        extend_persistent_ttl(&env, &key);

        let owner = Address::generate(&env);
        let token = Address::generate(&env);
        let allowance = Allowance {
            owner,
            token,
            device_key: BytesN::from_array(&env, &[0x02; 65]),
            balance: 10_000_000,
            per_payment_cap: 1_000_000,
            valid_until: 1700000000,
            close_requested_at: None,
            status: Status::Active,
        };
        set_allowance(&env, 1, &allowance);

        // Explicit extension
        extend_allowance_ttl(&env, 1);
        // Non-existent allowance extension is safe no-op
        extend_allowance_ttl(&env, 999);
    });
}
