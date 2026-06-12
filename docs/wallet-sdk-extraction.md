# Wallet SDK extraction — record, design decisions, and final report

Record of the `@agicash/wallet-sdk` extraction (restarted greenfield from master
2026-06-08; **complete** as of 2026-06-12, Phases 0–10 + final report). The work is a
stack of local branches, tip `sdk/phase10-import-cleanup` — no PRs/pushes, working tree
clean, all gates green. The next effort (the MCP/agent wallet) builds on this and starts
from the pickup list at the end of the *Final report*.

## How to read this document

The extraction is finished — nothing in here is pending work. The sections:

- **Goal** — why the extraction exists and why it was restarted from scratch.
- **Final report** — the end state: package layout, the full `sdk.*` surface, what
  stayed in the web app and why, the remaining `internal` escape hatches, and what the
  MCP phase picks up.
- **Architecture decisions** and the **Working method** patterns — settled with the user
  at checkpoints during the work. They are the contract the commits were written
  against: moves are byte-identical, and any logic change is named and justified in its
  commit message.
- **Ledger** — one row per chunk in stack order, with commit hashes. Deliberate oddities
  are flagged in place (e.g. mutations that intentionally do NOT write the cache because
  the realtime broadcast is the single write path).
- **Landmines** — behavior that looks wrong but is load-bearing; not bugs.

The stack is local only (`sdk/phase0-utils` → … → `sdk/phase10-import-cleanup`, each
branch on the previous, down to `master`); commits after the Phase 10 tip are docs-only.
Repo conventions: bun only (never npm/yarn/pnpm); default branch `master`; pre-commit
hooks run biome + db-types drift-check + typecheck.
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

## Final report — the codebase after the extraction

41 commits stacked on master (`sdk/phase0-utils` → … → `sdk/phase10-import-cleanup`;
commits after the Phase 10 tip are docs-only). Diffstat at the Phase 10 tip: 285 files
changed, +6,552/−4,206 lines vs master. 168 tests (utils 41, cashu 35,
wallet-sdk 40, web 52; was 95 on master — +73 test-locking load-bearing behavior).
Zero transitional shims remain.

**Package layout** (`@agicash/utils` 1.4k LOC ← `@agicash/cashu` 1.5k LOC /
`@agicash/db-types` 2.7k LOC ← `@agicash/wallet-sdk` 15.4k LOC; web app 27.3k LOC of
UI/hooks/routes/stores). All four packages have curated explicit exports maps — internals
are not importable.

**The `WalletSdk` surface** (`configureWalletSdk(config)` + `getSdk()`):

- `sdk.auth` — `stateOptions / getUserId / invalidate / isLoggedIn /
  getSessionExpiresInMs / clearTokens`. The identity source.
- `sdk.user` — `queryOptions / getCached / upsert (id derived from auth) / update /
  setDefaultAccount`.
- `sdk.accounts` — `listOptions / get / getCached / listCached / add /
  trackSparkBalances`.
- `sdk.transactions` — `queryOptions / listOptions (infinite) / pendingAckCountOptions /
  acknowledge`.
- `sdk.contacts` — `listOptions / getCached / create / delete / findCandidatesOptions`.
- `sdk.receive` — `claimToken / createCashuReceiveQuote / createSparkReceiveQuote /
  createCashuReceiveSwap / cashuQuoteOptions / sparkQuoteOptions /
  pendingCashuQuotesOptions / pendingSparkQuotesOptions / pendingCashuSwapsOptions`.
- `sdk.send` — `getCashuLightningQuote / createCashuSendQuote /
  getSparkLightningSendQuote / createSparkSendQuote / getCashuSendSwapQuote /
  createCashuSendSwap / reverseTransaction / cashuSwapOptions / trackCashuSwapOptions /
  unresolvedCashuQuotesOptions / unresolvedSparkQuotesOptions /
  unresolvedCashuSwapsOptions`.
- `sdk.realtime` — `subscribe / unsubscribe / getStatus / getError / onStatusChange /
  setOnlineStatus / setActiveStatus` (composes all domain change handlers + the
  invalidate-on-reconnect breadth internally).
- `sdk.queryClient` — the single query-core client.

Host seams in `WalletSdkConfig`: connections (openSecret/supabase/breez/sparkStorageDir),
`getLightningAddressDomain`, `cashuMintValidator`, `measureOperation`,
`captureException`, `onAuthUserIdDecoded`, `onAuthStateResolved`.

