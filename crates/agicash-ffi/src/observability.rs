//! Tracing → `os_log` bridge for iOS observability.
//!
//! Installs a process-wide `tracing` subscriber the first time any FFI
//! method is called. On Apple targets the subscriber routes through
//! `tracing-oslog` so every `tracing::info!` / `tracing::debug!` /
//! `tracing::warn!` / `tracing::error!` shows up in the iOS sim's
//! unified logging system, filterable via:
//!
//! ```sh
//! xcrun simctl spawn booted log stream \
//!   --predicate 'subsystem == "app.agicash.rust"' \
//!   --info --debug
//! ```
//!
//! Off Apple (linux CI, wasm) we fall back to a stderr-formatting
//! subscriber so tests + CLI still get usable output.
//!
//! ## Filter level
//!
//! Reads `AGICASH_LOG` at install time (e.g. `AGICASH_LOG=debug`,
//! `AGICASH_LOG=agicash_storage_supabase=trace,info`). Defaults to
//! `info`. The env-filter syntax matches `tracing-subscriber`'s
//! `EnvFilter`.
//!
//! ## Subsystem / category
//!
//! Subsystem is always `app.agicash.rust`. The `tracing-oslog 0.3`
//! crate takes a single category per logger, so we install ONE
//! category (`rust`) and let the per-event `target` (e.g.
//! `agicash_ffi::wallet`) ride along in the message body. Filtering
//! by crate is easier through `AGICASH_LOG` than through the os_log
//! category predicate anyway.
//!
//! ## Idempotency
//!
//! `init()` is gated behind `std::sync::Once`. Multiple FFI entry
//! points calling it (the wallet constructor, individual methods if
//! anyone wires them later) is fine — only the first call installs
//! the subscriber.

use std::sync::Once;

static INIT: Once = Once::new();

/// Install the global tracing subscriber. Idempotent; safe to call
/// from every FFI entry point.
///
/// On Apple targets this routes events to `os_log` under subsystem
/// `app.agicash.rust`, category `rust`. Elsewhere it falls back to a
/// stderr fmt subscriber.
pub fn init() {
    INIT.call_once(install_subscriber);
}

#[cfg(target_vendor = "apple")]
fn install_subscriber() {
    use tracing_oslog::OsLogger;
    use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt, Registry};

    let filter = env_filter();
    let layer = OsLogger::new("app.agicash.rust", "rust");

    // `try_init` rather than `init` because a host harness (tests,
    // CLI re-export) may have already installed a global subscriber;
    // we don't want to panic the FFI on a benign double-install.
    let _ = Registry::default().with(filter).with(layer).try_init();
}

#[cfg(not(target_vendor = "apple"))]
fn install_subscriber() {
    use tracing_subscriber::{fmt, layer::SubscriberExt, util::SubscriberInitExt, Registry};

    let filter = env_filter();
    let _ = Registry::default()
        .with(filter)
        .with(fmt::layer().with_writer(std::io::stderr))
        .try_init();
}

fn env_filter() -> tracing_subscriber::EnvFilter {
    // `AGICASH_LOG` is the operator-facing knob. Default to `info` so
    // production traffic is visible without flipping a switch, but
    // noisy crates can be turned up individually
    // (e.g. `AGICASH_LOG=agicash_storage_supabase=trace,info`).
    tracing_subscriber::EnvFilter::try_from_env("AGICASH_LOG")
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"))
}

/// Extract the `sub` claim from a JWT for logging purposes.
///
/// Returns `"<unparseable>"` on any decode/parse failure. Never
/// returns or logs the token itself. The `sub` claim is the user
/// id (a UUID in the OpenSecret case) which is safe to surface —
/// it's the same id already in Supabase and the FFI wallet's
/// in-memory session.
#[must_use]
pub fn jwt_sub(jwt: &str) -> String {
    use base64::Engine;

    let mut parts = jwt.split('.');
    let _header = parts.next();
    let Some(payload_b64) = parts.next() else {
        return "<unparseable>".into();
    };
    let Ok(payload_bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(payload_b64)
    else {
        return "<unparseable>".into();
    };
    let Ok(value) = serde_json::from_slice::<serde_json::Value>(&payload_bytes) else {
        return "<unparseable>".into();
    };
    value
        .get("sub")
        .and_then(|v| v.as_str())
        .map_or_else(|| "<missing-sub>".into(), std::string::ToString::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn init_is_idempotent() {
        init();
        init();
        init();
    }

    #[test]
    fn jwt_sub_extracts_subject() {
        // header.payload.signature where payload = {"sub":"abc","exp":1}
        // base64url-no-pad of `{"sub":"abc","exp":1}` is `eyJzdWIiOiJhYmMiLCJleHAiOjF9`.
        let jwt = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJhYmMiLCJleHAiOjF9.sig";
        assert_eq!(jwt_sub(jwt), "abc");
    }

    #[test]
    fn jwt_sub_handles_garbage() {
        assert_eq!(jwt_sub("not-a-jwt"), "<unparseable>");
        assert_eq!(jwt_sub("a.b.c"), "<unparseable>");
    }
}
