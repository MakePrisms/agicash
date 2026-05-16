# Slice 8 — Cashu Lightning Send

> **For executor:** REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Walk through tasks one at a time, committing per the plan's checkpoints. Read TS source first. Mirror slice 7 (mint-quote receive) closely — same structure, inverse direction (NUT-05 melt instead of NUT-04 mint).

**Goal:** Implement `agicash send lightning <bolt11-invoice>` — request a NUT-05 melt quote from a Cashu mint for the supplied invoice, select proofs from the account covering `quote.amount + quote.fee_reserve`, swap inputs if no exact match, mark the send-quote PENDING, call `melt`, then on `PAID` persist change proofs and complete the send. After this slice, a user can pay a BOLT-11 invoice from a Cashu account in a single CLI call.

**Non-goals:**
- **Amountless invoices.** TS gates them off (`Cashu accounts do not support amountless lightning invoices`); slice 8 does the same. CDK 0.15 *does* expose `MeltOptions::Amountless`, but the TS gate is normative and we keep the surface narrow.
- **MPP (Multi-part payments).** `MeltOptions::Mpp` exists in CDK; slice 8 always sends `options: None`.
- **NUT-08 deterministic change blanks.** TS allocates `numberOfChangeOutputs` blanks for fee-reserve change. Slice 8 will request change blanks (it's how the mint refunds the unused fee reserve), but uses *positional* matching of returned `BlindSignatures` to `BlindedMessages`. The TS code re-derives `OutputData` and matches via DLEQ verification because both CDK and Nutshell reorder change. Slice 8 trusts CDK's helper-driven path: build deterministic blinded messages, send, unblind via `construct_proofs`, accept what comes back. If a mint reorders change, the resulting unblind will fail and we surface a `Mint` error — note the limitation in commit body. Real change-matching by DLEQ comes later.
- **Cross-currency / FX.** Quote unit must match the account currency (BTC→sat, USD→cent). No exchange-rate conversion in slice 8.
- **Lightning Address (LUD-16) destination resolution.** TS has `useGetInvoiceFromLud16` to fetch a BOLT-11 from `user@host`. Slice 8 only accepts a raw BOLT-11.
- **Quote-expiry watcher / EXPIRED transitions from CLI.** Slice 8 exposes `expire` on the storage trait + service surface so a future watcher can call it; the CLI does not. (Same pattern as slice 7.)
- **`agicash send lightning` from a Spark account.** Spark Lightning send/receive is slice 10. Slice 8 only routes to Cashu accounts.
- **NUT-15 WebSocket subscription** for `paid` notifications. Slice 8 polls `get_melt_quote_status` (mirroring TS).
- **Receiver-claim watching of leftover change proofs.** The Supabase `complete_cashu_send_quote` RPC inserts change proofs for us via `add_cashu_proofs_and_update_account`; slice 8 trusts that and emits the receipt.

**Branch:** `feat/rust-cashu-lightning-send` off `feat/rust-cashu-lightning-receive`, worktree at `~/agicash/.claude/worktrees/rust-lightning-send`. Executor uses the operator-prepared worktree.

**Operator principles (override defaults):**
1. **TS code is the blueprint.** Read `app/features/send/cashu-send-quote*.ts` end-to-end. Port APIs faithfully; deviate only where Rust ownership/async forces it or where slice 8 explicitly omits TS scope (notably amountless invoices, FX, LUD-16, and full DLEQ change matching).
2. **WASM still the goal.** Sans-IO state machine in `agicash-cashu`, native-TLS executor stays out of `agicash-wasm`.
3. **Goal: cross-environment same-wallet.** Not full TS-app feature parity.
4. **No mocking in integration tests.** Real testnut.cashu.space mint, real local Supabase, real local OpenSecret. testnut's fakewallet auto-pays melt quotes.
5. **JSON-default CLI output**, stable kebab-case error codes on stderr.

---

## WASM compatibility flag

- State machine in `agicash-cashu/src/melt_quote/state.rs` is **sans-IO** — pure state transitions. Compiles to wasm trivially.
- Executor (`melt_quote/service.rs`) uses CDK which carries native-TLS reqwest — stays out of `agicash-wasm`.
- `ProofEncryption` trait reused; passthrough impl reused.
- Integration tests are real-network and CLI-shaped — not run on wasm.

Verify after slice: `cargo tree -p agicash-wasm | grep agicash-cashu` empty.

---

## Reference materials

| What | Path |
|------|------|
| Spec | `docs/superpowers/specs/2026-05-14-agicash-rust-sdk-design.md` — slice 8 == "Cashu Lightning send" (NUT-05). |
| Process | `~/athanor/projects/agicash-rust/PROCESS.md` |
| State | `~/athanor/projects/agicash-rust/STATE.md` |
| **Slice 7 plan (mirror structure)** | `docs/superpowers/plans/2026-05-15-rust-cashu-lightning-receive.md` |
| Slice 6 plan (proof-selection pattern) | `docs/superpowers/plans/2026-05-15-rust-cashu-send-token.md` |
| **TS service** | `app/features/send/cashu-send-quote-service.ts` |
| **TS domain** | `app/features/send/cashu-send-quote.ts` |
| **TS repository** | `app/features/send/cashu-send-quote-repository.ts` |
| **TS bolt11 helper** | `app/lib/bolt11.ts` (only `parseBolt11Invoice` + `decodeBolt11` — extract `paymentHash`, `amountMsat`, `expiryUnixMs`) |
| TS DB schema | `supabase/migrations/20260112150000_initial_db.sql` lines ~1820-2320 (`create_cashu_send_quote`, `mark_cashu_send_quote_as_pending`, `complete_cashu_send_quote`, `expire_cashu_send_quote`, `fail_cashu_send_quote`); the relevant table is `wallet.cashu_send_quotes`. |
| Slice 7 service (canonical pattern) | `crates/agicash-cashu/src/mint_quote/service.rs` |
| Slice 7 storage impl (canonical pattern) | `crates/agicash-storage-supabase/src/cashu_mint_quote_storage.rs` |
| Slice 6 send_swap (proof selection) | `crates/agicash-cashu/src/send_swap/service.rs` (`prepare_proofs_and_fee`, `select_send_proofs`, `compute_fee_for_proofs`) |
| Slice 6 send_swap storage (cashu_proof_input shape) | `crates/agicash-storage-supabase/src/cashu_send_swap_storage.rs` |
| CDK NUT-05 / NUT-23 melt types | `cashu-0.15.1/src/nuts/nut23.rs` (`MeltQuoteBolt11Request { request: Bolt11Invoice, unit, options }`, `MeltQuoteBolt11Response { quote, amount, fee_reserve, state, expiry, payment_preimage, change, request, unit }`); `cashu-0.15.1/src/nuts/nut05.rs` (`QuoteState::{Unpaid, Paid, Pending, Failed, Unknown}`, `MeltRequest::new(quote, inputs, outputs)`). |
| CDK mint connector | `cdk-0.15.1/src/wallet/mint_connector/mod.rs` (`post_melt_quote`, `get_melt_quote_status`, `post_melt`). |
| Cashu protocol NUT-05 | <https://github.com/cashubtc/nuts/blob/main/05.md> |
| Slice 7 integration test (helper to crib) | `crates/agicash-cli/tests/receive_lightning.rs` |

---

## File structure (NEW files)

```
crates/
├── agicash-cashu/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire melt_quote module
│       └── melt_quote/
│           ├── mod.rs                            # NEW
│           ├── types.rs                          # NEW — CashuMeltQuote + State enum
│           ├── storage.rs                        # NEW — CashuMeltQuoteStorage trait + DTOs
│           ├── state.rs                          # NEW — sans-IO state machine
│           ├── error.rs                          # NEW — MeltQuoteError
│           └── service.rs                        # NEW — CashuMeltQuoteService (orchestrator)
├── agicash-storage-supabase/
│   └── src/
│       ├── lib.rs                                # MODIFY — wire new module
│       └── cashu_melt_quote_storage.rs           # NEW — postgrest impl
├── agicash-cli/
│   ├── Cargo.toml                                # MODIFY (no new deps expected)
│   └── src/
│       ├── cli.rs                                # MODIFY — Send becomes a subcommand group (Token { ..., dry_run } | Lightning { invoice, .. } | LightningComplete { quote_id })
│       ├── composition.rs                        # MODIFY — wire MeltQuote deps
│       ├── main.rs                               # MODIFY — dispatch Send::Lightning + classify_melt_quote
│       └── send_lightning.rs                     # NEW — cmd_send_lightning + complete
└── agicash-cli/tests/
    └── send_lightning.rs                         # NEW — integration test
```

**Compatibility note on CLI:** slice 6 wired `agicash send <amount>` (with `--account`, `--token-version`, `--dry-run`) as the bare `send` command. Slice 8 turns `send` into a subcommand group so both flows coexist: `agicash send token <amount>` (existing semantics) and `agicash send lightning <bolt11>` / `agicash send lightning-complete <quote_id>`. **Breaking change** for any user/script using `agicash send <amount>` directly. Plan assumes hard rename (mechanical migration of slice 6 tests); flag for operator if a deprecation alias is desired. The slice-6 send-swap behavior moves wholesale into `Send::Token { amount, account, token_version, dry_run }` — same flags, same code path, different command name.

---

## Task 1: Domain — `CashuMeltQuote` + state

**Goal:** Add `CashuMeltQuote` struct + `CashuMeltQuoteState` enum to `agicash-cashu::melt_quote`. Match TS schema in `cashu-send-quote.ts` exactly. State machine has FOUR mid-states (UNPAID → PENDING → PAID, plus terminal EXPIRED + FAILED) — Lightning melts can take seconds to minutes, so PENDING is a real long-running state, not an instant blip.

**Files:**
- Create: `crates/agicash-cashu/src/melt_quote/types.rs`
- Create: `crates/agicash-cashu/src/melt_quote/mod.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-send-quote.ts` end-to-end. Note every base-schema field (`id`, `userId`, `accountId`, `paymentRequest`, `paymentHash`, `amountRequested`, `amountRequestedInMsat`, `amountReceived`, `lightningFeeReserve`, `cashuFee`, `quoteId`, `proofs`, `amountReserved`, `destinationDetails`, `keysetId`, `keysetCounter`, `numberOfChangeOutputs`, `transactionId`, `version`, `createdAt`, `expiresAt`) and the five state shapes (`UNPAID`, `PENDING`, `EXPIRED`, `FAILED { failureReason }`, `PAID { paymentPreimage, lightningFee, amountSpent, totalFee }`).

- [ ] **Step 2:** Create `crates/agicash-cashu/src/melt_quote/types.rs`:

```rust
use crate::receive_swap::TokenProof;
use agicash_domain::{AccountId, UserId};
use agicash_money::Money;
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One persisted Cashu lightning-send quote row (NUT-05 melt).
///
/// Mirrors `app/features/send/cashu-send-quote.ts`. Slice 8 covers the
/// direct-bolt11 branch only — `destinationDetails` (Lightning address /
/// agicash contact) is intentionally omitted for now.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct CashuMeltQuote {
    /// UUID of the quote row (DB primary key).
    pub id: Uuid,
    /// Mint-side melt-quote id. Used to call NUT-23 `melt_quote/status` and
    /// `melt`. Stored encrypted on the DB row.
    pub quote_id: String,
    pub user_id: UserId,
    pub account_id: AccountId,
    /// BOLT-11 invoice the mint will pay on our behalf.
    pub payment_request: String,
    /// Payment hash of the BOLT-11 invoice (lowercase hex). Searchable.
    pub payment_hash: String,
    /// Amount the user asked to send (could be in any currency for FX-ready
    /// flows; slice 8 always equals `amount_received`).
    pub amount_requested: Money,
    /// `amount_requested` converted to milli-satoshis. For BTC accounts this
    /// matches the invoice's amount-msat; for USD-unit mints the conversion
    /// is what the mint will quote against. Slice 8 derives this from the
    /// BOLT-11 invoice (no FX), so it always matches the invoice msat.
    pub amount_requested_in_msat: u64,
    /// Amount the receiver will get, in the account's currency.
    pub amount_received: Money,
    /// Mint-quoted Lightning fee reserve, in the account's currency.
    pub lightning_fee_reserve: Money,
    /// Mint-quoted cashu input fee for the proofs we'll spend.
    pub cashu_fee: Money,
    /// Proofs reserved for the melt. Sum >= amount_received + lightning_fee_reserve + cashu_fee.
    pub proofs: Vec<TokenProof>,
    /// Sum of `proofs` in the account's currency.
    pub amount_reserved: Money,
    /// Keyset used to derive the change blank outputs.
    pub keyset_id: String,
    /// Counter at the time the quote was created (DB-side reservation bumps
    /// the account counter by `number_of_change_outputs`; this captures the
    /// pre-bump value so we can rebuild the deterministic outputs).
    pub keyset_counter: u32,
    /// Number of change blanks issued for the NUT-08 fee-reserve refund.
    pub number_of_change_outputs: u32,
    /// UUID of the corresponding wallet transaction row.
    pub transaction_id: Uuid,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub version: u32,
    /// Lifecycle state. Flattened so the serialized form mirrors the TS
    /// discriminated-union shape.
    #[serde(flatten)]
    pub state: CashuMeltQuoteState,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", rename_all = "UPPERCASE")]
pub enum CashuMeltQuoteState {
    /// Quote created, no melt call started yet.
    Unpaid,
    /// `post_melt` issued; awaiting mint completion (Lightning payment in
    /// flight). May stay here for tens of seconds.
    Pending,
    /// Mint reports `PAID`; proofs spent + change persisted (terminal).
    Paid {
        payment_preimage: String,
        /// Actual Lightning fee charged (lightning_fee_reserve − change),
        /// in the account's currency.
        lightning_fee: Money,
        /// `amount_received + lightning_fee` — what really left the account
        /// in network terms.
        amount_spent: Money,
        /// `lightning_fee + cashu_fee`.
        total_fee: Money,
    },
    /// Quote expired before melt was initiated (terminal).
    Expired,
    /// Operational failure (terminal). `failure_reason` is the mint /
    /// network message we surface to the operator.
    Failed { failure_reason: String },
}
```

- [ ] **Step 3:** Add `crates/agicash-cashu/src/melt_quote/mod.rs`:

```rust
//! Cashu melt-quote (NUT-05 lightning-send) entity, state machine,
//! and orchestrator.
//!
//! Mirrors `app/features/send/cashu-send-quote*.ts`. Four layers:
//! - [`types`] — persisted entity + [`CashuMeltQuoteState`] enum.
//! - [`storage`] — `CashuMeltQuoteStorage` trait + DTOs.
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
  - Construct `CashuMeltQuote` in each of the five states.
  - JSON round-trip; verify discriminator + uppercase state strings + the per-state fields (`payment_preimage`/`lightning_fee`/`amount_spent`/`total_fee` for `Paid`, `failure_reason` for `Failed`).
  - `Pending` and `Expired` round-trip with no extra fields.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(cashu): add CashuMeltQuote + state types`

---

## Task 2: `CashuMeltQuoteStorage` trait + DTOs

**Goal:** Storage trait mirroring TS `CashuSendQuoteRepository`. Five operations the slice exercises: `create` (insert UNPAID + reserve proofs), `mark_as_pending` (UNPAID → PENDING), `complete` (PENDING → PAID with change proofs), `expire` (UNPAID → EXPIRED), `fail` (UNPAID/PENDING → FAILED). `get` accessor rounds out the surface.

**Files:**
- Create: `crates/agicash-cashu/src/melt_quote/storage.rs`

### Steps

- [ ] **Step 1:** Read `cashu-send-quote-repository.ts` end-to-end. Capture:
  - `create` input: encrypts a `CashuLightningSendDbDataSchema` blob (`paymentRequest`, `amountRequested`, `amountRequestedInMsat`, `amountReceived`, `lightningFeeReserve`, `cashuSendFee`, `meltQuoteId`, `amountReserved`, `destinationDetails?`) and posts to `create_cashu_send_quote` with `(p_user_id, p_account_id, p_currency, p_currency_requested, p_expires_at, p_keyset_id, p_number_of_change_outputs, p_proofs_to_send, p_encrypted_data, p_quote_id_hash, p_payment_hash)`. Returns `(quote, account, reserved_proofs)`.
  - `markAsPending` input: `mark_cashu_send_quote_as_pending(p_quote_id)`. Returns `(quote, proofs)`.
  - `complete` input: `{ quote, paymentPreimage, amountSpent, changeProofs }` — re-encrypts the data blob (now including `paymentPreimage`/`lightningFee`/`amountSpent`/`totalFee`) AND field-encrypts each change proof (amount + secret, batched), posts to `complete_cashu_send_quote(p_quote_id, p_change_proofs, p_encrypted_data)`. Returns `(quote, account, spent_proofs, change_proofs)`.
  - `expire(id)`: `expire_cashu_send_quote(p_quote_id)`. Returns `(quote, account, released_proofs)`.
  - `fail({id, reason})`: `fail_cashu_send_quote(p_quote_id, p_failure_reason)`. Returns `(quote, account, released_proofs)`.

- [ ] **Step 2:** Verify RPC parameter names match the migrations:
  - `create_cashu_send_quote`: parameters per `20260112150000_initial_db.sql` line 1826. Slice 8 omits `purpose` / `transfer_id` since they're not yet present in the SQL signature (cf. `20260306120000_add_transaction_purpose_and_transfer_id.sql` only adds these to receive-side quotes for now). Returns `wallet.create_cashu_send_quote_result`.
  - `mark_cashu_send_quote_as_pending`: line 1969. Returns `wallet.mark_cashu_send_quote_as_pending_result`.
  - `complete_cashu_send_quote`: line 2032. `p_change_proofs` is `wallet.cashu_proof_input[]`. Returns `wallet.complete_cashu_send_quote_result`.
  - `expire_cashu_send_quote`: line 2133. Returns `wallet.expire_cashu_send_quote_result`. Server-side guard rejects from non-UNPAID and from quotes that haven't yet expired.
  - `fail_cashu_send_quote`: line 2235. Returns `wallet.fail_cashu_send_quote_result`. Server-side guard rejects from PAID/EXPIRED.

- [ ] **Step 3:** Create `crates/agicash-cashu/src/melt_quote/storage.rs`:

```rust
use super::types::CashuMeltQuote;
use crate::receive_swap::TokenProof;
use agicash_domain::{Account, AccountId, UserId};
use agicash_money::Money;
use agicash_traits::EncryptionError;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use uuid::Uuid;

#[async_trait]
pub trait CashuMeltQuoteStorage: Send + Sync {
    /// Persist a new UNPAID melt quote, reserving the chosen input proofs
    /// and bumping the account's keyset counter by
    /// `input.number_of_change_outputs`.
    async fn create(
        &self,
        input: CreateMeltQuote,
    ) -> Result<CreateMeltQuoteResult, MeltQuoteStorageError>;

    /// Transition UNPAID → PENDING. Idempotent on PENDING (returns the
    /// existing row). Rejects from PAID/FAILED/EXPIRED with InvalidState.
    async fn mark_as_pending(
        &self,
        quote_id: Uuid,
    ) -> Result<CashuMeltQuote, MeltQuoteStorageError>;

    /// Transition UNPAID/PENDING → PAID with change proofs. Idempotent on
    /// PAID (returns existing row + account + already-spent proofs +
    /// already-credited change proofs).
    async fn complete(
        &self,
        input: CompleteMeltQuote,
    ) -> Result<CompleteMeltQuoteResult, MeltQuoteStorageError>;

    /// UNPAID → EXPIRED. Idempotent on EXPIRED. Server-side guard rejects
    /// when invoice has not yet passed its `expires_at`.
    async fn expire(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError>;

    /// UNPAID/PENDING → FAILED. Idempotent on FAILED. Server-side guard
    /// rejects from PAID/EXPIRED.
    async fn fail(
        &self,
        quote_id: Uuid,
        reason: &str,
    ) -> Result<CashuMeltQuote, MeltQuoteStorageError>;

    /// Fetch a single quote by primary key. Returns
    /// [`MeltQuoteStorageError::NotFound`] if absent.
    async fn get(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError>;
}

/// Input to [`CashuMeltQuoteStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateMeltQuote {
    pub user_id: UserId,
    pub account_id: AccountId,
    pub payment_request: String,
    pub payment_hash: String,
    pub expires_at: DateTime<Utc>,
    /// Mint-side melt quote id (plaintext); the hash goes into `quote_id_hash`.
    pub quote_id: String,
    pub amount_requested: Money,
    pub amount_requested_in_msat: u64,
    /// Account currency. Drives `p_currency` (account unit) and
    /// `p_currency_requested` (slice 8 always passes the same value — no
    /// FX yet).
    pub amount_received: Money,
    pub lightning_fee_reserve: Money,
    pub cashu_fee: Money,
    /// Proofs reserved for the send.
    pub proofs: Vec<TokenProof>,
    /// DB row ids of the proofs to reserve (matches TS
    /// `inputProofs.map((p) => p.id)`).
    pub proof_ids: Vec<Uuid>,
    /// Sum of `proofs` in the account's currency.
    pub amount_reserved: Money,
    pub keyset_id: String,
    pub number_of_change_outputs: u32,
}

/// Output of [`CashuMeltQuoteStorage::create`].
#[derive(Debug, Clone, PartialEq)]
pub struct CreateMeltQuoteResult {
    pub quote: CashuMeltQuote,
    pub account: Account,
}

/// Input to [`CashuMeltQuoteStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMeltQuote {
    pub quote: CashuMeltQuote,
    pub payment_preimage: String,
    /// Amount actually spent (proofs reserved minus change). Used to
    /// compute `lightning_fee = amount_spent - amount_received - cashu_fee`.
    pub amount_spent: Money,
    /// Change proofs (NUT-08 fee-reserve refund). May be empty if the mint
    /// charged the full reserve.
    pub change_proofs: Vec<TokenProof>,
}

