//! Main FFI wallet object.
//!
//! Holds shared `OpenSecretClient` + `SupabaseStorage` instances and a tiny
//! in-memory session slot. Persistence lives on the Swift side: after a
//! successful login the consumer reads `Session.refresh_token` and stores it
//! in iOS Keychain; on subsequent app launches it calls `set_session(...)` to
//! rehydrate the wallet before any other method.
//!
//! Auth methods mirror the CLI (`crates/agicash-cli/src/auth.rs`) but return
//! structured `Session` / `AuthStatus` values instead of printing JSON. The
//! account listing path mirrors `cmd_list` in `crates/agicash-cli/src/account.rs`.

use crate::account::AccountFfi;
use crate::error::FfiError;
use crate::mint::MintAddResult;
use crate::mint_quote::{MintQuoteFfiState, MintQuoteHandle, MintQuoteSnapshot};
use crate::receive::{ReceiveResult, ReceiveStatus};
use crate::receive_flow::{OpenSecretSeedProvider, ReceiveFlow};
use crate::session::{AuthStatus, Session};
use agicash_auth_opensecret::{
    auth_error_from_opensecret, login_email, logout, register_email, register_guest,
    OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
};
use agicash_cashu::{
    CashuMintQuote, CashuMintQuoteService, CashuMintQuoteState, CashuMintQuoteStorage,
    CashuReceiveSwapService, CashuReceiveSwapState, CashuReceiveSwapStorage, CashuSeedProvider,
    CashuSendSwapStorage, CdkCashuProvider, CompleteMintQuoteOutcome, CompleteOutcome,
    MintQuoteError, ParsedToken, ReceiveFlowService, ReceiveSwapError, ReceiveSwapStorageError,
};
use agicash_domain::{Account, AccountPurpose, AccountType, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_storage_supabase::{
    SupabaseCashuMintQuoteStorage, SupabaseCashuReceiveSwapStorage, SupabaseCashuSendSwapStorage,
    SupabaseStorage, SupabaseStorageConfig,
};
use agicash_traits::{
    AccountInput, CashuProvider, CashuProviderError, PassthroughProofEncryption, PersistedSession,
    ProofEncryption, TokenProvider, UpsertUserInput, UserStorage,
};
use cdk::mint_url::MintUrl;
use rust_decimal::Decimal;
use serde_json::json;
use std::str::FromStr;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

#[derive(uniffi::Object)]
pub struct AgicashWallet {
    client: OpenSecretClient,
    storage: Arc<SupabaseStorage>,
    /// Cashu provider (CDK-backed). Created once at construction; cheap to
    /// share across receive/send swaps.
    cashu_provider: Arc<dyn CashuProvider>,
    /// Receive-swap orchestrator. Wired against the same `SupabaseStorage`
    /// and `cashu_provider` the wallet already owns, with the slice-5
    /// `PassthroughProofEncryption` stub matching the CLI composition root.
    /// Once the encryption seam ships, this slot swaps to a real impl
    /// without the FFI surface changing.
    receive_swap_service: Arc<CashuReceiveSwapService>,
    /// Send-swap storage handle, reused here purely to call
    /// `list_unspent_proofs` from `list_accounts` so the per-account
    /// balance can be computed. Naming is awkward (the trait shape was
    /// designed around the send flow); a follow-up refactor lane should
    /// lift `list_unspent_proofs` to a balance-focused trait. Until then
    /// this is the only call-site here.
    send_swap_storage: Arc<dyn CashuSendSwapStorage>,
    /// Mint-quote (Lightning receive) orchestrator. Wired the same way as
    /// `receive_swap_service` — same `SupabaseStorage`, same provider,
    /// same passthrough encryption stub. Drives `start_mint_quote`,
    /// `poll_mint_quote`, `complete_mint_quote`.
    mint_quote_service: Arc<CashuMintQuoteService>,
    /// Storage handle for the mint-quote rows. Kept as its own slot so
    /// `poll_mint_quote` can read the persisted quote by id without
    /// holding the service.
    mint_quote_storage: Arc<dyn CashuMintQuoteStorage>,
    /// In-memory session. Phase 1 leaves persistence to the Swift consumer:
    /// the iOS app stores the `refresh_token` in Keychain and rehydrates this
    /// slot via `set_session` on app launch.
    session: Arc<RwLock<Option<PersistedSession>>>,
}

impl std::fmt::Debug for AgicashWallet {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // `OpenSecretClient` already redacts itself; the session is sensitive
        // material (refresh token) so we never print its contents.
        f.debug_struct("AgicashWallet")
            .field("client", &self.client)
            .field("storage", &self.storage)
            .field(
                "session_loaded",
                &self
                    .session
                    .try_read()
                    .map(|s| s.is_some())
                    .unwrap_or(false),
            )
            .finish_non_exhaustive()
    }
}

/// Generate 16 random bytes hex-encoded; the `OpenSecret` guest-registration
/// password slot accepts any string and we never need it after the first
/// login (Swift persists only the resulting refresh token).
fn random_password() -> String {
    let mut buf = [0u8; 16];
    getrandom::getrandom(&mut buf).expect("OS RNG must be available");
    hex::encode(buf)
}

