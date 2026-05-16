# Cashu Receive Orchestrator (sans-IO state machine)

Date: 2026-05-15
Status: in progress
Scope: rust core + FFI surface
Out of scope: iOS UI rewiring, Android UI, Lightning receive

## Motivation

The current `AgicashWallet::receive_token` FFI is a one-shot async call: parse
the token, look up the matching `(mint_url, currency)` account, swap, return.
If the user doesn't have an account at the token's mint the call fails
immediately with `no matching account for mint <url> — add the mint first`,
and the iOS app has no graceful way to recover. The Android app would inherit
the same dead end. WASM (future) would too.

Meanwhile the web app at `app/features/receive/receive-cashu-token.tsx` has a
real multi-step flow: parse → discover mint → optionally add mint → present
account picker → swap → show outcome. The state lives in React hooks (
`useReceiveCashuTokenAccounts`, `useCashuTokenWithClaimableProofs`,
`useCreateCashuReceiveSwap`) and is glued together with manual `useState`
transitions and React-Query mutations.

We want the same flow available to all UI shells (iOS, Android, WASM) without
each shell re-implementing it. The same rust state machine should drive all
three; the UI's job becomes: render the current state, dispatch user events.

## Web flow inventory

Source files audited:
- `app/features/receive/receive-cashu-token.tsx` — top-level page component.
- `app/features/receive/receive-cashu-token-hooks.ts` — orchestration hooks.
- `app/features/receive/receive-cashu-token-service.ts` — account discovery.
- `app/features/receive/claim-cashu-token-service.ts` — non-React flow used
  by the auto-claim path.
- `app/features/receive/receive-cashu-token-models.ts` — `isClaimingToSameCashuAccount`
- `app/features/receive/cashu-receive-swap-service.ts` — the same-account swap
  (already mirrored in rust at `receive_swap/service.rs`).

States and transitions (extracted):

| Stage | Web behavior |
| --- | --- |
| Token parse | `useCashuTokenWithClaimableProofs` — fetch `getUnspentProofsFromToken`, filter to claimable proofs, classify error reasons (`offline mint`, `already spent`, `unsupported lock`). |
| Discover source mint | `useCashuTokenSourceAccountQuery` → `getSourceAndDestinationAccounts`: if mint+unit is already in `accounts`, mark source as known; otherwise call `buildAccountForMint` (NUT-06 + active keyset). |
| Pick destination | `getDefaultReceiveAccount`: respect preferred, fall back to default account at same currency, fall back to source. |
| User decides | Account picker (multi-account; defaults to source for test mints / gift cards because lightning melt is blocked). |
| Add mint | If chosen account is `isUnknown` and `type === 'cashu'`, call `addCashuAccount` (which does `upsert_user_with_accounts`). |
| Same-account swap | `useCreateCashuReceiveSwap` → `CashuReceiveSwapService.create` + `completeSwap`. |
| Cross-account claim | `useCreateCrossAccountReceiveQuotes` (mint quote on source + receive quote on destination + melt). |
| Locked tokens | Filtered out at parse time (`getClaimableProofs(unspentProofs, cashuPubKey ? [cashuPubKey] : [])`). Currently no P2PK signing UI. |
| Already-claimed | `CashuReceiveSwapStorage.create` returns 23505 → service surfaces `AlreadyClaimed`. |
| Mint mismatch | Service rejects pre-create with `MintMismatch` / `CurrencyMismatch`. |
| Partial claim | Web's `getUnspentProofsFromToken` filters spent proofs out before swap; mint sees only the unspent subset. |
| Restore-fallback | `cashu-receive-swap-service.ts` `swapProofs()` catches `OUTPUT_ALREADY_SIGNED` / `TOKEN_ALREADY_SPENT`, calls `wallet.restore()`, returns the restored proofs. Already mirrored in rust's `receive_swap/service.rs`. |
| Error toasts | `getErrorMessage(error)` formatted with `toast({ variant: 'destructive' })`. |

## What we ship in this lane