/// Output of [`CashuMeltQuoteStorage::complete`].
#[derive(Debug, Clone, PartialEq)]
pub struct CompleteMeltQuoteResult {
    pub quote: CashuMeltQuote,
    pub account: Account,
    /// IDs of the change-proof rows the RPC inserted (mirrors TS
    /// `data.change_proofs.map((x) => x.id)`).
    pub added_change_proofs: Vec<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum MeltQuoteStorageError {
    /// The DB rejected reserving the chosen input proofs because they were
    /// modified by a concurrent transaction
    /// (`hint = 'CONCURRENCY_ERROR'`).
    #[error("concurrent modification: {0}")]
    Concurrency(String),
    /// No quote row matches the supplied id.
    #[error("not found")]
    NotFound,
    /// Server rejected a state transition.
    #[error("invalid state transition: {0}")]
    InvalidState(String),
    /// Generic storage-backend failure (network, JSON decoding, postgrest
    /// status code, etc.).
    #[error("storage backend error: {0}")]
    Backend(String),
    /// The encryption seam returned an error.
    #[error("encryption error: {0}")]
    Encryption(#[from] EncryptionError),
}
```

**Notes:**
- Reuses `TokenProof` from `crate::receive_swap` for proof shape (same as slice 5/6/7).
- `proof_ids` is required because the DB needs to find the proof rows by id to mark them RESERVED. Slice 6 (`CreateSendSwap.input_proof_ids`) follows the same pattern.
- Slice 8 deliberately omits `destination_details`, `purpose`, `transfer_id` — the TS schema supports them but the Rust DTO is additive: future slices can extend without breaking callers.
- `number_of_change_outputs` is the DB column the RPC uses to bump the account's keyset counter. Matches TS `numberOfChangeOutputs`.

- [ ] **Step 4:** Compile-only test asserting each DTO + error variant constructs and `MeltQuoteStorageError: Send + Sync`.

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(cashu): add CashuMeltQuoteStorage trait + DTOs`

---

## Task 3: Sans-IO state machine in `agicash-cashu`

**Goal:** Pure state machine driving the melt quote forward. No async, no I/O.

**Files:**
- Create: `crates/agicash-cashu/src/melt_quote/state.rs`
- Create: `crates/agicash-cashu/src/melt_quote/error.rs`
- Modify: `crates/agicash-cashu/src/lib.rs`

### Steps

- [ ] **Step 1:** Design the machine. Five terminal-or-mid states plus a `NotStarted` pseudo-state:

```rust
// crates/agicash-cashu/src/melt_quote/state.rs

use super::error::MeltQuoteError;
use super::types::{CashuMeltQuote, CashuMeltQuoteState};

#[derive(Debug, Clone)]
pub struct MeltQuoteMachine {
    state: MachineState,
}

/// Internal state. Each variant corresponds 1:1 with a persisted DB state
/// except `NotStarted`.
#[derive(Debug, Clone)]
pub enum MachineState {
    /// Quote not yet requested from the mint.
    NotStarted,
    /// Persisted UNPAID — proofs reserved, no melt call started.
    Unpaid(CashuMeltQuote),
    /// Persisted PENDING — melt in flight (Lightning payment in progress).
    Pending(CashuMeltQuote),
    /// Persisted PAID (terminal).
    Paid(CashuMeltQuote),
    /// Persisted EXPIRED (terminal).
    Expired(CashuMeltQuote),
    /// Persisted FAILED (terminal).
    Failed(CashuMeltQuote),
}

/// Next I/O the executor should perform.
#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    /// Ask the mint for a NUT-05 melt quote and persist the row.
    RequestQuote,
    /// Mark UNPAID → PENDING (storage RPC) and call `post_melt`.
    InitiateMelt { quote_id: String },
    /// Poll the mint's `melt_quote/status` endpoint while in PENDING.
    PollStatus { quote_id: String },
    /// Persist the resulting change proofs and transition PENDING → PAID.
    CompleteQuote { change_proofs_count: usize },
    /// Expire UNPAID quote.
    Expire,
    /// Fail UNPAID/PENDING quote with reason.
    Fail { reason: String },
    /// Terminal — nothing more to do.
    None,
}

/// Event the executor feeds back after performing an [`Action`].
#[derive(Debug, Clone)]
pub enum Event {
    /// Storage created the UNPAID quote row.
    QuoteRequested(CashuMeltQuote),
    /// Storage transitioned UNPAID → PENDING.
    QuoteMarkedPending(CashuMeltQuote),
    /// Mint reports the melt still pending; stay in `Pending`.
    PollSawPending,
    /// Mint reports the invoice unpaid (fail-back from PENDING — mint gave up).
    PollSawUnpaid,
    /// Mint reports the melt paid AND the executor has persisted the
    /// PAID transition.
    QuoteCompleted(CashuMeltQuote),
    /// Storage transitioned UNPAID → EXPIRED.
    QuoteExpired(CashuMeltQuote),
    /// Storage transitioned UNPAID/PENDING → FAILED.
    QuoteFailed(CashuMeltQuote),
}

impl MeltQuoteMachine {
    pub fn new() -> Self { Self { state: MachineState::NotStarted } }
    pub fn from_existing(quote: CashuMeltQuote) -> Self {
        let state = match &quote.state {
            CashuMeltQuoteState::Unpaid => MachineState::Unpaid(quote),
            CashuMeltQuoteState::Pending => MachineState::Pending(quote),
            CashuMeltQuoteState::Paid { .. } => MachineState::Paid(quote),
            CashuMeltQuoteState::Expired => MachineState::Expired(quote),
            CashuMeltQuoteState::Failed { .. } => MachineState::Failed(quote),
        };
        Self { state }
    }
    pub fn state(&self) -> &MachineState { &self.state }
    pub fn is_terminal(&self) -> bool {
        matches!(
            self.state,
            MachineState::Paid(_) | MachineState::Expired(_) | MachineState::Failed(_)
        )
    }
    pub fn next_action(&self) -> Action {
        match &self.state {
            MachineState::NotStarted => Action::RequestQuote,
            MachineState::Unpaid(q) => Action::InitiateMelt { quote_id: q.quote_id.clone() },
            MachineState::Pending(q) => Action::PollStatus { quote_id: q.quote_id.clone() },
            MachineState::Paid(_) | MachineState::Expired(_) | MachineState::Failed(_) => Action::None,
        }
    }
    pub fn apply(&mut self, event: Event) -> Result<(), MeltQuoteError> { /* see Step 2 */ }
}
```

- [ ] **Step 2:** Implement `apply` per the diagram:

```text
NotStarted ──RequestQuote──> QuoteRequested ──> Unpaid

Unpaid ──InitiateMelt──> QuoteMarkedPending ──> Pending
        │
        ├──[on melt success without intermediate PENDING]──QuoteCompleted──> Paid
        │
        ├──Expire──> QuoteExpired ──> Expired (terminal)
        └──Fail──>  QuoteFailed ──> Failed (terminal)

Pending ──PollStatus──> PollSawPending ──> [stay] (executor sleeps + polls again)
                     │
                     ├──QuoteCompleted──> Paid (terminal)
                     │
                     ├──PollSawUnpaid──> [executor decides; usually Fail or InitiateMelt again]
                     │
                     └──Fail──> QuoteFailed ──> Failed (terminal)
```

The transitions to surface as errors (`InvalidTransition`): applying `QuoteCompleted` from Unpaid (must go via Pending OR via the synchronous "post_melt returned PAID" path which still emits QuoteMarkedPending+QuoteCompleted in sequence), applying `PollSawPending` from anywhere except Pending, applying `QuoteExpired` from Pending/Paid/Failed, applying any event to Paid/Expired/Failed terminal states. Mirror slice 7's error formatting.

**Important:** the synchronous "fast PAID" path (some mints settle the melt within the `post_melt` request) still requires the machine to walk Unpaid → Pending → Paid. The orchestrator emits `QuoteMarkedPending` before the melt RPC, then `QuoteCompleted` after. Don't add a direct Unpaid → Paid transition; keep the machine narrow.

Also accept `QuoteCompleted` from Unpaid (single transition) — it's necessary for the case where storage's `complete_cashu_send_quote` allows UNPAID → PAID directly (per the SQL guard `state in ('UNPAID', 'PENDING')`). Concretely: the orchestrator marks PENDING then completes — but if mark-pending fails midway (e.g. network blip after the DB updated but before the response came back), the next session can re-drive the still-UNPAID quote and the SQL accepts the direct UNPAID → PAID transition. Add a tolerant Unpaid → Paid arm that accepts `QuoteCompleted`.

- [ ] **Step 3:** Unit tests covering every transition:
  - Happy path (slow): NotStarted → RequestQuote → QuoteRequested → Unpaid → InitiateMelt → QuoteMarkedPending → Pending → PollStatus → PollSawPending → [stay] → QuoteCompleted → Paid.
  - Happy path (fast): NotStarted → ... → Unpaid → QuoteMarkedPending → Pending → QuoteCompleted → Paid (no poll).
  - Tolerant fast-PAID path: Unpaid → QuoteCompleted → Paid (no Pending in between, simulating mark-pending side-effect persisted but response lost).
  - PollSawUnpaid: Pending → PollSawUnpaid → [stay Pending] (executor decides next action externally).
  - Expire from Unpaid: Unpaid → QuoteExpired → Expired.
  - Fail from Unpaid: Unpaid → QuoteFailed → Failed.
  - Fail from Pending: Pending → QuoteFailed → Failed.
  - Invalid: PollSawPending from Unpaid → InvalidTransition.
  - Invalid: QuoteExpired from Pending → InvalidTransition.
  - Invalid: any event applied to Paid/Expired/Failed → InvalidTransition.
  - `from_existing(PAID).is_terminal() == true`.

- [ ] **Step 4:** Create `error.rs`:

```rust
use super::storage::MeltQuoteStorageError;
use agicash_traits::CashuProviderError;

#[derive(Debug, thiserror::Error)]
pub enum MeltQuoteError {
    #[error("invalid state transition from {from} on event {event}")]
    InvalidTransition { from: String, event: String },
    #[error("storage error: {0}")]
    Storage(#[from] MeltQuoteStorageError),
    #[error("mint error: {0}")]
    Mint(#[from] CashuProviderError),
    #[error("invalid bolt11 invoice: {0}")]
    InvalidInvoice(String),
    #[error("amountless invoice not supported")]
    AmountlessInvoice,
    #[error("amount too small")]
    AmountTooSmall,
    #[error("currency mismatch: account {account} differs from request {request}")]
    CurrencyMismatch { account: String, request: String },
    #[error("insufficient balance: need {needed}, have {have}")]
    InsufficientBalance { needed: String, have: String },
    #[error("quote expired before payment")]
    QuoteExpired,
    #[error("quote not yet pending")]
    QuoteNotPending,
    #[error("melt failed at mint: {0}")]
    MeltFailed(String),
    #[error("melt unrecoverable: {0}")]
    Unrecoverable(String),
}
```

- [ ] **Step 5:** Wire into `agicash-cashu/src/lib.rs`:

```rust
pub mod melt_quote;
pub use melt_quote::{
    Action as MeltQuoteAction, CashuMeltQuote, CashuMeltQuoteService, CashuMeltQuoteState,
    CashuMeltQuoteStorage, CompleteMeltQuote, CompleteMeltQuoteOutcome, CompleteMeltQuoteResult,
    CreateMeltQuote, CreateMeltQuoteResult, Event as MeltQuoteEvent, MeltQuoteError,
    MeltQuoteMachine, MeltQuoteStorageError,
};
```

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cashu): sans-IO state machine for melt quote`

---

## Task 4: `CashuMeltQuoteService` (orchestrator)

**Goal:** Drives `MeltQuoteMachine` forward, performs I/O. Mirrors TS `CashuSendQuoteService` — exposes `get_quote` (preview), `create_quote`, `initiate_melt`, `poll_until_complete`, `expire`, `fail`. Slice 8 ships these primitives; the CLI composes them into the one-shot UX.

**Files:**
- Create: `crates/agicash-cashu/src/melt_quote/service.rs`

### Steps

- [ ] **Step 1:** Re-read TS `cashu-send-quote-service.ts` end-to-end. Critical sections:
  - `getLightningQuote` (lines 98-199) — Rust version calls `wallet.connector().post_melt_quote(MeltQuoteBolt11Request { request: bolt11, unit, options: None })`. Decodes the bolt11 to extract `paymentHash`, `amountMsat`, `expiresAt`. Selects proofs. **Slice 8 errors on amountless invoices** per non-goals.
  - `createSendQuote` (lines 204-323) — slice 8 covers the direct-bolt11 branch (no `destinationDetails`).
  - `initiateSend` (lines 330-360) — calls `wallet.meltProofsIdempotent(meltQuote, proofs, { keysetId }, { type: 'deterministic', counter: keysetCounter })`. Rust equivalent: `wallet.connector().post_melt(MeltRequest::new(quote_id, proofs, Some(blinded_messages_for_change)))`.
  - `markSendQuoteAsPending` (lines 368-380) — wraps the storage RPC.
  - `completeSendQuote` (lines 388-457) — verifies `MeltQuoteState::Paid`, re-derives the deterministic change `OutputData`, matches `meltQuote.change` to OutputData (TS uses DLEQ matching; slice 8 uses positional via CDK's `construct_proofs` — see non-goals + commit body warning), computes `amount_spent`, calls `storage.complete`.
  - `failSendQuote` (lines 465-499) — checks the latest melt-quote state via the mint and only fails if mint reports UNPAID.
  - `expireSendQuote` (lines 507-521).

- [ ] **Step 2:** Implement:

```rust
// crates/agicash-cashu/src/melt_quote/service.rs

use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use agicash_domain::{Account, Currency, UserId};
use agicash_money::{Money, Unit};
use agicash_traits::{CashuMintWallet, CashuProvider, CashuProviderError};
use cdk::amount::{FeeAndAmounts, SplitTarget};
use cdk::dhke::construct_proofs;
use cdk::nuts::nut02::Id as KeysetId;
use cdk::nuts::nut05::QuoteState as MeltQuoteState;
use cdk::nuts::{
    BlindedMessage, CurrencyUnit, KeySet, KeySetInfo, MeltOptions, MeltQuoteBolt11Request,
    MeltRequest, PaymentMethod, PreMintSecrets, Proof, RestoreRequest,
};
use cdk::Amount;
use chrono::{DateTime, TimeZone, Utc};
use lightning_invoice::Bolt11Invoice;
use rust_decimal::prelude::ToPrimitive;
use rust_decimal::Decimal;

use super::error::MeltQuoteError;
use super::state::{Action, Event, MachineState, MeltQuoteMachine};
use super::storage::{
    CashuMeltQuoteStorage, CompleteMeltQuote, CompleteMeltQuoteResult, CreateMeltQuote,
    CreateMeltQuoteResult,
};
use super::types::{CashuMeltQuote, CashuMeltQuoteState};
use crate::receive_swap::types::TokenProof;
use crate::send_swap::ProofWithId;

/// Service that orchestrates NUT-05 melt quotes (Lightning sends).
#[derive(Clone)]
pub struct CashuMeltQuoteService {
    storage: Arc<dyn CashuMeltQuoteStorage>,
    cashu_provider: Arc<dyn CashuProvider>,
}

impl CashuMeltQuoteService {
    pub fn new(
        storage: Arc<dyn CashuMeltQuoteStorage>,
        cashu_provider: Arc<dyn CashuProvider>,
    ) -> Self {
        Self { storage, cashu_provider }
    }

