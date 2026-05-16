import SwiftUI

/// Settings → Accounts screen. Mirrors the web's `/settings/accounts` route
/// (`app/features/settings/accounts/all-accounts.tsx`): a full-screen list
/// of the user's accounts, each row showing the account name + balance,
/// plus a "Add Mint" affordance for provisioning a new Cashu mint.
///
/// The web puts the Add Mint CTA at the bottom of the list as a primary
/// button. On iOS we expose it as a `+` toolbar item (closer-to-native
/// nav surface) AND keep a primary button under the list for parity with
/// the web's centered CTA — the two affordances render the same sheet, so
/// users can tap whichever they reach first.
///
/// Pull-to-refresh re-runs `wallet.listAccounts()` since `mint_add` calls
/// already auto-refresh on success but a fresh server view is still
/// useful when accounts were created on another device.
///
/// Empty state mirrors web's behaviour: when the user has no accounts yet
/// (brand-new guest, pre-first-mint-add) the list is replaced with a
/// friendly call-to-action that points at the Add Mint flow.
struct AccountsView: View {
    @Bindable var model: WalletViewModel

    /// Drives presentation of `AddMintView` as a sheet. Stays at this
    /// level (not on the toolbar button) so the sheet's dismiss path is
    /// the same regardless of which CTA the user tapped.
    @State private var showAddMint: Bool = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                if model.accounts.isEmpty {
                    EmptyAccountsCard(onAddMint: { showAddMint = true })
                        .padding(.horizontal, Spacing.l)
                        .padding(.top, Spacing.xxl)
                } else {
                    VStack(spacing: Spacing.s) {
                        ForEach(model.accounts, id: \.id) { account in
                            AccountRow(account: account)
                        }
                    }
                    .padding(.horizontal, Spacing.l)
                    .padding(.top, Spacing.l)

                    // Primary CTA mirrors the web's centered "Add Mint"
                    // button below the list. Use the more action-specific
                    // label "Add Mint" (web says "Add Account" but this
                    // slice only wires the Cashu/mint flow).
                    BrandButton(
                        "Add Mint",
                        variant: .primary,
                        size: .large,
                        action: { showAddMint = true }
                    )
                    .frame(maxWidth: 288)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, Spacing.l)
                    .padding(.top, Spacing.xxl)
                }
            }
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(Color.brandBackground.ignoresSafeArea())
        .navigationTitle("Accounts")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refreshAccounts() }
        .task { await model.refreshAccounts() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button(action: { showAddMint = true }) {
                    Image(systemName: "plus")
                        .font(.brandLabelEmphasis)
                        .foregroundStyle(Color.brandForeground)
                }
                .accessibilityLabel("Add mint")
            }
        }
        .sheet(isPresented: $showAddMint) {
            AddMintView(
                model: model,
                onDismiss: { showAddMint = false }
            )
        }
    }
}

/// Empty state: render when the user has zero accounts. Visually echoes the
/// web's empty-list treatment (the web actually renders nothing today —
/// iOS adds a friendlier nudge because a blank screen looks broken).
private struct EmptyAccountsCard: View {
    let onAddMint: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("No accounts yet")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Add a Cashu mint to start using your wallet.")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            BrandButton(
                "Add Mint",
                variant: .primary,
                action: onAddMint
            )
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: .infinity)
    }
}
