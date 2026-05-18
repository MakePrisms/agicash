# iOS Send — Cashu Token (Scope A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working Cashu-token send flow on iOS by adding the FFI bridge for `send_swap` and a numpad → confirm → share → claimed UI mirroring the existing Lightning Receive surface.

**Architecture:** Three new FFI methods on `AgicashWallet` (prepare quote, create swap, check claimed), one new storage method (`get(swap_id)`), regenerated Swift bindings, and a new `SendCarouselView` + `SendCashuTokenView` pair anchored from Home via `.sheet`. Polling drives the proofs-spent confirmation in lieu of a rust-side watcher.

**Tech Stack:** Rust 1.88 + UniFFI 0.30 + tokio + CDK (`MintConnector::post_check_state`); Swift / SwiftUI; the existing `bindings/swift/generate-bindings.sh` script.

---

## Repository orientation

Worktree root: `/Users/claude/agicash/.claude/worktrees/ios-send-cashu`. Branch: `feat/ios-send-cashu` (off `ee37a642`).

All paths in this plan are absolute. The iOS app lives at `ios/Agicash/Agicash/`. Rust crates live at `crates/`. Swift binding wrapper lives at `bindings/swift/`.

Existing reference patterns the engineer should read before starting:

- `crates/agicash-ffi/src/mint_quote.rs` — value-type pattern for new FFI records.
- `crates/agicash-ffi/src/wallet.rs` (`start_mint_quote`, `poll_mint_quote`, `complete_mint_quote`) — wallet-method pattern, account picker, error funnel.
- `crates/agicash-cli/src/send.rs` — the CLI send command that already does what we need to expose; mirrors structure.
- `crates/agicash-cashu/src/melt_quote/storage.rs` (the `get` method) — single-row read pattern for the storage trait addition.
- `crates/agicash-storage-supabase/src/cashu_melt_quote_storage.rs` — Supabase impl of single-row get.
- `ios/Agicash/Agicash/LightningReceiveView.swift` — full state machine + polling Task pattern + numpad usage. Most-cloned file.
- `ios/Agicash/Agicash/ReceiveCarouselView.swift` — three-tab carousel with custom indicator.
- `ios/Agicash/Agicash/CashuTokenPasteView.swift` — phase-machine + brandCard layout. Companion to the share screen layout.
- `app/features/send/share-cashu-token.tsx` — visual reference for share screen.
- `app/features/send/send-confirmation.tsx` — visual reference for confirm screen.

## File structure

| File | Disposition | Purpose |
|------|-------------|---------|
| `crates/agicash-cashu/src/send_swap/storage.rs` | modify | Add `get(swap_id)` to the trait. |
| `crates/agicash-cashu/src/send_swap/mod.rs` | check only | Confirm re-exports cover what FFI needs. |
| `crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs` | modify | Implement `get(swap_id)`. |
| `crates/agicash-ffi/src/send.rs` | create | New FFI value types: `SendQuotePreview`, `SendSwapHandle`, `SendSwapClaimSnapshot`, `SendSwapClaimState`. |
| `crates/agicash-ffi/src/lib.rs` | modify | Wire `pub mod send;` + re-export. |
| `crates/agicash-ffi/src/wallet.rs` | modify | Add `prepare_send_quote`, `create_send_swap`, `check_send_swap_claimed`; instantiate `CashuSendSwapService` in the constructor. |
| `bindings/swift/Sources/AgicashSDK/agicash_ffi.swift` | regenerate | Output of `generate-bindings.sh`. |
| `ios/Agicash/Agicash/WalletViewModel.swift` | modify | Add `prepareSend`, `createSend`, `pollSendClaim`; new `SendOutcome` / `SendQuoteOutcome` / `SendClaimOutcome` enums. |
| `ios/Agicash/Agicash/SendCarouselView.swift` | create | Three-tab carousel mirror of `ReceiveCarouselView`. |
| `ios/Agicash/Agicash/SendCashuTokenView.swift` | create | The five-phase numpad → confirm → share → claimed state machine. |
| `ios/Agicash/Agicash/LightningSendPlaceholderView.swift` | create | "Coming soon" tab placeholder. |
| `ios/Agicash/Agicash/LightningAddressSendPlaceholderView.swift` | create | "Coming soon" tab placeholder. |
| `ios/Agicash/Agicash/HomeView.swift` | modify | Wire the `Send` button to present `SendCarouselView` via `.sheet`. |
| `ios/Agicash/Agicash.xcodeproj/project.pbxproj` | modify | Register new Swift files in the Xcode project. |

## Build / verify commands

- Rust unit tests: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo test -p agicash-cashu -p agicash-ffi -p agicash-storage-supabase`
- Rebuild Swift xcframework + bindings: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/bindings/swift && ./generate-bindings.sh`
- Build iOS app (sim): `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash && xcodebuild -scheme Agicash -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build`
- Run iOS app on sim: open in Xcode and ⌘R, or `xcrun simctl install … && xcrun simctl launch …` (the script `bindings/swift/generate-bindings.sh` shows the install pattern).
- Commit prefix: every `git commit` MUST be prefixed `PREK_ALLOW_NO_CONFIG=1` per `project_agicash_prek_bypass.md`.

---

## Task 1: Add `get(swap_id)` to `CashuSendSwapStorage` trait

**Files:**
- Modify: `crates/agicash-cashu/src/send_swap/storage.rs` (add trait method around line 73, after `list_unspent_proofs`)
- Modify: `crates/agicash-cashu/src/send_swap/error.rs` (add `NotFound` variant if missing — verify first)
- Test: `crates/agicash-cashu/src/send_swap/storage.rs` (compile-only — real round-trip test happens at the Supabase impl)

- [ ] **Step 1: Inspect the existing error enum**

Run: `grep -n "NotFound\|pub enum SendSwapStorageError" /Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-cashu/src/send_swap/error.rs`

If `NotFound` already exists, skip step 2. If not, proceed with step 2.

- [ ] **Step 2: Add `NotFound` to `SendSwapStorageError` if absent**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-cashu/src/send_swap/error.rs`, add a variant:

```rust
#[error("send swap not found: {0}")]
NotFound(uuid::Uuid),
```

inside the existing `pub enum SendSwapStorageError { … }` block. Match the existing variant style (the file already uses `#[error(...)]` annotations).

