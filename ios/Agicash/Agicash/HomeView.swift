import SwiftUI

/// Home / accounts overview. Mirrors `app/routes/_protected._index.tsx` —
/// a centered total at the top, then the receive/buy/send action grid the
/// web ships, then the accounts list (v0 keeps accounts on the home so
/// users can see them without navigating; the web app puts them under
/// Settings → Accounts).
///
/// Payment flows are out of scope for v0 so the Receive / Buy / Send CTAs
/// are rendered with the web's exact visual treatment but tap to nothing.
/// They establish brand presence while keeping behaviour honest.
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

                    AccountListSection(
                        accounts: model.accounts,
                        title: "Accounts"
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
        }
    }
}

/// Centered balance display modeled on `MoneyWithConvertedAmount` on the
/// web home: large numeric on top, smaller converted amount below in muted
/// gray. Numeric uses `Font.brandNumericHero` — rounded fallback for Teko.
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
                // Phase 1 balances are always "0"; render that as the
                // hero. Once `AccountFfi.balance` is real, sum here.
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

/// Vertical list of `AccountRow` cards with a section header. Used by both
/// `HomeView` and `SettingsView` so the visual treatment stays consistent.
struct AccountListSection: View {
    let accounts: [AccountFfi]
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text(title)
                .font(.brandTitleSmall)
                .foregroundStyle(Color.brandForeground)

            if accounts.isEmpty {
                EmptyAccountsCard()
            } else {
                LazyVStack(spacing: Spacing.m) {
                    ForEach(accounts, id: \.id) { account in
                        AccountRow(account: account)
                    }
                }
            }
        }
    }
}

private struct EmptyAccountsCard: View {
    var body: some View {
        VStack(spacing: Spacing.s) {
            Image(systemName: "tray")
                .font(.title2)
                .foregroundStyle(Color.brandMutedForeground)
            Text("No accounts yet")
                .font(.brandTitleSmall)
                .foregroundStyle(Color.brandForeground)
            Text("Phase 1 fetched zero accounts from Supabase. Account creation lands in Phase 2.")
                .font(.brandCaption)
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity)
        .brandCard()
    }
}
