# Wallet SDK — Full Migration Design

**Status:** approved design (pre-implementation-plan)
**Date:** 2026-06-13
**Builds on:** PR #1119 — `@agicash/wallet-sdk` contract (types + interfaces, no impl)

---

## 1. Context & Goal

PR #1119 shipped the SDK *contract as code*: the public domain types, the domain
interfaces (declarations only), the `Sdk` class shape, `SdkConfig`, the event
layer, and the error classes — no implementation.

This initiative implements **every** SDK domain and migrates the **web app** to
consume the SDK fully, so the wallet's business logic is reusable by a future
**MCP wallet**. The end state: the SDK is the sole owner of all external
connections and wallet logic; the web app is a thin React shell.

**Delivery:** the whole migration lands as **one PR** (owner's decision; see
§2). To keep that safe it is *built* as an ordered commit sequence on one
branch — the web keeps working untouched while the SDK is built "dark," and the
risk concentrates into a single well-contained cut-over guarded by a
verification gate (§9–§10).

> Scope note: this effort began as "auth + user domains only" and was
> deliberately widened to the full wallet during brainstorming. The narrower
> framing is preserved in git history but superseded by this document.

---

## 2. Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | **Ignore the prototype branches** (`sdk/pr2-core`, `sdk/pr3-auth-user`, the `sdk-reactive/*` stack). Write fresh. | Owner's call. They exist as reading reference only; no code is lifted from them. |
| D2 | **User-row bootstrap = ensure-on-resolve, owned by the SDK.** `getCurrentUser()` / sign-in tail reads the `wallet.users` row; if missing or drifted (email / emailVerified) it derives keys + runs `upsert_user_with_accounts`. | Matches master's reconcile-on-entry semantics (`_protected` middleware); honours the contract's "sign-in returns the wallet `User`." |
| D3 | **SDK owns all key derivation**, including the Breez WASM signer for the spark identity pubkey. | Full migration ⇒ the SDK is the sole Breez/WASM owner anyway, so there is no dual-ownership window; this is the MCP-correct end state. |
| D4 | **Contract amendments** (§6): email verification, two-step password reset, terms + default-currency on `UserDomain`, `user:updated` event. | The web's real flows need surface the PR1119 contract lacks. |
| D5 | **Web stays a thin consumer: keep TanStack Query, swap internals, add one events→cache bridge.** Web deletes its repositories, services, OpenSecret/Breez/Supabase clients, task-processor, and own realtime. | Smallest UI blast radius; consumers + Suspense boundaries untouched; uses the SDK's events-only reactivity. |
| D6 | **Server-side paths are in scope**, via a server-mode SDK. | "Everything in one PR"; the Lightning Address routes are part of the wallet. |
| D7 | **One PR, big-bang delivery.** | Owner's decision, made against the recommendation to stage it. The risk (entire money path, fresh code, unreviewable-as-one-diff, unverifiable-until-end) was presented and accepted. De-risked by the build sequence + verification gate (§9–§10), **not** by reducing scope. |
| D8 | **`@agicash/money` is a standalone shared workspace package**; `db-types` and the other pure libs (`bolt11`, `ecies`, `lnurl`, `cashu-protocol`) are **SDK-internal**. | `Money` *values* cross the SDK↔web boundary, so a single shared module is mandatory (`instanceof` must hold). Nothing outside the SDK touches the DB or those libs in the end state. Rule: *shared package iff a non-SDK consumer needs it (esp. values crossing the boundary); else internal.* |
| D9 | **Client and server are separate facades** — a narrow `ServerSdk` (via `createServer(config)`) over the **same** internal substrate, not one class branching on mode. | The two surfaces differ radically; one branching class would expose ~10 domains that throw server-side — a footgun and a dishonest type. Services are written session-agnostic, so the internals are shared with no duplication. |
| D10 | **No connectivity seam.** Catch-up after reconnect/resume stays web-side via TanStack `refetchOnReconnect`/`refetchOnWindowFocus: 'always'` (already set on the queries; kept). The SDK's realtime self-heals (Supabase client + manager backoff). `background.start()`/`stop()` tie to **auth lifecycle** (start on sign-in/app-ready, stop on sign-out/destroy), **not** visibility — so nothing halts when backgrounded; pending sends keep processing. | Cache staleness is a *cache* concern → lives with the cache (web). Realtime resubscription is SDK-internal. The two were conflated in an earlier draft. An optional reconnect *nudge* can be added later if WS recovery proves too slow. |

