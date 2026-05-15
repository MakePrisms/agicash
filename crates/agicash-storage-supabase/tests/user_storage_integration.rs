//! Real-local Supabase integration tests for the `UserStorage` impl.
//!
//! Gated behind the `real-supabase-tests` Cargo feature so plain
//! `cargo test` stays hermetic.
//!
//! These tests exercise the storage layer's request/response shape — URL
//! paths, headers, query params, JSON serialization, error mapping — against
//! the real local Supabase REST API. To avoid coupling to the local
//! `OpenSecret` -> Supabase JWT bridge (which requires extra gotrue config),
//! they authenticate using the service role JWT, which bypasses RLS. The
//! storage layer itself is auth-agnostic: it asks its `TokenProvider` for
//! whatever bearer token to use.
//!
//! End-to-end coverage that DOES exercise the `OpenSecret` -> Supabase auth
//! chain lives in the slice-3 CLI integration test
//! (`agicash-cli/tests/account_list.rs`).
//!
//! Required env vars (loaded via `dotenvy::dotenv()`):
//! - `SUPABASE_URL` (or `VITE_SUPABASE_URL`)
//! - `SUPABASE_SERVICE_ROLE_KEY`
//! - `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`)
//!
//! Run: `cargo test -p agicash-storage-supabase --features real-supabase-tests`

#![cfg(feature = "real-supabase-tests")]

use agicash_domain::{AccountPurpose, AccountType, Currency, UserId};
use agicash_storage_supabase::{SupabaseStorage, SupabaseStorageConfig};
use agicash_traits::{AccountInput, AuthError, TokenProvider, UpsertUserInput, UserStorage};
use async_trait::async_trait;
use serde_json::json;
use std::sync::Arc;

/// Static token provider used by the integration tests. The service role JWT
/// is the simplest way to authenticate the postgrest client against a local
/// Supabase without wiring the OpenSecret -> Supabase JWT bridge.
#[derive(Clone)]
struct StaticToken(String);

#[async_trait]
impl TokenProvider for StaticToken {
    async fn get_jwt(&self) -> Result<String, AuthError> {
        Ok(self.0.clone())
    }
}

