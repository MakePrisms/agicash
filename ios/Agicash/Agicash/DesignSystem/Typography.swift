import SwiftUI

/// Typography tokens matching the web app's font stack
/// (`app/tailwind.css`):
///
///   --font-primary: "Kode Mono", monospace;
///   --font-numeric: "Teko", sans-serif;
///
/// The web app applies `font-primary` to the whole `<Page>` shell, so every
/// label, button, and body row is monospace. Numbers in `MoneyDisplay` swap
/// to Teko (a tall condensed sans).
///
/// iOS doesn't ship Kode Mono or Teko, and we deliberately don't bundle
/// non-licensed fonts. Instead we fall back to the closest system designs:
///
///   - `BrandFont.primary*` -> `.system(design: .monospaced)`
///   - `BrandFont.numeric*` -> `.system(design: .rounded)` with heavier weight
///
/// The fallback keeps the visual rhythm (mono labels + chunky numerals)
/// without dragging in a licensing concern.
enum BrandFont {
    /// Default body text used across the web app shell.
    static let body = Font.system(.body, design: .monospaced)
    /// Body text with semibold weight (used in buttons and emphasised rows).
    static let bodyEmphasis = Font.system(.body, design: .monospaced).weight(.semibold)
    /// Small label (`text-sm` on web).
    static let label = Font.system(.subheadline, design: .monospaced)
    /// Medium-weight label, used above inputs.
    static let labelEmphasis = Font.system(.subheadline, design: .monospaced).weight(.medium)
    /// Caption / footnote (`text-xs` on web).
    static let caption = Font.system(.caption, design: .monospaced)

    /// Small heading (`text-xl`, ~20pt).
    static let titleSmall = Font.system(.title3, design: .monospaced).weight(.semibold)
    /// Section heading (`text-2xl`, used by `CardTitle`).
    static let title = Font.system(.title2, design: .monospaced).weight(.bold)
    /// Hero heading (used for the app brand wordmark).
    static let titleLarge = Font.system(.largeTitle, design: .monospaced).weight(.bold)

    /// Numeric display — used for the home balance and any large currency
    /// readout. Web uses Teko (tall condensed); rounded + heavy is the best
    /// systemic fallback.
    static let numericHero = Font.system(size: 64, weight: .bold, design: .rounded)
    /// Smaller numeric (inline balances on rows).
    static let numericInline = Font.system(.title3, design: .rounded).weight(.semibold)
}

extension Font {
    /// Convenience accessors so call sites read like Tailwind utilities.
    static var brandBody: Font { BrandFont.body }
    static var brandBodyEmphasis: Font { BrandFont.bodyEmphasis }
    static var brandLabel: Font { BrandFont.label }
    static var brandLabelEmphasis: Font { BrandFont.labelEmphasis }
    static var brandCaption: Font { BrandFont.caption }
    static var brandTitle: Font { BrandFont.title }
    static var brandTitleSmall: Font { BrandFont.titleSmall }
    static var brandTitleLarge: Font { BrandFont.titleLarge }
    static var brandNumericHero: Font { BrandFont.numericHero }
    static var brandNumericInline: Font { BrandFont.numericInline }
}