#[uniffi::export(async_runtime = "tokio")]
impl AgicashWallet {
    /// Build a wallet that talks to the given `OpenSecret` and Supabase
    /// endpoints. The `client_id_uuid` must be a stringified UUID identifying
    /// this Agicash app to `OpenSecret` (matches the `OPENSECRET_CLIENT_ID`
    /// env var used by the CLI).
    //
    // UniFFI requires owned `String` arguments at the FFI boundary, so the
    // pedantic `needless_pass_by_value` lint can't be satisfied here.
    #[uniffi::constructor]
    #[allow(clippy::needless_pass_by_value)]
    pub fn new(
        opensecret_url: String,
        opensecret_client_id_uuid: String,
        supabase_url: String,
        supabase_anon_key: String,
    ) -> Result<Arc<Self>, FfiError> {
        let client_id = Uuid::parse_str(&opensecret_client_id_uuid)
            .map_err(|e| FfiError::internal(format!("invalid opensecret_client_id_uuid: {e}")))?;
        let auth_cfg = OpenSecretConfig {
            base_url: opensecret_url,
            client_id,
        };
        let client = OpenSecretClient::new(auth_cfg)?;

        let storage_cfg = SupabaseStorageConfig {
            url: supabase_url,
            anon_key: supabase_anon_key,
        };
        let token_provider: Arc<dyn TokenProvider + Send + Sync> =
            Arc::new(OpenSecretTokenProvider::new(client.clone()));
        let storage = Arc::new(SupabaseStorage::new(storage_cfg, token_provider)?);

        // Cashu wiring mirrors `crates/agicash-cli/src/composition.rs`
        // (`build_cashu_deps` + `build_receive_swap_deps`): one shared
        // CDK provider, plus a receive-swap service backed by the same
        // Supabase storage handle the wallet already owns. The
        // `PassthroughProofEncryption` stub matches what slice 5 ships;
        // when the real encryption layer lands the wallet just swaps
        // this constructor without the FFI shape moving.
        let cashu_provider: Arc<dyn CashuProvider> = Arc::new(CdkCashuProvider::new());
        let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
        let receive_storage: Arc<dyn CashuReceiveSwapStorage> = Arc::new(
            SupabaseCashuReceiveSwapStorage::new(Arc::clone(&storage), Arc::clone(&encryption)),
        );
        let receive_swap_service = Arc::new(CashuReceiveSwapService::new(
            receive_storage,
            Arc::clone(&cashu_provider),
        ));
        // Reuse the same passthrough encryption seam so per-account
        // balance reads can decrypt the proofs the receive-swap service
        // wrote. Slice 5+ swaps the encryption arc without touching this
        // wiring.
        let send_swap_storage: Arc<dyn CashuSendSwapStorage> = Arc::new(
            SupabaseCashuSendSwapStorage::new(Arc::clone(&storage), Arc::clone(&encryption)),
        );

        // Mint-quote service wiring mirrors the CLI's
        // `build_mint_quote_deps` (composition.rs). Same Supabase
        // storage, same passthrough encryption stub, same CDK provider.
        let mint_quote_storage: Arc<dyn CashuMintQuoteStorage> = Arc::new(
            SupabaseCashuMintQuoteStorage::new(Arc::clone(&storage), Arc::clone(&encryption)),
        );
        let mint_quote_service = Arc::new(CashuMintQuoteService::new(
            Arc::clone(&mint_quote_storage),
            Arc::clone(&cashu_provider),
        ));

        Ok(Arc::new(Self {
            client,
            storage,
            cashu_provider,
            receive_swap_service,
            send_swap_storage,
            mint_quote_service,
            mint_quote_storage,
            session: Arc::new(RwLock::new(None)),
        }))
    }

    // ---- session plumbing (Swift-side Keychain hooks) ----

    /// Rehydrate an existing session into the wallet. Called by the Swift
    /// consumer on app launch after reading the refresh token from Keychain.
    /// Performs an OpenSecret token refresh so the internal client has a
    /// fresh access token. On refresh failure the in-memory session is
    /// cleared and an `Auth` error is returned so the consumer can drop the
    /// Keychain entry.
    pub async fn set_session(
        &self,
        user_id_uuid: String,
        refresh_token: String,
    ) -> Result<(), FfiError> {
        let user_id = Uuid::parse_str(&user_id_uuid)
            .map_err(|e| FfiError::internal(format!("invalid user_id_uuid: {e}")))?;

        self.client.ensure_handshake().await?;
        self.client
            .inner()
            .set_tokens(String::new(), Some(refresh_token.clone()))
            .map_err(auth_error_from_opensecret)?;

        if let Err(e) = self.client.inner().refresh_token().await {
            *self.session.write().await = None;
            return Err(auth_error_from_opensecret(e).into());
        }

        *self.session.write().await = Some(PersistedSession {
            user_id,
            refresh_token,
        });
        Ok(())
    }

    /// Return the currently-loaded session, or `None` if the wallet is
    /// logged out. Lets the Swift consumer re-sync its Keychain copy after
    /// a `auth_guest` / `auth_login` call.
    pub async fn get_persisted_session(&self) -> Option<Session> {
        self.session.read().await.clone().map(Session::from)
    }

    // ---- auth surface ----

    /// Register an anonymous guest account against OpenSecret. Generates a
    /// throwaway password (the user never sees it) and returns the resulting
    /// `Session` so the Swift consumer can persist the refresh token.
    pub async fn auth_guest(&self) -> Result<Session, FfiError> {
        let password = random_password();
        let resp = register_guest(&self.client, password, self.client.client_id()).await?;
        let persisted = PersistedSession {
            user_id: resp.id,
            refresh_token: resp.refresh_token.clone(),
        };
        *self.session.write().await = Some(persisted.clone());
        Ok(persisted.into())
    }

    /// Email + password login.
    pub async fn auth_login(&self, email: String, password: String) -> Result<Session, FfiError> {
        let resp = login_email(&self.client, email, password, self.client.client_id()).await?;
        let persisted = PersistedSession {
            user_id: resp.id,
            refresh_token: resp.refresh_token.clone(),
        };
        *self.session.write().await = Some(persisted.clone());
        Ok(persisted.into())
    }

    /// Register a new email + password user against OpenSecret. Mirrors the
    /// web app's `/signup` flow: on success the user is auto-signed-in and
    /// the resulting `Session` is returned so the Swift consumer can persist
    /// the refresh token in Keychain. The optional `name` slot maps to the
    /// OpenSecret SDK's display-name field; the iOS app does not collect it
    /// in v0 (web doesn't either) but the parameter is exposed so the
    /// surface matches the underlying SDK and future UI can populate it
    /// without another FFI churn.
    pub async fn auth_signup(
        &self,
        email: String,
        password: String,
        name: Option<String>,
    ) -> Result<Session, FfiError> {
        let resp =
            register_email(&self.client, email, password, self.client.client_id(), name).await?;
        let persisted = PersistedSession {
            user_id: resp.id,
            refresh_token: resp.refresh_token.clone(),
        };
        *self.session.write().await = Some(persisted.clone());
        Ok(persisted.into())
    }