Cashu-token-only, same-account claim only (matches the rust `receive_swap`
service's surface). Cross-account claims (`useCreateCrossAccountReceiveQuotes`)
stay in the web layer for now — they require the cashu→lightning melt path
which the rust core hasn't ported yet (slice 7 / Lightning will).

Locked tokens (NUT-11/NUT-14) stay deferred (web doesn't support P2PK signing
either — it filters those proofs out at parse). Restore-fallback is already
covered by the existing `receive_swap` service.

## State diagram

```text
   ┌──────────┐
   │  Idle    │  ── Start { token, preferred_account_id? } ─┐
   └──────────┘                                              │
                                                             v
                                                       ┌──────────┐
                                                       │ Parsing  │
                                                       └────┬─────┘
                                                            │
                              parse error  ───────────┐     │
                                                      v     v
                                                 ┌─────────────┐   ┌────────────────────────┐
                                                 │   Failed    │   │ AccountResolved        │
                                                 │  (reason)   │<──│ source known + dest    │
                                                 └─────────────┘   │ picked (same-mint)     │
                                                            ▲      └──────┬─────────────────┘
                              account picker on iOS (later)│             │ same-mint, account exists
                                                            │             v
              ┌────────────────────────────────┐            │       ┌──────────────┐
              │  NeedsMintConfirmation         │── Cancel ──┘       │  Swapping    │
              │  { mint_url, name, unit,       │                    └──────┬───────┘
              │    amount }                    │── Confirm ──┐             │
              └────────────────────────────────┘             v             │
                              ▲                       ┌──────────────┐    │
                              │ source mint missing   │ AddingMint   │    │
                              │ in user's accounts    └──────┬───────┘    │
                              │                              │ add_ok     │
                              │                              v            v
                              │                       ┌──────────────────────┐
                              │                       │      Swapping        │
                              │                       └──────────┬───────────┘
                              │                                  │
                              │  swap ok / already-claimed       │ swap failed
                              │                                  v
                              v                       ┌──────────────────────┐
                       ┌─────────────┐                │       Failed         │
                       │    Done     │                │   { reason }         │
                       │  { result } │                └──────────────────────┘
                       └─────────────┘
```

## Public API

### States (UI snapshots)

```rust
pub enum ReceiveFlowState {
    /// Nothing started. `Start` event moves us out of this.
    Idle,
    /// Token is being parsed + source mint resolved.
    Parsing,
    /// Token parsed and source mint is unknown to the user. UI shows
    /// "Add this mint?" prompt. UI dispatches ConfirmAddMint or
    /// CancelAddMint.
    NeedsMintConfirmation {
        mint_url: String,
        mint_name: String,
        unit: String,
        currency: String,
        amount: String,  // decimal-stringified
        fee: String,
    },
    /// Adding the mint to the user's accounts (calling
    /// upsert_user_with_accounts).
    AddingMint { mint_url: String },
    /// Running the swap (create + complete) with the mint.
    Swapping { account_id: String, mint_url: String },
    /// Terminal success. UI shows the receipt.
    Done(ReceiveFlowResult),
    /// Terminal failure. UI shows the reason + Dismiss/Retry.
    Failed { reason: String, code: String },
}

pub struct ReceiveFlowResult {
    pub status: ReceiveStatus,  // Received / AlreadyClaimed / AlreadyFailed
    pub amount: String,
    pub fee: String,
    pub unit: String,
    pub currency: String,
    pub account_id: String,
    pub mint_url: String,
    pub token_hash: String,
}
```

### Events (UI dispatches)

```rust
pub enum ReceiveFlowEvent {
    Start { token: String },
    ConfirmAddMint,   // user said yes to the "Add this mint?" prompt
    CancelAddMint,    // user said no — flow goes to Failed("user cancelled")
    Retry,            // restart from Idle (allows re-dispatching Start)
    Dismiss,          // drop the terminal state, go back to Idle
}
```

### Codes for `Failed.code`

Discriminators the UI switches on. Strings, kept stable so iOS / Android
can match on them:

- `token-parse` — malformed / unsupported token
- `token-spent` — all proofs already spent
- `token-locked` — proofs require unsupported witness (NUT-11/14)
- `mint-offline` — NUT-06 fetch failed
- `mint-add-failed` — `upsert_user_with_accounts` failed
- `swap-failed` — mint swap failed (network or protocol)
- `already-claimed` — same user previously claimed
- `cancelled` — user dismissed the "Add this mint?" prompt
- `unknown`

## Code layout

```
crates/agicash-cashu/src/receive_flow/
  mod.rs        — re-exports
  types.rs      — ReceiveFlowState, ReceiveFlowEvent, ReceiveFlowResult,
                  ReceiveFlowError, ReceiveStatus (re-export from receive_swap)
  state.rs      — sans-IO state machine (mirrors receive_swap/state.rs)
  service.rs    — ReceiveFlowService orchestrator. Holds:
                    * UserStorage (for list_accounts + upsert_user)
                    * Arc<dyn CashuProvider>
                    * Arc<CashuReceiveSwapService>
                    * UserId
                    * fn that returns cashu seed
                  Composes mint_add + receive_swap.
```

Inside `service.rs` we add a private `add_mint` helper that mirrors what
`crates/agicash-cli/src/mint.rs::cmd_mint_add` does — call `provider.mint_info`,
then `storage.upsert_user_with_accounts` with a single Cashu account input.
We do NOT touch the FFI's `mint_add` method (the sister `ios-scaffold`
worktree may add one separately — non-overlapping with our orchestrator's
private helper).

