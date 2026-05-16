# Agicash Rust SDK — Design Spec

**Date:** 2026-05-14
**Status:** Approved through brainstorming. Awaiting plan.

## 1. Goals & Scope

Rewrite the agicash wallet core in Rust to maximize the surface that lives in
one shared, multi-platform implementation. The same Rust core powers:

- a native CLI (`agicash`), the v1 deliverable
- the existing web app via WASM (v2)
- future mobile/desktop shells via UniFFI or Tauri (post-v2, supported but not built)

**v1 functional scope:** Cashu accounts with Lightning support (via mint
melt/mint quotes), Spark accounts with native Lightning support (via Breez SDK
Spark, our fork), Supabase-backed encrypted persistence, Open Secret
authentication, full state machine + task processor logic in Rust.

**v1 success criterion:** a logged-in CLI sees the same wallet as the web app
(same accounts, transactions, balances) via the same database. Sending or
receiving in the CLI is observable from the web app and vice versa.

**Not in v1:** OAuth (Google/Apple/GitHub), daemon mode, MCP server, hardware
wallets, local-mnemonic mode (Open Secret is the only identity provider),
Supabase Realtime WebSocket client (CLI polls; WebSocket lands in v2 alongside
WASM).

## 2. Architecture Overview

Layered hexagonal architecture with a sans-IO core:

- **Layer 1 — Pure state machines.** No async, no I/O, total functions.
  `step(state, event) -> (state, Vec<effect>)`. Table-driven tests.
- **Layer 2 — Services.** Async orchestrators that compose trait objects.
  Hold no state; route effects to traits, feed results back as next events.
- **Layer 3 — `WalletCache`.** Strongly-typed in-memory state with an event
  bus. Source of truth for the wallet's view of itself. Rust owns it
  completely; no separate JS-side cache.

Concrete impls (Supabase storage, Open Secret key provider, Breez Spark
provider, CDK cashu provider) sit behind trait interfaces in `agicash-traits`.
The `WalletClient` facade is the only crate consumers depend on.