    /// Compute fees + proof selection for a hypothetical melt. Does not
    /// persist. Mirrors TS `getLightningQuote`. Returns the parsed
    /// `MeltQuoteBolt11Response` plus the prepared proofs so `create_quote`
    /// can reuse the work without re-quoting.
    pub async fn get_quote(
        &self,
        account: &Account,
        proofs: &[ProofWithId],
        bolt11: &str,
    ) -> Result<MeltQuotePreview, MeltQuoteError> {
        // 1. Parse bolt11 via lightning-invoice; reject amountless +
        //    expired.
        // 2. Map account.currency -> CurrencyUnit (Btc -> Sat, Usd -> Usd).
        // 3. wallet = cashu_provider.wallet_for_account(account).await?
        // 4. melt_quote = wallet.connector().post_melt_quote(
        //        MeltQuoteBolt11Request { request: invoice, unit, options: None }
        //    ).await
        // 5. Compute amount_to_send = melt_quote.amount + melt_quote.fee_reserve
        // 6. Select proofs covering amount_to_send + estimated cashu fee
        //    via slice-6's select_send_proofs / compute_fee_for_proofs.
        // 7. Pack a MeltQuotePreview { melt_quote, prepared_proofs,
        //    amount_received, lightning_fee_reserve, cashu_fee, ... }.
    }

