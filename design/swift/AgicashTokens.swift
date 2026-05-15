// AgicashTokens.swift
//
// ILLUSTRATIVE consumer of design/tokens.json for SwiftUI (iOS).
// This file is documentation of intent — not yet wired into the iOS scaffold.
// When the iOS app adopts it:
//   1. Generate Assets.xcassets Color Sets (light/dark variants) for every entry
//      in AgicashColors below. Names in Assets.xcassets must match the literals
//      passed to Color("...") here.
//   2. Bundle the Kode Mono + Teko TTFs and register them in Info.plist under
//      UIAppFonts (see ../FONTS.md for the full list).
//   3. Currency themes (USD/BTC) replace a subset of the base palette. SwiftUI
//      doesn't have a CSS-style cascade, so the recommended approach is to
//      store the active currency theme + color mode in an @EnvironmentObject
//      and resolve the right Color manually (see resolved(for:colorScheme:)).
//
// Source of truth: ../tokens.json
// Citations: ../SOURCES.md

import SwiftUI

// MARK: - Colors

/// Semantic color tokens. Each name matches an entry in Assets.xcassets, where
/// the light/dark variants are configured. The currency themes (USD/BTC) are
/// applied on top by `AgicashTheme.resolvedColor`.
enum AgicashColors {
    // Base palette — backed by Color Sets with "Any/Dark" appearances
    static let background           = Color("Background")
    static let foreground           = Color("Foreground")
    static let card                 = Color("Card")
    static let cardForeground       = Color("CardForeground")
    static let popover              = Color("Popover")
    static let popoverForeground    = Color("PopoverForeground")
    static let primary              = Color("Primary")
    static let primaryForeground    = Color("PrimaryForeground")
    static let secondary            = Color("Secondary")
    static let secondaryForeground  = Color("SecondaryForeground")
    static let muted                = Color("Muted")
    static let mutedForeground      = Color("MutedForeground")
    static let accent               = Color("Accent")
    static let accentForeground     = Color("AccentForeground")
    static let destructive          = Color("Destructive")
    static let destructiveForeground = Color("DestructiveForeground")
    static let border               = Color("Border")
    static let input                = Color("Input")
    static let ring                 = Color("Ring")

    // Hard-coded fallbacks if Assets.xcassets isn't populated yet.
    // Values pulled verbatim from app/tailwind.css (HSL → SwiftUI Color).
    enum Light {
        static let background = Color(hue: 0,    saturation: 0,    brightness: 1.0)
        static let foreground = Color(hue: 0,    saturation: 0,    brightness: 0.039)
        static let primary    = Color(hue: 0,    saturation: 0,    brightness: 0.09)
        static let destructive = Color(hue: 0/360.0, saturation: 0.842, brightness: 0.602)
    }
    enum Dark {
        static let background = Color(hue: 0, saturation: 0, brightness: 0.039)
        static let foreground = Color(hue: 0, saturation: 0, brightness: 0.98)
        static let primary    = Color(hue: 202/360.0, saturation: 0.13, brightness: 0.13)
    }
    enum USD {
        // hsl(178 100% 15%)
        static let background = Color(hue: 178/360.0, saturation: 1.0, brightness: 0.15)
        // hsl(177 42% 26%)
        static let primary    = Color(hue: 177/360.0, saturation: 0.42, brightness: 0.26)
    }
    enum BTC {
        // hsl(217 68% 35%)
        static let background = Color(hue: 217/360.0, saturation: 0.68, brightness: 0.35)
        // hsl(219 44% 45%)
        static let primary    = Color(hue: 219/360.0, saturation: 0.44, brightness: 0.45)
    }
}

// MARK: - Typography

/// Type tokens. Sizes are in points (web rem * 16). Fonts are PostScript names —
/// these only resolve if Kode Mono + Teko TTFs are bundled and registered in
/// Info.plist's UIAppFonts.
enum AgicashFont {
    // Numeric (Teko) — for monetary amounts only
    static let amountXS = Font.custom("Teko-SemiBold", size: 20)  // text-xl
    static let amountSM = Font.custom("Teko-SemiBold", size: 24)  // text-2xl
    static let amountMD = Font.custom("Teko-Bold",     size: 48)  // text-5xl
    static let amountLG = Font.custom("Teko-Bold",     size: 60)  // text-6xl

