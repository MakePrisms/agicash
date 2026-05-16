//! End-to-end test for the cashu receive-flow orchestrator against the
//! real testnut mint + the real Open Secret -> Supabase auth chain.
//!
//! Uses the same `mint_test_token_via_testnut` helper pattern as
//! `tests/receive.rs`, but exercises the new `ReceiveFlowService` directly
//! instead of going through the CLI's one-shot `receive` subcommand.
//!
//! Two scenarios:
//! 1. Add-mint flow: fresh guest, no accounts. `Start` →
//!    `NeedsMintConfirmation` → `ConfirmAddMint` → `Done`.
//! 2. Happy path with mint already added: `Start` → `Done` (skips the
//!    confirmation step).
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test `receive_flow` -- --nocapture

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use agicash_auth_opensecret::{
        register_guest, OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
    };
    use agicash_cashu::{
        CashuReceiveSwapService, CashuReceiveSwapStorage, CashuSeedProvider, CdkCashuProvider,
        ReceiveFlowError, ReceiveFlowEvent, ReceiveFlowService, ReceiveFlowState,
    };
    use agicash_storage_supabase::{
        SupabaseCashuReceiveSwapStorage, SupabaseStorage, SupabaseStorageConfig,
    };
    use agicash_traits::{
        CashuProvider, PassthroughProofEncryption, ProofEncryption, TokenProvider, UserStorage,
    };
    use cdk::amount::SplitTarget;
    use cdk::dhke::construct_proofs;
    use cdk::mint_url::MintUrl;
    use cdk::nuts::nut02::Id as KeysetId;
    use cdk::nuts::{
        CurrencyUnit, MintQuoteBolt11Request, MintRequest, PaymentMethod, PreMintSecrets, Token,
    };
    use cdk::wallet::{HttpClient, MintConnector};
    use cdk::Amount;
    use std::str::FromStr;
    use std::sync::Arc;

    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    fn env_ready() -> bool {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").is_ok()
            && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
            && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
            && (std::env::var("SUPABASE_ANON_KEY").is_ok()
                || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
    }

    /// `SeedProvider` that pulls from an `OpenSecretClient` — same wiring
    /// the FFI uses, just lifted into the test directly.
    struct CliSeedProvider {
        client: OpenSecretClient,
    }

    #[async_trait::async_trait]
    impl CashuSeedProvider for CliSeedProvider {
        async fn get_cashu_seed(&self) -> Result<[u8; 64], ReceiveFlowError> {
            self.client.get_cashu_seed().await.map_err(|e| {
                ReceiveFlowError::Storage(agicash_traits::StorageError::Internal(format!(
                    "fetch cashu seed: {e}"
                )))
            })
        }
    }

    async fn mint_test_token_via_testnut(
        amount: u64,
    ) -> Result<(String, u64), Box<dyn std::error::Error>> {
        let mint_url = MintUrl::from_str(TEST_MINT_URL)?;
        let client = HttpClient::new(mint_url.clone(), None);

        let keysets = client.get_mint_keysets().await?;
        let active = keysets
            .keysets
            .iter()
            .find(|k| k.unit == CurrencyUnit::Sat && k.active)
            .ok_or("no active sat keyset on testnut")?
            .clone();
        let keyset_id: KeysetId = active.id;

        let quote = client
            .post_mint_quote(MintQuoteBolt11Request {
                amount: Amount::from(amount),
                unit: CurrencyUnit::Sat,
                description: Some("agicash receive_flow e2e".into()),
                pubkey: None,
            })
            .await?;

        let mut paid = false;
        for _ in 0..20 {
            let status = client
                .get_mint_quote_status(&quote.quote.to_string())
                .await?;
            if matches!(status.state, cdk::nuts::nut23::QuoteState::Paid) {
                paid = true;
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        }
        if !paid {
            return Err("testnut did not auto-pay the test invoice".into());
        }

        let mut seed = [0u8; 64];
        getrandom::getrandom(&mut seed).map_err(|e| format!("getrandom: {e}"))?;
        let fee_and_amounts = cdk::amount::FeeAndAmounts::from((
            active.input_fee_ppk,
            (0..32).map(|i| 1u64 << i).collect::<Vec<_>>(),
        ));
        let pre_mint = PreMintSecrets::from_seed(
            keyset_id,
            0,
            &seed,
            Amount::from(amount),
            &SplitTarget::None,
            &fee_and_amounts,
        )?;

        let response = client
            .post_mint(
                &PaymentMethod::BOLT11,
                MintRequest {
                    quote: quote.quote.to_string(),
                    outputs: pre_mint.blinded_messages(),
                    signature: None,
                },
            )
            .await?;

        let keyset = client.get_mint_keyset(keyset_id).await?;
        let proofs = construct_proofs(
            response.signatures,
            pre_mint.rs(),
            pre_mint.secrets(),
            &keyset.keys,
        )?;

        let token = Token::new(
            mint_url.clone(),
            proofs,
            Some("agicash receive_flow test".into()),
            CurrencyUnit::Sat,
        );
        Ok((token.to_string(), amount))
    }

    /// Build the orchestrator dep bundle from env. Matches what
    /// `crates/agicash-cli/src/composition.rs` does, but inline so we don't
    /// need a CLI session file or keychain entry.
    async fn build_service_for_fresh_guest() -> Result<
        (ReceiveFlowService, OpenSecretClient, agicash_domain::UserId),
        Box<dyn std::error::Error>,
    > {
        let auth_cfg = OpenSecretConfig::from_env()?;
        let client = OpenSecretClient::new(auth_cfg)?;
        let mut password = [0u8; 16];
        getrandom::getrandom(&mut password).map_err(|e| format!("getrandom: {e}"))?;
        let resp = register_guest(&client, hex::encode(password), client.client_id()).await?;
        let user_id = agicash_domain::UserId::from(resp.id);

        let storage_cfg = SupabaseStorageConfig::from_env()?;
        let token_provider: Arc<dyn TokenProvider + Send + Sync> =
            Arc::new(OpenSecretTokenProvider::new(client.clone()));
        let storage = Arc::new(SupabaseStorage::new(storage_cfg, token_provider)?);

        let cashu_provider: Arc<dyn CashuProvider> = Arc::new(CdkCashuProvider::new());
        let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
        let receive_storage: Arc<dyn CashuReceiveSwapStorage> = Arc::new(
            SupabaseCashuReceiveSwapStorage::new(Arc::clone(&storage), encryption),
        );
        let receive_swap_service = Arc::new(CashuReceiveSwapService::new(
            receive_storage,
            Arc::clone(&cashu_provider),
        ));
        let seed_provider: Arc<dyn CashuSeedProvider> = Arc::new(CliSeedProvider {
            client: client.clone(),
        });
        let service = ReceiveFlowService::new(
            user_id,
            Arc::clone(&storage) as Arc<dyn UserStorage>,
            cashu_provider,
            receive_swap_service,
            seed_provider,
        );
        Ok((service, client, user_id))
    }

    #[tokio::test]
    async fn receive_flow_add_mint_then_swap() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }

        let (token, expected_amount) = mint_test_token_via_testnut(64)
            .await
            .expect("mint test token");

        let (mut service, _client, _user_id) = build_service_for_fresh_guest()
            .await
            .expect("build service");

        // No mint added yet — Start should land us in NeedsMintConfirmation.
        let s1 = service
            .dispatch(ReceiveFlowEvent::Start { token })
            .await
            .expect("start dispatch");
        match &s1 {
            ReceiveFlowState::NeedsMintConfirmation(c) => {
                assert!(c.mint_url.contains("testnut.cashu.space"));
                assert_eq!(c.unit, "sat");
                assert_eq!(c.currency, "BTC");
                assert_eq!(c.amount, expected_amount.to_string());
            }
            other => panic!("expected NeedsMintConfirmation, got {other:?}"),
        }

        // Confirm — should add the mint, run the swap, and land in Done.
        let s2 = service
            .dispatch(ReceiveFlowEvent::ConfirmAddMint)
            .await
            .expect("confirm dispatch");
        match s2 {
            ReceiveFlowState::Done(receipt) => {
                assert_eq!(receipt.amount, expected_amount.to_string());
                assert_eq!(receipt.unit, "sat");
                assert_eq!(receipt.currency, "BTC");
                assert!(!receipt.token_hash.is_empty());
            }
            other => panic!("expected Done, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn receive_flow_cancel_add_mint_lands_in_failed() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }

        let (token, _) = mint_test_token_via_testnut(32)
            .await
            .expect("mint test token");

        let (mut service, _client, _user_id) = build_service_for_fresh_guest()
            .await
            .expect("build service");

        let s1 = service
            .dispatch(ReceiveFlowEvent::Start { token })
            .await
            .expect("start dispatch");
        assert!(matches!(s1, ReceiveFlowState::NeedsMintConfirmation(_)));

        let s2 = service
            .dispatch(ReceiveFlowEvent::CancelAddMint)
            .await
            .expect("cancel dispatch");
        match s2 {
            ReceiveFlowState::Failed { code, .. } => {
                assert_eq!(code, "cancelled");
            }
            other => panic!("expected Failed, got {other:?}"),
        }

        // After Failed, Retry should reset to Idle.
        let s3 = service
            .dispatch(ReceiveFlowEvent::Retry)
            .await
            .expect("retry dispatch");
        assert!(matches!(s3, ReceiveFlowState::Idle));
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn receive_flow_tests_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test receive_flow"
    );
}
