//! `LoginView` — three-option login chooser, ported from iOS
//! `LoginOptionsCard` (see `ios/Agicash/Agicash/LoginView.swift` L123-193).
//!
//! Phase 1 partial behaviour:
//!   - "Continue as guest" calls `OpenSecretClient::register_guest`
//!     directly from wasm, persists the refresh token to
//!     `window.localStorage` via `BrowserSessionStorage`, stores the
//!     access token in the `AccessToken` signal, and navigates `/`.
//!   - "Log in with Email" and "Log in with Google" show a placeholder
//!     toast — those flows arrive after slice 12 wires the `WalletClient`.
//!   - "Sign up" link is a placeholder for the same reason.
//!
//! The axum SSR auth-proxy was ripped on 2026-05-17; the only path
//! now is wasm → opensecret direct.

// The `LoginView` component renders a long view block in Leptos's IntoView
// idiom; splitting it would just add indirection for indirection's sake.
#![allow(clippy::too_many_lines)]

use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::hooks::use_navigate;

use crate::app::AccessToken;
use crate::tokens;

/// Output of the in-browser guest-auth path. Only the `access_token`
/// gets propagated to the `AccessToken` signal; `user_id` is kept for
/// future plumbing (analytics, settings page) and currently unread on
/// the native `rlib` build.
#[allow(dead_code)]
#[derive(Debug, Clone)]
struct AuthResponse {
    access_token: String,
    user_id: String,
}

