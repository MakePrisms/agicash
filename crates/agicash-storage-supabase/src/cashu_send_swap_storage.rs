//! Postgrest-backed [`CashuSendSwapStorage`] implementation.
//!
//! Mirrors `app/features/send/cashu-send-swap-repository.ts`. The four RPCs
//! we call (`create_cashu_send_swap`, `commit_proofs_to_send`,
//! `complete_cashu_send_swap`, `fail_cashu_send_swap`) live in the `wallet`
//! schema.
//!
//! Encryption is hidden inside this impl. We accept a
//! [`Arc<dyn ProofEncryption>`] dep at construction; slice 5 wires up
//! [`agicash_traits::PassthroughProofEncryption`] which encodes plaintext
//! JSON as base64 in the `encrypted_data` blob.

use crate::SupabaseStorage;
use agicash_cashu::{
    CashuSendSwap, CashuSendSwapState, CashuSendSwapStorage, CommitProofsToSend, CreateSendSwap,
    CreateSendSwapResult, OutputAmounts, ProofWithId, SendSwapStorageError, TokenProof,
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

/// Postgres-backed send-swap storage.
pub struct SupabaseCashuSendSwapStorage {
    base: Arc<SupabaseStorage>,
    encryption: Arc<dyn ProofEncryption>,
}

impl std::fmt::Debug for SupabaseCashuSendSwapStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupabaseCashuSendSwapStorage")
            .finish_non_exhaustive()
    }
}

impl SupabaseCashuSendSwapStorage {
    pub fn new(base: Arc<SupabaseStorage>, encryption: Arc<dyn ProofEncryption>) -> Self {
        Self { base, encryption }
    }

    async fn encrypt_to_base64(&self, value: &Value) -> Result<String, SendSwapStorageError> {
        let bytes = serde_json::to_vec(value)
            .map_err(|e| SendSwapStorageError::Backend(format!("encode encrypted_data: {e}")))?;
        let cipher = self.encryption.encrypt(&bytes).await?;
        Ok(general_purpose::STANDARD.encode(cipher))
    }

    async fn decrypt_from_base64(&self, encoded: &str) -> Result<Value, SendSwapStorageError> {
        let cipher = general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .map_err(|e| SendSwapStorageError::Backend(format!("decode encrypted_data: {e}")))?;
        let plain = self.encryption.decrypt(&cipher).await?;
        let value: Value = serde_json::from_slice(&plain)
            .map_err(|e| SendSwapStorageError::Backend(format!("encrypted_data not JSON: {e}")))?;
        Ok(value)
    }
}

/// One row from `wallet.cashu_send_swaps`. Field names match the postgrest
/// response (`snake_case` columns).
#[derive(Debug, Clone, Deserialize)]
struct CashuSendSwapRow {
    id: Uuid,
    created_at: DateTime<Utc>,
    account_id: AccountId,
    user_id: UserId,
    keyset_id: Option<String>,
    keyset_counter: Option<i32>,
    state: String,
    version: i32,
    failure_reason: Option<String>,
    transaction_id: Uuid,
    encrypted_data: String,
    requires_input_proofs_swap: bool,
    token_hash: Option<String>,
    #[serde(default)]
    cashu_proofs: Vec<CashuProofRow>,
}

/// One row from `wallet.cashu_proofs` joined onto a swap. Used both for
/// the input proofs (no `cashu_send_swap_id` matches `swap.id`) and the
/// proofs-to-send / change proofs (set on the swap).
#[derive(Debug, Clone, Deserialize)]
struct CashuProofRow {
    id: Uuid,
    keyset_id: String,
    /// Encrypted payloads (base64-of-cipher).
    amount: String,
    secret: String,
    unblinded_signature: String,
    #[serde(default)]
    dleq: Option<Value>,
    #[serde(default)]
    witness: Option<Value>,
    #[serde(default)]
    cashu_send_swap_id: Option<Uuid>,
    #[serde(default)]
    spending_cashu_send_swap_id: Option<Uuid>,
}