- [ ] **Step 3: Add `get(swap_id)` to the trait**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-cashu/src/send_swap/storage.rs`, after the existing `list_unspent_proofs` method (before the closing `}` of the trait), add:

```rust
    /// Fetch a single swap by primary key. Returns
    /// [`SendSwapStorageError::NotFound`] if absent.
    ///
    /// Mirrors `CashuMeltQuoteStorage::get`. Used by the FFI
    /// `check_send_swap_claimed` path so the iOS app can poll a swap's
    /// claim state by id without holding the full row locally.
    async fn get(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError>;
```

- [ ] **Step 4: Verify the workspace still compiles (Supabase impl will be missing the method — that's expected; fix in Task 2)**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo check -p agicash-cashu`
Expected: PASSES. (`agicash-storage-supabase` will fail; that's Task 2.)

- [ ] **Step 5: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-cashu/src/send_swap/storage.rs crates/agicash-cashu/src/send_swap/error.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(send_swap): add storage.get(swap_id) for single-row read"
```

---

## Task 2: Implement `SupabaseCashuSendSwapStorage::get(swap_id)`

**Files:**
- Modify: `crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs` (add method to the `impl CashuSendSwapStorage for SupabaseCashuSendSwapStorage` block)

- [ ] **Step 1: Read the existing single-row pattern in the receive-swap storage**

Open `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-storage-supabase/src/cashu_receive_swap_storage.rs` and find the closest analog (typically a function that does a select-then-decode + decryption). Copy the postgrest call style (`.from("...").select(...)`) and the row-decode pattern.

Also open `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-storage-supabase/src/cashu_melt_quote_storage.rs` and find the `async fn get` impl — same pattern, different row type. Use whichever is cleaner as a template.

- [ ] **Step 2: Locate the existing row-decode helper in the send-swap storage file**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs`, the file already deserializes `CashuSendSwapRow` (around line 68). Find the existing private function that converts a `CashuSendSwapRow` (+ decrypted blob) into a `CashuSendSwap` — it's used by `create` / `commit_proofs_to_send` / `complete` / `fail`. The new `get` will reuse that same helper.

- [ ] **Step 3: Add the `get` method to the impl block**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs`, inside the `#[async_trait] impl CashuSendSwapStorage for SupabaseCashuSendSwapStorage { … }` block, add:

```rust
    async fn get(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
        // Same shape the other ops select: pull the swap row + its
        // joined cashu_proofs (so the proofs-to-send blob is available
        // for the FFI's check_send_swap_claimed). The PostgREST embed
        // syntax matches `create_cashu_send_swap`'s RETURNING block.
        let resp = self
            .base
            .postgrest()
            .from("cashu_send_swaps")
            .schema("wallet")
            .select("*, cashu_proofs!cashu_send_swap_id(*)")
            .eq("id", swap_id.to_string())
            .single()
            .execute()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("get: {e}")))?;

        if resp.status() == 404 || resp.status() == 406 {
            return Err(SendSwapStorageError::NotFound(swap_id));
        }
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(SendSwapStorageError::Backend(format!(
                "get failed: {status} {body}"
            )));
        }

        let row: CashuSendSwapRow = resp
            .json()
            .await
            .map_err(|e| SendSwapStorageError::Backend(format!("decode get: {e}")))?;

        self.decode_row(row).await
    }
```

**Important sanity checks before pasting:**
- Verify `self.base.postgrest()` is the right accessor by greping `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs` for `self.base` — the existing methods (`create`, `complete`, etc.) all use whatever the accessor is. If the codebase uses `self.base.client()` or `self.base.request(...)`, adapt.
- Verify the embed name. The other methods in this file use `cashu_proofs!cashu_send_swap_id(...)` — copy that string verbatim.
- Verify the row-decode helper is named `decode_row` — if not, use whatever the existing methods call (likely something like `row_to_swap` or inlined). Worst case, inline the decode logic by copying from `commit_proofs_to_send`'s response-handling.

- [ ] **Step 4: Add a Rust unit test for the NotFound path**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs`, at the bottom (in the `#[cfg(test)] mod tests { … }` block — create it if not present, mirroring `cashu_melt_quote_storage.rs`'s test layout), add:

```rust
#[cfg(test)]
mod get_tests {
    use super::*;
    // Re-use the existing real-supabase test gate from the rest of the
    // crate (look for `#[cfg(all(test, feature = "supabase-integration-tests"))]`
    // or whichever feature-flag the existing ops use). Gate this test the
    // same way so it doesn't run on plain `cargo test`.
    // If no such gate exists, copy the gate the closest test uses.
}
```

If the file already has an integration-test gate, add this test under it; if not, defer this test (it's an integration test by definition — single-row read against postgrest can't be unit-tested without a fake client).

- [ ] **Step 5: Verify the workspace compiles**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo check -p agicash-storage-supabase`
Expected: PASSES.

- [ ] **Step 6: Run the existing storage tests to catch regressions**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo test -p agicash-storage-supabase --no-run`
Expected: COMPILES. (Full test run requires the local supabase; compile-only is the gate.)

- [ ] **Step 7: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(storage-supabase): implement CashuSendSwapStorage::get"
```

---

## Task 3: Create FFI value types for send

**Files:**
- Create: `crates/agicash-ffi/src/send.rs`
- Modify: `crates/agicash-ffi/src/lib.rs` (add `pub mod send; pub use send::*;`)

- [ ] **Step 1: Create the send.rs FFI module**

Create `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-ffi/src/send.rs` with:

```rust
//! FFI send-swap value types.
//!
//! Wrappers around `agicash_cashu::send_swap::{CashuSendSwap, SendQuote,
//! CashuSendSwapState}` flattened into Swift-codable primitives.
//!
//! Three records cover the iOS-facing surface:
//!
//! - [`SendQuotePreview`] — returned from `prepare_send_quote`. Carries
//!   the fee breakdown the confirm screen displays. No persistence
//!   side effect (mirrors `cmd_send --dry-run`).
//! - [`SendSwapHandle`] — returned from `create_send_swap`. Carries the
//!   wire-form token to share + the swap id for polling.
//! - [`SendSwapClaimSnapshot`] — returned from `check_send_swap_claimed`.
//!   A state discriminator the iOS poll loop reacts to.

/// Pre-commit quote shown on the confirmation screen.
///
/// All `Money`-valued fields are decimal-stringified to match the
/// [`crate::receive::ReceiveResult`] convention.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SendQuotePreview {
    /// What the user asked to send (their typed amount).
    pub amount_requested: String,
    /// What the receiver gets when they claim the token. Equals
    /// `amount_requested` (receive fee is added on top, paid by the
    /// receiver from the proofs themselves — sender doesn't see it as
    /// a separate "I paid this much" line).
    pub amount_to_send: String,
    /// `amount_to_send + cashu_send_fee` — total deducted from the
    /// sender's account.
    pub total_amount: String,
    /// `cashu_send_fee + cashu_receive_fee`.
    pub total_fee: String,
    /// Mint fee for the sender's input swap. Zero when the account
    /// already holds exact-amount proofs.
    pub cashu_send_fee: String,
    /// Mint fee the receiver pays when claiming (pre-paid by sender via
    /// the token's encoded value).
    pub cashu_receive_fee: String,
    /// Cashu sub-unit (`sat`, `usd`).
    pub unit: String,
    /// Wallet account currency (`BTC`, `USD`).
    pub currency: String,
    /// UUID of the account the send debits.
    pub account_id: String,
    /// Canonical mint URL.
    pub mint_url: String,
}

/// Handle returned by `create_send_swap`. The swap row is persisted
/// PENDING; `token` is the wire-form V4 string the sender hands to the
/// receiver; `swap_id` is the wallet-side UUID for follow-up polling.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SendSwapHandle {
    /// Wallet-side UUID. Pass to `check_send_swap_claimed`.
    pub swap_id: String,
    /// V4 (`cashuB…`) wire token the sender shares.
    pub token: String,
    /// What the receiver will get on claim. Decimal-stringified.
    pub amount: String,
    /// Total fee paid (decimal-stringified).
    pub fee: String,
    /// Cashu sub-unit (`sat`, `usd`).
    pub unit: String,
    /// Wallet account currency (`BTC`, `USD`).
    pub currency: String,
    /// UUID of the account that was debited.
    pub account_id: String,
    /// Canonical mint URL.
    pub mint_url: String,
}

/// Claim state of a previously-created send swap.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Enum)]
pub enum SendSwapClaimState {
    /// At least one proof in the token is still UNSPENT — receiver
    /// hasn't claimed yet, keep polling.
    Pending,
    /// All proofs are SPENT (or the swap row is already COMPLETED) —
    /// receiver claimed. The poll loop stops here.
    Completed,
    /// Swap is FAILED. Shouldn't happen post-PENDING in practice;
    /// included so the iOS UI can render a terminal error if it does.
    Failed,
}

/// Snapshot returned by `check_send_swap_claimed`.
///
/// `failure_reason` is only populated when `state == Failed`.
#[derive(Debug, Clone, uniffi::Record)]
pub struct SendSwapClaimSnapshot {
    pub state: SendSwapClaimState,
    pub failure_reason: Option<String>,
}
```

- [ ] **Step 2: Wire the module into the FFI crate**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-ffi/src/lib.rs`, add (alphabetically, after `pub mod receive_flow;`):

```rust
pub mod send;
```

and (after `pub use receive_flow::*;`):

```rust
pub use send::*;
```

- [ ] **Step 3: Verify it compiles**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo check -p agicash-ffi`
Expected: PASSES.

- [ ] **Step 4: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-ffi/src/send.rs crates/agicash-ffi/src/lib.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ffi): add Cashu send value types (preview/handle/claim-snapshot)"
```

---

## Task 4: Wire `CashuSendSwapService` into `AgicashWallet`

**Files:**
- Modify: `crates/agicash-ffi/src/wallet.rs` (constructor + struct field)

- [ ] **Step 1: Add the service field to the struct**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-ffi/src/wallet.rs`, in the `pub struct AgicashWallet { … }` block (around line 48), add a new field after `mint_quote_storage`:

```rust
    /// Send-swap orchestrator. Wired against the same `send_swap_storage`
    /// + `cashu_provider`. Drives `prepare_send_quote`, `create_send_swap`,
    /// `check_send_swap_claimed`. Mirrors `mint_quote_service`.
    send_swap_service: Arc<agicash_cashu::CashuSendSwapService>,
```

- [ ] **Step 2: Construct the service in `new()`**

In the same file, find the `Self { … }` block at the end of `new()` (~line 192). Just before it, after the `mint_quote_service` is constructed, add:

```rust
        let send_swap_service = Arc::new(agicash_cashu::CashuSendSwapService::new(
            Arc::clone(&send_swap_storage),
            Arc::clone(&cashu_provider),
        ));
```

Then in the `Self { … }` initialiser list, add the field:

```rust
            send_swap_service,
```

(placement adjacent to `mint_quote_service` for readability).

- [ ] **Step 3: Add the `CashuSendSwapService` import**

In the existing `use agicash_cashu::{ … };` block (~line 24), add `CashuSendSwapService` to the list of imports.

- [ ] **Step 4: Verify it compiles**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo check -p agicash-ffi`
Expected: PASSES.

- [ ] **Step 5: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-ffi/src/wallet.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ffi): wire CashuSendSwapService into AgicashWallet"
```

---

## Task 5: Implement `prepare_send_quote` on the wallet

**Files:**
- Modify: `crates/agicash-ffi/src/wallet.rs` (add method to the `#[uniffi::export] impl AgicashWallet { … }` block)

- [ ] **Step 1: Add the method**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-ffi/src/wallet.rs`, inside the `#[uniffi::export(async_runtime = "tokio")] impl AgicashWallet { … }` block (after `complete_mint_quote`, before the closing `}` of the impl), add:

