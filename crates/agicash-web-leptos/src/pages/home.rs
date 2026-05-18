//! `/` — protected home route.
//!
//! Mirrors iOS `HomeView` (`ios/Agicash/Agicash/HomeView.swift`) which
//! is the design source of truth, cross-checked against the React
//! reference `app/routes/_protected._index.tsx` from the archived
//! react-web-app branch:
//!
//! ```text
//!   ┌─────────────────────────────┐
//!   │                             │
//!   │           $ 0               │  ← BalanceHero
//!   │       ≈ 0 sats              │
//!   │                             │
//!   │      [    Receive   ]       │  ← HomeActionGrid
//!   │      [    Send      ]       │     (Secondary / Primary)
//!   │                             │
//!   └─────────────────────────────┘
//! ```
//!
//! Auth guard lives in `ProtectedLayout`; this view only renders
//! content. Bottom nav and the surrounding shell come from the parent
//! layout too. The home page focuses on three things:
//!
//! 1. Triggering the wallet refresh on mount.
//! 2. Rendering the balance hero from whatever load state the wallet
//!    context is in (Idle / Loading → spinner; Ready → real numbers;
//!    Error → inline message + retry).
//! 3. Rendering the two primary CTAs (Receive / Send) using the L3
//!    `Button` component, wrapped in client-side `<A/>` links.
//!
//! ## Data source
//!
//! Reads `WalletData` from context. Today that produces `Ready(vec![])`
//! for a fresh guest (correct, real state — no accounts get created at
//! registration), so the hero renders `$ 0` / `≈ 0 sats`. When the
//! wasm wallet binding lands (slice 13), the same context will populate
//! with actual accounts and this page picks up the numbers reactively
//! with no edits required here.
//!
//! ## Deviations from the lane brief
//!
//! - **No account carousel.** Both iOS and the React reference keep
//!   accounts off home — iOS dropped the carousel intentionally
//!   (`HomeView.swift` comment: "Web does NOT render an accounts list
//!   on home — accounts live under `/settings/accounts`."), and React
//!   shows balance + buttons only. We follow the design source.
//! - **No recent activity list.** Neither reference renders one; the
//!   React app links to a separate `/transactions` route from a header
//!   icon. Skipping cleanly per the brief's "If not, omit cleanly."
//! - **No header icons (gift cards, scan, transactions, settings).**
//!   Each is owned by a separate lane / slice.

use leptos::either::Either;
use leptos::prelude::*;
use leptos_router::components::A;

use crate::components::{AccountSummary, Button, ButtonSize, ButtonVariant, LoadState, WalletData};
use crate::tokens;

#[component]
pub fn HomePage() -> impl IntoView {
    let wallet = expect_context::<WalletData>();

    // Kick off the refresh on mount. Effect (not memo / resource) so it
    // runs exactly once post-hydration and the spawned future drives the
    // signal transitions. `clone` because closures need to own a copy
    // and the retry handler below needs another.
    let wallet_for_mount = wallet.clone();
    Effect::new(move |_| {
        wallet_for_mount.clone().refresh();
    });

    let wallet_for_retry = wallet.clone();
    let on_retry = move |_| {
        wallet_for_retry.clone().refresh();
    };

    let accounts = wallet.accounts;

    let page_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:space-between; flex:1; \
         padding:{} {} {} {}; gap:{};",
        // iOS uses Spacing.hero (48px) above the hero and Spacing.xxl
        // below the action grid (.padding(.bottom, .xxl)). Side padding
        // matches the L (16px) default. The space-between layout pushes
        // the action grid toward the bottom of the available area while
        // the hero floats up.
        tokens::SPACE_HERO,
        tokens::SPACE_L,
        tokens::SPACE_XXL,
        tokens::SPACE_L,
        tokens::SPACE_XXXL,
    );

    view! {
        <div style=page_style>
            {move || match accounts.get() {
                LoadState::Idle | LoadState::Loading => {
                    Either::Left(view! { <BalanceLoading/> })
                }
                LoadState::Error(msg) => {
                    Either::Right(Either::Left(view! {
                        <BalanceError message=msg on_retry=on_retry.clone()/>
                    }))
                }
                LoadState::Ready(accounts) => {
                    Either::Right(Either::Right(view! {
                        <BalanceHero accounts=accounts/>
                    }))
                }
            }}

            <HomeActionGrid/>
        </div>
    }
}

// ---- Balance hero ---------------------------------------------------------

