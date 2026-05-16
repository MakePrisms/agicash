import SwiftUI

/// Visual analogue of the account row in
/// `app/features/settings/accounts/all-accounts.tsx`:
///
///   <Card className="flex flex-col p-2 px-4 hover:bg-muted/50">
///     <div className="flex items-center justify-between">
///       <h3>{account.name}</h3>
///       <MoneyWithConvertedAmount money={balance} variant="inline" />
///     </div>
///     {(isDefault || !isOnline) && (
///       <div className="mt-1 flex gap-2">
///         <Badge>Default</Badge>
///         <Badge>Offline</Badge>
///       </div>
///     )}
///   </Card>
///
/// The row is just a name + balance line. No leading icon, no account-type
/// badge, no mint URL — those were iOS surplus from the earlier pass.
/// Default / Offline badges only render when applicable; we don't have
/// either signal in `AccountFfi` yet so the badge row stays empty.
///
/// Phase 1 always renders balance "0" because the Rust FFI hard-codes it
/// (see `AccountFfi`). The `unit` field is also empty, so we render the
/// account currency next to the balance for now.
///
/// Currently unreferenced — kept as the canonical row component for the
/// future Settings → Accounts subview.
struct AccountRow: View {
    let account: AccountFfi

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .center) {
                Text(account.name)
                    .font(.brandBody)
                    .foregroundStyle(Color.brandCardForeground)
                    .lineLimit(1)

                Spacer()

                Text(displayBalance)
                    .font(.brandLabel.monospacedDigit())
                    .foregroundStyle(Color.brandMutedForeground)
            }
        }
        .padding(.vertical, Spacing.s)
        .padding(.horizontal, Spacing.l)
        .frame(maxWidth: .infinity, alignment: .leading)
        .brandCard()
    }

    private var displayBalance: String {
        if account.unit.isEmpty {
            return "\(account.balance) \(account.currency)"
        }
        return account.balance
    }
}
