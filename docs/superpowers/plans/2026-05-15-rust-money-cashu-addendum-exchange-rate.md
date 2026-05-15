# Slice 4 Addendum — Exchange Rate + WASM-friendly choices

> **For the executor:** This addendum is part of slice 4. Apply alongside the main plan at `2026-05-15-rust-money-cashu.md`. Two changes: (1) add an Exchange Rate Service as **new Task 5** (renumbering the existing Tasks 5→6, 6→7, 7→8), and (2) take a couple of zero-cost wasm-friendly choices in workspace deps.

## Why these additions

**Operator scope decision (2026-05-15):**
- Goal: one user logs into CLI / iOS / (eventually web) and sees the same wallet — not full TS-app feature parity.
- Exchange rate is required because the app is multi-unit (BTC + USD accounts). `agicash balance` is meaningless for USD accounts without a way to show BTC equivalents.
- WASM is still the eventual goal. Defer where there's a genuine blocker (opensecret), but optimize for wasm where it's free.

---

## Change 1: Add `uuid` wasm features to Task 2 workspace deps

In the workspace `[dependencies]` at `crates/Cargo.toml`, update the existing `uuid` line.

Current (the spike report identified `["v4","serde"]` only):
```toml
uuid = { version = "1.23", features = ["v4", "serde"] }
```

Updated (adds wasm-required features; harmless on native):
```toml
uuid = { version = "1.23", features = ["v4", "serde", "js"] }
```

If `getrandom` is in the workspace deps (transitively or directly), ensure it has its `js` feature available on wasm targets. Check with `cargo tree -e features | grep getrandom` and add `getrandom = { version = "0.2", features = ["js"] }` to `[workspace.dependencies]` if needed.

Verify `cargo build --workspace` is still clean after this change. WASM doesn't need to actually build yet — we're just removing one source of friction for later.

Commit this with the cdk addition in Task 2: `chore(deps): add cdk + wasm-required uuid features to workspace`

---

## Change 2: New Task 5 — Exchange Rate Service

> **Renumbering:** The original Task 5 (CLI commands), Task 6 (integration test), and Task 7 (verification) become Tasks 6, 7, 8 respectively. The new Exchange Rate task is Task 5 because the balance command in (renumbered) Task 6 needs the rate service to render USD-account BTC equivalents.

**Goal:** New `agicash-exchange-rate` crate exposing an `ExchangeRateProvider` trait + one production-quality provider (Mempool.space). Designed so adding CoinGecko / Coinbase later is a same-shape extension. Designed so the crate compiles to wasm later without rework (no native-only features locked in).

**What it does NOT do:**
- Multiple providers with fallback (port one; trait shape supports adding more later)
- Caching with TTL (slice 11+ owns caching)
- Currency-pair beyond BTC↔USD (slice expands as needed)

### File structure

```
crates/
├── agicash-exchange-rate/                        # NEW CRATE
│   ├── Cargo.toml                                # NEW
│   └── src/
│       ├── lib.rs                                # NEW — public surface
│       ├── provider.rs                           # NEW — ExchangeRateProvider trait + ExchangeRateError
│       └── mempool.rs                            # NEW — MempoolSpaceProvider impl
├── Cargo.toml                                    # MODIFY — add to [workspace.members]
```

### WASM-friendliness contract (free choices)

- `reqwest` config in `agicash-exchange-rate/Cargo.toml`: `default-features = false`, then enable `rustls-tls` for native + `json`. Do NOT enable `native-tls` or `cookies` (both have non-wasm friendly transitive deps). Reqwest's wasm-bindgen backend can be opted into later without changing call sites.
- No `tokio::fs`, no `tokio::process`, no system clock beyond `std::time::Instant` if needed.
- Public API uses `Decimal` (already wasm-safe) — no f64 in the trait surface.

### Steps

- [ ] **Step 1: Create `crates/agicash-exchange-rate/Cargo.toml`**

