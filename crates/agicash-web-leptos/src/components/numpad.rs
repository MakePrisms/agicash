//! `Numpad` — banking-app-style amount entry keypad.
//!
//! Mirror of `ios/Agicash/Agicash/AmountNumpad.swift`. Same 3×4 layout
//! (1-9, decimal, 0, backspace), same accumulator semantics, same
//! visual treatment (28px rounded text, 56px tall keys, 8px gutter).
//!
//! Differences from iOS:
//! - No `UIImpactFeedback` — the web has no equivalent. Tap CSS `:active`
//!   `transform:scale(0.95)` gives a visual analogue.
//! - Long-press to clear isn't wired in MVP; the React app doesn't have
//!   it either. Filed as a follow-up.
//!
//! Dataless — operates on a `RwSignal<String>` the parent owns. Parent
//! parses to `Decimal` for display. Keeping the buffer as a raw string
//! lets us render mid-decimal states like `"1."` that a `Decimal`
//! would collapse.
//!
//! # Example
//!
//! ```rust,ignore
//! use leptos::prelude::*;
//! use agicash_web_leptos::components::Numpad;
//!
//! #[component]
//! fn AmountEntry() -> impl IntoView {
//!     let buffer = RwSignal::new("0".to_string());
//!     view! {
//!         <div>{move || buffer.get()}</div>
//!         <Numpad value=buffer allows_decimal=true max_digits=9 />
//!     }
//! }
//! ```

use leptos::ev::MouseEvent;
use leptos::prelude::*;

use crate::tokens;

/// Default cap on digit count (excluding the decimal point) — matches the
/// iOS default. Keeps the hero font from line-wrapping.
pub const DEFAULT_MAX_DIGITS: usize = 9;

/// Reusable numeric keypad. See module docs for an example.
#[component]
pub fn Numpad(
    /// Raw input buffer. Read by parent for parsing/display; mutated in
    /// place when keys are tapped.
    value: RwSignal<String>,
    /// When `true`, the decimal key is enabled and emits `.`. Sat-mode
    /// passes `false` (sats are integer).
    #[prop(into, optional)]
    allows_decimal: Signal<bool>,
    /// Max digit count, excluding the decimal point. Defaults to
    /// [`DEFAULT_MAX_DIGITS`] (9). When exceeded, further taps are
    /// rejected silently.
    #[prop(optional)]
    max_digits: Option<usize>,
) -> impl IntoView {
    let max_digits = max_digits.unwrap_or(DEFAULT_MAX_DIGITS);

    let on_digit = move |digit: &'static str| {
        let mut current = value.get();
        if append_digit(&mut current, digit, max_digits) {
            value.set(current);
        }
    };
    let on_decimal = move || {
        if !allows_decimal.get() {
            return;
        }
        let mut current = value.get();
        if append_decimal(&mut current) {
            value.set(current);
        }
    };
    let on_delete = move || {
        let mut current = value.get();
        if delete_one(&mut current) {
            value.set(current);
        }
    };

    view! {
        <div
            aria-label="Number pad"
            role="group"
            style=grid_style()
        >
            {digit_keys(on_digit)}
            <DecimalKey
                enabled=allows_decimal
                on_press=Callback::new(move |_| on_decimal())
            />
            <DigitKey label="0" on_press=Callback::new(move |_| on_digit("0")) />
            <DeleteKey on_press=Callback::new(move |_| on_delete()) />
        </div>
    }
}

