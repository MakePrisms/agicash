# Wallet SDK — public contract proposal (step 4)

- **Date:** 2026-07-02
- **Status:** Proposal for review
- **Parent spec:** [2026-06-24-wallet-sdk-no-cache-production-design.md](./2026-06-24-wallet-sdk-no-cache-production-design.md)

Step 4 of the no-cache production design: define the `Sdk` class + `create(config)`,
the per-domain namespaces, the separate `ServerSdk`, and the *shape* of the
background contract. Background implementation lands in step 18; slices 5–16 fill
these namespaces in one domain at a time.

## Principles (inherited, restated as contract rules)

1. **No cache.** Reads return `Promise`s that hit the DB. The SDK holds no
   resident store of wallet data. (The feature-flag cache is process-local
   config, not wallet data — it stays.)
2. **Events out, promises in.** State changes surface only as typed events on
   `sdk.events`. The host owns freshness/caching (web: TanStack).
3. **Ports in via `create(config)`, never ambient.** No SDK module reads env
   vars or touches `localStorage`/cookies. Everything host-specific enters as a
   config port. This is what makes bun/node MCP hosting work.
4. **Instance, not module state.** All runtime capability hangs off an `Sdk`
   instance. Pure helpers (codecs, validators) are stateless root exports.
5. **Types at the root, capability on the instance.** `@agicash/wallet-sdk`
   exports domain types + pure helpers; repositories, services, and the DB
   layer stay internal. `/temporary` keeps bridging until step 19 deletes it.

## `Sdk.create(config)`

```ts
type SdkConfig = {
  db: {
    url: string;      // Supabase project URL — host resolves the final URL first
    anonKey: string;  // Supabase anon key
  };
  auth: {
    apiUrl: string;         // Open Secret backend URL
    clientId: string;       // Open Secret client id
    storage: AuthStorage;   // host-backed session persistence
  };
  spark: {
    breezApiKey: string;
    network: SparkNetwork;  // default network for account creation (see notes)
    storageDir?: string;    // node hosts; browser default applies
  };
  lightningAddressDomain: string; // lud16 domain for contacts/display
  logger?: Logger;          // diagnostic sink; MCP stdio hosts route to stderr
};

// Illustrative shape — binds to the React-agnostic @agicash/opensecret release's
// storage-provider interface verbatim (method names + nullability), settled when
// the auth slice (step 5) adopts the release, so the SDK ships no adapter over it.
type AuthStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

// Structured diagnostics. Web wires console + Sentry breadcrumbs; a bun/node MCP
// host wires stderr (stdout carries JSON-RPC). The SDK never calls console directly.
type Logger = {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
};

class Sdk {
  static create(config: SdkConfig): Sdk; // sync; no I/O
  init(): Promise<void>;                 // optional async second phase (see notes)
  dispose(): Promise<void>;              // tears down realtime + background
}
```

Notes:

