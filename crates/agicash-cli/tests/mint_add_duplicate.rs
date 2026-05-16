//! E2E: `mint add` is **idempotent** for a URL the user has already
//! added. Roadmap entry **B1** in
//! `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cell **"Mint: add duplicate (idempotent) → MISSING"**.
//!
//! Today's `mint.rs` happy-path test only proves the first-time add
//! works. Nothing asserts what happens when the user calls
//! `mint add <url>` against a URL they already added — the strategy
//! doc explicitly flags this as a gap and §5 calls the behaviour
//! "should be idempotent". A regression that started inserting a
//! second `wallet.accounts` row per duplicate call would fragment
//! balances silently; one that surfaced a hard error would break
//! "save mint" UIs.
//!
//! Production behaviour (probed against the local stack):
//!   - First call: `{"status":"added","account_id":"<UUID>","mint_url":…}`,
//!     exit 0.
//!   - Second call (same user, same URL): the same JSON envelope with
//!     the **same account_id**, exit 0. Backed by the
//!     `wallet.upsert_user_with_accounts` Postgres function returning
//!     the existing row when the (user_id, mint_url) tuple already
//!     exists, plus `cmd_mint_add`'s filter in
//!     `agicash-cli/src/mint.rs:175` that picks the account matching
//!     the URL out of the returned set (idempotent by construction).
//!
//! This test pins both invariants:
//!   1. Second call exits 0 with `status="added"` (no typed-error
//!      regression, no silent success-with-different-id).
//!   2. `account_id` matches between the two calls (no duplicate row
//!      regression).
//!   3. `account list` still has exactly one Cashu account for this
//!      URL (no duplicate at the DB level — the visible-list view of
//!      invariant 2).
//!
//! If a future migration changes the contract — e.g. it should emit
//! `status="exists"` or surface a typed `mint-duplicate` error code —
//! this test should be updated *and* the canonical error-code catalog
//! in `contracts.rs` should grow a new entry. The strategy doc treats
//! that as a flow change requiring a coordinated update.
//!
//! Note on the prompt vs spec divergence: the worker brief asked for a
//! typed error assertion. That contradicts both the production code
//! and §5 of the strategy doc, which name the behaviour idempotent.
//! Asserting idempotent here matches the spec and the live stack; if
//! the team later decides duplicates should surface a typed error,
//! flip the assertions and add the code to `ALLOWED_ERROR_CODES`.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test mint_add_duplicate -- --nocapture

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

    /// Call `mint add <testnut>` twice on the same guest, assert the
    /// second call is idempotent (same account_id, same status, exit
    /// 0) and that `account list` shows exactly one Cashu account for
    /// the URL.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn mint_add_is_idempotent_for_same_url() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let session = TestSession::new("mint-add-duplicate");
        session.spawn_guest();

        // ---- First call: should produce a brand-new account row. ----
        let first = session
            .cmd()
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add (first)");
        assert!(
            first.status.success(),
            "first mint add failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&first.stdout),
            String::from_utf8_lossy(&first.stderr),
        );
        let first_json = parse_json("mint add (first)", &first);
        assert_eq!(
            first_json.get("status").and_then(|v| v.as_str()),
            Some("added"),
            "unexpected first mint add body: {first_json}",
        );
        let first_id = first_json
            .get("account_id")
            .and_then(|v| v.as_str())
            .expect("account_id field on first add")
            .to_string();
        assert!(
            uuid::Uuid::parse_str(&first_id).is_ok(),
            "expected UUID account_id, got `{first_id}`",
        );
        let first_url = first_json
            .get("mint_url")
            .and_then(|v| v.as_str())
            .expect("mint_url field on first add")
            .to_string();
        assert_eq!(
            first_url.trim_end_matches('/'),
            TEST_MINT_URL.trim_end_matches('/'),
            "first add returned wrong mint_url",
        );

        // ---- Second call against the same URL: must be idempotent. ----
        let second = session
            .cmd()
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add (second)");
        assert!(
            second.status.success(),
            "second mint add must exit 0 (idempotent); \
             stdout={}, stderr={}",
            String::from_utf8_lossy(&second.stdout),
            String::from_utf8_lossy(&second.stderr),
        );
        let second_json = parse_json("mint add (second)", &second);
        assert_eq!(
            second_json.get("status").and_then(|v| v.as_str()),
            Some("added"),
            "second mint add must return the same `status=added` \
             envelope as the first (not a typed error, not a silent \
             success with different shape); got {second_json}",
        );
        let second_id = second_json
            .get("account_id")
            .and_then(|v| v.as_str())
            .expect("account_id field on second add")
            .to_string();
        assert_eq!(
            second_id, first_id,
            "idempotency invariant: second mint add must return the \
             SAME account_id as the first call. Different IDs mean a \
             duplicate row was inserted, fragmenting future balance \
             aggregation. first={first_id}, second={second_id}",
        );
        let second_url = second_json
            .get("mint_url")
            .and_then(|v| v.as_str())
            .expect("mint_url field on second add");
        assert_eq!(
            second_url.trim_end_matches('/'),
            TEST_MINT_URL.trim_end_matches('/'),
            "second add returned a different mint_url than requested",
        );

        // ---- Visible-list view: account list must show exactly ONE
        // Cashu account for this URL, not two. ----
        let list = session
            .cmd()
            .args(["account", "list"])
            .output()
            .expect("spawn agicash account list");
        assert!(
            list.status.success(),
            "account list failed: stdout={}, stderr={}",
            String::from_utf8_lossy(&list.stdout),
            String::from_utf8_lossy(&list.stderr),
        );
        let list_json = parse_json("account list", &list);
        let accounts = list_json
            .as_array()
            .expect("account list must be a JSON array");

        // Count accounts whose `details.mint_url` matches TEST_MINT_URL.
        // Tolerant of trailing-slash normalization differences (the
        // production code in mint.rs:182 already trims trailing slashes).
        let matching: Vec<&serde_json::Value> = accounts
            .iter()
            .filter(|a| {
                let purpose = a.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if purpose != "cashu" {
                    return false;
                }
                a.get("details")
                    .and_then(|d| d.get("mint_url"))
                    .and_then(|u| u.as_str())
                    .is_some_and(|s| s.trim_end_matches('/') == TEST_MINT_URL.trim_end_matches('/'))
            })
            .collect();
        assert_eq!(
            matching.len(),
            1,
            "expected exactly ONE Cashu account for `{TEST_MINT_URL}`, \
             found {} in: {list_json}",
            matching.len(),
        );
        let listed_id = matching[0]
            .get("id")
            .and_then(|v| v.as_str())
            .expect("listed account missing `id`");
        assert_eq!(
            listed_id, first_id,
            "account list returned a different id ({listed_id}) than \
             mint add reported ({first_id})",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn mint_add_duplicate_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test mint_add_duplicate"
    );
}
