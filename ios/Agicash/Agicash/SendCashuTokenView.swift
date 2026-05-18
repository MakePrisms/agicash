import SwiftUI
import UIKit

/// One page of the Send carousel — pick an amount, produce a Cashu
/// token, share it, watch for the receiver to claim.
///
/// State machine:
///   - `amountEntry`  → numpad + Continue (mirrors
///     `LightningReceiveView.amountEntryView`).
///   - `quoting`      → spinner while `prepareSend` runs.
///   - `confirming(quote)` → fee breakdown card; user taps Send.
///   - `swapping`     → spinner while `createSend` runs.
///   - `share(handle)` → token + copy + iOS share sheet. A long-running
///     `Task` polls `pollSendClaim` every 3s; on `.completed` flips to
///     `claimed`.
///   - `claimed(handle)` → green check + "Sent". Auto-dismisses after
///     3s; user can tap Done sooner.
///   - `failure(message)` → inline error + retry → amountEntry.
///
/// Mirrors `app/features/send/send-input.tsx` (amount entry),
/// `app/features/send/send-confirmation.tsx` (fee breakdown),
/// `app/features/send/share-cashu-token.tsx` (share view), and the
/// receiver-claim watcher in `cashu-send-swap-hooks.useTrackCashuSendSwap`.
struct SendCashuTokenView: View {
    @Bindable var model: WalletViewModel
    let onDismissCarousel: () -> Void

    enum Phase: Equatable {
        case amountEntry
        case quoting
        case confirming(SendQuotePreview)
        case swapping
        case share(SendSwapHandle)
        case claimed(SendSwapHandle)
        case failure(String)
    }

    @State private var amountBuffer: String = "0"
    @State private var phase: Phase = .amountEntry
    /// Long-running poll task. Held so we can cancel on disappear /
    /// dismiss / completion.
    @State private var pollTask: Task<Void, Never>?
    /// Auto-dismiss timer on the claimed state.
    @State private var autoDismissTask: Task<Void, Never>?
    /// Drives the iOS share sheet.
    @State private var showShareSheet: Bool = false
    /// Toast-style "copied!" overlay flag.
    @State private var showCopied: Bool = false

    /// BTC-only / sats-only for v0. USD send arrives when the FFI
    /// `prepare_send_quote(currency: Some("USD"))` path is exercised
    /// behind a currency toggle in a follow-up.
    private let currency = "BTC"
    private let unitLabel = "sats"
    private var allowsDecimal: Bool { false }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onDisappear {
            pollTask?.cancel()
            autoDismissTask?.cancel()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .amountEntry:
            amountEntryView
        case .quoting:
            ProgressView("Preparing send…")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .confirming(let quote):
            ConfirmCard(
                quote: quote,
                onSend: { Task { await commitSend() } },
                onCancel: resetToAmountEntry
            )
            .padding(.horizontal, Spacing.l)
        case .swapping:
            ProgressView("Producing token…")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .share(let handle):
            ShareCard(
                handle: handle,
                showCopied: showCopied,
                onCopy: { copyToken(handle.token) },
                onShare: { showShareSheet = true },
                onCancel: dismissNow
            )
            .padding(.horizontal, Spacing.l)
            .sheet(isPresented: $showShareSheet) {
                ShareSheet(items: [handle.token])
            }
        case .claimed(let handle):
            ClaimedCard(
                handle: handle,
                onDone: dismissNow
            )
            .padding(.horizontal, Spacing.l)
        case .failure(let message):
            FailureCard(
                message: message,
                onRetry: resetToAmountEntry,
                onDismiss: dismissNow
            )
            .padding(.horizontal, Spacing.l)
        }
    }

    private var amountEntryView: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.l)

            VStack(spacing: Spacing.xs) {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(displayAmount)
                        .font(.brandNumericHero)
                        .foregroundStyle(Color.brandForeground)
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(unitLabel)
                        .font(.brandTitleSmall)
                        .foregroundStyle(Color.brandMutedForeground)
                        .baselineOffset(8)
                }
                Text("Send Cashu token")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }
            .frame(maxWidth: .infinity)

            AmountNumpad(value: $amountBuffer, allowsDecimal: allowsDecimal)
                .padding(.horizontal, Spacing.l)

            BrandButton(
                "Continue",
                variant: .primary,
                size: .large,
                isDisabled: !isAmountValid,
                action: { Task { await startQuote() } }
            )
            .padding(.horizontal, Spacing.l)

            Spacer(minLength: Spacing.l)
        }
    }

    // MARK: - amount parsing (same shape as LightningReceiveView)

    private var displayAmount: String {
        guard let n = UInt64(amountBuffer) else {
            return amountBuffer.isEmpty ? "0" : amountBuffer
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        return formatter.string(from: NSNumber(value: n)) ?? amountBuffer
    }

    private var parsedAmount: UInt64? {
        let clean = amountBuffer.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return UInt64(clean)
    }

    private var isAmountValid: Bool {
        guard let n = parsedAmount else { return false }
        return n > 0
    }

    // MARK: - actions

    private func startQuote() async {
        guard let amount = parsedAmount, amount > 0 else { return }
        phase = .quoting
        let outcome = await model.prepareSend(
            amount: amount,
            accountId: nil,
            currency: currency
        )
        switch outcome {
        case .success(let quote):
            phase = .confirming(quote)
        case .failure(let message):
            phase = .failure(message)
        }
    }

    private func commitSend() async {
        guard let amount = parsedAmount, amount > 0 else { return }
        phase = .swapping
        let outcome = await model.createSend(
            amount: amount,
            accountId: nil,
            currency: currency
        )
        switch outcome {
        case .success(let handle):
            phase = .share(handle)
            startPollingClaim(handle)
        case .failure(let message):
            phase = .failure(message)
        }
    }

    private func startPollingClaim(_ handle: SendSwapHandle) {
        pollTask?.cancel()
        pollTask = Task {
            // Poll every 3s. Cadence matches the spec — slower than
            // Lightning Receive's 2s because the share screen is less
            // time-sensitive than waiting on an incoming invoice.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { return }
                let outcome = await model.pollSendClaim(swapId: handle.swapId)
                if Task.isCancelled { return }
                switch outcome {
                case .state(let state, let reason):
                    switch state {
                    case .pending:
                        continue
                    case .completed:
                        await MainActor.run { phase = .claimed(handle) }
                        scheduleAutoDismiss()
                        return
                    case .failed:
                        await MainActor.run {
                            phase = .failure(reason ?? "Send failed.")
                        }
                        return
                    }
                case .failure(let message):
                    // Transient — keep polling. The user can hit Cancel.
                    _ = message
                    continue
                }
            }
        }
    }

    private func copyToken(_ token: String) {
        UIPasteboard.general.string = token
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        showCopied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { showCopied = false }
        }
    }

    private func resetToAmountEntry() {
        pollTask?.cancel()
        autoDismissTask?.cancel()
        amountBuffer = "0"
        phase = .amountEntry
    }

    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled {
                await MainActor.run { dismissNow() }
            }
        }
    }

    private func dismissNow() {
        pollTask?.cancel()
        autoDismissTask?.cancel()
        onDismissCarousel()
    }
}