    /// Persist the UNPAID melt-quote row, reserve proofs. Returns the
    /// created quote with its DB id.
    pub async fn create_quote(
        &self,
        user_id: UserId,
        account: &Account,
        preview: MeltQuotePreview,
    ) -> Result<CreateMeltQuoteResult, MeltQuoteError> {
        // 1. Re-validate quote not expired.
        // 2. Pick active keyset for unit; compute number_of_change_outputs.
        //    Mirror TS:
        //       max_change = sum(proofs) - melt.amount - cashu_fee
        //       n = max_change == 0 ? 0 : ceil(log2(max_change)) || 1
        // 3. Build CreateMeltQuote { ... } and call storage.create.
        // 4. Return CreateMeltQuoteResult { quote, account }.
    }

    /// UNPAID → PENDING + call `post_melt`. On success returns a
    /// `MeltOutcome` enum that the caller dispatches on:
    /// - `Paid { change_proofs, payment_preimage }` — mint settled inline.
    /// - `Pending` — Lightning payment is in flight; caller should poll.
    /// - `Failed(reason)` — mint refused or returned a failure.
    pub async fn initiate_melt(
        &self,
        account: &Account,
        quote: CashuMeltQuote,
        seed: &[u8; 64],
    ) -> Result<MeltOutcome, MeltQuoteError> {
        // 1. machine = MeltQuoteMachine::from_existing(quote.clone())
        //    if machine.is_terminal() return Err(InvalidTransition)
        //    if state is Pending -> caller should call poll_until_complete.
        //    if state is Paid -> Ok(MeltOutcome::Paid(quote))
        // 2. wallet = cashu_provider.wallet_for_account(account).await?
        // 3. Mark pending: storage.mark_as_pending(quote.id) → updated_quote.
        //    Apply Event::QuoteMarkedPending(updated_quote).
        // 4. Build deterministic change blinded outputs:
        //    - keyset_id = quote.keyset_id; counter = quote.keyset_counter;
        //    - amounts = vec![1; quote.number_of_change_outputs as usize] (CDK
        //      treats per-position amounts as zero-amount blanks for fee-reserve
        //      change; using `1` matches TS `Array(n).fill(1)`).
        //    - PreMintSecrets::from_seed(keyset_id, counter, seed,
        //          Amount::from(amounts.iter().sum()), &SplitTarget::Values(amounts),
        //          &fee_and_amounts).
        // 5. cdk_proofs = quote.proofs.iter().map(token_proof_to_cdk_proof)
        //    (reuse slice-6's helper or duplicate).
        // 6. response = wallet.connector().post_melt(
        //        &PaymentMethod::BOLT11,
        //        MeltRequest::new(
        //            quote.quote_id.clone(),
        //            cdk_proofs,
        //            Some(pre_mint.blinded_messages()),
        //        ),
        //    ).await
        //    Map errors:
        //        - "already paid" / TokenAlreadySpent → MeltOutcome::Paid?
        //          (the user already paid the same invoice via this quote;
        //          treat as PAID and reconcile via poll)
        //        - other network/protocol errors → MeltOutcome::Failed(msg)
        //          + storage.fail.
        // 7. Inspect response.state:
        //    - Paid: build change_proofs via construct_proofs(response.change,
        //      pre_mint.rs(), pre_mint.secrets(), &keyset_keys.keys);
        //      compute amount_spent = sum(quote.proofs) -
        //      sum(change_proof_amounts) (in account's unit); call
        //      storage.complete(...); apply Event::QuoteCompleted.
        //      Return MeltOutcome::Paid { quote, change_proofs }.
        //    - Pending: return MeltOutcome::Pending(quote).
        //    - Unpaid: storage.fail(...) + return MeltOutcome::Failed.
        //    - Failed: storage.fail(...) + return MeltOutcome::Failed.
        //    - Unknown: leave as-is, return MeltOutcome::Pending.
    }