---

## 3. Target Architecture

The SDK becomes the single owner of every external connection and all wallet
business logic. The web app becomes a thin React shell: routes, UI, Zustand
stores, TanStack Query, and framework/transport glue. No permanent seams — the
transient dual-ownership exists only on the branch and is erased by the cut-over.

**Two operating modes, two facades, one internal substrate:**

```
┌───────────────────────── BROWSER (client mode — Sdk) ────────────────────────┐
│  React shell (routes, UI, Zustand stores, TanStack Query)                     │
│      │  query/mutation internals call ↓        ↑ events→cache bridge          │
│  ┌───┴───────────────────────────────────────────────────────────────────┐   │
│  │  Sdk  (storage adapter + OpenSecret session, RLS JWT)                  │   │
│  │   owns → OpenSecret · Supabase (anon+JWT) · Breez WASM + per-account   │   │
│  │          wallets · cashu wallets · orchestrator · leader election ·    │   │
│  │          Supabase realtime → SDK events                                │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘

┌───────────────────── SERVER (server mode — ServerSdk) ───────────────────────┐
│  RR resource routes (.well-known/lnurlp, api.lnurlp.*) = thin handlers        │
│      │  call ↓                                                                │
│  ┌───┴───────────────────────────────────────────────────────────────────┐   │
│  │  ServerSdk  (serviceRoleKey · NO enclave session · NO per-user keys)   │   │
│  │   owns → Supabase (service-role, RLS-bypass) · a dedicated SERVER      │   │
│  │          Spark wallet (own mnemonic) for invoicing on behalf of users  │   │
│  │   exposes → username/account resolution + receive-quote primitives     │   │
│  │             + quote-status                                             │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Web keeps (framework/browser concerns):** all `app/routes/*` + loaders /
guards / redirects; the SSR session-hint cookie; OAuth browser-redirect plumbing
(stashing `location.search`/`hash`); Zustand multi-step flow stores; theme; PWA;
`import.meta.env` (now only to assemble `SdkConfig`); all UI; TanStack Query.

**Web deletes (moves into the SDK):** every `*-repository.ts` / `*-service.ts`;
the OpenSecret wrappers (`user/auth.ts`, `shared/auth.ts`, `cryptography.ts`,
`encryption.ts`); `shared/cashu.ts` + `shared/spark.ts` wallet/key logic;
`database.client.ts` + `database.server.ts`; `supabase-session.ts`; the
task-processor + leader election; the web's own realtime change-handlers.

---

## 4. SDK Internal Structure

```
packages/
  money/                      @agicash/money — shared pkg (SDK + web both depend; values cross boundary)
  wallet-sdk/
    src/
      index.ts                barrel: Sdk · ServerSdk · public types · errors
      sdk.ts                  Sdk        — create(config): Promise<Sdk>   (client, all 11 domains)
      server-sdk.ts           ServerSdk  — createServer(config): ServerSdk (narrow surface, shared internals)
      config.ts events.ts errors.ts classify.ts
      domains/                client domain impls (auth user accounts scan cashu spark
                              transactions contacts transfers exchange-rate background)
      internal/
        connections/          open-secret · supabase-client (client+server) · supabase-session · breez · event-emitter
        db/                   generated Supabase db-types + row→domain mappers
        repositories/         per-entity DB access (shared by client domains AND ServerSdk)
        services/             session-agnostic business logic (take explicit account/user; shared by both facades)
        orchestrator/         executeQuote state machine · receiveToken melt-then-mint · balance listener · task processors
        background/           leader election (take_lead, 5s poll) · start/stop · lifecycle state
        realtime/             pure subscribe/backoff manager (self-healing) + DB-event → SDK-event forwarder
        crypto/               framework-free password/sha256 + key-derivation paths
        lib/                  SDK-only pure libs: cashu-protocol · bolt11 · ecies · lnurl
```

**Connection bundle** (`SdkConnections`) is assembled by `create`/`createServer`
and shared by every impl — one client each, no duplication. Client mode:
`storage` + OpenSecret session + RLS-JWT token provider + Breez (user wallets).
Server mode: `serviceRoleKey` client + a dedicated **server Spark wallet** (own
mnemonic) + cashu mint clients; **no** OpenSecret session, **no** per-user keys.

**Config replaces `import.meta.env`:** mint blocklist, feature flags, Breez API
key, lud16 domain, and `serverSparkMnemonic` (server mode) all arrive via
`SdkConfig` — no module-level env reads survive in the SDK.

---

## 5. The Reactive Bridge

"Keep TanStack, swap internals" = three cleanly separated channels.

1. **Reads** — TanStack query functions, same query keys as today, internals
   swapped: `queryFn: () => sdk.accounts.list()` instead of a repository. The SDK
   is stateless per call (no-cache); TanStack Query *is* the web's read cache.
   Every `useUser`/`useAccounts`/… consumer and Suspense boundary is unchanged.
2. **Writes** — mutations call SDK methods; `onSuccess` may still `setQueryData`
   for instant feedback, as today.
3. **Reactivity** — **one** `useSdkEventBridge(queryClient)` (mounted where
   `Wallet` mounts its trackers today) subscribes to `sdk.events` and maps each
   to a cache op — replacing *all* of the web's realtime/listener machinery:

| SDK event | Cache action |
|---|---|
| `auth:signed-in` | invalidate `['auth-state']` + `['feature-flags']` |
| `auth:signed-out` | `queryClient.clear()` + clear Sentry user |
| `auth:session-expired` | toast + sign-out / guest-extend (the old `useHandleSessionExpiry` logic, event-driven) |
| `user:updated` | `setQueryData(['user'], user)` |
| `account:updated {account, op}` | upsert into `['accounts']` (version-aware) |
| `transaction:created` / `:updated` | upsert `['transactions']` + refresh pending-ack count |
| `contact:created` / `:deleted` | upsert / remove `['contacts']` |
| `send:*` / `receive:*` | (a) drive the transaction/account updates above; (b) refresh the per-quote query the **active flow screen** reads for live UNPAID→PENDING→PAID state; (c) foreground flows still drive toasts from their Zustand stores |

**Active flow screens** (sending…/receiving…) read a per-quote query (e.g. `['cashu-send-quote', id]` backed by `sdk.cashu.send.get(id)`); the bridge refreshes that key on the matching `send:*`/`receive:*` event — this replaces the deleted quote caches.

**Two rules carried over:** (a) **version-aware apply** — never overwrite a newer
cache entry with an older event (reuse the existing `{Entity}Cache` version
logic); (b) **pre-warm on entry** — the `_protected` loader seeds the cache via
SDK reads so first render resolves from cache.

---

## 6. Contract Deltas

Amendment to `packages/wallet-sdk/src/domains.ts` + `events.ts`:

```ts
interface AuthDomain {
  // ... existing ...
  verifyEmail(code: string): Promise<User>;          // re-resolves; emailVerified flips
  requestEmailVerificationCode(): Promise<void>;      // resend
  resetPassword(email: string): Promise<{ secret: string }>;   // caller holds secret
  confirmPasswordReset(params: {
    email: string; code: string; secret: string; newPassword: string;
  }): Promise<void>;
  // terms accepted in the signup UI ride the initial upsert (no accept-terms flash):
  signUp(p: { email; password; termsAcceptedAt?; giftCardMintTermsAcceptedAt? }): Promise<User>;
  signInGuest(p?: { termsAcceptedAt?; giftCardMintTermsAcceptedAt? }): Promise<User>;
  completeOAuth(p: { /* … */ termsAcceptedAt?; giftCardMintTermsAcceptedAt? }): Promise<User>;
}
interface UserDomain {
  // ... existing ...
  acceptTerms(p: { wallet?: boolean; giftCardMint?: boolean }): Promise<User>;
  setDefaultCurrency(currency: Currency): Promise<User>;
}
type SdkEventMap = { /* … */ 'user:updated': { user: User } };

