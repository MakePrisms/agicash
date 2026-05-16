import SwiftUI

/// Add Mint sheet — the iOS analogue of the web's
/// `/settings/accounts/create/cashu` route
/// (`app/features/settings/accounts/add-mint-form.tsx`), collapsed into a
/// modal sheet because the parent Accounts screen is already a navigation
/// destination and pushing another stack frame for one TextField felt
/// heavier than necessary.
///
/// Web form fields: `name` + `mintUrl` (both required). iOS v0 collects
/// only `mintUrl` — the FFI hard-codes the mint's NUT-06 name as the
/// account name (same fallback the CLI uses), so we don't need a separate
/// Name field for parity. The web's optional `name` slot becomes future
/// work (`mint_add(url:name:)` parameter) once it stops being a stylistic
/// flourish; today the mint name reads cleanly without it.
///
/// State machine:
///   - `entry`     — URL field + Add button + Cancel.
///   - `working`   — Add button shows a spinner; field is locked.
///   - `success`   — replaces the form with a success card; auto-dismisses
///                   after 1.5s OR the user can tap Done.
///   - `error`     — inline destructive message under the field; user can
///                   edit + retry without dismissing.
///
/// Mirrors `ReceiveView`'s structure intentionally — the two flows have
/// the same "paste a string, call an FFI, surface the outcome" shape.
struct AddMintView: View {
    @Bindable var model: WalletViewModel
    let onDismiss: () -> Void

    enum Phase: Equatable {
        case entry
        case working
        case success(MintAddResult)
        case error(String)
    }

    @State private var url: String = ""
    @State private var phase: Phase = .entry
    @FocusState private var urlFocused: Bool
    /// Auto-dismiss timer task. Held so we can cancel it if the user taps
    /// Done (or the view disappears) before the timeout fires.
    @State private var autoDismissTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Spacing.xxl) {
                    Spacer(minLength: Spacing.l)

                    Image("AgicashLogo")
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(height: 40)
                        .accessibilityHidden(true)

                    Group {
                        switch phase {
                        case .entry, .working, .error:
                            AddMintFormCard(
                                url: $url,
                                urlFocused: $urlFocused,
                                isWorking: phase == .working,
                                errorMessage: errorMessageForCurrentPhase,
                                onPaste: pasteFromClipboard,
                                onAdd: { Task { await submit() } },
                                onCancel: dismiss
                            )
                        case .success(let result):
                            AddMintSuccessCard(
                                result: result,
                                onDone: dismiss
                            )
                        }
                    }
                    .padding(.horizontal, Spacing.l)

                    Spacer(minLength: Spacing.xxl)
                }
                .frame(maxWidth: .infinity)
            }
            .background(Color.brandBackground.ignoresSafeArea())
            .navigationTitle("Add Mint")
            .navigationBarTitleDisplayMode(.inline)
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", action: dismiss)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandForeground)
                        .disabled(phase == .working)
                }
            }
        }
        .onAppear { urlFocused = true }
        .onDisappear { autoDismissTask?.cancel() }
    }

    private var errorMessageForCurrentPhase: String? {
        if case .error(let message) = phase {
            return message
        }
        return nil
    }

    private func pasteFromClipboard() {
        guard let pasted = UIPasteboard.general.string else { return }
        url = pasted
        if case .error = phase { phase = .entry }
    }

    private func submit() async {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            phase = .error("Enter a mint URL first.")
            return
        }
        urlFocused = false
        phase = .working
        let outcome = await model.addMint(url: trimmed)
        switch outcome {
        case .success(let result):
            phase = .success(result)
            scheduleAutoDismiss()
        case .failure(let message):
            phase = .error(message)
        }
    }

    /// Auto-dismiss 1.5s after success — shorter than receive (2s) because
    /// the user just typed a URL and is ready to see the new account in
    /// the list behind the sheet.
    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            if !Task.isCancelled {
                await MainActor.run { dismiss() }
            }
        }
    }

    private func dismiss() {
        autoDismissTask?.cancel()
        urlFocused = false
        onDismiss()
    }
}

/// The URL + Add form. Mirrors `AddMintForm` on web: prominent input,
/// inline paste affordance, primary CTA, plus a helper line pointing at
/// bitcoinmints.com for discoverability.
private struct AddMintFormCard: View {
    @Binding var url: String
    var urlFocused: FocusState<Bool>.Binding
    let isWorking: Bool
    let errorMessage: String?
    let onPaste: () -> Void
    let onAdd: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            // Card header — mirrors web `space-y-1.5`.
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Add Cashu Mint")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Enter a mint URL to create a Cashu account for it.")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.l) {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    HStack {
                        Text("Mint URL")
                            .font(.brandLabelEmphasis)
                            .foregroundStyle(Color.brandCardForeground)
                        Spacer()
                        Button(action: onPaste) {
                            Text("Paste")
                                .font(.brandLabel)
                                .underline()
                                .foregroundStyle(Color.brandCardForeground)
                        }
                        .buttonStyle(.plain)
                        .disabled(isWorking)
                    }

                    TextField("https://mint.example.com", text: $url)
                        .textFieldStyle(BrandTextFieldStyle(isFocused: urlFocused.wrappedValue))
                        .focused(urlFocused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .keyboardType(.URL)
                        .submitLabel(.go)
                        .onSubmit(onAdd)
                        .disabled(isWorking)

                    // Web puts a "Search at bitcoinmints.com" + "Understand
                    // mint risks" line here. Skip the link (sheet can't
                    // navigate cleanly mid-add) but keep the discoverability
                    // hint as plain text — same information, no broken nav.
                    Text("Search trusted mints at bitcoinmints.com")
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandMutedForeground)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandDestructive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                BrandButton(
                    "Add",
                    variant: .primary,
                    isLoading: isWorking,
                    isDisabled: url.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    action: onAdd
                )

                BrandButton(
                    "Cancel",
                    variant: .ghost,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onCancel
                )
            }
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }
}

/// Success state shown after a mint is added. Echoes
/// `ReceiveSuccessCard`'s structure but renders mint name + URL + currency
/// instead of an amount.
private struct AddMintSuccessCard: View {
    let result: MintAddResult
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Mint added")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Your new account is ready to use.")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(alignment: .center, spacing: Spacing.s) {
                Text(result.mintName)
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                    .lineLimit(1)
                    .truncationMode(.tail)
                Text(result.mintUrl)
                    .font(.brandCaption)
                    .foregroundStyle(Color.brandMutedForeground)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Text(result.currency)
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }
            .frame(maxWidth: .infinity)

            BrandButton(
                "Done",
                variant: .primary,
                action: onDone
            )
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }
}