```rust
    // ---- cashu send-swap surface ----

    /// Compute the fee breakdown for a hypothetical send. Pure preview —
    /// no swap row is created. Mirrors the CLI's `agicash send <amount>
    /// --dry-run` (`crates/agicash-cli/src/send.rs`).
    ///
    /// `amount` is the value the user wants the receiver to get,
    /// expressed in the account's minor unit (sats for BTC, cents for
    /// USD). `account_id` + `currency` together pick the source Cashu
    /// account; same selector semantics as `start_mint_quote`.
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session loaded.
    /// - `FfiError::Internal` for amount-too-small, currency mismatch,
    ///   no/ambiguous matching account, or mint-protocol failure.
    /// - `FfiError::Storage` for raw Supabase failures.
    pub async fn prepare_send_quote(
        &self,
        amount: u64,
        account_id: Option<String>,
        currency: Option<String>,
    ) -> Result<crate::send::SendQuotePreview, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        if amount == 0 {
            return Err(FfiError::internal("amount too small"));
        }

        let currency_str = currency.unwrap_or_else(|| "BTC".to_string());
        let currency_enum = Currency::from_str(&currency_str)
            .map_err(|_| FfiError::internal(format!("unsupported currency: {currency_str}")))?;
        let unit = unit_for_currency(currency_enum);
        let amount_money = Money::new(Decimal::from(amount), currency_enum, unit);

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = pick_cashu_account_for_lightning(
            &accounts,
            account_id.as_deref(),
            currency_enum,
        )?;
        let mint_url = account
            .details
            .get("mint_url")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string)
            .ok_or_else(|| FfiError::internal("account.details missing mint_url"))?;

        let proofs = self
            .send_swap_storage
            .list_unspent_proofs(account.id)
            .await
            .map_err(|e| FfiError::internal(format!("list unspent proofs: {e}")))?;

        let quote = self
            .send_swap_service
            .get_quote(account, &proofs, amount_money)
            .await
            .map_err(send_swap_error_to_ffi)?;

        Ok(crate::send::SendQuotePreview {
            amount_requested: quote.amount_requested.amount().to_string(),
            amount_to_send: quote.amount_to_send.amount().to_string(),
            total_amount: quote.total_amount.amount().to_string(),
            total_fee: quote.total_fee.amount().to_string(),
            cashu_send_fee: quote.cashu_send_fee.amount().to_string(),
            cashu_receive_fee: quote.cashu_receive_fee.amount().to_string(),
            unit: quote.amount_to_send.unit().to_string(),
            currency: account.currency.to_string(),
            account_id: account.id.to_string(),
            mint_url,
        })
    }
```

- [ ] **Step 2: Add the `send_swap_error_to_ffi` helper**

At the bottom of the same file, before the `#[cfg(test)] mod tests` block, add:

```rust
/// Map `SendSwapError` down to `FfiError`. Same funneling pattern as
/// `receive_swap_error_to_ffi` and `mint_quote_error_to_ffi`.
fn send_swap_error_to_ffi(e: agicash_cashu::SendSwapError) -> FfiError {
    use agicash_cashu::SendSwapError;
    match e {
        SendSwapError::AmountTooSmall => FfiError::internal("amount too small"),
        SendSwapError::CurrencyMismatch { token, account } => FfiError::internal(format!(
            "currency mismatch: token currency {token} differs from account currency {account}",
        )),
        SendSwapError::InvalidTransition { from, event } => {
            FfiError::internal(format!("invalid state transition from {from} on {event}"))
        }
        SendSwapError::Mint(inner) => cashu_provider_error_to_ffi(inner),
        SendSwapError::Storage(s) => FfiError::internal(format!("storage error: {s}")),
        SendSwapError::TokenEncode(msg) => {
            FfiError::internal(format!("token encode error: {msg}"))
        }
    }
}
```

**Sanity check:** before pasting, run `grep -n "^pub enum SendSwapError" /Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-cashu/src/send_swap/error.rs` and read the variants. The match arms above must cover EVERY variant of the real enum. Add missing arms (or remove non-existent ones) so the match is exhaustive without a `_ =>` catchall.

- [ ] **Step 3: Run the agicash-ffi tests (existing tests should still pass)**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo test -p agicash-ffi --lib`
Expected: PASSES (existing tests, no new ones yet).

- [ ] **Step 4: Add an unauth test**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-ffi/src/wallet.rs`, inside the existing `#[cfg(test)] mod tests { … }`, add:

```rust
    #[tokio::test]
    async fn prepare_send_quote_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .prepare_send_quote(64, None, None)
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }
```

- [ ] **Step 5: Run the new test**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo test -p agicash-ffi --lib prepare_send_quote_without_session`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-ffi/src/wallet.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ffi): expose AgicashWallet::prepare_send_quote"
```

---

## Task 6: Implement `create_send_swap` on the wallet

**Files:**
- Modify: `crates/agicash-ffi/src/wallet.rs` (add method + helpers)

- [ ] **Step 1: Add the imports needed for token encoding**

At the top of `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/agicash-ffi/src/wallet.rs`, in the existing `use cdk::…` import block, ensure these are present:

```rust
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::{CurrencyUnit, Proof, Token};
use cdk::Amount;
```

If they're not in the file already, add them. If only some are, add the missing ones.

Also add (or confirm) at the top:

```rust
use agicash_cashu::{CashuSendSwapService, CashuSendSwapState, TokenProof};
```

(Some of these may already be in the import block from Task 4; merge into the existing block; do not duplicate.)

- [ ] **Step 2: Add the method**

In the `impl AgicashWallet { … }` block, immediately after `prepare_send_quote`, add:

```rust
    /// Persist a new Cashu send swap and produce a wire-form token.
    /// Mirrors the CLI's `agicash send <amount>` (without `--dry-run`).
    ///
    /// Always encodes a **V4** (`cashuB…`) token. V3 is the legacy
    /// shape; iOS v0 doesn't expose a chooser.
    ///
    /// Errors mirror `prepare_send_quote` plus token-encode failures.
    pub async fn create_send_swap(
        &self,
        amount: u64,
        account_id: Option<String>,
        currency: Option<String>,
    ) -> Result<crate::send::SendSwapHandle, FfiError> {
        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        if amount == 0 {
            return Err(FfiError::internal("amount too small"));
        }

        let currency_str = currency.unwrap_or_else(|| "BTC".to_string());
        let currency_enum = Currency::from_str(&currency_str)
            .map_err(|_| FfiError::internal(format!("unsupported currency: {currency_str}")))?;
        let unit = unit_for_currency(currency_enum);
        let amount_money = Money::new(Decimal::from(amount), currency_enum, unit);

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = pick_cashu_account_for_lightning(
            &accounts,
            account_id.as_deref(),
            currency_enum,
        )?
        .clone();
        let mint_url_str = account
            .details
            .get("mint_url")
            .and_then(|v| v.as_str())
            .map(std::string::ToString::to_string)
            .ok_or_else(|| FfiError::internal("account.details missing mint_url"))?;

        let proofs = self
            .send_swap_storage
            .list_unspent_proofs(account.id)
            .await
            .map_err(|e| FfiError::internal(format!("list unspent proofs: {e}")))?;

        let create_result = self
            .send_swap_service
            .create(&account, &proofs, amount_money)
            .await
            .map_err(send_swap_error_to_ffi)?;

        let swap = match &create_result.swap.state {
            CashuSendSwapState::Draft => {
                let seed = self.client.get_cashu_seed().await?;
                self.send_swap_service
                    .swap_for_proofs_to_send(&account, create_result.swap.clone(), &seed)
                    .await
                    .map_err(send_swap_error_to_ffi)?
            }
            CashuSendSwapState::Pending { .. } => create_result.swap.clone(),
            other => {
                return Err(FfiError::internal(format!(
                    "unexpected post-create state: {other:?}"
                )));
            }
        };

        let proofs_to_send = match &swap.state {
            CashuSendSwapState::Pending { proofs_to_send, .. }
            | CashuSendSwapState::Completed { proofs_to_send, .. } => proofs_to_send.clone(),
            other => {
                return Err(FfiError::internal(format!(
                    "swap not ready to encode: {other:?}"
                )));
            }
        };

        let token_str = encode_v4_token(&mint_url_str, &proofs_to_send, currency_enum)
            .map_err(|e| FfiError::internal(format!("token encode error: {e}")))?;

        Ok(crate::send::SendSwapHandle {
            swap_id: swap.id.to_string(),
            token: token_str,
            amount: swap.amount_received.amount().to_string(),
            fee: swap.total_fee.amount().to_string(),
            unit: swap.amount_received.unit().to_string(),
            currency: account.currency.to_string(),
            account_id: account.id.to_string(),
            mint_url: mint_url_str,
        })
    }
```

- [ ] **Step 3: Add the token encoder helper**

At the bottom of the file (with the other helpers like `mint_url_from_account`), add:

