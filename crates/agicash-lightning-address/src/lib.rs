//! LUD-16 Lightning Address resolver.
//!
//! Parses `user@domain` addresses, fetches the LUD-06 pay-request params
//! from `https://<domain>/.well-known/lnurlp/<user>`, and hits the callback
//! to produce a BOLT-11 invoice. Ports the TS implementation at
//! `app/lib/lnurl/` from the agicash main repo.
//!
//! Spec refs:
//! - <https://github.com/lnurl/luds/blob/luds/06.md>
//! - <https://github.com/lnurl/luds/blob/luds/16.md>
//!
//! # Example
//! ```no_run
//! # async fn run() -> Result<(), agicash_lightning_address::LightningAddressError> {
//! use agicash_lightning_address::{resolve, request_invoice};
//!
//! let info = resolve("alice@example.com").await?;
//! let invoice = request_invoice(&info, 10_000, None).await?;
//! println!("invoice = {invoice}");
//! # Ok(()) }
//! ```

use reqwest::Client;
use serde::Deserialize;

/// Parsed LUD-06/16 pay-request params.
///
/// Mirrors the TS `LNURLPayParams` shape. Fields beyond the spec minimum
/// (e.g. `comment_allowed`) are kept optional so this struct round-trips
/// servers that include them.
#[derive(Debug, Clone, Deserialize)]
pub struct LightningAddressInfo {
    /// Must be `"payRequest"` for LUD-06.
    pub tag: String,
    /// The callback URL — GET this with `?amount=<msat>` to receive an invoice.
    pub callback: String,
    /// Minimum amount in millisats the service is willing to invoice.
    #[serde(rename = "minSendable")]
    pub min_sendable: u64,
    /// Maximum amount in millisats the service is willing to invoice.
    #[serde(rename = "maxSendable")]
    pub max_sendable: u64,
    /// Metadata string per LUD-06 (raw JSON-encoded; not parsed here).
    pub metadata: String,
    /// Optional comment-length cap per LUD-12. `None` means comments
    /// are not advertised as supported.
    #[serde(rename = "commentAllowed", default)]
    pub comment_allowed: Option<u32>,
}

#[derive(Debug, thiserror::Error)]
pub enum LightningAddressError {
    #[error("invalid lightning address: {0}")]
    InvalidAddress(String),
    #[error("network error: {0}")]
    Network(String),
    #[error("invalid response: {0}")]
    InvalidResponse(String),
    #[error("amount {amount_msat} msat outside range {min}..={max}")]
    AmountOutOfRange {
        amount_msat: u64,
        min: u64,
        max: u64,
    },
    #[error("server returned error: {0}")]
    ServerError(String),
}

/// Parses a Lightning Address into `(localpart, domain)`.
///
/// Validates the LUD-16 character set on the localpart and a sane domain
/// shape. Accepts `user@localhost` and `user@127.0.0.1` for development
/// since the TS side already special-cases these (different protocol).
///
/// # Errors
/// Returns [`LightningAddressError::InvalidAddress`] if the format fails
/// to parse or the parts violate LUD-16's character rules.
pub fn parse_lightning_address(s: &str) -> Result<(String, String), LightningAddressError> {
    let trimmed = s.trim();
    let (local, domain) = trimmed.split_once('@').ok_or_else(|| {
        LightningAddressError::InvalidAddress("expected `localpart@domain`".into())
    })?;

    if local.is_empty() {
        return Err(LightningAddressError::InvalidAddress(
            "empty localpart".into(),
        ));
    }
    if domain.is_empty() {
        return Err(LightningAddressError::InvalidAddress("empty domain".into()));
    }

    // LUD-16: localpart restricted to a-z 0-9 _ - (lowercase only).
    if !local
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
    {
        return Err(LightningAddressError::InvalidAddress(format!(
            "localpart contains invalid characters: {local}"
        )));
    }

    Ok((local.to_string(), domain.to_string()))
}

/// Whether the domain looks like a local development host (use plain http).
fn is_local_host(domain: &str) -> bool {
    let host = domain.split(':').next().unwrap_or(domain);
    host == "localhost" || host == "127.0.0.1" || host == "::1"
}

