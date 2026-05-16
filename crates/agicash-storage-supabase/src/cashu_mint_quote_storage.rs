//! Postgrest-backed [`CashuMintQuoteStorage`] implementation.
//!
//! Mirrors `app/features/receive/cashu-receive-quote-repository.ts`. The six
//! RPCs we call (`create_cashu_receive_quote`,
//! `process_cashu_receive_quote_payment`, `complete_cashu_receive_quote`,
//! `expire_cashu_receive_quote`, `fail_cashu_receive_quote`) live in the
//! `wallet` schema. The `mark_cashu_receive_quote_cashu_token_melt_initiated`
//! RPC is intentionally NOT wired — slice 7 does not produce CASHU_TOKEN-typed
//! quotes.
//!
//! Encryption is hidden inside this impl. We accept an
//! [`Arc<dyn ProofEncryption>`] dep at construction; slice 5 wires up
//! [`agicash_traits::PassthroughProofEncryption`] which encodes plaintext
//! JSON as base64 in the `encrypted_data` blob.

use crate::SupabaseStorage;
use agicash_cashu::{
    CashuMintQuote, CashuMintQuoteState, CashuMintQuoteStorage, CompleteMintQuote,
    CompleteMintQuoteResult, CreateMintQuote, MintQuoteStorageError, ProcessMintQuotePayment,
    ProcessMintQuotePaymentResult,
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
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

/// Postgres-backed mint-quote storage.
pub struct SupabaseCashuMintQuoteStorage {
    base: Arc<SupabaseStorage>,
    encryption: Arc<dyn ProofEncryption>,
}

impl std::fmt::Debug for SupabaseCashuMintQuoteStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupabaseCashuMintQuoteStorage")
            .finish_non_exhaustive()
    }
}

impl SupabaseCashuMintQuoteStorage {
    pub fn new(base: Arc<SupabaseStorage>, encryption: Arc<dyn ProofEncryption>) -> Self {
        Self { base, encryption }
    }

    async fn encrypt_to_base64(&self, value: &Value) -> Result<String, MintQuoteStorageError> {
        let bytes = serde_json::to_vec(value)
            .map_err(|e| MintQuoteStorageError::Backend(format!("encode encrypted_data: {e}")))?;
        let cipher = self.encryption.encrypt(&bytes).await?;
        Ok(general_purpose::STANDARD.encode(cipher))
    }

    async fn decrypt_from_base64(&self, encoded: &str) -> Result<Value, MintQuoteStorageError> {
        let cipher = general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|e| MintQuoteStorageError::Backend(format!("decode encrypted_data: {e}")))?;
        let plain = self.encryption.decrypt(&cipher).await?;
        let value: Value = serde_json::from_slice(&plain)
            .map_err(|e| MintQuoteStorageError::Backend(format!("encrypted_data not JSON: {e}")))?;
        Ok(value)
    }
}

/// One row from `wallet.cashu_receive_quotes`. Field names match the
/// postgrest response (`snake_case` columns).
#[derive(Debug, Clone, Deserialize)]
struct CashuMintQuoteRow {
    id: Uuid,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    account_id: AccountId,
    user_id: UserId,
    keyset_id: Option<String>,
    keyset_counter: Option<i32>,
    state: String,
    version: i32,
    failure_reason: Option<String>,
    transaction_id: Uuid,
    payment_hash: String,
    locking_derivation_path: String,
    encrypted_data: String,
}

/// JSON inside `encrypted_data` (mirrors TS `CashuLightningReceiveDbDataSchema`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LightningReceiveData {
    payment_request: String,
    mint_quote_id: String,
    amount_received: Money,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    minting_fee: Option<Money>,
    /// Populated when the quote transitions to PAID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    output_amounts: Option<Vec<u64>>,
    total_fee: Money,
}

