//! Shared helpers for the `agicash-cli` integration test suite.
//!
//! Roadmap entry **E2** in
//! `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md` — extracts
//! the 7-fold duplicated setup that grew up across `account_list.rs`,
//! `mint.rs`, `receive.rs`, `receive_lightning.rs`, `send.rs`,
//! `auth_logout_idempotent.rs`, `receive_malformed.rs`, and
//! `contracts.rs`.
//!
//! Closes the structural smells §11 of the strategy doc flagged:
//!   1. helpers duplicated by copy-paste across e2e tests
//!   2. cleanup that's manual and panic-unsafe
//!
//! The most important primitive here is [`TestSession`] — an RAII guard
//! that owns a per-test keyring service id and runs `auth logout` on
//! drop, so panic paths can't leak Keychain entries.
//!
//! Tests opt in with:
//!
//! ```ignore
//! mod common;
//! use common::*;
//! ```
//!
//! and then:
//!
//! ```ignore
//! #[test]
//! fn my_e2e_test() {
//!     if !env_ready() { eprintln!("skipping: env vars not set"); return; }
//!     let session = TestSession::new("my-test-name");
//!     session.cmd().args(["auth", "guest"]).assert().success();
//!     // ... `session.cmd()` returns a fresh `Command` bound to the
//!     // per-test keyring service id; on drop `auth logout` runs.
//! }
//! ```
//!
//! Notes on what's NOT extracted:
//!   - The cargo feature gates (`#[cfg(all(feature = "real-…"))]`) stay
//!     in each test file because the feature combination differs (some
//!     tests need only `real-opensecret-tests`).
//!   - The `mod gated { … }` outer wrapper stays per-file for the same
//!     reason.
//!   - Hermetic tests (`help.rs`) don't use this module at all.

// Several helpers below are exported for the broader tests/ tree but
// not necessarily called by every consumer; the compiler can't see
// across the per-file `mod common;` declarations.
#![allow(dead_code)]
#![allow(clippy::doc_markdown)]

use assert_cmd::Command;

/// Public mint URL shared by every test that needs a real Cashu mint.
/// Centralised here so a future swap (local docker mint, env override)
/// touches one place.
pub const TEST_MINT_URL: &str = "https://testnut.cashu.space";

