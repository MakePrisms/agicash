import CoreGraphics

/// Corner radius tokens mirroring Tailwind utility classes the web app uses
/// (`app/tailwind.css` declares `--radius: 0.5rem`).
///
///   - shadcn `<Card>`  -> `rounded-lg`  (0.5rem = 8pt)  -> `Radius.card`
///   - shadcn `<Button>` -> `rounded-md`  (0.375rem ≈ 6pt) -> `Radius.control`
///   - shadcn `<Input>`  -> `rounded-md`  (0.375rem ≈ 6pt) -> `Radius.control`
///   - shadcn `<Badge>`  -> `rounded-full` -> `Radius.full`
enum Radius {
    /// `rounded-lg` — card surfaces.
    static let card: CGFloat = 8
    /// `rounded-md` — buttons, inputs, list rows.
    static let control: CGFloat = 6
    /// `rounded-full` — pill / capsule badges. SwiftUI shapes treat any
    /// radius >= half the smaller dimension as a capsule, so 9999 is a
    /// safe sentinel.
    static let full: CGFloat = 9999
}
