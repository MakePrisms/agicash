---
name: tailwind-design-system
description: Tailwind CSS design system for this mobile-first wallet app. Covers theme system (USD/BTC/dark), CSS variables, CVA components, shadcn/ui patterns, custom animations, and layout conventions. Use when creating or modifying UI components.
---

# Tailwind Design System — Project Conventions

**Stack**: Tailwind CSS 4.1 + `@tailwindcss/vite` + shadcn/ui + CVA + tailwind-merge + tw-animate-css + Radix UI + vaul

**References** (load when needed):
- [component-patterns.md](references/component-patterns.md) — CVA examples, MoneyDisplay, Dialog/Drawer/Toast animations, view transitions, page layout, available UI components

## Quick Reference

| What | How |
|------|-----|
| Class merging | `cn()` from `~/lib/utils` (clsx + tailwind-merge) |
| Component variants | CVA (`class-variance-authority`) |
| Semantic colors | CSS variables: `bg-primary`, `text-foreground`, `border-border` |
| Amount fonts | `font-numeric` (Teko) |
| Primary font | `font-primary` (Kode Mono) |
| Full viewport | `h-dvh` (dynamic viewport height) |
| Mobile container | `mx-auto w-full sm:max-w-sm` |
| Hide scrollbar | `scrollbar-none` (custom `@utility`) |
| Dark mode | Class-based (`.dark` on root) |
| Currency theme | `.usd` or `.btc` class on root |

## Configuration

**Tailwind v4 uses CSS-first configuration** — no `tailwind.config.ts`. All config lives in `app/tailwind.css`.

| File | Purpose |
|------|---------|
| `app/tailwind.css` | All Tailwind config: `@theme`, `@utility`, CSS variables, base styles |
| `vite.config.ts` | `@tailwindcss/vite` plugin (first in plugins array) |
| `app/lib/utils.ts` | `cn()` utility (clsx + tailwind-merge) |
| `app/features/theme/theme-provider.tsx` | Theme context and switching |
| `app/features/theme/colors.ts` | Theme colors in TypeScript (**must stay in sync with CSS**) |
| `app/components/ui/` | shadcn/ui base components |
| `app/components/page.tsx` | Page layout components |
| `app/components/money-display.tsx` | MoneyDisplay / MoneyInputDisplay |
| `components.json` | shadcn/ui config (no `config` path — v4 uses CSS) |

## v4 CSS-First Config Structure

The `app/tailwind.css` file structure:

```css
@import "tailwindcss";
@plugin "tailwindcss-animate";

/* 1. CSS Variables — outside @layer (v4 requirement) */
:root { --background: hsl(0 0% 100%); /* ... */ }
.usd  { --background: hsl(178 100% 15%); /* ... */ }
.btc  { --background: hsl(217 68% 35%); /* ... */ }
.dark { --background: hsl(0 0% 3.9%); /* ... */ }

/* 2. @theme inline — registers CSS vars as Tailwind color tokens */
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  /* ... maps all CSS vars to Tailwind tokens */
}

/* 3. @theme — custom tokens (fonts, sizes, animations) */
@theme {
  --font-numeric: "Teko", sans-serif;
  --font-primary: "Kode Mono", monospace;
  --font-size-2xs: 0.625rem;
  --animate-shake: shake 0.2s ease-in-out;
  --animate-slam: slam 0.4s ease-out both;
  --animate-slide-out-up: slide-out-up 300ms ease-out forwards;
}

/* 4. @keyframes — top-level, referenced by @theme animations */
@keyframes shake { /* ... */ }

/* 5. @utility — custom utilities (replaces v3 plugins) */
@utility scrollbar-none {
  -ms-overflow-style: none;
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}

/* 6. @layer base — global styles */
@layer base {
  * { @apply border-border; }
  body { @apply bg-background text-foreground; }
  button:not(:disabled), [role="button"]:not(:disabled) {
    cursor: pointer;  /* v4 removed default cursor:pointer */
  }
}
```

**Key v4 differences from v3:**
- `@import "tailwindcss"` replaces three `@tailwind` directives
- CSS variables use `hsl()` wrapper (v3 used bare values like `0 0% 100%`)
- `@theme inline` registers CSS vars as Tailwind tokens (replaces `theme.extend.colors` in JS)
- `@theme` defines custom tokens (replaces `theme.extend.*` in JS config)
- `@utility` creates custom utilities (replaces `plugin({ addUtilities })`)
- `@plugin` loads plugins (replaces `require()` in JS config)
- No `postcss.config.js` needed — `@tailwindcss/vite` handles everything

## v4 Class Name Changes

Use the v4 names. The v3 names no longer exist:

| v3 (removed) | v4 (use this) |
|--------------|---------------|
| `shadow-sm` | `shadow-xs` |
| `rounded-sm` | `rounded-xs` |
| `outline-none` | `outline-hidden` |

Also: default `ring` width changed from `3px` to `1px` (use `ring-3` for old behavior).

## Theme System

Two independent axes, both cookie-persisted for SSR:
1. **Currency theme**: `.usd` (teal) or `.btc` (blue) on `<html>`
2. **Color mode**: `light` / `dark` / `system` — applies `.dark` class

Access via `useTheme()` from `app/features/theme/use-theme.tsx`.

Always use semantic color classes (`bg-primary`, `text-foreground`, `border-border`). Never hardcode colors like `bg-blue-500`.

**Keep `app/tailwind.css` and `app/features/theme/colors.ts` in sync** — the TypeScript file duplicates CSS variable values for programmatic access.

## Layout Conventions

- **Full viewport**: `h-dvh` (not `h-screen` — handles mobile browser chrome)
- **Safe viewport**: `h-[90svh]` for drawers/modals
- **Mobile container**: `w-full sm:max-w-sm` (full on mobile, 448px max on larger)
- **Centered layout**: `mx-auto sm:items-center`
- **Scrollable content**: `flex-1 overflow-y-auto scrollbar-none min-h-0`
- **Numpad**: `sm:hidden` (keyboard input on larger screens)
- **Mobile-first**: Base styles target mobile; `sm:` adjusts for larger screens

## Rules

| Do | Don't |
|----|-------|
| Semantic color classes (`bg-primary`) | Hardcoded colors (`bg-blue-500`) |
| `font-numeric` for all monetary amounts | Arbitrary font values |
| `h-dvh` for full-viewport layouts | `h-screen` (broken on mobile) |
| `cn()` for all className composition | Manual string concatenation |
| CVA for component variants | Inline conditional classes |
| Check `app/components/ui/` before creating new components | Duplicate existing shadcn components |
| Keep CSS vars and `colors.ts` in sync | Change one without the other |
| Add new keyframes/animations in `@theme`/`@keyframes` in CSS | Create animations outside `app/tailwind.css` |
| Use cookies for theme persistence | `localStorage` (breaks SSR) |
| `forwardRef` on components wrapping HTML elements | Skip ref forwarding |
