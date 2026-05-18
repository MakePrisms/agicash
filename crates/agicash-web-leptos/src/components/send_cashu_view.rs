//! `SendCashuView` — Cashu token send flow (the only real surface in the
//! Send carousel for v0).
//!
//! Mirrors iOS `SendCashuTokenView` (`ios/Agicash/Agicash/SendCashuTokenView.swift`)
//! 1:1 in shape:
//!
//! ```text
//!   amountEntry   → numpad + Continue
//!     ↓ startQuote() (mocked)
//!   quoting       → spinner ("Preparing send…")
//!     ↓ on success
//!   confirming    → fee + total card, Confirm button
//!     ↓ commitSend() (mocked)
//!   swapping      → spinner ("Producing token…")
//!     ↓ on success
//!   share         → token + copy + share sheet, polling claim every 3s
//!     ↓ poll returns .completed (mocked timer)
//!   claimed       → "Sent" check + Done
//!     ↓ (or .failed / catch-all)
//!   failure       → error + Retry
//! ```
//!
//! ## SDK boundary
//!
//! `agicash-cashu::send_swap::*` is **not wasm-clean** today because its
//! storage trait pulls in `agicash-storage-supabase` which depends on
//! `rustls` / `tokio-net` / `ring`. Porting it is a multi-day effort
//! tracked separately as
//! `docs/superpowers/specs/2026-05-17-storage-supabase-wasm-port-design.md`
//! (sibling of the same blocker `feat/leptos-email-and-balance` hit when
//! it shipped the home page with a direct Supabase REST account fetch).
//!
//! So this view ships with the **SDK boundary mocked**:
//!   - `mock_prepare_send` returns a synthetic quote (1% sender fee, 0
//!     receive fee — same shape the real `CashuSendSwapService.get_quote`
//!     emits for sender-pays-fee mode).
//!   - `mock_commit_send` returns a synthetic V4-ish token handle after a
//!     1.5 s delay (matches the receive-flow's mock cadence). The token
//!     is a deterministic-but-fake `cashuB...` string so we can render
//!     truncation + copy + share UI; pasting it into a real receiver
//!     will fail (no real mint output).
//!   - `mock_poll_claim` flips to `.completed` after ~9 s on the share
//!     screen (three poll ticks at 3 s cadence) so the demo flow exits
//!     to the claimed state without operator intervention.
//!
//! Each mock site carries a `// TODO[slice-13]` marker pointing at the
//! real call to swap in once the wasm port lands. The view geometry,
//! state machine, and UX timings are real — only the network round-trips
//! are synthetic.
//!
//! ## Constraints
//!
//! - **No view-transitions spike inheritance.** Plain `Show`/match-arm
//!   conditional rendering per the lane brief.
//! - **Plain `<A>` links for navigation** (no `view-transitions`
//!   wrapping). Inside the carousel page there's no inter-route
//!   navigation; the back/close link lives in the page header.
//! - **L3 components throughout** — `Button`, `Numpad`, `ShareSheet`,
//!   `Toast`. No custom button or input styling.

// The view body is long but linear; splitting into private sub-components
// would just add indirection without reuse benefit. Matches the existing
// allow on `cashu_token_paste_view.rs`.
#![allow(clippy::too_many_lines)]

use leptos::ev::MouseEvent;
use leptos::prelude::*;
use leptos::task::spawn_local;

use crate::components::{
    use_toast, Button, ButtonSize, ButtonVariant, Numpad, SharePayload, ShareSheet, ToastVariant,
};
use crate::tokens;

// ---- View-model types -----------------------------------------------------
// Shape mirrors iOS `SendQuotePreview` / `SendSwapHandle` / `SendClaimState`
// so when the real wallet call lands the swap is mechanical.

/// Quote previewed on the Confirm card. Sender-pays-fee mode for v0:
/// `total = amount + send_fee` (receive fee is zero from sender's POV,
/// shown only for parity with iOS so the receiver-side number is visible).
#[derive(Clone, Debug, PartialEq, Eq)]
struct SendQuotePreview {
    /// What the receiver claims.
    amount_to_send: u64,
    /// Fee burned at the input swap (sender pays).
    send_fee: u64,
    /// Fee the receiver burns claiming (informational; sender doesn't pay).
    receive_fee: u64,
    /// Sender's total debit.
    total: u64,
    /// Display unit label, e.g. `"sats"`.
    unit: String,
}

/// Result of a successful `createSend`. Holds the encoded token + the
/// swap id so the polling loop can ask "has the receiver claimed?".
#[derive(Clone, Debug, PartialEq, Eq)]
struct SendSwapHandle {
    /// Encoded V4 token. In the mock this is a deterministic-but-fake
    /// `cashuB...` string; the real wallet will emit a valid token.
    token: String,
    /// Stable swap id for polling. Mock uses a UUIDv4-shaped string.
    swap_id: String,
    /// What the receiver claims. Held so the share / claimed cards can
    /// render the amount without re-deriving from the token.
    amount: u64,
    unit: String,
}

