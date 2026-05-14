# Agicash Rust SDK — Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the empty Cargo workspace, all 14 crates, the CLI binary with `--help`, the WASM crate compiling to `wasm32-unknown-unknown`, and CI. After this slice, `cargo build`, `cargo test`, `cargo clippy -- -D warnings`, and `cargo build --target wasm32-unknown-unknown -p agicash-wasm` all pass, and `agicash --help` prints usage.

**Architecture:** New `crates/` directory at repo root, alongside existing `app/`. Cargo workspace manifest at `crates/Cargo.toml`. Each crate has a single responsibility per the spec; in this slice most are stubs that compile, with real types only in `agicash-domain` and `agicash-money`. CLI uses `clap` derive macros; WASM uses `wasm-bindgen` with `crate-type = ["cdylib"]`.

**Tech Stack:** Rust 1.83 (stable), cargo workspaces, `clap` v4 with derive, `wasm-bindgen` v0.2, `wasm-pack` (via the `wasm:build` bun script), `rust_decimal` for money math, `uuid` v1 for ID types, `serde`/`serde_json` for serialization, `thiserror` for error types, `assert_cmd` + `predicates` for CLI integration tests.

**Reference:** This plan implements slice 1 of `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` (see §16 "Implementation Slicing").

**Branch:** Execute from a fresh branch off `master`, e.g. `feat/rust-scaffold`. Not from `homepage/v2-redesign`.

---

## File Structure

```
crates/                                  # NEW top-level directory
├── Cargo.toml                          # workspace manifest with shared deps + lints
├── rust-toolchain.toml                 # pin to stable 1.83
├── README.md                           # workspace overview, pointer to spec
├── .gitignore                          # ignore target/, pkg/
├── agicash-domain/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                      # re-exports + module declarations
│       ├── ids.rs                      # UserId, AccountId, TransactionId, QuoteId, ProofId
│       ├── currency.rs                 # Currency enum (BTC, USD, USDB)
│       ├── account.rs                  # AccountType enum, Account struct (stub)
│       └── transaction.rs              # TransactionState enum, Transaction struct (stub)
├── agicash-money/
│   ├── Cargo.toml
│   └── src/
│       ├── lib.rs                      # re-exports
│       ├── money.rs                    # Money struct, arithmetic, Display
│       └── unit.rs                     # Unit enum, conversion helpers
├── agicash-crypto/Cargo.toml           # stub (lib.rs has //! placeholder doc)
├── agicash-crypto/src/lib.rs
├── agicash-traits/Cargo.toml           # stub
├── agicash-traits/src/lib.rs
├── agicash-cashu/Cargo.toml            # stub
├── agicash-cashu/src/lib.rs
├── agicash-spark/Cargo.toml            # stub
├── agicash-spark/src/lib.rs
├── agicash-storage-supabase/Cargo.toml # stub
├── agicash-storage-supabase/src/lib.rs
├── agicash-auth-opensecret/Cargo.toml  # stub
├── agicash-auth-opensecret/src/lib.rs
├── agicash-cache/Cargo.toml            # stub
├── agicash-cache/src/lib.rs
├── agicash-services/Cargo.toml         # stub
├── agicash-services/src/lib.rs
├── agicash-wallet/Cargo.toml           # stub
├── agicash-wallet/src/lib.rs
├── agicash-testing/Cargo.toml          # stub
├── agicash-testing/src/lib.rs
├── agicash-cli/
│   ├── Cargo.toml
│   ├── src/
│   │   ├── main.rs                     # tokio::main entrypoint, dispatch to subcommands
│   │   └── cli.rs                      # clap Cli struct + Command enum (stubs only in this slice)
│   └── tests/
│       └── help.rs                     # assert_cmd integration test for `agicash --help`
└── agicash-wasm/
    ├── Cargo.toml                      # crate-type = ["cdylib", "rlib"]
    └── src/lib.rs                      # minimal wasm-bindgen export (greet() placeholder)

# Modifications outside crates/
.github/workflows/rust.yml               # NEW — Rust CI
package.json                             # MODIFY — add wasm:build, wasm:build:dev, wasm:watch
.gitignore                               # MODIFY — add /target, /crates/agicash-wasm/pkg
```

---

## Task 1: Workspace skeleton + toolchain pin

**Files:**
- Create: `crates/Cargo.toml`
- Create: `crates/rust-toolchain.toml`
- Create: `crates/.gitignore`
- Modify: root `.gitignore` (append Rust artifacts)

- [ ] **Step 1: Create the workspace manifest**

Create `crates/Cargo.toml`:

```toml
[workspace]
resolver = "2"
members = [
    "agicash-domain",
    "agicash-money",
    "agicash-crypto",
    "agicash-traits",
    "agicash-cashu",
    "agicash-spark",
    "agicash-storage-supabase",
    "agicash-auth-opensecret",
    "agicash-cache",
    "agicash-services",
    "agicash-wallet",
    "agicash-testing",
    "agicash-cli",
    "agicash-wasm",
]

[workspace.package]
version = "0.1.0"
edition = "2021"
rust-version = "1.83"
license = "MIT"
repository = "https://github.com/MakePrisms/agicash"

[workspace.dependencies]
# Async + runtime
tokio = { version = "1.42", features = ["macros", "rt-multi-thread", "signal", "sync", "time"] }
futures = "0.3"
async-trait = "0.1"
async-broadcast = "0.7"

# Serialization
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"

# Errors + misc
thiserror = "2.0"
uuid = { version = "1.11", features = ["v4", "serde"] }
rust_decimal = { version = "1.36", features = ["serde-with-str"] }
rust_decimal_macros = "1.36"

# CLI
clap = { version = "4.5", features = ["derive"] }

# WASM
wasm-bindgen = "0.2"
serde-wasm-bindgen = "0.6"
wasm-bindgen-futures = "0.4"
js-sys = "0.3"

# Dev / tests
assert_cmd = "2.0"
predicates = "3.1"

[workspace.lints.rust]
unsafe_code = "forbid"
missing_debug_implementations = "warn"

[workspace.lints.clippy]
all = { level = "warn", priority = -1 }
pedantic = { level = "warn", priority = -1 }
module_name_repetitions = "allow"
must_use_candidate = "allow"
missing_errors_doc = "allow"
missing_panics_doc = "allow"

[profile.release]
opt-level = "z"
lto = true
codegen-units = 1
strip = true
```