/// JSON shape inside `encrypted_data` for a send swap. Mirrors TS
/// `CashuSwapSendDbDataSchema`. All Money fields are serialized using the
/// shared agicash-money serde shape so the web app can read them too.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SendData {
    token_mint_url: String,
    amount_received: Money,
    cashu_receive_fee: Money,
    amount_to_send: Money,
    cashu_send_fee: Money,
    amount_spent: Money,
    amount_reserved: Money,
    total_fee: Money,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    output_amounts: Option<OutputAmounts>,
}

/// Wire shape for one proof in `commit_proofs_to_send` (matches the
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
impl CashuSendSwapStorage for SupabaseCashuSendSwapStorage {
    async fn create(
        &self,
        input: CreateSendSwap,
    ) -> Result<CreateSendSwapResult, SendSwapStorageError> {
        let requires_input_proofs_swap = input.input_amount != input.amount_to_send;
        let send_data = json!({
            "tokenMintUrl": input.token_mint_url,
            "amountReceived": input.amount_requested,
            "cashuReceiveFee": input.cashu_receive_fee,
            "amountToSend": input.amount_to_send,
            "cashuSendFee": input.cashu_send_fee,
            "amountSpent": input.total_amount,
            "amountReserved": input.input_amount,
            "totalFee": add_money(&input.cashu_send_fee, &input.cashu_receive_fee)?,
            "outputAmounts": input.output_amounts,
        });
        let encrypted_data = self.encrypt_to_base64(&send_data).await?;

        let number_of_outputs: Option<usize> = if requires_input_proofs_swap {
            input
                .output_amounts
                .as_ref()
                .map(|o| o.send.len() + o.change.len())
        } else {
            None
        };

        let body = serde_json::to_string(&json!({
            "p_user_id": input.user_id,
            "p_account_id": input.account_id,
            "p_input_proofs": input.input_proof_ids,
            "p_currency": input.amount_to_send.currency(),
            "p_encrypted_data": encrypted_data,
            "p_requires_input_proofs_swap": requires_input_proofs_swap,
            "p_token_hash": input.token_hash,
            "p_keyset_id": input.keyset_id,
            "p_number_of_outputs": number_of_outputs,
        }))
        .map_err(|e| SendSwapStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("create_cashu_send_swap", body)
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("CONCURRENCY_ERROR") {
                return Err(SendSwapStorageError::Concurrency(text));
            }
            return Err(SendSwapStorageError::Backend(format!(
                "create_cashu_send_swap: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse response: {e}")))?;
        let swap_value = value
            .get("swap")
            .cloned()
            .ok_or_else(|| SendSwapStorageError::Backend("missing swap field".into()))?;
        let reserved_proofs = value.get("reserved_proofs").cloned().unwrap_or(Value::Null);
        let account_value = value
            .get("account")
            .cloned()
            .ok_or_else(|| SendSwapStorageError::Backend("missing account field".into()))?;

        let swap = self
            .row_to_swap_with_extra_proofs(swap_value, Some(reserved_proofs))
            .await?;
        let account = parse_account(account_value)?;
        Ok(CreateSendSwapResult { swap, account })
    }

    async fn commit_proofs_to_send(
        &self,
        input: CommitProofsToSend,
    ) -> Result<CashuSendSwap, SendSwapStorageError> {
        let mut encrypted_send: Vec<EncryptedProofInput> =
            Vec::with_capacity(input.proofs_to_send.len());
        for p in &input.proofs_to_send {
            encrypted_send.push(self.to_encrypted_proof_input(p).await?);
        }
        let mut encrypted_change: Vec<EncryptedProofInput> =
            Vec::with_capacity(input.change_proofs.len());
        for p in &input.change_proofs {
            encrypted_change.push(self.to_encrypted_proof_input(p).await?);
        }

        let body = serde_json::to_string(&json!({
            "p_swap_id": input.swap_id,
            "p_proofs_to_send": encrypted_send,
            "p_change_proofs": encrypted_change,
            "p_token_hash": input.token_hash,
        }))
        .map_err(|e| SendSwapStorageError::Backend(format!("encode rpc body: {e}")))?;

        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("commit_proofs_to_send", body)
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(SendSwapStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(SendSwapStorageError::InvalidState(text));
            }
            return Err(SendSwapStorageError::Backend(format!(
                "commit_proofs_to_send: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse response: {e}")))?;
        let swap_value = value
            .get("swap")
            .cloned()
            .ok_or_else(|| SendSwapStorageError::Backend("missing swap field".into()))?;
        let mut extra: Vec<Value> = Vec::new();
        if let Some(arr) = value.get("reserved_proofs").and_then(Value::as_array) {
            extra.extend(arr.iter().cloned());
        }
        if let Some(arr) = value.get("change_proofs").and_then(Value::as_array) {
            extra.extend(arr.iter().cloned());
        }
        self.row_to_swap_with_extra_proofs(swap_value, Some(Value::Array(extra)))
            .await
    }

    async fn complete(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
        let body = serde_json::to_string(&json!({ "p_swap_id": swap_id }))
            .map_err(|e| SendSwapStorageError::Backend(format!("encode rpc body: {e}")))?;
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("complete_cashu_send_swap", body)
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(SendSwapStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(SendSwapStorageError::InvalidState(text));
            }
            return Err(SendSwapStorageError::Backend(format!(
                "complete_cashu_send_swap: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse response: {e}")))?;
        let swap_value = value
            .get("swap")
            .cloned()
            .ok_or_else(|| SendSwapStorageError::Backend("missing swap field".into()))?;
        let extra = value.get("spent_proofs").cloned();
        self.row_to_swap_with_extra_proofs(swap_value, extra).await
    }

    async fn list_unspent_proofs(
        &self,
        account_id: AccountId,
    ) -> Result<Vec<ProofWithId>, SendSwapStorageError> {
        tracing::info!(
            target: "agicash_storage_supabase::cashu_send_swap_storage",
            account_id = %account_id,
            url = %format!("{}/cashu_proofs?account_id=eq.{}&state=eq.UNSPENT", self.base.rest_url, account_id),
            method = "GET",
            "list_unspent_proofs: request"
        );
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .from("cashu_proofs")
            .select("*")
            .eq("account_id", account_id.to_string())
            .eq("state", "UNSPENT")
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("read body: {e}")))?;
        tracing::info!(
            target: "agicash_storage_supabase::cashu_send_swap_storage",
            account_id = %account_id,
            http_status = status.as_u16(),
            body_len = text.len(),
            body_preview = %text.chars().take(200).collect::<String>(),
            "list_unspent_proofs: response"
        );
        if !status.is_success() {
            tracing::warn!(
                target: "agicash_storage_supabase::cashu_send_swap_storage",
                account_id = %account_id,
                http_status = status.as_u16(),
                "list_unspent_proofs: non-success HTTP status"
            );
            return Err(SendSwapStorageError::Backend(format!(
                "list_unspent_proofs: HTTP {status}: {text}"
            )));
        }
        let rows: Vec<CashuProofRow> = serde_json::from_str(&text)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse proofs: {e}")))?;
        tracing::info!(
            target: "agicash_storage_supabase::cashu_send_swap_storage",
            account_id = %account_id,
            row_count = rows.len(),
            "list_unspent_proofs: parsed proof rows"
        );
        let mut out = Vec::with_capacity(rows.len());
        for row in &rows {
            let proof = self.decrypt_proof(row).await?;
            out.push(ProofWithId { id: row.id, proof });
        }
        tracing::info!(
            target: "agicash_storage_supabase::cashu_send_swap_storage",
            account_id = %account_id,
            decrypted_count = out.len(),
            "list_unspent_proofs: returning"
        );
        Ok(out)
    }

    async fn fail(
        &self,
        swap_id: Uuid,
        reason: &str,
    ) -> Result<CashuSendSwap, SendSwapStorageError> {
        let body = serde_json::to_string(&json!({
            "p_swap_id": swap_id,
            "p_reason": reason,
        }))
        .map_err(|e| SendSwapStorageError::Backend(format!("encode rpc body: {e}")))?;
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .rpc("fail_cashu_send_swap", body)
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            if text.contains("NOT_FOUND") {
                return Err(SendSwapStorageError::NotFound);
            }
            if text.contains("INVALID_STATE") {
                return Err(SendSwapStorageError::InvalidState(text));
            }
            return Err(SendSwapStorageError::Backend(format!(
                "fail_cashu_send_swap: HTTP {status}: {text}"
            )));
        }
        let value: Value = serde_json::from_str(&text)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse response: {e}")))?;
        let swap_value = value
            .get("swap")
            .cloned()
            .ok_or_else(|| SendSwapStorageError::Backend("missing swap field".into()))?;
        let extra = value.get("released_proofs").cloned();
        self.row_to_swap_with_extra_proofs(swap_value, extra).await
    }

    async fn get(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
        // Single-row read used by the FFI `check_send_swap_claimed`
        // path. Embeds the joined `cashu_proofs` so
        // `row_to_swap_with_extra_proofs` can rebuild proofs_to_send /
        // input_proofs without a second round trip. Mirrors
        // `CashuMeltQuoteStorage::get`.
        let client = self.base.authenticated_client().await.map_err(map_auth)?;
        let response = client
            .from("cashu_send_swaps")
            .select("*, cashu_proofs!cashu_send_swap_id(*)")
            .eq("id", swap_id.to_string())
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("postgrest: {e}")))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("read body: {e}")))?;
        if !status.is_success() {
            return Err(SendSwapStorageError::Backend(format!(
                "get cashu_send_swap: HTTP {status}: {text}"
            )));
        }
        // PostgREST returns an array even for single-row queries unless
        // `Accept: application/vnd.pgrst.object+json` is set. Decode the
        // array and take the first element; empty array → NotFound.
        let rows: Vec<Value> = serde_json::from_str(&text)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse rows: {e}")))?;
        let row = rows
            .into_iter()
            .next()
            .ok_or(SendSwapStorageError::NotFound)?;
        self.row_to_swap_with_extra_proofs(row, None).await
    }
}

