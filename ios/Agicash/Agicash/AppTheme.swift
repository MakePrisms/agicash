import SwiftUI

/// Legacy facade over the brand token layer in `DesignSystem/`. The Phase-1
/// screens reach for `AppTheme.background`, `.muted`, `.cardBackground()`
/// etc.; rather than rename every call site, we forward those names to the
/// new `Color.brand*` tokens (Asset Catalog colors with light + dark variants
/// matching `app/tailwind.css`).
///
/// New code should prefer the canonical token API directly:
///
///   `Color.brandBackground`, `Spacing.l`, `Radius.card`, `Font.brandBody`, ...
///
/// See `DesignSystem/Color+Theme.swift`, `Spacing.swift`, `Radius.swift`,
/// `Typography.swift` for the full surface.
enum AppTheme {
    static let background = Color.brandBackground
    static let card = Color.brandCard
    static let muted = Color.brandMuted
    static let foreground = Color.brandForeground
    static let mutedForeground = Color.brandMutedForeground
    static let tertiaryForeground = Color.brandTertiaryForeground
    static let border = Color.brandBorder
    static let destructive = Color.brandDestructive
    static let primary = Color.brandPrimary
    static let primaryForeground = Color.brandPrimaryForeground

    /// `Radius.card` (8pt) — kept for backward compatibility.
    static let cardCornerRadius: CGFloat = Radius.card
    /// `Radius.control` (6pt) — kept for backward compatibility.
    static let controlCornerRadius: CGFloat = Radius.control
    /// `Spacing.l` (16pt) — kept for backward compatibility.
    static let horizontalPadding: CGFloat = Spacing.l
}

/// Legacy alias for the brand card modifier. Prefer `.brandCard()`.
extension View {
    func cardBackground() -> some View { brandCard() }
}