**`internal` escape hatches that remain** (transitional until the MCP phase): receive/send
repositories+services+caches feed the web's tracking + task-processing hooks; accounts
repository/service/cache feed web account helpers and the lnurl server path; user
repositories/service feed the lnurl server path; `realtime.internal.manager` is a window
debug handle. Every site carries a JSDoc; `git grep "\.internal\." -- apps/web-wallet`
is the audit.

**What remains in the web app**: routes/UI components; React hooks as bindings over sdk
options/mutations (query-policy split: refetch/select/retry-counts/suspense live web-side);
zustand stores (send/receive flows); websocket/event tracking + background task processing
(React-orchestrated via useMutation/useQueries); OAuth/guest login flows + session-expiry
handling; the lnurl server path (per-request server db + `LNURL_SERVER_*` env); env
reading + the one `configureWalletSdk` call (`features/shared/sdk.ts`); Sentry; the
env-derived mint validator; web-only `~/lib` (lnurl, locale, transitions, clipboard,
supabase react hooks, spark wasm…).

**The tracked exception**: `@agicash/opensecret` is still the React build (transitive
react peer-dep + localStorage reads in sdk auth/encryption paths). Documented in
wallet-sdk `package.json` `dependencies:comments`; the storage-pluggable bump lands
before the MCP phase.

**What the MCP phase picks up**: `Query<T>`/`useQ` (subscribe/getSnapshot over the
QueryObserver the SDK owns); the opensecret storage-pluggable bump + headless auth; moving
the tracking/task-processing orchestration out of React hooks into the SDK (kills the
remaining `internal` surfaces); a headless task processor. Known follow-up issue to file:
`USER_UPDATED` realtime has no version guard (`wallet.users` has no version column).

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
  in wallet-sdk `package.json` `dependencies:comments`. (`src/auth.ts`'s
  localStorage token reads are part of the same exception.)
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
  are transitional plumbing absorbed by the root; web's `agicashDbClient` survived
  Phase 10 only as the client-side handle for web-owned features (feature flags, the
  task-processing lock).
- **Package layout**: `@agicash/utils` (money/json/zod/collections/sha256/ecies) ←
  `@agicash/cashu` (framework-free protocol lib incl. `ExtendedCashuWallet` + subscription
  managers) and `@agicash/db-types` (generated + augmented `Database`, `AgicashDb*` rows,
  json-model schemas; depends on cashu+utils) ← `@agicash/wallet-sdk`. Apps are bare-named,
  libraries `@agicash/`-scoped; shared deps go through the root `workspaces.catalog`
  (exact versions). React/UI cashu pieces (animated-QR, `useOnMeltQuoteStateChange`) stay
  web — a future `@agicash/cashu-ui` if ever needed.

## Working method (how every chunk was done)

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
     (test count never dropped; final 168: utils 41, cashu 35, wallet-sdk 40, web 52),
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

Patterns settled during phases 3–6 (every later domain follows them):

- **File-per-domain api factory**: each domain owns `{domain}/{domain}-api.ts` exporting
  the `*Api` type + `create*Api(deps)`; `sdk.ts` stays config + composition root (one
  factory call per domain). Cross-domain instances flow through factory returns/deps —
  the root never reaches through `internal`.
- **The SDK derives the current user from its own state** — curated methods never take
  `userId`/`User` from callers. The root builds one `getCurrentUserId` thunk (reads
  `this.user.getCached()`, throws `'No user is loaded. Bootstrap the session first.'`)
  and one lazy Encryption, shared by all domain factories. Only `sdk.user.upsert` took an
  id (the auth-layer identity injection point) until Phase 9 wired `sdk.auth` as the
  identity source — since then no curated method takes identity from outside. Ids are resolved at
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

## Ledger (phases, branches, commits)

