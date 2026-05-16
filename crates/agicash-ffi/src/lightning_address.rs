//! FFI surface for LUD-16 Lightning Address resolution.
//!
//! Wraps the network-free `agicash_lightning_address` resolver crate so
//! iOS/Android Send UI can call it directly without going through the
//! wallet handle — Lightning Address resolution carries no wallet state,
//! it's pure address-parsing + HTTPS GETs.
//!
//! Mirrors the CLI's `send lightning-address` plumbing
//! (`crates/agicash-cli/src/send_lightning_address.rs`): first
//! [`resolve_lightning_address`] to fetch LUD-06 pay-request params,
//! then [`request_lightning_invoice`] with the chosen `amount_msat` to
//! get a BOLT-11 invoice. Consumers then pass the invoice to the
//! existing send-lightning flow on the wallet.
//!
//! ## Why module-level free functions
//!
//! LUD-16 resolution is wallet-agnostic — no session, no storage, no
//! Cashu provider — so we expose these as module-level
//! `#[uniffi::export]` functions rather than methods on
//! `AgicashWallet`. Same shape as how the underlying crate exposes
//! them.

use agicash_lightning_address::{
    parse_lightning_address as parse_inner, request_invoice as request_invoice_inner,
    resolve as resolve_inner, LightningAddressError as InnerError,
    LightningAddressInfo as InnerInfo,
};

/// Localpart + domain split of a LUD-16 Lightning Address.
///
/// `parse_lightning_address("alice@example.com")` yields
/// `{ localpart: "alice", domain: "example.com" }`. The shape mirrors
/// the underlying crate's tuple return — flattened into a `Record` so
/// Swift / Kotlin callers get named fields rather than positional
/// tuple accessors.
#[derive(Debug, Clone, uniffi::Record)]
pub struct LightningAddressParts {
    /// Lowercase localpart per LUD-16 (allowed chars: `a-z 0-9 _ -`).
    pub localpart: String,
    /// Domain portion — may include a port for local-dev addresses
    /// (e.g. `localhost:8080`).
    pub domain: String,
}

/// FFI mirror of [`agicash_lightning_address::LightningAddressInfo`].
///
/// All numeric fields are kept as `u64` (msat is well within `u64`'s
/// range). `comment_allowed` mirrors LUD-12: `None` means the server
/// did not advertise comment support.
///
/// Consumers receive this from [`resolve_lightning_address`] and pass
/// it back unchanged to [`request_lightning_invoice`] — the Rust side
/// re-validates the amount against `min_sendable`/`max_sendable`
/// before hitting the callback.
#[derive(Debug, Clone, uniffi::Record)]
pub struct LightningAddressInfo {
    /// Must be `"payRequest"` for LUD-06 (the resolver enforces this).
    pub tag: String,
    /// Callback URL the wallet GETs with `?amount=<msat>` to receive
    /// an invoice.
    pub callback: String,
    /// Minimum amount in millisats the service is willing to invoice.
    pub min_sendable: u64,
    /// Maximum amount in millisats the service is willing to invoice.
    pub max_sendable: u64,
    /// Raw LUD-06 metadata blob (JSON-encoded string). Not parsed here
    /// — surfaced verbatim so the UI can extract `text/plain` or
    /// `image/png` entries on demand.
    pub metadata: String,
    /// Maximum comment length the server accepts per LUD-12, or
    /// `None` if comments are not advertised.
    pub comment_allowed: Option<u32>,
}

impl From<InnerInfo> for LightningAddressInfo {
    fn from(info: InnerInfo) -> Self {
        Self {
            tag: info.tag,
            callback: info.callback,
            min_sendable: info.min_sendable,
            max_sendable: info.max_sendable,
            metadata: info.metadata,
            comment_allowed: info.comment_allowed,
        }
    }
}

impl From<LightningAddressInfo> for InnerInfo {
    fn from(info: LightningAddressInfo) -> Self {
        Self {
            tag: info.tag,
            callback: info.callback,
            min_sendable: info.min_sendable,
            max_sendable: info.max_sendable,
            metadata: info.metadata,
            comment_allowed: info.comment_allowed,
        }
    }
}

