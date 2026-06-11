# Wallet SDK extraction — plan, progress, and working rules

Status document for the `@agicash/wallet-sdk` extraction (restarted greenfield from master
2026-06-08). Updated at the end of each phase. Current as of: **mid-Phase 6 (receive
domain) — chunk 6.1 committed, 6.2 grounded but not started** (branch
`sdk/phase6-receive`, all local — no PRs/pushes yet, working tree clean, all gates green).

## HANDOFF — read this first

This work is being handed to a fresh agent. Everything you need is in this document plus
the git history; there is no other context. How to resume:

1. You are on branch `sdk/phase6-receive` (stacked on phase5 → phase4 → phase3 → … →
   master). Verify: `git status` clean, `git log --oneline -8` matches the ledger below.
2. Read **Architecture decisions**, **Working method**, and **Landmines** below — these are
   settled with the user; do not relitigate them.
3. Continue with **Phase 6.2** in the *Remaining roadmap* — it contains exact,
   already-grounded instructions. Phases after it are specified at decreasing resolution;
   ground each one (read the files, map consumers with `git grep`) before moving code.
4. The user's standing instruction: **finish the whole effort autonomously, no checkpoints**
   — phases 6.2 → 10, then a final report on what the codebase looks like. Commit per
   chunk; never push or open PRs; ask only if genuinely blocked.
5. Conventions: bun only (never npm/yarn/pnpm); default branch is `master`; commit messages
   in the style of the existing ledger commits, ending with the `Co-Authored-By:` line for
   your model; pre-commit hooks run biome + db-types drift-check + typecheck automatically.
6. Update this document at the end of every phase (ledger row + status header + roadmap
   item) — it is the single source of truth and your crash-recovery point.

## Goal

Lift the wallet's domain logic out of `apps/web-wallet` into a framework-free
`@agicash/wallet-sdk` so the web app becomes a thin UI over it and the same engine can back
an **MCP/agent wallet — the MCP is the reason for the extraction and starts immediately
after it.**

