# iOS Receive UX Redesign — Carousel + Numpad + Buy Integration

Status: draft — implemented under `feat/ios-receive-ux`.
Author: ios-receive-ux lane.
Date: 2026-05-15.

## Why

The current iOS Receive surface is a single modal sheet centred on a paste
field. Functional, but form-y: it asks the user to act like a database
operator (pick the right field, paste a token, press Receive) before
showing them anything useful. The web app multiplexes receive across
several routes (`/receive`, `/receive/cashu`, `/receive/spark`,
`/receive/scan`, `/receive/cashu/token`). iOS should not reproduce the
multi-route hop — it should give the same expressive surface area with
swipe-native gestures and an opinionated, banking-app-feel amount entry.

The operator wants:

1. The Home `Receive` button to drop the user into a swipeable carousel.
2. A carousel page for Cashu-token paste (today's flow, refactored).
3. A carousel page for Lightning receive with a custom numpad → BOLT-11
   invoice → success.
4. The standalone Home `Buy` button to disappear, with Buy folded into
   the Receive surface in whichever location reads most naturally.

## Buy: two or three tabs?

Three options were on the table:

- **Third tab.** Add a `$` icon next to the banknote and bolt. Buy
  becomes a peer with Cashu paste and Lightning receive.
- **Footer link.** Inside the Lightning numpad show "Not enough sats?
  **Buy more.**"
- **Contextual on Home.** Show a "Buy sats" pill near the balance when
  it is low.

### Decision: third tab (`$` icon)

The Buy flow on web is its own first-class route
(`/buy/{_index, checkout}`), not a sidecar inside Receive. It has a
distinct mental model — fiat-in via Cash App vs. crypto-in via paste or
Lightning — and it has its own quote/checkout state machine. Burying it
inside the Lightning numpad would (a) hide it from users who land in
Cashu paste and (b) conflate "I have a Lightning wallet that can pay
this invoice" with "I have no sats yet; I need fiat." A footer link is
context-confused.

The contextual-on-Home pill is appealing but ambient: discoverable when
the balance is low but invisible when topped up. It also doesn't replace
the Buy button as cleanly — it merely supplements another entry point
the operator wanted to remove.

A peer tab matches the carousel's "ways to put money into this wallet"
mental model exactly. Banknote (proofs handed to me), bolt (someone
paying me on Lightning), dollar (I'm buying with fiat). Three peers,
three icons, one swipe gesture. The user discovers Buy without ever
having to know the standalone home button used to exist.

The tab order is `banknote → bolt → dollar`, mirroring the
crypto-in-hand → crypto-on-rails → fiat-in spectrum. The carousel
defaults to `bolt` (Lightning) since that's the most common
"someone-please-pay-me" intent and the most visually compelling first
impression.

## Carousel pattern

Use SwiftUI's native `TabView` with `.tabViewStyle(.page(indexDisplayMode:
.never))`. This gives us:

- Free swipe gestures with rubber-banding at the edges.
- Free programmatic selection via a `@State var selectedTab: ReceiveTab`.
- No third-party deps, no custom `DragGesture` plumbing.

We *suppress* the default page-indicator dots and render our own
**bottom navbar** with three tappable icons. Reasons:

- The default dots are positional ("page 1/2/3") with no semantic
  meaning. Users can't tell "I'm on the Lightning tab" from "I'm on the
  second dot."
- Our icons carry meaning (banknote = cashu, bolt = lightning, dollar =
  buy) and operate as both indicator and tap-target.
- Tapping an icon programmatically sets `selectedTab`; `TabView` animates
  the transition. Swipe and tap both feed the same state.

The indicator pill (the highlighted active icon) uses the brand primary
foreground; inactive icons use `brandMutedForeground`. 56pt total height
for the navbar, 32pt icon size, evenly spaced. Mirrors the visual rhythm
of Apple Mail's bottom toolbar.

## Custom amount numpad

This is the most opinionated piece and the one that most determines the
"feels like a native banking app" perception. The web uses
`~/components/numpad.tsx` (Numpad + MoneyInputDisplay). We do not import
that — SwiftUI has no React. Instead we ship `AmountNumpad.swift`, a
3×4 grid that reads:

```
 1   2   3
 4   5   6
 7   8   9
 .   0   ⌫
