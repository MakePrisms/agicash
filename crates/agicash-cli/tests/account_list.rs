//! End-to-end `account list` test against the real `OpenSecret` → Supabase
//! auth chain.
//!
//! Auth flow exercised:
//!     1. `agicash auth guest` registers a guest user against the local
//!        `OpenSecret` enclave (`OPENSECRET_BASE_URL`) and stores the refresh
//!        token in the keyring.
//!     2. A fresh process runs `agicash account list`. `composition::
//!        rehydrate_session()` reads the refresh token from the keyring,
//!        runs `refresh_token()` on the in-memory SDK, then
//!        `OpenSecretTokenProvider::get_jwt()` mints a third-party JWT.
//!     3. `SupabaseStorage` attaches that JWT as the `Authorization`
//!        bearer; local Supabase verifies it with HS256 against the JWT
//!        secret seeded into the `THIRD_PARTY_JWT_SECRET` row in
//!        `org_project_secrets` (matches Supabase's `GOTRUE_JWT_SECRET`).
//!
//! Local-dev wiring (one-time per machine):
//!     - opensecret enclave: `nix develop -c cargo run --bin opensecret`
//!       (binds `127.0.0.1:3999` via the local CHANGES.md patch).
//!     - seed the per-project JWT secret to match Supabase's:
//!         `cd ~/opensecret && PROJECT_ID=<maple-id> \
//!            SECRET='<value of supabase JWT_SECRET>' \
//!            nix develop -c cargo run --bin seed-project-secret`
//!     - local Supabase: `bunx supabase start` (from agicash root).
//!
//! Run: `cargo test -p agicash-cli \
//!         --features real-supabase-tests,real-opensecret-tests \
//!         --test account_list -- --nocapture`

#[cfg(all(feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod common;

#[cfg(all(feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod gated {
    use super::common::*;

    /// `auth guest` → `account list` end-to-end, no service-role shortcut.
    /// A fresh process for `account list` exercises the keyring-rehydration
    /// path (see `composition::rehydrate_session`).
    #[test]
    fn account_list_e2e_against_real_auth_chain() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        // Per-test keyring service so concurrent runs (and any leftover
        // session from a previous run) don't collide.
        let session = TestSession::new("account-list-e2e");

        let guest = session
            .cmd()
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(
            guest.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&guest.stdout),
            String::from_utf8_lossy(&guest.stderr),
        );
        let guest_json = parse_json("auth guest", &guest);
        assert_eq!(
            guest_json.get("status").and_then(|v| v.as_str()),
            Some("signed-in"),
            "unexpected auth guest body: {guest_json}",
        );

        let list = session
            .cmd()
            .args(["account", "list"])
            .output()
            .expect("spawn agicash account list");

        // TestSession::Drop cleans up the keyring on panic, so no
        // manual stage-before-assert dance is needed.
        assert!(
            list.status.success(),
            "account list failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&list.stdout),
            String::from_utf8_lossy(&list.stderr),
        );
        // A freshly-minted guest user has no accounts yet, so the expected
        // stdout is a JSON array (typically empty). The point of this test
        // is that we reached postgrest with a valid JWT (HTTP 200, exit 0)
        // and that stdout parses as JSON — not that any specific row was
        // returned.
        let list_json = parse_json("account list", &list);
        assert!(
            list_json.is_array(),
            "expected account list stdout to be a JSON array, got: {list_json}",
        );
    }
}

#[cfg(not(all(feature = "real-supabase-tests", feature = "real-opensecret-tests")))]
#[test]
fn account_list_e2e_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-supabase-tests,real-opensecret-tests --test account_list"
    );
}
