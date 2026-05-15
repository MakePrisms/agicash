//! End-to-end `mint add` + `balance` test against the real CDK -> testnut mint
//! and the real Open Secret -> Supabase auth chain.
//!
//! Mirrors the wiring from `account_list.rs`; see that file for the
//! one-time local-dev setup steps.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test mint -- --nocapture

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use assert_cmd::Command;

    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    fn env_ready() -> bool {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").is_ok()
            && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
            && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
            && (std::env::var("SUPABASE_ANON_KEY").is_ok()
                || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
    }

    /// `auth guest` -> `mint add` -> `balance` end-to-end.
    /// Verifies the JSON shape and that the mint URL round-trips through
    /// the DB upsert.
    #[test]
    fn mint_add_then_balance_shows_zero() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.mint-add-then-balance");

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

        let add = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add");

        // Stage cleanup before assertions so a panic still clears the keyring.
        let cleanup = |service: &str| {
            let _ = Command::cargo_bin("agicash")
                .unwrap()
                .env("AGICASH_KEYRING_SERVICE", service)
                .args(["auth", "logout"])
                .output();
        };

        if !add.status.success() {
            cleanup(&service);
            panic!(
                "mint add failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&add.stdout),
                String::from_utf8_lossy(&add.stderr),
            );
        }
        let add_stdout = String::from_utf8_lossy(&add.stdout).into_owned();
        let add_json: serde_json::Value = serde_json::from_str(add_stdout.trim())
            .unwrap_or_else(|e| panic!("mint add stdout not JSON ({e}): {add_stdout}"));
        assert_eq!(
            add_json.get("status").and_then(|v| v.as_str()),
            Some("added"),
            "unexpected mint add body: {add_json}",
        );
        assert!(
            add_json.get("account_id").is_some(),
            "mint add output missing account_id: {add_json}"
        );

        let bal = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .arg("balance")
            .output()
            .expect("spawn agicash balance");

        cleanup(&service);

        assert!(
            bal.status.success(),
            "balance failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&bal.stdout),
            String::from_utf8_lossy(&bal.stderr),
        );
        let bal_stdout = String::from_utf8_lossy(&bal.stdout).into_owned();
        let bal_json: serde_json::Value = serde_json::from_str(bal_stdout.trim())
            .unwrap_or_else(|e| panic!("balance stdout not JSON ({e}): {bal_stdout}"));
        assert!(
            bal_json.is_array(),
            "expected balance stdout to be a JSON array, got: {bal_json}",
        );
        let arr = bal_json.as_array().unwrap();
        assert!(
            !arr.is_empty(),
            "balance should list at least the mint we just added; got: {bal_json}"
        );
        let first = &arr[0];
        assert_eq!(
            first.get("balance").and_then(|v| v.as_str()),
            Some("0"),
            "expected zero balance entry, got: {first}",
        );
    }

    #[test]
    fn mint_add_with_unreachable_url_fails_with_json_error() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.mint-add-unreachable");

        let guest = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        assert!(guest.status.success());

        let bad = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["mint", "add", "https://does-not-exist.invalid.example"])
            .output()
            .expect("spawn agicash mint add (bad URL)");

        // Cleanup before assertions.
        let _ = Command::cargo_bin("agicash")
            .unwrap()
            .env("AGICASH_KEYRING_SERVICE", &service)
            .args(["auth", "logout"])
            .output();

        assert!(
            !bad.status.success(),
            "mint add against bogus host should fail; stdout={}",
            String::from_utf8_lossy(&bad.stdout),
        );
        let stderr = String::from_utf8_lossy(&bad.stderr).into_owned();
        assert!(
            stderr.contains("\"code\":\"mint-unreachable\""),
            "expected mint-unreachable code on stderr, got: {stderr}",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn mint_tests_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test mint"
    );
}
