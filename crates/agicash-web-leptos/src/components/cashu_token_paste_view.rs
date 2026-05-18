//! `CashuTokenPasteView` — paste-a-Cashu-token receive flow.
//!
//! Ports the iOS `CashuTokenPasteView` (see
//! `ios/Agicash/Agicash/CashuTokenPasteView.swift`) to Leptos 0.7. Same
//! state machine, same visual chrome (card on a centered column, "Paste"
//! affordance on the field label, inline destructive error line under the
//! textarea, primary "Receive" button at the bottom).
//!
//! Phase 1 partial behaviour:
//!   - The textarea + `Preview` button parse the token client-side using
//!     `cdk::nuts::Token::from_str` (wasm-clean — no network).
//!   - The `Receive` button is MOCKED: it spawns a 1.5s sleep on wasm
//!     (`gloo_timers::future::TimeoutFuture`) and then transitions to
//!     the success card. Slice 12 will replace the sleep with a real
//!     `WalletClient::receive_cashu_token` call — see the
//!     `// TODO[slice-12]` markers below.
//!   - "Mint already added?" is mocked against a hard-coded list of
//!     well-known mints (`KNOWN_MINTS`). When the user pastes a token
//!     from an unknown mint we surface an "Add mint first?" CTA that
//!     navigates to `/accounts/add-mint` (route not yet implemented;
//!     L2/another slice owns it).

// The view body is long but linear; splitting into private sub-components
// would just add indirection without reuse benefit.
#![allow(clippy::too_many_lines)]

use std::str::FromStr;

use cdk::nuts::{CurrencyUnit, Token};
use leptos::prelude::*;
use leptos::task::spawn_local;
use leptos_router::hooks::use_navigate;

use crate::tokens;

/// Well-known mints we consider "already added" for the mocked preview.
/// Real check needs `WalletClient::list_accounts()` from slice 12.
//
// TODO[slice-12]: replace with `WalletClient::accounts()` lookup so the
// CTA reflects the actual user account list rather than a hard-coded
// allowlist.
const KNOWN_MINTS: &[&str] = &[
    "https://nofees.testnut.cashu.space",
    "https://mint.minibits.cash/Bitcoin",
    "https://testnut.cashu.space",
];

/// Parsed token preview — what we render between "user pasted + clicked
/// Preview" and "user clicked Receive". All fields are cheap derivations
/// of `cdk::nuts::Token`; we don't keep the `Token` itself in state
/// because the cdk type isn't `Clone` on every variant we care about.
#[derive(Clone, Debug)]
struct TokenPreview {
    /// Original encoded token string. Held so slice 12 can pass it
    /// straight into `WalletClient::receive_cashu_token(&preview.raw)`
    /// without re-asking the user to paste. Read-after-write only there;
    /// the preview/success cards render derived fields below.
    //
    // TODO[slice-12]: read by the real receive call.
    #[allow(dead_code)]
    raw: String,
    amount: u64,
    unit: String,
    mint_url: String,
    memo: Option<String>,
    /// True iff `mint_url` is in `KNOWN_MINTS`. Mocked; see slice-12 TODO.
    mint_known: bool,
}

/// Result rendered on the success card after a (mocked) redeem completes.
#[derive(Clone, Debug)]
struct ReceiveResult {
    amount: u64,
    unit: String,
    mint_url: String,
}

/// View state machine. Matches iOS `Phase` 1:1 with a `Preview` sub-state
/// inserted between `Entry` and `Working` (the iOS view skips Preview and
/// jumps straight from paste → Working because it has carousel-level
/// chrome that gives a continuous "receive" affordance; the web flow
/// needs an explicit Preview so the user sees what they're about to
/// claim before committing).
#[derive(Clone, Debug)]
enum Phase {
    /// User is editing the textarea. No preview yet.
    Entry,
    /// Token parsed successfully — preview card visible, Receive button
    /// armed.
    Preview(TokenPreview),
    /// Receive in flight — spinner on the button, fields locked.
    Working(TokenPreview),
    /// Redeem complete — success card with amount + mint url + Done.
    Success(ReceiveResult),
    /// Parse error or (eventually) redeem error. Shown inline under the
    /// textarea; user can edit and retry without dismissing.
    Error(String),
}

