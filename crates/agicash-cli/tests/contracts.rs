//! E2E: cross-cutting **contract** test for the `agicash` CLI surface.
//! Roadmap entry **F1** in
//! `docs/superpowers/specs/2026-05-15-e2e-test-strategy.md`.
//!
//! Closes the matrix cells **"Contracts: JSON output stability"** and
//! **"Contracts: error code allow-list"** — both currently `(P)` in the
//! audit (each test asserts on its own one error string in isolation,
//! no central catalog).
//!
//! The strategy doc §11 calls out the underlying smell: a refactor that
//! changes `("invalid-token", 1)` to `("invalidToken", 1)` (or merges
//! two codes, or drops one entirely) would slip through every other
//! test in this crate because each only asserts on its own single
//! string. This file is the central catalog: every error code emitted
//! by `agicash-cli/src/main.rs::classify_*` is enumerated here, every
//! success path is checked for valid JSON shape, and the test fails
//! fast with a clear "expected vs got" diff when a code drifts.
//!
//! Two complementary checks:
//!
//!   1. **JSON output stability** — for every success path we exercise
//!      (`version`, `auth status`, `auth guest`, `auth logout`,
//!      `account list`, `mint add`, `balance`), stdout MUST parse as
//!      JSON. No bare strings, no human-formatted text, no logging on
//!      stdout. (Stdout is the structured channel; logs go to stderr.)
//!
//!   2. **Error code allow-list** — for every error path we *can*
//!      trigger without exotic infrastructure, the stderr `code` field
//!      MUST be drawn from a hand-maintained allow-list mirroring
//!      `agicash-cli/src/main.rs`. The allow-list itself is also
//!      validated for kebab-case.
//!
//! What this test cannot do today (and why it's still high value):
//!   - Some codes (`encryption-error`, `mint-unrecoverable`,
//!     `quote-expired`, `concurrency-error`) require fault injection or
//!     time travel. They live in the allow-list; surface assertions for
//!     them ride along with future infrastructure (roadmap E1).
//!   - The error-code allow-list is a copy of `main.rs`. Drift between
//!     the two is the failure mode this test is designed to surface —
//!     when a new error variant is added without updating the
//!     allow-list, the next contract test run flags an unknown code on
//!     stderr instead of silently accepting it.
//!
//! Run:
//!     cargo test -p agicash-cli \
//!         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
//!         --test contracts -- --nocapture

#![allow(clippy::doc_markdown)]

#[cfg(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
))]
#[allow(
    clippy::if_not_else,
    clippy::redundant_closure_for_method_calls,
    clippy::map_unwrap_or
)]
mod gated {
    use assert_cmd::Command;
    use serde_json::Value;

    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    /// The canonical kebab-case error code allow-list. Mirror of every
    /// string emitted by `classify_*` in `agicash-cli/src/main.rs`.
    /// Adding a new error variant to the CLI without updating this
    /// list is the failure mode this test guards against.
    const ALLOWED_ERROR_CODES: &[&str] = &[
        // Auth
        "not-logged-in",
        "unauthenticated",
        "auth-backend-error",
        "internal-error",
        "network-error",
        // Mint hygiene
        "invalid-mint-url",
        "mint-unreachable",
        "mint-error",
        "mint-mismatch",
        "mint-unrecoverable",
        "unsupported-currency",
        // Storage
        "not-found",
        "storage-backend-error",
        "encryption-error",
        "concurrency-error",
        // Receive
        "invalid-token",
        "no-matching-account",
        "already-claimed",
        // Send
        "insufficient-balance",
        "amount-too-small",
        "currency-mismatch",
        "token-encode-error",
        "unsupported-token-version",
        "invalid-account-id",
        "account-ambiguous",
        // Lightning receive
        "invalid-quote-id",
        "quote-not-paid",
        "quote-expired",
        "invalid-state",
        // Catch-all
        "unknown",
    ];

