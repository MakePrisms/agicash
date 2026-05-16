//! `LoginView` — three-option login chooser, ported from iOS
//! `LoginOptionsCard` (see `ios/Agicash/Agicash/LoginView.swift` L123-193).
//!
//! Phase 1 partial behaviour:
//!   - "Continue as guest" calls `POST /api/auth/guest`, stores the
//!     returned access token in the `AccessToken` signal, and navigates `/`.
//!   - "Log in with Email" and "Log in with Google" show a placeholder
//!     toast — those flows arrive after slice 12 wires the `WalletClient`.
//!   - "Sign up" link is a placeholder for the same reason.

// The `LoginView` component renders a long view block in Leptos's IntoView
// idiom; splitting it would just add indirection for indirection's sake.
#![allow(clippy::too_many_lines)]

use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::hooks::use_navigate;
use serde::Deserialize;

use crate::app::AccessToken;
use crate::tokens;

/// Mirrors `agicash_web_leptos::auth::AuthResponse` on the SSR side.
/// Kept local to avoid pulling the SSR-only module into the wasm bundle.
/// Both fields are accessed only in the hydrate build (the SSR build
/// compiles but never executes the fetch path), hence the dead-code
/// allowance for the SSR-only check.
#[allow(dead_code)]
#[derive(Deserialize, Debug, Clone)]
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
    // browser's microtask queue; SSR side compiles but `gloo_net::fetch`
    // and friends only run on wasm32.
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
                // The actual HTTP call lives behind `feature = "hydrate"` so
                // the SSR build doesn't depend on browser-only crates.
                // The closure body still has to compile for SSR though, hence
                // the cfg-gated branches.
                #[cfg(feature = "hydrate")]
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
                #[cfg(not(feature = "hydrate"))]
                {
                    // Touch the bindings so the compiler doesn't gripe about
                    // unused captures on the SSR build. The closure is dead
                    // code there anyway because there's no browser to run it.
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

// ---- Browser fetch helper -------------------------------------------------
// Only compiled into the wasm bundle (gated behind `feature = "hydrate"`).
// `gloo-net` wraps the platform `fetch` and handles credentials + JSON.

#[cfg(feature = "hydrate")]
async fn guest_auth_fetch() -> Result<AuthResponse, String> {
    use gloo_net::http::Request;

    // Browser sends same-origin cookies by default on POST; the axum
    // /api/auth/refresh route relies on this for httpOnly-cookie reads.
    let resp = Request::post("/api/auth/guest")
        .header("Content-Type", "application/json")
        .send()
        .await
        .map_err(|e| format!("network error: {e}"))?;

    if !resp.ok() {
        return Err(format!(
            "auth server returned {} {}",
            resp.status(),
            resp.status_text()
        ));
    }

    resp.json::<AuthResponse>()
        .await
        .map_err(|e| format!("parse json: {e}"))
}
