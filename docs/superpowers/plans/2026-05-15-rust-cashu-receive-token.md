# Slice 5 — Cashu Token Receive

> **For executor:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Walk through tasks one at a time, committing per the plan's checkpoints. Read TS source first.

**Goal:** Implement `agicash receive <token>` — accept a Cashu V3/V4 ecash token string, validate it against an existing account on the matching mint, swap with the mint per NUT-03, and store the resulting proofs against the account. After this slice, a user can take a token produced by any Cashu wallet (or the testnut faucet) and claim it into their wallet, with balance > 0 in `agicash balance`.

**Non-goals:**
- Cross-account claim (token from mint A → melted via Lightning into account on mint B). Future slice.
- Real client-side encryption — slice 5 uses a **passthrough `ProofEncryption` stub**. The trait shape supports real ECIES encryption in a future slice.
- Lightning involvement of any kind.
- Auto-add mint if token's mint isn't already an account. User must run `mint add <url>` first.

**Branch:** `feat/rust-cashu-receive` off `feat/rust-money-cashu`, worktree at `~/agicash/.claude/worktrees/rust-cashu-receive`. Executor creates the worktree before starting.

**Operator principles (override defaults):**
1. **TS code is the blueprint.** Read `app/features/receive/cashu-receive-swap*.ts` end-to-end. Port APIs faithfully; deviate only where Rust ownership/async forces it.
2. **WASM still the goal.** Opensecret is the only hard blocker. Where wasm-compat is free, take it.
3. **Goal: cross-environment same-wallet.** Not full TS-app feature parity.
4. **No mocking in integration tests.** Real testnut.cashu.space mint, real local Supabase, real local OpenSecret.
5. **JSON-default CLI output**, stable kebab-case error codes on stderr.

---

## WASM compatibility flag

- State machine in `agicash-cashu/src/receive_swap/state.rs` is **sans-IO** — pure state transitions, no async, no I/O. It compiles to wasm trivially.
- Executor (`receive_swap/executor.rs`) uses CDK which carries native-TLS reqwest — stays out of `agicash-wasm` (same as slice 4 CashuProvider).
- `ProofEncryption` trait + passthrough impl: pure Rust, wasm-safe.
- Integration tests are real-network and CLI-shaped — not run on wasm anyway.

Verify after slice: `cargo tree -p agicash-wasm | grep agicash-cashu` empty.

---

## Reference materials

| What | Path |
|------|------|
| Spec | `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` §16.8 (was slice 8; pulled forward to slice 5) |
| Process | `~/athanor/projects/agicash-rust/PROCESS.md` |
| State | `~/athanor/projects/agicash-rust/STATE.md` |
| Slice 4 plan (format reference) | `docs/superpowers/plans/2026-05-15-rust-money-cashu.md` |
| **TS service** (the blueprint) | `app/features/receive/cashu-receive-swap-service.ts` |
| **TS domain** | `app/features/receive/cashu-receive-swap.ts` |
| **TS repository** | `app/features/receive/cashu-receive-swap-repository.ts` |
| **TS entry point** | `app/features/receive/receive-cashu-token-service.ts` (less directly relevant — UI orchestration) |
| TS DB schema / RPCs | `supabase/migrations/` — find the migration creating `create_cashu_receive_swap`, `complete_cashu_receive_swap`, `fail_cashu_receive_swap` RPCs |
| TS encryption | `app/features/shared/encryption.ts` — read enough to define the trait shape |
| Cashu protocol NUT-03 | <https://github.com/cashubtc/nuts/blob/main/03.md> — the swap endpoint |

---

## File structure

```
crates/
├── agicash-domain/
│   └── src/
│       └── receive_swap.rs                          # NEW — CashuReceiveSwap struct + State enum
├── agicash-traits/
│   └── src/
│       ├── lib.rs                                   # MODIFY — wire new modules
│       ├── proof_encryption.rs                      # NEW — ProofEncryption trait + PassthroughProofEncryption stub
│       └── cashu_receive_swap_storage.rs            # NEW — CashuReceiveSwapStorage trait
├── agicash-storage-supabase/
│   └── src/
│       └── cashu_receive_swap_storage.rs            # NEW — postgrest-backed impl of the storage trait
├── agicash-cashu/
│   └── src/
│       ├── lib.rs                                   # MODIFY — wire receive_swap module
│       └── receive_swap/
│           ├── mod.rs                               # NEW
│           ├── state.rs                             # NEW — sans-IO state machine
│           ├── error.rs                             # NEW — ReceiveSwapError
│           └── service.rs                           # NEW — CashuReceiveSwapService (orchestrates state + I/O)
├── agicash-cli/
│   ├── Cargo.toml                                   # MODIFY — no new deps
│   └── src/
│       ├── cli.rs                                   # MODIFY — add Receive command
│       ├── composition.rs                           # MODIFY — wire ProofEncryption + CashuReceiveSwapStorage + service
│       ├── main.rs                                  # MODIFY — dispatch Receive
│       └── receive.rs                               # NEW — cmd_receive
└── agicash-cli/tests/
    └── receive.rs                                   # NEW — integration test (real-mint-tests + real-supabase-tests + real-opensecret-tests)
```

---

## Task 1: Domain — `CashuReceiveSwap` + state