/// Outcome of a single poll-claim shot.
#[derive(Clone, Debug, PartialEq, Eq)]
enum ClaimPoll {
    /// Receiver hasn't claimed yet; keep polling.
    Pending,
    /// Receiver claimed the token. The view transitions to `Claimed`.
    Completed,
    /// Mint declared the swap dead. Surfaces a reason on the failure card.
    //
    // TODO[slice-13]: emitted by the real `check_send_swap_claimed`
    // wallet call when the mint returns a terminal-failed state. The
    // mock today never returns this (the demo flow always completes on
    // tick 3), but the match arm in the polling Effect is wired so the
    // real wallet's failure path drops straight into Phase::Failure.
    #[allow(dead_code)]
    Failed(String),
}

/// View phase. Direct port of iOS `SendCashuTokenView.Phase` with the
/// inner payload types reshaped into the Rust view-model above.
#[derive(Clone, Debug)]
enum Phase {
    /// Numpad + Continue.
    AmountEntry,
    /// Spinner while the (mocked) quote round-trip runs.
    Quoting,
    /// Fee breakdown card; user taps Send to commit.
    Confirming(SendQuotePreview),
    /// Spinner while the (mocked) swap round-trip runs.
    Swapping,
    /// Share card: token, copy, share sheet. Polling claim every 3 s.
    Share(SendSwapHandle),
    /// "Sent" confirmation card.
    Claimed(SendSwapHandle),
    /// Inline error + Retry.
    Failure(String),
}

// ---- Component ------------------------------------------------------------

/// Send-Cashu surface. Sits inside the Send carousel (the carousel page
/// owns the tab header + tab bar; this component owns the body).
#[component]
pub fn SendCashuView() -> impl IntoView {
    let amount_buffer = RwSignal::new("0".to_string());
    let phase: RwSignal<Phase> = RwSignal::new(Phase::AmountEntry);
    // Share-screen copy-confirmation flag. Drives the icon swap on the
    // inline truncated-token chip (doc.on.doc → checkmark for 1.5 s).
    let show_copied = RwSignal::new(false);
    let toast = use_toast();

    // ---- Handlers (mirror iOS method names) ------------------------------

    let on_continue = move |_ev: MouseEvent| {
        let Some(amount) = parsed_amount(&amount_buffer.get()) else {
            return;
        };
        if amount == 0 {
            return;
        }
        phase.set(Phase::Quoting);

        spawn_local(async move {
            // TODO[slice-13]: replace with
            // `WalletClient::prepare_send_quote(amount, accountId, currency)`
            // once the storage-supabase wasm port lands. Outcome mapping
            // stays as-is: `Ok(quote)` → `Phase::Confirming(quote)`;
            // `Err(msg)` → `Phase::Failure(msg)`.
            #[cfg(feature = "hydrate")]
            {
                gloo_timers::future::TimeoutFuture::new(800).await;
            }
            phase.set(Phase::Confirming(mock_prepare_send(amount)));
        });
    };

    let on_confirm = move |_ev: MouseEvent| {
        let Phase::Confirming(quote) = phase.get() else {
            return;
        };
        phase.set(Phase::Swapping);

        spawn_local(async move {
            // TODO[slice-13]: replace with
            // `WalletClient::create_send_swap(quote)` once the wasm port
            // lands. The view-model maps to `SendSwapHandle` directly.
            #[cfg(feature = "hydrate")]
            {
                gloo_timers::future::TimeoutFuture::new(1500).await;
            }
            let handle = mock_commit_send(&quote);
            phase.set(Phase::Share(handle));
        });
    };

    let on_retry = move |_ev: MouseEvent| {
        amount_buffer.set("0".to_string());
        phase.set(Phase::AmountEntry);
    };

    let on_cancel_share = move |_ev: MouseEvent| {
        amount_buffer.set("0".to_string());
        phase.set(Phase::AmountEntry);
    };

    let on_done = move |_ev: MouseEvent| {
        amount_buffer.set("0".to_string());
        phase.set(Phase::AmountEntry);
    };

    let on_copy_token = move |token: String| {
        copy_to_clipboard(&token, show_copied, toast);
    };

    // ---- Polling effect --------------------------------------------------
    //
    // Watches the phase. When it transitions into Share(handle), starts a
    // 3 s-cadence poll loop. The loop is owned by an Effect closure that
    // captures the current `swap_id` — when phase changes (user leaves the
    // share screen, or claim flips to Completed) the next tick is a no-op
    // because `phase.get_untracked()` no longer matches.
    //
    // Cancellation is implicit: the Effect re-runs on the next phase
    // change (cancelling the in-flight timer via the early-return guard);
    // we don't need an explicit AbortController because the next scheduled
    // tick reads `phase.get_untracked()` and bails if it's stale.

    Effect::new(move |_| {
        // Only react to entering Share — the spawn below polls until the
        // phase moves elsewhere.
        let Phase::Share(handle) = phase.get() else {
            return;
        };
        let swap_id = handle.swap_id.clone();

        spawn_local(async move {
            // Three ticks at 3 s ≈ 9 s end-to-end, matching the iOS
            // SendCashuTokenView "Waiting for receiver…" loop. The mock
            // counter flips to Completed on the third tick (see
            // mock_poll_claim).
            let mut tick: u32 = 0;
            loop {
                #[cfg(feature = "hydrate")]
                {
                    gloo_timers::future::TimeoutFuture::new(3_000).await;
                }
                #[cfg(not(feature = "hydrate"))]
                {
                    // SSR path: bail immediately. Polling has no meaning
                    // server-side.
                    return;
                }
                // Cancellation guard. If the user moved off the share
                // screen (Cancel / Done / nav-away), stop polling.
                let still_sharing = matches!(
                    phase.get_untracked(),
                    Phase::Share(ref h) if h.swap_id == swap_id,
                );
                if !still_sharing {
                    return;
                }
                tick = tick.saturating_add(1);
                // TODO[slice-13]: replace with
                // `WalletClient::check_send_swap_claimed(swap_id)`. The
                // outcome maps onto `ClaimPoll` directly (state machine
                // mirrors iOS `SendSwapClaimState`).
                match mock_poll_claim(tick) {
                    // Loop body falls through to the next iteration — no
                    // explicit `continue` needed (and clippy flags it).
                    ClaimPoll::Pending => {}
                    ClaimPoll::Completed => {
                        phase.set(Phase::Claimed(handle));
                        return;
                    }
                    ClaimPoll::Failed(reason) => {
                        phase.set(Phase::Failure(reason));
                        return;
                    }
                }
            }
        });
    });

    // ---- Render ----------------------------------------------------------

    view! {
        <div style=pane_style()>
            {move || match phase.get() {
                Phase::AmountEntry => view! {
                    <AmountEntry
                        buffer=amount_buffer
                        on_continue=on_continue
                    />
                }.into_any(),
                Phase::Quoting => view! {
                    <SpinnerPane label="Preparing send...".to_string()/>
                }.into_any(),
                Phase::Confirming(quote) => view! {
                    <ConfirmCard
                        quote=quote
                        on_send=on_confirm
                        on_cancel=on_retry
                    />
                }.into_any(),
                Phase::Swapping => view! {
                    <SpinnerPane label="Producing token...".to_string()/>
                }.into_any(),
                Phase::Share(handle) => view! {
                    <ShareCard
                        handle=handle
                        show_copied=show_copied
                        on_copy=on_copy_token
                        on_cancel=on_cancel_share
                    />
                }.into_any(),
                Phase::Claimed(handle) => view! {
                    <ClaimedCard handle=handle on_done=on_done/>
                }.into_any(),
                Phase::Failure(message) => view! {
                    <FailureCard
                        message=message
                        on_retry=on_retry
                        on_dismiss=on_done
                    />
                }.into_any(),
            }}
        </div>
    }
}