## FFI shape

Decision: long-lived handle, polled by the UI.

```rust
#[uniffi::Object]
pub struct ReceiveFlow {
    inner: Arc<Mutex<ReceiveFlowMachine>>,
    service: ReceiveFlowService,
}

#[uniffi::export(async_runtime = "tokio")]
impl ReceiveFlow {
    /// Snapshot the current state — UI calls this from a tight polling loop
    /// or after each dispatch.
    pub async fn current_state(&self) -> ReceiveFlowStateFfi;

    /// Send the user event into the machine. Returns when the next stable
    /// state is reached (i.e., we're waiting on user input again or hit a
    /// terminal). Side effects (parse, mint add, swap) happen inside.
    pub async fn dispatch(&self, event: ReceiveFlowEventFfi) -> Result<ReceiveFlowStateFfi, FfiError>;
}

#[uniffi::export(async_runtime = "tokio")]
impl AgicashWallet {
    /// Construct a fresh receive flow handle. Each call returns a new
    /// machine — flows are not persisted server-side.
    pub fn receive_flow(self: Arc<Self>) -> Result<Arc<ReceiveFlow>, FfiError>;
}
```

UI usage on iOS (Swift):

```swift
let flow = try wallet.receiveFlow()
let s1 = try await flow.dispatch(event: .start(token: scannedToken))
// renders Parsing → AccountResolved or NeedsMintConfirmation
if case .needsMintConfirmation = s1 {
  // user taps "Add and Claim"
  let s2 = try await flow.dispatch(event: .confirmAddMint)
  // renders AddingMint → Swapping → Done
}
```

Rejected alternative: callback subscription. Callbacks across the FFI seam
add complexity (lifetime, threading) for marginal benefit when `dispatch`
already returns the next stable state. We can add subscriptions later.

## What differs from web

- **Single-account-per-token** for now. Web shows a destination picker
  (source vs. spark vs. other mints). Orchestrator only handles
  same-account claim (matches what the rust core can do today). Other
  destinations will be a follow-up state when slice 7 lands lightning melt.
- **No gift-card terms acceptance.** Web has `accept-terms` step gated by
  `accountRequiresGiftCardTermsAcceptance`. iOS doesn't surface gift cards
  in v0; we keep the FFI shape simple.
- **No guest signup flow inside the orchestrator.** Web's
  `PublicReceiveCashuToken` requires auth before the orchestrator runs;
  the iOS app handles login as a separate concern.
- **No `claimTo` preference param.** Add later when needed; default account
  selection (already exists in `getDefaultReceiveAccount`) covers the v0
  iOS need.

## Implementation order

1. `feat(cashu): receive_flow scaffolding (types + state enum + error)`
2. `feat(cashu): sans-IO state machine for receive flow` (pure transitions)
3. `feat(cashu): ReceiveFlowService orchestrator` (composes mint_add + CashuReceiveSwapService)
4. `feat(ffi): expose ReceiveFlow handle with current_state + dispatch`
5. `feat(swift-ffi): regenerate bindings with ReceiveFlow`
6. `test(cashu): unit tests for receive_flow state machine` (already in step 2)
7. `test(cli): integration test for receive_flow against testnut` (gated on env)

Each step ships as one commit so review can land incrementally.
