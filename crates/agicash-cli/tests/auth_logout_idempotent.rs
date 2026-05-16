//! E2E: `auth logout` is idempotent. Roadmap entry **A1** in
//! `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cell **"Auth: logout when logged out → MISSING"**.
//!
//! Today's `auth_lifecycle.rs` covers logout-when-signed-in. The
//! production code path (`agicash-cli/src/auth.rs::cmd_logout`) early
//! returns `{"status":"not-logged-in"}` when the keyring is empty, but no
//! test asserts on that. A regression that turned the no-session branch
//! into an error (or worse, a panic) would slip through CI today.
//!
//! This test exercises the empty-keyring branch first, then proves a
//! real signed-in → signed-out lifecycle still works in the same fresh
//! keyring service. Two assertions in one test by design — they share
//! all the fixture setup (keyring service id, env-readiness check).
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test auth_logout_idempotent -- --nocapture
//!
//! Note: this test only requires `real-opensecret-tests` (no Supabase or
//! mint hits). The full triple-feature gate matches the canonical
//! invocation pattern used by every other e2e test in this crate so the
//! `cargo test … --features real-mint,real-supabase,real-opensecret`
//! run picks it up alongside the rest.

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

    /// `auth logout` against an empty keyring exits 0 and emits
    /// `{"status":"not-logged-in"}`. A second call returns the same.
    /// Then a fresh `auth guest` → `auth logout` emits
    /// `{"status":"signed-out"}` and another `auth logout` reverts to
    /// `not-logged-in`. Proves the command is fully idempotent in both
    /// directions.
    #[test]
    fn logout_with_no_session_returns_not_logged_in() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }

        // TestSession::new performs a defensive `auth logout` before
        // handing us the service id, so we're guaranteed to observe the
        // no-session branch in phase 1.
        let session = TestSession::new("auth-logout-idempotent");

        // ---- Phase 1: logout from a guaranteed-empty keyring. ----
        let first = session
            .cmd()
            .args(["auth", "logout"])
            .output()
            .expect("spawn agicash auth logout (no session)");
        assert!(
            first.status.success(),
            "logout from empty keyring must exit 0; stderr={}",
            String::from_utf8_lossy(&first.stderr),
        );
        let first_json = parse_json("auth logout (empty)", &first);
        assert_eq!(
            first_json.get("status").and_then(|v| v.as_str()),
            Some("not-logged-in"),
            "expected status=not-logged-in on empty keyring; got {first_json}",
        );

        // ---- Phase 2: a second logout call must observe the same. ----
        let second = session
            .cmd()
            .args(["auth", "logout"])
            .output()
            .expect("spawn agicash auth logout (no session, repeat)");
        assert!(second.status.success(), "second logout must also exit 0");
        let second_json = parse_json("auth logout (empty repeat)", &second);
        assert_eq!(
            second_json.get("status").and_then(|v| v.as_str()),
            Some("not-logged-in"),
            "second logout with empty keyring should still report not-logged-in; got {second_json}",
        );

        // ---- Phase 3: real guest → logout reports `signed-out`. ----
        session.spawn_guest();

        let signed_out = session
            .cmd()
            .args(["auth", "logout"])
            .output()
            .expect("spawn agicash auth logout (signed-in)");
        assert!(
            signed_out.status.success(),
            "logout while signed-in must exit 0; stderr={}",
            String::from_utf8_lossy(&signed_out.stderr),
        );
        let signed_out_json = parse_json("auth logout (signed-in)", &signed_out);
        assert_eq!(
            signed_out_json.get("status").and_then(|v| v.as_str()),
            Some("signed-out"),
            "expected status=signed-out after a real session; got {signed_out_json}",
        );

        // ---- Phase 4: third logout reverts to not-logged-in. ----
        let final_logout = session
            .cmd()
            .args(["auth", "logout"])
            .output()
            .expect("spawn agicash auth logout (post-clear)");
        assert!(
            final_logout.status.success(),
            "post-clear logout must exit 0"
        );
        let final_json = parse_json("auth logout (post-clear)", &final_logout);
        assert_eq!(
            final_json.get("status").and_then(|v| v.as_str()),
            Some("not-logged-in"),
            "after a successful sign-out, the next logout should report not-logged-in; got {final_json}",
        );
        // session drops → cleanup_keyring runs.
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn auth_logout_idempotent_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test auth_logout_idempotent"
    );
}