- [ ] **Step 2: Create the toolchain pin**

Create `crates/rust-toolchain.toml`:

```toml
[toolchain]
channel = "1.83.0"
components = ["rustfmt", "clippy"]
targets = ["wasm32-unknown-unknown"]
profile = "minimal"
```

- [ ] **Step 3: Create crates-local gitignore**

Create `crates/.gitignore`:

```
/target
**/pkg
**/*.rs.bk
Cargo.lock.bak
```

- [ ] **Step 4: Update root `.gitignore`**

Append to root `.gitignore`:

```
# Rust
/target
/crates/target
/crates/**/pkg
```

- [ ] **Step 5: Verify cargo recognizes the workspace (will fail — no member crates yet)**

Run: `cd crates && cargo build`

Expected: FAIL with something like `error: failed to load manifest for workspace member`. This is expected — we have no member crates yet. The next task creates the first one.

- [ ] **Step 6: Commit**

```bash
git add crates/Cargo.toml crates/rust-toolchain.toml crates/.gitignore .gitignore
git commit -m "chore(rust): add empty cargo workspace + toolchain pin"
```

---

## Task 2: `agicash-domain` — ID newtypes

**Files:**
- Create: `crates/agicash-domain/Cargo.toml`
- Create: `crates/agicash-domain/src/lib.rs`
- Create: `crates/agicash-domain/src/ids.rs`

- [ ] **Step 1: Create the crate manifest**

Create `crates/agicash-domain/Cargo.toml`:

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
uuid = { workspace = true }
thiserror = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Create lib.rs with module declarations**

Create `crates/agicash-domain/src/lib.rs`:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`.

pub mod ids;
pub mod currency;
pub mod account;
pub mod transaction;

pub use ids::*;
pub use currency::*;
pub use account::*;
pub use transaction::*;
```

(The `currency`, `account`, `transaction` modules will be created in later tasks. To allow this task to compile in isolation, replace those `pub mod` lines temporarily with `// pub mod currency; etc.` and uncomment them in Tasks 3-4.)

Revised `crates/agicash-domain/src/lib.rs`:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`.

pub mod ids;

pub use ids::*;
```

- [ ] **Step 3: Write the failing test for `UserId`**

Create `crates/agicash-domain/src/ids.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_id_generates_unique_uuids() {
        let a = UserId::new();
        let b = UserId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn user_id_roundtrips_through_string() {
        let id = UserId::new();
        let s = id.to_string();
        let parsed: UserId = s.parse().unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn user_id_parse_rejects_garbage() {
        let result: Result<UserId, _> = "not-a-uuid".parse();
        assert!(result.is_err());
    }
}
```

- [ ] **Step 4: Run tests to see them fail**

Run: `cd crates && cargo test -p agicash-domain`

Expected: FAIL with `cannot find type 'UserId'` errors.

- [ ] **Step 5: Implement `UserId` and a macro for the other IDs**

Replace `crates/agicash-domain/src/ids.rs` content (keeping the test module at the bottom):

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;
use uuid::Uuid;

macro_rules! id_type {
    ($name:ident) => {
        #[derive(
            Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize,
        )]
        #[serde(transparent)]
        pub struct $name(Uuid);

        impl $name {
            #[must_use]
            pub fn new() -> Self {
                Self(Uuid::new_v4())
            }

            #[must_use]
            pub fn as_uuid(&self) -> Uuid {
                self.0
            }
        }

        impl Default for $name {
            fn default() -> Self {
                Self::new()
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
                self.0.fmt(f)
            }
        }

        impl FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                Ok(Self(Uuid::parse_str(s)?))
            }
        }

        impl From<Uuid> for $name {
            fn from(u: Uuid) -> Self {
                Self(u)
            }
        }
    };
}

id_type!(UserId);
id_type!(AccountId);
id_type!(TransactionId);
id_type!(QuoteId);
id_type!(ProofId);
id_type!(ClientId);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn user_id_generates_unique_uuids() {
        let a = UserId::new();
        let b = UserId::new();
        assert_ne!(a, b);
    }

    #[test]
    fn user_id_roundtrips_through_string() {
        let id = UserId::new();
        let s = id.to_string();
        let parsed: UserId = s.parse().unwrap();
        assert_eq!(id, parsed);
    }

    #[test]
    fn user_id_parse_rejects_garbage() {
        let result: Result<UserId, _> = "not-a-uuid".parse();
        assert!(result.is_err());
    }

    #[test]
    fn all_id_types_are_distinct() {
        // Compile-time check: these would not compile if all types were aliases.
        let _u: UserId = UserId::new();
        let _a: AccountId = AccountId::new();
        let _t: TransactionId = TransactionId::new();
        let _q: QuoteId = QuoteId::new();
        let _p: ProofId = ProofId::new();
        let _c: ClientId = ClientId::new();
    }
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS — 4 tests pass.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-domain
git commit -m "feat(domain): add ID newtypes (UserId, AccountId, TransactionId, QuoteId, ProofId, ClientId)"
```

---

## Task 3: `agicash-domain` — Currency enum

**Files:**
- Create: `crates/agicash-domain/src/currency.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

- [ ] **Step 1: Write failing tests**

Create `crates/agicash-domain/src/currency.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currency_display_uses_uppercase_ticker() {
        assert_eq!(Currency::Btc.to_string(), "BTC");
        assert_eq!(Currency::Usd.to_string(), "USD");
        assert_eq!(Currency::Usdb.to_string(), "USDB");
    }

    #[test]
    fn currency_parses_case_insensitively() {
        assert_eq!("btc".parse::<Currency>().unwrap(), Currency::Btc);
        assert_eq!("BTC".parse::<Currency>().unwrap(), Currency::Btc);
        assert_eq!("Usd".parse::<Currency>().unwrap(), Currency::Usd);
    }

    #[test]
    fn currency_parse_rejects_unknown() {
        assert!("EUR".parse::<Currency>().is_err());
        assert!("".parse::<Currency>().is_err());
    }

    #[test]
    fn currency_serializes_as_uppercase_string() {
        let json = serde_json::to_string(&Currency::Btc).unwrap();
        assert_eq!(json, "\"BTC\"");
    }

    #[test]
    fn currency_deserializes_from_uppercase_string() {
        let c: Currency = serde_json::from_str("\"USDB\"").unwrap();
        assert_eq!(c, Currency::Usdb);
    }
}
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-domain --lib currency`

