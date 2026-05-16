# Slice 6 — Cashu Token Send

> **For executor:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Walk through tasks one at a time, committing per the plan's checkpoints. Read TS source first. Mirror slice 5 (receive) closely — same structure, opposite semantics.

**Goal:** Implement `agicash send <amount> [--account <id>]` — select proofs from a Cashu account, swap with the mint (if no exact-amount proofs available) per NUT-03 to get sendable proofs at the exact amount, encode as a Cashu V3/V4 token string, and persist the send-swap state. After this slice, a user can produce a token string they can hand to anyone else, and a balance reduction is reflected in `agicash balance`.

**Non-goals:**
- **Sender-pays-fee** is the only mode in slice 6. Receiver-pays-fee (token with included fee deduction by receiver) is deferred. TS only implements sender-pays.
- **Reversing a send** (swap proofsToSend back into the account if recipient hasn't claimed). Future slice — wires into slice 5 receive-swap-service.
- **Token format choice flag** — default to V4 (CBOR). User can't pick.
- **Real client-side encryption** — slice 6 reuses slice 5's passthrough `ProofEncryption`.
- **Watching for the send to be claimed** (a polling task that drives PENDING → COMPLETED when receiver redeems). Future slice — slice 6 leaves send in PENDING after token is produced; CLI exit doesn't block on settlement.
- **Lightning involvement of any kind.**

**Branch:** `feat/rust-cashu-send` off `feat/rust-cashu-receive`, worktree at `~/agicash/.claude/worktrees/rust-cashu-send`. Executor creates the worktree before starting.

**Operator principles (override defaults):**
1. **TS code is the blueprint.** Read `app/features/send/cashu-send-swap*.ts` end-to-end. Port APIs faithfully; deviate only where Rust ownership/async forces it.
2. **WASM still the goal.** Same constraints as slice 5 — sans-IO state machine in `agicash-cashu`, native-TLS executor stays out of `agicash-wasm`.
3. **Goal: cross-environment same-wallet.** Not full TS-app feature parity.
4. **No mocking in integration tests.** Real testnut.cashu.space mint, real local Supabase, real local OpenSecret.
5. **JSON-default CLI output**, stable kebab-case error codes on stderr.

---

## WASM compatibility flag

- State machine in `agicash-cashu/src/send_swap/state.rs` is **sans-IO** — pure state transitions, no async, no I/O. Compiles to wasm trivially.
- Executor (`send_swap/service.rs`) uses CDK which carries native-TLS reqwest — stays out of `agicash-wasm`.
- `ProofEncryption` trait reused from slice 5; passthrough impl reused.
- Integration tests are real-network and CLI-shaped — not run on wasm anyway.

Verify after slice: `cargo tree -p agicash-wasm | grep agicash-cashu` empty.

---

## Reference materials

| What | Path |
|------|------|
| Spec | `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` (send section) |
| Process | `~/athanor/projects/agicash-rust/PROCESS.md` |
| State | `~/athanor/projects/agicash-rust/STATE.md` |
| Slice 5 plan (mirror structure) | `docs/superpowers/plans/2026-05-15-rust-cashu-receive-token.md` |
| **TS service** (the blueprint) | `app/features/send/cashu-send-swap-service.ts` |
| **TS domain** | `app/features/send/cashu-send-swap.ts` |
| **TS repository** | `app/features/send/cashu-send-swap-repository.ts` |
| TS DB schema / RPCs | `supabase/migrations/` — find the migration with `create_cashu_send_swap`, `commit_proofs_to_send`, `complete_cashu_send_swap`, `fail_cashu_send_swap` |
| Cashu protocol NUT-03 | <https://github.com/cashubtc/nuts/blob/main/03.md> — swap endpoint |
| Cashu token formats | NUT-00 (V3 cashuA…) and NUT-00 V4 (cashuB… CBOR) |

---

## File structure (NEW files)

```
crates/
├── agicash-domain/
│   └── src/
│       └── send_swap.rs                          # NEW — CashuSendSwap struct + State enum
├── agicash-traits/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire new module
│       └── cashu_send_swap_storage.rs            # NEW — CashuSendSwapStorage trait + DTOs
├── agicash-storage-supabase/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire new module
│       └── cashu_send_swap_storage.rs            # NEW — postgrest impl
├── agicash-cashu/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire send_swap module
│       └── send_swap/
│           ├── mod.rs                            # NEW
│           ├── state.rs                          # NEW — sans-IO state machine
│           ├── error.rs                          # NEW — SendSwapError
│           └── service.rs                        # NEW — CashuSendSwapService (orchestrator)
├── agicash-cli/
│   ├── Cargo.toml                                # MODIFY (no new deps expected)
│   └── src/
│       ├── cli.rs                                # MODIFY — add Send command
│       ├── composition.rs                        # MODIFY — wire SendSwap deps
│       ├── main.rs                               # MODIFY — dispatch Send
│       └── send.rs                               # NEW — cmd_send
└── agicash-cli/tests/
    └── send.rs                                   # NEW — integration test
```

---

## Task 1: Domain — `CashuSendSwap` + state

**Goal:** Add `CashuSendSwap` struct + `CashuSendSwapState` enum to `agicash-domain`. Match TS schema in `cashu-send-swap.ts` exactly.

**Files:**
- Create: `crates/agicash-domain/src/send_swap.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-send-swap.ts` end-to-end. Note every base-schema field and the four state variants (DRAFT/PENDING/COMPLETED/FAILED/REVERSED).

- [ ] **Step 2:** Create `crates/agicash-domain/src/send_swap.rs`:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{AccountId, Money, TokenProof, UserId};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuSendSwap {
    pub id: Uuid,
    pub account_id: AccountId,
    pub user_id: UserId,
    /// Proofs reserved from the account as inputs to the swap.
    /// In DRAFT state these are the ONLY proofs persisted; in PENDING they remain reserved.
    pub input_proofs: Vec<TokenProof>,
    pub input_amount: Money,
    /// What the receiver will end up with after they claim.
    pub amount_received: Money,
    /// Fee the receiver will pay when claiming (sender pre-pays this in the token).
    pub cashu_receive_fee: Money,
    /// `amount_received + cashu_receive_fee` — what's encoded in the token.
    pub amount_to_send: Money,
    /// Fee for the sender's swap (zero if exact-amount proofs available).
    pub cashu_send_fee: Money,
    /// `amount_to_send + cashu_send_fee` — total deducted from account.
    pub amount_spent: Money,
    /// `cashu_send_fee + cashu_receive_fee`.
    pub total_fee: Money,
    /// Set only when DRAFT (input swap required).
    pub keyset_id: Option<String>,
    /// Set only when DRAFT.
    pub keyset_counter: Option<u32>,
    /// Output amount splits for the swap; set only when DRAFT.
    pub output_amounts: Option<OutputAmounts>,
    pub transaction_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub version: u32,
    pub state: CashuSendSwapState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct OutputAmounts {
    pub send: Vec<u64>,
    pub change: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuSendSwapState {
    /// Input swap required; input_proofs reserved but not yet swapped.
    Draft,
    /// proofs_to_send exist; waiting for receiver to claim.
    Pending {
        /// Hash of the token being sent (NUT-00 token id).
        token_hash: String,
        /// Proofs the receiver will claim.
        proofs_to_send: Vec<TokenProof>,
    },
    /// Receiver claimed; proofs_to_send are spent.
    Completed {
        token_hash: String,
        proofs_to_send: Vec<TokenProof>,
    },
    /// Failed before reaching PENDING (e.g. mint swap rejected).
    Failed {
        failure_reason: String,
    },
    /// Sender swapped the proofs_to_send back into the account.
    Reversed,
}
```

**Notes:**
- `TokenProof` already exists in `agicash-domain` from slice 5 — reuse it.
- TS uses a single `CashuSendSwapPendingCompletedStateSchema` for both PENDING and COMPLETED (same fields). Above we split them; the tag rename handles it.
- TS uses `id: z.string()` (UUID) — use `Uuid` in Rust.

- [ ] **Step 3:** Add to `crates/agicash-domain/src/lib.rs`:

```rust
pub mod send_swap;
pub use send_swap::{CashuSendSwap, CashuSendSwapState, OutputAmounts};
```

- [ ] **Step 4:** Unit tests:
  - Construct `CashuSendSwap` in each state variant.
  - JSON round-trip; verify `#[serde(tag = "state")]` produces what the TS-side DB stores.
  - Confirm `OutputAmounts` round-trips.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(domain): add CashuSendSwap types`

---

## Task 2: `CashuSendSwapStorage` trait + DTOs

**Goal:** Storage trait mirroring TS `CashuSendSwapRepository`. Four operations: `create`, `commit_proofs_to_send`, `complete`, `fail`. Hits existing RPCs `create_cashu_send_swap`, `commit_proofs_to_send`, `complete_cashu_send_swap`, `fail_cashu_send_swap`.

**Files:**
- Create: `crates/agicash-traits/src/cashu_send_swap_storage.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

### Steps

- [ ] **Step 1:** Read TS `cashu-send-swap-repository.ts` end-to-end. Capture:
  - `create` input shape — see `CreateSendSwap` type in TS lines 23-86.
  - `create` returns swap with input_proofs attached.
  - `commit_proofs_to_send` input: swap, tokenHash, proofsToSend, changeProofs. Splits encrypted proofs between "send" (kept reserved with swap_id) and "change" (returned to account).
  - `complete` input: swap_id only.
  - `fail` input: swap_id + reason; only valid from DRAFT.
  - The `ConcurrencyError` mapping for `hint === 'CONCURRENCY_ERROR'` (TS line 158).

- [ ] **Step 2:** Grep migrations for exact RPC parameter names:
  ```
  grep -rn "create_cashu_send_swap\|commit_proofs_to_send\|complete_cashu_send_swap\|fail_cashu_send_swap" /Users/claude/agicash/supabase/migrations/
  ```

- [ ] **Step 3:** Create `crates/agicash-traits/src/cashu_send_swap_storage.rs`:

```rust
use async_trait::async_trait;
use uuid::Uuid;
use agicash_domain::{Account, AccountId, CashuSendSwap, Money, OutputAmounts, TokenProof, UserId};

#[async_trait]
pub trait CashuSendSwapStorage: Send + Sync {
    /// Create a send swap row, reserving the chosen input proofs from the account.
    /// If `requires_input_proofs_swap` is true the swap starts DRAFT; otherwise PENDING.
    async fn create(
        &self,
        input: CreateSendSwap,
    ) -> Result<CreateSendSwapResult, SendSwapStorageError>;

    /// Persist swapped proofs and transition DRAFT → PENDING.
    /// `proofs_to_send` stay reserved; `change_proofs` flow back into the account.
    async fn commit_proofs_to_send(
        &self,
        input: CommitProofsToSend,
    ) -> Result<CashuSendSwap, SendSwapStorageError>;

    /// PENDING → COMPLETED. Idempotent on COMPLETED.
    async fn complete(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError>;

    /// DRAFT → FAILED with reason. Idempotent on FAILED. Rejects from PENDING/COMPLETED.
    async fn fail(
        &self,
        swap_id: Uuid,
        reason: &str,
    ) -> Result<CashuSendSwap, SendSwapStorageError>;
}

#[derive(Debug, Clone)]
pub struct CreateSendSwap {
    pub account_id: AccountId,
    pub user_id: UserId,
    pub token_mint_url: String,
    /// Requested amount (what receiver will get).
    pub amount_requested: Money,
    /// `amount_requested + cashu_receive_fee` — what the token will encode.
    pub amount_to_send: Money,
    /// `amount_to_send + cashu_send_fee` — total deducted.
    pub total_amount: Money,
    pub cashu_send_fee: Money,
    pub cashu_receive_fee: Money,
    pub input_proofs: Vec<TokenProof>,
    pub input_amount: Money,
    /// Set only when sum(input_proofs) == amount_to_send (no swap needed).
    pub token_hash: Option<String>,
    /// Set only when swap required.
    pub keyset_id: Option<String>,
    /// Set only when swap required.
    pub output_amounts: Option<OutputAmounts>,
}

#[derive(Debug, Clone)]
pub struct CreateSendSwapResult {
    pub swap: CashuSendSwap,
    pub account: Account,
}

#[derive(Debug, Clone)]
pub struct CommitProofsToSend {
    pub swap_id: Uuid,
    pub token_hash: String,
    pub proofs_to_send: Vec<TokenProof>,
    pub change_proofs: Vec<TokenProof>,
}

#[derive(Debug, thiserror::Error)]
pub enum SendSwapStorageError {
    #[error("concurrent modification: {0}")]
    Concurrency(String),
    #[error("not found")]
    NotFound,
    #[error("invalid state transition: {0}")]
    InvalidState(String),
    #[error("storage backend error: {0}")]
    Backend(String),
    #[error("encryption error: {0}")]
    Encryption(#[from] agicash_traits::EncryptionError),
}
```

**Notes:**
- Encryption is hidden inside the storage impl (slice 5 pattern). Trait surface stays plaintext.
- `Account` returned with the create result so caller can observe the post-reservation balance.

- [ ] **Step 4:** Wire into `crates/agicash-traits/src/lib.rs`:

```rust
pub mod cashu_send_swap_storage;
pub use cashu_send_swap_storage::*;
```

- [ ] **Step 5:** Compile-only test.

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(traits): add CashuSendSwapStorage trait + DTOs`

---

## Task 3: Sans-IO state machine in `agicash-cashu`

**Goal:** Pure state machine driving the send-swap forward. No async, no I/O.

**Files:**
- Create: `crates/agicash-cashu/src/send_swap/mod.rs`
- Create: `crates/agicash-cashu/src/send_swap/state.rs`
- Create: `crates/agicash-cashu/src/send_swap/error.rs`
- Modify: `crates/agicash-cashu/src/lib.rs`

### Steps

- [ ] **Step 1:** Design the machine. Five terminal states from domain (Draft/Pending/Completed/Failed/Reversed) plus a `NotStarted` pseudo-state.

```rust
// crates/agicash-cashu/src/send_swap/state.rs

use agicash_domain::{CashuSendSwap, CashuSendSwapState};

pub struct SendSwapMachine {
    state: MachineState,
}

#[derive(Debug, Clone)]
enum MachineState {
    /// Have inputs picked, no DB row yet.
    NotStarted,
    /// Persisted, input swap with mint pending.
    Draft(CashuSendSwap),
    /// proofs_to_send exist, awaiting receiver claim.
    Pending(CashuSendSwap),
    Completed(CashuSendSwap),
    Failed(CashuSendSwap),
    Reversed(CashuSendSwap),
}

#[derive(Debug, Clone)]
pub enum Action {
    /// Persist swap row. If `requires_input_proofs_swap` is false, jumps straight to PENDING.
    CreateSwap { requires_input_proofs_swap: bool },
    /// Call mint /v1/swap with the reserved input proofs to produce send + change proofs.
    SwapWithMint {
        keyset_id: String,
        keyset_counter: u32,
        send_amounts: Vec<u64>,
        change_amounts: Vec<u64>,
    },
    /// Persist proofs_to_send + change_proofs, transition DRAFT → PENDING.
    CommitProofsToSend { token_hash: String },
    /// PENDING → COMPLETED (caller detected receiver claim externally).
    CompleteSwap,
    /// DRAFT → FAILED with reason.
    FailSwap { reason: String },
    /// Terminal — nothing more to do.
    None,
}

#[derive(Debug, Clone)]
pub enum Event {
    SwapCreated(CashuSendSwap),
    MintSwapSucceeded {
        proofs_to_send: Vec<agicash_domain::TokenProof>,
        change_proofs: Vec<agicash_domain::TokenProof>,
    },
    /// Mint rejected (output already signed / token already spent) — executor should restore.
    MintSwapAlreadyExecuted,
    MintRestoreSucceeded {
        proofs_to_send: Vec<agicash_domain::TokenProof>,
        change_proofs: Vec<agicash_domain::TokenProof>,
    },
    ProofsCommitted(CashuSendSwap),
    SwapCompleted(CashuSendSwap),
    SwapFailed(CashuSendSwap),
}

impl SendSwapMachine {
    pub fn new() -> Self { Self { state: MachineState::NotStarted } }
    pub fn from_existing(swap: CashuSendSwap) -> Self { /* match state variant */ }
    pub fn next_action(&self) -> Action { /* per state */ }
    pub fn apply(&mut self, event: Event) -> Result<(), SendSwapError> { /* transitions */ }
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Completed(_) | MachineState::Failed(_) | MachineState::Reversed(_),
        )
    }
    pub fn snapshot(&self) -> Option<&CashuSendSwap> { /* extract */ }
}
```

- [ ] **Step 2:** Implement `next_action` + `apply` per the diagram:

```
NotStarted ──CreateSwap{requires_swap:false}──> SwapCreated(PENDING) ──> Pending (terminal-ish; awaits external claim event)
NotStarted ──CreateSwap{requires_swap:true}──> SwapCreated(DRAFT) ──> Draft
Draft ──SwapWithMint──> MintSwapSucceeded ──> [internal: proofs ready] ──CommitProofsToSend──> ProofsCommitted ──> Pending
                     │
                     └─MintSwapAlreadyExecuted──> [executor calls restore]
                                              │
                                              ├─MintRestoreSucceeded──> [internal] ──CommitProofsToSend──> Pending
                                              └─else: FailSwap("mint swap failed")
Draft ──FailSwap──> SwapFailed ──> Failed (terminal)
Pending ──CompleteSwap──> SwapCompleted ──> Completed (terminal)
```

- [ ] **Step 3:** Unit tests for every transition:
  - Happy exact-proofs: NotStarted → CreateSwap{false} → PENDING.
  - Happy swap path: NotStarted → CreateSwap{true} → DRAFT → SwapWithMint → MintSwapSucceeded → CommitProofsToSend → Pending.
  - Restore path: DRAFT → SwapWithMint → MintSwapAlreadyExecuted → MintRestoreSucceeded → CommitProofsToSend → Pending.
  - Restore-fail: DRAFT → SwapWithMint → MintSwapAlreadyExecuted (no restore proofs) → FailSwap → Failed.
  - PENDING → CompleteSwap → Completed.
  - DRAFT → FailSwap → Failed.
  - Invalid transitions (CompleteSwap from DRAFT, FailSwap from PENDING, etc.) return error.
  - `from_existing(COMPLETED swap).is_terminal() == true`.

No network, no async.

- [ ] **Step 4:** Create `error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum SendSwapError {
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },
    #[error("storage error: {0}")]
    Storage(#[from] agicash_traits::SendSwapStorageError),
    #[error("mint error: {0}")]
    Mint(#[from] agicash_traits::CashuProviderError),
    #[error("insufficient balance: need {needed}, have {have}")]
    InsufficientBalance { needed: String, have: String },
    #[error("amount too small after fees")]
    AmountTooSmall,
    #[error("currency mismatch: account {account} differs from request {request}")]
    CurrencyMismatch { account: String, request: String },
    #[error("token encode error: {0}")]
    TokenEncode(String),
}
```

- [ ] **Step 5:** Wire into `agicash-cashu/src/lib.rs`:

```rust
pub mod send_swap;
pub use send_swap::{SendSwapMachine, Action as SendAction, Event as SendEvent, SendSwapError};
```

`send_swap/mod.rs`:

```rust
pub mod state;
pub mod error;
pub mod service;
pub use state::*;
pub use error::*;
pub use service::*;
```

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cashu): sans-IO state machine for send swap`

---

## Task 4: `CashuSendSwapService` (orchestrator)

**Goal:** Drives `SendSwapMachine` forward, performs I/O. Mirrors TS `CashuSendSwapService` — exposes `get_quote`, `create`, `swap_for_proofs_to_send`. (Slice 6 omits `reverse` and async polling for `complete`; user can call `complete` manually if/when slice adds receiver-claim detection.)

**Files:**
- Create: `crates/agicash-cashu/src/send_swap/service.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-send-swap-service.ts` end-to-end. Critical sections:
  - `prepareProofsAndFee` (lines 298-398) — proof selection + fee math. Two-pass: (1) select for amount, check if exact, (2) if not exact, re-select including estimated receive-fee.
  - `getQuote` (lines 51-96) — preview without persisting.
  - `create` (lines 101-184) — persist; emits DRAFT or PENDING based on whether swap is needed.
  - `swapForProofsToSend` (lines 186-245) — drive DRAFT → PENDING; includes the `OUTPUT_ALREADY_SIGNED` / `TOKEN_ALREADY_SPENT` restore fallback.
  - `swapProofs` (lines 400-462) — the mint swap call with deterministic output data + restore on conflict.

- [ ] **Step 2:** Implement:

```rust
// crates/agicash-cashu/src/send_swap/service.rs

use std::sync::Arc;
use agicash_domain::{Account, AccountId, CashuSendSwap, Money, OutputAmounts, TokenProof, UserId};
use agicash_traits::{CashuProvider, CashuSendSwapStorage, CreateSendSwap, CreateSendSwapResult};
use crate::send_swap::{SendAction, SendEvent, SendSwapError, SendSwapMachine};

pub struct CashuSendSwapService {
    storage: Arc<dyn CashuSendSwapStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl CashuSendSwapService {
    pub fn new(
        storage: Arc<dyn CashuSendSwapStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self { storage, cashu_provider }
    }

    /// Compute fees + proof selection for a hypothetical send. Does not persist.
    pub async fn get_quote(
        &self,
        account: &Account,
        amount: Money,
    ) -> Result<SendQuote, SendSwapError> {
        // 1. Validate currency.
        // 2. Call prepare_proofs_and_fee(account.proofs, amount).
        // 3. Wrap result as SendQuote.
    }

    /// Persist a new send swap. Returns the resulting state (DRAFT if input swap required, PENDING otherwise).
    pub async fn create(
        &self,
        user_id: UserId,
        account: &Account,
        amount: Money,
    ) -> Result<CreateSendSwapResult, SendSwapError> {
        // 1. Validate currency.
        // 2. prepare_proofs_and_fee(...)
        // 3. If sum(send) == amount_to_send: compute token_hash, no swap needed → storage.create(token_hash=Some, keyset_id=None, output_amounts=None).
        //    Else: pick keyset (latest active), compute output splits via cdk::nuts::amount::split_amount.
        //       → storage.create(token_hash=None, keyset_id=Some(...), output_amounts=Some(...)).
        // 4. Return CreateSendSwapResult { swap, account }.
    }

    /// Drive DRAFT → PENDING by performing the mint swap.
    /// Idempotent: returns Ok on already-PENDING swaps.
    pub async fn swap_for_proofs_to_send(
        &self,
        account: &Account,
        swap: CashuSendSwap,
    ) -> Result<CashuSendSwap, SendSwapError> {
        let mut machine = SendSwapMachine::from_existing(swap.clone());
        // Drive loop:
        //   action = next_action()
        //   match action:
        //     SwapWithMint{..} -> call CDK swap (pre_mint_secrets with deterministic counter); on conflict, restore.
        //       -> apply MintSwapSucceeded or (MintSwapAlreadyExecuted -> attempt restore -> MintRestoreSucceeded | FailSwap)
        //     CommitProofsToSend{..} -> storage.commit_proofs_to_send(...) -> apply ProofsCommitted
        //     FailSwap{reason} -> storage.fail(swap_id, &reason) -> apply SwapFailed
        //     None -> exit
    }

    pub async fn complete(&self, swap: &CashuSendSwap) -> Result<CashuSendSwap, SendSwapError> {
        // Match TS: no-op on COMPLETED, error on non-PENDING.
        // Else storage.complete(swap.id).
    }

    pub async fn fail(&self, swap: &CashuSendSwap, reason: &str) -> Result<CashuSendSwap, SendSwapError> {
        // Match TS: no-op on FAILED, error on non-DRAFT.
        // Else storage.fail(swap.id, reason).
    }

    /// TS lines 298-398 — proof selection + two-pass fee math.
    async fn prepare_proofs_and_fee(
        &self,
        account: &Account,
        requested: Money,
    ) -> Result<PreparedSelection, SendSwapError> {
        // Mirror TS exactly:
        // 1. selectProofsToSend(proofs, requested_amount, /* includeFeesInSendAmount */ true)
        // 2. cashu_send_fee_for_selected = wallet.get_fees_for_proofs(send_selected)
        // 3. if sum(send) == requested + receive_fee_estimated_at_zero_cost: return zero-send-fee result.
        // 4. else: estimate_receive_fee = get_fees_estimate_to_receive_at_least(requested + ...);
        //    re-select for (requested + estimate_receive_fee), recompute cashu_send_fee.
        // 5. Check balance sufficient; else InsufficientBalance.
        // CDK exposes:
        //   - cdk::wallet::Wallet::select_proofs (verify exact name)
        //   - keyset.input_fee_ppk based fee calc helpers
        // Verify in CDK source before writing this method.
    }
}

pub struct SendQuote {
    pub amount_requested: Money,
    pub amount_to_send: Money,
    pub total_amount: Money,
    pub total_fee: Money,
    pub cashu_receive_fee: Money,
    pub cashu_send_fee: Money,
}

pub struct PreparedSelection {
    pub send: Vec<TokenProof>,
    pub keep: Vec<TokenProof>,
    pub cashu_send_fee: u64,
    pub cashu_receive_fee: u64,
}
```

**Open questions surfaced here:**
- Where does the user's seed come from? **Same answer as slice 5** — `OpenSecretClient::get_seed()`. Slice 5 should have already added this; reuse.
- Which CDK type produces deterministic blinded outputs? TS uses `OutputData.createDeterministicData(amount, seed, counter, keyset, output_amounts)`. CDK equivalent is `PreMintSecrets::with_counter` (or similar — verify before Task 4 implementation).
- Token encoding: the orchestrator returns proofs; the CLI command (Task 6) is responsible for assembling them into a token string via `cdk::nuts::Token::new(...).to_string()` (default v4). Verify exact API.

- [ ] **Step 3:** Unit tests (no network):
  - `get_quote` rejects currency mismatch.
  - `get_quote` errors with `InsufficientBalance` when balance < total.
  - `create` populates `token_hash` when proofs exact; populates `keyset_id` + `output_amounts` when swap needed.
  - `fail` is no-op on FAILED swap; errors on PENDING swap.
  - `complete` is no-op on COMPLETED; errors on DRAFT.

Network-dependent paths (`swap_for_proofs_to_send` with real mint) go in Task 7.

- [ ] **Step 4:** Clippy + fmt clean.

- [ ] **Step 5: Commit** — `feat(cashu): CashuSendSwapService orchestrator with CDK swap + restore fallback`

---

## Task 5: Supabase impl of `CashuSendSwapStorage`

**Goal:** Postgrest-backed impl mirroring TS repository. Calls `create_cashu_send_swap`, `commit_proofs_to_send`, `complete_cashu_send_swap`, `fail_cashu_send_swap` RPCs.

**Files:**
- Create: `crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

### Steps

- [ ] **Step 1:** Read TS `cashu-send-swap-repository.ts` end-to-end. Note:
  - `create` encrypts the swap blob (tokenMintUrl, amountReceived, amountToSend, cashuReceiveFee, cashuSendFee, amountSpent, amountReserved, totalFee, outputAmounts) and sends input_proofs as IDs (TS line 141).
  - `commit_proofs_to_send` field-encrypts each proof's amount + secret in batch and sends as JSON arrays (TS lines 197-223).
  - `complete` and `fail` are simple RPC calls.
  - `ConcurrencyError` mapping on `error.hint === 'CONCURRENCY_ERROR'`.

- [ ] **Step 2:** Implement following the slice 5 storage pattern:

```rust
pub struct SupabaseCashuSendSwapStorage {
    client: postgrest::Postgrest,
    encryption: Arc<dyn ProofEncryption>,
}

#[async_trait]
impl CashuSendSwapStorage for SupabaseCashuSendSwapStorage {
    async fn create(&self, input: CreateSendSwap) -> Result<CreateSendSwapResult, SendSwapStorageError> {
        // 1. Build the encrypted-data JSON blob (see TS line 113-129).
        // 2. encryption.encrypt(serde_json::to_vec(&blob)?)
        // 3. requires_input_proofs_swap = input.input_amount != input.amount_to_send
        // 4. Call create_cashu_send_swap RPC with:
        //    p_user_id, p_account_id, p_input_proofs (ids only), p_currency,
        //    p_encrypted_data, p_requires_input_proofs_swap, p_token_hash,
        //    p_keyset_id, p_number_of_outputs.
        // 5. Map error.hint=='CONCURRENCY_ERROR' → Concurrency.
        // 6. Parse response { swap, reserved_proofs, account }.
    }

    async fn commit_proofs_to_send(&self, input: CommitProofsToSend) -> Result<CashuSendSwap, SendSwapStorageError> {
        // 1. For each proof (proofs_to_send + change_proofs) encrypt amount + secret (passthrough for slice 6).
        // 2. Build encrypted_proofs_to_send + encrypted_change_proofs JSON arrays.
        // 3. Call commit_proofs_to_send RPC.
        // 4. Parse response → CashuSendSwap in PENDING state.
    }

    async fn complete(&self, swap_id: Uuid) -> Result<CashuSendSwap, SendSwapStorageError> {
        // Simple RPC call to complete_cashu_send_swap.
    }

    async fn fail(&self, swap_id: Uuid, reason: &str) -> Result<CashuSendSwap, SendSwapStorageError> {
        // Simple RPC call to fail_cashu_send_swap.
    }
}
```

**Notes:**
- Slice 5 chose loop-encrypt over batch-encrypt — do the same here. Encryption is passthrough so single-call performance is fine.
- Confirm whether postgrest's bytea param wants base64 or raw bytes; match slice 5.
- Helper `to_swap(row, proofs)` — port TS `toSwap` (line 327). It distinguishes input_proofs from proofs_to_send by `cashu_send_swap_id` foreign key (TS line 330-336).

- [ ] **Step 3:** Integration tests gated behind `real-supabase-tests`:
  - `create` with `requires_input_proofs_swap=false` (token_hash provided) → swap in PENDING.
  - `create` with `requires_input_proofs_swap=true` → swap in DRAFT.
  - `create` then `commit_proofs_to_send` → DRAFT → PENDING.
  - `create` then `fail` (still DRAFT) → DRAFT → FAILED.
  - `create` then `commit` then `complete` → PENDING → COMPLETED.
  - Duplicate `create` on same account with overlapping input proofs → ConcurrencyError or constraint error (verify by trying).

- [ ] **Step 4:** Wire into `agicash-storage-supabase/src/lib.rs`.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(storage-supabase): postgrest impl for CashuSendSwapStorage`

---

## Task 6: CLI command `agicash send <amount> [--account <id>]`

**Goal:** Wire the send flow to the CLI. Emits a JSON object containing the token string + send-swap metadata.

**Files:**
- Modify: `crates/agicash-cli/src/cli.rs`
- Modify: `crates/agicash-cli/src/composition.rs`
- Create: `crates/agicash-cli/src/send.rs`
- Modify: `crates/agicash-cli/src/main.rs`

### Steps

- [ ] **Step 1:** Add to `cli.rs`:

```rust
Send {
    /// Amount to send in the account's unit (sats for BTC accounts, cents for USD).
    amount: u64,
    /// Account ID to send from. If omitted, uses the only account or errors.
    #[arg(long)]
    account: Option<Uuid>,
    /// Token format version: 4 (CBOR, default) or 3 (legacy JSON).
    #[arg(long, default_value_t = 4)]
    token_version: u8,
    /// Show preview without sending.
    #[arg(long)]
    dry_run: bool,
},
```

- [ ] **Step 2:** Add `SendSwapDeps` in `composition.rs`:

```rust
pub struct SendSwapDeps {
    pub service: Arc<CashuSendSwapService>,
    pub storage: Arc<dyn CashuSendSwapStorage>,
}

pub fn build_send_swap_deps(
    auth_deps: &AuthDeps,
    cashu_deps: &CashuDeps,
) -> Result<SendSwapDeps, Error> {
    let encryption = Arc::new(PassthroughProofEncryption);
    let storage = Arc::new(SupabaseCashuSendSwapStorage::new(
        /* postgrest client from auth_deps */,
        encryption,
    ));
    let service = Arc::new(CashuSendSwapService::new(
        storage.clone(),
        Arc::new(cashu_deps.provider.clone()),
    ));
    Ok(SendSwapDeps { service, storage })
}
```

- [ ] **Step 3:** Implement `cmd_send` in `send.rs`:

```rust
pub async fn cmd_send(
    auth_deps: &AuthDeps,
    storage_deps: &StorageDeps,
    cashu_deps: &CashuDeps,
    send_deps: &SendSwapDeps,
    amount: u64,
    account: Option<Uuid>,
    token_version: u8,
    dry_run: bool,
) -> Result<(), SendCmdError> {
    // 1. Load session — error NotLoggedIn if absent.
    // 2. List user accounts; resolve target account:
    //    - If `account` provided: storage_deps.account_storage.get(id) — error NoMatchingAccount if missing or not owned by user.
    //    - Else: if only one account, use it; if multiple, error AccountAmbiguous.
    // 3. Hydrate account to CashuAccount with proofs.
    // 4. Build `Money` from amount + account.currency.
    // 5. If dry_run: call service.get_quote, print quote JSON, exit.
    // 6. Else: service.create(user_id, &account, amount).
    //    - DRAFT result: service.swap_for_proofs_to_send(&account, swap) → PENDING swap.
    //    - PENDING result: proceed.
    // 7. Build Cashu token from final swap.proofs_to_send + mint_url + currency:
    //    - cdk::nuts::Token::new(mint_url, proofs, unit, memo=None) → encode v3 or v4 per flag.
    // 8. Print JSON: {
    //      "status": "sent",
    //      "token": "cashuB...",
    //      "amount": "<sats>",
    //      "fee": "<sats>",
    //      "account_id": "...",
    //      "mint_url": "...",
    //      "swap_id": "...",
    //      "token_hash": "..."
    //    }
}

#[derive(Debug, thiserror::Error)]
pub enum SendCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("no matching account")]
    NoMatchingAccount,
    #[error("account ambiguous — pass --account <id>")]
    AccountAmbiguous,
    #[error("insufficient balance")]
    InsufficientBalance,
    #[error(transparent)]
    Send(#[from] SendSwapError),
    #[error(transparent)]
    Storage(#[from] agicash_traits::StorageError),
    #[error(transparent)]
    Auth(#[from] agicash_traits::AuthError),
    #[error("token encode error: {0}")]
    TokenEncode(String),
}
```

- [ ] **Step 4:** Dispatch in `main.rs`. Add `SendCmdError` to `classify_error` with stable kebab-case codes: `not-logged-in`, `no-matching-account`, `account-ambiguous`, `insufficient-balance`, `amount-too-small`, `currency-mismatch`, `mint-error`, `mint-unreachable`, `token-encode-error`.

- [ ] **Step 5:** Smoke test: `cargo run -p agicash-cli -- send --help`.

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cli): add 'agicash send <amount>' command`

---

## Task 7: Integration test against real mint

**Goal:** E2E test: deposit (via slice 5 receive flow or testnut faucet), send a smaller amount, verify token is claimable by a separate receive call.

**Files:**
- Create: `crates/agicash-cli/tests/send.rs`

### Steps

- [ ] **Step 1:** Decide deposit strategy:
  - **Option A (preferred):** Reuse slice 5's `mint_test_token_via_testnut` helper. Receive 200 sats; send 100; verify second receive of the produced token claims 100.
  - **Option B:** Mint directly via CDK at higher amount; skip receive.

- [ ] **Step 2:** Write tests gated behind `real-mint-tests,real-supabase-tests,real-opensecret-tests`:

```rust
#[cfg(all(feature = "real-mint-tests", feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod tests {
    use assert_cmd::Command;
    use predicates::prelude::*;

    #[test]
    fn send_token_round_trips_through_receive() {
        let _ = dotenvy::dotenv();
        // 1. auth guest
        // 2. mint add testnut
        // 3. mint a 200-sat token via helper; agicash receive it.
        // 4. agicash send 100 → capture token from JSON stdout.
        // 5. auth guest (fresh user) — log out + new guest.
        // 6. mint add testnut
        // 7. agicash receive <captured_token> → success, amount=100.
        // 8. balance shows 100.
    }

    #[test]
    fn send_exact_proofs_no_input_swap() {
        // Receive an exact amount (e.g. 8 sats), then send 8 — should skip mint swap (goes straight to PENDING).
        // Verify token is claimable.
    }

    #[test]
    fn send_insufficient_balance_errors() {
        // No proofs in account; agicash send 100 → exit nonzero, stderr contains "insufficient-balance".
    }

    #[test]
    fn send_dry_run_prints_quote_without_persisting() {
        // After receive of 200 sats, agicash send 100 --dry-run prints quote JSON.
        // Subsequent `agicash send 100` still succeeds (no proofs reserved by dry-run).
    }
}
```

- [ ] **Step 3:** Run: `cargo test -p agicash-cli --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test send -- --nocapture`. PASS.

- [ ] **Step 4: Commit** — `test(cli): integration test for send-token flow`

---

## Task 8: Final verification — slice 6 test bar

- [ ] `cargo build --workspace` clean (zero warnings)
- [ ] `cargo test --workspace` green
- [ ] `cargo clippy --workspace --all-targets --features real-supabase-tests,real-opensecret-tests,real-mint-tests,real-rate-tests -- -D warnings` clean
- [ ] `cargo fmt --all --check` clean
- [ ] `cargo test -p agicash-cashu` — state-machine unit tests pass (no network)
- [ ] `cargo test -p agicash-storage-supabase --features real-supabase-tests` — storage tests pass
- [ ] `cargo test -p agicash-cli --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test send -- --nocapture` — e2e passes
- [ ] `cargo tree -p agicash-wasm | grep agicash-cashu` empty
- [ ] Smoke: `agicash send --help` shows usage; `agicash send 100 --dry-run` (after receiving funds) prints a JSON quote; `agicash send 999999999` errors with `insufficient-balance`.

---

## Open questions for operator

1. **Send-flow `complete` trigger.** Slice 6 leaves the swap in PENDING after producing the token. The transition to COMPLETED requires detecting that the receiver claimed the token (mint's `check_state` returns SPENT for the secrets). Three options: (a) defer all transitions to a future "watcher" slice — slice 6 ships PENDING-and-forget. (b) Add a `agicash send-status <swap_id>` CLI command that re-queries the mint and transitions to COMPLETED if spent. (c) Block in `cmd_send` polling for completion (bad UX — receiver may not claim for hours). **Recommend (a) for slice 6** — matches the minimum-viable scope. Confirm before Task 6.

2. **Token version default.** TS app defaults to V4 (CBOR), which is the spec-recommended modern format. CDK supports both. **Recommend V4 default**, with `--token-version 3` for legacy compat. Confirm.

3. **Account-selection UX.** If user has one account, use it implicitly. If multiple, error and demand `--account <id>`. TS UI lets user pick from a dropdown; CLI can't. Alternative: prompt interactively when stdin is a TTY. **Recommend hard-error for slice 6** — keeps the JSON-only output contract intact. Confirm.

---

## Notes for the executor

- Same as slice 5 — state machine pure, executor holds I/O.
- TS uses `wallet.ops.send(amount, inputs).keyset(id).asCustom(send_outputs).keepAsCustom(keep_outputs).run()` — that's CDK swap with deterministic outputs for both send and change. CDK 0.15's equivalent is `Wallet::swap` with `PreMintSecrets::with_counter` for both output sets. **Read CDK source to find exact entry point.** Slice 5 should have located the relevant CDK API.
- The DB RPC parameter names in TS repo are authoritative. Match exactly.
- Passthrough encryption only. Real encryption arrives in a future slice.
- If you hit "where does the seed come from" — slice 5 resolved this (Open Question 1 in slice 5 plan). Same answer; reuse.
- Token serialization: `cdk::nuts::Token::new(mint_url, proofs, currency_unit, memo)` → `.to_string()` for v3 or `.to_v4_string()` for v4 (verify exact API names).