A previous 28-PR attempt (#1119–1147, two stacked chains) was reviewed and abandoned. What
sank it: a custom `Query<T>`/`useQ` reactive bridge with an infinite-suspend bug, a
cross-user cache leak on logout, a headless premise that couldn't authenticate, internals
leaked as public API, and unreviewable scope. The faithful service/repository lifts were the
good part; this restart keeps that fidelity discipline and fixes the architecture and
process.

## Architecture decisions (settled — do not relitigate)

- **The SDK owns the single TanStack `query-core` QueryClient** (`getQueryClient()`, pinned
  to react-query's exact version + workspace patch so it is the same class). The web mounts
  it as its only client and consumes SDK reads with **stock react-query hooks**
  (`useSuspenseQuery(sdk.accounts.listOptions(userId))`). No custom reactive bridge.
- **Reads are plain query-options objects** (typed via `@tanstack/query-core`; the
  react-query `queryOptions()` helper is a typed identity and is not used in the SDK).
- **`Query<T>` is deliberately deferred to the MCP phase** that follows the extraction.
  Adding it then is additive: a `subscribe`/`getSnapshot` wrapper over the `QueryObserver`
  the SDK already owns + a small tested `useQ`; consumers flip
  `useSuspenseQuery(x.listOptions())` → `useQ(x.list())` with nothing else changing.
- **Framework-free SDK**: no direct `react`/`react-dom`/`@tanstack/react-query`/DOM imports
  in `packages/wallet-sdk/src`. **One tracked exception**: `@agicash/opensecret` is
  currently the React build (transitive `react` peer-dep + `localStorage`); a
  storage-pluggable version is in flight and the bump lands before the MCP phase. Documented
  in wallet-sdk `package.json` `dependencies:comments`. (`src/auth.ts`'s `isLoggedIn`
  localStorage read is part of the same exception.)
- **Sdk composition root now, not later**: `configureWalletSdk(config)` (one env-derived
  config; server-safe, records state only) + `getSdk()` (client-only lazy browser
  singleton). Domains are composed inside `WalletSdk`; the web wires nothing by hand.
- **Curated domain surfaces** (user principle): app/UI code interacts with a domain ONLY via
  use-case methods (`sdk.accounts.get/add/listOptions/...`). Repository/service/cache are
  internal. Where not-yet-migrated collaborators force exposure, they live under
  `sdk.<domain>.internal` — a documented, grep-able, shrinking escape hatch. **No app/UI
  code may use `internal`.**
- **Web-only concerns never enter the SDK**: route strings (`getAccountHomePath`), toasts,
  React hooks, `import.meta.env` reads, the dev-LAN URL rewrite, Sentry setup. The SDK gets
  capabilities via config/seams (`measureOperation`, `setSparkDebugLogging`).
- **The raw Supabase client never becomes public API.** `configureAgicashDb`/`getAgicashDb`
  are transitional plumbing absorbed by the root; web's `agicashDbClient` re-export exists
  only for unmigrated repositories.
- **Package layout**: `@agicash/utils` (money/json/zod/collections/sha256/ecies) ←
  `@agicash/cashu` (framework-free protocol lib incl. `ExtendedCashuWallet` + subscription
  managers) and `@agicash/db-types` (generated + augmented `Database`, `AgicashDb*` rows,
  json-model schemas; depends on cashu+utils) ← `@agicash/wallet-sdk`. Apps are bare-named,
  libraries `@agicash/`-scoped; shared deps go through the root `workspaces.catalog`
  (exact versions). React/UI cashu pieces (animated-QR, `useOnMeltQuoteStateChange`) stay
  web — a future `@agicash/cashu-ui` if ever needed.

## Working method (how every chunk is done)

1. **Small stacked branches, one reviewable chunk each** (`sdk/phaseN-<name>`), commit per
   chunk, local only; pause for review between phases. Target ~200–500 LOC.
2. **Byte-identical moves**: `git mv`, then only import-path rewrites. Logic changes are
   separate, named, and justified in the commit message. Money/crypto logic is never edited
   in a move.
3. **Re-export shims** at the old path so consumers stay untouched (`// Transitional
   re-export — moved to X; removed in the import-cleanup PR.`). Mixed files don't move:
   pure internals extract, React hooks stay and consume the SDK. One final cleanup PR
   rewrites all imports and deletes shims.
4. **Gates on every chunk** (all must pass before commit):
   - `bun run typecheck` (all packages), `bun run fix:all`, `bun run test`
     (test count must not drop; currently 152: utils 41, cashu 35, wallet-sdk 19, web 57),
     `bun run build` (client+server+prerender — needs `.env` loaded:
     `set -a; . ./.env; set +a`)
   - framework-free grep: `git grep -nE "from 'react'|@tanstack/react" packages/wallet-sdk/src`
     → only comments
   - encapsulation grep: `git grep -nE "\.(internal)\." -- apps/web-wallet` → only
     sanctioned transitional sites (hooks-as-bindings + realtime wiring + stranded
     collaborators, each carrying the transitional JSDoc)
5. **Test-lock load-bearing behavior** when it lands in its clean SDK file (it cannot be
   tested while inside web files — their import graphs need Vite env at module load).
   Already locked: AccountsCache version-guard, spark-balance write-guard,
   `structuralSharing` (preserves session-expired accounts), encryption roundtrip +
   serialization rules (Date/undefined/Infinity/Money), lazy-encryption key resolution,
   `getSdk` server-throw, QueryClient server-per-request vs browser-singleton.
6. **Ground before gnarly chunks**: map exports/consumers/deps first (read the code; use
   subagents for breadth), decide the seam, then move. Verify claims by running code, not
   by assumption.
7. **No copying for "unblocking"** — a schema/helper needed by two places is extracted once
   and re-export-shimmed, never duplicated.

Patterns settled during phases 3–6 (follow them for every remaining domain):

- **File-per-domain api factory**: each domain owns `{domain}/{domain}-api.ts` exporting
  the `*Api` type + `create*Api(deps)`; `sdk.ts` stays config + composition root (one
  factory call per domain). Cross-domain instances flow through factory returns/deps —
  the root never reaches through `internal`.
- **The SDK derives the current user from its own state** — curated methods never take
  `userId`/`User` from callers. The root builds one `getCurrentUserId` thunk (reads
  `this.user.getCached()`, throws `'No user is loaded. Bootstrap the session first.'`)
  and one lazy Encryption, shared by all domain factories. Only `sdk.user.upsert` takes an
  id (the auth-layer identity injection point — dies in Phase 9). Ids are resolved at
  fetch/call time, never captured at options creation (prevents pinning a previous
  session's id).
- **Primitives, not policy**: curated reads return `T | null`; throw-on-missing wrappers
  belong to consumers (web's `getUserFromCacheOrThrow`). Mutations DO throw on
  unsatisfiable preconditions (`@throws` documented).
- **Query-policy split**: domain semantics live in SDK options (staleTime, domain retry
  rules like NotFoundError-no-retry, queryFn cache write-throughs); reactive consumption
  policy stays in web hooks (`refetchOnWindowFocus/Reconnect`, plain retry counts,
  `select`, `initialData` polish).
- **Curated mutations absorb their cache write-backs** (no web `onSuccess` cache writes) —
  EXCEPT where the realtime broadcast is the established single write path (contacts
  `create`); preserve whichever behavior the original hook had.
- **Host-environment values enter via config thunks** (`getLightningAddressDomain`)
  because `configureWalletSdk` records on the server too; thunks are only invoked
  client-side after `getSdk()`.
- **Zero-consumer cleanup per phase**: any shim/hook a phase empties is deleted in that
  phase's commit, not left for Phase 10.

## Done (phases, branches, commits)

Stack order (each on the previous): `master` → utils → db-types → db-augmented → cashu →
queryclient → accounts-leaf → ecies → encryption → supabase → cashu-init → spark-init →
db-singleton → accounts-core → sdk-root → user-types → user-core → user-surface.

| Phase | Branch · commit | What landed |
|---|---|---|
| 0.1 | `sdk/phase0-utils` · 3375ff1d | `@agicash/utils`: money (byte-identical), json, zod; shims at `~/lib/{money,json,zod}`; big.js/zod/@types-big.js to catalog |
| 0.2 | `sdk/phase0-db-types` · 36438864 | `@agicash/db-types`: generated `database.types.ts` moved; `db:generate-types`, CI drift-check, biome ignore repointed; tsconfig alias removed |
| 0.3 | `sdk/phase0-db-augmented` · 3b33d91b | augmented `Database` (RPC return types) + `AgicashDb*` rows + isCashu/isSpark guards + 2 account-detail json-models → db-types |
| 0.4 | `sdk/phase0-cashu` · 8fd94841, 104d3faf, f74233aa | `@agicash/cashu`: protocol primitives (+35 tests), then `ExtendedCashuWallet`/`getCashuWallet`/mint-validation + both quote subscription managers (barrel-React-leak fixed; `isSubset`→utils), then 6 more json-models → db-types (db-types now deps on cashu+utils) |
| 1 | `sdk/phase1-queryclient` · 2526d2e8 | SDK owns the QueryClient (query-core pinned 5.90.20+patch); web `query-client.ts` is a re-export; phantom-dep fixes |
| 2.1 | `sdk/phase2-accounts-leaf` · c7f76ebd | account types/predicates/`CashuProofSchema`/BIP-85 path → SDK; `getAccountHomePath` stays web |
| 2.2 | `sdk/phase2-ecies` · c5f35ca2 | ecies → `@agicash/utils` (utils tests 32) |
| 2.3 | `sdk/phase2-encryption` · e131989c | encryption core (ECIES wrappers, serialization rules, `getEncryption`, opensecret key queryOptions) → SDK; web keeps the 3 React hooks; opensecret = tracked exception begins |
| 2.4a | `sdk/phase2-supabase` · fc79e3b8 | `supabase-session` (RLS token, JWT-exp staleTime) + `isLoggedIn` + `createAgicashDb` factory (wallet schema, redacting realtime logger) → SDK; web keeps env + dev-LAN rewrite + realtime manager |
| 2.4b | `sdk/phase2-cashu-init` · 1a8f5acf | cashu crypto (seed/xpub/privkey), mint info/keysets/keys queries, `decodeCashuToken`, NUT-21 CAT auth provider, `getInitializedCashuWallet` → SDK; new `performance.ts` measurer seam; `computeSHA256`→utils; web keeps env-derived `cashuMintValidator` + `useCashuCryptography` |
| 2.4c | `sdk/phase2-spark-init` · d5e7fc5d | spark mnemonic/identity/wallet queries + `getInitializedSparkWallet` + `sparkDebugLog` → SDK via `configureSpark` seam; web keeps Breez env fail-fast + balance-tracker hook |
| 2.4d | `sdk/phase2-db-singleton` · e5f1330d | SDK owns the DB client instance (`configureAgicashDb`/lazy `getAgicashDb`); web re-exports transitionally |
| 2.5 | `sdk/phase2-accounts-core` · 4da2567d | `AccountRepository` (typed deps object; wallet-init now plain SDK imports), `AccountService` (structural `UserDefaultAccounts` until Phase 3), `AccountsCache` + `accountsQueryOptions` + `createAccountChangeHandlers`, `error.ts` (DomainError etc.) → SDK; `spark-config.ts` split keeps cache import graph light; cache test-lock (8 tests) |
| 2.6 | `sdk/phase2-sdk-root` · 91cc9001 | `configureWalletSdk` (absorbs 4 configure seams; one web config point `features/shared/sdk.ts`) + `getSdk()`; **lazy Encryption facade** (keys resolve on first use — root constructs pre-login); wiring hooks → one-liners; measurer registered server-side too (restores lnurlp Sentry spans) |
| 2.7 | `sdk/phase2-sdk-root` · 523f78ae | curated `sdk.accounts` surface: `listOptions/get/getCached/listCached/add` public; `internal = {repository, service, cache, changeHandlers}` escape hatch; `useAccountService` deleted; all app touchpoints on curated methods |
| 3.1 | `sdk/phase3-user-types` · c2eda5b6 | `User`/`FullUser`/`GuestUser`/`UserProfile`/`UpdateUser` + 3 predicates → SDK `user/user.ts`; `AccountService`'s structural `UserDefaultAccounts` replaced with the real `User`; web `user.ts` → shim |
| 3.2 | `sdk/phase3-user-core` · 4312041e | `ReadUserRepository`/`WriteUserRepository` (`upsert_user_with_accounts` RPC)/`ReadUserDefaultAccountRepository` + `UserService` + `UserCache`/`userQueryOptions`/`createUserChangeHandlers` → SDK (verbatim, import remaps only); web repo/service files → shims keeping hooks one more chunk |
| 3.3 | `sdk/phase3-user-surface` · f4ab912f | curated `sdk.user` surface: `queryOptions/getCached/upsert/update/setDefaultAccount` (cache write-backs absorbed; `upsert` records accounts via new `AccountsCache.set`); `internal = {readRepository, writeRepository, service, cache, changeHandlers}`; `ensureUserData` + accept-terms + verify-email + receive-token migrated; `useReadUserRepository`/`useWriteUserRepository`/`useUserService` deleted. `ReadUserDefaultAccountRepository` deliberately NOT in the root: its only consumer is the server-side lnurl path (per-request server db + `LNURL_SERVER_SPARK_MNEMONIC`); a root instance would wrongly bind the logged-in user's mnemonic |
| 3.4 | `sdk/phase3-user-surface` · ca4937df | checkpoint feedback: `getCachedOrThrow` removed from `sdk.user` — whether a missing cached user is exceptional is caller policy, and accounts exposes no orThrow either. SDK keeps the `getCached(): User \| null` primitive; web's `getUserFromCacheOrThrow` (user-hooks) wraps it for protected-layout contexts where missing user = bug |
| 3.5 | `sdk/phase3-user-surface` · 24315f2d | checkpoint feedback: `sdk.ts` split — each domain owns `{domain}/{domain}-api.ts` with the `*Api` type + `create*Api(deps)` factory; `sdk.ts` is just config + the composition root. `createAccountsApi` returns `{api, repository, cache}` so the root wires cross-domain deps (user's WriteUserRepository, upsert accounts write-back) WITHOUT reaching through `internal`; `createLazyEncryption` moved to `encryption.ts`. Pattern for every future domain: new file + one `create*Api` call in the root |
| 3.6 | `sdk/phase3-user-surface` · 92366aa6 | checkpoint feedback: the SDK is a single-user instance (RLS-scoped session), so `sdk.user` methods no longer take the user's identity from outside — `update(data)`, `setDefaultAccount(account)`, `queryOptions()` derive the current user from the SDK's own state (id resolved at fetch/call time, so long-lived observers can't pin a previous session's id). `upsert` keeps `id` in params: it IS the identity injection point from the host's auth layer. Web hooks shrink (`useUpdateUser`/`useSetDefaultAccount` no longer subscribe to user just to echo it back) |
| 3.7 | `sdk/phase3-user-surface` · 1bddaed4 | same treatment for accounts: `listOptions()` and `add(account)` drop caller-passed identity; `AccountsApiDeps.getCurrentUserId` is a thunk the root wires from `this.user.getCached()` (lazy — accounts is constructed before user; only invoked post-bootstrap); `accountsQueryOptions` takes `getUserId` resolved at fetch time (structuralSharing untouched). `useAccounts`/`useAddCashuAccount` stop echoing the id; claim-token service passes `getUserId: () => user.id` for its explicit-user flow |
| 4.1 | `sdk/phase4-transactions` · 3a7bb953 | `DestinationDetailsSchema` → `@agicash/db-types/json-models/destination-details` (it is db-persisted jsonb format; db-types cannot import from the send domain — this broke the cross-package knot); `cashu-lightning-send-db-data` json-model → db-types; send leaf re-exports the schema so send imports are unchanged; orphaned `account-details-db-data` union deleted (zero consumers) |
| 4.2 | `sdk/phase4-transactions` · 7d6d9eae | transactions domain → SDK `transactions/`: types + `isTransactionReversable`, enums, `transaction-details/` (8 files), `TransactionRepository`; `TransactionsCache` + `createTransactionChangeHandlers` extracted from hooks, `acknowledgeInHistory` absorbed into the cache, test-locked (4 tests). Curated `sdk.transactions`: `queryOptions(id)` (NotFoundError retry semantics live in the SDK), `listOptions(accountId?)` (infinite, PAGE_SIZE 25, per-id write-through), `pendingAckCountOptions()` (primitive count; web derives the boolean), `acknowledge(tx)`. Root now shares ONE lazy Encryption + ONE `getCurrentUserId` thunk across domains. `useReverseTransaction` stays web-wired (send-domain services) until Phase 7 |
| 5 | `sdk/phase5-contacts` · 719f55ec | contacts domain → SDK `contacts/`: types, `ContactRepository`, `ContactsCache`, change handlers. New config thunk `WalletSdkConfig.getLightningAddressDomain` (web passes `() => window.location.host`, matching the root loader's `domain`; a thunk because config records on the server too — only invoked client-side). Curated `sdk.contacts`: `listOptions/getCached/create/delete/findCandidatesOptions`; **`create` deliberately does NOT write the cache** — CONTACT_CREATED realtime is the single write path (behavior preserved) |
| 6.1 | `sdk/phase6-receive` · 6ca5d29d | receive leaf+cores → SDK `receive/`: cashu/spark quote types, swap types, melt-data, both quote cores, token models (verbatim). `lib/bolt11` → `@agicash/utils/bolt11` (+tests; `light-bolt11-decoder` dep moved to utils, `@scure/base@2.0.0` added to catalog). `derivePublicKey` → SDK `cryptography.ts` (the `useCryptography` hook stays web) |

## Remaining roadmap (handoff instructions — work top to bottom)

### The proven import-remap table (apply when moving a file web → SDK)

| Web import | SDK import |
|---|---|
| `~/lib/money` | `@agicash/utils/money` |
| `~/lib/cashu` | `@agicash/cashu` |
| `~/lib/bolt11` | `@agicash/utils/bolt11` |
| `~/lib/sha256` | `@agicash/utils/sha256` |
| `~/lib/performance` | `../performance` |
| `../shared/cashu` | `../cashu` |
| `../shared/spark` | `../spark` |
| `../shared/encryption` | `../encryption` |
| `../shared/error` | `../error` |
| `../shared/cryptography` | `../cryptography` |
| `../agicash-db/database` (types) | `@agicash/db-types` |
| `../agicash-db/json-models` (barrel) | `@agicash/db-types/json-models/<specific-file>` |
| `../accounts/*`, `../user/*`, `../transactions/*`, `../contacts/*` | same relative path (already in SDK) |
| `agicashDbClient` value import | delete — class takes `db: AgicashDb` via ctor; root passes `getAgicashDb()` |
| `use*` hook imports + the `useXRepository/useXService` tail of the file | delete from the SDK copy — hooks stay in the web file (shim or hooks file) |

`@tanstack/react-query` **type-only** imports (e.g. `QueryClient`) become
`@tanstack/query-core`.

### Phase 6.2 — receive repositories + services (grounded, do next)

Move into `packages/wallet-sdk/src/receive/`, verbatim + remaps, shims at old paths:

- `cashu-receive-quote-repository.ts`, `cashu-receive-swap-repository.ts`,
  `spark-receive-quote-repository.ts` — each ends with a `use*Repository()` hook (strip;
  keep in web shim only if other web files import it — check; the hooks files are the
  usual sole consumers). They import `AllUnionFieldsRequired` from `~/lib/type-utils` — a
  pure type-fest helper; move `lib/type-utils.ts` → `@agicash/utils/type-utils` first
  (add `type-fest` to utils deps via catalog; 6 consumers, all repos being moved in 6.2/7,
  so a web shim is still needed for the 3 send repos until Phase 7).
- `cashu-receive-quote-service.ts`, `cashu-receive-swap-service.ts`,
  `spark-receive-quote-service.ts`, `receive-cashu-token-quote-service.ts` — pure once
  remapped (`derivePublicKey` → `../cryptography`, `tokenToMoney`/`getTokenHash` already in
  SDK `cashu.ts`).
- `receive-cashu-token-service.ts` — pure class + a 3-line `useReceiveCashuTokenService`
  tail hook (strip; class takes `queryClient`). It imports `cashuMintValidator` from
  `../shared/cashu` — CHECK: that one is env-derived and web-only; if the class receives it
  as a ctor/method arg keep as-is, if it imports it module-level the validator needs to
  become a dep (ground this file before moving).
- **Stays web**: `lightning-address-service.ts` + the four `*.server.ts` files (the lnurl
  server path: per-request server db, `LNURL_SERVER_*` env, server ExchangeRateService) —
  they keep consuming SDK classes through the shims; `receive-store.ts` (zustand),
  `receive-provider/-input/-scanner/*.tsx` (UI), `index.ts` (UI barrel).

### Phase 6.3 — receive caches + api + hooks delegation

1. **Error-reporting seam** (mirrors `measureOperation`): SDK `error-reporting.ts` with
   `setErrorReporter(fn)` + `captureException(error)` no-op default;
   `WalletSdkConfig.captureException?`; web passes Sentry's. Needed by the claim service
   (single `Sentry.captureException` at claim-cashu-token-service.ts:76).
2. **Exchange rate into the SDK**: `lib/exchange-rate/` (service + providers + tests) is
   pure fetch — move to SDK `exchange-rate/` (web `~/lib/exchange-rate` shim stays for UI
   + lnurl server). Move `exchangeRateQueryOptions` + `getExchangeRate(queryClient, ticker)`
   from `hooks/use-exchange-rate.ts` into it (the `useExchangeRate` hook stays web and
   spreads the SDK options). Consumers: claim service, receive-token hooks, send UI,
   money-input hooks.
3. **Claim service → SDK**: `claim-cashu-token-service.ts` after (1)+(2): swap Sentry for
   `captureException`, `getExchangeRate` from SDK exchange-rate, `AccountsCache`/
   `accountsQueryOptions`/`UserCache` imports to SDK relatives. It is the MCP-shaped
   orchestrator — expose curated `sdk.receive.claimToken(token, claimTo)` (derive user via
   the root's `getCurrentUserId`/`getCached`; check its `user` param usage first).
4. **Extract cache classes + change handlers from the hooks files** into SDK
   `receive/cashu-receive-quote-cache.ts` etc.: `CashuReceiveQuoteCache` (hooks line ~55),
   `PendingCashuReceiveQuotesCache` (~85), `SparkReceiveQuoteCache` (~36),
   `PendingSparkReceiveQuotesCache` (~127), the pending-swaps cache in
   `cashu-receive-swap-hooks.ts`, and the three `use*ChangeHandlers` bodies →
   `create*ChangeHandlers`. Version-guards inside them are load-bearing — verbatim +
   test-lock.
5. **`receive-api.ts`**: curated `claimToken` + quote/swap creation methods where the hook
   bodies are thin (`useCreateCashuReceiveQuote` etc. — ground each; creation methods
   typically wrap `service.create(...)` + cache write). `internal = {repositories,
   services, caches, changeHandlers}` for the orchestration hooks (`useTrack*Quote`,
   `useOnSparkReceiveStateChange`, `useProcess*Tasks` — these stay web until Phase 8).
   Wire into the root with the shared `encryption` + `getCurrentUserId`; pass
   `cashuMintValidator`-style web deps via api deps if 6.2 grounding found any.
6. Hooks files keep ONLY React orchestration, delegating to `sdk.receive.*`; the
   receive-token route swaps its hand-built service graph for `sdk.receive` methods
   (`getClaimCashuTokenService` in `routes/_protected.receive.cashu_.token.tsx` should
   reduce to `getSdk().receive...`).

### Phase 7 — send domain (`sdk/phase7-send`)

Mirror of Phase 6, files in `features/send/`: leafs (`cashu-send-quote.ts` — already
re-exports DestinationDetails from db-types, `cashu-send-swap.ts`, `spark-send-quote.ts`),
repositories ×3, services ×3 (+ `find-matching-offer-or-gift-card-account.ts` + its test —
pure, moves; test moves with it), then caches/changeHandlers out of the three hooks files,
`send-api.ts`, hooks delegate. Specifics:
- `proof-state-subscription-manager.ts` carries a breadcrumb comment → move to
  `@agicash/cashu` next to the other two subscription managers.
- `lib/cashu/melt-quote-subscription.ts` is the one web-local file in `lib/cashu` (the
  index re-exports it) — likely moves to `@agicash/cashu` with the proof-state manager;
  ground its imports first (it may have React).
- `useReverseTransaction` (transactions hooks) can now absorb into a curated
  `sdk.transactions.reverse(tx)` or `sdk.send` method — it needs CashuSendSwapRepository
  + CashuSendSwapService + a cashu account lookup, all SDK-side after this phase.
- Stays web: `send-store.ts` (zustand), `resolve-destination.ts` (CHECK — it imports
  contacts + bolt11; if pure it moves), `use-get-invoice-from-lud16.ts` (hook),
  `validation.ts` (CHECK purity), UI tsx files, `utils.ts` (CHECK).

### Phase 8 — realtime hub into the SDK (`sdk/phase8-realtime`)

Ground first: `features/agicash-db/database.client.ts` (SupabaseRealtimeManager),
`features/wallet/use-track-wallet-changes.ts` (the `wallet:${userId}` channel: collects
every domain's changeHandlers, dispatches by event, reconnect invalidation breadth),
`features/shared/spark.ts` (`useTrackAndUpdateSparkAccountBalances`), and
`features/wallet/task-processing.ts` + `task-processing-lock-repository.ts` (background
task processor driven by `useProcess*Tasks` hooks). Target:
- SDK `realtime.ts` owning channel lifecycle (`sdk.realtime.start(…)/stop()` or
  subscribe-on-construction with explicit lifecycle), dispatching to the domain
  changeHandlers it composes internally — **the `internal.changeHandlers` escape hatches
  die here** (delete them from every `*Api.internal`), and caches leave `internal` where
  realtime was their last external consumer.
- Reconnect behavior (invalidate-all breadth) and the production payload-redacting logger
  are load-bearing — verbatim.
- Web keeps one thin lifecycle hook (`useEffect` start/stop bound to auth state).
- Spark balance tracking similarly becomes SDK-owned with a web lifecycle binding.
- Task processing: if it is framework-free orchestration over SDK services, move it and
  expose `sdk.tasks`-style start/stop; the `useProcess*Tasks` hooks become bindings.

### Phase 9 — thin auth shell (`sdk/phase9-auth`)

Decided at checkpoint: auth and user stay SEPARATE domains (different systems and
lifecycles — OpenSecret session/`AuthUser` vs `wallet.users` row/`User`; auth is alive
pre-user on login screens) but get WIRED: `sdk.auth` becomes the identity source the root
injects into the user domain, the same way user now feeds accounts (3.6/3.7). Move
`authQueryOptions` + `invalidateAuthQueries` + token/session primitives from
`features/user/auth.ts` into SDK `auth/` (file exists with session bits already); web keeps
`useAuthState/useAuthActions` + oauth/guest/login UI flows. Then absorb the last
outside-passed identity: `sdk.user.upsert` stops taking `id` (derive from auth internally;
`_protected.tsx` `ensureUserData` passes only profile fields). Dependency chain reads
auth → user → accounts.

### Phase 10 — import-cleanup (`sdk/phase10-import-cleanup`)

1. Rewrite every shim import to its package path across `apps/web-wallet` (the shims all
   carry the marker comment `Transitional re-export` — grep it for the inventory).
2. Delete the shim files; delete `agicashDbClient` re-export once Phase 6–8 removed the
   last repository consumers (verify with `git grep agicashDbClient`).
3. Replace `"./*": "./src/*.ts"` exports wildcards in wallet-sdk/utils/db-types/cashu with
   curated explicit maps (the wildcard leaks internals — old-stack lesson).
4. Final full gates + SSR build + a browser smoke test (dev server: `bun run dev`,
   guest-account flow: signup → terms → wallet home → settings → send/receive screens —
   see the 3.x smoke-test ledger entry for the known-good sequence; testnut.cashu.space
   being down/CORS-blocked in dev is environmental noise, not a regression).

### Final report

Update this doc (ledger + status), then report: final package surfaces (what `sdk.*`
exposes per domain), what remains in web (UI, hooks-as-bindings, stores, server lnurl,
auth flows), LOC moved, test counts, the tracked opensecret exception, and what the MCP
phase picks up next (`Query<T>`/`useQ`, opensecret storage-pluggable bump, headless auth).

## Landmines & nuances (do not rediscover these the hard way)

- **Import cycle trap**: web `feature-flags.ts` imports `database.client.ts` which
  configures through `features/shared/sdk.ts` — so `shared/sdk.ts` must never import
  feature-flags (that's why spark debug logging binds via `setSparkDebugLogging` from
  `shared/spark.ts`, order-independent).
- **Module-eval order**: `database.client.ts` and `shared/spark.ts` side-effect-import
  `../shared/sdk` so configuration happens before first use on every import path —
  including the **server-side** lightning-address chain (shared/sdk.ts evaluates on the
  server; `configureWalletSdk` must stay server-safe: record-only, no connections).
- **Lazy encryption nuance**: `useAccountRepository` no longer suspends on the key queries;
  keys resolve inside the first decrypt (staleTime ∞) and `_protected` middleware prewarms
  keep real timing identical.
- **`accountsQueryOptions.structuralSharing` and the AccountsCache version-guard are
  load-bearing financial behavior** — verbatim only, test-locked in
  `packages/wallet-sdk/src/accounts/accounts-cache.test.ts`.
- **bun tests can't import web feature files** (module-load env reads throw
  `VITE_SUPABASE_URL is not set`) — test code only after it lands in clean SDK files.
- **`@cashu/cashu-ts` is catalog-pinned** because `ExtendedCashuWallet`/`ExtendedMintInfo`
  subclass it — version skew would silently break overrides. Same logic pins
  `@tanstack/query-core` to react-query's exact version (+ the mutation-scope patch).
- The `"./*": "./src/*.ts"` exports wildcard needs explicit entries for directory subpaths
  (`"./money"`), and packages whose graph touches `Money` need `"lib": ["ES2022", "DOM"]`
  (money's guarded devtools-formatter `window` reference).
- `database.server.ts` (service-role server client) is untouched and stays web/server.
- **Consumer greps must match both import forms**: feature files import siblings as
  `../user/user-repository` AND `~/features/user/user-repository`. Use
  `git grep -lE "from '[^']*<path-suffix>'"` or you will miss consumers (this bit once).
- **Filename-substring grep trap**: `git grep account-details-db-data` also matches
  `cashu-account-details-db-data` re-export lines — check matches before concluding a
  file has consumers.
- `bun -e` one-liners are the reliable way to batch-edit import lines (sed -i with
  multiline -e args misbehaves in this zsh setup); use `\x27` for quotes inside.

## Status of verification

Every chunk so far: typecheck ×6 packages, biome, full test suite (152 — always recount),
SSR build incl. prerender, pre-commit hooks (biome, db-types drift, typecheck). Browser
smoke tests driven and green after Phase 2 (2026-06-11) and Phase 3 incl. the curated
surfaces (2026-06-12, fresh guest account — see ledger). Phases 4–6.1 are gate-verified
but not yet browser-driven; Phase 10 ends with a full smoke test. e2e
(`bun run test:e2e`) not run — ask the user before running it.

Known follow-up to file as an issue (not in this effort's scope): `USER_UPDATED` realtime
has no version-guard (`wallet.users` has no version column — latest payload wins).