**Goal:** Add the `CashuReceiveSwap` struct + `CashuReceiveSwapState` enum to `agicash-domain`. Match the TS schema exactly (read `cashu-receive-swap.ts`).

**Files:**
- Create: `crates/agicash-domain/src/receive_swap.rs`
- Modify: `crates/agicash-domain/src/lib.rs`

### Steps

- [ ] **Step 1:** Read TS `cashu-receive-swap.ts` end-to-end. Note every field on `CashuReceiveSwapBaseSchema`, the three state variants (PENDING/COMPLETED/FAILED), and which fields belong on the base vs. state-specific variants.

- [ ] **Step 2:** Create `crates/agicash-domain/src/receive_swap.rs` with:

```rust
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::{AccountId, UserId, Money};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuReceiveSwap {
    /// Hash of the token being received (unique key).
    pub token_hash: String,
    pub token_proofs: Vec<TokenProof>,
    pub token_description: Option<String>,
    pub user_id: UserId,
    pub account_id: AccountId,
    pub input_amount: Money,
    pub amount_received: Money,
    pub fee_amount: Money,
    pub keyset_id: String,
    pub keyset_counter: u32,
    pub output_amounts: Vec<u64>,
    pub transaction_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub version: u32,
    pub state: CashuReceiveSwapState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuReceiveSwapState {
    Pending,
    Completed,
    Failed { failure_reason: String },
}

/// A single Cashu proof from a token. Match @cashu/cashu-ts Proof shape.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TokenProof {
    pub id: String,       // keyset id
    pub amount: u64,
    pub secret: String,
    #[serde(rename = "C")]
    pub c: String,        // unblinded signature
    pub dleq: Option<serde_json::Value>,
    pub witness: Option<serde_json::Value>,
}
```

**Notes:**
- The TS schema uses `version: z.number()` and `keysetCounter: z.number()` — use `u32` in Rust unless TS storage shows the field can exceed that. Read the migration to confirm column types.
- `TokenProof` could live in `agicash-cashu` if it's protocol-layer rather than domain. Judgment call: TS keeps proofs in domain. Match.

- [ ] **Step 3:** Add to `crates/agicash-domain/src/lib.rs`:

```rust
pub mod receive_swap;
pub use receive_swap::{CashuReceiveSwap, CashuReceiveSwapState, TokenProof};
```

- [ ] **Step 4:** Unit tests in `receive_swap.rs`:
  - Construct `CashuReceiveSwap` in each state.
  - JSON round-trip the struct (use `serde_json::to_string` then `from_str`) — verify the `#[serde(tag = "state")]` shape matches what the TS-side DB stores.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(domain): add CashuReceiveSwap + TokenProof types`

---

## Task 2: `ProofEncryption` trait + passthrough stub

**Goal:** Define the encryption seam in `agicash-traits`. Slice 5 uses a passthrough impl; real ECIES encryption lands in a future slice without changing the trait.

**Files:**
- Create: `crates/agicash-traits/src/proof_encryption.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

### Steps

- [ ] **Step 1:** Read `app/features/shared/encryption.ts` enough to learn:
  - What gets encrypted (proof `amount`, proof `secret`, swap `tokenProofs` JSON, etc.)
  - Whether encryption is per-field (batch) or per-blob
  - The bytes-in / bytes-out shape

- [ ] **Step 2:** Create `crates/agicash-traits/src/proof_encryption.rs`:

```rust
use async_trait::async_trait;

/// Encrypts and decrypts sensitive wallet data (proofs, swap metadata)
/// before it leaves the device. Implementations must be deterministic
/// only in the trivial passthrough case — real impls derive per-call
/// nonces and MUST NOT be deterministic.
///
/// `ciphertext` shape is opaque — callers store it as bytes and pass
/// it back to `decrypt`.
#[async_trait]
pub trait ProofEncryption: Send + Sync {
    async fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError>;
    async fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, EncryptionError>;
}

#[derive(Debug, thiserror::Error)]
pub enum EncryptionError {
    #[error("encryption failed: {0}")]
    Encrypt(String),
    #[error("decryption failed: {0}")]
    Decrypt(String),
    #[error("encryption key unavailable")]
    NoKey,
}

/// Passthrough impl for slice 5. Real encryption arrives in a future slice.
/// Stores plaintext as-is in the "ciphertext" channel. SAFE FOR LOCAL DEV ONLY.
#[derive(Debug, Clone, Default)]
pub struct PassthroughProofEncryption;

#[async_trait]
impl ProofEncryption for PassthroughProofEncryption {
    async fn encrypt(&self, plaintext: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        Ok(plaintext.to_vec())
    }
    async fn decrypt(&self, ciphertext: &[u8]) -> Result<Vec<u8>, EncryptionError> {
        Ok(ciphertext.to_vec())
    }
}
```

- [ ] **Step 3:** Wire into `crates/agicash-traits/src/lib.rs`:

```rust
pub mod proof_encryption;
pub use proof_encryption::*;
```