    /// Best-effort server logout. Always clears the in-memory session even
    /// if the server-side call fails (e.g. expired token, network error).
    /// The Swift consumer should also drop its Keychain entry on success.
    pub async fn auth_logout(&self) -> Result<(), FfiError> {
        let was_loaded = self.session.read().await.is_some();
        if was_loaded {
            if let Err(e) = logout(&self.client).await {
                // Server logout failures are non-fatal; swallow them so the
                // local state is still cleared. We surface the original
                // status only when there was something to log out.
                let _ = e;
            }
        }
        *self.session.write().await = None;
        Ok(())
    }

    /// Return whether the wallet currently holds a session.
    pub async fn auth_status(&self) -> Result<AuthStatus, FfiError> {
        let snap = self.session.read().await.clone();
        Ok(match snap {
            Some(s) => AuthStatus {
                logged_in: true,
                user_id: Some(s.user_id.to_string()),
            },
            None => AuthStatus {
                logged_in: false,
                user_id: None,
            },
        })
    }

    // ---- account surface ----

    /// List Supabase `wallet.accounts` rows for the currently-logged-in
    /// user. For each Cashu account, sums the account's UNSPENT proofs
    /// (decrypted via the storage layer's `list_unspent_proofs`) and
    /// returns the total as `balance` in the account's smallest unit
    /// (`sat` for BTC, `cent` for USD/USDB). Spark accounts always return
    /// balance `"0"` until slice 9 wires their proof storage.
    ///
    /// Per-account decryption walks the rows one-by-one; this is fine at
    /// MVP scale but could grow to N+1 latency once users hold many
    /// proofs. A grouped query is the natural follow-up.
    pub async fn list_accounts(&self) -> Result<Vec<AccountFfi>, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);
        let accounts = self.storage.list_accounts(user_id).await?;

        let mut out = Vec::with_capacity(accounts.len());
        for account in accounts {
            let balance = compute_cashu_balance(self.send_swap_storage.as_ref(), &account).await?;
            out.push(AccountFfi::from_account_with_balance(account, balance));
        }
        Ok(out)
    }

    // ---- mint surface ----

    /// Provision a new Cashu mint and create a BTC account row for it.
    ///
    /// Mirrors the `agicash mint add <url>` CLI subcommand
    /// (`crates/agicash-cli/src/mint.rs`): parse the URL, fetch NUT-06 mint
    /// info, then call `wallet.upsert_user_with_accounts` to insert the new
    /// `wallet.accounts` row. Returns the new account id + name + canonical
    /// URL so the Add Mint sheet on iOS can show a confirmation and the
    /// Accounts screen can refresh without a follow-up `list_accounts`
    /// round-trip (though it will refresh anyway).
    ///
    /// Hard-codes `currency = BTC` to match the web app's `add-mint-form.tsx`
    /// (which also hard-codes BTC). The iOS UI does not collect a currency
    /// today; if/when the web exposes USD mint creation we can add a
    /// parameter here.
    ///
    /// First-mint-add for a brand-new guest user creates a placeholder
    /// `Spark` account too — same workaround the CLI uses to satisfy the
    /// `wallet.upsert_user_with_accounts` "at least one BTC Spark"
    /// constraint. Slice 9 (Spark wiring) replaces it with a real-key-backed
    /// row.
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session is loaded.
    /// - `FfiError::Internal` for invalid URLs, mint unreachable, mint
    ///   protocol errors, and the post-upsert "no account matching the new
    ///   mint URL" sanity check (the underlying `MintCmdError` doesn't fit
    ///   Auth/Storage cleanly — same shape as `receive_token` funnels
    ///   `ReceiveSwapError` through Internal).
    /// - `FfiError::Storage` for raw Supabase failures (network, etc.).
    pub async fn mint_add(&self, url: String) -> Result<MintAddResult, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        let mint_url = MintUrl::from_str(url.trim())
            .map_err(|e| FfiError::internal(format!("invalid mint URL: {e}")))?;

        let info = self
            .cashu_provider
            .mint_info(&mint_url)
            .await
            .map_err(cashu_provider_error_to_ffi)?;

        let mint_url_string = mint_url.to_string();
        let mint_name = info.name.clone().unwrap_or_else(|| mint_url_string.clone());

        // Mirror the CLI's user-row preservation. The `wallet.users` table
        // has UNIQUE indexes on the three xpub/pubkey columns; for a
        // brand-new guest we synthesize per-user placeholders so two
        // guests can't collide before slice 5+ wires real key init.
        let existing = self.storage.get_user(user_id).await?;
        let (
            email,
            email_verified,
            cashu_locking_xpub,
            encryption_public_key,
            spark_identity_public_key,
            terms_accepted_at,
            gift_card_mint_terms_accepted_at,
        ) = if let Some(u) = existing.as_ref() {
            (
                u.email.clone(),
                u.email_verified,
                u.cashu_locking_xpub.clone(),
                u.encryption_public_key.clone(),
                u.spark_identity_public_key.clone(),
                u.terms_accepted_at,
                u.gift_card_mint_terms_accepted_at,
            )
        } else {
            let placeholder_prefix = format!("uninitialized-{user_id}-");
            (
                None,
                false,
                format!("{placeholder_prefix}cashu"),
                format!("{placeholder_prefix}encryption"),
                format!("{placeholder_prefix}spark"),
                None,
                None,
            )
        };

        let currency = Currency::Btc;
        let mut accounts = vec![AccountInput {
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            name: mint_name.clone(),
            details: json!({
                "mint_url": mint_url_string,
                "keyset_counters": {},
            }),
            is_default: false,
        }];
        if existing.is_none() {
            // Same CLI-side workaround as `cmd_mint_add`:
            // `wallet.upsert_user_with_accounts` requires at least one BTC
            // Spark account for brand-new users. The `cli_placeholder`
            // marker (kept verbatim so slice 9 can detect rows seeded
            // through either entry point) flags this row as a stub.
            accounts.push(AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: "Lightning".into(),
                details: json!({
                    "network": "MAINNET",
                    "cli_placeholder": true,
                }),
                is_default: true,
            });
        }

        let input = UpsertUserInput {
            user_id,
            email,
            email_verified,
            accounts,
            cashu_locking_xpub,
            encryption_public_key,
            spark_identity_public_key,
            terms_accepted_at,
            gift_card_mint_terms_accepted_at,
        };

        let result = self.storage.upsert_user_with_accounts(input).await?;

        // Upsert returns all of the user's accounts; pick the one matching
        // the new mint URL.
        let new_account = result
            .accounts
            .iter()
            .find(|a| {
                a.account_type == AccountType::Cashu
                    && a.details
                        .get("mint_url")
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| mint_urls_equal(s, &mint_url_string))
            })
            .ok_or_else(|| FfiError::Storage {
                code: crate::error::storage_code::INTERNAL,
                message: "upsert returned no account matching the new mint URL".into(),
            })?;

        Ok(MintAddResult {
            account_id: new_account.id.to_string(),
            mint_name,
            mint_url: mint_url_string,
            currency: currency.to_string(),
        })
    }

    // ---- receive surface ----

    /// Redeem a Cashu token (V3 `cashuA…` or V4 `cashuB…`).
    ///
    /// Mirrors the `agicash receive token <token>` CLI subcommand
    /// (`crates/agicash-cli/src/receive.rs`): parse the token, pick the
    /// matching account by `(mint_url, currency)`, run
    /// `CashuReceiveSwapService::create` followed by `complete_swap`, and
    /// return a flattened receipt. Idempotent on repeat redeems of the
    /// same token (returns [`ReceiveStatus::AlreadyClaimed`]).
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session is loaded.
    /// - `FfiError::Internal` for token-parse failures, missing matching
    ///   account, currency/unit mismatches, or amount-too-small after fees
    ///   (the underlying `ReceiveSwapError` doesn't fit Auth/Storage cleanly
    ///   so it is funneled through Internal — the message string carries
    ///   the discriminator the iOS UI surfaces inline).
    /// - `FfiError::Storage` for raw Supabase failures (network, etc.).
    pub async fn receive_token(&self, token: String) -> Result<ReceiveResult, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        // Parse first so a malformed token surfaces as a clean error
        // before we touch storage / the mint.
        let parsed = ParsedToken::parse(&token, &self.cashu_provider)
            .await
            .map_err(receive_swap_error_to_ffi)?;

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = pick_cashu_account_for_token(&accounts, &parsed.mint_url, &parsed.unit)
            .ok_or_else(|| {
                FfiError::internal(format!(
                    "no matching account for mint {} — add the mint first",
                    parsed.mint_url
                ))
            })?;

        // Create the PENDING swap row. AlreadyClaimed is idempotent —
        // surface the existing terminal state instead of erroring.
        let create_result = match self
            .receive_swap_service
            .create(user_id, &parsed, account, None)
            .await
        {
            Ok(r) => r,
            Err(ReceiveSwapError::Storage(ReceiveSwapStorageError::AlreadyClaimed)) => {
                return Ok(ReceiveResult {
                    status: ReceiveStatus::AlreadyClaimed,
                    amount: "0".into(),
                    fee: "0".into(),
                    unit: parsed.unit.to_string(),
                    currency: account.currency.to_string(),
                    account_id: account.id.to_string(),
                    mint_url: parsed.mint_url.clone(),
                    token_hash: parsed.hash.clone(),
                });
            }
            Err(e) => return Err(receive_swap_error_to_ffi(e)),
        };

        // Pull the BIP-39 cashu seed from OpenSecret so the service can
        // blind the outputs. Requires an active session (the read-lock
        // above proves we have one).
        let seed = self.client.get_cashu_seed().await?;

        let outcome = self
            .receive_swap_service
            .complete_swap(&create_result.account, create_result.swap, &seed)
            .await
            .map_err(receive_swap_error_to_ffi)?;

        Ok(receive_result_from_outcome(
            outcome,
            &create_result.account,
            &parsed,
        ))
    }

    /// Construct a fresh [`ReceiveFlow`] handle for an interactive
    /// receive-token flow. Each call returns a new orchestrator —
    /// flows are not persisted across constructions.
    ///
    /// The returned handle exposes:
    /// - `current_state()` to snapshot the current state
    /// - `dispatch(event)` to feed UI events in and run the resulting I/O
    ///
    /// Requires an active session; returns `FfiError::Auth { UNAUTHENTICATED }`
    /// otherwise.
    pub async fn receive_flow(&self) -> Result<Arc<ReceiveFlow>, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);
        let seed_provider: Arc<dyn CashuSeedProvider> =
            Arc::new(OpenSecretSeedProvider::new(self.client.clone()));
        let service = ReceiveFlowService::new(
            user_id,
            Arc::clone(&self.storage) as Arc<dyn UserStorage>,
            Arc::clone(&self.cashu_provider),
            Arc::clone(&self.receive_swap_service),
            seed_provider,
        );
        Ok(Arc::new(ReceiveFlow::new(service)))
    }

    // ---- lightning receive (mint quote) surface ----

    /// Start a NUT-04 mint quote — request a BOLT-11 invoice from the
    /// mint backing the user's Cashu account.
    ///
    /// Mirrors the CLI's `agicash receive lightning <amount>` subcommand
    /// (`crates/agicash-cli/src/receive_lightning.rs`) but stops at the
    /// "quote issued" step. The Swift side displays the invoice and
    /// drives the poll/complete cycle itself so the polling cadence and
    /// UI feedback stay on the consumer.
    ///
    /// `amount` is the value the wallet wants to *receive* expressed in
    /// the account's minor unit (sats for BTC, cents for USD). The mint
    /// may add a small fee on top — surfaced via [`MintQuoteHandle::fee`]
    /// so the iOS UI can render a breakdown.
    ///
    /// `account_id` and `currency` together select the receiving Cashu
    /// account. `currency` is the wallet currency string (`"BTC"` /
    /// `"USD"`); when omitted defaults to `"BTC"`. `account_id` (UUID
    /// string) lets multi-mint users pick the receiving account; when
    /// omitted, the single matching Cashu+currency account is used, or
    /// an `Internal` error is returned if zero or multiple matches
    /// exist (same selector the CLI uses).
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session is loaded.
    /// - `FfiError::Internal` for amount-too-small, currency mismatch,
    ///   no/ambiguous matching account, or any mint-protocol failure
    ///   (mirrors `receive_token`'s funneling pattern).
    /// - `FfiError::Storage` for raw Supabase failures.
    pub async fn start_mint_quote(
        &self,
        amount: u64,
        account_id: Option<String>,
        currency: Option<String>,
    ) -> Result<MintQuoteHandle, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        if amount == 0 {
            return Err(FfiError::internal("amount too small"));
        }

        let currency_str = currency.unwrap_or_else(|| "BTC".to_string());
        let currency_enum = Currency::from_str(&currency_str)
            .map_err(|_| FfiError::internal(format!("unsupported currency: {currency_str}")))?;
        let unit = unit_for_currency(currency_enum);
        let amount_money = Money::new(Decimal::from(amount), currency_enum, unit);

        let accounts = self.storage.list_accounts(user_id).await?;
        let account =
            pick_cashu_account_for_lightning(&accounts, account_id.as_deref(), currency_enum)?;

        let quote = self
            .mint_quote_service
            .create_quote(user_id, account, amount_money, None)
            .await
            .map_err(mint_quote_error_to_ffi)?;

        Ok(mint_quote_handle_from(&quote, account))
    }

    /// Poll the mint for the current state of a previously-started
    /// quote. Single-shot: returns the snapshot of the persisted row
    /// (with one mint round-trip if still UNPAID), never loops.
    ///
    /// The iOS app owns the polling timer; this method is intended to
    /// be called every 1-3 seconds from a long-running `Task` while the
    /// LightningReceiveView is on the `invoice` step. Once the snapshot
    /// returns `Paid` (or any terminal state), the timer stops and the
    /// UI either transitions to `complete_mint_quote` (PAID) or to the
    /// failure/expiry states.
    ///
    /// `quote_id` is the wallet-side UUID returned in
    /// [`MintQuoteHandle::quote_id`] — NOT the mint-side string id.
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session is loaded.
    /// - `FfiError::Internal` for invalid UUID, missing quote row,
    ///   ownership mismatch, account lookup failure, or mint-protocol
    ///   failure during the single poll round-trip.
    /// - `FfiError::Storage` for raw Supabase failures.
    pub async fn poll_mint_quote(&self, quote_id: String) -> Result<MintQuoteSnapshot, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        let id = Uuid::parse_str(&quote_id)
            .map_err(|e| FfiError::internal(format!("invalid quote_id: {e}")))?;
        let quote = self
            .mint_quote_storage
            .get(id)
            .await
            .map_err(|e| FfiError::internal(format!("storage error: {e}")))?;
        if quote.user_id != user_id {
            return Err(FfiError::internal("quote belongs to a different user"));
        }

        // Fast-path: if the row is already PAID/COMPLETED/EXPIRED/FAILED,
        // return that immediately. The mint round-trip is only worth doing
        // when the persisted state is still UNPAID.
        if !matches!(quote.state, CashuMintQuoteState::Unpaid) {
            return Ok(mint_quote_snapshot_from(&quote));
        }

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = accounts
            .iter()
            .find(|a| a.id == quote.account_id && a.account_type == AccountType::Cashu)
            .ok_or_else(|| FfiError::internal("no matching account for quote"))?;

        // Use `poll_until_paid` with a zero timeout — effectively "one
        // status check, then return". The service does at most one mint
        // round-trip; if status is still UNPAID we get back the same
        // unmodified quote, if PAID/ISSUED the service transitions
        // storage and returns the updated row.
        let polled = self
            .mint_quote_service
            .poll_until_paid(
                account,
                quote.clone(),
                std::time::Duration::from_millis(0),
                std::time::Duration::from_millis(0),
            )
            .await
            .map_err(mint_quote_error_to_ffi)?;

        Ok(mint_quote_snapshot_from(&polled))
    }

    /// Drive a PAID quote to COMPLETED — mint proofs and credit the
    /// account. Returns a [`ReceiveResult`] shape identical to
    /// `receive_token`'s output so the iOS UI can render success
    /// uniformly across both flows.
    ///
    /// Idempotent on already-completed quotes (returns the existing
    /// terminal state).
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session is loaded.
    /// - `FfiError::Internal` for invalid UUID, quote not yet paid,
    ///   missing account, or mint-protocol failure during the proof
    ///   minting / restore round-trip.
    /// - `FfiError::Storage` for raw Supabase failures.
    pub async fn complete_mint_quote(&self, quote_id: String) -> Result<ReceiveResult, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        let id = Uuid::parse_str(&quote_id)
            .map_err(|e| FfiError::internal(format!("invalid quote_id: {e}")))?;
        let quote = self
            .mint_quote_storage
            .get(id)
            .await
            .map_err(|e| FfiError::internal(format!("storage error: {e}")))?;
        if quote.user_id != user_id {
            return Err(FfiError::internal("quote belongs to a different user"));
        }

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = accounts
            .iter()
            .find(|a| a.id == quote.account_id && a.account_type == AccountType::Cashu)
            .ok_or_else(|| FfiError::internal("no matching account for quote"))?
            .clone();

        let seed = self.client.get_cashu_seed().await?;
        let outcome = self
            .mint_quote_service
            .complete_receive(&account, quote.clone(), &seed)
            .await
            .map_err(mint_quote_error_to_ffi)?;

        Ok(receive_result_from_mint_quote_outcome(
            outcome, &account, &quote,
        ))
    }
}