```rust
/// Encode a slice of `TokenProof` into a V4 (`cashuB…`) wire token.
/// Mirrors `encode_token` in `crates/agicash-cli/src/send.rs` with
/// `token_version = 4` (the default `.to_string()` path on
/// `cdk::nuts::Token`).
fn encode_v4_token(
    mint_url: &str,
    proofs: &[TokenProof],
    currency: Currency,
) -> Result<String, String> {
    let mint = MintUrl::from_str(mint_url).map_err(|e| format!("mint url: {e}"))?;
    let cdk_proofs: Vec<Proof> = proofs
        .iter()
        .map(token_proof_to_cdk_proof)
        .collect::<Result<Vec<_>, _>>()?;
    let unit = cashu_unit_for_currency(currency);
    let token = Token::new(mint, cdk_proofs, None, unit);
    Ok(token.to_string())
}

fn cashu_unit_for_currency(currency: Currency) -> CurrencyUnit {
    match currency {
        Currency::Btc => CurrencyUnit::Sat,
        Currency::Usd | Currency::Usdb => CurrencyUnit::Usd,
    }
}

fn token_proof_to_cdk_proof(proof: &TokenProof) -> Result<Proof, String> {
    use cdk::nuts::PublicKey;
    use cdk::secret::Secret;
    let keyset_id = KeysetId::from_str(&proof.id)
        .map_err(|e| format!("keyset id {}: {e}", proof.id))?;
    let secret = Secret::from_str(&proof.secret).map_err(|e| format!("secret: {e}"))?;
    let c = PublicKey::from_hex(&proof.c).map_err(|e| format!("C: {e}"))?;
    Ok(Proof {
        amount: Amount::from(proof.amount),
        keyset_id,
        secret,
        c,
        witness: None,
        dleq: None,
    })
}
```

- [ ] **Step 4: Add the unauth test for create_send_swap**

In the `#[cfg(test)] mod tests { … }` block, add:

```rust
    #[tokio::test]
    async fn create_send_swap_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .create_send_swap(64, None, None)
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }
```

- [ ] **Step 5: Run the tests**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo test -p agicash-ffi --lib`
Expected: PASS (all existing tests + the two new send tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-ffi/src/wallet.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ffi): expose AgicashWallet::create_send_swap (produces V4 token)"
```

---

## Task 7: Implement `check_send_swap_claimed` on the wallet

**Files:**
- Modify: `crates/agicash-ffi/src/wallet.rs` (add method)

- [ ] **Step 1: Add the method**

In the impl block, after `create_send_swap`, add:

```rust
    /// Check whether the receiver has claimed a previously-created
    /// send swap. Pure poll: re-loads the swap, asks the mint via
    /// NUT-07 `post_check_state` whether the swap's `proofs_to_send`
    /// are SPENT, and (if so) flips the persisted row PENDING →
    /// COMPLETED.
    ///
    /// Returns:
    /// - `Pending` while at least one proof is still UNSPENT.
    /// - `Completed` when every proof is SPENT (the receiver
    ///   redeemed). The persisted row is transitioned in the same
    ///   call; subsequent polls short-circuit on the persisted state.
    /// - `Failed` only if the swap row is already FAILED (defensive;
    ///   shouldn't happen post-PENDING). The `failure_reason` is
    ///   surfaced for the iOS UI to render.
    ///
    /// Errors:
    /// - `FfiError::Auth { UNAUTHENTICATED }` if no session loaded.
    /// - `FfiError::Internal` for invalid UUID, missing swap, ownership
    ///   mismatch, mint round-trip failure.
    /// - `FfiError::Storage` for raw Supabase failures.
    pub async fn check_send_swap_claimed(
        &self,
        swap_id: String,
    ) -> Result<crate::send::SendSwapClaimSnapshot, FfiError> {
        use cdk::nuts::{CheckStateRequest, State as CdkProofState, PublicKey as CdkPubKey};
        use cdk::wallet::MintConnector;
        use agicash_traits::CashuProvider;

        let session = self.session.read().await.clone().ok_or(FfiError::Auth {
            code: crate::error::auth_code::UNAUTHENTICATED,
            message: "not authenticated".into(),
        })?;
        let user_id = UserId::from(session.user_id);

        let id = Uuid::parse_str(&swap_id)
            .map_err(|e| FfiError::internal(format!("invalid swap_id: {e}")))?;
        let swap = self
            .send_swap_storage
            .get(id)
            .await
            .map_err(|e| FfiError::internal(format!("storage error: {e}")))?;
        if swap.user_id != user_id {
            return Err(FfiError::internal("swap belongs to a different user"));
        }

        // Fast path: already-terminal states short-circuit without a
        // mint round-trip.
        match &swap.state {
            CashuSendSwapState::Completed { .. } => {
                return Ok(crate::send::SendSwapClaimSnapshot {
                    state: crate::send::SendSwapClaimState::Completed,
                    failure_reason: None,
                });
            }
            CashuSendSwapState::Failed { failure_reason } => {
                return Ok(crate::send::SendSwapClaimSnapshot {
                    state: crate::send::SendSwapClaimState::Failed,
                    failure_reason: Some(failure_reason.clone()),
                });
            }
            CashuSendSwapState::Pending { .. } => { /* fall through to mint poll */ }
            other => {
                return Err(FfiError::internal(format!(
                    "swap in unexpected state for claim-check: {other:?}"
                )));
            }
        }

        let proofs_to_send = match &swap.state {
            CashuSendSwapState::Pending { proofs_to_send, .. } => proofs_to_send.clone(),
            _ => unreachable!("filtered above"),
        };

        let accounts = self.storage.list_accounts(user_id).await?;
        let account = accounts
            .iter()
            .find(|a| a.id == swap.account_id && a.account_type == AccountType::Cashu)
            .ok_or_else(|| FfiError::internal("no matching account for swap"))?;

        let wallet = self
            .cashu_provider
            .wallet_for_account(account)
            .await
            .map_err(cashu_provider_error_to_ffi)?;

        // Build the NUT-07 request out of the proofs' `Y` (the secret
        // commitment hash). CDK's helper takes `Vec<PublicKey>`, derived
        // by hashing each proof's secret to a point. For a poll-only
        // check we hash via `cdk::dhke::hash_to_curve`.
        let ys: Vec<CdkPubKey> = proofs_to_send
            .iter()
            .map(|p| {
                let secret = cdk::secret::Secret::from_str(&p.secret)
                    .map_err(|e| FfiError::internal(format!("bad secret: {e}")))?;
                cdk::dhke::hash_to_curve(secret.as_bytes())
                    .map_err(|e| FfiError::internal(format!("hash_to_curve: {e}")))
            })
            .collect::<Result<Vec<_>, _>>()?;

        let req = CheckStateRequest { ys };
        let resp = wallet
            .connector()
            .post_check_state(req)
            .await
            .map_err(|e| FfiError::internal(format!("mint check_state: {e}")))?;

        let all_spent = !resp.states.is_empty()
            && resp.states.iter().all(|s| matches!(s.state, CdkProofState::Spent));

        if all_spent {
            // Transition PENDING → COMPLETED so subsequent polls
            // short-circuit on the persisted state.
            self.send_swap_service
                .complete(&swap)
                .await
                .map_err(send_swap_error_to_ffi)?;
            Ok(crate::send::SendSwapClaimSnapshot {
                state: crate::send::SendSwapClaimState::Completed,
                failure_reason: None,
            })
        } else {
            Ok(crate::send::SendSwapClaimSnapshot {
                state: crate::send::SendSwapClaimState::Pending,
                failure_reason: None,
            })
        }
    }
```

- [ ] **Step 2: Add the unauth test**

In the `#[cfg(test)] mod tests` block:

```rust
    #[tokio::test]
    async fn check_send_swap_claimed_without_session_returns_unauthenticated() {
        let cfg = fake_config();
        let wallet = AgicashWallet::new(
            cfg.opensecret_url,
            cfg.client_id,
            cfg.supabase_url,
            cfg.anon_key,
        )
        .expect("construct");
        let err = wallet
            .check_send_swap_claimed(Uuid::new_v4().to_string())
            .await
            .expect_err("no session");
        assert!(
            matches!(err, FfiError::Auth { code, .. } if code == crate::error::auth_code::UNAUTHENTICATED)
        );
    }
```

- [ ] **Step 3: Run the tests**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu && nix develop -c cargo test -p agicash-ffi --lib`
Expected: PASS.

**If the build fails on CDK API mismatches** (e.g. `CheckStateRequest` shape, `State` enum location, `hash_to_curve` signature), open `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/Cargo.lock` to find the CDK version, then `grep -rn "CheckStateRequest\|post_check_state\|hash_to_curve" /Users/claude/agicash/.claude/worktrees/ios-send-cashu/crates/` for sibling usages. The receive-swap path in `agicash-cashu` already calls into similar CDK surfaces — copy the import path verbatim from there.

- [ ] **Step 4: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add crates/agicash-ffi/src/wallet.rs
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ffi): expose AgicashWallet::check_send_swap_claimed (NUT-07 poll)"
```

---

## Task 8: Regenerate Swift bindings

**Files:**
- Regenerate: `bindings/swift/Sources/AgicashSDK/agicash_ffi.swift` (output of `generate-bindings.sh`)
- Regenerate: `bindings/swift/build/xcframework/agicash_ffiFFI.xcframework` (output of `generate-bindings.sh`)

