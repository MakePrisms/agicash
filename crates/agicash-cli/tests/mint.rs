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
mod common;

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
mod gated {
    use super::common::*;

    /// `auth guest` -> `mint add` -> `balance` end-to-end.
    /// Verifies the JSON shape and that the mint URL round-trips through
    /// the DB upsert.
    #[test]
    fn mint_add_then_balance_shows_zero() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("mint-add-then-balance");
        session.spawn_guest();

        let add = session
            .cmd()
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add");
        assert!(
            add.status.success(),
            "mint add failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&add.stdout),
            String::from_utf8_lossy(&add.stderr),
        );
        let add_json = parse_json("mint add", &add);
        assert_eq!(
            add_json.get("status").and_then(|v| v.as_str()),
            Some("added"),
            "unexpected mint add body: {add_json}",
        );
        assert!(
            add_json.get("account_id").is_some(),
            "mint add output missing account_id: {add_json}"
        );

        let bal = session
            .cmd()
            .arg("balance")
            .output()
            .expect("spawn agicash balance");
        assert!(
            bal.status.success(),
            "balance failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&bal.stdout),
            String::from_utf8_lossy(&bal.stderr),
        );
        let bal_json = parse_json("balance", &bal);
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
        let session = TestSession::new("mint-add-unreachable");
        session.spawn_guest();

        let bad = session
            .cmd()
            .args(["mint", "add", "https://does-not-exist.invalid.example"])
            .output()
            .expect("spawn agicash mint add (bad URL)");

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
