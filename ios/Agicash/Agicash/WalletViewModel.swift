import Foundation
import Observation

/// Phase 1 wallet view model. Holds the `AgicashWallet` UniFFI handle, an
/// auth phase, and the cached accounts list. SwiftUI observes the @Observable
/// state and rerenders on every change.
///
/// Phase 1 talks to local OpenSecret + local Supabase (see `Endpoints`).
/// Endpoint overrides land in Phase 2+ as the app gets a settings UI.
@MainActor
@Observable
final class WalletViewModel {
    enum Phase: Equatable {
        /// Bootstrapping: deciding whether to show the sign-in screen or the
        /// accounts list. We start here at app launch while we attempt to
        /// rehydrate a Keychain-stored session.
        case checking
        case signedOut
        case signedIn(userId: String)
        case error(String)
    }

    /// Hard-coded Phase 1 dev endpoints. The iOS simulator inherits the
    /// host's network namespace, so `127.0.0.1` reaches whatever the
    /// developer is running locally — the enclave on port 3999 and the
    /// supabase stack on 54321.
    enum Endpoints {
        static let opensecretURL = "http://127.0.0.1:3999"
        static let opensecretClientID = "ba5a14b5-d915-47b1-b7b1-afda52bc5fc6"
        static let supabaseURL = "https://127.0.0.1:54321"
        // Local supabase publishable anon key (same one used by the JS app +
        // the integration tests; not a secret).
        static let supabaseAnonKey =
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
    }

    var phase: Phase = .checking
    var accounts: [AccountFfi] = []
    var isWorking = false
    /// Inline message shown on the login screen when an interactive sign-in
    /// attempt fails. Cleared on the next attempt. Distinct from `phase ==
    /// .error(...)` which represents a fatal/unexpected error blocking the
    /// whole app.
    var loginErrorMessage: String?
    /// Debug-only marker set by the `-AgicashDemoSignedIn` launch flag in
    /// `AgicashApp`. When true, `refreshAccounts` and `signOut` short-circuit
    /// so the seeded mock accounts stay visible (the FFI calls would
    /// otherwise hit Supabase and either replace the mocks with empty data
    /// or surface a network error). Production builds never set this.
    var isDemoMode: Bool = false

    private let wallet: AgicashWallet

    init() throws {
        self.wallet = try AgicashWallet(
            opensecretUrl: Endpoints.opensecretURL,
            opensecretClientIdUuid: Endpoints.opensecretClientID,
            supabaseUrl: Endpoints.supabaseURL,
            supabaseAnonKey: Endpoints.supabaseAnonKey
        )
    }

    /// Attempt to rehydrate a Keychain session. Called on app launch.
    func bootstrap() async {
        do {
            guard let stored = try SessionStore.load() else {
                phase = .signedOut
                return
            }
            try await wallet.setSession(
                userIdUuid: stored.userId,
                refreshToken: stored.refreshToken
            )
            phase = .signedIn(userId: stored.userId)
            await refreshAccounts()
        } catch let err as SessionStoreError {
            phase = .error("session load failed: \(err)")
        } catch let err as FfiError {
            // Rehydration failed (refresh token rejected). Drop the
            // Keychain copy so we don't keep retrying on every launch.
            try? SessionStore.clear()
            phase = .signedOut
            _ = err
        } catch {
            phase = .error("unexpected: \(error)")
        }
    }

    func signInAsGuest() async {
        await runSignIn { try await self.wallet.authGuest() }
    }

    func signInWithEmail(email: String, password: String) async {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEmail.isEmpty, !password.isEmpty else {
            loginErrorMessage = "Email and password are required."
            return
        }
        await runSignIn {
            try await self.wallet.authLogin(
                email: trimmedEmail, password: password
            )
        }
    }

    /// Register a new email + password account against OpenSecret. Mirrors
    /// the web `/signup` flow: on success the user is auto-signed-in and
    /// routed into the wallet (the FFI returns the same `Session` shape as
    /// `authLogin`). The web form requires confirm-password and an
    /// 8-character minimum; we enforce both here so the FFI never sees a
    /// mismatched pair. `name` is intentionally not collected — the web
    /// doesn't either, and the FFI accepts `nil`.
    func signUpWithEmail(email: String, password: String, confirmPassword: String) async {
        let trimmedEmail = email.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedEmail.isEmpty, !password.isEmpty else {
            loginErrorMessage = "Email and password are required."
            return
        }
        guard password.count >= 8 else {
            loginErrorMessage = "Password must have at least 8 characters."
            return
        }
        guard password == confirmPassword else {
            loginErrorMessage = "Passwords do not match."
            return
        }
        await runSignIn {
            try await self.wallet.authSignup(
                email: trimmedEmail, password: password, name: nil
            )
        }
    }

