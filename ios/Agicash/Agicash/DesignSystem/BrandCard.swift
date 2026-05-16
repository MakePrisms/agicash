import SwiftUI

/// Visual analogue of `~/components/ui/card.tsx`:
///
///   className="rounded-lg border bg-card text-card-foreground shadow-xs"
///
/// Filled with the card background, hairline border, very subtle drop
/// shadow. Use via the `.brandCard()` view modifier.
struct BrandCardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: Radius.card)
                    .fill(Color.brandCard)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.card)
                    .stroke(Color.brandBorder, lineWidth: 0.5)
            )
            // `shadow-xs` on web is a 1px y-offset, almost invisible.
            .shadow(color: Color.black.opacity(0.04), radius: 1, x: 0, y: 1)
    }
}

extension View {
    /// Apply the brand card visual treatment (rounded-lg + hairline border +
    /// xs shadow). Equivalent to wrapping the content in `<Card>` on web.
    func brandCard() -> some View { modifier(BrandCardBackground()) }
}
