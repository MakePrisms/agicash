import SwiftUI

/// Visual analogue of the Card row in
/// `app/features/settings/accounts/all-accounts.tsx`: name on the left,
/// formatted balance on the right, optional badges underneath.
///
/// Phase 1 always renders balance "0" because the Rust FFI hard-codes it
/// (see `AccountFfi`). The `unit` field is also empty, so we render the
/// account currency next to the balance for now.
struct AccountRow: View {
    let account: AccountFfi

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: iconName(for: account.accountType))
                .font(.title3)
                .foregroundStyle(.orange)
                .frame(width: 28, height: 28)

            VStack(alignment: .leading, spacing: 2) {
                Text(account.name)
                    .font(.body)
                    .foregroundStyle(AppTheme.foreground)
                if let url = account.mintUrl, !url.isEmpty {
                    Text(url)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.tertiaryForeground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                HStack(spacing: 6) {
                    AccountTypeBadge(accountType: account.accountType)
                    Text(account.currency)
                        .font(.caption.monospaced())
                        .foregroundStyle(AppTheme.mutedForeground)
                }
            }

            Spacer()

            VStack(alignment: .trailing, spacing: 2) {
                Text(displayBalance)
                    .font(.headline.monospacedDigit())
                    .foregroundStyle(AppTheme.foreground)
                if !account.unit.isEmpty {
                    Text(account.unit)
                        .font(.caption2)
                        .foregroundStyle(AppTheme.mutedForeground)
                }
            }
        }
        .padding(.vertical, 10)
        .padding(.horizontal, 14)
        .frame(maxWidth: .infinity)
        .cardBackground()
    }

    private var displayBalance: String {
        // Phase 1 returns "0" for every account. Render that as "0 <currency>"
        // so the row reads naturally even before the proofs layer ships.
        if account.unit.isEmpty {
            return "\(account.balance) \(account.currency)"
        }
        return account.balance
    }

    private func iconName(for accountType: String) -> String {
        switch accountType {
        case "cashu": return "creditcard.fill"
        case "spark": return "bolt.fill"
        default: return "circle.fill"
        }
    }
}

private struct AccountTypeBadge: View {
    let accountType: String

    var body: some View {
        Text(accountType.uppercased())
            .font(.caption2.weight(.semibold))
            .foregroundStyle(AppTheme.mutedForeground)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(
                Capsule().fill(AppTheme.muted)
            )
            .overlay(
                Capsule().stroke(AppTheme.border, lineWidth: 0.5)
            )
    }
}
