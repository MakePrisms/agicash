import Foundation
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

    /// Drives presentation of `ReceiveView` as a sheet. The web routes
    /// to `/receive` which is a separate page; on iOS a `.sheet` is the
    /// closer-to-native equivalent and avoids rebuilding the nav stack.
    /// Stays at this level (not on the action grid) so the sheet's
    /// dismissal cleanly returns control to the home scroll view.
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
                ReceiveView(model: model, onDismiss: { showReceive = false })
            }
        }
    }
}

/// Centered balance display modeled on `MoneyWithConvertedAmount` on the
/// web home: large numeric on top, smaller converted amount below in muted
/// gray. Numeric uses `Font.brandNumericHero` (Teko Bold).
///
/// Web aggregates by currency via `useBalance('BTC') / useBalance('USD')`
/// in `app/routes/_protected._index.tsx` and renders the user's default
/// currency. Phase 1 iOS has no user-prefs surface yet, so the primary
/// currency is inferred from the accounts list (USD wins when both are
/// present, mirroring the historical default) and only that currency's
/// per-account balances are summed. The secondary line shows the other
/// currency's per-unit total without FX conversion (Phase 1 has no rates
/// wired client-side), which matches the web's "≈" placeholder when rate
/// data is unavailable.
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
                Text(primaryAmountText)
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

    /// The currency we're summing for the primary line. Matches
    /// `primarySymbol` so the prefix and numeric agree.
    private var primaryCurrency: String {
        let currencies = Set(accounts.map(\.currency))
        if currencies.contains("USD") { return "USD" }
        if currencies.contains("BTC") { return "BTC" }
        return "USD"
    }

    /// Sum of `balance` (in smallest units) for accounts matching
    /// `primaryCurrency`. The FFI emits balances as decimal strings of the
    /// minor unit (`sat` for BTC, `cent` for USD/USDB); we display the raw
    /// minor-unit total so we never lose precision in the parse round-trip.
    /// Major-unit formatting (BTC, dollars) lands when the iOS app grows a
    /// currency formatter pass.
    private var primaryAmountText: String {
        let total = totalForCurrency(primaryCurrency)
        return formatDecimal(total)
    }

    /// Mimics the web's converted-amount line. When the user holds BOTH
    /// BTC and USD accounts, this line surfaces the other currency's
    /// per-unit total (e.g. "≈ 64 sats" while primary is USD). With only
    /// one currency present, it falls back to a sats placeholder — Phase 2
    /// will replace this with a real FX-converted figure once rates are
    /// wired client-side.
    private var secondaryLine: String {
        let currencies = Set(accounts.map(\.currency))
        let secondaryCurrency: String? = {
            if primaryCurrency == "USD" && currencies.contains("BTC") { return "BTC" }
            if primaryCurrency == "BTC" && currencies.contains("USD") { return "USD" }
            return nil
        }()
        if let secondary = secondaryCurrency {
            let total = totalForCurrency(secondary)
            let unit = unitLabel(for: secondary, total: total)
            return "≈ \(formatDecimal(total)) \(unit)"
        }
        // Single-currency wallet — show the symmetrical placeholder so the
        // hero doesn't collapse to a single line.
        return "≈ 0 sats"
    }

    /// Walk the accounts list, summing balances for the matching currency.
    /// Decimal parsing tolerates the FFI's string shape (`"0"`, `"64"`)
    /// and silently skips non-numeric entries so a malformed row from a
    /// future FFI surface can't crash the hero.
    private func totalForCurrency(_ currency: String) -> Decimal {
        accounts
            .filter { $0.currency == currency }
            .reduce(Decimal.zero) { acc, account in
                acc + (Decimal(string: account.balance) ?? .zero)
            }
    }

    /// `sat` / `cent` / etc. label, pluralised the same way the web treats
    /// the converted-amount string. `cent`/`cents` and `sat`/`sats` match
    /// the FFI's `AccountFfi.unit` for these currencies.
    private func unitLabel(for currency: String, total: Decimal) -> String {
        switch currency {
        case "BTC": return total == 1 ? "sat" : "sats"
        case "USD", "USDB": return total == 1 ? "cent" : "cents"
        default: return ""
        }
    }

    private func formatDecimal(_ value: Decimal) -> String {
        // Default decimal description renders integer values without a
        // trailing decimal point; minor units are always integers so this
        // is fine. Localisation pass lands with the rest of the
        // currency-formatter work.
        var copy = value
        var rounded = Decimal()
        NSDecimalRound(&rounded, &copy, 0, .plain)
        return NSDecimalNumber(decimal: rounded).stringValue
    }
}

/// The Receive / Buy / Send button trio from the web home
/// (`_protected._index.tsx`): two secondary buttons side by side on top, a
/// full-width primary Send button below, all in a 288pt (`w-72`) column.
///
/// Receive is wired in this lane (paste a Cashu token and claim it).
/// Buy / Send / Lightning remain stubs — see the slice-8 worker for
/// Lightning send and a follow-up lane for Buy.
private struct HomeActionGrid: View {
    let onReceive: () -> Void

    var body: some View {
        VStack(spacing: Spacing.l) {
            HStack(spacing: Spacing.l) {
                BrandButton(
                    "Receive",
                    variant: .secondary,
                    size: .large,
                    action: onReceive
                )
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