- **The SDK builds its own Supabase client.** Auth lives inside the SDK
  (step 5), so the access-token getter (Open Secret JWT → Supabase session)
  wires internally — the host cannot supply it without a circular dependency.
  The host supplies only `url` + `anonKey`, and resolves the **final** URL
  before `create()` (the dev-only `127.0.0.1 → hostname` rewrite stays in the
  host's config assembly). The SDK reads no browser globals.
- **Supported runtimes:** browser, bun, and node ≥ 22 — realtime needs a global
  `WebSocket`, which older node lacks; the Breez fork already floors node at 22.
- **All key material stays lazy.** Encryption keys, the Cashu seed, and the
  Spark mnemonic derive on demand from the authenticated Open Secret session
  (constructors already take `() => Promise<…>` getters today — the internal
  wiring keeps that shape).
- **`create` is synchronous; `init()` is the optional async second phase.**
  Constructing an `Sdk` does no I/O. `init()` front-loads the async inits that
  can *fail* — session restore and the Breez WASM probe — and rejects with the
  typed error (e.g. `WebAssemblyUnavailableError`, when WebAssembly is
  unavailable as under iOS Lockdown Mode), so the host keeps its boot-time
  fallback path. If the host never calls `init()`, first use lazy-initializes
  exactly as today. This preserves master's split verbatim — **what is lazy
  stays lazy, what is eager stays eager**: eager = session restore + WASM probe
  (`init()`) and the realtime subscription (driven by `events.on()`); lazy =
  per-account Spark connect, cashu wallet init, and all reads (first use).
- **`dispose()`** awaits in-flight background state transitions to their next
  checkpoint, then tears down realtime + background; still-pending namespace
  promises reject with a typed `SdkError`.
- **`spark.network`** is the default used when the SDK *creates* an account; the
  per-account value persisted in the DB is authoritative for every account after
  that (network is per-account state, not global truth).

## Instance namespaces

One namespace per migration slice; the slice PR fills the namespace and flips
the web app's imports for that domain from `/temporary` to `sdk.*`.

```ts
class Sdk {
  auth: AuthApi;            // step 5
  user: UserApi;            // step 5
  accounts: AccountsApi;    // step 6
  contacts: ContactsApi;    // step 7
  transactions: TransactionsApi; // step 8
  receive: ReceiveApi;      // steps 9–12
  send: SendApi;            // steps 13–15
  transfer: TransferApi;    // step 16
  featureFlags: FeatureFlagsApi;
  events: WalletEvents;     // shape now; emits from step 18
  background: BackgroundApi; // shape now; implementation step 18
}
```

Flow-first (`receive`/`send`), not rail-first (`cashu`/`spark`): the app and
the slice sequence both think in flows, and cross-rail concerns
(`resolveDestination`, transfer) already live at flow level. Rails appear as
sub-namespaces where the flows genuinely diverge:

```ts
type ReceiveApi = {
  cashu: {
    getLightningQuote(params): Promise<CashuReceiveLightningQuote>;
    createQuote(params): Promise<CashuReceiveQuote>;
    getQuote(id: string): Promise<CashuReceiveQuote | null>;
  };
  spark: {
    getLightningQuote(params): Promise<SparkReceiveLightningQuote>;
    createQuote(params): Promise<SparkReceiveQuote>;
    getQuote(id: string): Promise<SparkReceiveQuote | null>;
  };
  cashuToken: {
    getQuote(params): Promise<ReceiveCashuTokenQuote>;
    claim(params): Promise<…>;
  };
};

type SendApi = {
  resolveDestination(input: string): Promise<DestinationDetails>;
  cashu: {
    getLightningQuote(params): Promise<CashuLightningQuote>;
    createQuote(params): Promise<{ transactionId: string }>;
    getSwapQuote(params): Promise<CashuSwapQuote>;   // send-to-token
    createSwap(params): Promise<…>;
  };
  spark: {
    getLightningQuote(params): Promise<SparkLightningQuote>;
    createQuote(params): Promise<{ transactionId: string }>;
  };
};
```

Representative shapes for the simpler namespaces (exact param types settle in
each slice PR, per the parent spec):

```ts
type AccountsApi = {
  get(id: string): Promise<Account | null>;
  list(): Promise<Account[]>;                 // active accounts, current user
  cashu: {
    add(params): Promise<CashuAccount>;
  };
};
```

Rail-agnostic reads stay at the namespace top (`get`/`list` return the
`Account` union); rail-specific operations nest per rail — the same rule
`receive`/`send` follow. A future addable rail lands as `accounts.spark.add`
with exact input and return types, instead of widening a shared `add`
signature into unions or overloads.

```ts
type UserApi = {
  get(): Promise<User>;
  updateUsername(username: string): Promise<User>;
  acceptTerms(params): Promise<User>;
  setDefaultAccount(params): Promise<User>;    // user slice owns default-account
  setDefaultCurrency(params): Promise<User>;   // …and default-currency writes
};

type ContactsApi = {
  get(id: string): Promise<Contact | null>;
  list(): Promise<Contact[]>;                  // today's getAll
  create(params): Promise<Contact>;
  delete(id: string): Promise<void>;
  findContactCandidates(query: string): Promise<Contact[]>;
};

type TransferApi = {
  getQuote(params): Promise<TransferQuote>;    // stateless preview
  initiate(params): Promise<{ transactionId: string }>;
};

type TransactionsApi = {
  get(id: string): Promise<Transaction | null>;
  list(params: { cursor?: Cursor; pageSize?: number; accountId?: string }):
    Promise<{ transactions: Transaction[]; nextCursor: Cursor | null }>;
  countPendingAck(): Promise<number>;
  acknowledge(transactionId: string): Promise<void>;
};

type BackgroundApi = {
  start(): void;            // leader election + change feed + processors
  stop(): Promise<void>;    // see stop() semantics below
  readonly state: 'stopped' | 'follower' | 'leader' | 'error';
};
```

### Execution model

**Nothing moves money unless a background loop is running somewhere.**
`createQuote` persists an UNPAID quote; execution (paying, swapping, melting) is
background-only. This is already true today — the task processor is leader-gated
behind a ~6-second DB lock — but the contract must state it, because two
consumers depend on it:

- **An MCP / request-response host MUST call `background.start()` in-process**,
  or its own sends sit UNPAID forever — nothing else runs its loop.
- **The executing instance may differ from the initiating one.** The leader lock
  is per-user across devices, so a send initiated on one instance can be executed
  by another (e.g. an open browser tab). Failover is bounded by the lease TTL +
  poll interval (~6s lease, renewed every 5s), not instant — accepted contract,
  not a stall.

**Error handling** keeps master's two tiers:

- **Per-task errors are isolated** — a single poisoned quote logs via the
  `logger` port and the loop keeps processing the rest; the failed entity
  surfaces through its own `*.updated` event on transition to FAILED.
- **Systemic failures** — change feed dead after retries, leader lock
  unrenewable — transition `state → 'error'` and emit `background.state-changed`.
  A host wires that to recovery: web throws from a subscribed hook into its
  global error boundary; an MCP host drives its exit/restart policy.

**`stop()` returns a Promise** because callers (logout, process exit, the SDK's
own `dispose()`) must await cleanup: it stops claiming new work immediately,
awaits in-flight iterations to their next checkpoint (bounded by a timeout),
releases the leader lock, and abandons the remaining queue.

Conventions across all namespaces:

- **`userId` is implicit.** The instance knows the authenticated user; methods
  don't take `userId` params (today's repos do — the namespace layer closes
  over the session).