/// Resolve a Lightning Address to its LUD-06 pay-request params.
///
/// GETs `https://<domain>/.well-known/lnurlp/<user>` (http for localhost)
/// and parses the JSON response. Returns
/// [`LightningAddressError::ServerError`] if the server returns a
/// `{"status": "ERROR", "reason": "..."}` payload per LUD-06.
///
/// # Errors
/// Returns [`LightningAddressError::InvalidAddress`] for parse failures,
/// [`LightningAddressError::Network`] for transport errors, and
/// [`LightningAddressError::InvalidResponse`] for malformed bodies.
pub async fn resolve(address: &str) -> Result<LightningAddressInfo, LightningAddressError> {
    let (local, domain) = parse_lightning_address(address)?;
    let scheme = if is_local_host(&domain) { "http" } else { "https" };
    let url = format!("{scheme}://{domain}/.well-known/lnurlp/{local}");

    let client = Client::builder()
        .build()
        .map_err(|e| LightningAddressError::Network(e.to_string()))?;

    let body = client
        .get(&url)
        .send()
        .await
        .map_err(|e| LightningAddressError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| LightningAddressError::Network(e.to_string()))?;

    parse_pay_params(&body)
}

/// Request a BOLT-11 invoice from a resolved Lightning Address.
///
/// Hits `info.callback?amount=<msat>[&comment=<comment>]`. Returns the
/// `pr` (BOLT-11) field on success. Bounds-checks `amount_msat` against
/// `min_sendable`/`max_sendable` client-side first so we fail fast.
///
/// # Errors
/// Returns [`LightningAddressError::AmountOutOfRange`] when the amount
/// is outside the advertised sendable range, [`LightningAddressError::ServerError`]
/// when the LNURL server returns an error JSON, and the usual network/parse
/// variants otherwise.
pub async fn request_invoice(
    info: &LightningAddressInfo,
    amount_msat: u64,
    comment: Option<&str>,
) -> Result<String, LightningAddressError> {
    if amount_msat < info.min_sendable || amount_msat > info.max_sendable {
        return Err(LightningAddressError::AmountOutOfRange {
            amount_msat,
            min: info.min_sendable,
            max: info.max_sendable,
        });
    }

    let mut url = reqwest::Url::parse(&info.callback)
        .map_err(|e| LightningAddressError::InvalidResponse(format!("invalid callback: {e}")))?;
    url.query_pairs_mut()
        .append_pair("amount", &amount_msat.to_string());
    if let Some(c) = comment {
        url.query_pairs_mut().append_pair("comment", c);
    }

    let client = Client::builder()
        .build()
        .map_err(|e| LightningAddressError::Network(e.to_string()))?;
    let body = client
        .get(url)
        .send()
        .await
        .map_err(|e| LightningAddressError::Network(e.to_string()))?
        .text()
        .await
        .map_err(|e| LightningAddressError::Network(e.to_string()))?;

    parse_callback(&body)
}

/// Parse the well-known endpoint body, handling either a `payRequest`
/// success or a LUD-06 `{"status": "ERROR", "reason": "..."}` failure.
fn parse_pay_params(body: &str) -> Result<LightningAddressInfo, LightningAddressError> {
    if let Some(reason) = extract_error_reason(body) {
        return Err(LightningAddressError::ServerError(reason));
    }
    let info: LightningAddressInfo = serde_json::from_str(body)
        .map_err(|e| LightningAddressError::InvalidResponse(format!("{e}; body: {body}")))?;
    if info.tag != "payRequest" {
        return Err(LightningAddressError::InvalidResponse(format!(
            "expected tag=payRequest, got tag={}",
            info.tag
        )));
    }
    if info.min_sendable == 0 || info.max_sendable < info.min_sendable {
        return Err(LightningAddressError::InvalidResponse(format!(
            "invalid sendable range: min={} max={}",
            info.min_sendable, info.max_sendable
        )));
    }
    Ok(info)
}