#[component]
pub fn CashuTokenPasteView() -> impl IntoView {
    let navigate = use_navigate();

    let token_text = RwSignal::new(String::new());
    let phase: RwSignal<Phase> = RwSignal::new(Phase::Entry);

    // ---- Handlers ---------------------------------------------------------

    let on_preview = move |_ev| {
        let raw = token_text.get().trim().to_string();
        if raw.is_empty() {
            phase.set(Phase::Error("Paste a Cashu token first.".into()));
            return;
        }
        match parse_token(&raw) {
            Ok(preview) => phase.set(Phase::Preview(preview)),
            Err(msg) => phase.set(Phase::Error(msg)),
        }
    };

    // Reset preview/error when the user edits the textarea so they don't
    // see a stale preview matching a previous paste.
    let on_token_input = move |ev: leptos::ev::Event| {
        let value = event_target_value(&ev);
        token_text.set(value);
        // If we were showing a Preview / Success / Error, drop back to
        // Entry so the user can re-trigger Preview deliberately.
        match phase.get() {
            Phase::Preview(_) | Phase::Error(_) | Phase::Success(_) => {
                phase.set(Phase::Entry);
            }
            // Don't yank the user out of an in-flight Working state.
            Phase::Entry | Phase::Working(_) => {}
        }
    };

    let on_blur = move |_ev| {
        // Mirror iOS UX: parse on blur as well so the user sees the
        // preview even if they don't click the explicit Preview button.
        // Only run if we're still in Entry and the field has content.
        if !matches!(phase.get(), Phase::Entry) {
            return;
        }
        let raw = token_text.get().trim().to_string();
        if raw.is_empty() {
            return;
        }
        match parse_token(&raw) {
            Ok(preview) => phase.set(Phase::Preview(preview)),
            Err(msg) => phase.set(Phase::Error(msg)),
        }
    };

    let on_receive = move |_ev| {
        // Snapshot the preview so we can route to Success regardless of
        // what the user types during the mocked delay.
        let Phase::Preview(preview) = phase.get() else {
            return;
        };
        phase.set(Phase::Working(preview.clone()));

        spawn_local(async move {
            // TODO[slice-12]: replace the simulated delay below with a
            // real `WalletClient::receive_cashu_token(&preview.raw)`
            // call. The success and error branches will map to the
            // existing `Phase::Success` / `Phase::Error` transitions.
            #[cfg(feature = "hydrate")]
            {
                gloo_timers::future::TimeoutFuture::new(1500).await;
            }
            // SSR path: there's no browser to spin; transition synchronously
            // so the type-checker is happy. This branch never executes in
            // practice because Routes don't render to interactive HTML on
            // first paint in our SSR setup — but cargo still has to
            // compile it.
            phase.set(Phase::Success(ReceiveResult {
                amount: preview.amount,
                unit: preview.unit.clone(),
                mint_url: preview.mint_url.clone(),
            }));
        });
    };

    let on_done = {
        let navigate = navigate.clone();
        move |_ev| {
            navigate("/", leptos_router::NavigateOptions::default());
        }
    };

    let on_add_mint = {
        let navigate = navigate.clone();
        move |_ev| {
            // TODO[slice-12]: real route exists once the accounts UI
            // lands. For now this is a placeholder so the CTA goes
            // somewhere intentional rather than no-op'ing.
            navigate(
                "/accounts/add-mint",
                leptos_router::NavigateOptions::default(),
            );
        }
    };

    // ---- Styles -----------------------------------------------------------
    // Mirror the page chrome from LoginView (centered column, single card
    // capped at CARD_MAX_WIDTH) and the FormCard chrome from the iOS
    // `CashuTokenPasteView` (Spacing.xxl padding, brandCard border).

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

    let header_style = format!(
        "width:100%; max-width:{}; display:flex; \
         align-items:center; justify-content:space-between; \
         margin-bottom:{};",
        tokens::CARD_MAX_WIDTH,
        tokens::SPACE_L,
    );

    let back_link_style = format!(
        "font-size:{}; color:{}; text-decoration:none; cursor:pointer;",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    );

    let header_title_style = format!(
        "font-size:{}; font-weight:600; margin:0; color:{};",
        tokens::TEXT_LG,
        tokens::COLOR_FOREGROUND,
    );

    view! {
        <div style=page_style>
            <div style=header_style>
                <a href="/" style=back_link_style>"← Back"</a>
                <h1 style=header_title_style>"Receive"</h1>
                // Spacer for symmetry with the back link.
                <span style="width:48px;"/>
            </div>

            {move || match phase.get() {
                Phase::Entry | Phase::Error(_) => view! {
                    <FormCard
                        token_text=token_text
                        is_working=false
                        error_message=if let Phase::Error(m) = phase.get() { Some(m) } else { None }
                        on_token_input=on_token_input
                        on_blur=on_blur
                        on_preview=on_preview
                    />
                }.into_any(),
                Phase::Preview(preview) => view! {
                    <PreviewCard
                        preview=preview
                        is_working=false
                        on_receive=on_receive
                        on_add_mint=on_add_mint.clone()
                    />
                }.into_any(),
                Phase::Working(preview) => view! {
                    <PreviewCard
                        preview=preview
                        is_working=true
                        on_receive=on_receive
                        on_add_mint=on_add_mint.clone()
                    />
                }.into_any(),
                Phase::Success(result) => view! {
                    <SuccessCard
                        result=result
                        on_done=on_done.clone()
                    />
                }.into_any(),
            }}
        </div>
    }
}

