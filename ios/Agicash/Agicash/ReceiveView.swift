import SwiftUI

/// Receive sheet — the iOS analogue of the web's
/// `app/features/receive/receive-input.tsx` + `receive-cashu-token.tsx`
/// pair, collapsed into a single screen because the iOS slice's only
/// supported flow is "paste a raw cashu token, claim it." Lightning
/// receive, on-chain, scan-QR, and account selection are out of scope
/// for this lane (the home grid's Receive button is the only entry
/// point).
///
/// State machine:
///   - `entry`     — paste field + Receive button + Cancel.
///   - `working`   — Receive button shows a spinner; field is locked.
///   - `success`   — replaces the form with a success card; auto-dismisses
///                   after 2s OR the user can tap Done.
///   - `error`     — inline destructive message under the field; user can
///                   edit + retry without dismissing.
///
/// Presented as a `.sheet` from `HomeView`. Uses the brand card chrome
/// so it reads as a focused step rather than a full-page route — the web
/// puts receive on its own route (`/receive`) but on iOS a modal sheet
/// is the closer-to-native equivalent and avoids the nav-stack rebuild
/// the existing `HomeView` would otherwise need.
struct ReceiveView: View {
    @Bindable var model: WalletViewModel
    let onDismiss: () -> Void

    enum Phase: Equatable {
        case entry
        case working
        case success(ReceiveResult)
        case error(String)
    }

    @State private var token: String = ""
    @State private var phase: Phase = .entry
    @FocusState private var tokenFocused: Bool
    /// Auto-dismiss timer task. Held so we can cancel it if the user taps
    /// Done (or the view disappears) before the 2-second timeout fires.
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
                            ReceiveFormCard(
                                token: $token,
                                tokenFocused: $tokenFocused,
                                isWorking: phase == .working,
                                errorMessage: errorMessageForCurrentPhase,
                                onPaste: pasteFromClipboard,
                                onReceive: { Task { await submit() } },
                                onCancel: dismiss
                            )
                        case .success(let result):
                            ReceiveSuccessCard(
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
            .navigationTitle("Receive")
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
        .onDisappear { autoDismissTask?.cancel() }
    }

    /// Surfaces the inline error string when (and only when) the current
    /// phase is `.error`. Working/entry states render a clean form so the
    /// previous failure doesn't bleed through after the user starts editing.
    private var errorMessageForCurrentPhase: String? {
        if case .error(let message) = phase {
            return message
        }
        return nil
    }

    private func pasteFromClipboard() {
        guard let pasted = UIPasteboard.general.string else { return }
        token = pasted
        // Drop any prior error so the form reads clean post-paste.
        if case .error = phase { phase = .entry }
    }

    /// Run the receive call. Trims whitespace (cashu tokens routinely
    /// arrive surrounded by newlines from messaging apps) and short-
    /// circuits on empty input so the FFI never sees a blank string.
    private func submit() async {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            phase = .error("Paste a Cashu token first.")
            return
        }
        tokenFocused = false
        phase = .working
        let outcome = await model.receive(token: trimmed)
        switch outcome {
        case .success(let result):
            phase = .success(result)
            scheduleAutoDismiss()
        case .failure(let message):
            phase = .error(message)
        }
    }

    /// Auto-dismiss the sheet 2 seconds after a successful receive so the
    /// user lands back on Home and sees the refreshed balance. Cancellable
    /// — if the user taps Done first we don't want a delayed dismiss to
    /// fire on top of whatever screen they navigated to next.
    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled {
                await MainActor.run { dismiss() }
            }
        }
    }

    private func dismiss() {
        autoDismissTask?.cancel()
        tokenFocused = false
        onDismiss()
    }
}

/// The paste + Receive form. Mirrors the visual structure of the web's
/// `receive-input.tsx`: token displayed prominently, paste affordance
/// inline, primary CTA at the bottom — but with a multi-line `TextEditor`
/// in place of the numeric input since real cashu tokens are 200-1000+
/// characters and don't fit a single-line field.
private struct ReceiveFormCard: View {
    @Binding var token: String
    var tokenFocused: FocusState<Bool>.Binding
    let isWorking: Bool
    let errorMessage: String?
    let onPaste: () -> Void
    let onReceive: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            // Card header — `space-y-1.5` on web.
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Receive Cashu")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Paste a Cashu token to claim it into your wallet")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.l) {
                // Token field group.
                VStack(alignment: .leading, spacing: Spacing.s) {
                    HStack {
                        Text("Token")
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

                    // Multi-line entry — cashu tokens are long base64-ish
                    // strings (a typical V4 token is 400-1000 chars) so a
                    // 4-line editor is a reasonable default. iOS 17+
                    // `TextEditor` honors monospace via `.font` plus
                    // `.scrollContentBackground(.hidden)` lets the brand
                    // card-background show through.
                    TextEditor(text: $token)
                        .font(.brandBody)
                        .foregroundStyle(Color.brandForeground)
                        .scrollContentBackground(.hidden)
                        .focused(tokenFocused)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .frame(minHeight: 96, maxHeight: 200)
                        .padding(Spacing.s)
                        .background(
                            RoundedRectangle(cornerRadius: Radius.control)
                                .fill(Color.brandBackground)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: Radius.control)
                                .stroke(
                                    tokenFocused.wrappedValue
                                        ? Color.brandRing : Color.brandInput,
                                    lineWidth: tokenFocused.wrappedValue ? 1.5 : 0.5
                                )
                        )
                        .disabled(isWorking)
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandDestructive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                BrandButton(
                    "Receive",
                    variant: .primary,
                    isLoading: isWorking,
                    isDisabled: token.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                    action: onReceive
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

/// Success state shown after a token claims successfully. Mirrors the
/// web's post-claim transaction page (`/transactions/:id`) but in-place:
/// title + amount + mint URL + Done button. Distinct from
/// "AlreadyClaimed" which we surface as a friendly note rather than a
/// celebration (no proofs were minted twice — the wallet is unchanged).
private struct ReceiveSuccessCard: View {
    let result: ReceiveResult
    let onDone: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text(headline)
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text(subhead)
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(alignment: .center, spacing: Spacing.s) {
                HStack(alignment: .lastTextBaseline, spacing: 6) {
                    Text(result.amount)
                        .font(.brandNumericInline)
                        .foregroundStyle(Color.brandCardForeground)
                        .monospacedDigit()
                    Text(result.unit)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
                Text(result.mintUrl)
                    .font(.brandCaption)
                    .foregroundStyle(Color.brandMutedForeground)
                    .lineLimit(1)
                    .truncationMode(.middle)
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

    /// Discriminate between the three success-ish statuses. AlreadyFailed
    /// gets routed through the form's error path so it's not handled here;
    /// Pending is treated like a soft success for UX purposes (the swap
    /// lives in storage and will reconcile on the next launch).
    private var headline: String {
        switch result.status {
        case .received:       return "Token received"
        case .alreadyClaimed: return "Already claimed"
        case .pending:        return "Pending"
        case .alreadyFailed:  return "Token unavailable"
        }
    }

    private var subhead: String {
        switch result.status {
        case .received:
            return "Proofs added to your wallet."
        case .alreadyClaimed:
            return "You've already redeemed this token — wallet is unchanged."
        case .pending:
            return "Swap is in progress. It will finish in the background."
        case .alreadyFailed:
            return "Someone else redeemed this token first."
        }
    }
}