/// Find a `Cashu` account whose `(mint_url, currency)` pair matches the
/// supplied parsed token. Mirrors the CLI's private `pick_account`
/// (`crates/agicash-cli/src/receive.rs`) — duplicated here so the FFI
/// stays decoupled from the CLI binary.
fn pick_cashu_account_for_token<'a>(
    accounts: &'a [Account],
    mint_url: &str,
    unit: &cdk::nuts::CurrencyUnit,
) -> Option<&'a Account> {
    accounts.iter().find(|a| {
        a.account_type == AccountType::Cashu
            && a.details
                .get("mint_url")
                .and_then(|v| v.as_str())
                .is_some_and(|u| mint_urls_equal(u, mint_url))
            && unit_matches_currency(unit, a.currency)
    })
}

fn mint_urls_equal(a: &str, b: &str) -> bool {
    a.trim_end_matches('/') == b.trim_end_matches('/')
}

fn unit_matches_currency(unit: &cdk::nuts::CurrencyUnit, currency: Currency) -> bool {
    use cdk::nuts::CurrencyUnit;
    matches!(
        (unit, currency),
        (CurrencyUnit::Sat, Currency::Btc) | (CurrencyUnit::Usd, Currency::Usd)
    )
}

/// Sum the UNSPENT proofs for a single account.
///
/// Cashu accounts route through `CashuSendSwapStorage::list_unspent_proofs`
/// which internally decrypts each proof's encrypted amount. Spark accounts
/// always return 0 — slice 9 will wire their proof storage and replace this
/// branch. Storage failures are funneled through `FfiError::Internal`
/// (matching the `receive_swap_error_to_ffi` shape) since
/// `SendSwapStorageError` doesn't fit the structured Auth/Storage variants
/// cleanly.
async fn compute_cashu_balance(
    storage: &dyn CashuSendSwapStorage,
    account: &Account,
) -> Result<u64, FfiError> {
    match account.account_type {
        AccountType::Cashu => {
            let proofs = storage
                .list_unspent_proofs(account.id)
                .await
                .map_err(|e| FfiError::internal(format!("list unspent proofs: {e}")))?;
            Ok(proofs.iter().map(|p| p.proof.amount).sum())
        }
        AccountType::Spark => Ok(0),
    }
}