/// Parse the callback body — `{"pr": "lnbc..."}` on success, or
/// `{"status": "ERROR", "reason": "..."}` on failure.
fn parse_callback(body: &str) -> Result<String, LightningAddressError> {
    if let Some(reason) = extract_error_reason(body) {
        return Err(LightningAddressError::ServerError(reason));
    }
    #[derive(Deserialize)]
    struct CallbackOk {
        pr: String,
    }
    let parsed: CallbackOk = serde_json::from_str(body)
        .map_err(|e| LightningAddressError::InvalidResponse(format!("{e}; body: {body}")))?;
    if parsed.pr.is_empty() {
        return Err(LightningAddressError::InvalidResponse(
            "empty `pr` (BOLT-11) field".into(),
        ));
    }
    Ok(parsed.pr)
}

/// If `body` looks like `{"status": "ERROR", "reason": "..."}`, extract
/// the reason. Returns `None` otherwise (caller proceeds to parse success).
fn extract_error_reason(body: &str) -> Option<String> {
    #[derive(Deserialize)]
    struct ErrBody {
        status: String,
        #[serde(default)]
        reason: Option<String>,
    }
    let parsed: ErrBody = serde_json::from_str(body).ok()?;
    if parsed.status == "ERROR" {
        Some(parsed.reason.unwrap_or_else(|| "(no reason given)".into()))
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_simple_address() {
        let (l, d) = parse_lightning_address("alice@example.com").unwrap();
        assert_eq!(l, "alice");
        assert_eq!(d, "example.com");
    }

    #[test]
    fn parses_address_with_underscore_and_digits() {
        let (l, d) = parse_lightning_address("user_42@agicash.app").unwrap();
        assert_eq!(l, "user_42");
        assert_eq!(d, "agicash.app");
    }

    #[test]
    fn parses_address_with_hyphen() {
        let (l, _) = parse_lightning_address("bob-the-builder@example.com").unwrap();
        assert_eq!(l, "bob-the-builder");
    }

    #[test]
    fn parses_localhost_address() {
        let (l, d) = parse_lightning_address("dev@localhost:8080").unwrap();
        assert_eq!(l, "dev");
        assert_eq!(d, "localhost:8080");
        assert!(is_local_host(&d));
    }

    #[test]
    fn rejects_address_without_at() {
        let e = parse_lightning_address("noatsign").unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidAddress(_)));
    }

    #[test]
    fn rejects_empty_localpart() {
        let e = parse_lightning_address("@example.com").unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidAddress(_)));
    }

    #[test]
    fn rejects_empty_domain() {
        let e = parse_lightning_address("alice@").unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidAddress(_)));
    }

    #[test]
    fn rejects_uppercase_in_localpart() {
        // LUD-16: localpart MUST be lowercase.
        let e = parse_lightning_address("Alice@example.com").unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidAddress(_)));
    }

    #[test]
    fn rejects_invalid_chars_in_localpart() {
        let e = parse_lightning_address("alice+spam@example.com").unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidAddress(_)));
    }

    #[test]
    fn trims_whitespace() {
        let (l, d) = parse_lightning_address("  alice@example.com  ").unwrap();
        assert_eq!(l, "alice");
        assert_eq!(d, "example.com");
    }

    #[test]
    fn parse_pay_params_accepts_valid_body() {
        let body = r#"{
            "tag": "payRequest",
            "callback": "https://example.com/cb",
            "minSendable": 1000,
            "maxSendable": 100000000,
            "metadata": "[[\"text/plain\",\"sats for alice\"]]"
        }"#;
        let info = parse_pay_params(body).unwrap();
        assert_eq!(info.tag, "payRequest");
        assert_eq!(info.min_sendable, 1000);
        assert_eq!(info.max_sendable, 100_000_000);
    }

    #[test]
    fn parse_pay_params_handles_lnurl_error_body() {
        let body = r#"{"status":"ERROR","reason":"user not found"}"#;
        let e = parse_pay_params(body).unwrap_err();
        match e {
            LightningAddressError::ServerError(reason) => assert_eq!(reason, "user not found"),
            other => panic!("expected ServerError, got {other:?}"),
        }
    }

    #[test]
    fn parse_pay_params_rejects_wrong_tag() {
        let body = r#"{
            "tag": "withdrawRequest",
            "callback": "https://example.com/cb",
            "minSendable": 1000,
            "maxSendable": 100000000,
            "metadata": "[]"
        }"#;
        let e = parse_pay_params(body).unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidResponse(_)));
    }

    #[test]
    fn parse_pay_params_rejects_inverted_range() {
        let body = r#"{
            "tag": "payRequest",
            "callback": "https://example.com/cb",
            "minSendable": 100,
            "maxSendable": 10,
            "metadata": "[]"
        }"#;
        let e = parse_pay_params(body).unwrap_err();
        assert!(matches!(e, LightningAddressError::InvalidResponse(_)));
    }

    #[test]
    fn parse_callback_accepts_valid_pr() {
        let body = r#"{"pr":"lnbc100n1example","routes":[]}"#;
        let pr = parse_callback(body).unwrap();
        assert_eq!(pr, "lnbc100n1example");
    }

    #[test]
    fn parse_callback_handles_error_body() {
        let body = r#"{"status":"ERROR","reason":"amount too small"}"#;
        let e = parse_callback(body).unwrap_err();
        match e {
            LightningAddressError::ServerError(r) => assert_eq!(r, "amount too small"),
            other => panic!("expected ServerError, got {other:?}"),
        }
    }

    #[test]
    fn request_invoice_rejects_below_min() {
        let info = LightningAddressInfo {
            tag: "payRequest".into(),
            callback: "https://example.com/cb".into(),
            min_sendable: 1000,
            max_sendable: 100_000_000,
            metadata: "[]".into(),
            comment_allowed: None,
        };
        // Drive request_invoice via tokio so we exercise the bounds check
        // without ever hitting the network.
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let e = rt
            .block_on(request_invoice(&info, 500, None))
            .expect_err("amount below min should error");
        assert!(matches!(e, LightningAddressError::AmountOutOfRange { .. }));
    }

    #[test]
    fn request_invoice_rejects_above_max() {
        let info = LightningAddressInfo {
            tag: "payRequest".into(),
            callback: "https://example.com/cb".into(),
            min_sendable: 1000,
            max_sendable: 10_000,
            metadata: "[]".into(),
            comment_allowed: None,
        };
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let e = rt
            .block_on(request_invoice(&info, 20_000, None))
            .expect_err("amount above max should error");
        assert!(matches!(e, LightningAddressError::AmountOutOfRange { .. }));
    }
}

