//! E2E: `agicash send --token-version 3` emits a NUT-00 V3-format
//! token (`cashuA…` base64-JSON), and the default invocation continues
//! to emit a V4-format token (`cashuB…` base64-CBOR). Roadmap entry
//! **D6** in `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cell **"Send: token format v3 → MISSING"**.
//!
//! The `--token-version` flag is plumbed through `cli.rs::Send` →
//! `send.rs::cmd_send` → `encode_token`. The latter calls
//! `Token::to_v3_string()` for v3 and `Token::to_string()` (V4 CBOR)
//! otherwise. The unit test in `cli.rs::tests::parses_send_with_token_version_3`
//! covers the clap parse only; nothing today asserts that the resulting
//! token string is actually in the requested wire format. A silent
//! refactor that, say, dropped the `match token_version` arm so every
//! send produced v4 would slip through every other test in the suite.
//!
//! NUT-00 wire-format reminder (spec/00.md):
//!   - **V3** — `cashuA{base64_json}` — legacy, kept for receiver
//!     compatibility with older wallets that haven't shipped CBOR.
//!   - **V4** — `cashuB{base64_cbor}` — the modern compact format,
//!     default since cashu-ts 1.x and our CLI's default since slice 6.
//!
//! This test asserts the **prefix-byte invariant** (the cheapest
//! external signal of the wire format) for both paths:
//!   1. `agicash send 100 --token-version 3` produces a token starting
//!      with `cashuA`, and *not* `cashuB` or any other prefix.
//!   2. `agicash send 100` (default) produces a token starting with
//!      `cashuB`, demonstrating the flag actually flips the format
//!      rather than being a no-op.
//!   3. The v3 token round-trips through `cdk::nuts::Token::from_str`
//!      — proving the body isn't merely *labelled* v3 but actually
//!      decodes as v3. (`Token::from_str` accepts both v3 and v4
//!      strings.)
//!
//! Standard receive-via-faucet setup: mint a 300-sat deposit token via
//! `mint_test_token_via_testnut`, receive it into a fresh guest, then
//! send 100 sats twice (once per token version, into a separate guest
//! to avoid proof-selection state pollution between the two send
//! commands).
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test send_v3_format -- --nocapture

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

    /// Mint a deposit token, receive it into a fresh guest, then
    /// `send 100 --token-version 3` and assert the token is V3-formatted
    /// (`cashuA…`). Cross-check: the default `send 100` continues to
    /// emit V4 (`cashuB…`) so we can prove the flag actually flips the
    /// format rather than being a no-op.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn send_with_token_version_3_emits_cashu_a_prefix() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }

        // Two separate sessions: one per token-version sweep. Separate
        // guests avoid having the second `send` race the first for
        // proofs in the same wallet (also prevents the first send from
        // double-charging if the test panics mid-flight).
        let v3_session = TestSession::new("send-v3-format");
        let v4_session = TestSession::new("send-v3-format-control");

        // Mint deposit tokens up front so test failures inside the CLI
        // path don't waste time re-talking to testnut. 300 sats is
        // generous head-room over any input-fee surprise.
        let (deposit_v3, _) = mint_test_token_blocking(300);
        let (deposit_v4, _) = mint_test_token_blocking(300);

        // ---- V3 path: explicit --token-version 3. ----
        v3_session.spawn_guest_with_test_mint();
        let receive_v3 = v3_session
            .cmd()
            .args(["receive", "token", &deposit_v3])
            .output()
            .expect("spawn agicash receive token (v3 deposit)");
        assert!(
            receive_v3.status.success(),
            "v3 deposit receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive_v3.stdout),
            String::from_utf8_lossy(&receive_v3.stderr),
        );

        let send_v3 = v3_session
            .cmd()
            .args(["send", "100", "--token-version", "3"])
            .output()
            .expect("spawn agicash send --token-version 3");
        assert!(
            send_v3.status.success(),
            "send --token-version 3 failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&send_v3.stdout),
            String::from_utf8_lossy(&send_v3.stderr),
        );
        let send_v3_json = parse_json("send v3", &send_v3);
        assert_eq!(
            send_v3_json.get("status").and_then(|v| v.as_str()),
            Some("sent"),
            "v3 send envelope: {send_v3_json}",
        );
        let v3_token = send_v3_json
            .get("token")
            .and_then(|v| v.as_str())
            .expect("v3 send must include `token` field")
            .to_string();

        // Invariant 1: V3 starts with `cashuA`, NOT `cashuB`/`cashuC`/
        // anything else. NUT-00 reserves the next letter per major
        // version bump, so a regression that emitted a different prefix
        // would be a wire-format break visible to receivers.
        assert!(
            v3_token.starts_with("cashuA"),
            "expected V3 token to start with `cashuA…` (NUT-00 §0); \
             got `{}…`",
            &v3_token[..v3_token.len().min(8)],
        );
        assert!(
            !v3_token.starts_with("cashuB"),
            "V3 token must NOT start with the V4 prefix `cashuB`; \
             the --token-version flag may be ignored. token={v3_token}",
        );

        // Invariant 3: V3 token actually decodes as a `Token::TokenV3`
        // via CDK. `Token::from_str` accepts both V3 and V4 strings, so
        // matching on the enum variant proves the body is *valid V3
        // wire format* — not a mis-labelled V4 inside a `cashuA…`
        // prefix, not random base64.
        let parsed: cdk::nuts::Token = v3_token.parse().unwrap_or_else(|e| {
            panic!("V3 token failed to round-trip parse: {e}; token={v3_token}")
        });
        assert!(
            matches!(parsed, cdk::nuts::Token::TokenV3(_)),
            "expected Token::TokenV3 after parsing `cashuA…` token; \
             got a different variant. token={v3_token}",
        );

        // ---- V4 (default) path: same shape, opposite prefix. ----
        v4_session.spawn_guest_with_test_mint();
        let receive_v4 = v4_session
            .cmd()
            .args(["receive", "token", &deposit_v4])
            .output()
            .expect("spawn agicash receive token (v4 deposit)");
        assert!(
            receive_v4.status.success(),
            "v4 deposit receive failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&receive_v4.stdout),
            String::from_utf8_lossy(&receive_v4.stderr),
        );

        let send_v4 = v4_session
            .cmd()
            .args(["send", "100"]) // default = v4
            .output()
            .expect("spawn agicash send (default = v4)");
        assert!(
            send_v4.status.success(),
            "default send failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&send_v4.stdout),
            String::from_utf8_lossy(&send_v4.stderr),
        );
        let send_v4_json = parse_json("send v4", &send_v4);
        let v4_token = send_v4_json
            .get("token")
            .and_then(|v| v.as_str())
            .expect("v4 send must include `token` field")
            .to_string();

        // Invariant 2: default emits V4 (proves --token-version actually
        // toggles, isn't a default-everything-to-v3 bug).
        assert!(
            v4_token.starts_with("cashuB"),
            "expected default V4 token to start with `cashuB…`; \
             got `{}…`",
            &v4_token[..v4_token.len().min(8)],
        );
        assert!(
            !v4_token.starts_with("cashuA"),
            "default-version token must NOT start with the V3 prefix \
             `cashuA`; the default-value path may have regressed. \
             token={v4_token}",
        );

        // V4 token must round-trip into the V4 variant — same proof
        // shape as above, opposite direction.
        let parsed_v4: cdk::nuts::Token = v4_token.parse().unwrap_or_else(|e| {
            panic!("V4 token failed to round-trip parse: {e}; token={v4_token}")
        });
        assert!(
            matches!(parsed_v4, cdk::nuts::Token::TokenV4(_)),
            "expected Token::TokenV4 after parsing `cashuB…` token; \
             got a different variant. token={v4_token}",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn send_v3_format_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test send_v3_format"
    );
}
