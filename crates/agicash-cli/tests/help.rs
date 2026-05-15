use assert_cmd::Command;
use predicates::prelude::*;

#[test]
fn help_flag_prints_usage_and_exits_zero() {
    Command::cargo_bin("agicash")
        .unwrap()
        .arg("--help")
        .assert()
        .success()
        .stdout(predicate::str::contains("Agicash CLI"))
        .stdout(predicate::str::contains("Usage: agicash"));
}

#[test]
fn version_subcommand_prints_version_as_json() {
    let out = Command::cargo_bin("agicash")
        .unwrap()
        .arg("version")
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let s = String::from_utf8(out).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(s.trim())
        .unwrap_or_else(|e| panic!("version stdout was not valid JSON ({e}): {s}"));
    assert_eq!(
        parsed.get("version").and_then(|v| v.as_str()),
        Some(env!("CARGO_PKG_VERSION")),
    );
}

#[test]
fn json_flag_no_longer_recognized() {
    // `--json` was a parsed-but-unused flag; JSON is now the only output and
    // the flag has been removed. clap should reject it.
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["--json", "version"])
        .assert()
        .failure();
}

#[test]
fn unknown_subcommand_exits_nonzero() {
    Command::cargo_bin("agicash")
        .unwrap()
        .arg("nonsense-subcommand")
        .assert()
        .failure();
}

#[test]
fn auth_guest_help_lists_command() {
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["auth", "guest", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("guest"));
}

#[test]
fn auth_login_help_requires_email_arg() {
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["auth", "login", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("email"));
}

#[test]
fn account_help_lists_list_subcommand() {
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["account", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("list"));
}

#[test]
fn account_list_help_works() {
    Command::cargo_bin("agicash")
        .unwrap()
        .args(["account", "list", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("List"));
}

#[test]
fn account_list_without_session_exits_three_and_emits_json_error() {
    // No session in keyring; use a unique keyring service so we never collide
    // with a real session. Even if SUPABASE_URL is missing, the "not logged in"
    // check is supposed to fire BEFORE build_storage_deps runs — but the auth
    // deps + storage deps are built up front. Provide dummy env values so
    // build_storage_deps succeeds; the actual HTTP call is never made because
    // load() returns None first.
    let pid = std::process::id();
    let service = format!("com.agicash.cli.test.{pid}.account-list");
    let out = Command::cargo_bin("agicash")
        .unwrap()
        .env("AGICASH_KEYRING_SERVICE", &service)
        .env("SUPABASE_URL", "https://test.invalid")
        .env("SUPABASE_ANON_KEY", "test-anon-key")
        .env("OPENSECRET_BASE_URL", "https://does-not-resolve.invalid")
        .env(
            "OPENSECRET_CLIENT_ID",
            "00000000-0000-0000-0000-000000000000",
        )
        .args(["account", "list"])
        .assert()
        .failure()
        .get_output()
        .clone();

    assert_eq!(
        out.status.code(),
        Some(3),
        "expected exit 3 for not-logged-in, got {:?}; stderr={}",
        out.status.code(),
        String::from_utf8_lossy(&out.stderr),
    );
    let stderr = String::from_utf8(out.stderr).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(stderr.trim())
        .unwrap_or_else(|e| panic!("stderr was not valid JSON ({e}): {stderr}"));
    assert_eq!(
        parsed.pointer("/error/code").and_then(|v| v.as_str()),
        Some("not-logged-in"),
        "unexpected error body: {parsed}",
    );
}
