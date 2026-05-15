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
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.account-list-e2e");

        let guest = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(
            guest.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&guest.stdout),
            String::from_utf8_lossy(&guest.stderr),
        );
        let guest_stdout = String::from_utf8_lossy(&guest.stdout).into_owned();
        let guest_json: serde_json::Value = serde_json::from_str(guest_stdout.trim())
            .unwrap_or_else(|e| panic!("auth guest stdout not JSON ({e}): {guest_stdout}"));
        assert_eq!(
            guest_json.get("status").and_then(|v| v.as_str()),
            Some("signed-in"),
            "unexpected auth guest body: {guest_json}",
        );

        let list = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["account", "list"])
            .output()
            .expect("spawn agicash account list");

        // Cleanup the keyring before any assertion so a panic doesn't leak
        // entries across runs.
        let _ = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "logout"])
            .output();

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
        let list_stdout = String::from_utf8_lossy(&list.stdout).into_owned();
        let list_json: serde_json::Value = serde_json::from_str(list_stdout.trim())
            .unwrap_or_else(|e| panic!("account list stdout not JSON ({e}): {list_stdout}"));
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