/// Map the rich `ReceiveSwapError` family down to `FfiError`. The trait
/// crate already has `From<AuthError>` / `From<StorageError>` impls for
/// FFI; the cashu-specific cases (token parse, mint-mismatch,
/// amount-too-small) don't fit either family cleanly so they funnel
/// through `Internal` with a discriminator-bearing message.
fn receive_swap_error_to_ffi(e: ReceiveSwapError) -> FfiError {
    match e {
        ReceiveSwapError::TokenParse(msg) => FfiError::internal(format!("invalid token: {msg}")),
        ReceiveSwapError::MintMismatch { token, account } => FfiError::internal(format!(
            "mint mismatch: token mint {token} differs from account mint {account}",
        )),
        ReceiveSwapError::CurrencyMismatch { token, account } => FfiError::internal(format!(
            "currency mismatch: token currency {token} differs from account currency {account}",
        )),
        ReceiveSwapError::AmountTooSmall => FfiError::internal("amount too small after mint fees"),
        ReceiveSwapError::InvalidTransition { from, event } => {
            FfiError::internal(format!("invalid state transition from {from} on {event}"))
        }
        // Mint-protocol failures (network, NUT errors) — surface the
        // `CashuProviderError`'s display so the UI gets something
        // meaningful without a new FFI variant.
        ReceiveSwapError::Mint(inner) => FfiError::internal(format!("mint error: {inner}")),
        // Storage is the one branch where we DO have a structured FFI
        // shape. Map the inner storage failure through the existing
        // `From<StorageError>` impl when possible; otherwise fall back
        // to Internal so the caller still sees the failure reason.
        ReceiveSwapError::Storage(s) => FfiError::internal(format!("storage error: {s}")),
    }
}

