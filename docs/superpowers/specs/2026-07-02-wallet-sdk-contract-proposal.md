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
    url: string;      // Supabase project URL
    anonKey: string;  // Supabase anon key
  };
  auth: {
    apiUrl: string;         // Open Secret backend URL
    clientId: string;       // Open Secret client id
    storage: AuthStorage;   // host-backed session persistence
  };
  spark: {
    breezApiKey: string;
    network: SparkNetwork;
    storageDir?: string;    // node hosts; browser default applies
  };
  lightningAddressDomain: string; // lud16 domain for contacts/display
};

type AuthStorage = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
};

class Sdk {
  static create(config: SdkConfig): Sdk; // sync; connects lazily
  dispose(): Promise<void>;              // tears down realtime + background
}
```

Notes:

- **The SDK builds its own Supabase client.** Auth lives inside the SDK
  (step 5), so the access-token getter (Open Secret JWT → Supabase session)
  wires internally — the host cannot supply it without a circular dependency.
  The host supplies only `url` + `anonKey`.
- **All key material stays lazy.** Encryption keys, the Cashu seed, and the
  Spark mnemonic derive on demand from the authenticated Open Secret session
  (constructors already take `() => Promise<…>` getters today — the internal
  wiring keeps that shape).
- `create` is synchronous: constructing an `Sdk` does no I/O. First use of a
  namespace (or `auth.getSession()`) drives connection. This keeps hosts free
  to construct at module scope.

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
  exchangeRate: ExchangeRateApi;
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
  add(params: AddAccountParams): Promise<CashuAccount>; // input discriminated on type; only 'cashu' addable today
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
  stop(): Promise<void>;
  readonly state: 'stopped' | 'follower' | 'leader';
};
```

Two conventions across all namespaces:

- **`userId` is implicit.** The instance knows the authenticated user; methods
  don't take `userId` params (today's repos do — the namespace layer closes
  over the session).
- **Completion is not the host's job.** Methods like `expire`/`fail`/
  `completeSwap` that today's hooks call from background processors do NOT
  appear on the public namespaces — they move behind `sdk.background`
  (step 18). The public surface is: initiate, read, observe events.

## Events

```ts
type WalletEventMap = {
  'user.updated': { user: User };
  'account.created' | 'account.updated': { account: Account };
  'contact.created' | 'contact.deleted': { contact: Contact };
  'transaction.created' | 'transaction.updated': { transaction: Transaction };
  'cashu-receive-quote.created' | 'cashu-receive-quote.updated': { quote: CashuReceiveQuote };
  'cashu-receive-swap.created' | 'cashu-receive-swap.updated': { swap: CashuReceiveSwap };
  'spark-receive-quote.created' | 'spark-receive-quote.updated': { quote: SparkReceiveQuote };
  'cashu-send-quote.created' | 'cashu-send-quote.updated': { quote: CashuSendQuote };
  'cashu-send-swap.created' | 'cashu-send-swap.updated': { swap: CashuSendSwap };
  'spark-send-quote.created' | 'spark-send-quote.updated': { quote: SparkSendQuote };
  'connection.changed': { state: 'connected' | 'reconnecting' };
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
  kebab-case. Every persisted entity emits `created` and `updated` — `created`
  matters cross-device: a quote initiated on one device must reach the user's
  other sessions. Terminal transitions (completed/expired/failed) arrive as
  `updated` with the new state on the payload, not as separate event names.
- `connection.changed → 'connected'` is the web's invalidate-all signal on
  reconnect, replacing today's `onConnected` cache sweep.
- Event names are stable contract; adding events is non-breaking, renaming is
  breaking.

## `ServerSdk`

Lightning-address routes run server-side with different trust: env-provided
secrets, no user session, per-request scope.

```ts
type ServerSdkConfig = {
  db: { url: string; anonKey: string };
  spark: { breezApiKey: string; network: SparkNetwork; mnemonic: string };
  quoteEncryptionKey: string; // hex; encrypts LNURL verify payloads
};

class ServerSdk {
  static create(config: ServerSdkConfig): ServerSdk; // singleton per process
  lightningAddress: {
    handleLud16Request(params: { username: string; baseUrl: string }):
      Promise<LNURLPayParams | LNURLError>;
    handleLnurlpCallback(params: { userId: string; amount: Money<'BTC'>; baseUrl: string }):
      Promise<LNURLPayResult | LNURLError>;
    handleLnurlpVerify(params: { encryptedQuoteData: string }):
      Promise<LNURLVerifyResult | LNURLError>;
  };
}
```

The `Request` object (a constructor param today) becomes a per-method
`baseUrl` param, so `ServerSdk` constructs once per process instead of per
request. No `auth` port, no `events`, no `background`.

## Root exports (module level, stateless)

Alongside the existing domain types, the package root exports the pure
helpers the web consumes that need no instance state:

- codecs/inspection: `decodeCashuToken`, `tokenToMoney`, `getTokenHash`
- validation: `validateBolt11`, `validateLightningAddressFormat`,
  `cashuMintValidator`
- errors: `SdkError` (abstract base — everything the SDK throws extends it,
  giving hosts one `instanceof` check at the boundary) with `DomainError`,
  `ConcurrencyError`, `NotFoundError`, `UniqueConstraintError`. Subclass
  semantics are contract: `DomainError.message` is the only user-displayable
  message; `ConcurrencyError` always means retry.

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
| exchange-rate | `sdk.exchangeRate` |
| account/user predicate helpers (`getAccountBalance`, `shouldVerifyEmail`…) | stay root exports (pure fns over domain types) |
| `TaskProcessingLockRepository`, processors | internal, behind `sdk.background` |

## Decision points (need a call before slice PRs start)

1. **DB port granularity** — proposal: `{ url, anonKey }`, SDK builds the
   client and wires its own access token (auth is inside). Alternative: host
   passes a pre-built Supabase client; rejected here because the token getter
   would point back into the SDK.
2. **Flow-first namespaces** (`sdk.receive.cashu`) over rail-first
   (`sdk.cashu.receive`) — proposal: flow-first, matches app mental model and
   slice sequence.
3. **`userId` implicit from session** — proposal: yes; repos keep explicit
   params internally, namespaces close over the session.
4. **Processor verbs off the public surface** — proposal: `complete/expire/
   fail` are background-only; hosts observe via events. This is the strongest
   simplification vs. today and worth explicit sign-off.
