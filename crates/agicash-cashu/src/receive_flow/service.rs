//! Orchestrator that drives a [`ReceiveFlowMachine`] forward by performing
//! the I/O each pending stage requires.
//!
//! Composes:
//! - [`crate::ParsedToken::parse`] for token parsing
//! - The injected `UserStorage` for `list_accounts` + `get_user` +
//!   `upsert_user_with_accounts` (the mint-add path)
//! - The injected `CashuProvider` for `mint_info`
//! - [`crate::CashuReceiveSwapService`] for the actual swap
//!
//! This mirrors what `app/features/receive/claim-cashu-token-service.ts`
//! does on the web, minus the cross-account melt path (slice 7 lands that)
//! and minus the gift-card terms acceptance step (iOS v0 doesn't surface
//! gift cards).

use super::error::{code, ReceiveFlowError};
use super::state::ReceiveFlowMachine;
use super::types::{
    MintConfirmation, ReceiveFlowEvent, ReceiveFlowResult, ReceiveFlowState, ReceiveStatus,
};
use crate::receive_swap::{
    CashuReceiveSwapService, CashuReceiveSwapState, CompleteOutcome, ParsedToken,
    ReceiveSwapError, ReceiveSwapStorageError,
};
use agicash_domain::{Account, AccountPurpose, AccountType, Currency, UserId};
use agicash_traits::{
    AccountInput, CashuProvider, UpsertUserInput, UserStorage,
};
use cdk::mint_url::MintUrl;
use cdk::nuts::CurrencyUnit;
use serde_json::json;
use std::str::FromStr;
use std::sync::Arc;

/// Provider of the BIP-39 cashu seed bytes used to derive blinded outputs.
///
/// Boxed as a trait so the FFI / CLI / WASM compositions can each plug a
/// different source (OpenSecret on FFI, keychain on CLI, etc.) without
/// pulling those crates into `agicash-cashu`.
#[async_trait::async_trait]
pub trait CashuSeedProvider: Send + Sync {
    /// Return the 64-byte cashu seed for the current session.
    async fn get_cashu_seed(&self) -> Result<[u8; 64], ReceiveFlowError>;
}

/// One async receive flow. Wraps a [`ReceiveFlowMachine`] + the dependencies
/// it needs to drive the next stage.
///
/// Use [`ReceiveFlowService::dispatch`] to feed UI events in.
pub struct ReceiveFlowService {
    machine: ReceiveFlowMachine,
    user_id: UserId,
    storage: Arc<dyn UserStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
    receive_swap_service: Arc<CashuReceiveSwapService>,
    seed_provider: Arc<dyn CashuSeedProvider>,
    /// Set after a `Start` event; required by `ConfirmAddMint`.
    pending: Option<PendingContext>,
}

impl std::fmt::Debug for ReceiveFlowService {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReceiveFlowService")
            .field("state", self.machine.state())
            .field("user_id", &self.user_id)
            .finish_non_exhaustive()
    }
}

/// Per-flow context the service holds onto across dispatch calls. Survives
/// the `NeedsMintConfirmation` pause so the follow-up `ConfirmAddMint`
/// dispatch can resume without re-parsing.
#[derive(Debug, Clone)]
struct PendingContext {
    parsed: ParsedToken,
    /// Mint metadata fetched during the initial discovery step. Reused
    /// when adding the mint so we don't hit NUT-06 twice.
    mint_name: String,
}

impl ReceiveFlowService {
    pub fn new(
        user_id: UserId,
        storage: Arc<dyn UserStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
        receive_swap_service: Arc<CashuReceiveSwapService>,
        seed_provider: Arc<dyn CashuSeedProvider>,
    ) -> Self {
        Self {
            machine: ReceiveFlowMachine::new(),
            user_id,
            storage,
            cashu_provider,
            receive_swap_service,
            seed_provider,
            pending: None,
        }
    }

    /// Snapshot the current state. Cheap; safe to call from a tight UI
    /// polling loop.
    #[must_use]
    pub fn current_state(&self) -> ReceiveFlowState {
        self.machine.state().clone()
    }