- [ ] **Step 1: Run the bindings generator**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/bindings/swift && ./generate-bindings.sh`
Expected: builds rust target for `aarch64-apple-ios` + `aarch64-apple-ios-sim`, generates Swift sources, packages xcframework. Wall time: 60–300 s depending on cache.

If the script complains about a Nix env conflict, follow its hint (usually "exit `nix develop` and run from a normal shell"). The script has a Nix-detection block per its top-comment.

- [ ] **Step 2: Verify the new symbols are in the generated Swift**

Run: `grep -E "prepareSendQuote|createSendSwap|checkSendSwapClaimed|SendQuotePreview|SendSwapHandle|SendSwapClaimSnapshot|SendSwapClaimState" /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/AgicashSDK/agicash_ffi.swift`
Expected: each symbol appears at least once.

(If the iOS app reads bindings from `bindings/swift/Sources/AgicashSDK/` instead of `ios/Agicash/Agicash/AgicashSDK/`, the script may write to the bindings dir and the iOS project picks it up via the framework. Grep both paths — the symbols must appear in whichever one the Xcode project links against. Check `bindings/swift/generate-bindings.sh`'s output paths.)

- [ ] **Step 3: Sync the regenerated Swift into the iOS app's source tree if needed**

If `generate-bindings.sh` outputs to `bindings/swift/Sources/AgicashSDK/` but the iOS app's `AgicashSDK/agicash_ffi.swift` is a static checkout (not a symlink), copy the new file in:

```bash
cp /Users/claude/agicash/.claude/worktrees/ios-send-cashu/bindings/swift/Sources/AgicashSDK/agicash_ffi.swift \
   /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/AgicashSDK/agicash_ffi.swift
```

Check the existing `ios-receive-ux` workflow on master-merger — look for prior `feat(swift-ffi): regenerate bindings…` commits to confirm what gets staged. Typically: the generated `.swift` files + the xcframework binaries.

- [ ] **Step 4: Commit the regenerated bindings**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
# Stage whichever generated paths the previous regenerate commits touched.
# Common set:
PREK_ALLOW_NO_CONFIG=1 git add bindings/swift/Sources/AgicashSDK/ ios/Agicash/Agicash/AgicashSDK/agicash_ffi.swift
# If the xcframework is checked in:
PREK_ALLOW_NO_CONFIG=1 git add bindings/swift/build/xcframework/ 2>/dev/null || true
PREK_ALLOW_NO_CONFIG=1 git commit -m "chore(swift-ffi): regenerate bindings with Cashu send"
```

If the project intentionally git-ignores the xcframework binary (look at `.gitignore`), omit the `bindings/swift/build/xcframework/` line.

---

## Task 9: Add Send view-model methods

**Files:**
- Modify: `ios/Agicash/Agicash/WalletViewModel.swift` (add three async methods + three outcome enums)

- [ ] **Step 1: Add the outcome enums + methods**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/WalletViewModel.swift`, add near the other outcome enums (after `AddMintOutcome`):

```swift
    // MARK: - Cashu send (NUT-03 send swap)

    /// Outcome shape for `prepareSend`. Success carries the FFI quote
    /// (amount/fee breakdown) so the confirm card can render it
    /// directly; failure carries a presentation-ready string already
    /// mapped through `ffiErrorMessage`.
    enum SendQuoteOutcome {
        case success(SendQuotePreview)
        case failure(String)
    }

    /// Outcome shape for `createSend`. Success carries the FFI handle
    /// (token + swap_id + amount); failure carries a presentation-ready
    /// error string.
    enum SendOutcome {
        case success(SendSwapHandle)
        case failure(String)
    }

    /// Outcome shape for `pollSendClaim`. Mirrors `SendSwapClaimSnapshot`
    /// plus a failure branch. The view loops on this until the state
    /// flips to `.completed` (or the user dismisses).
    enum SendClaimOutcome {
        case state(SendSwapClaimState, failureReason: String?)
        case failure(String)
    }

    /// Preview the fee + total for a send. Mirrors `startLightningQuote`
    /// in shape; does NOT flip `isWorking` for the same reason
    /// (`SendCashuTokenView` owns its own phase machine and renders a
    /// localized spinner during the brief quote round-trip).
    func prepareSend(
        amount: UInt64,
        accountId: String? = nil,
        currency: String? = nil
    ) async -> SendQuoteOutcome {
        do {
            let quote = try await wallet.prepareSendQuote(
                amount: amount,
                accountId: accountId,
                currency: currency
            )
            return .success(quote)
        } catch let err as FfiError {
            return .failure(ffiErrorMessage(err))
        } catch {
            return .failure("unexpected: \(error)")
        }
    }

    /// Commit a send — runs the input swap + encodes a token. Refreshes
    /// the accounts list on success so Home's balance reflects the
    /// debit without a pull-to-refresh. Failure leaves the wallet
    /// untouched (the swap row is rolled back by the service on error).
    func createSend(
        amount: UInt64,
        accountId: String? = nil,
        currency: String? = nil
    ) async -> SendOutcome {
        do {
            let handle = try await wallet.createSendSwap(
                amount: amount,
                accountId: accountId,
                currency: currency
            )
            await refreshAccounts()
            return .success(handle)
        } catch let err as FfiError {
            return .failure(ffiErrorMessage(err))
        } catch {
            return .failure("unexpected: \(error)")
        }
    }

    /// Single-shot poll for "has the receiver claimed?". Called from a
    /// long-running `Task` in `SendCashuTokenView.share` phase every
    /// ~3s while the share screen is on screen.
    func pollSendClaim(swapId: String) async -> SendClaimOutcome {
        do {
            let snapshot = try await wallet.checkSendSwapClaimed(swapId: swapId)
            return .state(snapshot.state, failureReason: snapshot.failureReason)
        } catch let err as FfiError {
            return .failure(ffiErrorMessage(err))
        } catch {
            return .failure("unexpected: \(error)")
        }
    }
```

**Sanity check before committing:** the generated Swift method names follow UniFFI's camelCase convention. If the regenerated `agicash_ffi.swift` shows `prepare_send_quote` (snake_case) instead, the iOS code above needs to use the snake_case names. Run `grep -E "prepareSendQuote|prepare_send_quote" /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/AgicashSDK/agicash_ffi.swift | head -3` to confirm. Adapt the method-call lines (`wallet.prepareSendQuote(...)` etc.) if needed.

- [ ] **Step 2: Build the iOS app to catch compile errors**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash && xcodebuild -scheme Agicash -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -40`
Expected: BUILD SUCCEEDED.

- [ ] **Step 3: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add ios/Agicash/Agicash/WalletViewModel.swift
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ios): WalletViewModel Cashu send methods (prepare/create/poll-claim)"
```

---

## Task 10: Create the Lightning + LN-Address placeholder views

**Files:**
- Create: `ios/Agicash/Agicash/LightningSendPlaceholderView.swift`
- Create: `ios/Agicash/Agicash/LightningAddressSendPlaceholderView.swift`

- [ ] **Step 1: Create LightningSendPlaceholderView.swift**

Create `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/LightningSendPlaceholderView.swift` with:

```swift
import SwiftUI

