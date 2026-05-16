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