Concurrency model: services are async fns on `&self`. Locking lives inside
the cache, per slot. No central actor — method-call API on `Arc<WalletClient>`
is the public surface. `async-broadcast` for the event bus (WASM-compatible).
`futures::lock::Mutex` and `parking_lot::RwLock` for synchronization (no tokio
primitives in core crates, since `tokio` doesn't target `wasm32-unknown-unknown`).

Multi-platform strategy: same `agicash-wallet` crate consumed by CLI directly,
WASM via `agicash-wasm` (wasm-bindgen), future mobile via `agicash-uniffi`
(Mozilla UniFFI). Web UIs get method-call ergonomics + TanStack-shaped
subscription hooks. Native UIs (later) can opt into an event-driven snapshot
projection without changing the core.

## 3. Crate Layout

New top-level `crates/` directory alongside existing `app/`. Existing TS app
is untouched until web migration begins.

```
crates/
├── Cargo.toml                          # workspace manifest
├── agicash-domain/                     # types: Money, Account, Transaction, Quote, Proof
├── agicash-money/                      # decimal math, currency conversion
├── agicash-crypto/                     # xchacha20poly1305, key derivation helpers
├── agicash-traits/                     # Storage*, KeyProvider, TokenProvider, CashuProvider,
│                                       # SparkProvider, RealtimeStorage, Clock
├── agicash-cashu/                      # cdk wrapper + sans-IO state machines per feature
│   └── src/
│       ├── send_quote/                 # mirrors features/send/cashu-send-quote-*
│       ├── send_swap/
│       ├── receive_quote/
│       └── receive_swap/
├── agicash-spark/                      # breez-sdk-spark (agicash fork) wrapper + state machines
│   └── src/
│       ├── send_quote/
│       └── receive_quote/
├── agicash-storage-supabase/           # Storage trait impls over postgrest 1.6
├── agicash-auth-opensecret/            # KeyProvider + TokenProvider impls over opensecret 0.2.9
├── agicash-cache/                      # WalletCache + event bus + subscription primitives
├── agicash-services/                   # async orchestrators per feature
├── agicash-wallet/                     # facade: WalletClient + composition root
├── agicash-cli/                        # bin: clap + tokio + wallet
├── agicash-wasm/                       # cdylib: wasm-bindgen wrappers
└── agicash-testing/                    # in-memory fakes, fixtures, test builders
```

Each crate has a single responsibility expressible in one sentence.
`agicash-domain` has zero deps beyond `serde`. `agicash-traits` is the seam
between abstract and concrete; concrete impls only exist in named impl crates.

Build orchestration: `cargo build` / `cargo run -p agicash-cli` for native,
`bun run wasm:build` (new script wrapping `wasm-pack build`) for WASM. Existing
`bun run dev`, `bun run fix:all` stay as-is.

## 4. State, Concurrency, Runtime Model

State machines are sans-IO total functions. Each (state, event) pair produces
a definitive `(next_state, Vec<effect>)`. Effects include `CallRpc(...)`,
`CallMint(...)`, `EmitEvent(...)`, `Schedule(...)`. Services run effects and
feed results back as next events. Tests are table-driven; no mocks.

Async runtime is split:

- Core crates (`agicash-services`, `agicash-cache`, state machine crates) use
  only `async fn`, `futures::future`, `async-broadcast`, `futures::lock`. No
  `tokio::*` direct calls.
- `agicash-cli` uses `tokio::spawn`, `tokio::time`, `tokio::signal` for native
  task spawning and shutdown.
- `agicash-wasm` uses `wasm_bindgen_futures::spawn_local` and `gloo-timers`.

Task processors implement a `TaskProcessor` trait:

```rust
#[async_trait]
pub trait TaskProcessor: Send + Sync {
    async fn run(self: Arc<Self>, shutdown: CancellationToken);
}
```

CLI spawns via `tokio::spawn` and tracks `JoinHandle`s; WASM spawns via
`spawn_local`. Processors `select!` on `(event_bus_recv, timer_tick, shutdown)`
— no busy polling.

`WalletClient` is the composition root:

```rust
let wallet = WalletClient::builder()
    .storage(SupabaseStorage::new(supabase_client))
    .key_provider(OpenSecretKeyProvider::new(os_client.clone()))
    .token_provider(OpenSecretTokenProvider::new(os_client))   // same OpenSecretClient instance
    .spark_provider(SparkProvider::connect(spark_config).await?)  // owns the per-user Breez session internally
xx    .cashu_provider(CashuProvider::new(cdk_config))
    .clock(SystemClock)
    .build()
    .await?;
```

Dropping the last `Arc<WalletClient>` cascades a `CancellationToken` to all
spawned task processors for clean shutdown.

### Distributed task processing lock

Multiple devices logged in as the same user (CLI on a laptop + web app in a
browser + future mobile) MUST NOT both run task processors simultaneously.
Quote expiry checks, mint quote claim attempts, and especially Spark
auto-leaf-optimization assume a single active driver per user; concurrent
drivers would race on DB state and (in Spark's case) corrupt channel state.

We use the existing `take_lead(user_id, client_id)` Supabase RPC as a
distributed lock with a 6-second TTL. Each `WalletClient` instance
generates a stable `ClientId` UUID on first run, persisted alongside
session tokens. Task processors call `take_lead` every few seconds;
the RPC grants the lease (or refreshes the existing one if `client_id`
matches). Processors only execute work while they hold the lease;
otherwise they sit idle on the realtime event stream waiting for the
active device to publish state changes.

The lock gates *background drivers*, not user-initiated actions. Sending
a payment, claiming a token, paying an invoice — all run on the active
client regardless of who holds the lease, because the DB-level state
machines (the `mark_pending`, `complete`, `expire`, `fail` RPCs with
CHECK constraints) make these mutations safe to race at the DB tier.

## 5. Storage & Supabase Boundary

Mirror the 32 existing Supabase RPC functions as Rust trait methods. We do not
re-implement state-machine logic in the client — the DB functions are
authoritative, enforce CHECK constraints + RLS atomically, and we treat them
as the action vocabulary.

Storage trait is **segregated by domain** rather than one mega-trait:

- `UserStorage` — `upsert_user_with_accounts` (the only true Supabase RPC),
  plus `get_user`, `list_accounts`, `get_account` which are direct postgrest
  table selects with filters (the existing TS app uses the same pattern)
- `TransactionStorage` — `list_transactions`
- `CashuSendQuoteStorage` — `create`, `mark_pending`, `complete`, `expire`, `fail`
- `CashuSendSwapStorage` — `create`, `commit_proofs_to_send`, `complete`, `fail`
- `CashuReceiveQuoteStorage` — `create`, `process_payment`, `complete`, `expire`, `fail`, `mark_token_melt_initiated`
- `CashuReceiveSwapStorage` — `create`, `complete`, `fail`
- `SparkSendQuoteStorage` — `create`, `mark_pending`, `complete`, `fail`
- `SparkReceiveQuoteStorage` — `create`, `complete`, `expire`, `fail`, `mark_cashu_token_melt_initiated`
- `FeatureFlagStorage` — `evaluate_feature_flags`
- `TaskLockStorage` — `take_lead`
- `ContactStorage` — `find_contact_candidates`
- `RealtimeStorage` — `subscribe_accounts`, `subscribe_transactions`, ...

Each service depends on only the traits it needs. One concrete
`SupabaseStorage` struct implements all of them. Test fakes are tiny — implement
one trait at a time.

HTTP transport: `postgrest` crate v1.6.0 (community-maintained, stable since
2023, WASM-compatible via `reqwest` with `default-features = false`). Each RPC
call wraps `client.rpc(fn_name, json_body).insert_header("Authorization",
"Bearer {jwt}").insert_header("apikey", ...).execute().await`. With ~32 RPCs
and ~1 line of dispatcher code per RPC, the concrete impl is under 200 LOC.

JWT comes from a separate `TokenProvider` trait so Supabase storage doesn't
know about Open Secret directly. `OpenSecretTokenProvider` caches JWTs with a
~30s expiry margin and refreshes in the background.

**Realtime:** the ecosystem has no production-grade WASM-capable client.
Existing crates (`supabase-lib-rs`, `rp-supabase-realtime`, `realtime-rs`) are
all bus-factor-1 with open bugs. We will build our own thin client when needed.

- **v1 (CLI):** `RealtimeStorage` trait exists with the same event shape that
  Supabase Realtime emits (Inserted/Updated/Deleted variants per table). CLI
  impl polls Supabase every 5s, diffs snapshots, emits events. ~150 LOC.
- **v2 (WASM):** new impl using `tokio-tungstenite` (native cfg) +
  `web-sys::WebSocket` (WASM cfg) speaking Phoenix channels for
  `postgres_changes`. ~500-1000 LOC. Estimated 1-2 weeks. Reference impls
  available in `rp-supabase-realtime` and `bytemunch/realtime-rs` (MIT/Apache).

Trait surface is identical between v1 and v2. Services consuming
`RealtimeStorage` don't change when the impl swaps.

Encryption: Proofs and sensitive transaction fields are encrypted client-side
in the service layer (via `agicash-crypto`, xchacha20poly1305) before reaching
the Storage layer. Storage sees opaque ciphertext strings, never plaintext.

## 6. Key Derivation & Auth

Two traits separate concerns:

```rust
#[async_trait]
pub trait KeyProvider {
    async fn derive_private_key(&self, options: KeyOptions) -> Result<SecretKey>;
    async fn derive_public_key(
        &self,
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<PublicKey>;
    async fn sign_message(
        &self,
        message: &[u8],
        algorithm: SigningAlgorithm,
        options: KeyOptions,
    ) -> Result<Signature>;
    async fn get_mnemonic(&self) -> Result<Mnemonic>;
}

#[async_trait]
pub trait TokenProvider {
    async fn get_jwt(&self) -> Result<String>;
}
```

Implementation: the `opensecret` crate v0.2.9 from crates.io (also available
at `node_modules/@agicash/opensecret-sdk/rust/`). Already implements:

- AWS Nitro Enclave attestation with bundled root cert and COSE_Sign1
  verification
- x25519 key exchange for session keys
- ChaCha20-Poly1305 encrypted API channel
- All wallet-relevant endpoints: `login`, `register`, `refresh`, `private_key`,
  `private_key_bytes`, `sign_message`, `encrypt`, `decrypt`,
  `third_party_token`, `change_password`

**One shared `OpenSecretClient` instance** is constructed at the composition
root and passed by `Arc` to both `OpenSecretKeyProvider` and
`OpenSecretTokenProvider`. They share the session, attestation cost is paid
once per process startup.

Key derivation caching: private keys cached in-memory after first derivation,
keyed on `KeyOptions`. Lifetime tied to `WalletClient`. Zero-on-drop via
`zeroize`. Signing remains remote (enclave-side) by default; mnemonic is only
fetched when truly needed (Spark wallet seed init).

**v1 auth methods: email/password and guest only.** OAuth (Google/Apple/GitHub)
is deferred — the Rust `opensecret` crate lacks OAuth wrappers and we don't
need to implement a `gh auth login`-style loopback for v1.

Session persistence (CLI): tokens stored in OS keyring via the `keyring`
crate (Keychain on macOS, Secret Service on Linux, Credential Manager on
Windows). Re-attestation + key exchange runs on every cold start (session keys
are ephemeral); the refresh token in keyring is the durable identity.

## 7. Cashu & Spark Providers

Two provider traits (per account type), not a unified `LightningProvider`:

```rust
#[async_trait]
pub trait CashuProvider {
    async fn wallet_for_account(&self, account: &CashuAccount) -> Result<Arc<CashuMintWallet>>;
    async fn mint_info(&self, mint_url: &MintUrl) -> Result<MintInfo>;
}

#[async_trait]
pub trait SparkProvider {
    /// Get or initialize the wallet handle for a Spark account.
    /// All Spark accounts for a user share the underlying Breez session,
    /// which the provider owns internally.
    async fn wallet_for_account(&self, account: &SparkAccount) -> Result<Arc<SparkWallet>>;
}
```

**Cashu wallet keying:** one `CashuMintWallet` per account, identified by
`(mint_url, currency, purpose, seed)`. Matches the existing master code
(`getInitializedCashuWallet`). Each wallet internally spans all keysets the
mint exposes for its currency; the right keyset is selected per operation.

**CDK usage philosophy: protocol primitives, not sagas.** CDK ships
higher-level wallet operations (`Wallet::send`, `Wallet::receive`,
`Wallet::melt`) backed by a saga subsystem (`SendSaga`, `ReceiveSaga`,
`MeltSaga`, `IssueSaga`, `SwapSaga`) that persists state via CDK's
~50-method `WalletDatabase` trait. We do NOT use that layer. Concretely
incompatible with our model:

- CDK's saga state machines duplicate our quote tables → drift risk.
- `WalletDatabase` assumes plaintext `ProofInfo`; our schema stores
  encrypted blobs.
- CDK proof state enum has 5 values (`Spent`/`Unspent`/`Pending`/`Reserved`/`PendingSpent`),
  ours has 3 (`UNSPENT`/`RESERVED`/`SPENT`).
- CDK reservations use UUIDs (`operation_id`); our RPCs use natural keys
  (`quote_id`, `token_hash`) which give us stronger idempotency.
- CDK saga retries are not idempotent at the caller level
  (`Wallet::prepare_send` twice → two reservations).

We use only CDK's **`MintConnector` trait** (HTTP wrappers over the
mint protocol, zero `WalletDatabase` touches) and the cashu-crate
crypto primitives:

- `MintConnector::post_mint_quote`, `post_mint`, `post_melt_quote`,
  `post_melt`, `post_swap`, `post_check_state`, `post_restore`,
  `get_mint_quote_status`, `get_melt_quote_status`, `get_mint_keys`,
  `get_mint_keysets`, `get_mint_info` (and batch variants when needed).
- `cashu::nuts::PreMintSecrets` for blinded message generation
  (`from_seed`, `with_conditions`, `restore_batch`) and
  `construct_proofs` for final proof assembly.
- `cashu::nuts::Token` for token codec (`from_str`, `new`, `proofs`).
- DLEQ verification primitives from the `cashu` crate directly, not
  the `Wallet::verify_token_dleq` wrapper (which reads from
  `WalletDatabase`).

Keyset counter management uses the existing `keyset_id` /
`number_of_outputs` fields on the DB RPCs as the canonical counter
source. CDK is told the exact output indices to use per call,
bypassing its counter system entirely (mirroring the cashu-ts v3
`OutputType.custom` bypass agicash already uses).

**One exception — `Wallet::restore`.** NUT-13 restore-from-mnemonic is
self-contained: it loops over keysets, calls `PreMintSecrets::restore_batch`
+ `post_restore`, then writes via `update_proofs` and
`increment_keyset_counter`. It does not touch the saga subsystem. We
use `Wallet::restore` directly with a minimal `WalletDatabase` impl
(~6 methods: `get_mint`, `get_mint_keysets`, `add_mint_keysets`,
`update_proofs`, `increment_keyset_counter`, plus check helpers) that
encrypts on the way in and reads via our Supabase RPCs.

`CashuMintWallet` is therefore a thin async facade exposing the
`MintConnector` primitives (plus the isolated restore entrypoint).
Services compose them; state machines drive the order.

**Spark client keying:** one shared `BreezClient` per user, identified by
`(mnemonic_hash, network)`. All Spark accounts of a single user share one
Breez session. This matches both the existing master code (TanStack query key
`['spark-wallet', sha256(mnemonic), network, storageDir]`) and the Spark
protocol's assumption that one user = one set of channels. Per-account
separate Breez clients would conflict on leaf optimization.

**Breez SDK source:** the agicash fork at `github.com/MakePrisms/spark-sdk`,
not upstream `breez-sdk-spark`. The fork adds delegated Lightning invoice
support (the existing TS app already uses `@agicash/breez-sdk-spark@0.13.5-1`,
sourced from this fork). The Rust crate is pulled in via:

```toml
breez-sdk-spark = { git = "https://github.com/MakePrisms/spark-sdk", rev = "<pinned-commit>" }
```

We pin to a specific commit chosen at implementation time to match the
version that the TS package `@agicash/breez-sdk-spark@0.13.5-1` was built
from. Version bumps are deliberate work that includes a parity check.

**State machines per feature**, mirroring the existing app's feature
organization. One module per state machine:

- `agicash-cashu/src/send_quote/{state.rs, step.rs, tests.rs, mod.rs}`
- `agicash-cashu/src/send_swap/`
- `agicash-cashu/src/receive_quote/`
- `agicash-cashu/src/receive_swap/`
- `agicash-spark/src/send_quote/`
- `agicash-spark/src/receive_quote/`

Each state machine is a pure function over typed `State`, `Event`, `Effect`
enums. No async, no I/O.

Services in `agicash-services` compose state machines with provider traits +
storage traits. One service module per state machine. Service drives the
machine forward, executes effects, persists via Storage RPCs, emits events
via the cache.

`WalletClient` facade exposes operations like:

```rust
impl WalletClient {
    pub async fn pay_lightning(&self, account_id: AccountId, invoice: Bolt11Invoice) -> Result<...>;
    pub async fn create_lightning_invoice(&self, account_id: AccountId, amount: Money) -> Result<...>;
    pub async fn send_cashu_token(&self, account_id: AccountId, amount: Money) -> Result<Token>;
    pub async fn claim_cashu_token(&self, token: Token) -> Result<...>;
    // ...
}
```

Each method dispatches to the right service based on `account.account_type`.

### Multi-device realities

**Spark / Breez.** The Breez SDK uses an in-memory `leaves: TreeNode[]`
array as source of truth, with per-instance mutexes. Two devices each
have their own Breez SDK instance and can fall out of sync. The most
destructive cross-device operation is auto leaf optimization
(`optimizationConfig.autoEnabled = true`), which mutates global channel
state. Mitigations:

- The distributed task-lock (Section 4) gates auto leaf optimization to
  one active device at a time.
- `BreezClient::sync()` is called on cold start and periodically while
  active, to refresh in-memory leaves from the Spark operators.
- We prefer `breez.get_balance()` (queries the coordinator, eventually
  consistent) over `breez.get_internal_balance()` (purely in-memory) for
  user-facing balance displays.
- For receive flows on inactive devices, we let the active device claim;
  inactive devices learn about the new balance via the realtime event
  stream (or polling in v1).

**Cashu proofs.** Proof state (`UNSPENT`, `RESERVED`, `SPENT`) lives in
the DB with strict transitions enforced by RPC functions. The
`commit_proofs_to_send` and `complete_cashu_send_quote` RPCs atomically
update proof state — two devices cannot both spend the same proof. Stale
in-memory state on one device surfaces as `ConcurrencyError` from the
RPC, which the service retries after re-fetching authoritative state
(see Section 11).

**Cashu token claim races.** The DB enforces uniqueness on `token_hash`
for receive swaps. Two devices attempting to claim the same token both
call `create_cashu_receive_swap`; the second receives a unique-constraint
violation, surfaces as `DomainError::TokenAlreadyClaimed`, no retry.

**Quote completion vs. expiry races.** A device pays a quote while
another device's task processor expires it. The DB's `complete_*` RPCs
require the quote to be in `PENDING` state; if expiry won first,
completion fails with `ConcurrencyError` and the service rolls forward
to `Failed`, surfacing a typed error the UI can interpret.

## 8. Cache & Event Bus

`WalletCache` is the canonical source of truth for the wallet's in-memory
state. Rust owns it completely; there is no separate JS-side TanStack cache.

```rust
pub struct WalletCache {
    accounts: Arc<RwLock<HashMap<AccountId, Account>>>,
    transactions: Arc<RwLock<TransactionStore>>,
    proofs: Arc<RwLock<HashMap<AccountId, Vec<Proof>>>>,
    user: Arc<RwLock<Option<User>>>,
    quotes: Arc<RwLock<HashMap<QuoteId, QuoteState>>>,
    in_flight: Arc<DashMap<FetchKey, Shared<BoxFuture<'static, ()>>>>,
    events: async_broadcast::Sender<WalletEvent>,
}
```

Strongly-typed slots, not generic `HashMap<String, Box<dyn Any>>`. Each slot
has its own `RwLock` for fine-grained locking. Reads return owned `Clone`s
(safe to use across `.await`).

Writes go through `cache.apply(CacheMutation)`. Mutation + event emission are
atomic under the slot lock — no window where state changed but no event fired.
`try_broadcast` so slow subscribers don't block writers (they get a lag signal
and re-fetch).