Expected: FAIL — `Currency` doesn't exist yet.

- [ ] **Step 3: Implement `Currency`**

Replace `crates/agicash-domain/src/currency.rs` with:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum Currency {
    Btc,
    Usd,
    Usdb,
}

#[derive(Debug, thiserror::Error)]
#[error("unknown currency: {0}")]
pub struct UnknownCurrency(pub String);

impl fmt::Display for Currency {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Btc => "BTC",
            Self::Usd => "USD",
            Self::Usdb => "USDB",
        })
    }
}

impl FromStr for Currency {
    type Err = UnknownCurrency;
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_ascii_uppercase().as_str() {
            "BTC" => Ok(Self::Btc),
            "USD" => Ok(Self::Usd),
            "USDB" => Ok(Self::Usdb),
            _ => Err(UnknownCurrency(s.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currency_display_uses_uppercase_ticker() {
        assert_eq!(Currency::Btc.to_string(), "BTC");
        assert_eq!(Currency::Usd.to_string(), "USD");
        assert_eq!(Currency::Usdb.to_string(), "USDB");
    }

    #[test]
    fn currency_parses_case_insensitively() {
        assert_eq!("btc".parse::<Currency>().unwrap(), Currency::Btc);
        assert_eq!("BTC".parse::<Currency>().unwrap(), Currency::Btc);
        assert_eq!("Usd".parse::<Currency>().unwrap(), Currency::Usd);
    }

    #[test]
    fn currency_parse_rejects_unknown() {
        assert!("EUR".parse::<Currency>().is_err());
        assert!("".parse::<Currency>().is_err());
    }

    #[test]
    fn currency_serializes_as_uppercase_string() {
        let json = serde_json::to_string(&Currency::Btc).unwrap();
        assert_eq!(json, "\"BTC\"");
    }

    #[test]
    fn currency_deserializes_from_uppercase_string() {
        let c: Currency = serde_json::from_str("\"USDB\"").unwrap();
        assert_eq!(c, Currency::Usdb);
    }
}
```

- [ ] **Step 4: Add `serde_json` as a dev-dependency**

Edit `crates/agicash-domain/Cargo.toml` to add a dev-deps section:

```toml
[dev-dependencies]
serde_json = { workspace = true }
```

- [ ] **Step 5: Wire the module into `lib.rs`**

Replace `crates/agicash-domain/src/lib.rs` with:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`.

pub mod ids;
pub mod currency;

pub use ids::*;
pub use currency::*;
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS — all tests including the 5 currency tests.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-domain
git commit -m "feat(domain): add Currency enum (BTC, USD, USDB)"
```

---

## Task 4: `agicash-domain` — Account and Transaction stubs

**Files:**
- Create: `crates/agicash-domain/src/account.rs`
- Create: `crates/agicash-domain/src/transaction.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

These are stubs in slice 1 — just enough types for later slices to depend on. Full schemas (encrypted blob fields, mint URLs, derivation paths, etc.) land in slice 3 (Accounts) and slice 4 (Cashu provider).

- [ ] **Step 1: Write tests for `AccountType` and minimal `Account`**

Create `crates/agicash-domain/src/account.rs`:

```rust
use crate::{AccountId, Currency, UserId};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_type_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountType::Cashu).unwrap();
        assert_eq!(json, "\"cashu\"");
        let json = serde_json::to_string(&AccountType::Spark).unwrap();
        assert_eq!(json, "\"spark\"");
    }

    #[test]
    fn account_constructs_with_required_fields() {
        let a = Account {
            id: AccountId::new(),
            user_id: UserId::new(),
            account_type: AccountType::Cashu,
            currency: Currency::Btc,
            name: "Test mint".to_string(),
        };
        assert_eq!(a.account_type, AccountType::Cashu);
    }
}
```

- [ ] **Step 2: Implement the stub types**

Replace `crates/agicash-domain/src/account.rs`:

```rust
use crate::{AccountId, Currency, UserId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AccountType {
    Cashu,
    Spark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Account {
    pub id: AccountId,
    pub user_id: UserId,
    pub account_type: AccountType,
    pub currency: Currency,
    pub name: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn account_type_serializes_as_lowercase() {
        let json = serde_json::to_string(&AccountType::Cashu).unwrap();
        assert_eq!(json, "\"cashu\"");
        let json = serde_json::to_string(&AccountType::Spark).unwrap();
        assert_eq!(json, "\"spark\"");
    }

    #[test]
    fn account_constructs_with_required_fields() {
        let a = Account {
            id: AccountId::new(),
            user_id: UserId::new(),
            account_type: AccountType::Cashu,
            currency: Currency::Btc,
            name: "Test mint".to_string(),
        };
        assert_eq!(a.account_type, AccountType::Cashu);
    }
}
```

- [ ] **Step 3: Write tests for `TransactionState` and minimal `Transaction`**

Create `crates/agicash-domain/src/transaction.rs`:

```rust
use crate::{AccountId, TransactionId, UserId};
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_state_serializes_as_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&TransactionState::Draft).unwrap(),
            "\"DRAFT\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionState::Pending).unwrap(),
            "\"PENDING\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionState::Completed).unwrap(),
            "\"COMPLETED\""
        );
    }

    #[test]
    fn transaction_direction_serializes_as_uppercase() {
        assert_eq!(
            serde_json::to_string(&TransactionDirection::Send).unwrap(),
            "\"SEND\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionDirection::Receive).unwrap(),
            "\"RECEIVE\""
        );
    }
}
```

- [ ] **Step 4: Implement the stub types**

Replace `crates/agicash-domain/src/transaction.rs`:

```rust
use crate::{AccountId, TransactionId, UserId};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum TransactionState {
    Draft,
    Pending,
    Completed,
    Expired,
    Failed,
    Reversed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum TransactionDirection {
    Send,
    Receive,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Transaction {
    pub id: TransactionId,
    pub user_id: UserId,
    pub account_id: AccountId,
    pub state: TransactionState,
    pub direction: TransactionDirection,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transaction_state_serializes_as_screaming_snake_case() {
        assert_eq!(
            serde_json::to_string(&TransactionState::Draft).unwrap(),
            "\"DRAFT\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionState::Pending).unwrap(),
            "\"PENDING\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionState::Completed).unwrap(),
            "\"COMPLETED\""
        );
    }

    #[test]
    fn transaction_direction_serializes_as_uppercase() {
        assert_eq!(
            serde_json::to_string(&TransactionDirection::Send).unwrap(),
            "\"SEND\""
        );
        assert_eq!(
            serde_json::to_string(&TransactionDirection::Receive).unwrap(),
            "\"RECEIVE\""
        );
    }
}
```

- [ ] **Step 5: Wire modules into `lib.rs`**

Replace `crates/agicash-domain/src/lib.rs`:

```rust
//! Foundational domain types for agicash. Zero deps beyond `serde`/`uuid`/`thiserror`.

pub mod ids;
pub mod currency;
pub mod account;
pub mod transaction;

pub use ids::*;
pub use currency::*;
pub use account::*;
pub use transaction::*;
```

- [ ] **Step 6: Run tests**

Run: `cd crates && cargo test -p agicash-domain`

Expected: PASS — all domain tests.

- [ ] **Step 7: Commit**

```bash
git add crates/agicash-domain
git commit -m "feat(domain): add Account, Transaction stubs and their state/direction enums"
```

---

## Task 5: `agicash-money` — Money type with arithmetic and display

**Files:**
- Create: `crates/agicash-money/Cargo.toml`
- Create: `crates/agicash-money/src/lib.rs`
- Create: `crates/agicash-money/src/unit.rs`
- Create: `crates/agicash-money/src/money.rs`

The scaffold `Money` is intentionally minimal: construction, addition, subtraction, currency-mismatch error, equality, `Display`, `is_zero`. Full Money port (locale-aware formatting, exchange-rate conversion, unit conversion across minor/major) lands in slice 4 when accounts get balance displays.

- [ ] **Step 1: Create the crate manifest**

Create `crates/agicash-money/Cargo.toml`:

```toml
[package]
name = "agicash-money"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
serde = { workspace = true }
thiserror = { workspace = true }
rust_decimal = { workspace = true }
rust_decimal_macros = { workspace = true }

[dev-dependencies]
serde_json = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Create lib.rs**

Create `crates/agicash-money/src/lib.rs`:

```rust
//! Money arithmetic with strict currency safety. No floating-point.

pub mod unit;
pub mod money;

pub use unit::*;
pub use money::*;
```

- [ ] **Step 3: Create Unit enum (no tests yet, simple data)**

Create `crates/agicash-money/src/unit.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    /// Bitcoin satoshi (1 BTC = 100_000_000 sat)
    Sat,
    /// USD cent (1 USD = 100 cent)
    Cent,
    /// Major unit (BTC, USD, USDB itself)
    Major,
}

impl fmt::Display for Unit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Sat => "sat",
            Self::Cent => "cent",
            Self::Major => "major",
        })
    }
}
```

- [ ] **Step 4: Write the failing tests for `Money`**

Create `crates/agicash-money/src/money.rs`:

```rust
use crate::Unit;
use agicash_domain::Currency;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn money_constructs_with_amount_currency_unit() {
        let m = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        assert_eq!(m.amount(), dec!(50000));
        assert_eq!(m.currency(), Currency::Btc);
        assert_eq!(m.unit(), Unit::Sat);
    }

    #[test]
    fn money_add_same_currency_unit() {
        let a = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let b = Money::new(dec!(30000), Currency::Btc, Unit::Sat);
        let sum = a.try_add(&b).unwrap();
        assert_eq!(sum.amount(), dec!(80000));
    }

    #[test]
    fn money_sub_same_currency_unit() {
        let a = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let b = Money::new(dec!(30000), Currency::Btc, Unit::Sat);
        let diff = a.try_sub(&b).unwrap();
        assert_eq!(diff.amount(), dec!(20000));
    }

    #[test]
    fn money_add_rejects_currency_mismatch() {
        let btc = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let usd = Money::new(dec!(1000), Currency::Usd, Unit::Cent);
        assert!(matches!(
            btc.try_add(&usd),
            Err(MoneyError::CurrencyMismatch { .. })
        ));
    }

    #[test]
    fn money_add_rejects_unit_mismatch() {
        let sats = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let btc_major = Money::new(dec!(1), Currency::Btc, Unit::Major);
        assert!(matches!(
            sats.try_add(&btc_major),
            Err(MoneyError::UnitMismatch { .. })
        ));
    }

    #[test]
    fn money_is_zero_and_sign_helpers() {
        let zero = Money::new(dec!(0), Currency::Btc, Unit::Sat);
        let pos = Money::new(dec!(1), Currency::Btc, Unit::Sat);
        let neg = Money::new(dec!(-1), Currency::Btc, Unit::Sat);
        assert!(zero.is_zero());
        assert!(pos.is_positive());
        assert!(neg.is_negative());
    }

    #[test]
    fn money_display_includes_amount_currency_unit() {
        let m = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        assert_eq!(m.to_string(), "50000 sat BTC");
    }

    #[test]
    fn money_roundtrips_through_json() {
        let m = Money::new(dec!(50000.5), Currency::Usd, Unit::Cent);
        let json = serde_json::to_string(&m).unwrap();
        let parsed: Money = serde_json::from_str(&json).unwrap();
        assert_eq!(m, parsed);
    }
}
```

- [ ] **Step 5: Run tests — expect failure**

Run: `cd crates && cargo test -p agicash-money`

Expected: FAIL — `Money` and `MoneyError` don't exist yet.

- [ ] **Step 6: Implement `Money` and `MoneyError`**

Replace `crates/agicash-money/src/money.rs`:

```rust
use crate::Unit;
use agicash_domain::Currency;
use rust_decimal::Decimal;
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct Money {
    amount: Decimal,
    currency: Currency,
    unit: Unit,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum MoneyError {
    #[error("currency mismatch: left={left}, right={right}")]
    CurrencyMismatch { left: Currency, right: Currency },
    #[error("unit mismatch: left={left}, right={right}")]
    UnitMismatch { left: Unit, right: Unit },
}

impl Money {
    #[must_use]
    pub fn new(amount: Decimal, currency: Currency, unit: Unit) -> Self {
        Self { amount, currency, unit }
    }

    #[must_use]
    pub fn amount(&self) -> Decimal {
        self.amount
    }

    #[must_use]
    pub fn currency(&self) -> Currency {
        self.currency
    }

    #[must_use]
    pub fn unit(&self) -> Unit {
        self.unit
    }

    pub fn try_add(&self, other: &Self) -> Result<Self, MoneyError> {
        self.check_compatible(other)?;
        Ok(Self::new(self.amount + other.amount, self.currency, self.unit))
    }

    pub fn try_sub(&self, other: &Self) -> Result<Self, MoneyError> {
        self.check_compatible(other)?;
        Ok(Self::new(self.amount - other.amount, self.currency, self.unit))
    }

    #[must_use]
    pub fn is_zero(&self) -> bool {
        self.amount.is_zero()
    }

    #[must_use]
    pub fn is_positive(&self) -> bool {
        self.amount.is_sign_positive() && !self.amount.is_zero()
    }

    #[must_use]
    pub fn is_negative(&self) -> bool {
        self.amount.is_sign_negative() && !self.amount.is_zero()
    }

    fn check_compatible(&self, other: &Self) -> Result<(), MoneyError> {
        if self.currency != other.currency {
            return Err(MoneyError::CurrencyMismatch {
                left: self.currency,
                right: other.currency,
            });
        }
        if self.unit != other.unit {
            return Err(MoneyError::UnitMismatch {
                left: self.unit,
                right: other.unit,
            });
        }
        Ok(())
    }
}

impl fmt::Display for Money {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} {} {}", self.amount, self.unit, self.currency)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rust_decimal_macros::dec;

    #[test]
    fn money_constructs_with_amount_currency_unit() {
        let m = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        assert_eq!(m.amount(), dec!(50000));
        assert_eq!(m.currency(), Currency::Btc);
        assert_eq!(m.unit(), Unit::Sat);
    }

    #[test]
    fn money_add_same_currency_unit() {
        let a = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let b = Money::new(dec!(30000), Currency::Btc, Unit::Sat);
        let sum = a.try_add(&b).unwrap();
        assert_eq!(sum.amount(), dec!(80000));
    }

    #[test]
    fn money_sub_same_currency_unit() {
        let a = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let b = Money::new(dec!(30000), Currency::Btc, Unit::Sat);
        let diff = a.try_sub(&b).unwrap();
        assert_eq!(diff.amount(), dec!(20000));
    }

    #[test]
    fn money_add_rejects_currency_mismatch() {
        let btc = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let usd = Money::new(dec!(1000), Currency::Usd, Unit::Cent);
        assert!(matches!(
            btc.try_add(&usd),
            Err(MoneyError::CurrencyMismatch { .. })
        ));
    }

    #[test]
    fn money_add_rejects_unit_mismatch() {
        let sats = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        let btc_major = Money::new(dec!(1), Currency::Btc, Unit::Major);
        assert!(matches!(
            sats.try_add(&btc_major),
            Err(MoneyError::UnitMismatch { .. })
        ));
    }

    #[test]
    fn money_is_zero_and_sign_helpers() {
        let zero = Money::new(dec!(0), Currency::Btc, Unit::Sat);
        let pos = Money::new(dec!(1), Currency::Btc, Unit::Sat);
        let neg = Money::new(dec!(-1), Currency::Btc, Unit::Sat);
        assert!(zero.is_zero());
        assert!(pos.is_positive());
        assert!(neg.is_negative());
    }

    #[test]
    fn money_display_includes_amount_currency_unit() {
        let m = Money::new(dec!(50000), Currency::Btc, Unit::Sat);
        assert_eq!(m.to_string(), "50000 sat BTC");
    }

    #[test]
    fn money_roundtrips_through_json() {
        let m = Money::new(dec!(50000.5), Currency::Usd, Unit::Cent);
        let json = serde_json::to_string(&m).unwrap();
        let parsed: Money = serde_json::from_str(&json).unwrap();
        assert_eq!(m, parsed);
    }
}
```

- [ ] **Step 7: Run tests — expect pass**

Run: `cd crates && cargo test -p agicash-money`

Expected: PASS — 8 tests pass.

- [ ] **Step 8: Commit**

```bash
git add crates/agicash-money
git commit -m "feat(money): add Money type with currency/unit-safe arithmetic"
```

---

## Task 6: Stub the remaining 10 library crates

Each crate gets a minimal `Cargo.toml` and a `lib.rs` with just a module-level doc comment. These exist so the workspace builds; they get real implementation in later slices.

**Files (Create each one):**
- `crates/agicash-crypto/{Cargo.toml,src/lib.rs}`
- `crates/agicash-traits/{Cargo.toml,src/lib.rs}`
- `crates/agicash-cashu/{Cargo.toml,src/lib.rs}`
- `crates/agicash-spark/{Cargo.toml,src/lib.rs}`
- `crates/agicash-storage-supabase/{Cargo.toml,src/lib.rs}`
- `crates/agicash-auth-opensecret/{Cargo.toml,src/lib.rs}`
- `crates/agicash-cache/{Cargo.toml,src/lib.rs}`
- `crates/agicash-services/{Cargo.toml,src/lib.rs}`
- `crates/agicash-wallet/{Cargo.toml,src/lib.rs}`
- `crates/agicash-testing/{Cargo.toml,src/lib.rs}`

- [ ] **Step 1: Create `agicash-crypto` stub**

Create `crates/agicash-crypto/Cargo.toml`:

```toml
[package]
name = "agicash-crypto"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[lints]
workspace = true
```

Create `crates/agicash-crypto/src/lib.rs`:

```rust
//! Encryption + key derivation helpers. Filled in slice 3+.
```

- [ ] **Step 2: Create `agicash-traits` stub**

Create `crates/agicash-traits/Cargo.toml`:

```toml
[package]
name = "agicash-traits"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
async-trait = { workspace = true }