    /// Feed a UI event into the flow and run any side effects it triggers.
    /// Returns the next stable state.
    ///
    /// "Stable" means: the next state at which the orchestrator is either
    /// terminal or waiting for the next UI event. Intermediate states
    /// (Parsing, AddingMint, Swapping) are observable via
    /// [`Self::current_state`] mid-flight only if the caller polls from
    /// another thread; sequential callers will see only the stable
    /// terminal of each dispatch.
    pub async fn dispatch(
        &mut self,
        event: ReceiveFlowEvent,
    ) -> Result<ReceiveFlowState, ReceiveFlowError> {
        if !self.machine.accepts(&event) {
            return Err(ReceiveFlowError::InvalidEvent {
                event: format!("{event:?}"),
                state: format!("{:?}", self.machine.state()),
            });
        }
        match event {
            ReceiveFlowEvent::Start { token } => self.handle_start(token).await,
            ReceiveFlowEvent::ConfirmAddMint => self.handle_confirm_add_mint().await,
            ReceiveFlowEvent::CancelAddMint => Ok(self.go_failed_str(
                "user cancelled the add-mint prompt",
                code::CANCELLED,
            )),
            ReceiveFlowEvent::Retry | ReceiveFlowEvent::Dismiss => {
                self.machine.transition(ReceiveFlowState::Idle);
                self.pending = None;
                Ok(self.machine.state().clone())
            }
        }
    }

    /// Convenience: dispatch `Start` and immediately auto-progress through
    /// any non-user-blocking states. Used by the CLI integration test and
    /// the `wallet.receive_token` shortcut. If the flow lands in
    /// `NeedsMintConfirmation` (mint unknown), returns that state and waits
    /// for the caller to dispatch a follow-up event.
    pub async fn start_and_progress(
        &mut self,
        token: String,
    ) -> Result<ReceiveFlowState, ReceiveFlowError> {
        self.dispatch(ReceiveFlowEvent::Start { token }).await
    }

    async fn handle_start(
        &mut self,
        token: String,
    ) -> Result<ReceiveFlowState, ReceiveFlowError> {
        self.machine.transition(ReceiveFlowState::Parsing);

        let parsed = match ParsedToken::parse(&token, &self.cashu_provider).await {
            Ok(p) => p,
            Err(ReceiveSwapError::TokenParse(msg)) => {
                return Ok(self.go_failed_str(&msg, code::TOKEN_PARSE));
            }
            Err(other) => return Ok(self.go_failed_from_swap(other)),
        };

        if parsed.proofs.is_empty() {
            return Ok(self.go_failed_str(
                "token contains no proofs",
                code::TOKEN_SPENT,
            ));
        }

        // Look up the user's accounts and try to match by (mint_url, unit).
        let accounts = self.storage.list_accounts(self.user_id).await?;
        let unit_str = parsed.unit.to_string();
        if let Some(account) = find_matching_account(&accounts, &parsed.mint_url, &parsed.unit) {
            // Mint already known — run the swap immediately.
            return self.run_swap(parsed, account.clone()).await;
        }

        // Mint unknown — fetch info, surface NeedsMintConfirmation, hold
        // parsed token in pending context until the user confirms.
        let mint_url = MintUrl::from_str(&parsed.mint_url)
            .map_err(|e| ReceiveFlowError::TokenParse(format!("mint URL parse: {e}")))?;
        let info = self
            .cashu_provider
            .mint_info(&mint_url)
            .await
            .map_err(ReceiveFlowError::MintDiscovery)?;
        let mint_name = info
            .name
            .clone()
            .unwrap_or_else(|| parsed.mint_url.clone());

        let amount = parsed.proofs.iter().map(|p| p.amount).sum::<u64>();
        // We don't compute mint fee here (would require fetching keysets);
        // the UI can render "before fees" amount and we'll pin the real fee
        // when the swap actually runs.
        let confirmation = MintConfirmation {
            mint_url: parsed.mint_url.clone(),
            mint_name: mint_name.clone(),
            unit: unit_str,
            currency: currency_for_unit(&parsed.unit)
                .map(|c| c.to_string())
                .unwrap_or_default(),
            amount: amount.to_string(),
            fee: "0".into(),
        };

        self.pending = Some(PendingContext { parsed, mint_name });
        self.machine
            .transition(ReceiveFlowState::NeedsMintConfirmation(confirmation));
        Ok(self.machine.state().clone())
    }

