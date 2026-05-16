import SwiftUI
import UIKit

/// Custom 3×4 amount numpad for the Lightning receive flow.
///
/// Banking-app-style amount entry: a calculator-style keypad with
/// digits 0-9, a decimal point, and a backspace key. iOS's default
/// `.numberPad` keyboard is rejected here for two reasons:
///
/// 1. It pops up over the bottom half of the screen, leaving no room
///    for the live amount display + breakdown + CTA without the layout
///    fighting safe-area / keyboard-avoidance state.
/// 2. It doesn't fire per-tap haptics. Banking apps (Cash App, Venmo,
///    Apple Wallet) all use a custom keypad with `UIImpactFeedback`
///    on each digit press — that tactile rhythm is what makes amount
///    entry feel native.
///
/// The web equivalent is `~/components/numpad.tsx`. This view ships
/// the same key layout and accumulator semantics: digits append,
/// leading-zero replacement, `.` is no-op when buffer already has one
/// or when sat-mode is active, `⌫` pops the last character. Long-press
/// on `⌫` clears the buffer (matches Cash App).
///
/// `value` is bound to the parent's `@State` raw buffer string. Parsing
/// to `Decimal` is the parent's responsibility — this view only
/// manipulates the raw string so the display strip can render
/// in-progress states like "1." (mid-decimal) that a `Decimal` would
/// collapse.
struct AmountNumpad: View {
    /// Raw input buffer ("0", "1", "1.5", "12345"). Mutated in place;
    /// the parent observes via the binding and re-parses for display.
    @Binding var value: String
    /// Whether decimal entry is allowed. Sat-mode disables it (sats
    /// are integer); USD-mode allows it (cents → two decimal places).
    let allowsDecimal: Bool
    /// Max digit count (excluding the decimal point and trailing
    /// zeros). 9 by default to keep the live display from line
    /// wrapping at the hero font size.
    let maxDigits: Int

    init(value: Binding<String>, allowsDecimal: Bool, maxDigits: Int = 9) {
        self._value = value
        self.allowsDecimal = allowsDecimal
        self.maxDigits = maxDigits
    }

    /// Haptic generators are expensive to construct repeatedly — keep
    /// one of each style alive for the view's lifetime. `.light` for
    /// digits, `.medium` for backspace, `.rigid` for the clear long-
    /// press (a slightly different feel so the user knows the gesture
    /// did something distinct).
    private let lightHaptic = UIImpactFeedbackGenerator(style: .light)
    private let mediumHaptic = UIImpactFeedbackGenerator(style: .medium)
    private let rigidHaptic = UIImpactFeedbackGenerator(style: .rigid)

    var body: some View {
        VStack(spacing: Spacing.s) {
            row(["1", "2", "3"])
            row(["4", "5", "6"])
            row(["7", "8", "9"])
            HStack(spacing: Spacing.s) {
                key(label: allowsDecimal ? "." : "", action: appendDecimal, enabled: allowsDecimal)
                key(label: "0", action: { appendDigit("0") })
                deleteKey()
            }
        }
    }

    private func row(_ digits: [String]) -> some View {
        HStack(spacing: Spacing.s) {
            ForEach(digits, id: \.self) { digit in
                key(label: digit, action: { appendDigit(digit) })
            }
        }
    }

    private func key(label: String, action: @escaping () -> Void, enabled: Bool = true) -> some View {
        Button(action: action) {
            Text(label)
                .font(.system(size: 28, weight: .regular, design: .rounded))
                .foregroundStyle(enabled ? Color.brandForeground : Color.brandMutedForeground.opacity(0.3))
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    private func deleteKey() -> some View {
        Button(action: deleteOne) {
            Image(systemName: "delete.left")
                .font(.system(size: 24, weight: .regular))
                .foregroundStyle(Color.brandForeground)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        // Long-press to clear. iOS interprets this as a separate
        // gesture from the tap; the tap-handler still fires for
        // short presses so single-character deletes feel instant.
        .onLongPressGesture(minimumDuration: 0.4) {
            clearAll()
        }
    }

    // MARK: - mutators

    private func appendDigit(_ digit: String) {
        // Trim trailing zeros into the cap when a decimal point is
        // present: "1.5" has 2 useful digits, not 3. For integer mode
        // it's just `value.count`.
        let digitCount = value.filter(\.isNumber).count
        guard digitCount < maxDigits else {
            rigidHaptic.impactOccurred()
            return
        }
        lightHaptic.impactOccurred()
        if value == "0" {
            // Replace the leading zero so we don't end up with "01".
            // Exception: when a decimal has already been entered ("0.")
            // we want to keep the zero.
            value = digit
        } else {
            value.append(digit)
        }
    }

    private func appendDecimal() {
        guard allowsDecimal else { return }
        guard !value.contains(".") else {
            rigidHaptic.impactOccurred()
            return
        }
        lightHaptic.impactOccurred()
        // Empty buffer + "." -> "0." so the display reads naturally.
        value = value.isEmpty ? "0." : value + "."
    }

    private func deleteOne() {
        guard !value.isEmpty, value != "0" else {
            // Already empty — give a tactile "nothing happened" buzz.
            rigidHaptic.impactOccurred()
            return
        }
        mediumHaptic.impactOccurred()
        value.removeLast()
        if value.isEmpty {
            value = "0"
        }
    }

    private func clearAll() {
        guard value != "0" else { return }
        rigidHaptic.impactOccurred()
        value = "0"
    }
}
