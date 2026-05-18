# iOS Send — Cashu Token (Scope A) Design

Status: draft — to be implemented under `feat/ios-send-cashu`.
Author: ios-send-cashu lane.
Date: 2026-05-17.

## Why

Today the iOS Home `Send` button is a stub. Slice 6 shipped the Rust-side
Cashu send-swap orchestrator (`agicash_cashu::send_swap`) and the CLI
already exposes `agicash send <amount>`. The iOS app cannot reach it —
the Swift UniFFI surface (`agicash-ffi`) only carries auth, accounts,
receive (token + Lightning mint quote), and `mint_add`. No send method
exists.

The operator picked **Scope A** for this pass: ship a fully working
Cashu-token send (the smallest unit that adds real user value), wire the
UniFFI bridge it needs, and stub the Lightning + Lightning-Address tabs
as carousel placeholders so the surface is ready for later. Visual shape
mirrors the existing Receive carousel and the web app's
`CreateCashuTokenConfirmation` / `ShareCashuToken` pages.

## Scope

In scope:

- New `SendCarouselView` mirroring `ReceiveCarouselView`. Three tabs:
  Cashu (real), Lightning (placeholder), Lightning Address
  (placeholder).
- `SendCashuTokenView` — amount-entry numpad → produce token →
  shareable-token screen → polled proofs-spent confirmation.
- FFI additions to `agicash-ffi`: `prepare_send_quote(amount, ...)`,
  `create_send_swap(amount, ...)`, `check_send_swap_claimed(swap_id)`,
  plus the FFI value-types (`SendQuotePreview`, `SendSwapHandle`,
  `SendSwapClaimSnapshot`).
- Storage helper: add `get(swap_id)` to `CashuSendSwapStorage` (mirrors
  `CashuMeltQuoteStorage::get`); wired through to
  `SupabaseCashuSendSwapStorage` so the FFI can re-load a swap during
  polling.
- iOS `WalletViewModel` methods that wrap the new FFI calls + a
  presentation-ready `SendOutcome` shape (same pattern as
  `ReceiveOutcome` / `LightningQuoteOutcome`).
- HomeView's `Send` button wired to present the new carousel as a
  `.sheet`.
- Swift FFI regeneration via `bindings/swift/generate-bindings.sh` so
  the new symbols appear in `AgicashSDK/agicash_ffi.swift`.
- Manual sim verification of a round-trip token send against the local
  mint stack.

Explicitly out of scope:

