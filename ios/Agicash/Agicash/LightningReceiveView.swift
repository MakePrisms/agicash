import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

/// One page of the Receive carousel — generate a BOLT-11 invoice and
/// watch the mint until it gets paid.
///
/// State machine:
///   - `amountEntry` → user types an amount on the numpad, hits
///     "Create invoice".
///   - `generating`  → spinner while `startMintQuote` runs (one mint
///     round-trip).
///   - `invoice`     → QR code + BOLT-11 + breakdown + countdown timer.
///     A long-running `Task` polls `pollMintQuote` every 2s; on PAID
///     transitions to `completing`.
///   - `completing`  → spinner while `completeMintQuote` mints proofs.
///   - `success`     → green check + "Received N sats". Auto-dismisses
///     the carousel after 4s; user can tap "Receive more" to bounce
///     back to amountEntry, or "Done" to dismiss now.
///   - `failure`     → inline error + "Try again" → amountEntry.
///
/// Mirrors `app/features/receive/receive-cashu.tsx` on the web (which
/// is the cashu-mint side of `/receive/cashu`) — same conceptual flow:
/// create quote → show QR → poll → success.
struct LightningReceiveView: View {
    @Bindable var model: WalletViewModel
    let onDismissCarousel: () -> Void

    enum Phase: Equatable {
        case amountEntry
        case generating
        case invoice(MintQuoteHandle)
        case completing(MintQuoteHandle)
        case success(ReceiveResult)
        case failure(String)
    }

    @State private var amountBuffer: String = "0"
    @State private var phase: Phase = .amountEntry
    /// Long-running poll task. Held so we can cancel it when the view
    /// disappears, the user hits Cancel, or the polled state moves
    /// past UNPAID.
    @State private var pollTask: Task<Void, Never>?
    /// Auto-dismiss timer on the success state.
    @State private var autoDismissTask: Task<Void, Never>?
    /// Display unit. Sat-mode (BTC) only for now — the FFI accepts
    /// `currency: "USD"` but the LightningReceiveView ships sats-only
    /// to keep the numpad opinionated. USD support is a follow-up.
    private let currency = "BTC"
    private let unitLabel = "sats"
    private var allowsDecimal: Bool { false } // sats are integer

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
        case .generating:
            ProgressView("Requesting invoice from mint…")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .invoice(let handle):
            InvoiceView(
                handle: handle,
                onCancel: cancelInvoice,
                onCopy: copyInvoice
            )
        case .completing:
            ProgressView("Minting proofs…")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .success(let result):
            SuccessCard(
                result: result,
                onReceiveMore: resetToAmountEntry,
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
                Text("Receive over Lightning")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }
            .frame(maxWidth: .infinity)

            AmountNumpad(value: $amountBuffer, allowsDecimal: allowsDecimal)
                .padding(.horizontal, Spacing.l)

            BrandButton(
                "Create invoice",
                variant: .primary,
                size: .large,
                isDisabled: !isAmountValid,
                action: { Task { await createInvoice() } }
            )
            .padding(.horizontal, Spacing.l)

