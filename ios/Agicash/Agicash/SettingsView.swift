import SwiftUI

/// Settings screen. Mirrors `app/features/settings/settings.tsx`:
///
///   - LnAddressDisplay at the top — large clickable text (`username@domain`)
///     with a copy icon.
///   - SettingsNavButton stack: Edit profile, {default account name}, Contacts.
///   - Footer: Sign Out CTA, Terms / Privacy links.
///
/// Web also renders a `ColorModeToggle` and a row of social icons (X, Nostr,
/// GitHub, Discord) in the footer; both are out of scope for the iOS pass
/// today. The previous iOS pass added an inline `AccountListSection` here —
/// removed for parity (web puts that under `/settings/accounts`).
struct SettingsView: View {
    @Bindable var model: WalletViewModel

    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    LnAddressDisplay(model: model)
                        .padding(.horizontal, Spacing.l)
                        .padding(.top, Spacing.l)

                    SettingsNavStack(defaultAccountLabel: defaultAccountLabel)
                        .padding(.horizontal, Spacing.l)

                    Spacer(minLength: Spacing.xxl)

                    SettingsFooter(
                        isWorking: model.isWorking,
                        onSignOut: { confirmingSignOut = true }
                    )
                    .padding(.horizontal, Spacing.l)
                    .padding(.bottom, Spacing.xxl)
                }
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandBackground.ignoresSafeArea())
            .navigationTitle("")
            .navigationBarTitleDisplayMode(.inline)
            .refreshable { await model.refreshAccounts() }
            .confirmationDialog(
                "Sign out of Agicash?",
                isPresented: $confirmingSignOut,
                titleVisibility: .visible
            ) {
                Button("Sign out", role: .destructive) {
                    Task { await model.signOut() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("Your local session will be cleared. You can sign back in any time.")
            }
        }
    }

    /// Web shows `{defaultAccount.name}` in the second nav row. We don't
    /// have a "default account" concept on iOS yet, so fall back to the
    /// first account's name, then "Accounts" if the list is empty.
    private var defaultAccountLabel: String {
        model.accounts.first?.name ?? "Accounts"
    }
}

/// Visual analogue of `LnAddressDisplay` from web settings: a row with the
/// user identity on the left (large monospace text) and a copy icon on the
/// right. We don't have a lightning address yet so we render the truncated
/// user UUID — same layout, same affordance.
private struct LnAddressDisplay: View {
    let model: WalletViewModel

    var body: some View {
        HStack {
            Text(displayUserId)
                .font(.brandTitle)
                .foregroundStyle(Color.brandForeground)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer()
            Image(systemName: "doc.on.doc")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
        }
    }

    private var displayUserId: String {
        if case .signedIn(let id) = model.phase {
            // Show prefix-domain style so it visually rhymes with
            // "satoshi@nakamoto.com"
            let short = String(id.prefix(8))
            return "\(short)@agicash"
        }
        return "—"
    }
}

/// Mirrors `SettingsNavButton` (`features/settings/ui/settings-nav-button.tsx`):
/// 40pt row, leading icon + label, trailing chevron. Borderless — the row
/// is its own affordance, no card chrome.
private struct SettingsNavStack: View {
    let defaultAccountLabel: String

    var body: some View {
        VStack(spacing: 0) {
            SettingsNavRow(icon: "square.and.pencil", label: "Edit profile")
            SettingsNavRow(icon: "creditcard", label: defaultAccountLabel)
            SettingsNavRow(icon: "person.2", label: "Contacts")
        }
    }
}

private struct SettingsNavRow: View {
    let icon: String
    let label: String

    var body: some View {
        HStack(spacing: Spacing.s) {
            Image(systemName: icon)
                .font(.brandLabel)
                .foregroundStyle(Color.brandForeground)
                .frame(width: 16)
            Text(label)
                .font(.brandBody)
                .foregroundStyle(Color.brandForeground)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.brandCaption)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(height: 40)
    }
}

/// Web `PageFooter`: a Sign Out button in a centered `w-36` (144pt) column,
/// then a row of "Terms & Privacy" links underneath in muted text.
private struct SettingsFooter: View {
    let isWorking: Bool
    let onSignOut: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            BrandButton(
                "Sign Out",
                variant: .primary,
                isLoading: isWorking,
                action: onSignOut
            )
            .frame(maxWidth: 144) // matches `w-36` on web.

            // `flex w-full justify-between text-muted-foreground text-sm`
            HStack {
                Text("Terms")
                    .underline()
                Spacer()
                Text("&")
                Spacer()
                Text("Privacy")
                    .underline()
            }
            .font(.brandLabel)
            .foregroundStyle(Color.brandMutedForeground)
            .frame(maxWidth: 144)
        }
        .frame(maxWidth: .infinity)
    }
}
