//! End-to-end `account list` test.
//!
//! Slice 3 cannot currently exercise the full end-to-end chain because of
//! two slice-2 / deployment gaps:
//!
//! 1. **`OpenSecret` session state is process-local.** Slice 2 persists only
//!    the refresh token in the keyring; the in-memory `OpenSecretClient`
//!    does not re-hydrate the access token from disk. After
//!    `agicash auth guest` returns and the process exits, a fresh process
//!    running `agicash account list` builds a new `OpenSecretClient` with
//!    no session state, and `generate_third_party_token` fails with
//!    "No refresh token available". This is a real gap in slice 2's
//!    session-storage seam — `OpenSecretTokenProvider` needs to hydrate
//!    the access token from `PersistedSession.refresh_token` before
//!    issuing third-party tokens.
//!
//! 2. **Local Supabase isn't wired to verify `OpenSecret` JWTs.** Even if
//!    the access token were available, the local Supabase's gotrue is not
//!    configured with the `OpenSecret` enclave's signing key (no
//!    `signing_keys_url` / `JWT_KEYS` in `supabase/config.toml`).
//!    Authenticated postgrest requests with `OpenSecret`-issued tokens get
//!    HTTP 401 PGRST301 "JWT cryptographic operation failed".
//!
//! Slice-3 storage-layer correctness IS exercised via real local Supabase
//! in `agicash-storage-supabase/tests/user_storage_integration.rs` (gated
//! behind `real-supabase-tests`), authenticating with the service role
//! key. End-to-end coverage waits on whichever later slice closes (1).
//!
//! Run: `cargo test -p agicash-cli --features real-supabase-tests,real-opensecret-tests --test account_list`

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

    /// Smoke-test: `auth guest` succeeds against the local OpenSecret enclave.
    /// We can't go further (see module docs).
    #[test]
    fn auth_guest_succeeds_against_local_enclave() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.account-list-e2e");

        let output = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(
            output.status.success(),
            "auth guest failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains("signed in as guest"), "stdout: {stdout}");

        // Cleanup the keyring entry.
        let _ = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "logout"])
            .output();
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
