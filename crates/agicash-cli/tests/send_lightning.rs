//! End-to-end test for `agicash send lightning <invoice>` against the
//! real testnut mint + the real Open Secret -> Supabase auth chain.
//!
//! Flow (single-account, two-quote dance):
//!   1. `auth guest` + `mint add testnut`
//!   2. `receive lightning 256` to fund the account (testnut fakewallet auto-pays).
//!   3. `receive lightning 64 --no-wait` to mint an outgoing invoice we
//!      can pay against ourselves; capture invoice + `receive_quote_id`.
//!   4. `send lightning <invoice>` pays it (NUT-05 melt round-trip).
//!   5. `receive lightning-complete <quote_id>` lands the proofs on
//!      the receive side so balance reflects the round-trip.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test `send_lightning` -- --nocapture --test-threads=1

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use assert_cmd::Command;

    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    fn env_ready() -> bool {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").is_ok()
            && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
            && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
            && (std::env::var("SUPABASE_ANON_KEY").is_ok()
                || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
    }

    fn cleanup(service: &str) {
        let _ = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", service)
            .args(["auth", "logout"])
            .output();
    }

    fn run(service: &str, args: &[&str]) -> std::process::Output {
        Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", service)
            .args(args)
            .output()
            .expect("spawn agicash")
    }

    fn last_json_line(output: &[u8]) -> serde_json::Value {
        let stdout = String::from_utf8_lossy(output).into_owned();
        let last = stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .next_back()
            .expect("at least one stdout line");
        serde_json::from_str(last)
            .unwrap_or_else(|e| panic!("last stdout line not JSON ({e}): {last}\nfull: {stdout}"))
    }

    fn first_json_line(output: &[u8]) -> serde_json::Value {
        let stdout = String::from_utf8_lossy(output).into_owned();
        let first = stdout
            .lines()
            .find(|l| !l.trim().is_empty())
            .expect("at least one stdout line");
        serde_json::from_str(first)
            .unwrap_or_else(|e| panic!("first stdout line not JSON ({e}): {first}\nfull: {stdout}"))
    }

    /// auth guest -> mint add -> receive lightning 256 (fund) ->
    /// receive lightning 64 --no-wait (capture invoice) ->
    /// send lightning <invoice> -> expect status == paid.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn send_lightning_pays_invoice_end_to_end() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-lightning-e2e");

        // 1. auth guest.
        let guest = run(&service, &["auth", "guest"]);
        assert!(
            guest.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&guest.stdout),
            String::from_utf8_lossy(&guest.stderr),
        );

        // 2. mint add.
        let add = run(&service, &["mint", "add", TEST_MINT_URL]);
        if !add.status.success() {
            cleanup(&service);
            panic!(
                "mint add failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&add.stdout),
                String::from_utf8_lossy(&add.stderr),
            );
        }

        // 3. Fund the account: receive 256 sat via lightning (auto-paid by testnut fakewallet).
        let fund = run(
            &service,
            &[
                "receive",
                "lightning",
                "256",
                "--poll-ms",
                "500",
                "--timeout-s",
                "30",
            ],
        );
        if !fund.status.success() {
            cleanup(&service);
            panic!(
                "fund receive failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&fund.stdout),
                String::from_utf8_lossy(&fund.stderr),
            );
        }
        let fund_last = last_json_line(&fund.stdout);
        assert_eq!(
            fund_last.get("status").and_then(|v| v.as_str()),
            Some("received"),
            "fund receive did not complete: {fund_last}",
        );

        // 4. Generate an outgoing invoice to pay.
        let issue = run(&service, &["receive", "lightning", "64", "--no-wait"]);
        if !issue.status.success() {
            cleanup(&service);
            panic!(
                "issue invoice failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&issue.stdout),
                String::from_utf8_lossy(&issue.stderr),
            );
        }
        let issued = first_json_line(&issue.stdout);
        let invoice = issued
            .get("invoice")
            .and_then(|v| v.as_str())
            .expect("invoice field")
            .to_string();
        let receive_quote_id = issued
            .get("quote_id")
            .and_then(|v| v.as_str())
            .expect("quote_id field")
            .to_string();

        // 5. Send lightning — pay our own outgoing invoice.
        let send = run(
            &service,
            &[
                "send",
                "lightning",
                &invoice,
                "--poll-ms",
                "500",
                "--timeout-s",
                "60",
            ],
        );
        if !send.status.success() {
            cleanup(&service);
            panic!(
                "send lightning failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&send.stdout),
                String::from_utf8_lossy(&send.stderr),
            );
        }
        let send_last = last_json_line(&send.stdout);
        assert_eq!(
            send_last.get("status").and_then(|v| v.as_str()),
            Some("paid"),
            "send did not reach paid: {send_last}",
        );

        // 6. Optional sanity: complete the receive side so balance is consistent.
        let complete = run(
            &service,
            &[
                "receive",
                "lightning-complete",
                &receive_quote_id,
                "--poll-ms",
                "500",
                "--timeout-s",
                "30",
            ],
        );
        cleanup(&service);
        if !complete.status.success() {
            // Non-fatal — the send already proved the flow works.
            eprintln!(
                "receive lightning-complete failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&complete.stdout),
                String::from_utf8_lossy(&complete.stderr),
            );
        }
    }

    /// `agicash send lightning --no-wait` returns the quote, then
    /// `send lightning-complete` drives it to PAID.
    #[test]
    fn send_lightning_no_wait_then_complete_resolves() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-lightning-no-wait");

        let guest = run(&service, &["auth", "guest"]);
        assert!(guest.status.success());

        let add = run(&service, &["mint", "add", TEST_MINT_URL]);
        if !add.status.success() {
            cleanup(&service);
            panic!(
                "mint add failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&add.stdout),
                String::from_utf8_lossy(&add.stderr),
            );
        }

        // Fund.
        let fund = run(
            &service,
            &[
                "receive",
                "lightning",
                "128",
                "--poll-ms",
                "500",
                "--timeout-s",
                "30",
            ],
        );
        if !fund.status.success() {
            cleanup(&service);
            panic!(
                "fund receive failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&fund.stdout),
                String::from_utf8_lossy(&fund.stderr),
            );
        }

        // Issue invoice.
        let issue = run(&service, &["receive", "lightning", "32", "--no-wait"]);
        if !issue.status.success() {
            cleanup(&service);
            panic!(
                "issue invoice failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&issue.stdout),
                String::from_utf8_lossy(&issue.stderr),
            );
        }
        let issued = first_json_line(&issue.stdout);
        let invoice = issued
            .get("invoice")
            .and_then(|v| v.as_str())
            .expect("invoice field")
            .to_string();

        // Send --no-wait.
        let send_quote = run(&service, &["send", "lightning", &invoice, "--no-wait"]);
        if !send_quote.status.success() {
            cleanup(&service);
            panic!(
                "send --no-wait failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&send_quote.stdout),
                String::from_utf8_lossy(&send_quote.stderr),
            );
        }
        let quote_issued = last_json_line(&send_quote.stdout);
        assert_eq!(
            quote_issued.get("status").and_then(|v| v.as_str()),
            Some("quote-issued"),
            "send --no-wait body: {quote_issued}",
        );
        let send_quote_id = quote_issued
            .get("quote_id")
            .and_then(|v| v.as_str())
            .expect("quote_id field")
            .to_string();

        // Complete.
        let complete = run(
            &service,
            &[
                "send",
                "lightning-complete",
                &send_quote_id,
                "--poll-ms",
                "500",
                "--timeout-s",
                "60",
            ],
        );
        cleanup(&service);
        assert!(
            complete.status.success(),
            "send lightning-complete failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&complete.stdout),
            String::from_utf8_lossy(&complete.stderr),
        );
        let final_body = last_json_line(&complete.stdout);
        assert_eq!(
            final_body.get("status").and_then(|v| v.as_str()),
            Some("paid"),
            "send lightning-complete body: {final_body}",
        );
    }

    /// `agicash send lightning` without a matching Cashu account errors
    /// with `no-matching-account` on stderr.
    #[test]
    fn send_lightning_without_account_errors() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-lightning-no-acct");

        let guest = run(&service, &["auth", "guest"]);
        assert!(guest.status.success());

        // Skip `mint add` — no matching account on this fresh guest.
        let send = run(&service, &["send", "lightning", "lnbc1pdoesnotmatter"]);
        cleanup(&service);
        assert!(
            !send.status.success(),
            "expected failure without matching account, stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let stderr = String::from_utf8_lossy(&send.stderr).into_owned();
        assert!(
            stderr.contains("\"code\":\"no-matching-account\""),
            "expected no-matching-account on stderr, got: {stderr}",
        );
    }

    /// `agicash send lightning <not-a-bolt11>` against a configured
    /// account errors with `invalid-invoice` on stderr.
    #[test]
    fn send_lightning_for_invalid_invoice_errors() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-lightning-bad-inv");

        let guest = run(&service, &["auth", "guest"]);
        assert!(guest.status.success());

        let add = run(&service, &["mint", "add", TEST_MINT_URL]);
        if !add.status.success() {
            cleanup(&service);
            panic!(
                "mint add failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&add.stdout),
                String::from_utf8_lossy(&add.stderr),
            );
        }

        let send = run(&service, &["send", "lightning", "not-a-bolt11"]);
        cleanup(&service);
        assert!(
            !send.status.success(),
            "expected failure for invalid invoice, stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let stderr = String::from_utf8_lossy(&send.stderr).into_owned();
        assert!(
            stderr.contains("\"code\":\"invalid-invoice\""),
            "expected invalid-invoice on stderr, got: {stderr}",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn send_lightning_tests_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test send_lightning"
    );
}