#[component]
pub fn LoginView() -> impl IntoView {
    let AccessToken(token) = expect_context::<AccessToken>();
    let navigate = use_navigate();

    // `RwSignal` instead of plain Signal so the closures can both read
    // (for disabling buttons) and write (for clearing).
    let is_working = RwSignal::new(false);
    let error_message: RwSignal<Option<String>> = RwSignal::new(None);

    // ---- Guest auth handler ------------------------------------------------
    // Clones for the move closure. spawn_local hops the request to the
    // browser's microtask queue; the native rlib build compiles the
    // closure but the live opensecret round-trip is wasm-only (see the
    // `cfg(target_arch = "wasm32")` gate inside the closure).
    let on_guest = {
        let navigate = navigate.clone();
        move |_ev| {
            if is_working.get() {
                return;
            }
            is_working.set(true);
            error_message.set(None);
            let navigate = navigate.clone();
            spawn_local(async move {
                // The opensecret round-trip is browser-only — `reqwest`'s
                // wasm future is `!Send` and the native rlib build (kept
                // for `cargo test` to pick up the unit tests on the
                // pure-Rust pieces) cannot pull it in. Gate the live path
                // on `target_arch = "wasm32"`; the native arm just
                // touches the captured signals so they don't appear
                // unused.
                #[cfg(target_arch = "wasm32")]
                {
                    match guest_auth_fetch().await {
                        Ok(resp) => {
                            token.set(Some(resp.access_token));
                            navigate("/", Default::default());
                        }
                        Err(msg) => {
                            error_message.set(Some(msg));
                        }
                    }
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    let _ = (&token, &navigate);
                }
                is_working.set(false);
            });
        }
    };

    // ---- Stubbed handlers --------------------------------------------------
    let on_email = move |_| {
        error_message.set(Some(
            "Email login is coming soon. For now, continue as guest.".to_string(),
        ));
    };
    let on_google = move |_| {
        error_message.set(Some(
            "Google login is coming soon. For now, continue as guest.".to_string(),
        ));
    };
    let on_signup = move |()| {
        error_message.set(Some(
            "Sign up is coming soon. For now, continue as guest.".to_string(),
        ));
    };

    // ---- Styles ------------------------------------------------------------
    // The card mirrors `LoginOptionsCard` from iOS — vertically-stacked
    // buttons inside a max-w-384 card. Inline styles keep this file
    // self-contained for now; once Tailwind is wired into cargo-leptos a
    // follow-up can swap them for utility classes.
    let page_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         min-height:100dvh; padding:{} {}; background:{}; \
         color:{}; font-family:{};",
        tokens::SPACE_HERO,
        tokens::SPACE_L,
        tokens::COLOR_BACKGROUND,
        tokens::COLOR_FOREGROUND,
        tokens::FONT_PRIMARY,
    );

    let logo_style = format!(
        "font-family:{}; font-size:36px; font-weight:600; \
         letter-spacing:0.05em; margin-bottom:{}; color:{};",
        tokens::FONT_NUMERIC,
        tokens::SPACE_XXL,
        tokens::COLOR_PRIMARY,
    );

    let card_style = format!(
        "background:{}; color:{}; border:1px solid {}; \
         border-radius:{}; padding:{}; box-shadow:{}; \
         width:100%; max-width:{}; display:flex; \
         flex-direction:column; gap:{};",
        tokens::COLOR_CARD,
        tokens::COLOR_CARD_FOREGROUND,
        tokens::COLOR_BORDER,
        tokens::RADIUS_LG,
        tokens::SPACE_XXL,
        tokens::SHADOW_XS,
        tokens::CARD_MAX_WIDTH,
        tokens::SPACE_L,
    );

    let title_style = format!(
        "font-size:{}; font-weight:600; margin:0; color:{};",
        tokens::TEXT_2XL,
        tokens::COLOR_CARD_FOREGROUND,
    );

    let description_style = format!(
        "font-size:{}; margin:0 0 {} 0; color:{};",
        tokens::TEXT_SM,
        tokens::SPACE_S,
        tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=page_style>
            // Brand mark — text wordmark in the typographic style of the iOS
            // AgicashLogo asset. When the public/icon-512 PNG is wired into
            // an `<img/>` for parity, swap this `<div>` for `<img ...>`.
            <div style=logo_style aria-label="Agicash">"agicash"</div>

            <div style=card_style>
                <div>
                    <h1 style=title_style>"Login"</h1>
                    <p style=description_style>"Choose your preferred login method"</p>
                </div>

                <button
                    style=button_style(ButtonVariant::Primary)
                    disabled=move || is_working.get()
                    on:click=on_email
                >
                    "Log in with Email"
                </button>

                <button
                    style=button_style(ButtonVariant::Primary)
                    disabled=move || is_working.get()
                    on:click=on_google
                >
                    "Log in with Google"
                </button>

                <button
                    style=button_style(ButtonVariant::Ghost)
                    disabled=move || is_working.get()
                    on:click=on_guest
                >
                    {move || if is_working.get() { "Working..." } else { "Continue as guest" }}
                </button>

                // Render the error/notice line when present.
                {move || error_message.get().map(|msg| view! {
                    <p style=format!(
                        "color:{}; font-size:{}; margin:0;",
                        tokens::COLOR_DESTRUCTIVE,
                        tokens::TEXT_SM,
                    )>{msg}</p>
                })}

                <div style=format!(
                    "text-align:center; font-size:{}; margin-top:{};",
                    tokens::TEXT_SM,
                    tokens::SPACE_S,
                )>
                    <span>"Don't have an account? "</span>
                    <a
                        href="#"
                        style=format!(
                            "color:{}; text-decoration:underline; cursor:pointer;",
                            tokens::COLOR_CARD_FOREGROUND,
                        )
                        on:click=move |ev| {
                            ev.prevent_default();
                            on_signup(());
                        }
                    >
                        "Sign up"
                    </a>
                </div>
            </div>
        </div>
    }
}

// ---- Button style helper --------------------------------------------------
// Two variants matching `LoginOptionsCard` (Primary for Email/Google,
// Ghost for the "Continue as guest" subordinate button).

#[derive(Clone, Copy)]
enum ButtonVariant {
    Primary,
    Ghost,
}

