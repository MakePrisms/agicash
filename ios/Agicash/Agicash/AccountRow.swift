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
///
/// `isDefault` mirrors the web's `account.isDefault` field (computed by
/// `AccountService.isDefaultAccount` from the user row). When true, a
/// small pill renders under the title row.
///
/// Offline / online distinction isn't surfaced by the FFI yet, so the
/// "Offline" badge stays out of scope. Add it when `AccountFfi` learns
/// an `isOnline` signal.
///
/// `displayBalance` renders the FFI's smallest-unit balance suffixed with
/// `account.unit` (`sat` / `cent`). If the FFI ever emits an empty unit
/// (legacy / Phase 1 stub fallback), we fall back to the currency code.
struct AccountRow: View {
    let account: AccountFfi
    var isDefault: Bool = false

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

            if isDefault {
                HStack(spacing: Spacing.s) {
                    DefaultBadge()
                }
                .padding(.top, Spacing.xs)
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
        return "\(account.balance) \(account.unit)"
    }
}

/// Compact pill badge mirroring web's shadcn `<Badge>`. Used today only for
/// the "Default" marker, but the type is parameterised over the label so a
/// future "Offline" badge can reuse it without a second definition.
///
/// Web's `<Badge>` (default variant) is `rounded-full bg-primary text-primary-foreground
/// px-2.5 py-0.5 text-xs`. Mirrored at the iOS pixel scale.
private struct DefaultBadge: View {
    var body: some View {
        Text("Default")
            .font(.brandCaption)
            .foregroundStyle(Color.brandPrimaryForeground)
            .padding(.horizontal, 10)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(Color.brandPrimary)
            )
    }
}