// MARK: - Confirm card

private struct ConfirmCard: View {
    let quote: SendQuotePreview
    let onSend: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Confirm send")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Producing a token the receiver can claim")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.s) {
                amountRow("They receive", value: quote.amountToSend, unit: quote.unit, prominent: true)
                amountRow("Send fee", value: quote.cashuSendFee, unit: quote.unit)
                amountRow("Receive fee", value: quote.cashuReceiveFee, unit: quote.unit)
                Divider()
                amountRow("You pay", value: quote.totalAmount, unit: quote.unit, prominent: true)
            }

            VStack(spacing: Spacing.s) {
                BrandButton("Send", variant: .primary, action: onSend)
                BrandButton("Cancel", variant: .ghost, action: onCancel)
            }
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }

    private func amountRow(_ label: String, value: String, unit: String, prominent: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(prominent ? .brandLabelEmphasis : .brandLabel)
                .foregroundStyle(prominent ? Color.brandCardForeground : Color.brandMutedForeground)
            Spacer()
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value)
                    .font(prominent ? .brandLabelEmphasis : .brandLabel)
                    .foregroundStyle(Color.brandCardForeground)
                    .monospacedDigit()
                Text(unit)
                    .font(.brandCaption)
                    .foregroundStyle(Color.brandMutedForeground)
            }
        }
    }
}

// MARK: - Share card

private struct ShareCard: View {
    let handle: SendSwapHandle
    let showCopied: Bool
    let onCopy: () -> Void
    let onShare: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: Spacing.l) {
            VStack(spacing: Spacing.xs) {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(handle.amount)
                        .font(.brandNumericInline)
                        .foregroundStyle(Color.brandCardForeground)
                        .monospacedDigit()
                    Text(handle.unit)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
                HStack(spacing: Spacing.xs) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Waiting for receiver…")
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
            }

            Button(action: onCopy) {
                HStack(spacing: Spacing.xs) {
                    Text(truncated(handle.token))
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandMutedForeground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Image(systemName: showCopied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.brandMutedForeground)
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.s)
                .background(
                    RoundedRectangle(cornerRadius: Radius.control)
                        .fill(Color.brandMuted)
                )
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 320)

            VStack(spacing: Spacing.s) {
                BrandButton("Share", variant: .primary, action: onShare)
                BrandButton("Cancel", variant: .ghost, action: onCancel)
            }
            .frame(maxWidth: 320)
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }

    private func truncated(_ s: String) -> String {
        guard s.count > 24 else { return s }
        let head = s.prefix(12)
        let tail = s.suffix(8)
        return "\(head)…\(tail)"
    }
}

// MARK: - Claimed card

private struct ClaimedCard: View {
    let handle: SendSwapHandle
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.xxl)
            VStack(spacing: Spacing.m) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(Color.green)
                Text("Sent")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(handle.amount)
                        .font(.brandNumericInline)
                        .foregroundStyle(Color.brandCardForeground)
                        .monospacedDigit()
                    Text(handle.unit)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
            .brandCard()
            .frame(maxWidth: 384)

            BrandButton("Done", variant: .primary, action: onDone)
                .frame(maxWidth: 384)

            Spacer(minLength: Spacing.xxl)
        }
    }
}

// MARK: - Failure card (same shape as LightningReceiveView's)

private struct FailureCard: View {
    let message: String
    let onRetry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.xxl)
            VStack(spacing: Spacing.m) {
                Image(systemName: "xmark.octagon.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.brandDestructive)
                Text("Couldn't send")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text(message)
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
            .brandCard()
            .frame(maxWidth: 384)

            VStack(spacing: Spacing.m) {
                BrandButton("Try again", variant: .primary, action: onRetry)
                BrandButton("Dismiss", variant: .ghost, action: onDismiss)
            }
            .frame(maxWidth: 384)

            Spacer(minLength: Spacing.xxl)
        }
    }
}

// MARK: - UIActivityViewController bridge

/// Bridges `UIActivityViewController` (iOS share sheet) into SwiftUI.
/// Used by `SendCashuTokenView` to share the encoded Cashu token via
/// the native share sheet (Messages, Mail, Notes, AirDrop, etc.).
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
