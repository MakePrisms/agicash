# Slice 7 — Cashu Lightning Receive

> **For executor:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Walk through tasks one at a time, committing per the plan's checkpoints. Read TS source first. Mirror slice 5 (receive-swap) closely — same structure, different semantics (NUT-04 mint quote instead of NUT-03 swap).

**Goal:** Implement `agicash receive lightning <amount> [--account <id>]` — request a NUT-04 mint quote from a Cashu mint, return the resulting BOLT-11 invoice to the user, poll until the mint reports `state == PAID`, then mint the proofs (with `wallet.restore` fallback on `QUOTE_ALREADY_ISSUED` / `OUTPUT_ALREADY_SIGNED`), and persist them against the account. After this slice, a user can ask the wallet for an invoice that, once paid externally, settles into balance with no further intervention.

**Non-goals:**
- **Cross-account / CASHU_TOKEN-typed receive quotes** (the TS `CASHU_TOKEN` quote subtype which melts proofs from one mint to fund a receive on another). Future slice.
- **NUT-20 locked quotes.** TS uses `createLockedMintQuote(amount, lockingPublicKey)` with a BIP-32 derived locking key from Open Secret. Slice 7 issues *unlocked* mint quotes (`pubkey: None`). NUT-20 is a security upgrade we layer on once the basic flow is alive; the surface stays compatible.
- **Real client-side encryption** — slice 7 reuses slice 5's passthrough `ProofEncryption`. Real ECIES lands later.
- **Quote-expiry watcher / EXPIRED transitions.** TS has a periodic task that calls `expire_cashu_receive_quote` after the invoice expiry. Slice 7 exposes `expire` on the storage trait + service so a future watcher can call it; the CLI does not.
- **`agicash receive` on a Spark account.** Spark Lightning send/receive is slice 10. Slice 7 only routes to Cashu accounts.
- **Cross-currency.** Mint quotes are requested in the account's native unit (`sat` for BTC, `usd` for USD). No FX in this slice.

**Branch:** `feat/rust-cashu-lightning-receive` off `feat/rust-cashu-send`, worktree at `~/agicash/.claude/worktrees/rust-lightning-receive`. Executor creates the worktree before starting (the operator dispatched it already; verify presence).

**Operator principles (override defaults):**
1. **TS code is the blueprint.** Read `app/features/receive/cashu-receive-quote*.ts` end-to-end. Port APIs faithfully; deviate only where Rust ownership/async forces it or where slice 7 explicitly omits TS scope (notably NUT-20 + CASHU_TOKEN).
2. **WASM still the goal.** Sans-IO state machine in `agicash-cashu`, native-TLS executor stays out of `agicash-wasm`.
3. **Goal: cross-environment same-wallet.** Not full TS-app feature parity.
4. **No mocking in integration tests.** Real testnut.cashu.space mint, real local Supabase, real local OpenSecret. testnut's fakewallet auto-pays mint-quote invoices.
5. **JSON-default CLI output**, stable kebab-case error codes on stderr.

---

## WASM compatibility flag

- State machine in `agicash-cashu/src/mint_quote/state.rs` is **sans-IO** — pure state transitions. Compiles to wasm trivially.
- Executor (`mint_quote/service.rs`) uses CDK which carries native-TLS reqwest — stays out of `agicash-wasm`.
- `ProofEncryption` trait reused; passthrough impl reused.
- Integration tests are real-network and CLI-shaped — not run on wasm.

Verify after slice: `cargo tree -p agicash-wasm | grep agicash-cashu` empty.

---

## Reference materials

| What | Path |
|------|------|
| Spec | `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` — note: the spec's "step 5" matches this slice; the executor delivered token receive/send earlier (now slice 5 = receive-token, slice 6 = send-token, slice 7 = lightning receive). |
| Process | `~/athanor/projects/agicash-rust/PROCESS.md` |
| State | `~/athanor/projects/agicash-rust/STATE.md` |
| Slice 5 plan (mirror structure) | `docs/superpowers/plans/2026-05-15-rust-cashu-receive-token.md` |
| Slice 6 plan (mirror structure) | `docs/superpowers/plans/2026-05-15-rust-cashu-send-token.md` |
| **TS service** | `app/features/receive/cashu-receive-quote-service.ts` |
| **TS core helpers** | `app/features/receive/cashu-receive-quote-core.ts` |
| **TS domain** | `app/features/receive/cashu-receive-quote.ts` |
| **TS repository** | `app/features/receive/cashu-receive-quote-repository.ts` |
| TS DB schema | `supabase/migrations/20260112150000_initial_db.sql` lines 1053-1491 (`create_cashu_receive_quote`, `process_cashu_receive_quote_payment`, `complete_cashu_receive_quote`, `expire_cashu_receive_quote`, `fail_cashu_receive_quote`, `mark_cashu_receive_quote_cashu_token_melt_initiated`); purpose/transfer_id additions in `20260306120000_add_transaction_purpose_and_transfer_id.sql`; state guard fix in `20260422142259_fix_fail_cashu_receive_quote_state_guard.sql`. |
| Slice 5 service (canonical pattern) | `crates/agicash-cashu/src/receive_swap/service.rs` |
| Slice 5 storage impl (canonical pattern) | `crates/agicash-storage-supabase/src/cashu_receive_swap_storage.rs` |
| CDK NUT-23/NUT-04 types | `cashu-0.15.1/src/nuts/nut23.rs` (`MintQuoteBolt11Request`, `MintQuoteBolt11Response<Q>`, `QuoteState::{Unpaid, Paid, Issued}`) |
| CDK mint connector | `cdk-0.15.1/src/wallet/mint_connector/mod.rs` (`post_mint_quote`, `get_mint_quote_status`, `post_mint`) |
| Cashu protocol NUT-04 | <https://github.com/cashubtc/nuts/blob/main/04.md> |
| Slice 5 integration test (helper to crib) | `crates/agicash-cli/tests/receive.rs` — `mint_test_token_via_testnut` ALREADY runs the full quote→mint flow against testnut. Slice 7's test is the same flow expressed through the CLI. |

---

## File structure (NEW files)

```
crates/
├── agicash-cashu/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire mint_quote module
│       └── mint_quote/
│           ├── mod.rs                            # NEW
│           ├── types.rs                          # NEW — CashuMintQuote + State enum
│           ├── storage.rs                        # NEW — CashuMintQuoteStorage trait + DTOs
│           ├── state.rs                          # NEW — sans-IO state machine
│           ├── error.rs                          # NEW — MintQuoteError
│           └── service.rs                        # NEW — CashuMintQuoteService (orchestrator)
├── agicash-storage-supabase/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire new module
│       └── cashu_mint_quote_storage.rs           # NEW — postgrest impl
├── agicash-cli/
│   ├── Cargo.toml                                # MODIFY (no new deps expected)
│   └── src/
│       ├── cli.rs                                # MODIFY — Receive becomes a subcommand group (Token { token } | Lightning { amount, .. })
│       ├── composition.rs                        # MODIFY — wire MintQuote deps
│       ├── main.rs                               # MODIFY — dispatch Receive::Lightning
│       └── receive_lightning.rs                  # NEW — cmd_receive_lightning
└── agicash-cli/tests/
    └── receive_lightning.rs                      # NEW — integration test
```

**Compatibility note on CLI:** slice 5 wired `agicash receive <token>` as a single positional. Slice 7 turns `receive` into a subcommand group so both flows coexist: `agicash receive token <token>` and `agicash receive lightning <amount>`. Keep `agicash receive <token>` working as a deprecated alias (clap default subcommand) **only if free**; if it forces extra wiring, just rename — the only tests we have are this crate's own and the migration is mechanical. Plan assumes rename; flag for operator if a deprecation alias is desired.