/// Placeholder for the Lightning Send tab of the Send carousel.
///
/// The Cashu send tab ships in this pass; Lightning melt-quote + LN
/// Address tabs land in a follow-up FFI lane (slice 8 — `melt_quote`
/// service is already wired in Rust but not bridged through UniFFI).
/// The placeholder keeps the carousel's three-tab geometry stable so
/// the indicator bar reads symmetrically once those tabs go live.
struct LightningSendPlaceholderView: View {
    var body: some View {
        VStack(spacing: Spacing.l) {
            Image(systemName: "bolt.fill")
                .font(.system(size: 48, weight: .regular))
                .foregroundStyle(Color.brandMutedForeground)
            Text("Lightning send")
                .font(.brandTitle)
                .foregroundStyle(Color.brandCardForeground)
            Text("Coming soon")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

- [ ] **Step 2: Create LightningAddressSendPlaceholderView.swift**

Create `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/LightningAddressSendPlaceholderView.swift` with:

```swift
import SwiftUI

/// Placeholder for the Lightning-Address Send tab of the Send carousel.
///
/// Lightning Address (LUD-16) resolver shipped in the
/// `agicash-lightning-address` crate but is not bridged through UniFFI
/// yet. This placeholder reserves the third tab slot in the carousel
/// for the follow-up lane.
struct LightningAddressSendPlaceholderView: View {
    var body: some View {
        VStack(spacing: Spacing.l) {
            Image(systemName: "at")
                .font(.system(size: 48, weight: .regular))
                .foregroundStyle(Color.brandMutedForeground)
            Text("Lightning Address")
                .font(.brandTitle)
                .foregroundStyle(Color.brandCardForeground)
            Text("Coming soon")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
```

- [ ] **Step 3: Register both files in the Xcode project**

Open `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash.xcodeproj` in Xcode. In the Project Navigator, right-click the `Agicash` group (the one holding `ReceiveCarouselView.swift` etc.), choose **Add Files to "Agicash"…**, select the two new placeholder files, ensure the target `Agicash` is checked, click Add.

Alternatively (CLI-only path): edit `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash.xcodeproj/project.pbxproj` by hand — find the entries for `BuyView.swift` (a similar single-file placeholder added in the receive carousel lane), duplicate the four references (`PBXBuildFile`, `PBXFileReference`, group `children`, sources `files`), and rename the UUID/name pairs for each new file. Verify with `xcodebuild` after.

- [ ] **Step 4: Build**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash && xcodebuild -scheme Agicash -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED, both new files compiled.

- [ ] **Step 5: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add ios/Agicash/Agicash/LightningSendPlaceholderView.swift ios/Agicash/Agicash/LightningAddressSendPlaceholderView.swift ios/Agicash/Agicash.xcodeproj/project.pbxproj
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ios): Lightning + LN-Address send placeholder views"
```

---

## Task 11: Create SendCarouselView

**Files:**
- Create: `ios/Agicash/Agicash/SendCarouselView.swift`

- [ ] **Step 1: Create the file**

Create `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/SendCarouselView.swift` with:

```swift
import SwiftUI

/// Top-level Send surface. Presented as a `.sheet` from `HomeView`,
/// hosts a three-tab swipeable carousel: Cashu (token), Lightning
/// (placeholder), Lightning Address (placeholder).
///
/// Sibling of `ReceiveCarouselView` — same `TabView` +
/// `.tabViewStyle(.page(indexDisplayMode: .never))` pattern, same
/// custom bottom indicator bar. The default tab is `.cashu` since
/// it's the only real surface in this pass.
struct SendCarouselView: View {
    @Bindable var model: WalletViewModel
    let initialTab: SendTab
    let onDismiss: () -> Void

    init(
        model: WalletViewModel,
        initialTab: SendTab = .cashu,
        onDismiss: @escaping () -> Void
    ) {
        self.model = model
        self.initialTab = initialTab
        self.onDismiss = onDismiss
    }

    @State private var selectedTab: SendTab = .cashu

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $selectedTab) {
                    SendCashuTokenView(
                        model: model,
                        onDismissCarousel: onDismiss
                    )
                    .tag(SendTab.cashu)

                    LightningSendPlaceholderView()
                        .tag(SendTab.lightning)

                    LightningAddressSendPlaceholderView()
                        .tag(SendTab.lightningAddress)
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .background(Color.brandBackground)

                TabIndicatorBar(selectedTab: $selectedTab)
                    .padding(.horizontal, Spacing.l)
                    .padding(.vertical, Spacing.s)
                    .background(
                        Color.brandBackground
                            .overlay(
                                Rectangle()
                                    .fill(Color.brandBorder)
                                    .frame(height: 0.5),
                                alignment: .top
                            )
                    )
            }
            .background(Color.brandBackground.ignoresSafeArea())
            .navigationTitle(titleForTab(selectedTab))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Close", action: onDismiss)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandForeground)
                }
            }
            .onAppear {
                selectedTab = initialTab
            }
        }
    }

    private func titleForTab(_ tab: SendTab) -> String {
        switch tab {
        case .cashu:            return "Send Cashu"
        case .lightning:        return "Send Lightning"
        case .lightningAddress: return "Send to address"
        }
    }
}

/// Tabs the Send carousel supports.
enum SendTab: Hashable, CaseIterable {
    case cashu
    case lightning
    case lightningAddress

    var iconName: String {
        switch self {
        case .cashu:            return "banknote"
        case .lightning:        return "bolt.fill"
        case .lightningAddress: return "at"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .cashu:            return "Send Cashu token"
        case .lightning:        return "Send over Lightning"
        case .lightningAddress: return "Send to Lightning Address"
        }
    }
}

/// Bottom indicator bar — three tappable icons that double as page
/// indicators. Identical structure to `ReceiveCarouselView`'s bar.
private struct TabIndicatorBar: View {
    @Binding var selectedTab: SendTab

    var body: some View {
        HStack(spacing: 0) {
            ForEach(SendTab.allCases, id: \.self) { tab in
                Button(action: {
                    withAnimation(.easeInOut(duration: 0.18)) {
                        selectedTab = tab
                    }
                }) {
                    Image(systemName: tab.iconName)
                        .font(.system(size: 22, weight: .regular))
                        .foregroundStyle(
                            tab == selectedTab
                                ? Color.brandForeground
                                : Color.brandMutedForeground.opacity(0.4)
                        )
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(tab.accessibilityLabel)
            }
        }
    }
}
```

- [ ] **Step 2: Register in Xcode project**

Add the new `SendCarouselView.swift` to the Xcode project — same procedure as Task 10 Step 3.

- [ ] **Step 3: Build (will fail until Task 12 adds SendCashuTokenView; verify the error is the right one)**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash && xcodebuild -scheme Agicash -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -10`
Expected: FAILS only on `SendCashuTokenView` being undefined. (Any other error → fix before moving on.)

- [ ] **Step 4: Commit (allow the build error; the placeholder for SendCashuTokenView arrives in Task 12)**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add ios/Agicash/Agicash/SendCarouselView.swift ios/Agicash/Agicash.xcodeproj/project.pbxproj
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ios): SendCarouselView + tab indicator scaffolding"
```

---

## Task 12: Create SendCashuTokenView

**Files:**
- Create: `ios/Agicash/Agicash/SendCashuTokenView.swift`

- [ ] **Step 1: Create the file**

Create `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/SendCashuTokenView.swift` with:

```swift
import SwiftUI
import UIKit

/// One page of the Send carousel — pick an amount, produce a Cashu
/// token, share it, watch for the receiver to claim.
///
/// State machine:
///   - `amountEntry`  → numpad + Continue (mirrors
///     `LightningReceiveView.amountEntryView`).
///   - `quoting`      → spinner while `prepareSend` runs.
///   - `confirming(quote)` → fee breakdown card; user taps Send.
///   - `swapping`     → spinner while `createSend` runs.
///   - `share(handle)` → token + copy + iOS share sheet. A long-running
///     `Task` polls `pollSendClaim` every 3s; on `.completed` flips to
///     `claimed`.
///   - `claimed(handle)` → green check + "Sent". Auto-dismisses after
///     3s; user can tap Done sooner.
///   - `failure(message)` → inline error + retry → amountEntry.
///
/// Mirrors `app/features/send/send-input.tsx` (amount entry),
/// `app/features/send/send-confirmation.tsx` (fee breakdown),
/// `app/features/send/share-cashu-token.tsx` (share view), and the
/// receiver-claim watcher in `cashu-send-swap-hooks.useTrackCashuSendSwap`.
struct SendCashuTokenView: View {
    @Bindable var model: WalletViewModel
    let onDismissCarousel: () -> Void

    enum Phase: Equatable {
        case amountEntry
        case quoting
        case confirming(SendQuotePreview)
        case swapping
        case share(SendSwapHandle)
        case claimed(SendSwapHandle)
        case failure(String)
    }

    @State private var amountBuffer: String = "0"
    @State private var phase: Phase = .amountEntry
    /// Long-running poll task. Held so we can cancel on disappear /
    /// dismiss / completion.
    @State private var pollTask: Task<Void, Never>?
    /// Auto-dismiss timer on the claimed state.
    @State private var autoDismissTask: Task<Void, Never>?
    /// Drives the iOS share sheet.
    @State private var showShareSheet: Bool = false
    /// Toast-style "copied!" overlay flag.
    @State private var showCopied: Bool = false