/// True if the env-var quartet needed by every full-stack e2e test
/// (OpenSecret base+client-id, Supabase URL+anon key) is set. Tries
/// `.env` via dotenvy as a side effect so test binaries pick up the
/// dev env without manual export.
///
/// Both `SUPABASE_URL`/`VITE_SUPABASE_URL` and
/// `SUPABASE_ANON_KEY`/`VITE_SUPABASE_ANON_KEY` are accepted to match
/// the local dev convention (the agicash web app uses VITE_-prefixed
/// vars; cli e2e tests look for either).
pub fn env_ready() -> bool {
    let _ = dotenvy::dotenv();
    std::env::var("OPENSECRET_BASE_URL").is_ok()
        && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
        && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
        && (std::env::var("SUPABASE_ANON_KEY").is_ok()
            || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
}

/// Narrower readiness check for tests that only need OpenSecret (e.g.
/// `auth_lifecycle.rs`'s session-restart test, which never talks to
/// Supabase or a mint).
pub fn env_ready_opensecret_only() -> bool {
    let _ = dotenvy::dotenv();
    std::env::var("OPENSECRET_BASE_URL").is_ok() && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
}

/// Per-test keyring service id. Combines pid + caller-supplied label so
/// concurrent test binaries (and any leftover state from a prior run)
/// don't collide. The exact format must stay stable — operators have
/// `security delete-generic-password` aliases keyed on the prefix.
#[must_use]
pub fn keyring_service(test_name: &str) -> String {
    let pid = std::process::id();
    format!("com.agicash.cli.test.{pid}.{test_name}")
}

/// Spawn a fresh `agicash` binary bound to `service`. Equivalent to
/// what every test was doing inline:
///
/// ```ignore
/// Command::cargo_bin("agicash")
///     .unwrap()
///     .env("AGICASH_KEYRING_SERVICE", service)
/// ```
#[must_use]
pub fn agicash_cmd(service: &str) -> Command {
    let mut c = Command::cargo_bin("agicash").expect("binary `agicash` not built");
    c.env("AGICASH_KEYRING_SERVICE", service);
    c
}

/// Best-effort `auth logout` for `service`. Always safe to call.
pub fn cleanup_keyring(service: &str) {
    let _ = agicash_cmd(service).args(["auth", "logout"]).output();
}

/// Parse the stdout bytes of an `agicash` invocation as JSON. Panics
/// with a labelled diagnostic on parse failure that includes stderr,
/// so a test failure points at the actual command output rather than a
/// generic serde error.
#[must_use]
pub fn parse_json(label: &str, out: &std::process::Output) -> serde_json::Value {
    let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
    serde_json::from_str(stdout.trim()).unwrap_or_else(|e| {
        panic!(
            "{label} stdout was not JSON ({e}). stdout={stdout}, stderr={}",
            String::from_utf8_lossy(&out.stderr),
        )
    })
}

/// Extract `error.code` from a JSON stderr body emitted by
/// `agicash-cli/src/main.rs::classify_*`. Panics with a clear
/// diagnostic when the shape is wrong, so a regression in error
/// envelope shape surfaces at the assertion site.
#[must_use]
pub fn extract_error_code(label: &str, stderr: &str) -> String {
    let parsed: serde_json::Value = serde_json::from_str(stderr.trim())
        .unwrap_or_else(|e| panic!("{label}: stderr was not JSON ({e}); stderr={stderr}"));
    parsed
        .get("error")
        .and_then(|e| e.get("code"))
        .and_then(|c| c.as_str())
        .map_or_else(
            || panic!("{label}: missing error.code in stderr JSON: {parsed}"),
            str::to_string,
        )
}

/// RAII guard around a per-test keyring service id. Runs
/// `cleanup_keyring(&service)` on drop, including on panic, so a
/// failing assertion can't leak a Keychain entry. Replaces the
/// `let cleanup = |…| …; cleanup(&service); panic!(…)` dance that
/// every pre-refactor test was repeating.
pub struct TestSession {
    service: String,
}

impl TestSession {
    /// Create a fresh session with the given label. The label is
    /// folded into the keyring service id so test failures point at
    /// the right slot.
    ///
    /// Does NOT call `auth guest` — the caller chooses whether the
    /// session starts logged-out (e.g. logout-idempotent tests) or
    /// logged-in (most flow tests).
    #[must_use]
    pub fn new(test_name: &str) -> Self {
        let service = keyring_service(test_name);
        // Defensive: ensure a clean slate even if a previous run with
        // the same pid+label leaked a session. Cheap, idempotent.
        let _ = agicash_cmd(&service).args(["auth", "logout"]).output();
        Self { service }
    }

    /// The keyring service id this session owns. Useful when a helper
    /// outside this file needs to spawn its own `Command`.
    #[must_use]
    pub fn service(&self) -> &str {
        &self.service
    }

    /// Spawn a fresh `agicash` Command bound to this session's keyring
    /// service id. Each call returns a new `Command` (assert_cmd's
    /// `Command` is single-use).
    #[must_use]
    pub fn cmd(&self) -> Command {
        agicash_cmd(&self.service)
    }

    /// Convenience: spawn the fresh guest user this session will
    /// operate against. Panics with the stdout+stderr of the failing
    /// call so the test failure points at the right command.
    pub fn spawn_guest(&self) {
        let out = self
            .cmd()
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(
            out.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        );
    }

    /// Convenience: `agicash mint add <TEST_MINT_URL>`. Same panic
    /// shape as `spawn_guest`.
    pub fn add_test_mint(&self) {
        let out = self
            .cmd()
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add");
        assert!(
            out.status.success(),
            "mint add failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        );
    }

    /// Convenience: full setup — fresh guest + testnut added. Used by
    /// every receive/send-style test.
    pub fn spawn_guest_with_test_mint(&self) {
        self.spawn_guest();
        self.add_test_mint();
    }
}

impl Drop for TestSession {
    fn drop(&mut self) {
        cleanup_keyring(&self.service);
    }
}

// ---------------------------------------------------------------------
// Mint helper
// ---------------------------------------------------------------------

/// Pre-mints a token against `testnut.cashu.space`'s fakewallet (which
/// auto-pays test invoices within a few seconds) and returns the
/// encoded `cashuB…` token string plus the amount. This is the
/// canonical seed for any test that needs a redeemable token without
/// running through the CLI's own mint-quote path.
///
/// Extracted from inline copies in `receive.rs` and `send.rs` (slice
/// 5 + 6 worker output).
///
/// Returns `(token_string, amount)`.
///
/// # Errors
/// Propagates any CDK / network / encoding error. Tests typically
/// `.expect("mint test token")` because failure here is an
/// infrastructure problem, not a flow problem.
pub async fn mint_test_token_via_testnut(
    amount: u64,
) -> Result<(String, u64), Box<dyn std::error::Error>> {
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
            description: Some("agicash e2e".into()),
            pubkey: None,
        })
        .await?;

    // testnut's fakewallet auto-pays test invoices after a short delay.
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

/// Blocking wrapper around [`mint_test_token_via_testnut`] for tests
/// that don't want to spin up their own tokio runtime. Spins up a
/// short-lived runtime, runs the future, drops the runtime.
#[must_use]
pub fn mint_test_token_blocking(amount: u64) -> (String, u64) {
    let runtime = tokio::runtime::Runtime::new().expect("build tokio runtime");
    let res = runtime
        .block_on(mint_test_token_via_testnut(amount))
        .expect("mint test token via testnut");
    drop(runtime);
    res
}