// ---- Phase: AmountEntry ---------------------------------------------------

#[component]
fn AmountEntry<C>(buffer: RwSignal<String>, on_continue: C) -> impl IntoView
where
    C: Fn(MouseEvent) + Send + Sync + 'static,
{
    let column_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         gap:{gap}; padding:{pad_v} {pad_h}; flex:1;",
        gap = tokens::SPACE_XXL,
        pad_v = tokens::SPACE_L,
        pad_h = tokens::SPACE_L,
    );
    let hero_wrap_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         gap:{gap}; margin-top:{top};",
        gap = tokens::SPACE_XS,
        top = tokens::SPACE_L,
    );
    let amount_row_style = "display:flex; align-items:baseline; \
         justify-content:center; gap:6px;"
        .to_string();
    let amount_style = format!(
        "font-family:{font}; font-size:64px; font-weight:600; color:{fg}; \
         line-height:1; font-variant-numeric:tabular-nums;",
        font = tokens::FONT_NUMERIC,
        fg = tokens::COLOR_FOREGROUND,
    );
    let unit_style = format!(
        "font-size:{size}; color:{fg};",
        size = tokens::TEXT_LG,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let caption_style = format!(
        "font-size:{size}; color:{fg}; margin:0;",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let cta_wrap_style = format!("width:100%; max-width:{max};", max = tokens::CARD_MAX_WIDTH,);

    let is_valid = Signal::derive(move || matches!(parsed_amount(&buffer.get()), Some(n) if n > 0));
    let disabled = Signal::derive(move || !is_valid.get());

    view! {
        <div style=column_style>
            <div style=hero_wrap_style>
                <div style=amount_row_style>
                    <span style=amount_style aria-label="Amount to send">
                        {move || display_amount(&buffer.get())}
                    </span>
                    <span style=unit_style>"sats"</span>
                </div>
                <p style=caption_style>"Send Cashu token"</p>
            </div>

            <Numpad value=buffer allows_decimal=Signal::derive(|| false)/>

            <div style=cta_wrap_style>
                <Button
                    variant=ButtonVariant::Primary
                    size=ButtonSize::Large
                    disabled=disabled
                    on_click=Callback::new(on_continue)
                >
                    "Continue"
                </Button>
            </div>
        </div>
    }
}

// ---- Phase: Quoting / Swapping (shared spinner) ---------------------------

#[component]
fn SpinnerPane(label: String) -> impl IntoView {
    let column_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; gap:{gap}; flex:1;",
        gap = tokens::SPACE_M,
    );
    let spinner_style = format!(
        "width:32px; height:32px; border:2px solid {color}; \
         border-top-color:transparent; border-radius:50%; \
         animation:agicash-spin 0.7s linear infinite;",
        color = tokens::COLOR_MUTED_FOREGROUND,
    );
    let caption_style = format!(
        "font-size:{size}; color:{fg}; margin:0;",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=column_style role="status" aria-live="polite">
            <span aria-hidden="true" style=spinner_style/>
            <p style=caption_style>{label}</p>
        </div>
    }
}