impl SupabaseCashuSendSwapStorage {
    async fn to_encrypted_proof_input(
        &self,
        proof: &TokenProof,
    ) -> Result<EncryptedProofInput, SendSwapStorageError> {
        let amount_enc = self
            .encryption
            .encrypt(proof.amount.to_string().as_bytes())
            .await?;
        let secret_enc = self.encryption.encrypt(proof.secret.as_bytes()).await?;
        Ok(EncryptedProofInput {
            keyset_id: proof.id.clone(),
            amount: general_purpose::STANDARD.encode(amount_enc),
            secret: general_purpose::STANDARD.encode(secret_enc),
            unblinded_signature: proof.c.clone(),
            public_key_y: proof_to_y(&proof.secret),
            dleq: proof.dleq.clone(),
            witness: proof.witness.clone(),
        })
    }

    async fn decrypt_proof(&self, row: &CashuProofRow) -> Result<TokenProof, SendSwapStorageError> {
        let amount_bytes = general_purpose::STANDARD
            .decode(row.amount.as_bytes())
            .map_err(|e| SendSwapStorageError::Backend(format!("decode amount: {e}")))?;
        let secret_bytes = general_purpose::STANDARD
            .decode(row.secret.as_bytes())
            .map_err(|e| SendSwapStorageError::Backend(format!("decode secret: {e}")))?;
        let amount_plain = self.encryption.decrypt(&amount_bytes).await?;
        let secret_plain = self.encryption.decrypt(&secret_bytes).await?;
        let amount: u64 = std::str::from_utf8(&amount_plain)
            .map_err(|e| SendSwapStorageError::Backend(format!("amount utf8: {e}")))?
            .parse()
            .map_err(|e| SendSwapStorageError::Backend(format!("amount parse: {e}")))?;
        let secret = std::str::from_utf8(&secret_plain)
            .map_err(|e| SendSwapStorageError::Backend(format!("secret utf8: {e}")))?
            .to_string();
        Ok(TokenProof {
            id: row.keyset_id.clone(),
            amount,
            secret,
            c: row.unblinded_signature.clone(),
            dleq: row.dleq.clone(),
            witness: row.witness.clone(),
        })
    }

