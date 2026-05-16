import SwiftUI

/// Design tokens loosely matched to the Agicash web app (see
/// `app/tailwind.css` + the shadcn primitives in `app/components/ui/`). The
/// web app uses tailwind tokens like `bg-background`, `text-muted-foreground`,
/// and `bg-card`; we mirror them as SwiftUI colors so screens read similarly.
///
/// SwiftUI's system colors already auto-adapt to dark mode, which mirrors the
/// web app's color-mode toggle behaviour.
enum AppTheme {
    /// `bg-background` — root canvas color.
    static let background = Color(.systemBackground)
    /// `bg-card` — card / surface color used for list rows.
    static let card = Color(.secondarySystemBackground)
    /// `bg-muted` — light surface used for inputs and resting buttons.
    static let muted = Color(.tertiarySystemBackground)
    /// `text-foreground` — primary text color.
    static let foreground = Color(.label)
    /// `text-muted-foreground` — secondary text.
    static let mutedForeground = Color(.secondaryLabel)
    /// Tertiary text (web equivalent: `text-muted-foreground/50`).
    static let tertiaryForeground = Color(.tertiaryLabel)
    /// `border` — subtle divider color.
    static let border = Color(.separator)
    /// `text-destructive` — red used for destructive actions and errors.
    static let destructive = Color.red

    /// Default rounded-corner radius for cards (shadcn default 0.75rem ≈ 12pt).
    static let cardCornerRadius: CGFloat = 12
    /// Default rounded-corner radius for buttons / inputs (shadcn default).
    static let controlCornerRadius: CGFloat = 10

    /// Standard horizontal page padding (shadcn `px-4`).
    static let horizontalPadding: CGFloat = 16
}

/// Card surface — visual analogue of `<Card>` from `~/components/ui/card.tsx`.
/// Filled with `card` background, rounded corners, hairline border.
struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius)
                    .fill(AppTheme.card)
            )
            .overlay(
                RoundedRectangle(cornerRadius: AppTheme.cardCornerRadius)
                    .stroke(AppTheme.border, lineWidth: 0.5)
            )
    }
}

extension View {
    func cardBackground() -> some View { modifier(CardBackground()) }
}
