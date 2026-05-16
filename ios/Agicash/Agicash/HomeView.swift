import SwiftUI

/// Home / accounts overview. Mirrors `app/routes/_protected._index.tsx`:
/// a centered balance at the top (no label, no "Total Balance" header on
/// web) and the receive/buy/send action grid the web ships.
///
/// Web does NOT render an accounts list on home — accounts live under
/// `/settings/accounts`. The previous iOS pass added an `AccountListSection`
/// here; it has been removed for parity. Payment flows are out of scope for
/// v0 so the Receive / Buy / Send CTAs render with the web's exact visual
/// treatment but tap to nothing.
struct HomeView: View {
    @Bindable var model: WalletViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.xxxl) {
                    BalanceHero(accounts: model.accounts)
                        .padding(.top, Spacing.hero)

                    HomeActionGrid()
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

/// The Receive / Buy / Send button trio from the web home
/// (`_protected._index.tsx`): two secondary buttons side by side on top, a
/// full-width primary Send button below, all in a 288pt (`w-72`) column.
private struct HomeActionGrid: View {
    var body: some View {
        VStack(spacing: Spacing.l) {
            HStack(spacing: Spacing.l) {
                BrandButton(
                    "Receive",
                    variant: .secondary,
                    size: .large
                ) { /* payment flows out of scope in v0 */ }
                BrandButton(
                    "Buy",
                    variant: .secondary,
                    size: .large
                ) { /* payment flows out of scope in v0 */ }
            }
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
