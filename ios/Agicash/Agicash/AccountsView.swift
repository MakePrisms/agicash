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
/// Default account UX: each non-default row reveals a "Set as default"
/// action on swipe-left (iOS Mail-style). Tapping it calls the FFI
/// `setDefaultAccount`, which PATCHes the user row's
/// `default_<currency>_account_id` slot (mirroring the web's
/// `UserService.setDefaultAccount`). Rows reorder so the new default sits
/// on top, matching the web's `AccountService.getExtendedAccounts.sort`.
///
/// Pull-to-refresh re-runs `wallet.listAccounts()` + `wallet.getUser()` so
/// the badge stays correct if the default flipped on another device.
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

    /// Inline error surfaced as an alert when the swipe action's FFI
    /// call fails (network, RLS rejection, etc.). Nil when no error is
    /// pending. SwiftUI binds the alert's presentation to the non-nil
    /// case.
    @State private var setDefaultError: String?

    var body: some View {
        Group {
            if model.accounts.isEmpty {
                emptyState
            } else {
                populatedList
            }
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
        .alert(
            "Could not set default",
            isPresented: Binding(
                get: { setDefaultError != nil },
                set: { if !$0 { setDefaultError = nil } }
            ),
            presenting: setDefaultError
        ) { _ in
            Button("OK", role: .cancel) { setDefaultError = nil }
        } message: { message in
            Text(message)
        }
    }

    /// Empty path: ScrollView preserves pull-to-refresh + matches the
    /// pre-swipe behaviour for users with zero accounts. (`List` won't
    /// render a refreshable empty view here without juggling section
    /// padding, and there are no rows to swipe on anyway.)
    private var emptyState: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                EmptyAccountsCard(onAddMint: { showAddMint = true })
                    .padding(.horizontal, Spacing.l)
                    .padding(.top, Spacing.xxl)
            }
            .padding(.bottom, Spacing.xxl)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    /// Populated path: `List` for native swipe-actions support. Brand
    /// chrome is preserved by hiding the system list background and
    /// neutralizing the row separators / row backgrounds — each
    /// `AccountRow` keeps its `brandCard()` look, identical to the
    /// previous `ScrollView { VStack }` pass.
    ///
    /// The primary "Add Mint" CTA sits in a List footer section so it
    /// scrolls naturally with the rows (sticky-bottom CTAs interact
    /// badly with the swipe gesture's edge tracking).
    private var populatedList: some View {
        List {
            Section {
                ForEach(model.sortedAccounts, id: \.id) { account in
                    AccountRow(account: account, isDefault: model.isDefault(account))
                        .listRowBackground(Color.clear)
                        .listRowSeparator(.hidden)
                        .listRowInsets(EdgeInsets(
                            top: Spacing.xs,
                            leading: Spacing.l,
                            bottom: Spacing.xs,
                            trailing: Spacing.l
                        ))
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            if !model.isDefault(account) {
                                Button {
                                    Task { await handleSetDefault(account) }
                                } label: {
                                    // SwiftUI renders the label inside the
                                    // system action chip (rounded rect,
                                    // fixed height). Label gives both glyph
                                    // and verb so VoiceOver picks both up.
                                    Label("Set as default", systemImage: "star.fill")
                                }
                                .tint(Color.brandPrimary)
                            }
                        }
                }
            } header: {
                // Top spacing without a literal "header" string — keeps
                // the visual cadence of the previous ScrollView pass.
                Color.clear
                    .frame(height: Spacing.s)
                    .listRowInsets(EdgeInsets())
            } footer: {
                VStack {
                    BrandButton(
                        "Add Mint",
                        variant: .primary,
                        size: .large,
                        action: { showAddMint = true }
                    )
                    .frame(maxWidth: 288)
                    .frame(maxWidth: .infinity)
                    .padding(.top, Spacing.xxl)
                    .padding(.bottom, Spacing.xxl)
                }
                .listRowInsets(EdgeInsets())
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
    }

    private func handleSetDefault(_ account: AccountFfi) async {
        let outcome = await model.setDefaultAccount(account)
        if case .failure(let message) = outcome {
            setDefaultError = message
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
