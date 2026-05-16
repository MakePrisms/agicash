# Motion — Cross-Platform Mapping

## Survey of what the web app actually uses

The web app has **no framer-motion** and **no spring physics**. Everything is timing-function based, expressed through:

1. **Tailwind utilities** (`transition-colors`, `duration-200`, etc.) on most interactive elements.
2. **Custom keyframes** registered in `app/tailwind.css` (`shake`, `slam`, `slide-out-up`) and `app/lib/transitions/transitions.css` (slide/fade for page transitions).
3. **The browser's View Transitions API** for navigation (no JS animation library — `LinkWithViewTransition` orchestrates CSS `::view-transition-*` pseudo-elements).
4. **vaul** for drawer pull/dismiss physics (vaul has its own internal spring; the values are not exposed in our config).
5. **tailwindcss-animate** for shadcn's `data-[state=open]:animate-in` / `data-[state=closed]:animate-out` open/close transitions (used on Dialog and Toast).

## The top 5 motion patterns and their platform equivalents

### 1. Default `transition-colors` on interactive elements

Used on: Button (every variant), ToastClose, DialogClose, ToastAction.
- **Web**: `transition-colors` (Tailwind v4 → `transition-duration: 150ms` with `cubic-bezier(0.4, 0, 0.2, 1)`)
- **SwiftUI**: `.animation(.easeInOut(duration: 0.15), value: someState)` — apply to the color-bound view modifier
- **Compose**: `animateColorAsState(targetValue = color, animationSpec = tween(durationMillis = 150, easing = FastOutSlowInEasing))`

### 2. Page navigation — slide / fade

Used by `LinkWithViewTransition` (`slideLeft`, `slideRight`, `slideUp`, `slideDown`, `fade`).
- **Web**: View Transitions API + custom keyframes (`slide-in-from-right`, etc.), `animation-duration: 0.18s`, `animation-timing-function: ease-in` (see `app/lib/transitions/transitions.css:91-105`)
- **SwiftUI**: `NavigationStack` transitions are built-in. To match the 180ms feel use `.transition(.move(edge: .trailing).combined(with: .opacity))` with `withAnimation(.easeIn(duration: 0.18))`
- **Compose**: `AnimatedNavHost` (accompanist) or Compose Navigation 2.7+:
  ```kotlin
  enterTransition = { slideInHorizontally(animationSpec = tween(180, easing = EaseIn)) { it } }
  exitTransition  = { slideOutHorizontally(animationSpec = tween(180, easing = EaseIn)) { -it } }
  ```

### 3. Dialog open/close — `animate-in` / `animate-out` (tailwindcss-animate)

