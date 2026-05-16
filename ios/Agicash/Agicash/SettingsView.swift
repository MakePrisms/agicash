import SwiftUI

/// Settings screen. Mirrors `app/features/settings/settings.tsx` and the
/// "Accounts" sub-page (`app/features/settings/accounts/all-accounts.tsx`):
/// user identity at top, navigation rows, an accounts list, and a sign-out
/// CTA at the bottom.
///
/// In v0 we collapse the "Settings → Accounts" sub-route into the same
/// scroll. Sub-navigation can grow back when we have more settings to show.
struct SettingsView: View {
    @Bindable var model: WalletViewModel

    @State private var confirmingSignOut = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    UserCard(model: model)
                        .padding(.horizontal, AppTheme.horizontalPadding)

                    AccountListSection(
                        accounts: model.accounts,
                        title: "Accounts"
                    )
                    .padding(.horizontal, AppTheme.horizontalPadding)

                    SignOutSection(
                        isWorking: model.isWorking,
                        onSignOut: { confirmingSignOut = true }
                    )
                    .padding(.horizontal, AppTheme.horizontalPadding)
                    .padding(.top, 8)
                }
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("Settings")
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

private struct UserCard: View {
    let model: WalletViewModel

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Signed in")
                .font(.caption)
                .foregroundStyle(AppTheme.mutedForeground)
            Text(displayUserId)
                .font(.callout.monospaced())
                .foregroundStyle(AppTheme.foreground)
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    private var displayUserId: String {
        if case .signedIn(let id) = model.phase {
            return id
        }
        return "—"
    }
}

private struct SignOutSection: View {
    let isWorking: Bool
    let onSignOut: () -> Void

    var body: some View {
        Button(role: .destructive, action: onSignOut) {
            HStack {
                if isWorking {
                    ProgressView()
                        .progressViewStyle(.circular)
                        .tint(AppTheme.destructive)
                } else {
                    Image(systemName: "rectangle.portrait.and.arrow.right")
                }
                Text("Sign out")
                    .fontWeight(.semibold)
            }
            .frame(maxWidth: .infinity)
            .padding(.vertical, 12)
        }
        .buttonStyle(.bordered)
        .tint(AppTheme.destructive)
        .disabled(isWorking)
    }
}
