//! End-to-end test for `agicash receive lightning <amount>` against the
//! real testnut mint + the real Open Secret -> Supabase auth chain.
//!
//! `testnut.cashu.space`'s fakewallet auto-pays mint-quote invoices within
//! a few seconds, so the polling path runs to completion without any
//! external wallet action.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test `receive_lightning` -- --nocapture --test-threads=1

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod common;

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use super::common::*;

    /// `auth guest` -> `mint add testnut` -> `receive lightning N` ->
    /// assert success and balance > 0.
    #[test]
    fn receive_lightning_credits_balance_end_to_end() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("recv-lightning-e2e");
        session.spawn_guest_with_test_mint();

        let receive = session
            .cmd()
            .args([
                "receive",
                "lightning",
                "64",
                "--poll-ms",
                "500",
                "--timeout-s",
                "30",
            ])
            .output()
            .expect("spawn agicash receive lightning");
        assert!(
            receive.status.success(),
            "receive lightning failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive.stdout),
            String::from_utf8_lossy(&receive.stderr),
        );
        let stdout = String::from_utf8_lossy(&receive.stdout).into_owned();
        // The command emits TWO newline-delimited JSON bodies: the initial
        // `quote-issued` and the final `received`. Parse the last one.
        let last_json = stdout
            .lines()
            .filter(|l| !l.trim().is_empty())
            .next_back()
            .expect("at least one JSON line on stdout");
        let parsed: serde_json::Value = serde_json::from_str(last_json)
            .unwrap_or_else(|e| panic!("last stdout line not JSON ({e}): {last_json}"));
        assert_eq!(
            parsed.get("status").and_then(|v| v.as_str()),
            Some("received"),
            "unexpected final body: {parsed} (full stdout: {stdout})"
        );
        assert_eq!(
            parsed.get("amount").and_then(|v| v.as_str()),
            Some("64"),
            "expected amount 64, body: {parsed}"
        );

        // Verify balance reflects the new proofs.
        let balance = session
            .cmd()
            .arg("balance")
            .output()
            .expect("spawn agicash balance");
        assert!(
            balance.status.success(),
            "balance failed: stderr={}",
            String::from_utf8_lossy(&balance.stderr)
        );
        let balances = parse_json("balance", &balance);
        // `agicash balance` shape varies; assert there's at least one
        // non-zero positive balance anywhere in the JSON.
        let serialized = serde_json::to_string(&balances).unwrap();
        assert!(
            !serialized.contains("\"0\""),
            "expected non-zero balance after lightning receive: {serialized}",
        );
    }

    /// `--no-wait` returns the invoice and `receive lightning-complete`
    /// drives the mint after the fakewallet pays it.
    #[test]
    fn receive_lightning_no_wait_then_complete_resolves() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("recv-lightning-no-wait");
        session.spawn_guest_with_test_mint();

        let issued = session
            .cmd()
            .args(["receive", "lightning", "32", "--no-wait"])
            .output()
            .expect("spawn agicash receive lightning --no-wait");
        assert!(
            issued.status.success(),
            "receive lightning --no-wait failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&issued.stdout),
            String::from_utf8_lossy(&issued.stderr),
        );
        let issued_json = parse_json("no-wait", &issued);
        assert_eq!(
            issued_json.get("status").and_then(|v| v.as_str()),
            Some("quote-issued"),
            "unexpected --no-wait body: {issued_json}"
        );
        let quote_id = issued_json
            .get("quote_id")
            .and_then(|v| v.as_str())
            .expect("quote_id field")
            .to_string();

        // Give testnut's fakewallet a moment to settle the invoice.
        std::thread::sleep(std::time::Duration::from_secs(3));

        let complete = session
            .cmd()
            .args([
                "receive",
                "lightning-complete",
                &quote_id,
                "--poll-ms",
                "500",
                "--timeout-s",
                "30",
            ])
            .output()
            .expect("spawn agicash receive lightning-complete");
        assert!(
            complete.status.success(),
            "lightning-complete failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&complete.stdout),
            String::from_utf8_lossy(&complete.stderr),
        );
        let complete_json = parse_json("complete", &complete);
        assert_eq!(
            complete_json.get("status").and_then(|v| v.as_str()),
            Some("received"),
            "unexpected complete body: {complete_json}"
        );
        assert_eq!(
            complete_json.get("amount").and_then(|v| v.as_str()),
            Some("32"),
        );
    }

    /// `agicash receive lightning <amount>` without a matching Cashu
    /// account on the user errors with `no-matching-account`.
    #[test]
    fn receive_lightning_without_account_errors() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("recv-lightning-no-acct");
        session.spawn_guest();

        // Skip `mint add` — no matching account on this fresh guest.
        let receive = session
            .cmd()
            .args(["receive", "lightning", "64"])
            .output()
            .expect("spawn agicash receive lightning");
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
fn receive_lightning_tests_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test receive_lightning"
    );
}