Subscriptions:

- Services subscribe to `WalletEvent`s relevant to them (cache invalidation,
  task wake-ups)
- The WASM layer exposes a `subscribe(callback)` method that forwards events
  to JS over `postMessage` (Comlink-wrapped). React hook (`useWalletSelector`)
  subscribes, re-runs selector on event, triggers re-render via shallow
  comparison. ~30-50 LOC of glue code, replaces TanStack's per-key subscription.

In-flight dedup: concurrent calls to `fetch_accounts` from multiple subscribers
share one `Future` via `futures::future::Shared`. Replaces TanStack's
deduplication.

SSR hydration: cache exposes `snapshot()` and `hydrate(snapshot)` methods.
RR7 loaders call WASM methods, snapshot the cache, send as JSON to client.
Client init calls `hydrate` once. Proofs and sensitive data excluded from
snapshots — operations needing them fetch client-side after hydration.

### Cache reconciliation across devices

Realtime events from other devices arrive as `WalletEvent`s with the same
shape as local mutations. The cache treats them identically — apply the
mutation, emit the event, subscribers re-render. Critically:

- Inserts and Updates from realtime are *idempotent* in the cache (a
  `Transaction` with the same `id` overwrites the existing slot value).
- Local mutations and realtime events use the same `CacheMutation` enum
  — there is no "remote vs local" distinction at the cache layer.