    fn env_ready() -> bool {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").is_ok()
            && std::env::var("OPENSECRET_CLIENT_ID").is_ok()
            && (std::env::var("SUPABASE_URL").is_ok() || std::env::var("VITE_SUPABASE_URL").is_ok())
            && (std::env::var("SUPABASE_ANON_KEY").is_ok()
                || std::env::var("VITE_SUPABASE_ANON_KEY").is_ok())
    }

    fn cmd(service: &str) -> Command {
        let mut c = Command::cargo_bin("agicash").unwrap();
        c.env("AGICASH_KEYRING_SERVICE", service);
        c
    }

    fn cleanup(service: &str) {
        let _ = cmd(service).args(["auth", "logout"]).output();
    }

    /// True iff `s` is a non-empty kebab-case identifier (lowercase
    /// letters + digits, words separated by single hyphens, no leading
    /// or trailing hyphen).
    fn is_kebab_case(s: &str) -> bool {
        if s.is_empty() || s.starts_with('-') || s.ends_with('-') || s.contains("--") {
            return false;
        }
        s.chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
    }

    /// Pull the `error.code` string from a JSON error body, panicking
    /// with a helpful diagnostic when the shape is wrong.
    fn extract_error_code(label: &str, stderr: &str) -> String {
        let parsed: Value = serde_json::from_str(stderr.trim())
            .unwrap_or_else(|e| panic!("{label}: stderr was not JSON ({e}); stderr={stderr}",));
        parsed
            .get("error")
            .and_then(|e| e.get("code"))
            .and_then(|c| c.as_str())
            .map(str::to_string)
            .unwrap_or_else(|| panic!("{label}: missing error.code in stderr JSON: {parsed}"))
    }

    /// Catalog assertion: the static allow-list must itself be valid
    /// kebab-case. Sanity check before trusting it elsewhere.
    #[test]
    fn allow_list_entries_are_kebab_case() {
        let bad: Vec<&str> = ALLOWED_ERROR_CODES
            .iter()
            .copied()
            .filter(|c| !is_kebab_case(c))
            .collect();
        assert!(
            bad.is_empty(),
            "non-kebab-case entries in ALLOWED_ERROR_CODES: {bad:?}",
        );
    }

    /// Every success path we can trigger emits parseable JSON on stdout.
    /// Iterates the full set of safe success scenarios and accumulates
    /// failures so a single broken command doesn't hide the others.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn success_paths_emit_valid_json() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.contracts-success");

        let mut failures: Vec<String> = Vec::new();

        // Defensive: clean slate before observing the no-session
        // logout body shape.
        cleanup(&service);