/// Map the rich `CashuProviderError` family down to `FfiError`. The mint-
/// provider failures (invalid URL, network, NUT protocol) are funneled
/// through `Internal` with a discriminator-bearing message, same shape as
/// `receive_swap_error_to_ffi` — the iOS UI parses the message prefix to
/// render an inline form-level error.
fn cashu_provider_error_to_ffi(e: CashuProviderError) -> FfiError {
    match e {
        CashuProviderError::InvalidUrl(msg) => {
            FfiError::internal(format!("invalid mint URL: {msg}"))
        }
        CashuProviderError::Network(msg) => FfiError::internal(format!("mint unreachable: {msg}")),
        CashuProviderError::Protocol(msg) => FfiError::internal(format!("mint error: {msg}")),
    }
}

fn receive_result_from_outcome(
    outcome: CompleteOutcome,
    fallback_account: &Account,
    parsed: &ParsedToken,
) -> ReceiveResult {
    match outcome {
        CompleteOutcome::Completed { swap, account, .. } => ReceiveResult {
            status: ReceiveStatus::Received,
            amount: swap.amount_received.amount().to_string(),
            fee: swap.fee_amount.amount().to_string(),
            unit: swap.amount_received.unit().to_string(),
            currency: swap.amount_received.currency().to_string(),
            account_id: account.id.to_string(),
            mint_url: parsed.mint_url.clone(),
            token_hash: parsed.hash.clone(),
        },
        CompleteOutcome::AlreadyTerminal(swap) => {
            let status = match &swap.state {
                CashuReceiveSwapState::Completed => ReceiveStatus::Received,
                CashuReceiveSwapState::Failed { .. } => ReceiveStatus::AlreadyFailed,
                CashuReceiveSwapState::Pending => ReceiveStatus::Pending,
            };
            ReceiveResult {
                status,
                amount: swap.amount_received.amount().to_string(),
                fee: swap.fee_amount.amount().to_string(),
                unit: swap.amount_received.unit().to_string(),
                currency: swap.amount_received.currency().to_string(),
                account_id: fallback_account.id.to_string(),
                mint_url: parsed.mint_url.clone(),
                token_hash: parsed.hash.clone(),
            }
        }
        CompleteOutcome::Failed(swap) => ReceiveResult {
            status: ReceiveStatus::AlreadyFailed,
            amount: swap.amount_received.amount().to_string(),
            fee: swap.fee_amount.amount().to_string(),
            unit: swap.amount_received.unit().to_string(),
            currency: swap.amount_received.currency().to_string(),
            account_id: fallback_account.id.to_string(),
            mint_url: parsed.mint_url.clone(),
            token_hash: parsed.hash.clone(),
        },
    }
}

// ---- mint-quote (Lightning receive) helpers ----