// ---- Phase: Confirming ----------------------------------------------------

#[component]
fn ConfirmCard<S, C>(quote: SendQuotePreview, on_send: S, on_cancel: C) -> impl IntoView
where
    S: Fn(MouseEvent) + Send + Sync + 'static,
    C: Fn(MouseEvent) + Send + Sync + 'static,
{
    let wrap_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; flex:1; padding:{pad};",
        pad = tokens::SPACE_L,
    );
    let card_style = card_style();
    let title_style = format!(
        "font-size:{size}; font-weight:600; margin:0; color:{fg};",
        size = tokens::TEXT_2XL,
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let subhead_style = format!(
        "font-size:{size}; color:{fg}; margin:0;",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let rows_style = format!(
        "display:flex; flex-direction:column; gap:{gap};",
        gap = tokens::SPACE_S,
    );
    let divider_style = format!(
        "height:1px; background:{color}; margin:{m} 0;",
        color = tokens::COLOR_BORDER,
        m = tokens::SPACE_XS,
    );
    let buttons_style = format!(
        "display:flex; flex-direction:column; gap:{gap}; \
         width:100%;",
        gap = tokens::SPACE_S,
    );

    let unit = quote.unit.clone();

    view! {
        <div style=wrap_style>
            <div style=card_style>
                <div>
                    <h2 style=title_style>"Confirm send"</h2>
                    <p style=subhead_style>
                        "Producing a token the receiver can claim"
                    </p>
                </div>

                <div style=rows_style>
                    <AmountRow
                        label="They receive".to_string()
                        value=quote.amount_to_send
                        unit=unit.clone()
                        prominent=true
                    />
                    <AmountRow
                        label="Send fee".to_string()
                        value=quote.send_fee
                        unit=unit.clone()
                        prominent=false
                    />
                    <AmountRow
                        label="Receive fee".to_string()
                        value=quote.receive_fee
                        unit=unit.clone()
                        prominent=false
                    />
                    <div style=divider_style/>
                    <AmountRow
                        label="You pay".to_string()
                        value=quote.total
                        unit=unit
                        prominent=true
                    />
                </div>

                <div style=buttons_style>
                    <Button
                        variant=ButtonVariant::Primary
                        on_click=Callback::new(on_send)
                    >
                        "Send"
                    </Button>
                    <Button
                        variant=ButtonVariant::Ghost
                        on_click=Callback::new(on_cancel)
                    >
                        "Cancel"
                    </Button>
                </div>
            </div>
        </div>
    }
}

#[component]
fn AmountRow(label: String, value: u64, unit: String, prominent: bool) -> impl IntoView {
    let row_style = "display:flex; align-items:center; \
         justify-content:space-between;"
        .to_string();
    let label_style = format!(
        "font-size:{size}; font-weight:{weight}; color:{fg};",
        size = tokens::TEXT_SM,
        weight = if prominent { "600" } else { "400" },
        fg = if prominent {
            tokens::COLOR_CARD_FOREGROUND
        } else {
            tokens::COLOR_MUTED_FOREGROUND
        },
    );
    let value_row_style = "display:flex; align-items:baseline; gap:4px;".to_string();
    let value_style = format!(
        "font-size:{size}; font-weight:{weight}; color:{fg}; \
         font-variant-numeric:tabular-nums;",
        size = tokens::TEXT_SM,
        weight = if prominent { "600" } else { "400" },
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let unit_style = format!(
        "font-size:{size}; color:{fg};",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=row_style>
            <span style=label_style>{label}</span>
            <span style=value_row_style>
                <span style=value_style>{format_amount(value)}</span>
                <span style=unit_style>{unit}</span>
            </span>
        </div>
    }
}

// ---- Phase: Share ---------------------------------------------------------

#[component]
fn ShareCard<C>(
    handle: SendSwapHandle,
    show_copied: RwSignal<bool>,
    on_copy: C,
    on_cancel: impl Fn(MouseEvent) + Send + Sync + 'static,
) -> impl IntoView
where
    C: Fn(String) + Send + Sync + 'static + Clone,
{
    let wrap_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; flex:1; padding:{pad};",
        pad = tokens::SPACE_L,
    );
    let card_style = card_style();
    let header_style = format!(
        "display:flex; flex-direction:column; align-items:center; gap:{gap};",
        gap = tokens::SPACE_XS,
    );
    let amount_row_style = "display:flex; align-items:baseline; \
         justify-content:center; gap:6px;"
        .to_string();
    let amount_style = format!(
        "font-family:{font}; font-size:40px; font-weight:600; color:{fg}; \
         line-height:1; font-variant-numeric:tabular-nums;",
        font = tokens::FONT_NUMERIC,
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let unit_style = format!(
        "font-size:{size}; color:{fg};",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let waiting_style = format!(
        "display:flex; align-items:center; gap:{gap}; \
         font-size:{size}; color:{fg};",
        gap = tokens::SPACE_XS,
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let inline_spinner_style = format!(
        "width:14px; height:14px; border:2px solid {color}; \
         border-top-color:transparent; border-radius:50%; \
         animation:agicash-spin 0.7s linear infinite;",
        color = tokens::COLOR_MUTED_FOREGROUND,
    );
    let chip_style = format!(
        "display:inline-flex; align-items:center; gap:{gap}; \
         padding:{pad_v} {pad_h}; border:1px solid {border}; \
         border-radius:{radius}; background:{bg}; \
         font-size:{size}; color:{fg}; \
         cursor:pointer; font-family:inherit; \
         max-width:100%; \
         -webkit-tap-highlight-color:transparent;",
        gap = tokens::SPACE_XS,
        pad_v = tokens::SPACE_S,
        pad_h = tokens::SPACE_M,
        border = tokens::COLOR_BORDER,
        radius = tokens::RADIUS_MD,
        bg = tokens::COLOR_MUTED,
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let chip_text_style = "overflow:hidden; text-overflow:ellipsis; \
         white-space:nowrap; font-variant-numeric:tabular-nums; \
         font-family:ui-monospace, SFMono-Regular, Menlo, monospace;"
        .to_string();
    let buttons_style = format!(
        "display:flex; flex-direction:column; gap:{gap}; width:100%;",
        gap = tokens::SPACE_S,
    );

    let token = handle.token.clone();
    let token_for_copy = token.clone();
    let token_for_share = token.clone();
    let truncated = truncate_token(&token);

    let on_copy_clone = on_copy.clone();
    let copy_handler = move |_ev: MouseEvent| {
        on_copy_clone(token_for_copy.clone());
    };

    let share_payload = Signal::derive(move || SharePayload {
        title: Some("Cashu token".to_string()),
        text: Some(token_for_share.clone()),
        url: None,
    });
    let on_share_copied = Callback::new(move |()| {
        // Same on_copy path the chip uses — surface the toast via the
        // sibling handler so success feedback matches.
        on_copy(token.clone());
    });
    let on_share_error = Callback::new(move |msg: String| {
        // Best-effort log. Toast would be noisy on the "user dismissed
        // share sheet" rejection path.
        leptos::logging::warn!("share_sheet error: {msg}");
    });

    view! {
        <div style=wrap_style>
            <div style=card_style>
                <div style=header_style>
                    <div style=amount_row_style>
                        <span style=amount_style>{format_amount(handle.amount)}</span>
                        <span style=unit_style.clone()>{handle.unit}</span>
                    </div>
                    <div style=waiting_style>
                        <span aria-hidden="true" style=inline_spinner_style/>
                        <span>"Waiting for receiver..."</span>
                    </div>
                </div>

                <button
                    style=chip_style
                    on:click=copy_handler
                    aria-label="Copy token"
                >
                    <span style=chip_text_style>{truncated}</span>
                    <CopyOrCheckIcon copied=show_copied/>
                </button>

                <div style=buttons_style>
                    <ShareSheet
                        payload=share_payload
                        variant=ButtonVariant::Primary
                        on_copied=on_share_copied
                        on_error=on_share_error
                    >
                        "Share"
                    </ShareSheet>
                    <Button
                        variant=ButtonVariant::Ghost
                        on_click=Callback::new(on_cancel)
                    >
                        "Cancel"
                    </Button>
                </div>
            </div>
        </div>
    }
}

/// Inline icon for the truncated-token chip. Flips between the
/// document-on-document "copy" glyph and a checkmark for 1.5 s after
/// a successful copy.
#[component]
fn CopyOrCheckIcon(copied: RwSignal<bool>) -> impl IntoView {
    view! {
        <span aria-hidden="true" style="display:inline-flex; width:14px; height:14px;">
            {move || if copied.get() {
                view! {
                    <svg width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="20 6 9 17 4 12"/>
                    </svg>
                }.into_any()
            } else {
                view! {
                    <svg width="14" height="14" viewBox="0 0 24 24"
                        fill="none" stroke="currentColor" stroke-width="2"
                        stroke-linecap="round" stroke-linejoin="round">
                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                }.into_any()
            }}
        </span>
    }
}

// ---- Phase: Claimed -------------------------------------------------------

#[component]
fn ClaimedCard<D>(handle: SendSwapHandle, on_done: D) -> impl IntoView
where
    D: Fn(MouseEvent) + Send + Sync + 'static,
{
    let wrap_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; flex:1; padding:{pad}; gap:{gap};",
        pad = tokens::SPACE_L,
        gap = tokens::SPACE_XXL,
    );
    let card_style = card_style();
    let header_style = format!(
        "display:flex; flex-direction:column; align-items:center; gap:{gap};",
        gap = tokens::SPACE_M,
    );
    let title_style = format!(
        "font-size:{size}; font-weight:600; margin:0; color:{fg};",
        size = tokens::TEXT_2XL,
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let amount_row_style = "display:flex; align-items:baseline; \
         justify-content:center; gap:6px;"
        .to_string();
    let amount_style = format!(
        "font-family:{font}; font-size:36px; font-weight:600; color:{fg}; \
         line-height:1; font-variant-numeric:tabular-nums;",
        font = tokens::FONT_NUMERIC,
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let unit_style = format!(
        "font-size:{size}; color:{fg};",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    // Tailwind emerald-500 to match the toast success colour.
    let check_color = "hsl(160 84% 39%)";
    let check_style = format!("color:{check_color}; width:56px; height:56px;",);

    view! {
        <div style=wrap_style>
            <div style=card_style>
                <div style=header_style>
                    <svg
                        style=check_style
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm-1 14.4L6.6 12l1.4-1.4L11 13.6l5-5L17.4 10z"/>
                    </svg>
                    <h2 style=title_style>"Sent"</h2>
                    <div style=amount_row_style>
                        <span style=amount_style>{format_amount(handle.amount)}</span>
                        <span style=unit_style>{handle.unit}</span>
                    </div>
                </div>
            </div>
            <div style=format!("width:100%; max-width:{max};", max = tokens::CARD_MAX_WIDTH)>
                <Button
                    variant=ButtonVariant::Primary
                    on_click=Callback::new(on_done)
                >
                    "Done"
                </Button>
            </div>
        </div>
    }
}

// ---- Phase: Failure -------------------------------------------------------

#[component]
fn FailureCard<R, D>(message: String, on_retry: R, on_dismiss: D) -> impl IntoView
where
    R: Fn(MouseEvent) + Send + Sync + 'static,
    D: Fn(MouseEvent) + Send + Sync + 'static,
{
    let wrap_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; flex:1; padding:{pad}; gap:{gap};",
        pad = tokens::SPACE_L,
        gap = tokens::SPACE_XXL,
    );
    let card_style = card_style();
    let header_style = format!(
        "display:flex; flex-direction:column; align-items:center; gap:{gap};",
        gap = tokens::SPACE_M,
    );
    let title_style = format!(
        "font-size:{size}; font-weight:600; margin:0; color:{fg};",
        size = tokens::TEXT_2XL,
        fg = tokens::COLOR_CARD_FOREGROUND,
    );
    let message_style = format!(
        "font-size:{size}; color:{fg}; margin:0; text-align:center;",
        size = tokens::TEXT_SM,
        fg = tokens::COLOR_MUTED_FOREGROUND,
    );
    let icon_style = format!(
        "color:{color}; width:48px; height:48px;",
        color = tokens::COLOR_DESTRUCTIVE,
    );
    let buttons_style = format!(
        "display:flex; flex-direction:column; gap:{gap}; width:100%; max-width:{max};",
        gap = tokens::SPACE_S,
        max = tokens::CARD_MAX_WIDTH,
    );

    view! {
        <div style=wrap_style>
            <div style=card_style>
                <div style=header_style>
                    <svg
                        style=icon_style
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        aria-hidden="true"
                    >
                        <path d="M12 2 1 21h22zm0 4 8.5 14.7H3.5zM11 10v5h2v-5zm0 7v2h2v-2z"/>
                    </svg>
                    <h2 style=title_style>"Couldn't send"</h2>
                    <p style=message_style>{message}</p>
                </div>
            </div>
            <div style=buttons_style>
                <Button
                    variant=ButtonVariant::Primary
                    on_click=Callback::new(on_retry)
                >
                    "Try again"
                </Button>
                <Button
                    variant=ButtonVariant::Ghost
                    on_click=Callback::new(on_dismiss)
                >
                    "Dismiss"
                </Button>
            </div>
        </div>
    }
}

// ---- Shared styles --------------------------------------------------------

fn pane_style() -> String {
    format!(
        "display:flex; flex-direction:column; flex:1; \
         background:{bg}; min-height:0;",
        bg = tokens::COLOR_BACKGROUND,
    )
}

fn card_style() -> String {
    format!(
        "background:{bg}; color:{fg}; border:1px solid {border}; \
         border-radius:{radius}; padding:{pad}; box-shadow:{shadow}; \
         width:100%; max-width:{max}; display:flex; \
         flex-direction:column; gap:{gap};",
        bg = tokens::COLOR_CARD,
        fg = tokens::COLOR_CARD_FOREGROUND,
        border = tokens::COLOR_BORDER,
        radius = tokens::RADIUS_LG,
        pad = tokens::SPACE_XXL,
        shadow = tokens::SHADOW_XS,
        max = tokens::CARD_MAX_WIDTH,
        gap = tokens::SPACE_L,
    )
}

// ---- Pure helpers (testable without a DOM) --------------------------------

/// Parse the numpad buffer into a `u64`. Returns `None` if the buffer
/// holds a non-integer (e.g. user typed a `.`) or an unparseable string.
/// Sat-only for v0 — mirrors iOS `parsedAmount`.
fn parsed_amount(buffer: &str) -> Option<u64> {
    let cleaned = buffer.trim_matches('.');
    cleaned.parse::<u64>().ok()
}

/// Render the amount buffer with thousands separators for the hero
/// display. Empty buffer renders `"0"` to keep the hero from collapsing.
fn display_amount(buffer: &str) -> String {
    let n = parsed_amount(buffer).unwrap_or(0);
    format_amount(n)
}

/// Comma-separated thousands grouping. Same shape `home.rs::format_amount`
/// + `cashu_token_paste_view::format_amount` use.
fn format_amount(amount: u64) -> String {
    let digits: Vec<char> = amount.to_string().chars().collect();
    let mut out = String::new();
    for (i, c) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(',');
        }
        out.push(*c);
    }
    out
}

/// Render the token as `head...tail` for the inline copy chip. Mirrors
/// iOS `truncated` (head 12, tail 8, ellipsis between).
fn truncate_token(s: &str) -> String {
    let len = s.chars().count();
    if len <= 24 {
        return s.to_string();
    }
    let head: String = s.chars().take(12).collect();
    let tail: String = s.chars().skip(len - 8).collect();
    format!("{head}...{tail}")
}

// ---- Mocked SDK boundary --------------------------------------------------
//
// TODO[slice-13]: each function below maps to a real wallet call once the
// storage-supabase wasm port lands. Keeping them in one block so the swap
// is mechanical:
//   - mock_prepare_send  →  WalletClient::prepare_send_quote
//   - mock_commit_send   →  WalletClient::create_send_swap
//   - mock_poll_claim    →  WalletClient::check_send_swap_claimed
//
// The view-model types (`SendQuotePreview`, `SendSwapHandle`, `ClaimPoll`)
// already match the real wallet's emit shape (see iOS `WalletViewModel`
// `SendQuotePreview` / `SendSwapHandle` / `SendSwapClaimSnapshot` for the
// canonical structures these will swap into).

fn mock_prepare_send(amount: u64) -> SendQuotePreview {
    // 1% sender fee, ceiling-divided so 50 sats still costs at least 1
    // sat — same conservative upper bound the real
    // `CashuSendSwapService.get_quote` returns for sender-pays-fee mode
    // on small inputs. Receive fee 0 from sender's POV in the same mode.
    // Integer math (no `f64` casts) avoids precision-loss + truncation
    // lints; for the synthetic mock this is exactly what we want anyway.
    let send_fee = amount.saturating_add(99) / 100;
    let send_fee = send_fee.max(1);
    SendQuotePreview {
        amount_to_send: amount,
        send_fee,
        receive_fee: 0,
        total: amount.saturating_add(send_fee),
        unit: "sats".to_string(),
    }
}

fn mock_commit_send(quote: &SendQuotePreview) -> SendSwapHandle {
    // Deterministic-but-fake token shape — `cashuB` prefix + 72 bytes of
    // hex-looking padding so the truncation + copy + share UI all render
    // identically to a real V4 token. Real tokens are CBOR + base64url so
    // this won't actually parse on the receiver side; that's fine, it's
    // the mock.
    let token = format!(
        "cashuB{prefix}{filler}{suffix}",
        prefix = "o2F0gaJhaWlAY2FzaHUuc3BhY2VhcIKjY3NlY",
        filler = "X".repeat(48),
        suffix = "ZW5kc2VuZG1vY2tfdXVpZA==",
    );
    SendSwapHandle {
        token,
        swap_id: format!("mock-swap-{}-{}", quote.amount_to_send, mock_tick_id()),
        amount: quote.amount_to_send,
        unit: quote.unit.clone(),
    }
}

fn mock_poll_claim(tick: u32) -> ClaimPoll {
    // Flip to Completed on the third tick (≈ 9 s on the share screen).
    // Matches the demo cadence in the lane brief without needing an
    // operator to act on the receiver side.
    if tick >= 3 {
        ClaimPoll::Completed
    } else {
        ClaimPoll::Pending
    }
}

/// Tiny pseudo-ID used by `mock_commit_send` so two consecutive sends
/// produce distinct `swap_ids` (needed so the polling Effect's
/// cancellation guard sees the new id and stops watching the old one).
fn mock_tick_id() -> u64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static N: AtomicU64 = AtomicU64::new(1);
    N.fetch_add(1, Ordering::Relaxed)
}

// ---- Clipboard helper -----------------------------------------------------
//
// Single-call helper that writes `text` to the clipboard and flips the
// `show_copied` flag for 1.5 s. SSR-only build compiles a no-op so the
// type-checker is happy on the `cfg(not(feature = "hydrate"))` branch.

#[cfg(feature = "hydrate")]
fn copy_to_clipboard(
    text: &str,
    show_copied: RwSignal<bool>,
    toast: crate::components::ToastHandle,
) {
    use wasm_bindgen_futures::JsFuture;

    let Some(window) = web_sys::window() else {
        return;
    };
    let clipboard = window.navigator().clipboard();
    let promise = clipboard.write_text(text);
    spawn_local(async move {
        match JsFuture::from(promise).await {
            Ok(_) => {
                show_copied.set(true);
                toast.push("Copied to clipboard", ToastVariant::Success);
                // Reset the chip icon after 1.5 s. Best-effort — if the
                // user has already navigated away the signal is gone and
                // the update is a no-op.
                gloo_timers::future::TimeoutFuture::new(1_500).await;
                show_copied.set(false);
            }
            Err(err) => {
                toast.push(format!("Couldn't copy: {err:?}"), ToastVariant::Error);
            }
        }
    });
}

#[cfg(not(feature = "hydrate"))]
fn copy_to_clipboard(
    _text: &str,
    _show_copied: RwSignal<bool>,
    _toast: crate::components::ToastHandle,
) {
    // SSR build never runs in a browser; no-op.
}

// ---- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::{
        display_amount, format_amount, mock_poll_claim, mock_prepare_send, parsed_amount,
        truncate_token, ClaimPoll,
    };

    #[test]
    fn parses_integer_buffer() {
        assert_eq!(parsed_amount("0"), Some(0));
        assert_eq!(parsed_amount("12345"), Some(12_345));
    }

    #[test]
    fn rejects_decimal_buffer() {
        // Sat-only — anything with a real decimal is None.
        assert_eq!(parsed_amount("1.5"), None);
    }

    #[test]
    fn tolerates_trailing_dot() {
        // Mid-edit state `"12."` should still parse as 12 so the hero
        // doesn't flicker to 0 between digit and decimal.
        assert_eq!(parsed_amount("12."), Some(12));
    }

    #[test]
    fn display_amount_zero_for_empty() {
        assert_eq!(display_amount(""), "0");
        assert_eq!(display_amount("0"), "0");
    }

    #[test]
    fn display_amount_formats_thousands() {
        assert_eq!(display_amount("1234"), "1,234");
        assert_eq!(display_amount("1234567"), "1,234,567");
    }

    #[test]
    fn format_amount_groups_long_numbers() {
        assert_eq!(format_amount(0), "0");
        assert_eq!(format_amount(999), "999");
        assert_eq!(format_amount(100_000), "100,000");
    }

    #[test]
    fn truncate_short_token_unchanged() {
        assert_eq!(truncate_token("cashuBshort"), "cashuBshort");
    }

    #[test]
    fn truncate_long_token() {
        let raw = format!("cashuB{}", "A".repeat(100));
        let truncated = truncate_token(&raw);
        // head 12 + ... + tail 8 = 23 chars
        assert_eq!(truncated.chars().count(), 23);
        assert!(truncated.starts_with("cashuBAAAAAA"));
        assert!(truncated.ends_with("AAAAAAAA"));
        assert!(truncated.contains("..."));
    }

    #[test]
    fn mock_quote_uses_1pct_fee_floor_1() {
        let q = mock_prepare_send(100);
        assert_eq!(q.amount_to_send, 100);
        assert_eq!(q.send_fee, 1);
        assert_eq!(q.total, 101);
        assert_eq!(q.receive_fee, 0);
    }

    #[test]
    fn mock_quote_scales_fee() {
        let q = mock_prepare_send(10_000);
        assert_eq!(q.send_fee, 100);
        assert_eq!(q.total, 10_100);
    }

    #[test]
    fn mock_poll_completes_on_third_tick() {
        assert_eq!(mock_poll_claim(1), ClaimPoll::Pending);
        assert_eq!(mock_poll_claim(2), ClaimPoll::Pending);
        assert_eq!(mock_poll_claim(3), ClaimPoll::Completed);
        assert_eq!(mock_poll_claim(99), ClaimPoll::Completed);
    }
}
