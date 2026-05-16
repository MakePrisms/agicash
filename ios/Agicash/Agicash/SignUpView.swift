import SwiftUI

/// Sign-up screen. Mirrors the web `Signup` step machine in
/// `app/features/signup/signup.tsx`: a `pick-option` → `signup-with-email`
/// flow rendered as a single `Card`.
///
/// The web flow has three options on `pick-option` (email, Google, guest)
/// plus an Accept Terms interstitial before each one. iOS v0:
///   - Email: full form with confirm-password.
///   - Google: button rendered, action is a no-op (matches the deferred
///     Google OAuth scope from `LoginView`).
///   - Guest: ghost button, wired to `wallet.authGuest()` (same path the
///     login screen uses; the operator requires guest on every client).
///   - Accept Terms: out of scope for v0; the web form gates on it but
///     iOS does not collect it yet (parity with the existing login screen).
///
/// Presented as a `fullScreenCover` from `LoginView` rather than as a step
/// inside it — the web puts signup on its own route (`/signup`) so the
/// modal cover is the closest iOS analogue without introducing a
/// `NavigationStack`.
struct SignUpView: View {
    @Bindable var model: WalletViewModel
    let onDismiss: () -> Void

    enum Step { case pickOption, email }

    @State private var step: Step = .pickOption
    @State private var email: String = ""
    @State private var password: String = ""
    @State private var confirmPassword: String = ""
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case email, password, confirmPassword
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xxl) {
                Spacer(minLength: Spacing.hero)

                Image("AgicashLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: 56)
                    .accessibilityLabel("Agicash")

                Group {
                    switch step {
                    case .pickOption:
                        SignUpOptionsCard(
                            isWorking: model.isWorking,
                            onPickEmail: { step = .email },
                            onPickGoogle: {
                                // Google OAuth deferred (same as LoginView).
                            },
                            onPickGuest: {
                                Task { await model.signInAsGuest() }
                            },
                            onPickLogIn: dismissBackToLogin
                        )
                    case .email:
                        SignUpFormCard(
                            email: $email,
                            password: $password,
                            confirmPassword: $confirmPassword,
                            focusedField: $focusedField,
                            isWorking: model.isWorking,
                            errorMessage: model.loginErrorMessage,
                            onSignUp: {
                                focusedField = nil
                                Task {
                                    await model.signUpWithEmail(
                                        email: email,
                                        password: password,
                                        confirmPassword: confirmPassword
                                    )
                                }
                            },
                            onBack: {
                                focusedField = nil
                                step = .pickOption
                            },
                            onPickLogIn: dismissBackToLogin
                        )
                    }
                }
                .padding(.horizontal, Spacing.l)

                Spacer(minLength: Spacing.xxl)
            }
            .frame(maxWidth: .infinity)
        }
        .background(Color.brandBackground.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }

    /// Tear down the cover and clear any in-progress signup error so the
    /// LoginView is presented clean.
    private func dismissBackToLogin() {
        focusedField = nil
        model.loginErrorMessage = nil
        onDismiss()
    }
}

/// Mirrors `SignupOptions` from `app/features/signup/signup-options.tsx`.
/// The web includes an `AcceptTerms` interstitial; iOS v0 routes straight
/// through (parity with login). Guest button is rendered unconditionally
/// (matches LoginView's "always show guest" rule).
private struct SignUpOptionsCard: View {
    let isWorking: Bool
    let onPickEmail: () -> Void
    let onPickGoogle: () -> Void
    let onPickGuest: () -> Void
    let onPickLogIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Sign Up")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Choose your preferred sign-up method")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.l) {
                BrandButton(
                    "Create wallet with Email",
                    variant: .primary,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onPickEmail
                )
                BrandButton(
                    "Create wallet with Google",
                    variant: .primary,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onPickGoogle
                )
                BrandButton(
                    "Create wallet as guest",
                    variant: .ghost,
                    isLoading: isWorking,
                    isDisabled: isWorking,
                    action: onPickGuest
                )

                Button(action: onPickLogIn) {
                    HStack(spacing: 4) {
                        Text("Already have an account?")
                            .foregroundStyle(Color.brandCardForeground)
                        Text("Log in")
                            .underline()
                            .foregroundStyle(Color.brandCardForeground)
                    }
                    .font(.brandLabel)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isWorking)
            }
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }
}

/// Mirrors `SignupForm` from `app/features/signup/signup-form.tsx`.
/// Three inputs (email, password, confirm-password); validation lives in
/// `WalletViewModel.signUpWithEmail` so the error string flows through
/// the existing `loginErrorMessage` channel.
private struct SignUpFormCard: View {
    @Binding var email: String
    @Binding var password: String
    @Binding var confirmPassword: String
    var focusedField: FocusState<SignUpView.Field?>.Binding
    let isWorking: Bool
    let errorMessage: String?
    let onSignUp: () -> Void
    let onBack: () -> Void
    let onPickLogIn: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Sign Up")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Enter your email & password below to setup a wallet")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.l) {
                VStack(alignment: .leading, spacing: Spacing.s) {
                    Text("Email")
                        .font(.brandLabelEmphasis)
                        .foregroundStyle(Color.brandCardForeground)
                    TextField("satoshi@nakamoto.com", text: $email)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        .autocorrectionDisabled()
                        .textContentType(.username)
                        .submitLabel(.next)
                        .focused(focusedField, equals: .email)
                        .onSubmit { focusedField.wrappedValue = .password }
                        .textFieldStyle(BrandTextFieldStyle(
                            isFocused: focusedField.wrappedValue == .email
                        ))
                }

                VStack(alignment: .leading, spacing: Spacing.s) {
                    Text("Password")
                        .font(.brandLabelEmphasis)
                        .foregroundStyle(Color.brandCardForeground)
                    SecureField("", text: $password)
                        .textContentType(.newPassword)
                        .submitLabel(.next)
                        .focused(focusedField, equals: .password)
                        .onSubmit { focusedField.wrappedValue = .confirmPassword }
                        .brandSecureFieldChrome(
                            isFocused: focusedField.wrappedValue == .password
                        )
                }

                VStack(alignment: .leading, spacing: Spacing.s) {
                    Text("Confirm Password")
                        .font(.brandLabelEmphasis)
                        .foregroundStyle(Color.brandCardForeground)
                    SecureField("", text: $confirmPassword)
                        .textContentType(.newPassword)
                        .submitLabel(.go)
                        .focused(focusedField, equals: .confirmPassword)
                        .onSubmit(onSignUp)
                        .brandSecureFieldChrome(
                            isFocused: focusedField.wrappedValue == .confirmPassword
                        )
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandDestructive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                BrandButton(
                    "Create Wallet",
                    variant: .primary,
                    isLoading: isWorking,
                    action: onSignUp
                )

                BrandButton(
                    "Back",
                    variant: .ghost,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onBack
                )

                Button(action: onPickLogIn) {
                    HStack(spacing: 4) {
                        Text("Already have a wallet?")
                            .foregroundStyle(Color.brandCardForeground)
                        Text("Log in")
                            .underline()
                            .foregroundStyle(Color.brandCardForeground)
                    }
                    .font(.brandLabel)
                    .frame(maxWidth: .infinity)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(isWorking)
            }
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }
}
