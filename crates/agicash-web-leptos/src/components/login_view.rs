//! `LoginView` — login + signup chooser, ported from iOS `LoginView`.
//!
//! ## Modes
//!
//! - **Login (default).** Email + password fields, primary button
//!   "Log in", calls `agicash_auth_opensecret::login_email`.
//! - **Signup.** Toggled from the "Sign up" link at the bottom of the
//!   login card. Same fields, primary button reads "Create account",
//!   calls `agicash_auth_opensecret::register_email`. A "Back to login"
//!   link swaps back.
//! - **Guest.** "Continue as guest" ghost button at the bottom of both
//!   modes; calls `agicash_auth_opensecret::register_guest`. Threat
//!   model: any client of the running browser can recover the guest's
//!   refresh token from `localStorage` — accepted per the legacy React
//!   convention.
//!
//! All three auth flows funnel through the same post-success path:
//! persist a `PersistedSession` via [`BrowserSessionStorage`] (so a
//! page reload can rehydrate the user), set the in-memory `AccessToken`
//! signal, and `navigate("/")`.
//!
//! ## Config
//!
//! Endpoint URLs + `client_id` are read from the [`AppConfig`] context
//! (provided in `app.rs`, sourced from `<meta>` tags in `index.html`).
//! No more hardcoded dev URLs.

// The `LoginView` component renders a long view block in Leptos's IntoView
// idiom; splitting it would just add indirection for indirection's sake.
#![allow(clippy::too_many_lines)]

use leptos::ev;
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::hooks::use_navigate;

use crate::app::AccessToken;
use crate::config::AppConfig;
use crate::tokens;

/// Output of a successful auth call. Only the `access_token` gets
/// propagated to the `AccessToken` signal; `user_id` is kept for future
/// plumbing (analytics, settings page) and currently unread on the
/// native `rlib` build.
#[allow(dead_code)]
#[derive(Debug, Clone)]
struct AuthResponse {
    access_token: String,
    user_id: String,
}

/// Which auth mode the form is currently in. Toggled by the
/// "Sign up" / "Back to login" link.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AuthMode {
    Login,
    Signup,
}

impl AuthMode {
    const fn title(self) -> &'static str {
        match self {
            Self::Login => "Login",
            Self::Signup => "Create account",
        }
    }

    const fn description(self) -> &'static str {
        match self {
            Self::Login => "Sign in to your Agicash account",
            Self::Signup => "Sign up for a new Agicash account",
        }
    }

    const fn primary_label(self) -> &'static str {
        match self {
            Self::Login => "Log in",
            Self::Signup => "Create account",
        }
    }

    const fn working_label(self) -> &'static str {
        match self {
            Self::Login => "Logging in...",
            Self::Signup => "Creating...",
        }
    }

    const fn toggle_prompt(self) -> &'static str {
        match self {
            Self::Login => "Don't have an account? ",
            Self::Signup => "Already have an account? ",
        }
    }

    const fn toggle_label(self) -> &'static str {
        match self {
            Self::Login => "Sign up",
            Self::Signup => "Back to login",
        }
    }

    const fn flipped(self) -> Self {
        match self {
            Self::Login => Self::Signup,
            Self::Signup => Self::Login,
        }
    }
}