    /// Poll the mint until `Paid`/`Failed`/`Unpaid` or timeout. On `Paid`
    /// reconciles change proofs + storage.complete; on `Failed`/`Unpaid`
    /// after a delay, calls storage.fail. On timeout, returns the still-
    /// pending quote untouched.
    pub async fn poll_until_complete(
        &self,
        account: &Account,
        quote: CashuMeltQuote,
        seed: &[u8; 64],
        poll_interval: Duration,
        timeout: Duration,
    ) -> Result<MeltOutcome, MeltQuoteError> {
        // Mirror slice 7's poll_until_paid loop. Inside the loop:
        //   status = wallet.connector().get_melt_quote_status(&quote_id).await
        //   if status.state == Paid:
        //       build change proofs from status.change (deterministic outputs
        //       reproduced from quote.keyset_id/keyset_counter/n), call
        //       storage.complete, return MeltOutcome::Paid.
        //   if status.state == Pending: sleep and continue.
        //   if status.state == Unpaid or Failed:
        //       storage.fail(quote.id, "mint reported {state}"), return Failed.
        //   if status.state == Unknown: sleep and continue.
        // On timeout return MeltOutcome::Pending(quote) unchanged.
    }

    /// Expire an UNPAID quote.
    pub async fn expire(&self, quote: &CashuMeltQuote) -> Result<CashuMeltQuote, MeltQuoteError> {
        match &quote.state {
            CashuMeltQuoteState::Expired => Ok(quote.clone()),
            CashuMeltQuoteState::Unpaid => Ok(self.storage.expire(quote.id).await?),
            _ => Err(MeltQuoteError::InvalidTransition {
                from: format!("{:?}", quote.state),
                event: "expire".into(),
            }),
        }
    }