- Lightning melt-quote FFI bridge (slice 8 UI lane).
- Lightning-Address FFI bridge.
- Account selector (multi-mint users get an `Internal` error mirroring
  the CLI's "account ambiguous — pass `--account <id>`"; AccountsView
  worker is adding default-account semantics on a parallel lane — we
  don't fight them).
- QR scanner for send (web has `Scan`; iOS Receive doesn't have it yet
  either; symmetric).
- A real async receiver-claim watcher on the Rust side (the operator
  explicitly flagged this as deferred — we poll from iOS instead).
- DLEQ verification on the receive side of the token we just produced
  (sender doesn't claim their own token).

## Web app references

Read before coding for design source-of-truth:

- `app/features/send/index.tsx` — public surface (`SendInput`,
  `CreateCashuTokenConfirmation`, `ShareCashuToken`).
- `app/features/send/send-input.tsx` — the amount-entry page. The iOS
  surface borrows the bones: large amount display + `Numpad` + a
  Continue/CTA. We drop the destination chip (Cashu-out has no
  destination) and the account selector (single-account v0).
- `app/features/send/send-confirmation.tsx` — the
  `CreateCashuTokenConfirmation` panel. Shows the quote breakdown
  (amount, send fee, receive fee, total). iOS mirrors the breakdown
  numerically; visually it's a `brandCard` like the Lightning Receive
  invoice card.
- `app/features/send/share-cashu-token.tsx` + the
  `_protected.send.share.$swapId.tsx` route — the share + watch flow.
  Web uses a CDK websocket subscription via
  `proof-state-subscription-manager.ts` and `useTrackCashuSendSwap`
  drives the navigate-to-receipt on COMPLETED. iOS replaces the socket
  with poll-every-3s of a new FFI `check_send_swap_claimed`.

## FFI surface

Two phases — quote then commit, plus a poll:

```rust
// crates/agicash-ffi/src/send.rs (new file)

#[derive(Debug, Clone, uniffi::Record)]
pub struct SendQuotePreview {
    pub amount_requested: String,   // user-typed
    pub amount_to_send:   String,   // encoded in token (incl. receive fee)
    pub total_amount:     String,   // amount_to_send + send fee
    pub total_fee:        String,
    pub cashu_send_fee:   String,
    pub cashu_receive_fee: String,
    pub unit:     String,
    pub currency: String,
    pub account_id: String,
    pub mint_url:   String,
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct SendSwapHandle {
    pub swap_id:       String,   // UUID — pass to check_send_swap_claimed
    pub token:         String,   // V4 (cashuB…) wire token
    pub amount:        String,   // amount_received (decimal-stringified)
    pub fee:           String,   // total_fee
    pub unit:          String,
    pub currency:      String,
    pub account_id:    String,
    pub mint_url:      String,
}

#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum SendSwapClaimState {
    Pending,    // proofs still UNSPENT — keep polling
    Completed,  // all proofs SPENT — receiver claimed
    Failed,     // swap is FAILED (won't happen post-PENDING, included for completeness)
}

#[derive(Debug, Clone, uniffi::Record)]
pub struct SendSwapClaimSnapshot {
    pub state: SendSwapClaimState,
    pub failure_reason: Option<String>,
}
```

`AgicashWallet` gains three methods:

- `prepare_send_quote(amount: u64, account_id: Option<String>, currency: Option<String>) -> SendQuotePreview` — pure
  preview. Mirrors `cmd_send --dry-run`. iOS shows the breakdown before
  the user commits.
- `create_send_swap(amount: u64, account_id: Option<String>, currency: Option<String>) -> SendSwapHandle` —
  picks Cashu account by `(currency, account_id)`, runs
  `send_swap::create` + (if draft) `swap_for_proofs_to_send`, encodes a
  **V4** token, returns the handle. Mirrors `cmd_send` non-dry-run.
- `check_send_swap_claimed(swap_id: String) -> SendSwapClaimSnapshot` —
  reloads the swap from storage, runs NUT-07 `post_check_state` on its
  `proofs_to_send`, if all SPENT calls `service.complete()` to flip
  PENDING→COMPLETED, returns the snapshot.

The third method is what enables the polled proofs-spent confirmation
without a Rust-side watcher.

## Storage addition

`CashuSendSwapStorage::get(swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError>`
— single-row lookup. Mirrors `CashuMeltQuoteStorage::get`. The Supabase
impl SELECTs from `wallet.cashu_send_swaps` + joined `wallet.cashu_proofs`,
decrypts via the same `ProofEncryption` arc, decodes via the same row
deserializer the other operations use. Read-only; no RLS surprises (the
existing receive-side `get` patterns already pass).

## UI shape

### `SendCarouselView`

Direct sibling of `ReceiveCarouselView`. Three-tab carousel with the
same `TabIndicatorBar`:

| Tab | Icon | Status |
|-----|------|--------|
| Cashu | `banknote` | Real implementation |
| Lightning | `bolt.fill` | Placeholder ("Coming soon") |
| Lightning Address | `at` | Placeholder ("Coming soon") |

Defaults to `cashu` (the only real one). Same toolbar + close button +
brandBackground as `ReceiveCarouselView`.

### `SendCashuTokenView`

State machine:

```
amountEntry  ─submit─▶  quoting  ─quote─▶  confirming  ─send─▶  swapping  ─token─▶  share  ─poll─▶  claimed
     ▲                     │                    │                  │                   │
     └─────────cancel──────┴─────error──────────┴──error──────────┴─────error─────────┘
```

- `amountEntry` — visual clone of `LightningReceiveView.amountEntryView`.
  Hero amount + `unit` label + `AmountNumpad` + "Continue" `BrandButton`.
- `quoting` — short spinner ("Preparing send…") while
  `prepare_send_quote` runs. Server round-trip can take 200–500ms.
- `confirming` — `brandCard` showing amount + fee breakdown + Send +
  Cancel buttons. Mirrors web `CreateCashuTokenConfirmation`.
- `swapping` — spinner ("Producing token…") while `create_send_swap`
  runs.
- `share` — main delivery. Card with: large amount, the truncated token
  string (tap to copy with haptic + toast), a Share button that pops
  iOS's `UIActivityViewController`, a status row ("Waiting for
  receiver…") with a small spinner. A long-running `Task` polls
  `check_send_swap_claimed` every 3 s. When `Completed` →
  transition to `claimed`.
- `claimed` — green checkmark + "Sent" + the same amount. Auto-dismiss
  the carousel after 3 s; user can tap Done sooner.
- Error states: a `FailureCard` styled the same way as the Lightning
  Receive one. Try-again returns to `amountEntry`.

QR code is intentionally omitted in v0 — Cashu tokens are long; a copy +
native share sheet is the meaningful affordance. (Web shows a QR but
also a tap-to-copy.) Easy follow-up if visible feedback proves
necessary.

### HomeView wire-up

`HomeView.HomeActionGrid` already has the `Send` button stub. Wire it
the same way `Receive` works: a `@State var showSend: Bool` toggles a
`.sheet` containing `SendCarouselView`.

## Polling-vs-watcher rationale

The operator flagged three options for proofs-spent UX:

1. Manual refresh button.
2. iOS-driven polling.
3. De-defer the rust-side watcher.

Polling wins for this lane because:

- It keeps orchestrator work out of a UI lane.
- The cost is one NUT-07 round-trip every 3 s while the share screen is
  on screen. CDK's `post_check_state` is cheap; mints handle it
  routinely.
- The web app's `proof-state-subscription-manager.ts` does essentially
  the same thing via websocket — same semantic (mint says "yep, those
  proofs are spent"), different transport.
- When the rust-side watcher lands later, `check_send_swap_claimed`
  remains useful: a `cmd-tab back to the app` users still want the
  "yes it landed" verification.

3-second cadence matches the `LightningReceiveView` choice (which
polls every 2 s); slightly slower because send-share is less time
sensitive than waiting for an incoming Lightning invoice to pay.

## Test plan

Rust unit tests:

- `prepare_send_quote` + `create_send_swap` + `check_send_swap_claimed`
  unauth → `FfiError::Auth { UNAUTHENTICATED }`.
- New `SupabaseCashuSendSwapStorage::get` round-trip against a created
  swap (uses existing test fixtures).
- (Real-mint feature-gated) full round-trip: mint 64 sats → send 32
  sats → encode token → restore using a fresh wallet → confirm
  `check_send_swap_claimed` flips to `Completed`.

iOS manual smoke (sim):

1. Sign in as guest, add the local devmint, receive 100 sats via
   Lightning.
2. Tap Home → Send → numpad enter 64 → Continue → see fee breakdown.
3. Tap Send → see spinner → share screen.
4. Copy token. Paste it into the Receive flow on the same sim (or a CLI
   `agicash receive token …` against a separate guest account).
5. Within ~6 s the share screen flips to "Sent" and auto-dismisses.

## Branch / commit shape

- Branch: `feat/ios-send-cashu`.
- Phased commits:
  1. `feat(send_swap): add storage.get()`
  2. `feat(ffi): expose AgicashWallet Cashu send (prepare/create/check-claimed)`
  3. `chore(swift-ffi): regenerate bindings with Cashu send`
  4. `feat(ios): SendCarouselView + tab indicator scaffolding`
  5. `feat(ios): SendCashuTokenView (amount → confirm → share → claimed)`
  6. `feat(ios): wire Home Send button to SendCarouselView`

NO PR — per project convention (`feedback_agicash_no_prs.md`). Branch
stays local until the operator integrates it.