        // ---- 1. `version` (no auth, no env, hermetic). ----
        let v = cmd(&service)
            .arg("version")
            .output()
            .expect("spawn agicash version");
        if !v.status.success() {
            failures.push(format!(
                "version: nonzero exit; stderr={}",
                String::from_utf8_lossy(&v.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&v.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("version").and_then(|x| x.as_str()).is_none() {
                        failures.push(format!("version: missing string `version` field: {j}"));
                    }
                }
                Err(e) => failures.push(format!("version: stdout not JSON ({e}): {s}")),
            }
        }

        // ---- 2. `auth status` while logged out. ----
        let s_out = cmd(&service)
            .args(["auth", "status"])
            .output()
            .expect("spawn agicash auth status");
        if !s_out.status.success() {
            failures.push(format!(
                "auth status (logged out): nonzero exit; stderr={}",
                String::from_utf8_lossy(&s_out.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&s_out.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("logged_in").and_then(|v| v.as_bool()) != Some(false) {
                        failures.push(format!(
                            "auth status (logged out): expected logged_in=false; got {j}"
                        ));
                    }
                }
                Err(e) => failures.push(format!("auth status (logged out): not JSON ({e}): {s}")),
            }
        }

        // ---- 3. `auth logout` while logged out (status=not-logged-in). ----
        let lo = cmd(&service)
            .args(["auth", "logout"])
            .output()
            .expect("spawn agicash auth logout (no session)");
        if !lo.status.success() {
            failures.push(format!(
                "auth logout (no session): nonzero exit; stderr={}",
                String::from_utf8_lossy(&lo.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&lo.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("status").and_then(|v| v.as_str()) != Some("not-logged-in") {
                        failures.push(format!(
                            "auth logout (no session): expected status=not-logged-in; got {j}"
                        ));
                    }
                }
                Err(e) => failures.push(format!("auth logout (no session): not JSON ({e}): {s}")),
            }
        }

        // ---- 4. `auth guest` (creates a session). ----
        let g = cmd(&service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        if !g.status.success() {
            cleanup(&service);
            failures.push(format!(
                "auth guest: nonzero exit; stderr={}",
                String::from_utf8_lossy(&g.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&g.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("status").and_then(|v| v.as_str()) != Some("signed-in") {
                        failures.push(format!("auth guest: expected status=signed-in; got {j}"));
                    }
                    if j.get("user_id").and_then(|v| v.as_str()).is_none() {
                        failures.push(format!("auth guest: missing user_id; got {j}"));
                    }
                    if j.get("guest").and_then(|v| v.as_bool()) != Some(true) {
                        failures.push(format!("auth guest: expected guest=true; got {j}"));
                    }
                }
                Err(e) => failures.push(format!("auth guest: not JSON ({e}): {s}")),
            }
        }

        // ---- 5. `auth status` while logged in. ----
        let si = cmd(&service)
            .args(["auth", "status"])
            .output()
            .expect("spawn agicash auth status (logged in)");
        if !si.status.success() {
            failures.push(format!(
                "auth status (logged in): nonzero exit; stderr={}",
                String::from_utf8_lossy(&si.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&si.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("logged_in").and_then(|v| v.as_bool()) != Some(true) {
                        failures.push(format!(
                            "auth status (logged in): expected logged_in=true; got {j}"
                        ));
                    }
                    if j.get("user_id").and_then(|v| v.as_str()).is_none() {
                        failures.push(format!("auth status (logged in): missing user_id; got {j}"));
                    }
                }
                Err(e) => failures.push(format!("auth status (logged in): not JSON ({e}): {s}")),
            }
        }

        // ---- 6. `account list` empty before mint add → JSON array. ----
        let al = cmd(&service)
            .args(["account", "list"])
            .output()
            .expect("spawn agicash account list");
        if !al.status.success() {
            failures.push(format!(
                "account list (empty): nonzero exit; stderr={}",
                String::from_utf8_lossy(&al.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&al.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if !j.is_array() {
                        failures.push(format!("account list: expected array; got {j}"));
                    }
                }
                Err(e) => failures.push(format!("account list: not JSON ({e}): {s}")),
            }
        }

        // ---- 7. `mint add testnut` → status=added, account_id present. ----
        let ma = cmd(&service)
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add");
        if !ma.status.success() {
            failures.push(format!(
                "mint add: nonzero exit; stderr={}",
                String::from_utf8_lossy(&ma.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&ma.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("status").and_then(|v| v.as_str()) != Some("added") {
                        failures.push(format!("mint add: expected status=added; got {j}"));
                    }
                    if j.get("account_id").and_then(|v| v.as_str()).is_none() {
                        failures.push(format!("mint add: missing account_id; got {j}"));
                    }
                    if j.get("mint_url").and_then(|v| v.as_str()).is_none() {
                        failures.push(format!("mint add: missing mint_url; got {j}"));
                    }
                }
                Err(e) => failures.push(format!("mint add: not JSON ({e}): {s}")),
            }
        }

        // ---- 8. `balance` after mint add → JSON array of entries. ----
        let bal = cmd(&service)
            .arg("balance")
            .output()
            .expect("spawn agicash balance");
        if !bal.status.success() {
            failures.push(format!(
                "balance: nonzero exit; stderr={}",
                String::from_utf8_lossy(&bal.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&bal.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if !j.is_array() {
                        failures.push(format!("balance: expected array; got {j}"));
                    } else {
                        for entry in j.as_array().unwrap() {
                            for required in ["account_id", "name", "currency", "balance", "unit"] {
                                if entry.get(required).is_none() {
                                    failures.push(format!(
                                        "balance entry missing `{required}`: {entry}"
                                    ));
                                }
                            }
                        }
                    }
                }
                Err(e) => failures.push(format!("balance: not JSON ({e}): {s}")),
            }
        }

        // ---- 9. `auth logout` while signed in → status=signed-out. ----
        let final_lo = cmd(&service)
            .args(["auth", "logout"])
            .output()
            .expect("spawn agicash auth logout (signed in)");

        // Always run cleanup last (idempotent).
        cleanup(&service);

        if !final_lo.status.success() {
            failures.push(format!(
                "auth logout (signed in): nonzero exit; stderr={}",
                String::from_utf8_lossy(&final_lo.stderr),
            ));
        } else {
            let s = String::from_utf8_lossy(&final_lo.stdout).into_owned();
            match serde_json::from_str::<Value>(s.trim()) {
                Ok(j) => {
                    if j.get("status").and_then(|v| v.as_str()) != Some("signed-out") {
                        failures.push(format!(
                            "auth logout (signed in): expected status=signed-out; got {j}"
                        ));
                    }
                }
                Err(e) => failures.push(format!("auth logout (signed in): not JSON ({e}): {s}")),
            }
        }

        assert!(
            failures.is_empty(),
            "JSON success-path contract failures:\n  - {}",
            failures.join("\n  - "),
        );
    }

    /// Every error path we can trigger emits a kebab-case `error.code`
    /// drawn from `ALLOWED_ERROR_CODES`. Catches schema drift between
    /// `classify_*` in `main.rs` and the allow-list maintained here.
    #[test]
    #[allow(clippy::too_many_lines)]
    fn error_codes_match_kebab_case_allow_list() {
        if !env_ready() {
            eprintln!("skipping: env vars not set");
            return;
        }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.contracts-errors");

        // Defensive cleanup so the not-logged-in cases observe a clean slate.
        cleanup(&service);

        // (label, args, expected error code)
        // Each row is a CLI invocation that MUST produce a typed JSON error.
        let cases: &[(&str, &[&str], &str)] = &[
            // Auth-required surfaces with no session: each maps to
            // `not-logged-in` via its respective NotLoggedIn variant.
            (
                "account list (no session)",
                &["account", "list"],
                "not-logged-in",
            ),
            (
                "mint add (no session)",
                &["mint", "add", TEST_MINT_URL],
                "not-logged-in",
            ),
            ("balance (no session)", &["balance"], "not-logged-in"),
            ("send (no session)", &["send", "100"], "not-logged-in"),
            (
                "receive token (no session)",
                &["receive", "token", "cashuBgarbage"],
                "not-logged-in",
            ),
            (
                "receive lightning (no session)",
                &["receive", "lightning", "100"],
                "not-logged-in",
            ),
        ];

        let mut failures: Vec<String> = Vec::new();

        for (label, args, expected_code) in cases {
            let out = cmd(&service)
                .args(*args)
                .output()
                .unwrap_or_else(|e| panic!("spawn {label}: {e}"));

            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();

            if out.status.success() {
                failures.push(format!(
                    "{label}: expected nonzero exit; stdout={stdout}, stderr={stderr}",
                ));
                continue;
            }

            let code = extract_error_code(label, &stderr);
            if !is_kebab_case(&code) {
                failures.push(format!(
                    "{label}: error code `{code}` is not kebab-case; stderr={stderr}",
                ));
            }
            if !ALLOWED_ERROR_CODES.contains(&code.as_str()) {
                failures.push(format!(
                    "{label}: error code `{code}` not in ALLOWED_ERROR_CODES \
                     (catalog drift?). stderr={stderr}",
                ));
            }
            if code != *expected_code {
                failures.push(format!(
                    "{label}: expected code `{expected_code}` but got `{code}`. stderr={stderr}",
                ));
            }
        }

        // Now exercise the post-auth error surface to cover codes that
        // can't be hit without a session.
        let g = cmd(&service)
            .args(["auth", "guest"])
            .output()
            .expect("spawn agicash auth guest");
        if !g.status.success() {
            cleanup(&service);
            panic!(
                "auth guest failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&g.stdout),
                String::from_utf8_lossy(&g.stderr),
            );
        }

        let pre_mint_cases: &[(&str, &[&str], &str)] = &[
            (
                "mint add unreachable",
                &["mint", "add", "https://does-not-exist.invalid.example"],
                "mint-unreachable",
            ),
            (
                "receive token malformed",
                &["receive", "token", "not-a-token"],
                "invalid-token",
            ),
            (
                "send before mint added",
                &["send", "100"],
                // No mint accounts exist yet; the send subcommand
                // resolves the target account first and surfaces
                // `no-matching-account` before consulting balances.
                "no-matching-account",
            ),
        ];

        for (label, args, expected_code) in pre_mint_cases {
            let out = cmd(&service)
                .args(*args)
                .output()
                .unwrap_or_else(|e| panic!("spawn {label}: {e}"));

            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();

            if out.status.success() {
                failures.push(format!(
                    "{label}: expected nonzero exit; stdout={stdout}, stderr={stderr}",
                ));
                continue;
            }

            let code = extract_error_code(label, &stderr);
            if !is_kebab_case(&code) {
                failures.push(format!(
                    "{label}: error code `{code}` is not kebab-case; stderr={stderr}",
                ));
            }
            if !ALLOWED_ERROR_CODES.contains(&code.as_str()) {
                failures.push(format!(
                    "{label}: error code `{code}` not in ALLOWED_ERROR_CODES \
                     (catalog drift?). stderr={stderr}",
                ));
            }
            if code != *expected_code {
                failures.push(format!(
                    "{label}: expected code `{expected_code}` but got `{code}`. stderr={stderr}",
                ));
            }
        }

        // Add a mint so the empty-wallet send path exercises the
        // `insufficient-balance` branch (proof-selection error rather
        // than account-resolution error).
        let ma = cmd(&service)
            .args(["mint", "add", TEST_MINT_URL])
            .output()
            .expect("spawn agicash mint add (for empty-wallet send)");
        if !ma.status.success() {
            cleanup(&service);
            panic!(
                "mint add (for send) failed: stdout={}, stderr={}",
                String::from_utf8_lossy(&ma.stdout),
                String::from_utf8_lossy(&ma.stderr),
            );
        }

        let post_mint_cases: &[(&str, &[&str], &str)] = &[(
            "send empty wallet",
            &["send", "100"],
            "insufficient-balance",
        )];

        for (label, args, expected_code) in post_mint_cases {
            let out = cmd(&service)
                .args(*args)
                .output()
                .unwrap_or_else(|e| panic!("spawn {label}: {e}"));

            let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
            let stdout = String::from_utf8_lossy(&out.stdout).into_owned();

            if out.status.success() {
                failures.push(format!(
                    "{label}: expected nonzero exit; stdout={stdout}, stderr={stderr}",
                ));
                continue;
            }

            let code = extract_error_code(label, &stderr);
            if !is_kebab_case(&code) {
                failures.push(format!(
                    "{label}: error code `{code}` is not kebab-case; stderr={stderr}",
                ));
            }
            if !ALLOWED_ERROR_CODES.contains(&code.as_str()) {
                failures.push(format!(
                    "{label}: error code `{code}` not in ALLOWED_ERROR_CODES \
                     (catalog drift?). stderr={stderr}",
                ));
            }
            if code != *expected_code {
                failures.push(format!(
                    "{label}: expected code `{expected_code}` but got `{code}`. stderr={stderr}",
                ));
            }
        }

        cleanup(&service);

        assert!(
            failures.is_empty(),
            "error-code contract failures:\n  - {}",
            failures.join("\n  - "),
        );
    }

    /// Hermetic catalog sanity: ensures the allow-list mirrors every
    /// hardcoded code string in `agicash-cli/src/main.rs::classify_*`.
    /// If a worker adds a new variant + maps it to a new code without
    /// updating ALLOWED_ERROR_CODES, the next run of
    /// `error_codes_match_kebab_case_allow_list` will flag it for the
    /// real path. This pure-text check catches the case where the new
    /// code is added but the path that triggers it isn't yet hit by
    /// the live cases above.
    #[test]
    fn allow_list_covers_every_classify_code_in_main_rs() {
        // Resolve relative to this source file so the test runs from
        // any cwd. CARGO_MANIFEST_DIR points at agicash-cli/.
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let main_rs = std::path::Path::new(manifest_dir).join("src/main.rs");
        let src = std::fs::read_to_string(&main_rs)
            .unwrap_or_else(|e| panic!("read {}: {e}", main_rs.display()));

        // Match the literal `=> ("kebab-case", N)` and bare `=> "..."`
        // patterns produced by classify_error / classify_storage / etc.
        // The regex stays simple by design — kebab-case identifiers in
        // double quotes, optionally followed by ", <int>)".
        let mut found: std::collections::BTreeSet<String> = std::collections::BTreeSet::new();
        // Naive parser: scan for `"..."` literals; keep ones that look
        // like kebab-case codes (lowercase + digits + hyphens, length
        // >= 3 and contains at least one hyphen OR is a recognized
        // single-word code).
        let mut chars = src.char_indices().peekable();
        while let Some((_, c)) = chars.next() {
            if c == '"' {
                let start = chars.peek().map(|(i, _)| *i).unwrap_or(src.len());
                let mut end = start;
                while let Some(&(i, ch)) = chars.peek() {
                    if ch == '"' {
                        end = i;
                        chars.next();
                        break;
                    }
                    if ch == '\\' {
                        chars.next();
                        chars.next();
                        continue;
                    }
                    chars.next();
                    end = i + ch.len_utf8();
                }
                let lit = &src[start..end];
                // Heuristic: a code-like literal is short, all
                // lowercase ASCII / digits / hyphens, with no leading
                // or trailing hyphen. This matches every code emitted
                // by `classify_*` (single-word codes like
                // `unauthenticated` / `unknown` and multi-word codes
                // like `not-logged-in`).
                if !lit.is_empty()
                    && lit.len() <= 40
                    && lit
                        .chars()
                        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
                    && !lit.starts_with('-')
                    && !lit.ends_with('-')
                    && !lit.contains("--")
                {
                    found.insert(lit.to_string());
                }
            }
        }

        // Filter out hits that aren't error codes (e.g. URL fragments).
        // The classify_* fns produce ASCII kebab; URL-ish strings are
        // not present as bare literals in main.rs. Empirically the only
        // false positives would be rare. To stay strict, we require
        // every code in our allow-list to be present in the file (the
        // forward direction) AND every kebab literal in main.rs to be
        // in the allow-list (the reverse direction).
        let allow: std::collections::BTreeSet<String> = ALLOWED_ERROR_CODES
            .iter()
            .map(|s| (*s).to_string())
            .collect();

        let in_main_not_in_allow: Vec<&String> = found.difference(&allow).collect();
        let in_allow_not_in_main: Vec<&String> = allow.difference(&found).collect();

        assert!(
            in_main_not_in_allow.is_empty(),
            "kebab literals in main.rs missing from ALLOWED_ERROR_CODES (catalog drift): {in_main_not_in_allow:?}",
        );
        assert!(
            in_allow_not_in_main.is_empty(),
            "ALLOWED_ERROR_CODES has entries not present as literals in main.rs (stale catalog): {in_allow_not_in_main:?}",
        );
    }
}

#[cfg(not(all(
    feature = "real-mint-tests",
    feature = "real-supabase-tests",
    feature = "real-opensecret-tests"
)))]
#[test]
fn contracts_skipped_without_features() {
    eprintln!(
        "skipping real-network e2e; run with: \
         cargo test -p agicash-cli \
         --features real-mint-tests,real-supabase-tests,real-opensecret-tests \
         --test contracts"
    );
}