    private let currency = "BTC"
    private let unitLabel = "sats"
    private var allowsDecimal: Bool { false }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .onDisappear {
            pollTask?.cancel()
            autoDismissTask?.cancel()
        }
    }

    @ViewBuilder
    private var content: some View {
        switch phase {
        case .amountEntry:
            amountEntryView
        case .quoting:
            ProgressView("Preparing send…")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .confirming(let quote):
            ConfirmCard(
                quote: quote,
                onSend: { Task { await commitSend() } },
                onCancel: resetToAmountEntry
            )
            .padding(.horizontal, Spacing.l)
        case .swapping:
            ProgressView("Producing token…")
                .font(.brandLabel)
                .foregroundStyle(Color.brandMutedForeground)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .share(let handle):
            ShareCard(
                handle: handle,
                showCopied: showCopied,
                onCopy: { copyToken(handle.token) },
                onShare: { showShareSheet = true },
                onCancel: dismissNow
            )
            .padding(.horizontal, Spacing.l)
            .sheet(isPresented: $showShareSheet) {
                ShareSheet(items: [handle.token])
            }
        case .claimed(let handle):
            ClaimedCard(
                handle: handle,
                onDone: dismissNow
            )
            .padding(.horizontal, Spacing.l)
        case .failure(let message):
            FailureCard(
                message: message,
                onRetry: resetToAmountEntry,
                onDismiss: dismissNow
            )
            .padding(.horizontal, Spacing.l)
        }
    }

    private var amountEntryView: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.l)

            VStack(spacing: Spacing.xs) {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(displayAmount)
                        .font(.brandNumericHero)
                        .foregroundStyle(Color.brandForeground)
                        .monospacedDigit()
                        .minimumScaleFactor(0.6)
                        .lineLimit(1)
                    Text(unitLabel)
                        .font(.brandTitleSmall)
                        .foregroundStyle(Color.brandMutedForeground)
                        .baselineOffset(8)
                }
                Text("Send Cashu token")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }
            .frame(maxWidth: .infinity)

            AmountNumpad(value: $amountBuffer, allowsDecimal: allowsDecimal)
                .padding(.horizontal, Spacing.l)

            BrandButton(
                "Continue",
                variant: .primary,
                size: .large,
                isDisabled: !isAmountValid,
                action: { Task { await startQuote() } }
            )
            .padding(.horizontal, Spacing.l)

            Spacer(minLength: Spacing.l)
        }
    }

    // MARK: - amount parsing (same shape as LightningReceiveView)

    private var displayAmount: String {
        guard let n = UInt64(amountBuffer) else {
            return amountBuffer.isEmpty ? "0" : amountBuffer
        }
        let formatter = NumberFormatter()
        formatter.numberStyle = .decimal
        formatter.groupingSeparator = ","
        return formatter.string(from: NSNumber(value: n)) ?? amountBuffer
    }

    private var parsedAmount: UInt64? {
        let clean = amountBuffer.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        return UInt64(clean)
    }

    private var isAmountValid: Bool {
        guard let n = parsedAmount else { return false }
        return n > 0
    }

    // MARK: - actions

    private func startQuote() async {
        guard let amount = parsedAmount, amount > 0 else { return }
        phase = .quoting
        let outcome = await model.prepareSend(
            amount: amount,
            accountId: nil,
            currency: currency
        )
        switch outcome {
        case .success(let quote):
            phase = .confirming(quote)
        case .failure(let message):
            phase = .failure(message)
        }
    }

    private func commitSend() async {
        guard let amount = parsedAmount, amount > 0 else { return }
        phase = .swapping
        let outcome = await model.createSend(
            amount: amount,
            accountId: nil,
            currency: currency
        )
        switch outcome {
        case .success(let handle):
            phase = .share(handle)
            startPollingClaim(handle)
        case .failure(let message):
            phase = .failure(message)
        }
    }

    private func startPollingClaim(_ handle: SendSwapHandle) {
        pollTask?.cancel()
        pollTask = Task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 3_000_000_000)
                if Task.isCancelled { return }
                let outcome = await model.pollSendClaim(swapId: handle.swapId)
                if Task.isCancelled { return }
                switch outcome {
                case .state(let state, let reason):
                    switch state {
                    case .pending:
                        continue
                    case .completed:
                        await MainActor.run { phase = .claimed(handle) }
                        scheduleAutoDismiss()
                        return
                    case .failed:
                        await MainActor.run {
                            phase = .failure(reason ?? "Send failed.")
                        }
                        return
                    }
                case .failure(let message):
                    // Transient — keep polling. The user can hit Cancel.
                    _ = message
                    continue
                }
            }
        }
    }

    private func copyToken(_ token: String) {
        UIPasteboard.general.string = token
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        showCopied = true
        Task {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            await MainActor.run { showCopied = false }
        }
    }

    private func resetToAmountEntry() {
        pollTask?.cancel()
        autoDismissTask?.cancel()
        amountBuffer = "0"
        phase = .amountEntry
    }

    private func scheduleAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = Task {
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            if !Task.isCancelled {
                await MainActor.run { dismissNow() }
            }
        }
    }

    private func dismissNow() {
        pollTask?.cancel()
        autoDismissTask?.cancel()
        onDismissCarousel()
    }
}

// MARK: - Confirm card

private struct ConfirmCard: View {
    let quote: SendQuotePreview
    let onSend: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Confirm send")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text("Producing a token the receiver can claim")
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
            }

            VStack(spacing: Spacing.s) {
                amountRow("They receive", value: quote.amountToSend, unit: quote.unit, prominent: true)
                amountRow("Send fee", value: quote.cashuSendFee, unit: quote.unit)
                amountRow("Receive fee", value: quote.cashuReceiveFee, unit: quote.unit)
                Divider()
                amountRow("You pay", value: quote.totalAmount, unit: quote.unit, prominent: true)
            }

            VStack(spacing: Spacing.s) {
                BrandButton("Send", variant: .primary, action: onSend)
                BrandButton("Cancel", variant: .ghost, action: onCancel)
            }
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }

    private func amountRow(_ label: String, value: String, unit: String, prominent: Bool = false) -> some View {
        HStack {
            Text(label)
                .font(prominent ? .brandLabelEmphasis : .brandLabel)
                .foregroundStyle(prominent ? Color.brandCardForeground : Color.brandMutedForeground)
            Spacer()
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(value)
                    .font(prominent ? .brandLabelEmphasis : .brandLabel)
                    .foregroundStyle(Color.brandCardForeground)
                    .monospacedDigit()
                Text(unit)
                    .font(.brandCaption)
                    .foregroundStyle(Color.brandMutedForeground)
            }
        }
    }
}

// MARK: - Share card

private struct ShareCard: View {
    let handle: SendSwapHandle
    let showCopied: Bool
    let onCopy: () -> Void
    let onShare: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: Spacing.l) {
            VStack(spacing: Spacing.xs) {
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(handle.amount)
                        .font(.brandNumericInline)
                        .foregroundStyle(Color.brandCardForeground)
                        .monospacedDigit()
                    Text(handle.unit)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
                HStack(spacing: Spacing.xs) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Waiting for receiver…")
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
            }

            Button(action: onCopy) {
                HStack(spacing: Spacing.xs) {
                    Text(truncated(handle.token))
                        .font(.brandCaption)
                        .foregroundStyle(Color.brandMutedForeground)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Image(systemName: showCopied ? "checkmark" : "doc.on.doc")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.brandMutedForeground)
                }
                .padding(.horizontal, Spacing.m)
                .padding(.vertical, Spacing.s)
                .background(
                    RoundedRectangle(cornerRadius: Radius.control)
                        .fill(Color.brandMuted)
                )
            }
            .buttonStyle(.plain)
            .frame(maxWidth: 320)

            VStack(spacing: Spacing.s) {
                BrandButton("Share", variant: .primary, action: onShare)
                BrandButton("Cancel", variant: .ghost, action: onCancel)
            }
            .frame(maxWidth: 320)
        }
        .padding(Spacing.xxl)
        .brandCard()
        .frame(maxWidth: 384)
    }

    private func truncated(_ s: String) -> String {
        guard s.count > 24 else { return s }
        let head = s.prefix(12)
        let tail = s.suffix(8)
        return "\(head)…\(tail)"
    }
}

// MARK: - Claimed card

private struct ClaimedCard: View {
    let handle: SendSwapHandle
    let onDone: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.xxl)
            VStack(spacing: Spacing.m) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 56))
                    .foregroundStyle(Color.green)
                Text("Sent")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                HStack(alignment: .lastTextBaseline, spacing: 4) {
                    Text(handle.amount)
                        .font(.brandNumericInline)
                        .foregroundStyle(Color.brandCardForeground)
                        .monospacedDigit()
                    Text(handle.unit)
                        .font(.brandLabel)
                        .foregroundStyle(Color.brandMutedForeground)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
            .brandCard()
            .frame(maxWidth: 384)

            BrandButton("Done", variant: .primary, action: onDone)
                .frame(maxWidth: 384)

            Spacer(minLength: Spacing.xxl)
        }
    }
}

// MARK: - Failure card (same shape as LightningReceiveView's)

private struct FailureCard: View {
    let message: String
    let onRetry: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(spacing: Spacing.xxl) {
            Spacer(minLength: Spacing.xxl)
            VStack(spacing: Spacing.m) {
                Image(systemName: "xmark.octagon.fill")
                    .font(.system(size: 48))
                    .foregroundStyle(Color.brandDestructive)
                Text("Couldn't send")
                    .font(.brandTitle)
                    .foregroundStyle(Color.brandCardForeground)
                Text(message)
                    .font(.brandLabel)
                    .foregroundStyle(Color.brandMutedForeground)
                    .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(Spacing.xxl)
            .brandCard()
            .frame(maxWidth: 384)

            VStack(spacing: Spacing.m) {
                BrandButton("Try again", variant: .primary, action: onRetry)
                BrandButton("Dismiss", variant: .ghost, action: onDismiss)
            }
            .frame(maxWidth: 384)

            Spacer(minLength: Spacing.xxl)
        }
    }
}

// MARK: - UIActivityViewController bridge

/// Bridges `UIActivityViewController` (iOS share sheet) into SwiftUI.
/// Used by `SendCashuTokenView` to share the encoded Cashu token via
/// the native share sheet (Messages, Mail, Notes, AirDrop, etc.).
private struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }

    func updateUIViewController(_ controller: UIActivityViewController, context: Context) {}
}
```

- [ ] **Step 2: Register in Xcode project**

Add the new `SendCashuTokenView.swift` to the Xcode project (same procedure as Task 10 Step 3).

- [ ] **Step 3: Build**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash && xcodebuild -scheme Agicash -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED.

**If there are property-name mismatches between the Swift code and the regenerated FFI** (e.g. `quote.amountToSend` vs `quote.amount_to_send` vs `quote.amountToSend`), grep the generated file: `grep -n -E "amountToSend|amount_to_send|amountTosend" /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/AgicashSDK/agicash_ffi.swift`. UniFFI normally produces camelCase for record fields in Swift; if it produced snake_case, update the Swift references in `ConfirmCard` + `ShareCard` accordingly.

- [ ] **Step 4: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add ios/Agicash/Agicash/SendCashuTokenView.swift ios/Agicash/Agicash.xcodeproj/project.pbxproj
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ios): SendCashuTokenView (amount → confirm → share → claimed)"
```

---

## Task 13: Wire Home Send button to SendCarouselView