[lints]
workspace = true
```

Create `crates/agicash-traits/src/lib.rs`:

```rust
//! Trait boundaries between abstract and concrete impls. Filled per slice.
```

- [ ] **Step 3: Create `agicash-cashu` stub**

Create `crates/agicash-cashu/Cargo.toml`:

```toml
[package]
name = "agicash-cashu"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }

[lints]
workspace = true
```

Create `crates/agicash-cashu/src/lib.rs`:

```rust
//! Cashu protocol primitives and per-feature state machines.
//! Filled starting in slice 4.
```

- [ ] **Step 4: Create `agicash-spark` stub**

Create `crates/agicash-spark/Cargo.toml`:

```toml
[package]
name = "agicash-spark"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }

[lints]
workspace = true
```

Create `crates/agicash-spark/src/lib.rs`:

```rust
//! Spark provider wrapping our Breez SDK fork.
//! Filled starting in slice 9.
```

- [ ] **Step 5: Create `agicash-storage-supabase` stub**

Create `crates/agicash-storage-supabase/Cargo.toml`:

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

[lints]
workspace = true
```

Create `crates/agicash-storage-supabase/src/lib.rs`:

```rust
//! Storage trait impls over postgrest. Filled starting in slice 3.
```

- [ ] **Step 6: Create `agicash-auth-opensecret` stub**