    /// Fail an UNPAID/PENDING quote. Mirrors TS: queries the mint to ensure
    /// it's still UNPAID before failing — refusing to fail a PAID quote.
    pub async fn fail(
        &self,
        account: &Account,
        quote: &CashuMeltQuote,
        reason: &str,
    ) -> Result<CashuMeltQuote, MeltQuoteError> {
        if matches!(quote.state, CashuMeltQuoteState::Failed { .. }) {
            return Ok(quote.clone());
        }
        if !matches!(quote.state, CashuMeltQuoteState::Unpaid | CashuMeltQuoteState::Pending) {
            return Err(MeltQuoteError::InvalidTransition {
                from: format!("{:?}", quote.state),
                event: "fail".into(),
            });
        }
        let wallet = self.cashu_provider.wallet_for_account(account).await?;
        let status = wallet
            .connector()
            .get_melt_quote_status(&quote.quote_id)
            .await
            .map_err(|e| MeltQuoteError::Mint(CashuProviderError::Network(format!(
                "get_melt_quote_status: {e}"
            ))))?;
        if status.state != MeltQuoteState::Unpaid {
            return Err(MeltQuoteError::InvalidTransition {
                from: format!("mint reports {:?}", status.state),
                event: "fail".into(),
            });
        }
        Ok(self.storage.fail(quote.id, reason).await?)
    }
}

/// Output of [`CashuMeltQuoteService::get_quote`].
#[derive(Debug, Clone)]
pub struct MeltQuotePreview {
    pub bolt11: String,
    pub melt_quote_id: String,
    /// Mint's quoted amount (sat for BTC, cent for USD).
    pub amount_received: Money,
    pub lightning_fee_reserve: Money,
    pub cashu_fee: Money,
    pub total_fee: Money,
    pub total_amount: Money,
    pub amount_requested: Money,
    pub amount_requested_in_msat: u64,
    pub payment_hash: String,
    pub expires_at: DateTime<Utc>,
    pub keyset_id: String,
    pub keyset_counter: u32,
    pub number_of_change_outputs: u32,
    pub prepared_proofs: Vec<ProofWithId>,
    pub amount_reserved: Money,
}

/// Result of `initiate_melt` / `poll_until_complete`.
#[derive(Debug, Clone)]
pub enum MeltOutcome {
    /// Mint settled the melt; `quote` carries `state == Paid { ... }`.
    Paid {
        quote: CashuMeltQuote,
        account: Account,
        change_proofs_count: usize,
    },
    /// Lightning payment in flight; caller should poll.
    Pending(CashuMeltQuote),
    /// Mint refused or marked UNPAID/FAILED; quote persisted as FAILED.
    Failed(CashuMeltQuote),
}

/// Result of [`CashuMeltQuoteService::complete_melt_quote`] (used by
/// poll-then-complete callers).
#[derive(Debug, Clone)]
pub enum CompleteMeltQuoteOutcome {
    Completed { quote: CashuMeltQuote, account: Account, change_proofs_count: usize },
    AlreadyTerminal(CashuMeltQuote),
    Failed(CashuMeltQuote),
}
```

**Notes:**
- `MeltOutcome` and `CompleteMeltQuoteOutcome` overlap; consolidate if convenient (the CLI doesn't need both).
- Reuse slice-7 helpers verbatim where possible (`fetch_keyset_infos`, `fetch_keyset_keys`, `active_keyset_for_unit`, `cashu_unit_for_currency`, `unit_for_currency`, `money_to_minor_units`, `extract_payment_hash`). Where slice 7 keeps them private to `mint_quote/service.rs`, either factor them up into a shared `crates/agicash-cashu/src/cdk_helpers.rs` module or duplicate them — the slice-7 author already noted this duplication; **slice 8 also duplicates** (the refactor is a separate follow-up the operator will dispatch).
- Reuse slice-6 helpers (`select_send_proofs`, `compute_fee_for_proofs`, `token_proof_to_cdk_proof`) similarly. They're currently `pub(super)` in `send_swap/service.rs`; if rustc complains, expose them via a new pub-crate-internal helper module rather than copy-pasting.
- `lightning-invoice = "0.34"` is already a dep in `agicash-cashu/Cargo.toml`. Use `Bolt11Invoice::from_str(&bolt11)` to extract `payment_hash()`, `amount_milli_satoshis()`, and `expires_at()`.
- The `CDK` `MeltQuoteBolt11Request` carries the parsed `Bolt11Invoice` (not a string), so we parse once and feed the parsed value to the connector.
- `MeltQuoteBolt11Response.expiry: u64` is non-Optional. Convert to DateTime via `Utc.timestamp_opt(expiry as i64, 0)`.
- `MeltQuoteState::Pending` is a real CDK variant (NUT-05's `pending` state). Don't confuse with the storage layer's PENDING.
- The "fast PAID" path: if `post_melt` returns `state == Paid` synchronously, we still mark the quote PENDING first (the storage RPC), then complete. Two storage RPCs, one CDK call. Keep this discipline so the orchestrator doesn't bypass the state machine.

- [ ] **Step 3:** Unit tests (no network):
  - `get_quote` rejects amountless invoice.
  - `get_quote` rejects expired invoice.
  - `get_quote` rejects currency mismatch (account BTC, account doesn't unit-map).
  - `expire` is no-op on EXPIRED quote.
  - `expire` errors on PAID/PENDING quote.
  - `fail` is no-op on FAILED quote.
  - `fail` errors on PAID/EXPIRED quote (without touching network).
  - `initiate_melt` on PAID quote returns `MeltOutcome::Paid` immediately.
  - `initiate_melt` on EXPIRED/FAILED quote returns `InvalidTransition`.

Network-dependent paths (`get_quote` actually quoting, `initiate_melt` calling `post_melt`, `poll_until_complete` against a real mint) live in Task 7.

- [ ] **Step 4:** Clippy + fmt clean.

- [ ] **Step 5: Commit** — `feat(cashu): CashuMeltQuoteService orchestrator with CDK melt_quote + melt`

---

## Task 5: Supabase impl of `CashuMeltQuoteStorage`

**Goal:** Postgrest-backed impl mirroring TS `CashuSendQuoteRepository`. Calls the five existing RPCs.

**Files:**
- Create: `crates/agicash-storage-supabase/src/cashu_melt_quote_storage.rs`
- Modify: `crates/agicash-storage-supabase/src/lib.rs`

### Steps

- [ ] **Step 1:** Re-read `cashu-send-quote-repository.ts` end-to-end:
  - `create` encrypts `CashuLightningSendDbDataSchema` (`paymentRequest`, `amountRequested`, `amountRequestedInMsat`, `amountReceived`, `lightningFeeReserve`, `cashuSendFee`, `meltQuoteId`, `amountReserved`, `destinationDetails`). The `quote_id_hash` is SHA-256 of plaintext melt quote id.
  - `complete` re-encrypts including `paymentPreimage`, `lightningFee`, `amountSpent`, `totalFee`. Field-encrypts each change proof (amount + secret) — slice 8 follows slice 6/7's per-call passthrough loop (no batch encryption yet).
  - `markAsPending(id)`: `mark_cashu_send_quote_as_pending(p_quote_id)`.
  - `expire(id)`: `expire_cashu_send_quote(p_quote_id)`.
  - `fail({id, reason})`: `fail_cashu_send_quote(p_quote_id, p_failure_reason)`.

- [ ] **Step 2:** Implement following the slice 7 storage pattern (`SupabaseCashuMintQuoteStorage` is the canonical model — same `Arc<SupabaseStorage>` + `Arc<dyn ProofEncryption>` constructor, same `encrypt_to_base64` / `decrypt_from_base64` helpers, same `EncryptedProofInput` shape for change proofs, same `parse_account` helper for the result rows).

Skeleton:

```rust
use crate::SupabaseStorage;
use agicash_cashu::{
    CashuMeltQuote, CashuMeltQuoteState, CashuMeltQuoteStorage, CompleteMeltQuote,
    CompleteMeltQuoteResult, CreateMeltQuote, CreateMeltQuoteResult, MeltQuoteStorageError,
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
use sha2::{Digest, Sha256};
use std::sync::Arc;
use uuid::Uuid;

pub struct SupabaseCashuMeltQuoteStorage {
    base: Arc<SupabaseStorage>,
    encryption: Arc<dyn ProofEncryption>,
}

#[derive(Debug, Clone, Deserialize)]
struct CashuMeltQuoteRow {
    id: Uuid,
    created_at: DateTime<Utc>,
    expires_at: DateTime<Utc>,
    account_id: AccountId,
    user_id: UserId,
    keyset_id: String,
    keyset_counter: i32,
    number_of_change_outputs: i32,
    state: String,
    version: i32,
    failure_reason: Option<String>,
    transaction_id: Uuid,
    payment_hash: String,
    encrypted_data: String,
    // currency / currency_requested ignored (we re-derive from amounts in
    // the encrypted blob).
}

/// JSON inside `encrypted_data` (mirrors TS `CashuLightningSendDbDataSchema`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LightningSendData {
    payment_request: String,
    amount_requested: Money,
    amount_requested_in_msat: u64,
    amount_received: Money,
    lightning_fee_reserve: Money,
    cashu_send_fee: Money,
    melt_quote_id: String,
    amount_reserved: Money,
    /// Populated when the quote transitions to PAID.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    payment_preimage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    lightning_fee: Option<Money>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    amount_spent: Option<Money>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    total_fee: Option<Money>,
}

#[async_trait]
impl CashuMeltQuoteStorage for SupabaseCashuMeltQuoteStorage {
    async fn create(&self, input: CreateMeltQuote) -> Result<CreateMeltQuoteResult, MeltQuoteStorageError> {
        // 1. Build LightningSendData blob (no preimage/fee/spent yet).
        // 2. encrypt + sha256(quote_id).
        // 3. POST create_cashu_send_quote with all p_* params.
        //    - p_currency: input.amount_received.currency()
        //    - p_currency_requested: input.amount_requested.currency()
        //    - p_keyset_id: input.keyset_id
        //    - p_number_of_change_outputs: input.number_of_change_outputs
        //    - p_proofs_to_send: input.proof_ids
        //    - p_encrypted_data, p_quote_id_hash, p_payment_hash, p_expires_at,
        //      p_user_id, p_account_id.
        // 4. Detect CONCURRENCY_ERROR hint in response and map to
        //    MeltQuoteStorageError::Concurrency.
        // 5. Parse response { quote, account, reserved_proofs } -> CreateMeltQuoteResult.
    }