#[component]
pub fn LoginView() -> impl IntoView {
    let AccessToken(token) = expect_context::<AccessToken>();
    let config = expect_context::<AppConfig>();
    let navigate = use_navigate();

    let mode = RwSignal::new(AuthMode::Login);
    let email = RwSignal::new(String::new());
    let password = RwSignal::new(String::new());
    let is_working = RwSignal::new(false);
    let error_message: RwSignal<Option<String>> = RwSignal::new(None);

    // ---- Email/signup auth handler ----------------------------------------
    // Pressing the primary button (or hitting Enter in either field)
    // calls this with the current mode.
    let on_submit = {
        let navigate = navigate.clone();
        let config = config.clone();
        move || {
            if is_working.get() {
                return;
            }
            let email_value = email.get_untracked();
            let password_value = password.get_untracked();
            let current_mode = mode.get_untracked();

            // Surface validation errors locally so the user gets fast
            // feedback (the opensecret call would also reject these,
            // but the round-trip is wasted work).
            if email_value.trim().is_empty() {
                error_message.set(Some("Email is required.".to_string()));
                return;
            }
            if password_value.is_empty() {
                error_message.set(Some("Password is required.".to_string()));
                return;
            }

            is_working.set(true);
            error_message.set(None);
            let navigate = navigate.clone();
            let config = config.clone();
            spawn_local(async move {
                #[cfg(target_arch = "wasm32")]
                {
                    let result = email_auth_fetch(
                        &config,
                        email_value.trim().to_string(),
                        password_value,
                        current_mode,
                    )
                    .await;
                    match result {
                        Ok(resp) => {
                            token.set(Some(resp.access_token));
                            navigate("/", leptos_router::NavigateOptions::default());
                        }
                        Err(msg) => {
                            error_message.set(Some(msg));
                        }
                    }
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    // Native build: touch the captured values so they
                    // don't appear unused (rlib is for unit tests).
                    let _ = (
                        &token,
                        &navigate,
                        &config,
                        &email_value,
                        &password_value,
                        &current_mode,
                    );
                }
                is_working.set(false);
            });
        }
    };

    // ---- Guest auth handler -----------------------------------------------
    let on_guest = {
        let navigate = navigate.clone();
        let config = config.clone();
        move |_ev| {
            if is_working.get() {
                return;
            }
            is_working.set(true);
            error_message.set(None);
            let navigate = navigate.clone();
            let config = config.clone();
            spawn_local(async move {
                #[cfg(target_arch = "wasm32")]
                {
                    match guest_auth_fetch(&config).await {
                        Ok(resp) => {
                            token.set(Some(resp.access_token));
                            navigate("/", leptos_router::NavigateOptions::default());
                        }
                        Err(msg) => {
                            error_message.set(Some(msg));
                        }
                    }
                }
                #[cfg(not(target_arch = "wasm32"))]
                {
                    let _ = (&token, &navigate, &config);
                }
                is_working.set(false);
            });
        }
    };

    let on_primary = {
        let on_submit = on_submit.clone();
        move |_ev: ev::MouseEvent| on_submit()
    };

    let on_form_submit = {
        let on_submit = on_submit.clone();
        move |ev: ev::SubmitEvent| {
            ev.prevent_default();
            on_submit();
        }
    };

    let on_toggle_mode = move |ev: ev::MouseEvent| {
        ev.prevent_default();
        mode.update(|m| *m = m.flipped());
        error_message.set(None);
    };

    // ---- Styles ------------------------------------------------------------
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

    let input_style = format!(
        "display:block; width:100%; box-sizing:border-box; \
         height:40px; padding:0 {pad}; border-radius:{radius}; \
         font-size:{text}; font-family:inherit; \
         background:{bg}; color:{fg}; border:1px solid {border};",
        pad = tokens::SPACE_M,
        radius = tokens::RADIUS_MD,
        text = tokens::TEXT_SM,
        bg = tokens::COLOR_BACKGROUND,
        fg = tokens::COLOR_FOREGROUND,
        border = tokens::COLOR_BORDER,
    );

    let label_style = format!(
        "display:block; font-size:{}; font-weight:500; \
         margin-bottom:{}; color:{};",
        tokens::TEXT_SM,
        tokens::SPACE_XS,
        tokens::COLOR_CARD_FOREGROUND,
    );

    let divider_style = format!(
        "display:flex; align-items:center; gap:{gap}; \
         font-size:{text}; color:{c}; margin:{m} 0;",
        gap = tokens::SPACE_S,
        text = tokens::TEXT_SM,
        c = tokens::COLOR_MUTED_FOREGROUND,
        m = tokens::SPACE_XS,
    );

    let divider_line_style = format!("flex:1; height:1px; background:{};", tokens::COLOR_BORDER);

    view! {
        <div style=page_style>
            <div style=logo_style aria-label="Agicash">"agicash"</div>

            <div style=card_style>
                <div>
                    <h1 style=title_style>{move || mode.get().title()}</h1>
                    <p style=description_style>{move || mode.get().description()}</p>
                </div>

                <form on:submit=on_form_submit style="display:flex; flex-direction:column; gap:12px;">
                    <div>
                        <label for="login-email" style=label_style.clone()>"Email"</label>
                        <input
                            id="login-email"
                            type="email"
                            autocomplete="email"
                            autocapitalize="none"
                            spellcheck="false"
                            inputmode="email"
                            placeholder="you@example.com"
                            style=input_style.clone()
                            prop:value=move || email.get()
                            on:input=move |ev| email.set(event_target_value(&ev))
                            disabled=move || is_working.get()
                        />
                    </div>
                    <div>
                        <label for="login-password" style=label_style>"Password"</label>
                        <input
                            id="login-password"
                            type="password"
                            autocomplete=move || if mode.get() == AuthMode::Signup { "new-password" } else { "current-password" }
                            placeholder="Password"
                            style=input_style
                            prop:value=move || password.get()
                            on:input=move |ev| password.set(event_target_value(&ev))
                            disabled=move || is_working.get()
                        />
                    </div>

                    <button
                        type="submit"
                        style=button_style(ButtonVariant::Primary)
                        disabled=move || is_working.get()
                        on:click=on_primary
                    >
                        {move || if is_working.get() {
                            mode.get().working_label()
                        } else {
                            mode.get().primary_label()
                        }}
                    </button>
                </form>

                <div style=divider_style>
                    <div style=divider_line_style.clone()></div>
                    <span>"or"</span>
                    <div style=divider_line_style></div>
                </div>

                <button
                    type="button"
                    style=button_style(ButtonVariant::Ghost)
                    disabled=move || is_working.get()
                    on:click=on_guest
                >
                    {move || if is_working.get() { "Working..." } else { "Continue as guest" }}
                </button>

                // Inline error / notice line.
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
                    <span>{move || mode.get().toggle_prompt()}</span>
                    <a
                        href="#"
                        style=format!(
                            "color:{}; text-decoration:underline; cursor:pointer;",
                            tokens::COLOR_CARD_FOREGROUND,
                        )
                        on:click=on_toggle_mode
                    >
                        {move || mode.get().toggle_label()}
                    </a>
                </div>
            </div>
        </div>
    }
}