Create `crates/agicash-auth-opensecret/Cargo.toml`:

```toml
[package]
name = "agicash-auth-opensecret"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-traits = { path = "../agicash-traits" }

[lints]
workspace = true
```

Create `crates/agicash-auth-opensecret/src/lib.rs`:

```rust
//! KeyProvider + TokenProvider impls over opensecret 0.2.9.
//! Filled in slice 2.
```

- [ ] **Step 7: Create `agicash-cache` stub**

Create `crates/agicash-cache/Cargo.toml`:

```toml
[package]
name = "agicash-cache"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }

[lints]
workspace = true
```

Create `crates/agicash-cache/src/lib.rs`:

```rust
//! WalletCache + event bus + subscription primitives.
//! Filled starting in slice 11.
```

- [ ] **Step 8: Create `agicash-services` stub**

Create `crates/agicash-services/Cargo.toml`:

```toml
[package]
name = "agicash-services"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }
agicash-traits = { path = "../agicash-traits" }
agicash-cache = { path = "../agicash-cache" }
agicash-cashu = { path = "../agicash-cashu" }
agicash-spark = { path = "../agicash-spark" }

[lints]
workspace = true
```

Create `crates/agicash-services/src/lib.rs`:

```rust
//! Async orchestrators per feature. Filled per slice 5+.
```

