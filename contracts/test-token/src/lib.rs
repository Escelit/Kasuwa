#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, String};

#[contracttype]
pub enum DataKey {
    Admin,
    Decimals,
    Name,
    Symbol,
    Balance(Address),
}

#[contract]
pub struct TestToken;

#[contractimpl]
impl TestToken {
    pub fn initialize(env: Env, admin: Address, decimal: u32, name: String, symbol: String) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Decimals, &decimal);
        env.storage().instance().set(&DataKey::Name, &name);
        env.storage().instance().set(&DataKey::Symbol, &symbol);
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("not initialized");
        admin.require_auth();
        if amount < 0 {
            panic!("negative amount");
        }
        let current_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        let new_balance = current_balance.checked_add(amount).expect("overflow");
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to), &new_balance);
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Balance(id))
            .unwrap_or(0)
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        if amount < 0 {
            panic!("negative amount");
        }
        let from_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(from.clone()))
            .unwrap_or(0);
        if from_balance < amount {
            panic!("insufficient balance");
        }
        let new_from = from_balance.checked_sub(amount).expect("underflow");
        env.storage()
            .persistent()
            .set(&DataKey::Balance(from), &new_from);

        let to_balance: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Balance(to.clone()))
            .unwrap_or(0);
        let new_to = to_balance.checked_add(amount).expect("overflow");
        env.storage()
            .persistent()
            .set(&DataKey::Balance(to), &new_to);
    }

    pub fn decimals(env: Env) -> u32 {
        env.storage()
            .instance()
            .get(&DataKey::Decimals)
            .unwrap_or(7)
    }

    pub fn name(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Name)
            .expect("not initialized")
    }

    pub fn symbol(env: Env) -> String {
        env.storage()
            .instance()
            .get(&DataKey::Symbol)
            .expect("not initialized")
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{token, String};

    #[test]
    fn test_token_lifecycle() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let user1 = Address::generate(&env);
        let user2 = Address::generate(&env);

        let token_id = env.register(TestToken, ());
        let client = TestTokenClient::new(&env, &token_id);

        client.initialize(
            &admin,
            &7,
            &String::from_str(&env, "Test USD"),
            &String::from_str(&env, "TUSD"),
        );

        assert_eq!(client.decimals(), 7);
        assert_eq!(client.balance(&user1), 0);

        client.mint(&user1, &100_000_000);
        assert_eq!(client.balance(&user1), 100_000_000);

        client.transfer(&user1, &user2, &30_000_000);
        assert_eq!(client.balance(&user1), 70_000_000);
        assert_eq!(client.balance(&user2), 30_000_000);

        // SEP-41 standard token client compatibility
        let std_client = token::Client::new(&env, &token_id);
        assert_eq!(std_client.balance(&user1), 70_000_000);
    }
}