interface ExchangeRateDomain {
  convert(params: { amount: Money; to: Currency }): Promise<Money>;   // existing (contract)
  getRates(params: { tickers: Ticker[] }): Promise<Rates>;            // new — raw rates for the reactive rate UI
  getRate(ticker: Ticker): Promise<string>;                           // new
}
```

Plus a small **server surface** on `ServerSdk` (exact names settled in the plan):
resolve a username → public receiving capability; create a receive quote for a
resolved account session-less; read a quote's settle status (LUD-21 verify). The
LUD JSON wire format stays in the RR routes; `SdkConfig` gains `serverSparkMnemonic`.

---

## 7. Migration Map (moves / deletes / stays)

### 7a — Shared substrate (moves first)

| Web today | → SDK |
|---|---|
| `entry.client.tsx` `configure()`, `shared/auth.ts` `isLoggedIn`, `shared/cryptography.ts` | `internal/connections/open-secret` + `internal/crypto` |
| `shared/encryption.ts` (ECIES + key @ `m/10111099'/0'`) | `internal/crypto` + `internal/lib/ecies` |
| `shared/cashu.ts` (seed/xpub/wallet-init/mint-auth), `agicash-mint-auth-provider.ts` | `internal/connections` (cashu) + key derivation; `VITE_CASHU_MINT_BLOCKLIST` → config |
| `shared/spark.ts` (mnemonic, identity pubkey, `connect()`, balance listener, WASM), `lib/spark/*` | `internal/connections/breez`; `VITE_BREEZ_API_KEY` → config; `DEBUG_LOGGING_SPARK` → `config.featureFlags` |
| `database.client.ts` + `database.server.ts` + `supabase-session.ts` | `internal/connections/supabase-client` (client+server) + `supabase-session` |
| `lib/supabase/*` realtime **manager** (pure, self-healing) | `internal/realtime` (auto-reconnect/backoff is internal; no web connectivity seam) |

Libs: `money` → `@agicash/money`. `bolt11`·`ecies`·`lnurl`·`cashu-protocol` → `internal/lib`. `agicash-db/database.ts` → `internal/db`.

### 7b — Per-domain

| Domain | → SDK (moves) | ✗ web deletes | web keeps (thin) |
|---|---|---|---|
| **auth** | `user/auth.ts` OS-wrappers, guest-storage, pwd/sha256 gen → `domains/auth` | `useAuthActions` internals, `useHandleSessionExpiry` *timer* | `authQueryOptions`/`useAuthState` (queryFn→sdk), login/signup UI, OAuth redirect plumbing, session-hint cookie |
| **user** | repos (get/update/**upsert + ensure-on-resolve**), `UserService`, dbUser mapper → `domains/user` | `UserCache`, `useUserChangeHandlers` | `useUser`, thin mutation hooks, profile UI |
| **accounts** | types/utils, BIP-85 paths, repo (`toAccount`+decrypt+wallet-init), service → `domains/accounts` | `AccountsCache`, `useAccountChangeHandlers` | `useAccounts`/`useBalance` (derive over subscribed list), account UI |
| **scan** | `classify-input` → `domains/scan`; `MODE` → config | — | scan route + nav/toast |
| **exchangeRate** | service + 3 providers (coinbase/coingecko/mempool) → `domains/exchange-rate` (exposes `getRates`/`getRate` **and** `convert`) | — | `use-exchange-rate` hooks (queryFn→`sdk…getRates`; 15s refetch stays) |
| **cashu** | send/receive quote+swap (schema/service/repo), token-claim, melt/mint subscription **managers**, mint-validation → `domains/cashu` + `orchestrator` + `internal/lib/cashu-protocol` | all cashu caches, `useProcessCashu*Tasks`, cashu change-handlers, `useOnMeltQuoteStateChange`, queryClient-in-service | send/receive Zustand stores, `animated-qr-code`, routes |
| **spark** | send/receive quote (+`.server` variants), `shared/spark` lifecycle+balance-listener, `lib/spark` → `domains/spark` + `connections/breez` + `orchestrator` | spark caches, `useProcessSpark*Tasks`, `useTrackAndUpdateSparkAccountBalances` | spark send/receive UI + routes |
| **transactions** | schema, repo (cursor list/count/ack/`toTransaction`), 6 details parsers → `domains/transactions` + `internal/db` | `TransactionsCache`, `useTransactionChangeHandlers` | `useTransactions` (infinite query over cursor), list/details UI, ack-status Zustand store, visibility-ack |
| **contacts** | `contact` + repo (CRUD + `findContactCandidates`) → `domains/contacts` | `ContactsCache`, `useContactChangeHandlers` | `useContacts`/search; lud16 domain → config |
| **transfers** | `transfer-service` (paired send+receive, `transferId`, auto-fail) → `domains/transfers` | quote/initiate hook internals (no transfer cache) | `transfer-store` (Zustand), transfer UI/scanner |
| **background** | `take_lead` repo, leader election, 6 task orchestrators, realtime forwarder → `domains/background` + `internal/{background,realtime}` | `TaskProcessor`, `useTakeTaskProcessingLead`, `use-track-wallet-changes`, all `*ChangeHandlers` | `Wallet` calls `sdk.background.start()` (sign-in) / `stop()` (sign-out) + mounts the one bridge; keeps `refetchOnReconnect`/`OnWindowFocus` for catch-up |

### 7c — Web residue (thin consumer)
- `features/shared/sdk.ts`: `getSdk()` client singleton from `VITE_*` → `SdkConfig` (incl. `featureFlags`, `cashuMintBlocklist`, lud16 domain). Server entry builds a `createServer()` instance.
- The **one** `useSdkEventBridge(queryClient)` in `Wallet`.
- Every `*-hooks` becomes thin: `queryFn`/`mutationFn` → `sdk.*`.

### 7d — Stays web-only (framework/browser)
Routes + loaders/guards/redirects (`_protected`/`_auth`/`_public`), session-hint
cookie + `require-session-hint.server`, OAuth redirect stashing
(`oauth-login-session-storage`, pending-terms), all Zustand multi-step stores,
`animated-qr-code` + view-transitions + UI, React util hooks (`use-latest`,
`useMoneyInput`, …), and `import.meta.env` reads (only to assemble `SdkConfig`).

---

## 8. Correctness Risks (carried into implementation)

| Risk | Status | What the SDK must preserve |
|---|---|---|
| **Spark stale-balance race** (`shared/spark.ts:180-230`) | Already handled today; **porting hazard only** | The balance listener must re-read `getInfo()` on the `synced` event, not just on `paymentSucceeded`. Without it, a stale (pre-payment) balance sticks. `account:updated` compare-before-emit suppresses the no-op. **Regression test required.** |
| **nutshell #788 change loss** (`melt-quote-subscription.ts:68-86`) | Must be preserved, abstracted into the SDK | On melt `PAID`, if `inputAmount > meltQuote.amount` (change expected) but `change` is absent from the WS payload, refetch via `checkMeltQuoteBolt11` before completing — else the user's change ecash (real sats) is lost. Lives inside the orchestrator's melt handler; invisible to consumers. **Regression test required.** |
| **Server-side Spark receive** | Understood; works today | The server uses a **dedicated server Spark wallet** (`LNURL_SERVER_SPARK_MNEMONIC` → `config.serverSparkMnemonic`) and calls `getLightningQuote({ wallet: serverWallet, amount, receiverIdentityPubkey: user.sparkIdentityPublicKey })` — Breez `receivePayment` mints an invoice claimable only by the receiver, using the receiver's *public* key. No receiver private keys. Cashu receivers need no Breez. ⇒ **server mode runs Breez WASM** (corrects an earlier "no Breez server-side" assumption). |
| **Reconnect/resume staleness** | Resolved (no seam) | Supabase realtime can't replay missed messages, so after a drop the web cache would be stale. Fix stays **web-side**: TanStack `refetchOnReconnect`/`refetchOnWindowFocus: 'always'` (kept) refetches via SDK reads. SDK realtime resubscribes internally. No web→SDK connectivity API; `background.start/stop` are auth-lifecycle only (D10). |
| **Breez `initLogging` single-global-subscriber** | Note | The SDK must guard `initLogging` to a single attempt (master's `loggingStatus` guard) so it can't be called twice. |
| **Leader-election / dual-ownership** | Avoided by sequencing | The web's task-processor + realtime are deleted in the same cut-over step (§9 S13) that starts `sdk.background` — never two leaders or two realtime owners in the merged result. |

---

## 9. Build Sequence (one branch, ordered commits, merged as one PR)

### Phase 0 — Foundation
- **S1 · `@agicash/money`** shared package (web + SDK import it; behaviour identical). First, because its instances cross the boundary.
- **S2 · SDK core shell** — `config`·`events`·`errors`+`classify`·connections·`crypto`. Domains stubbed (`NotImplemented`). SDK vendors internal copies of the pure libs + `db-types` as needed.

### Phase 1 — SDK domains, built "dark" (present, unit-tested, **not imported by the web**)
- **S3** auth + user (session resolver, ensure-on-resolve bootstrap, user repo, db-user mapper)
- **S4** accounts + scan + exchangeRate (+ live wallet-handle resolution)
- **S5** cashu ops (send / receive / token-claim)
- **S6** spark ops (send / receive; client + **server** spark wallet)
- **S7** orchestrator (`executeQuote` + melt/mint WS + #788; `receiveToken` melt-then-mint; balance listener incl. `synced` reconcile; the 6 task processors)
- **S8** transactions + contacts + transfers
- **S9** background (leader election, `start`/`stop`) + realtime forwarder + connectivity commands
- **S10** `ServerSdk` facade over shared internals

*Through Phase 1 the web is untouched and runs on its own code; each slice is verified by SDK unit tests alone.*

### Phase 2 — Web cut-over (old code deleted here)
- **S11** `getSdk()` singleton + `SdkConfig` (client entry) and `createServer()` (server entry)
- **S12 · Reads** — flip every `queryFn` to `sdk.*`. Web realtime still drives reactivity. **Checkpoint: app works on SDK reads.**
- **S13 · Reactivity + orchestration flip** (necessarily atomic — see below) — `sdk.background.start()`, mount the events→cache bridge, flip send/receive/transfer mutations; **delete** the web's repos · services · OS-wrappers · encryption · cashu/spark shared · `database.client` · `supabase-session` · task-processor · realtime · all `*ChangeHandlers`. **Checkpoint: app fully on the SDK (client).**
- **S14 · Server routes** — LN-address routes call the `createServer()` instance; delete `database.server.ts` + `lightning-address-service.ts` from the web.
- **S15 · Cleanup** — delete the web's now-dead lib copies, drop unused deps, `fix:all`.

> **S13 cannot be subdivided per-domain.** The web `TaskProcessor` and the SDK background processor both poll the same `wallet.task_processing_locks` + task tables; running both at once risks double-processing a quote (double melt/mint — a real-money bug). So orchestration flips in one step (start SDK background ⇄ delete web processor). Reads (S12) subdivide freely; the write/orchestration path does not. This step is the focus of the verification gate.

Temporary lib duplication lives only on the branch; the cut-over deletes the web's copies, so the merged PR has each lib in exactly one place (`money` shared, the rest SDK-internal).

---

## 10. Verification Gate (before the PR is "done")

- **Per SDK slice:** unit tests — services, mappers, `classify`, repos against a mocked Supabase client, orchestrator transitions. Explicit **regression tests**: stale-balance `synced` re-read; nutshell-#788 change refetch; taken-username → `DomainError`; transfer receive-auto-fails-on-send-failure.
- **Post-cut-over (S13/S14):** `bun run fix:all` + web unit suite + **`bun run test:e2e`** all green — e2e passing on the flipped app is the strongest "behaves identically" proof.
- **Manual (Chrome DevTools MCP)** on the money paths: sign in/up/guest/OAuth · verify-email · accept-terms · cashu send + receive (token + LN) · spark send + receive · cross-account transfer · LN-address receive (cashu + spark) + LUD-21 verify.

---

## 11. Open items to resolve during planning

- **`ServerSdk` method names** — final naming for the resolution / receive-primitive /
  quote-status surface.
- **Server Breez footprint** — confirm the server Spark wallet's WASM init cost
  is acceptable in the Vercel/Node runtime, and the `storageDir` strategy
  (`/tmp/.spark-data` today).
- **`SdkConfig` additions** — `featureFlags`, `cashuMintBlocklist`, lud16
  `domain`, `serverSparkMnemonic`, plus the `Ticker`/`Rates` types for
  exchange-rate; fold into the contract amendment.

**Resolved during review (2026-06-13):** exchangeRate surface = `getRates`/`getRate`
+ `convert` (§6); gift-card discovery stays web-side reading SDK account data
(`VITE_GIFT_CARDS` → config); **no connectivity seam** — catch-up is web-side
TanStack refetch and `background.start/stop` are auth-lifecycle (D10/§8); active
flow-screen live state via a per-quote query fed by the bridge (§5); S13 is
necessarily atomic (§9).
