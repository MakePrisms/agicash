import SwiftUI

/// Settings screen. Mirrors `app/features/settings/settings.tsx`:
///
///   - User identity at the top (lightning address-style row, large text,
///     copy affordance).
///   - SettingsNavButton stack: Edit profile, Accounts, Contacts.
///   - Accounts list (we collapse "Settings → Accounts" into the same
///     scroll for v0 since the `AccountFfi` set is the only signed-in
///     content we currently have).
///   - Footer with the Sign Out CTA, terms/privacy links.
struct SettingsView: View {
    @Bindable var model: WalletViewModel

    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.xxl) {
                    IdentityRow(model: model)
                        .padding(.horizontal, Spacing.l)
                        .padding(.top, Spacing.l)

                    SettingsNavStack()
                        .padding(.horizontal, Spacing.l)

                    AccountListSection(
                        accounts: model.accounts,
                        title: "Accounts"
                    )
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
}

/// Visual analogue of `LnAddressDisplay` from web settings: a row with the
/// user identity on the left (large monospace text) and a copy icon on the
/// right. We don't have a lightning address yet so we render the truncated
/// user UUID — same layout, same affordance.
private struct IdentityRow: View {
    let model: WalletViewModel

    var body: some View {
        HStack {
            Text(displayUserId)
                .font(.system(.title2, design: .monospaced).weight(.semibold))
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
    var body: some View {
        VStack(spacing: 0) {
            SettingsNavRow(icon: "square.and.pencil", label: "Edit profile")
            SettingsNavRow(icon: "creditcard", label: "Accounts")
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

/// Web `PageFooter` with a sign-out button at the top, then a row of
/// terms/privacy links underneath. Web wraps the button in a centered
/// 144pt (`w-36`) column; we mirror that.
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
            .frame(maxWidth: 220)

            HStack(spacing: Spacing.s) {
                Text("Terms")
                    .underline()
                Text("&")
                Text("Privacy")
                    .underline()
            }
            .font(.brandCaption)
            .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(maxWidth: .infinity)
    }
}
