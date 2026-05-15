# Design Tokens — Source Citations

Every value in `tokens.json` traces back to one of these files. Line numbers are at the `5751be2e` head of `master` (the commit `chore/design-tokens` branched from).

## Primary sources

| File | What it owns |
|------|--------------|
| `app/tailwind.css` | All CSS variables (light/dark/usd/btc theme tokens), `@theme` declarations (fonts, custom font size, animation names), keyframes (`shake`, `slam`, `slide-out-up`), the `scrollbar-none` utility, and the `--radius` token |
| `app/features/theme/colors.ts` | TypeScript-side duplicate of currency-theme background colors (used by `meta[name="theme-color"]`) |
| `app/root.tsx` | Google Fonts `<link>` tag (Kode Mono + Teko), font preconnects, theme-color meta wiring |
| `app/lib/transitions/transitions.css` | Slide/fade keyframes used by the View Transitions API, root view-transition timing |
| `app/lib/transitions/view-transition.tsx` | `VIEW_TRANSITION_DURATION_MS = 180`, transition name → keyframe mapping |
| `app/components/money-display.tsx` | `MoneyDisplay` / `MoneyInputDisplay` font sizes for amounts |
| `app/components/ui/*.tsx` | Component-level utility usage (radii, heights, paddings, shadows) |
| `package.json` | Versions: Tailwind 4.1.18, no framer-motion (verified absent), tailwindcss-animate 1.0.7, vaul 1.1.2 |

## Token → source map

### Fonts

| Token | Source |
|-------|--------|
| `fonts.primary.family = "Kode Mono"` | `app/tailwind.css:123` (`--font-primary: "Kode Mono", monospace`) |
| `fonts.numeric.family = "Teko"` | `app/tailwind.css:122` (`--font-numeric: "Teko", sans-serif`) |
| Fonts are loaded from Google Fonts CDN | `app/root.tsx:56-58` (`<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Kode+Mono:wght@400..700&family=Teko:wght@300..700&display=swap" />`) |
| Preconnects | `app/root.tsx:45-54` |
| No bundled WOFF/TTF/OTF files | Verified by globbing `app/` — only SVG/PNG/MD assets exist |

### Type scale

| Token | Source |
|-------|--------|
| `type_scale.2xs = 0.625rem` | `app/tailwind.css:124` (`--font-size-2xs: 0.625rem`) |
| `type_scale.xs..7xl` | Tailwind v4 defaults — no overrides in `app/tailwind.css`, app uses utility classes like `text-sm`, `text-2xl`, `text-6xl` |
| `money_display_sizes.*` | `app/components/money-display.tsx:25-51` (cva symbol + value variants) |

### Colors

| Theme/token | Source |
|-------------|--------|
| Light theme (all 25 tokens) | `app/tailwind.css:5-31` (`:root { ... }`) |
| USD theme (8 overrides) | `app/tailwind.css:34-45` |
| BTC theme (8 overrides) | `app/tailwind.css:48-59` |
| Dark theme (all 25 tokens) | `app/tailwind.css:62-89` |
| `@theme inline` mapping to Tailwind utilities | `app/tailwind.css:92-117` |
| TypeScript duplicate of bg colors | `app/features/theme/colors.ts:4-10` |
| Theme scoping: classes on `<html>` | `app/root.tsx:166` (`<html lang="en" className={themeClassName}>`) |

### Motion / animation

| Token | Source |
|-------|--------|
| `named_animations.shake` | `app/tailwind.css:125` (`--animate-shake: shake 0.2s ease-in-out`), keyframes at L131-145 |
| `named_animations.slam` | `app/tailwind.css:126` (`--animate-slam: slam 0.4s ease-out both`), keyframes at L147-173 |
| `named_animations.slide_out_up` | `app/tailwind.css:127` (`--animate-slide-out-up: slide-out-up 300ms ease-out forwards`), keyframes at L175-184 |
| `named_animations.view_transition_root` | `app/lib/transitions/transitions.css:91-105`; the JS-side mirror is `app/lib/transitions/view-transition.tsx:199` (`VIEW_TRANSITION_DURATION_MS = 180`) |
| `page_transition_directions.*` | `app/lib/transitions/view-transition.tsx:34-105` (`ANIMATIONS` map); keyframes themselves in `app/lib/transitions/transitions.css:1-89` |
| `default_transition_duration_ms = 150` | Tailwind v4 default for `transition-colors` (`app/components/ui/button.tsx:9` uses `transition-colors` without explicit duration) |
| Dialog `duration-200` | `app/components/ui/dialog.tsx:40` |
| `easing.ease_*` curves | CSS specification defaults (Tailwind v4 ships these as named values for `transition-timing-function`) |

### Radius

| Token | Source |
|-------|--------|
| `radius.base_token = 0.5rem` | `app/tailwind.css:30` (`--radius: 0.5rem;`) and L121 (duplicated in `@theme`) |
| `radius.scale` | Tailwind v4 defaults |
| `radius.drawer_top = 10` | `app/components/ui/drawer.tsx:47` (`rounded-t-[10px]`) |
| Button radius `rounded-md` | `app/components/ui/button.tsx:9` |
| Card radius `rounded-lg` | `app/components/ui/card.tsx:12` |

### Shadows

| Token | Source |
|-------|--------|
| `shadows.xs` used on Card | `app/components/ui/card.tsx:12` (`shadow-xs`) |
| `shadows.lg` used on Dialog, Toast | `app/components/ui/dialog.tsx:40`, `app/components/ui/toast.tsx:28` |
| Shadow values themselves | Tailwind v4 defaults |

### Component sizes

| Token | Source |
|-------|--------|
| `component_sizes.button.*` | `app/components/ui/button.tsx:23-28` (size variants) |
| `component_sizes.input` | `app/components/ui/input.tsx:11` (`h-10`, `px-3 py-2`, `rounded-md`) |
| `component_sizes.card` | `app/components/ui/card.tsx:12` |
| `component_sizes.dialog.max_width = 512` | `app/components/ui/dialog.tsx:40` (`max-w-lg`, which is 32rem = 512px) |

### Layout

| Token | Source |
|-------|--------|
| `viewport.full_height = 100dvh` | Convention documented in `.claude/skills/tailwind-design-system/SKILL.md`; usage examples in `app/root.tsx:182` (`overflow-hidden`) and throughout `app/features/**` |
| `mobile_container_max_width_px = 384` | `sm:max-w-sm` convention; Tailwind's `max-w-sm` = 24rem = 384px |

## Notes on tokens that did NOT come from the codebase

These were added to make the cross-platform contract complete, but are not literally declared in TS:

1. **Semantic `success`/`warning` colors** — not defined in the design system. The codebase uses ad-hoc `text-green-500` or similar utilities where success is needed. Flagged in `tokens.json` as `semantic_aliases` with notes; **iOS/Android should not invent a value** — wait for a deliberate addition.
2. **Tailwind v4 default scales (spacing, type scale, font weights, shadow values)** — inlined for convenience so platforms don't need to reference the Tailwind source.
3. **CSS cubic-bezier control points** for `ease`, `ease-in`, `ease-out`, `ease-in-out` — these are CSS specification constants, not authored in this repo.