- [ ] **Step 9: Create `agicash-wallet` stub**

Create `crates/agicash-wallet/Cargo.toml`:

```toml
[package]
name = "agicash-wallet"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }
agicash-traits = { path = "../agicash-traits" }
agicash-cache = { path = "../agicash-cache" }
agicash-services = { path = "../agicash-services" }

[lints]
workspace = true
```

Create `crates/agicash-wallet/src/lib.rs`:

```rust
//! WalletClient facade — the only crate consumers (CLI, WASM) depend on directly.
//! Filled starting in slice 12.
```

- [ ] **Step 10: Create `agicash-testing` stub**

Create `crates/agicash-testing/Cargo.toml`:

```toml
[package]
name = "agicash-testing"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }

[lints]
workspace = true
```

Create `crates/agicash-testing/src/lib.rs`:

```rust
//! In-memory fakes, fixtures, and test data builders. Filled per slice.
```

- [ ] **Step 11: Verify the workspace builds**

Run: `cd crates && cargo build`

Expected: PASS — all 12 library crates compile (domain, money, plus 10 stubs).

- [ ] **Step 12: Commit**

```bash
git add crates/agicash-crypto crates/agicash-traits crates/agicash-cashu crates/agicash-spark crates/agicash-storage-supabase crates/agicash-auth-opensecret crates/agicash-cache crates/agicash-services crates/agicash-wallet crates/agicash-testing
git commit -m "chore(rust): stub remaining lib crates so workspace builds"
```

---

## Task 7: `agicash-wasm` crate

**Files:**
- Create: `crates/agicash-wasm/Cargo.toml`
- Create: `crates/agicash-wasm/src/lib.rs`

- [ ] **Step 1: Create the crate manifest with `cdylib`**

Create `crates/agicash-wasm/Cargo.toml`:

```toml
[package]
name = "agicash-wasm"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
wasm-bindgen = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Create a minimal wasm-bindgen export**

Create `crates/agicash-wasm/src/lib.rs`:

```rust
//! WASM bindings for the agicash Rust SDK. Real surface fills in slice 13.

use wasm_bindgen::prelude::*;

