# Agicash Design Tokens

Cross-platform design tokens extracted from the Agicash TS web app. Used to keep
SwiftUI (iOS) and Compose (Android) visually consistent with the web — same
fonts, themes, type scale, and motion curves.

## Files

| File | Purpose |
|------|---------|
| `tokens.json` | Machine-readable single source of truth |
| `SOURCES.md` | Citation map: every token → TS source file + line |
| `FONTS.md` | Font bundling instructions for iOS + Android |
| `MOTION.md` | Motion curve mappings across web / SwiftUI / Compose |
| `swift/AgicashTokens.swift` | Illustrative SwiftUI consumer (not yet wired into iOS scaffold) |
| `kotlin/AgicashTokens.kt` | Illustrative Compose consumer (not yet wired into Android scaffold) |

## How tokens flow

```
app/tailwind.css           (source of truth for the web app)
app/lib/transitions/*.css  (motion source of truth)
app/components/ui/*.tsx    (component-level usage)
        |
        v
design/tokens.json         (extracted, platform-agnostic)
        |
        +----> design/swift/AgicashTokens.swift     (SwiftUI consumer)
        +----> design/kotlin/AgicashTokens.kt        (Compose consumer)
```

## Theme system (USD / BTC / dark)

Two independent axes:

1. **Currency theme** (`usd`, `btc`) — applied as a class on the web's
   `<html>` element. Replaces a small subset of color tokens (background,
   foreground, primary, muted, border, card).
2. **Color mode** (`light`, `dark`, `system`) — `.dark` class on `<html>`.

**Cascade rule** (matches the order in `app/tailwind.css`): when both currency
theme and `.dark` are applied, `.dark` wins because its rules come later in the
stylesheet. The Swift and Kotlin consumers replicate this rule explicitly in
`AgicashTheme.resolvedColor` / `resolvePalette()`.

## How to update

1. A web designer changes a value in `app/tailwind.css` (or a component file
   under `app/components/ui/`).
2. Update the corresponding entry in `tokens.json`. Cite the line number in
   `SOURCES.md`.
3. Regenerate the SwiftUI and Compose constants if their values changed —
   currently manual; could be automated by a small script that emits
   `swift/AgicashTokens.swift` and `kotlin/AgicashTokens.kt` from `tokens.json`.
4. iOS Phase 2: also update `Assets.xcassets` Color Sets so the Color("Name")
   references in `AgicashTokens.swift` resolve correctly.
5. Android Phase 2: also update any `res/values/colors.xml` mirrors if those
   are used for `<View>`-based legacy components.

## What's NOT in scope here

- Wiring these tokens into the actual iOS or Android scaffolds — that's
  Phase 2 work in each platform repo / worktree.
- Generating Assets.xcassets Color Sets — needs Xcode tooling, not in this PR.
- Re-implementing the web's View Transitions API — see `MOTION.md` for the
  recommended platform-native equivalents.

## Verification checklist

- [x] Every token in `tokens.json` has a citation in `SOURCES.md`
- [x] Font families resolved (Google Fonts: Kode Mono + Teko), bundling
      instructions documented in `FONTS.md`
- [x] No invented color values — anything not in the codebase is flagged
      (see `colors.semantic_aliases` in `tokens.json`)
- [x] Motion curves cite both the keyframe definition and any JS mirror
      (e.g., `VIEW_TRANSITION_DURATION_MS = 180`)