- [ ] **Step 4:** Unit test the passthrough round-trip (encrypt then decrypt yields original bytes).

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(traits): add ProofEncryption trait + passthrough stub for slice 5`

---

## Task 3: `CashuReceiveSwapStorage` trait

**Goal:** Storage trait for receive-swap CRUD. Matches TS `CashuReceiveSwapRepository` shape. Three operations: `create`, `complete`, `fail`. All hit the existing DB RPCs (`create_cashu_receive_swap`, `complete_cashu_receive_swap`, `fail_cashu_receive_swap`).

**Files:**
- Create: `crates/agicash-traits/src/cashu_receive_swap_storage.rs`
- Modify: `crates/agicash-traits/src/lib.rs`

### Steps

- [ ] **Step 1:** Read `cashu-receive-swap-repository.ts` end-to-end. Capture:
  - `create` input shape (token, userId, accountId, keysetId, inputAmount, cashuReceiveFee, receiveAmount, outputAmounts, reversedTransactionId?)
  - `create` returns `{ swap, account }` — what account fields are needed
  - `complete` input shape (tokenHash, userId, proofs — with field-level encryption of amount + secret)
  - `complete` returns `{ swap, account, addedProofs }`
  - `fail` input shape (tokenHash, userId, reason)
  - The `UniqueConstraintError` mapping for duplicate token claims (error code 23505)

- [ ] **Step 2:** Find the DB RPC definitions in `supabase/migrations/` to confirm exact parameter names and return shapes:
  ```
  grep -r "create_cashu_receive_swap\|complete_cashu_receive_swap\|fail_cashu_receive_swap" /Users/claude/agicash/supabase/migrations/
  ```

- [ ] **Step 3:** Create `crates/agicash-traits/src/cashu_receive_swap_storage.rs`:

```rust
use async_trait::async_trait;
use uuid::Uuid;
use agicash_domain::{Account, AccountId, CashuReceiveSwap, Money, TokenProof, UserId};

#[async_trait]
pub trait CashuReceiveSwapStorage: Send + Sync {
    /// Create a new receive swap row + reserve a keyset counter range on the account.
    /// Returns the swap (in PENDING state) and the updated account.
    ///
    /// Returns AlreadyClaimed if a swap with the same token_hash already exists.
    async fn create(
        &self,
        input: CreateReceiveSwap,
    ) -> Result<CreateReceiveSwapResult, ReceiveSwapStorageError>;

    /// Complete a PENDING receive swap: store the new proofs and transition to COMPLETED.
    /// Idempotent on COMPLETED state.
    async fn complete(
        &self,
        token_hash: &str,
        user_id: UserId,
        proofs: Vec<TokenProof>,
    ) -> Result<CompleteReceiveSwapResult, ReceiveSwapStorageError>;

    /// Fail a PENDING receive swap. Idempotent on FAILED state. Rejects if COMPLETED.
    async fn fail(
        &self,
        token_hash: &str,
        user_id: UserId,
        reason: &str,
    ) -> Result<CashuReceiveSwap, ReceiveSwapStorageError>;
}

#[derive(Debug, Clone)]
pub struct CreateReceiveSwap {
    pub token_hash: String,
    pub token_proofs: Vec<TokenProof>,
    pub token_mint_url: String,
    pub token_description: Option<String>,
    pub user_id: UserId,
    pub account_id: AccountId,
    pub keyset_id: String,
    pub input_amount: Money,
    pub fee_amount: Money,
    pub amount_received: Money,
    pub output_amounts: Vec<u64>,
    pub reversed_transaction_id: Option<Uuid>,
}

#[derive(Debug, Clone)]
pub struct CreateReceiveSwapResult {
    pub swap: CashuReceiveSwap,
    pub account: Account,
}

