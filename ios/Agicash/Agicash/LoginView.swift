import SwiftUI

/// Login screen. Mirrors the web `LoginOptions` + `LoginForm` flow: a small
/// card centered on the page with a title, description, an email/password
/// form, and a guest option.
///
/// Phase 1 wires both branches to `WalletViewModel` (`signInWithEmail` and
/// `signInAsGuest`). Google OAuth, signup, and forgot-password are out of
/// scope for v0.
struct LoginView: View {
    @Bindable var model: WalletViewModel

    @State private var email: String = ""
    @State private var password: String = ""
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case email, password
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                Spacer(minLength: 60)

                BrandHeader()

                LoginCard(
                    email: $email,
                    password: $password,
                    focusedField: $focusedField,
                    isWorking: model.isWorking,
                    errorMessage: model.loginErrorMessage,
                    onSignIn: {
                        focusedField = nil
                        Task {
                            await model.signInWithEmail(
                                email: email, password: password
                            )
                        }
                    },
                    onGuest: {
                        focusedField = nil
                        Task { await model.signInAsGuest() }
                    }
                )
                .padding(.horizontal, AppTheme.horizontalPadding)

                Spacer(minLength: 40)
            }
            .frame(maxWidth: .infinity)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct BrandHeader: View {
    var body: some View {
        VStack(spacing: 10) {
            Image("AgicashLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 64)
                .accessibilityLabel("Agicash")
            Text("Agicash")
                .font(.largeTitle.bold())
            Text("Self-custody Bitcoin wallet")
                .font(.subheadline)
                .foregroundStyle(AppTheme.mutedForeground)
        }
    }
}

private struct LoginCard: View {
    @Binding var email: String
    @Binding var password: String
    var focusedField: FocusState<LoginView.Field?>.Binding
    let isWorking: Bool
    let errorMessage: String?
    let onSignIn: () -> Void
    let onGuest: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Login")
                    .font(.title2.bold())
                Text("Enter your email below to login to your wallet.")
                    .font(.subheadline)
                    .foregroundStyle(AppTheme.mutedForeground)
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Email")
                    .font(.subheadline.weight(.medium))
                TextField("satoshi@nakamoto.com", text: $email)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .autocorrectionDisabled()
                    .textContentType(.username)
                    .submitLabel(.next)
                    .focused(focusedField, equals: .email)
                    .onSubmit { focusedField.wrappedValue = .password }
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                            .fill(AppTheme.muted)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                            .stroke(AppTheme.border, lineWidth: 0.5)
                    )
            }

            VStack(alignment: .leading, spacing: 8) {
                Text("Password")
                    .font(.subheadline.weight(.medium))
                SecureField("••••••••", text: $password)
                    .textContentType(.password)
                    .submitLabel(.go)
                    .focused(focusedField, equals: .password)
                    .onSubmit(onSignIn)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                            .fill(AppTheme.muted)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: AppTheme.controlCornerRadius)
                            .stroke(AppTheme.border, lineWidth: 0.5)
                    )
            }

            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(AppTheme.destructive)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            Button(action: onSignIn) {
                HStack {
                    if isWorking {
                        ProgressView()
                            .progressViewStyle(.circular)
                            .tint(.white)
                    }
                    Text("Login")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.borderedProminent)
            .tint(AppTheme.foreground)
            .foregroundStyle(AppTheme.background)
            .disabled(isWorking)

            HStack {
                Rectangle().fill(AppTheme.border).frame(height: 0.5)
                Text("or")
                    .font(.caption)
                    .foregroundStyle(AppTheme.mutedForeground)
                Rectangle().fill(AppTheme.border).frame(height: 0.5)
            }

            Button(action: onGuest) {
                HStack {
                    Image(systemName: "person.crop.circle.badge.plus")
                    Text("Continue as guest")
                        .fontWeight(.medium)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            .buttonStyle(.bordered)
            .disabled(isWorking)
        }
        .padding(20)
        .cardBackground()
        .frame(maxWidth: 420)
    }
}
