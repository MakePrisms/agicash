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
use predicates::prelude::*;

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
    // cmd_guest output: "signed in as guest <uuid>"
    let guest_uuid = guest_stdout
        .split_whitespace()
        .last()
        .expect("guest stdout has uuid")
        .to_string();
    assert!(
        uuid::Uuid::parse_str(&guest_uuid).is_ok(),
        "expected guest uuid, got: {guest_stdout}"
    );

    // Step 2: fresh process, status must show the same uuid.
    make_cmd()
        .args(["auth", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("logged in"))
        .stdout(predicate::str::contains(&guest_uuid));

    // Step 3: logout (fresh process).
    make_cmd().args(["auth", "logout"]).assert().success();

    // Step 4: fresh process, status must report logged out.
    make_cmd()
        .args(["auth", "status"])
        .assert()
        .success()
        .stdout(predicate::str::contains("not logged in"));
}
