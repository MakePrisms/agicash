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
    .breez(BreezClient::connect(breez_config).await?)          // one per user
    .spark_provider(SparkProvider::new(breez_handle, storage_dir, network))
    .cashu_provider(CashuProvider::new(cdk_config))
    .clock(SystemClock)
    .build()
    .await?;
```

Dropping the last `Arc<WalletClient>` cascades a `CancellationToken` to all
spawned task processors for clean shutdown.

## 5. Storage & Supabase Boundary

Mirror the 32 existing Supabase RPC functions as Rust trait methods. We do not
re-implement state-machine logic in the client — the DB functions are
authoritative, enforce CHECK constraints + RLS atomically, and we treat them
as the action vocabulary.

Storage trait is **segregated by domain** rather than one mega-trait:

- `UserStorage` — `upsert_user_with_accounts`, `get_user`, `list_accounts`, `get_account`
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
    async fn derive_public_key(&self, options: KeyOptions) -> Result<PublicKey>;
    async fn sign_message(&self, message: &[u8], options: KeyOptions) -> Result<Signature>;
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
    async fn breez(&self) -> Result<Arc<BreezClient>>;
    fn account_handle(&self, account_id: AccountId) -> SparkAccountHandle;
}
```

**Cashu wallet keying:** one `CashuMintWallet` per account, identified by
`(mint_url, currency, purpose, seed)`. Matches the existing master code
(`getInitializedCashuWallet`). Each wallet internally spans all keysets the
mint exposes for its currency; the right keyset is selected per operation.

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

Retry policy is encoded via `WalletError::retry_policy()`:

- `Domain`, `NotFound`, `Unauthenticated`, `Invariant` → never retry
- `Concurrency` → always retry (with backoff)
- `Network` → retry with exponential backoff, max 3

WASM mapping: each error becomes a `JsError` object with `kind`, `code`,
`message` fields. React side pattern-matches on `error.kind` for retry
decisions.

CLI mapping: `Display` to stderr; appropriate exit code.

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