    async fn handle_confirm_add_mint(&mut self) -> Result<ReceiveFlowState, ReceiveFlowError> {
        let pending = self
            .pending
            .take()
            .expect("accepts() filters this case from non-pending states");
        let parsed = pending.parsed;
        let mint_name = pending.mint_name;

        self.machine.transition(ReceiveFlowState::AddingMint {
            mint_url: parsed.mint_url.clone(),
        });

        let currency = match currency_for_unit(&parsed.unit) {
            Some(c) => c,
            None => {
                return Ok(self.go_failed_str(
                    &format!("unsupported cashu unit {}", parsed.unit),
                    code::TOKEN_PARSE,
                ))
            }
        };

        let added = match self
            .add_mint(&parsed.mint_url, &mint_name, currency)
            .await
        {
            Ok(account) => account,
            Err(e) => return Ok(self.go_failed_from(e)),
        };

        self.run_swap(parsed, added).await
    }

    /// Add a Cashu mint to the user's wallet account list. Mirrors
    /// `crates/agicash-cli/src/mint.rs::cmd_mint_add` minus the print step.
    async fn add_mint(
        &self,
        mint_url: &str,
        mint_name: &str,
        currency: Currency,
    ) -> Result<Account, ReceiveFlowError> {
        let existing = self.storage.get_user(self.user_id).await?;
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
            let placeholder_prefix = format!("uninitialized-{}-", self.user_id);
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

        let mut accounts = vec![AccountInput {
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency,
            name: mint_name.to_string(),
            details: json!({
                "mint_url": mint_url,
                "keyset_counters": {},
            }),
            is_default: false,
        }];
        if existing.is_none() {
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
            user_id: self.user_id,
            email,
            email_verified,
            accounts,
            cashu_locking_xpub,
            encryption_public_key,
            spark_identity_public_key,
            terms_accepted_at,
            gift_card_mint_terms_accepted_at,
        };

        let result = self
            .storage
            .upsert_user_with_accounts(input)
            .await
            .map_err(ReceiveFlowError::MintAdd)?;

        let new_account = result
            .accounts
            .into_iter()
            .find(|a| {
                a.account_type == AccountType::Cashu
                    && a.details
                        .get("mint_url")
                        .and_then(|v| v.as_str())
                        .is_some_and(|s| mint_urls_equal(s, mint_url))
            })
            .ok_or_else(|| {
                ReceiveFlowError::MintAdd(agicash_traits::StorageError::Internal(
                    "upsert returned no account matching the new mint URL".into(),
                ))
            })?;
        Ok(new_account)
    }

    async fn run_swap(
        &mut self,
        parsed: ParsedToken,
        account: Account,
    ) -> Result<ReceiveFlowState, ReceiveFlowError> {
        self.machine.transition(ReceiveFlowState::Swapping {
            account_id: account.id.to_string(),
            mint_url: parsed.mint_url.clone(),
        });

        let create_result = match self
            .receive_swap_service
            .create(self.user_id, &parsed, &account, None)
            .await
        {
            Ok(r) => r,
            Err(ReceiveSwapError::Storage(ReceiveSwapStorageError::AlreadyClaimed)) => {
                let receipt = ReceiveFlowResult {
                    status: ReceiveStatus::AlreadyClaimed,
                    amount: "0".into(),
                    fee: "0".into(),
                    unit: parsed.unit.to_string(),
                    currency: account.currency.to_string(),
                    account_id: account.id.to_string(),
                    mint_url: parsed.mint_url.clone(),
                    token_hash: parsed.hash.clone(),
                };
                self.machine.transition(ReceiveFlowState::Done(receipt.clone()));
                return Ok(ReceiveFlowState::Done(receipt));
            }
            Err(e) => return Ok(self.go_failed_from_swap(e)),
        };

        let seed = self.seed_provider.get_cashu_seed().await?;
        let outcome = match self
            .receive_swap_service
            .complete_swap(&create_result.account, create_result.swap, &seed)
            .await
        {
            Ok(o) => o,
            Err(e) => return Ok(self.go_failed_from_swap(e)),
        };

        let result = receipt_from_outcome(outcome, &create_result.account, &parsed);
        self.machine
            .transition(ReceiveFlowState::Done(result.clone()));
        Ok(ReceiveFlowState::Done(result))
    }