    /// Build a [`CashuSendSwap`] from a postgrest swap row + (optionally)
    /// an extra `cashu_proofs` array supplied alongside (e.g. from RPC
    /// composite responses where `cashu_proofs` is split into reserved /
    /// change buckets).
    async fn row_to_swap_with_extra_proofs(
        &self,
        value: Value,
        extra_proofs: Option<Value>,
    ) -> Result<CashuSendSwap, SendSwapStorageError> {
        // Merge extra_proofs into the row's cashu_proofs field if present.
        let mut row_value = value;
        if let Some(extra) = extra_proofs {
            if let Some(arr) = extra.as_array() {
                let mut combined: Vec<Value> = row_value
                    .get("cashu_proofs")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                for p in arr {
                    combined.push(p.clone());
                }
                row_value
                    .as_object_mut()
                    .ok_or_else(|| SendSwapStorageError::Backend("swap row not an object".into()))?
                    .insert("cashu_proofs".into(), Value::Array(combined));
            }
        }

        let row: CashuSendSwapRow = serde_json::from_value(row_value).map_err(|e| {
            SendSwapStorageError::Backend(format!("parse cashu_send_swap row: {e}"))
        })?;
        let decoded = self.decrypt_from_base64(&row.encrypted_data).await?;
        let send: SendData = serde_json::from_value(decoded)
            .map_err(|e| SendSwapStorageError::Backend(format!("parse encrypted_data: {e}")))?;

        // TS distinguishes input_proofs from proofs_to_send by
        // `cashu_send_swap_id`: input proofs were not added BY this swap
        // (so cashu_send_swap_id != row.id), proofs_to_send were
        // (cashu_send_swap_id == row.id). For DRAFT swaps (no swap done
        // yet), only input proofs exist. For PENDING/COMPLETED swaps that
        // didn't require an input swap, the proofs ARE the input proofs
        // and ARE the proofs-to-send (we report them once each).
        let mut input_proofs: Vec<TokenProof> = Vec::new();
        let mut proofs_to_send: Vec<TokenProof> = Vec::new();
        for p in &row.cashu_proofs {
            let is_swap_added = p.cashu_send_swap_id == Some(row.id);
            let is_swap_spending = p.spending_cashu_send_swap_id == Some(row.id);
            let proof = self.decrypt_proof(p).await?;
            if !row.requires_input_proofs_swap {
                // Single set: include as both input + send (TS to_swap
                // does the same via the OR condition on line 335).
                input_proofs.push(proof.clone());
                proofs_to_send.push(proof);
            } else if is_swap_added && is_swap_spending {
                proofs_to_send.push(proof);
            } else if !is_swap_added {
                input_proofs.push(proof);
            }
            // else: change proof — owned by the account; no bucket here.
        }

        let state = match row.state.as_str() {
            "DRAFT" => CashuSendSwapState::Draft,
            "PENDING" => CashuSendSwapState::Pending {
                token_hash: row.token_hash.clone().unwrap_or_default(),
                proofs_to_send: proofs_to_send.clone(),
            },
            "COMPLETED" => CashuSendSwapState::Completed {
                token_hash: row.token_hash.clone().unwrap_or_default(),
                proofs_to_send: proofs_to_send.clone(),
            },
            "FAILED" => CashuSendSwapState::Failed {
                failure_reason: row
                    .failure_reason
                    .clone()
                    .unwrap_or_else(|| "unknown".into()),
            },
            "REVERSED" => CashuSendSwapState::Reversed,
            other => {
                return Err(SendSwapStorageError::Backend(format!(
                    "unknown send swap state: {other}"
                )));
            }
        };

        let keyset_counter = match row.keyset_counter {
            Some(c) => Some(u32::try_from(c).map_err(|_| {
                SendSwapStorageError::Backend(format!("keyset_counter out of u32 range: {c}"))
            })?),
            None => None,
        };
        let version = u32::try_from(row.version).map_err(|_| {
            SendSwapStorageError::Backend(format!("version out of u32 range: {}", row.version))
        })?;

        Ok(CashuSendSwap {
            id: row.id,
            account_id: row.account_id,
            user_id: row.user_id,
            input_proofs,
            input_amount: send.amount_reserved,
            amount_received: send.amount_received,
            cashu_receive_fee: send.cashu_receive_fee,
            amount_to_send: send.amount_to_send,
            cashu_send_fee: send.cashu_send_fee,
            amount_spent: send.amount_spent,
            total_fee: send.total_fee,
            keyset_id: row.keyset_id,
            keyset_counter,
            output_amounts: send.output_amounts,
            transaction_id: row.transaction_id,
            created_at: row.created_at,
            version,
            state,
        })
    }
}