/// Placeholder until the real Wallet binding lands in slice 13.
/// Lets us verify the WASM build pipeline works during scaffold.
#[wasm_bindgen]
#[must_use]
pub fn agicash_wasm_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
```

- [ ] **Step 3: Verify it builds for the host**

Run: `cd crates && cargo build -p agicash-wasm`

Expected: PASS — agicash-wasm builds for host target.

- [ ] **Step 4: Verify it builds for wasm32-unknown-unknown**

Run: `cd crates && cargo build --target wasm32-unknown-unknown -p agicash-wasm`

Expected: PASS — agicash-wasm builds as a `cdylib` for wasm32. If the target is not installed, the toolchain pin in `rust-toolchain.toml` (Task 1, Step 2) should install it automatically; if it doesn't, run `rustup target add wasm32-unknown-unknown` once.

- [ ] **Step 5: Commit**

```bash
git add crates/agicash-wasm
git commit -m "feat(wasm): add agicash-wasm crate compiling to wasm32-unknown-unknown"
```

---

## Task 8: `agicash-cli` skeleton

**Files:**
- Create: `crates/agicash-cli/Cargo.toml`
- Create: `crates/agicash-cli/src/main.rs`
- Create: `crates/agicash-cli/src/cli.rs`

- [ ] **Step 1: Create the crate manifest**

Create `crates/agicash-cli/Cargo.toml`:

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

[dependencies]
agicash-domain = { path = "../agicash-domain" }
agicash-money = { path = "../agicash-money" }
agicash-wallet = { path = "../agicash-wallet" }
clap = { workspace = true }
tokio = { workspace = true }

[dev-dependencies]
assert_cmd = { workspace = true }
predicates = { workspace = true }

[lints]
workspace = true
```

- [ ] **Step 2: Create the `Cli` struct in `cli.rs`**

Create `crates/agicash-cli/src/cli.rs`:

```rust
use clap::{Parser, Subcommand};

#[derive(Parser, Debug)]
#[command(name = "agicash", version, about = "Agicash CLI — self-custody Bitcoin wallet")]
pub struct Cli {
    /// Output as JSON instead of human-readable text.
    #[arg(long, global = true)]
    pub json: bool,

    #[command(subcommand)]
    pub cmd: Option<Command>,
}

#[derive(Subcommand, Debug)]
pub enum Command {
    /// Print the SDK version.
    Version,
}
```

(Subcommands are intentionally minimal in this slice. Real `auth`, `account`, `balance`, etc. land in slice 2+.)

- [ ] **Step 3: Create `main.rs`**

Create `crates/agicash-cli/src/main.rs`:

```rust
mod cli;

use clap::Parser;
use cli::{Cli, Command};

#[tokio::main]
async fn main() {
    let args = Cli::parse();
    match args.cmd {
        Some(Command::Version) => println!("{}", env!("CARGO_PKG_VERSION")),
        None => {
            // With no subcommand and no --help/--version flag, fall through silently.
            // Real dispatch lands in slice 2 (auth).
        }
    }
}
```

- [ ] **Step 4: Verify it builds**

Run: `cd crates && cargo build -p agicash-cli`

Expected: PASS.

- [ ] **Step 5: Run the binary manually to sanity-check**

Run: `cd crates && cargo run -p agicash-cli -- --help`

Expected: clap prints usage including the `--json` flag and `version` subcommand.

Run: `cd crates && cargo run -p agicash-cli -- version`

Expected: prints `0.1.0`.

- [ ] **Step 6: Commit**

```bash
git add crates/agicash-cli
git commit -m "feat(cli): add agicash CLI binary skeleton with --help and version"
```

---

## Task 9: CLI integration test (`agicash --help`)

**Files:**
- Create: `crates/agicash-cli/tests/help.rs`

- [ ] **Step 1: Write the failing integration test**

Create `crates/agicash-cli/tests/help.rs`:

```rust
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
```

- [ ] **Step 2: Run the test**

Run: `cd crates && cargo test -p agicash-cli --test help`

Expected: PASS — all 3 tests pass (the binary was built in Task 8 and works).

- [ ] **Step 3: Commit**

```bash
git add crates/agicash-cli/tests
git commit -m "test(cli): assert_cmd integration test for --help, version, unknown subcommand"
```

---

## Task 10: CI workflow

**Files:**
- Create: `.github/workflows/rust.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/rust.yml`:

```yaml
name: Rust

on:
  pull_request:
    paths:
      - "crates/**"
      - ".github/workflows/rust.yml"
  push:
    branches: [master]
    paths:
      - "crates/**"
      - ".github/workflows/rust.yml"

env:
  CARGO_TERM_COLOR: always
  RUST_BACKTRACE: 1

jobs:
  fmt:
    name: cargo fmt
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: crates
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.83.0
        with:
          components: rustfmt
      - run: cargo fmt --all --check

  clippy:
    name: cargo clippy
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: crates
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.83.0
        with:
          components: clippy
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: crates -> target
      - run: cargo clippy --workspace --all-targets -- -D warnings

  test:
    name: cargo test
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: crates
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.83.0
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: crates -> target
      - run: cargo test --workspace

  wasm-build:
    name: cargo build wasm32
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: crates
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@1.83.0
        with:
          targets: wasm32-unknown-unknown
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: crates -> target
      - run: cargo build --target wasm32-unknown-unknown -p agicash-wasm
```

- [ ] **Step 2: Verify fmt + clippy locally before committing**

Run: `cd crates && cargo fmt --all --check`

Expected: PASS (no diff). If it fails, run `cargo fmt --all` and inspect the diff before continuing.

Run: `cd crates && cargo clippy --workspace --all-targets -- -D warnings`

Expected: PASS (no warnings or errors).

If clippy flags anything, fix it before committing — the CI will fail on the same warnings.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/rust.yml
git commit -m "ci(rust): add fmt + clippy + test + wasm build workflow"
```

---

## Task 11: `bun` scripts for WASM build + `wasm-pack` install hint

**Files:**
- Modify: root `package.json`

- [ ] **Step 1: Add scripts to `package.json`**

Open root `package.json`. In the `"scripts"` section, add:

```jsonc
"wasm:build": "wasm-pack build crates/agicash-wasm --target bundler --out-dir pkg --release",
"wasm:build:dev": "wasm-pack build crates/agicash-wasm --target bundler --out-dir pkg --dev",
"wasm:watch": "cargo watch -w crates -s 'bun run wasm:build:dev'"
```

(Place them alphabetically near other build-related scripts, e.g. after `wasm-cleanup` if one exists, or near the end of the scripts block.)

- [ ] **Step 2: Verify `wasm-pack` is available, install if not**

Run: `wasm-pack --version`

Expected output: a version like `wasm-pack 0.13.x`.

If `wasm-pack` is not found, install via:

```bash
cargo install wasm-pack --locked
```

(Do not commit anything from this step — it's a developer-environment setup. If the team prefers a different installation method, document it separately. For CI we rely on `cargo build --target wasm32-unknown-unknown` and not `wasm-pack`, so the workflow doesn't need wasm-pack installed.)

- [ ] **Step 3: Run the wasm:build script**

Run: `bun run wasm:build`

Expected: `wasm-pack` produces `crates/agicash-wasm/pkg/` with `agicash_wasm.js`, `agicash_wasm_bg.wasm`, `package.json`, etc.

- [ ] **Step 4: Confirm `pkg/` is gitignored**

Run: `git status crates/agicash-wasm/pkg`

Expected: `pkg` is NOT shown as untracked (it should be ignored via the `**/pkg` line in `crates/.gitignore` from Task 1).

If it shows up, append `crates/agicash-wasm/pkg` to `crates/.gitignore` and re-test.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore(wasm): add bun scripts wasm:build, wasm:build:dev, wasm:watch"
```

