//! Design tokens as Rust constants — a thin Rust mirror of
//! `~/agicash/design/tokens.json`.
//!
//! The web's tailwind utility classes (`p-4`, `text-sm`, `bg-card`, …) aren't
//! consumable from Leptos's static `view!` macro directly — we emit inline
//! CSS strings instead. Centralising the values here keeps the `LoginView` (and
//! anything we add later) faithful to the shared design system. When
//! `design/tokens.json` changes, update the constants below to match.
//!
//! Source: `design/tokens.json` (extracted from commit 5751be2e of the TS app).

// ---- Colors (light theme) -------------------------------------------------
// HSL string format chosen to match `app/tailwind.css` line-by-line. The
// LoginView only needs the light variants; theme switching is Phase 2 work.
pub const COLOR_BACKGROUND: &str = "hsl(0 0% 100%)";
pub const COLOR_FOREGROUND: &str = "hsl(0 0% 3.9%)";
pub const COLOR_CARD: &str = "hsl(0 0% 100%)";
pub const COLOR_CARD_FOREGROUND: &str = "hsl(0 0% 3.9%)";
pub const COLOR_PRIMARY: &str = "hsl(0 0% 9%)";
pub const COLOR_PRIMARY_FOREGROUND: &str = "hsl(0 0% 98%)";
pub const COLOR_MUTED: &str = "hsl(0 0% 96.1%)";
pub const COLOR_MUTED_FOREGROUND: &str = "hsl(0 0% 45.1%)";
pub const COLOR_BORDER: &str = "hsl(0 0% 89.8%)";
pub const COLOR_DESTRUCTIVE: &str = "hsl(0 84.2% 60.2%)";

// ---- Fonts ----------------------------------------------------------------
// Kode Mono for UI text; Teko reserved for monetary displays elsewhere.
// `fonts.primary` / `fonts.numeric` in tokens.json.
pub const FONT_PRIMARY: &str = "'Kode Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
pub const FONT_NUMERIC: &str = "'Teko', sans-serif";

// ---- Spacing scale --------------------------------------------------------
// Tailwind v4 default scale (4px unit). Matches `ios/Spacing.swift` 1:1.
pub const SPACE_XS: &str = "4px";
pub const SPACE_S: &str = "8px";
pub const SPACE_M: &str = "12px";
pub const SPACE_L: &str = "16px";
pub const SPACE_XL: &str = "20px";
pub const SPACE_XXL: &str = "24px";
pub const SPACE_XXXL: &str = "32px";
pub const SPACE_HERO: &str = "48px";

// ---- Radii ----------------------------------------------------------------
pub const RADIUS_MD: &str = "6px";
pub const RADIUS_LG: &str = "8px";

// ---- Type scale ----------------------------------------------------------
pub const TEXT_SM: &str = "0.875rem";
pub const TEXT_BASE: &str = "1rem";
pub const TEXT_LG: &str = "1.125rem";
pub const TEXT_2XL: &str = "1.5rem";

// ---- Layout --------------------------------------------------------------
// `layout.mobile_container_max_width_px` — same `max-w-sm` (384px) the iOS
// LoginView uses on its card.
pub const CARD_MAX_WIDTH: &str = "384px";

// ---- Shadows --------------------------------------------------------------
pub const SHADOW_XS: &str = "0 1px 2px 0 rgb(0 0 0 / 0.05)";
