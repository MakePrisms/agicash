# Wallet SDK extraction — plan, progress, and working rules

Status document for the `@agicash/wallet-sdk` extraction (restarted greenfield from master
2026-06-08). Updated at the end of each phase. Current as of: **Phase 2 complete**
(branch `sdk/phase2-sdk-root`, 17 commits, all local — no PRs/pushes yet).

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
     (test count must not drop; currently 148), `bun run build` (client+server+prerender —
     needs `.env` loaded: `set -a; . ./.env; set +a`)
   - framework-free grep: `git grep -nE "from 'react'|@tanstack/react" packages/wallet-sdk/src`
     → only comments
   - encapsulation grep: `git grep -n "accounts.internal" -- apps/web-wallet` → only
     sanctioned transitional sites
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

## Done (phases, branches, commits)

Stack order (each on the previous): `master` → utils → db-types → db-augmented → cashu →
queryclient → accounts-leaf → ecies → encryption → supabase → cashu-init → spark-init →
db-singleton → accounts-core → sdk-root.

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

## Remaining roadmap

1. **Browser smoke test of the current stack** (pending, recommended before Phase 3):
   login → account list → send/receive screens → receive-token route. The Sdk root rewired
   app startup; gates are green but it has not been driven in a browser.
2. **Phase 3 — user domain**, landing natively as `sdk.user.*` with a curated surface
   (types, `toUser`, Read/Write repositories, service, `UserCache`/options, change
   handlers; replace `AccountService`'s structural `UserDefaultAccounts` with the SDK
   `User`). Ground first (consumers: ~18 files; `_protected.tsx` `ensureUserData` bootstrap;
   `upsert_user_with_accounts` RPC; realtime user updates; `defaultAccounts` stays web).
   Known follow-up: `USER_UPDATED` has no version-guard (preserve behavior, file an issue).
3. **CHECKPOINT** (user evaluates the approach on two fully-migrated domains before more).
4. Then, order TBD at checkpoint: transactions, contacts, receive, send (incl. quote/swap
   services + `ProofStateSubscriptionManager` — breadcrumb comment points it to
   `@agicash/cashu`), the `cashu-lightning-send` json-model (needs send-domain
   `DestinationDetailsSchema`), `account-details-db-data` (account-domain combined schema).
5. **Realtime hub into the SDK** (after most domains): the `wallet:${userId}` channel,
   dispatch, reconnect invalidation breadth, spark balance tracker → SDK; the
   `internal.changeHandlers`/cache escape hatches die here.
6. **Phase 4 — thin auth shell** (auth queryOptions + invalidate with injected
   opensecret/storage; oauth/guest/session flows stay web).
7. **Import-cleanup PR**: rewrite all shim imports to the packages, delete shims, replace
   `"./*"` exports wildcards with curated barrels.
8. **Phase 5 — MCP boundary** (the goal): tested `Query<T>` + `useQ`, flip web hooks,
   storage-pluggable opensecret bump (removes the framework-free exception), headless auth.

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

## Status of verification

Every chunk: typecheck ×6 packages, biome, full test suite (now 148: web 84, utils 32,
cashu 35, wallet-sdk 15 — but always recount), SSR build incl. prerender, pre-commit hooks
(biome, db-types drift, typecheck). Not yet done: the browser smoke test (item 1 above) and
e2e (`bun run test:e2e` — ask before running).
