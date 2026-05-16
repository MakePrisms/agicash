//! End-to-end test for `agicash receive <token>` against the real testnut
//! mint + the real Open Secret -> Supabase auth chain.
//!
//! The helper `mint_test_token_via_testnut` (in `common`) runs the NUT-04
//! mint flow against testnut.cashu.space: post a quote (testnut's
//! fakewallet auto-pays test invoices), post mint to obtain proofs, and
//! encode them into a token string. The token is then handed to the CLI
//! just like a user-supplied token.
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
mod common;

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use super::common::*;

    /// `auth guest` -> `mint add testnut` -> mint a test token -> `receive`
    /// -> assert success and balance > 0.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn receive_token_increments_balance() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("receive-success");
        let (token, expected_amount) = mint_test_token_blocking(64);

        session.spawn_guest_with_test_mint();

        let receive = session
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive token");
        assert!(
            receive.status.success(),
            "receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive.stdout),
            String::from_utf8_lossy(&receive.stderr),
        );
        let receive_json = parse_json("receive", &receive);
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
            .expect("token_hash field")
            .to_string();
        assert!(!token_hash.is_empty());

        // Second receive should be already-claimed (DB unique constraint).
        let second = session
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive token (second)");
        assert!(
            second.status.success(),
            "second receive should exit 0 with already-claimed status, stderr={}",
            String::from_utf8_lossy(&second.stderr),
        );
        let second_json = parse_json("second receive", &second);
        assert_eq!(
            second_json.get("status").and_then(|v| v.as_str()),
            Some("already-claimed"),
            "unexpected second receive body: {second_json}",
        );
        assert_eq!(
            second_json.get("token_hash").and_then(|v| v.as_str()),
            Some(token_hash.as_str()),
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
        let session = TestSession::new("receive-unknown-mint");
        let (token, _) = mint_test_token_blocking(32);
        session.spawn_guest();

        // Skip `mint add` — no matching account on this fresh guest.
        let receive = session
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive token");

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