/// Real-data hero. Mirrors iOS `BalanceHero` 1:1 (currency symbol +
/// large numeric, then a smaller "≈ <other-currency total>" line in
/// muted text). Pure derivation from the account list — no signals
/// captured, so it composes cleanly into the `LoadState::Ready` arm.
#[component]
fn BalanceHero(accounts: Vec<AccountSummary>) -> impl IntoView {
    let symbol = primary_symbol(&accounts);
    let primary_currency = primary_currency(&accounts);
    let primary_total = total_for_currency(&accounts, primary_currency);
    let secondary = secondary_line(&accounts, primary_currency);

    let column_style = format!(
        "display:flex; flex-direction:column; align-items:center; gap:{};",
        tokens::SPACE_S,
    );
    let row_style = "display:flex; align-items:baseline; \
         justify-content:center; gap:6px;"
        .to_string();
    let symbol_style = format!(
        "font-size:28px; font-weight:600; color:{}; \
         font-family:system-ui, -apple-system, sans-serif;",
        tokens::COLOR_FOREGROUND,
    );
    let amount_style = format!(
        "font-family:{}; font-size:72px; font-weight:600; color:{}; \
         line-height:1; font-variant-numeric:tabular-nums;",
        tokens::FONT_NUMERIC,
        tokens::COLOR_FOREGROUND,
    );
    let secondary_style = format!(
        "font-size:{}; color:{};",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=column_style>
            <div style=row_style>
                <span style=symbol_style>{symbol}</span>
                <span style=amount_style aria-label="Total balance">
                    {format_amount(primary_total)}
                </span>
            </div>
            <span style=secondary_style>{secondary}</span>
        </div>
    }
}

/// Centered spinner shown while the wallet is loading. Same vertical
/// footprint as `BalanceHero` so the layout doesn't shift when the
/// numbers arrive. Caption uses muted-foreground to match the
/// secondary-line styling on the real hero.
#[component]
fn BalanceLoading() -> impl IntoView {
    let column_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; gap:{}; min-height:120px;",
        tokens::SPACE_M,
    );
    let spinner_style = format!(
        "width:24px; height:24px; border:2px solid {}; \
         border-top-color:transparent; border-radius:50%; \
         animation:agicash-spin 0.7s linear infinite;",
        tokens::COLOR_MUTED_FOREGROUND,
    );
    let caption_style = format!(
        "font-size:{}; color:{};",
        tokens::TEXT_SM,
        tokens::COLOR_MUTED_FOREGROUND,
    );

    view! {
        <div style=column_style role="status" aria-live="polite">
            <span aria-hidden="true" style=spinner_style/>
            <span style=caption_style>"Loading wallet..."</span>
        </div>
    }
}

/// Error card shown when `WalletData::refresh` returns `Err`. Surfaces
/// the message and a small ghost-style retry button.
#[component]
fn BalanceError<R>(message: String, on_retry: R) -> impl IntoView
where
    R: Fn(leptos::ev::MouseEvent) + 'static,
{
    let column_style = format!(
        "display:flex; flex-direction:column; align-items:center; \
         justify-content:center; gap:{}; min-height:120px; max-width:320px;",
        tokens::SPACE_M,
    );
    let message_style = format!(
        "font-size:{}; color:{}; margin:0; text-align:center;",
        tokens::TEXT_SM,
        tokens::COLOR_DESTRUCTIVE,
    );
    let retry_style = format!(
        "display:inline-flex; align-items:center; justify-content:center; \
         height:32px; padding:0 {}; border:1px solid {}; \
         border-radius:{}; background:transparent; color:{}; \
         font-family:inherit; font-size:{}; cursor:pointer;",
        tokens::SPACE_L,
        tokens::COLOR_BORDER,
        tokens::RADIUS_MD,
        tokens::COLOR_FOREGROUND,
        tokens::TEXT_SM,
    );

    view! {
        <div style=column_style role="alert">
            <p style=message_style>{format!("Couldn't load your wallet: {message}")}</p>
            <button style=retry_style on:click=on_retry>"Retry"</button>
        </div>
    }
}

// ---- Action grid ----------------------------------------------------------