/// Wire shape for one proof in `complete_cashu_receive_quote` (matches the
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
impl CashuMintQuoteStorage for SupabaseCashuMintQuoteStorage {
    async fn create(
        &self,
        input: CreateMintQuote,
    ) -> Result<CashuMintQuote, MintQuoteStorageError> {
        let data = LightningReceiveData {
            payment_request: input.payment_request.clone(),
            mint_quote_id: input.quote_id.clone(),
            amount_received: input.amount,
            description: input.description.clone(),
            minting_fee: input.minting_fee,
            output_amounts: None,
            total_fee: input.total_fee,
        };
        let encrypted_data =
            self.encrypt_to_base64(&serde_json::to_value(&data).map_err(|e| {
                MintQuoteStorageError::Backend(format!("encode receive data: {e}"))
            })?)
            .await?;
        let quote_id_hash = sha256_hex(&input.quote_id);

        let body = serde_json::to_string(&json!({
            "p_user_id": input.user_id,
            "p_account_id": input.account_id,
            "p_currency": input.amount.currency(),
            "p_expires_at": input.expires_at,
            "p_locking_derivation_path": input.locking_derivation_path,
            "p_receive_type": "LIGHTNING",
            "p_encrypted_data": encrypted_data,
            "p_quote_id_hash": quote_id_hash,
            "p_payment_hash": input.payment_hash,
        }))
        .map_err(|e| MintQuoteStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("create_cashu_receive_quote", body)
            .execute()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(MintQuoteStorageError::Backend(format!(
                "create_cashu_receive_quote: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse response: {e}")))?;
        self.row_to_quote(value).await
    }

    async fn process_payment(
        &self,
        input: ProcessMintQuotePayment,
    ) -> Result<ProcessMintQuotePaymentResult, MintQuoteStorageError> {
        // Re-encrypt the receive-data blob with the new output_amounts.
        let existing_data = LightningReceiveData {
            payment_request: input.quote.payment_request.clone(),
            mint_quote_id: input.quote.quote_id.clone(),
            amount_received: input.quote.amount,
            description: input.quote.description.clone(),
            minting_fee: input.quote.minting_fee,
            output_amounts: Some(input.output_amounts.clone()),
            total_fee: input.quote.total_fee,
        };
        let encrypted_data =
            self.encrypt_to_base64(&serde_json::to_value(&existing_data).map_err(|e| {
                MintQuoteStorageError::Backend(format!("encode receive data: {e}"))
            })?)
            .await?;

        let body = serde_json::to_string(&json!({
            "p_quote_id": input.quote.id,
            "p_keyset_id": input.keyset_id,
            "p_number_of_outputs": input.output_amounts.len(),
            "p_encrypted_data": encrypted_data,
        }))
        .map_err(|e| MintQuoteStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("process_cashu_receive_quote_payment", body)
            .execute()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(MintQuoteStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(MintQuoteStorageError::InvalidState(text));
            }
            return Err(MintQuoteStorageError::Backend(format!(
                "process_cashu_receive_quote_payment: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse response: {e}")))?;
        let quote_value = value
            .get("quote")
            .cloned()
            .ok_or_else(|| MintQuoteStorageError::Backend("missing quote field".into()))?;
        let account_value = value
            .get("account")
            .cloned()
            .ok_or_else(|| MintQuoteStorageError::Backend("missing account field".into()))?;
        let quote = self.row_to_quote(quote_value).await?;
        let account = parse_account(account_value)?;
        Ok(ProcessMintQuotePaymentResult { quote, account })
    }

    async fn complete(
        &self,
        input: CompleteMintQuote,
    ) -> Result<CompleteMintQuoteResult, MintQuoteStorageError> {
        let mut encrypted_proofs = Vec::with_capacity(input.proofs.len());
        for p in &input.proofs {
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
            "p_quote_id": input.quote_id,
            "p_proofs": encrypted_proofs,
        }))
        .map_err(|e| MintQuoteStorageError::Backend(format!("encode rpc body: {e}")))?;
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("complete_cashu_receive_quote", body)
            .execute()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(MintQuoteStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(MintQuoteStorageError::InvalidState(text));
            }
            return Err(MintQuoteStorageError::Backend(format!(
                "complete_cashu_receive_quote: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse response: {e}")))?;
        let quote_value = value
            .get("quote")
            .cloned()
            .ok_or_else(|| MintQuoteStorageError::Backend("missing quote field".into()))?;
        let account_value = value
            .get("account")
            .cloned()
            .ok_or_else(|| MintQuoteStorageError::Backend("missing account field".into()))?;
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

        let quote = self.row_to_quote(quote_value).await?;
        let account = parse_account(account_value)?;
        Ok(CompleteMintQuoteResult {
            quote,
            account,
            added_proofs,
        })
    }

    async fn expire(&self, quote_id: Uuid) -> Result<CashuMintQuote, MintQuoteStorageError> {
        let body = serde_json::to_string(&json!({ "p_quote_id": quote_id }))
            .map_err(|e| MintQuoteStorageError::Backend(format!("encode rpc body: {e}")))?;
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("expire_cashu_receive_quote", body)
            .execute()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(MintQuoteStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(MintQuoteStorageError::InvalidState(text));
            }
            return Err(MintQuoteStorageError::Backend(format!(
                "expire_cashu_receive_quote: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse response: {e}")))?;
        self.row_to_quote(value).await
    }

