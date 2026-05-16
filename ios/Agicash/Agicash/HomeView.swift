import SwiftUI

/// Home / accounts overview. Mirrors `app/routes/_protected._index.tsx` —
/// a centered total, then a list of accounts and their balances. Send /
/// receive / buy buttons from the web home are intentionally omitted in
/// v0; payment flows are out of scope.
struct HomeView: View {
    @Bindable var model: WalletViewModel

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 24) {
                    BalanceHeader(accounts: model.accounts)
                        .padding(.top, 24)

                    AccountListSection(
                        accounts: model.accounts,
                        title: "Accounts"
                    )
                    .padding(.horizontal, AppTheme.horizontalPadding)
                }
                .padding(.bottom, 24)
                .frame(maxWidth: .infinity)
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("Home")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.refreshAccounts() }
            .task { await model.refreshAccounts() }
        }
    }
}

private struct BalanceHeader: View {
    let accounts: [AccountFfi]

    var body: some View {
        VStack(spacing: 8) {
            Text("Total balance")
                .font(.subheadline)
                .foregroundStyle(AppTheme.mutedForeground)
            // Phase 1 always-zero balances mean a cross-currency total
            // would be misleading; show a stable placeholder instead.
            Text("0")
                .font(.system(size: 48, weight: .bold, design: .rounded))
                .foregroundStyle(AppTheme.foreground)
                .monospacedDigit()
            Text(currencyHint)
                .font(.caption)
                .foregroundStyle(AppTheme.mutedForeground)
        }
        .frame(maxWidth: .infinity)
    }

    private var currencyHint: String {
        let currencies = Set(accounts.map(\.currency))
        if currencies.isEmpty { return "—" }
        if currencies.count == 1 { return currencies.first ?? "—" }
        return currencies.sorted().joined(separator: " · ")
    }
}

/// Vertical list of `AccountRow` cards with a section header. Used by both
/// `HomeView` and `SettingsView` so the visual treatment stays consistent.
struct AccountListSection: View {
    let accounts: [AccountFfi]
    let title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(.headline)
                .foregroundStyle(AppTheme.foreground)

            if accounts.isEmpty {
                EmptyAccountsCard()
            } else {
                LazyVStack(spacing: 10) {
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
        VStack(spacing: 8) {
            Image(systemName: "tray")
                .font(.title2)
                .foregroundStyle(AppTheme.mutedForeground)
            Text("No accounts yet")
                .font(.headline)
                .foregroundStyle(AppTheme.foreground)
            Text("Phase 1 fetched zero accounts from Supabase. Account creation lands in Phase 2.")
                .font(.footnote)
                .multilineTextAlignment(.center)
                .foregroundStyle(AppTheme.mutedForeground)
        }
        .padding(20)
        .frame(maxWidth: .infinity)
        .cardBackground()
    }
}