**Files:**
- Modify: `ios/Agicash/Agicash/HomeView.swift`

- [ ] **Step 1: Add the showSend state**

In `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash/HomeView.swift`, find the `@State private var showReceive: Bool = false` line and add right after it:

```swift
    /// Drives presentation of `SendCarouselView` as a sheet. Sibling
    /// of `showReceive`; same `.sheet` pattern.
    @State private var showSend: Bool = false
```

- [ ] **Step 2: Pass the onSend callback to HomeActionGrid**

Find the `HomeActionGrid(onReceive: { showReceive = true })` invocation and change it to:

```swift
                    HomeActionGrid(
                        onReceive: { showReceive = true },
                        onSend: { showSend = true }
                    )
```

- [ ] **Step 3: Add the Send sheet**

After the existing `.sheet(isPresented: $showReceive) { … }` modifier, add:

```swift
            .sheet(isPresented: $showSend) {
                SendCarouselView(
                    model: model,
                    onDismiss: { showSend = false }
                )
            }
```

- [ ] **Step 4: Update HomeActionGrid signature**

In the same file, find `private struct HomeActionGrid: View { … }`. Change:

```swift
private struct HomeActionGrid: View {
    let onReceive: () -> Void
```

to:

```swift
private struct HomeActionGrid: View {
    let onReceive: () -> Void
    let onSend: () -> Void
```

And in the body, replace the stub Send button:

```swift
            BrandButton(
                "Send",
                variant: .primary,
                size: .large
            ) { /* payment flows out of scope in v0 */ }
```

with:

```swift
            BrandButton(
                "Send",
                variant: .primary,
                size: .large,
                action: onSend
            )
```

- [ ] **Step 5: Build**

Run: `cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash && xcodebuild -scheme Agicash -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build 2>&1 | tail -20`
Expected: BUILD SUCCEEDED.

- [ ] **Step 6: Commit**

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
PREK_ALLOW_NO_CONFIG=1 git add ios/Agicash/Agicash/HomeView.swift
PREK_ALLOW_NO_CONFIG=1 git commit -m "feat(ios): wire Home Send button to SendCarouselView"
```

---

## Task 14: Manual simulator verification

This task has no commit — it's a verification gate. Output goes in the operator report at the end.

- [ ] **Step 1: Erase the simulator (avoids Keychain trap)**

Per `feedback_ios_sim_keychain_trap.md`, stale sessions cause silent hangs:

```bash
xcrun simctl shutdown "iPhone 16 Pro" 2>/dev/null || true
xcrun simctl erase "iPhone 16 Pro"
xcrun simctl boot "iPhone 16 Pro"
```

- [ ] **Step 2: Confirm the local stack is up**

Per `project_opensecret_local_stack.md`: opensecret on `:3999`, supabase on `:54321`, nix-native pg on `:5432`.

```bash
curl -sS http://127.0.0.1:3999/health 2>&1 | head -3
curl -sSk https://127.0.0.1:54321/rest/v1/ 2>&1 | head -3
```

Both should respond. If not, follow the revive recipe in `project_opensecret_local_stack.md` (DO NOT recreate). Pause and report back if either is down.

- [ ] **Step 3: Install + launch the app**

Open `/Users/claude/agicash/.claude/worktrees/ios-send-cashu/ios/Agicash/Agicash.xcodeproj` in Xcode, select the iPhone 16 Pro sim destination, ⌘R. Wait for the build to deploy and the app to launch on the booted sim.

- [ ] **Step 4: Sign in as guest + add the local devmint**

In-app: tap "Continue as guest". Once signed in, navigate to Settings (or wherever the Add Mint affordance lives in this build — `AddMintView`). Add the local devmint URL (typically `http://127.0.0.1:3338` or whichever URL `agicash mint add` uses in CLI tests — check `~/.agicash/cli/state` or `crates/agicash-cli/src/composition.rs` for the dev mint URL).

- [ ] **Step 5: Top up via Lightning Receive**

Home → Receive → Lightning. Type 100. Create invoice. Pay it from the regtest LN cluster (the same regtest invoice pattern the existing receive smoke tests use; if unclear, look at any prior receive smoke commit's commit message — the pattern is established).

Verify balance shows 100 sats on Home.

- [ ] **Step 6: Trigger the send flow**

Home → Send. Confirm the carousel opens on the Cashu tab. Confirm Lightning + Lightning Address tabs show placeholders.

Type 64 on the numpad. Tap Continue.

Confirm card appears. Verify the breakdown shows: They receive 64, Send fee (0 if exact-amount proofs), Receive fee, You pay (64 + fees).

Tap Send. Confirm the spinner shows briefly, then the share screen.

- [ ] **Step 7: Verify the share screen + copy + share-sheet**

Confirm: amount renders, truncated token renders, "Waiting for receiver…" shows with a spinner, Copy shows the doc icon. Tap the truncated token row — confirm the icon flips to a checkmark for ~1.5 s and the haptic fires.

Tap Share. Confirm `UIActivityViewController` appears with the token as the share payload.

- [ ] **Step 8: Claim the token from a second identity (proves the polling watcher)**

On host shell:

```bash
cd /Users/claude/agicash/.claude/worktrees/ios-send-cashu
# Use the CLI to claim the token as a fresh guest (NOT the same user as the sim).
nix develop -c cargo run -p agicash-cli -- auth guest
nix develop -c cargo run -p agicash-cli -- mint add http://127.0.0.1:3338
nix develop -c cargo run -p agicash-cli -- receive token "<paste the token here from the sim's clipboard / share sheet>"
```

(Pull the token from the sim's clipboard via `xcrun simctl pasteboard "iPhone 16 Pro" --copy-from-pasteboard-of=<sim-uuid>` if needed, or just read it from the Xcode console where the FFI tracing should log it.)

- [ ] **Step 9: Verify the sim flips to "Sent"**

Within 3-6 s of the CLI receive, the sim's share screen should flip to the green checkmark "Sent" card, then auto-dismiss the carousel back to Home after ~3 s.

Home balance should reflect the debit (100 − 64 − fees).

- [ ] **Step 10: Capture results for the operator report**

Note: branch name, commit shas, what worked end-to-end, what's stubbed (the two placeholder tabs), and any deviations from the plan. This is the final report — the operator reads it directly.

---

## Self-review

(Author note — done before handoff.)

**Spec coverage check:**
- ✅ FFI bridge for `send_swap` — Tasks 1–7 cover storage, value types, three wallet methods.
- ✅ Storage `get(swap_id)` helper — Tasks 1, 2.
- ✅ Polling-based proofs-spent confirmation — Task 7 (`check_send_swap_claimed`), Task 12 (`startPollingClaim`).
- ✅ Amount input UI mirrors Lightning Receive — Task 12 (`amountEntryView` copies `LightningReceiveView.amountEntryView` directly).
- ✅ Shareable Token screen with copy + share-sheet — Task 12 (`ShareCard` + `ShareSheet`).
- ✅ Confirmation screen for proofs-spent — Task 12 (`ClaimedCard`).
- ✅ Stub Lightning + LN-Address tabs as placeholders — Task 10.
- ✅ HomeView Send button wired — Task 13.
- ✅ Carousel mirror of `ReceiveCarouselView` — Task 11.
- ✅ Manual sim verification gate — Task 14.

**Placeholder scan:**
- No TBD / TODO / "implement later" markers. Each step has concrete commands and code.
- One known-soft area: Task 2 Step 3's reference to `self.base.postgrest()` — flagged inline with a "verify before pasting" note pointing to the existing methods in the same file. Same for the `decode_row` helper name — the engineer is told to confirm by grepping.
- Task 7 Step 1 may need CDK API name adjustments — flagged inline with a fallback grep recipe.
- Task 8 Step 2/3 may need a path adjustment if `generate-bindings.sh` outputs to a different directory — flagged with a "grep both paths" instruction.

**Type consistency:**
- `SendQuotePreview`, `SendSwapHandle`, `SendSwapClaimSnapshot`, `SendSwapClaimState` — defined in Task 3, referenced consistently in Tasks 5/6/7/9/12.
- `prepareSend` / `createSend` / `pollSendClaim` — defined in Task 9, called consistently in Task 12.
- `SendQuoteOutcome` / `SendOutcome` / `SendClaimOutcome` — defined in Task 9, used in Task 12's `await model.prepareSend / createSend / pollSendClaim` switch arms.
- `SendTab` enum members `.cashu` / `.lightning` / `.lightningAddress` — defined in Task 11, referenced in `HomeActionGrid` indirectly only through `SendCarouselView` (HomeView never names a `SendTab`); no cross-task inconsistency.
- `phase` cases (`amountEntry`, `quoting`, `confirming`, `swapping`, `share`, `claimed`, `failure`) — defined in Task 12 only; internally consistent.

**Decisions locked:**
- V4 token only (Task 6) — no V3 chooser.
- 3-second polling cadence (Task 12, matches spec).
- Polling stops on `.completed` or `.failed`; transient `.failure` outcomes keep polling.
- Cancel button on share screen counts as "done" (dismisses carousel) — same affordance as Lightning Receive's invoice screen Cancel.
- No QR code on share screen — copy + native share sheet only.
