//! Error mapping from CDK to the trait surface. Free functions, not `From`
//! impls, because both error types are foreign and the orphan rule blocks
//! `impl From<cdk::Error> for CashuProviderError` here.

use agicash_traits::CashuProviderError;

/// Best-effort classification of a CDK error into a transport-vs-protocol
/// bucket so the caller can decide whether to retry. CDK does not expose a
/// stable error-kind taxonomy yet, so we sniff the rendered message.
///
/// Takes the error by value so it can be passed directly to `Result::map_err`.
#[allow(clippy::needless_pass_by_value)]
pub fn map_cdk_error(e: cdk::Error) -> CashuProviderError {
    let msg = e.to_string();
    let lc = msg.to_lowercase();
    if lc.contains("connect")
        || lc.contains("timeout")
        || lc.contains("network")
        || lc.contains("unreachable")
        || lc.contains("refused")
        || lc.contains("dns")
        || lc.contains("tls")
        || lc.contains("io error")
    {
        CashuProviderError::Network(msg)
    } else {
        CashuProviderError::Protocol(msg)
    }
}

pub fn map_url_error(e: impl std::fmt::Display) -> CashuProviderError {
    CashuProviderError::InvalidUrl(e.to_string())
}
