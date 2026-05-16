import SwiftUI

/// Visual analogue of `~/components/ui/button.tsx`. The web ships variants
/// (`default`, `secondary`, `ghost`, `destructive`, `outline`) and sizes
/// (`default`, `sm`, `lg`); we cover the three the iOS screens actually use.
///
/// The web `<Button>` is `h-10` (or `h-11` for `lg`), rounded-md, full-width
/// inside its parent's flex column. `BrandButton` matches that — a centered
/// label inside a 40pt (default) or 44pt (large) tappable rectangle.
///
/// Loading state mirrors the web: hide the label, overlay a spinner — so the
/// button height never shifts mid-press.
struct BrandButton<Label: View>: View {
    enum Variant {
        /// `bg-primary text-primary-foreground` — the default solid CTA.
        case primary
        /// `border bg-card hover:bg-muted/50` — the secondary outlined button
        /// used by Receive / Buy on the web home.
        case secondary
        /// `bg-destructive text-destructive-foreground` — sign-out, delete.
        case destructive
        /// `hover:bg-accent` — borderless, used for "Back" / inline actions.
        case ghost
    }

    enum Size {
        /// `h-10 px-4` — default.
        case medium
        /// `h-11 px-8 text-lg` and the home-screen `py-6 text-lg` chunky
        /// rectangles. We pick the chunky one because the home is what most
        /// users see most.
        case large
    }

    let variant: Variant
    let size: Size
    let isLoading: Bool
    let isDisabled: Bool
    let action: () -> Void
    @ViewBuilder var label: () -> Label

    init(
        variant: Variant = .primary,
        size: Size = .medium,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void,
        @ViewBuilder label: @escaping () -> Label
    ) {
        self.variant = variant
        self.size = size
        self.isLoading = isLoading
        self.isDisabled = isDisabled
        self.action = action
        self.label = label
    }

    var body: some View {
        Button(action: action) {
            ZStack {
                // Invisible label preserves the rendered height (web does the
                // same with `<span className="invisible">`).
                label()
                    .opacity(isLoading ? 0 : 1)
                if isLoading {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(foregroundColor)
                        .scaleEffect(0.9)
                }
            }
            .font(.brandBodyEmphasis)
            .foregroundStyle(foregroundColor)
            .frame(maxWidth: .infinity)
            .frame(height: heightForSize)
            .padding(.horizontal, paddingForSize)
            .background(
                RoundedRectangle(cornerRadius: Radius.control)
                    .fill(backgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.control)
                    .stroke(borderColor, lineWidth: borderWidth)
            )
        }
        .disabled(isLoading || isDisabled)
        .opacity(isDisabled ? 0.5 : 1.0)
    }

    private var heightForSize: CGFloat {
        switch size {
        case .medium: return 40
        case .large:  return 52
        }
    }

    private var paddingForSize: CGFloat {
        switch size {
        case .medium: return Spacing.l
        case .large:  return Spacing.xxl
        }
    }

    private var backgroundColor: Color {
        switch variant {
        case .primary:     return .brandPrimary
        case .secondary:   return .brandCard
        case .destructive: return .brandDestructive
        case .ghost:       return .clear
        }
    }

    private var foregroundColor: Color {
        switch variant {
        case .primary:     return .brandPrimaryForeground
        case .secondary:   return .brandCardForeground
        case .destructive: return .brandDestructiveForeground
        case .ghost:       return .brandForeground
        }
    }

    private var borderColor: Color {
        switch variant {
        case .secondary: return .brandBorder
        default:         return .clear
        }
    }

    private var borderWidth: CGFloat {
        variant == .secondary ? 0.5 : 0
    }
}

extension BrandButton where Label == Text {
    /// Convenience for the most common case: a plain text label.
    init(
        _ title: String,
        variant: Variant = .primary,
        size: Size = .medium,
        isLoading: Bool = false,
        isDisabled: Bool = false,
        action: @escaping () -> Void
    ) {
        self.init(
            variant: variant,
            size: size,
            isLoading: isLoading,
            isDisabled: isDisabled,
            action: action,
            label: { Text(title) }
        )
    }
}