// ---- Button style helper --------------------------------------------------

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

// ---- Browser-side auth fetches ----------------------------------------

#[cfg(target_arch = "wasm32")]
fn build_client(config: &AppConfig) -> Result<agicash_auth_opensecret::OpenSecretClient, String> {
    use agicash_auth_opensecret::{OpenSecretClient, OpenSecretConfig};
    let cfg = OpenSecretConfig {
        base_url: config.opensecret_base_url.clone(),
        client_id: config.opensecret_client_id,
    };
    OpenSecretClient::new(cfg).map_err(|e| format!("build opensecret client: {e}"))
}

/// Persist the refresh token to localStorage and return the user-
/// visible bits for the in-memory `AccessToken` signal. Taking the
/// three primitives instead of the SDK's `LoginResponse` keeps this
/// crate independent of the `opensecret` SDK as a direct dep — the
/// `agicash-auth-opensecret` re-exports cover everything we need.
#[cfg(target_arch = "wasm32")]
async fn persist_session_and_extract(
    user_id: uuid::Uuid,
    access_token: String,
    refresh_token: String,
) -> Result<AuthResponse, String> {
    use agicash_auth_opensecret::BrowserSessionStorage;
    use agicash_traits::{PersistedSession, SessionStorage};

    let persisted = PersistedSession {
        user_id,
        refresh_token,
    };
    BrowserSessionStorage::new()
        .store(&persisted)
        .await
        .map_err(|e| format!("session persist failed: {e}"))?;

    Ok(AuthResponse {
        access_token,
        user_id: user_id.to_string(),
    })
}

#[cfg(target_arch = "wasm32")]
async fn email_auth_fetch(
    config: &AppConfig,
    email: String,
    password: String,
    mode: AuthMode,
) -> Result<AuthResponse, String> {
    use agicash_auth_opensecret::{login_email, register_email};

    let client = build_client(config)?;
    let response = match mode {
        AuthMode::Login => login_email(&client, email, password, client.client_id())
            .await
            .map_err(|e| format!("login failed: {e}"))?,
        AuthMode::Signup => register_email(&client, email, password, client.client_id(), None)
            .await
            .map_err(|e| format!("signup failed: {e}"))?,
    };
    persist_session_and_extract(response.id, response.access_token, response.refresh_token).await
}

#[cfg(target_arch = "wasm32")]
async fn guest_auth_fetch(config: &AppConfig) -> Result<AuthResponse, String> {
    use agicash_auth_opensecret::register_guest;

    let client = build_client(config)?;
    let password = random_password_browser();
    let response = register_guest(&client, password, client.client_id())
        .await
        .map_err(|e| format!("guest registration failed: {e}"))?;
    persist_session_and_extract(response.id, response.access_token, response.refresh_token).await
}

/// Throwaway 32-char hex password for guest registration. The enclave
/// hashes it; we never need to recover it. Sourced from `getrandom`
/// (wasm-compatible via the `js` feature on the workspace dep).
#[cfg(target_arch = "wasm32")]
fn random_password_browser() -> String {
    use std::fmt::Write;
    let mut buf = [0u8; 16];
    // Best-effort: if `getrandom` fails the downstream opensecret call
    // will also fail and the user sees a comprehensible error in the UI.
    let _ = getrandom::getrandom(&mut buf);
    let mut out = String::with_capacity(buf.len() * 2);
    for b in buf {
        // Writing to String never fails; the `_ =` documents that.
        let _ = write!(out, "{b:02x}");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn auth_mode_flips() {
        assert_eq!(AuthMode::Login.flipped(), AuthMode::Signup);
        assert_eq!(AuthMode::Signup.flipped(), AuthMode::Login);
    }

    #[test]
    fn auth_mode_labels_distinct() {
        assert_ne!(
            AuthMode::Login.primary_label(),
            AuthMode::Signup.primary_label()
        );
        assert_ne!(
            AuthMode::Login.toggle_label(),
            AuthMode::Signup.toggle_label()
        );
    }
}