    // Primary (Kode Mono) — for all other UI text
    static let textXS   = Font.custom("KodeMono-Regular",  size: 12)
    static let textSM   = Font.custom("KodeMono-Regular",  size: 14)
    static let textBase = Font.custom("KodeMono-Regular",  size: 16)
    static let textLG   = Font.custom("KodeMono-Medium",   size: 18)
    static let text2XL  = Font.custom("KodeMono-SemiBold", size: 24)

    // Honor Dynamic Type by composing with `.scaledFont(for:)` from a custom
    // ViewModifier, or by adopting `Font.custom(_:size:relativeTo:)`:
    static func textBase(relativeTo style: Font.TextStyle) -> Font {
        Font.custom("KodeMono-Regular", size: 16, relativeTo: style)
    }
}

// MARK: - Radius

enum AgicashRadius {
    static let xs:  CGFloat = 2
    static let sm:  CGFloat = 4
    static let md:  CGFloat = 6
    static let lg:  CGFloat = 8   // matches --radius from app/tailwind.css
    static let xl:  CGFloat = 12
    static let xl2: CGFloat = 16
    static let drawerTop: CGFloat = 10
    static let full: CGFloat = 9999
}

// MARK: - Spacing

/// Spacing scale follows Tailwind's 4-pt grid. Use these instead of magic numbers
/// so the iOS layout maintains parity with the web grid.
enum AgicashSpacing {
    static let px:   CGFloat = 1
    static let s0_5: CGFloat = 2
    static let s1:   CGFloat = 4
    static let s2:   CGFloat = 8
    static let s3:   CGFloat = 12
    static let s4:   CGFloat = 16
    static let s6:   CGFloat = 24
    static let s8:   CGFloat = 32
    static let s12:  CGFloat = 48
}

// MARK: - Motion

/// Named motion tokens.
///
/// Apple's `.easeIn`/`.easeOut` are close to but not identical to CSS's named
/// curves. For pixel-level parity with the web, prefer the `.timingCurve(...)`
/// variants below; for "feels the same" parity, `.easeIn`/`.easeOut` are fine.
enum AgicashMotion {
    // Durations (seconds)
    static let durationFast:           Double = 0.15  // transition-colors default
    static let durationViewTransition: Double = 0.18  // page nav slide/fade
    static let durationBase:           Double = 0.20  // dialog open/close, shake
    static let durationSlideOutUp:     Double = 0.30  // toast dismiss
    static let durationSlam:           Double = 0.40  // numeric slam feedback

    // Named easings — exact CSS cubic-bezier control points
    static let easeIn     = Animation.timingCurve(0.4, 0, 1, 1, duration: durationBase)
    static let easeOut    = Animation.timingCurve(0, 0, 0.2, 1, duration: durationBase)
    static let easeInOut  = Animation.timingCurve(0.4, 0, 0.2, 1, duration: durationBase)

    // Apple-native equivalents — slightly softer, but feel native
    static let easeOutFast = Animation.easeOut(duration: durationFast)
    static let easeInOutBase = Animation.easeInOut(duration: durationBase)

    // No spring physics in the web app. If a SwiftUI motion needs a spring
    // (e.g., for sheet pull-down to mirror vaul's drawer), use the iOS-native
    // .sheet — it already has Apple-tuned physics that will feel more right
    // than reverse-engineering vaul's curve.
}

// MARK: - Theme resolution

enum CurrencyTheme: String { case usd, btc }
enum AgicashColorMode { case light, dark }

/// Helper to mirror the CSS cascade: dark mode wins over currency theme, exactly
/// as in app/tailwind.css where `.dark` rules appear after `.usd`/`.btc`.
struct AgicashTheme {
    let currency: CurrencyTheme
    let mode: AgicashColorMode

    var background: Color {
        switch (mode, currency) {
        case (.dark, _):       return AgicashColors.Dark.background
        case (.light, .usd):   return AgicashColors.USD.background
        case (.light, .btc):   return AgicashColors.BTC.background
        }
    }

    var primary: Color {
        switch (mode, currency) {
        case (.dark, _):       return AgicashColors.Dark.primary
        case (.light, .usd):   return AgicashColors.USD.primary
        case (.light, .btc):   return AgicashColors.BTC.primary
        }
    }
}
