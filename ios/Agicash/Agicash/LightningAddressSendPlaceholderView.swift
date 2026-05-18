import SwiftUI

/// Placeholder for the Lightning-Address Send tab of the Send carousel.
///
/// Lightning Address (LUD-16) resolver shipped in the
/// `agicash-lightning-address` crate but is not bridged through UniFFI
/// yet. This placeholder reserves the third tab slot in the carousel
/// for the follow-up lane.
struct LightningAddressSendPlaceholderView: View {
    var body: some View {
        VStack(spacing: Spacing.l) {
            Image(systemName: "at")
                .font(.system(size: 48, weight: .regular))
                .foregroundStyle(Color.brandMutedForeground)
            Text("Lightning Address")
                .font(.brandTitle)
                .foregroundStyle(Color.brandCardForeground)
            Text("Coming soon")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
