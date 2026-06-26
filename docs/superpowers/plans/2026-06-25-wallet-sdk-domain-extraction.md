# Wallet SDK Domain Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the wallet domain layer out of `apps/web-wallet` into a **React-agnostic** `@agicash/wallet-sdk` package — clean repository/service classes, pure functions, and domain types live in the SDK; React construction/data hooks and `queryOptions` stay in the web app.

**Architecture:** This is the no-cache SDK migration (spec: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`). It supersedes the spec's "pure mechanical move" framing for step 3: mapping showed the domain files are entangled with React/TanStack and un-extracted `~/lib` utilities, so a paths-only move is impossible. Instead we **split each domain file** — the class/types move to the SDK (importing `@tanstack/query-core`, never `react`/`@tanstack/react-query`), the `useXxx` hooks move to the web app. Web consumers import values through `@agicash/wallet-sdk/temporary` and types through `@agicash/wallet-sdk`. The SDK keeps its existing `queryClient`-based caching for now (sourced from `query-core`); a **dedicated later step** removes `queryClient` entirely (reads → plain Promises). Work is sequenced as **stacked vertical-slice PRs**, each independently typecheck-able and smoke-testable, NOT one big-bang PR.

**Tech Stack:** TypeScript (bun workspace monorepo), React Router v7, TanStack Query v5 (`@tanstack/query-core` in the SDK, `@tanstack/react-query` in web), Zustand, Supabase, `@cashu/cashu-ts`, `@buildonspark/spark-sdk` (via `@agicash/breez-sdk-spark`), Zod (`zod/mini`).

## Global Constraints

- **SDK is React-agnostic.** No file under `packages/wallet-sdk/src` may import `react` or `@tanstack/react-query`. Use `@tanstack/query-core` for `QueryClient`/`FetchQueryOptions`; use the `@agicash/utils` `queryOptions` shim for the `queryOptions` helper.
- **SDK is headless-safe — no DOM / Web-Crypto.** No file under `packages/wallet-sdk/src` may rely on `window`/`document`/`localStorage`/`sessionStorage` or `crypto.subtle` (they fail or behave differently under the MCP node/bun runtime). Use isomorphic APIs: `@noble/hashes` for SHA-256 (not `crypto.subtle`); `TextEncoder`/`crypto.getRandomValues` only via package internals or `@types/bun` globals. Browser-storage/host-state access stays in web behind the `create(config)` storage adapter.
- **Import direction is one-way:** `packages/*` may never import from `apps/web-wallet` (no `~/...`). The compiler enforces it once `/temporary` is deleted (final cleanup, out of scope here).
- **Layout is preserved on move:** `apps/web-wallet/app/features/<x>/` → `packages/wallet-sdk/src/<x>/`. Relative cross-module imports (`../agicash-db/database`, `./account`) survive unchanged; only `~/features/...` alias imports get rewritten to relative.
- **Web imports of moved code:** values → `@agicash/wallet-sdk/temporary`; type-only → `@agicash/wallet-sdk`.
- **No Sentry in the SDK.** Strip `~/lib/performance` `measureOperation` (unwrap) and direct `@sentry/react-router` use from any file moving to the SDK.
- **Package manager is `bun`**; default branch is `master`. After editing TS, run the local verify (see Verification) — `bun` is not on this environment's PATH, so use the documented `tsc`/`biome` fallback.
- **Money-path slices** (cashu/spark wallet-init, send/receive flows) require live verification by the maintainer before stacking further on top.

## Decision Record (resolved with maintainer, 2026-06-25)

| # | Decision |
|---|---|
| D1 | SDK is React-agnostic now; achieved by retargeting `@tanstack/react-query` → `@tanstack/query-core` in moved code. Real de-cache (removing `queryClient`) is a **separate later step**. |
| D2 | Every `useXxx` construction/data hook stays in the web app. `queryOptions` follow their consumer: SDK-consumed (via `queryClient.fetchQuery`) move to the SDK; web-only ones stay in web. |
| D3 | `~/lib/type-utils`, `~/lib/sha256`, `~/lib/xchacha20poly1305` → `@agicash/utils` (finishing step 0). `@agicash/utils` also hosts the `query-core` `queryOptions` shim. |
| D4 | `~/lib/performance` is **not moved** — `measureOperation` is stripped from moving files. |
| D5 | `~/lib/spark`, `~/lib/exchange-rate` → `packages/wallet-sdk/src/lib/`. `~/lib/supabase` (realtime manager) **stays in web** (its only domain importer, `database.client.ts`, stays in web). |
| D6 | agicash-db: pure types + `json-models` → SDK. **Concrete client construction** (`database.client.ts`, `database.server.ts`, `supabase-session.ts`) **stays in web** (host wiring — `import.meta.env`/`window`/`process.env`/`getQueryClient()` singleton). It moves into the SDK later behind `create(config)`. |
| D7 | `~/features/gift-cards/gift-card-config.ts` → SDK as a domain object; repoint its ~6 web importers (incl. `vite.config.ts`). Enables `find-matching-offer-or-gift-card-account.ts` to move. |
| D8 | `claim-cashu-token-service.ts` is **deferred** — it reads/writes `AccountsCache`/`UserCache`/`accountsQueryOptions` mid-flow; it migrates in its own slice (receive-cashu-token) after the de-cache step. Tracked in **Deferred** below. |
| D9 | `feature-flags.ts`: a new `FeatureFlagService` (the RPC fetch) + the `FeatureFlag` type → SDK; `featureFlagsQueryOptions`/`useFeatureFlag`/`getFeatureFlag` stay in web. `shared/query-client.ts` (`getQueryClient` singleton) **stays in web**. |
| D10 | `getQueryClient()` singleton callers that move (`getAgicashMintAuthProvider`, `decodeCashuToken`, `getMintAuthProvider`) take `queryClient` as an explicit parameter (the caller already has one). |
| D11 | PR strategy: **stacked slice-PRs** — slice 1 branches off `sdk/break-feature-cycles`; each subsequent slice branches off the prior; rebase onto `master` as parents merge. *(Confirm at sign-off; alternative is one long-lived branch.)* |
| D12 | **Browser-storage/host-state access stays in web** (the SDK is headless-safe — no DOM): `shared/auth.ts` (`isLoggedIn`→`window.localStorage`) and the four `user/` storages (`localStorage`/`sessionStorage`/`document.cookie`). The one SDK consumer of `isLoggedIn` (`agicash-mint-auth-provider`) receives it via DI; the storages have no SDK consumer. They move into the SDK behind the `create(config)` storage adapter in the auth slice (spec step 5). *(Revised per PR review — was "move now with transient DOM".)* |
| D13 | This Decision Record **supersedes the raw mapping JSON** where they differ: `query-client.ts` and the `feature-flags.ts` file are **kept in web** (mapping tagged them MOVE); `gift-card-config.ts`, `find-matching-offer-or-gift-card-account.ts`, and `send/validation.ts` **move** (per D7 + reconciliation) though the mapping had them absent/UNSURE. See "Files kept in web" below. |

**Files the mapping marked MOVE but that are kept in web** (not relocated into the SDK by this plan): `database.client.ts`, `database.server.ts`, `supabase-session.ts` (D6), `query-client.ts` (D9 — `getQueryClient` singleton), the `feature-flags.ts` *file* (D9 — only `FeatureFlagService` is extracted), `shared/auth.ts` + the four `user/` storages (D12 — host-state), and `claim-cashu-token-service.ts` (D8, Deferred).

---

## The Split Recipe (apply per domain file)

This is the repeatable transformation every domain slice uses. Two file archetypes:

### Archetype A — domain-type file (e.g. `accounts/account.ts`, `transactions/transaction.ts`)
Pure types + zod schemas + pure helpers, no React. **Move whole** to `packages/wallet-sdk/src/<domain>/<name>.ts`. Rewrite imports per the rules below. Add its **types** to `src/index.ts`; add its **value exports** (schemas/helpers) to `src/temporary.ts`.

### Archetype B — `*-repository.ts` / `*-service.ts` (class + construction hook)
Each currently holds `export class XRepository {...}` plus `export function useXRepository() { ... return new XRepository(...) }`. Split:

1. **Class + types → SDK** (`packages/wallet-sdk/src/<domain>/<name>.ts`): keep the class, its types, and any pure helpers. Apply import rewrites.
2. **Hook → web** (`apps/web-wallet/app/features/<domain>/<name>-hooks.ts`, create if absent — or append to the domain's existing `*-hooks.ts`): move the `useXxx` function verbatim; change its import of the class to `@agicash/wallet-sdk/temporary`. It keeps gathering deps from other web hooks (`useQueryClient`, `useEncryption`, …) and passing them into the constructor.
3. **Barrel:** add the class to `src/temporary.ts`; add its public types to `src/index.ts`.
4. **Repoint web importers** of the class → `@agicash/wallet-sdk/temporary`; of types → `@agicash/wallet-sdk`.

### Import rewrite rules (applied to every file moved into the SDK)
| Current import | Becomes |
|---|---|
| `~/features/<x>/...` (to another moved file) | relative path (`../<x>/...`) |
| `./...` / `../...` (already relative, to another moved file) | **unchanged** |
| `~/lib/{sha256,type-utils,xchacha20poly1305}` | `@agicash/utils` |
| `~/lib/{spark,exchange-rate/...}` | relative into `../lib/{spark,exchange-rate}` (moved in slice 0d) |
| `~/lib/performance` (`measureOperation`) | **deleted** — unwrap the call (`measureOperation('x', () => fn())` → `fn()`) |
| `supabase/database.types` | **unchanged** (resolved by the SDK tsconfig path alias) |
| `@tanstack/react-query` — `QueryClient`, `FetchQueryOptions` (types) | `@tanstack/query-core` |
| `@tanstack/react-query` — `queryOptions` (helper) | `@agicash/utils` (shim) |
| `@tanstack/react-query` — `useQueryClient`/`useSuspenseQuery`/`useQuery`/`useMutation` | not allowed in SDK — these live only in the extracted web hook |
| `react` (`useMemo`, …) | not allowed in SDK — lives only in the extracted web hook |
| `@sentry/react-router` | removed (replace `Sentry.captureException(e)` with `console.error(...)`) |
| `getQueryClient()` (singleton, from `shared/query-client`) | add a `queryClient: QueryClient` parameter; caller passes it |
| `@agicash/*` / external npm | **unchanged** |

### Worked example — `accounts/account-repository.ts` (entangled `queryClient` case)

**SDK** `packages/wallet-sdk/src/accounts/account-repository.ts` — class only, retargeted:
```ts
import { ProofSchema, normalizeMintUrl } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import type { QueryClient } from '@tanstack/query-core';        // was @tanstack/react-query
import type { DistributedOmit } from 'type-fest';
import { z } from 'zod/mini';
import { type AgicashDb, type AgicashDbAccountWithProofs, isCashuAccount, isSparkAccount } from '../agicash-db/database';
import { CashuAccountDetailsDbDataSchema } from '../agicash-db/json-models/cashu-account-details-db-data';
import type { SparkNetwork } from '../agicash-db/json-models/spark-account-details-db-data';
import { SparkAccountDetailsDbDataSchema } from '../agicash-db/json-models/spark-account-details-db-data';
import { getInitializedCashuWallet, getMintAuthProvider } from '../shared/cashu';
import { type Encryption } from '../shared/encryption';
import { DomainError } from '../shared/error';
import { getInitializedSparkWallet, sparkMnemonicQueryOptions } from '../shared/spark';
import type { Account, AccountPurpose, CashuAccount } from './account';
import type { CashuProof } from './cashu-account';

export class AccountRepository { /* ...class body unchanged; getMintAuthProvider(purpose, this.queryClient)... */ }
// useAccountRepository REMOVED — moved to web
```
> Note: `agicashDbClient` (was `import { agicashDbClient } from '../agicash-db/database.client'`) is **not** imported by the class — the class takes `db: AgicashDb` via constructor. Only the web hook references the concrete `agicashDbClient`. `getMintAuthProvider(purpose)` gains a `queryClient` argument (D10).

**Web** `apps/web-wallet/app/features/accounts/account-repository-hooks.ts`:
```ts
import { useQueryClient } from '@tanstack/react-query';
import { AccountRepository } from '@agicash/wallet-sdk/temporary';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { useEncryption } from '~/features/shared/encryption-hooks';
import { useCashuCryptography } from '~/features/shared/cashu-hooks';
import { sparkMnemonicQueryOptions } from '@agicash/wallet-sdk/temporary';