    private func runSignIn(_ call: @escaping () async throws -> Session) async {
        isWorking = true
        loginErrorMessage = nil
        defer { isWorking = false }
        do {
            let session = try await call()
            try SessionStore.save(
                PersistedSession(
                    userId: session.userId,
                    refreshToken: session.refreshToken
                )
            )
            phase = .signedIn(userId: session.userId)
            await refreshAccounts()
        } catch let err as FfiError {
            loginErrorMessage = ffiErrorMessage(err)
        } catch let err as SessionStoreError {
            loginErrorMessage = "session save failed: \(err)"
        } catch {
            loginErrorMessage = "unexpected: \(error)"
        }
    }

    func signOut() async {
        isWorking = true
        defer { isWorking = false }
        if isDemoMode {
            accounts = []
            loginErrorMessage = nil
            isDemoMode = false
            phase = .signedOut
            return
        }
        do {
            try await wallet.authLogout()
        } catch {
            // Best-effort; clear local state regardless.
        }
        try? SessionStore.clear()
        accounts = []
        loginErrorMessage = nil
        phase = .signedOut
    }

    /// Outcome shape returned to `ReceiveView`. Success carries the FFI
    /// `ReceiveResult` so the view can render amount/mint/etc. directly;
    /// failure carries a presentation-ready string already mapped through
    /// `ffiErrorMessage` so the view doesn't need to know about FFI shapes.
    enum ReceiveOutcome {
        case success(ReceiveResult)
        case failure(String)
    }

    /// Redeem a Cashu token. Mirrors the auth methods' `runSignIn` shape:
    /// flips `isWorking` for the duration so the calling view can render a
    /// spinner, refreshes the accounts list on success so the home
    /// balance updates without an extra round-trip, and translates FFI
    /// errors into user-readable strings via the existing helper.
    ///
    /// Note: this method intentionally does NOT mutate `phase` on
    /// failure (that's what `runSignIn` does because failed sign-ins
    /// stay on the login screen). Receive failures stay inside the
    /// receive sheet — the caller renders them inline.
    func receive(token: String) async -> ReceiveOutcome {
        let trimmed = token.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .failure("Paste a Cashu token first.")
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let result = try await wallet.receiveToken(token: trimmed)
            // Refresh so Home's balance/accounts list reflects the new
            // proofs without forcing the user to pull-to-refresh.
            await refreshAccounts()
            return .success(result)
        } catch let err as FfiError {
            return .failure(ffiErrorMessage(err))
        } catch {
            return .failure("unexpected: \(error)")
        }
    }

    /// Outcome shape returned to `AddMintView`. Mirrors `ReceiveOutcome`:
    /// success carries the FFI `MintAddResult` so the sheet can show the
    /// new mint's name/URL inline; failure carries a presentation-ready
    /// string already mapped through `ffiErrorMessage`.
    enum AddMintOutcome {
        case success(MintAddResult)
        case failure(String)
    }

    /// Provision a new Cashu mint and refresh the accounts list. Mirrors
    /// the web `AddMintForm` (`app/features/settings/accounts/add-mint-form.tsx`):
    /// the form trims and submits the URL, the wallet talks NUT-06 to the
    /// mint, the new `wallet.accounts` row gets inserted, and the local
    /// cache refreshes so the Accounts screen reflects the new row without
    /// a pull-to-refresh.
    ///
    /// Empty / whitespace-only URLs short-circuit with a friendly inline
    /// error so the FFI never sees a blank string. All other errors funnel
    /// through `FfiError` and surface as a single user-readable message.
    func addMint(url: String) async -> AddMintOutcome {
        let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .failure("Enter a mint URL first.")
        }
        isWorking = true
        defer { isWorking = false }
        do {
            let result = try await wallet.mintAdd(url: trimmed)
            await refreshAccounts()
            return .success(result)
        } catch let err as FfiError {
            return .failure(ffiErrorMessage(err))
        } catch {
            return .failure("unexpected: \(error)")
        }
    }

    func refreshAccounts() async {
        if isDemoMode { return }
        do {
            let list = try await wallet.listAccounts()
            accounts = list
        } catch let err as FfiError {
            phase = .error("list accounts failed: \(ffiErrorMessage(err))")
        } catch {
            phase = .error("unexpected: \(error)")
        }
    }

    private func ffiErrorMessage(_ err: FfiError) -> String {
        switch err {
        case .Auth(let code, let message):
            return "auth/\(code): \(message)"
        case .Storage(let code, let message):
            return "storage/\(code): \(message)"
        case .Internal(let message):
            return message
        }
    }
}
