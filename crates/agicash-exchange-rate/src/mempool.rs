//! Mempool.space exchange rate provider.
//!
//! Endpoint: `https://mempool.space/api/v1/prices`
//! Response shape: `{"time": 1234567890, "USD": 50000, "EUR": 46000, ...}`
//! All quoted values are BTC-denominated (price of 1 BTC in that currency).

use crate::provider::{ExchangeRateError, ExchangeRateProvider};
use agicash_domain::Currency;
use async_trait::async_trait;
use reqwest::Client;
use rust_decimal::Decimal;
use serde::Deserialize;
use std::sync::Arc;

const MEMPOOL_PRICES_URL: &str = "https://mempool.space/api/v1/prices";

/// TCP-handshake timeout. Fails fast when the endpoint is unreachable
/// (DNS hole, NAT route, dev-host down) rather than hanging the
/// caller's UI thread. See the supabase client for the parent rationale.
const CONNECT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);
/// Overall per-request timeout. Bounds a single HTTP exchange so a
/// stalled mempool.space response can't wedge the wallet's rate-refresh
/// loop indefinitely.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(30);

fn build_http_client() -> Client {
    Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("reqwest client constructible")
}

#[derive(Debug, Clone)]
pub struct MempoolSpaceProvider {
    client: Arc<Client>,
    url: String,
}

impl MempoolSpaceProvider {
    pub fn new() -> Self {
        Self {
            client: Arc::new(build_http_client()),
            url: MEMPOOL_PRICES_URL.to_string(),
        }
    }

    /// Construct with a custom endpoint — useful for tests that point at a
    /// mock HTTP server. Not yet exercised but kept symmetric with the
    /// equivalent TS test helper.
    pub fn with_url(url: impl Into<String>) -> Self {
        Self {
            client: Arc::new(build_http_client()),
            url: url.into(),
        }
    }
}

impl Default for MempoolSpaceProvider {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug, Deserialize)]
struct MempoolPricesResponse {
    // Deserialize directly as Decimal. The workspace's default rust_decimal
    // serde uses string-only deserialization; the `serde-float` feature plus
    // `float_option` here accepts JSON numbers (integer or fractional) without
    // routing through f64::try_from, which is lossy for non-integer values.
    #[serde(rename = "USD", with = "rust_decimal::serde::float_option")]
    usd: Option<Decimal>,
    // Add more currencies as needed in future slices (EUR, GBP, etc.).
}

#[async_trait]
impl ExchangeRateProvider for MempoolSpaceProvider {
    async fn get_rate(&self, from: Currency, to: Currency) -> Result<Decimal, ExchangeRateError> {
        // Mempool gives BTC-denominated prices. Supported pairs:
        //   - BTC -> USD: response.USD
        //   - USD -> BTC: 1 / response.USD
        if !matches!(
            (from, to),
            (Currency::Btc, Currency::Usd) | (Currency::Usd, Currency::Btc)
        ) {
            return Err(ExchangeRateError::UnsupportedPair { from, to });
        }

        let resp = self
            .client
            .get(&self.url)
            .send()
            .await
            .map_err(|e| ExchangeRateError::Network(e.to_string()))?;

        let parsed: MempoolPricesResponse = resp
            .json()
            .await
            .map_err(|e| ExchangeRateError::InvalidResponse(e.to_string()))?;

        let usd_decimal = parsed
            .usd
            .ok_or_else(|| ExchangeRateError::InvalidResponse("missing USD field".into()))?
            .round_dp(2);

        match (from, to) {
            (Currency::Btc, Currency::Usd) => Ok(usd_decimal),
            (Currency::Usd, Currency::Btc) => {
                // 1 USD = 1 / usd_decimal BTC, with 8 dp of precision.
                if usd_decimal.is_zero() {
                    return Err(ExchangeRateError::InvalidResponse("zero USD price".into()));
                }
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
        // USDB not supported by this trivial impl.
        let result = provider.get_rate(Currency::Btc, Currency::Usdb).await;
        assert!(matches!(
            result,
            Err(ExchangeRateError::UnsupportedPair { .. })
        ));
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
        let rate = provider
            .get_rate(Currency::Btc, Currency::Usd)
            .await
            .expect("mempool prices endpoint should respond");
        // Sanity range: > $1k, < $1M.
        assert!(rate > Decimal::from(1000), "BTC/USD looks too low: {rate}");
        assert!(
            rate < Decimal::from(1_000_000),
            "BTC/USD looks too high: {rate}"
        );
        // Direct JSON-number -> Decimal deserialization should produce a clean
        // 2-dp (or smaller-scale) value, not the f64-roundtrip artifacts that
        // Decimal::try_from(f64) used to introduce.
        assert!(
            rate.scale() <= 2,
            "expected USD rate to have <= 2 dp, got scale={} value={rate}",
            rate.scale()
        );
        println!("BTC/USD = {rate}");
    }

    #[tokio::test]
    async fn reverse_rate_is_inverse() {
        let _ = dotenvy::dotenv();
        let provider = MempoolSpaceProvider::new();
        let btc_usd = provider
            .get_rate(Currency::Btc, Currency::Usd)
            .await
            .unwrap();
        let usd_btc = provider
            .get_rate(Currency::Usd, Currency::Btc)
            .await
            .unwrap();
        // btc_usd * usd_btc should round-trip near 1.0. The error is bounded
        // by 8-dp truncation of 1/btc_usd: at $80k/BTC the smallest representable
        // BTC step is 1e-8, so 1/80000 = 0.0000125 rounds to 0.00001250 → ~0.0008
        // relative error magnitude. We allow 0.005 (0.5%) to comfortably cover
        // price levels up to ~$200k/BTC.
        let product = btc_usd * usd_btc;
        let diff = (product - Decimal::ONE).abs();
        assert!(
            diff < Decimal::new(5, 3), // within 0.005
            "round-trip product not ~1: btc_usd={btc_usd}, usd_btc={usd_btc}, product={product}"
        );
    }
}
