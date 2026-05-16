import SwiftUI

/// One page of the Receive carousel — buy sats with fiat.
///
/// Placeholder for this lane. The web app's Buy flow
/// (`app/features/buy/`) integrates with Cash App via a hosted-checkout
/// redirect to produce a Lightning invoice the user pays from their
/// bank app. Plumbing that through the FFI is its own slice — see the
/// design note `docs/superpowers/specs/2026-05-15-ios-receive-ux-redesign.md`
/// for why Buy lives as a peer tab here rather than as a footer link
/// on the Lightning numpad.
///
/// In this lane we ship the visual scaffolding (brand card, headline,
/// body, disabled CTA) so the carousel feels complete, then the
/// follow-up lane swaps the body for the real onramp UI without
/// touching the carousel host.
struct BuyView: View {
    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xxl) {
                Spacer(minLength: Spacing.xxl)

                VStack(alignment: .leading, spacing: Spacing.l) {
                    VStack(alignment: .leading, spacing: Spacing.xs) {
                        Text("Buy sats")
                            .font(.brandTitle)
                            .foregroundStyle(Color.brandCardForeground)
                        Text("Top up with fiat via Cash App")
                            .font(.brandLabel)
                            .foregroundStyle(Color.brandMutedForeground)
                    }

                    VStack(alignment: .leading, spacing: Spacing.s) {
                        HStack(spacing: Spacing.s) {
                            Image(systemName: "dollarsign.circle.fill")
                                .font(.system(size: 28))
                                .foregroundStyle(Color.brandMutedForeground)
                            Text("Coming soon")
                                .font(.brandBodyEmphasis)
                                .foregroundStyle(Color.brandCardForeground)
                        }
                        Text(
                            "Buy sats directly inside Agicash without leaving the app. "
                            + "We're wiring this up in the next iteration — for now use "
                            + "the web app at agicash.com to top up."
                        )
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                    }

                    BrandButton(
                        "Coming soon",
                        variant: .secondary,
                        isDisabled: true,
                        action: {}
                    )
                }
                .padding(Spacing.xxl)
                .brandCard()
                .frame(maxWidth: 384)
                .padding(.horizontal, Spacing.l)

                Spacer(minLength: Spacing.xxl)
            }
            .frame(maxWidth: .infinity)
        }
    }
}
