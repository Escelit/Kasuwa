use crate::types::{PaymentAuth, RejectReason};
use crate::verify::{
    compute_payment_auth_digest, encode_payment_auth_canonical, is_low_s, verify_authorization,
};
use crate::AllowanceVault;
use p256::ecdsa::signature::hazmat::PrehashSigner;
use p256::pkcs8::DecodePrivateKey;
use serde_json::Value;
use soroban_sdk::{address_payload::AddressPayload, Address, BytesN, Env};

const VECTORS_JSON: &str = include_str!("../../../../test-vectors/payment-auth.json");

fn hex_to_32(hex_str: &str) -> [u8; 32] {
    let mut arr = [0u8; 32];
    hex::decode_to_slice(hex_str, &mut arr).expect("decode hex 32");
    arr
}

fn hex_to_16(hex_str: &str) -> [u8; 16] {
    let mut arr = [0u8; 16];
    hex::decode_to_slice(hex_str, &mut arr).expect("decode hex 16");
    arr
}

#[test]
fn test_all_shared_vectors_message_hash() {
    let env = Env::default();
    let root: Value = serde_json::from_str(VECTORS_JSON).expect("parse JSON");

    let contract_id_hex = root["context"]["contract_id_hex"].as_str().unwrap();
    let network_id_hex = root["context"]["network_id_hex"].as_str().unwrap();

    let contract_id = BytesN::from_array(&env, &hex_to_32(contract_id_hex));
    let network_id = BytesN::from_array(&env, &hex_to_32(network_id_hex));

    let vectors = root["vectors"].as_array().expect("vectors array");
    let mut auth_count = 0;

    for v in vectors {
        let v_type = v["type"].as_str().unwrap();
        if v_type != "PaymentAuthorization" {
            continue;
        }
        auth_count += 1;

        let inputs = &v["inputs"];
        let version = inputs["version"].as_u64().unwrap() as u32;
        let allowance_id = inputs["allowanceId"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap();
        let payment_id =
            BytesN::from_array(&env, &hex_to_16(inputs["paymentId"].as_str().unwrap()));

        let merchant_hex = inputs["merchant"].as_str().unwrap();
        let merchant_bytes = hex_to_32(merchant_hex);
        let merchant_address = Address::from_payload(
            &env,
            AddressPayload::ContractIdHash(BytesN::from_array(&env, &merchant_bytes)),
        );

        let amount = inputs["amount"].as_str().unwrap().parse::<i128>().unwrap();
        let issued_at = inputs["issuedAt"].as_u64().unwrap();
        let expires_at = inputs["expiresAt"].as_u64().unwrap();

        let auth = PaymentAuth {
            version,
            allowance_id,
            payment_id,
            merchant: merchant_address,
            amount,
            issued_at,
            expires_at,
        };

        // Assert canonical encoding byte-for-byte
        let canonical = encode_payment_auth_canonical(&env, &auth).expect("canonical encoding");
        let expected_canonical_hex = v["expected_canonical_hex"].as_str().unwrap();
        let mut canonical_bytes = [0u8; 128];
        let len = canonical.len() as usize;
        canonical.copy_into_slice(&mut canonical_bytes[..len]);
        assert_eq!(
            hex::encode(&canonical_bytes[..len]),
            expected_canonical_hex,
            "Vector {} canonical encoding mismatch",
            v["id"]
        );

        // Assert signed message digest equals expected hash
        let digest = compute_payment_auth_digest(&env, &auth, &contract_id, &network_id)
            .expect("compute digest");
        let expected_hash = v["expected_hash"].as_str().unwrap();
        assert_eq!(
            hex::encode(digest.to_array()),
            expected_hash,
            "Vector {} digest mismatch",
            v["id"]
        );
    }

    assert!(
        auth_count >= 9,
        "Expected at least 9 PaymentAuthorization vectors, got {}",
        auth_count
    );
}

#[test]
fn test_verify_signature_rejections_and_tampering() {
    let env = Env::default();
    let contract_id_val = env.register(AllowanceVault, ());

    env.as_contract(&contract_id_val, || {
        let root: Value = serde_json::from_str(VECTORS_JSON).expect("parse JSON");

        let pkcs8_hex = root["test_key"]["private_key_pkcs8_hex"].as_str().unwrap();
        let pkcs8_bytes = hex::decode(pkcs8_hex).unwrap();
        let signing_key = p256::ecdsa::SigningKey::from_pkcs8_der(&pkcs8_bytes).unwrap();

        let pub_key_hex = root["test_key"]["public_key_uncompressed_hex"]
            .as_str()
            .unwrap();
        let mut pub_key_arr = [0u8; 65];
        hex::decode_to_slice(pub_key_hex, &mut pub_key_arr).unwrap();
        let device_key = BytesN::from_array(&env, &pub_key_arr);

        let merchant_bytes =
            hex_to_32("2222222222222222222222222222222222222222222222222222222222222222");
        let merchant_address = Address::from_payload(
            &env,
            AddressPayload::ContractIdHash(BytesN::from_array(&env, &merchant_bytes)),
        );

        let auth = PaymentAuth {
            version: 1,
            allowance_id: 1,
            payment_id: BytesN::from_array(&env, &[0x44; 16]),
            merchant: merchant_address.clone(),
            amount: 5_000_000,
            issued_at: 1700000000,
            expires_at: 1700086400,
        };

        let contract_id = BytesN::from_array(
            &env,
            &hex_to_32(root["context"]["contract_id_hex"].as_str().unwrap()),
        );
        let network_id = BytesN::from_array(
            &env,
            &hex_to_32(root["context"]["network_id_hex"].as_str().unwrap()),
        );

        // Generate valid signature using prehash
        let digest = compute_payment_auth_digest(&env, &auth, &contract_id, &network_id).unwrap();
        let (raw_sig, _) = signing_key.sign_prehash(&digest.to_array()).unwrap();
        let low_s_sig = raw_sig.normalize_s().unwrap_or(raw_sig);
        let sig_arr: [u8; 64] = low_s_sig.to_bytes().into();
        let valid_signature = BytesN::from_array(&env, &sig_arr);

        // 1. Happy path: valid signature verifies cleanly
        let res = verify_authorization(
            &env,
            &device_key,
            &auth,
            &valid_signature,
            &contract_id,
            &network_id,
        );
        assert_eq!(res, Ok(()));

        // 2. Tampered amount: host verification rejects
        let mut tampered_auth = auth.clone();
        tampered_auth.amount = 5_000_001;
        let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = verify_authorization(
                &env,
                &device_key,
                &tampered_auth,
                &valid_signature,
                &contract_id,
                &network_id,
            );
        }));
        assert!(
            panic_res.is_err(),
            "Tampered amount must be rejected by host verifier"
        );

        // 3. Tampered merchant: host verification rejects
        let other_merchant_bytes =
            hex_to_32("3333333333333333333333333333333333333333333333333333333333333333");
        let other_merchant = Address::from_payload(
            &env,
            AddressPayload::ContractIdHash(BytesN::from_array(&env, &other_merchant_bytes)),
        );
        let mut tampered_merchant_auth = auth.clone();
        tampered_merchant_auth.merchant = other_merchant;
        let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = verify_authorization(
                &env,
                &device_key,
                &tampered_merchant_auth,
                &valid_signature,
                &contract_id,
                &network_id,
            );
        }));
        assert!(
            panic_res.is_err(),
            "Tampered merchant must be rejected by host verifier"
        );

        // 4. Wrong contract_id: host verification rejects
        let wrong_contract_id = BytesN::from_array(&env, &[0x99; 32]);
        let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = verify_authorization(
                &env,
                &device_key,
                &auth,
                &valid_signature,
                &wrong_contract_id,
                &network_id,
            );
        }));
        assert!(
            panic_res.is_err(),
            "Wrong contract_id must be rejected by host verifier"
        );

        // 5. Wrong network_id: host verification rejects
        let wrong_network_id = BytesN::from_array(&env, &[0x88; 32]);
        let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = verify_authorization(
                &env,
                &device_key,
                &auth,
                &valid_signature,
                &contract_id,
                &wrong_network_id,
            );
        }));
        assert!(
            panic_res.is_err(),
            "Wrong network_id must be rejected by host verifier"
        );

        // 6. High-S signature: rejected explicitly by low-S enforcement without host call
        let mut high_s_bytes = [0u8; 64];
        valid_signature.copy_into_slice(&mut high_s_bytes);
        high_s_bytes[32] = 0xFF; // Force high S
        let high_s_sig = BytesN::from_array(&env, &high_s_bytes);
        assert!(!is_low_s(&high_s_sig));
        let res = verify_authorization(
            &env,
            &device_key,
            &auth,
            &high_s_sig,
            &contract_id,
            &network_id,
        );
        assert_eq!(res, Err(RejectReason::BadSignature));

        // 7. Wrong key / bad prefix (0x02 instead of 0x04): rejected cleanly
        let mut bad_key_bytes = [0u8; 65];
        device_key.copy_into_slice(&mut bad_key_bytes);
        bad_key_bytes[0] = 0x02;
        let bad_key = BytesN::from_array(&env, &bad_key_bytes);
        let res = verify_authorization(
            &env,
            &bad_key,
            &auth,
            &valid_signature,
            &contract_id,
            &network_id,
        );
        assert_eq!(res, Err(RejectReason::BadSignature));

        // 8. Unsupported version: rejected cleanly
        let mut bad_ver_auth = auth.clone();
        bad_ver_auth.version = 2;
        let res = verify_authorization(
            &env,
            &device_key,
            &bad_ver_auth,
            &valid_signature,
            &contract_id,
            &network_id,
        );
        assert_eq!(res, Err(RejectReason::BadSignature));
    });
}