```

### Layout decisions

- **3×4 grid.** Matches the iPhone calculator and Cash App. The bottom
  row holds `.` (decimal), `0`, and `⌫` (delete). No `+/-`, no
  scientific row, no currency switcher inline.
- **Currency switcher above, not inline.** The display strip above the
  numpad shows the current amount with the currency symbol prefix (`$0`
  or `0 sats`) in `Teko Bold` 60pt to match the home balance. Tapping
  the currency suffix swaps SAT ↔ USD (one-direction toggle; the wallet
  only supports two currencies for Lightning today). Avoids cluttering
  the numpad row with a fifth key.
- **Haptic feedback.** Each digit press fires
  `UIImpactFeedbackGenerator(style: .light).impactOccurred()`. The
  delete key fires `.medium`. Backspace-and-hold clears entirely (long
  press resets to "0").
- **Continue CTA below.** A `BrandButton(.primary)` labelled "Create
  invoice" sits under the numpad. Disabled when the amount is `0` or
  `.` with no trailing digits.

### Input behavior

The numpad is an **accumulator** (string-builder) not a formatter:

- Pressing digits appends to a raw string buffer (max 9 characters to
  avoid overflowing 64-bit sats).
- Pressing `.` is a no-op if the buffer already contains a `.`, and a
  no-op for sat-mode (sats are integer).
- Pressing `⌫` pops the last character.
- A leading `0` is replaced by the first digit pressed (so "01" doesn't
  appear; "1" does).
- The display strip parses the buffer into a `Decimal` and formats with
  thousands separators (`12,345`).

This matches Cash App / Venmo / Apple Wallet behaviour; SwiftUI's
`TextField` with `.numberPad` keyboard does NOT match it (the system
keyboard shows a return key, occupies more vertical space, and doesn't
fire haptics on each digit).

### Max-amount validation

- Sat mode: max 21,000,000 * 100,000,000 = 2.1×10^15 sats. Practically
  capped at 9 digits (999,999,999 sats ≈ 9.99 BTC) for the UI to keep
  the display from line-wrapping.
- USD mode: max 999,999.99. 9 characters including the dot.
- The Continue button shows `Amount too large` inline (red caption
  under the display) if the user tries to exceed the cap.

## Per-tab views

### `CashuTokenPasteView`

Refactor of the existing `ReceiveView`'s `ReceiveFormCard` +
`ReceiveSuccessCard` extracted into a single view bound to the carousel.
No behaviour change. Loses the `NavigationStack`, the toolbar, and the
sheet chrome — the carousel host provides those. Gains a `Spacer` at the
bottom so it visually sits above the navbar.

### `LightningReceiveView`

State machine:

```
amountEntry → generating → invoice → completed → (auto-back to entry after success)
                            ↓
                          failed (inline error, back to amountEntry on retry)
```

- **amountEntry**: shows the numpad + Continue CTA.
- **generating**: shows a centered spinner with "Requesting invoice from
  mint…". Triggered by `WalletViewModel.startLightningQuote(...)`.
- **invoice**: shows a QR code (256pt), the BOLT-11 string truncated
  with copy-on-tap, the amount + fee breakdown, and a Cancel button.
  Polls the FFI every 2s via a long-running `Task`.
- **completed**: shows a green checkmark + "Received N sats", with
  "Receive more" (back to amountEntry) and "Done" (closes the carousel)
  CTAs. Auto-dismisses after 4s if the user doesn't tap.
- **failed**: shows the failure reason inline; "Try again" button bounces
  back to amountEntry.

### `BuyView`

Placeholder this lane. Visually scaffolded to look like the other tabs
(brand card, title, body) with a "Coming soon — Cash App buy flow" inset.
The web app's `BuyInput` integrates with `getBuyQuote` + Cash App;
plumbing that through the FFI is its own slice (NUT-26 onchain + Cash
App SDK are not in this lane).

## FFI surface

Three new methods on `AgicashWallet`:

```rust
pub async fn start_mint_quote(
    &self,
    amount: u64,
    account_id: Option<String>,
    currency: Option<String>,
) -> Result<MintQuoteHandle, FfiError>;

