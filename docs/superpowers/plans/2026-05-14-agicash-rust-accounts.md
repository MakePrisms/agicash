# Agicash Rust SDK — User + Accounts Read Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire up the Supabase storage seam to the point where `agicash account list` reads real `wallet.accounts` rows for the currently-signed-in user. After this slice, an integration test against the real Open Secret + Supabase dev environment runs `agicash auth guest` in one process, calls `upsert_user_with_accounts` in-test to seed the user row plus accounts, then runs `agicash account list` in a fresh process and confirms the seeded account names appear in stdout. All slice-1 and slice-2 tests still pass.

**Architecture:** `agicash-domain` grows two new enums (`AccountPurpose`, `AccountState`) and the `Account` struct expands to match the real `wallet.accounts` schema. A new `User` type is added next to it. `agicash-traits` gains a `StorageError` enum (mirroring `AuthError`'s shape) plus a `UserStorage` trait whose four async methods cover the one true RPC (`upsert_user_with_accounts`) and three direct table reads (`get_user`, `list_accounts`, `get_account`). `agicash-storage-supabase` becomes real: it holds a `postgrest::Postgrest` client plus an `Arc<dyn TokenProvider>`, injects per-request `Authorization` + `apikey` headers from the token provider, and implements `UserStorage` against the `wallet` schema. Hermetic tests for the four methods use `wiremock` to mock the Supabase REST API. `agicash-cli` gains an `account list` subcommand wired through a thin composition extension that builds a `SupabaseStorage` from env vars and reuses the slice-2 `OpenSecretTokenProvider`. An optional integration test gated behind a `real-supabase-tests` Cargo feature exercises the full path end-to-end.

**Tech Stack:** `postgrest = "1.6"` (community-maintained REST client, WASM-compatible via `reqwest` with `default-features = false`), `wiremock = "0.6"` (dev-dep for hermetic HTTP mocking), `chrono = { version = "0.4", features = ["serde"] }` for timestamp columns. `reqwest` is pulled in transitively by `postgrest` but we use a direct dep for header types. `async-trait`, `serde`, `serde_json` are already workspace deps.

**Reference:** This plan implements slice 3 of `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` (see §3, §5, §10, §11 "orphan rule", §12, §16.3). Slices 1 (`docs/superpowers/plans/2026-05-14-agicash-rust-scaffold.md`) and 2 (`docs/superpowers/plans/2026-05-14-agicash-rust-auth.md`) are assumed complete and committed. The slice-3 pre-research lives at `~/athanor/projects/agicash-rust/research/2026-05-14-slice-3-accounts.md` and resolved two important points: (1) only `upsert_user_with_accounts` is a real Supabase RPC, the other three "RPCs" are direct postgrest table queries; (2) `wallet.accounts.details` is plaintext JSONB — only `wallet.transactions.encrypted_transaction_details` is encrypted, so this slice does NOT need a `KeyProvider`-based decryption seam.

**Spec deviations:**
1. §5 (line 176, already amended) describes `UserStorage` as exposing the 1-RPC + 3-direct-queries pattern. This plan honors that — no separate "rpc()" wrapper, three of the four methods build direct postgrest selects with `.eq()` filters.
2. §11's orphan-rule paragraph (lines 601-610) was added because slice 2 hit the constraint mapping `opensecret::Error → AuthError`. Slice 3 hits the same constraint: `postgrest`/`reqwest` errors are foreign, and so is `chrono::DateTime`. Conversions in `agicash-storage-supabase` therefore use free helper functions, not `From` impls. This is not a deviation from the spec, but it must be observed.
3. §10 lists `agicash account list | default <id> | info [<id>]` as v1 surface. **This plan ships only `account list`.** `default <id>` and `info` are deferred to slice 4+ once balance/account-detail surfaces have real data behind them. The `default` write path also needs optimistic locking on the `version` column, which is out of scope for a read-path slice.

Defer (3) should be folded back into the spec when later slices add the remaining account subcommands.

**Scope change after planning (2026-05-15): drop wiremock; let it rip on local.**
gudnuf stood up a local OpenSecret enclave at `http://127.0.0.1:3999` and
local Supabase at `https://127.0.0.1:54321`. With both services running on
loopback there is no value in mocking Supabase's REST API for hermetic
tests — real-local is fast, deterministic enough, and gives end-to-end
confidence. Executor instructions:

- **Remove `wiremock` from the workspace deps** in Task 1 and from
  `agicash-storage-supabase`'s dev-deps in Task 9.
- **Replace each per-task wiremock test in Tasks 11-14 with a real-local
  Supabase integration test** that:
  - Reads `SUPABASE_URL` (falling back to `VITE_SUPABASE_URL`) and the
    anon key from `.env` (via `dotenvy::dotenv()` in test setup).
  - Skips with `eprintln!` when the env vars are missing (don't panic).
  - Gates behind a Cargo feature flag `real-supabase-tests` on the
    `agicash-storage-supabase` crate (mirror slice 2's `real-opensecret-tests`
    pattern in `agicash-cli`).
  - Performs the real operation (`list_accounts`, `get_user`, etc.) and
    asserts on the response shape. For seed/teardown isolation, use a
    randomly-generated `UserId` per test so rows don't collide; clean up
    any inserted rows in a `Drop` guard or test-end step.
- **Keep the structure of each task** (Files, Steps, commit) — only the
  test body and Cargo features change.
- **`real-supabase-tests` runs separately**: default `cargo test` should
  skip with eprintln, just like slice 2's auth_lifecycle test. The
  executor runs `cargo test -p agicash-storage-supabase --features real-supabase-tests`
  during slice 3 development.
- **Task 18's integration test** stays as-is — it already uses real
  local services end-to-end.

The original wiremock-based plan is preserved verbatim in the task bodies
below for reference; the executor adapts the test bodies per this directive.

**Branch:** Execute from `feat/rust-accounts` in the worktree at `/Users/claude/agicash/.claude/worktrees/rust-accounts`. Branched from `feat/rust-auth` (slice 2), which is itself off `feat/rust-scaffold` (slice 1), which is off master.

---

## File Structure

```
crates/
├── Cargo.toml                                          # MODIFY — add postgrest, wiremock, chrono
├── agicash-domain/
│   ├── Cargo.toml                                      # MODIFY — add chrono
│   └── src/
│       ├── lib.rs                                      # MODIFY — wire new modules
│       ├── account.rs                                  # MODIFY — expand Account + AccountPurpose + AccountState
│       └── user.rs                                     # NEW — User struct
├── agicash-traits/
│   ├── Cargo.toml                                      # MODIFY — add chrono, async-trait already present
│   └── src/
│       ├── lib.rs                                      # MODIFY — wire new modules
│       ├── storage_error.rs                            # NEW — StorageError
│       └── user_storage.rs                             # NEW — UpsertUserInput, UpsertUserResult, UserStorage
├── agicash-storage-supabase/
│   ├── Cargo.toml                                      # MODIFY — real deps
│   └── src/
│       ├── lib.rs                                      # MODIFY — wire new modules
│       ├── config.rs                                   # NEW — SupabaseStorageConfig
│       ├── error.rs                                    # NEW — free helpers (orphan rule)
│       ├── client.rs                                   # NEW — SupabaseStorage struct + auth helper
│       └── user_storage.rs                             # NEW — UserStorage impl + types
└── agicash-cli/
    ├── Cargo.toml                                      # MODIFY — add agicash-storage-supabase dep + feature
    ├── src/
    │   ├── main.rs                                     # MODIFY — wire AccountCommand dispatch
    │   ├── cli.rs                                      # MODIFY — add AccountCommand
    │   ├── composition.rs                              # MODIFY — extend with build_storage()
    │   └── account.rs                                  # NEW — cmd_account_list
    └── tests/
        ├── help.rs                                     # MODIFY — add account list smoke tests
        └── account_list.rs                             # NEW — gated integration test
```

---

## Task 1: Workspace dependency additions

**Files:**
- Modify: `crates/Cargo.toml`

- [ ] **Step 1: Add the new workspace dependencies**

Open `crates/Cargo.toml`. In the `[workspace.dependencies]` table, add the following entries. Group with related deps (postgrest under a "Storage" header, chrono under "Serialization", wiremock under "Dev / tests"):

```toml
# Storage
postgrest = "1.6"
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }

# (under existing "Serialization" header)
chrono = { version = "0.4", default-features = false, features = ["serde", "std", "clock"] }

# (under existing "Dev / tests" header)
wiremock = "0.6"
```

Place each in the appropriate section. Do not reorder unrelated entries. The `reqwest` dep is workspace-shared rather than transitive-via-postgrest because we need access to header types and want to control the TLS backend.

- [ ] **Step 2: Verify the workspace still resolves**

Run: `cd crates && cargo check --workspace`

Expected: PASS. The new deps are declared but not yet consumed; cargo only fetches them when a member crate references them, but a workspace-level `cargo check` must still succeed.

If the resolver fails (e.g., a transitive version conflict from `reqwest`/`postgrest`), stop and investigate before continuing.

- [ ] **Step 3: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/Cargo.toml
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
chore(rust): add workspace deps for slice 3 storage

postgrest 1.6, reqwest 0.12 (rustls), chrono 0.4 (serde), wiremock 0.6.
EOF
)"
```

---

## Task 2: `agicash-domain` — `AccountPurpose` enum

**Files:**
- Create: `crates/agicash-domain/src/account_purpose.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

`AccountPurpose` mirrors the `wallet.account_purpose` enum: `transactional`, `gift-card`. Note the hyphen in `gift-card` — the schema uses `gift-card` and we must match it on the wire.

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-domain/src/account_purpose.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_purpose_display_uses_kebab_case() {
        assert_eq!(AccountPurpose::Transactional.to_string(), "transactional");
        assert_eq!(AccountPurpose::GiftCard.to_string(), "gift-card");
    }

    #[test]
    fn account_purpose_parses_kebab_case() {
        assert_eq!(
            "transactional".parse::<AccountPurpose>().unwrap(),
            AccountPurpose::Transactional
        );
        assert_eq!(
            "gift-card".parse::<AccountPurpose>().unwrap(),
            AccountPurpose::GiftCard
        );
    }

    #[test]
    fn account_purpose_parse_rejects_unknown() {
        assert!("voucher".parse::<AccountPurpose>().is_err());
        assert!("".parse::<AccountPurpose>().is_err());
        // No silent underscore-vs-hyphen leniency: gift_card must NOT parse.
        assert!("gift_card".parse::<AccountPurpose>().is_err());
    }

    #[test]
    fn account_purpose_serializes_as_kebab_case() {
        let json = serde_json::to_string(&AccountPurpose::Transactional).unwrap();
        assert_eq!(json, "\"transactional\"");
        let json = serde_json::to_string(&AccountPurpose::GiftCard).unwrap();
        assert_eq!(json, "\"gift-card\"");
    }

    #[test]
    fn account_purpose_deserializes_from_kebab_case() {
        let p: AccountPurpose = serde_json::from_str("\"gift-card\"").unwrap();
        assert_eq!(p, AccountPurpose::GiftCard);
    }
}
```

- [ ] **Step 2: Wire the module into `lib.rs`**

Replace `crates/agicash-domain/src/lib.rs`:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`/`chrono`.

pub mod account;
pub mod account_purpose;
pub mod currency;
pub mod ids;
pub mod transaction;

pub use account::*;
pub use account_purpose::*;
pub use currency::*;
pub use ids::*;
pub use transaction::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-domain`

Expected: FAIL — `AccountPurpose` does not exist.

- [ ] **Step 4: Implement `AccountPurpose`**

Replace `crates/agicash-domain/src/account_purpose.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AccountPurpose {
    Transactional,
    GiftCard,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown account purpose: {0}")]
pub struct UnknownAccountPurpose(pub String);

impl fmt::Display for AccountPurpose {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Transactional => "transactional",
            Self::GiftCard => "gift-card",
        })
    }
}