---

## Task 1: Domain — `CashuMintQuote` + state

**Goal:** Add `CashuMintQuote` struct + `CashuMintQuoteState` enum to `agicash-cashu::mint_quote`. Match TS schema in `cashu-receive-quote.ts` exactly, **omitting** the CASHU_TOKEN-typed branch (`tokenReceiveData`) per non-goals.

**Files:**
- Create: `crates/agicash-cashu/src/mint_quote/types.rs`
- Create: `crates/agicash-cashu/src/mint_quote/mod.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-receive-quote.ts` end-to-end. Note every base-schema field (`id`, `userId`, `accountId`, `quoteId`, `amount`, `description`, `createdAt`, `expiresAt`, `paymentRequest`, `paymentHash`, `lockingDerivationPath`, `transactionId`, `mintingFee`, `totalFee`, `version`) and the three state shapes (`UNPAID/EXPIRED`, `PAID/COMPLETED`, `FAILED`).

- [ ] **Step 2:** Create `crates/agicash-cashu/src/mint_quote/types.rs`:

```rust
use agicash_domain::{AccountId, UserId};
use agicash_money::Money;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One persisted Cashu lightning receive quote row.
///
/// Mirrors `app/features/receive/cashu-receive-quote.ts`'s LIGHTNING-typed
/// quote shape. The CASHU_TOKEN-typed variant is intentionally omitted in
/// slice 7 — that subtype exists in the DB but no Rust caller produces it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuMintQuote {
    /// UUID of the quote row (DB primary key).
    pub id: Uuid,
    /// Mint's quote id (string; used to call NUT-04 `mint_quote/status` and
    /// `mint`). Stored encrypted in `encrypted_data` but exposed here in
    /// plaintext for callers.
    pub quote_id: String,
    pub user_id: UserId,
    pub account_id: AccountId,
    /// Amount credited to the wallet on completion.
    pub amount: Money,
    /// Optional memo passed to the mint when requesting the quote.
    pub description: Option<String>,
    /// BOLT-11 invoice the user pays. Stored encrypted; exposed plaintext.
    pub payment_request: String,
    /// Payment hash of the BOLT-11 invoice (lowercase hex). Searchable.
    pub payment_hash: String,
    /// BIP-32 derivation path used for NUT-20 locking. Slice 7 always emits
    /// the empty string here (no locking); kept on the struct because the
    /// DB column is NOT NULL.
    pub locking_derivation_path: String,
    /// UUID of the corresponding wallet transaction row.
    pub transaction_id: Uuid,
    /// Fee charged by the mint on top of `amount` (added to the invoice
    /// amount). Zero or None when the mint charges nothing.
    pub minting_fee: Option<Money>,
    /// Sum of all fees the receive incurs. For LIGHTNING receives this
    /// equals `minting_fee` (or zero if absent).
    pub total_fee: Money,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub version: u32,
    /// Lifecycle state. Flattened so JSON mirrors the TS discriminated
    /// shape (`{ state: "UNPAID" }`, `{ state: "PAID", keyset_id, keyset_counter, output_amounts }`,
    /// `{ state: "EXPIRED" }`, `{ state: "COMPLETED", keyset_id, keyset_counter, output_amounts }`,
    /// `{ state: "FAILED", failure_reason }`).
    #[serde(flatten)]
    pub state: CashuMintQuoteState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuMintQuoteState {
    /// Invoice issued, awaiting payment by the user.
    Unpaid,
    /// Mint detected payment but proofs not yet minted. Has the keyset
    /// metadata required to reproduce the blinded outputs.
    Paid {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Proofs minted, account credited.
    Completed {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Invoice expired without payment.
    Expired,
    /// Operational failure (e.g. mint rejected mint call after PAID for
    /// reasons other than already-issued — already-issued is recovered via
    /// `wallet.restore`).
    Failed { failure_reason: String },
}
```

- [ ] **Step 3:** Add `crates/agicash-cashu/src/mint_quote/mod.rs`:

```rust
//! Cashu mint-quote (NUT-04 lightning-receive) entity, state machine,
//! and orchestrator.
//!
//! Mirrors `app/features/receive/cashu-receive-quote*.ts`. Four layers:
//! - [`types`] — persisted entity + [`CashuMintQuoteState`] enum.
//! - [`storage`] — `CashuMintQuoteStorage` trait + DTOs.
//! - [`state`] — sans-IO state machine.
//! - [`service`] — orchestrator with CDK + storage I/O.

pub mod error;
pub mod service;
pub mod state;
pub mod storage;
pub mod types;

pub use error::*;
pub use service::*;
pub use state::*;
pub use storage::*;
pub use types::*;
```

- [ ] **Step 4:** Unit tests in `types.rs`:
  - Construct `CashuMintQuote` in each state (`Unpaid`, `Paid`, `Completed`, `Expired`, `Failed`).
  - JSON round-trip; verify discriminator + uppercase state strings + `failure_reason` field.
  - `Paid` and `Completed` round-trip the `keyset_id`/`keyset_counter`/`output_amounts` payload.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(cashu): add CashuMintQuote + state types`

---

## Task 2: `CashuMintQuoteStorage` trait + DTOs

**Goal:** Storage trait mirroring TS `CashuReceiveQuoteRepository`. Five operations the slice exercises: `create`, `process_payment` (UNPAID → PAID), `complete` (PAID → COMPLETED), `fail` (UNPAID → FAILED), `expire` (UNPAID → EXPIRED). `get` and `get_by_transaction_id` accessors round out the surface; `mark_melt_initiated` is omitted (CASHU_TOKEN-only).

**Files:**
- Create: `crates/agicash-cashu/src/mint_quote/storage.rs`

### Steps

- [ ] **Step 1:** Read `cashu-receive-quote-repository.ts` end-to-end. Capture:
  - `create` input shape (TS `RepositoryCreateQuoteParams` for LIGHTNING type — `userId`, `accountId`, `amount`, `quoteId`, `paymentRequest`, `paymentHash`, `expiresAt`, `description`, `lockingDerivationPath`, `receiveType='LIGHTNING'`, `mintingFee?`, `totalFee`, `purpose?`, `transferId?`).
  - `create` returns the persisted quote (no account is returned for create — TS pulls the account from elsewhere).
  - `processPayment` input: `{ quote, keysetId, outputAmounts }`; encrypts `outputAmounts + paymentRequest + ...` into a new `encrypted_data`, returns `{ quote, account }`.
  - `completeReceive` input: `{ quoteId, proofs }`; field-encrypts each proof's `amount + secret` in batch, returns `{ quote, account, addedProofs }`.
  - `expire(id)` — no return value (RPC returns the quote row but TS discards it).
  - `fail({ id, reason })` — same; RPC returns the quote row.
  - Error mappings: nothing as specific as slice 5's `23505 → AlreadyClaimed`; treat generic postgrest errors as `Backend`.

- [ ] **Step 2:** Verify RPC parameter names match the migrations:
  - `create_cashu_receive_quote`: `p_user_id`, `p_account_id`, `p_currency`, `p_expires_at`, `p_locking_derivation_path`, `p_receive_type`, `p_encrypted_data`, `p_quote_id_hash`, `p_payment_hash`, `p_purpose` (default `'PAYMENT'`), `p_transfer_id` (default `null`). Returns `wallet.cashu_receive_quotes` row.
  - `process_cashu_receive_quote_payment`: `p_quote_id`, `p_keyset_id`, `p_number_of_outputs`, `p_encrypted_data`. Returns `wallet.cashu_receive_quote_payment_result` (composite `(quote, account)`).
  - `complete_cashu_receive_quote`: `p_quote_id`, `p_proofs` (array of `wallet.cashu_proof_input`). Returns `wallet.complete_cashu_receive_quote_result` (composite `(quote, account, added_proofs)`).
  - `expire_cashu_receive_quote`: `p_quote_id`. Returns `wallet.cashu_receive_quotes`.
  - `fail_cashu_receive_quote`: `p_quote_id`, `p_failure_reason`. Returns `wallet.cashu_receive_quotes`.

- [ ] **Step 3:** Create `crates/agicash-cashu/src/mint_quote/storage.rs`:

```rust
use super::types::CashuMintQuote;
use crate::receive_swap::TokenProof;  // reuse the slice-5 TokenProof shape
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::EncryptionError;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[async_trait]
pub trait CashuMintQuoteStorage: Send + Sync {
    /// Persist a new UNPAID mint quote and its draft transaction.
    /// Returns the created quote.
    async fn create(
        &self,
        input: CreateMintQuote,
    ) -> Result<CashuMintQuote, MintQuoteStorageError>;