fn digit_keys<F>(on_digit: F) -> impl IntoView
where
    F: Fn(&'static str) + Copy + Send + Sync + 'static,
{
    // 1..=9 in row-major order. Static labels so we can hand them to the
    // mutator without an allocation.
    const LABELS: [&str; 9] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
    LABELS
        .into_iter()
        .map(|label| {
            view! {
                <DigitKey
                    label=label
                    on_press=Callback::new(move |_| on_digit(label))
                />
            }
        })
        .collect_view()
}

#[component]
fn DigitKey(label: &'static str, on_press: Callback<MouseEvent>) -> impl IntoView {
    view! {
        <button
            type="button"
            style=key_style(true)
            on:click=move |ev| on_press.run(ev)
        >
            {label}
        </button>
    }
}

#[component]
fn DecimalKey(enabled: Signal<bool>, on_press: Callback<MouseEvent>) -> impl IntoView {
    view! {
        <button
            type="button"
            aria-label="Decimal point"
            disabled=move || !enabled.get()
            style=move || key_style(enabled.get())
            on:click=move |ev| {
                if enabled.get() {
                    on_press.run(ev);
                }
            }
        >
            {move || if enabled.get() { "." } else { "" }}
        </button>
    }
}

#[component]
fn DeleteKey(on_press: Callback<MouseEvent>) -> impl IntoView {
    // Inline SVG mirrors iOS `delete.left` SF Symbol shape. Hand-rolled
    // 24×24 to avoid pulling in an icon dep.
    view! {
        <button
            type="button"
            aria-label="Delete"
            style=key_style(true)
            on:click=move |ev| on_press.run(ev)
        >
            <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.6"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="M21 5H8.5L3 12l5.5 7H21a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z" />
                <line x1="18" y1="9" x2="12" y2="15" />
                <line x1="12" y1="9" x2="18" y2="15" />
            </svg>
        </button>
    }
}

fn grid_style() -> String {
    format!(
        "display:grid; grid-template-columns:repeat(3, 1fr); \
         gap:{gap}; width:100%; max-width:{max};",
        gap = tokens::SPACE_S,
        max = tokens::CARD_MAX_WIDTH,
    )
}

fn key_style(enabled: bool) -> String {
    let color = if enabled {
        tokens::COLOR_FOREGROUND
    } else {
        tokens::COLOR_MUTED_FOREGROUND
    };
    let cursor = if enabled { "pointer" } else { "default" };
    format!(
        "display:inline-flex; align-items:center; justify-content:center; \
         height:56px; width:100%; border:none; background:transparent; \
         color:{color}; font-family:{font}; font-size:28px; font-weight:400; \
         border-radius:{radius}; cursor:{cursor}; \
         transition:transform 80ms ease, background 120ms ease; \
         -webkit-tap-highlight-color:transparent; user-select:none;",
        font = tokens::FONT_PRIMARY,
        radius = tokens::RADIUS_MD,
    )
}

// ---- pure mutators (testable without a DOM) -------------------------------

/// Append a single digit to `buf`. Returns `true` if `buf` changed.
///
/// Rules (mirror iOS `appendDigit`):
/// - Reject when digit-count already at `max_digits`.
/// - When `buf == "0"`, replace it (so we don't end up with `"01"`).
/// - When `buf == "0."`, the digit is appended (decimal sticks).
fn append_digit(buf: &mut String, digit: &str, max_digits: usize) -> bool {
    let digit_count = buf.chars().filter(char::is_ascii_digit).count();
    if digit_count >= max_digits {
        return false;
    }
    if buf == "0" {
        *buf = digit.to_string();
    } else {
        buf.push_str(digit);
    }
    true
}

/// Append a decimal point. Returns `true` if `buf` changed.
///
/// Rules (mirror iOS `appendDecimal`):
/// - Reject if `buf` already contains `.`.
/// - Empty buffer becomes `"0."`.
fn append_decimal(buf: &mut String) -> bool {
    if buf.contains('.') {
        return false;
    }
    if buf.is_empty() {
        *buf = "0.".to_string();
    } else {
        buf.push('.');
    }
    true
}

/// Pop the last character. Returns `true` if `buf` changed.
///
/// Rules (mirror iOS `deleteOne`):
/// - No-op when buffer is empty or `"0"`.
/// - Emptying the buffer resets it to `"0"`.
fn delete_one(buf: &mut String) -> bool {
    if buf.is_empty() || buf == "0" {
        return false;
    }
    buf.pop();
    if buf.is_empty() {
        *buf = "0".to_string();
    }
    true
}

#[cfg(test)]
mod tests {
    use super::{append_decimal, append_digit, delete_one, DEFAULT_MAX_DIGITS};

    #[test]
    fn digit_replaces_leading_zero() {
        let mut buf = String::from("0");
        assert!(append_digit(&mut buf, "5", DEFAULT_MAX_DIGITS));
        assert_eq!(buf, "5");
    }

    #[test]
    fn digit_appends_normally() {
        let mut buf = String::from("12");
        assert!(append_digit(&mut buf, "3", DEFAULT_MAX_DIGITS));
        assert_eq!(buf, "123");
    }

    #[test]
    fn digit_stays_after_decimal_zero() {
        // "0." should accept further digits, not be replaced.
        let mut buf = String::from("0.");
        assert!(append_digit(&mut buf, "5", DEFAULT_MAX_DIGITS));
        assert_eq!(buf, "0.5");
    }

    #[test]
    fn digit_rejected_at_max() {
        let mut buf = String::from("123456789");
        assert!(!append_digit(&mut buf, "0", DEFAULT_MAX_DIGITS));
        assert_eq!(buf, "123456789");
    }

    #[test]
    fn digit_count_excludes_decimal_point() {
        // 8 digits + a decimal -> still room for one more digit.
        let mut buf = String::from("1234567.8");
        assert!(append_digit(&mut buf, "9", DEFAULT_MAX_DIGITS));
        assert_eq!(buf, "1234567.89");
        // Now at 9 digits — next one rejected.
        assert!(!append_digit(&mut buf, "0", DEFAULT_MAX_DIGITS));
    }

    #[test]
    fn decimal_on_empty_makes_zero_dot() {
        let mut buf = String::new();
        assert!(append_decimal(&mut buf));
        assert_eq!(buf, "0.");
    }

    #[test]
    fn decimal_appends_to_integer() {
        let mut buf = String::from("12");
        assert!(append_decimal(&mut buf));
        assert_eq!(buf, "12.");
    }

    #[test]
    fn decimal_rejected_when_present() {
        let mut buf = String::from("1.5");
        assert!(!append_decimal(&mut buf));
        assert_eq!(buf, "1.5");
    }

    #[test]
    fn delete_pops_last_char() {
        let mut buf = String::from("123");
        assert!(delete_one(&mut buf));
        assert_eq!(buf, "12");
    }

    #[test]
    fn delete_resets_to_zero_when_emptied() {
        let mut buf = String::from("5");
        assert!(delete_one(&mut buf));
        assert_eq!(buf, "0");
    }

    #[test]
    fn delete_noop_on_zero() {
        let mut buf = String::from("0");
        assert!(!delete_one(&mut buf));
        assert_eq!(buf, "0");
    }

    #[test]
    fn delete_noop_on_empty() {
        let mut buf = String::new();
        assert!(!delete_one(&mut buf));
        assert_eq!(buf, "");
    }

    #[test]
    fn delete_preserves_decimal_in_middle() {
        let mut buf = String::from("1.5");
        assert!(delete_one(&mut buf));
        assert_eq!(buf, "1.");
    }
}