```toml
[package]
name = "agicash-exchange-rate"
version.workspace = true
edition.workspace = true
rust-version.workspace = true
license.workspace = true
repository.workspace = true

[dependencies]
agicash-domain = { path = "../agicash-domain" }
async-trait = { workspace = true }
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "json"] }
rust_decimal = { workspace = true }
serde = { workspace = true, features = ["derive"] }
serde_json = { workspace = true }
thiserror = { workspace = true }

[dev-dependencies]
tokio = { workspace = true, features = ["rt", "macros"] }
dotenvy = { workspace = true }

[features]
# Network-hitting tests. cargo test -p agicash-exchange-rate --features real-rate-tests
real-rate-tests = []

[lints]
workspace = true
```

If `reqwest` is not yet in `[workspace.dependencies]`, add it there with `default-features = false`. If the workspace `[patch.crates-io]` table already pins reqwest for opensecret/postgrest reasons, the patch should still apply — verify on first build.

- [ ] **Step 2: Add to `crates/Cargo.toml` `[workspace.members]`**

Insert in alphabetical position: `"agicash-exchange-rate",`

- [ ] **Step 3: Write failing tests in `crates/agicash-exchange-rate/src/provider.rs`**

```rust
use agicash_domain::Currency;
use async_trait::async_trait;
use rust_decimal::Decimal;

/// Provides current exchange rates between currency pairs.
///
/// Implementations are expected to be cheap to clone (`Arc`-wrapped HTTP clients
/// or stateless types). The trait is intentionally narrow — caching, retries,
/// and fallback live in higher layers.
#[async_trait]
pub trait ExchangeRateProvider: Send + Sync {
    /// Returns the rate as: `1 unit of `from` major-currency` = `<result> units of `to` major-currency`.
    ///
    /// E.g. `get_rate(Currency::Btc, Currency::Usd)` returns the BTC→USD price (~50000 today).
    /// Returns `UnsupportedPair` if the provider does not support the requested pair.
    async fn get_rate(
        &self,
        from: Currency,
        to: Currency,
    ) -> Result<Decimal, ExchangeRateError>;
}

#[derive(Debug, thiserror::Error)]
pub enum ExchangeRateError {
    #[error("network error: {0}")]
    Network(String),
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("unsupported pair: {from} -> {to}")]
    UnsupportedPair { from: Currency, to: Currency },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn error_variants_construct() {
        let _ = ExchangeRateError::Network("timeout".into());
        let _ = ExchangeRateError::InvalidResponse("not json".into());
        let _ = ExchangeRateError::UnsupportedPair {
            from: Currency::Btc,
            to: Currency::Usd,
        };
    }
}
```

- [ ] **Step 4: Implement `MempoolSpaceProvider` in `crates/agicash-exchange-rate/src/mempool.rs`**

Endpoint: `https://mempool.space/api/v1/prices`
Response shape (verify on real call):
```json
{"time": 1234567890, "USD": 50000, "EUR": 46000, ...}
```

