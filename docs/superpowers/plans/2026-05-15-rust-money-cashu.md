# Agicash Rust SDK — Money Port + CashuProvider Scaffolding (Slice 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the `agicash-money` port to full arithmetic parity with the TypeScript `Money` class, then build out `agicash-cashu` with a concrete `CashuProvider` implementation that can connect to a real Cashu mint and fetch its info. After this slice, `agicash mint add <url>` persists a Cashu account row and `agicash balance` reads and displays zero balance from that account. All prior slice tests continue to pass.

**What "full Money port" means:** The slice-1 stub covers construction + add/sub + sign helpers. "Full" means the arithmetic surface needed by all subsequent slices (5–12): `multiply`, `divide`, cross-unit conversion (`to_unit`: sat↔msat↔major), `sum`/`min`/`max` static helpers, and `convert` (currency exchange). Display formatting (locale, symbol) is deferred — the CLI only needs plain decimal output for v1. `toLocaleString` and `toLocalizedStringParts` have no direct Rust equivalent and are WASM-surface concerns; explicitly out of scope.

**What "CashuProvider basics" means:** The `CashuProvider` trait (spec §7) added to `agicash-traits`, a concrete `CdkCashuProvider` in `agicash-cashu` that wraps CDK's `HttpClient`/`MintConnector`, and two read-only operations: `mint_info` and `wallet_for_account`. No minting, melting, or swapping yet — those are slices 5–8.

**Architecture:** `agicash-money` stays in its own crate (not merged into `agicash-domain`). The `CashuProvider` trait lives in `agicash-traits` (the seam crate); the concrete impl in `agicash-cashu`. CLI gains two new subcommands wired through a thin `CashuDeps` composition struct.