            Spacer(minLength: Spacing.l)
        }
    }

    // MARK: - amount parsing

    /// Format the raw buffer with thousands separators for the display
    /// strip. Leaves trailing decimal-in-progress states intact
    /// (`"12."` renders as `"12."` not `"12"`) so the user can see
    /// they're mid-decimal.
    private var displayAmount: String {
        guard let n = UInt64(amountBuffer) else {
            // Mid-decimal or empty — show the raw buffer.
            return amountBuffer.isEmpty ? "0" : amountBuffer
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        return formatter.string(from: NSNumber(value: n)) ?? amountBuffer
    }

    private var parsedAmount: UInt64? {
        // Drop a trailing dot ("12." → "12") and parse.
        let clean = amountBuffer.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return UInt64(clean)
    }

    private var isAmountValid: Bool {
        guard let n = parsedAmount else { return false }
        return n > 0
    }

    // MARK: - actions

    private func createInvoice() async {
        guard let amount = parsedAmount, amount > 0 else { return }
        phase = .generating
        let outcome = await model.startLightningQuote(
            amount: amount,
            accountId: nil,
            currency: currency
        )
        switch outcome {
        case .success(let handle):
            phase = .invoice(handle)
            startPolling(handle)
        case .failure(let message):
            phase = .failure(message)
        }
    }

    private func startPolling(_ handle: MintQuoteHandle) {
        pollTask?.cancel()
        pollTask = Task {
            // Poll every 2s. Keep going while the view is alive and
            // we're still on the .invoice phase for this handle.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 2_000_000_000)
                if Task.isCancelled { return }
                let outcome = await model.pollLightningQuote(quoteId: handle.quoteId)
                if Task.isCancelled { return }
                switch outcome {
                case .state(let state, let reason):
                    switch state {
                    case .unpaid:
                        // Keep polling.
                        continue
                    case .paid:
                        await MainActor.run { phase = .completing(handle) }
                        await completeQuote(handle)
                        return
                    case .completed:
                        // Server already minted — treat as success.
                        await MainActor.run { phase = .completing(handle) }
                        await completeQuote(handle)
                        return
                    case .expired:
                        await MainActor.run {
                            phase = .failure("Invoice expired before payment. Try again.")
                        }
                        return
                    case .failed:
                        await MainActor.run {
                            phase = .failure(reason ?? "Quote failed.")
                        }
                        return
                    }
                case .failure(let message):
                    // Network blip — log via UI but keep polling so a
                    // transient failure doesn't kick the user out of
                    // the invoice screen. The user can hit Cancel.
                    _ = message
                    continue
                }
            }
        }
    }

    private func completeQuote(_ handle: MintQuoteHandle) async {
        let outcome = await model.completeLightningQuote(quoteId: handle.quoteId)
        switch outcome {
        case .success(let result):
            phase = .success(result)
            scheduleAutoDismiss()
        case .failure(let message):
            phase = .failure(message)
        }
    }

    private func cancelInvoice() {
        pollTask?.cancel()
        phase = .amountEntry
    }

    private func copyInvoice(_ invoice: String) {
        UIPasteboard.general.string = invoice
        UINotificationFeedbackGenerator().notificationOccurred(.success)
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
            try? await Task.sleep(nanoseconds: 4_000_000_000)
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

// MARK: - Invoice card

/// Invoice presentation: QR code + truncated BOLT-11 + amount + fee.
/// The QR is generated synchronously via CoreImage — for a 256pt code
/// it takes <5ms on modern iPhones, no async needed.
private struct InvoiceView: View {
    let handle: MintQuoteHandle
    let onCancel: () -> Void
    let onCopy: (String) -> Void

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.l) {
                Spacer(minLength: Spacing.l)

                VStack(spacing: Spacing.xs) {
                    HStack(alignment: .lastTextBaseline, spacing: 4) {
                        Text(handle.amount)
                            .font(.brandNumericInline)
                            .foregroundStyle(Color.brandForeground)
                            .monospacedDigit()
                        Text(handle.unit)
                            .font(.brandLabel)
                            .foregroundStyle(Color.brandMutedForeground)
                    }
                    Text("Waiting for payment…")
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }

                if let qr = qrCode(for: handle.invoice) {
                    Image(uiImage: qr)
                        .interpolation(.none)
                        .resizable()
                        .frame(width: 240, height: 240)
                        .padding(Spacing.s)
                        .background(Color.white)
                        .cornerRadius(Radius.control)
                } else {
                    RoundedRectangle(cornerRadius: Radius.control)
                        .fill(Color.brandMuted)
                        .frame(width: 240, height: 240)
                        .overlay(Text("QR unavailable").font(.brandCaption))
                }

                Button(action: { onCopy(handle.invoice) }) {
                    HStack(spacing: Spacing.xs) {
                        Text(truncated(handle.invoice))
                            .font(.brandCaption)
                            .foregroundStyle(Color.brandMutedForeground)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Image(systemName: "doc.on.doc")
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
                .frame(maxWidth: 280)

                if !handle.fee.isEmpty, handle.fee != "0" {
                    HStack {
                        Text("Mint fee")
                            .font(.brandLabel)
                            .foregroundStyle(Color.brandMutedForeground)
                        Spacer()
                        Text("\(handle.fee) \(handle.unit)")
                            .font(.brandLabel)
                            .foregroundStyle(Color.brandForeground)
                    }
                    .padding(.horizontal, Spacing.m)
                    .frame(maxWidth: 280)
                }

                BrandButton(
                    "Cancel",
                    variant: .ghost,
                    action: onCancel
                )
                .frame(maxWidth: 280)

                Spacer(minLength: Spacing.l)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private func truncated(_ s: String) -> String {
        guard s.count > 24 else { return s }
        let head = s.prefix(12)
        let tail = s.suffix(8)
        return "\(head)…\(tail)"
    }

    /// Synchronously render a BOLT-11 string into a `UIImage` QR code.
    /// CoreImage's `CIQRCodeGenerator` produces a tiny raw bitmap; we
    /// scale it up via a sample affine transform so the image is
    /// crisp at 240pt. `interpolation(.none)` on the SwiftUI side
    /// preserves the hard edges.
    private func qrCode(for string: String) -> UIImage? {
        let data = string.data(using: .utf8) ?? Data()
        let filter = CIFilter.qrCodeGenerator()
        filter.setValue(data, forKey: "inputMessage")
        filter.setValue("M", forKey: "inputCorrectionLevel")
        guard let output = filter.outputImage else { return nil }
        let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
        let context = CIContext()
        guard let cg = context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

// MARK: - Success + failure

private struct SuccessCard: View {
    let result: ReceiveResult
    let onReceiveMore: () -> Void
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.xxl)
            VStack(spacing: Spacing.m) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(Color.green)
                Text("Received")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(result.amount)
                        .font(.brandNumericInline)
                        .foregroundStyle(Color.brandCardForeground)
                        .monospacedDigit()
                    Text(result.unit)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
            .brandCard()
            .frame(maxWidth: 384)

            VStack(spacing: Spacing.m) {
                BrandButton(
                    "Receive more",
                    variant: .secondary,
                    action: onReceiveMore
                )
                BrandButton(
                    "Done",
                    variant: .primary,
                    action: onDone
                )
            }
            .frame(maxWidth: 384)

            Spacer(minLength: Spacing.xxl)
        }
    }
}

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
                Text("Couldn't receive")
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
                BrandButton(
                    "Try again",
                    variant: .primary,
                    action: onRetry
                )
                BrandButton(
                    "Dismiss",
                    variant: .ghost,
                    action: onDismiss
                )
            }
            .frame(maxWidth: 384)

            Spacer(minLength: Spacing.xxl)
        }
    }
}