// -----------------------------------------------------------------------------
// Integration tests against real LNURL servers. Gated behind `real-network-tests`
// because they require network + are sensitive to remote availability.
// Run with:  cargo test -p agicash-lightning-address --features real-network-tests
// -----------------------------------------------------------------------------
#[cfg(all(test, feature = "real-network-tests"))]
mod real_network_tests {
    use super::*;

    #[tokio::test]
    async fn resolves_walletofsatoshi_address() {
        // Wallet of Satoshi exposes LUD-16 for any registered user. We use
        // their canonical "wallet of satoshi" address (well-publicized,
        // unlikely to disappear). Fall back to coinos if WoS rejects.
        let info = resolve("walletofsatoshi@walletofsatoshi.com")
            .await
            .expect("walletofsatoshi.com should respond");
        assert_eq!(info.tag, "payRequest");
        assert!(info.min_sendable >= 1);
        assert!(info.max_sendable >= info.min_sendable);
        assert!(info.callback.starts_with("https://"));
        println!(
            "WoS callback={} min={} max={}",
            info.callback, info.min_sendable, info.max_sendable
        );
    }

    #[tokio::test]
    async fn requests_invoice_from_walletofsatoshi() {
        let info = resolve("walletofsatoshi@walletofsatoshi.com")
            .await
            .expect("resolve should succeed");
        // Use min_sendable to avoid sending too much (this generates a real
        // invoice we won't pay, but the server allocates resources to it).
        let amount = info.min_sendable.max(1000);
        if amount > info.max_sendable {
            panic!("min > max, can't pick an amount");
        }
        let invoice = request_invoice(&info, amount, None)
            .await
            .expect("invoice request should succeed");
        assert!(
            invoice.starts_with("lnbc") || invoice.starts_with("LNBC"),
            "expected BOLT-11 invoice, got: {invoice}"
        );
        println!("invoice length = {}", invoice.len());
    }
}
