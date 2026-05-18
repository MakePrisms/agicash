import SwiftUI

/// Top-level Send surface. Presented as a `.sheet` from `HomeView`,
/// hosts a three-tab swipeable carousel: Cashu (token), Lightning
/// (placeholder), Lightning Address (placeholder).
///
/// Sibling of `ReceiveCarouselView` — same `TabView` +
/// `.tabViewStyle(.page(indexDisplayMode: .never))` pattern, same
/// custom bottom indicator bar. The default tab is `.cashu` since
/// it's the only real surface in this pass.
struct SendCarouselView: View {
    @Bindable var model: WalletViewModel
    /// Tab the carousel opens on. Defaults to `.cashu` — the only
    /// real surface this pass; the placeholders are there to lock in
    /// the carousel's three-tab geometry for the follow-up FFI lanes.
    let initialTab: SendTab
    let onDismiss: () -> Void

    init(
        model: WalletViewModel,
        initialTab: SendTab = .cashu,
        onDismiss: @escaping () -> Void
    ) {
        self.model = model
        self.initialTab = initialTab
        self.onDismiss = onDismiss
    }

    @State private var selectedTab: SendTab = .cashu

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $selectedTab) {
                    SendCashuTokenView(
                        model: model,
                        onDismissCarousel: onDismiss
                    )
                    .tag(SendTab.cashu)

                    LightningSendPlaceholderView()
                        .tag(SendTab.lightning)

                    LightningAddressSendPlaceholderView()
                        .tag(SendTab.lightningAddress)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .background(Color.brandBackground)

                TabIndicatorBar(selectedTab: $selectedTab)
                    .padding(.horizontal, Spacing.l)
                    .padding(.vertical, Spacing.s)
                    .background(
                        Color.brandBackground
                            .overlay(
                                Rectangle()
                                    .fill(Color.brandBorder)
                                    .frame(height: 0.5),
                                alignment: .top
                            )
                    )
            }
            .background(Color.brandBackground.ignoresSafeArea())
            .navigationTitle(titleForTab(selectedTab))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", action: onDismiss)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandForeground)
                }
            }
            .onAppear {
                selectedTab = initialTab
            }
        }
    }

    private func titleForTab(_ tab: SendTab) -> String {
        switch tab {
        case .cashu:            return "Send Cashu"
        case .lightning:        return "Send Lightning"
        case .lightningAddress: return "Send to address"
        }
    }
}

/// Tabs the Send carousel supports.
enum SendTab: Hashable, CaseIterable {
    case cashu
    case lightning
    case lightningAddress

    var iconName: String {
        switch self {
        case .cashu:            return "banknote"
        case .lightning:        return "bolt.fill"
        case .lightningAddress: return "at"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .cashu:            return "Send Cashu token"
        case .lightning:        return "Send over Lightning"
        case .lightningAddress: return "Send to Lightning Address"
        }
    }
}

/// Bottom indicator bar — three tappable icons that double as page
/// indicators. Identical structure to `ReceiveCarouselView`'s bar.
private struct TabIndicatorBar: View {
    @Binding var selectedTab: SendTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(SendTab.allCases, id: \.self) { tab in
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selectedTab = tab
                    }
                }) {
                    Image(systemName: tab.iconName)
                        .font(.system(size: 22, weight: .regular))
                        .foregroundStyle(
                            tab == selectedTab
                                ? Color.brandForeground
                                : Color.brandMutedForeground.opacity(0.4)
                        )
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.accessibilityLabel)
            }
        }
    }
}
