# Leptos PWA Home Page

Status: design + implementation (single lane, 2026-05-17).

## Context

The Leptos PWA's `/` route currently ships a single-line balance-hero
placeholder. We want a real home page that mirrors the iOS `HomeView`
(design source of truth per `feedback_agicash_ios_visual_parity.md`) and
the React reference (`app/routes/_protected._index.tsx`).

The constraint that shapes the whole spec: **there is no wasm-clean
wallet binding yet.** The agicash-wasm crate is a stub that only
exports a version string. `agicash-storage-supabase` depends on
`rustls-platform-verifier` + ring + a `Send + Sync` `TokenProvider`;
`agicash-ffi`'s `AgicashWallet::list_accounts` therefore can't load in
the browser today. The slice 13 follow-up (mentioned in
`crates/agicash-wasm/Cargo.toml`) is the place that gap closes.

So the page's design has to do two things at once:

1. Render the right visual surface today (with whatever real data we
   *can* surface from the browser).
2. Be wired so the wasm-wallet binding drops in with a single seam
   change — no UI rewrite when slice 13 lands.

## Visual reference

iOS `HomeView` is the canonical layout. Confirmed by reading
`ios/Agicash/Agicash/HomeView.swift` and cross-checking against
`app/routes/_protected._index.tsx`:

- **Balance hero** — large numeric, currency-prefixed (e.g. `$ 0`),
  secondary converted-amount line below in muted text.
- **Receive + Send buttons** — vertical stack capped at 288pt, Receive
  is `secondary` variant, Send is `primary`. iOS folded Buy into the
  Receive carousel; React still shows it as a peer button. We match
  iOS (Receive/Send only).
- **No account carousel on home.** Both iOS HomeView and the React
  `_index.tsx` route deliberately keep accounts on the `/accounts`
  page. The lane brief asked for a carousel; we defer to the design
  reference and document the deviation here.
- **No recent activity on home.** Neither iOS nor React renders one;
  the React app has a separate `/transactions` route reached from a
  header icon. No FFI for transactions exists in the wasm-reachable
  surface, so omitting is the cleanest call.

## Architecture

```
HomePage (pages/home.rs)
  ├── balance_hero    (private fn -> impl IntoView)
  ├── home_action_grid (private fn -> impl IntoView)
  └── reads `WalletData` from context (components/wallet_context.rs)

WalletData (components/wallet_context.rs)
  ├── accounts: RwSignal<LoadState<Vec<AccountSummary>>>
  ├── user_id:  RwSignal<Option<Uuid>>
  └── refresh(): triggers a load (today: a stub; slice 13: real)
```

### `WalletData` context

A `Clone + Debug` struct providing two signals plus a `refresh()`
method. Inserted via `provide_context` at the App root (next to
`AccessToken`). HomePage (and any future page) reads via
`expect_context::<WalletData>()`.

Loading semantics: `LoadState<T>` enum — `Idle | Loading | Ready(T) |
Error(String)`. HomePage matches on this to render spinner / hero /
error states. Mirrors the iOS `@Bindable model.accounts` pattern but
with explicit load states (Suspense-style) since wasm fetches will
take longer than the iOS in-process call.

### Where the data actually comes from today

`refresh()` on `WalletData`:

1. Reads the persisted session (user_id, refresh_token) from
   `BrowserSessionStorage`.
2. Populates `user_id`.
3. Sets `accounts` to `Ready(vec![])`.

This is the empty-state path. It is **real** in that it reflects the
actual state of the user's account list (a fresh guest has zero
accounts). When the wasm wallet binding lands (slice 13), the body of
`refresh()` swaps to call `WalletClient::list_accounts()`. The
HomePage code does not change.

### Balance hero math

Reuses the same algorithm iOS uses (`primarySymbol`, `primaryCurrency`,
`totalForCurrency`, `secondaryLine`) — re-implemented in Rust as
pure functions on `&[AccountSummary]`. Lifted unit tests included.

For the empty-state case this collapses to `"$ 0"` with `≈ 0 sats`
below, matching iOS's empty-wallet rendering.

### Action buttons

Uses the L3 `Button` component. Receive = `Secondary, Large`, links to
`/receive`. Send = `Primary, Large`, links to `/send`. Both wrapped in
`<A/>` for client-side navigation. 288px max-width vertical stack
matching iOS `HomeActionGrid`.

### Loading / error states

- `LoadState::Idle | LoadState::Loading` → small inline spinner
  centred where the hero would be, with the muted "Loading wallet..."
  caption. No layout shift when data lands.
- `LoadState::Error(msg)` → muted destructive text + a small "Retry"
  ghost button that calls `WalletData::refresh()`.
- `LoadState::Ready(_)` → the real hero.

## File touches

- `crates/agicash-web-leptos/src/pages/home.rs` — replace placeholder.
- `crates/agicash-web-leptos/src/components/wallet_context.rs` — new file.
- `crates/agicash-web-leptos/src/components/mod.rs` — wire the new module.
- `crates/agicash-web-leptos/src/app.rs` — `provide_context(WalletData)`.

Sibling lane `feat/leptos-receive-flow` is editing
`pages/receive.rs` (+ possibly `app.rs`). The `app.rs` touch we make
is one-line and additive (next to the existing `provide_context`
call); if the sibling rebases through it should be a trivial conflict.

## Testing

- Pure-Rust unit tests on the balance-math helpers (lifted from the
  iOS implementation's behaviour: USD wins, single-currency fallback,
  empty wallet, mixed wallet).
- Pure-Rust unit test on `LoadState` matching.
- Browser smoke (manual, documented): build wasm, serve, sign in as
  guest, watch the home page transition Loading → Ready(empty) and
  render `$ 0` with the action buttons.

No `wasm-bindgen-test` cases this lane — the data-load path is a
stub today; the contract that needs testing arrives in slice 13.

## Constraints honoured

- L3 `Button` reused — no new button styles.
- Design tokens from `tokens.rs` everywhere — no hardcoded colours.
- `ProtectedLayout` handles the auth-guard redirect; HomePage doesn't
  re-check.
- Bottom nav stays mounted (it's in the parent layout).

## Out of scope (explicitly)

- Wasm wallet binding itself (slice 13).
- Account carousel on home (deviation from brief documented above).
- Recent activity list (deviation from brief documented above).
- Currency switcher (`DefaultCurrencySwitcher`) — needs user defaults
  surface which doesn't exist in the wasm-reachable layer yet.
- Header icons (gift cards, scan, transactions, settings) — separate
  lanes per the React route shape.
- Real loading skeletons — the wasm load is a stub so the skeleton
  flashes for one tick; we ship a simple inline spinner instead.
