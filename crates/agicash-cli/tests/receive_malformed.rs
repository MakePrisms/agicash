//! E2E: `agicash receive token <garbage>` rejects malformed token strings
//! with the `invalid-token` JSON error code on stderr. Roadmap entry
//! **D1** in `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cell **"Receive: malformed token → MISSING e2e
//! (unit covers parse)"**.
//!
//! `agicash-cashu`'s receive_swap unit tests cover the parser at the
//! type level. Nothing today proves that a malformed string flowing
//! through the CLI surfaces as the contract-stable
//! `{"code":"invalid-token"}` error rather than e.g. a panic, a
//! stack-trace, or a different code from a deeper layer. The error
//! mapping lives in `agicash-cli/src/main.rs:72`
//! (`ReceiveCmdError::InvalidToken => ("invalid-token", 1)`); a
//! refactor that drops the early
//! `ReceiveSwapError::TokenParse → InvalidToken` mapping in
//! `receive.rs` would change the wire-visible code without breaking
//! anything cargo currently asserts on.
//!
//! Three distinct malformed inputs are checked as separate cases — they
//! exercise different parser branches:
//!   1. obviously not a token at all (`"not-a-token"`) — early reject
//!   2. wrong prefix (`"cashuZinvalid"`) — fails the version-byte branch
//!   3. correct prefix but undecodable body (`"cashuBnotbase64"`) —
//!      fails the base64/CBOR decode path
//!
//! Each must exit nonzero AND emit `"code":"invalid-token"` on stderr.
//! No mint or supabase calls are exercised because the parser fails
//! before the auth chain gets a chance to talk to the mint.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test receive_malformed -- --nocapture

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use assert_cmd::Command;

    fn env_ready() -> bool {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").is_ok()
            && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
            && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
            && (std::env::var("SUPABASE_ANON_KEY").is_ok()
                || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
    }

    fn cmd(service: &str) -> Command {
        let mut c = Command::cargo_bin("agicash").unwrap();
        c.env("AGICASH_KEYRING_SERVICE", service);
        c
    }

    fn cleanup(service: &str) {
        let _ = cmd(service).args(["auth", "logout"]).output();
    }

    /// All three malformed-token inputs in one test fn — they share a
    /// guest user and the env-readiness check. Per the strategy doc §5,
    /// edges live as **distinct** cases so a single flake doesn't hide
    /// other flakes; here the three inputs are verified inline with
    /// independent assertion sites and a final summary if any failed.
    #[test]
    fn malformed_tokens_emit_invalid_token_error() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.receive-malformed");

        // Need a signed-in user so we hit the parse path (rather than
        // the not-logged-in early return). A guest is the cheapest way.
        let guest = cmd(&service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        if !guest.status.success() {
            cleanup(&service);
            panic!(
                "auth guest failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&guest.stdout),
                String::from_utf8_lossy(&guest.stderr),
            );
        }

        // Inputs that should all fail parsing in different parser branches.
        // Pure ASCII so there's no stdout/stderr encoding ambiguity.
        let cases: &[(&str, &str)] = &[
            ("plain-text", "not-a-token"),
            ("wrong-prefix", "cashuZsomethinginvalid"),
            ("good-prefix-bad-body", "cashuBnot-actually-base64-or-cbor!!"),
        ];

        let mut failures: Vec<String> = Vec::new();

        for (label, token) in cases {
            let out = cmd(&service)
                .args(["receive", "token", token])
                .output()
                .unwrap_or_else(|e| panic!("spawn agicash receive token ({label}): {e}"));

            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();
            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();

            if out.status.success() {
                failures.push(format!(
                    "[{label}] expected nonzero exit; stdout={stdout}, stderr={stderr}",
                ));
                continue;
            }
            if !stderr.contains("\"code\":\"invalid-token\"") {
                failures.push(format!(
                    "[{label}] expected \"code\":\"invalid-token\" on stderr; \
                     got stdout={stdout}, stderr={stderr}",
                ));
            }
        }

        // Cleanup before any assertion that could panic.
        cleanup(&service);

        assert!(
            failures.is_empty(),
            "malformed-token cases failed:\n  - {}",
            failures.join("\n  - "),
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn receive_malformed_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test receive_malformed"
    );
}