impl FromStr for AccountPurpose {
    type Err = UnknownAccountPurpose;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "transactional" => Ok(Self::Transactional),
            "gift-card" => Ok(Self::GiftCard),
            _ => Err(UnknownAccountPurpose(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_purpose_display_uses_kebab_case() {
        assert_eq!(AccountPurpose::Transactional.to_string(), "transactional");
        assert_eq!(AccountPurpose::GiftCard.to_string(), "gift-card");
    }

    #[test]
    fn account_purpose_parses_kebab_case() {
        assert_eq!(
            "transactional".parse::<AccountPurpose>().unwrap(),
            AccountPurpose::Transactional
        );
        assert_eq!(
            "gift-card".parse::<AccountPurpose>().unwrap(),
            AccountPurpose::GiftCard
        );
    }

    #[test]
    fn account_purpose_parse_rejects_unknown() {
        assert!("voucher".parse::<AccountPurpose>().is_err());
        assert!("".parse::<AccountPurpose>().is_err());
        assert!("gift_card".parse::<AccountPurpose>().is_err());
    }

    #[test]
    fn account_purpose_serializes_as_kebab_case() {
        let json = serde_json::to_string(&AccountPurpose::Transactional).unwrap();
        assert_eq!(json, "\"transactional\"");
        let json = serde_json::to_string(&AccountPurpose::GiftCard).unwrap();
        assert_eq!(json, "\"gift-card\"");
    }

    #[test]
    fn account_purpose_deserializes_from_kebab_case() {
        let p: AccountPurpose = serde_json::from_str("\"gift-card\"").unwrap();
        assert_eq!(p, AccountPurpose::GiftCard);
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-domain
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(domain): add AccountPurpose enum (transactional, gift-card)"
```

---

## Task 3: `agicash-domain` — `AccountState` enum

**Files:**
- Create: `crates/agicash-domain/src/account_state.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

Mirrors the `wallet.account_state` enum (added in migration `20260325120000_add_account_state.sql`): `active`, `expired`.

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-domain/src/account_state.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_state_display_uses_lowercase() {
        assert_eq!(AccountState::Active.to_string(), "active");
        assert_eq!(AccountState::Expired.to_string(), "expired");
    }

    #[test]
    fn account_state_parses_lowercase() {
        assert_eq!(
            "active".parse::<AccountState>().unwrap(),
            AccountState::Active
        );
        assert_eq!(
            "expired".parse::<AccountState>().unwrap(),
            AccountState::Expired
        );
    }

    #[test]
    fn account_state_parse_rejects_unknown() {
        assert!("dormant".parse::<AccountState>().is_err());
        assert!("ACTIVE".parse::<AccountState>().is_err(),
            "strict lowercase only — schema enum is lowercase");
    }

    #[test]
    fn account_state_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountState::Active).unwrap();
        assert_eq!(json, "\"active\"");
    }

    #[test]
    fn account_state_deserializes_from_lowercase() {
        let s: AccountState = serde_json::from_str("\"expired\"").unwrap();
        assert_eq!(s, AccountState::Expired);
    }
}
```

- [ ] **Step 2: Wire the module into `lib.rs`**

Replace `crates/agicash-domain/src/lib.rs`:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`/`chrono`.

pub mod account;
pub mod account_purpose;
pub mod account_state;
pub mod currency;
pub mod ids;
pub mod transaction;

pub use account::*;
pub use account_purpose::*;
pub use account_state::*;
pub use currency::*;
pub use ids::*;
pub use transaction::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-domain`

Expected: FAIL — `AccountState` does not exist.

- [ ] **Step 4: Implement `AccountState`**

Replace `crates/agicash-domain/src/account_state.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountState {
    Active,
    Expired,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown account state: {0}")]
pub struct UnknownAccountState(pub String);

impl fmt::Display for AccountState {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Active => "active",
            Self::Expired => "expired",
        })
    }
}

impl FromStr for AccountState {
    type Err = UnknownAccountState;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "active" => Ok(Self::Active),
            "expired" => Ok(Self::Expired),
            _ => Err(UnknownAccountState(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_state_display_uses_lowercase() {
        assert_eq!(AccountState::Active.to_string(), "active");
        assert_eq!(AccountState::Expired.to_string(), "expired");
    }

    #[test]
    fn account_state_parses_lowercase() {
        assert_eq!(
            "active".parse::<AccountState>().unwrap(),
            AccountState::Active
        );
        assert_eq!(
            "expired".parse::<AccountState>().unwrap(),
            AccountState::Expired
        );
    }

    #[test]
    fn account_state_parse_rejects_unknown() {
        assert!("dormant".parse::<AccountState>().is_err());
        assert!("ACTIVE".parse::<AccountState>().is_err());
    }

    #[test]
    fn account_state_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountState::Active).unwrap();
        assert_eq!(json, "\"active\"");
    }

    #[test]
    fn account_state_deserializes_from_lowercase() {
        let s: AccountState = serde_json::from_str("\"expired\"").unwrap();
        assert_eq!(s, AccountState::Expired);
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-domain
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(domain): add AccountState enum (active, expired)"
```

---

## Task 4: `agicash-domain` — expand `Account` to match schema

**Files:**
- Modify: `crates/agicash-domain/Cargo.toml`
- Modify: `crates/agicash-domain/src/account.rs`

The slice-1 `Account` was a 5-field stub. The real `wallet.accounts` row has 11 columns (after migration 20260325120000): `id`, `created_at`, `user_id`, `name`, `type`, `purpose`, `currency`, `details` (jsonb), `version`, `state`, `expires_at`. The field name `type` is reserved in Rust so we keep the slice-1 `account_type` Rust name and use `#[serde(rename = "type")]` for wire compat.

- [ ] **Step 1: Add `chrono` as a dep on the domain crate**

Edit `crates/agicash-domain/Cargo.toml`. Update `[dependencies]` to include `chrono`:

```toml
[package]
name = "agicash-domain"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
chrono = { workspace = true }
uuid = { workspace = true }
thiserror = { workspace = true }

[dev-dependencies]
serde_json = { workspace = true }

[lints]
workspace = true
```

`serde_json` moves into runtime deps because `Account.details` is `serde_json::Value`. (Keep it in dev-deps too, but cargo dedupes.)

- [ ] **Step 2: Write the failing tests**

Replace `crates/agicash-domain/src/account.rs`:

```rust
use crate::{AccountId, AccountPurpose, AccountState, Currency, UserId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Cashu,
    Spark,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Account {
    pub id: AccountId,
    pub created_at: DateTime<Utc>,
    pub user_id: UserId,
    pub name: String,
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub purpose: AccountPurpose,
    pub currency: Currency,
    pub details: serde_json::Value,
    pub version: i32,
    pub state: AccountState,
    pub expires_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn account_type_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountType::Cashu).unwrap();
        assert_eq!(json, "\"cashu\"");
        let json = serde_json::to_string(&AccountType::Spark).unwrap();
        assert_eq!(json, "\"spark\"");
    }

    #[test]
    fn account_roundtrips_through_realistic_supabase_row_json() {
        // Shape mirrors a postgrest select * row from wallet.accounts.
        let raw = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-03-01T12:00:00Z",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Test Mint",
            "type": "cashu",
            "purpose": "transactional",
            "currency": "BTC",
            "details": {
                "mint_url": "https://mint.example",
                "keyset_counters": {},
                "is_default": true
            },
            "version": 0,
            "state": "active",
            "expires_at": null
        });
        let parsed: Account = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed.name, "Test Mint");
        assert_eq!(parsed.account_type, AccountType::Cashu);
        assert_eq!(parsed.purpose, AccountPurpose::Transactional);
        assert_eq!(parsed.currency, Currency::Btc);
        assert_eq!(parsed.state, AccountState::Active);
        assert!(parsed.expires_at.is_none());
        assert_eq!(
            parsed.details.get("mint_url").and_then(|v| v.as_str()),
            Some("https://mint.example")
        );

        let reserialized = serde_json::to_value(&parsed).unwrap();
        // type is serialized as "type" not "account_type".
        assert_eq!(reserialized.get("type").and_then(|v| v.as_str()), Some("cashu"));
        // Round-trip: parse, serialize, parse, must equal.
        let parsed2: Account = serde_json::from_value(reserialized).unwrap();
        assert_eq!(parsed, parsed2);
    }

    #[test]
    fn account_with_expires_at_populated_deserializes() {
        let raw = json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "created_at": "2026-03-01T12:00:00Z",
            "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "name": "Gift Card",
            "type": "cashu",
            "purpose": "gift-card",
            "currency": "USD",
            "details": {},
            "version": 3,
            "state": "active",
            "expires_at": "2026-04-01T00:00:00Z"
        });
        let parsed: Account = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.version, 3);
        assert_eq!(parsed.purpose, AccountPurpose::GiftCard);
        assert!(parsed.expires_at.is_some());
    }
}
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-domain`

Expected: FAIL — the slice-1 `Account` shape doesn't have the new fields, and `chrono` is freshly added.

- [ ] **Step 4: Confirm the implementation is already in the test file body above**

The implementation in Step 2 is the new `Account` struct itself. No separate "implement" step is needed — replacing the file in Step 2 includes both the implementation and the tests. Move on.

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS — the new `Account` deserializes the realistic JSON and round-trips.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-domain
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
feat(domain): expand Account to match wallet.accounts schema

Adds created_at, purpose, details (jsonb), version, state, expires_at
to match the real Supabase row shape after migration
20260325120000_add_account_state.sql. Renames inner serde field
from "account_type" to "type" to match the column name.
EOF
)"
```

---

## Task 5: `agicash-domain` — `User` struct

**Files:**
- Create: `crates/agicash-domain/src/user.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

Mirrors the `wallet.users` table. `id`, `created_at`, `email` (optional), `email_verified`, `username`, `default_btc_account_id` (optional), `default_usd_account_id` (optional), `default_currency`, `cashu_locking_xpub`, `encryption_public_key`, `spark_identity_public_key`, `terms_accepted_at`, `gift_card_mint_terms_accepted_at` (optional — added by migration `20260415180000_add_gift_card_mint_terms.sql`). We elide `updated_at` from the Rust type — it's trigger-managed and not part of the read API surface; if a later slice needs it we can add it.

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-domain/src/user.rs`:

```rust
use crate::{AccountId, Currency, UserId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn user_roundtrips_through_realistic_supabase_row_json() {
        let raw = json!({
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "created_at": "2026-03-01T12:00:00Z",
            "email": "test@example.com",
            "email_verified": true,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub6Cabc123",
            "encryption_public_key": "schnorrpub123",
            "spark_identity_public_key": "sparkpub123",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        });
        let parsed: User = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed.email.as_deref(), Some("test@example.com"));
        assert!(parsed.email_verified);
        assert_eq!(parsed.username, "user-eeeeeeeeeeee");
        assert_eq!(parsed.default_currency, Currency::Btc);
        assert!(parsed.default_btc_account_id.is_some());
        assert!(parsed.default_usd_account_id.is_none());
        assert!(parsed.gift_card_mint_terms_accepted_at.is_none());

        let reserialized = serde_json::to_value(&parsed).unwrap();
        let parsed2: User = serde_json::from_value(reserialized).unwrap();
        assert_eq!(parsed, parsed2);
    }

    #[test]
    fn user_with_no_email_deserializes() {
        // Guest users have null email until they upgrade.
        let raw = json!({
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "created_at": "2026-03-01T12:00:00Z",
            "email": null,
            "email_verified": false,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub6Cabc123",
            "encryption_public_key": "schnorrpub123",
            "spark_identity_public_key": "sparkpub123",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        });
        let parsed: User = serde_json::from_value(raw).unwrap();
        assert!(parsed.email.is_none());
        assert!(!parsed.email_verified);
    }
}
```

- [ ] **Step 2: Wire the module into `lib.rs`**

Replace `crates/agicash-domain/src/lib.rs`:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`/`chrono`.

pub mod account;
pub mod account_purpose;
pub mod account_state;
pub mod currency;
pub mod ids;
pub mod transaction;
pub mod user;

