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
/// Phase 1 always renders balance "0" because the Rust FFI hard-codes it
/// (see `AccountFfi`). The `unit` field is also empty, so we render the
/// account currency next to the balance for now.
struct AccountRow: View {
    let account: AccountFfi

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .center, spacing: Spacing.m) {
                // The web row is name + balance only — no leading icon. We
                // keep one because iOS rows feel naked without a glyph and
                // the `account.type` is already the only visual cue
                // distinguishing rows in v0.
                Image(systemName: iconName(for: account.accountType))
                    .font(.brandBody)
                    .foregroundStyle(Color.brandMutedForeground)
                    .frame(width: 18)

                Text(account.name)
                    .font(.brandBody)
                    .foregroundStyle(Color.brandCardForeground)
                    .lineLimit(1)

                Spacer()

                Text(displayBalance)
                    .font(.brandNumericInline.monospacedDigit())
                    .foregroundStyle(Color.brandCardForeground)
            }

            // Web shows Default + Offline badges only when applicable. We
            // surface the account type as a badge so each row has a label
            // without depending on data we don't have in v0.
            HStack(spacing: Spacing.s) {
                AccountTypeBadge(label: account.accountType)
                if let url = account.mintUrl, !url.isEmpty {
                    Text(url)
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandTertiaryForeground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
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

    private func iconName(for accountType: String) -> String {
        switch accountType {
        case "cashu": return "creditcard"
        case "spark": return "bolt"
        default:      return "circle"
        }
    }
}

/// Pill badge mirroring `~/components/ui/badge.tsx` — small uppercase label,
/// rounded-full, muted background. Used for the account type marker.
private struct AccountTypeBadge: View {
    let label: String

    var body: some View {
        Text(label.uppercased())
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(Color.brandMutedForeground)
            .padding(.horizontal, Spacing.s)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(Color.brandMuted)
            )
            .overlay(
                Capsule().stroke(Color.brandBorder, lineWidth: 0.5)
            )
    }
}