**Tech stack additions:** `cdk = { version = "0.15", features = ["wallet"], default-features = false }` (Cashu Development Kit; `wallet` feature gates `MintConnector` + `HttpClient`). No new noble/* equivalents — CDK vendors its own crypto. `rust_decimal_macros` stays in `[dev-dependencies]` per commit `398df24b`; production code uses `Decimal::from_str` instead.

**Branch:** Execute from `feat/rust-money-cashu` branched off `feat/rust-accounts` in a new worktree at `/Users/claude/agicash/.claude/worktrees/rust-money-cashu` (the executor creates it).

---

## WASM compatibility flag

The Money arithmetic additions (multiply, divide, convert, sum/min/max, to_unit) are pure `rust_decimal` operations — fully WASM-compatible. The CDK `wallet` feature pulls in `reqwest` with native TLS. The `agicash-cashu` crate must NOT appear in `agicash-wasm`'s dependency graph. The `CashuProvider` trait in `agicash-traits` is fine to include in WASM (it's a trait definition), but the concrete `CdkCashuProvider` with CDK's native-TLS `reqwest` stays out of `agicash-wasm` until slice 13 resolves the WASM HTTP transport question.

Verify with `cargo tree -p agicash-wasm | grep agicash-cashu` returning empty.

---

## File structure

```
crates/
├── Cargo.toml                                      # MODIFY — add cdk dep
├── agicash-money/
│   └── src/
│       ├── unit.rs                                 # MODIFY — add Msat variant
│       └── money.rs                                # MODIFY — add multiply, divide, sum, min, max, convert, to_unit
├── agicash-traits/
│   ├── Cargo.toml                                  # MODIFY — add cdk dep
│   └── src/
│       ├── lib.rs                                  # MODIFY — wire cashu_provider module
│       └── cashu_provider.rs                       # NEW — CashuProvider trait, CashuMintWallet, CashuProviderError
├── agicash-cashu/
│   ├── Cargo.toml                                  # MODIFY — add deps + real-mint-tests feature
│   └── src/
│       ├── lib.rs                                  # MODIFY — wire new modules
│       ├── error.rs                                # NEW — free conversion helpers (orphan rule)
│       └── provider.rs                             # NEW — CdkCashuProvider struct + CashuProvider impl
└── agicash-cli/
    ├── Cargo.toml                                  # MODIFY — add agicash-cashu dep + real-mint-tests feature
    ├── src/
    │   ├── cli.rs                                  # MODIFY — add MintCommand + Balance to Command enum
    │   ├── composition.rs                          # MODIFY — add build_cashu_deps() + CashuDeps
    │   ├── main.rs                                 # MODIFY — dispatch mint + balance, add MintCmdError to classify_error
    │   └── mint.rs                                 # NEW — cmd_mint_add, cmd_balance
    └── tests/
        └── mint.rs                                 # NEW — gated integration test (real-mint-tests)
```

---

## Task 1: Extend `agicash-money` — full arithmetic port

**What changes:** Add `Msat` to `Unit`, add `multiply`, `divide`, `sum`, `min`, `max`, `convert`, and `to_unit` to `Money`. The existing `try_add`/`try_sub` remain unit-strict. `to_unit` enables cross-unit normalization (e.g., sat → msat for Lightning fee math in slice 6).

**Why Msat now:** CDK returns Lightning fee estimates in millisatoshis. Slice 6 (Cashu send quote) needs to represent fees accurately. Without `Msat`, fee amounts truncate silently.

**Files:**
- Modify: `crates/agicash-money/src/unit.rs`
- Modify: `crates/agicash-money/src/money.rs`

### Steps

- [ ] **Step 1: Write failing tests** in the existing `#[cfg(test)]` module in `money.rs`:

```rust
#[test]
fn money_multiply() {
    let m = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
    let result = m.multiply(dec!(1.5));
    assert_eq!(result.amount(), dec!(1500));
    assert_eq!(result.unit(), Unit::Sat);
}

#[test]
fn money_divide() {
    let m = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
    let result = m.divide(dec!(4));
    assert_eq!(result.amount(), dec!(250));
}

#[test]
fn money_divide_rounds_down() {
    // 1000 / 3 = 333.33... → 333 sat (floor to unit precision)
    let m = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
    let result = m.divide(dec!(3));
    assert_eq!(result.amount(), dec!(333));
}

#[test]
fn money_sum_non_empty() {
    let moneys = vec![
        Money::new(dec!(100), Currency::Btc, Unit::Sat),
        Money::new(dec!(200), Currency::Btc, Unit::Sat),
        Money::new(dec!(300), Currency::Btc, Unit::Sat),
    ];
    let total = Money::sum(moneys).unwrap();
    assert_eq!(total.amount(), dec!(600));
}

#[test]
fn money_sum_empty_returns_none() {
    let result = Money::sum(Vec::<Money>::new());
    assert!(result.is_none());
}

#[test]
fn money_min_max() {
    let moneys = vec![
        Money::new(dec!(100), Currency::Btc, Unit::Sat),
        Money::new(dec!(500), Currency::Btc, Unit::Sat),
        Money::new(dec!(200), Currency::Btc, Unit::Sat),
    ];
    assert_eq!(Money::min(moneys.clone()).unwrap().amount(), dec!(100));
    assert_eq!(Money::max(moneys).unwrap().amount(), dec!(500));
}

#[test]
fn money_min_max_empty_returns_none() {
    assert!(Money::min(Vec::<Money>::new()).is_none());
    assert!(Money::max(Vec::<Money>::new()).is_none());
}

#[test]
fn money_convert_btc_to_usd() {
    let btc = Money::new(dec!(1), Currency::Btc, Unit::Major);
    let usd = btc.convert(Currency::Usd, dec!(50000));
    assert_eq!(usd.currency(), Currency::Usd);
    assert_eq!(usd.amount(), dec!(50000));
    assert_eq!(usd.unit(), Unit::Major);
}

#[test]
fn money_to_unit_sat_to_msat() {
    let sats = Money::new(dec!(1000), Currency::Btc, Unit::Sat);
    let msat = sats.to_unit(Unit::Msat).unwrap();
    assert_eq!(msat.amount(), dec!(1000000));
    assert_eq!(msat.unit(), Unit::Msat);
}

#[test]
fn money_to_unit_msat_to_sat_floors() {
    // 1500 msat = 1.5 sat → floor to 1 sat
    let msat = Money::new(dec!(1500), Currency::Btc, Unit::Msat);
    let sats = msat.to_unit(Unit::Sat).unwrap();
    assert_eq!(sats.amount(), dec!(1));
}

#[test]
fn money_to_unit_rejects_incompatible_currency_unit_pair() {
    let usd = Money::new(dec!(100), Currency::Usd, Unit::Major);
    assert!(usd.to_unit(Unit::Sat).is_err());
}
```

- [ ] **Step 2: Run tests — expect FAIL.** `cd crates && cargo test -p agicash-money`

- [ ] **Step 3: Add `Msat` to `Unit`** — replace `crates/agicash-money/src/unit.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::fmt;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    /// Bitcoin satoshi (1 BTC = 100_000_000 sat)
    Sat,
    /// Bitcoin millisatoshi (1 sat = 1_000 msat; 1 BTC = 100_000_000_000 msat)
    Msat,
    /// USD cent (1 USD = 100 cent)
    Cent,
    /// Major unit: BTC, USD, or USDB in their base denomination
    Major,
}

impl fmt::Display for Unit {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::Sat => "sat",
            Self::Msat => "msat",
            Self::Cent => "cent",
            Self::Major => "major",
        })
    }
}
```

- [ ] **Step 4: Implement arithmetic extensions on `Money`** — add to the `impl Money` block:

```rust
/// Multiplies this amount by `factor`. Unit and currency preserved.
/// No rounding (full decimal precision retained); callers floor for wire format.
#[must_use]
pub fn multiply(&self, factor: Decimal) -> Self {
    Self::new(self.amount * factor, self.currency, self.unit)
}

/// Divides by `divisor`, flooring to unit precision (0 for sat/msat/cent, 8 for BTC major, 2 for USD major).
/// Panics if divisor is zero.
#[must_use]
pub fn divide(&self, divisor: Decimal) -> Self {
    let raw = self.amount / divisor;
    let scale = unit_scale(self.currency, self.unit);
    let floored = raw.round_dp_with_strategy(scale, rust_decimal::RoundingStrategy::ToZero);
    Self::new(floored, self.currency, self.unit)
}

/// Sums a slice. Empty → None. All must share currency+unit — panics otherwise.
pub fn sum(moneys: Vec<Self>) -> Option<Self> {
    let mut iter = moneys.into_iter();
    let first = iter.next()?;
    Some(iter.fold(first, |acc, m| acc.try_add(&m).expect("sum: currency/unit mismatch")))
}

pub fn min(moneys: Vec<Self>) -> Option<Self> {
    moneys.into_iter().reduce(|a, b| if b.amount < a.amount { b } else { a })
}

pub fn max(moneys: Vec<Self>) -> Option<Self> {
    moneys.into_iter().reduce(|a, b| if b.amount > a.amount { b } else { a })
}

/// Converts to another currency. `rate` = target-major-units per source-major-unit.
/// Result is in target currency at Major unit, rounded to target's major-unit precision.
pub fn convert(&self, target: Currency, rate: Decimal) -> Money {
    let in_major = self.to_unit(Unit::Major)
        .expect("convert: source unit incompatible with currency");
    let raw = in_major.amount * rate;
    let scale = unit_scale(target, Unit::Major);
    let rounded = raw.round_dp_with_strategy(scale, rust_decimal::RoundingStrategy::MidpointNearestEven);
    Money::new(rounded, target, Unit::Major)
}

/// Converts to a different unit within the same currency.
/// Returns IncompatibleUnit if the unit doesn't belong to this currency.
pub fn to_unit(&self, target: Unit) -> Result<Self, MoneyError> {
    if self.unit == target {
        return Ok(*self);
    }
    let from_factor = unit_factor(self.currency, self.unit)?;
    let to_factor = unit_factor(self.currency, target)?;
    let raw = self.amount * from_factor / to_factor;
    let scale = unit_scale(self.currency, target);
    let floored = raw.round_dp_with_strategy(scale, rust_decimal::RoundingStrategy::ToZero);
    Ok(Self::new(floored, self.currency, target))
}
```

Add private helpers after the `impl` block. Use `Decimal::from_str(...).unwrap()` (not the `dec!` macro) so this doesn't require `rust_decimal_macros` as a production dep:

```rust
fn unit_scale(currency: Currency, unit: Unit) -> u32 {
    match (currency, unit) {
        (_, Unit::Sat) | (_, Unit::Msat) | (_, Unit::Cent) => 0,
        (Currency::Btc, Unit::Major) => 8,
        (Currency::Usd | Currency::Usdb, Unit::Major) => 2,
    }
}

fn unit_factor(currency: Currency, unit: Unit) -> Result<Decimal, MoneyError> {
    use std::str::FromStr;
    match (currency, unit) {
        (Currency::Btc, Unit::Major) => Ok(Decimal::ONE),
        (Currency::Btc, Unit::Sat)   => Ok(Decimal::from_str("0.00000001").unwrap()),
        (Currency::Btc, Unit::Msat)  => Ok(Decimal::from_str("0.00000000001").unwrap()),
        (Currency::Usd | Currency::Usdb, Unit::Major) => Ok(Decimal::ONE),
        (Currency::Usd | Currency::Usdb, Unit::Cent)  => Ok(Decimal::from_str("0.01").unwrap()),
        _ => Err(MoneyError::IncompatibleUnit { currency, unit }),
    }
}
```

**Executor note:** Add a new `MoneyError::IncompatibleUnit { currency: Currency, unit: Unit }` variant. Existing `UnitMismatch { left, right }` is for the `try_add` case (two unit values disagree); the new variant is for currency↔unit incompatibility.

- [ ] **Step 5: Run tests — expect PASS.** All existing tests + 11 new tests.

- [ ] **Step 6: Clippy + fmt clean** — `cargo clippy -p agicash-money -- -D warnings` and `cargo fmt -p agicash-money -- --check`.

- [ ] **Step 7: Commit** — `feat(money): full arithmetic port — multiply, divide, sum/min/max, convert, to_unit, Msat unit`

---

## Task 2: Add `cdk` to workspace dependencies

**Files:** `crates/Cargo.toml`

- [ ] **Step 1:** Add under `[workspace.dependencies]`:

```toml
cdk = { version = "0.15", features = ["wallet"], default-features = false }
```

Before adding, check `crates.io/crates/cdk` for the latest version; use it if newer and note the deviation. `default-features = false` disables mint-server features.

- [ ] **Step 2:** `cargo build --workspace` clean. If CDK introduces a dep version conflict (e.g., `bitcoin`, `lightning`, `time`), add that dep to `[workspace.dependencies]` to let Cargo resolve. Log conflicts as open items.

- [ ] **Step 3: Commit** — `chore(deps): add cdk wallet feature to workspace`

---

## Task 3: `CashuProvider` trait in `agicash-traits`

**Files:**
- Modify: `crates/agicash-traits/Cargo.toml`
- Create: `crates/agicash-traits/src/cashu_provider.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

Trait parameters use CDK types directly (`MintInfo`, `MintUrl`). Wrapping them in newtypes for v1 is premature abstraction.

**Before writing,** verify CDK module paths from source:
- `MintUrl` — likely `cdk_common::mint_url::MintUrl` or `cdk::nuts::MintUrl`
- `MintInfo` — likely `cdk::nuts::MintInfo` or `cdk_common::nuts::nut06::MintInfo`
- `MintConnector` (trait) — likely `cdk::wallet::MintConnector`

Run `cargo doc -p cdk --open` in `crates/` or `grep -r "pub trait MintConnector" ~/.cargo/registry/src/` to confirm.

### Steps

- [ ] **Step 1:** Add `cdk = { workspace = true }` to `crates/agicash-traits/Cargo.toml`.

- [ ] **Step 2:** Create `crates/agicash-traits/src/cashu_provider.rs`:

```rust
use std::sync::Arc;
use async_trait::async_trait;
use cdk::nuts::MintInfo;
use cdk::wallet::MintConnector;
use cdk_common::mint_url::MintUrl;  // adjust path from CDK source
use agicash_domain::Account;

/// Thin wrapper around a CDK connector for one mint.
/// Holds the HttpClient; does not yet expose proof operations.
/// Slices 5-8 add minting/melting/swap methods.
#[derive(Debug, Clone)]
pub struct CashuMintWallet {
    client: Arc<dyn MintConnector + Send + Sync>,
    mint_url: MintUrl,
}

impl CashuMintWallet {
    pub fn new(client: Arc<dyn MintConnector + Send + Sync>, mint_url: MintUrl) -> Self {
        Self { client, mint_url }
    }

    pub fn mint_url(&self) -> &MintUrl {
        &self.mint_url
    }

    pub fn connector(&self) -> &Arc<dyn MintConnector + Send + Sync> {
        &self.client
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CashuProviderError {
    #[error("mint unreachable: {0}")]
    Network(String),
    #[error("invalid mint URL: {0}")]
    InvalidUrl(String),
    #[error("mint protocol error: {0}")]
    Protocol(String),
}

#[async_trait]
pub trait CashuProvider: Send + Sync {
    /// Returns connector handle for the mint linked to this Cashu account.
    /// Provider caches connectors — repeat calls for the same mint_url return same client.
    /// Extracts mint_url from account.details["mint_url"] (JSONB).
    async fn wallet_for_account(
        &self,
        account: &Account,
    ) -> Result<Arc<CashuMintWallet>, CashuProviderError>;

    /// Fetches current mint metadata via NUT-06 info endpoint.
    async fn mint_info(
        &self,
        mint_url: &MintUrl,
    ) -> Result<MintInfo, CashuProviderError>;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cashu_provider_error_variants_construct() {
        let _ = CashuProviderError::Network("timeout".into());
        let _ = CashuProviderError::InvalidUrl("not-a-url".into());
        let _ = CashuProviderError::Protocol("bad json".into());
    }
}
```

- [ ] **Step 3:** Add to `crates/agicash-traits/src/lib.rs`:

```rust
pub mod cashu_provider;
pub use cashu_provider::*;
```

- [ ] **Step 4:** `cargo test -p agicash-traits` passes.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(traits): add CashuProvider trait, CashuMintWallet, CashuProviderError`

---

## Task 4: Implement `CdkCashuProvider` in `agicash-cashu`

**Files:**
- Modify: `crates/agicash-cashu/Cargo.toml`
- Create: `crates/agicash-cashu/src/error.rs`
- Create: `crates/agicash-cashu/src/provider.rs`
- Modify: `crates/agicash-cashu/src/lib.rs`

Provider wraps CDK's `HttpClient`. Caches one connector per mint URL via `parking_lot::RwLock<HashMap>`. Double-checked locking on the read path.

**Orphan rule:** Can't `impl From<cdk::Error> for CashuProviderError` here — both foreign. Use free function `map_cdk_error`.

### Steps

- [ ] **Step 1:** Replace `crates/agicash-cashu/Cargo.toml`:

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
agicash-traits = { path = "../agicash-traits" }
cdk = { workspace = true }
parking_lot = { workspace = true }
async-trait = { workspace = true }
serde_json = { workspace = true }
thiserror = { workspace = true }

[dev-dependencies]
tokio = { workspace = true, features = ["rt", "macros"] }
dotenvy = { workspace = true }

[features]
real-mint-tests = []

[lints]
workspace = true
```

- [ ] **Step 2:** Create `crates/agicash-cashu/src/error.rs`:

```rust
use agicash_traits::CashuProviderError;

/// Maps CDK error to CashuProviderError. Free function — orphan rule blocks `impl From`.
pub fn map_cdk_error(e: cdk::Error) -> CashuProviderError {
    let msg = e.to_string();
    if msg.contains("connect")
        || msg.contains("timeout")
        || msg.contains("network")
        || msg.contains("unreachable")
        || msg.contains("refused")
    {
        CashuProviderError::Network(msg)
    } else {
        CashuProviderError::Protocol(msg)
    }
}

pub fn map_url_error(e: impl std::fmt::Display) -> CashuProviderError {
    CashuProviderError::InvalidUrl(e.to_string())
}
```

**Executor note:** Verify CDK error type — `cdk::Error` or `cdk::error::Error` or `cdk_common::error::Error`. Adjust import.

- [ ] **Step 3:** Create `crates/agicash-cashu/src/provider.rs`:

```rust
use std::{collections::HashMap, str::FromStr, sync::Arc};
use agicash_domain::Account;
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use async_trait::async_trait;
use cdk::{nuts::MintInfo, wallet::HttpClient};
use cdk_common::mint_url::MintUrl;  // adjust path from CDK source
use parking_lot::RwLock;
use crate::error::{map_cdk_error, map_url_error};

pub struct CdkCashuProvider {
    clients: RwLock<HashMap<String, Arc<HttpClient>>>,
}

impl CdkCashuProvider {
    pub fn new() -> Self {
        Self { clients: RwLock::new(HashMap::new()) }
    }

    fn get_or_create(&self, mint_url: &MintUrl) -> Arc<HttpClient> {
        let key = mint_url.to_string();
        {
            let map = self.clients.read();
            if let Some(c) = map.get(&key) {
                return Arc::clone(c);
            }
        }
        let mut map = self.clients.write();
        if let Some(c) = map.get(&key) {
            return Arc::clone(c);
        }
        let client = Arc::new(HttpClient::new(mint_url.clone()));
        map.insert(key, Arc::clone(&client));
        client
    }
}

impl std::fmt::Debug for CdkCashuProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CdkCashuProvider").finish_non_exhaustive()
    }
}

#[async_trait]
impl CashuProvider for CdkCashuProvider {
    async fn wallet_for_account(
        &self,
        account: &Account,
    ) -> Result<Arc<CashuMintWallet>, CashuProviderError> {
        let mint_url_str = account
            .details
            .get("mint_url")
            .and_then(|v| v.as_str())
            .ok_or_else(|| CashuProviderError::InvalidUrl(
                "account.details missing mint_url".into(),
            ))?;
        let mint_url = MintUrl::from_str(mint_url_str).map_err(map_url_error)?;
        let client = self.get_or_create(&mint_url);
        Ok(Arc::new(CashuMintWallet::new(client, mint_url)))
    }

    async fn mint_info(
        &self,
        mint_url: &MintUrl,
    ) -> Result<MintInfo, CashuProviderError> {
        let client = self.get_or_create(mint_url);
        client.get_mint_info().await.map_err(map_cdk_error)
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn provider_constructs() {
        let _ = CdkCashuProvider::new();
    }

    #[tokio::test]
    async fn wallet_for_account_fails_on_missing_mint_url() {
        use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType, Currency, UserId};
        use chrono::Utc;
        use serde_json::json;

        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "test".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({}),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };
        let provider = CdkCashuProvider::new();
        let result = provider.wallet_for_account(&account).await;
        assert!(matches!(result, Err(CashuProviderError::InvalidUrl(_))));
    }
}

#[cfg(all(test, feature = "real-mint-tests"))]
mod real_mint_tests {
    use super::*;

    // cargo test -p agicash-cashu --features real-mint-tests
    #[tokio::test]
    async fn mint_info_fetches_from_real_mint() {
        let _ = dotenvy::dotenv();
        let url_str = std::env::var("AGICASH_TEST_MINT_URL")
            .unwrap_or_else(|_| "https://testnut.cashu.space".into());
        let mint_url = MintUrl::from_str(&url_str).expect("valid mint URL");

        let provider = CdkCashuProvider::new();
        let info = provider.mint_info(&mint_url).await
            .expect("mint_info should succeed against live mint");
        println!("Mint name: {:?}", info.name);
    }

    #[tokio::test]
    async fn wallet_for_account_constructs_connector() {
        use agicash_domain::{AccountId, AccountPurpose, AccountState, AccountType, Currency, UserId};
        use chrono::Utc;
        use serde_json::json;

        let _ = dotenvy::dotenv();
        let url_str = std::env::var("AGICASH_TEST_MINT_URL")
            .unwrap_or_else(|_| "https://testnut.cashu.space".into());

        let account = Account {
            id: AccountId::new(),
            created_at: Utc::now(),
            user_id: UserId::new(),
            name: "test".into(),
            account_type: AccountType::Cashu,
            purpose: AccountPurpose::Transactional,
            currency: Currency::Btc,
            details: json!({ "mint_url": url_str }),
            version: 0,
            state: AccountState::Active,
            expires_at: None,
        };

        let provider = CdkCashuProvider::new();
        let wallet = provider.wallet_for_account(&account).await
            .expect("should construct wallet");
        assert_eq!(
            wallet.mint_url().to_string().trim_end_matches('/'),
            url_str.trim_end_matches('/')
        );
    }
}
```

- [ ] **Step 4:** Replace `crates/agicash-cashu/src/lib.rs`:

```rust
//! Cashu protocol primitives and per-feature state machines.

pub mod error;
pub mod provider;

pub use provider::CdkCashuProvider;
```

- [ ] **Step 5:** `cargo test -p agicash-cashu` — unit tests pass (no network).

- [ ] **Step 6:** `cargo test -p agicash-cashu --features real-mint-tests -- --nocapture` — both real-mint tests pass.

- [ ] **Step 7:** Clippy + fmt clean.

- [ ] **Step 8: Commit** — `feat(cashu): implement CdkCashuProvider — mint_info + wallet_for_account via CDK`

---

## Task 5: CLI commands — `agicash mint add` and `agicash balance`

**Files:**
- Modify: `crates/agicash-cli/Cargo.toml`
- Modify: `crates/agicash-cli/src/cli.rs`
- Modify: `crates/agicash-cli/src/composition.rs`
- Create: `crates/agicash-cli/src/mint.rs`
- Modify: `crates/agicash-cli/src/main.rs`

`mint add` calls slice-3's `upsert_user_with_accounts` after fetching mint info for the account name. `balance` calls `list_accounts` and prints zero for each (real balances are slice 5+). All output JSON per the JSON-default convention established in slice 3 cleanup.

### Steps

- [ ] **Step 1:** Add to `[dependencies]`:

```toml
agicash-cashu = { path = "../agicash-cashu" }
```

Add `[features]`:

```toml
real-mint-tests = ["agicash-cashu/real-mint-tests"]
```

- [ ] **Step 2:** Add to the `Command` enum in `cli.rs`:

```rust
/// Manage Cashu mints
Mint(MintArgs),
/// Show balance for all accounts (or a specific account)
Balance {
    /// Show balance for a specific account ID only
    #[arg(long)]
    account: Option<String>,
},
```

```rust
#[derive(Args, Debug)]
pub struct MintArgs {
    #[command(subcommand)]
    pub cmd: MintCommand,
}

#[derive(Subcommand, Debug)]
pub enum MintCommand {
    /// Add a Cashu mint and create an account for it.
    Add {
        /// Mint URL, e.g. https://testnut.cashu.space
        url: String,
        /// Currency code (BTC or USD, default BTC)
        #[arg(long, default_value = "BTC")]
        currency: String,
    },
}
```

- [ ] **Step 3:** In `composition.rs`:

```rust
use agicash_cashu::CdkCashuProvider;

pub struct CashuDeps {
    pub provider: CdkCashuProvider,
}

pub fn build_cashu_deps() -> CashuDeps {
    CashuDeps { provider: CdkCashuProvider::new() }
}
```

- [ ] **Step 4:** Create `crates/agicash-cli/src/mint.rs`. Two functions, JSON output to stdout:

`cmd_mint_add(auth_deps, storage_deps, cashu_deps, url, currency_str)`:
1. Load session — fail with `MintCmdError::NotLoggedIn` if absent.
2. Parse currency via `Currency::from_str`.
3. Parse mint URL via `MintUrl::from_str`.
4. Call `cashu_deps.provider.mint_info(&mint_url)` — fail with `MintCmdError::MintUnreachable` on error.
5. Extract `mint_info.name` (fallback to URL string if None).
6. Load user via `storage_deps.user_storage.get_user(session.user_id)`.
7. Call `upsert_user_with_accounts` with one `AccountInput`: `details = json!({ "mint_url": ..., "keyset_counters": {} })`.
8. Print JSON: `{"status":"added","account_id":"<uuid>","mint_name":"...","mint_url":"..."}`.

`cmd_balance(auth_deps, storage_deps)`:
1. Load session — fail with `NotLoggedIn` if absent.
2. `list_accounts(session.user_id)`.
3. Print JSON array: `[{"account_id":"...","name":"...","currency":"BTC","balance":"0","unit":"sat"}]`. Empty if no accounts.

```rust
#[derive(Debug, thiserror::Error)]
pub enum MintCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("invalid mint URL: {0}")]
    InvalidUrl(String),
    #[error("mint unreachable: {0}")]
    MintUnreachable(String),
    #[error("unsupported currency: {0}")]
    UnsupportedCurrency(String),
    #[error(transparent)]
    Storage(#[from] agicash_traits::StorageError),
    #[error(transparent)]
    Auth(#[from] agicash_traits::AuthError),
}
```

**Executor note:** `cmd_mint_add` re-reads the user via `get_user` to populate `UpsertUserInput` fields (`cashu_locking_xpub`, etc.). For guest users without key initialization, these are empty strings — that's current state and acceptable. If the DB function rejects empty strings, add a pre-check via `list_accounts`: if an account with matching `mint_url` exists, return idempotent success and skip upsert.

- [ ] **Step 5:** Wire dispatch in `main.rs`:

```rust
Some(Command::Mint(m)) => match m.cmd {
    MintCommand::Add { url, currency } => {
        let storage_deps = build_storage_deps(&auth_deps)?;
        let cashu_deps = build_cashu_deps();
        mint::cmd_mint_add(&auth_deps, &storage_deps, &cashu_deps, &url, &currency).await?;
    }
},
Some(Command::Balance { account: _ }) => {
    let storage_deps = build_storage_deps(&auth_deps)?;
    mint::cmd_balance(&auth_deps, &storage_deps).await?;
}
```

Add `mod mint;`. Add `MintCmdError` to `classify_error` (new code strings: `not-logged-in`, `invalid-mint-url`, `mint-unreachable`, `unsupported-currency`).

- [ ] **Step 6:** Build + smoke test:

```bash
cargo run -p agicash-cli -- mint --help
cargo run -p agicash-cli -- mint add --help
cargo run -p agicash-cli -- balance --help
```

- [ ] **Step 7:** Clippy + fmt clean.

- [ ] **Step 8: Commit** — `feat(cli): add 'mint add' and 'balance' commands with JSON output`

---

## Task 6: CLI integration test for `mint add` + `balance`

**File:** `crates/agicash-cli/tests/mint.rs`

Gated `real-mint-tests`. Requires local OpenSecret + local Supabase + public testnet mint.

```rust
#[cfg(feature = "real-mint-tests")]
mod tests {
    use assert_cmd::Command;
    use predicates::prelude::*;

    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    #[test]
    fn mint_add_then_balance_shows_zero() {
        let _ = dotenvy::dotenv();

        Command::cargo_bin("agicash").unwrap()
            .args(["auth", "guest"]).assert().success();

        Command::cargo_bin("agicash").unwrap()
            .args(["mint", "add", TEST_MINT_URL])
            .assert().success()
            .stdout(predicate::str::contains(r#""status":"added""#));

        Command::cargo_bin("agicash").unwrap()
            .arg("balance")
            .assert().success()
            .stdout(predicate::str::contains(r#""balance":"0""#));
    }

    #[test]
    fn mint_add_with_unreachable_url_fails_with_json_error() {
        let _ = dotenvy::dotenv();
        Command::cargo_bin("agicash").unwrap()
            .args(["auth", "guest"]).assert().success();

        Command::cargo_bin("agicash").unwrap()
            .args(["mint", "add", "https://does-not-exist.invalid.example"])
            .assert().failure()
            .stderr(predicate::str::contains(r#""code":"mint-unreachable""#));
    }
}
```

- [ ] **Step 1:** Write test.

- [ ] **Step 2:** Run: `cargo test -p agicash-cli --features real-mint-tests --test mint -- --nocapture`. PASS.

- [ ] **Step 3: Commit** — `test(cli): integration test for 'mint add' + 'balance'`

---

## Task 7: Final verification — slice 4 test bar

- [ ] `cargo build --workspace` clean (zero warnings)
- [ ] `cargo test --workspace` green (prior + 11 money + 1 traits + 2 cashu unit tests)
- [ ] `cargo clippy --workspace --all-targets -- -D warnings` clean
- [ ] `cargo fmt --all --check` clean
- [ ] `cargo build --target wasm32-unknown-unknown -p agicash-wasm` PASS. `cargo tree -p agicash-wasm | grep agicash-cashu` empty.
- [ ] `cargo test -p agicash-cashu --features real-mint-tests -- --nocapture` PASS
- [ ] `cargo test -p agicash-cli --features real-mint-tests --test mint -- --nocapture` PASS
- [ ] CLI smoke tests: `--help`, `mint --help`, `balance` all show JSON-formatted output

---

## Notes for the executor

- **Verify CDK API paths first.** CDK is pre-1.0; module structure shifts between minor versions. Before any CDK code: `cargo doc -p cdk --open` or grep `~/.cargo/registry/src/**/cdk-*/src/` to confirm `MintConnector`, `HttpClient::new()` signature, `get_mint_info()` method name, `MintUrl` import path.
- **Don't promote `rust_decimal_macros` to a runtime dep.** Per commit `398df24b` it's dev-only. Use `Decimal::from_str(...).unwrap()` in production code.
- **`upsert_user_with_accounts` for guests:** verify behavior with empty-string key fields. If it rejects them, add a pre-check via `list_accounts`.
- **No state machines in this slice.** `send_quote/`, `send_swap/`, `receive_quote/`, `receive_swap/` are slices 5–8.
- **`real-mint-tests` skips by default.** Default `cargo test --workspace` must not attempt network calls.

---

## Open questions for gudnuf

1. **CDK version pin** — use latest minor (≥0.15) at execution time, or pin to a specific version for reproducibility?
2. **`upsert_user_with_accounts` idempotency** — if a user calls `mint add` twice for the same URL, does the DB function merge `details` JSON or clobber? If clobber, `mint add` needs a pre-existence check.
3. **Guest user key fields** — does the DB function tolerate empty strings for `cashu_locking_xpub`, `encryption_public_key`, `spark_identity_public_key`?
4. **Test mint reliability** — `https://testnut.cashu.space` is the default real-mint target. Acceptable as third-party dep, or require a local nutshell mint?
5. **`mint add` vs `account list` overlap** — after `mint add`, slice-3's `account list` shows the new account. Is `balance` redundant with `account list`, or do they have distinct UX roles?