/// Select the receiving Cashu account for a Lightning receive. Mirrors
/// the CLI's `pick_account` in `receive_lightning.rs`: when `requested`
/// (UUID string) is `Some`, find the matching Cashu+currency row; when
/// `None`, pick the unique Cashu+currency row or report
/// none/ambiguous.
///
/// Different from `pick_cashu_account_for_token` because Lightning
/// receives don't carry a mint URL — the user-chosen account
/// determines which mint we ask for a quote.
fn pick_cashu_account_for_lightning<'a>(
    accounts: &'a [Account],
    requested: Option<&str>,
    currency: Currency,
) -> Result<&'a Account, FfiError> {
    let cashu: Vec<&Account> = accounts
        .iter()
        .filter(|a| a.account_type == AccountType::Cashu && a.currency == currency)
        .collect();
    match requested {
        Some(id_str) => {
            let id = Uuid::parse_str(id_str)
                .map_err(|e| FfiError::internal(format!("invalid account_id: {e}")))?;
            cashu
                .into_iter()
                .find(|a| a.id == agicash_domain::AccountId::from(id))
                .ok_or_else(|| {
                    FfiError::internal(format!("no Cashu {currency} account with id {id_str}"))
                })
        }
        None => match cashu.len() {
            0 => Err(FfiError::internal(format!(
                "no Cashu {currency} account — add a mint first"
            ))),
            1 => Ok(cashu[0]),
            _ => Err(FfiError::internal(format!(
                "multiple Cashu {currency} accounts — pass account_id"
            ))),
        },
    }
}

/// Map `MintQuoteError` down to `FfiError`. Same funneling pattern as
/// `receive_swap_error_to_ffi`: storage/network/protocol failures land
/// in `Internal` with a discriminator-bearing message; validation
/// failures (amount-too-small, currency mismatch) stay as their own
/// strings so the iOS UI can pattern-match the prefix.
fn mint_quote_error_to_ffi(e: MintQuoteError) -> FfiError {
    match e {
        MintQuoteError::AmountTooSmall => FfiError::internal("amount too small"),
        MintQuoteError::CurrencyMismatch { account, request } => FfiError::internal(format!(
            "currency mismatch: account {account} differs from request {request}",
        )),
        MintQuoteError::QuoteNotPaid => FfiError::internal("quote not yet paid"),
        MintQuoteError::QuoteExpired => FfiError::internal("quote expired before payment"),
        MintQuoteError::InvalidTransition { from, event } => {
            FfiError::internal(format!("invalid state transition from {from} on {event}"))
        }
        MintQuoteError::Unrecoverable(msg) => {
            FfiError::internal(format!("mint quote unrecoverable: {msg}"))
        }
        MintQuoteError::Mint(inner) => cashu_provider_error_to_ffi(inner),
        MintQuoteError::Storage(s) => FfiError::internal(format!("storage error: {s}")),
    }
}

/// Map `Currency` -> minor `Unit` for amount-money construction. Mirrors
/// the CLI's `unit_for_currency` (`receive_lightning.rs`).
fn unit_for_currency(currency: Currency) -> Unit {
    match currency {
        Currency::Btc => Unit::Sat,
        Currency::Usd | Currency::Usdb => Unit::Cent,
    }
}

/// Build the `MintQuoteHandle` returned by `start_mint_quote`. The
/// amount + fee are decimal-stringified to match the
/// `ReceiveResult` convention.
fn mint_quote_handle_from(quote: &CashuMintQuote, account: &Account) -> MintQuoteHandle {
    MintQuoteHandle {
        quote_id: quote.id.to_string(),
        mint_quote_id: quote.quote_id.clone(),
        invoice: quote.payment_request.clone(),
        payment_hash: quote.payment_hash.clone(),
        amount: quote.amount.amount().to_string(),
        fee: quote.total_fee.amount().to_string(),
        unit: quote.amount.unit().to_string(),
        currency: quote.amount.currency().to_string(),
        account_id: account.id.to_string(),
        expires_at: quote.expires_at.to_rfc3339(),
    }
}

/// Convert a persisted `CashuMintQuote` into the FFI snapshot. Maps
/// the per-state Rust enum down to the flat FFI discriminator.
fn mint_quote_snapshot_from(quote: &CashuMintQuote) -> MintQuoteSnapshot {
    match &quote.state {
        CashuMintQuoteState::Unpaid => MintQuoteSnapshot {
            state: MintQuoteFfiState::Unpaid,
            failure_reason: None,
        },
        CashuMintQuoteState::Paid { .. } => MintQuoteSnapshot {
            state: MintQuoteFfiState::Paid,
            failure_reason: None,
        },
        CashuMintQuoteState::Completed { .. } => MintQuoteSnapshot {
            state: MintQuoteFfiState::Completed,
            failure_reason: None,
        },
        CashuMintQuoteState::Expired => MintQuoteSnapshot {
            state: MintQuoteFfiState::Expired,
            failure_reason: None,
        },
        CashuMintQuoteState::Failed { failure_reason } => MintQuoteSnapshot {
            state: MintQuoteFfiState::Failed,
            failure_reason: Some(failure_reason.clone()),
        },
    }
}