- **`get*` vs `create*`.** `get*` methods are stateless previews — they compute
  and return without persisting (`getLightningQuote`, `transfer.getQuote`).
  `create*` methods persist and enter the entity into the background lifecycle
  (`createQuote`, `createSwap`, `accounts.cashu.add`). A slice never re-decides
  which is which.
- **Completion is not the host's job.** Methods like `expire`/`fail`/
  `completeSwap` that today's hooks call from background processors do NOT
  appear on the public namespaces — they move behind `sdk.background`
  (step 18). The public surface is: initiate, read, observe events.
- **User-initiated writes are public surface**, not only payment initiation:
  reads, event observation, *and* plain writes a person triggers — contacts
  create/delete, username/terms/default updates, `transfer.getQuote`/`initiate`.
  Only background-driven state transitions (bullet above) are hidden.

### Observing an initiated payment

Send returns a bare `{ transactionId }` and completion is background-only, so
"pay this and tell me the result" is an **observation**. The contract idiom is
subscribe-then-read (a dedicated `transactions.waitForTerminal` is deferred —
hosts hand-roll correlation for now):

1. `events.on('<entity>.updated', …)` filtered to the id — **subscribe first**.
2. read the starting state (`getQuote(id)` / `transactions.get(id)`) as the baseline.
3. correlate `updated` events until a terminal state lands.