- When a service starts a mutation locally (e.g., creating a send quote),
  the cache tracks an in-flight marker on the entity; concurrent realtime
  events for that entity are still applied to the slot, but the in-flight
  flag tells subscribers a local operation is still in progress so they
  can render pending UI.

We do NOT implement vector clocks or CRDTs. The DB is the source of truth;
realtime is how the cache stays current across devices; conflicts are
detected at the RPC level via `ConcurrencyError` and retried.

## 9. WASM Boundary

WASM lives in a Web Worker, isolated from main-thread JS:

```
┌────────────────────────────────────────┐
│ Main thread — React UI                 │
│  • useWalletSelector hooks             │
└────────────────┬───────────────────────┘
                 │ Comlink (postMessage)
┌────────────────▼───────────────────────┐
│ Worker — WASM Wallet instance          │
│  • Owns all state, runs all services   │
│  • Subscribes to Supabase Realtime     │
└────────────────────────────────────────┘
```

Public surface (`agicash-wasm` crate):

- `Wallet::connect(config)` — async constructor; runs Open Secret attestation,
  connects to Supabase, builds `WalletClient`.
- Synchronous read methods returning owned serde data (called from React
  render paths). Examples: `accounts()`, `balance(account_id)`,
  `transactions(filter)`.
- Async mutation methods returning Promises. Examples: `payLightning`,
  `createLightningInvoice`, `sendCashuToken`, `claimCashuToken`. ~30-50 methods
  total, each one a thin dispatch into `WalletClient`.