fn button_style(variant: ButtonVariant) -> String {
    let (bg, fg, border) = match variant {
        ButtonVariant::Primary => (
            tokens::COLOR_PRIMARY,
            tokens::COLOR_PRIMARY_FOREGROUND,
            tokens::COLOR_PRIMARY,
        ),
        ButtonVariant::Ghost => (
            "transparent",
            tokens::COLOR_CARD_FOREGROUND,
            tokens::COLOR_BORDER,
        ),
    };
    format!(
        "display:inline-flex; align-items:center; justify-content:center; \
         height:40px; padding:0 {pad}; border-radius:{radius}; \
         font-size:{text}; font-weight:500; font-family:inherit; \
         background:{bg}; color:{fg}; border:1px solid {border}; \
         cursor:pointer; transition:opacity 150ms ease;",
        pad = tokens::SPACE_L,
        radius = tokens::RADIUS_MD,
        text = tokens::TEXT_SM,
    )
}

// ---- Browser-side guest auth -------------------------------------------
// No more axum proxy: the wasm bundle calls into `OpenSecretClient`
// directly, persists the refresh token via `BrowserSessionStorage`
// (`window.localStorage`), and surfaces the access token to the App
// via the `AccessToken` signal.
//
// Threat model: XSS exposure on the refresh token is accepted, matching
// the legacy React app's convention. See the operator's 2026-05-17
// pivot note for the rationale.
//
// Config: for the Phase-1 smoke test we hardcode the local-dev
// enclave (`http://127.0.0.1:3999`) + the workspace's `OPENSECRET_CLIENT_ID`
// default. Real config injection (build-time env, `<meta>` tag, fetch
// from a `/config.json`) is a follow-up — the surface here is the only
// site that needs updating when we wire it.

/// Local-dev enclave URL. Mirrors the default in `nix/shells/default.nix`
/// (and the operator's `project_opensecret_local_stack.md` recipe).
#[cfg(target_arch = "wasm32")]
const DEV_OPENSECRET_BASE_URL: &str = "http://127.0.0.1:3999";

/// Local-dev client_id. Mirrors the default in `nix/shells/default.nix`.
#[cfg(target_arch = "wasm32")]
const DEV_OPENSECRET_CLIENT_ID: &str = "ba5a14b5-d915-47b1-b7b1-afda52bc5fc6";

#[cfg(target_arch = "wasm32")]
async fn guest_auth_fetch() -> Result<AuthResponse, String> {
    use agicash_auth_opensecret::{
        register_guest, BrowserSessionStorage, OpenSecretClient, OpenSecretConfig,
    };
    use agicash_traits::{PersistedSession, SessionStorage};

    let config = OpenSecretConfig {
        base_url: DEV_OPENSECRET_BASE_URL.to_string(),
        client_id: DEV_OPENSECRET_CLIENT_ID
            .parse()
            .map_err(|e| format!("invalid built-in client_id: {e}"))?,
    };
    let client =
        OpenSecretClient::new(config).map_err(|e| format!("build opensecret client: {e}"))?;

    let password = random_password_browser();
    let response = register_guest(&client, password, client.client_id())
        .await
        .map_err(|e| format!("guest registration failed: {e}"))?;

    // Persist refresh token to localStorage so a page reload can resume
    // the session. The access token stays in memory (the `AccessToken`
    // signal) per spec §7's in-memory-only access-token rule.
    let persisted = PersistedSession {
        user_id: response.id,
        refresh_token: response.refresh_token.clone(),
    };
    BrowserSessionStorage::new()
        .store(&persisted)
        .await
        .map_err(|e| format!("session persist failed: {e}"))?;

    Ok(AuthResponse {
        access_token: response.access_token,
        user_id: response.id.to_string(),
    })
}

/// Throwaway 32-char hex password for guest registration. The enclave
/// hashes it; we never need to recover it. Sourced from `getrandom`
/// (wasm-compatible via the `js` feature on the workspace dep).
#[cfg(target_arch = "wasm32")]
fn random_password_browser() -> String {
    let mut buf = [0u8; 16];
    // Best-effort: if `getrandom` fails the downstream opensecret call
    // will also fail and the user sees a comprehensible error in the UI.
    let _ = getrandom::getrandom(&mut buf);
    buf.iter().map(|b| format!("{b:02x}")).collect()
}