fn add_money(a: &Money, b: &Money) -> Result<Money, SendSwapStorageError> {
    a.try_add(b)
        .map_err(|e| SendSwapStorageError::Backend(format!("add Money: {e}")))
}

fn parse_account(value: Value) -> Result<Account, SendSwapStorageError> {
    serde_json::from_value::<Account>(value)
        .map_err(|e| SendSwapStorageError::Backend(format!("parse account row: {e}")))
}

/// Hash the proof secret to a `public_key_y` value used as the proof's
/// unique key in the DB. Mirrors slice 5's helper.
fn proof_to_y(secret: &str) -> String {
    use cdk::dhke::hash_to_curve;
    match hash_to_curve(secret.as_bytes()) {
        Ok(pk) => pk.to_hex(),
        Err(_) => String::new(),
    }
}

#[allow(clippy::needless_pass_by_value)]
fn map_auth(err: agicash_traits::StorageError) -> SendSwapStorageError {
    SendSwapStorageError::Backend(format!("auth: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_domain::{AccountPurpose, AccountState, AccountType, Currency};
    use agicash_money::Unit;
    use agicash_traits::PassthroughProofEncryption;
    use rust_decimal::Decimal;
    use serde_json::json;

    /// Stub `TokenProvider` that always errors. Storage unit tests never
    /// reach `authenticated_client`.
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

    fn make_storage() -> SupabaseCashuSendSwapStorage {
        let cfg = crate::SupabaseStorageConfig {
            url: "https://test.supabase.co".into(),
            anon_key: "anon".into(),
        };
        let base = Arc::new(crate::SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap());
        SupabaseCashuSendSwapStorage::new(base, passthrough())
    }

    fn money(amount: u64, currency: Currency) -> Money {
        let unit = match currency {
            Currency::Btc => Unit::Sat,
            _ => Unit::Cent,
        };
        Money::new(Decimal::from(amount), currency, unit)
    }

    #[tokio::test]
    async fn encrypt_to_base64_round_trips_via_passthrough() {
        let storage = make_storage();
        let value = json!({ "hello": "world", "n": 42 });
        let encoded = storage.encrypt_to_base64(&value).await.unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded.as_bytes())
            .unwrap();
        let back: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(back, value);
        let decoded = storage.decrypt_from_base64(&encoded).await.unwrap();
        assert_eq!(decoded, value);
    }

    #[test]
    fn send_data_round_trips_through_json_with_optional_output_amounts() {
        let with = SendData {
            token_mint_url: "https://m".into(),
            amount_received: money(100, Currency::Btc),
            cashu_receive_fee: money(0, Currency::Btc),
            amount_to_send: money(100, Currency::Btc),
            cashu_send_fee: money(2, Currency::Btc),
            amount_spent: money(102, Currency::Btc),
            amount_reserved: money(128, Currency::Btc),
            total_fee: money(2, Currency::Btc),
            output_amounts: Some(OutputAmounts {
                send: vec![64, 32, 4],
                change: vec![16, 8, 2],
            }),
        };
        let v = serde_json::to_value(&with).unwrap();
        assert!(v.get("tokenMintUrl").is_some());
        assert!(v.get("amountToSend").is_some());
        assert!(v.get("outputAmounts").is_some());
        let back: SendData = serde_json::from_value(v).unwrap();
        assert_eq!(back.output_amounts.unwrap().send, vec![64, 32, 4]);

        let without = SendData {
            output_amounts: None,
            ..with.clone()
        };
        let v = serde_json::to_value(&without).unwrap();
        // None should be omitted from the wire shape.
        assert!(v.get("outputAmounts").is_none());
    }

    #[test]
    fn proof_to_y_returns_non_empty_hex_for_valid_secret() {
        let y = proof_to_y("0123456789abcdef");
        assert!(!y.is_empty());
        assert!(y.chars().all(|c| c.is_ascii_hexdigit()));
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

    #[tokio::test]
    async fn row_to_swap_parses_pending_swap_with_proofs_to_send() {
        let storage = make_storage();
        let amount = money(64, Currency::Btc);
        let zero = money(0, Currency::Btc);

        let send = SendData {
            token_mint_url: "https://m".into(),
            amount_received: amount,
            cashu_receive_fee: zero,
            amount_to_send: amount,
            cashu_send_fee: zero,
            amount_spent: amount,
            amount_reserved: amount,
            total_fee: zero,
            output_amounts: None,
        };
        let encrypted = storage
            .encrypt_to_base64(&serde_json::to_value(&send).unwrap())
            .await
            .unwrap();
        let swap_id = Uuid::new_v4();
        let amount_enc = base64::engine::general_purpose::STANDARD.encode(b"64");
        let secret_enc = base64::engine::general_purpose::STANDARD.encode(b"sec1");
        let row = json!({
            "id": swap_id,
            "created_at": "2026-05-15T00:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": null,
            "keyset_counter": null,
            "state": "PENDING",
            "version": 1,
            "failure_reason": null,
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "encrypted_data": encrypted,
            "requires_input_proofs_swap": false,
            "token_hash": "abc",
            "cashu_proofs": [{
                "id": Uuid::new_v4(),
                "keyset_id": "ks1",
                "amount": amount_enc,
                "secret": secret_enc,
                "unblinded_signature": "C1",
            }],
        });
        let swap = storage
            .row_to_swap_with_extra_proofs(row, None)
            .await
            .unwrap();
        match swap.state {
            CashuSendSwapState::Pending {
                token_hash,
                proofs_to_send,
            } => {
                assert_eq!(token_hash, "abc");
                assert_eq!(proofs_to_send.len(), 1);
                assert_eq!(proofs_to_send[0].amount, 64);
                assert_eq!(proofs_to_send[0].secret, "sec1");
            }
            other => panic!("expected Pending, got: {other:?}"),
        }
    }

    #[tokio::test]
    async fn row_to_swap_parses_failed_state_with_reason() {
        let storage = make_storage();
        let amount = money(64, Currency::Btc);
        let zero = money(0, Currency::Btc);
        let send = SendData {
            token_mint_url: "https://m".into(),
            amount_received: amount,
            cashu_receive_fee: zero,
            amount_to_send: amount,
            cashu_send_fee: zero,
            amount_spent: amount,
            amount_reserved: amount,
            total_fee: zero,
            output_amounts: None,
        };
        let encrypted = storage
            .encrypt_to_base64(&serde_json::to_value(&send).unwrap())
            .await
            .unwrap();
        let row = json!({
            "id": Uuid::new_v4(),
            "created_at": "2026-05-15T00:00:00Z",
            "account_id": "11111111-2222-3333-4444-555555555555",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "keyset_id": "ks1",
            "keyset_counter": 0,
            "state": "FAILED",
            "version": 2,
            "failure_reason": "Mint swap already executed",
            "transaction_id": "11111111-2222-3333-4444-555555555555",
            "encrypted_data": encrypted,
            "requires_input_proofs_swap": true,
            "token_hash": null,
        });
        let swap = storage
            .row_to_swap_with_extra_proofs(row, None)
            .await
            .unwrap();
        match swap.state {
            CashuSendSwapState::Failed { failure_reason } => {
                assert_eq!(failure_reason, "Mint swap already executed");
            }
            other => panic!("expected Failed, got: {other:?}"),
        }
    }
}
