//! End-to-end test for `agicash send token <amount>` against the real testnut
//! mint + the real Open Secret -> Supabase auth chain.
//!
//! The helper `mint_test_token_via_testnut` (in `common`) runs the NUT-04
//! mint flow against testnut.cashu.space and produces a token string. The
//! token is handed to `agicash receive token` to fund the guest account; then
//! `agicash send token` produces a token a fresh guest can claim back via
//! `agicash receive token`.
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
mod common;

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use super::common::*;

    /// Mint 200 sats into a guest account, send 100 → produce token, then
    /// have a fresh guest receive that token and verify amount=100.
    #[test]
    #[allow(clippy::too_many_lines, clippy::similar_names)]
    fn send_token_round_trips_through_receive() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let sender = TestSession::new("send-roundtrip-sender");
        let receiver = TestSession::new("send-roundtrip-receiver");

        let (deposit_token, _) = mint_test_token_blocking(200);

        sender.spawn_guest_with_test_mint();
        let receive = sender
            .cmd()
            .args(["receive", "token", &deposit_token])
            .output()
            .expect("spawn agicash receive (deposit)");
        assert!(
            receive.status.success(),
            "deposit receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive.stdout),
            String::from_utf8_lossy(&receive.stderr),
        );

        let send = sender
            .cmd()
            .args(["send", "token", "100"])
            .output()
            .expect("spawn agicash send");
        assert!(
            send.status.success(),
            "send failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let send_json = parse_json("send", &send);
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

        // Fresh receiver redeems the token.
        receiver.spawn_guest_with_test_mint();
        let receive2 = receiver
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive (redeem)");
        assert!(
            receive2.status.success(),
            "redeem receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive2.stdout),
            String::from_utf8_lossy(&receive2.stderr),
        );
        let r2_json = parse_json("redeem receive", &receive2);
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
        let session = TestSession::new("send-insufficient");
        session.spawn_guest_with_test_mint();

        let send = session
            .cmd()
            .args(["send", "token", "100"])
            .output()
            .expect("spawn agicash send");
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
        let session = TestSession::new("send-dry-run");
        let (deposit_token, _) = mint_test_token_blocking(200);

        session.spawn_guest_with_test_mint();
        let receive = session
            .cmd()
            .args(["receive", "token", &deposit_token])
            .output()
            .expect("spawn agicash receive");
        assert!(
            receive.status.success(),
            "receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive.stdout),
            String::from_utf8_lossy(&receive.stderr),
        );

        let dry = session
            .cmd()
            .args(["send", "token", "100", "--dry-run"])
            .output()
            .expect("spawn agicash send --dry-run");
        assert!(
            dry.status.success(),
            "dry-run failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&dry.stdout),
            String::from_utf8_lossy(&dry.stderr),
        );
        let dry_json = parse_json("dry-run", &dry);
        assert_eq!(
            dry_json.get("status").and_then(|v| v.as_str()),
            Some("quote"),
        );
        // Token must NOT be present in a quote.
        assert!(dry_json.get("token").is_none());

        // Real send still works.
        let send = session
            .cmd()
            .args(["send", "token", "100"])
            .output()
            .expect("spawn agicash send");
        assert!(
            send.status.success(),
            "follow-up send failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let send_json = parse_json("follow-up send", &send);
        assert_eq!(
            send_json.get("status").and_then(|v| v.as_str()),
            Some("sent")
        );
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
