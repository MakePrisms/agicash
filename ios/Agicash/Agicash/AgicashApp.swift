import SwiftUI

@main
struct AgicashApp: App {
    @State private var walletState: WalletState

    init() {
        self.walletState = WalletState()
    }

    var body: some Scene {
        WindowGroup {
            ContentView(state: walletState)
                .task { await walletState.bootstrap() }
        }
    }
}

/// Thin wrapper that defers `WalletViewModel` initialization (which can fail
/// if the underlying FFI rejects the configured URLs) and lets ContentView
/// pull either a model or a fatal error out of it.
@MainActor
@Observable
final class WalletState {
    enum BootResult {
        case pending
        case ready(WalletViewModel)
        case failed(String)
    }

    var result: BootResult = .pending

    func bootstrap() async {
        switch result {
        case .pending:
            break
        case .ready, .failed:
            return
        }
        do {
            let model = try WalletViewModel()
            result = .ready(model)
            if !applyDemoSignedInIfRequested(model: model) {
                await model.bootstrap()
            }
        } catch {
            result = .failed("init failed: \(error)")
        }
    }

    /// Debug-only: when launched with `-AgicashDemoSignedIn YES` (CLI flag
    /// or Xcode scheme argument), skip the bootstrap call to OpenSecret +
    /// Supabase and seed a fake signed-in state with mock accounts. Used to
    /// capture screenshots of the home / settings flow without standing up
    /// the local enclave + Supabase stack.
    ///
    /// Production behaviour is unchanged: the flag is read from the process
    /// argument list, which the Phase 1 dev simulator launch can pass but a
    /// real device install never receives.
    @discardableResult
    private func applyDemoSignedInIfRequested(model: WalletViewModel) -> Bool {
        #if DEBUG
        let argsHasDemo = CommandLine.arguments.contains("-AgicashDemoSignedIn")
            || ProcessInfo.processInfo.arguments.contains("-AgicashDemoSignedIn")
            || (UserDefaults.standard.string(forKey: "AgicashDemoSignedIn") == "YES")
        guard argsHasDemo else { return false }
        model.isDemoMode = true
        model.phase = .signedIn(userId: "11111111-2222-3333-4444-555555555555")
        model.accounts = [
            AccountFfi(
                id: "demo-cashu-btc",
                name: "Default BTC",
                accountType: "cashu",
                currency: "BTC",
                mintUrl: "https://mint.agicash.dev",
                balance: "0",
                unit: "sat"
            ),
            AccountFfi(
                id: "demo-cashu-usd",
                name: "Default USD",
                accountType: "cashu",
                currency: "USD",
                mintUrl: "https://mint.agicash.dev",
                balance: "0",
                unit: "cent"
            ),
            AccountFfi(
                id: "demo-spark-btc",
                name: "Spark Lightning",
                accountType: "spark",
                currency: "BTC",
                mintUrl: nil,
                balance: "0",
                unit: "sat"
            ),
        ]
        return true
        #else
        return false
        #endif
    }
}
