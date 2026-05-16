import SwiftUI

/// Login screen. Mirrors the web `Login` step machine in
/// `app/features/login/login.tsx`: a two-step `pick-option` →
/// `login-with-email` flow, both rendered as a single `Card` centered on
/// the page.
///
/// Visual treatment is one-to-one with `app/features/login/login-options.tsx`
/// + `app/features/login/login-form.tsx`. The web has no brand mark on this
/// screen — just the card. We render the AgicashLogo above the card per the
/// project spec ("do not change AgicashLogo placement or asset"); the
/// wordmark, tagline, and "or" divider are iOS surplus and have been removed.
///
/// Guest auth: web doesn't expose this, but operator requires guest on all
/// clients (CLI, iOS, Android). Restored as a third (ghost-variant) button
/// on the pick-option step, matching Android's `LoginScreen` placement
/// convention. Wired to `wallet.authGuest()` via `signInAsGuest`.
struct LoginView: View {
    @Bindable var model: WalletViewModel

    enum Step { case pickOption, email }

    @State private var step: Step = .pickOption
    @State private var email: String = ""
    @State private var password: String = ""
    /// Drives presentation of `SignUpView` as a full-screen cover. The web
    /// uses a separate `/signup` route; on iOS we mirror that as a modal
    /// take-over so the existing nav stack stays untouched.
    @State private var showSignUp: Bool = false
    @FocusState private var focusedField: Field?

    enum Field: Hashable {
        case email, password
    }

    /// Open the Sign Up screen. Clears any leftover login error so it
    /// doesn't bleed across screens, then triggers the cover.
    private func openSignUp() {
        focusedField = nil
        model.loginErrorMessage = nil
        showSignUp = true
    }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.xxl) {
                Spacer(minLength: Spacing.hero)

                // Logo only (no wordmark, no tagline) — keep the asset in
                // place per spec, but match web's lack of header chrome
                // beyond a single mark.
                Image("AgicashLogo")
                    .resizable()
                    .aspectRatio(contentMode: .fit)
                    .frame(height: 56)
                    .accessibilityLabel("Agicash")

                Group {
                    switch step {
                    case .pickOption:
                        LoginOptionsCard(
                            isWorking: model.isWorking,
                            onPickEmail: { step = .email },
                            onPickGoogle: {
                                // Google OAuth is out of scope for v0;
                                // button still rendered to match web.
                            },
                            onPickGuest: {
                                Task { await model.signInAsGuest() }
                            },
                            onPickSignUp: openSignUp
                        )
                    case .email:
                        LoginFormCard(
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
                            onBack: {
                                focusedField = nil
                                step = .pickOption
                            },
                            onPickSignUp: openSignUp
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
        .fullScreenCover(isPresented: $showSignUp) {
            SignUpView(model: model, onDismiss: { showSignUp = false })
        }
    }
}

/// Mirrors `LoginOptions` from `app/features/login/login-options.tsx`:
///
///   <Card>
///     <CardHeader>
///       <CardTitle>Login</CardTitle>
///       <CardDescription>Choose your preferred login method</CardDescription>
///     </CardHeader>
///     <CardContent>
///       <Button>Log in with Email</Button>
///       <Button>Log in with Google</Button>
///       <div>Don't have an account? <Link>Sign up</Link></div>
///     </CardContent>
///   </Card>
private struct LoginOptionsCard: View {
    let isWorking: Bool
    let onPickEmail: () -> Void
    let onPickGoogle: () -> Void
    let onPickGuest: () -> Void
    let onPickSignUp: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            // CardHeader — `p-6 pb-0` on web, `space-y-1.5`.
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Login")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Choose your preferred login method")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            // CardContent — `grid gap-4` on web.
            VStack(spacing: Spacing.l) {
                BrandButton(
                    "Log in with Email",
                    variant: .primary,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onPickEmail
                )
                BrandButton(
                    "Log in with Google",
                    variant: .primary,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onPickGoogle
                )

                // Guest auth is required on all clients per operator intent
                // (web omits it intentionally, but iOS/Android/CLI must
                // expose it). Ghost variant keeps it visually subordinate
                // to the two primary login methods.
                BrandButton(
                    "Continue as guest",
                    variant: .ghost,
                    isLoading: isWorking,
                    isDisabled: isWorking,
                    action: onPickGuest
                )

                // `mt-4 text-center text-sm` — wrapped in a Button so the
                // "Sign up" target is tappable (web uses `<Link to="/signup">`).
                Button(action: onPickSignUp) {
                    HStack(spacing: 4) {
                        Text("Don't have an account?")
                            .foregroundStyle(Color.brandCardForeground)
                        Text("Sign up")
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
        .frame(maxWidth: 384) // `max-w-sm`
    }
}

/// Mirrors `LoginForm` from `app/features/login/login-form.tsx`:
///
///   <Card>
///     <CardHeader>
///       <CardTitle>Login</CardTitle>
///       <CardDescription>Enter your email below to login to your wallet</CardDescription>
///     </CardHeader>
///     <CardContent>
///       <form>
///         <Label>Email</Label> <Input placeholder="satoshi@nakamoto.com" />
///         <flex> <Label>Password</Label> <Link>Forgot your password?</Link> </flex>
///         <Input type=password />
///         <Button>Login</Button>
///         <Button variant="ghost">Back</Button>
///       </form>
///       <div>Don't have a wallet? <Link>Sign up</Link></div>
///     </CardContent>
///   </Card>
private struct LoginFormCard: View {
    @Binding var email: String
    @Binding var password: String
    var focusedField: FocusState<LoginView.Field?>.Binding
    let isWorking: Bool
    let errorMessage: String?
    let onSignIn: () -> Void
    let onBack: () -> Void
    let onPickSignUp: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            // CardHeader
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Login")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Enter your email below to login to your wallet")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            // CardContent — form
            VStack(spacing: Spacing.l) {
                // Email field group (`grid gap-2`).
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

                // Password field group with inline "Forgot your password?"
                // link (matches web's `<div className="flex items-center">`).
                VStack(alignment: .leading, spacing: Spacing.s) {
                    HStack {
                        Text("Password")
                            .font(.brandLabelEmphasis)
                            .foregroundStyle(Color.brandCardForeground)
                        Spacer()
                        Text("Forgot your password?")
                            .font(.brandLabel)
                            .underline()
                            .foregroundStyle(Color.brandCardForeground)
                    }
                    SecureField("", text: $password)
                        .textContentType(.password)
                        .submitLabel(.go)
                        .focused(focusedField, equals: .password)
                        .onSubmit(onSignIn)
                        .brandSecureFieldChrome(
                            isFocused: focusedField.wrappedValue == .password
                        )
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandDestructive)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                BrandButton(
                    "Login",
                    variant: .primary,
                    isLoading: isWorking,
                    action: onSignIn
                )

                BrandButton(
                    "Back",
                    variant: .ghost,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onBack
                )

                // `mt-4 text-center text-sm` — Button wrap so "Sign up" is
                // tappable (mirrors web's `<Link to="/signup">`).
                Button(action: onPickSignUp) {
                    HStack(spacing: 4) {
                        Text("Don't have a wallet?")
                            .foregroundStyle(Color.brandCardForeground)
                        Text("Sign up")
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