```rust
use std::sync::Arc;
use agicash_domain::Currency;
use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;
use crate::provider::{ExchangeRateError, ExchangeRateProvider};

const MEMPOOL_PRICES_URL: &str = "https://mempool.space/api/v1/prices";

#[derive(Debug, Clone)]
pub struct MempoolSpaceProvider {
    client: Arc<Client>,
    url: String,
}

impl MempoolSpaceProvider {
    pub fn new() -> Self {
        Self {
            client: Arc::new(
                Client::builder()
                    .build()
                    .expect("reqwest client constructible"),
            ),
            url: MEMPOOL_PRICES_URL.to_string(),
        }
    }

    /// Construct with a custom endpoint (useful for tests with mock servers).
    pub fn with_url(url: impl Into<String>) -> Self {
        Self {
            client: Arc::new(Client::builder().build().expect("client")),
            url: url.into(),
        }
    }
}

impl Default for MempoolSpaceProvider {
    fn default() -> Self { Self::new() }
}

#[derive(Debug, Deserialize)]
struct MempoolPricesResponse {
    #[serde(rename = "USD")]
    usd: Option<f64>,
    // Add more currencies as needed in future tasks.
}

#[async_trait]
impl ExchangeRateProvider for MempoolSpaceProvider {
    async fn get_rate(
        &self,
        from: Currency,
        to: Currency,
    ) -> Result<Decimal, ExchangeRateError> {
        // Mempool gives BTC-denominated prices. So:
        // - get_rate(BTC, USD) -> response.USD
        // - get_rate(USD, BTC) -> 1 / response.USD
        // Other pairs unsupported by this provider.
        if !matches!((from, to),
            (Currency::Btc, Currency::Usd) | (Currency::Usd, Currency::Btc))
        {
            return Err(ExchangeRateError::UnsupportedPair { from, to });
        }

        let resp = self.client.get(&self.url).send().await
            .map_err(|e| ExchangeRateError::Network(e.to_string()))?;

        let parsed: MempoolPricesResponse = resp
            .json()
            .await
            .map_err(|e| ExchangeRateError::InvalidResponse(e.to_string()))?;

        let usd = parsed.usd.ok_or_else(||
            ExchangeRateError::InvalidResponse("missing USD field".into())
        )?;

        // Convert via Decimal::try_from(f64) — but f64 -> Decimal can lose precision.
        // Mempool returns integer-ish USD values (no fractional cents at this scale),
        // so this is fine. Round to 2 decimal places to model "dollars and cents".
        let usd_decimal = Decimal::try_from(usd)
            .map_err(|_| ExchangeRateError::InvalidResponse(
                format!("non-finite USD value: {usd}")
            ))?
            .round_dp(2);

        match (from, to) {
            (Currency::Btc, Currency::Usd) => Ok(usd_decimal),
            (Currency::Usd, Currency::Btc) => {
                // 1 USD = 1/usd_decimal BTC, with 8 decimals of precision
                Ok((Decimal::ONE / usd_decimal).round_dp(8))
            }
            _ => unreachable!("matched above"),
        }
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[tokio::test]
    async fn unsupported_pair_returns_error() {
        let provider = MempoolSpaceProvider::new();
        // EUR not yet supported by this trivial impl
        let result = provider.get_rate(Currency::Btc, Currency::Usdb).await;
        assert!(matches!(result, Err(ExchangeRateError::UnsupportedPair { .. })));
    }
}

#[cfg(all(test, feature = "real-rate-tests"))]
mod real_rate_tests {
    use super::*;

    // cargo test -p agicash-exchange-rate --features real-rate-tests
    #[tokio::test]
    async fn fetches_real_btc_usd_rate_from_mempool() {
        let _ = dotenvy::dotenv();
        let provider = MempoolSpaceProvider::new();
        let rate = provider.get_rate(Currency::Btc, Currency::Usd).await
            .expect("mempool prices endpoint should respond");
        // Reasonable sanity range: > $1000, < $1M
        assert!(rate > Decimal::from(1000), "BTC/USD looks too low: {rate}");
        assert!(rate < Decimal::from(1_000_000), "BTC/USD looks too high: {rate}");
        println!("BTC/USD = {rate}");
    }

    #[tokio::test]
    async fn reverse_rate_is_inverse() {
        let _ = dotenvy::dotenv();
        let provider = MempoolSpaceProvider::new();
        let btc_usd = provider.get_rate(Currency::Btc, Currency::Usd).await.unwrap();
        let usd_btc = provider.get_rate(Currency::Usd, Currency::Btc).await.unwrap();
        // BTC->USD * USD->BTC should round-trip near 1.0 (within precision loss)
        let product = btc_usd * usd_btc;
        let diff = (product - Decimal::ONE).abs();
        assert!(diff < Decimal::new(1, 4),  // within 0.0001
            "round-trip product not ~1: btc_usd={btc_usd}, usd_btc={usd_btc}, product={product}");
    }
}
```

- [ ] **Step 5: `crates/agicash-exchange-rate/src/lib.rs`**

