import SwiftUI

/// One page of the Receive carousel — paste a Cashu token and claim it.
///
/// Refactor of the original `ReceiveView`'s `ReceiveFormCard` +
/// `ReceiveSuccessCard` extracted as a standalone view that lives
/// inside `ReceiveCarouselView`. The NavigationStack + toolbar + sheet
/// chrome are owned by the carousel host now.
///
/// State machine (unchanged from the original `ReceiveView`):
///   - `entry`     — paste field + Receive button.
///   - `working`   — Receive button shows a spinner; field is locked.
///   - `success`   — replaces the form with a success card; auto-dismisses
///                   the WHOLE carousel after 2s OR the user can tap Done.
///   - `error`     — inline destructive message under the field; user
///                   can edit + retry without dismissing.
///
/// The carousel-level dismiss callback is invoked when the user taps
/// "Done" in the success card or when the auto-dismiss timer fires.
/// The user can also swipe to another tab; we keep the local phase so
/// the tab remembers its state on swipe-back.
struct CashuTokenPasteView: View {
    @Bindable var model: WalletViewModel
    let onDismissCarousel: () -> Void

    enum Phase: Equatable {
        case entry
        case working
        case success(ReceiveResult)
        case error(String)
    }

    @State private var token: String = ""
    @State private var phase: Phase = .entry
    @FocusState private var tokenFocused: Bool
    /// Auto-dismiss timer task. Held so we can cancel it if the user
    /// taps Done (or the view disappears) before the 2-second timeout
    /// fires.
    @State private var autoDismissTask: Task<Void, Never>?

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xxl) {
                Spacer(minLength: Spacing.l)

                Group {
                    switch phase {
                    case .entry, .working, .error:
                        FormCard(
                            token: $token,
                            tokenFocused: $tokenFocused,
                            isWorking: phase == .working,
                            errorMessage: errorMessageForCurrentPhase,
                            onPaste: pasteFromClipboard,
                            onReceive: { Task { await submit() } }
                        )
                    case .success(let result):
                        SuccessCard(
                            result: result,
                            onDone: dismissNow
                        )
                    }
                }
                .padding(.horizontal, Spacing.l)

                Spacer(minLength: Spacing.xxl)
            }
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .onDisappear { autoDismissTask?.cancel() }
    }

    /// Surfaces the inline error string when (and only when) the
    /// current phase is `.error`. Working/entry states render a clean
    /// form so the previous failure doesn't bleed through after the
    /// user starts editing.
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

    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            if !Task.isCancelled {
                await MainActor.run { dismissNow() }
            }
        }
    }

    private func dismissNow() {
        autoDismissTask?.cancel()
        tokenFocused = false
        onDismissCarousel()
    }
}

/// Paste-token form card. Mirrors the original `ReceiveFormCard` but
/// without the surrounding `NavigationStack`/toolbar — the carousel
/// supplies the close affordance via its own toolbar.
private struct FormCard: View {
    @Binding var token: String
    var tokenFocused: FocusState<Bool>.Binding
    let isWorking: Bool
    let errorMessage: String?
    let onPaste: () -> Void
    let onReceive: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Receive Cashu")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Paste a Cashu token to claim it into your wallet")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.l) {
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
            }
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }
}

/// Success state shown after a token claims successfully. Same shape as
/// the original `ReceiveSuccessCard`.
private struct SuccessCard: View {
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
