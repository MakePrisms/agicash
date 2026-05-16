//! End-to-end test for `agicash send <amount>` against the real testnut
//! mint + the real Open Secret -> Supabase auth chain.
//!
//! The helper `mint_test_token_via_testnut` runs the NUT-04 mint flow
//! against testnut.cashu.space and produces a V4 token string. The token
//! is handed to `agicash receive` to fund the guest account; then
//! `agicash send` produces a token a fresh guest can claim back via
//! `agicash receive`.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test send -- --nocapture

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
                description: Some("agicash slice 6 e2e".into()),
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
            Some("agicash test".into()),
            CurrencyUnit::Sat,
        );
        Ok((token.to_string(), amount))
    }

    /// Spawn a fresh guest, add testnut, optionally receive a token to
    /// fund the account. Returns the keyring service id (caller must
    /// `auth logout` to clean up).
    fn spawn_guest_with_mint(service: &str) {
        let guest = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(
            guest.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&guest.stdout),
            String::from_utf8_lossy(&guest.stderr),
        );
        let add = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", service)
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add");
        assert!(
            add.status.success(),
            "mint add failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&add.stdout),
            String::from_utf8_lossy(&add.stderr),
        );
    }

    fn cleanup(service: &str) {
        let _ = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", service)
            .args(["auth", "logout"])
            .output();
    }

    /// Mint 200 sats into a guest account, send 100 → produce token, then
    /// have a fresh guest receive that token and verify amount=100.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn send_token_round_trips_through_receive() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let sender_service = format!("com.agicash.cli.test.{pid}.send-roundtrip-sender");
        let receiver_service = format!("com.agicash.cli.test.{pid}.send-roundtrip-receiver");

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (deposit_token, _) = runtime
            .block_on(mint_test_token_via_testnut(200))
            .expect("mint deposit token");
        drop(runtime);

        spawn_guest_with_mint(&sender_service);
        let receive = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &sender_service)
            .args(["receive", &deposit_token])
            .output()
            .expect("spawn agicash receive (deposit)");
        if !receive.status.success() {
            cleanup(&sender_service);
            panic!(
                "deposit receive failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&receive.stdout),
                String::from_utf8_lossy(&receive.stderr),
            );
        }

        let send = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &sender_service)
            .args(["send", "100"])
            .output()
            .expect("spawn agicash send");
        if !send.status.success() {
            cleanup(&sender_service);
            panic!(
                "send failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&send.stdout),
                String::from_utf8_lossy(&send.stderr),
            );
        }
        let send_stdout = String::from_utf8_lossy(&send.stdout).into_owned();
        let send_json: serde_json::Value = serde_json::from_str(send_stdout.trim())
            .unwrap_or_else(|e| panic!("send stdout not JSON ({e}): {send_stdout}"));
        assert_eq!(
            send_json.get("status").and_then(|v| v.as_str()),
            Some("sent"),
            "unexpected send body: {send_json}",
        );
        let token = send_json
            .get("token")
            .and_then(|v| v.as_str())
            .expect("token field")
            .to_string();
        assert!(token.starts_with("cashu"), "expected cashu token: {token}");
        let amount = send_json
            .get("amount")
            .and_then(|v| v.as_str())
            .expect("amount field");
        assert_eq!(amount, "100", "expected amount=100, got {amount}");

        cleanup(&sender_service);

        // Fresh receiver redeems the token.
        spawn_guest_with_mint(&receiver_service);
        let receive2 = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &receiver_service)
            .args(["receive", &token])
            .output()
            .expect("spawn agicash receive (redeem)");
        cleanup(&receiver_service);
        assert!(
            receive2.status.success(),
            "redeem receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive2.stdout),
            String::from_utf8_lossy(&receive2.stderr),
        );
        let r2_stdout = String::from_utf8_lossy(&receive2.stdout).into_owned();
        let r2_json: serde_json::Value = serde_json::from_str(r2_stdout.trim())
            .unwrap_or_else(|e| panic!("redeem receive not JSON ({e}): {r2_stdout}"));
        assert_eq!(
            r2_json.get("status").and_then(|v| v.as_str()),
            Some("received"),
            "unexpected redeem receive body: {r2_json}",
        );
        let received_amount = r2_json
            .get("amount")
            .and_then(|v| v.as_str())
            .expect("amount field");
        assert_eq!(
            received_amount, "100",
            "receiver should claim 100, got {received_amount}"
        );
    }

    /// `agicash send 100` with no proofs in the account → exit nonzero,
    /// stderr contains "insufficient-balance".
    #[test]
    fn send_insufficient_balance_errors() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-insufficient");

        spawn_guest_with_mint(&service);
        let send = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["send", "100"])
            .output()
            .expect("spawn agicash send");
        cleanup(&service);
        assert!(
            !send.status.success(),
            "expected nonzero exit, stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let stderr = String::from_utf8_lossy(&send.stderr).into_owned();
        assert!(
            stderr.contains("\"code\":\"insufficient-balance\""),
            "expected insufficient-balance code, got: {stderr}",
        );
    }

    /// `agicash send 100 --dry-run` after a 200-sat deposit prints a
    /// quote without persisting; a follow-up `agicash send 100` still
    /// succeeds.
    #[test]
    fn send_dry_run_prints_quote_without_persisting() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-dry-run");

        let runtime = tokio::runtime::Runtime::new().unwrap();
        let (deposit_token, _) = runtime
            .block_on(mint_test_token_via_testnut(200))
            .expect("mint deposit token");
        drop(runtime);

        spawn_guest_with_mint(&service);
        let receive = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["receive", &deposit_token])
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

        let dry = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["send", "100", "--dry-run"])
            .output()
            .expect("spawn agicash send --dry-run");
        if !dry.status.success() {
            cleanup(&service);
            panic!(
                "dry-run failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&dry.stdout),
                String::from_utf8_lossy(&dry.stderr),
            );
        }
        let dry_stdout = String::from_utf8_lossy(&dry.stdout).into_owned();
        let dry_json: serde_json::Value = serde_json::from_str(dry_stdout.trim())
            .unwrap_or_else(|e| panic!("dry-run stdout not JSON ({e}): {dry_stdout}"));
        assert_eq!(
            dry_json.get("status").and_then(|v| v.as_str()),
            Some("quote"),
        );
        // Token must NOT be present in a quote.
        assert!(dry_json.get("token").is_none());

        // Real send still works.
        let send = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["send", "100"])
            .output()
            .expect("spawn agicash send");
        cleanup(&service);
        assert!(
            send.status.success(),
            "follow-up send failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let send_json: serde_json::Value =
            serde_json::from_str(String::from_utf8_lossy(&send.stdout).trim()).unwrap();
        assert_eq!(send_json.get("status").and_then(|v| v.as_str()), Some("sent"));
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn send_tests_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test send"
    );
}
