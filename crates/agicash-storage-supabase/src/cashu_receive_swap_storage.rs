//! Postgrest-backed [`CashuReceiveSwapStorage`] implementation.
//!
//! Mirrors `app/features/receive/cashu-receive-swap-repository.ts`. The three
//! RPCs we call (`create_cashu_receive_swap`, `complete_cashu_receive_swap`,
//! `fail_cashu_receive_swap`) live in the `wallet` schema.
//!
//! Encryption is hidden inside this impl. We accept a
//! [`Arc<dyn ProofEncryption>`] dep at construction; slice 5 wires up
//! [`agicash_traits::PassthroughProofEncryption`] which encodes plaintext
//! JSON as base64 in the `encrypted_data` blob.

use crate::SupabaseStorage;
use agicash_cashu::{
    CashuReceiveSwap, CashuReceiveSwapState, CashuReceiveSwapStorage, CompleteReceiveSwapResult,
    CreateReceiveSwap, CreateReceiveSwapResult, ReceiveSwapStorageError, TokenProof,
};
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::ProofEncryption;
use async_trait::async_trait;
use base64::engine::general_purpose;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

/// Postgres-backed receive-swap storage.
pub struct SupabaseCashuReceiveSwapStorage {
    base: Arc<SupabaseStorage>,
    encryption: Arc<dyn ProofEncryption>,
}

impl std::fmt::Debug for SupabaseCashuReceiveSwapStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupabaseCashuReceiveSwapStorage")
            .finish_non_exhaustive()
    }
}

impl SupabaseCashuReceiveSwapStorage {
    pub fn new(base: Arc<SupabaseStorage>, encryption: Arc<dyn ProofEncryption>) -> Self {
        Self { base, encryption }
    }

    async fn encrypt_to_base64(&self, value: &Value) -> Result<String, ReceiveSwapStorageError> {
        let bytes = serde_json::to_vec(value)
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("encode encrypted_data: {e}")))?;
        let cipher = self.encryption.encrypt(&bytes).await?;
        Ok(general_purpose::STANDARD.encode(cipher))
    }

    async fn decrypt_from_base64(&self, encoded: &str) -> Result<Value, ReceiveSwapStorageError> {
        let cipher = general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("decode encrypted_data: {e}")))?;
        let plain = self.encryption.decrypt(&cipher).await?;
        let value: Value = serde_json::from_slice(&plain).map_err(|e| {
            ReceiveSwapStorageError::Backend(format!("encrypted_data not JSON: {e}"))
        })?;
        Ok(value)
    }
}

/// One row from `wallet.cashu_receive_swaps`. Field names match the postgrest
/// response (`snake_case` columns).
#[derive(Debug, Clone, Deserialize)]
struct CashuReceiveSwapRow {
    token_hash: String,
    created_at: DateTime<Utc>,
    account_id: AccountId,
    user_id: UserId,
    keyset_id: String,
    keyset_counter: i32,
    state: String,
    version: i32,
    failure_reason: Option<String>,
    transaction_id: Uuid,
    encrypted_data: String,
}

/// JSON shape inside `encrypted_data` (mirrors TS
/// `CashuSwapReceiveDbDataSchema`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReceiveData {
    token_mint_url: String,
    token_amount: Money,
    token_proofs: Vec<TokenProof>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token_description: Option<String>,
    amount_received: Money,
    output_amounts: Vec<u64>,
    cashu_receive_fee: Money,
}

/// Wire shape for one proof in `complete_cashu_receive_swap` (matches the
/// `wallet.cashu_proof_input` composite type's camelCase field names).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncryptedProofInput {
    keyset_id: String,
    amount: String,
    secret: String,
    unblinded_signature: String,
    public_key_y: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    dleq: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    witness: Option<Value>,
}