/// Receive + Send vertical stack. Caps at 288px to match iOS
/// `HomeActionGrid.frame(maxWidth: 288)`. Each button is wrapped in
/// the leptos_router `<A/>` so navigation stays client-side.
#[component]
fn HomeActionGrid() -> impl IntoView {
    let column_style = format!(
        "display:flex; flex-direction:column; gap:{}; width:100%; max-width:288px;",
        tokens::SPACE_L,
    );

    view! {
        <div style=column_style>
            // Receive — Secondary (outlined) per iOS BrandButton variant.
            // Links to `/receive` parent; the receive lane owns the
            // carousel that fans out to `/receive/cashu` etc.
            <A href="/receive">
                <Button variant=ButtonVariant::Secondary size=ButtonSize::Large>
                    "Receive"
                </Button>
            </A>
            // Send — Primary (solid). Links to `/send` placeholder
            // route; the send-flow lane owns the page.
            <A href="/send">
                <Button variant=ButtonVariant::Primary size=ButtonSize::Large>
                    "Send"
                </Button>
            </A>
        </div>
    }
}

// ---- Pure derivations ----------------------------------------------------
// All testable from native Rust with no leptos / browser involvement.
// Mirrors the iOS `BalanceHero` helpers (`primarySymbol`,
// `primaryCurrency`, `totalForCurrency`, `secondaryLine`, `unitLabel`).
// USD wins over BTC when both are present (matches the iOS historical
// default).

/// Pick a currency symbol from the accounts list. Default `$` because
/// most users land in USD and a fresh guest has no accounts (so the
/// hero shows `$ 0`).
fn primary_symbol(accounts: &[AccountSummary]) -> &'static str {
    match primary_currency(accounts) {
        "BTC" => "₿",
        // USD / USDB and the empty-wallet default all land on `$`.
        _ => "$",
    }
}

/// Currency we sum for the primary numeric. USD wins over BTC when both
/// are held (matches iOS); falls back to USD with an empty wallet so
/// the symbol + primary line agree.
fn primary_currency(accounts: &[AccountSummary]) -> &'static str {
    let mut has_usd = false;
    let mut has_btc = false;
    for a in accounts {
        match a.currency.as_str() {
            "USD" | "USDB" => has_usd = true,
            "BTC" => has_btc = true,
            _ => {}
        }
    }
    if has_usd {
        "USD"
    } else if has_btc {
        "BTC"
    } else {
        "USD"
    }
}

/// Sum balances for every account whose currency matches. Sums in `u128`
/// to avoid overflow if someone holds an astronomically large balance
/// across many account rows; we cap back to `u64` because that's all
/// the hero needs to display (and the FFI itself emits `u64`).
fn total_for_currency(accounts: &[AccountSummary], currency: &str) -> u64 {
    let total: u128 = accounts
        .iter()
        .filter(|a| {
            // Map USD/USDB into the same bucket as the symbol — keeps
            // dollar-and-cent-equivalent accounts adding together. iOS
            // does the same in `totalForCurrency` (compares against the
            // primary currency string directly; USD and USDB are
            // distinct strings there so they sum separately, but the
            // wider sentiment of "show the user one dollar number" is
            // what we model here).
            match currency {
                "USD" => matches!(a.currency.as_str(), "USD"),
                "USDB" => matches!(a.currency.as_str(), "USDB"),
                _ => a.currency == currency,
            }
        })
        .map(|a| u128::from(a.balance))
        .sum();
    // Saturating cast: hero displays a single number, can't represent
    // > u64::MAX. Practically unreachable.
    u64::try_from(total).unwrap_or(u64::MAX)
}

/// "≈ X sats" / "≈ X cents" secondary line. With both BTC and USD held,
/// shows the other currency's per-unit total (mirrors iOS — no FX
/// conversion yet). Single-currency wallet collapses to the symmetrical
/// "≈ 0 sats" placeholder so the hero is always two lines tall.
fn secondary_line(accounts: &[AccountSummary], primary: &str) -> String {
    let has_btc = accounts.iter().any(|a| a.currency == "BTC");
    let has_usd = accounts
        .iter()
        .any(|a| matches!(a.currency.as_str(), "USD" | "USDB"));

    let other: Option<&'static str> = match primary {
        "USD" | "USDB" if has_btc => Some("BTC"),
        "BTC" if has_usd => Some("USD"),
        _ => None,
    };

    if let Some(other) = other {
        let total = total_for_currency(accounts, other);
        let unit = unit_label(other, total);
        format!("≈ {} {unit}", format_amount(total))
    } else {
        // Empty / single-currency wallet — symmetrical placeholder.
        "≈ 0 sats".to_string()
    }
}

