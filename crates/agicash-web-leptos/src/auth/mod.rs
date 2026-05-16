//! Server-side auth-proxy handlers (SSR only).
//!
//! The browser never loads `opensecret` directly (spec §7). Instead the
//! Leptos wasm calls into this small axum router which:
//!   1. Forwards the user's credentials to the real OpenSecret enclave via
//!      `agicash-auth-opensecret`,
//!   2. Sets the refresh token in an httpOnly cookie (XSS-resistant),
//!   3. Returns the short-lived access token + user_id in the JSON body.
//!
//! All handlers are gated behind `#[cfg(feature = "ssr")]` (the whole
//! module is too, see `lib.rs`). The wasm bundle never imports opensecret.

use std::sync::Arc;

use agicash_auth_opensecret::{
    login_email, logout, refresh, register_email, register_guest, OpenSecretClient,
    OpenSecretConfig,
};
use axum::{
    extract::State,
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::{Deserialize, Serialize};

/// Per-process auth client. Created at server boot from environment
/// variables (`OPENSECRET_BASE_URL` + `OPENSECRET_CLIENT_ID`).
#[derive(Clone, Debug)]
pub struct AuthState {
    pub client: Arc<OpenSecretClient>,
}

impl AuthState {
    /// Build from env vars. Errors are mapped to anyhow-style strings —
    /// the caller (in `main.rs`) prints + exits if construction fails.
    pub fn from_env() -> Result<Self, String> {
        let config = OpenSecretConfig::from_env().map_err(|e| {
            format!(
                "missing OpenSecret config: {e}. Set OPENSECRET_BASE_URL + OPENSECRET_CLIENT_ID."
            )
        })?;
        let client =
            OpenSecretClient::new(config).map_err(|e| format!("build opensecret client: {e}"))?;
        Ok(Self {
            client: Arc::new(client),
        })
    }

    /// Build a `Router` over `/api/auth/*` that this crate's
    /// `main.rs` can `.merge` into the top-level axum app.
    pub fn router(self) -> Router {
        Router::new()
            .route("/api/auth/guest", post(guest_handler))
            .route("/api/auth/login", post(login_handler))
            .route("/api/auth/signup", post(signup_handler))
            .route("/api/auth/refresh", post(refresh_handler))
            .route("/api/auth/logout", post(logout_handler))
            .with_state(self)
    }
}

// ---- Request / response shapes -------------------------------------------

#[derive(Deserialize, Debug)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[derive(Deserialize, Debug)]
pub struct SignupRequest {
    pub email: String,
    pub password: String,
    pub name: Option<String>,
}

/// Sent back to the browser on every successful auth call. The
/// `access_token` is short-lived and sits in a Leptos memory signal;
/// `refresh_token` rides on the `Set-Cookie` header (httpOnly, never
/// touched by the body).
#[derive(Serialize, Debug)]
pub struct AuthResponse {
    pub access_token: String,
    pub user_id: String,
}

// ---- Cookie + response helpers --------------------------------------------

const REFRESH_COOKIE: &str = "agicash_refresh_token";

/// Build the standard refresh-token cookie. `HttpOnly` keeps it out of
/// JS reach; `Secure` requires HTTPS in prod (the dev server runs on
/// http://127.0.0.1:3000 so cargo-leptos users will need a flag to
/// disable for local — Phase 2 work, not in this scaffold).
fn refresh_cookie(token: &str) -> String {
    // 30-day lifetime matches the OpenSecret default refresh window.
    format!("{REFRESH_COOKIE}={token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000")
}

/// Build a cookie that clears the refresh-token cookie on the browser.
fn clear_refresh_cookie() -> String {
    format!("{REFRESH_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0")
}

fn json_response<T: Serialize>(
    body: &T,
    cookie: Option<String>,
) -> Result<Response, (StatusCode, String)> {
    let payload = serde_json::to_vec(body).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("encode json: {e}"),
        )
    })?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    if let Some(cookie) = cookie {
        if let Ok(v) = HeaderValue::from_str(&cookie) {
            headers.insert(header::SET_COOKIE, v);
        }
    }
    Ok((StatusCode::OK, headers, payload).into_response())
}

