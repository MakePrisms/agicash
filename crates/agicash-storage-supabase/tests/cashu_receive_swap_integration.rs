//! Real-local Supabase integration tests for
//! `SupabaseCashuReceiveSwapStorage`.
//!
//! Same wiring as `user_storage_integration.rs` — uses the service role
//! JWT to bypass RLS, so the auth chain isn't exercised here. End-to-end
//! coverage with the real `OpenSecret` -> Supabase bridge lives in the CLI
//! integration test.
//!
//! Run: `cargo test -p agicash-storage-supabase --features real-supabase-tests`

#![cfg(feature = "real-supabase-tests")]

use agicash_cashu::{
    CashuReceiveSwapState, CashuReceiveSwapStorage, CreateReceiveSwap, ReceiveSwapStorageError,
    TokenProof,
};
use agicash_domain::{AccountId, AccountPurpose, AccountType, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_storage_supabase::{
    SupabaseCashuReceiveSwapStorage, SupabaseStorage, SupabaseStorageConfig,
};
use agicash_traits::{
    AccountInput, AuthError, PassthroughProofEncryption, ProofEncryption, TokenProvider,
    UpsertUserInput, UserStorage,
};
use async_trait::async_trait;
use rust_decimal::Decimal;
use serde_json::json;
use std::sync::Arc;

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

struct Fixture {
    storage: SupabaseCashuReceiveSwapStorage,
    user_id: UserId,
    account_id: AccountId,
}

async fn make_fixture() -> Fixture {
    let service_role =
        std::env::var("SUPABASE_SERVICE_ROLE_KEY").expect("SUPABASE_SERVICE_ROLE_KEY set");
    let tokens: Arc<dyn TokenProvider + Send + Sync> = Arc::new(StaticToken(service_role));
    let cfg = SupabaseStorageConfig::from_env().expect("Supabase env");
    let base = Arc::new(SupabaseStorage::new(cfg, tokens).expect("SupabaseStorage"));

    // Seed a user + cashu account so we have a target for the receive swap.
    let user_id = UserId::new();
    let pid = std::process::id();
    let nonce = uuid::Uuid::new_v4().simple().to_string();
    let mint_url = "https://test-mint.example.invalid".to_string();

    let upsert = UpsertUserInput {
        user_id,
        email: None,
        email_verified: false,
        accounts: vec![
            AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: format!("spark-{pid}-{nonce}"),
                details: json!({ "network": "MAINNET" }),
                is_default: true,
            },
            AccountInput {
                account_type: AccountType::Cashu,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: format!("mint-{pid}-{nonce}"),
                details: json!({ "mint_url": mint_url, "keyset_counters": {} }),
                is_default: false,
            },
        ],
        cashu_locking_xpub: format!("xpub-{pid}-{nonce}"),
        encryption_public_key: format!("enc-{pid}-{nonce}"),
        spark_identity_public_key: format!("spark-{pid}-{nonce}"),
        terms_accepted_at: None,
        gift_card_mint_terms_accepted_at: None,
    };
    let result = base
        .upsert_user_with_accounts(upsert)
        .await
        .expect("upsert_user_with_accounts");
    let cashu_account = result
        .accounts
        .iter()
        .find(|a| a.account_type == AccountType::Cashu)
        .expect("seeded cashu account")
        .clone();

    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let storage = SupabaseCashuReceiveSwapStorage::new(base, encryption);

    Fixture {
        storage,
        user_id,
        account_id: cashu_account.id,
    }
}

fn dummy_proof(amount: u64) -> TokenProof {
    TokenProof {
        id: "00abcdef00abcdef".into(),
        amount,
        secret: format!("secret-{amount}-{}", uuid::Uuid::new_v4()),
        c: "02".to_string() + &"a".repeat(64),
        dleq: None,
        witness: None,
    }
}

fn dummy_create(token_hash: &str, user_id: UserId, account_id: AccountId) -> CreateReceiveSwap {
    let amount = 64u64;
    CreateReceiveSwap {
        token_hash: token_hash.into(),
        token_proofs: vec![dummy_proof(amount)],
        token_mint_url: "https://test-mint.example.invalid".into(),
        token_description: Some("integration test".into()),
        user_id,
        account_id,
        keyset_id: "00abcdef00abcdef".into(),
        input_amount: Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat),
        fee_amount: Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
        amount_received: Money::new(Decimal::from(amount), Currency::Btc, Unit::Sat),
        output_amounts: vec![64],
        reversed_transaction_id: None,
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn create_then_fail_transitions_pending_to_failed() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let token_hash = format!("hash-{}", uuid::Uuid::new_v4().simple());
    let created = fx
        .storage
        .create(dummy_create(&token_hash, fx.user_id, fx.account_id))
        .await
        .expect("create");
    assert!(matches!(created.swap.state, CashuReceiveSwapState::Pending));
    assert_eq!(created.swap.token_hash, token_hash);
    assert_eq!(created.account.id, fx.account_id);

    let failed = fx
        .storage
        .fail(&token_hash, fx.user_id, "test reason")
        .await
        .expect("fail");
    match failed.state {
        CashuReceiveSwapState::Failed { failure_reason } => {
            assert_eq!(failure_reason, "test reason");
        }
        other => panic!("expected Failed, got: {other:?}"),
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn duplicate_create_returns_already_claimed() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let token_hash = format!("hash-{}", uuid::Uuid::new_v4().simple());
    fx.storage
        .create(dummy_create(&token_hash, fx.user_id, fx.account_id))
        .await
        .expect("first create");

    let err = fx
        .storage
        .create(dummy_create(&token_hash, fx.user_id, fx.account_id))
        .await
        .expect_err("second create should fail");
    assert!(
        matches!(err, ReceiveSwapStorageError::AlreadyClaimed),
        "got: {err:?}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn fail_then_fail_again_is_idempotent() {
    if !env_ready() {
        eprintln!("skipping: env vars not set");
        return;
    }
    let fx = make_fixture().await;
    let token_hash = format!("hash-{}", uuid::Uuid::new_v4().simple());
    fx.storage
        .create(dummy_create(&token_hash, fx.user_id, fx.account_id))
        .await
        .expect("create");
    let first = fx
        .storage
        .fail(&token_hash, fx.user_id, "reason A")
        .await
        .expect("fail #1");
    let second = fx
        .storage
        .fail(&token_hash, fx.user_id, "reason B (ignored)")
        .await
        .expect("fail #2 idempotent");
    match (first.state, second.state) {
        (
            CashuReceiveSwapState::Failed {
                failure_reason: a, ..
            },
            CashuReceiveSwapState::Failed {
                failure_reason: b, ..
            },
        ) => {
            // Idempotent: returns the existing FAILED row with its original
            // reason intact.
            assert_eq!(a, b);
            assert_eq!(a, "reason A");
        }
        other => panic!("unexpected states: {other:?}"),
    }
}
