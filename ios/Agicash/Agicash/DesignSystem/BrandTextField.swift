import SwiftUI

/// Visual analogue of `~/components/ui/input.tsx`:
///
///   "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2
///    text-base ring-offset-background ... focus-visible:ring-2 ..."
///
/// 40pt tall, rounded-md, hairline border, background-color fill. Both the
/// secured (`SecureField`) and plain (`TextField`) variants use the same
/// chrome so a password field doesn't pop out of the form.
struct BrandTextFieldStyle: TextFieldStyle {
    var isFocused: Bool = false

    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .font(.brandBody)
            .foregroundStyle(Color.brandForeground)
            .padding(.horizontal, Spacing.m)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: Radius.control)
                    .fill(Color.brandBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.control)
                    .stroke(isFocused ? Color.brandRing : Color.brandInput, lineWidth: isFocused ? 1.5 : 0.5)
            )
    }
}

/// SecureField has no `TextFieldStyle` equivalent, so we ship a parallel
/// modifier for the same chrome.
struct BrandSecureFieldChrome: ViewModifier {
    var isFocused: Bool

    func body(content: Content) -> some View {
        content
            .font(.brandBody)
            .foregroundStyle(Color.brandForeground)
            .padding(.horizontal, Spacing.m)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: Radius.control)
                    .fill(Color.brandBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: Radius.control)
                    .stroke(isFocused ? Color.brandRing : Color.brandInput, lineWidth: isFocused ? 1.5 : 0.5)
            )
    }
}

extension View {
    /// Apply input chrome to a `SecureField` (use `BrandTextFieldStyle` for
    /// regular `TextField`).
    func brandSecureFieldChrome(isFocused: Bool) -> some View {
        modifier(BrandSecureFieldChrome(isFocused: isFocused))
    }
}