pub async fn poll_mint_quote(
    &self,
    quote_id: String,
) -> Result<MintQuoteSnapshot, FfiError>;

pub async fn complete_mint_quote(
    &self,
    quote_id: String,
) -> Result<ReceiveResult, FfiError>;
```

### Returned types

```rust
pub struct MintQuoteHandle {
    pub quote_id: String,           // wallet-side UUID (storage row)
    pub mint_quote_id: String,      // mint-side NUT-04 quote id
    pub invoice: String,            // BOLT-11
    pub payment_hash: String,
    pub amount: String,             // decimal-stringified
    pub fee: String,                // decimal-stringified (zero if minting_fee = None)
    pub unit: String,               // "sat" / "usd"
    pub currency: String,           // "BTC" / "USD"
    pub account_id: String,
    pub expires_at: String,         // ISO 8601
}

pub enum MintQuoteFfiState {
    Unpaid,
    Paid,
    Completed,
    Expired,
    Failed,
}

pub struct MintQuoteSnapshot {
    pub state: MintQuoteFfiState,
    pub failure_reason: Option<String>,
}
```

### Behaviour

- `start_mint_quote` wraps `CashuMintQuoteService::create_quote`. Picks
  the matching account by `(currency, account_type=Cashu)` using the same
  selector the CLI uses (`pick_account`); if `account_id` is passed,
  honors it; if multiple Cashu accounts exist and no id was passed,
  returns `Internal { message: "account ambiguous — pass account_id" }`.
- `poll_mint_quote` calls the service's storage `get(...)` to read the
  current row, then if `Unpaid` calls `wallet.connector().get_mint_quote_status`
  via a single-shot poll (no long-running loop on the FFI side; iOS owns
  the cadence). On observing `Paid|Issued`, transitions storage to PAID
  via `do_process_payment` then returns `Paid`. On `Unpaid` returns
  `Unpaid` unchanged.
- `complete_mint_quote` calls `CashuMintQuoteService::complete_receive`.
  Returns a `ReceiveResult` shape identical to `receive_token`'s output
  so the iOS UI can render success the same way.

The split between `poll_mint_quote` (single-shot, returns current state)
and `complete_mint_quote` (drives PAID → COMPLETED, mints proofs) means
the iOS app owns the polling timer and can show distinct UI for each
phase. Web's `useCashuReceiveQuote` does the same.

## Success state on each tab

- **Cashu paste success** auto-dismisses the *sheet* after 2s (existing
  behaviour) — preserved. The carousel as a whole closes.
- **Lightning success** stays inside the Lightning tab on the
  `completed` state for 4s, showing "Received N sats" + the two CTAs.
  "Receive more" resets to amountEntry inside the same tab (the user
  keeps the same Lightning context). "Done" dismisses the carousel.
- **Buy** stub has no success state in this lane.

The carousel host is presented via `.sheet(isPresented:)` from `HomeView`
as before; tab switches happen inside the sheet. The Home `Receive`
button calls `showReceive = true` with `selectedTab = .lightning`
(deep-linked default). Future work: an `IntentReceiveTab` enum so a
deep link from `agicash://receive/cashu` or a NFC tap can route to a
specific tab.

## Home button changes

- Remove the standalone `Buy` button from `HomeActionGrid`.
- The `Receive` button now opens `ReceiveCarouselView` (renamed from
  the inline `.sheet(ReceiveView)`).
- The `Send` button is unchanged (separate lane).

The grid collapses from `[Receive, Buy] / [Send]` to `[Receive] /
[Send]` — two full-width buttons stacked vertically. The web app's home
will continue to ship Buy as its own button (no parity break — the iOS
brief says iOS-only).

## Deferred / out of scope

- Real Buy integration (Cash App SDK + onramp).
- Account picker inside Lightning receive (we pick the default Cashu
  BTC account; multi-mint users get the first match).
- NIP-20 invoice locking.
- Polling cadence tuning (2s fixed in this lane; web uses 1s but with
  websocket fallback).
- iOS NotificationCenter wiring for receive-completed (push notifications
  while the app is backgrounded).
- Sat ↔ USD currency conversion at the numpad (today both modes work
  but the display strip doesn't show the converted amount the way the
  web does via `MoneyWithConvertedAmount`).