```rust
//! Exchange rate providers.
//!
//! Currently ships one provider (Mempool.space). The trait shape supports
//! adding more (CoinGecko, Coinbase) without changing call sites.

pub mod mempool;
pub mod provider;

pub use mempool::MempoolSpaceProvider;
pub use provider::{ExchangeRateError, ExchangeRateProvider};
```

- [ ] **Step 6: Verification**

```
cargo build -p agicash-exchange-rate
cargo test -p agicash-exchange-rate                                       # unit tests pass, no network
cargo test -p agicash-exchange-rate --features real-rate-tests             # both real-rate tests pass
cargo clippy -p agicash-exchange-rate --all-targets -- -D warnings
cargo fmt -p agicash-exchange-rate -- --check
```

- [ ] **Step 7: Commit** — `feat(exchange-rate): add ExchangeRateProvider trait + Mempool.space implementation`

---

## Change 3: Renumbered Task 6 (was Task 5) — `agicash balance` uses exchange rate

This is a small modification to the original Task 5's `cmd_balance` function. The renumbered Task 6 still does everything the old Task 5 did, plus:

1. Take an `ExchangeRateProvider` reference (passed via a new field on `CashuDeps` or a new `ExchangeRateDeps`).
2. For each account in `list_accounts`, if its `currency` is `USD` (or anything not equal to a "display reference currency"), call `get_rate(account.currency, Currency::Btc)` once at the top of the loop and include `"btc_equivalent": "<value>"` in the JSON entry. If the provider fails, omit the field and add `"btc_equivalent_error": "<error code>"`.
3. For BTC accounts, no rate call needed; omit the field.

The composition step:

```rust
// In composition.rs
use agicash_exchange_rate::MempoolSpaceProvider;

pub struct ExchangeRateDeps {
    pub provider: MempoolSpaceProvider,
}

pub fn build_exchange_rate_deps() -> ExchangeRateDeps {
    ExchangeRateDeps { provider: MempoolSpaceProvider::new() }
}
```

`cmd_balance` signature gains a `&ExchangeRateDeps` parameter. Wire in `main.rs` accordingly.

**Output schema update:**
```json
[
  {"account_id":"...","name":"...","currency":"BTC","balance":"0","unit":"sat"},
  {"account_id":"...","name":"...","currency":"USD","balance":"0","unit":"cent","btc_equivalent":"0","rate_btc":"50000.00"},
  {"account_id":"...","name":"...","currency":"USD","balance":"0","unit":"cent","btc_equivalent_error":"network-error"}
]
```

The `rate_btc` field shows the rate used so agents can verify the conversion. Errors are surfaced per-account, not as a top-level failure — `balance` should not crash when the rate provider is down; it should still return the account list with errors flagged.

`MintCmdError` does NOT get a new variant for exchange-rate errors. The rate failure is encoded in the JSON output of the affected account, not a top-level command failure.

---

## Change 4: Renumbered Task 8 (was Task 7) — verification updates

Add to the verification bar:

```
cargo build -p agicash-exchange-rate
cargo test -p agicash-exchange-rate
cargo test -p agicash-exchange-rate --features real-rate-tests
cargo clippy -p agicash-exchange-rate --all-targets -- -D warnings
```

Add to expected test count: `agicash-exchange-rate` has at least 4 tests (1 unit + 2 real-rate-gated + 1 error variants).

The WASM regression check (`cargo build --target wasm32-unknown-unknown -p agicash-wasm`) is now optional in this slice — we are not actively building wasm. Skip if `wasm-pack` / target is missing; do not block sign-off on it. The `uuid`/`getrandom` workspace fixes from Change 1 are about future-proofing; they're verified by `cargo build --workspace` clean.

---

## Open question added to the plan

7. **Reqwest patch interaction.** The workspace `[patch.crates-io]` table currently patches `postgrest` (for rustls-native-roots). When `agicash-exchange-rate` adds a direct `reqwest` dep, does the workspace's existing reqwest version line up with what the exchange-rate crate needs? Verify with `cargo tree | grep reqwest` after Task 5 lands. If versions conflict, pin `reqwest` in `[workspace.dependencies]` to the version both crates accept.