/// FFI mirror of [`agicash_lightning_address::LightningAddressError`].
///
/// Flat enum with stable variant names so Swift / Kotlin consumers can
/// switch on the case and render UI accordingly:
/// - `InvalidAddress` -> "this isn't a Lightning Address"
/// - `Network` -> "couldn't reach the recipient's server, try again"
/// - `InvalidResponse` -> "the recipient's server returned an unexpected response"
/// - `AmountOutOfRange` -> "amount must be between min and max sats"
/// - `ServerError` -> server-supplied human-readable reason
///
/// `AmountOutOfRange` keeps the three bounds-relevant fields (the
/// rejected amount + advertised min/max) so the UI can render
/// "minimum 1000 sat" without re-parsing the message.
#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum LightningAddressError {
    #[error("invalid lightning address: {message}")]
    InvalidAddress { message: String },
    #[error("network error: {message}")]
    Network { message: String },
    #[error("invalid response: {message}")]
    InvalidResponse { message: String },
    #[error("amount {amount_msat} msat outside range {min}..={max}")]
    AmountOutOfRange {
        amount_msat: u64,
        min: u64,
        max: u64,
    },
    #[error("server returned error: {message}")]
    ServerError { message: String },
}

impl From<InnerError> for LightningAddressError {
    fn from(err: InnerError) -> Self {
        match err {
            InnerError::InvalidAddress(message) => Self::InvalidAddress { message },
            InnerError::Network(message) => Self::Network { message },
            InnerError::InvalidResponse(message) => Self::InvalidResponse { message },
            InnerError::AmountOutOfRange {
                amount_msat,
                min,
                max,
            } => Self::AmountOutOfRange {
                amount_msat,
                min,
                max,
            },
            InnerError::ServerError(message) => Self::ServerError { message },
        }
    }
}

/// Parse a Lightning Address into its localpart and domain.
///
/// Validates the LUD-16 character set on the localpart and a sane
/// domain shape. Accepts `user@localhost` and `user@127.0.0.1` for
/// local development (the underlying crate switches to plain http for
/// those hosts when resolving).
///
/// This is the only synchronous-in-spirit call in the surface — kept
/// `async` to match the other two so the Swift / Kotlin call sites
/// look uniform (an iOS `Task { ... }` block can `await` all three
/// without a special-case for the parse step).
///
/// # Errors
/// Returns [`LightningAddressError::InvalidAddress`] when the input
/// fails to parse or violates LUD-16's character rules.
#[uniffi::export(async_runtime = "tokio")]
#[allow(clippy::unused_async)]
pub async fn parse_lightning_address(
    address: String,
) -> Result<LightningAddressParts, LightningAddressError> {
    let (localpart, domain) = parse_inner(&address)?;
    Ok(LightningAddressParts { localpart, domain })
}

/// Resolve a Lightning Address to its LUD-06 pay-request params.
///
/// Performs the well-known lookup
/// (`GET https://<domain>/.well-known/lnurlp/<localpart>`) and returns
/// the parsed pay-request info. Networks are hit here — the iOS UI
/// should show a spinner.
///
/// # Errors
/// - [`LightningAddressError::InvalidAddress`] for parse failures.
/// - [`LightningAddressError::Network`] for transport failures.
/// - [`LightningAddressError::InvalidResponse`] for malformed bodies.
/// - [`LightningAddressError::ServerError`] when the LNURL server
///   returns `{"status": "ERROR", "reason": "..."}` per LUD-06.
#[uniffi::export(async_runtime = "tokio")]
pub async fn resolve_lightning_address(
    address: String,
) -> Result<LightningAddressInfo, LightningAddressError> {
    let info = resolve_inner(&address).await?;
    Ok(info.into())
}