Used on: Dialog (overlay fade, content fade+zoom+slide), Toast (slide-in-from-bottom).
- **Web**: Tailwindcss-animate, `duration-200` (explicit on Dialog), combined `fade-in` + `zoom-in-95` + `slide-in-from-left-1/2`/`slide-in-from-top-[48%]` on open (see `app/components/ui/dialog.tsx:40`)
- **SwiftUI**: `.sheet` is the platform-native equivalent — use it (don't reimplement). If a true centered modal is needed, present a custom view with `.transition(.opacity.combined(with: .scale(scale: 0.95))).animation(.easeOut(duration: 0.2), value: isPresented)`
- **Compose**: `ModalBottomSheet` or `AlertDialog` are native. For a custom centered dialog, wrap in `AnimatedVisibility(visible = isOpen, enter = fadeIn(tween(200)) + scaleIn(initialScale = 0.95, animationSpec = tween(200, easing = EaseOut)))`

### 4. Toast slide-out-up — custom 300ms

Toasts swipe up to dismiss using `data-[state=closed]:animate-slide-out-up`.
- **Web**: `slide-out-up 300ms ease-out forwards`; `translateY 0 → -150%` with opacity 1 → 0 (see `app/tailwind.css:127, 175-184`)
- **SwiftUI**: For a non-native toast use `.transition(.move(edge: .top).combined(with: .opacity))` with `.animation(.easeOut(duration: 0.3), value: isShown)`. Native equivalent: `.alert` doesn't slide — consider building a custom banner that respects this motion.
- **Compose**: `Snackbar` is the conventional choice but doesn't match this curve. For parity, use `AnimatedVisibility(exit = slideOutVertically(animationSpec = tween(300, easing = EaseOut)) { -(it * 1.5).toInt() } + fadeOut(tween(300)))`

### 5. Shake — input validation feedback

`animate-shake` = `translateX 0 → -5 → +5 → -5 → 0` over 200ms (`ease-in-out`).
- **Web**: `app/tailwind.css:125, 131-145`
- **SwiftUI**: `.modifier(ShakeEffect(animatableData: shakeTrigger))` where the modifier uses a `GeometryEffect` returning a `CGAffineTransform(translationX: -5 * sin(animatableData * .pi * 2), y: 0)`. Trigger with `withAnimation(.easeInOut(duration: 0.2)) { shakeTrigger += 1 }`.
- **Compose**: `Modifier.offset { IntOffset(x = (sin(progress * 2 * PI) * 5.dp.toPx()).toInt(), y = 0) }` driven by `animateFloatAsState(targetValue = trigger, animationSpec = tween(200, easing = LinearEasing))`. Alternatively `animateValueAsState` of a `Float` from 0→1 keyframed at -5, +5, -5, 0.

## Easing curve mapping table

| Web (CSS) | Cubic-bezier | SwiftUI | Compose |
|-----------|--------------|---------|---------|
| `linear` | `(0, 0, 1, 1)` | `.linear` | `LinearEasing` |
| `ease` | `(0.25, 0.1, 0.25, 1)` | `.timingCurve(0.25, 0.1, 0.25, 1, duration:)` | `CubicBezierEasing(0.25f, 0.1f, 0.25f, 1f)` |
| `ease-in` | `(0.4, 0, 1, 1)` | `.easeIn` (≈ `(0.42, 0, 1, 1)`) or `.timingCurve(0.4, 0, 1, 1, ...)` for exactness | `EaseIn` |
| `ease-out` | `(0, 0, 0.2, 1)` | `.easeOut` (≈ `(0, 0, 0.58, 1)`) or `.timingCurve(0, 0, 0.2, 1, ...)` for exactness | `EaseOut` |
| `ease-in-out` | `(0.4, 0, 0.2, 1)` | `.easeInOut` (≈ `(0.42, 0, 0.58, 1)`) or `.timingCurve(0.4, 0, 0.2, 1, ...)` for exactness | `EaseInOut` or `FastOutSlowInEasing` |

**Note**: CSS named easings are not identical to Apple's `.easeIn`/`.easeOut`/`.easeInOut` — Apple's are slightly softer (cubic-bezier `0.42, 0, 0.58, 1` vs CSS's `0.4, 0, 0.2, 1`). For pixel-level parity, prefer `.timingCurve(...)` on iOS with the exact CSS values. For "feels the same" parity, the named curves are close enough.

## Duration ladder

| Name | ms | Where it's used |
|------|----|-----------------|
| Fast (default) | 150 | `transition-colors` on buttons, hovers |
| View transition | 180 | Page navigation slide/fade |
| Base / Shake | 200 | Dialog open/close, input shake |
| Slide out up | 300 | Toast swipe dismiss |
| Slam | 400 | Numeric input "slam" feedback |

## What does NOT translate cleanly

1. **Browser View Transitions API** — there is no exact equivalent on iOS/Android. The closest match is platform-native navigation transitions (NavigationStack on iOS, Compose Navigation animations on Android). Don't try to reimplement the View Transitions snapshot-and-crossfade mechanism — use platform primitives.
2. **vaul drawer physics** — vaul has its own internal spring for the swipe-to-dismiss gesture. Our config doesn't tune it; we accept the library defaults. On iOS use the native `.sheet` (with `.presentationDetents` for partial heights) and on Android use `ModalBottomSheet` — both have platform-tuned springs that feel more native than reimplementing vaul.
3. **The `slam` letter-spacing pulse** — varies `letter-spacing` from `0.05em` → `-0.02em` → `0.02em` mid-animation. SwiftUI's `Text` has `kerning` but it doesn't animate well; Compose's `letterSpacing` similarly doesn't interpolate smoothly. If the slam effect is critical on mobile, drop the letter-spacing portion and keep only the scale pulse, or accept that this is a web-only effect.
4. **`tailwindcss-animate` composite animations** (e.g., Dialog's `fade-in + zoom-in-95 + slide-in-from-left-1/2 + slide-in-from-top-[48%]` all simultaneously) — these compose via CSS animation lists. On iOS/Android, compose them with `.combined(with:)` in SwiftUI or `+` in Compose, but verify the result feels right; multiple simultaneous transforms can land at slightly different times depending on how the platform interpolates compound transforms.