Stack order (each on the previous): `master` → utils → db-types → db-augmented → cashu →
queryclient → accounts-leaf → ecies → encryption → supabase → cashu-init → spark-init →
db-singleton → accounts-core → sdk-root → user-types → user-core → user-surface →
transactions → contacts → receive → send → realtime → auth → import-cleanup.

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
| 6.2 | `sdk/phase6-receive` · 71138490 | receive repositories ×3 + services ×5 → SDK `receive/` (verbatim + remaps, tail hooks stripped; shims keep the `use*` hooks wiring `agicashDbClient`/`useEncryption`/`useAccountRepository`). `lib/type-utils` → `@agicash/utils/type-utils` (`type-fest` dep moved web→utils; web shim stays for the 3 send repos until Phase 7). `ReceiveCashuTokenService` ctor gains `cashuMintValidator: MintValidator` dep (it was an env-derived module-level import; web shim + the receive-token route inject web's validator); new `MintValidator` type exported from `@agicash/cashu` mint-validation |
| 6.3 | `sdk/phase6-receive` · 88a3ec68 | curated `sdk.receive` surface. New seams: SDK `error-reporting.ts` (`setErrorReporter`/`captureException` no-op default; `WalletSdkConfig.captureException?` — web passes Sentry's) mirroring `performance.ts`; `lib/exchange-rate/` → SDK `exchange-rate/` (+5 tests; `ky` to catalog; `exchangeRate(s)QueryOptions` + `getExchangeRate` extracted from `hooks/use-exchange-rate.ts` — web keeps the 3 hooks + 15s refetchInterval policy; explicit `./exchange-rate` exports entry). `ClaimCashuTokenService` → SDK (Sentry swapped for `captureException`). Cache classes + change handlers extracted from the 3 hooks files → `receive/{cashu,spark}-receive-quote-cache.ts`, `receive/cashu-receive-swap-cache.ts` (version guards test-locked, +10 tests). `receive-api.ts`: `claimToken(token, claimTo)` (derives the FULL user via new root `getCurrentUser` thunk), `createCashuReceiveQuote`/`createSparkReceiveQuote` (absorb active-quote cache.add), `createCashuReceiveSwap` (NO cache write — realtime is the write path), `cashuQuoteOptions`/`sparkQuoteOptions`/`pendingCashu(Spark)QuotesOptions`/`pendingCashuSwapsOptions` (staleTime ∞ in SDK; refetch/select/throwOnError stay web), `internal` = repos+services+caches+changeHandlers for tracking/task-processing hooks (die in Phase 8). `WalletSdkConfig.cashuMintValidator` (required) — web passes its env-derived validator. Root factories now return `{api, service}` (user) / `{api, repository, service, cache}` (accounts) so receive wires without `internal`-reaching. Hooks files: only React orchestration left (websocket/polling tracking, task processing, spark event listeners); `useCreateCashuReceiveQuote` et al one-line delegate; receive-token route's hand-built 9-class graph replaced by `getSdk().receive.claimToken`. Zero-consumer cleanup: hooks-file `getExchangeRate` re-export dropped |
| 7.1 | `sdk/phase7-send` · 96b7950f | send leafs ×3 + `utils.ts` + repositories ×3 + services ×3 + `proof-state-subscription-manager` → SDK `send/` (verbatim + remaps; tail hooks stay in shims). `shared/currencies` → SDK `currencies.ts`; `lib/spark/errors` guards → SDK `spark-utils.ts` (errors.ts deleted — zero direct importers). Grounding deviations (web-only consumers): `find-matching-offer-or-gift-card-account` (+test), `resolve-destination`, `validation` stay web; `melt-quote-subscription` is the React `useOnMeltQuoteStateChange` hook and stays web. The proof-state manager stays in the SDK rather than `@agicash/cashu` (coupled to db-flavored `CashuProof` + send-swap types) |
| 7.2 | `sdk/phase7-send` · f489a2b2 | curated `sdk.send` surface: `getCashuLightningQuote`/`createCashuSendQuote`/`getSparkLightningSendQuote`/`createSparkSendQuote`/`getCashuSendSwapQuote`/`createCashuSendSwap` (absorbs active-swap cache.add)/`reverseTransaction(tx)` (absorbs `useReverseTransaction` body; resolves the swap's cashu account via the accounts cache), `cashuSwapOptions` (NotFoundError retry semantics)/`trackCashuSwapOptions`/`unresolved*Options` ×3. Cache classes + change handlers extracted into `send/{cashu,spark}-send-quote-cache.ts`, `send/cashu-send-swap-cache.ts` (version guards test-locked, +6 tests → 168). `createReceiveApi` now returns `{api, cashuReceiveSwapService}` so the root wires the send-swap reversal dependency without internal-reaching. Hooks files keep only React orchestration (melt-quote websocket tracking, spark event listeners, proof-state subscriptions, task processing). Zero-consumer cleanup: `useCashuSendSwapService` hook deleted from its shim |
| 8 | `sdk/phase8-realtime` · cf9d26d6 | realtime hub → SDK. `SupabaseRealtimeManager`/channel/builder → SDK `realtime/` (verbatim; `@supabase/realtime-js` type imports remapped to `@supabase/supabase-js` which star-re-exports them — no new dep). New `sdk.realtime` (`realtime-api.ts`): `subscribe/unsubscribe` (the `wallet:{userId}` private broadcast channel, topic resolved at call time), `getStatus/getError/onStatusChange` (useSyncExternalStore-ready), `setOnlineStatus/setActiveStatus` (host activity bindings); composes every domain's change handlers + the 13-cache invalidate-on-reconnect internally. **`internal.changeHandlers` deleted from every `*Api`** — domain factories now return `{api, …, cache(s), changeHandlers}` to the root. Web: `useTrackWalletChanges` is a ~40-line lifecycle binding (subscribe/unsubscribe + status + throws `SupabaseRealtimeError` to the boundary); `useSupabaseRealtimeActivityTracking` takes the structural `{setOnlineStatus,setActiveStatus}` target; the 10 `use*ChangeHandlers` hooks + `useUserCache` + `useContactsCache` deleted (zero consumers); `database.client.ts` keeps only the db re-export + the window debug handle (`sdk.realtime.internal.manager` — the one sanctioned realtime internal). Spark balance tracking → `sdk.accounts.trackSparkBalances(accounts)` (web binds it to the reactive spark-accounts list). `TaskProcessingLockRepository` → SDK root (grounding deviation: the task PROCESSOR stays web — it is useMutation/useQueries-based React orchestration; a headless rewrite belongs to the MCP phase) |
| 9 | `sdk/phase9-auth` · b8c05d7f | thin auth shell. SDK `auth.ts` becomes the auth domain: `AuthUser`/`AuthState`/`authStateQueryKey`, the auth-state queryFn (token read → `fetchUser` → state; verbatim) and the session/JWT primitives move in; web side effects became host hooks — `WalletSdkConfig.onAuthUserIdDecoded` (web: early `Sentry.setUser`) + `onAuthStateResolved` (web: Sentry user incl. isGuest + SSR session-hint cookie set/clear; `reason: 'no-tokens' \| 'fetch-failed'` preserves the original Sentry-null-only-on-failure behavior). Curated `sdk.auth`: `stateOptions/getUserId/invalidate/isLoggedIn/getSessionExpiresInMs/clearTokens` (no internal). **`sdk.user.upsert` no longer takes `id`** — the root wires `getAuthUserId: () => this.auth.getUserId()` into the user domain (reads the resolved auth state; throws pre-login); `ensureUserData` passes only profile fields. Identity chain: auth → user → accounts. Web `auth.ts` keeps `useAuthState/useAuthActions/useSignOut/useHandleSessionExpiry` + OAuth/guest flows + `invalidateAuthQueries` (sdk.auth.invalidate + the WEB-owned feature-flags key). Landmine fixed in-flight: the transitional `authQueryOptions` wrapper must stay server-safe (public pages build it during SSR/prerender) — `getSdk()` is only touched inside the queryFn |
| 10 | `sdk/phase10-import-cleanup` · d549b7cc | import-cleanup. All ~90 transitional shims deleted; 191 imports rewritten to package paths by a resolver script (handles both `~/` and relative forms) + 56 symbol-split imports for the mixed files (web hooks stay at the feature path, moved names go to the package) + 16 `~/lib/cashu` splits (`useOnMeltQuoteStateChange` → its own file; protocol names → `@agicash/cashu`). The last constructed-in-web SDK collaborators became `sdk.*.internal` bindings (transaction-additional-details, transfer-service, receive-cashu-token-hooks). `agicashDbClient` survives ONLY as the web's client-only handle for web-owned features (feature flags, task lock) — no repository consumers remain. Exports wildcards (`"./*"`) replaced with curated explicit maps in all four packages (utils 9 entries, cashu 7, db-types 11, wallet-sdk 36). `~/lib` keeps only genuinely-web modules. Browser smoke test green (fresh guest: signup → terms → wallet home → receive → send → settings; realtime `wallet:{userId}` subscribed via sdk.realtime incl. strict-mode ref-count, Breez sync + spark-balance listener firing, task-lock yielding; only the known testnut.cashu.space CORS noise) |

## Reference: the web → SDK import-remap table

Applied to every file moved web → SDK; kept because the MCP phase may move more code
down (the tracking/task-processing orchestration).

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

Every chunk: typecheck ×6 packages, biome, full test suite (168: utils 41, cashu 35,
wallet-sdk 40, web 52), SSR build incl. prerender, pre-commit hooks (biome, db-types
drift, typecheck). Browser smoke tests driven and green after Phase 2, Phase 3, and
Phase 10 (fresh guest account: signup → terms → wallet home → receive/send/settings;
realtime + Breez + task-lock verified in the console). e2e (`bun run test:e2e`) not
run — ask the user before running it.

Known follow-up to file as an issue (not in this effort's scope): `USER_UPDATED` realtime
has no version-guard (`wallet.users` has no version column — latest payload wins).