    /// Transition UNPAID → PAID. Stores the keyset metadata needed to
    /// reproduce blinded outputs and bumps the account's keyset counter.
    /// Idempotent on PAID/COMPLETED (returns the existing row + account).
    async fn process_payment(
        &self,
        input: ProcessMintQuotePayment,
    ) -> Result<ProcessMintQuotePaymentResult, MintQuoteStorageError>;

    /// Transition PAID → COMPLETED with the minted proofs. Idempotent on
    /// COMPLETED (returns the existing row + account + previously added
    /// proofs).
    async fn complete(
        &self,
        input: CompleteMintQuote,
    ) -> Result<CompleteMintQuoteResult, MintQuoteStorageError>;

    /// Transition UNPAID → EXPIRED. Idempotent on EXPIRED. Rejects if not
    /// expired yet (server-side guard).
    async fn expire(&self, quote_id: Uuid) -> Result<CashuMintQuote, MintQuoteStorageError>;

    /// Transition UNPAID → FAILED with `reason`. Idempotent on FAILED.
    /// Rejects from PAID/COMPLETED.
    async fn fail(
        &self,
        quote_id: Uuid,
        reason: &str,
    ) -> Result<CashuMintQuote, MintQuoteStorageError>;

    /// Fetch a single quote by primary key. Returns `NotFound` if absent.
    async fn get(&self, quote_id: Uuid) -> Result<CashuMintQuote, MintQuoteStorageError>;
}

