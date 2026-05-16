import SwiftUI

/// Home / accounts overview. Mirrors `app/routes/_protected._index.tsx`:
/// a centered balance at the top (no label, no "Total Balance" header on
/// web) and the receive/send action stack.
///
/// Web does NOT render an accounts list on home — accounts live under
/// `/settings/accounts`. Payment flows mostly live in dedicated lanes;
/// Receive opens `ReceiveCarouselView` (cashu paste / Lightning / Buy
/// tabs), Send is still stubbed.
///
/// Buy used to be a standalone secondary button next to Receive; the
/// 2026-05-15 receive-UX redesign folded it into the Receive carousel
/// as a third tab so the Home grid simplifies to Receive + Send.
/// See `docs/superpowers/specs/2026-05-15-ios-receive-ux-redesign.md`.
struct HomeView: View {
    @Bindable var model: WalletViewModel

    /// Drives presentation of `ReceiveCarouselView` as a sheet. The web
    /// routes to `/receive` which is a separate page; on iOS a `.sheet`
    /// is the closer-to-native equivalent and avoids rebuilding the
    /// nav stack. Stays at this level (not on the action grid) so the
    /// sheet's dismissal cleanly returns control to the home scroll
    /// view.
    @State private var showReceive: Bool = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.xxxl) {
                    BalanceHero(accounts: model.accounts)
                        .padding(.top, Spacing.hero)

                    HomeActionGrid(
                        onReceive: { showReceive = true }
                    )
                    .padding(.horizontal, Spacing.l)
                }
                .padding(.bottom, Spacing.xxl)
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandBackground.ignoresSafeArea())
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.refreshAccounts() }
            .task { await model.refreshAccounts() }
            .sheet(isPresented: $showReceive) {
                ReceiveCarouselView(
                    model: model,
                    onDismiss: { showReceive = false }
                )
            }
        }
    }
}

/// Centered balance display modeled on `MoneyWithConvertedAmount` on the
/// web home: large numeric on top, smaller converted amount below in muted
/// gray. Numeric uses `Font.brandNumericHero` (Teko Bold).
private struct BalanceHero: View {
    let accounts: [AccountFfi]

    var body: some View {
        VStack(spacing: Spacing.s) {
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                // Currency symbol — small, like Teko's prefix on web.
                Text(primarySymbol)
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color.brandForeground)
                    .baselineOffset(8)
                Text("0")
                    .font(.brandNumericHero)
                    .foregroundStyle(Color.brandForeground)
                    .monospacedDigit()
            }
            Text(secondaryLine)
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(maxWidth: .infinity)
    }

    /// Pick the most prominent currency symbol from the accounts we know
    /// about. Defaults to "$" since most users land in USD.
    private var primarySymbol: String {
        let currencies = Set(accounts.map(\.currency))
        if currencies.contains("USD") { return "$" }
        if currencies.contains("BTC") { return "₿" }
        return "$"
    }

    /// Mimics the web's converted-amount line (e.g. "≈ 0 sats").
    private var secondaryLine: String {
        let currencies = Set(accounts.map(\.currency))
        if currencies.contains("BTC") { return "≈ 0 sats" }
        return "≈ 0 sats"
    }
}

/// Receive / Send button stack. Buy used to live next to Receive as a
/// peer secondary button; the 2026-05-15 receive-UX redesign folded
/// it into the Receive carousel as a third tab so the Home surface
/// stays focused on the two primary intents (someone-pay-me /
/// I-pay-someone). See
/// `docs/superpowers/specs/2026-05-15-ios-receive-ux-redesign.md`.
///
/// Receive opens `ReceiveCarouselView`. Send remains a stub — separate
/// lane (slice 8 / Lightning send).
private struct HomeActionGrid: View {
    let onReceive: () -> Void

    var body: some View {
        VStack(spacing: Spacing.l) {
            BrandButton(
                "Receive",
                variant: .secondary,
                size: .large,
                action: onReceive
            )
            BrandButton(
                "Send",
                variant: .primary,
                size: .large
            ) { /* payment flows out of scope in v0 */ }
        }
        .frame(maxWidth: 288)
        .frame(maxWidth: .infinity) // center the 288pt column.
    }
}
