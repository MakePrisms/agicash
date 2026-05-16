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
    // "No session present" exit-code contract. Two paths exercise this test:
    //
    //   - On macOS dev machines the OS keyring is reachable, so the CLI picks
    //     `KeyringSessionStorage`; we pass a unique service id so it can't
    //     collide with a real session.
    //   - On Linux CI (no `dbus-daemon` + secret-service running), the
    //     keyring probe reports `BackendUnavailable` and the CLI falls
    //     through to `InMemorySessionStorage` (always available). The
    //     in-memory store starts empty, so `load()` returns `Ok(None)`.
    //
    // Either way the CLI must exit 3 with a `not-logged-in` JSON error.
    //
    // SUPABASE_URL etc. are stubbed so build_storage_deps succeeds; the
    // actual HTTP call is never made because the "not logged in" check fires
    // first on `load() -> None`.
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
    // stderr is line-oriented: zero or more `note: …` warnings (e.g. the
    // keyring-unavailable diagnostic emitted by the fallback chain on Linux
    // CI) followed by the structured JSON error body. Scan for the JSON
    // line rather than parsing the whole blob.
    let stderr = String::from_utf8(out.stderr).unwrap();
    let json_line = stderr
        .lines()
        .find(|l| l.trim_start().starts_with('{'))
        .unwrap_or_else(|| panic!("no JSON error line in stderr: {stderr}"));
    let parsed: serde_json::Value = serde_json::from_str(json_line.trim())
        .unwrap_or_else(|e| panic!("error line was not valid JSON ({e}): {json_line}"));
    assert_eq!(
        parsed.pointer("/error/code").and_then(|v| v.as_str()),
        Some("not-logged-in"),
        "unexpected error body: {parsed}",
    );
}
