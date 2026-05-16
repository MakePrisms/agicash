import CoreGraphics

/// Tailwind spacing scale mirrored to CGFloat. Web uses `p-1` = 0.25rem =
/// 4pt, `p-2` = 8pt, etc. Named constants spell out the common steps so
/// SwiftUI screens read like their Tailwind counterparts.
enum Spacing {
    /// Tailwind `1` (4pt).
    static let xs: CGFloat = 4
    /// Tailwind `2` (8pt) — the default gap between siblings inside a card.
    static let s: CGFloat = 8
    /// Tailwind `3` (12pt) — input padding.
    static let m: CGFloat = 12
    /// Tailwind `4` (16pt) — page padding, gap between form rows.
    static let l: CGFloat = 16
    /// Tailwind `5` (20pt) — card inner padding.
    static let xl: CGFloat = 20
    /// Tailwind `6` (24pt) — section gap.
    static let xxl: CGFloat = 24
    /// Tailwind `8` (32pt) — large section gap.
    static let xxxl: CGFloat = 32
    /// Tailwind `12` (48pt) — hero spacing.
    static let hero: CGFloat = 48
}