/// Build the `ReceiveResult` returned by `complete_mint_quote`. The shape
/// is identical to what `receive_token` returns so the iOS success card
/// can render uniformly across both flows. Mirrors
/// `receive_result_from_outcome` (which handles the Cashu-token swap
/// outcome) but for the `CompleteMintQuoteOutcome` enum.
fn receive_result_from_mint_quote_outcome(
    outcome: CompleteMintQuoteOutcome,
    fallback_account: &Account,
    fallback_quote: &CashuMintQuote,
) -> ReceiveResult {
    // Lightning quotes don't carry a token hash; we synthesize one from
    // the BOLT-11 payment hash so the receipt has a stable identifier.
    let token_hash = fallback_quote.payment_hash.clone();
    let mint_url = mint_url_from_account(fallback_account);

    match outcome {
        CompleteMintQuoteOutcome::Completed {
            quote,
            account,
            added_proofs: _,
        } => ReceiveResult {
            status: ReceiveStatus::Received,
            amount: quote.amount.amount().to_string(),
            fee: quote.total_fee.amount().to_string(),
            unit: quote.amount.unit().to_string(),
            currency: quote.amount.currency().to_string(),
            account_id: account.id.to_string(),
            mint_url: mint_url_from_account(&account),
            token_hash,
        },
        CompleteMintQuoteOutcome::AlreadyTerminal(quote) => {
            let status = match &quote.state {
                CashuMintQuoteState::Completed { .. } => ReceiveStatus::Received,
                CashuMintQuoteState::Failed { .. } => ReceiveStatus::AlreadyFailed,
                CashuMintQuoteState::Expired => ReceiveStatus::AlreadyFailed,
                // PAID without a follow-up complete is "still pending" from the
                // UI's perspective; treat as `Pending` so the user can retry.
                CashuMintQuoteState::Paid { .. } | CashuMintQuoteState::Unpaid => {
                    ReceiveStatus::Pending
                }
            };
            ReceiveResult {
                status,
                amount: quote.amount.amount().to_string(),
                fee: quote.total_fee.amount().to_string(),
                unit: quote.amount.unit().to_string(),
                currency: quote.amount.currency().to_string(),
                account_id: fallback_account.id.to_string(),
                mint_url,
                token_hash,
            }
        }
        CompleteMintQuoteOutcome::Failed(quote) => ReceiveResult {
            status: ReceiveStatus::AlreadyFailed,
            amount: quote.amount.amount().to_string(),
            fee: quote.total_fee.amount().to_string(),
            unit: quote.amount.unit().to_string(),
            currency: quote.amount.currency().to_string(),
            account_id: fallback_account.id.to_string(),
            mint_url,
            token_hash,
        },
    }
}

/// Pull the canonical `mint_url` string out of a Cashu account's
/// `details` blob. Defaults to empty string if the column is missing or
/// malformed — the iOS UI tolerates empty mint URLs in its success card
/// rendering (drops the line) so we don't need to error here.
fn mint_url_from_account(account: &Account) -> String {
    account
        .details
        .get("mint_url")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct FakeConfig {
        opensecret_url: String,
        client_id: String,
        supabase_url: String,
        anon_key: String,
    }

    fn fake_config() -> FakeConfig {
        FakeConfig {
            opensecret_url: "https://does-not-resolve-agicash.invalid".to_string(),
            client_id: Uuid::nil().to_string(),
            supabase_url: "https://does-not-resolve-supabase.invalid".to_string(),
            anon_key: "anon-key".to_string(),
        }
    }

    #[tokio::test]
    async fn constructor_returns_wallet_without_network() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let status = wallet.auth_status().await.unwrap();
        assert!(!status.logged_in);
        assert!(status.user_id.is_none());
    }

    #[tokio::test]
    async fn list_accounts_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet.list_accounts().await.expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }

    #[tokio::test]
    async fn mint_add_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .mint_add("https://example.invalid".into())
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }

    #[tokio::test]
    async fn constructor_rejects_bad_client_id_uuid() {
        let err = AgicashWallet::new(
            "https://example.invalid".into(),
            "not-a-uuid".into(),
            "https://supabase.invalid".into(),
            "anon".into(),
        )
        .expect_err("bad uuid");
        assert!(
            matches!(err, FfiError::Internal { ref message } if message.contains("client_id_uuid"))
        );
    }

    // ---- mint-quote (Lightning receive) FFI surface ----

    #[tokio::test]
    async fn start_mint_quote_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .start_mint_quote(64, None, None)
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }

    #[tokio::test]
    async fn poll_mint_quote_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .poll_mint_quote(Uuid::new_v4().to_string())
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }

    #[tokio::test]
    async fn complete_mint_quote_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .complete_mint_quote(Uuid::new_v4().to_string())
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }

    // ---- helper unit tests (no FFI, no network) ----

    fn stub_account(currency: Currency) -> Account {
        use agicash_domain::{AccountId, AccountPurpose, AccountState};
        use chrono::Utc;
        Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            details: json!({ "mint_url": "https://m.example", "keyset_counters": {} }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        }
    }

    #[test]
    fn pick_cashu_for_lightning_returns_only_cashu_btc() {
        let mut other = stub_account(Currency::Btc);
        other.account_type = AccountType::Spark;
        let accounts = vec![other, stub_account(Currency::Btc)];
        let picked =
            pick_cashu_account_for_lightning(&accounts, None, Currency::Btc).expect("found");
        assert_eq!(picked.account_type, AccountType::Cashu);
    }

    #[test]
    fn pick_cashu_for_lightning_errors_when_no_match() {
        let accounts = vec![stub_account(Currency::Usd)];
        let err =
            pick_cashu_account_for_lightning(&accounts, None, Currency::Btc).expect_err("none");
        assert!(matches!(err, FfiError::Internal { ref message } if message.contains("no Cashu")));
    }

    #[test]
    fn pick_cashu_for_lightning_errors_when_ambiguous() {
        let accounts = vec![stub_account(Currency::Btc), stub_account(Currency::Btc)];
        let err = pick_cashu_account_for_lightning(&accounts, None, Currency::Btc)
            .expect_err("ambiguous");
        assert!(matches!(err, FfiError::Internal { ref message } if message.contains("multiple")));
    }

    #[test]
    fn pick_cashu_for_lightning_rejects_bad_uuid() {
        let accounts = vec![stub_account(Currency::Btc)];
        let err = pick_cashu_account_for_lightning(&accounts, Some("not-a-uuid"), Currency::Btc)
            .expect_err("bad uuid");
        assert!(
            matches!(err, FfiError::Internal { ref message } if message.contains("invalid account_id"))
        );
    }

    #[test]
    fn mint_quote_error_to_ffi_maps_amount_too_small() {
        let e = mint_quote_error_to_ffi(MintQuoteError::AmountTooSmall);
        assert!(matches!(e, FfiError::Internal { ref message } if message.contains("too small")));
    }

    #[test]
    fn mint_quote_error_to_ffi_maps_quote_not_paid() {
        let e = mint_quote_error_to_ffi(MintQuoteError::QuoteNotPaid);
        assert!(
            matches!(e, FfiError::Internal { ref message } if message.contains("not yet paid"))
        );
    }

    #[test]
    fn unit_for_currency_maps_btc_to_sat() {
        assert_eq!(unit_for_currency(Currency::Btc), Unit::Sat);
        assert_eq!(unit_for_currency(Currency::Usd), Unit::Cent);
    }
}