// ---- Sub-components -------------------------------------------------------

/// Paste-token form card. Mirrors iOS `FormCard` (private struct inside
/// `CashuTokenPasteView.swift`).
#[component]
fn FormCard<O, B, P>(
    token_text: RwSignal<String>,
    is_working: bool,
    error_message: Option<String>,
    on_token_input: O,
    on_blur: B,
    on_preview: P,
) -> impl IntoView
where
    O: Fn(leptos::ev::Event) + 'static,
    B: Fn(leptos::ev::FocusEvent) + 'static,
    P: Fn(leptos::ev::MouseEvent) + 'static,
{
    let card_style = card_style();
    let label_row_style =
        "display:flex; align-items:center; justify-content:space-between;".to_string();
    let label_style = format!(
        "font-size:{}; font-weight:600; color:{};",
        tokens::TEXT_SM,
        tokens::COLOR_CARD_FOREGROUND,
    );
    let textarea_style = format!(
        "width:100%; min-height:96px; max-height:200px; resize:vertical; \
         padding:{}; border:1px solid {}; border-radius:{}; \
         font-family:{}; font-size:{}; color:{}; background:{}; \
         box-sizing:border-box;",
        tokens::SPACE_S,
        tokens::COLOR_BORDER,
        tokens::RADIUS_MD,
        tokens::FONT_PRIMARY,
        tokens::TEXT_SM,
        tokens::COLOR_FOREGROUND,
        tokens::COLOR_BACKGROUND,
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
    let error_style = format!(
        "color:{}; font-size:{}; margin:0;",
        tokens::COLOR_DESTRUCTIVE,
        tokens::TEXT_SM,
    );

    view! {
        <div style=card_style>
            <div>
                <h2 style=title_style>"Receive Cashu"</h2>
                <p style=description_style>
                    "Paste a Cashu token to claim it into your wallet"
                </p>
            </div>

            <div style="display:flex; flex-direction:column; gap:8px;">
                <div style=label_row_style>
                    <span style=label_style>"Token"</span>
                </div>
                <textarea
                    style=textarea_style
                    prop:value=move || token_text.get()
                    placeholder="cashuA... or cashuB..."
                    autocapitalize="none"
                    spellcheck="false"
                    disabled=is_working
                    on:input=on_token_input
                    on:blur=on_blur
                />
            </div>

            {error_message.map(|msg| view! {
                <p style=error_style>{msg}</p>
            })}

            <button
                style=button_style(ButtonVariant::Primary)
                disabled=move || is_working || token_text.get().trim().is_empty()
                on:click=on_preview
            >
                "Preview"
            </button>
        </div>
    }
}

/// Preview card shown after the token is parsed. Renders amount + mint
/// URL + memo and an "Add mint first?" CTA when the mint isn't in the
/// (mocked) known-mints list. Reuses the same card chrome as `FormCard`.
#[component]
fn PreviewCard<R, A>(
    preview: TokenPreview,
    is_working: bool,
    on_receive: R,
    on_add_mint: A,
) -> impl IntoView
where
    R: Fn(leptos::ev::MouseEvent) + 'static,
    A: Fn(leptos::ev::MouseEvent) + 'static,
{
    let card_style = card_style();
    let title_style = format!(
        "font-size:{}; font-weight:600; margin:0; color:{};",
        tokens::TEXT_2XL,
        tokens::COLOR_CARD_FOREGROUND,
    );
    let amount_row_style =
        "display:flex; align-items:baseline; justify-content:center; gap:6px;".to_string();
    let amount_style = format!(
        "font-family:{}; font-size:48px; font-weight:600; color:{}; \
         line-height:1; font-variant-numeric:tabular-nums;",
        tokens::FONT_NUMERIC,
        tokens::COLOR_CARD_FOREGROUND,
    );
    let unit_style = format!(
        "font-size:{}; color:{};",
        tokens::TEXT_BASE,
        tokens::COLOR_MUTED_FOREGROUND,
    );
    let meta_label_style = format!(
        "font-size:{}; font-weight:600; color:{}; margin:0;",
        tokens::TEXT_SM,
        tokens::COLOR_CARD_FOREGROUND,
    );
    let meta_value_style = format!(
        "font-size:{}; color:{}; margin:0; overflow-wrap:anywhere;",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    );
    let unknown_mint_style = format!(
        "color:{}; font-size:{}; margin:0;",
        tokens::COLOR_DESTRUCTIVE,
        tokens::TEXT_SM,
    );

    let amount = preview.amount;
    let unit = preview.unit.clone();
    let mint_url = preview.mint_url.clone();
    let memo = preview.memo.clone();
    let mint_known = preview.mint_known;

    view! {
        <div style=card_style>
            <h2 style=title_style>"Preview"</h2>

            <div style=amount_row_style>
                <span style=amount_style>{format_amount(amount)}</span>
                <span style=unit_style>{unit}</span>
            </div>

            <div style="display:flex; flex-direction:column; gap:4px;">
                <p style=meta_label_style.clone()>"Mint"</p>
                <p style=meta_value_style.clone()>{mint_url}</p>
            </div>

            {memo.map(|m| view! {
                <div style="display:flex; flex-direction:column; gap:4px;">
                    <p style=meta_label_style.clone()>"Memo"</p>
                    <p style=meta_value_style.clone()>{m}</p>
                </div>
            })}

            {(!mint_known).then(|| view! {
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <p style=unknown_mint_style>
                        "This mint isn't in your wallet yet."
                    </p>
                    <button
                        style=button_style(ButtonVariant::Ghost)
                        on:click=on_add_mint
                    >
                        "Add mint first?"
                    </button>
                </div>
            })}

            <button
                style=button_style(ButtonVariant::Primary)
                disabled=is_working
                on:click=on_receive
            >
                {move || if is_working { "Receiving..." } else { "Receive" }}
            </button>
        </div>
    }
}

/// Success card shown after a (mocked) redeem completes. Mirrors iOS
/// `SuccessCard`.
#[component]
fn SuccessCard<D>(result: ReceiveResult, on_done: D) -> impl IntoView
where
    D: Fn(leptos::ev::MouseEvent) + 'static,
{
    let card_style = card_style();
    let title_style = format!(
        "font-size:{}; font-weight:600; margin:0; color:{};",
        tokens::TEXT_2XL,
        tokens::COLOR_CARD_FOREGROUND,
    );
    let subhead_style = format!(
        "font-size:{}; margin:0 0 {} 0; color:{};",
        tokens::TEXT_SM,
        tokens::SPACE_S,
        tokens::COLOR_MUTED_FOREGROUND,
    );
    let amount_row_style = "display:flex; align-items:baseline; \
         justify-content:center; gap:6px;"
        .to_string();
    let amount_style = format!(
        "font-family:{}; font-size:48px; font-weight:600; color:{}; \
         line-height:1; font-variant-numeric:tabular-nums;",
        tokens::FONT_NUMERIC,
        tokens::COLOR_CARD_FOREGROUND,
    );
    let unit_style = format!(
        "font-size:{}; color:{};",
        tokens::TEXT_BASE,
        tokens::COLOR_MUTED_FOREGROUND,
    );
    let mint_style = format!(
        "font-size:{}; color:{}; margin:0; text-align:center; \
         overflow-wrap:anywhere;",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=card_style>
            <div>
                <h2 style=title_style>"Token received"</h2>
                <p style=subhead_style>"Proofs added to your wallet."</p>
            </div>

            <div style="display:flex; flex-direction:column; align-items:center; gap:8px;">
                <div style=amount_row_style>
                    <span style=amount_style>{format_amount(result.amount)}</span>
                    <span style=unit_style>{result.unit}</span>
                </div>
                <p style=mint_style>{result.mint_url}</p>
            </div>

            <button
                style=button_style(ButtonVariant::Primary)
                on:click=on_done
            >
                "Done"
            </button>
        </div>
    }
}

// ---- Helpers --------------------------------------------------------------

/// Parse a raw Cashu token string into the preview view-model. Pure
/// (no network): only uses `cdk::nuts::Token::from_str` +
/// `.value() / .mint_url() / .unit() / .memo()` which the cdk types
/// derive from the encoded payload itself.
fn parse_token(raw: &str) -> Result<TokenPreview, String> {
    let token = Token::from_str(raw).map_err(|e| format!("Invalid token: {e}"))?;
    let mint_url = token
        .mint_url()
        .map_err(|e| format!("Token is missing a mint URL: {e}"))?
        .to_string();
    let unit_label = unit_label(token.unit());
    let amount = token
        .value()
        .map_err(|e| format!("Could not compute token amount: {e}"))?;
    let memo = token.memo().clone();
    let mint_known = is_known_mint(&mint_url);
    Ok(TokenPreview {
        raw: raw.to_string(),
        amount: amount.into(),
        unit: unit_label,
        mint_url,
        memo,
        mint_known,
    })
}

fn unit_label(unit: Option<CurrencyUnit>) -> String {
    match unit {
        Some(CurrencyUnit::Sat) => "sats".to_string(),
        Some(CurrencyUnit::Msat) => "msats".to_string(),
        Some(CurrencyUnit::Usd) => "USD".to_string(),
        Some(CurrencyUnit::Eur) => "EUR".to_string(),
        Some(other) => other.to_string(),
        // Missing unit isn't fatal — cdk treats it as "unknown unit".
        // We render an empty label rather than a placeholder so the
        // amount stays the focal point.
        None => String::new(),
    }
}

fn is_known_mint(mint_url: &str) -> bool {
    // Trim trailing slash for the comparison so
    // "https://mint.example.com" and "https://mint.example.com/" both
    // match the same allowlist entry.
    let needle = mint_url.trim_end_matches('/');
    KNOWN_MINTS
        .iter()
        .any(|known| known.trim_end_matches('/') == needle)
}

/// Format an integer amount with `_` thousand separators so a 100,000
/// sat token doesn't read as a wall of digits.
fn format_amount(amount: u64) -> String {
    let digits: Vec<char> = amount.to_string().chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(*c);
    }
    out
}

