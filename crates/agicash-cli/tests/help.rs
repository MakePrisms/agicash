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
fn version_subcommand_prints_version() {
    Command::cargo_bin("agicash")
        .unwrap()
        .arg("version")
        .assert()
        .success()
        .stdout(predicate::str::contains("0.1.0"));
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
fn account_list_without_session_exits_nonzero_and_prints_message() {
    // No session in keyring; use a unique keyring service so we never collide
    // with a real session. Even if SUPABASE_URL is missing, the "not logged in"
    // check is supposed to fire BEFORE build_storage_deps runs — but the auth
    // deps + storage deps are built up front. Provide dummy env values so
    // build_storage_deps succeeds; the actual HTTP call is never made because
    // load() returns None first.
    let pid = std::process::id();
    let service = format!("com.agicash.cli.test.{pid}.account-list");
    Command::cargo_bin("agicash")
        .unwrap()
        .env("AGICASH_KEYRING_SERVICE", &service)
        .env("SUPABASE_URL", "https://test.invalid")
        .env("SUPABASE_ANON_KEY", "test-anon-key")
        .env("OPENSECRET_BASE_URL", "https://does-not-resolve.invalid")
        .env("OPENSECRET_CLIENT_ID", "00000000-0000-0000-0000-000000000000")
        .args(["account", "list"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not logged in"));
}