- `subscribe(callback)` — registers a JS callback for `WalletEvent` stream.
- `snapshot()` / `hydrate(snapshot)` — for SSR.

Returned values are plain serde data, not `#[wasm_bindgen]` class handles
(class handles can't be structured-cloned across `postMessage`). Errors map
to `JsError` with `kind` and `code` fields preserved for React-side
pattern-matching.

Server-side rendering (RR7 loaders in Node): the same `agicash-wasm` package
imports work. WASM module compiled once at module scope
(`WebAssembly.compileStreaming`), per-request `Wallet` instance. ~50-100ms
cold-start per request after first. Public/marketing routes skip WASM
entirely — only `_protected.*` routes lazy-load it.

Build pipeline: `wasm-pack build crates/agicash-wasm --target bundler`
emits to a `pkg/` directory. Vite consumes via `vite-plugin-wasm` +
`vite-plugin-top-level-await`. Bundle size mitigations: `wasm-opt -Oz`,
strip-on-release, lazy-load on protected routes only. Estimated 600KB-1.5MB
gzipped for v1 surface.

Dev loop: `cargo watch -w crates -s 'bun run wasm:build:dev'` → Vite picks
up new `pkg/` → page reload. ~3-8s incremental rebuild. No HMR for WASM —
full reload, worker state is lost on every Rust change. Mitigated by keeping
frequently-edited code in small crates.

## 10. CLI Surface

```
agicash auth login | guest | logout | status | whoami
agicash account list | default <id> | info [<id>]
agicash mint add <url> [--currency=BTC] | list
agicash balance [<account-id>]
agicash send <amount> [--account=<id>] [--memo=<text>]
agicash pay <invoice> [--account=<id>]
agicash receive <amount> | <token>
agicash decode <input>
agicash history [--account=<id>] [--limit=20]
agicash watch                            # foreground task processor
```

Arg parsing: `clap` with derive macros. Output: human-readable by default;
`--json` flag for scripting. Color via `anstream` (auto-detects TTY).

Session storage: tokens in OS keyring (`keyring` crate). Config
(`~/.config/agicash/config.toml`) holds non-secret prefs.

Exit codes: 0 success, 1 runtime error, 2 usage error (clap-handled), 3 auth
required, 4 network error.

Not in v1: daemon mode, MCP server, interactive REPL, shell completions.

## 11. Error Model

Single `WalletError` enum at the facade level, with `From` impls for
subsystem-specific errors (`StorageError`, `CashuError`, `SparkError`,
`AuthError`). Start with a small set of variants (`Domain`, `Concurrency`,
`NotFound`, `Unauthenticated`, `Network`, `Invariant`) plus wrapped subsystem
errors. **Add variants when concrete need arises** rather than enumerating
all possible failure modes upfront.

**Orphan-rule constraint.** Rust's orphan rule operates at the **crate**
level, not the workspace level. `impl From<Foreign> for Foreign` is illegal
no matter how many of our crates are between the two. This bites whenever a
provider crate wants to map a third-party error or convert a type defined in
`agicash-traits` to a type defined in a third-party crate. In those cases use
free helper functions (`fn convert_x_to_y(x: X) -> Y`) instead of `From`
impls — uglier at call sites but the only legal option. Slice 2 hit this
with `agicash-auth-opensecret` mapping `opensecret::Error → AuthError` and
`KeyOptions → opensecret::KeyOptions`. Plan-writers for future slices should
account for this when sketching cross-crate trait surfaces.

Retry policy is encoded via `WalletError::retry_policy()`:

- `Domain`, `NotFound`, `Unauthenticated`, `Invariant` → never retry
- `Concurrency` → always retry (with backoff, capped — see below)
- `Network` → retry with exponential backoff, max 3

### Concurrency retry strategy

`ConcurrencyError` originates from RPCs that detect state has moved
between read and write (e.g., trying to `complete_cashu_send_quote` on a
quote that is already `EXPIRED`). The retry strategy is:

1. Re-fetch authoritative state for the entity (single RPC call).
2. Drive the state machine forward from the current state.
3. If the new state allows the original intent, retry the mutation. If
   not (e.g., quote is now `EXPIRED`), surface a typed `DomainError`.

Max 3 retries with exponential backoff (100ms / 400ms / 1.6s + jitter).
Beyond that, surface as `Network` for "try again later." Concurrency
errors that hit the cap are logged with the entity id so we can audit
real contention vs. transient races.

### Idempotency

State-transition RPCs are designed idempotent by the DB layer: calling
`complete_cashu_send_quote` twice on the same `(quote_id, change_proofs)`
returns the same result; the second call is a no-op. This is critical
for unreliable networks — a client that issues an RPC, never sees the
response, and retries will not double-process.

`create_*` RPCs use natural keys (`quote_id`, `token_hash`) so retries
do not create duplicate rows. We do not generate separate idempotency
tokens; the DB schema is the idempotency boundary.

### WASM and CLI mapping

WASM: each error becomes a `JsError` object with `kind`, `code`,
`message` fields. React side pattern-matches on `error.kind` for retry
decisions.

CLI: `Display` to stderr; appropriate exit code (see Section 10).

## 12. Testing Approach

TDD per feature. No upfront test infrastructure plan beyond a small
`agicash-testing` crate providing in-memory fakes for the storage traits, a
fake `KeyProvider`, a fake `CashuProvider` / `SparkProvider`, a `MockClock`,
and test data builders.

For each feature we ship:

- State machine: table-driven `(state, event) → (state, effects)` tests
  alongside `step()` for every transition including invalid ones
- Service: happy-path + failure-path tests using `agicash-testing` fakes
- Integration: when features compose, a `crates/agicash-wallet/tests/` test
  exercises the multi-service flow against fakes

End-to-end CLI tests (`agicash-cli/tests/` using `assert_cmd`) against a real
Supabase test project run as `#[ignore]` locally, on CI nightly.

### Open Secret test economy

Open Secret runs in a Nitro enclave; creating users and burning attestation
cycles is not free. Tests that need a real Open Secret session follow these
rules:

- **One guest user per test run.** A shared fixture
  (`agicash-testing::open_secret_fixture`) creates a single guest user
  at the start of a test binary's run, caches the
  `(access_token, refresh_token, client_id)` in a temp file, and
  reuses it across all tests in that run. Local dev gets a longer-lived
  cache (e.g., `~/.cache/agicash-tests/`) that survives between
  `cargo test` invocations.
- **Reuse the same user across operations.** Tests don't sign in/out
  per case; they share the session and isolate via per-test entities
  (unique account ids, mint URLs, transaction memos, token hashes).
- **Tests requiring distinct identities** (multi-device concurrency
  tests) explicitly opt in via a `dual_user_fixture` that creates a
  second guest. Used sparingly.
- **Unit + service tests use the `FakeKeyProvider`** in
  `agicash-testing` — never touch Open Secret at all. The vast majority
  of tests should be in this tier.
- **CI cleanup**: guest users are anonymous and self-expire; no
  explicit teardown needed. If a test leaks state into shared accounts
  on Supabase, the test is responsible for cleaning up its own rows.

`cargo clippy -- -D warnings`, `cargo fmt --check`, and
`cargo build --target wasm32-unknown-unknown -p agicash-wasm` run on every PR.

## 13. Out of Scope

- OAuth (Google/Apple/GitHub) — deferred to v2 via loopback HTTP server.
- Daemon mode (`agicashd`) — defer until session cold-start cost becomes a
  real pain point.
- MCP server — defer with daemon.
- Hardware wallets — trait shape doesn't preclude future `LedgerKeyProvider`.
- Local-mnemonic CLI mode — Open Secret is the only identity provider.
- Supabase Realtime WebSocket — v2, alongside WASM web app migration.
- Migration of the existing React app to the WASM SDK — separate project, v3.
- Native shells (iOS, Android, Tauri desktop) — supported by architecture,
  not built.

## 14. Known Costs & Risks

- **Supabase Realtime client (~1-2 weeks)** when we reach v2. No upstream crate
  is mature enough; we'll write a thin Phoenix-channels client copying from
  two existing MIT/Apache reference impls. Largest single known cost.
- **cdk version churn.** Pinned to a known-good commit. Each minor bump is
  deliberate work including a parity check.
- **breez-sdk-spark fork drift.** Our fork is at `github.com/MakePrisms/spark-sdk`;
  upstream Breez evolves independently. Periodic merges from upstream are a
  separate workstream.
- **WASM bundle size.** Mitigations planned (`wasm-opt -Oz`, lazy-load on
  protected routes). Will measure after v1 and revisit if >2MB gzipped.
- **WASM dev loop is rough.** No HMR. Mitigated by thin crates and full-page
  reload as the dev model. Plan for it.
- **WASM cold-start in SSR (~50-100ms/request).** Acceptable for `_protected`
  routes; public routes skip WASM entirely.

## 15. Open Questions

None blocking. The Realtime build choice (A: build now, B: defer to v2) was
resolved as B during brainstorming, with v1 CLI using polling. Trait surface
is built day-one to match the eventual WebSocket impl.

## 16. Implementation Slicing (TDD-Friendly Order)

Each slice ships a testable, user-visible (or developer-visible) thing.
Subsequent slices build on prior ones; tests written during one slice
become regression tests for the next. Each slice gets its own
implementation plan via `superpowers:writing-plans`.

1. **Scaffold.** Cargo workspace, all crates created with empty stubs,
   `agicash-domain` types, `agicash-money`, basic CI. **Test bar:**
   `cargo build`, `cargo test`, `cargo clippy -- -D warnings`,
   `cargo build --target wasm32-unknown-unknown -p agicash-wasm` all
   pass; `agicash --help` prints usage.

2. **Auth.** `agicash-auth-opensecret` (with shared `OpenSecretClient`),
   `KeyProvider` + `TokenProvider` traits in `agicash-traits`, CLI
   commands `agicash auth login | guest | logout | status`,
   keyring-backed session persistence. **Test bar:** integration test
   signs in with test credentials against the real Open Secret dev env,
   asserts `auth status` reports the right user id; tokens survive process
   restart.

3. **User + Accounts read path.** `agicash-storage-supabase` skeleton,
   `UserStorage` trait wired to its 4 RPCs, `agicash account list` works.
   **Test bar:** integration test signs in, lists accounts, shows
   non-empty output for a seeded user.

4. **Cashu provider scaffolding.** `agicash-cashu` crate, `CashuProvider`
   trait + CDK wrapper, mint info fetch, `agicash mint add <url>`,
   `agicash balance`. **Test bar:** add a regtest mint, see zero balance,
   account row persisted via `upsert_user_with_accounts`.

5. **Cashu receive — Lightning quote.** Receive quote state machine
   (`agicash-cashu/src/receive_quote/`), the 6 receive-quote RPCs in
   storage, service in `agicash-services`, `agicash receive 100
   --currency=BTC --account=<id>`. **Test bar:** e2e test against a
   regtest mint: produce a bolt11 invoice, pay it externally, see
   balance reflect; failure-path tests for expiry and fail.

6. **Cashu send — Lightning quote.** Send quote state machine, 5
   send-quote RPCs, `agicash pay <invoice>`. **Test bar:** e2e test pays
   a regtest invoice; balance reflects; change proofs persisted; tests
   for insufficient-balance, invalid-invoice, expired-quote.

7. **Cashu send — Token swap.** Send swap state machine, 4 send-swap
   RPCs, `agicash send 50` produces a cashu token. **Test bar:** token
   round-trips via `agicash decode`; tests for insufficient balance,
   bad keysets.

8. **Cashu receive — Token swap.** Receive swap state machine, 3
   receive-swap RPCs, `agicash receive <token>`. **Test bar:** tokens
   from slice 7 are claimable; e2e test moves balance between two
   accounts; tests for already-claimed, invalid-token, expired-mint-keyset.

9. **Spark provider.** `agicash-spark` crate using our Breez fork,
   `SparkProvider` trait, single `BreezClient` per user, account
   creation. **Test bar:** regtest Spark integration, balance read.

10. **Spark send/receive.** Spark Lightning send/receive via Breez.
    Send/receive quote state machines, the 4 + 5 spark-quote RPCs.
    **Test bar:** pay an invoice from a Spark account; receive an invoice
    to a Spark account.

11. **Cache + event bus + task processors.** `agicash-cache` crate,
    `WalletCache` with typed slots, `async-broadcast` event bus,
    polling `RealtimeStorage` impl, distributed lock via `take_lead`,
    task processors for quote expiry/claim. **Test bar:** `agicash
    watch` running on two CLI instances against the same user — only
    one holds the lease at a time; state changes on one are visible on
    the other within one polling interval.

12. **`agicash-wallet` facade + multi-service integration.** All previous
    services composed through `WalletClient::builder()`. **Test bar:**
    `crates/agicash-wallet/tests/` exercises multi-service flows against
    fakes (e.g., "send from cashu A → receive to cashu B → check
    balances + transaction history").

After step 12 the Rust CLI is at feature parity with v1 scope.

13. **WASM (v2).** `agicash-wasm` crate, wasm-bindgen surface, Comlink
    worker setup, basic web app integration behind a feature flag.
    **Test bar:** web app with feature flag ON uses Rust core for one
    feature (e.g., balance display); with flag OFF uses existing TS
    code; A/B parity test.

14. **Supabase Realtime WebSocket client (v2).** Replace polling with
    Phoenix-channels WebSocket impl. **Test bar:** subscribed clients
    receive events within 500ms of a DB mutation; failover to polling
    on disconnect; reconnection with no event loss.

Steps 1-12 deliver v1. Steps 13-14 deliver v2 (WASM web app integration).
Beyond that, native shells (iOS/Android/Tauri) and OAuth are post-v2
workstreams that reuse the same core unchanged.
