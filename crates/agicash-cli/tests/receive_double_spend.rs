//! E2E: receive of a token whose proofs the **mint** has already
//! redeemed (i.e. another wallet ate them) returns the typed
//! `already-claimed` envelope. Roadmap entry **D2** in
//! `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cell **"Receive: token from mint we trust but mint
//! reports double-spent at swap → MISSING"**.
//!
//! Distinct from `receive::receive_token_increments_balance`'s second-
//! receive assertion: that case hits the **DB unique constraint** path
//! because the same guest's `cashu_receive_swaps` table already has a
//! row keyed by token_hash, so the swap is short-circuited before any
//! mint call. This test exercises the **mint-reports-spent** path —
//! a fresh guest's DB has no row for the token, so the receive flow
//! actually sends the swap request to the mint, the mint replies
//! `TokenAlreadySpent` (NUT-00 error 11001), `attempt_restore` returns
//! empty (the second guest's seed is different), and the swap is
//! marked `Failed` with `status="already-claimed"` (per
//! `cmd_receive`'s `CompleteOutcome::Failed` branch in
//! `agicash-cli/src/receive.rs:166`).
//!
//! Both paths converge on the same wire-level envelope
//! (`status="already-claimed"`, exit 0) so a regression that diverged
//! them — e.g. the mint-side path raising a `mint-error` instead — would
//! be a silent UX break (a "your token wasn't claimed" UI would suddenly
//! see a `mint-error` for an otherwise-routine race). This test pins
//! both branches against a single contract.
//!
//! Note on the prompt vs spec divergence: the worker brief asked for
//! "exit code non-zero" but the production code in
//! `agicash-cli/src/receive.rs` deliberately maps `CompleteOutcome::
//! Failed` (mint reports spent) and the storage `AlreadyClaimed` short-
//! circuit (DB unique-constraint) to the SAME success-exit-with-status
//! envelope. Strategy doc §5 names this as the canonical contract
//! ("idempotent re-receive → already-claimed"). The test pins the
//! production contract; if the team later flips it to a typed error,
//! flip the assertions and add the code to `ALLOWED_ERROR_CODES` in
//! `contracts.rs`.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test receive_double_spend -- --nocapture

