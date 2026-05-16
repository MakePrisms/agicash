import SwiftUI

/// Top-level app shell. Reads the bootstrap result + auth phase from the
/// shared `WalletState` / `WalletViewModel` and routes to the right screen.
struct ContentView: View {
    @Bindable var state: WalletState

    var body: some View {
        Group {
            switch state.result {
            case .pending:
                ProgressView("Starting Agicash…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AppTheme.background.ignoresSafeArea())
            case .failed(let message):
                FatalErrorView(message: message)
            case .ready(let model):
                @Bindable var model = model
                AuthGateView(model: model)
            }
        }
    }
}

/// Switches between the login screen and the signed-in tab shell based on
/// `WalletViewModel.phase`. The intermediate `.checking` state shows a small
/// spinner so a quick Keychain rehydrate doesn't flash the login UI.
struct AuthGateView: View {
    @Bindable var model: WalletViewModel

    var body: some View {
        switch model.phase {
        case .checking:
            ProgressView("Loading session…")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(AppTheme.background.ignoresSafeArea())
        case .signedOut:
            LoginView(model: model)
        case .signedIn:
            RootTabView(model: model)
        case .error(let message):
            VStack(spacing: 16) {
                Image(systemName: "exclamationmark.octagon")
                    .font(.largeTitle)
                    .foregroundStyle(AppTheme.destructive)
                Text("Something went wrong")
                    .font(.headline)
                Text(message)
                    .font(.callout)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(AppTheme.mutedForeground)
                    .padding(.horizontal)
                Button("Sign out and retry") {
                    Task { await model.signOut() }
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(AppTheme.background.ignoresSafeArea())
        }
    }
}

/// Two-tab signed-in shell: Home (accounts overview) + Settings (sign out).
/// Mirrors the web app's bottom-of-screen split between the index route
/// (balance + actions) and `/settings` (profile + accounts + sign-out).
struct RootTabView: View {
    @Bindable var model: WalletViewModel

    enum Tab: Hashable { case home, settings }

    @State private var selected: Tab = .home

    var body: some View {
        TabView(selection: $selected) {
            HomeView(model: model)
                .tabItem { Label("Home", systemImage: "house.fill") }
                .tag(Tab.home)

            SettingsView(model: model)
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(Tab.settings)
        }
        .tint(.orange)
    }
}

private struct FatalErrorView: View {
    let message: String

    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.largeTitle)
                .foregroundStyle(AppTheme.destructive)
            Text("Failed to start")
                .font(.headline)
            Text(message)
                .font(.callout)
                .multilineTextAlignment(.center)
                .foregroundStyle(AppTheme.mutedForeground)
                .padding(.horizontal)
        }
        .padding()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
    }
}
