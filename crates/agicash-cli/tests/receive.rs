//! End-to-end test for `agicash receive <token>` against the real testnut
//! mint + the real Open Secret -> Supabase auth chain.
//!
//! The helper `mint_test_token_via_testnut` runs the NUT-04 mint flow
//! against testnut.cashu.space: post a quote (testnut's fakewallet
//! auto-pays test invoices), post mint to obtain proofs, and encode them
//! into a V4 token string. The token is then handed to the CLI just like
//! a user-supplied token.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test receive -- --nocapture

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use assert_cmd::Command;
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

    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    fn env_ready() -> bool {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").is_ok()
            && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
            && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
            && (std::env::var("SUPABASE_ANON_KEY").is_ok()
                || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
    }

    async fn mint_test_token_via_testnut(
        amount: u64,
    ) -> Result<(String, u64), Box<dyn std::error::Error>> {
        let mint_url = MintUrl::from_str(TEST_MINT_URL)?;
        let client = HttpClient::new(mint_url.clone(), None);

        // Pick an active sat keyset.
        let keysets = client.get_mint_keysets().await?;
        let active = keysets
            .keysets
            .iter()
            .find(|k| k.unit == CurrencyUnit::Sat && k.active)
            .ok_or("no active sat keyset on testnut")?
            .clone();
        let keyset_id: KeysetId = active.id;

        // Request a mint quote.
        let quote = client
            .post_mint_quote(MintQuoteBolt11Request {
                amount: Amount::from(amount),
                unit: CurrencyUnit::Sat,
                description: Some("agicash slice 5 e2e".into()),
                pubkey: None,
            })
            .await?;

        // testnut's fakewallet auto-pays test invoices after a short delay.
        // Poll until PAID or fail after a few seconds.
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

        // Build blinded messages. Use a random seed; we don't need to keep
        // track of counters for this test mint.
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

        // Unblind to proofs.
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
            Some("agicash test".into()),
            CurrencyUnit::Sat,
        );
        Ok((token.to_string(), amount))
    }

    /// `auth guest` -> `mint add testnut` -> mint a test token -> `receive`
    /// -> assert success and balance > 0.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn receive_token_increments_balance() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.receive-success");

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (token, expected_amount) = runtime
            .block_on(mint_test_token_via_testnut(64))
            .expect("mint test token");
        drop(runtime);

        let guest = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(
            guest.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&guest.stdout),
            String::from_utf8_lossy(&guest.stderr),
        );

        let cleanup = |service: &str| {
            let _ = Command::cargo_bin("agicash")
                .unwrap()
                .env("AGICASH_KEYRING_SERVICE", service)
                .args(["auth", "logout"])
                .output();
        };

        let add = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add");
        if !add.status.success() {
            cleanup(&service);
            panic!(
                "mint add failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&add.stdout),
                String::from_utf8_lossy(&add.stderr),
            );
        }

        let receive = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["receive", &token])
            .output()
            .expect("spawn agicash receive");
        if !receive.status.success() {
            cleanup(&service);
            panic!(
                "receive failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&receive.stdout),
                String::from_utf8_lossy(&receive.stderr),
            );
        }
        let receive_stdout = String::from_utf8_lossy(&receive.stdout).into_owned();
        let receive_json: serde_json::Value = serde_json::from_str(receive_stdout.trim())
            .unwrap_or_else(|e| panic!("receive stdout not JSON ({e}): {receive_stdout}"));
        assert_eq!(
            receive_json.get("status").and_then(|v| v.as_str()),
            Some("received"),
            "unexpected receive body: {receive_json}",
        );
        let amount_str = receive_json
            .get("amount")
            .and_then(|v| v.as_str())
            .expect("amount field");
        assert_eq!(
            amount_str,
            &expected_amount.to_string(),
            "expected amount {expected_amount}, got {amount_str}"
        );
        let token_hash = receive_json
            .get("token_hash")
            .and_then(|v| v.as_str())
            .expect("token_hash field");
        assert!(!token_hash.is_empty());

        // Second receive should be already-claimed (DB unique constraint).
        let second = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["receive", &token])
            .output()
            .expect("spawn agicash receive (second)");
        cleanup(&service);
        assert!(
            second.status.success(),
            "second receive should exit 0 with already-claimed status, stderr={}",
            String::from_utf8_lossy(&second.stderr),
        );
        let second_stdout = String::from_utf8_lossy(&second.stdout).into_owned();
        let second_json: serde_json::Value = serde_json::from_str(second_stdout.trim())
            .unwrap_or_else(|e| panic!("second receive not JSON ({e}): {second_stdout}"));
        assert_eq!(
            second_json.get("status").and_then(|v| v.as_str()),
            Some("already-claimed"),
            "unexpected second receive body: {second_json}",
        );
        assert_eq!(
            second_json.get("token_hash").and_then(|v| v.as_str()),
            Some(token_hash),
            "token_hash should match between the two receives"
        );
    }

    /// Attempt to receive a token whose mint we haven't added; expect a
    /// `no-matching-account` error on stderr.
    #[test]
    fn receive_token_for_unknown_mint_fails() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.receive-unknown-mint");

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (token, _) = runtime
            .block_on(mint_test_token_via_testnut(32))
            .expect("mint test token");
        drop(runtime);

        let guest = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(guest.status.success());

        // Skip `mint add` — no matching account on this fresh guest.
        let receive = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["receive", &token])
            .output()
            .expect("spawn agicash receive");

        let _ = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "logout"])
            .output();

        assert!(
            !receive.status.success(),
            "expected failure without matching account, stdout={}, stderr={}",
            String::from_utf8_lossy(&receive.stdout),
            String::from_utf8_lossy(&receive.stderr),
        );
        let stderr = String::from_utf8_lossy(&receive.stderr).into_owned();
        assert!(
            stderr.contains("\"code\":\"no-matching-account\""),
            "expected no-matching-account code on stderr, got: {stderr}",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn receive_tests_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test receive"
    );
}