#![allow(clippy::doc_markdown)]

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

    /// Mint a token via testnut, have guest A receive it (mint marks
    /// the proofs spent), then have a fresh guest B try to receive the
    /// SAME token — forcing the receive flow through the mint-side
    /// double-spend branch instead of the local DB short-circuit.
    /// Asserts the wire envelope matches the existing same-guest case.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn receive_already_spent_at_mint_returns_already_claimed() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }

        // Two distinct keyring service ids → two distinct OpenSecret
        // guest users → two distinct Cashu seeds. Guest B's seed cannot
        // restore guest A's blinded outputs from the mint, so the
        // restore fallback in `perform_mint_swap` returns empty and
        // the swap is marked Failed.
        let guest_a = TestSession::new("receive-double-spend-a");
        let guest_b = TestSession::new("receive-double-spend-b");

        let (token, expected_amount) = mint_test_token_blocking(64);

        // ---- Phase 1: guest A receives the token successfully. ----
        guest_a.spawn_guest_with_test_mint();
        let first = guest_a
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive (guest A)");
        assert!(
            first.status.success(),
            "guest A receive should succeed; stdout={}, stderr={}",
            String::from_utf8_lossy(&first.stdout),
            String::from_utf8_lossy(&first.stderr),
        );
        let first_json = parse_json("guest A receive", &first);
        assert_eq!(
            first_json.get("status").and_then(|v| v.as_str()),
            Some("received"),
            "guest A first receive should report `received`; got {first_json}",
        );
        let first_amount = first_json
            .get("amount")
            .and_then(|v| v.as_str())
            .expect("guest A receive amount field");
        // testnut takes a 1-sat input fee on the receive swap, so the
        // received amount may be `expected_amount - 1`. Assert it's at
        // least within 1 sat of the requested amount, matching the
        // strategy doc §4 "fee assertions stay defensive" guideline
        // and the pre-existing receive.rs test's known-fee surface.
        let parsed: u64 = first_amount.parse().expect("amount must parse as u64");
        assert!(
            parsed == expected_amount || parsed + 1 == expected_amount,
            "guest A received {parsed}, expected {expected_amount} (or {} with fee)",
            expected_amount - 1,
        );
        let token_hash_a = first_json
            .get("token_hash")
            .and_then(|v| v.as_str())
            .expect("guest A receive token_hash field")
            .to_string();
        assert!(!token_hash_a.is_empty(), "token_hash must be non-empty");

        // ---- Phase 2: guest B (fresh DB, fresh seed) tries the same
        // token. The mint reports the proofs already spent; the local
        // restore fallback fails (different seed); the swap is marked
        // Failed and the CLI emits status=already-claimed, exit 0. ----
        guest_b.spawn_guest_with_test_mint();
        let second = guest_b
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive (guest B)");
        assert!(
            second.status.success(),
            "guest B receive of an already-spent token must exit 0 with \
             status=already-claimed (not a typed error). \
             stdout={}, stderr={}",
            String::from_utf8_lossy(&second.stdout),
            String::from_utf8_lossy(&second.stderr),
        );
        let second_json = parse_json("guest B receive", &second);
        assert_eq!(
            second_json.get("status").and_then(|v| v.as_str()),
            Some("already-claimed"),
            "guest B receive of a mint-spent token must report \
             `already-claimed` (the mint-side path must converge to the \
             same wire envelope as the local DB short-circuit). \
             got {second_json}",
        );

        // The token_hash MUST round-trip identically: it's the proof
        // that both branches identified the same token. A drift here
        // would mean the hash function diverged between the two paths.
        let token_hash_b = second_json
            .get("token_hash")
            .and_then(|v| v.as_str())
            .expect("guest B receive token_hash field");
        assert_eq!(
            token_hash_b, token_hash_a,
            "token_hash must match between guest A success and guest B \
             already-claimed: a={token_hash_a}, b={token_hash_b}",
        );

        // ---- Phase 3: guest B's balance must NOT have grown. The
        // already-claimed path is a no-op on local proofs. (The
        // `balance` command is a known stub returning 0 today, so
        // this is more belt-and-braces than load-bearing — but if a
        // worker accidentally double-credited the receiver in the
        // failure path, this would catch it once aggregation lands.) ----
        let bal = guest_b
            .cmd()
            .arg("balance")
            .output()
            .expect("spawn agicash balance (guest B)");
        assert!(
            bal.status.success(),
            "balance failed for guest B: stderr={}",
            String::from_utf8_lossy(&bal.stderr),
        );
        let bal_json = parse_json("guest B balance", &bal);
        let entries = bal_json
            .as_array()
            .expect("balance must be a JSON array");
        for entry in entries {
            let bal_str = entry
                .get("balance")
                .and_then(|v| v.as_str())
                .expect("balance entry must have balance field");
            // Today this is "0" universally (stub). The instant real
            // aggregation lands, this assertion will turn red on the
            // mint account if double-credit ever leaks in via the
            // already-claimed path.
            assert_eq!(
                bal_str, "0",
                "guest B balance entry must be 0 after a no-op receive; \
                 got {entry}",
            );
        }
    }

    /// Same-guest second receive (control case) — proves the
    /// existing DB-unique-constraint short-circuit still emits the
    /// same `status=already-claimed` envelope as the cross-guest
    /// mint-spent path above. If these two ever diverge, callers
    /// can't write a single "is this a benign re-receive?" check.
    ///
    /// This is intentionally redundant with
    /// `receive::receive_token_increments_balance`'s second-receive
    /// assertion — keeping the two contract checks in the same file
    /// makes a later divergence between them visible at one glance.
    #[test]
    fn receive_same_guest_twice_short_circuits_via_db() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("receive-double-spend-same");
        let (token, _) = mint_test_token_blocking(32);
        session.spawn_guest_with_test_mint();

        let first = session
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive (first)");
        assert!(
            first.status.success(),
            "first receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&first.stdout),
            String::from_utf8_lossy(&first.stderr),
        );
        let first_json = parse_json("first receive (same guest)", &first);
        assert_eq!(
            first_json.get("status").and_then(|v| v.as_str()),
            Some("received"),
        );
        let token_hash_first = first_json
            .get("token_hash")
            .and_then(|v| v.as_str())
            .expect("token_hash on first receive")
            .to_string();

        let second = session
            .cmd()
            .args(["receive", "token", &token])
            .output()
            .expect("spawn agicash receive (second)");
        assert!(
            second.status.success(),
            "same-guest second receive must exit 0; stderr={}",
            String::from_utf8_lossy(&second.stderr),
        );
        let second_json = parse_json("second receive (same guest)", &second);
        assert_eq!(
            second_json.get("status").and_then(|v| v.as_str()),
            Some("already-claimed"),
            "same-guest second receive must short-circuit to \
             already-claimed; got {second_json}",
        );
        let token_hash_second = second_json
            .get("token_hash")
            .and_then(|v| v.as_str())
            .expect("token_hash on second receive");
        assert_eq!(
            token_hash_second, token_hash_first,
            "token_hash must be stable across both branches",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn receive_double_spend_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test receive_double_spend"
    );
}