pub use account::*;
pub use account_purpose::*;
pub use account_state::*;
pub use currency::*;
pub use ids::*;
pub use transaction::*;
pub use user::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-domain`

Expected: FAIL — `User` does not exist.

- [ ] **Step 4: Implement `User`**

Replace `crates/agicash-domain/src/user.rs`:

```rust
use crate::{AccountId, Currency, UserId};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct User {
    pub id: UserId,
    pub created_at: DateTime<Utc>,
    pub email: Option<String>,
    pub email_verified: bool,
    pub username: String,
    pub default_btc_account_id: Option<AccountId>,
    pub default_usd_account_id: Option<AccountId>,
    pub default_currency: Currency,
    pub cashu_locking_xpub: String,
    pub encryption_public_key: String,
    pub spark_identity_public_key: String,
    pub terms_accepted_at: DateTime<Utc>,
    pub gift_card_mint_terms_accepted_at: Option<DateTime<Utc>>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn user_roundtrips_through_realistic_supabase_row_json() {
        let raw = json!({
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "created_at": "2026-03-01T12:00:00Z",
            "email": "test@example.com",
            "email_verified": true,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub6Cabc123",
            "encryption_public_key": "schnorrpub123",
            "spark_identity_public_key": "sparkpub123",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        });
        let parsed: User = serde_json::from_value(raw.clone()).unwrap();
        assert_eq!(parsed.email.as_deref(), Some("test@example.com"));
        assert!(parsed.email_verified);
        assert_eq!(parsed.username, "user-eeeeeeeeeeee");
        assert_eq!(parsed.default_currency, Currency::Btc);
        assert!(parsed.default_btc_account_id.is_some());
        assert!(parsed.default_usd_account_id.is_none());
        assert!(parsed.gift_card_mint_terms_accepted_at.is_none());

        let reserialized = serde_json::to_value(&parsed).unwrap();
        let parsed2: User = serde_json::from_value(reserialized).unwrap();
        assert_eq!(parsed, parsed2);
    }

    #[test]
    fn user_with_no_email_deserializes() {
        let raw = json!({
            "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "created_at": "2026-03-01T12:00:00Z",
            "email": null,
            "email_verified": false,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub6Cabc123",
            "encryption_public_key": "schnorrpub123",
            "spark_identity_public_key": "sparkpub123",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        });
        let parsed: User = serde_json::from_value(raw).unwrap();
        assert!(parsed.email.is_none());
        assert!(!parsed.email_verified);
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-domain
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(domain): add User struct mirroring wallet.users schema"
```

---

## Task 6: `agicash-traits` — `StorageError`

**Files:**
- Create: `crates/agicash-traits/src/storage_error.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

Mirrors `AuthError`'s shape exactly: `Network(String)`, `NotFound`, `Backend(String)`, `Internal(String)`. Note we skip `Unauthenticated` here — auth failures bubble up through the token provider as `AuthError` before we get to storage code. If a 401 leaks from postgrest we surface it as `Backend("unauthenticated: ...")`.

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-traits/src/storage_error.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_error_display_covers_each_variant() {
        let n = StorageError::Network("dns".into());
        assert!(n.to_string().contains("network"));

        let nf = StorageError::NotFound;
        assert!(nf.to_string().to_lowercase().contains("not found"));

        let b = StorageError::Backend("oops".into());
        assert!(b.to_string().contains("oops"));

        let i = StorageError::Internal("bug".into());
        assert!(i.to_string().contains("bug"));
    }

    #[test]
    fn storage_error_is_a_std_error() {
        fn assert_error<E: std::error::Error>() {}
        assert_error::<StorageError>();
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls.

pub mod error;
pub mod key_options;
pub mod key_provider;
pub mod session_storage;
pub mod storage_error;
pub mod token_provider;

pub use error::*;
pub use key_options::*;
pub use key_provider::*;
pub use session_storage::*;
pub use storage_error::*;
pub use token_provider::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `StorageError` does not exist.

- [ ] **Step 4: Implement `StorageError`**

Replace `crates/agicash-traits/src/storage_error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("network: {0}")]
    Network(String),
    #[error("not found")]
    NotFound,
    #[error("storage backend error: {0}")]
    Backend(String),
    #[error("internal error: {0}")]
    Internal(String),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_error_display_covers_each_variant() {
        let n = StorageError::Network("dns".into());
        assert!(n.to_string().contains("network"));

        let nf = StorageError::NotFound;
        assert!(nf.to_string().to_lowercase().contains("not found"));

        let b = StorageError::Backend("oops".into());
        assert!(b.to_string().contains("oops"));

        let i = StorageError::Internal("bug".into());
        assert!(i.to_string().contains("bug"));
    }

    #[test]
    fn storage_error_is_a_std_error() {
        fn assert_error<E: std::error::Error>() {}
        assert_error::<StorageError>();
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-traits
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(traits): add StorageError enum (Network, NotFound, Backend, Internal)"
```

---

## Task 7: `agicash-traits` — `UpsertUserInput` and `UpsertUserResult`

**Files:**
- Modify: `crates/agicash-traits/Cargo.toml` (add `chrono` dep)
- Create: `crates/agicash-traits/src/user_storage.rs` (initial scaffold, types only)
- Modify: `crates/agicash-traits/src/lib.rs`

These are the input/output shapes for the `upsert_user_with_accounts` Supabase RPC. From the migrations (the function was redefined in `20260415180000_add_gift_card_mint_terms.sql` to add two optional `*_terms_accepted_at` parameters) and the slice-3 research, the inputs mirror the `p_*` parameter names and the result is a composite of `user` + `accounts[]` (jsonb array). We expose them as serde-friendly structs; field names use snake_case to match the JSONB payload Postgres expects when calling the function via REST. The two `*_terms_accepted_at` params have Postgres `default null`, so we mark them `Option<DateTime<Utc>>` and `#[serde(skip_serializing_if = "Option::is_none")]` so omission is wire-equivalent to default.

- [ ] **Step 0: Add `chrono` to `agicash-traits` deps**

Edit `crates/agicash-traits/Cargo.toml`. Add `chrono = { workspace = true }` to `[dependencies]`:

```toml
[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-crypto = { path = "../agicash-crypto" }
async-trait = { workspace = true }
chrono = { workspace = true }
serde = { workspace = true }
thiserror = { workspace = true }
uuid = { workspace = true }
```

- [ ] **Step 1: Write the failing tests**

Create `crates/agicash-traits/src/user_storage.rs`:

```rust
use crate::StorageError;
use agicash_domain::{Account, AccountPurpose, AccountId, AccountType, Currency, User, UserId};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod types_tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn account_input_serializes_with_snake_case_fields() {
        let input = AccountInput {
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            name: "Lightning".into(),
            details: json!({"network": "MAINNET"}),
            is_default: true,
        };
        let v = serde_json::to_value(&input).unwrap();
        assert_eq!(v.get("type").and_then(|v| v.as_str()), Some("spark"));
        assert_eq!(v.get("purpose").and_then(|v| v.as_str()), Some("transactional"));
        assert_eq!(v.get("currency").and_then(|v| v.as_str()), Some("BTC"));
        assert_eq!(v.get("name").and_then(|v| v.as_str()), Some("Lightning"));
        assert_eq!(v.get("is_default").and_then(|v| v.as_bool()), Some(true));
        assert!(v.get("details").unwrap().is_object());
    }

    #[test]
    fn upsert_user_input_serializes_with_p_prefixed_params() {
        let input = UpsertUserInput {
            user_id: UserId::from(Uuid::nil()),
            email: Some("u@example.com".into()),
            email_verified: true,
            accounts: vec![AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: "Lightning".into(),
                details: json!({"network": "MAINNET"}),
                is_default: true,
            }],
            cashu_locking_xpub: "xpub6...".into(),
            encryption_public_key: "schnorr-pub".into(),
            spark_identity_public_key: "spark-pub".into(),
        };
        let v = serde_json::to_value(&input).unwrap();
        // postgrest RPC body uses the function's parameter names verbatim,
        // which are prefixed with p_ in our schema.
        assert!(v.get("p_user_id").is_some());
        assert!(v.get("p_email").is_some());
        assert!(v.get("p_email_verified").is_some());
        assert!(v.get("p_accounts").is_some());
        assert!(v.get("p_cashu_locking_xpub").is_some());
        assert!(v.get("p_encryption_public_key").is_some());
        assert!(v.get("p_spark_identity_public_key").is_some());
        assert!(v.get("p_accounts").unwrap().is_array());
    }

    #[test]
    fn upsert_user_result_deserializes_from_composite_payload() {
        // postgrest returns the composite as: { "user": {...}, "accounts": [...] }
        let raw = json!({
            "user": {
                "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "created_at": "2026-03-01T12:00:00Z",
                "email": null,
                "email_verified": false,
                "username": "user-abc",
                "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
                "default_usd_account_id": null,
                "default_currency": "BTC",
                "cashu_locking_xpub": "xpub",
                "encryption_public_key": "enc",
                "spark_identity_public_key": "spark",
                "terms_accepted_at": "2026-03-01T12:00:00Z",
                "gift_card_mint_terms_accepted_at": null
            },
            "accounts": [
                {
                    "id": "11111111-2222-3333-4444-555555555555",
                    "created_at": "2026-03-01T12:00:00Z",
                    "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    "name": "Lightning",
                    "type": "spark",
                    "purpose": "transactional",
                    "currency": "BTC",
                    "details": {"network": "MAINNET"},
                    "version": 0,
                    "state": "active",
                    "expires_at": null
                }
            ]
        });
        let parsed: UpsertUserResult = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.user.username, "user-abc");
        assert_eq!(parsed.accounts.len(), 1);
        assert_eq!(parsed.accounts[0].name, "Lightning");
    }
}
```

- [ ] **Step 2: Wire the module into `lib.rs`**

Replace `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls.

pub mod error;
pub mod key_options;
pub mod key_provider;
pub mod session_storage;
pub mod storage_error;
pub mod token_provider;
pub mod user_storage;

pub use error::*;
pub use key_options::*;
pub use key_provider::*;
pub use session_storage::*;
pub use storage_error::*;
pub use token_provider::*;
pub use user_storage::*;
```

- [ ] **Step 3: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `AccountInput`, `UpsertUserInput`, `UpsertUserResult` do not exist.

- [ ] **Step 4: Implement the types (no trait yet — that's Task 8)**

Replace `crates/agicash-traits/src/user_storage.rs`:

```rust
use crate::StorageError;
use agicash_domain::{Account, AccountId, AccountPurpose, AccountType, Currency, User, UserId};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

/// Element of `p_accounts` in `wallet.upsert_user_with_accounts`.
/// Field order matches the `wallet.account_input` composite type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct AccountInput {
    #[serde(rename = "type")]
    pub account_type: AccountType,
    pub purpose: AccountPurpose,
    pub currency: Currency,
    pub name: String,
    pub details: serde_json::Value,
    pub is_default: bool,
}

/// Input shape for `UserStorage::upsert_user_with_accounts`.
///
/// Field names use the `p_*` prefix to match the Postgres function's parameter
/// names; postgrest serializes the struct directly as the RPC body.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsertUserInput {
    #[serde(rename = "p_user_id")]
    pub user_id: UserId,
    #[serde(rename = "p_email")]
    pub email: Option<String>,
    #[serde(rename = "p_email_verified")]
    pub email_verified: bool,
    #[serde(rename = "p_accounts")]
    pub accounts: Vec<AccountInput>,
    #[serde(rename = "p_cashu_locking_xpub")]
    pub cashu_locking_xpub: String,
    #[serde(rename = "p_encryption_public_key")]
    pub encryption_public_key: String,
    #[serde(rename = "p_spark_identity_public_key")]
    pub spark_identity_public_key: String,
    #[serde(
        rename = "p_terms_accepted_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
    #[serde(
        rename = "p_gift_card_mint_terms_accepted_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub gift_card_mint_terms_accepted_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// Output of `UserStorage::upsert_user_with_accounts`.
/// Postgres composite `wallet.upsert_user_with_accounts_result` is shaped
/// `{ "user": <users row>, "accounts": [<accounts rows>] }` when REST-encoded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UpsertUserResult {
    pub user: User,
    pub accounts: Vec<Account>,
}

#[cfg(test)]
mod types_tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    #[test]
    fn account_input_serializes_with_snake_case_fields() {
        let input = AccountInput {
            account_type: AccountType::Spark,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            name: "Lightning".into(),
            details: json!({"network": "MAINNET"}),
            is_default: true,
        };
        let v = serde_json::to_value(&input).unwrap();
        assert_eq!(v.get("type").and_then(|v| v.as_str()), Some("spark"));
        assert_eq!(v.get("purpose").and_then(|v| v.as_str()), Some("transactional"));
        assert_eq!(v.get("currency").and_then(|v| v.as_str()), Some("BTC"));
        assert_eq!(v.get("name").and_then(|v| v.as_str()), Some("Lightning"));
        assert_eq!(v.get("is_default").and_then(|v| v.as_bool()), Some(true));
        assert!(v.get("details").unwrap().is_object());
    }

    #[test]
    fn upsert_user_input_serializes_with_p_prefixed_params() {
        let input = UpsertUserInput {
            user_id: UserId::from(Uuid::nil()),
            email: Some("u@example.com".into()),
            email_verified: true,
            accounts: vec![AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: "Lightning".into(),
                details: json!({"network": "MAINNET"}),
                is_default: true,
            }],
            cashu_locking_xpub: "xpub6...".into(),
            encryption_public_key: "schnorr-pub".into(),
            spark_identity_public_key: "spark-pub".into(),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        };
        let v = serde_json::to_value(&input).unwrap();
        assert!(v.get("p_user_id").is_some());
        assert!(v.get("p_email").is_some());
        assert!(v.get("p_email_verified").is_some());
        assert!(v.get("p_accounts").is_some());
        assert!(v.get("p_cashu_locking_xpub").is_some());
        assert!(v.get("p_encryption_public_key").is_some());
        assert!(v.get("p_spark_identity_public_key").is_some());
        assert!(v.get("p_accounts").unwrap().is_array());
        // Optional terms fields omitted from serialization when None.
        assert!(v.get("p_terms_accepted_at").is_none());
        assert!(v.get("p_gift_card_mint_terms_accepted_at").is_none());
    }

    #[test]
    fn upsert_user_result_deserializes_from_composite_payload() {
        let raw = json!({
            "user": {
                "id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "created_at": "2026-03-01T12:00:00Z",
                "email": null,
                "email_verified": false,
                "username": "user-abc",
                "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
                "default_usd_account_id": null,
                "default_currency": "BTC",
                "cashu_locking_xpub": "xpub",
                "encryption_public_key": "enc",
                "spark_identity_public_key": "spark",
                "terms_accepted_at": "2026-03-01T12:00:00Z",
                "gift_card_mint_terms_accepted_at": null
            },
            "accounts": [
                {
                    "id": "11111111-2222-3333-4444-555555555555",
                    "created_at": "2026-03-01T12:00:00Z",
                    "user_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                    "name": "Lightning",
                    "type": "spark",
                    "purpose": "transactional",
                    "currency": "BTC",
                    "details": {"network": "MAINNET"},
                    "version": 0,
                    "state": "active",
                    "expires_at": null
                }
            ]
        });
        let parsed: UpsertUserResult = serde_json::from_value(raw).unwrap();
        assert_eq!(parsed.user.username, "user-abc");
        assert_eq!(parsed.accounts.len(), 1);
        assert_eq!(parsed.accounts[0].name, "Lightning");
    }
}
```

- [ ] **Step 5: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS — 3 new types tests pass; existing tests still green.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-traits
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(traits): add UpsertUserInput, UpsertUserResult, AccountInput types"
```

---

## Task 8: `agicash-traits` — `UserStorage` trait

**Files:**
- Modify: `crates/agicash-traits/src/user_storage.rs`

Adds the trait alongside the types already in the file. Four methods: 1 RPC + 3 direct table reads. Compile-only test via a `DummyStorage` impl in `#[cfg(test)]`.

- [ ] **Step 1: Append the failing trait usage test**

Append to `crates/agicash-traits/src/user_storage.rs` (after the `types_tests` mod):

```rust
#[cfg(test)]
mod trait_tests {
    use super::*;
    use serde_json::json;
    use uuid::Uuid;

    struct DummyStorage;

    #[async_trait]
    impl UserStorage for DummyStorage {
        async fn upsert_user_with_accounts(
            &self,
            _input: UpsertUserInput,
        ) -> Result<UpsertUserResult, StorageError> {
            Err(StorageError::Internal("dummy".into()))
        }

        async fn get_user(&self, _user_id: UserId) -> Result<Option<User>, StorageError> {
            Ok(None)
        }

        async fn list_accounts(&self, _user_id: UserId) -> Result<Vec<Account>, StorageError> {
            Ok(Vec::new())
        }

        async fn get_account(
            &self,
            _account_id: AccountId,
        ) -> Result<Option<Account>, StorageError> {
            Ok(None)
        }
    }

    #[tokio::test]
    async fn dummy_storage_implements_user_storage() {
        let s = DummyStorage;
        assert!(matches!(
            s.upsert_user_with_accounts(UpsertUserInput {
                user_id: UserId::from(Uuid::nil()),
                email: None,
                email_verified: false,
                accounts: vec![],
                cashu_locking_xpub: "x".into(),
                encryption_public_key: "e".into(),
                spark_identity_public_key: "s".into(),
                terms_accepted_at: None,
                gift_card_mint_terms_accepted_at: None,
            })
            .await,
            Err(StorageError::Internal(_))
        ));
        assert!(s.get_user(UserId::from(Uuid::nil())).await.unwrap().is_none());
        assert!(s.list_accounts(UserId::from(Uuid::nil())).await.unwrap().is_empty());
        assert!(s.get_account(AccountId::from(Uuid::nil())).await.unwrap().is_none());
    }
}
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-traits`

Expected: FAIL — `UserStorage` trait does not exist.

- [ ] **Step 3: Define the trait**

In `crates/agicash-traits/src/user_storage.rs`, insert the trait definition between the `UpsertUserResult` struct and the `types_tests` mod:

```rust
#[async_trait]
pub trait UserStorage: Send + Sync {
    /// Real Supabase RPC: `wallet.upsert_user_with_accounts`. Idempotent on
    /// `user_id`; safe to call repeatedly. Returns the resulting user row plus
    /// all of that user's accounts.
    async fn upsert_user_with_accounts(
        &self,
        input: UpsertUserInput,
    ) -> Result<UpsertUserResult, StorageError>;

    /// Direct postgrest select on `wallet.users` by id. Returns `Ok(None)` if
    /// the user row doesn't exist (e.g., guest hasn't been upserted yet).
    async fn get_user(&self, user_id: UserId) -> Result<Option<User>, StorageError>;

    /// Direct postgrest select on `wallet.accounts` filtered by
    /// `user_id = <uuid>` AND `state = 'active'`. Returns rows in postgrest's
    /// natural order (server-defined). Callers that need a stable order should
    /// sort client-side.
    async fn list_accounts(&self, user_id: UserId) -> Result<Vec<Account>, StorageError>;

    /// Direct postgrest select on `wallet.accounts` by id. Returns `Ok(None)`
    /// if no row matches. Does NOT filter by state — expired accounts are
    /// still readable via this method.
    async fn get_account(&self, account_id: AccountId)
        -> Result<Option<Account>, StorageError>;
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-traits`

Expected: PASS — `DummyStorage` compiles and the smoke test runs.

- [ ] **Step 5: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-traits
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(traits): add UserStorage trait with 4 methods (1 RPC + 3 direct queries)"
```

---

## Task 9: `agicash-storage-supabase` — deps and `SupabaseStorageConfig`

**Files:**
- Modify: `crates/agicash-storage-supabase/Cargo.toml`
- Create: `crates/agicash-storage-supabase/src/config.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

The config reads `SUPABASE_URL` and `SUPABASE_ANON_KEY` from env. **Important env var quirk:** the existing `.env` in `~/agicash/.claude/worktrees/rust-auth/.env` uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Vite-prefixed for the JS app). To avoid forcing a `.env` rewrite, `from_env()` reads `SUPABASE_URL` first, falling back to `VITE_SUPABASE_URL`; same for the anon key. This is the single place this fallback lives — it's a one-time accommodation for the dev `.env`, not a long-term API design.

- [ ] **Step 1: Update the crate manifest**

Replace `crates/agicash-storage-supabase/Cargo.toml`:

```toml
[package]
name = "agicash-storage-supabase"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-traits = { path = "../agicash-traits" }
async-trait = { workspace = true }
postgrest = { workspace = true }
reqwest = { workspace = true }
serde = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }
uuid = { workspace = true }
chrono = { workspace = true }

[dev-dependencies]
tokio = { workspace = true }
wiremock = { workspace = true }
serde_json = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Write the failing config tests**

Create `crates/agicash-storage-supabase/src/config.rs`:

```rust
use agicash_traits::StorageError;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_env_vars_parses_happy_path() {
        let cfg = SupabaseStorageConfig::from_env_vars(
            |name| match name {
                "SUPABASE_URL" => Ok("https://test.supabase.co".to_string()),
                "SUPABASE_ANON_KEY" => Ok("anon-key-abc".to_string()),
                _ => Err(()),
            },
        )
        .unwrap();
        assert_eq!(cfg.url, "https://test.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key-abc");
    }

    #[test]
    fn from_env_vars_falls_back_to_vite_prefix() {
        let cfg = SupabaseStorageConfig::from_env_vars(
            |name| match name {
                "VITE_SUPABASE_URL" => Ok("https://test.supabase.co".to_string()),
                "VITE_SUPABASE_ANON_KEY" => Ok("anon-key-abc".to_string()),
                _ => Err(()),
            },
        )
        .unwrap();
        assert_eq!(cfg.url, "https://test.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key-abc");
    }

    #[test]
    fn from_env_vars_reports_missing_url() {
        let err = SupabaseStorageConfig::from_env_vars(
            |name| match name {
                "SUPABASE_ANON_KEY" => Ok("anon".into()),
                _ => Err(()),
            },
        )
        .unwrap_err();
        assert!(matches!(err, StorageError::Internal(_)));
        assert!(err.to_string().contains("SUPABASE_URL"));
    }

    #[test]
    fn from_env_vars_reports_missing_anon_key() {
        let err = SupabaseStorageConfig::from_env_vars(
            |name| match name {
                "SUPABASE_URL" => Ok("https://test.supabase.co".into()),
                _ => Err(()),
            },
        )
        .unwrap_err();
        assert!(matches!(err, StorageError::Internal(_)));
        assert!(err.to_string().contains("SUPABASE_ANON_KEY"));
    }
}
```

- [ ] **Step 3: Wire into `lib.rs`**

Replace `crates/agicash-storage-supabase/src/lib.rs`:

```rust
//! Storage trait impls over postgrest. Mirrors the Supabase REST surface.

pub mod config;

pub use config::*;
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: FAIL — `SupabaseStorageConfig` does not exist.

- [ ] **Step 5: Implement `SupabaseStorageConfig`**

Replace `crates/agicash-storage-supabase/src/config.rs`:

```rust
use agicash_traits::StorageError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SupabaseStorageConfig {
    pub url: String,
    pub anon_key: String,
}

impl SupabaseStorageConfig {
    /// Load config from process env vars. Reads `SUPABASE_URL` first, falling
    /// back to `VITE_SUPABASE_URL`; same for the anon key. This accommodates
    /// the dev `.env` shared with the JS app.
    pub fn from_env() -> Result<Self, StorageError> {
        Self::from_env_vars(|name| std::env::var(name).map_err(|_| ()))
    }

    /// Test-friendly variant taking an env-var getter closure.
    pub fn from_env_vars<F>(get: F) -> Result<Self, StorageError>
    where
        F: Fn(&str) -> Result<String, ()>,
    {
        let url = get("SUPABASE_URL")
            .or_else(|_| get("VITE_SUPABASE_URL"))
            .map_err(|_| {
                StorageError::Internal(
                    "missing env var: SUPABASE_URL (or VITE_SUPABASE_URL)".into(),
                )
            })?;
        let anon_key = get("SUPABASE_ANON_KEY")
            .or_else(|_| get("VITE_SUPABASE_ANON_KEY"))
            .map_err(|_| {
                StorageError::Internal(
                    "missing env var: SUPABASE_ANON_KEY (or VITE_SUPABASE_ANON_KEY)".into(),
                )
            })?;
        Ok(Self { url, anon_key })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn from_env_vars_parses_happy_path() {
        let cfg = SupabaseStorageConfig::from_env_vars(|name| match name {
            "SUPABASE_URL" => Ok("https://test.supabase.co".to_string()),
            "SUPABASE_ANON_KEY" => Ok("anon-key-abc".to_string()),
            _ => Err(()),
        })
        .unwrap();
        assert_eq!(cfg.url, "https://test.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key-abc");
    }

    #[test]
    fn from_env_vars_falls_back_to_vite_prefix() {
        let cfg = SupabaseStorageConfig::from_env_vars(|name| match name {
            "VITE_SUPABASE_URL" => Ok("https://test.supabase.co".to_string()),
            "VITE_SUPABASE_ANON_KEY" => Ok("anon-key-abc".to_string()),
            _ => Err(()),
        })
        .unwrap();
        assert_eq!(cfg.url, "https://test.supabase.co");
        assert_eq!(cfg.anon_key, "anon-key-abc");
    }

    #[test]
    fn from_env_vars_reports_missing_url() {
        let err = SupabaseStorageConfig::from_env_vars(|name| match name {
            "SUPABASE_ANON_KEY" => Ok("anon".into()),
            _ => Err(()),
        })
        .unwrap_err();
        assert!(matches!(err, StorageError::Internal(_)));
        assert!(err.to_string().contains("SUPABASE_URL"));
    }

    #[test]
    fn from_env_vars_reports_missing_anon_key() {
        let err = SupabaseStorageConfig::from_env_vars(|name| match name {
            "SUPABASE_URL" => Ok("https://test.supabase.co".into()),
            _ => Err(()),
        })
        .unwrap_err();
        assert!(matches!(err, StorageError::Internal(_)));
        assert!(err.to_string().contains("SUPABASE_ANON_KEY"));
    }
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase crates/Cargo.lock
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(storage-supabase): add SupabaseStorageConfig with env loading"
```

---

## Task 10: `agicash-storage-supabase` — `SupabaseStorage` skeleton

**Files:**
- Create: `crates/agicash-storage-supabase/src/error.rs`
- Create: `crates/agicash-storage-supabase/src/client.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

The struct holds a `postgrest::Postgrest` client, an `Arc<dyn TokenProvider + Send + Sync>`, and the anon key. The `authenticated_client()` helper returns a `postgrest::Postgrest` builder with per-request headers set: `Authorization: Bearer <jwt>` and `apikey: <anon_key>`. Postgrest builders mutate per-call (consuming `self` and returning a new builder), so the helper is `async` (awaiting the JWT) and returns the headered client.

Because `postgrest::Error` is foreign and `reqwest::Error` is foreign and we already control `StorageError`, **all conversions go through free helper functions** (orphan rule). See spec §11. Slice 2's `agicash-auth-opensecret/src/error.rs` is the precedent.

- [ ] **Step 1: Create the error helpers module**

Create `crates/agicash-storage-supabase/src/error.rs`:

```rust
use agicash_traits::StorageError;

/// Map a postgrest error to a `StorageError`. Postgrest 1.6's error type is
/// just `Box<dyn std::error::Error + Send + Sync>` — there's no rich variant
/// enum we can match on, so we collapse to `Backend(String)`.
pub fn map_postgrest_error(err: impl std::fmt::Display) -> StorageError {
    StorageError::Backend(format!("postgrest: {err}"))
}

/// Map a `reqwest::Error` to a `StorageError`, distinguishing network errors
/// from response/decode errors.
pub fn map_reqwest_error(err: reqwest::Error) -> StorageError {
    if err.is_connect() || err.is_timeout() || err.is_request() {
        StorageError::Network(format!("{err}"))
    } else {
        StorageError::Backend(format!("reqwest: {err}"))
    }
}

/// Map a `serde_json::Error` to a `StorageError`.
pub fn map_json_error(err: serde_json::Error) -> StorageError {
    StorageError::Backend(format!("json decode: {err}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_postgrest_error_is_backend() {
        let err = map_postgrest_error("oops");
        assert!(matches!(err, StorageError::Backend(_)));
        assert!(err.to_string().contains("oops"));
    }

    #[test]
    fn map_json_error_is_backend() {
        // Force a serde_json error.
        let err: serde_json::Error =
            serde_json::from_str::<i32>("not-an-int").unwrap_err();
        let mapped = map_json_error(err);
        assert!(matches!(mapped, StorageError::Backend(_)));
    }
}
```

- [ ] **Step 2: Create the client skeleton**

Create `crates/agicash-storage-supabase/src/client.rs`:

```rust
use crate::SupabaseStorageConfig;
use agicash_traits::{StorageError, TokenProvider};
use std::sync::Arc;

/// Schema name in the Supabase project where all wallet tables live.
pub(crate) const WALLET_SCHEMA: &str = "wallet";

#[derive(Clone)]
pub struct SupabaseStorage {
    /// REST endpoint base (e.g. `https://xxx.supabase.co/rest/v1`).
    pub(crate) rest_url: String,
    pub(crate) anon_key: String,
    pub(crate) tokens: Arc<dyn TokenProvider + Send + Sync>,
    pub(crate) http: reqwest::Client,
}

impl std::fmt::Debug for SupabaseStorage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SupabaseStorage")
            .field("rest_url", &self.rest_url)
            .field("anon_key", &"<redacted>")
            .finish()
    }
}

impl SupabaseStorage {
    pub fn new(
        config: SupabaseStorageConfig,
        tokens: Arc<dyn TokenProvider + Send + Sync>,
    ) -> Result<Self, StorageError> {
        // Normalize `<base>` -> `<base>/rest/v1`. Strip a trailing slash if any.
        let base = config.url.trim_end_matches('/');
        let rest_url = format!("{base}/rest/v1");
        let http = reqwest::Client::builder()
            .build()
            .map_err(|e| StorageError::Internal(format!("build reqwest client: {e}")))?;
        Ok(Self {
            rest_url,
            anon_key: config.anon_key,
            tokens,
            http,
        })
    }

    /// Build a `postgrest::Postgrest` instance scoped to the `wallet` schema
    /// with per-request auth headers. Called once per RPC/select.
    pub(crate) async fn authenticated_client(
        &self,
    ) -> Result<postgrest::Postgrest, StorageError> {
        let jwt = self
            .tokens
            .get_jwt()
            .await
            .map_err(|e| StorageError::Backend(format!("token provider: {e}")))?;
        let client = postgrest::Postgrest::new(&self.rest_url)
            .schema(WALLET_SCHEMA)
            .insert_header("apikey", &self.anon_key)
            .insert_header("Authorization", format!("Bearer {jwt}"));
        Ok(client)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agicash_traits::AuthError;
    use async_trait::async_trait;

    struct StubTokens;

    #[async_trait]
    impl TokenProvider for StubTokens {
        async fn get_jwt(&self) -> Result<String, AuthError> {
            Ok("stub.jwt.token".into())
        }
    }

    #[test]
    fn constructor_normalizes_trailing_slash() {
        let cfg = SupabaseStorageConfig {
            url: "https://test.supabase.co/".into(),
            anon_key: "anon".into(),
        };
        let s = SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap();
        assert_eq!(s.rest_url, "https://test.supabase.co/rest/v1");
    }

    #[tokio::test]
    async fn authenticated_client_calls_token_provider() {
        let cfg = SupabaseStorageConfig {
            url: "https://test.supabase.co".into(),
            anon_key: "anon-key".into(),
        };
        let s = SupabaseStorage::new(cfg, Arc::new(StubTokens)).unwrap();
        // Just verifies the helper returns Ok; we'll cover request shape in
        // Task 11's wiremock tests.
        let _client = s.authenticated_client().await.unwrap();
    }
}
```

- [ ] **Step 3: Wire into `lib.rs`**

Replace `crates/agicash-storage-supabase/src/lib.rs`:

```rust
//! Storage trait impls over postgrest. Mirrors the Supabase REST surface.

pub mod client;
pub mod config;
pub mod error;

pub use client::*;
pub use config::*;
pub use error::*;
```

- [ ] **Step 4: Run tests — expect pass (or first failure)**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: PASS — 2 client tests + 2 error tests + 4 config tests.

If postgrest's `.schema(...)` doesn't exist on 1.6 (it should — verify via `cargo doc --open -p postgrest`), the alternative is to set `Accept-Profile: wallet` and `Content-Profile: wallet` headers manually. Either is acceptable; the test in Task 11 verifies the on-wire shape.

- [ ] **Step 5: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase crates/Cargo.lock
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
feat(storage-supabase): add SupabaseStorage skeleton + error helpers

Holds a postgrest client + Arc<dyn TokenProvider>. The authenticated_client
helper injects Authorization and apikey headers per request, scoped to the
wallet schema. Foreign error types (postgrest, reqwest, serde_json) are
mapped through free helper functions per the orphan-rule constraint.
EOF
)"
```

---

## Task 11: `agicash-storage-supabase` — `list_accounts` impl with wiremock

**Files:**
- Create: `crates/agicash-storage-supabase/src/user_storage.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

This is the meatiest task in the slice. `list_accounts(user_id)` becomes a `GET <rest_url>/accounts?user_id=eq.<uuid>&state=eq.active&select=*` with `Accept-Profile: wallet`, `Authorization`, `apikey` headers. The response is a JSON array; we parse it directly into `Vec<Account>`. The wiremock test asserts the URL path, query string, and headers, then returns a stubbed two-account array.

- [ ] **Step 1: Create the user_storage module with the failing wiremock test**

Create `crates/agicash-storage-supabase/src/user_storage.rs`:

```rust
use crate::{SupabaseStorage, map_json_error, map_postgrest_error};
use agicash_domain::{Account, AccountId, User, UserId};
use agicash_traits::{
    StorageError, UpsertUserInput, UpsertUserResult, UserStorage,
};
use async_trait::async_trait;

#[async_trait]
impl UserStorage for SupabaseStorage {
    async fn upsert_user_with_accounts(
        &self,
        _input: UpsertUserInput,
    ) -> Result<UpsertUserResult, StorageError> {
        // Filled in Task 14.
        Err(StorageError::Internal("not yet implemented".into()))
    }

    async fn get_user(&self, _user_id: UserId) -> Result<Option<User>, StorageError> {
        // Filled in Task 12.
        Err(StorageError::Internal("not yet implemented".into()))
    }

    async fn list_accounts(&self, user_id: UserId) -> Result<Vec<Account>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from("accounts")
            .select("*")
            .eq("user_id", user_id.to_string())
            .eq("state", "active")
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "list_accounts: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(crate::map_reqwest_error)?;
        serde_json::from_str::<Vec<Account>>(&body).map_err(map_json_error)
    }

    async fn get_account(
        &self,
        _account_id: AccountId,
    ) -> Result<Option<Account>, StorageError> {
        // Filled in Task 13.
        Err(StorageError::Internal("not yet implemented".into()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::SupabaseStorageConfig;
    use agicash_traits::{AuthError, TokenProvider};
    use async_trait::async_trait;
    use serde_json::json;
    use std::sync::Arc;
    use uuid::Uuid;
    use wiremock::matchers::{header, method, path, query_param};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    struct StubTokens(&'static str);

    #[async_trait]
    impl TokenProvider for StubTokens {
        async fn get_jwt(&self) -> Result<String, AuthError> {
            Ok(self.0.to_string())
        }
    }

    fn storage_for(server: &MockServer) -> SupabaseStorage {
        let cfg = SupabaseStorageConfig {
            url: server.uri(),
            anon_key: "test-anon-key".into(),
        };
        SupabaseStorage::new(cfg, Arc::new(StubTokens("stub-jwt-token"))).unwrap()
    }

    fn sample_user_id() -> UserId {
        UserId::from(Uuid::parse_str("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee").unwrap())
    }

    fn two_account_payload(user_id: UserId) -> serde_json::Value {
        json!([
            {
                "id": "11111111-2222-3333-4444-555555555555",
                "created_at": "2026-03-01T12:00:00Z",
                "user_id": user_id.to_string(),
                "name": "Lightning",
                "type": "spark",
                "purpose": "transactional",
                "currency": "BTC",
                "details": {"network": "MAINNET"},
                "version": 0,
                "state": "active",
                "expires_at": null
            },
            {
                "id": "22222222-3333-4444-5555-666666666666",
                "created_at": "2026-03-01T12:00:00Z",
                "user_id": user_id.to_string(),
                "name": "Mint",
                "type": "cashu",
                "purpose": "transactional",
                "currency": "BTC",
                "details": {"mint_url": "https://mint.example"},
                "version": 0,
                "state": "active",
                "expires_at": null
            }
        ])
    }

    #[tokio::test]
    async fn list_accounts_sends_authenticated_request_and_parses_response() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();

        Mock::given(method("GET"))
            .and(path("/rest/v1/accounts"))
            .and(query_param("user_id", format!("eq.{user_id}")))
            .and(query_param("state", "eq.active"))
            .and(query_param("select", "*"))
            .and(header("apikey", "test-anon-key"))
            .and(header("authorization", "Bearer stub-jwt-token"))
            // postgrest's .schema("wallet") emits Accept-Profile: wallet.
            .and(header("accept-profile", "wallet"))
            .respond_with(ResponseTemplate::new(200).set_body_json(two_account_payload(user_id)))
            .expect(1)
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let accounts = storage.list_accounts(user_id).await.unwrap();
        assert_eq!(accounts.len(), 2);
        assert_eq!(accounts[0].name, "Lightning");
        assert_eq!(accounts[1].name, "Mint");
    }

    #[tokio::test]
    async fn list_accounts_empty_array_returns_empty_vec() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();
        Mock::given(method("GET"))
            .and(path("/rest/v1/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let accounts = storage.list_accounts(user_id).await.unwrap();
        assert!(accounts.is_empty());
    }

    #[tokio::test]
    async fn list_accounts_surfaces_http_error_as_backend() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();
        Mock::given(method("GET"))
            .and(path("/rest/v1/accounts"))
            .respond_with(ResponseTemplate::new(500).set_body_string("server boom"))
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let err = storage.list_accounts(user_id).await.unwrap_err();
        assert!(matches!(err, StorageError::Backend(_)));
    }
}
```

- [ ] **Step 2: Wire into `lib.rs`**

Replace `crates/agicash-storage-supabase/src/lib.rs`:

```rust
//! Storage trait impls over postgrest. Mirrors the Supabase REST surface.

pub mod client;
pub mod config;
pub mod error;
pub mod user_storage;

pub use client::*;
pub use config::*;
pub use error::*;
```

(Note: `user_storage` defines an `impl` block, not new public types — no `pub use` needed.)

- [ ] **Step 3: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: PASS — all three wiremock tests pass; existing config/client/error tests still pass.

If the `Accept-Profile` assertion fails, postgrest 1.6 may handle schema selection differently. Inspect the actual request via `wiremock`'s diagnostic output and adjust the matcher. The semantic requirement is that postgrest targets the `wallet` schema; the exact header name is the wire detail to verify.

If the `query_param("select", "*")` assertion fails, postgrest may omit the param when set explicitly to `"*"` (since `*` is the default). In that case drop the `select` matcher and assert on the other params only.

- [ ] **Step 4: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase crates/Cargo.lock
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
feat(storage-supabase): implement UserStorage::list_accounts via postgrest

GET /rest/v1/accounts?user_id=eq.<uuid>&state=eq.active with wallet
schema profile + Bearer token + apikey. Hermetic wiremock tests cover
happy path, empty result, and HTTP 5xx mapping to Backend error.
EOF
)"
```

---

## Task 12: `agicash-storage-supabase` — `get_user` impl

**Files:**
- Modify: `crates/agicash-storage-supabase/src/user_storage.rs`

Direct select on `wallet.users` by id. Returns `Ok(None)` when no row matches. Postgrest with `.single()` returns a 406 when the result set is empty (and a 200 with the row when found). We do NOT use `.single()` — we ask for a list (`select * where id=eq.<uuid>`) and return `Some(rows.into_iter().next())`. That keeps the not-found case as `Ok(None)` rather than needing to interpret a non-200 status.

- [ ] **Step 1: Add the failing test for the not-found path**

Append to the `tests` mod in `crates/agicash-storage-supabase/src/user_storage.rs`:

```rust
    fn sample_user_payload(user_id: UserId) -> serde_json::Value {
        json!({
            "id": user_id.to_string(),
            "created_at": "2026-03-01T12:00:00Z",
            "email": null,
            "email_verified": false,
            "username": "user-eeeeeeeeeeee",
            "default_btc_account_id": "11111111-2222-3333-4444-555555555555",
            "default_usd_account_id": null,
            "default_currency": "BTC",
            "cashu_locking_xpub": "xpub",
            "encryption_public_key": "enc",
            "spark_identity_public_key": "spark",
            "terms_accepted_at": "2026-03-01T12:00:00Z",
            "gift_card_mint_terms_accepted_at": null
        })
    }

    #[tokio::test]
    async fn get_user_found_returns_some() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();
        Mock::given(method("GET"))
            .and(path("/rest/v1/users"))
            .and(query_param("id", format!("eq.{user_id}")))
            .and(header("authorization", "Bearer stub-jwt-token"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(json!([sample_user_payload(user_id)])),
            )
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let user = storage.get_user(user_id).await.unwrap();
        assert!(user.is_some());
        assert_eq!(user.unwrap().username, "user-eeeeeeeeeeee");
    }

    #[tokio::test]
    async fn get_user_not_found_returns_none() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();
        Mock::given(method("GET"))
            .and(path("/rest/v1/users"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let user = storage.get_user(user_id).await.unwrap();
        assert!(user.is_none());
    }
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: FAIL — `get_user` still returns `not yet implemented`.

- [ ] **Step 3: Implement `get_user`**

In `crates/agicash-storage-supabase/src/user_storage.rs`, replace the stub `get_user` body with:

```rust
    async fn get_user(&self, user_id: UserId) -> Result<Option<User>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from("users")
            .select("*")
            .eq("id", user_id.to_string())
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "get_user: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(crate::map_reqwest_error)?;
        let rows: Vec<User> = serde_json::from_str(&body).map_err(map_json_error)?;
        Ok(rows.into_iter().next())
    }
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: PASS — both `get_user` tests pass.

- [ ] **Step 5: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(storage-supabase): implement UserStorage::get_user via postgrest"
```

---

## Task 13: `agicash-storage-supabase` — `get_account` impl

**Files:**
- Modify: `crates/agicash-storage-supabase/src/user_storage.rs`

Same pattern as `get_user` but on `wallet.accounts` by id. No `state` filter — `get_account` returns expired accounts too (callers decide what to do with them).

- [ ] **Step 1: Add the failing tests**

Append to the `tests` mod:

```rust
    fn sample_account_payload(account_id: AccountId, user_id: UserId) -> serde_json::Value {
        json!({
            "id": account_id.to_string(),
            "created_at": "2026-03-01T12:00:00Z",
            "user_id": user_id.to_string(),
            "name": "Single account",
            "type": "spark",
            "purpose": "transactional",
            "currency": "BTC",
            "details": {"network": "MAINNET"},
            "version": 0,
            "state": "active",
            "expires_at": null
        })
    }

    #[tokio::test]
    async fn get_account_found_returns_some() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();
        let account_id =
            AccountId::from(Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap());
        Mock::given(method("GET"))
            .and(path("/rest/v1/accounts"))
            .and(query_param("id", format!("eq.{account_id}")))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(json!([sample_account_payload(account_id, user_id)])),
            )
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let account = storage.get_account(account_id).await.unwrap();
        assert!(account.is_some());
        assert_eq!(account.unwrap().name, "Single account");
    }

    #[tokio::test]
    async fn get_account_not_found_returns_none() {
        let server = MockServer::start().await;
        let account_id =
            AccountId::from(Uuid::parse_str("11111111-2222-3333-4444-555555555555").unwrap());
        Mock::given(method("GET"))
            .and(path("/rest/v1/accounts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!([])))
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let account = storage.get_account(account_id).await.unwrap();
        assert!(account.is_none());
    }
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: FAIL — `get_account` still returns `not yet implemented`.

- [ ] **Step 3: Implement `get_account`**

Replace the stub `get_account` body with:

```rust
    async fn get_account(
        &self,
        account_id: AccountId,
    ) -> Result<Option<Account>, StorageError> {
        let client = self.authenticated_client().await?;
        let response = client
            .from("accounts")
            .select("*")
            .eq("id", account_id.to_string())
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "get_account: HTTP {}",
                response.status()
            )));
        }
        let body = response.text().await.map_err(crate::map_reqwest_error)?;
        let rows: Vec<Account> = serde_json::from_str(&body).map_err(map_json_error)?;
        Ok(rows.into_iter().next())
    }
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(storage-supabase): implement UserStorage::get_account via postgrest"
```

---

## Task 14: `agicash-storage-supabase` — `upsert_user_with_accounts` RPC

**Files:**
- Modify: `crates/agicash-storage-supabase/src/user_storage.rs`

The one real RPC. POST to `<rest_url>/rpc/upsert_user_with_accounts` with the `UpsertUserInput` (which already carries the `p_*`-prefixed param names) as the JSON body. Response is the `UpsertUserResult` composite.

Note: postgrest 1.6's `.rpc()` method takes the function name and a JSON body string. We serialize `UpsertUserInput` ourselves and pass the string in.

- [ ] **Step 1: Add the failing test**

Append to the `tests` mod:

```rust
    use agicash_domain::{AccountPurpose, AccountType, Currency};
    use agicash_traits::{AccountInput, UpsertUserInput};
    use wiremock::matchers::body_json;

    fn sample_upsert_input(user_id: UserId) -> UpsertUserInput {
        UpsertUserInput {
            user_id,
            email: None,
            email_verified: false,
            accounts: vec![AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: "Lightning".into(),
                details: json!({"network": "MAINNET"}),
                is_default: true,
            }],
            cashu_locking_xpub: "xpub6".into(),
            encryption_public_key: "schnorr-pub".into(),
            spark_identity_public_key: "spark-pub".into(),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        }
    }

    fn sample_upsert_result(user_id: UserId) -> serde_json::Value {
        json!({
            "user": sample_user_payload(user_id),
            "accounts": [{
                "id": "11111111-2222-3333-4444-555555555555",
                "created_at": "2026-03-01T12:00:00Z",
                "user_id": user_id.to_string(),
                "name": "Lightning",
                "type": "spark",
                "purpose": "transactional",
                "currency": "BTC",
                "details": {"network": "MAINNET"},
                "version": 0,
                "state": "active",
                "expires_at": null
            }]
        })
    }

    #[tokio::test]
    async fn upsert_user_with_accounts_posts_to_rpc_and_parses_result() {
        let server = MockServer::start().await;
        let user_id = sample_user_id();
        let input = sample_upsert_input(user_id);
        let expected_body = serde_json::to_value(&input).unwrap();

        Mock::given(method("POST"))
            .and(path("/rest/v1/rpc/upsert_user_with_accounts"))
            .and(header("apikey", "test-anon-key"))
            .and(header("authorization", "Bearer stub-jwt-token"))
            .and(header("accept-profile", "wallet"))
            .and(body_json(&expected_body))
            .respond_with(ResponseTemplate::new(200).set_body_json(sample_upsert_result(user_id)))
            .expect(1)
            .mount(&server)
            .await;

        let storage = storage_for(&server);
        let result = storage.upsert_user_with_accounts(input).await.unwrap();
        assert_eq!(result.user.id, user_id);
        assert_eq!(result.accounts.len(), 1);
        assert_eq!(result.accounts[0].name, "Lightning");
    }
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: FAIL — `upsert_user_with_accounts` still returns `not yet implemented`.

- [ ] **Step 3: Implement `upsert_user_with_accounts`**

Replace the stub `upsert_user_with_accounts` body with:

```rust
    async fn upsert_user_with_accounts(
        &self,
        input: UpsertUserInput,
    ) -> Result<UpsertUserResult, StorageError> {
        let client = self.authenticated_client().await?;
        let body = serde_json::to_string(&input).map_err(map_json_error)?;
        let response = client
            .rpc("upsert_user_with_accounts", body)
            .execute()
            .await
            .map_err(map_postgrest_error)?;
        if !response.status().is_success() {
            return Err(StorageError::Backend(format!(
                "upsert_user_with_accounts: HTTP {}",
                response.status()
            )));
        }
        let text = response.text().await.map_err(crate::map_reqwest_error)?;
        serde_json::from_str::<UpsertUserResult>(&text).map_err(map_json_error)
    }
```

If postgrest 1.6's `.rpc()` method has a different signature (e.g., takes `Value` rather than `String`), adapt — the goal is a POST to `/rest/v1/rpc/upsert_user_with_accounts` with the serialized input as the body. Verify via `cargo doc --open -p postgrest`.

- [ ] **Step 4: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-storage-supabase`

Expected: PASS — RPC test verifies body shape (via `body_json` matcher), URL, headers, and response parsing.

- [ ] **Step 5: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(storage-supabase): implement UserStorage::upsert_user_with_accounts RPC"
```

---

## Task 15: `agicash-cli` — add `account list` subcommand to clap

**Files:**
- Modify: `crates/agicash-cli/src/cli.rs`

Adds an `Account(AccountArgs)` variant to `Command`, with a single `AccountCommand::List` subcommand. No `default` or `info` — those land in slice 4+.

- [ ] **Step 1: Write failing clap tests**

Append to `crates/agicash-cli/src/cli.rs` at the bottom of the `tests` mod:

```rust
    #[test]
    fn parses_account_list() {
        let cli = Cli::try_parse_from(["agicash", "account", "list"]).unwrap();
        match cli.cmd {
            Some(Command::Account(a)) => assert!(matches!(a.cmd, AccountCommand::List)),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn account_default_subcommand_is_not_recognized_yet() {
        // Deferred to slice 4+; explicitly NOT in this slice.
        let res = Cli::try_parse_from(["agicash", "account", "default", "<id>"]);
        assert!(res.is_err());
    }
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-cli --lib`

Expected: FAIL — `Command::Account` does not exist.

- [ ] **Step 3: Extend the CLI surface**

In `crates/agicash-cli/src/cli.rs`, modify the `Command` enum:

```rust
#[derive(Subcommand, Debug)]
pub enum Command {
    /// Print the SDK version.
    Version,
    /// Authentication and session management.
    Auth(AuthArgs),
    /// Accounts (cashu and spark) for the current user.
    Account(AccountArgs),
}
```

Add the new args + subcommand types below `AuthCommand`:

```rust
#[derive(clap::Args, Debug)]
pub struct AccountArgs {
    #[command(subcommand)]
    pub cmd: AccountCommand,
}

#[derive(Subcommand, Debug)]
pub enum AccountCommand {
    /// List active accounts for the current user.
    List,
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-cli --lib`

Expected: PASS.

- [ ] **Step 5: Smoke test the help output**

Append to `crates/agicash-cli/tests/help.rs`:

```rust
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
```

Run: `cd crates && cargo test -p agicash-cli --test help`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-cli
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(cli): add 'account list' clap subcommand (default/info deferred)"
```

---

## Task 16: `agicash-cli` — composition root extension

**Files:**
- Modify: `crates/agicash-cli/Cargo.toml`
- Modify: `crates/agicash-cli/src/composition.rs`

We keep `build_auth_deps()` as-is (slice 2's surface stays untouched) and add a sibling `build_storage_deps()` that returns a struct with the storage handle. The call site composes both at dispatch time. This is cleaner than a single `build_deps()` because the auth subcommands don't need storage, and forcing storage construction (which fails if `SUPABASE_URL` is missing) would break the `auth guest` / `auth status` UX when the dev `.env` is partial.

- [ ] **Step 1: Update the crate manifest**

Replace `crates/agicash-cli/Cargo.toml`:

```toml
[package]
name = "agicash-cli"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[[bin]]
name = "agicash"
path = "src/main.rs"

[features]
default = []
# Enable integration tests that hit the real Open Secret dev environment.
real-opensecret-tests = []
# Enable integration tests that hit the real Supabase dev project.
real-supabase-tests = []

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }
agicash-traits = { path = "../agicash-traits" }
agicash-auth-opensecret = { path = "../agicash-auth-opensecret" }
agicash-storage-supabase = { path = "../agicash-storage-supabase" }
agicash-wallet = { path = "../agicash-wallet" }
clap = { workspace = true }
tokio = { workspace = true }
rpassword = { workspace = true }
uuid = { workspace = true }
hex = { workspace = true }
dotenvy = { workspace = true }
getrandom = { workspace = true }

[dev-dependencies]
assert_cmd = { workspace = true }
predicates = { workspace = true }
dotenvy = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Extend the composition module**

Append to `crates/agicash-cli/src/composition.rs`:

```rust
use agicash_auth_opensecret::OpenSecretTokenProvider;
use agicash_storage_supabase::{SupabaseStorage, SupabaseStorageConfig};
use agicash_traits::StorageError;
use std::sync::Arc;

#[derive(Clone)]
pub struct StorageDeps {
    pub storage: Arc<SupabaseStorage>,
}

impl std::fmt::Debug for StorageDeps {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StorageDeps").finish_non_exhaustive()
    }
}

pub fn build_storage_deps(auth: &AuthDeps) -> Result<StorageDeps, StorageError> {
    let config = SupabaseStorageConfig::from_env()?;
    // OpenSecretTokenProvider needs a Client + SessionStorage; slice 2 already
    // builds it inside auth, but its construction is private to the auth
    // crate. Re-wire it here: the same Arc<OpenSecretClient> from AuthDeps,
    // plus the same KeyringSessionStorage.
    let tokens: Arc<dyn agicash_traits::TokenProvider + Send + Sync> = Arc::new(
        OpenSecretTokenProvider::new(auth.client.clone(), auth.storage.clone()),
    );
    let storage = Arc::new(SupabaseStorage::new(config, tokens)?);
    Ok(StorageDeps { storage })
}
```

Note: Rust import paths use underscores, not hyphens. The crate is named `agicash-storage-supabase` in Cargo.toml but imported as `agicash_storage_supabase` in source.

If `OpenSecretTokenProvider::new()` has a different signature in slice 2's actual shipped code (verify by reading `crates/agicash-auth-opensecret/src/token_provider.rs`), adjust the constructor call to match. The functional requirement is: produce an `Arc<dyn TokenProvider>` that pulls fresh JWTs from the slice-2 client + session.

- [ ] **Step 3: Verify the workspace builds**

Run: `cd crates && cargo build -p agicash-cli`

Expected: PASS.

If `OpenSecretTokenProvider::new` doesn't accept the slice-2 arguments as-shown, fix the call. Don't paper over with names that don't compile.

- [ ] **Step 4: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-cli
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
feat(cli): add build_storage_deps composition for SupabaseStorage

Sibling of build_auth_deps; constructed only when a storage-using
command runs, so the auth subcommands still work when SUPABASE_URL
is not present in .env.
EOF
)"
```

---

## Task 17: `agicash-cli` — `cmd_account_list` handler

**Files:**
- Create: `crates/agicash-cli/src/account.rs`
- Modify: `crates/agicash-cli/src/main.rs`

The handler:
1. Loads `PersistedSession` from storage to get the `user_id`. Errors with "not logged in" + non-zero exit if absent.
2. Calls `storage.list_accounts(user_id)`.
3. Prints one line per account: `<id>  <type>  <currency>  <name>`.

- [ ] **Step 1: Create the account module**

Create `crates/agicash-cli/src/account.rs`:

```rust
use crate::composition::{AuthDeps, StorageDeps};
use agicash_domain::UserId;
use agicash_traits::{AuthError, SessionStorage, UserStorage};

#[derive(Debug, thiserror::Error)]
pub enum AccountCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error(transparent)]
    Auth(#[from] AuthError),
    #[error(transparent)]
    Storage(#[from] agicash_traits::StorageError),
}

pub async fn cmd_list(auth: &AuthDeps, storage: &StorageDeps) -> Result<(), AccountCmdError> {
    let session = auth.storage.load().await?.ok_or(AccountCmdError::NotLoggedIn)?;
    let user_id = UserId::from(session.user_id);
    let accounts = storage.storage.list_accounts(user_id).await?;
    for a in accounts {
        println!(
            "{}  {}  {}  {}",
            a.id,
            a.account_type,
            a.currency,
            a.name
        );
    }
    Ok(())
}
```

Note: `AccountType` needs a `Display` impl — check `crates/agicash-domain/src/account.rs`. If slice 1 didn't add one, derive it manually (`impl Display`). The implementation is trivial:

```rust
impl std::fmt::Display for AccountType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Self::Cashu => "cashu",
            Self::Spark => "spark",
        })
    }
}
```

If you need to add it, do so in `crates/agicash-domain/src/account.rs` and include the change in the same task commit. Add a tiny test confirming `Display` matches `Serialize`.

- [ ] **Step 2: Wire `account` module into `main.rs`**

Replace `crates/agicash-cli/src/main.rs`:

```rust
mod account;
mod auth;
mod cli;
mod composition;

use clap::Parser;
use cli::{AccountCommand, AuthCommand, Cli, Command};
use composition::{build_auth_deps, build_storage_deps};

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();

    let args = Cli::parse();
    let exit_code = match run(args).await {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("error: {e}");
            // The handler returned NotLoggedIn -> exit code 3 (auth required).
            // All other errors -> 1 (runtime error). Distinguished by message.
            if e.to_string() == "not logged in" {
                3
            } else {
                1
            }
        }
    };
    std::process::exit(exit_code);
}

async fn run(args: Cli) -> Result<(), Box<dyn std::error::Error>> {
    match args.cmd {
        Some(Command::Version) => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            Ok(())
        }
        Some(Command::Auth(a)) => match a.cmd {
            AuthCommand::Guest => {
                let deps = build_auth_deps()?;
                auth::cmd_guest(&deps).await?;
                Ok(())
            }
            AuthCommand::Login { email } => {
                let deps = build_auth_deps()?;
                auth::cmd_login(&deps, email).await?;
                Ok(())
            }
            AuthCommand::Logout => {
                let deps = build_auth_deps()?;
                auth::cmd_logout(&deps).await?;
                Ok(())
            }
            AuthCommand::Status => {
                let deps = build_auth_deps()?;
                auth::cmd_status(&deps).await?;
                Ok(())
            }
        },
        Some(Command::Account(a)) => match a.cmd {
            AccountCommand::List => {
                let auth_deps = build_auth_deps()?;
                let storage_deps = build_storage_deps(&auth_deps)?;
                account::cmd_list(&auth_deps, &storage_deps).await?;
                Ok(())
            }
        },
        None => Ok(()),
    }
}
```

- [ ] **Step 3: Build check**

Run: `cd crates && cargo build -p agicash-cli`

Expected: PASS.

- [ ] **Step 4: Smoke test "not logged in" behavior**

Append to `crates/agicash-cli/tests/help.rs`:

```rust
#[test]
fn account_list_without_session_exits_nonzero_and_prints_message() {
    // No session in keyring; use a unique keyring service so we never collide
    // with a real session. Even if the env vars aren't set, the "not logged
    // in" check fires before the storage builder runs (storage builder needs
    // SUPABASE_URL), so we must also ensure SUPABASE_URL/ANON_KEY are at
    // least present-ish — but the auth-side check happens FIRST.
    let pid = std::process::id();
    let service = format!("com.agicash.cli.test.{pid}.account-list");
    Command::cargo_bin("agicash")
        .unwrap()
        .env("AGICASH_KEYRING_SERVICE", &service)
        // SUPABASE_URL/ANON_KEY are read by build_storage_deps but that's
        // called AFTER auth.storage.load(). Set them to dummy values so the
        // composition doesn't fail before the session check.
        .env("SUPABASE_URL", "https://test.invalid")
        .env("SUPABASE_ANON_KEY", "test-anon-key")
        // Make sure OPENSECRET vars exist too so build_auth_deps doesn't error
        // before we get to load() (build_auth_deps consumes them).
        .env("OPENSECRET_BASE_URL", "https://does-not-resolve.invalid")
        .env("OPENSECRET_CLIENT_ID", "00000000-0000-0000-0000-000000000000")
        .args(["account", "list"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("not logged in"));
}
```

Note on ordering: the test relies on `build_auth_deps` and `build_storage_deps` succeeding cheaply (they don't hit the network — they just build clients), and the `not logged in` check coming from `auth.storage.load()` happening before any HTTP call. Verify the flow does that.

Run: `cd crates && cargo test -p agicash-cli --test help`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-cli crates/agicash-domain
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
feat(cli): add 'account list' handler

Reads the persisted session, calls UserStorage::list_accounts for the
session's user_id, prints one line per active account. Returns exit
code 3 ("auth required") when no session is present.
EOF
)"
```

---

## Task 18: CLI integration test — list accounts against real Supabase

**Files:**
- Create: `crates/agicash-cli/tests/account_list.rs`

The test sequence:
1. Process 1: `agicash auth guest` → capture user id from stdout.
2. In-test: instantiate `SupabaseStorage` with the slice-2 token provider, call `storage.upsert_user_with_accounts(...)` to seed one Spark BTC account. (The JS app does this via the same RPC after Open Secret returns the guest; we replicate that bootstrap here.)
3. Process 2 (fresh): `agicash account list` → assert stdout contains the seeded account name.
4. Process 3 (fresh): `agicash auth logout` → exit 0 (cleanup).

Gated behind the `real-supabase-tests` feature. Reads `.env`. Skips gracefully if any of `OPENSECRET_BASE_URL`, `OPENSECRET_CLIENT_ID`, `SUPABASE_URL` (or `VITE_SUPABASE_URL`), `SUPABASE_ANON_KEY` (or `VITE_SUPABASE_ANON_KEY`) is missing.

- [ ] **Step 1: Write the integration test**

Create `crates/agicash-cli/tests/account_list.rs`:

```rust
//! End-to-end account-list test against the real Open Secret + Supabase dev environments.
//!
//! Gated behind both the `real-supabase-tests` and `real-opensecret-tests`
//! features so plain `cargo test` stays hermetic. To run:
//!
//! ```
//! cargo test -p agicash-cli \
//!     --features real-supabase-tests,real-opensecret-tests \
//!     --test account_list -- --nocapture
//! ```
//!
//! Env vars are loaded from .env (same as the CLI binary):
//! - OPENSECRET_BASE_URL
//! - OPENSECRET_CLIENT_ID
//! - SUPABASE_URL or VITE_SUPABASE_URL
//! - SUPABASE_ANON_KEY or VITE_SUPABASE_ANON_KEY

#[cfg(all(feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod gated {
    use agicash_auth_opensecret::{
        KeyringSessionStorage, OpenSecretClient, OpenSecretConfig, OpenSecretTokenProvider,
    };
    use agicash_domain::{AccountPurpose, AccountType, Currency, UserId};
    use agicash_storage_supabase::{SupabaseStorage, SupabaseStorageConfig};
    use agicash_traits::{
        AccountInput, PersistedSession, SessionStorage, UpsertUserInput, UserStorage,
    };
    use assert_cmd::Command;
    use predicates::prelude::*;
    use serde_json::json;
    use std::sync::Arc;
    use uuid::Uuid;

    fn env_ready() -> Option<()> {
        let _ = dotenvy::dotenv();
        std::env::var("OPENSECRET_BASE_URL").ok()?;
        std::env::var("OPENSECRET_CLIENT_ID").ok()?;
        std::env::var("SUPABASE_URL")
            .or_else(|_| std::env::var("VITE_SUPABASE_URL"))
            .ok()?;
        std::env::var("SUPABASE_ANON_KEY")
            .or_else(|_| std::env::var("VITE_SUPABASE_ANON_KEY"))
            .ok()?;
        Some(())
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn list_accounts_after_seeding_via_upsert_user_with_accounts() {
        if env_ready().is_none() {
            eprintln!("skipping: required env vars not set");
            return;
        }

        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.account-list");

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
        let guest_uuid: Uuid = guest_stdout
            .split_whitespace()
            .last()
            .expect("guest stdout has uuid")
            .parse()
            .expect("last token is a uuid");

        // Step 2: in-test seed wallet.users + a wallet.accounts row.
        // Mirrors the JS app's `upsert_user_with_accounts` call on first run.
        let auth_config = OpenSecretConfig::from_env().expect("openSecret env");
        let auth_client = OpenSecretClient::new(auth_config).expect("client");
        let session_storage = KeyringSessionStorage::new(&service);
        let tokens: Arc<dyn agicash_traits::TokenProvider + Send + Sync> =
            Arc::new(OpenSecretTokenProvider::new(
                auth_client.clone(),
                session_storage.clone(),
            ));
        let storage_config = SupabaseStorageConfig::from_env().expect("supabase env");
        let storage =
            SupabaseStorage::new(storage_config, tokens).expect("storage");

        let user_id = UserId::from(guest_uuid);
        let seeded_account_name = format!("test-spark-{}", pid);
        let seeded_input = UpsertUserInput {
            user_id,
            email: None,
            email_verified: false,
            accounts: vec![AccountInput {
                account_type: AccountType::Spark,
                purpose: AccountPurpose::Transactional,
                currency: Currency::Btc,
                name: seeded_account_name.clone(),
                details: json!({"network": "MAINNET"}),
                is_default: true,
            }],
            cashu_locking_xpub: format!("xpub-test-{}", pid),
            encryption_public_key: format!("enc-test-{}", pid),
            spark_identity_public_key: format!("spark-test-{}", pid),
            terms_accepted_at: None,
            gift_card_mint_terms_accepted_at: None,
        };
        let upsert = storage
            .upsert_user_with_accounts(seeded_input)
            .await
            .expect("upsert");
        assert_eq!(upsert.user.id, user_id);
        assert!(!upsert.accounts.is_empty(), "upsert returned accounts");

        // Step 3: fresh process runs `agicash account list`, must see the
        // seeded account name in stdout.
        make_cmd()
            .args(["account", "list"])
            .assert()
            .success()
            .stdout(predicate::str::contains(&seeded_account_name));

        // Step 4: cleanup. logout clears the local keyring entry.
        make_cmd().args(["auth", "logout"]).assert().success();
    }
}

#[cfg(not(all(feature = "real-supabase-tests", feature = "real-opensecret-tests")))]
#[test]
fn account_list_e2e_skipped_without_features() {
    eprintln!(
        "skipping real-supabase-tests; run with: \
         cargo test -p agicash-cli \
         --features real-supabase-tests,real-opensecret-tests --test account_list"
    );
}
```

- [ ] **Step 2: Run the gated test (no feature → skip)**

Run: `cd crates && cargo test -p agicash-cli --test account_list`

Expected: PASS — the skip stub runs; no network calls.

- [ ] **Step 3: Run the real-network test (manual; reads `.env`)**

This requires `.env` in the worktree root. If it doesn't exist, copy from the slice-2 worktree:

```bash
cp /Users/claude/agicash/.claude/worktrees/rust-auth/.env \
   /Users/claude/agicash/.claude/worktrees/rust-accounts/.env
```

If the slice-2 `.env` lacks `SUPABASE_URL`/`SUPABASE_ANON_KEY` (it uses the Vite-prefixed forms `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`), the fallback wired in Task 9 handles it — no edits needed. If neither prefix is present in `.env`, **STOP and report to the meta-agent**; do not try to fabricate values.

```bash
cd crates && \
cargo test -p agicash-cli \
  --features real-supabase-tests,real-opensecret-tests \
  --test account_list -- --nocapture
```

Expected: PASS — guest registration succeeds, RPC seed succeeds, the seeded account name appears in `account list` output.

If the RPC returns an unexpected status (e.g., 400 with a hint about "p_accounts cannot be empty" — read the migration body), the input shape may need adjusting. The shape in this test mirrors the schema; any mismatch is worth flagging back to the meta-agent.

- [ ] **Step 4: Commit**

```bash
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-cli
PREK_ALLOW_NO_CONFIG=1 git commit -m "$(cat <<'EOF'
test(cli): add account list integration test (gated)

Spawns auth guest, seeds wallet.users + a wallet.accounts row via
upsert_user_with_accounts, then spawns account list in a fresh process
and asserts the seeded account name appears in stdout. Gated behind
real-supabase-tests + real-opensecret-tests features; .env-driven.
EOF
)"
```

---

## Task 19: Final verification — the slice-3 test bar

This task confirms slice 3 is complete by running every check that matters.

- [ ] **Step 1: `cargo build` passes**

Run: `cd crates && cargo build --workspace`

Expected: PASS, no warnings.

- [ ] **Step 2: Default `cargo test` passes (hermetic — no network)**

Run: `cd crates && cargo test --workspace`

Expected: PASS — all slice-1, slice-2, and slice-3 tests pass; the two gated integration tests print skip lines and still count as passes.

- [ ] **Step 3: `cargo clippy -- -D warnings` passes**

Run: `cd crates && cargo clippy --workspace --all-targets -- -D warnings`

Expected: PASS, no warnings.

- [ ] **Step 4: `cargo fmt --check` passes**

Run: `cd crates && cargo fmt --all --check`

Expected: PASS, no diff.

- [ ] **Step 5: WASM target still builds**

Run: `cd crates && cargo build --target wasm32-unknown-unknown -p agicash-wasm`

Expected: PASS — slice 3 doesn't touch wasm and it must still compile.

If `agicash-storage-supabase` is now in the wasm crate's dep graph (it isn't yet — the wasm crate is still a stub), and `reqwest` features (`rustls-tls`) cause wasm build failure, the right fix is target-specific cfg in `agicash-storage-supabase/Cargo.toml`. Defer that to whenever the wasm crate actually consumes storage; for slice 3 the wasm crate is unchanged.

- [ ] **Step 6: CLI surface matches plan**

Run: `cd crates && cargo run -p agicash-cli -- account --help`

Expected output lists `list` as the only subcommand. No `default`, no `info`.

Run: `cd crates && cargo run -p agicash-cli -- account list --help`

Expected: succeeds, mentions "List active accounts".

- [ ] **Step 7: Real-network manual verification (gated; uses `.env`)**

Assuming `.env` is present with the four required keys (or their `VITE_` aliases):

```bash
cd crates
export AGICASH_KEYRING_SERVICE=com.agicash.cli.local-verify

cargo run -p agicash-cli -- auth guest
# expected: "signed in as guest <uuid>"

cargo test -p agicash-cli \
  --features real-supabase-tests,real-opensecret-tests \
  --test account_list -- --nocapture
# expected: PASS, seeded account name appears in `account list` output.
# (This test re-runs the auth guest itself; the manual `auth guest` above
# was a sanity check.)

# clean up the manual test keyring entry
security delete-generic-password -s com.agicash.cli.local-verify 2>/dev/null || true
```

If every line behaves as commented, slice 3 is functionally complete.

- [ ] **Step 8: Stop and report — DO NOT open a PR**

This is an experimental project. Per `~/athanor/projects/agicash-rust/PROCESS.md`, slices never get merged to master; branches stack. After Step 7 passes, report back to the meta-agent with:

- Full commit list (oldest first, `git log --oneline feat/rust-auth..feat/rust-accounts | tac`)
- Output of every verification step in this task (steps 1-6)
- Any deviations from the plan and why
- Anything you noticed worth flagging for slice 4 or the spec (postgrest quirks, schema-header behavior, etc.)

Do not push the branch. Do not open a PR. Do not merge anywhere.

After the meta-agent reviews and gudnuf signs off, slice 3 is done. The next plan to write is for **slice 4 — Cashu provider scaffolding**.

---

## Notes for the executor

- **Do not open the PR yourself.** The meta-agent reviews each slice and opens the PR. After Task 19 step 8 is checked, stop and report.
- **Do not implement anything from slice 4+.** No `FakeKeyProvider` / `FakeUserStorage` in `agicash-testing`, no encryption seam, no transactions, no realtime, no services orchestrator, no cache, no event bus, no `account default` / `account info` CLI subcommands. Those land in their own slices.
- **`account default` and `account info` are deliberately omitted.** Spec §10 lists them; this slice ships only `account list`. The deferral is recorded in the "Spec deviations" header. After sign-off the meta-agent updates §10.
- **Orphan rule, again.** `postgrest::Error`, `reqwest::Error`, and `serde_json::Error` are all foreign types. We map them to `StorageError` via free helper functions in `crates/agicash-storage-supabase/src/error.rs`, not `From` impls — same pattern slice 2 used for `opensecret::Error`. Don't try to write `impl From<reqwest::Error> for StorageError` in `agicash-storage-supabase`; both types are foreign relative to it.
- **`.env` mechanics.** The dev `.env` lives at the worktree root and is loaded by `dotenvy::dotenv()` from `main()`. If `/Users/claude/agicash/.claude/worktrees/rust-accounts/.env` doesn't exist, copy from `/Users/claude/agicash/.claude/worktrees/rust-auth/.env`. The slice-2 `.env` has `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Vite-prefixed for the JS app); the storage config in Task 9 falls back to those when the un-prefixed names aren't set. If neither form is present, **STOP and report** — don't fabricate values.
- **Verify postgrest API shapes before each implementation step.** This plan names methods like `.from()`, `.select()`, `.eq()`, `.rpc()`, `.schema()`, `.insert_header()`, `.execute()`. If postgrest 1.6 disagrees on any of these (signature, return type, naming), trust the crate. `cargo doc --open -p postgrest` is fastest. Adjust the code, don't paper over with mismatched names.
- **The opensecret patch in `[patch.crates-io]` is still in effect.** It points to `~/opensecret-sdk-fork/rust`. Don't touch it. Slice 3 doesn't need any opensecret changes.
- **Type names from this slice are load-bearing in later slices.** `User`, `Account` (expanded), `AccountPurpose`, `AccountState`, `StorageError`, `AccountInput`, `UpsertUserInput`, `UpsertUserResult`, `UserStorage`, `SupabaseStorageConfig`, `SupabaseStorage`. Renaming any requires updating the spec.
- **`PREK_ALLOW_NO_CONFIG=1`** in front of every `git commit`. The slice-2 worktree had `.pre-commit-config.yaml` gitignored; this worktree inherits the same setup, so `prek` (the local pre-commit harness) errors out without the env var.
- **CI doesn't require the real-network features.** `cargo test --workspace` on the runner skips both gated tests gracefully. A nightly job with secrets is a later concern.
- **`Cargo.lock`** stays committed. Each task that pulls a new transitive dep will touch the lockfile; let the commit that introduces the dep also touch it.
- **If postgrest's schema selection doesn't emit `Accept-Profile: wallet`**, the wiremock matcher in Task 11 will fail. Adjust the matcher to whatever postgrest 1.6 actually emits (could be `Content-Profile` for writes, `Accept-Profile` for reads, or both). The semantic requirement is that `wallet`-scoped requests reach `wallet`-scoped tables; the exact header name is incidental.
- **If postgrest 1.6's `.rpc()` body argument has a different type** (`Value` vs `String` vs `serde::Serialize`), adapt Task 14's implementation. The wiremock `body_json` matcher in the test asserts on shape, not how we serialized it.
- **`AccountType` Display impl in Task 17** — if slice 1 didn't add one, add it (the task notes this) and commit the change in the same task; otherwise the CLI handler can't `format!("{}", a.account_type)`. Verify by reading `crates/agicash-domain/src/account.rs` before Task 17 begins.
- **Be cautious about `serde_json` in `agicash-domain`.** Slice 1 only had it as a dev-dep. Task 4 promotes it to a runtime dep because `Account.details: serde_json::Value`. That's intentional; don't try to push the JSONB out as a `String` to avoid the dep — every downstream consumer would have to re-parse.
- **Don't bother decrypting anything.** Account rows are plaintext per the slice-3 research. The encryption seam lands in slice 4+ when `wallet.transactions.encrypted_transaction_details` matters.
