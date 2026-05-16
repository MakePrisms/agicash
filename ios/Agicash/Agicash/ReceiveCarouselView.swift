import SwiftUI

/// Top-level Receive surface. Presented as a `.sheet` from `HomeView`,
/// hosts a three-tab swipeable carousel: Cashu paste, Lightning, Buy.
///
/// Replaces the original single-screen `ReceiveView`. The web app
/// multiplexes receive across `/receive/cashu`, `/receive/spark`,
/// `/receive/scan`, etc.; iOS folds the equivalent surfaces into one
/// swipe-native sheet.
///
/// `TabView` with `.tabViewStyle(.page(indexDisplayMode: .never))` gives
/// us free swipe gestures + page bounce. The default page dots are
/// suppressed in favour of a custom bottom navbar that surfaces a
/// semantic icon per tab (banknote / bolt / dollar) — tapping an icon
/// drives the same `@State` the swipe gesture does.
struct ReceiveCarouselView: View {
    @Bindable var model: WalletViewModel
    /// Tab the carousel opens on. Defaults to `.lightning` (the most
    /// common "please pay me" intent and the most visually compelling
    /// first impression); the Home view can pass a different value if
    /// future deep-links route to a specific tab.
    let initialTab: ReceiveTab
    let onDismiss: () -> Void

    init(
        model: WalletViewModel,
        initialTab: ReceiveTab = .lightning,
        onDismiss: @escaping () -> Void
    ) {
        self.model = model
        self.initialTab = initialTab
        self.onDismiss = onDismiss
    }

    @State private var selectedTab: ReceiveTab = .lightning

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $selectedTab) {
                    CashuTokenPasteView(
                        model: model,
                        onDismissCarousel: onDismiss
                    )
                    .tag(ReceiveTab.cashu)

                    LightningReceiveView(
                        model: model,
                        onDismissCarousel: onDismiss
                    )
                    .tag(ReceiveTab.lightning)

                    BuyView()
                        .tag(ReceiveTab.buy)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                // The default page-tab background bleeds through;
                // pin to brandBackground so the tabs feel like the
                // rest of the app.
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

    private func titleForTab(_ tab: ReceiveTab) -> String {
        switch tab {
        case .cashu:     return "Receive Cashu"
        case .lightning: return "Receive Lightning"
        case .buy:       return "Buy sats"
        }
    }
}

/// Tabs the receive carousel supports.
enum ReceiveTab: Hashable, CaseIterable {
    case cashu
    case lightning
    case buy

    var iconName: String {
        switch self {
        case .cashu:     return "banknote"
        case .lightning: return "bolt.fill"
        case .buy:       return "dollarsign.circle"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .cashu:     return "Paste Cashu token"
        case .lightning: return "Receive over Lightning"
        case .buy:       return "Buy sats"
        }
    }
}

/// Bottom indicator bar — three tappable icons that double as page
/// indicators. Mirrors the rhythm of Apple Mail's bottom toolbar.
private struct TabIndicatorBar: View {
    @Binding var selectedTab: ReceiveTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(ReceiveTab.allCases, id: \.self) { tab in
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