    async fn fail(
        &self,
        quote_id: Uuid,
        reason: &str,
    ) -> Result<CashuMintQuote, MintQuoteStorageError> {
        let body = serde_json::to_string(&json!({
            "p_quote_id": quote_id,
            "p_failure_reason": reason,
        }))
        .map_err(|e| MintQuoteStorageError::Backend(format!("encode rpc body: {e}")))?;
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("fail_cashu_receive_quote", body)
            .execute()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(MintQuoteStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(MintQuoteStorageError::InvalidState(text));
            }
            return Err(MintQuoteStorageError::Backend(format!(
                "fail_cashu_receive_quote: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse response: {e}")))?;
        self.row_to_quote(value).await
    }

    async fn get(&self, quote_id: Uuid) -> Result<CashuMintQuote, MintQuoteStorageError> {
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .from("cashu_receive_quotes")
            .select("*")
            .eq("id", quote_id.to_string())
            .execute()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| MintQuoteStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(MintQuoteStorageError::Backend(format!(
                "select cashu_receive_quotes: HTTP {status}: {text}"
            )));
        }
        let rows: Vec<Value> = serde_json::from_str(&text)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse response: {e}")))?;
        let row = rows
            .into_iter()
            .next()
            .ok_or(MintQuoteStorageError::NotFound)?;
        self.row_to_quote(row).await
    }
}

impl SupabaseCashuMintQuoteStorage {
    async fn row_to_quote(&self, value: Value) -> Result<CashuMintQuote, MintQuoteStorageError> {
        let row: CashuMintQuoteRow = serde_json::from_value(value).map_err(|e| {
            MintQuoteStorageError::Backend(format!("parse cashu_receive_quote row: {e}"))
        })?;
        let decoded = self.decrypt_from_base64(&row.encrypted_data).await?;
        let receive: LightningReceiveData = serde_json::from_value(decoded)
            .map_err(|e| MintQuoteStorageError::Backend(format!("parse encrypted_data: {e}")))?;
        let version = u32::try_from(row.version).map_err(|_| {
            MintQuoteStorageError::Backend(format!("version out of u32 range: {}", row.version))
        })?;
        let state = match row.state.as_str() {
            "UNPAID" => CashuMintQuoteState::Unpaid,
            "PAID" => CashuMintQuoteState::Paid {
                keyset_id: row.keyset_id.clone().unwrap_or_default(),
                keyset_counter: row
                    .keyset_counter
                    .and_then(|c| u32::try_from(c).ok())
                    .unwrap_or(0),
                output_amounts: receive.output_amounts.clone().unwrap_or_default(),
            },
            "COMPLETED" => CashuMintQuoteState::Completed {
                keyset_id: row.keyset_id.clone().unwrap_or_default(),
                keyset_counter: row
                    .keyset_counter
                    .and_then(|c| u32::try_from(c).ok())
                    .unwrap_or(0),
                output_amounts: receive.output_amounts.clone().unwrap_or_default(),
            },
            "EXPIRED" => CashuMintQuoteState::Expired,
            "FAILED" => CashuMintQuoteState::Failed {
                failure_reason: row.failure_reason.unwrap_or_else(|| "unknown".to_string()),
            },
            other => {
                return Err(MintQuoteStorageError::Backend(format!(
                    "unknown mint quote state: {other}"
                )));
            }
        };
        Ok(CashuMintQuote {
            id: row.id,
            quote_id: receive.mint_quote_id,
            user_id: row.user_id,
            account_id: row.account_id,
            amount: receive.amount_received,
            description: receive.description,
            payment_request: receive.payment_request,
            payment_hash: row.payment_hash,
            locking_derivation_path: row.locking_derivation_path,
            transaction_id: row.transaction_id,
            minting_fee: receive.minting_fee,
            total_fee: receive.total_fee,
            created_at: row.created_at,
            expires_at: row.expires_at,
            version,
            state,
        })
    }
}

fn parse_account(value: Value) -> Result<Account, MintQuoteStorageError> {
    serde_json::from_value::<Account>(value)
        .map_err(|e| MintQuoteStorageError::Backend(format!("parse account row: {e}")))
}

#[allow(clippy::needless_pass_by_value)]
fn map_auth(err: agicash_traits::StorageError) -> MintQuoteStorageError {
    MintQuoteStorageError::Backend(format!("auth: {err}"))
}

fn sha256_hex(data: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data.as_bytes());
    hex::encode(hasher.finalize())
}