---

## Task 12: `crates/README.md` workspace overview

**Files:**
- Create: `crates/README.md`

- [ ] **Step 1: Create the README**

Create `crates/README.md`:

````markdown
# Agicash Rust SDK

Rust core for the agicash wallet. Powers the CLI today, the web app via WASM
later, and future native shells.

See [the design spec](../docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md)
for architecture, slicing, and rationale.

## Workspace layout

```
crates/
├── agicash-domain/             # foundational types: ids, currency, account, transaction
├── agicash-money/              # currency- and unit-safe arithmetic
├── agicash-crypto/             # xchacha20poly1305 + key derivation helpers (per slice)
├── agicash-traits/             # Storage*, KeyProvider, TokenProvider, providers, Clock
├── agicash-cashu/              # cdk wrapper + sans-IO state machines per feature
├── agicash-spark/              # Breez SDK Spark fork wrapper + state machines
├── agicash-storage-supabase/   # Storage trait impls over postgrest
├── agicash-auth-opensecret/    # KeyProvider + TokenProvider over opensecret 0.2.9
├── agicash-cache/              # WalletCache + event bus + subscription primitives
├── agicash-services/           # async orchestrators per feature
├── agicash-wallet/             # WalletClient facade — the public surface
├── agicash-cli/                # bin: clap + tokio + wallet
├── agicash-wasm/               # cdylib: wasm-bindgen wrappers
└── agicash-testing/            # in-memory fakes, fixtures, builders
```

## Common commands

From the repo root:

```bash
# build the whole workspace
cd crates && cargo build

# run all tests
cd crates && cargo test

# lint
cd crates && cargo clippy --workspace --all-targets -- -D warnings

# format
cd crates && cargo fmt --all

# build the WASM bundle for the web app
bun run wasm:build

# build CLI binary
cd crates && cargo build --release -p agicash-cli
# then ./crates/target/release/agicash --help
```

## Running the CLI

```bash
cd crates && cargo run -p agicash-cli -- --help
cd crates && cargo run -p agicash-cli -- version
```

Real subcommands (`auth login`, `balance`, `send`, etc.) ship in subsequent
slices — see `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` §16.
````

- [ ] **Step 2: Commit**

```bash
git add crates/README.md
git commit -m "docs(rust): add workspace README"
```

---

## Task 13: Final verification — the slice-1 test bar

This task confirms slice 1 is complete by running every check the spec promised.

- [ ] **Step 1: `cargo build` passes**

Run: `cd crates && cargo build --workspace`

Expected: PASS, no warnings.

- [ ] **Step 2: `cargo test` passes**

Run: `cd crates && cargo test --workspace`

Expected: PASS — all `agicash-domain`, `agicash-money`, and `agicash-cli` tests succeed; stub crates have no tests but compile.

- [ ] **Step 3: `cargo clippy -- -D warnings` passes**

Run: `cd crates && cargo clippy --workspace --all-targets -- -D warnings`

Expected: PASS, no warnings.

- [ ] **Step 4: `cargo fmt --check` passes**

Run: `cd crates && cargo fmt --all --check`

Expected: PASS, no diff.

- [ ] **Step 5: WASM target builds**

Run: `cd crates && cargo build --target wasm32-unknown-unknown -p agicash-wasm`

Expected: PASS.

- [ ] **Step 6: `agicash --help` prints usage**

Run: `cd crates && cargo run -p agicash-cli -- --help`

Expected: clap-formatted usage including the `--json` flag and `version` subcommand.

- [ ] **Step 7: `bun run wasm:build` produces a `pkg/` bundle**

Run: `bun run wasm:build`

Expected: `crates/agicash-wasm/pkg/` is created with `.wasm`, `.js`, and `package.json` files. (Not committed; the `.gitignore` excludes it.)

- [ ] **Step 8: Open a PR (or merge directly per team practice)**

Push the branch and open a PR titled "Rust SDK scaffold (slice 1 of 14)". Reference the spec doc in the PR body. The Rust CI workflow runs on this PR and should be green across all 4 jobs (fmt, clippy, test, wasm-build).

After merge, slice 1 is done. The next plan to write is for **slice 2 — Auth**.

---

## Notes for the executor

- **Do not implement anything from slice 2+.** Resist the urge to put real code in `agicash-traits` or `agicash-auth-opensecret`. Stub means stub.
- **Type names from this slice are load-bearing in later slices.** `UserId`, `AccountId`, `TransactionId`, `QuoteId`, `ProofId`, `ClientId`, `Currency`, `AccountType`, `Account`, `TransactionState`, `TransactionDirection`, `Transaction`, `Unit`, `Money`, `MoneyError`. If you rename any of them, update the spec accordingly.
- **`crates/Cargo.toml` is the workspace manifest.** Run cargo from inside `crates/` or use `cargo --manifest-path crates/Cargo.toml ...`. The README documents the convention.
- **The CI workflow runs only on `crates/**` changes** so it doesn't fire on every TS-only PR.
- **No `Cargo.lock` strategy decision** in slice 1: it's committed by default (the workspace has a binary crate). If we later add gitignore for it, that's a separate change.
