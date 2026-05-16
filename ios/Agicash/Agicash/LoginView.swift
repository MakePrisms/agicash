import SwiftUI

/// Login screen. Mirrors the web `LoginOptions` + `LoginForm` flow: a small
/// card centered on the page with a title, description, an email/password
/// form, and a guest option. Visual treatment is one-to-one with
/// `app/components/ui/card.tsx` (rounded-lg + hairline border + xs shadow)
/// + `~/components/ui/button.tsx` (rounded-md, primary = near-black) +
/// `~/components/ui/input.tsx` (40pt, rounded-md, hairline border).
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
            VStack(spacing: Spacing.xxl) {
                Spacer(minLength: Spacing.hero)

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
                .padding(.horizontal, Spacing.l)

                Spacer(minLength: Spacing.xxl)
            }
            .frame(maxWidth: .infinity)
        }
        .background(Color.brandBackground.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
    }
}

private struct BrandHeader: View {
    var body: some View {
        VStack(spacing: Spacing.s) {
            // Keep the AgicashLogo asset as-is per spec.
            Image("AgicashLogo")
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(height: 64)
                .accessibilityLabel("Agicash")
            Text("Agicash")
                .font(.brandTitleLarge)
                .foregroundStyle(Color.brandForeground)
            Text("Self-custody Bitcoin wallet")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
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
        // Card outer chrome — matches `<Card>` from
        // `app/components/ui/card.tsx`. `CardHeader` is `p-6 pb-0`,
        // `CardContent` is `p-6` → so the card has 24pt inset everywhere.
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
                // Email field group (mirrors the web `grid gap-2`).
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

                // Password field group with "Forgot your password?" inline
                // link (matches web's `<div className="flex items-center">`).
                VStack(alignment: .leading, spacing: Spacing.s) {
                    HStack {
                        Text("Password")
                            .font(.brandLabelEmphasis)
                            .foregroundStyle(Color.brandCardForeground)
                        Spacer()
                        // Web has an inline "Forgot your password?" link
                        // here; signup + forgot-password are out of scope
                        // for v0 (see file header). We render a disabled
                        // sibling so layout matches.
                        Text("Forgot your password?")
                            .font(.brandCaption)
                            .underline()
                            .foregroundStyle(Color.brandMutedForeground)
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

                // Web's `LoginOptions` separates email and guest with a
                // gap-4 grid; we mirror that by rendering both buttons
                // stacked. The "or" divider is a familiar shadcn motif
                // and reads well as a divider between the two paths.
                HStack(spacing: Spacing.m) {
                    Rectangle().fill(Color.brandBorder).frame(height: 0.5)
                    Text("or")
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandMutedForeground)
                    Rectangle().fill(Color.brandBorder).frame(height: 0.5)
                }

                BrandButton(
                    variant: .secondary,
                    isLoading: false,
                    isDisabled: isWorking,
                    action: onGuest
                ) {
                    HStack(spacing: Spacing.s) {
                        Image(systemName: "person.crop.circle.badge.plus")
                        Text("Continue as guest")
                    }
                }

                // Mirrors web's `mt-4 text-center text-sm "Don't have a
                // wallet? Sign up"`. Signup not wired in v0.
                HStack(spacing: 4) {
                    Text("Don't have a wallet?")
                        .foregroundStyle(Color.brandCardForeground)
                    Text("Sign up")
                        .underline()
                        .foregroundStyle(Color.brandCardForeground)
                }
                .font(.brandCaption)
                .frame(maxWidth: .infinity)
            }
        }
        .padding(Spacing.xxl) // matches `p-6` on web Card.
        .brandCard()
        .frame(maxWidth: 384) // matches `max-w-sm` on web Card.
    }
}