Order matters: subscribing before the baseline read closes the race where an
update lands between the read and the subscription (TanStack hides this today;
a bare event consumer must get it right by hand). Receive methods return full
quote objects (they must hand back the generated invoice) while send returns
only an id — the asymmetry is intentional, not an oversight.

## Events

```ts
type WalletEventMap = {
  'user.updated': { user: User };
  'account.created' | 'account.updated': { account: Account };
  'account.balance-changed': { accountId: string; balance: Money }; // spark only; no version
  'contact.created' | 'contact.deleted': { contact: Contact };
  'transaction.created' | 'transaction.updated': { transaction: Transaction };
  'cashu-receive-quote.created' | 'cashu-receive-quote.updated': { quote: CashuReceiveQuote };
  'cashu-receive-swap.created' | 'cashu-receive-swap.updated': { swap: CashuReceiveSwap };
  'spark-receive-quote.created' | 'spark-receive-quote.updated': { quote: SparkReceiveQuote };
  'cashu-send-quote.created' | 'cashu-send-quote.updated': { quote: CashuSendQuote };
  'cashu-send-swap.created' | 'cashu-send-swap.updated': { swap: CashuSendSwap };
  'spark-send-quote.created' | 'spark-send-quote.updated': { quote: SparkSendQuote };
  'connection.changed': { state: 'connected' | 'reconnecting' | 'error' };
  'background.state-changed': { state: BackgroundApi['state']; error?: SdkError };
};

type WalletEvents = {
  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): () => void; // returns unsubscribe
};
```

- Payloads are **decrypted domain objects** — from step 18 the SDK owns the
  realtime change feed + row decryption (today's `use-track-wallet-changes`
  handler set maps 1:1 onto this event map).
- Naming invariant: `<entity>.<verb>`, entity = the domain type name in
  kebab-case. **Verbs are per entity, not universal** — an entity emits the
  verbs its data model supports. Most quote/swap/account/transaction entities
  emit `created` + `updated`; **`contact` emits `created` + `deleted` only**
  (contacts are immutable today — an owner→username link with no update path).
  `created` matters cross-device: a quote initiated on one device must reach the
  user's other sessions. Terminal transitions (completed/expired/failed) arrive
  as `updated` with the new state on the payload, not as separate event names.
- **`account.updated` vs `account.balance-changed` are two kinds of change.**
  `account.updated` = a persisted row changed; its payload carries a `version`
  and consumers version-gate on it. `account.balance-changed` = a live rail-side
  balance signal with no version semantics. Cashu accounts only ever emit
  `account.updated` (balance is row-derived); **spark accounts emit
  `account.balance-changed`** from the SDK's internal Breez listeners (replacing
  today's raw-handle listeners). The contract `Account` carries `balance` and
  does **not** expose a raw wallet handle.