#[derive(Debug, Clone, PartialEq)]
pub struct CreateMintQuote {
    pub user_id: UserId,
    pub account_id: AccountId,
    pub amount: Money,
    pub description: Option<String>,
    /// Mint-side quote id (plaintext); the hash goes into `quote_id_hash`.
    pub quote_id: String,
    pub payment_request: String,
    pub payment_hash: String,
    pub expires_at: DateTime<Utc>,
    /// Empty string in slice 7 (no NUT-20 locking yet); the DB column is
    /// NOT NULL so we always send something.
    pub locking_derivation_path: String,
    pub minting_fee: Option<Money>,
    pub total_fee: Money,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProcessMintQuotePayment {
    pub quote: CashuMintQuote,
    pub keyset_id: String,
    pub output_amounts: Vec<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ProcessMintQuotePaymentResult {
    pub quote: CashuMintQuote,
    pub account: Account,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMintQuote {
    pub quote_id: Uuid,
    pub proofs: Vec<TokenProof>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMintQuoteResult {
    pub quote: CashuMintQuote,
    pub account: Account,
    pub added_proofs: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MintQuoteStorageError {
    #[error("not found")]
    NotFound,
    #[error("invalid state transition: {0}")]
    InvalidState(String),
    #[error("storage backend error: {0}")]
    Backend(String),
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
}
```

**Notes:**
- The storage trait reuses `TokenProof` from `crate::receive_swap` to avoid duplicating the wire shape. Both refer to the same `wallet.cashu_proof_input` composite type on the DB side.
- `purpose` and `transfer_id` are NOT exposed on `CreateMintQuote` for slice 7 — the postgrest call relies on the SQL default of `'PAYMENT'` / `null`. Future transfer flows can extend `CreateMintQuote` without breaking callers.
- Slice 5's `Account` carries no proofs; the postgrest layer's `to_account_with_proofs` adds a `cashu_proofs` array that the slice-5 `parse_account` helper tolerates. Reuse that helper.

- [ ] **Step 4:** Compile-only test asserting each DTO + error variant constructs and `MintQuoteStorageError: Send + Sync`.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(cashu): add CashuMintQuoteStorage trait + DTOs`

---

## Task 3: Sans-IO state machine in `agicash-cashu`

**Goal:** Pure state machine driving the mint-quote forward. No async, no I/O.

**Files:**
- Create: `crates/agicash-cashu/src/mint_quote/state.rs`
- Create: `crates/agicash-cashu/src/mint_quote/error.rs`
- Modify: `crates/agicash-cashu/src/lib.rs`

### Steps

- [ ] **Step 1:** Design the machine. Five terminal-or-mid states plus a `NotStarted` pseudo-state:

```rust
// crates/agicash-cashu/src/mint_quote/state.rs

use super::error::MintQuoteError;
use super::types::{CashuMintQuote, CashuMintQuoteState};

pub struct MintQuoteMachine {
    state: MachineState,
}

#[derive(Debug, Clone)]
pub enum MachineState {
    /// Amount + account chosen, no quote requested yet.
    NotStarted,
    /// Invoice issued, awaiting external payment.
    Unpaid(CashuMintQuote),
    /// Mint reports PAID; keyset metadata + outputs computed. Ready to mint.
    Paid(CashuMintQuote),
    /// Proofs minted, account credited (terminal).
    Completed(CashuMintQuote),
    /// Quote expired (terminal).
    Expired(CashuMintQuote),
    /// Quote failed (terminal).
    Failed(CashuMintQuote),
}

/// Next I/O the executor should perform.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Ask the mint for a NUT-04 mint quote and persist the row.
    RequestQuote,
    /// Poll the mint's `mint_quote/status` endpoint.
    PollStatus { quote_id: String },
    /// Mint detected payment — persist the PAID transition with output
    /// metadata.
    ProcessPayment {
        keyset_id: String,
        output_amounts: Vec<u64>,
    },
    /// Mint the proofs via NUT-04 mint endpoint, then persist them.
    MintProofs {
        keyset_id: String,
        keyset_counter: u32,
        output_amounts: Vec<u64>,
    },
    /// Persist the resulting proofs and transition to COMPLETED.
    CompleteQuote { proofs_count: usize },
    /// Expire UNPAID quote.
    Expire,
    /// Fail UNPAID quote with reason.
    Fail { reason: String },
    /// Terminal — nothing more to do.
    None,
}

/// Event the executor feeds back after performing an [`Action`].
#[derive(Debug, Clone)]
pub enum Event {
    QuoteRequested(CashuMintQuote),
    PollSawUnpaid,
    PollSawPaid,
    PollSawIssued,                 // mint reports ISSUED — quote already minted; should follow with MintProofsAlreadyIssued.
    PaymentProcessed(CashuMintQuote),
    MintSucceeded,
    /// Mint replied with `QUOTE_ALREADY_ISSUED` / `OUTPUT_ALREADY_SIGNED`.
    /// Executor should attempt restore.
    MintAlreadyIssued,
    MintRestoreSucceeded,
    QuoteCompleted(CashuMintQuote),
    QuoteExpired(CashuMintQuote),
    QuoteFailed(CashuMintQuote),
}

impl MintQuoteMachine {
    pub fn new() -> Self { Self { state: MachineState::NotStarted } }
    pub fn from_existing(quote: CashuMintQuote) -> Self {
        let state = match &quote.state {
            CashuMintQuoteState::Unpaid => MachineState::Unpaid(quote),
            CashuMintQuoteState::Paid { .. } => MachineState::Paid(quote),
            CashuMintQuoteState::Completed { .. } => MachineState::Completed(quote),
            CashuMintQuoteState::Expired => MachineState::Expired(quote),
            CashuMintQuoteState::Failed { .. } => MachineState::Failed(quote),
        };
        Self { state }
    }
    pub fn state(&self) -> &MachineState { &self.state }
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Completed(_) | MachineState::Expired(_) | MachineState::Failed(_)
        )
    }
    pub fn next_action(&self) -> Action {
        match &self.state {
            MachineState::NotStarted => Action::RequestQuote,
            MachineState::Unpaid(q) => Action::PollStatus { quote_id: q.quote_id.clone() },
            MachineState::Paid(q) => match &q.state {
                CashuMintQuoteState::Paid { keyset_id, keyset_counter, output_amounts } => Action::MintProofs {
                    keyset_id: keyset_id.clone(),
                    keyset_counter: *keyset_counter,
                    output_amounts: output_amounts.clone(),
                },
                _ => Action::None, // unreachable
            },
            MachineState::Completed(_) | MachineState::Expired(_) | MachineState::Failed(_) => Action::None,
        }
    }
    pub fn apply(&mut self, event: Event) -> Result<(), MintQuoteError> { /* state transitions */ }
}
```

- [ ] **Step 2:** Implement `apply` per the diagram:

```
NotStarted ──RequestQuote──> QuoteRequested ──> Unpaid
Unpaid ──PollStatus──> PollSawUnpaid  ──> [stay] (executor sleeps + polls again)
                   │
                   ├─PollSawPaid──> [executor calls ProcessPayment with keyset] ──PaymentProcessed──> Paid
                   │
                   └─PollSawIssued──> [skipped path; executor reconciles via restore — apply as PaymentProcessed if a `Paid` row exists, or FailSwap otherwise]
Paid ──MintProofs──> MintSucceeded ──> [executor persists proofs] ──QuoteCompleted──> Completed
                  │
                  └─MintAlreadyIssued──> [executor restores] ──MintRestoreSucceeded──> [executor persists] ──QuoteCompleted──> Completed
                                       └─ else: QuoteFailed("Quote issued but proofs unrecoverable")
Unpaid ──Expire──> QuoteExpired ──> Expired
Unpaid ──Fail──> QuoteFailed ──> Failed
```

The transitions to surface as errors (`InvalidTransition`): applying `QuoteCompleted` from Unpaid, applying `PaymentProcessed` from Completed/Failed/Expired, etc. Mirror slice 5's error formatting.

- [ ] **Step 3:** Unit tests covering every transition:
  - Happy path: NotStarted → RequestQuote → QuoteRequested → Unpaid → PollStatus → PollSawPaid → ProcessPayment → PaymentProcessed → Paid → MintProofs → MintSucceeded → CompleteQuote → QuoteCompleted → Completed.
  - Poll loop: PollSawUnpaid stays Unpaid; PollSawPaid advances.
  - Already-issued path: Paid → MintProofs → MintAlreadyIssued → MintRestoreSucceeded → CompleteQuote → Completed.
  - Restore-fail path: Paid → MintAlreadyIssued → (no restore) → Fail → Failed.
  - Expire: Unpaid → Expire → Expired.
  - Fail from Unpaid: Unpaid → Fail → Failed.
  - Invalid transitions return `MintQuoteError::InvalidTransition`.
  - `from_existing(COMPLETED).is_terminal() == true`.

- [ ] **Step 4:** Create `error.rs`:

```rust
use super::storage::MintQuoteStorageError;
use agicash_traits::CashuProviderError;

#[derive(Debug, thiserror::Error)]
pub enum MintQuoteError {
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },
    #[error("storage error: {0}")]
    Storage(#[from] MintQuoteStorageError),
    #[error("mint error: {0}")]
    Mint(#[from] CashuProviderError),
    #[error("amount too small")]
    AmountTooSmall,
    #[error("currency mismatch: account {account} differs from request {request}")]
    CurrencyMismatch { account: String, request: String },
    #[error("quote expired before payment")]
    QuoteExpired,
    #[error("quote not yet paid")]
    QuoteNotPaid,
    #[error("mint quote unrecoverable: {0}")]
    Unrecoverable(String),
}
```

- [ ] **Step 5:** Wire into `agicash-cashu/src/lib.rs`:

```rust
pub mod mint_quote;
pub use mint_quote::{
    CashuMintQuote, CashuMintQuoteService, CashuMintQuoteState, CashuMintQuoteStorage,
    CompleteMintQuote, CompleteMintQuoteOutcome, CreateMintQuote, MintQuoteError,
    MintQuoteMachine, MintQuoteStorageError, ProcessMintQuotePayment,
};
```

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cashu): sans-IO state machine for mint quote`

---

## Task 4: `CashuMintQuoteService` (orchestrator)

**Goal:** Drives `MintQuoteMachine` forward, performs I/O. Mirrors TS `CashuReceiveQuoteService` — exposes `create_quote`, `poll_until_paid`, `complete_receive`, `expire`, `fail`. Slice 7 ships these primitives; the CLI composes them into the one-shot UX.

**Files:**
- Create: `crates/agicash-cashu/src/mint_quote/service.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-receive-quote-service.ts` lines 36-358. Critical sections:
  - `getLightningQuote` (delegates to `cashu-receive-quote-core.ts`) — Rust version calls `wallet.connector().post_mint_quote(MintQuoteBolt11Request { amount, unit, description, pubkey: None })`. **No NUT-20 locking** per non-goals.
  - `createReceiveQuote` (lines 63-118) — slice 7 covers only the LIGHTNING branch.
  - `completeReceive` (lines 196-235), `processUnpaidQuote` (237-258), `processPaidQuote` (260-290), `mintProofs` (292-357) — includes the `OUTPUT_ALREADY_SIGNED` / `QUOTE_ALREADY_ISSUED` restore fallback.
  - `expire` (lines 153-167), `fail` (lines 176-186).

- [ ] **Step 2:** Implement:

```rust
// crates/agicash-cashu/src/mint_quote/service.rs

use std::sync::Arc;
use std::time::Duration;

use agicash_domain::{Account, UserId};
use agicash_money::Money;
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use cdk::nuts::{MintQuoteBolt11Request, MintQuoteBolt11Response, MintRequest, PaymentMethod, PreMintSecrets};
use cdk::nuts::nut23::QuoteState;
use cdk::Amount;

use super::error::MintQuoteError;
use super::state::{Action, Event, MintQuoteMachine};
use super::storage::{
    CashuMintQuoteStorage, CompleteMintQuote, CompleteMintQuoteResult, CreateMintQuote,
    ProcessMintQuotePayment,
};
use super::types::{CashuMintQuote, CashuMintQuoteState};

pub struct CashuMintQuoteService {
    storage: Arc<dyn CashuMintQuoteStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl CashuMintQuoteService {
    pub fn new(
        storage: Arc<dyn CashuMintQuoteStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self { storage, cashu_provider }
    }

    /// Request a NUT-04 mint quote from the mint and persist the UNPAID row.
    /// Returns the created quote with the BOLT-11 invoice attached.
    pub async fn create_quote(
        &self,
        user_id: UserId,
        account: &Account,
        amount: Money,
        description: Option<String>,
    ) -> Result<CashuMintQuote, MintQuoteError> {
        // 1. Validate currency: account.currency must accept the requested Money.
        //    Map currency → CurrencyUnit (Btc -> Sat, Usd -> Usd; reject others).
        // 2. wallet = cashu_provider.wallet_for_account(account).await?
        // 3. mint_quote = wallet.connector().post_mint_quote(MintQuoteBolt11Request {
        //        amount: Amount::from(amount.to_minor_units()),
        //        unit, description: description.clone(), pubkey: None,
        //    }).await
        // 4. Extract payment_hash from the BOLT-11 invoice. Use the
        //    `lightning-invoice` crate (already in cashu's tree via nut23) —
        //    Bolt11Invoice::from_str(&response.request) gives `payment_hash()`.
        //    Format as lowercase hex; if extraction fails, surface
        //    Mint(CashuProviderError::Protocol("bad invoice: ..")).
        // 5. expires_at = DateTime::from_timestamp(response.expiry as i64, 0)
        //    ; if absent, use chrono::Utc::now() + Duration::hours(1) and log a warning.
        // 6. minting_fee = response.amount.map(|a| amount.minus(a))? — pull from
        //    response if present, else None. (CDK's MintQuoteBolt11Response.amount
        //    is the invoice amount; if it equals the requested amount, fee is zero.)
        //    Match TS: total_fee == minting_fee for LIGHTNING.
        // 7. input = CreateMintQuote { ..., locking_derivation_path: String::new() }.
        // 8. storage.create(input).await — returns the persisted quote.
    }

    /// Poll the mint until the quote is PAID or `timeout` elapses. Returns
    /// the (locally-persisted) quote in its latest state. Caller handles
    /// the subsequent `complete_receive` call.
    pub async fn poll_until_paid(
        &self,
        account: &Account,
        quote: CashuMintQuote,
        poll_interval: Duration,
        timeout: Duration,
    ) -> Result<CashuMintQuote, MintQuoteError> {
        let mut machine = MintQuoteMachine::from_existing(quote.clone());
        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let deadline = std::time::Instant::now() + timeout;
        loop {
            if let Action::PollStatus { quote_id } = machine.next_action() {
                let status = wallet
                    .connector()
                    .get_mint_quote_status(&quote_id)
                    .await
                    .map_err(|e| MintQuoteError::Mint(CashuProviderError::Network(format!(
                        "get_mint_quote_status: {e}"
                    ))))?;
                match status.state {
                    QuoteState::Unpaid => {
                        if std::time::Instant::now() >= deadline {
                            return Ok(quote_in_machine(&machine).cloned().unwrap_or(quote));
                        }
                        tokio::time::sleep(poll_interval).await;
                        continue;
                    }
                    QuoteState::Paid => {
                        // Compute keyset metadata + output split via CDK
                        // (mirror slice 5's split_amounts). Then call
                        // storage.process_payment(...).
                        let result = self.do_process_payment(&wallet, &quote, &account).await?;
                        return Ok(result.quote);
                    }
                    QuoteState::Issued => {
                        // Quote already minted (someone else won the race). The
                        // mint considers it done; we have nothing to claim.
                        // Mirror TS: treat as the "already issued" path —
                        // attempt restore via complete_receive.
                        let result = self.do_process_payment(&wallet, &quote, &account).await?;
                        return Ok(result.quote);
                    }
                }
            } else {
                // Quote no longer UNPAID; return current state.
                return Ok(quote_in_machine(&machine).cloned().unwrap_or(quote));
            }
        }
    }

    /// Drive a PAID quote to COMPLETED — request proofs from the mint
    /// (with `wallet.restore` fallback on already-issued), persist them.
    /// Idempotent on COMPLETED.
    pub async fn complete_receive(
        &self,
        account: &Account,
        quote: CashuMintQuote,
        seed: &[u8; 64],
    ) -> Result<CompleteMintQuoteOutcome, MintQuoteError> {
        let mut machine = MintQuoteMachine::from_existing(quote.clone());
        if machine.is_terminal() {
            // COMPLETED, EXPIRED, or FAILED — return as-is.
            return Ok(CompleteMintQuoteOutcome::AlreadyTerminal(quote));
        }
        if matches!(machine.state(), MachineState::Unpaid(_)) {
            return Err(MintQuoteError::QuoteNotPaid);
        }
        // Drive the Paid → Completed loop:
        //   1. Fetch keyset_info + keyset_keys via slice-5's helpers.
        //   2. Build PreMintSecrets::from_seed with the persisted counter +
        //      output_amounts (mirror slice 5's perform_mint_swap).
        //   3. wallet.connector().post_mint(PaymentMethod::BOLT11, MintRequest {
        //          quote: quote.quote_id, outputs: blinded_messages, signature: None
        //      }).await
        //      - On success: unblind to proofs, storage.complete(...), apply
        //        QuoteCompleted → return CompleteMintQuoteOutcome::Completed.
        //      - On already-issued: PreMintSecrets::restore_batch + post_restore
        //        (slice-5 attempt_restore helper). If yields proofs: storage.complete.
        //        Else: storage.fail("quote already issued, restore yielded no proofs")
        //              → return CompleteMintQuoteOutcome::Failed.
        //   4. Mirror slice-5 error detection for already-issued:
        //      cdk::error::Error::QuoteAlreadyIssued + BlindedMessageAlreadySigned
        //      + message substring "already issued" / "already signed".
    }

    /// Expire an UNPAID quote (only valid after the invoice expiry).
    pub async fn expire(&self, quote: &CashuMintQuote) -> Result<CashuMintQuote, MintQuoteError> {
        match &quote.state {
            CashuMintQuoteState::Expired => Ok(quote.clone()),
            CashuMintQuoteState::Unpaid => Ok(self.storage.expire(quote.id).await?),
            _ => Err(MintQuoteError::InvalidTransition {
                from: format!("{:?}", quote.state),
                event: "expire".into(),
            }),
        }
    }

    /// Fail an UNPAID quote (e.g. user cancelled out-of-band).
    pub async fn fail(
        &self,
        quote: &CashuMintQuote,
        reason: &str,
    ) -> Result<CashuMintQuote, MintQuoteError> {
        match &quote.state {
            CashuMintQuoteState::Failed { .. } => Ok(quote.clone()),
            CashuMintQuoteState::Unpaid => Ok(self.storage.fail(quote.id, reason).await?),
            _ => Err(MintQuoteError::InvalidTransition {
                from: format!("{:?}", quote.state),
                event: "fail".into(),
            }),
        }
    }
}

pub enum CompleteMintQuoteOutcome {
    Completed {
        quote: CashuMintQuote,
        account: Account,
        added_proofs: Vec<String>,
    },
    AlreadyTerminal(CashuMintQuote),
    Failed(CashuMintQuote),
}
```

**Notes:**
- `do_process_payment` is a private helper that fetches keysets, picks the active sat/usd keyset (mirror slice 5's `active_keyset_for_unit`), splits the amount into denominations, and calls `storage.process_payment(...)`.
- Reuse slice-5 helpers verbatim where possible (`fetch_keyset_infos`, `fetch_keyset_keys`, `active_keyset_for_unit`, `compute_fee_for_proofs`, `split_amounts`, `proof_to_token_proof`, `is_already_claimed_error`-style detection adapted to NUT-04 error codes). Where slice 5 keeps them private to `receive_swap/service.rs`, either factor them up into a shared `crates/agicash-cashu/src/cdk_helpers.rs` module or duplicate them — judgment call; factoring up is cleaner but mechanical. Recommend duplicate first, refactor in a follow-up commit if time permits.
- `MintQuoteBolt11Response.expiry: Option<u64>` — handle the None branch.
- `payment_hash` extraction: `lightning-invoice = "0.32"` is transitively present (cashu-0.15 depends on it). Add a direct dependency in `agicash-cashu/Cargo.toml` if rustc complains.

- [ ] **Step 3:** Unit tests (no network):
  - `create_quote` rejects currency mismatch (account BTC, request USD).
  - `expire` is no-op on EXPIRED quote.
  - `expire` errors on PAID/COMPLETED quote.
  - `fail` is no-op on FAILED quote.
  - `fail` errors on PAID/COMPLETED quote.
  - `complete_receive` on UNPAID quote returns `QuoteNotPaid`.
  - `complete_receive` on COMPLETED quote returns `AlreadyTerminal` without touching storage.

Network-dependent paths (`create_quote`, `poll_until_paid` with real mint, `complete_receive` minting) live in Task 7.

- [ ] **Step 4:** Clippy + fmt clean.

- [ ] **Step 5: Commit** — `feat(cashu): CashuMintQuoteService orchestrator with CDK mint_quote + mint + restore fallback`

---

## Task 5: Supabase impl of `CashuMintQuoteStorage`

**Goal:** Postgrest-backed impl mirroring TS `CashuReceiveQuoteRepository`. Calls the six existing RPCs.

**Files:**
- Create: `crates/agicash-storage-supabase/src/cashu_mint_quote_storage.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

### Steps

- [ ] **Step 1:** Re-read `cashu-receive-quote-repository.ts` end-to-end:
  - `create` encrypts the `CashuLightningReceiveDbDataSchema` blob (`paymentRequest`, `mintQuoteId`, `amountReceived`, `description`, `mintingFee`, `cashuTokenMeltData=undefined` for LIGHTNING, `totalFee`). The `quote_id_hash` is SHA-256 of the plaintext mint quote id.
  - `processPayment` re-encrypts the blob including `outputAmounts` and sends `(p_quote_id, p_keyset_id, p_number_of_outputs, p_encrypted_data)`.
  - `completeReceive` field-encrypts each proof's amount + secret (passthrough loop, matching slice 5's pattern; `encryptBatch` is a future optimization).
  - `expire(id)`: `expire_cashu_receive_quote(p_quote_id)`.
  - `fail({id, reason})`: `fail_cashu_receive_quote(p_quote_id, p_failure_reason)`.

- [ ] **Step 2:** Implement following the slice 5 storage pattern (`SupabaseCashuReceiveSwapStorage` is the canonical model — same `Arc<SupabaseStorage>` + `Arc<dyn ProofEncryption>` constructor, same `encrypt_to_base64` / `decrypt_from_base64` helpers, same `EncryptedProofInput` shape for `complete`).

Skeleton:

```rust
use crate::SupabaseStorage;
use agicash_cashu::{
    CashuMintQuote, CashuMintQuoteState, CashuMintQuoteStorage, CompleteMintQuote,
    CompleteMintQuoteResult, CreateMintQuote, MintQuoteStorageError, ProcessMintQuotePayment,
    ProcessMintQuotePaymentResult, TokenProof,
};
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::ProofEncryption;
use async_trait::async_trait;
use base64::engine::general_purpose;
use base64::Engine;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use uuid::Uuid;

pub struct SupabaseCashuMintQuoteStorage {
    base: Arc<SupabaseStorage>,
    encryption: Arc<dyn ProofEncryption>,
}

#[derive(Debug, Clone, Deserialize)]
struct CashuMintQuoteRow {
    id: Uuid,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    account_id: AccountId,
    user_id: UserId,
    keyset_id: Option<String>,
    keyset_counter: Option<i32>,
    state: String,
    version: i32,
    failure_reason: Option<String>,
    transaction_id: Uuid,
    payment_hash: String,
    locking_derivation_path: String,
    encrypted_data: String,
    // type / cashu_token_melt_initiated are present but ignored by slice 7.
}

/// JSON inside `encrypted_data` (mirrors TS `CashuLightningReceiveDbDataSchema`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LightningReceiveData {
    payment_request: String,
    mint_quote_id: String,
    amount_received: Money,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    minting_fee: Option<Money>,
    /// Populated on transition to PAID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    output_amounts: Option<Vec<u64>>,
    total_fee: Money,
}

#[async_trait]
impl CashuMintQuoteStorage for SupabaseCashuMintQuoteStorage {
    async fn create(&self, input: CreateMintQuote) -> Result<CashuMintQuote, MintQuoteStorageError> {
        let data = LightningReceiveData {
            payment_request: input.payment_request.clone(),
            mint_quote_id: input.quote_id.clone(),
            amount_received: input.amount.clone(),
            description: input.description.clone(),
            minting_fee: input.minting_fee.clone(),
            output_amounts: None,
            total_fee: input.total_fee.clone(),
        };
        let encrypted_data = self.encrypt_to_base64(&serde_json::to_value(&data)?).await?;
        let quote_id_hash = sha256_hex(&input.quote_id);
        let body = serde_json::to_string(&json!({
            "p_user_id": input.user_id,
            "p_account_id": input.account_id,
            "p_currency": input.amount.currency(),
            "p_expires_at": input.expires_at,
            "p_locking_derivation_path": input.locking_derivation_path,
            "p_receive_type": "LIGHTNING",
            "p_encrypted_data": encrypted_data,
            "p_quote_id_hash": quote_id_hash,
            "p_payment_hash": input.payment_hash,
        }))?;
        // POST RPC, parse Value -> row.
    }
    // ... process_payment, complete, expire, fail, get
}
```

**Notes:**
- `wallet.cashu_receive_quotes` columns reference: see `crates/agicash-cashu/src/mint_quote/storage.rs` for the exact row shape pulled from the DB. Confirm by grep of the migration if unsure.
- The `complete_cashu_receive_quote` RPC returns `(quote, account, added_proofs)`. The `account` value comes from `to_account_with_proofs` and includes a `cashu_proofs` array — reuse slice 5's `parse_account` helper for tolerance.
- `quote_id_hash` is SHA-256 hex of the mint quote id (TS uses `computeSHA256(quoteId)`). Reuse the `sha256_hex` helper introduced in slice 5's receive_swap service.

- [ ] **Step 3:** Integration tests gated behind `real-supabase-tests` (mirror slice 5's storage tests):
  - `create` writes an UNPAID quote.
  - `create` then `process_payment` writes a PAID quote + bumps account counter.
  - `create` → `process_payment` → `complete` writes proofs + COMPLETED quote.
  - `create` → `fail` writes FAILED quote.
  - `create` → wait, then `expire` writes EXPIRED quote (use `expires_at = now() - 1m`).
  - Round-trip an encrypted blob.

These tests use the service-role-key path (same as slice 5 storage tests).

- [ ] **Step 4:** Wire into `agicash-storage-supabase/src/lib.rs`:

```rust
pub mod cashu_mint_quote_storage;
pub use cashu_mint_quote_storage::*;
```

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(storage-supabase): postgrest impl for CashuMintQuoteStorage`

---

## Task 6: CLI command `agicash receive lightning <amount>`

**Goal:** Wire the mint-quote flow to the CLI as a subcommand under `receive`. Emits a JSON object containing the BOLT-11 invoice + quote id at quote-creation time, then (default behaviour) polls until paid + mints, emitting a final receipt.

**Files:**
- Modify: `crates/agicash-cli/src/cli.rs`
- Modify: `crates/agicash-cli/src/composition.rs`
- Create: `crates/agicash-cli/src/receive_lightning.rs`
- Modify: `crates/agicash-cli/src/main.rs`

### Steps

- [ ] **Step 1:** Refactor `Command::Receive { token }` into a subcommand group in `cli.rs`:

```rust
Receive(ReceiveArgs),
// ...
#[derive(clap::Args, Debug)]
pub struct ReceiveArgs {
    #[command(subcommand)]
    pub cmd: ReceiveCommand,
}
#[derive(Subcommand, Debug)]
pub enum ReceiveCommand {
    /// Claim a Cashu token (NUT-03 swap).
    Token { token: String },
    /// Receive sats via Lightning: request a NUT-04 mint quote, then mint
    /// proofs once the invoice is paid.
    Lightning {
        /// Amount to receive in the account's unit (sats for BTC,
        /// cents for USD).
        amount: u64,
        /// Account ID to receive into. If omitted, the only Cashu account
        /// for the user is used; if multiple, this is required.
        #[arg(long)]
        account: Option<String>,
        /// Currency code (BTC default; USD for usd-unit mints).
        #[arg(long, default_value = "BTC")]
        currency: String,
        /// Optional memo to attach to the mint quote.
        #[arg(long)]
        description: Option<String>,
        /// If set, print the invoice + quote id and exit without polling.
        /// The user must call `agicash receive lightning-complete <quote_id>`
        /// once the invoice is paid externally.
        #[arg(long)]
        no_wait: bool,
        /// Polling interval in milliseconds.
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        /// Overall timeout in seconds.
        #[arg(long, default_value_t = 300)]
        timeout_s: u64,
    },
    /// Finish a previously-created lightning receive (used with `--no-wait`).
    LightningComplete {
        /// The DB quote id (UUID), as returned by `receive lightning --no-wait`.
        quote_id: String,
    },
}
```

Update existing tests in `cli.rs` to use the new shape (`agicash receive token cashuA...`).

- [ ] **Step 2:** Add `MintQuoteDeps` in `composition.rs`:

```rust
pub struct MintQuoteDeps {
    pub service: Arc<CashuMintQuoteService>,
    pub storage: Arc<dyn CashuMintQuoteStorage>,
}
pub fn build_mint_quote_deps(
    storage_deps: &StorageDeps,
    cashu_deps: &CashuDeps,
) -> MintQuoteDeps {
    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let quote_storage: Arc<dyn CashuMintQuoteStorage> = Arc::new(
        SupabaseCashuMintQuoteStorage::new(Arc::clone(&storage_deps.storage), encryption),
    );
    let service = Arc::new(CashuMintQuoteService::new(
        Arc::clone(&quote_storage),
        Arc::clone(&cashu_deps.provider),
    ));
    MintQuoteDeps { service, storage: quote_storage }
}
```

- [ ] **Step 3:** Implement `cmd_receive_lightning` in `receive_lightning.rs`:

```rust
pub async fn cmd_receive_lightning(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    quote_deps: &MintQuoteDeps,
    args: LightningArgs,
) -> Result<(), ReceiveLightningCmdError> {
    // 1. Load session → error NotLoggedIn.
    // 2. Build Money from (amount, currency).
    // 3. Resolve target account (same selection logic as `send`):
    //    - If --account passed, get by id; check ownership.
    //    - Else, list Cashu accounts; require exactly one.
    // 4. quote = service.create_quote(user_id, &account, amount, description).await?
    // 5. Print quote JSON immediately so the user can pay:
    //    { "status": "quote-issued", "quote_id": "...", "invoice": "lnbc...", "amount": "...", "expires_at": "...", "account_id": "..." }
    // 6. If args.no_wait: return Ok(()) (the user calls `receive lightning-complete` later).
    // 7. Poll loop:
    //    quote = service.poll_until_paid(&account, quote, Duration::from_millis(poll_ms), Duration::from_secs(timeout_s)).await?
    //    if quote.state is Unpaid: print `{"status":"timed-out", "quote_id": "..."}`; return Ok(()).
    //    if quote.state is Paid:
    //        seed = auth.client.get_cashu_seed().await?
    //        outcome = service.complete_receive(&account, quote, &seed).await?
    //        print final receipt JSON per outcome variant.
}

pub async fn cmd_receive_lightning_complete(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    quote_deps: &MintQuoteDeps,
    quote_id: String,
) -> Result<(), ReceiveLightningCmdError> {
    // 1. Load session.
    // 2. Uuid::from_str(&quote_id).
    // 3. quote = quote_deps.storage.get(quote_id).await?
    // 4. Resolve account from quote.account_id via storage_deps.
    // 5. If quote is UNPAID, poll once + transition; if still UNPAID, error QuoteNotPaid.
    // 6. seed + complete_receive + print receipt.
}

#[derive(Debug, thiserror::Error)]
pub enum ReceiveLightningCmdError {
    #[error("not logged in")] NotLoggedIn,
    #[error("no matching account")] NoMatchingAccount,
    #[error("account ambiguous — pass --account <id>")] AccountAmbiguous,
    #[error("invalid account id: {0}")] InvalidAccountId(String),
    #[error("invalid quote id: {0}")] InvalidQuoteId(String),
    #[error("unsupported currency: {0}")] UnsupportedCurrency(String),
    #[error("amount too small")] AmountTooSmall,
    #[error("quote not paid yet")] QuoteNotPaid,
    #[error(transparent)] Quote(#[from] MintQuoteError),
    #[error(transparent)] Storage(#[from] StorageError),
    #[error(transparent)] Auth(#[from] AuthError),
}
```

JSON receipt shape for the success path:

```json
{
  "status": "received",
  "amount": "<sats>",
  "fee": "<sats>",
  "unit": "sat",
  "currency": "BTC",
  "account_id": "...",
  "quote_id": "...",
  "invoice_payment_hash": "..."
}
```

- [ ] **Step 4:** Dispatch in `main.rs`. Add `ReceiveLightningCmdError` to `classify_error` with stable kebab-case codes: `not-logged-in`, `no-matching-account`, `account-ambiguous`, `invalid-account-id`, `invalid-quote-id`, `unsupported-currency`, `amount-too-small`, `quote-not-paid`, `quote-expired`, `mint-error`, `mint-unreachable`. Map nested `MintQuoteError` variants the same way slice 5 maps `ReceiveSwapError`.

Also update the existing `Command::Receive { token }` dispatch to handle `ReceiveCommand::Token { token }`. No semantics change for the token-receive path.

- [ ] **Step 5:** Smoke test: `cargo run -p agicash-cli -- receive lightning --help`.

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cli): add 'agicash receive lightning <amount>' command`

---

## Task 7: Integration test against real mint

**Goal:** E2E test: `agicash receive lightning 64` against testnut.cashu.space — testnut's fakewallet auto-pays the invoice within seconds — verify the proofs land and `agicash balance` reflects them.

**Files:**
- Create: `crates/agicash-cli/tests/receive_lightning.rs`

### Steps

- [ ] **Step 1:** The helper pattern is already established by `crates/agicash-cli/tests/receive.rs`. Reuse `env_ready()` + the per-process keyring service trick. The new test does not need a token-minting helper — `agicash receive lightning` IS the helper.

- [ ] **Step 2:** Write tests gated behind `real-mint-tests,real-supabase-tests,real-opensecret-tests`:

```rust
#[cfg(all(feature = "real-mint-tests", feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod gated {
    use assert_cmd::Command;
    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    fn env_ready() -> bool { /* same as receive.rs */ }

    #[test]
    fn receive_lightning_credits_balance_end_to_end() {
        if !env_ready() { eprintln!("skipping: env vars not set"); return; }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.recv-lightning");

        let cleanup = |s: &str| {
            let _ = Command::cargo_bin("agicash").unwrap()
                .env("AGICASH_KEYRING_SERVICE", s)
                .args(["auth", "logout"]).output();
        };

        // 1. auth guest
        // 2. mint add testnut (BTC)
        // 3. agicash receive lightning 64 --poll-ms 500 --timeout-s 30
        //    - Expect exit 0; stdout has one or two JSON objects (quote-issued + received).
        //    - Parse the last newline-delimited JSON line.
        //    - Assert status == "received", amount == "64".
        // 4. agicash balance → assert testnut account balance > 0.
        // 5. cleanup.
    }

    #[test]
    fn receive_lightning_no_wait_returns_invoice_and_complete_resolves() {
        // 1. auth guest, mint add testnut.
        // 2. agicash receive lightning 32 --no-wait
        //    - Parse quote-issued JSON, capture quote_id + invoice.
        // 3. sleep 3s for testnut auto-pay.
        // 4. agicash receive lightning-complete <quote_id>
        //    - Expect status == "received", amount == "32".
    }

    #[test]
    fn receive_lightning_for_missing_account_errors() {
        // auth guest; do NOT add mint.
        // agicash receive lightning 64 → expect no-matching-account on stderr.
    }
}

#[cfg(not(all(feature = "real-mint-tests", feature = "real-supabase-tests", feature = "real-opensecret-tests")))]
#[test]
fn receive_lightning_tests_skipped_without_features() {
    eprintln!("skipping; run with --features real-mint-tests,real-supabase-tests,real-opensecret-tests");
}
```

- [ ] **Step 3:** Run: `cargo test -p agicash-cli --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test receive_lightning -- --nocapture --test-threads=1`. PASS.

- [ ] **Step 4: Commit** — `test(cli): integration test for lightning receive flow against testnut`

---

## Task 8: Final verification — slice 7 test bar

- [ ] `cargo build --workspace` clean (zero warnings).
- [ ] `cargo test --workspace` green (prior + new unit tests).
- [ ] `cargo clippy --workspace --all-targets --features "real-mint-tests real-supabase-tests real-opensecret-tests" -- -D warnings` clean.
- [ ] `cargo fmt --all --check` clean.
- [ ] `cargo test -p agicash-cashu` — state-machine unit tests pass (no network).
- [ ] `cargo test -p agicash-storage-supabase --features real-supabase-tests` — storage tests pass.
- [ ] `cargo test -p agicash-cli --features "real-mint-tests,real-supabase-tests,real-opensecret-tests" --test receive_lightning -- --nocapture --test-threads=1` — e2e passes.
- [ ] `cargo tree -p agicash-wasm | grep agicash-cashu` empty.
- [ ] Smoke: `agicash receive lightning --help` shows usage; `agicash receive lightning 100 --no-wait` (against a configured account) returns a JSON `quote-issued` body to stdout.

---

## Acceptance criteria

1. `agicash receive lightning <amount>` issues a NUT-04 mint quote, returns a BOLT-11 invoice, polls until PAID, mints proofs, persists them, returns a JSON receipt with `status: "received"`. **Covered by Task 7's `receive_lightning_credits_balance_end_to_end` test.**
2. `agicash receive lightning <amount> --no-wait` + `agicash receive lightning-complete <quote_id>` produces the same end state with explicit user pacing. **Covered by Task 7's `receive_lightning_no_wait_returns_invoice_and_complete_resolves` test.**
3. `agicash receive lightning <amount>` without a matching Cashu account on the user errors with `no-matching-account` on stderr. **Covered by Task 7's `receive_lightning_for_missing_account_errors` test.**
4. State machine handles every transition + invalid transitions deterministically. **Covered by Task 3's unit tests.**
5. Postgrest impl round-trips encrypted blobs through every RPC. **Covered by Task 5's storage integration tests.**
6. WASM stays clean of `agicash-cashu`. **Covered by `cargo tree` check.**

---

## Open questions for operator

1. **Subcommand restructure of `agicash receive`.** Slice 5 wired `agicash receive <token>`; slice 7 needs `agicash receive lightning <amount>`. Proposal: turn `receive` into a subcommand group (`receive token <token>` / `receive lightning <amount>` / `receive lightning-complete <quote_id>`). **Breaking change** for any user/script using `agicash receive cashuA...` directly. Alternatives: (a) hard rename now (cheap, mechanical), (b) keep `agicash receive <token>` as the bare positional default + add `receive lightning <amount>` as a sibling subcommand (possible in clap but awkward). **Recommend (a)** — slice 7 is the right moment, no production users yet. Confirm before Task 6.

2. **NUT-20 locked quotes.** TS uses `wallet.createLockedMintQuote(amount, lockingPublicKey)` and stores `lockingDerivationPath`. Slice 7 omits this — quotes are unlocked. Risk: in production multi-device scenarios the lock prevents another instance from claiming the proofs. For slice 7's single-CLI scope this is fine; flag for inclusion in a future "multi-device" hardening slice.

3. **Polling vs. mint-side webhook.** Slice 7 polls (`get_mint_quote_status` every 1s by default). TS uses the same polling pattern; CDK 0.15 doesn't ship a webhook subscriber for NUT-04 (NUT-15 WebSocket subscription exists but is unimplemented in CDK 0.15's `MintConnector` trait). **Polling stays; document the timeout default (300s) + flag for tuning.**

4. **Quote-expiry watcher.** TS runs a background task that calls `expire_cashu_receive_quote` after `expiresAt`. Slice 7 exposes the storage + service surface for this but does not wire it from the CLI. Future slice (cache + task processors, spec step 11) covers it. The trait + service `expire` method are real, just unexercised from the CLI.

5. **Mint quote `purpose` / `transfer_id` parameters.** The RPC has SQL defaults for both, so omitting them in slice 7 works. The Rust DTOs deliberately omit them too. A future "internal transfer" slice will reintroduce them on `CreateMintQuote` (additive change).

6. **`pre-commit` hooks.** Slice 5 + 6 used `PREK_ALLOW_NO_CONFIG=1`. Slice 7 worktree is branched off slice 6; same workaround applies. Use it for every commit; mention in commit body if conspicuous.

---

## Sequence of commits

1. `feat(cashu): add CashuMintQuote + state types` (Task 1)
2. `feat(cashu): add CashuMintQuoteStorage trait + DTOs` (Task 2)
3. `feat(cashu): sans-IO state machine for mint quote` (Task 3)
4. `feat(cashu): CashuMintQuoteService orchestrator with CDK mint_quote + mint + restore fallback` (Task 4)
5. `feat(storage-supabase): postgrest impl for CashuMintQuoteStorage` (Task 5)
6. `feat(cli): add 'agicash receive lightning <amount>' command` (Task 6)
7. `test(cli): integration test for lightning receive flow against testnut` (Task 7)
8. `style(rust): clippy nits after slice 7` (Task 8, only if needed)

Each commit prefixed with `PREK_ALLOW_NO_CONFIG=1 git commit ...`.

---

## Notes for the executor

- State machine pure; orchestrator holds I/O. Same discipline as slice 5/6.
- The TS `mintBolt11` call (line 318 of `cashu-receive-quote-service.ts`) corresponds to CDK's `MintConnector::post_mint(PaymentMethod::BOLT11, MintRequest { quote, outputs, signature })`. The `signature` field is for NUT-20-locked quotes; slice 7 always sends `None`.
- The CDK `MintQuoteBolt11Response.expiry` is `Option<u64>`. Most mints set it; testnut does.
- `payment_hash`: extract from the BOLT-11 invoice via `Bolt11Invoice::from_str(invoice).map(|i| hex::encode(i.payment_hash()))`. `lightning-invoice` is transitively present; if a direct dep is needed, add `lightning-invoice = { version = "0.32", default-features = false }` to `agicash-cashu/Cargo.toml`.
- Token receive (slice 5) already exposes `get_cashu_seed()` on `OpenSecretClient`. Reuse — no plumbing needed.
- The DB RPC parameter names match the TS repo verbatim. If serializer renames a field, the RPC silently fails. Run the storage integration tests early.
- testnut.cashu.space's fakewallet auto-pays test invoices within ~1-2 seconds. The 30s timeout in the integration test gives ample margin. If the test flakes, bump to 60s.
- If you hit "where does the keyset counter come from" during `complete_receive` — `process_payment` reads it back from the row after the DB function bumps + returns it. The `Paid` state variant carries it through.
- If you find yourself reaching for tokio in `state.rs`, you've made a mistake.
