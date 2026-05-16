import SwiftUI

/// Brand color tokens, one-to-one with the web app's CSS variables in
/// `app/tailwind.css` (shadcn neutral palette). Each name maps to an Asset
/// Catalog color in `Assets.xcassets/Colors/` with both a light and a dark
/// appearance variant — the same dual values the web ships in `:root` and
/// `.dark`.
///
/// Use these instead of `Color(.systemBackground)` / `.label`. The system
/// equivalents drift subtly from the web palette (iOS dark grays are warmer,
/// separators are lower-contrast) which makes a side-by-side feel like two
/// different products.
extension Color {
    /// `--background` — root canvas.
    static let brandBackground = Color("background", bundle: .main)
    /// `--foreground` — primary text on background.
    static let brandForeground = Color("foreground", bundle: .main)

    /// `--card` — card surfaces.
    static let brandCard = Color("card", bundle: .main)
    /// `--card-foreground` — text on cards.
    static let brandCardForeground = Color("cardForeground", bundle: .main)

    /// `--primary` — primary CTA fill (near-black in light, dark slate in
    /// dark). Used by the default `<Button>` variant on web.
    static let brandPrimary = Color("primary", bundle: .main)
    /// `--primary-foreground` — text on primary fills.
    static let brandPrimaryForeground = Color("primaryForeground", bundle: .main)

    /// `--secondary` — secondary/ghost surface (light gray in light mode,
    /// near-black in dark). Used by the `secondary` button variant on web.
    static let brandSecondary = Color("secondary", bundle: .main)
    /// `--secondary-foreground` — text on secondary fills.
    static let brandSecondaryForeground = Color("secondaryForeground", bundle: .main)

    /// `--muted` — muted surface for inputs and resting controls.
    static let brandMuted = Color("muted", bundle: .main)
    /// `--muted-foreground` — secondary/helper text. Matches web's
    /// `text-muted-foreground` exactly.
    static let brandMutedForeground = Color("mutedForeground", bundle: .main)
    /// 50% opacity of muted foreground — web uses `text-muted-foreground/50`
    /// for tertiary text (e.g. the domain in a lightning address).
    static let brandTertiaryForeground = Color("mutedForeground", bundle: .main).opacity(0.5)

    /// `--accent` — hover surface (mirrors `--secondary` in shadcn neutral).
    static let brandAccent = Color("accent", bundle: .main)
    /// `--accent-foreground` — text on accent fills.
    static let brandAccentForeground = Color("accentForeground", bundle: .main)

    /// `--destructive` — destructive action color (red).
    static let brandDestructive = Color("destructive", bundle: .main)
    /// `--destructive-foreground` — text on destructive fills.
    static let brandDestructiveForeground = Color("destructiveForeground", bundle: .main)

    /// `--border` — subtle hairline border on cards / inputs.
    static let brandBorder = Color("border", bundle: .main)
    /// `--input` — input border (same value as `--border` on web).
    static let brandInput = Color("input", bundle: .main)
    /// `--ring` — focus ring color.
    static let brandRing = Color("ring", bundle: .main)

    // MARK: Aliases matching the legacy `AppTheme.*` API
    //
    // The Phase-1 screens used `AppTheme.background`, `.muted`, etc. The
    // re-skin keeps those names working by routing them at the `AppTheme`
    // namespace (see AppTheme.swift) so we don't have to chase every call
    // site through the diff.
}