    async fn mark_as_pending(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError> {
        // POST mark_cashu_send_quote_as_pending {p_quote_id}; parse {quote, proofs} -> quote.
    }

    async fn complete(&self, input: CompleteMeltQuote) -> Result<CompleteMeltQuoteResult, MeltQuoteStorageError> {
        // 1. Re-encrypt LightningSendData with paymentPreimage + lightningFee +
        //    amountSpent + totalFee fields populated (compute lightning_fee =
        //    amount_spent - amount_received - cashu_fee; total_fee =
        //    lightning_fee + cashu_fee).
        // 2. Field-encrypt each change_proof's amount + secret -> EncryptedProofInput[].
        // 3. POST complete_cashu_send_quote {p_quote_id, p_change_proofs, p_encrypted_data}.
        //    Map NOT_FOUND -> NotFound, INVALID_STATE -> InvalidState.
        // 4. Parse {quote, account, spent_proofs, change_proofs} -> Result.
    }

    async fn expire(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError> {
        // POST expire_cashu_send_quote {p_quote_id}; parse {quote, account, released_proofs} -> quote.
    }

    async fn fail(&self, quote_id: Uuid, reason: &str) -> Result<CashuMeltQuote, MeltQuoteStorageError> {
        // POST fail_cashu_send_quote {p_quote_id, p_failure_reason}; parse {quote, ...} -> quote.
    }

    async fn get(&self, quote_id: Uuid) -> Result<CashuMeltQuote, MeltQuoteStorageError> {
        // GET cashu_send_quotes?id=eq.{id}. Parse first row -> quote (NotFound on empty).
    }
}
```

**Notes:**
- `wallet.cashu_send_quotes` columns reference: see Task 1's row struct.
- `complete_cashu_send_quote` returns `(quote, account, spent_proofs, change_proofs)`. Slice 8 surfaces `added_change_proofs` (IDs of `change_proofs`).
- The shared `EncryptedProofInput` (`{keysetId, amount, secret, unblindedSignature, publicKeyY, dleq?, witness?}`) is identical across slice 5/6/7 — duplicate for now; refactor in a follow-up.
- `proof_to_y(secret)` and `sha256_hex(s)` helpers are duplicated across slice 6/7 storage — duplicate again here; the refactor follow-up will collapse them.
- `quote_id_hash` is SHA-256 hex of the mint melt-quote id.

- [ ] **Step 3:** Integration tests gated behind `real-supabase-tests` (mirror slice 6/7's storage tests):
  - `create` writes an UNPAID quote + reserves proofs + bumps account counter by `number_of_change_outputs`.
  - `create` then `mark_as_pending` writes a PENDING quote.
  - `create` → `mark_as_pending` → `complete` writes change proofs + PAID quote.
  - `create` → `fail` writes FAILED quote and releases proofs.
  - `create` → wait, then `expire` writes EXPIRED quote (use `expires_at = now() - 1m`).
  - Round-trip an encrypted blob.

These tests use the service-role-key path (same as slice 6/7 storage tests).

- [ ] **Step 4:** Wire into `agicash-storage-supabase/src/lib.rs`:

```rust
pub mod cashu_melt_quote_storage;
pub use cashu_melt_quote_storage::*;
```

- [ ] **Step 5:** Clippy + fmt clean.

- [ ] **Step 6: Commit** — `feat(storage-supabase): postgrest impl for CashuMeltQuoteStorage`

---

## Task 6: CLI command `agicash send lightning <invoice>`

**Goal:** Wire the melt-quote flow to the CLI. Emits a JSON `quote-issued` event after `post_melt_quote`, then (default behaviour) initiates the melt, polls if pending, emits a final `paid` receipt.

**Files:**
- Modify: `crates/agicash-cli/src/cli.rs`
- Modify: `crates/agicash-cli/src/composition.rs`
- Create: `crates/agicash-cli/src/send_lightning.rs`
- Modify: `crates/agicash-cli/src/main.rs`
- Possibly modify: `crates/agicash-cli/src/send.rs` — keep the existing token-send module behind the new `Send::Token` subcommand. The function signatures stay the same; only the dispatch surface changes.

### Steps

- [ ] **Step 1:** Refactor `Command::Send { ... }` into a subcommand group in `cli.rs`:

```rust
Send(SendArgs),
// ...
#[derive(clap::Args, Debug)]
pub struct SendArgs {
    #[command(subcommand)]
    pub cmd: SendCommand,
}
#[derive(Subcommand, Debug)]
pub enum SendCommand {
    /// Produce a Cashu token (NUT-03 send).
    Token {
        amount: u64,
        #[arg(long)]
        account: Option<String>,
        #[arg(long, default_value_t = 4)]
        token_version: u8,
        #[arg(long)]
        dry_run: bool,
    },
    /// Pay a BOLT-11 invoice via NUT-05 melt.
    Lightning {
        /// BOLT-11 invoice to pay (must include amount).
        invoice: String,
        /// Account ID to send from. If omitted, the only Cashu account is used.
        #[arg(long)]
        account: Option<String>,
        /// Show preview without persisting or paying.
        #[arg(long)]
        dry_run: bool,
        /// If set, return the quote and exit; call `agicash send
        /// lightning-complete <quote_id>` after the melt finishes.
        #[arg(long)]
        no_wait: bool,
        /// Polling interval in milliseconds.
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        /// Overall timeout in seconds.
        #[arg(long, default_value_t = 300)]
        timeout_s: u64,
    },
    /// Finish a previously-initiated lightning send (used with `--no-wait`).
    LightningComplete {
        /// The DB quote id (UUID) returned by `send lightning --no-wait`.
        quote_id: String,
        #[arg(long, default_value_t = 1000)]
        poll_ms: u64,
        #[arg(long, default_value_t = 30)]
        timeout_s: u64,
    },
}
```

Update existing `cli.rs` tests (`parses_send_with_amount`, etc.) to use the new shape (`agicash send token 100`, `agicash send token 50 --account ... --dry-run`).

- [ ] **Step 2:** Add `MeltQuoteDeps` in `composition.rs` mirroring `MintQuoteDeps`:

```rust
pub struct MeltQuoteDeps {
    pub service: Arc<CashuMeltQuoteService>,
    pub storage: Arc<dyn CashuMeltQuoteStorage>,
}
pub fn build_melt_quote_deps(
    storage_deps: &StorageDeps,
    cashu_deps: &CashuDeps,
) -> MeltQuoteDeps {
    let encryption: Arc<dyn ProofEncryption> = Arc::new(PassthroughProofEncryption);
    let melt_storage: Arc<dyn CashuMeltQuoteStorage> = Arc::new(
        SupabaseCashuMeltQuoteStorage::new(Arc::clone(&storage_deps.storage), encryption),
    );
    let service = Arc::new(CashuMeltQuoteService::new(
        Arc::clone(&melt_storage),
        Arc::clone(&cashu_deps.provider),
    ));
    MeltQuoteDeps { service, storage: melt_storage }
}
```

- [ ] **Step 3:** Implement `cmd_send_lightning` in `send_lightning.rs`:

```rust
pub async fn cmd_send_lightning(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    send_swap_deps: &SendSwapDeps,  // for list_unspent_proofs
    melt_deps: &MeltQuoteDeps,
    invoice: String,
    account: Option<String>,
    dry_run: bool,
    no_wait: bool,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), SendLightningCmdError> {
    // 1. Load session → error NotLoggedIn.
    // 2. Resolve target Cashu account (same selection logic as `send token`).
    // 3. Load unspent proofs via send_swap_deps.storage.list_unspent_proofs.
    // 4. preview = melt_deps.service.get_quote(&account, &proofs, &invoice).await?
    // 5. If dry_run: print preview JSON `{ status: "quote", ... }` and return.
    // 6. created = melt_deps.service.create_quote(user_id, &account, preview).await?
    //    print `quote-issued` JSON with quote_id + invoice + amount + fee_reserve.
    // 7. If no_wait: return (the user calls `send lightning-complete <id>`).
    // 8. seed = auth.client.get_cashu_seed().await?
    // 9. outcome = melt_deps.service.initiate_melt(&account, created.quote, &seed).await?
    //    match outcome:
    //      Paid { quote, .. }   -> print `paid` JSON; return Ok.
    //      Pending(q)           -> proceed to poll.
    //      Failed(q)            -> print `failed` JSON; return Ok (process exits 0;
    //                              soft-failure surfaces in body, not exit code).
    // 10. poll_outcome = melt_deps.service.poll_until_complete(&account, q, &seed,
    //         Duration::from_millis(poll_ms), Duration::from_secs(timeout_s)).await?
    //     match: Paid -> print paid; Pending -> print timed-out; Failed -> print failed.
}

pub async fn cmd_send_lightning_complete(
    auth: &AuthDeps,
    storage_deps: &StorageDeps,
    melt_deps: &MeltQuoteDeps,
    quote_id: String,
    poll_ms: u64,
    timeout_s: u64,
) -> Result<(), SendLightningCmdError> {
    // 1. Load session.
    // 2. Uuid::parse_str(&quote_id) → InvalidQuoteId.
    // 3. quote = melt_deps.storage.get(quote_id).await?
    // 4. Verify quote.user_id == session.user_id.
    // 5. Resolve account from quote.account_id.
    // 6. seed = auth.client.get_cashu_seed().await?
    // 7. If quote.state is Unpaid: outcome = service.initiate_melt(...).
    //    If quote.state is Pending: outcome = service.poll_until_complete(...).
    //    If quote.state is Paid: print paid + return.
    //    If terminal (Expired/Failed): print accordingly.
}

#[derive(Debug, thiserror::Error)]
pub enum SendLightningCmdError {
    #[error("not logged in")] NotLoggedIn,
    #[error("no matching account")] NoMatchingAccount,
    #[error("account ambiguous — pass --account <id>")] AccountAmbiguous,
    #[error("invalid account id: {0}")] InvalidAccountId(String),
    #[error("invalid quote id: {0}")] InvalidQuoteId(String),
    #[error(transparent)] Quote(#[from] MeltQuoteError),
    #[error(transparent)] Storage(#[from] StorageError),
    #[error(transparent)] Auth(#[from] AuthError),
}
```

JSON shapes:

```json
// dry-run:
{
  "status": "quote",
  "amount": "<sat>",
  "lightning_fee_reserve": "<sat>",
  "cashu_fee": "<sat>",
  "total_fee": "<sat>",
  "total_amount": "<sat>",
  "unit": "sat",
  "currency": "BTC",
  "account_id": "...",
  "payment_hash": "..."
}

// quote-issued (after create_quote, before initiate_melt):
{
  "status": "quote-issued",
  "quote_id": "...",
  "invoice": "lnbc...",
  "amount": "<sat>",
  "lightning_fee_reserve": "<sat>",
  "cashu_fee": "<sat>",
  "total_fee": "<sat>",
  "expires_at": "...",
  "account_id": "...",
  "payment_hash": "..."
}

// paid (success):
{
  "status": "paid",
  "quote_id": "...",
  "amount": "<sat>",
  "lightning_fee": "<sat>",
  "cashu_fee": "<sat>",
  "total_fee": "<sat>",
  "amount_spent": "<sat>",
  "payment_preimage": "...",
  "account_id": "...",
  "payment_hash": "..."
}

// timed-out (still pending after poll):
{ "status": "timed-out", "quote_id": "...", "payment_hash": "..." }

// failed:
{ "status": "failed", "quote_id": "...", "reason": "..." }
```

- [ ] **Step 4:** Dispatch in `main.rs`. Add `SendLightningCmdError` to `classify_error` with kebab-case codes: `not-logged-in`, `no-matching-account`, `account-ambiguous`, `invalid-account-id`, `invalid-quote-id`, plus a `classify_melt_quote(&MeltQuoteError)` helper mapping `InvalidInvoice → invalid-invoice`, `AmountlessInvoice → amountless-invoice-unsupported`, `AmountTooSmall → amount-too-small`, `CurrencyMismatch → currency-mismatch`, `InsufficientBalance → insufficient-balance`, `QuoteExpired → quote-expired`, `QuoteNotPending → quote-not-pending`, `MeltFailed → melt-failed`, `Unrecoverable → mint-unrecoverable`, plus the inner `Storage` (NotFound/InvalidState/Backend/Encryption/Concurrency) and `Mint` (InvalidUrl/Network/Protocol) variants — same shape as `classify_mint_quote` from slice 7.

Update the existing `Command::Send { ... }` dispatch to handle `SendCommand::Token { ... }`. The `send::cmd_send` function signature doesn't change — only the call site moves into the `Token` arm.

- [ ] **Step 5:** Smoke test: `cargo run -p agicash-cli -- send lightning --help`.

- [ ] **Step 6:** Clippy + fmt clean.

- [ ] **Step 7: Commit** — `feat(cli): add 'agicash send lightning <invoice>' command`

---

## Task 7: Integration test against real mint

**Goal:** E2E test: `agicash send lightning <invoice>` against testnut.cashu.space — testnut's fakewallet auto-pays melts via its internal Lightning — verify the quote reaches PAID and balance drops.

**Files:**
- Create: `crates/agicash-cli/tests/send_lightning.rs`

### Steps

- [ ] **Step 1:** Reuse the helper pattern from `crates/agicash-cli/tests/receive_lightning.rs`. The test needs to first fund the account via `agicash receive lightning N` (to have proofs to spend), then generate a BOLT-11 to pay (testnut accepts arbitrary invoices payable via its fakewallet — generate one by calling `agicash receive lightning M --no-wait` for a SECOND testnut session and using THAT invoice as the payment target). Two-account dance: account A pays, account B receives.

Actually simpler approach: testnut allows you to pay any BOLT-11; we can use a known throwaway invoice or generate one via `mint_quote` against testnut itself. Easiest:
1. `auth guest` → `mint add testnut`
2. `receive lightning 256` (fund the account — fakewallet auto-pays; balance now 256 sat)
3. `receive lightning 64 --no-wait` — capture the BOLT-11 from the JSON output
4. `send lightning <bolt11>` — pay our own outgoing invoice, mint moves money from A's reserved proofs to A's pending receive
5. `receive lightning-complete <receive_quote_id>` — mints proofs from the now-PAID receive
6. Assert `agicash balance` shows the original 256 minus fees (lightning fee tiny, cashu fees ~zero on testnut — net should be ~256).

This flow exercises the full melt round-trip without external dependencies. Note that on a single agicash account both quotes share the wallet — that's fine for the test.

- [ ] **Step 2:** Write tests gated behind `real-mint-tests,real-supabase-tests,real-opensecret-tests`:

```rust
#[cfg(all(feature = "real-mint-tests", feature = "real-supabase-tests", feature = "real-opensecret-tests"))]
mod gated {
    use assert_cmd::Command;
    const TEST_MINT_URL: &str = "https://testnut.cashu.space";

    fn env_ready() -> bool { /* same as receive_lightning.rs */ }
    fn cleanup(service: &str) { /* same */ }

    #[test]
    fn send_lightning_pays_invoice_end_to_end() {
        if !env_ready() { eprintln!("skipping: env vars not set"); return; }
        let pid = std::process::id();
        let service = format!("com.agicash.cli.test.{pid}.send-lightning-e2e");

        // 1. auth guest + mint add
        // 2. receive lightning 256 --poll-ms 500 --timeout-s 30 (fund account)
        // 3. receive lightning 64 --no-wait (capture invoice)
        // 4. send lightning <invoice> --poll-ms 500 --timeout-s 60
        //    Expect last JSON line == { "status": "paid", ... }; assert "amount" == "64".
        // 5. cleanup.
    }

    #[test]
    fn send_lightning_no_wait_returns_quote_then_complete_resolves() {
        // 1. auth guest + mint add + fund.
        // 2. receive lightning 16 --no-wait → capture invoice2.
        // 3. send lightning <invoice2> --no-wait → capture send_quote_id.
        // 4. (optional sleep)
        // 5. send lightning-complete <send_quote_id> → expect status == "paid".
    }

    #[test]
    fn send_lightning_for_missing_account_errors() {
        // auth guest; do NOT add mint.
        // send lightning <any-invoice> → expect no-matching-account.
    }

    #[test]
    fn send_lightning_for_invalid_invoice_errors() {
        // auth guest + mint add.
        // send lightning "not-a-bolt11" → expect invalid-invoice.
    }
}

#[cfg(not(all(feature = "real-mint-tests", feature = "real-supabase-tests", feature = "real-opensecret-tests")))]
#[test]
fn send_lightning_tests_skipped_without_features() {
    eprintln!("skipping; run with --features real-mint-tests,real-supabase-tests,real-opensecret-tests");
}
```

- [ ] **Step 3:** Run: `cargo test -p agicash-cli --features real-mint-tests,real-supabase-tests,real-opensecret-tests --test send_lightning -- --nocapture --test-threads=1`. PASS.

- [ ] **Step 4: Commit** — `test(cli): integration test for lightning send flow against testnut`

---

## Task 8: Final verification — slice 8 test bar

- [ ] `cargo build --workspace` clean (zero warnings).
- [ ] `cargo test --workspace` green (prior + new unit tests).
- [ ] `cargo clippy --workspace --all-targets --features "real-mint-tests real-supabase-tests real-opensecret-tests" -- -D warnings` clean.
- [ ] `cargo fmt --all --check` clean.
- [ ] `cargo test -p agicash-cashu` — state-machine unit tests pass (no network).
- [ ] `cargo test -p agicash-storage-supabase --features real-supabase-tests` — storage tests pass.
- [ ] `cargo test -p agicash-cli --features "real-mint-tests,real-supabase-tests,real-opensecret-tests" --test send_lightning -- --nocapture --test-threads=1` — e2e passes.
- [ ] `cargo tree -p agicash-wasm | grep agicash-cashu` empty.
- [ ] Smoke: `agicash send lightning --help` shows usage; `agicash send lightning <bolt11> --dry-run` (against a configured account) returns a JSON `quote` body to stdout.

---

## Acceptance criteria

1. `agicash send lightning <bolt11>` requests a NUT-05 melt quote, reserves proofs, posts melt, polls if pending, persists change proofs, returns a JSON receipt with `status: "paid"`. **Covered by Task 7's `send_lightning_pays_invoice_end_to_end` test.**
2. `agicash send lightning <bolt11> --no-wait` + `agicash send lightning-complete <quote_id>` produces the same end state with explicit user pacing. **Covered by Task 7's `send_lightning_no_wait_returns_quote_then_complete_resolves` test.**
3. `agicash send lightning <bolt11>` without a matching Cashu account on the user errors with `no-matching-account` on stderr. **Covered by Task 7's `send_lightning_for_missing_account_errors` test.**
4. `agicash send lightning <invalid>` errors with `invalid-invoice` on stderr. **Covered by Task 7's `send_lightning_for_invalid_invoice_errors` test.**
5. State machine handles every transition (UNPAID → PENDING → PAID, fast-PAID, expire, fail) + invalid transitions deterministically. **Covered by Task 3's unit tests.**
6. Postgrest impl round-trips encrypted blobs through every RPC. **Covered by Task 5's storage integration tests.**
7. WASM stays clean of `agicash-cashu`. **Covered by `cargo tree` check.**

---

## Open questions for operator

1. **Subcommand restructure of `agicash send`.** Slice 6 wired `agicash send <amount>`; slice 8 needs `agicash send lightning <invoice>`. Proposal: turn `send` into a subcommand group (`send token <amount>` / `send lightning <invoice>` / `send lightning-complete <quote_id>`). **Breaking change** for any user/script using `agicash send <amount>` directly. Recommend hard rename now (mechanical migration of slice 6 tests; no production users yet). Confirm before Task 6.

2. **DLEQ-based change-proof matching.** TS re-derives `OutputData` and matches `meltQuote.change` blind signatures by DLEQ verification rather than positional pairing, because both CDK and Nutshell return change proofs in non-deterministic order from a SQL query without `ORDER BY`. Slice 8 trusts CDK's `construct_proofs` positional path. Risk: if a mint reorders change, `construct_proofs` will surface a "construct_proofs" error and the operator sees it as a `mint-error`. testnut returns single-output change in our test sizes so this is unlikely to surface in CI; flag for a hardening slice.

3. **Polling vs. mint-side webhook.** Slice 8 polls (`get_melt_quote_status` every 1s by default). TS uses the same polling pattern. CDK 0.15 doesn't ship a NUT-15 WebSocket subscriber. Polling stays; document the timeout default (300s) + flag for tuning.

4. **Quote-expiry watcher.** Slice 8 exposes `expire` on storage + service but doesn't wire from CLI. Future cache + task-processors slice (spec step 11) covers it.

5. **Synchronous fast-PAID inside `post_melt`.** Some mints settle the melt within the `post_melt` request itself and return `state == Paid` immediately. The orchestrator still walks Unpaid → Pending → Paid in storage (two RPCs, one CDK call) so we never bypass the state machine. The state machine has a tolerant Unpaid → Paid arm to recover from the case where `mark_pending` succeeded server-side but the response was lost.

6. **`pre-commit` hooks.** Slices 5/6/7 used `PREK_ALLOW_NO_CONFIG=1`. Slice 8 worktree is branched off slice 7; same workaround applies. Use it for every commit.

7. **Helper duplication across slices 6/7/8.** All three duplicate `cashu_unit_for_currency`, `unit_for_currency`, `money_to_minor_units`, `fetch_keyset_infos`, `fetch_keyset_keys`, `active_keyset_for_unit`, `proof_to_y`, `sha256_hex`, `EncryptedProofInput`, `parse_account`, etc. Slice 7 worker noted this; slice 8 duplicates again rather than refactoring inline. **The refactor is a separate follow-up** the operator will dispatch when these crystallize. Don't block slice 8 on it.

---

## Sequence of commits

1. `feat(cashu): add CashuMeltQuote + state types` (Task 1)
2. `feat(cashu): add CashuMeltQuoteStorage trait + DTOs` (Task 2)
3. `feat(cashu): sans-IO state machine for melt quote` (Task 3)
4. `feat(cashu): CashuMeltQuoteService orchestrator with CDK melt_quote + melt` (Task 4)
5. `feat(storage-supabase): postgrest impl for CashuMeltQuoteStorage` (Task 5)
6. `feat(cli): add 'agicash send lightning <invoice>' command` (Task 6)
7. `test(cli): integration test for lightning send flow against testnut` (Task 7)
8. `style(rust): clippy nits after slice 8` (Task 8, only if needed)

Each commit prefixed with `PREK_ALLOW_NO_CONFIG=1 git commit ...`.

---

## Notes for the executor

- State machine pure; orchestrator holds I/O. Same discipline as slice 5/6/7.
- TS's `wallet.meltProofsIdempotent(...)` call corresponds to CDK's `MintConnector::post_melt(&PaymentMethod::BOLT11, MeltRequest::new(quote, inputs, outputs))`. The `outputs` field is the change blanks for NUT-08 fee-reserve refund.
- The CDK `MeltQuoteBolt11Response.expiry` is `u64` (non-Optional); NUT-04's mint-quote response has `Option<u64>`. Don't blindly copy the slice-7 pattern.
- Before calling `post_melt`, you MUST mark the quote PENDING server-side (`mark_cashu_send_quote_as_pending`). Slice 7 has no equivalent because mint quotes don't have a midstate. The order is: `storage.mark_as_pending → wallet.connector().post_melt → storage.complete (or storage.fail)`.
- `payment_hash`: extract from BOLT-11 invoice via `Bolt11Invoice::from_str(...).map(|i| hex::encode(i.payment_hash()))`. Same as slice 7's helper — duplicate it.
- `amount_milli_satoshis()` returns `Option<u64>`; `None` is the amountless case → return `MeltQuoteError::AmountlessInvoice`.
- Token send (slice 6) already exposes `get_cashu_seed()` on `OpenSecretClient`. Reuse — no plumbing needed.
- The DB RPC parameter names match the TS repo verbatim. If serializer renames a field, the RPC silently fails. Run the storage integration tests early.
- testnut.cashu.space's fakewallet auto-pays test melts within ~1-2 seconds. The 60s timeout in the integration test gives ample margin. If the test flakes, bump to 90s.
- If the change proofs returned by `post_melt` come in a different order than the deterministic outputs, `construct_proofs` will fail. Don't try to do DLEQ matching in slice 8; surface the mint error and flag in non-goals.
- If you find yourself reaching for tokio in `state.rs`, you've made a mistake.
