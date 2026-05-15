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
use assert_cmd::Command;

#[cfg(feature = "real-opensecret-tests")]
fn env_ready() -> bool {
    let _ = dotenvy::dotenv();
    std::env::var("OPENSECRET_BASE_URL").is_ok() && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
}

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
    if !env_ready() {
        eprintln!("skipping: OPENSECRET_BASE_URL and/or OPENSECRET_CLIENT_ID not set");
        return;
    }

    // Use a unique keyring service per test run so we don't collide with the
    // developer's normal CLI state and so tests are isolated.
    let pid = std::process::id();
    let service = format!("com.agicash.cli.test.{pid}");

    // Helper: each call spawns a *fresh* process. assert_cmd::Command does
    // not share state with the test process beyond env/args, which is
    // exactly what we want — the only carrier is the OS keyring entry.
    let make_cmd = || {
        let mut c = Command::cargo_bin("agicash").unwrap();
        c.env("AGICASH_KEYRING_SERVICE", &service);
        c
    };

    // Step 1: register a guest user.
    let guest_out = make_cmd()
        .args(["auth", "guest"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let guest_stdout = String::from_utf8(guest_out).unwrap();
    let guest_json: serde_json::Value = serde_json::from_str(guest_stdout.trim())
        .unwrap_or_else(|e| panic!("auth guest stdout not JSON ({e}): {guest_stdout}"));
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
    let status_out = make_cmd()
        .args(["auth", "status"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let status_stdout = String::from_utf8(status_out).unwrap();
    let status_json: serde_json::Value = serde_json::from_str(status_stdout.trim())
        .unwrap_or_else(|e| panic!("auth status stdout not JSON ({e}): {status_stdout}"));
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
    let logout_out = make_cmd()
        .args(["auth", "logout"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let logout_stdout = String::from_utf8(logout_out).unwrap();
    let logout_json: serde_json::Value = serde_json::from_str(logout_stdout.trim())
        .unwrap_or_else(|e| panic!("auth logout stdout not JSON ({e}): {logout_stdout}"));
    assert_eq!(
        logout_json.get("status").and_then(|v| v.as_str()),
        Some("signed-out"),
        "unexpected logout body: {logout_json}",
    );

    // Step 4: fresh process, status must report logged out.
    let status_out2 = make_cmd()
        .args(["auth", "status"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let status_stdout2 = String::from_utf8(status_out2).unwrap();
    let status_json2: serde_json::Value = serde_json::from_str(status_stdout2.trim())
        .unwrap_or_else(|e| panic!("auth status stdout not JSON ({e}): {status_stdout2}"));
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