fn env_ready() -> bool {
    let _ = dotenvy::dotenv();
    (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
        && (std::env::var("SUPABASE_ANON_KEY").is_ok()
            || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
        && std::env::var("SUPABASE_SERVICE_ROLE_KEY").is_ok()
}

struct TestFixture {
    storage: SupabaseStorage,
    user_id: UserId,
    seeded_account_name: String,
}

async fn make_fixture() -> TestFixture {
    let service_role =
        std::env::var("SUPABASE_SERVICE_ROLE_KEY").expect("SUPABASE_SERVICE_ROLE_KEY set");
    let tokens: Arc<dyn TokenProvider + Send + Sync> = Arc::new(StaticToken(service_role));
    let cfg = SupabaseStorageConfig::from_env().expect("Supabase env");
    let storage = SupabaseStorage::new(cfg, tokens).expect("SupabaseStorage");

    // Use a random UUID so tests are isolated across runs.
    let user_id = UserId::new();
    let pid = std::process::id();
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let seeded_account_name = format!("test-spark-{pid}-{nonce}");

    let input = UpsertUserInput {
        user_id,
        email: None,
        email_verified: false,
        accounts: vec![AccountInput {
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            name: seeded_account_name.clone(),
            details: json!({"network": "MAINNET"}),
            is_default: true,
        }],
        cashu_locking_xpub: format!("xpub-test-{pid}-{nonce}"),
        encryption_public_key: format!("enc-test-{pid}-{nonce}"),
        spark_identity_public_key: format!("spark-test-{pid}-{nonce}"),
        terms_accepted_at: None,
        gift_card_mint_terms_accepted_at: None,
    };
    let result = storage
        .upsert_user_with_accounts(input)
        .await
        .expect("upsert_user_with_accounts");
    assert_eq!(result.user.id, user_id);
    assert!(
        !result.accounts.is_empty(),
        "upsert returned at least one account"
    );

    TestFixture {
        storage,
        user_id,
        seeded_account_name,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn list_accounts_returns_seeded_account() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let accounts = fx
        .storage
        .list_accounts(fx.user_id)
        .await
        .expect("list_accounts");
    assert!(
        accounts.iter().any(|a| a.name == fx.seeded_account_name),
        "seeded account {:?} not in list of {} accounts",
        fx.seeded_account_name,
        accounts.len()
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn list_accounts_for_unknown_user_returns_empty() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let service_role = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap();
    let tokens: Arc<dyn TokenProvider + Send + Sync> = Arc::new(StaticToken(service_role));
    let cfg = SupabaseStorageConfig::from_env().unwrap();
    let storage = SupabaseStorage::new(cfg, tokens).unwrap();
    let unknown = UserId::new();
    let accounts = storage.list_accounts(unknown).await.expect("list_accounts");
    assert!(accounts.is_empty());
}

#[tokio::test(flavor = "multi_thread")]
async fn get_user_returns_seeded_user() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let user = fx
        .storage
        .get_user(fx.user_id)
        .await
        .expect("get_user")
        .expect("user row exists");
    assert_eq!(user.id, fx.user_id);
    assert!(user.email.is_none(), "seeded user has no email");
}

#[tokio::test(flavor = "multi_thread")]
async fn get_user_returns_none_for_unknown_id() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let service_role = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap();
    let tokens: Arc<dyn TokenProvider + Send + Sync> = Arc::new(StaticToken(service_role));
    let cfg = SupabaseStorageConfig::from_env().unwrap();
    let storage = SupabaseStorage::new(cfg, tokens).unwrap();
    let user = storage.get_user(UserId::new()).await.expect("get_user");
    assert!(user.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn get_account_returns_seeded_account_by_id() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let accounts = fx
        .storage
        .list_accounts(fx.user_id)
        .await
        .expect("list_accounts");
    let seeded = accounts
        .into_iter()
        .find(|a| a.name == fx.seeded_account_name)
        .expect("seeded account present");
    let fetched = fx
        .storage
        .get_account(seeded.id)
        .await
        .expect("get_account")
        .expect("account exists");
    assert_eq!(fetched.id, seeded.id);
    assert_eq!(fetched.name, fx.seeded_account_name);
}

#[tokio::test(flavor = "multi_thread")]
async fn get_account_returns_none_for_unknown_id() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let service_role = std::env::var("SUPABASE_SERVICE_ROLE_KEY").unwrap();
    let tokens: Arc<dyn TokenProvider + Send + Sync> = Arc::new(StaticToken(service_role));
    let cfg = SupabaseStorageConfig::from_env().unwrap();
    let storage = SupabaseStorage::new(cfg, tokens).unwrap();
    let result = storage
        .get_account(agicash_domain::AccountId::new())
        .await
        .expect("get_account");
    assert!(result.is_none());
}

#[tokio::test(flavor = "multi_thread")]
async fn upsert_user_with_accounts_is_idempotent() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let input = UpsertUserInput {
        user_id: fx.user_id,
        email: None,
        email_verified: false,
        accounts: vec![AccountInput {
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            name: fx.seeded_account_name.clone(),
            details: json!({"network": "MAINNET"}),
            is_default: true,
        }],
        cashu_locking_xpub: "xpub-test-reupsert".into(),
        encryption_public_key: "enc-test-reupsert".into(),
        spark_identity_public_key: "spark-test-reupsert".into(),
        terms_accepted_at: None,
        gift_card_mint_terms_accepted_at: None,
    };
    let result = fx
        .storage
        .upsert_user_with_accounts(input)
        .await
        .expect("second upsert");
    assert_eq!(result.user.id, fx.user_id);
}
