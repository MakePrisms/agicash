//! End-to-end auth lifecycle against the real Open Secret dev environment.
//!
//! Gated behind the `real-opensecret-tests` cargo feature so plain
//! `cargo test` stays hermetic. To run:
//!
//! ```
//! cargo test -p agicash-cli --features real-opensecret-tests --test auth_lifecycle -- --nocapture
//! ```
//!
//! Env vars are loaded from .env (the same way the CLI binary loads them):
//! - `OPENSECRET_BASE_URL`
//! - `OPENSECRET_CLIENT_ID`

#[cfg(feature = "real-opensecret-tests")]
mod common;

#[cfg(not(feature = "real-opensecret-tests"))]
#[test]
fn auth_lifecycle_skipped_without_feature() {
    eprintln!(
        "skipping real-opensecret-tests; run with: \
         cargo test -p agicash-cli --features real-opensecret-tests"
    );
}

#[cfg(feature = "real-opensecret-tests")]
#[test]
fn session_survives_process_restart() {
    use common::{env_ready_opensecret_only, parse_json, TestSession};

    if !env_ready_opensecret_only() {
        eprintln!("skipping: OPENSECRET_BASE_URL and/or OPENSECRET_CLIENT_ID not set");
        return;
    }

    // Use a unique keyring service per test run so we don't collide with
    // the developer's normal CLI state and so tests are isolated. The
    // RAII session also clears the keyring on drop / panic.
    let session = TestSession::new("auth-lifecycle");

    // Step 1: register a guest user. Each `cmd()` returns a fresh
    // `assert_cmd::Command`, so a separate process picks up the same
    // keyring entry — exactly the rehydration path under test.
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
    assert_eq!(
        guest_json.get("guest").and_then(serde_json::Value::as_bool),
        Some(true),
        "expected guest=true: {guest_json}",
    );
    let guest_uuid = guest_json
        .get("user_id")
        .and_then(|v| v.as_str())
        .expect("user_id in auth guest output")
        .to_string();
    assert!(
        uuid::Uuid::parse_str(&guest_uuid).is_ok(),
        "expected guest uuid, got: {guest_uuid}"
    );

    // Step 2: fresh process, status must show the same uuid.
    let status = session
        .cmd()
        .args(["auth", "status"])
        .output()
        .expect("spawn agicash auth status");
    assert!(status.status.success(), "auth status (logged in) failed");
    let status_json = parse_json("auth status (logged in)", &status);
    assert_eq!(
        status_json
            .get("logged_in")
            .and_then(serde_json::Value::as_bool),
        Some(true),
        "expected logged_in=true: {status_json}",
    );
    assert_eq!(
        status_json.get("user_id").and_then(|v| v.as_str()),
        Some(guest_uuid.as_str()),
        "unexpected user_id in status: {status_json}",
    );

    // Step 3: logout (fresh process).
    let logout = session
        .cmd()
        .args(["auth", "logout"])
        .output()
        .expect("spawn agicash auth logout");
    assert!(logout.status.success(), "auth logout failed");
    let logout_json = parse_json("auth logout", &logout);
    assert_eq!(
        logout_json.get("status").and_then(|v| v.as_str()),
        Some("signed-out"),
        "unexpected logout body: {logout_json}",
    );

    // Step 4: fresh process, status must report logged out.
    let status2 = session
        .cmd()
        .args(["auth", "status"])
        .output()
        .expect("spawn agicash auth status (post-logout)");
    assert!(status2.status.success());
    let status_json2 = parse_json("auth status (post-logout)", &status2);
    assert_eq!(
        status_json2
            .get("logged_in")
            .and_then(serde_json::Value::as_bool),
        Some(false),
        "expected logged_in=false after logout: {status_json2}",
    );
    assert!(
        status_json2.get("user_id").is_none(),
        "expected no user_id when logged out: {status_json2}",
    );
}