#[derive(Debug, Clone)]
pub struct CompleteReceiveSwapResult {
    pub swap: CashuReceiveSwap,
    pub account: Account,
    pub added_proofs: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum ReceiveSwapStorageError {
    #[error("token already claimed")]
    AlreadyClaimed,
    #[error("not found")]
    NotFound,
    #[error("invalid state transition: {0}")]
    InvalidState(String),
    #[error("storage backend error: {0}")]
    Backend(String),
    #[error("encryption error: {0}")]
    Encryption(#[from] agicash_traits::EncryptionError),  // adjust path if cycle
}
```

**Notes:**
- The encryption layer is HIDDEN inside the storage impl (slice 5's passthrough is opaque). The trait surface stays plaintext.
- `Account` return — slice 3 has `Account` in `agicash-domain`. After receive completes, the account row's `details.proofs` should be updated to include the new proofs. The storage impl handles encryption inline.

- [ ] **Step 4:** Wire into `crates/agicash-traits/src/lib.rs`:

```rust
pub mod cashu_receive_swap_storage;
pub use cashu_receive_swap_storage::*;
```

- [ ] **Step 5:** Compile-only test (variants construct, no behavior yet).

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(traits): add CashuReceiveSwapStorage trait + DTOs`

---

## Task 4: Sans-IO state machine in `agicash-cashu`

**Goal:** Implement the receive-swap state transitions as a pure sans-IO state machine. No async, no network, no DB. The state machine **describes** the next action; the executor (Task 6) performs it.

**Files:**
- Create: `crates/agicash-cashu/src/receive_swap/mod.rs`
- Create: `crates/agicash-cashu/src/receive_swap/state.rs`
- Create: `crates/agicash-cashu/src/receive_swap/error.rs`
- Modify: `crates/agicash-cashu/src/lib.rs`

### Steps

- [ ] **Step 1:** Design the state-machine type. Three states from domain (Pending, Completed, Failed) — same as TS. Plus a "starting" pseudo-state representing "we have a token but haven't created the swap yet."

```rust
// crates/agicash-cashu/src/receive_swap/state.rs

use agicash_domain::{CashuReceiveSwap, CashuReceiveSwapState};

/// Drives a receive-swap forward. The executor consumes Action values
/// and produces Event values to advance state.
pub struct ReceiveSwapMachine {
    state: MachineState,
}

#[derive(Debug, Clone)]
enum MachineState {
    /// Token parsed, account selected, but no DB row yet.
    NotStarted,
    /// Swap row exists, mint swap is the next step.
    Pending(CashuReceiveSwap),
    /// Swap and proofs persisted.
    Completed(CashuReceiveSwap),
    /// Swap failed; reason recorded.
    Failed(CashuReceiveSwap),
}

#[derive(Debug, Clone)]
pub enum Action {
    /// Persist the swap row, reserve keyset counters.
    CreateSwap,
    /// Call mint's /v1/swap endpoint with the prepared blinded messages.
    SwapWithMint {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Persist resulting proofs and mark COMPLETED.
    CompleteSwap { proofs_count: usize },
    /// Mark FAILED with reason (e.g. token already spent).
    FailSwap { reason: String },
    /// Terminal — nothing more to do.
    None,
}

#[derive(Debug, Clone)]
pub enum Event {
    /// Storage created the swap row (returns the persisted entity).
    SwapCreated(CashuReceiveSwap),
    /// Mint returned proofs successfully.
    MintSwapSucceeded,
    /// Mint rejected with "already spent" or output already signed.
    /// Executor should attempt restore; if restore yields 0 proofs → already claimed.
    MintSwapAlreadyClaimed,
    /// Restore yielded proofs we can use (mint failed but we have signatures).
    MintRestoreSucceeded,
    /// Storage stored proofs and updated state.
    SwapCompleted(CashuReceiveSwap),
    /// Storage transitioned to FAILED.
    SwapFailed(CashuReceiveSwap),
}

impl ReceiveSwapMachine {
    pub fn new() -> Self { Self { state: MachineState::NotStarted } }
    pub fn from_existing(swap: CashuReceiveSwap) -> Self {
        let state = match &swap.state {
            CashuReceiveSwapState::Pending => MachineState::Pending(swap),
            CashuReceiveSwapState::Completed => MachineState::Completed(swap),
            CashuReceiveSwapState::Failed { .. } => MachineState::Failed(swap),
        };
        Self { state }
    }

    /// Returns the next action the executor should take.
    pub fn next_action(&self) -> Action { /* match on state */ }

    /// Apply an event; returns whether state changed.
    pub fn apply(&mut self, event: Event) -> Result<(), ReceiveSwapError> { /* state transitions */ }

    pub fn state(&self) -> &MachineState { &self.state }
    pub fn is_terminal(&self) -> bool {
        matches!(self.state, MachineState::Completed(_) | MachineState::Failed(_))
    }
}
```

- [ ] **Step 2:** Implement `next_action` and `apply` per the state diagram:

```
NotStarted ──CreateSwap──> SwapCreated ──> Pending
Pending ──SwapWithMint──> MintSwapSucceeded ──> [internal] proofs ready
                       │
                       └─MintSwapAlreadyClaimed──> [executor attempts restore]
                                              │
                                              ├─MintRestoreSucceeded──> [internal] proofs ready
                                              └─else: FailSwap("already claimed")
Pending + proofs ready ──CompleteSwap──> SwapCompleted ──> Completed (terminal)
Pending ──FailSwap(reason)──> SwapFailed ──> Failed (terminal)
```

- [ ] **Step 3:** Unit tests for every transition. Cover:
  - Happy path: NotStarted → CreateSwap → SwapCreated → SwapWithMint → MintSwapSucceeded → CompleteSwap → SwapCompleted.
  - Already-claimed path: same up to SwapWithMint → MintSwapAlreadyClaimed → restore yields nothing → FailSwap.
  - Restored-proofs path: SwapWithMint → MintSwapAlreadyClaimed → MintRestoreSucceeded → CompleteSwap.
  - Invalid transitions panic / return error (e.g. CompleteSwap before SwapCreated).
  - `from_existing(COMPLETED swap).is_terminal() == true`.

These tests run with `cargo test -p agicash-cashu` — **no network, no async**.

- [ ] **Step 4:** Create `error.rs`:

```rust
#[derive(Debug, thiserror::Error)]
pub enum ReceiveSwapError {
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },
    #[error("storage error: {0}")]
    Storage(#[from] agicash_traits::ReceiveSwapStorageError),
    #[error("mint error: {0}")]
    Mint(#[from] agicash_traits::CashuProviderError),
    #[error("token parse error: {0}")]
    TokenParse(String),
    #[error("amount too small after fees")]
    AmountTooSmall,
    #[error("mint URL mismatch: token mint {token} differs from account mint {account}")]
    MintMismatch { token: String, account: String },
    #[error("currency mismatch: token currency {token} differs from account currency {account}")]
    CurrencyMismatch { token: String, account: String },
}
```

- [ ] **Step 5:** Wire into `agicash-cashu/src/lib.rs`:

```rust
pub mod receive_swap;
pub use receive_swap::{ReceiveSwapMachine, Action, Event, ReceiveSwapError};
```

And `receive_swap/mod.rs`:

```rust
pub mod state;
pub mod error;
pub mod service;  // added in Task 5

pub use state::*;
pub use error::*;
pub use service::*;
```

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cashu): sans-IO state machine for receive swap`

---

## Task 5: `CashuReceiveSwapService` (orchestrator)

**Goal:** Stateful orchestrator that drives `ReceiveSwapMachine` forward by performing the I/O for each `Action`. Mirrors TS `CashuReceiveSwapService` — same method shapes (`create`, `complete_swap`, `fail`).

**Files:**
- Create: `crates/agicash-cashu/src/receive_swap/service.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-receive-swap-service.ts` lines 23-205 (the `create`, `fail`, `completeSwap`, `swapProofs` methods). Note the error handling for `TOKEN_ALREADY_CLAIMED` and the `wallet.restore` fallback.

- [ ] **Step 2:** Implement:

```rust
// crates/agicash-cashu/src/receive_swap/service.rs

use std::sync::Arc;
use agicash_domain::{Account, AccountId, CashuReceiveSwap, Money, TokenProof, UserId};
use agicash_traits::{
    CashuProvider, CashuReceiveSwapStorage, CreateReceiveSwap, CreateReceiveSwapResult,
};
use crate::receive_swap::{Action, Event, ReceiveSwapError, ReceiveSwapMachine};

pub struct CashuReceiveSwapService {
    storage: Arc<dyn CashuReceiveSwapStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl CashuReceiveSwapService {
    pub fn new(
        storage: Arc<dyn CashuReceiveSwapStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self { storage, cashu_provider }
    }

    /// Start receiving a token. Validates, creates swap row, returns PENDING swap.
    pub async fn create(
        &self,
        user_id: UserId,
        token: ParsedToken,
        account: &Account,
    ) -> Result<CreateReceiveSwapResult, ReceiveSwapError> {
        // Validate token.mint matches account.details.mint_url.
        // Validate token currency matches account.currency.
        // Compute input_amount, fee_amount, amount_received via cdk fee calculation.
        // Build CreateReceiveSwap input.
        // Call storage.create().
        // Map UniqueConstraintError → ReceiveSwapStorageError::AlreadyClaimed.
        // Bubble up.
    }

    /// Drive a PENDING swap to completion via the mint.
    /// Idempotent on COMPLETED/FAILED.
    pub async fn complete_swap(
        &self,
        account: &Account,
        swap: CashuReceiveSwap,
    ) -> Result<CompleteOutcome, ReceiveSwapError> {
        let mut machine = ReceiveSwapMachine::from_existing(swap.clone());
        if machine.is_terminal() {
            return Ok(CompleteOutcome::AlreadyTerminal(swap));
        }
        // Drive forward:
        //   action = next_action()
        //   match action:
        //     SwapWithMint{..} -> call wallet.swap (CDK), apply Event::MintSwapSucceeded
        //                       -> on already-spent/output-already-signed: attempt restore
        //                          -> if restore yields 0 proofs: apply Event::MintSwapAlreadyClaimed + fail
        //                          -> else: apply Event::MintRestoreSucceeded
        //     CompleteSwap{..} -> storage.complete(token_hash, user_id, proofs) -> apply Event::SwapCompleted
        //     FailSwap{reason} -> storage.fail(token_hash, user_id, &reason) -> apply Event::SwapFailed
        //     None -> exit
        // Return CompleteOutcome::Done(updated_swap, updated_account, added_proofs).
    }

    pub async fn fail(
        &self,
        swap: &CashuReceiveSwap,
        reason: &str,
    ) -> Result<CashuReceiveSwap, ReceiveSwapError> {
        // Match TS: no-op on FAILED, error on non-PENDING.
    }
}

pub enum CompleteOutcome {
    Done {
        swap: CashuReceiveSwap,
        account: Account,
        added_proofs: Vec<String>,
    },
    AlreadyTerminal(CashuReceiveSwap),
}

/// Wrapper around a CDK Token after parsing.
pub struct ParsedToken {
    pub raw: String,
    pub mint_url: String,
    pub proofs: Vec<TokenProof>,
    pub memo: Option<String>,
    pub unit: String,  // "sat", "msat", etc.
}

impl ParsedToken {
    /// Parse a Cashu token string (V3 cashuA... or V4 cashuB... CBOR).
    /// Delegate to CDK's parser; map errors.
    pub fn parse(raw: &str) -> Result<Self, ReceiveSwapError> {
        // cdk::nuts::Token::from_str or cdk::wallet::token::Token::decode
        // — verify exact API by reading CDK source.
        // Convert to our ParsedToken shape.
    }
}
```

**Notes:**
- The actual CDK call (`wallet.swap` equivalent) is what differs from slice 4. CDK's `MintConnector::post_swap` takes blinded messages and returns blinded signatures. The service needs to:
  1. Compute output blinded messages from `(amount_received, keyset, counter, seed)` — CDK has `PreMintSecrets::with_counter` for this.
  2. Call `connector.post_swap(SwapRequest { inputs: token_proofs, outputs: blinded_messages })`.
  3. Unblind the signatures into proofs via CDK's `construct_proofs`.
- The seed for `PreMintSecrets` is derived from the user's BIP39 mnemonic via Open Secret. **For slice 5, where do we get the seed from?** TS uses `wallet.seed` which comes from `getInitializedCashuWallet`. In Rust, the seed is held by `OpenSecretClient`. Add a method to `OpenSecretClient` or `OpenSecretTokenProvider` that exposes the seed bytes? Or thread it through `CashuMintWallet`? **Open question — see end of plan.**
- `wallet.restore` (the TS fallback when mint says "already signed") corresponds to CDK's `MintConnector::post_restore`. Wire the same fallback logic.

- [ ] **Step 3:** Unit tests for the service that **don't hit network**:
  - `create` rejects mint URL mismatch.
  - `create` rejects currency mismatch.
  - `create` rejects token too small after fees.
  - `fail` is no-op on already-failed swap.
  - `fail` errors on COMPLETED swap.

The network-dependent paths (`complete_swap` with real mint) are covered by Task 8 integration test, not here.

- [ ] **Step 4:** Clippy + fmt clean.

- [ ] **Step 5: Commit** — `feat(cashu): CashuReceiveSwapService orchestrator with CDK swap + restore fallback`

---

## Task 6: Supabase impl of `CashuReceiveSwapStorage`

**Goal:** Postgrest-backed impl mirroring the TS repository. Calls `create_cashu_receive_swap`, `complete_cashu_receive_swap`, `fail_cashu_receive_swap` RPCs.

**Files:**
- Create: `crates/agicash-storage-supabase/src/cashu_receive_swap_storage.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

### Steps

- [ ] **Step 1:** Read TS `cashu-receive-swap-repository.ts` end-to-end. Note the exact RPC parameter names, the encryption seam (encryption happens INSIDE the repo before the RPC call), the `UniqueConstraintError` mapping for `error.code === '23505'`, and how proofs are field-encrypted on `complete` (amount + secret separately, batched).

- [ ] **Step 2:** Implement the storage impl. It takes `Arc<dyn ProofEncryption>` as a dep; for slice 5 it'll be `PassthroughProofEncryption`. The impl serializes/deserializes JSON for the encrypted blobs.

```rust
pub struct SupabaseCashuReceiveSwapStorage {
    client: postgrest::Postgrest,
    encryption: Arc<dyn ProofEncryption>,
}

#[async_trait]
impl CashuReceiveSwapStorage for SupabaseCashuReceiveSwapStorage {
    async fn create(&self, input: CreateReceiveSwap) -> Result<CreateReceiveSwapResult, ReceiveSwapStorageError> {
        let receive_data = json!({
            "tokenMintUrl": input.token_mint_url,
            "tokenAmount": input.input_amount,
            "tokenProofs": input.token_proofs,
            "tokenDescription": input.token_description,
            "amountReceived": input.amount_received,
            "outputAmounts": input.output_amounts,
            "cashuReceiveFee": input.fee_amount,
        });
        let encrypted_data = self.encryption.encrypt(&serde_json::to_vec(&receive_data)?).await?;

        let response = self.client.rpc("create_cashu_receive_swap", json!({
            "p_token_hash": input.token_hash,
            "p_account_id": input.account_id,
            "p_user_id": input.user_id,
            "p_currency": input.amount_received.currency,
            "p_keyset_id": input.keyset_id,
            "p_number_of_outputs": input.output_amounts.len(),
            "p_encrypted_data": base64::encode(&encrypted_data),
            "p_reversed_transaction_id": input.reversed_transaction_id,
        })).execute().await?;

        // Map 23505 → AlreadyClaimed
        // Parse response { swap, account } → CashuReceiveSwap + Account
    }

    async fn complete(&self, token_hash: &str, user_id: UserId, proofs: Vec<TokenProof>) -> Result<CompleteReceiveSwapResult, ReceiveSwapStorageError> {
        // Field-encrypt each proof's amount + secret in batch (TS uses encryptBatch).
        // Build the encrypted_proofs JSON array.
        // Call complete_cashu_receive_swap RPC.
        // Parse response.
    }

    async fn fail(&self, token_hash: &str, user_id: UserId, reason: &str) -> Result<CashuReceiveSwap, ReceiveSwapStorageError> {
        // Simple RPC call to fail_cashu_receive_swap.
    }
}
```

**Notes:**
- TS uses `encryption.encryptBatch` for the proofs (each amount + secret is a separate ciphertext to enable selective decryption). The Rust trait doesn't yet have a batch method. Either:
  - (a) Add `encrypt_batch(items: &[&[u8]]) -> Result<Vec<Vec<u8>>>` to the trait now.
  - (b) Use plain `encrypt` in a loop for slice 5 — slower but works.
  Pick (b) for now (slice 5 is single-token); flag (a) as a future addition when real encryption arrives.
- `base64::encode` — confirm whether postgrest's bytea param wants base64 or raw bytes. Read existing slice-3 storage code (`crates/agicash-storage-supabase/`) for the established pattern.

- [ ] **Step 3:** Integration tests gated behind `real-supabase-tests`:
  - `create` then `fail` → swap goes PENDING → FAILED.
  - `create` then `complete` with a fake proof list → swap goes PENDING → COMPLETED, account.details.proofs grows.
  - Duplicate `create` with same token_hash → `AlreadyClaimed`.

These tests use the service-role-key path (same pattern as slice 3 storage integration tests — those don't exercise auth chain, just storage).

- [ ] **Step 4:** Wire into `agicash-storage-supabase/src/lib.rs`.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(storage-supabase): postgrest impl for CashuReceiveSwapStorage`

---

## Task 7: CLI command `agicash receive <token>`

**Goal:** Wire the receive flow to the CLI.

**Files:**
- Modify: `crates/agicash-cli/src/cli.rs`
- Modify: `crates/agicash-cli/src/composition.rs`
- Create: `crates/agicash-cli/src/receive.rs`
- Modify: `crates/agicash-cli/src/main.rs`

### Steps

- [ ] **Step 1:** Add `Receive { token: String }` to the `Command` enum in `cli.rs`.

- [ ] **Step 2:** In `composition.rs`, add `ReceiveSwapDeps`:

```rust
pub struct ReceiveSwapDeps {
    pub service: Arc<CashuReceiveSwapService>,
    pub storage: Arc<dyn CashuReceiveSwapStorage>,
}

pub fn build_receive_swap_deps(
    auth_deps: &AuthDeps,
    cashu_deps: &CashuDeps,
) -> Result<ReceiveSwapDeps, Error> {
    let encryption = Arc::new(PassthroughProofEncryption);
    let storage = Arc::new(SupabaseCashuReceiveSwapStorage::new(
        /* postgrest client from auth_deps.token_provider */,
        encryption,
    ));
    let service = Arc::new(CashuReceiveSwapService::new(
        storage.clone(),
        Arc::new(cashu_deps.provider.clone()),
    ));
    Ok(ReceiveSwapDeps { service, storage })
}
```

- [ ] **Step 3:** Implement `cmd_receive` in `receive.rs`:

```rust
pub async fn cmd_receive(
    auth_deps: &AuthDeps,
    storage_deps: &StorageDeps,
    receive_deps: &ReceiveSwapDeps,
    token_str: &str,
) -> Result<(), ReceiveCmdError> {
    // 1. Load session — error NotLoggedIn if absent.
    // 2. Parse token via ParsedToken::parse(token_str).
    // 3. List user accounts; find the one whose details.mint_url matches token.mint_url AND currency matches.
    //    - If none: error "no matching account, run `agicash mint add <url>` first"
    // 4. Call receive_deps.service.create(user_id, parsed_token, &account).await
    //    - If AlreadyClaimed: emit JSON {"status":"already-claimed","token_hash":"..."} and exit 0 (informational success).
    // 5. Drive to completion: receive_deps.service.complete_swap(&account, swap).await
    //    - Match outcome.
    // 6. Print JSON: {"status":"received","amount":"<sats>","fee":"<sats>","account_id":"...","mint_url":"...","token_hash":"..."}
    // 7. Error JSON via the standard error pipeline.
}

#[derive(Debug, thiserror::Error)]
pub enum ReceiveCmdError {
    #[error("not logged in")]
    NotLoggedIn,
    #[error("invalid token: {0}")]
    InvalidToken(String),
    #[error("no matching account for mint {0} — run `agicash mint add` first")]
    NoMatchingAccount(String),
    #[error(transparent)]
    Receive(#[from] ReceiveSwapError),
    #[error(transparent)]
    Storage(#[from] agicash_traits::StorageError),
    #[error(transparent)]
    Auth(#[from] agicash_traits::AuthError),
}
```

- [ ] **Step 4:** Dispatch in `main.rs`:

```rust
Some(Command::Receive { token }) => {
    let storage_deps = build_storage_deps(&auth_deps)?;
    let cashu_deps = build_cashu_deps();
    let receive_deps = build_receive_swap_deps(&auth_deps, &cashu_deps)?;
    receive::cmd_receive(&auth_deps, &storage_deps, &receive_deps, &token).await?;
}
```

Add `ReceiveCmdError` to `classify_error` with stable kebab-case codes: `not-logged-in`, `invalid-token`, `no-matching-account`, `mint-unreachable`, `mint-error`, `amount-too-small`, `mint-mismatch`, `currency-mismatch`, `already-claimed`, etc.

- [ ] **Step 5:** Smoke test by hand: `cargo run -p agicash-cli -- receive --help` shows usage with JSON output.

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cli): add 'agicash receive <token>' command`

---

## Task 8: Integration test against real mint

**Goal:** End-to-end test: mint a fresh test token via testnut.cashu.space, claim it via `agicash receive`, verify `agicash balance` shows the claimed amount.

**Files:**
- Create: `crates/agicash-cli/tests/receive.rs`

### Steps

- [ ] **Step 1:** Investigate how to mint a test token from testnut without going through a real Lightning quote dance. Options:
  - **Testnut faucet**: `https://testnut.cashu.space/` may expose a faucet endpoint or web UI. Check `https://testnut.cashu.space/` and document.
  - **Use the receive-quote pathway**: testnut accepts test "Lightning" invoices that auto-settle. We'd need a brief quote-and-claim flow first.
  - **Pre-generated test tokens**: include a small fixed test token in the test fixtures, ALONG WITH a comment that says "if testnut rotates its keyset, regenerate this token by running X."
  
  Most robust path: implement a small helper in the test that uses CDK directly to mint a test token (testnut accepts test mint quotes — verify CDK's testing pattern).

- [ ] **Step 2:** Write the test gated behind `real-mint-tests,real-supabase-tests,real-opensecret-tests`:

```rust
#[cfg(all(feature = "real-mint-tests", feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod tests {
    use assert_cmd::Command;
    use predicates::prelude::*;

    #[test]
    fn receive_token_increments_balance() {
        let _ = dotenvy::dotenv();

        // 1. auth guest
        Command::cargo_bin("agicash").unwrap()
            .args(["auth", "guest"]).assert().success();

        // 2. mint add testnut
        Command::cargo_bin("agicash").unwrap()
            .args(["mint", "add", "https://testnut.cashu.space"])
            .assert().success();

        // 3. Mint a test token (via helper or pre-generated).
        let token_str = mint_test_token_via_testnut(100).expect("mint test token");

        // 4. agicash receive <token>
        Command::cargo_bin("agicash").unwrap()
            .args(["receive", &token_str])
            .assert().success()
            .stdout(predicate::str::contains(r#""status":"received""#))
            .stdout(predicate::str::contains(r#""amount":"#));

        // 5. agicash balance shows > 0
        let output = Command::cargo_bin("agicash").unwrap()
            .arg("balance").output().expect("balance command");
        let stdout = String::from_utf8_lossy(&output.stdout);
        let balances: serde_json::Value = serde_json::from_str(&stdout).unwrap();
        let testnut_balance = balances.as_array().unwrap().iter()
            .find(|a| a["mint_url"].as_str().unwrap().contains("testnut"))
            .expect("testnut account");
        assert!(testnut_balance["balance"].as_str().unwrap() != "0",
            "balance should be > 0 after receive: {balances}");
    }

    #[test]
    fn receive_same_token_twice_is_already_claimed() {
        // Same flow; second receive emits {"status":"already-claimed"} with exit 0.
    }

    #[test]
    fn receive_token_for_unknown_mint_fails() {
        // Don't add the mint; attempt receive; expect no-matching-account error.
    }
}
```

- [ ] **Step 3:** Run: `cargo test -p agicash-cli --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test receive -- --nocapture`. PASS.

- [ ] **Step 4: Commit** — `test(cli): integration test for receive-token flow against real testnut`

---

## Task 9: Final verification — slice 5 test bar

- [ ] `cargo build --workspace` clean (zero warnings)
- [ ] `cargo test --workspace` green (prior + new unit tests)
- [ ] `cargo clippy --workspace --all-targets --features real-supabase-tests,real-opensecret-tests,real-mint-tests,real-rate-tests -- -D warnings` clean
- [ ] `cargo fmt --all --check` clean
- [ ] `cargo test -p agicash-cashu` — state-machine unit tests pass (no network)
- [ ] `cargo test -p agicash-storage-supabase --features real-supabase-tests` — storage tests pass
- [ ] `cargo test -p agicash-cli --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test receive -- --nocapture` — e2e passes
- [ ] `cargo tree -p agicash-wasm | grep agicash-cashu` empty
- [ ] Smoke: `agicash receive --help` shows JSON-style usage; `agicash receive cashuA...invalid` emits a JSON error to stderr with stable code

---

## Open questions for operator

1. **Where does the user's seed come from?** TS's `wallet.seed` is derived from Open Secret. In Rust we have `OpenSecretClient` but no exposed seed getter. Three options: (a) add `inner().get_seed()` method to the slice-2 opensecret wrapper, (b) thread a `SeedProvider` trait through composition, (c) derive a per-mint seed in `CashuMintWallet` via key-derivation from the auth context. **Recommend (a) — smallest change, mirrors the TS shape.** Confirm before Task 5 implements `PreMintSecrets`.

2. **Should `encrypt_batch` be added to the `ProofEncryption` trait now?** TS uses batch encryption for per-proof field encryption. Slice 5 uses passthrough so the loop-vs-batch distinction is irrelevant. But when real encryption lands, batch matters for performance. **Recommend: defer to the real-encryption slice.**

3. **Token format support.** TS supports V3 (legacy) and V4 (CBOR) tokens. CDK supports both. **Confirm: `cdk::nuts::Token::from_str` handles both transparently.** Verify by reading CDK source before Task 5.

4. **Pre-commit hooks.** Slice 4 cleanup used `PREK_ALLOW_NO_CONFIG=1` because the worktree didn't have the `.pre-commit-config.yaml` symlink. Slice 5 worktree will be branched off slice 4; same workaround applies. The `chore/rust-aware-hooks` branch (off master, `c8c699f8`) is not yet integrated. **Acceptable to continue using `PREK_ALLOW_NO_CONFIG=1` for slice 5 commits — flag in commit message footers if used.**

---

## Notes for the executor

- The state machine **must** be unit-testable without network — that's the whole point of sans-IO. If you find yourself reaching for tokio in `state.rs`, you've made a mistake.
- The orchestrator (`service.rs`) is what holds the async I/O. The state machine is pure.
- TS uses `wallet.ops.receive(...).asCustom(outputData).run()` — that's the CDK call. CDK 0.15's equivalent is the `Wallet::send` / `Wallet::receive` method or a direct `MintConnector::post_swap`. **Read the CDK wallet source to find the right entry point.** Slice 4 wired `CashuMintWallet` to expose `connector()` — use that.
- The DB RPC parameter names in the TS repo are authoritative — if a Rust JSON serializer renames a field, the RPC will silently fail. Match exactly.
- Don't try to wire real encryption in this slice. Passthrough. The trait shape is what matters.
- If you hit "where does the seed come from" in Task 5, halt and ask before inventing. This is Open Question 1.