- **`connection.changed`** emits on every transition into `connected` —
  including the first subscribe, not only reconnects — so the invalidate-all
  sweep also covers changes that land between first render and subscription
  (replacing today's `onConnected`). `error` is terminal: the channel is dead
  after retries exhaust (today's `SupabaseRealtimeError` → error boundary),
  distinct from a long `reconnecting`.
- **`background.state-changed`** fires only on systemic background failures
  (see Execution model); per-task errors never fire it.
- Event names are stable contract; adding events is non-breaking, renaming is
  breaking.

## `ServerSdk`

Lightning-address routes run server-side with different trust: env-provided
secrets, no user session, per-request scope.

```ts
type ServerSdkConfig = {
  db: { url: string; serviceRoleKey: string };
  spark: { breezApiKey: string; network: SparkNetwork; mnemonic: string; storageDir: string };
  quoteEncryptionKey: string; // hex; encrypts LNURL verify payloads
};

class ServerSdk {
  static create(config: ServerSdkConfig): ServerSdk; // singleton per process
  lightningAddress: {
    handleLud16Request(params: { username: string; baseUrl: string }):
      Promise<LNURLPayParams | LNURLError>;
    handleLnurlpCallback(params: {
      userId: string; amount: Money<'BTC'>; baseUrl: string; bypassAmountValidation?: boolean;
    }): Promise<LNURLPayResult | LNURLError>;
    handleLnurlpVerify(params: { encryptedQuoteData: string }):
      Promise<LNURLVerifyResult | LNURLError>;
  };
}
```

The `Request` object (a constructor param today) becomes a per-method
`baseUrl` param, so `ServerSdk` constructs once per process instead of per
request. No `auth` port, no `events`, no `background`.

`db` uses the **service-role key**, not the anon key: these routes do cross-user
reads with no user session, where anon + RLS returns nothing — that different
trust model is the whole reason `ServerSdk` exists. `spark.storageDir` is
required (every route passes it today). `bypassAmountValidation` is a per-request
**method** param, not instance state — it selects the agicash→agicash pay path
(default-currency/FX receive vs BTC-only), and kept as instance state it would
race across concurrent requests on the per-process singleton. `min`/`maxSendable`
stay hardcoded in the service for now. The host still owns wire parsing: a raw
millisat query string is converted to `Money<'BTC'>` before the call, so an
invalid amount can't reach the SDK (the `Money` constructor rejects it).

## Root exports (module level, stateless)

Alongside the existing domain types, the package root exports the pure
helpers the web consumes that need no instance state:

- codecs/inspection: `decodeCashuToken`, `tokenToMoney`, `getTokenHash`
- validation: `validateBolt11`, `validateLightningAddressFormat`,
  `cashuMintValidator`
- errors: `SdkError` (abstract base — everything the SDK throws extends it,
  giving hosts one `instanceof` check at the boundary) with `DomainError`,
  `ConcurrencyError`, `NotFoundError`, `UniqueConstraintError`,
  `WebAssemblyUnavailableError` (thrown by `init()` / first Spark use where
  WebAssembly is unavailable; web `instanceof`-checks it for the fallback UI).
  Subclass semantics are contract: `DomainError.message` is the only
  user-displayable message; `ConcurrencyError` always means retry.
- exchange rate: `exchangeRate` — provider fallback chain (mempool → coingecko →
  coinbase); holds no instance state or ports, so a rate lookup needs no `Sdk`.

Anything touching the DB, keys, or accounts lives on the instance. The Zod
row schemas + transaction-details parsers the web imports today are
migration-era leftovers: they become SDK-internal at step 18 (web stops
parsing rows once events deliver domain objects).

## Migration mapping

| `/temporary` consumer group today | Contract home |
| --- | --- |
| `*Repository` / `*Service` classes | internal, behind namespaces |
| db row types + `*DbDataSchema` | internal (step 18 removes web's need) |
| `getEncryption`, encrypt/decrypt fns | internal (auth slice) |
| cashu wallet plumbing (`getInitializedCashuWallet`, mint auth…) | internal |
| pure codecs/validators/errors | root exports |
| feature-flag fns | `sdk.featureFlags` |
| exchange-rate | root export (stateless) |
| account/user predicate helpers (`getAccountBalance`, `shouldVerifyEmail`…) | stay root exports (pure fns over domain types) |
| `TaskProcessingLockRepository`, processors | internal, behind `sdk.background` |

## Decision points (all four signed off in review #1164)

Kept as the rationale trail; each is now resolved.

1. **DB port granularity** — `{ url, anonKey }`, SDK builds the client and wires
   its own access token (auth is inside). Alternative (host passes a pre-built
   Supabase client) rejected: the token getter would point back into the SDK.
   **Resolved: adopted** — client port only; `ServerSdk` separately takes a
   service-role key.
2. **Flow-first namespaces** (`sdk.receive.cashu`) over rail-first
   (`sdk.cashu.receive`) — matches the app mental model and slice sequence.
   **Resolved: adopted.**
3. **`userId` implicit from session** — repos keep explicit params internally;
   namespaces close over the session. **Resolved: adopted.**
4. **Processor verbs off the public surface** — `complete/expire/fail` are
   background-only; hosts observe via events. **Resolved: adopted** — the
   Execution model section above states the "what runs the loop" obligation this
   creates.
