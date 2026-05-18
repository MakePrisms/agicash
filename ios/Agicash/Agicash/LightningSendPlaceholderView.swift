import SwiftUI

/// Placeholder for the Lightning Send tab of the Send carousel.
///
/// The Cashu send tab ships in this pass; Lightning melt-quote + LN
/// Address tabs land in a follow-up FFI lane (slice 8 — `melt_quote`
/// service is already wired in Rust but not bridged through UniFFI).
/// The placeholder keeps the carousel's three-tab geometry stable so
/// the indicator bar reads symmetrically once those tabs go live.
struct LightningSendPlaceholderView: View {
    var body: some View {
        VStack(spacing: Spacing.l) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 48, weight: .regular))
                .foregroundStyle(Color.brandMutedForeground)
            Text("Lightning send")
                .font(.brandTitle)
                .foregroundStyle(Color.brandCardForeground)
            Text("Coming soon")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
