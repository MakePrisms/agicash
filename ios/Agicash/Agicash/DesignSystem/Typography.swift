import SwiftUI

/// Typography tokens matching the web app's font stack
/// (`app/tailwind.css`):
///
///   --font-primary: "Kode Mono", monospace;
///   --font-numeric: "Teko", sans-serif;
///
/// The web app applies `font-primary` (Kode Mono) to the whole `<Page>`
/// shell, so every label, button, and body row is monospace. Numbers in
/// `MoneyDisplay` swap to Teko (a tall condensed sans).
///
/// Both fonts ship under the SIL Open Font License (OFL) and are bundled in
/// `Resources/Fonts/` (variable .ttf files). PostScript family names exposed
/// to iOS:
///
///   - `Kode Mono` (variable wght, instances Regular / Medium / SemiBold /
///     Bold)
///   - `Teko` (variable wght, instances Light / Regular / Medium /
///     SemiBold / Bold)
///
/// We address them via `Font.custom("Kode Mono", size:)` + `.weight(...)`
/// and `Font.custom("Teko", size:)` + `.weight(...)` so iOS picks the right
/// axis instance.
enum BrandFont {
    /// Bundled font family names. PostScript family names match the
    /// human-readable family.
    enum Family {
        static let primary = "Kode Mono"
        static let numeric = "Teko"
    }

    // MARK: - Primary (Kode Mono) — body, labels, titles
    //
    // Sizes mirror the web's Tailwind tokens roughly:
    //   text-xs  -> 12, text-sm -> 14, text-base -> 16, text-lg -> 18,
    //   text-xl  -> 20, text-2xl -> 24, text-3xl -> 30, text-4xl -> 36.

    /// Default body text used across the web app shell (`text-base`).
    static let body = Font.custom(Family.primary, size: 16)
    /// Body text with semibold weight (used in buttons and emphasised rows).
    static let bodyEmphasis = Font.custom(Family.primary, size: 16).weight(.semibold)
    /// Small label (`text-sm` on web).
    static let label = Font.custom(Family.primary, size: 14)
    /// Medium-weight label, used above inputs.
    static let labelEmphasis = Font.custom(Family.primary, size: 14).weight(.medium)
    /// Caption / footnote (`text-xs` on web).
    static let caption = Font.custom(Family.primary, size: 12)

    /// Small heading (`text-xl`, ~20pt).
    static let titleSmall = Font.custom(Family.primary, size: 20).weight(.semibold)
    /// Section heading (`text-2xl`, used by `CardTitle`).
    static let title = Font.custom(Family.primary, size: 24).weight(.bold)
    /// Hero heading (`text-4xl`, used for the app brand wordmark).
    static let titleLarge = Font.custom(Family.primary, size: 36).weight(.bold)

    // MARK: - Numeric (Teko) — money displays
    //
    // Web uses Teko for `font-numeric`. `MoneyDisplay` ships sizes
    // text-xl/2xl/5xl/6xl. We expose two:
    //   - `numericHero`   -> `text-6xl` (60pt) bold
    //   - `numericInline` -> `text-2xl` (24pt) semibold
    static let numericHero = Font.custom(Family.numeric, size: 60).weight(.bold)
    /// Smaller numeric (inline balances on rows).
    static let numericInline = Font.custom(Family.numeric, size: 24).weight(.semibold)
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
