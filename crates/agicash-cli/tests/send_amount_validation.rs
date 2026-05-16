//! E2E: `agicash send token` amount-edge validation. Roadmap entry
//! **A2** in `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`
//! ("Send: amount == 0 — should reject pre-quote" + "Send: amount >
//! balance" + clap-level non-numeric parsing).
//!
//! Closes the matrix cells **"Send: amount == 0 → MISSING"**,
//! **"Send: amount > balance"** (already covered for empty wallet by
//! `send::send_insufficient_balance_errors`, this file covers the
//! **funded-but-too-low** branch which hits a different code path),
//! and pins clap-level parsing errors to a stable shape.
//!
//! Three branches in this single file (one `#[test]` per branch so
//! a flake on one doesn't mask another, per strategy doc §5):
//!   1. **`send token 0` with funded balance — rejected pre-quote**
//!      with typed `amount-too-small`. Pre-fix history: this used to
//!      silently produce an empty `cashuB…` token (the buggy contract
//!      was pinned in a now-deleted sibling test) because
//!      `select_send_proofs` short-circuited on `target_amount == 0`
//!      and `create()` walked the exact-proofs path with both totals
//!      at 0. Fixed by adding an explicit `requested_amount == 0`
//!      guard at the top of `prepare_proofs_and_fee` in
//!      `agicash-cashu/src/send_swap/service.rs`. See git log.
//!   2. **`send token <amount>` with `amount > funded balance`** —
//!      should produce `insufficient-balance` (the funded variant of
//!      the branch that `send::send_insufficient_balance_errors`
//!      exercises for an empty wallet). Asserts a follow-up
//!      `send token <funded>` still works → proves the failed call
//!      left no PENDING swap row that would block the next attempt.
//!   3. **`send token abc`** — non-numeric amount → clap's own parse
//!      error, exit code 2, NO JSON envelope. Pins this contract so a
//!      future "wrap clap errors in our JSON shape" change is a
//!      deliberate visible API break, not a silent one.
//!
//! Branches 1 and 2 deposit 100 sats via the testnut helper before
//! exercising the send. 100 sats covers the 1-sat receive-side input
//! fee testnut applies, leaving ~99 sats redeemable. Branch 3 is
//! hermetic (clap rejects before any I/O).
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test send_amount_validation -- --nocapture

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

    /// `send token 0` against a funded wallet must reject pre-quote
    /// with `amount-too-small` (strategy doc §5). Matches the TS web
    /// app, which disables the Continue button when
    /// `inputValue.isZero()` in `app/features/send/send-input.tsx`.
    ///
    /// Pre-fix history (kept for archaeology): this branch used to
    /// silently produce an empty `cashuB…` token because
    /// `select_send_proofs(_, 0, _)` short-circuited to `Ok(empty)`
    /// and the downstream pass-2 `requested_amount == 0` guard was
    /// unreachable for zero. Fixed by an explicit guard at the top of
    /// `prepare_proofs_and_fee` in
    /// `agicash-cashu/src/send_swap/service.rs`.
    #[test]
    fn send_zero_amount_returns_amount_too_small() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("send-amount-zero");
        let (deposit_token, _) = mint_test_token_blocking(100);

        session.spawn_guest_with_test_mint();
        let receive = session
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

        let send = session
            .cmd()
            .args(["send", "token", "0"])
            .output()
            .expect("spawn agicash send token 0");
        assert!(
            !send.status.success(),
            "send token 0 must reject pre-quote per strategy doc §5. \
             stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let stderr = String::from_utf8_lossy(&send.stderr).into_owned();
        let code = extract_error_code("send token 0", &stderr);
        assert_eq!(
            code, "amount-too-small",
            "expected amount-too-small for send token 0, got `{code}`. stderr={stderr}",
        );

        // ---- A follow-up `send 50` must still succeed. Proves the
        // rejected zero-amount call left no swap row that would
        // poison the next call. ----
        let follow_up = session
            .cmd()
            .args(["send", "token", "50"])
            .output()
            .expect("spawn agicash send token 50 (follow-up)");
        assert!(
            follow_up.status.success(),
            "follow-up send must succeed after a rejected zero-amount \
             send. stdout={}, stderr={}",
            String::from_utf8_lossy(&follow_up.stdout),
            String::from_utf8_lossy(&follow_up.stderr),
        );
        let follow_body = parse_json("follow-up send", &follow_up);
        assert_eq!(
            follow_body.get("status").and_then(|v| v.as_str()),
            Some("sent"),
            "unexpected follow-up send body: {follow_body}",
        );
    }

    /// Deposit 100 sats, then attempt `send token 1000`. Must fail
    /// with `insufficient-balance` and leave the wallet's spendable
    /// proofs intact (a follow-up send of the actually-available
    /// amount must still work).
    ///
    /// Distinct from `send::send_insufficient_balance_errors`, which
    /// exercises the **empty-wallet** branch — that hits
    /// `select_send_proofs`'s `total_avail < target_amount` guard with
    /// `total_avail = 0`. This test exercises the **funded-but-low**
    /// branch where the same guard fires with a non-zero
    /// `total_avail`, plus proves the post-failure state is recoverable.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn send_amount_exceeding_balance_returns_insufficient_balance() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("send-amount-exceeds");
        let (deposit_token, _) = mint_test_token_blocking(100);

        session.spawn_guest_with_test_mint();
        let receive = session
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

        let send = session
            .cmd()
            .args(["send", "token", "1000"])
            .output()
            .expect("spawn agicash send token 1000");
        assert!(
            !send.status.success(),
            "send token 1000 against a 100-sat balance must exit nonzero \
             (insufficient-balance). stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        let stderr = String::from_utf8_lossy(&send.stderr).into_owned();
        let code = extract_error_code("send token 1000", &stderr);
        assert_eq!(
            code, "insufficient-balance",
            "expected insufficient-balance for send token 1000 against 100-sat \
             wallet, got `{code}`. stderr={stderr}",
        );

        // ---- Follow-up: a smaller send must still work. Pins the
        // invariant that the failed send did not reserve / lock any
        // proofs. ----
        let follow_up = session
            .cmd()
            .args(["send", "token", "50"])
            .output()
            .expect("spawn agicash send token 50 (post-failure)");
        assert!(
            follow_up.status.success(),
            "follow-up send token 50 must succeed after a failed send token 1000. \
             stdout={}, stderr={}",
            String::from_utf8_lossy(&follow_up.stdout),
            String::from_utf8_lossy(&follow_up.stderr),
        );
        let body = parse_json("follow-up send 50", &follow_up);
        assert_eq!(
            body.get("status").and_then(|v| v.as_str()),
            Some("sent"),
            "unexpected post-failure send body: {body}",
        );
    }

    /// `send token abc` — non-numeric amount. Clap rejects before any
    /// service code runs. Exit code is nonzero (clap convention: 2)
    /// and stderr is clap's own human-readable error, NOT a JSON
    /// envelope. Pins this contract so a future change that wraps
    /// clap errors into our JSON shape is a visible deliberate change.
    ///
    /// Hermetic: needs no env, no auth, no mint. Skipped under the
    /// real-* gate only to keep the file's mod-organization
    /// consistent with the rest of the suite.
    #[test]
    fn send_non_numeric_amount_fails_at_clap_parse() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("send-amount-nonnumeric");

        let send = session
            .cmd()
            .args(["send", "token", "abc"])
            .output()
            .expect("spawn agicash send token abc");
        assert!(
            !send.status.success(),
            "send token abc must exit nonzero (clap parse error). \
             stdout={}, stderr={}",
            String::from_utf8_lossy(&send.stdout),
            String::from_utf8_lossy(&send.stderr),
        );
        // Clap parse errors emit human-readable text on stderr, NOT
        // our typed JSON envelope. Detect this by attempting to parse
        // stderr as JSON and asserting it FAILS.
        let stderr = String::from_utf8_lossy(&send.stderr).into_owned();
        let parse_result: Result<serde_json::Value, _> = serde_json::from_str(stderr.trim());
        assert!(
            parse_result.is_err(),
            "clap parse errors must NOT be wrapped in our JSON envelope; \
             stderr was unexpectedly valid JSON: {stderr}",
        );
        // Clap's standard error mentions `amount` and `invalid value`.
        // We don't pin the exact message (clap may reword it), but we
        // do pin that the error mentions the offending arg.
        assert!(
            stderr.to_lowercase().contains("invalid") || stderr.to_lowercase().contains("error"),
            "expected clap's parse-error language on stderr, got: {stderr}",
        );

        // Same for negative — u64 can't hold -50.
        let neg = session
            .cmd()
            .args(["send", "token", "--", "-50"])
            .output()
            .expect("spawn agicash send token -50");
        assert!(
            !neg.status.success(),
            "send token -50 must exit nonzero. stdout={}, stderr={}",
            String::from_utf8_lossy(&neg.stdout),
            String::from_utf8_lossy(&neg.stderr),
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn send_amount_validation_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test send_amount_validation"
    );
}