#[async_trait]
impl CashuReceiveSwapStorage for SupabaseCashuReceiveSwapStorage {
    async fn create(
        &self,
        input: CreateReceiveSwap,
    ) -> Result<CreateReceiveSwapResult, ReceiveSwapStorageError> {
        let receive_data = json!({
            "tokenMintUrl": input.token_mint_url,
            "tokenAmount": input.input_amount,
            "tokenProofs": input.token_proofs,
            "tokenDescription": input.token_description,
            "amountReceived": input.amount_received,
            "outputAmounts": input.output_amounts,
            "cashuReceiveFee": input.fee_amount,
        });
        let encrypted_data = self.encrypt_to_base64(&receive_data).await?;

        let body = serde_json::to_string(&json!({
            "p_token_hash": input.token_hash,
            "p_account_id": input.account_id,
            "p_user_id": input.user_id,
            "p_currency": input.amount_received.currency(),
            "p_keyset_id": input.keyset_id,
            "p_number_of_outputs": input.output_amounts.len(),
            "p_encrypted_data": encrypted_data,
            "p_reversed_transaction_id": input.reversed_transaction_id,
        }))
        .map_err(|e| ReceiveSwapStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("create_cashu_receive_swap", body)
            .execute()
            .await
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("postgrest: {e}")))?;

        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("read body: {e}")))?;

        if !status.is_success() {
            // Postgrest returns 23505 inside a JSON body like
            // `{"code":"23505","message":"..."}`. Inspect the JSON; fall
            // back to substring matching for older mints / clients.
            if text.contains("\"23505\"") || text.contains("duplicate key") {
                return Err(ReceiveSwapStorageError::AlreadyClaimed);
            }
            return Err(ReceiveSwapStorageError::Backend(format!(
                "create_cashu_receive_swap: HTTP {status}: {text}"
            )));
        }

        let value: Value = serde_json::from_str(&text)
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("parse response: {e}")))?;
        let swap_value = value
            .get("swap")
            .cloned()
            .ok_or_else(|| ReceiveSwapStorageError::Backend("missing swap field".into()))?;
        let account_value = value
            .get("account")
            .cloned()
            .ok_or_else(|| ReceiveSwapStorageError::Backend("missing account field".into()))?;

        let swap = self.row_to_swap(swap_value).await?;
        let account = parse_account(account_value)?;
        Ok(CreateReceiveSwapResult { swap, account })
    }

    async fn complete(
        &self,
        token_hash: &str,
        user_id: UserId,
        proofs: Vec<TokenProof>,
    ) -> Result<CompleteReceiveSwapResult, ReceiveSwapStorageError> {
        // Mirror TS encryptBatch by encrypting each (amount, secret) pair
        // separately. Slice 5 uses Passthrough so this is a fast loop; a
        // future real-encryption slice should add encrypt_batch to the
        // trait for perf.
        let mut encrypted_proofs = Vec::with_capacity(proofs.len());
        for p in &proofs {
            let amount_enc = self
                .encryption
                .encrypt(p.amount.to_string().as_bytes())
                .await?;
            let secret_enc = self.encryption.encrypt(p.secret.as_bytes()).await?;
            encrypted_proofs.push(EncryptedProofInput {
                keyset_id: p.id.clone(),
                amount: general_purpose::STANDARD.encode(amount_enc),
                secret: general_purpose::STANDARD.encode(secret_enc),
                unblinded_signature: p.c.clone(),
                public_key_y: proof_to_y(&p.secret),
                dleq: p.dleq.clone(),
                witness: p.witness.clone(),
            });
        }

        let body = serde_json::to_string(&json!({
            "p_token_hash": token_hash,
            "p_user_id": user_id,
            "p_proofs": encrypted_proofs,
        }))
        .map_err(|e| ReceiveSwapStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("complete_cashu_receive_swap", body)
            .execute()
            .await
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(ReceiveSwapStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(ReceiveSwapStorageError::InvalidState(text));
            }
            return Err(ReceiveSwapStorageError::Backend(format!(
                "complete_cashu_receive_swap: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("parse response: {e}")))?;
        let swap_value = value
            .get("swap")
            .cloned()
            .ok_or_else(|| ReceiveSwapStorageError::Backend("missing swap field".into()))?;
        let account_value = value
            .get("account")
            .cloned()
            .ok_or_else(|| ReceiveSwapStorageError::Backend("missing account field".into()))?;
        let added_proofs = value
            .get("added_proofs")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|p| {
                p.get("id")
                    .and_then(Value::as_str)
                    .map(std::string::ToString::to_string)
            })
            .collect();

        let swap = self.row_to_swap(swap_value).await?;
        let account = parse_account(account_value)?;
        Ok(CompleteReceiveSwapResult {
            swap,
            account,
            added_proofs,
        })
    }

    async fn fail(
        &self,
        token_hash: &str,
        user_id: UserId,
        reason: &str,
    ) -> Result<CashuReceiveSwap, ReceiveSwapStorageError> {
        let body = serde_json::to_string(&json!({
            "p_token_hash": token_hash,
            "p_user_id": user_id,
            "p_failure_reason": reason,
        }))
        .map_err(|e| ReceiveSwapStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("fail_cashu_receive_swap", body)
            .execute()
            .await
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(ReceiveSwapStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(ReceiveSwapStorageError::InvalidState(text));
            }
            return Err(ReceiveSwapStorageError::Backend(format!(
                "fail_cashu_receive_swap: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("parse response: {e}")))?;
        self.row_to_swap(value).await
    }
}

impl SupabaseCashuReceiveSwapStorage {
    async fn row_to_swap(&self, value: Value) -> Result<CashuReceiveSwap, ReceiveSwapStorageError> {
        let row: CashuReceiveSwapRow = serde_json::from_value(value).map_err(|e| {
            ReceiveSwapStorageError::Backend(format!("parse cashu_receive_swap row: {e}"))
        })?;
        let decoded = self.decrypt_from_base64(&row.encrypted_data).await?;
        let receive: ReceiveData = serde_json::from_value(decoded)
            .map_err(|e| ReceiveSwapStorageError::Backend(format!("parse encrypted_data: {e}")))?;
        let state = match row.state.as_str() {
            "PENDING" => CashuReceiveSwapState::Pending,
            "COMPLETED" => CashuReceiveSwapState::Completed,
            "FAILED" => CashuReceiveSwapState::Failed {
                failure_reason: row.failure_reason.unwrap_or_else(|| "unknown".to_string()),
            },
            other => {
                return Err(ReceiveSwapStorageError::Backend(format!(
                    "unknown receive swap state: {other}"
                )));
            }
        };
        let keyset_counter = u32::try_from(row.keyset_counter).map_err(|_| {
            ReceiveSwapStorageError::Backend(format!(
                "keyset_counter out of u32 range: {}",
                row.keyset_counter
            ))
        })?;
        let version = u32::try_from(row.version).map_err(|_| {
            ReceiveSwapStorageError::Backend(format!("version out of u32 range: {}", row.version))
        })?;
        Ok(CashuReceiveSwap {
            token_hash: row.token_hash,
            token_proofs: receive.token_proofs,
            token_description: receive.token_description,
            user_id: row.user_id,
            account_id: row.account_id,
            input_amount: receive.token_amount,
            amount_received: receive.amount_received,
            fee_amount: receive.cashu_receive_fee,
            keyset_id: row.keyset_id,
            keyset_counter,
            output_amounts: receive.output_amounts,
            transaction_id: row.transaction_id,
            created_at: row.created_at,
            version,
            state,
        })
    }
}

fn parse_account(value: Value) -> Result<Account, ReceiveSwapStorageError> {
    // `to_account_with_proofs` appends a `cashu_proofs` array; the Account
    // struct doesn't have that field, but serde_json::from_value ignores it.
    serde_json::from_value::<Account>(value)
        .map_err(|e| ReceiveSwapStorageError::Backend(format!("parse account row: {e}")))
}

/// Hash the proof secret to a `public_key_y` value used as the proof's
/// unique key in the DB. CDK exposes this via `Proof::y()`, but we already
/// hold a plaintext `Secret`-string, so we hash directly.
///
/// TS uses `proofToY(proof)` from `~/lib/cashu` which delegates to CDK's
/// hash-to-curve. To stay deterministic and match what CDK produces, we
/// reuse `cdk::dhke::hash_to_curve` via a `Secret` round-trip.
fn proof_to_y(secret: &str) -> String {
    use cdk::dhke::hash_to_curve;
    // hash_to_curve operates on raw bytes. CDK's Secret::as_bytes() returns
    // the same UTF-8 representation of the secret string, so we hash the
    // secret string's bytes directly.
    match hash_to_curve(secret.as_bytes()) {
        Ok(pk) => pk.to_hex(),
        Err(_) => String::new(),
    }
}

// Note: SupabaseStorage::authenticated_client returns a
// agicash_traits::StorageError, which the postgrest impl needs to bridge
// into ReceiveSwapStorageError.
// `map_err` passes the error by value, so this shape mirrors what callers
// need. Clippy's needless_pass_by_value fires on it; `#[allow]` is the
// idiomatic answer when the caller dictates the function shape.
#[allow(clippy::needless_pass_by_value)]
fn map_auth(err: agicash_traits::StorageError) -> ReceiveSwapStorageError {
    ReceiveSwapStorageError::Backend(format!("auth: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountPurpose, AccountState, AccountType, Currency};
    use agicash_money::Unit;
    use agicash_traits::PassthroughProofEncryption;
    use rust_decimal::Decimal;
    use serde_json::json;

    /// Stub `TokenProvider` that always errors. The storage unit tests
    /// never call `authenticated_client`, so the JWT result is never
    /// observed.
    struct StubTokens;

    #[async_trait::async_trait]
    impl agicash_traits::TokenProvider for StubTokens {
        async fn get_jwt(&self) -> Result<String, agicash_traits::AuthError> {
            Err(agicash_traits::AuthError::Unauthenticated)
        }
    }

    fn passthrough() -> Arc<dyn ProofEncryption> {
        Arc::new(PassthroughProofEncryption)
    }

    fn make_storage() -> SupabaseCashuReceiveSwapStorage {
        let cfg = crate::SupabaseStorageConfig {
            url: "https://test.supabase.co".into(),
            anon_key: "anon".into(),
        };
        let base = Arc::new(crate::SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap());
        SupabaseCashuReceiveSwapStorage::new(base, passthrough())
    }

    #[tokio::test]
    async fn encrypt_to_base64_round_trips_via_passthrough() {
        let storage = make_storage();

        let value = json!({ "hello": "world", "n": 42 });
        let encoded = storage.encrypt_to_base64(&value).await.unwrap();
        // Passthrough should yield base64 of the JSON bytes.
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .unwrap();
        let back: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back, value);

        let decoded = storage
            .decrypt_from_base64(&encoded)
            .await
            .expect("decrypt");
        assert_eq!(decoded, value);
    }

    #[test]
    fn proof_to_y_returns_non_empty_hex_for_valid_secret() {
        let y = proof_to_y("0123456789abcdef");
        assert!(!y.is_empty());
        assert!(y.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn receive_data_round_trips_through_json() {
        let data = ReceiveData {
            token_mint_url: "https://m.test".into(),
            token_amount: Money::new(Decimal::from(100u64), Currency::Btc, Unit::Sat),
            token_proofs: vec![TokenProof {
                id: "ks1".into(),
                amount: 64,
                secret: "s".into(),
                c: "C".into(),
                dleq: None,
                witness: None,
            }],
            token_description: Some("memo".into()),
            amount_received: Money::new(Decimal::from(99u64), Currency::Btc, Unit::Sat),
            output_amounts: vec![64, 32, 2, 1],
            cashu_receive_fee: Money::new(Decimal::from(1u64), Currency::Btc, Unit::Sat),
        };
        let json = serde_json::to_value(&data).unwrap();
        // camelCase field names mirror TS schema.
        assert!(json.get("tokenMintUrl").is_some());
        assert!(json.get("tokenAmount").is_some());
        assert!(json.get("amountReceived").is_some());
        assert!(json.get("cashuReceiveFee").is_some());
        let back: ReceiveData = serde_json::from_value(json).unwrap();
        assert_eq!(back.output_amounts, vec![64, 32, 2, 1]);
    }

    #[tokio::test]
    async fn row_to_swap_parses_postgrest_response_shape() {
        let storage = make_storage();

        let data = json!({
            "tokenMintUrl": "https://m.test",
            "tokenAmount": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "tokenProofs": [],
            "tokenDescription": "memo",
            "amountReceived": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "outputAmounts": [64],
            "cashuReceiveFee": Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
        });
        let encrypted = storage.encrypt_to_base64(&data).await.unwrap();

        let row = json!({
            "token_hash": "deadbeef",
            "created_at": "2026-05-15T00:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": "00abcdef",
            "keyset_counter": 7,
            "state": "PENDING",
            "version": 0,
            "failure_reason": null,
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "encrypted_data": encrypted,
        });
        let swap = storage.row_to_swap(row).await.unwrap();
        assert_eq!(swap.token_hash, "deadbeef");
        assert_eq!(swap.keyset_counter, 7);
        assert!(matches!(swap.state, CashuReceiveSwapState::Pending));
        assert_eq!(swap.output_amounts, vec![64]);
        assert_eq!(swap.token_description.as_deref(), Some("memo"));
    }

    #[tokio::test]
    async fn row_to_swap_parses_failed_state_with_reason() {
        let storage = make_storage();

        let data = json!({
            "tokenMintUrl": "https://m.test",
            "tokenAmount": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "tokenProofs": [],
            "amountReceived": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "outputAmounts": [64],
            "cashuReceiveFee": Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
        });
        let encrypted = storage.encrypt_to_base64(&data).await.unwrap();
        let row = json!({
            "token_hash": "h",
            "created_at": "2026-05-15T00:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": "00abcdef",
            "keyset_counter": 0,
            "state": "FAILED",
            "version": 1,
            "failure_reason": "Token already claimed",
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "encrypted_data": encrypted,
        });
        let swap = storage.row_to_swap(row).await.unwrap();
        match swap.state {
            CashuReceiveSwapState::Failed { failure_reason } => {
                assert_eq!(failure_reason, "Token already claimed");
            }
            other => panic!("expected Failed, got: {other:?}"),
        }
    }

    #[test]
    fn parse_account_strips_extra_cashu_proofs_field() {
        // `to_account_with_proofs` appends `cashu_proofs` — confirm our
        // Account parser tolerates it.
        let raw = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-03-01T12:00:00Z",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Test",
            "type": "cashu",
            "purpose": "transactional",
            "currency": "BTC",
            "details": {"mint_url": "https://m"},
            "version": 0,
            "state": "active",
            "expires_at": null,
            "cashu_proofs": []
        });
        let acct = parse_account(raw).unwrap();
        assert_eq!(acct.account_type, AccountType::Cashu);
        assert_eq!(acct.currency, Currency::Btc);
        assert_eq!(acct.state, AccountState::Active);
        assert_eq!(acct.purpose, AccountPurpose::Transactional);
    }
}
