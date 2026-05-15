//! Exchange rate providers.
//!
//! Ships one provider (Mempool.space) for now. The [`ExchangeRateProvider`]
//! trait shape supports adding more (`CoinGecko`, `Coinbase`) later without
//! changing call sites — same pattern as the TS `ExchangeRateService`.

pub mod mempool;
pub mod provider;

pub use mempool::MempoolSpaceProvider;
pub use provider::{ExchangeRateError, ExchangeRateProvider};