fn proof_to_y(secret: &str) -> String {
    use cdk::dhke::hash_to_curve;
    match hash_to_curve(secret.as_bytes()) {
        Ok(pk) => pk.to_hex(),
        Err(_) => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountPurpose, AccountState, AccountType, Currency};
    use agicash_money::Unit;
    use agicash_traits::PassthroughProofEncryption;
    use rust_decimal::Decimal;
    use serde_json::json;

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

    fn make_storage() -> SupabaseCashuMintQuoteStorage {
        let cfg = crate::SupabaseStorageConfig {
            url: "https://test.supabase.co".into(),
            anon_key: "anon".into(),
        };
        let base = Arc::new(crate::SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap());
        SupabaseCashuMintQuoteStorage::new(base, passthrough())
    }

    #[tokio::test]
    async fn encrypt_round_trip_via_passthrough() {
        let storage = make_storage();
        let value = json!({ "hello": "world" });
        let encoded = storage.encrypt_to_base64(&value).await.unwrap();
        let back = storage.decrypt_from_base64(&encoded).await.unwrap();
        assert_eq!(back, value);
    }

    #[test]
    fn sha256_hex_matches_known_vector() {
        let h = sha256_hex("abc");
        assert_eq!(
            h,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn proof_to_y_returns_hex_for_valid_secret() {
        let y = proof_to_y("0123456789abcdef");
        assert!(!y.is_empty());
        assert!(y.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn receive_data_round_trips_through_json() {
        let data = LightningReceiveData {
            payment_request: "lnbc...".into(),
            mint_quote_id: "qid".into(),
            amount_received: Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            description: Some("memo".into()),
            minting_fee: Some(Money::new(Decimal::from(1u64), Currency::Btc, Unit::Sat)),
            output_amounts: Some(vec![64]),
            total_fee: Money::new(Decimal::from(1u64), Currency::Btc, Unit::Sat),
        };
        let json = serde_json::to_value(&data).unwrap();
        assert!(json.get("paymentRequest").is_some());
        assert!(json.get("mintQuoteId").is_some());
        assert!(json.get("amountReceived").is_some());
        let back: LightningReceiveData = serde_json::from_value(json).unwrap();
        assert_eq!(back.output_amounts, Some(vec![64]));
    }

    #[tokio::test]
    async fn row_to_quote_parses_unpaid_state() {
        let storage = make_storage();
        let data = json!({
            "paymentRequest": "lnbc...",
            "mintQuoteId": "qid",
            "amountReceived": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "totalFee": Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
        });
        let encrypted = storage.encrypt_to_base64(&data).await.unwrap();
        let row = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-05-15T00:00:00Z",
            "expires_at": "2026-05-15T01:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": null,
            "keyset_counter": null,
            "state": "UNPAID",
            "version": 0,
            "failure_reason": null,
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "payment_hash": "ph",
            "locking_derivation_path": "",
            "encrypted_data": encrypted,
        });
        let quote = storage.row_to_quote(row).await.unwrap();
        assert_eq!(quote.quote_id, "qid");
        assert!(matches!(quote.state, CashuMintQuoteState::Unpaid));
    }

    #[tokio::test]
    async fn row_to_quote_parses_paid_state_with_output_amounts() {
        let storage = make_storage();
        let data = json!({
            "paymentRequest": "lnbc...",
            "mintQuoteId": "qid",
            "amountReceived": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "totalFee": Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
            "outputAmounts": [64],
        });
        let encrypted = storage.encrypt_to_base64(&data).await.unwrap();
        let row = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-05-15T00:00:00Z",
            "expires_at": "2026-05-15T01:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": "00abcdef",
            "keyset_counter": 7,
            "state": "PAID",
            "version": 1,
            "failure_reason": null,
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "payment_hash": "ph",
            "locking_derivation_path": "",
            "encrypted_data": encrypted,
        });
        let quote = storage.row_to_quote(row).await.unwrap();
        match quote.state {
            CashuMintQuoteState::Paid {
                keyset_id,
                keyset_counter,
                output_amounts,
            } => {
                assert_eq!(keyset_id, "00abcdef");
                assert_eq!(keyset_counter, 7);
                assert_eq!(output_amounts, vec![64]);
            }
            other => panic!("unexpected state: {other:?}"),
        }
    }

    #[tokio::test]
    async fn row_to_quote_parses_failed_state_with_reason() {
        let storage = make_storage();
        let data = json!({
            "paymentRequest": "lnbc...",
            "mintQuoteId": "qid",
            "amountReceived": Money::new(Decimal::from(64u64), Currency::Btc, Unit::Sat),
            "totalFee": Money::new(Decimal::from(0u64), Currency::Btc, Unit::Sat),
        });
        let encrypted = storage.encrypt_to_base64(&data).await.unwrap();
        let row = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-05-15T00:00:00Z",
            "expires_at": "2026-05-15T01:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": null,
            "keyset_counter": null,
            "state": "FAILED",
            "version": 1,
            "failure_reason": "Boom",
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "payment_hash": "ph",
            "locking_derivation_path": "",
            "encrypted_data": encrypted,
        });
        let quote = storage.row_to_quote(row).await.unwrap();
        match quote.state {
            CashuMintQuoteState::Failed { failure_reason } => assert_eq!(failure_reason, "Boom"),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn parse_account_strips_extra_cashu_proofs_field() {
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