// ---- Shared card / button styles ------------------------------------------
// Lifted from `components/login_view.rs`. When L3 lands its reusable
// Card/Button primitives (`feat/leptos-components` branch) replace these
// helpers with the L3 components.
//
// TODO: replace with L3 <Card> / <Button> when the L3 branch lands.

fn card_style() -> String {
    format!(
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
    )
}

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

// ---- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{is_known_mint, parse_token, KNOWN_MINTS};

    /// V3 token (cashuA) fixture copied from `cashu-0.15.1` upstream
    /// tests. 2+8 = 10 sat at <https://8333.space:3338>, memo "Thank you
    /// very much.". Verifies the pure-parse path doesn't need any
    /// network calls — exactly what makes the wasm preview viable.
    const V3_TOKEN_FIXTURE: &str = "cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vODMzMy5zcGFjZTozMzM4IiwicHJvb2ZzIjpbeyJhbW91bnQiOjIsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6IjQwNzkxNWJjMjEyYmU2MWE3N2UzZTZkMmFlYjRjNzI3OTgwYmRhNTFjZDA2YTZhZmMyOWUyODYxNzY4YTc4MzciLCJDIjoiMDJiYzkwOTc5OTdkODFhZmIyY2M3MzQ2YjVlNDM0NWE5MzQ2YmQyYTUwNmViNzk1ODU5OGE3MmYwY2Y4NTE2M2VhIn0seyJhbW91bnQiOjgsImlkIjoiMDA5YTFmMjkzMjUzZTQxZSIsInNlY3JldCI6ImZlMTUxMDkzMTRlNjFkNzc1NmIwZjhlZTBmMjNhNjI0YWNhYTNmNGUwNDJmNjE0MzNjNzI4YzcwNTdiOTMxYmUiLCJDIjoiMDI5ZThlNTA1MGI4OTBhN2Q2YzA5NjhkYjE2YmMxZDVkNWZhMDQwZWExZGUyODRmNmVjNjlkNjEyOTlmNjcxMDU5In1dfV0sInVuaXQiOiJzYXQiLCJtZW1vIjoiVGhhbmsgeW91IHZlcnkgbXVjaC4ifQ==";

    #[test]
    fn parses_v3_token_fixture() {
        let preview = parse_token(V3_TOKEN_FIXTURE).expect("token parses");
        assert_eq!(preview.amount, 10, "2+8 sat fixture");
        assert_eq!(preview.unit, "sats");
        assert_eq!(preview.mint_url, "https://8333.space:3338");
        assert_eq!(preview.memo.as_deref(), Some("Thank you very much."));
        // Mint isn't in our hard-coded test list, so the unknown-mint
        // CTA should be active.
        assert!(!preview.mint_known);
    }

    #[test]
    fn rejects_garbage_string() {
        let err = parse_token("not-a-token").expect_err("garbage rejected");
        // The exact message comes from cdk; we only care that it surfaces.
        assert!(
            err.contains("Invalid token") || err.contains("decode"),
            "unexpected message: {err}",
        );
    }

    #[test]
    fn rejects_empty_string() {
        let err = parse_token("").expect_err("empty rejected");
        assert!(!err.is_empty());
    }

    #[test]
    fn known_mint_matches_with_trailing_slash() {
        // The known-mints list entries don't have trailing slashes; the
        // comparison must normalize so user-pasted URLs match.
        for known in KNOWN_MINTS {
            let with_slash = format!("{known}/");
            assert!(
                is_known_mint(&with_slash),
                "{with_slash} should match {known}",
            );
        }
    }

    #[test]
    fn unknown_mint_returns_false() {
        assert!(!is_known_mint("https://example.com"));
    }
}