export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  const { getSeed: getCashuWalletSeed } = useCashuCryptography();
  const getSparkWalletMnemonic = () => queryClient.fetchQuery(sparkMnemonicQueryOptions());
  return new AccountRepository(agicashDbClient, encryption, queryClient, getCashuWalletSeed, getSparkWalletMnemonic, './.spark-data');
}
```
> `useQueryClient()` returns a `query-core` `QueryClient` — type-compatible with the SDK class's `QueryClient` param.

### Worked example — `shared/feature-flags.ts` (D9 special case)

**SDK** `packages/wallet-sdk/src/shared/feature-flag-service.ts`:
```ts
import type { AgicashDb } from '../agicash-db/database';

export type FeatureFlag = 'GUEST_SIGNUP' | 'DEBUG_LOGGING_SPARK';
export type FeatureFlags = Record<FeatureFlag, boolean>;
export const FEATURE_FLAG_DEFAULTS: FeatureFlags = { GUEST_SIGNUP: false, DEBUG_LOGGING_SPARK: false };

export class FeatureFlagService {
  constructor(private readonly db: AgicashDb) {}
  async fetchAll(): Promise<FeatureFlags> {
    const { data, error } = await this.db.rpc('evaluate_feature_flags');
    if (error) throw new Error('Failed to fetch feature flags', { cause: error });
    return data as FeatureFlags;
  }
}
```
**Web** `apps/web-wallet/app/features/shared/feature-flags.ts` (keeps queryOptions + hooks; retry/console.error instead of Sentry):
```ts
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { FeatureFlagService, FEATURE_FLAG_DEFAULTS, type FeatureFlag, type FeatureFlags } from '@agicash/wallet-sdk/temporary';
import { agicashDbClient } from '~/features/agicash-db/database.client';
import { getQueryClient } from '~/features/shared/query-client';
// featureFlagsQueryOptions wraps new FeatureFlagService(agicashDbClient).fetchAll() with the existing 3x retry,
// returning FEATURE_FLAG_DEFAULTS on failure (console.error instead of Sentry.captureException).
// useFeatureFlag / getFeatureFlag unchanged.
```
> `FeatureFlag` type is also exported from `src/index.ts`.

---

## Package scaffolding (exact)

### `packages/wallet-sdk/package.json`
```jsonc
{
  "name": "@agicash/wallet-sdk",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",             // domain TYPES only
    "./temporary": "./src/temporary.ts" // migration value/repo/service re-exports (deleted at the end → boundary then compiler-enforced)
  },
  // No "./*" wildcard: everything must go through "." (types) or "./temporary" (values),
  // so deleting /temporary at the end makes the compiler enforce the boundary. (PR review: pmilic021)
  "scripts": { "typecheck": "tsc", "test": "bun test" },
  "dependencies": {
    "@agicash/bolt11": "workspace:*",
    "@agicash/breez-sdk-spark": "0.13.5-1",
    "@agicash/cashu": "workspace:*",
    "@agicash/ecies": "workspace:*",
    "@agicash/lnurl": "workspace:*",
    "@agicash/money": "workspace:*",
    "@agicash/opensecret": "catalog:",
    "@agicash/utils": "workspace:*",
    "@cashu/cashu-ts": "catalog:",
    "@noble/hashes": "catalog:",
    "@scure/base": "catalog:",
    "@scure/bip32": "1.7.0",
    "@scure/bip39": "1.6.0",
    "@stablelib/base64": "catalog:",
    "@supabase/supabase-js": "2.95.2",
    "@tanstack/query-core": "5.90.20",  // patched at root (patchedDependencies)
    "big.js": "catalog:",
    "jwt-decode": "4.0.0",
    "ky": "catalog:",
    "type-fest": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": { "@types/big.js": "catalog:", "@types/bun": "catalog:", "typescript": "catalog:" }
}
```
> Exact versions for `@scure/*`, `jwt-decode`, `@supabase/supabase-js` mirror `apps/web-wallet/package.json`. Promote any of these to the root `catalog` if/when a second consumer appears. Run `bun install` after editing. **No `react`, no `@tanstack/react-query`, no `@sentry/*`.**

### `packages/wallet-sdk/tsconfig.json`
```jsonc
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "lib": ["ES2022"], // NO DOM — SDK runs headless under MCP (node/bun). sha256 uses @noble/hashes (not crypto.subtle); TextEncoder/crypto.getRandomValues come from @types/bun (and the node/bun runtime). If a stricter config is wanted, add "WebWorker" (provides TextEncoder/crypto WITHOUT window/document/localStorage, so any host-state leak still fails to compile).
    "types": ["bun"],
    "baseUrl": ".",
    "paths": { "supabase/database.types": ["./supabase/database.types.ts"] },
    "noEmit": true
  }
}
```
> The `supabase/database.types` alias lets moved `agicash-db` files keep their import string unchanged after `supabase/` moves into the package (slice 0a).

### `src/index.ts` (types-only) and `src/temporary.ts` (migration barrel)
Both start empty in slice 0c and grow per slice. `index.ts` uses `export type { … } from './<domain>/<file>'`. `temporary.ts` uses `export { … } from './<domain>/<file>'` for classes/values. The complete export inventory per slice is listed in each slice below (derived from the export map).

---

## Phase 0 — Foundation

### Task 0a: Move the `supabase/` project + repoint references

**Files:**
- Move: `supabase/` → `packages/wallet-sdk/supabase/` (config.toml, migrations/, seed.sql, snippets/, database.types.ts, .gitignore, .env*)
- Modify: `package.json:42`, `.github/workflows/ci.yml:31,54,55`, `biome.jsonc:11`, `apps/web-wallet/tsconfig.json:20`

- [ ] **Step 1:** `git mv supabase packages/wallet-sdk/supabase` (config.toml paths are all relative — `sql_paths=["./seed.sql"]` — so they survive the move; verified, no exceptions).
- [ ] **Step 2:** Edit root `package.json:42` — `db:generate-types` — **add `--workdir packages/wallet-sdk`** (the CLI discovers `supabase/` by walking UP from cwd, which no longer exists at root) and repoint the output:
  `"supabase gen types typescript --local --schema wallet > supabase/database.types.ts"` → `"supabase gen types typescript --local --schema wallet --workdir packages/wallet-sdk > packages/wallet-sdk/supabase/database.types.ts"`. (Confirm CLI 2.75.5 honors `--workdir` for `gen types --local`; the maintainer validates against a live DB.)
- [ ] **Step 3:** Edit `.github/workflows/ci.yml`: line 31 `supabase/migrations/` → `packages/wallet-sdk/supabase/migrations/`; **line 53** `bun supabase db start` → `bun supabase db start --workdir packages/wallet-sdk`; **line 54** add `--workdir packages/wallet-sdk` and repoint the redirect → `bun supabase gen types typescript --local --schema wallet --workdir packages/wallet-sdk > packages/wallet-sdk/supabase/database.types.ts`; line 55 `git diff ... supabase/database.types.ts` → `... packages/wallet-sdk/supabase/database.types.ts`.
- [ ] **Step 4:** Edit `biome.jsonc:11` ignore glob `"supabase/database.types.ts"` → `"packages/wallet-sdk/supabase/database.types.ts"`.
- [ ] **Step 5:** Edit `apps/web-wallet/tsconfig.json:20` alias target `["../../supabase/database.types.ts"]` → `["../../packages/wallet-sdk/supabase/database.types.ts"]` (key unchanged → the 2 importers `agicash-db/database.ts` + `transaction-details/transaction-details-types.ts` need no edit during 0a; both leave web in 1b/2d, after which this web alias is dead and can be dropped in cleanup; also fixes the Vite build via `vite-tsconfig-paths`).
- [ ] **Step 5b:** Repoint stale doc references to `supabase/migrations` so the Verify grep stays clean: `README.md` (~lines 185, 192) and `.claude/skills/supabase-database/{SKILL.md,references/migrations.md}` → `packages/wallet-sdk/supabase/migrations`. (Docs only — alternatively whitelist them in the Verify grep.)
- [ ] **Step 6 (maintainer):** repoint Supabase's hosted git-integration directory to `packages/wallet-sdk/supabase`; verify deploy triggers (`next` → `alpha` → `live`). **Not done by the agent.**
- [ ] **Verify:** `git grep -nE "(^|[^/])supabase/(migrations|database\.types)" -- ':!packages/wallet-sdk/supabase'` returns only intended references; web typecheck still resolves `supabase/database.types`.

### Task 0b: Move 3 generic utils into `@agicash/utils` + add the `queryOptions` shim

**Files:**
- Move: `apps/web-wallet/app/lib/{type-utils.ts,sha256.ts,xchacha20poly1305.ts}` → `packages/utils/src/`
- Create: `packages/utils/src/query-options.ts`
- Modify: `packages/utils/src/index.ts`, `packages/utils/package.json`, `packages/utils/tsconfig.json`, and importers

- [ ] **Step 1:** `git mv` the three files into `packages/utils/src/`. `type-utils.ts` (only `type-fest`) and `xchacha20poly1305.ts` (only `@noble/ciphers/*` — `randomBytes` works headless via the node/bun global `crypto.getRandomValues`) move as-is.
- [ ] **Step 1b (PR review — headless-safe SHA-256):** rewrite `sha256.ts` to drop `crypto.subtle`/`TextEncoder` (Web-Crypto/DOM, would misbehave under MCP node/bun) in favor of `@noble/hashes` (isomorphic). Keep the async signature so call sites (`await computeSHA256(...)`) are unchanged:
  ```ts
  import { sha256 } from '@noble/hashes/sha2';
  import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
  export async function computeSHA256(message: string): Promise<string> {
    return bytesToHex(sha256(utf8ToBytes(message)));
  }
  ```
- [ ] **Step 2:** Create `packages/utils/src/query-options.ts`:
  ```ts
  // query-core has no queryOptions() helper; this is the identity helper for type inference.
  export const queryOptions = <T>(options: T): T => options;
  ```
- [ ] **Step 3:** `packages/utils/src/index.ts` — add `export * from './type-utils'; export * from './sha256'; export * from './xchacha20poly1305'; export * from './query-options';`
- [ ] **Step 4:** `packages/utils/package.json` — add `"type-fest": "catalog:"`, `"@noble/ciphers": "catalog:"`, `"@noble/hashes": "catalog:"` to dependencies.
- [ ] **Step 5:** `packages/utils/tsconfig.json` — **no DOM needed** (sha256 now uses `@noble/hashes`; xchacha's `randomBytes` comes from `@noble/ciphers`). Keep `lib: ["ES2022"]`.
- [ ] **Step 6:** Repoint the web importers (all currently moving domain files, but edit them in place now while still in web): `~/lib/type-utils` (6 files), `~/lib/sha256` (5 files), `~/lib/xchacha20poly1305` (1 file) → `@agicash/utils`. Delete the now-empty old `~/lib` files.
- [ ] **Verify:** `bun install`; web + utils typecheck.

### Task 0c: Scaffold the `wallet-sdk` package

- [ ] **Step 1:** Replace `packages/wallet-sdk/package.json` with the version above. `bun install`.
- [ ] **Step 2:** Replace `packages/wallet-sdk/tsconfig.json` with the version above.
- [ ] **Step 3:** Create empty `packages/wallet-sdk/src/temporary.ts` (`export {};`). Keep `src/index.ts` (will hold types).
- [ ] **Step 4:** Symlink workspace `@agicash/*` packages into `node_modules/@agicash/` for local tsc (per the local-tooling note), then `cd packages/wallet-sdk && ../../node_modules/.bin/tsc --noEmit` → passes (empty).

### Task 0d: Move `~/lib/spark` and `~/lib/exchange-rate` into the SDK

**Files:** Move `apps/web-wallet/app/lib/spark/` and `apps/web-wallet/app/lib/exchange-rate/` → `packages/wallet-sdk/src/lib/{spark,exchange-rate}/`.

- [ ] **Step 1:** `git mv` both dirs. Rewrite any internal imports per the rules (both are self-contained: `@agicash/breez-sdk-spark`+`@noble/hashes` for spark; `big.js`+`ky` for exchange-rate).
- [ ] **Step 2:** Add to `src/temporary.ts`: `export * from './lib/spark'; export * from './lib/exchange-rate';` (so staying web importers reach them).
- [ ] **Step 3:** Repoint staying web importers → `@agicash/wallet-sdk/temporary`: `~/lib/spark` in `root.tsx`, `routes/_protected.tsx`, `features/receive/receive-cashu-token-hooks.ts`, **and `entry.client.tsx` which uses the *relative* form `./lib/spark` (line 15) — rewrite it too** (a staying-in-web file importing a now-moved file via a relative path must become `@agicash/wallet-sdk/temporary`, NOT left "unchanged"); `~/lib/exchange-rate*` in `~/hooks/use-exchange-rate.ts`, `~/hooks/use-money-input.ts`, and the UI files. (Moving-domain importers get repointed to relative `../lib/...` when they themselves move.)
- [ ] **Step 4:** Move `exchange-rate`'s colocated `.test.ts` too; SDK `bun test` runs it.
- [ ] **Verify:** web + sdk typecheck; `bun test` (exchange-rate) green.

---

## Phase 1 — Foundational domain layer

> Each Phase 1/2 slice ends with: add SDK files, extract web hooks, update `src/index.ts` (types) + `src/temporary.ts` (values), repoint web importers, then **Verify** = symlink `@agicash/*`, `cd apps/web-wallet && ../../node_modules/.bin/react-router typegen && ../../node_modules/.bin/tsc --noEmit` AND `cd packages/wallet-sdk && ../../node_modules/.bin/tsc --noEmit` AND `./node_modules/.bin/biome check --write <changed>` + smoke the touched path. Steps below list only the slice-specific specifics.

### Task 1a: shared foundational leaves → SDK *(must precede agicash-db)*
- Move whole (Archetype A), no React: `error.ts` (`getErrorMessage, UniqueConstraintError, NotFoundError, DomainError, ConcurrencyError` → temporary; **23** web importers to repoint), `currencies.ts` (`getDefaultUnit`; 13 importers), `send-destination.ts` (`DestinationDetails` type → index; `DestinationDetailsSchema` → temporary — **must land in this slice, before agicash-db**: `json-models/cashu-lightning-send-db-data.ts` imports `DestinationDetailsSchema`).
- `cryptography.ts` split (Archetype B-ish): `derivePublicKey`, `getSeedPhraseDerivationPath` → SDK/temporary; `useCryptography` → web `shared/cryptography-hooks.ts`.
- **`auth.ts` stays in web (D12 — PR review):** `isLoggedIn` reads `window.localStorage` (host-state, fails headless). Keep it in web; its only SDK consumer (`agicash-mint-auth-provider`, slice 1d) receives `isLoggedIn` via DI. It moves to the SDK behind the `create(config)` storage adapter in the auth slice (spec step 5).

### Task 1b: agicash-db types + json-models → SDK (D6)
- Move to `src/agicash-db/`: `database.ts`, `json-models/*` (11 files). **Keep in web:** `database.client.ts`, `database.server.ts`, `supabase-session.ts` (host wiring, D6).
- `database.ts` rewrites: `supabase/database.types` (unchanged — tsconfig alias), `type-fest`/`@supabase/supabase-js` (unchanged), `./json-models/...` (unchanged). **`json-models/cashu-lightning-send-db-data.ts:3`:** `~/features/shared/send-destination` → `../../shared/send-destination` (moved in 1a — the only cross-feature `~/features` import in json-models).
- Web `database.client.ts`/`.server.ts` change `import type { Database } from './database'` → `from '@agicash/wallet-sdk'`; `agicashDbClient`/`agicashDbServer` construction stays in web.
- `index.ts` += types: `AgicashDbUser, AgicashDbAccount, AgicashDbCashuProof, AgicashDbAccountWithProofs, AgicashDbCashuReceiveQuote, AgicashDbCashuReceiveSwap, AgicashDbCashuSendQuote, AgicashDbCashuSendSwap, AgicashDbTransaction, AgicashDbContact, AgicashDbSparkReceiveQuote, AgicashDbSparkSendQuote, Database, AgicashDb` + all `*DbData`/`SparkNetwork` types.
- `temporary.ts` += `isCashuAccount, isSparkAccount`, all `*DbDataSchema`.
- Repoint web importers of `database`/json-models (11 importers of `database.ts`) → `@agicash/wallet-sdk(/temporary)`.

### Task 1c: `shared/encryption` split
- SDK `src/shared/encryption.ts`: `Encryption` type (→index), `encryptToPublicKey, encryptBatchToPublicKey, decryptWithPrivateKey, decryptBatchWithPrivateKey, getEncryption` (→temporary). Retarget `QueryClient`→`query-core` if referenced.
- Web `shared/encryption-hooks.ts`: `useEncryption, useEncryptionPrivateKey, useEncryptionPublicKeyHex` **plus** `encryptionPrivateKeyQueryOptions`/`encryptionPublicKeyQueryOptions` — **verified** these queryOptions are consumed only by the `useSuspenseQuery` hooks (NOT by `getEncryption`/`fetchQuery`), so they **stay in web** and the SDK `encryption.ts` does not import `queryOptions`.

### Task 1d: `shared/cashu` + `shared/agicash-mint-auth-provider` split ⚠️ MONEY-PATH
- SDK `src/shared/cashu.ts`: `CashuCryptography` type (→index); values → temporary: `BASE_CASHU_LOCKING_DERIVATION_PATH, tokenToMoney, getCashuCryptography, getTokenHash, cashuMintValidator, getMintAuthProvider, mintInfoQueryKey, allMintKeysetsQueryKey, mintKeysQueryKey, decodeCashuToken, getInitializedCashuWallet`; queryOptions (SDK-consumed by `getInitializedCashuWallet`/`getCashuCryptography`) → SDK/temporary: `seedQueryOptions, xpubQueryOptions, mintInfoQueryOptions, allMintKeysetsQueryOptions, mintKeysQueryOptions`. Retarget `QueryClient`→`query-core`, `queryOptions`→`@agicash/utils`. **D10:** `decodeCashuToken` and `getMintAuthProvider` take `queryClient: QueryClient` param (drop `getQueryClient()`); strip `measureOperation` from `getInitializedCashuWallet`.
- SDK `src/shared/agicash-mint-auth-provider.ts`: `getAgicashMintAuthProvider(queryClient, isLoggedIn)` (D10) — `isLoggedIn` is **injected** (it stays in web per D12), not imported; the web construction site passes it from `~/features/shared/auth`.
- Web `shared/cashu-hooks.ts`: `useCashuCryptography`. Repoint all `decodeCashuToken`/`getMintAuthProvider` call sites to pass `queryClient`.
- **Live-verify** (cashu wallet init, token decode) before stacking 1e.

### Task 1e: `shared/spark` → SDK ⚠️ MONEY-PATH
- SDK `src/shared/spark.ts`: `getInitializedSparkWallet, sparkDebugLog` (→temporary); queryOptions `sparkMnemonicQueryOptions, sparkIdentityPublicKeyQueryOptions, sparkWalletQueryOptions` (→SDK/temporary). Retarget `QueryClient`→`query-core`, `queryOptions`→`@agicash/utils`; strip `measureOperation`; `~/lib/spark`→`../lib/spark`, `~/lib/sha256`→`@agicash/utils`.
- **Sever the `getFeatureFlag` dependency (this is a BLOCKER if missed — verified):** `spark.ts:18` imports `getFeatureFlag` from `./feature-flags` (used in `sparkDebugLog`/`tryInitLogging` as `getFeatureFlag('DEBUG_LOGGING_SPARK')`). `getFeatureFlag` stays in web (D9) and reads the web `getQueryClient()` cache, so it can be neither a relative SDK import nor moved. Change `sparkDebugLog` (and `getInitializedSparkWallet`/`tryInitLogging` where they gate on it) to take a `debugLogging: boolean` parameter; the web caller (the construction hook / web call sites) sources it via `getFeatureFlag('DEBUG_LOGGING_SPARK')` and passes it in. The SDK `spark.ts` must NOT import `./feature-flags`. *(Small, deliberate logic change — add it as an explicit step.)*
- No React hooks here. **Live-verify** spark wallet init.

### Task 1f: `shared/feature-flags` (D9) + leave `query-client.ts` in web
- Per the worked example: create SDK `src/shared/feature-flag-service.ts` (`FeatureFlagService`, `FeatureFlag`→index, `FEATURE_FLAG_DEFAULTS`→temporary). Web `shared/feature-flags.ts` keeps `featureFlagsQueryOptions, useFeatureFlag, getFeatureFlag`, calls the service, `console.error` instead of `Sentry`.
- `shared/query-client.ts` (`getQueryClient`) **stays in web** — confirm no SDK file imports it after 1d/1e (`decodeCashuToken`/`getMintAuthProvider` now take `queryClient`).

---

## Phase 2 — Per-domain slices

> Each follows the Recipe. Listed: files → SDK (class/types/fns), hooks → web, index types, temporary values. Verify per the Phase 1/2 boilerplate.

### Task 2a: accounts
- SDK: `account.ts` (types: `AccountType, AccountState, AccountPurpose, Account, ExtendedAccount, CashuAccount, SparkAccount, ExtendedCashuAccount, ExtendedSparkAccount, RedactedAccount, RedactedCashuAccount`; values: `AccountTypeSchema, AccountPurposeSchema, accountRequiresGiftCardTermsAcceptance, canSendToLightning, canReceiveFromLightning, getAccountHomePath, getAccountBalance`), `cashu-account.ts` (`CashuProof` type; `CashuProofSchema, toProof`), `AccountRepository` (queryClient→core; worked example above), `AccountService` (queryClient→core).
- Web hooks: `useAccountRepository`, `useAccountService` → `accounts/*-hooks.ts`. `account.ts` has **37 web importers** (largest repoint) — bulk `~/features/accounts/account` → `@agicash/wallet-sdk`(types)/`/temporary`(values).

### Task 2b: user
- SDK: `user.ts` (`FullUser, GuestUser, User, UserProfile`; `shouldVerifyEmail, shouldAcceptTerms, shouldAcceptGiftCardMintTerms`), **(the four storages `guest-account-storage`/`oauth-login-session-storage`/`pending-terms-storage`/`session-hint-cookie` STAY in web — D12, PR review:** they use `localStorage`/`sessionStorage`/`document.cookie` (host-state, fail headless) and are imported only by web files — `user-hooks`, `user/auth.ts`, routes, signup/receive UI — so no moving SDK file needs them and no DI is required**)**, `UserRepository` (`UpdateUser` type; `WriteUserRepository, ReadUserRepository, ReadUserDefaultAccountRepository`; queryClient→core), `UserService`.
- Web hooks: `useReadUserRepository, useWriteUserRepository, useUserService`.

### Task 2c: contacts (D8 dissolved by C)
- SDK: `contact.ts` (`Contact`; `isContact`), `ContactRepository` (already takes `domain: string` via constructor — clean).
- Web: `useContactRepository` → web hook; it keeps reading `useLocationData()` and passing `domain` in.

### Task 2d: transactions
- SDK: `transaction-enums.ts`, `transaction.ts`, all 8 `transaction-details/*` files (types + `*Schema` + `*Parser` values + `TransactionDetailsParser`, `TransactionDetailsSchema`), `TransactionRepository` (`Cursor` type). `transaction-details/transaction-details-types.ts` keeps `supabase/database.types` import (alias).
- Web: `useTransactionRepository`.

### Task 2e: spark-receive ⚠️ MONEY-PATH *(before cashu-receive)*
- SDK: `spark-receive-quote-core.ts`, `spark-receive-quote.ts`, `spark-receive-quote-repository.ts`/`.server.ts`, `spark-receive-quote-service.ts`/`.server.ts`.
- Web hooks: `useSparkReceiveQuoteRepository, useSparkReceiveQuoteService`.
- **Sequenced before cashu-receive** because 2f imports these files. spark-receive's only cross-domain deps are accounts(2a)+transactions(2d)+agicash-db+shared — all earlier — so it has no dependency on cashu-receive.

### Task 2f: cashu-receive ⚠️ MONEY-PATH
- **Depends on spark-receive (2e)** — `lightning-address-service.ts:30-31` imports `SparkReceiveQuoteRepositoryServer`/`SparkReceiveQuoteServiceServer`; `receive-cashu-token-quote-service.ts:19-25` imports `SparkReceiveQuote`/`getLightningQuote`/`SparkReceiveQuoteService` — all moved in 2e.
- SDK: `cashu-receive-quote-core.ts`, `cashu-receive-quote.ts`, `cashu-receive-quote-repository.ts`/`.server.ts`, `cashu-receive-quote-service.ts`/`.server.ts`, `cashu-receive-swap.ts`, `cashu-receive-swap-repository.ts`, `cashu-receive-swap-service.ts`, `cashu-token-melt-data.ts`, `receive-cashu-token-models.ts`, `receive-cashu-token-quote-service.ts`, `receive-cashu-token-service.ts` (queryClient→core), `lightning-address-service.ts` (queryClient→core; `~/lib/performance` strip; `~/lib/exchange-rate`→`../lib/exchange-rate`; `~/lib/xchacha20poly1305`→`@agicash/utils`).
- Web hooks: `useCashuReceiveQuoteRepository, useCashuReceiveQuoteService, useCashuReceiveSwapRepository, useCashuReceiveSwapService, useReceiveCashuTokenQuoteService, useReceiveCashuTokenService`.
- `.server.ts` repos/services take the server `AgicashDb` via constructor — the LNURL server routes construct them with `agicashDbServer` (web). Live-verify `/lnurl-test`.

### Task 2g: gift-card-config → SDK (D7)
- SDK: move `features/gift-cards/gift-card-config.ts` → `src/gift-cards/gift-card-config.ts` (`GiftCardConfig, GiftCardInfo` types → index; `GiftCardConfigSchema, JsonGiftCardConfigSchema` → temporary). Only dep is `zod/mini`.
- Repoint ~6 web importers (gift-cards UI, `send-store.ts`, **`vite.config.ts`**) → `@agicash/wallet-sdk(/temporary)`.

### Task 2h: send ⚠️ MONEY-PATH
- SDK: `cashu-send-quote.ts` (`CashuSendQuote, DestinationDetails`), `cashu-send-quote-repository.ts`, `cashu-send-quote-service.ts` (`GetCashuLightningQuoteOptions, CashuLightningQuote, SendQuoteRequest`), `cashu-send-swap.ts`, `cashu-send-swap-repository.ts`, `cashu-send-swap-service.ts` (`CashuSwapQuote`), `spark-send-quote.ts`, `spark-send-quote-repository.ts`, `spark-send-quote-service.ts` (`SparkLightningQuote`; strip `measureOperation`; `~/lib/spark`→`../lib/spark`), `utils.ts` (`toDecryptedCashuProofs`), `proof-state-subscription-manager.ts`, `resolve-destination.ts` (`SendDestination`), `validation.ts` (uses `import.meta.env.MODE` — vite/client in tsconfig; consumed by `resolve-destination`), `find-matching-offer-or-gift-card-account.ts` (+`.test.ts`; imports `GiftCardInfo` from `../gift-cards/gift-card-config`).
- Web hooks: `useCashuSendQuoteRepository, useCashuSendQuoteService, useCashuSendSwapRepository, useCashuSendSwapService, useSparkSendQuoteRepository, useSparkSendQuoteService`.

### Task 2i: transfer
- SDK: `transfer-service.ts` (`TransferReceiveSide, TransferSendSide, TransferQuote`; `TransferService`). Web hook: `useTransferService`.

### Task 2j: wallet (data-access only)
- SDK: `task-processing-lock-repository.ts` (`TaskProcessingLockRepository`). Background runtime/processors/realtime hooks **stay in web** (later step). No hook to extract.

---

## Deferred (tracked list — revisit in the noted step)

| Item | Why deferred | Picked up by |
|---|---|---|
| `claim-cashu-token-service.ts` | Reads/writes `AccountsCache`/`UserCache`/`accountsQueryOptions` mid-orchestration (web cache) | receive-cashu-token domain slice, **after** the de-cache step. Add a `// Deferred from wallet-sdk extraction — see this plan` comment at its class. |
| Removing `queryClient` from SDK classes (true de-cache; reads → Promises) | Out of scope; this plan only makes the SDK React-agnostic via `query-core` | the dedicated de-cache step (spec step 1, reframed) |
| `database.client.ts`/`.server.ts`/`supabase-session.ts` + `~/lib/supabase` realtime manager → SDK | Host-connection wiring; belongs behind `create(config)` | the `create(config)`/contract step (spec step 4) |
| `shared/auth.ts` + the four `user/` storages → SDK (D12) | Host-state (`window.localStorage`/`sessionStorage`/`cookie`) fails headless; **kept in web** now, `isLoggedIn` injected into its one SDK consumer (`agicash-mint-auth-provider`) | the auth slice via the `create(config)` storage adapter (spec step 5) |
| `Sdk`/`ServerSdk` contract + namespaces | This plan moves code via `/temporary`; the contract is later | spec step 4 + per-domain wrapping |
| Background processing (task runner, leader election, change-feed, processors) | Most concurrency-sensitive; needs live failover verification | spec step 18 |
| Delete `/temporary` | Boundary enforcement is the final cleanup | spec step 19 |

## Verification strategy

- **Per slice:** SDK `tsc --noEmit` + web `react-router typegen && tsc --noEmit` + `biome check --write` on changed files + boot the app and exercise the touched path. (Local commands per the agicash-local-tooling note; unit tests need `bun` → run by maintainer.)
- **Money-path slices (1d, 1e, 2e, 2f, 2h):** maintainer runs live verification (Lightning send/receive, token claim, `/lnurl-test`) before stacking further.
- **Whole-program invariant:** after each slice, `git grep -n "from '~/" packages/wallet-sdk/src` returns nothing (no app imports in the package), and `git grep -nE "from '(react|@tanstack/react-query|@sentry)" packages/wallet-sdk/src` returns nothing (React-agnostic).

## Risks / watch-items

- **`getInitializedCashuWallet`/`getInitializedSparkWallet` caching** moves with the SDK but still uses an injected `queryClient` — behavior is unchanged now; the de-cache step changes it. Do not "improve" it here.
- **`.server.ts` repos** must take the server client via constructor; never import `database.server.ts` from the SDK (it stays in web).
- **`storages` in `user/`** may touch `window`/`document`/cookies — if so they're host wiring (keep in web like the DB client); decide per file in slice 2b.
- **`vite.config.ts` importing `@agicash/wallet-sdk`** (slice 2g) — verify the Vite config can resolve the workspace package at config-eval time.
- **Branch:** this plan lives on `sdk/domain-extraction-plan` (stacked on `sdk/break-feature-cycles`). Slice 1 branches off this; each later slice off the prior; rebase onto `master` as parents merge.
