# Leptos PWA — email login + real balance bringup

**Date:** 2026-05-17
**Lane:** `feat/leptos-email-and-balance`
**Branch base:** `agicash-rs/feat/leptos-home-page` (which already sits on top of `feat/leptos-kill-axum`).

## Goal

The cross-platform demo: sign into the same prod user on iOS + Android + Leptos
PWA, watch balance update on receive. The PWA is the missing third leg.

This lane delivers as much of the path as is realistic in one push:

1. **Email signup + login + config injection** — small and self-contained.
   Enables the operator to actually sign in at `damian+3@agi.cash` on the
   PWA against PROD opensecret. **Ships fully.**
2. **Real balance hero / `WalletData::refresh()`** — the demo's payoff.
   Requires `agicash-storage-supabase` to compile and run on wasm32, which
   today needs swapping rustls/ring for the browser's `fetch`, and adding
   `?Send` trait gates to every Storage trait + impl. This is multi-day
   work. **Scaffolds + audits the surface; ships as much as fits without
   blocking deliverable 1.**

## Architecture: where each piece lives

```
crates/agicash-web-leptos/
├── src/
│   ├── components/
│   │   ├── login_view.rs    ← Email + password fields, signup link
│   │   └── wallet_context.rs ← refresh() learns to call real storage
│   ├── config.rs            ← NEW: prod URLs from <meta> tags in index.html
│   └── wallet/              ← NEW (if scope allows): wasm wallet wiring
│       └── mod.rs
└── index.html               ← NEW: <meta> tags for opensecret + supabase URLs
```

## Sub-deliverable 1: Email signup + login (ships fully)

### UI

Mirror the iOS LoginView layout (already partially present in
`login_view.rs`):

- Email input (type=email, placeholder "Email")
- Password input (type=password, placeholder "Password")
- "Login" button (primary) — calls `login_email` against opensecret
- A subtle "or Continue as guest" link below (the existing guest path stays)
- "Don't have an account? Sign up" link at the bottom

Sign-up is a second mode toggle on the same view (matches iOS): clicking
"Sign up" swaps the primary button to "Create account" and calls
`register_email` instead. A back link returns to login.

### Auth wiring

The `agicash-auth-opensecret::session` module already exports both
`login_email` and `register_email` (verified). The wasm code path is
identical to the existing guest flow — same `OpenSecretClient`, same
`BrowserSessionStorage` persistence, same `AccessToken` signal hand-off,
same `navigate("/")` redirect.

### Config injection

**Today:** `LoginView` has `http://127.0.0.1:3999` + a dev-only client_id
hardcoded under `cfg(wasm)`.

**Pick:** read from `<meta>` tags in `index.html`. Simplest of the three
options the brief lists — no fetch latency at startup, no extra round-trip,
just `document.querySelector('meta[name="opensecret-base-url"]')`. The
operator runs one prod build with the prod values in `index.html`.

**`crates/agicash-web-leptos/src/config.rs`:**

```rust
pub struct AppConfig {
    pub opensecret_base_url: String,
    pub opensecret_client_id: Uuid,
    pub supabase_url: String,
    pub supabase_anon_key: String,
}

impl AppConfig {
    pub fn from_meta() -> Result<Self, String> {
        // Read <meta name="opensecret-base-url" content="...">, etc.
        // Falls back to dev defaults on missing tags for local hacking.
    }
}
```

**`crates/agicash-web-leptos/index.html`** gets:

```html
<meta name="opensecret-base-url" content="https://enclave.trymaple.ai" />
<meta name="opensecret-client-id" content="a5e351d4-6dd9-4ee6-8e36-f5fb871e5432" />
<meta name="supabase-url" content="https://szuncqupizxelsxkxlpq.supabase.co" />
<meta name="supabase-anon-key" content="<ANON_KEY>" />
```

Anon key is a public-by-design Supabase JWT — safe in client HTML.

Provide the `AppConfig` via `provide_context` at app root so `LoginView`
and `WalletData::refresh()` both read it.

### End-state

Operator can `nix develop .#wasm` → `aweb --serve` → open `localhost:3000/login`
→ enter `damian+3@agi.cash` / `12345678` → land on `/` with session in
localStorage. Refresh the page → still signed in.

## Sub-deliverable 2: Real balance (scaffolds + audits)

### Honest scope assessment

The brief lists four sub-tasks. Each is a real piece of yak-shaving:

1. **`agicash-storage-supabase` wasm compile.** Today it imports
   `rustls::ClientConfig::with_platform_verifier()` and unconditionally
   installs `rustls::crypto::ring::default_provider()`. Neither builds on
   wasm32. Fix: split `http_client()` along `cfg(target_arch = "wasm32")` —
   on wasm just `reqwest::Client::new()` (the wasm32 reqwest backend uses
   browser `fetch`, no TLS layer at all). On native, the existing
   rustls-platform-verifier path stays. Cargo features have to follow:
   the workspace `reqwest` pin enables `rustls-tls` unconditionally; the
   storage crate needs a wasm-specific dep section with `default-features = false`
   and no `rustls-tls`. Postgrest's reqwest dep flows through the same
   patch; this is the patch step that surfaces unknowns.