/// `sat` / `sats` / `cent` / `cents` pluralisation. Mirrors iOS
/// `unitLabel(for:total:)`.
fn unit_label(currency: &str, total: u64) -> &'static str {
    match currency {
        "BTC" => {
            if total == 1 {
                "sat"
            } else {
                "sats"
            }
        }
        "USD" | "USDB" => {
            if total == 1 {
                "cent"
            } else {
                "cents"
            }
        }
        _ => "",
    }
}

/// Comma-separated thousands grouping. Same shape the receive flow's
/// `format_amount` uses so the two views render the same long-number
/// styling.
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

// ---- Tests ----------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn account(currency: &str, balance: u64) -> AccountSummary {
        AccountSummary {
            currency: currency.to_string(),
            balance,
        }
    }

    // primary_currency / primary_symbol -----------------------------------

    #[test]
    fn empty_wallet_defaults_to_usd() {
        let accounts: Vec<AccountSummary> = vec![];
        assert_eq!(primary_currency(&accounts), "USD");
        assert_eq!(primary_symbol(&accounts), "$");
    }

    #[test]
    fn usd_wins_over_btc_when_both_present() {
        let accounts = vec![account("BTC", 1000), account("USD", 500)];
        assert_eq!(primary_currency(&accounts), "USD");
        assert_eq!(primary_symbol(&accounts), "$");
    }

    #[test]
    fn btc_only_wallet_picks_btc() {
        let accounts = vec![account("BTC", 64)];
        assert_eq!(primary_currency(&accounts), "BTC");
        assert_eq!(primary_symbol(&accounts), "₿");
    }

    #[test]
    fn usdb_falls_into_usd_bucket() {
        let accounts = vec![account("USDB", 100)];
        // USDB triggers `has_usd`, so primary_currency is USD.
        assert_eq!(primary_currency(&accounts), "USD");
        assert_eq!(primary_symbol(&accounts), "$");
    }

    // total_for_currency --------------------------------------------------

    #[test]
    fn sums_matching_accounts() {
        let accounts = vec![account("BTC", 10), account("BTC", 20), account("USD", 100)];
        assert_eq!(total_for_currency(&accounts, "BTC"), 30);
        assert_eq!(total_for_currency(&accounts, "USD"), 100);
    }

    #[test]
    fn empty_wallet_totals_zero() {
        assert_eq!(total_for_currency(&[], "USD"), 0);
        assert_eq!(total_for_currency(&[], "BTC"), 0);
    }

    #[test]
    fn unknown_currency_returns_zero() {
        let accounts = vec![account("BTC", 10), account("USD", 100)];
        assert_eq!(total_for_currency(&accounts, "EUR"), 0);
    }

    // secondary_line ------------------------------------------------------

    #[test]
    fn empty_wallet_shows_placeholder_secondary() {
        assert_eq!(secondary_line(&[], "USD"), "≈ 0 sats");
    }

    #[test]
    fn single_currency_wallet_shows_placeholder() {
        let accounts = vec![account("USD", 500)];
        assert_eq!(secondary_line(&accounts, "USD"), "≈ 0 sats");
    }

    #[test]
    fn mixed_wallet_shows_other_currency_total() {
        let accounts = vec![account("USD", 100), account("BTC", 64)];
        assert_eq!(secondary_line(&accounts, "USD"), "≈ 64 sats");
        assert_eq!(secondary_line(&accounts, "BTC"), "≈ 100 cents");
    }

    #[test]
    fn sat_is_singular_for_one() {
        let accounts = vec![account("USD", 500), account("BTC", 1)];
        assert_eq!(secondary_line(&accounts, "USD"), "≈ 1 sat");
    }

    #[test]
    fn cent_is_singular_for_one() {
        let accounts = vec![account("USD", 1), account("BTC", 1000)];
        assert_eq!(secondary_line(&accounts, "BTC"), "≈ 1 cent");
    }

    // format_amount -------------------------------------------------------

    #[test]
    fn formats_small_amounts_unchanged() {
        assert_eq!(format_amount(0), "0");
        assert_eq!(format_amount(7), "7");
        assert_eq!(format_amount(999), "999");
    }

    #[test]
    fn formats_thousands_with_comma() {
        assert_eq!(format_amount(1_000), "1,000");
        assert_eq!(format_amount(12_345), "12,345");
        assert_eq!(format_amount(1_000_000), "1,000,000");
    }
}