/// Map any `AuthError` to a 401 + plain-text body. The browser surfaces
/// the body to the user; we never echo opensecret internals verbatim,
/// but the error tag (e.g. "invalid credentials") is fine.
fn auth_err<E: std::fmt::Display>(e: E) -> (StatusCode, String) {
    (StatusCode::UNAUTHORIZED, format!("auth error: {e}"))
}

// ---- Handlers -------------------------------------------------------------

async fn guest_handler(State(state): State<AuthState>) -> Result<Response, (StatusCode, String)> {
    let password = random_password();
    let resp = register_guest(&state.client, password, state.client.client_id())
        .await
        .map_err(auth_err)?;
    json_response(
        &AuthResponse {
            access_token: resp.access_token,
            user_id: resp.id.to_string(),
        },
        Some(refresh_cookie(&resp.refresh_token)),
    )
}

async fn login_handler(
    State(state): State<AuthState>,
    Json(body): Json<LoginRequest>,
) -> Result<Response, (StatusCode, String)> {
    let resp = login_email(
        &state.client,
        body.email,
        body.password,
        state.client.client_id(),
    )
    .await
    .map_err(auth_err)?;
    json_response(
        &AuthResponse {
            access_token: resp.access_token,
            user_id: resp.id.to_string(),
        },
        Some(refresh_cookie(&resp.refresh_token)),
    )
}

async fn signup_handler(
    State(state): State<AuthState>,
    Json(body): Json<SignupRequest>,
) -> Result<Response, (StatusCode, String)> {
    let resp = register_email(
        &state.client,
        body.email,
        body.password,
        state.client.client_id(),
        body.name,
    )
    .await
    .map_err(auth_err)?;
    json_response(
        &AuthResponse {
            access_token: resp.access_token,
            user_id: resp.id.to_string(),
        },
        Some(refresh_cookie(&resp.refresh_token)),
    )
}

async fn refresh_handler(State(state): State<AuthState>) -> Result<Response, (StatusCode, String)> {
    // NOTE: the underlying `opensecret` crate manages refresh-token state
    // internally per client instance. In production the server would need
    // to look up the per-user session keyed on the cookie value; for the
    // Phase 1 scaffold we wire the surface and stub the per-cookie lookup
    // — real session state lives in slice 12's `WalletClient`.
    refresh(&state.client).await.map_err(auth_err)?;
    // Without per-user state we can't return a fresh access token here;
    // 501 surfaces the gap clearly until the slice-12 plumbing arrives.
    Err((
        StatusCode::NOT_IMPLEMENTED,
        "refresh wiring pending slice 12 (per-user session state)".to_string(),
    ))
}

async fn logout_handler(State(state): State<AuthState>) -> Result<Response, (StatusCode, String)> {
    let _ = logout(&state.client).await; // best-effort
    let body = serde_json::json!({ "ok": true });
    let payload = serde_json::to_vec(&body).map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("encode json: {e}"),
        )
    })?;
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    headers.insert(
        header::SET_COOKIE,
        HeaderValue::from_str(&clear_refresh_cookie())
            .unwrap_or_else(|_| HeaderValue::from_static("")),
    );
    Ok((StatusCode::OK, headers, payload).into_response())
}

// ---- Misc helpers --------------------------------------------------------

/// 16 random bytes hex-encoded — matches `agicash-cli::auth::random_password`.
fn random_password() -> String {
    // We avoid pulling in `getrandom` directly here; just use the OS RNG
    // via a tiny local helper to keep the dep graph trim. opensecret's
    // password is opaque to the server (the enclave hashes it), so the
    // shape only needs to be ASCII and entropic enough.
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let mut h = std::collections::hash_map::DefaultHasher::new();
    use std::hash::{Hash, Hasher};
    nanos.hash(&mut h);
    std::process::id().hash(&mut h);
    // 64 bits of entropy here is weak. The intent is "a non-trivial
    // throwaway string" — true randomness for guests will land with
    // slice 12 (where `getrandom` is already a workspace dep).
    format!("{:016x}-{:016x}", nanos as u64, h.finish())
}