2. **`?Send` trait gates.** `UserStorage`, `CashuReceiveSwapStorage`,
   `CashuSendSwapStorage`, `CashuMintQuoteStorage`, `CashuMeltQuoteStorage` —
   each declared `pub trait Foo: Send + Sync` with `#[async_trait]` impls
   that the `Arc<dyn Foo + Send + Sync>` constructors compose. The
   `TokenProvider` precedent from `audit/auth-opensecret-wasm` shows the
   shape: introduce a `FooBounds` marker trait that is `Send + Sync` on
   native and empty on wasm, swap `pub trait Foo: Send + Sync` for
   `pub trait Foo: FooBounds`, and `cfg_attr` the `#[async_trait]` macros.
   Roughly 5 traits × (trait def + every impl + every Arc-dyn caller).

3. **Wallet construction in browser.** No wallet facade exists today —
   each consumer wires `OpenSecretClient` + `SupabaseStorage` + `CashuProvider`
   + each `Cashu*Service` manually (see `agicash-ffi/src/wallet.rs:140-209`).
   The leptos PWA composition root needs to mirror that. The minimum for
   "show real balance" is the slice the FFI's `list_accounts` uses: storage
   + send_swap_storage (for proof balance reads).

4. **Realtime updates.** Supabase realtime works over websockets and
   requires the `supabase-rs` client (or a hand-rolled websocket wrapper).
   If sub-tasks 1-3 land, polling every 5s is a one-liner; realtime is a
   follow-up lane.

### What this lane ships for deliverable 2

**Tier A — definitely ships:**
- The `?Send` gate work on `agicash-traits::user_storage` (only). This
  is the trait `list_accounts` depends on. Mirrors the auth crate
  pattern 1:1.
- `agicash-storage-supabase`: cfg-gated `http_client()` (the wasm branch
  is just `reqwest::Client::new()`). Audit + report on what other
  wasm-incompatible deps surface during the wasm compile (`tokio`
  features, `chrono`, etc.) so the follow-up has a punch-list.

**Tier B — ships if Tier A lands cleanly:**
- `WalletData::refresh()` wired to construct a `SupabaseStorage`-backed
  `dyn UserStorage`, call `list_accounts(user_id)`, map to `AccountSummary`,
  set `LoadState::Ready(accounts)`. Balance set to 0 for all accounts
  (the per-account proof sum needs `CashuSendSwapStorage` which has its
  own `?Send` audit; do that as a follow-up).
- `agicash-web-leptos/Cargo.toml` gains `agicash-storage-supabase` and
  `agicash-traits` (under `[target.'cfg(target_arch = "wasm32")'.dependencies]`).

**Tier C — explicitly out of scope, follow-up lane:**
- The full `?Send` audit on `agicash-cashu` (proof balance sums need it).
- Per-account real balance numbers in the hero.
- Realtime websocket subscription.
- A `WalletClient` facade in `agicash-wallet`.

### Why this split

Tier A gives the operator the demo's *visible* leg (sign in on PWA on
the same user). Tier B gives them account-count parity (accounts
list arrives, hero stops showing $0 from "no accounts" and starts
showing $0 from "real accounts with no proofs"). Tier C is the actual
balance numbers and live updates — that's where the next lane picks up.

The home page's `pages/home.rs` does NOT change. The seam is exactly
where the home-page worker designed it: `WalletData::refresh()`'s body.

## Process

1. Brief brainstorm done (this doc).
2. Skip `writing-plans` — the design above is itself the plan, broken
   into deliverables. The operator's brief is already a detailed plan;
   double-planning would be ceremony.
3. Execute Tier 1 → Tier A → Tier B in order. Stop at the first sustained
   yak-shave (per "honest scope" mandate).
4. Push the branch (no PR, per `feedback_agicash_no_prs.md`), report,
   clean up the worktree per `feedback_worktree_cleanup_after_merge.md`.

## Verification checklist (what the operator runs to confirm)

- [ ] `nix develop .#wasm -c cargo build -p agicash-web-leptos --target wasm32-unknown-unknown --no-default-features --features=hydrate` is green.
- [ ] `aweb` produces a pkg/, `python3 -m http.server 3000` serves it, browser
      loads `/login` without console errors.
- [ ] Login as `damian+3@agi.cash` / `12345678` → redirected to `/`, session
      persists in localStorage across page reload.
- [ ] Network tab shows a request to `https://enclave.trymaple.ai/login` (NOT
      `127.0.0.1:3999`).
- [ ] (If Tier B lands) Network tab shows a request to
      `https://szuncqupizxelsxkxlpq.supabase.co/rest/v1/...` and the home
      hero renders.

## Non-goals

- No PR. Push the branch and report.
- No changes to `pages/home.rs` (the home-page worker's view layer).
- No `WalletClient` facade construction.
- No realtime websocket subscription (follow-up lane).
- No Google login (still stubbed; the iOS UI also stubs it).