    fn go_failed_str(&mut self, reason: &str, code_str: &str) -> ReceiveFlowState {
        let s = ReceiveFlowState::Failed {
            reason: reason.to_string(),
            code: code_str.to_string(),
        };
        self.machine.transition(s.clone());
        s
    }

    fn go_failed_from(&mut self, err: ReceiveFlowError) -> ReceiveFlowState {
        let s = ReceiveFlowState::Failed {
            reason: err.to_string(),
            code: err.code().to_string(),
        };
        self.machine.transition(s.clone());
        s
    }

    fn go_failed_from_swap(&mut self, err: ReceiveSwapError) -> ReceiveFlowState {
        self.go_failed_from(ReceiveFlowError::Swap(err))
    }
}

fn receipt_from_outcome(
    outcome: CompleteOutcome,
    fallback_account: &Account,
    parsed: &ParsedToken,
) -> ReceiveFlowResult {
    match outcome {
        CompleteOutcome::Completed { swap, account, .. } => ReceiveFlowResult {
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
            ReceiveFlowResult {
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
        CompleteOutcome::Failed(swap) => ReceiveFlowResult {
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

fn find_matching_account<'a>(
    accounts: &'a [Account],
    mint_url: &str,
    unit: &CurrencyUnit,
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

fn unit_matches_currency(unit: &CurrencyUnit, currency: Currency) -> bool {
    matches!(
        (unit, currency),
        (CurrencyUnit::Sat, Currency::Btc) | (CurrencyUnit::Usd, Currency::Usd)
    )
}

fn currency_for_unit(unit: &CurrencyUnit) -> Option<Currency> {
    match unit {
        CurrencyUnit::Sat => Some(Currency::Btc),
        CurrencyUnit::Usd => Some(Currency::Usd),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::receive_swap::{CashuReceiveSwapStorage, TokenProof};
    use agicash_domain::{AccountId, AccountState, User};
    use agicash_traits::{
        CashuMintWallet, CashuProviderError, UpsertUserResult,
    };
    use chrono::Utc;
    use cdk::mint_url::MintUrl;
    use serde_json::Value;
    use uuid::Uuid;

    /// Storage that returns the supplied accounts/user. `upsert` records the
    /// last input and returns a constructed account.
    struct StubStorage {
        accounts: Vec<Account>,
        user: Option<User>,
        upsert_response: std::sync::Mutex<Option<UpsertUserResult>>,
    }

    #[async_trait::async_trait]
    impl UserStorage for StubStorage {
        async fn upsert_user_with_accounts(
            &self,
            _input: UpsertUserInput,
        ) -> Result<UpsertUserResult, agicash_traits::StorageError> {
            self.upsert_response
                .lock()
                .unwrap()
                .take()
                .ok_or_else(|| agicash_traits::StorageError::Internal("no upsert response".into()))
        }
        async fn get_user(
            &self,
            _user_id: UserId,
        ) -> Result<Option<User>, agicash_traits::StorageError> {
            Ok(self.user.clone())
        }
        async fn list_accounts(
            &self,
            _user_id: UserId,
        ) -> Result<Vec<Account>, agicash_traits::StorageError> {
            Ok(self.accounts.clone())
        }
        async fn get_account(
            &self,
            _account_id: AccountId,
        ) -> Result<Option<Account>, agicash_traits::StorageError> {
            Ok(None)
        }
    }

    struct StubProvider {
        info_response: std::sync::Mutex<Result<cdk::nuts::MintInfo, CashuProviderError>>,
    }

    #[async_trait::async_trait]
    impl CashuProvider for StubProvider {
        async fn wallet_for_account(
            &self,
            _account: &Account,
        ) -> Result<Arc<CashuMintWallet>, CashuProviderError> {
            Err(CashuProviderError::Network("not used in tests".into()))
        }
        async fn mint_info(
            &self,
            _mint_url: &MintUrl,
        ) -> Result<cdk::nuts::MintInfo, CashuProviderError> {
            let mut guard = self.info_response.lock().unwrap();
            std::mem::replace(&mut *guard, Err(CashuProviderError::Network("consumed".into())))
        }
    }

    struct StubSeedProvider;
    #[async_trait::async_trait]
    impl CashuSeedProvider for StubSeedProvider {
        async fn get_cashu_seed(&self) -> Result<[u8; 64], ReceiveFlowError> {
            Ok([0u8; 64])
        }
    }

    /// Storage stub for the inner receive-swap service. Never reached when
    /// we only test the parse/list paths.
    struct UnusedSwapStorage;
    #[async_trait::async_trait]
    impl CashuReceiveSwapStorage for UnusedSwapStorage {
        async fn create(
            &self,
            _input: crate::receive_swap::CreateReceiveSwap,
        ) -> Result<
            crate::receive_swap::CreateReceiveSwapResult,
            crate::receive_swap::ReceiveSwapStorageError,
        > {
            unreachable!("swap storage create should not be hit in unit tests")
        }
        async fn complete(
            &self,
            _token_hash: &str,
            _user_id: UserId,
            _proofs: Vec<TokenProof>,
        ) -> Result<
            crate::receive_swap::CompleteReceiveSwapResult,
            crate::receive_swap::ReceiveSwapStorageError,
        > {
            unreachable!()
        }
        async fn fail(
            &self,
            _token_hash: &str,
            _user_id: UserId,
            _reason: &str,
        ) -> Result<
            crate::receive_swap::CashuReceiveSwap,
            crate::receive_swap::ReceiveSwapStorageError,
        > {
            unreachable!()
        }
    }

    fn make_service(
        accounts: Vec<Account>,
        user: Option<User>,
        info: Result<cdk::nuts::MintInfo, CashuProviderError>,
    ) -> ReceiveFlowService {
        let storage: Arc<dyn UserStorage> = Arc::new(StubStorage {
            accounts,
            user,
            upsert_response: std::sync::Mutex::new(None),
        });
        let provider: Arc<dyn CashuProvider> = Arc::new(StubProvider {
            info_response: std::sync::Mutex::new(info),
        });
        let swap_storage: Arc<dyn CashuReceiveSwapStorage> = Arc::new(UnusedSwapStorage);
        let swap_service = Arc::new(CashuReceiveSwapService::new(
            swap_storage,
            Arc::clone(&provider),
        ));
        let seed: Arc<dyn CashuSeedProvider> = Arc::new(StubSeedProvider);
        ReceiveFlowService::new(UserId::new(), storage, provider, swap_service, seed)
    }

    #[tokio::test]
    async fn starts_in_idle_and_accepts_start() {
        let svc = make_service(
            vec![],
            None,
            Err(CashuProviderError::Network("n/a".into())),
        );
        assert_eq!(svc.current_state(), ReceiveFlowState::Idle);
    }

    #[tokio::test]
    async fn rejects_invalid_event_in_idle() {
        let mut svc = make_service(
            vec![],
            None,
            Err(CashuProviderError::Network("n/a".into())),
        );
        let err = svc
            .dispatch(ReceiveFlowEvent::ConfirmAddMint)
            .await
            .unwrap_err();
        assert!(matches!(err, ReceiveFlowError::InvalidEvent { .. }));
    }

    #[tokio::test]
    async fn malformed_token_lands_in_failed_token_parse() {
        let mut svc = make_service(
            vec![],
            None,
            Err(CashuProviderError::Network("n/a".into())),
        );
        let state = svc
            .dispatch(ReceiveFlowEvent::Start {
                token: "not-a-token".into(),
            })
            .await
            .unwrap();
        match state {
            ReceiveFlowState::Failed { code, .. } => assert_eq!(code, code::TOKEN_PARSE),
            other => panic!("expected Failed, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn retry_from_failed_resets_to_idle() {
        let mut svc = make_service(
            vec![],
            None,
            Err(CashuProviderError::Network("n/a".into())),
        );
        let _ = svc
            .dispatch(ReceiveFlowEvent::Start {
                token: "bad".into(),
            })
            .await
            .unwrap();
        let next = svc.dispatch(ReceiveFlowEvent::Retry).await.unwrap();
        assert_eq!(next, ReceiveFlowState::Idle);
    }

    #[tokio::test]
    async fn dismiss_from_failed_resets_to_idle() {
        let mut svc = make_service(
            vec![],
            None,
            Err(CashuProviderError::Network("n/a".into())),
        );
        let _ = svc
            .dispatch(ReceiveFlowEvent::Start {
                token: "bad".into(),
            })
            .await
            .unwrap();
        let next = svc.dispatch(ReceiveFlowEvent::Dismiss).await.unwrap();
        assert_eq!(next, ReceiveFlowState::Idle);
    }

    #[test]
    fn find_matching_account_normalizes_trailing_slash() {
        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: serde_json::json!({ "mint_url": "https://m.example/" }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };
        assert!(find_matching_account(
            std::slice::from_ref(&account),
            "https://m.example",
            &CurrencyUnit::Sat,
        )
        .is_some());
    }

    #[test]
    fn find_matching_account_rejects_currency_mismatch() {
        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Usd,
            details: serde_json::json!({ "mint_url": "https://m.example" }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };
        assert!(find_matching_account(
            std::slice::from_ref(&account),
            "https://m.example",
            &CurrencyUnit::Sat,
        )
        .is_none());
    }

    #[test]
    fn unit_matches_currency_covers_sat_btc_only() {
        assert!(unit_matches_currency(&CurrencyUnit::Sat, Currency::Btc));
        assert!(unit_matches_currency(&CurrencyUnit::Usd, Currency::Usd));
        assert!(!unit_matches_currency(&CurrencyUnit::Msat, Currency::Btc));
    }

    #[test]
    fn currency_for_unit_covers_sat_and_usd_only() {
        assert_eq!(currency_for_unit(&CurrencyUnit::Sat), Some(Currency::Btc));
        assert_eq!(currency_for_unit(&CurrencyUnit::Usd), Some(Currency::Usd));
        assert_eq!(currency_for_unit(&CurrencyUnit::Msat), None);
    }

    #[test]
    fn receipt_from_outcome_completed_sets_received_status() {
        let parsed = ParsedToken {
            raw: "x".into(),
            mint_url: "https://m".into(),
            proofs: vec![],
            memo: None,
            unit: CurrencyUnit::Sat,
            hash: "h".into(),
        };
        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "Mint".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: Value::Null,
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };
        let swap = crate::receive_swap::CashuReceiveSwap {
            token_hash: "h".into(),
            token_proofs: vec![],
            token_description: None,
            user_id: UserId::new(),
            account_id: account.id,
            input_amount: agicash_money::Money::new(
                rust_decimal::Decimal::from(64u64),
                Currency::Btc,
                agicash_money::Unit::Sat,
            ),
            amount_received: agicash_money::Money::new(
                rust_decimal::Decimal::from(64u64),
                Currency::Btc,
                agicash_money::Unit::Sat,
            ),
            fee_amount: agicash_money::Money::new(
                rust_decimal::Decimal::from(0u64),
                Currency::Btc,
                agicash_money::Unit::Sat,
            ),
            keyset_id: "k".into(),
            keyset_counter: 0,
            output_amounts: vec![],
            transaction_id: Uuid::new_v4(),
            created_at: Utc::now(),
            version: 0,
            state: CashuReceiveSwapState::Completed,
        };
        let outcome = CompleteOutcome::Completed {
            swap,
            account: account.clone(),
            added_proofs: vec![],
        };
        let r = receipt_from_outcome(outcome, &account, &parsed);
        assert_eq!(r.status, ReceiveStatus::Received);
        assert_eq!(r.amount, "64");
    }
}