/// Request a BOLT-11 invoice from a previously-resolved Lightning
/// Address.
///
/// The `amount_msat` is bounds-checked against
/// `info.min_sendable`/`info.max_sendable` client-side first so we
/// fail fast without hitting the network. The optional `comment`
/// rides along as `?comment=<comment>` per LUD-12 when the server
/// advertises comment support.
///
/// Returns the raw BOLT-11 invoice string the consumer should feed
/// to the wallet's existing send-lightning flow.
///
/// # Errors
/// - [`LightningAddressError::AmountOutOfRange`] when `amount_msat`
///   is outside the advertised range.
/// - [`LightningAddressError::Network`] / `InvalidResponse` /
///   `ServerError` for the usual callback failures.
#[uniffi::export(async_runtime = "tokio")]
pub async fn request_lightning_invoice(
    info: LightningAddressInfo,
    amount_msat: u64,
    comment: Option<String>,
) -> Result<String, LightningAddressError> {
    let inner: InnerInfo = info.into();
    let invoice = request_invoice_inner(&inner, amount_msat, comment.as_deref()).await?;
    Ok(invoice)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn parses_simple_address() {
        let parts = parse_lightning_address("alice@example.com".into())
            .await
            .expect("simple address parses");
        assert_eq!(parts.localpart, "alice");
        assert_eq!(parts.domain, "example.com");
    }

    #[tokio::test]
    async fn parses_walletofsatoshi_address() {
        let parts = parse_lightning_address("user@walletofsatoshi.com".into())
            .await
            .expect("walletofsatoshi shape parses");
        assert_eq!(parts.localpart, "user");
        assert_eq!(parts.domain, "walletofsatoshi.com");
    }

    #[tokio::test]
    async fn parses_localhost_address_for_dev() {
        let parts = parse_lightning_address("dev@localhost:8080".into())
            .await
            .expect("localhost address parses for dev");
        assert_eq!(parts.localpart, "dev");
        assert_eq!(parts.domain, "localhost:8080");
    }

    #[tokio::test]
    async fn rejects_address_without_at_sign() {
        let err = parse_lightning_address("not-an-address".into())
            .await
            .expect_err("missing @ should fail");
        assert!(matches!(err, LightningAddressError::InvalidAddress { .. }));
    }

    #[tokio::test]
    async fn rejects_uppercase_localpart() {
        // LUD-16: localpart MUST be lowercase. The Send UI should
        // lowercase before calling, but FFI rejects too as a guard.
        let err = parse_lightning_address("Alice@example.com".into())
            .await
            .expect_err("uppercase should fail");
        assert!(matches!(err, LightningAddressError::InvalidAddress { .. }));
    }

    #[test]
    fn info_roundtrips_ffi_and_inner() {
        // Sanity check that the `From` impls between the FFI Record
        // and the underlying crate's struct are lossless — the iOS
        // app sends `LightningAddressInfo` it got from
        // `resolve_lightning_address` straight back into
        // `request_lightning_invoice`, so the round-trip must
        // preserve every field bit-for-bit.
        let original = LightningAddressInfo {
            tag: "payRequest".into(),
            callback: "https://example.com/cb?token=abc".into(),
            min_sendable: 1_000,
            max_sendable: 100_000_000,
            metadata: r#"[["text/plain","sats for alice"]]"#.into(),
            comment_allowed: Some(255),
        };
        let inner: InnerInfo = original.clone().into();
        let back: LightningAddressInfo = inner.into();
        assert_eq!(back.tag, original.tag);
        assert_eq!(back.callback, original.callback);
        assert_eq!(back.min_sendable, original.min_sendable);
        assert_eq!(back.max_sendable, original.max_sendable);
        assert_eq!(back.metadata, original.metadata);
        assert_eq!(back.comment_allowed, original.comment_allowed);
    }

    #[test]
    fn error_maps_each_inner_variant() {
        let invalid: LightningAddressError = InnerError::InvalidAddress("nope".into()).into();
        assert!(matches!(invalid, LightningAddressError::InvalidAddress { .. }));

        let net: LightningAddressError = InnerError::Network("dns".into()).into();
        assert!(matches!(net, LightningAddressError::Network { .. }));

        let resp: LightningAddressError = InnerError::InvalidResponse("bad json".into()).into();
        assert!(matches!(resp, LightningAddressError::InvalidResponse { .. }));

        let oor: LightningAddressError = InnerError::AmountOutOfRange {
            amount_msat: 500,
            min: 1_000,
            max: 10_000,
        }
        .into();
        match oor {
            LightningAddressError::AmountOutOfRange {
                amount_msat,
                min,
                max,
            } => {
                assert_eq!(amount_msat, 500);
                assert_eq!(min, 1_000);
                assert_eq!(max, 10_000);
            }
            other => panic!("expected AmountOutOfRange, got {other:?}"),
        }

        let srv: LightningAddressError = InnerError::ServerError("user not found".into()).into();
        assert!(matches!(srv, LightningAddressError::ServerError { .. }));
    }

    #[tokio::test]
    async fn request_invoice_rejects_below_min_without_network() {
        // Exercise the bounds-check guard so we can be confident the
        // FFI wrapper preserves the underlying crate's fail-fast
        // behaviour — no network hit.
        let info = LightningAddressInfo {
            tag: "payRequest".into(),
            callback: "https://example.com/cb".into(),
            min_sendable: 1_000,
            max_sendable: 100_000_000,
            metadata: "[]".into(),
            comment_allowed: None,
        };
        let err = request_lightning_invoice(info, 500, None)
            .await
            .expect_err("below min should error");
        assert!(matches!(
            err,
            LightningAddressError::AmountOutOfRange { .. }
        ));
    }

    #[tokio::test]
    async fn request_invoice_rejects_above_max_without_network() {
        let info = LightningAddressInfo {
            tag: "payRequest".into(),
            callback: "https://example.com/cb".into(),
            min_sendable: 1_000,
            max_sendable: 10_000,
            metadata: "[]".into(),
            comment_allowed: None,
        };
        let err = request_lightning_invoice(info, 50_000, None)
            .await
            .expect_err("above max should error");
        assert!(matches!(
            err,
            LightningAddressError::AmountOutOfRange { .. }
        ));
    }
}
