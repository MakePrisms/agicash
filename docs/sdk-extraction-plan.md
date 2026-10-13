# Agicash SDK Extraction Plan

> Bun workspace refactor of MakePrisms/agicash: extract all portable business logic, types, and utilities into `@agicash/sdk` (or `@agicash/core` — naming TBD) so the web app imports from the package and future consumers (CLI, bots, integrations) can reuse the same code. The web app stays at root, the new package lives at `packages/sdk/`. Each phase ships as one PR, and the app must work identically after every merge.

---

## Critical Issues (2026-03-27 audit by keeper:architect + keeper:review)

Five issues found by reviewing the plan against the actual codebase:

### Issue 1: Cache Interface Gap — `setQueryData()` / `invalidateQueries()` missing

`ClaimCashuTokenService` uses three QueryClient methods:
- `fetchQuery()` (line 91) — in Cache ✓
- `setQueryData()` (line 140) — **NOT in Cache** — updates user query cache after claim
- `invalidateQueries()` (line 284) — **NOT in Cache** — invalidates spark balance after claim

**Fix:** Extend the `Cache` interface:
```typescript
export type Cache = {
  fetchQuery<T>(options: { queryKey: readonly unknown[]; queryFn: () => Promise<T>; staleTime?: number }): Promise<T>;
  cancelQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
  setQueryData?<T>(queryKey: readonly unknown[], data: T): void;          // NEW
  invalidateQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;  // NEW
};
```

Make them optional — SDK code that uses them gets the web adapter's full QueryClient. CLI consumers that don't need cache invalidation can skip them.

### Issue 2: `getFeatureFlag` in portable code

Two files marked as portable import `getFeatureFlag` from `app/lib/feature-flags.ts` (which uses `import.meta.env`):
- `app/features/shared/spark.ts` (line 26) — `DEBUG_LOGGING_SPARK` flag
- `app/features/receive/receive-cashu-token-service.ts` (lines 17, 85, 123) — `GIFT_CARDS` flag

**Fix:** Add feature flags to the `AgicashConfig` type in Phase 1:
```typescript
export type AgicashConfig = {
  // ...existing fields
  featureFlags?: Record<string, boolean>;
};
```
SDK code calls `getConfig().featureFlags?.GIFT_CARDS` instead of importing from feature-flags.ts. Web app populates from `import.meta.env` in `configure()`.

### Issue 3: No missing files (confirmed)

All source files listed in Phase 2–5 move tables exist at their stated paths. No action needed.

### Issue 4: Module-level `import.meta.env` in cashu.ts

`app/features/shared/cashu.ts` line 173 has a module-level constant:
```typescript
const mintBlocklist = MintBlocklistSchema.parse(
  JSON.parse(import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '[]'),
);
```
This runs on import — will crash in non-Vite environments.

**Fix:** The plan already specifies `getConfig().cashuMintBlocklist` as the replacement (Phase 4c). Ensure this constant becomes a lazy function call: `const getMintBlocklist = () => getConfig().cashuMintBlocklist;`

Note: `app/lib/money/money.ts` has `window.devtoolsFormatters` but it's already guarded by `typeof window === 'undefined'` — safe as-is.

### Issue 5: 8 open PRs overlap with SDK move targets (CRITICAL)

| PR | Key overlapping files |
|----|----------------------|
| #959 (offers) | account.ts, account-service.ts, cashu.ts, mint-validation.ts, receive-cashu-token-service.ts |
| #958 (clear auth wallet) | cashu.ts, mint-auth-provider.ts, cashu/token.ts, cashu/utils.ts |
| #961 (spark balance) | spark-send-quote-service.ts, spark.ts, spark/errors.ts |
| #631 (unlocking data) | cashu-send-swap-repository.ts, cashu-send-swap-service.ts |
| #630 (deterministic P2PK) | cashu/crypto.ts, cashu/types.ts, cashu/utils.ts |
| #627 (spending conditions) | cashu-receive-quote-service.ts, cashu-send-swap-service.ts, cashu/error-codes.ts, cashu/utils.ts |
| #799 (supabase JWTs) | database.client.ts, database.server.ts |
| #596 (auth slimmed) | cashu/utils.ts |

**`app/lib/cashu/utils.ts` is touched by 5 concurrent PRs.** `cashu.ts` by 2 active PRs.

**Fix:** SDK extraction Phases 0–1 (workspace skeleton + core abstractions) are safe — they don't move files. **Phases 2+ must wait until the offer stack (#959, #955) and #961 merge.** Clear auth (#958) and older PRs (#627, #630, #631) may also need to land first. Recommendation: ship Phases 0–1 now, then reassess merge order before Phase 2.

---

## Principles

1. **Move files, don't rewrite them.** The vast majority of changes are file moves + import path updates. No redesigns.
2. **Each PR is independently verifiable.** After every merge: `bun run fix:all` passes, `bun run dev` works. No "trust me, it'll work when phase 5 lands."
3. **Split mixed files.** Files containing both pure logic and React hooks get split: pure code goes to the package, hooks stay in web.
4. **No new abstractions except at real boundaries.** Only three small interfaces: `KeyProvider`, `Cache`, and runtime `Config`. Everything else keeps its existing shape.
5. **Web app stays at root.** Moving to `apps/web/` is a separate, optional future step. Root IS the web app. `packages/sdk/` is the only new directory.
6. **Shims then cleanup.** During extraction phases, moved files leave re-export shims in the web app so existing imports don't break. Final phase removes all shims and updates imports directly to `@agicash/sdk`.
7. **No monorepo tooling.** Just bun workspaces. Turborepo can be layered on later if needed.
8. **CLI comes after.** This plan covers SDK extraction only. CLI is a separate follow-up.

---

## Architecture

### End-State Directory Structure

```
agicash/
├── packages/
│   └── sdk/                               # @agicash/sdk — environment-agnostic
│       ├── package.json
│       ├── tsconfig.json
│       ├── biome.json
│       └── src/
│           ├── index.ts                   # Public barrel
│           ├── config.ts                  # Runtime config (replaces import.meta.env)
│           ├── performance.ts             # Injectable measureOperation
│           │
│           ├── interfaces/
│           │   ├── key-provider.ts        # Replaces @opensecret/react direct imports
│           │   └── cache.ts              # Replaces QueryClient dependency
│           │
│           ├── lib/                       # From app/lib/ (portable modules only)
│           │   ├── money/
│           │   ├── cashu/                 # Clean barrel — no React hook exports
│           │   ├── bolt11/
│           │   ├── spark/
│           │   ├── ecies/
│           │   ├── lnurl/
│           │   ├── exchange-rate/
│           │   ├── supabase/             # RealtimeManager + Channel + Builder (no hooks)
│           │   ├── locale/
│           │   ├── sha256.ts
│           │   ├── json.ts
│           │   ├── zod.ts
│           │   ├── utils.ts
│           │   ├── timeout.ts
│           │   ├── delay.ts
│           │   ├── type-utils.ts
│           │   └── xchacha20poly1305.ts
│           │
│           ├── db/                        # Database types
│           │   ├── database.ts            # AgicashDb type, isCashuAccount, isSparkAccount
│           │   ├── database-generated.types.ts  # Copied from supabase/database.types.ts
│           │   └── json-models/           # Zod schemas for JSON columns
│           │
│           └── features/
│               ├── shared/
│               │   ├── error.ts           # DomainError, ConcurrencyError, NotFoundError
│               │   ├── currencies.ts
│               │   ├── encryption.ts      # Pure: Encryption type, getEncryption(), encrypt/decrypt
│               │   ├── cryptography.ts    # Pure: derivePublicKey()
│               │   ├── cashu.ts           # getCashuCryptography(keyProvider, cache), getInitializedCashuWallet()
│               │   └── spark.ts           # getInitializedSparkWallet(), getLeafDenominations()
│               ├── accounts/
│               │   ├── account.ts         # Types
│               │   ├── cashu-account.ts   # Types + Zod schemas
│               │   ├── account-cryptography.ts
│               │   ├── account-service.ts
│               │   └── account-repository.ts  # Class only, no use* hook
│               ├── send/
│               │   ├── cashu-send-quote.ts
│               │   ├── cashu-send-quote-service.ts
│               │   ├── cashu-send-quote-repository.ts
│               │   ├── cashu-send-swap.ts
│               │   ├── cashu-send-swap-service.ts
│               │   ├── cashu-send-swap-repository.ts
│               │   ├── spark-send-quote.ts
│               │   ├── spark-send-quote-service.ts
│               │   ├── spark-send-quote-repository.ts
│               │   ├── utils.ts
│               │   └── proof-state-subscription-manager.ts
│               ├── receive/
│               │   ├── cashu-receive-quote.ts
│               │   ├── cashu-receive-quote-core.ts
│               │   ├── cashu-receive-quote-service.ts
│               │   ├── cashu-receive-quote-repository.ts
│               │   ├── cashu-receive-swap-repository.ts
│               │   ├── cashu-receive-swap-service.ts
│               │   ├── cashu-token-melt-data.ts
│               │   ├── receive-cashu-token-models.ts
│               │   ├── receive-cashu-token-quote-service.ts
│               │   ├── receive-cashu-token-service.ts
│               │   ├── claim-cashu-token-service.ts
│               │   ├── spark-receive-quote.ts
│               │   ├── spark-receive-quote-core.ts
│               │   ├── spark-receive-quote-service.ts
│               │   └── spark-receive-quote-repository.ts
│               ├── transactions/
│               │   ├── transaction.ts
│               │   ├── transaction-enums.ts
│               │   ├── transaction-repository.ts
│               │   └── transaction-details/    # All 8 Zod schema files
│               ├── contacts/
│               │   ├── contact.ts
│               │   └── contact-repository.ts
│               ├── user/
│               │   ├── user.ts
│               │   ├── user-service.ts
│               │   └── user-repository.ts
│               ├── theme/
│               │   ├── theme.types.ts
│               │   ├── theme.constants.ts
│               │   └── colors.ts
│               └── wallet/
│                   └── task-processing-lock-repository.ts
│
├── app/                                    # Web app (stays at root, thinner)
│   ├── routes/                             # Unchanged
│   ├── features/
│   │   ├── shared/
│   │   │   ├── cashu.ts                   # queryOptions + useCashuCryptography (thin wrapper)
│   │   │   ├── spark.ts                   # queryOptions + useTrackAndUpdateSparkAccountBalances
│   │   │   ├── encryption.ts             # queryOptions + useEncryption (thin wrapper)
│   │   │   ├── cryptography.ts           # useCryptography (thin wrapper)
│   │   │   └── money-with-converted-amount.tsx
│   │   ├── accounts/
│   │   │   ├── account-hooks.ts           # useAccounts, useAccountRepository, etc.
│   │   │   └── ...components
│   │   ├── send/
│   │   │   ├── cashu-send-quote-hooks.ts
│   │   │   ├── cashu-send-swap-hooks.ts
│   │   │   ├── spark-send-quote-hooks.ts
│   │   │   ├── send-store.ts
│   │   │   └── ...components
│   │   ├── receive/                       # hooks + components
│   │   ├── transactions/                  # hooks + components + store
│   │   ├── user/                          # auth.ts, user-hooks.tsx, storage files
│   │   ├── wallet/                        # task-processing.ts, wallet.tsx
│   │   ├── agicash-db/
│   │   │   ├── database.client.ts         # Browser Supabase client (window, import.meta.env)
│   │   │   ├── database.server.ts         # Server Supabase client
│   │   │   └── supabase-session.ts        # Token management (QueryClient + OpenSecret)
│   │   └── ...other feature dirs (login, signup, settings, gift-cards, etc.)
│   ├── components/                         # Unchanged
│   ├── hooks/                              # Unchanged
│   ├── lib/
│   │   ├── cashu/
│   │   │   ├── index.ts                   # Web barrel (re-exports sdk + adds melt-quote-subscription)
│   │   │   ├── melt-quote-subscription.ts # React hooks
│   │   │   └── animated-qr-code/          # React hooks
│   │   ├── supabase/
│   │   │   ├── index.ts                   # Re-exports sdk + adds hooks
│   │   │   └── supabase-realtime-hooks.ts # React hooks
│   │   ├── performance/
│   │   │   └── sentry-performance.ts      # Sentry impl (registers via setMeasureOperation)
│   │   ├── transitions/                   # React + DOM
│   │   ├── use-throttle/                  # React hooks
│   │   ├── use-latest/                    # React hooks
│   │   ├── read-clipboard.ts              # navigator.clipboard
│   │   ├── share.ts                       # navigator.share
│   │   ├── password-generator.ts          # window.crypto
│   │   ├── validation.ts                  # document.createElement
│   │   ├── date.ts                        # navigator.language
│   │   ├── cookies.server.ts              # Server-only
│   │   └── feature-flags.ts              # import.meta.env
│   ├── entry.client.tsx                    # Calls configure() + setMeasureOperation()
│   └── ...rest unchanged
│
├── supabase/                               # Stays at root (migrations, functions, config)
│   └── database.types.ts                  # Generated here, ALSO copied to sdk
├── package.json                            # Root = web app + workspace config
├── tsconfig.json
├── vite.config.ts
└── ...other root config files
```

### The Three Boundary Interfaces

These are the **only** new abstractions. They match shapes that already exist in the codebase.

#### KeyProvider — replaces `@opensecret/react` direct imports

```typescript
// packages/sdk/src/interfaces/key-provider.ts
export type KeyProvider = {
  getPrivateKeyBytes(params: {
    seed_phrase_derivation_path?: string;
    private_key_derivation_path?: string;
  }): Promise<{ private_key: string }>;

  getPublicKey(
    type: 'schnorr',
    params: { private_key_derivation_path: string },
  ): Promise<{ public_key: string }>;

  getMnemonic(params: {
    seed_phrase_derivation_path: string;
  }): Promise<{ mnemonic: string }>;
};
```

Web app implements this by delegating to `@opensecret/react`. CLI (future) implements with file-based key storage.

#### Cache — replaces QueryClient dependency

```typescript
// packages/sdk/src/interfaces/cache.ts
export type Cache = {
  fetchQuery<T>(options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<T>;
    staleTime?: number;
  }): Promise<T>;

  cancelQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
};
```

This is the subset of `QueryClient` that SDK code actually uses. Web app wraps its existing `QueryClient`. CLI (future) uses a `Map`-backed implementation.

#### Config — replaces import.meta.env

```typescript
// packages/sdk/src/config.ts
export type AgicashConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  cashuMintBlocklist: string[];
  environment: 'local' | 'production' | 'alpha' | 'next' | 'preview';
};

let _config: AgicashConfig | null = null;

export function configure(config: AgicashConfig): void {
  _config = config;
}

export function getConfig(): AgicashConfig {
  if (!_config) throw new Error('Call configure() before using @agicash/sdk');
  return _config;
}
```

Web app calls `configure()` in `entry.client.tsx` with values from `import.meta.env`.

### Performance Abstraction

```typescript
// packages/sdk/src/performance.ts
export type MeasureOperationFn = <T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
) => Promise<T>;

let _measureOperation: MeasureOperationFn = (_name, op) => op();

export function setMeasureOperation(fn: MeasureOperationFn): void {
  _measureOperation = fn;
}

export function measureOperation<T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
): Promise<T> {
  return _measureOperation(name, operation, attributes);
}
```

Default is a no-op passthrough. Web app registers Sentry. CLI can use `console.time()` or skip entirely.

---

## Phases

### Phase 0: Workspace Infrastructure

**Goal:** Bun workspace set up, SDK package exists but is empty, web app unchanged.

**What changes:**
1. Add `"workspaces": ["packages/*"]` to root `package.json`
2. Create `packages/sdk/package.json`:
   ```jsonc
   {
     "name": "@agicash/sdk",
     "private": true,
     "type": "module",
     "exports": {
       ".": "./src/index.ts",
       "./*": "./src/*"
     }
   }
   ```
3. Create `packages/sdk/tsconfig.json` — **no `"DOM"` in lib**, no `"jsx"`, no `"types": ["vite/client"]`. This enforces no browser API usage at compile time.
4. Create `packages/sdk/biome.json` — extends `../../biome.jsonc`
5. Create `packages/sdk/src/index.ts` — empty barrel: `// @agicash/sdk`
6. Add `"@agicash/sdk": "workspace:*"` to root `package.json` dependencies
7. Add `"references": [{ "path": "./packages/sdk" }]` to root `tsconfig.json`

**What stays in web app:** Everything. No code moves.

**Verification:**
- `bun install` completes (workspace symlinks created)
- `bun run fix:all` passes
- `bun run dev` works — web app unchanged

**Risk:** Low. Pure infrastructure, no code changes.

---

### Phase 1: Core Abstractions

**Goal:** Create the three boundary interfaces, runtime config, and performance abstraction. Wire them into the web app so they're ready for moved files to use.

**What changes:**
1. Create `packages/sdk/src/config.ts` — `AgicashConfig` type, `configure()`, `getConfig()`
2. Create `packages/sdk/src/performance.ts` — injectable `measureOperation`
3. Create `packages/sdk/src/interfaces/key-provider.ts` — `KeyProvider` type
4. Create `packages/sdk/src/interfaces/cache.ts` — `Cache` type
5. Update `app/entry.client.tsx` to call `configure()` and `setMeasureOperation()`:
   ```typescript
   import { configure } from '@agicash/sdk/config';
   import { setMeasureOperation } from '@agicash/sdk/performance';
   import { measureOperation as sentryMeasureOperation } from './lib/performance/sentry-performance';

   // After existing OpenSecret configure() call:
   configure({
     supabaseUrl: import.meta.env.VITE_SUPABASE_URL ?? '',
     supabaseAnonKey: import.meta.env.VITE_SUPABASE_ANON_KEY ?? '',
     cashuMintBlocklist: (import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '').split(',').filter(Boolean),
     environment: getEnvironment(),
   });

   setMeasureOperation(sentryMeasureOperation);
   ```
6. Export interfaces and config from `packages/sdk/src/index.ts`

**What stays in web app:** Everything except the new SDK files.

**Verification:**
- `bun run fix:all` passes
- `bun run dev` works
- Web app calls `configure()` on startup without errors

**Risk:** Low. Five new files + one small edit to `entry.client.tsx`.

---

### Phase 2: Move Pure Lib Modules

**Goal:** All portable utility modules live in `packages/sdk/src/lib/`.

These files require **zero logic changes** — just move and update imports. The only work is updating consumer imports in the web app, and leaving re-export shims in the original locations.

**What moves:**

| Source | Destination |
|--------|-------------|
| `app/lib/money/` (entire dir) | `packages/sdk/src/lib/money/` |
| `app/lib/bolt11/` | `packages/sdk/src/lib/bolt11/` |
| `app/lib/ecies/` | `packages/sdk/src/lib/ecies/` |
| `app/lib/sha256.ts` | `packages/sdk/src/lib/sha256.ts` |
| `app/lib/json.ts` | `packages/sdk/src/lib/json.ts` |
| `app/lib/zod.ts` | `packages/sdk/src/lib/zod.ts` |
| `app/lib/utils.ts` | `packages/sdk/src/lib/utils.ts` |
| `app/lib/timeout.ts` | `packages/sdk/src/lib/timeout.ts` |
| `app/lib/delay.ts` | `packages/sdk/src/lib/delay.ts` |
| `app/lib/type-utils.ts` | `packages/sdk/src/lib/type-utils.ts` |
| `app/lib/xchacha20poly1305.ts` | `packages/sdk/src/lib/xchacha20poly1305.ts` |
| `app/lib/locale/` | `packages/sdk/src/lib/locale/` |
| `app/lib/spark/` (all files) | `packages/sdk/src/lib/spark/` |
| `app/lib/exchange-rate/` (entire dir) | `packages/sdk/src/lib/exchange-rate/` |
| `app/lib/lnurl/` | `packages/sdk/src/lib/lnurl/` |

**Cashu lib — individual files, NOT the barrel:**

| Source | Destination |
|--------|-------------|
| `app/lib/cashu/proof.ts` | `packages/sdk/src/lib/cashu/proof.ts` |
| `app/lib/cashu/secret.ts` | `packages/sdk/src/lib/cashu/secret.ts` |
| `app/lib/cashu/token.ts` | `packages/sdk/src/lib/cashu/token.ts` |
| `app/lib/cashu/utils.ts` | `packages/sdk/src/lib/cashu/utils.ts` |
| `app/lib/cashu/error-codes.ts` | `packages/sdk/src/lib/cashu/error-codes.ts` |
| `app/lib/cashu/types.ts` | `packages/sdk/src/lib/cashu/types.ts` |
| `app/lib/cashu/payment-request.ts` | `packages/sdk/src/lib/cashu/payment-request.ts` |
| `app/lib/cashu/mint-validation.ts` | `packages/sdk/src/lib/cashu/mint-validation.ts` |
| `app/lib/cashu/melt-quote-subscription-manager.ts` | `packages/sdk/src/lib/cashu/melt-quote-subscription-manager.ts` |
| `app/lib/cashu/mint-quote-subscription-manager.ts` | `packages/sdk/src/lib/cashu/mint-quote-subscription-manager.ts` |

**DO NOT move:** `melt-quote-subscription.ts` (React hooks), `animated-qr-code/` (React hooks), the barrel `index.ts`.

Create clean barrel `packages/sdk/src/lib/cashu/index.ts` re-exporting only portable files.

**Supabase realtime — manager + channel, not hooks:**

| Source | Destination |
|--------|-------------|
| `app/lib/supabase/supabase-realtime-manager.ts` | `packages/sdk/src/lib/supabase/supabase-realtime-manager.ts` |
| `app/lib/supabase/supabase-realtime-channel.ts` | `packages/sdk/src/lib/supabase/supabase-realtime-channel.ts` |
| `app/lib/supabase/supabase-realtime-channel-builder.ts` | `packages/sdk/src/lib/supabase/supabase-realtime-channel-builder.ts` |

**DO NOT move:** `supabase-realtime-hooks.ts` (React hooks using `window`, `document`, `navigator`).

**Shim strategy:** Each moved file leaves a re-export shim at its original location:
```typescript
// app/lib/money/index.ts (shim)
export * from '@agicash/sdk/lib/money';
```

This means zero consumer import changes in this phase. All `~/lib/money` imports continue to work through the shim.

**Minor fix to verify before moving:** `app/lib/money/money.ts` has `window.devtoolsFormatters` in `registerDevToolsFormatter()`. It already has a `typeof window === 'undefined'` guard — confirm this before moving.

**What stays in web app:** All React hooks, browser-dependent libs, Sentry performance, animated QR code, melt-quote-subscription.

**Verification:**
- `bun run fix:all` passes
- `bun run dev` works
- All features that use money, cashu, bolt11, spark, etc. still work

**Risk:** Low. File moves + re-export shims. No logic changes.

---

### Phase 3: Move Types, Error Classes, Database Types

**Goal:** All shared types, error classes, and database schemas live in the SDK.

**What moves:**

Shared types and errors:

| Source | Destination |
|--------|-------------|
| `app/features/shared/error.ts` | `packages/sdk/src/features/shared/error.ts` |
| `app/features/shared/currencies.ts` | `packages/sdk/src/features/shared/currencies.ts` |

Database types:

| Source | Destination |
|--------|-------------|
| `app/features/agicash-db/database.ts` | `packages/sdk/src/db/database.ts` |
| `app/features/agicash-db/json-models/` (entire dir) | `packages/sdk/src/db/json-models/` |

Update `database.ts` to import generated types from local path:
```typescript
// Before: import type { Database as DatabaseGenerated } from 'supabase/database.types';
// After:  import type { Database as DatabaseGenerated } from './database-generated.types';
```

Update `db:generate-types` script to also copy to SDK:
```jsonc
"db:generate-types": "supabase gen types typescript --local --schema wallet > supabase/database.types.ts && cp supabase/database.types.ts packages/sdk/src/db/database-generated.types.ts"
```

Account types:

| Source | Destination |
|--------|-------------|
| `app/features/accounts/account.ts` | `packages/sdk/src/features/accounts/account.ts` |
| `app/features/accounts/cashu-account.ts` | `packages/sdk/src/features/accounts/cashu-account.ts` |
| `app/features/accounts/account-cryptography.ts` | `packages/sdk/src/features/accounts/account-cryptography.ts` |

Feature entity types:

| Source | Destination |
|--------|-------------|
| `app/features/send/cashu-send-quote.ts` | `packages/sdk/src/features/send/cashu-send-quote.ts` |
| `app/features/send/cashu-send-swap.ts` | `packages/sdk/src/features/send/cashu-send-swap.ts` |
| `app/features/send/spark-send-quote.ts` | `packages/sdk/src/features/send/spark-send-quote.ts` |
| `app/features/receive/cashu-receive-quote.ts` | `packages/sdk/src/features/receive/cashu-receive-quote.ts` |
| `app/features/receive/cashu-token-melt-data.ts` | `packages/sdk/src/features/receive/cashu-token-melt-data.ts` |
| `app/features/receive/receive-cashu-token-models.ts` | `packages/sdk/src/features/receive/receive-cashu-token-models.ts` |
| `app/features/receive/spark-receive-quote.ts` | `packages/sdk/src/features/receive/spark-receive-quote.ts` |
| `app/features/transactions/transaction.ts` | `packages/sdk/src/features/transactions/transaction.ts` |
| `app/features/transactions/transaction-enums.ts` | `packages/sdk/src/features/transactions/transaction-enums.ts` |
| `app/features/transactions/transaction-details/` (all 8 schema files) | `packages/sdk/src/features/transactions/transaction-details/` |
| `app/features/contacts/contact.ts` | `packages/sdk/src/features/contacts/contact.ts` |
| `app/features/user/user.ts` | `packages/sdk/src/features/user/user.ts` |

Theme types and constants:

| Source | Destination |
|--------|-------------|
| `app/features/theme/theme.types.ts` | `packages/sdk/src/features/theme/theme.types.ts` |
| `app/features/theme/theme.constants.ts` | `packages/sdk/src/features/theme/theme.constants.ts` |
| `app/features/theme/colors.ts` | `packages/sdk/src/features/theme/colors.ts` |

**DO NOT move:** `app/features/theme/index.ts` (re-exports React components/hooks).

**Shim strategy:** Same as Phase 2 — each moved file leaves a re-export shim at its original location. Zero consumer import changes.

**What stays in web app:** `database.client.ts`, `database.server.ts`, `supabase-session.ts`, all hooks and components, theme's React barrel.

**Verification:**
- `bun run fix:all` passes
- `bun run dev` works
- `bun run db:generate-types` works (copies to both locations)

**Risk:** Low. Pure file moves of types and constants.

---

### Phase 4: Split Mixed Files

**Goal:** Extract portable logic from files that mix pure functions with React hooks. This is the most impactful phase — wallet initialization, cryptography, and encryption are core paths.

Four files need splitting:

#### 4a: `encryption.ts`

**SDK** (`packages/sdk/src/features/shared/encryption.ts`):
- `Encryption` type
- `getEncryption(privateKey, publicKeyHex)` factory
- `encryptToPublicKey()`, `encryptBatchToPublicKey()`
- `decryptWithPrivateKey()`, `decryptBatchWithPrivateKey()`
- `preprocessData()`, `serializeData()`, `deserializeData()`

These are already pure — they take `Uint8Array`/`string` params and return results. Zero signature changes.

**Web** (`app/features/shared/encryption.ts`) becomes a thin wrapper:
- Re-exports all core types/functions from `@agicash/sdk`
- Keeps `encryptionPrivateKeyQueryOptions()`, `encryptionPublicKeyQueryOptions()`
- Keeps `useEncryptionPrivateKey()`, `useEncryptionPublicKeyHex()`, `useEncryption()`
- These hooks call `@opensecret/react` functions + wrap core's `getEncryption()`

#### 4b: `cryptography.ts`

**SDK** (`packages/sdk/src/features/shared/cryptography.ts`):
- `derivePublicKey(xpub, derivationPath)` — already pure

**Web** (`app/features/shared/cryptography.ts`):
- Re-exports `derivePublicKey` from SDK
- Keeps `useCryptography()` hook (wraps `@opensecret/react` functions)

#### 4c: `cashu.ts` — most complex split

**SDK** (`packages/sdk/src/features/shared/cashu.ts`):
- `CashuCryptography` type
- `getCashuCryptography(keyProvider: KeyProvider, cache: Cache)` — signature changes from `(queryClient: QueryClient)`:
  - `getSeed()` calls `keyProvider.getMnemonic()` + `cache.fetchQuery()`
  - `getXpub()` calls `keyProvider.getPrivateKeyBytes()` + `cache.fetchQuery()`
  - `getPrivateKey()` calls `keyProvider.getPrivateKeyBytes()` + `cache.fetchQuery()`
- `getInitializedCashuWallet(cache, mintUrl, currency, bip39seed)` — uses `cache` instead of `queryClient`, `getConfig().cashuMintBlocklist` instead of `import.meta.env.VITE_CASHU_MINT_BLOCKLIST`, `measureOperation` from SDK
- `tokenToMoney()`, `getTokenHash()`, constants

**Web** (`app/features/shared/cashu.ts`):
- All `queryOptions()` definitions stay (`seedQueryOptions`, `xpubQueryOptions`, `mintInfoQueryOptions`, etc.)
- `useCashuCryptography()` creates a `KeyProvider` from `@opensecret/react` and wraps `QueryClient` as `Cache`
- Re-exports core types

Web-specific `KeyProvider` and `Cache` adapter:
```typescript
const webKeyProvider: KeyProvider = { getPrivateKeyBytes, getPublicKey, getMnemonic: getPrivateKey };

function queryClientAsCache(qc: QueryClient): Cache {
  return {
    fetchQuery: (opts) => qc.fetchQuery(opts),
    cancelQueries: (params) => qc.cancelQueries(params),
  };
}
```

This adapter pattern will be reused across the web app. Put it in `app/lib/cache-adapter.ts`.

#### 4d: `spark.ts`

**SDK** (`packages/sdk/src/features/shared/spark.ts`):
- `getInitializedSparkWallet(cache, mnemonic, network)` — uses `cache`, `measureOperation` from SDK
- `getLeafDenominations()`

**Web** (`app/features/shared/spark.ts`):
- All `queryOptions()` definitions
- `useTrackAndUpdateSparkAccountBalances()` — the heavy React hook
- `useSparkBalances()`

**What stays in web app:** All hooks, all `queryOptions()`, the `webKeyProvider` and `queryClientAsCache` adapter.

**Verification:**
- `bun run fix:all` passes
- `bun run dev` works
- Cashu wallet initializes against real mint
- Spark wallet initializes
- Encryption round-trips correctly
- Login/signup works (depends on encryption)

**Risk:** **Medium.** Wallet initialization is a critical path. The `KeyProvider`/`Cache` refactor of `cashu.ts` changes function signatures. Mitigation: `Cache` is a strict subset of `QueryClient` — behavioral parity is guaranteed. Test manually after splitting.

---

### Phase 5: Move Repositories and Services

**Goal:** All repository classes and service classes live in the SDK. Only `use*` factory hooks stay in web.

Every repo/service follows the same pattern:
1. Move the **class** to SDK
2. The `use*()` hook factory at the bottom of the file moves to the corresponding `*-hooks.ts` file in web
3. Update the class to import types/deps from SDK paths
4. Where a class accepts `QueryClient`, change to `Cache`

#### Accounts

| File | Moves to SDK | Stays in web |
|------|-------------|--------------|
| `account-service.ts` | Entire file (pure static methods) | — |
| `account-repository.ts` | `AccountRepository` class | `useAccountRepository()` moves to `account-hooks.ts` |
| `utils.ts` | Entire file | — |

#### Send

| File | Moves to SDK | Stays in web |
|------|-------------|--------------|
| `cashu-send-quote-service.ts` | Entire file | — |
| `cashu-send-quote-repository.ts` | Class | `use*` hook to `cashu-send-quote-hooks.ts` |
| `cashu-send-swap-service.ts` | Entire file | — |
| `cashu-send-swap-repository.ts` | Class | `use*` hook to `cashu-send-swap-hooks.ts` |
| `spark-send-quote-service.ts` | Entire file | — |
| `spark-send-quote-repository.ts` | Class | `use*` hook to `spark-send-quote-hooks.ts` |
| `proof-state-subscription-manager.ts` | Entire file | — |
| `utils.ts` | Entire file | — |

#### Receive

| File | Moves to SDK | Stays in web |
|------|-------------|--------------|
| `cashu-receive-quote-core.ts` | Entire file | — |
| `cashu-receive-quote-service.ts` | Entire file | — |
| `cashu-receive-quote-repository.ts` | Class | Hook to `*-hooks.ts` |
| `cashu-receive-swap-repository.ts` | Class | Hook to `*-hooks.ts` |
| `cashu-receive-swap-service.ts` | Class | `useCashuReceiveSwapService()` to hooks |
| `receive-cashu-token-quote-service.ts` | Entire file | — |
| `receive-cashu-token-service.ts` | Class | Hook to `*-hooks.ts`. Class uses `QueryClient` — change to `Cache` |
| `claim-cashu-token-service.ts` | Class | Hook stays in web. Class uses `QueryClient` heavily — change to `Cache` |
| `spark-receive-quote-core.ts` | Entire file | — |
| `spark-receive-quote-service.ts` | Entire file | — |
| `spark-receive-quote-repository.ts` | Class | Hook to `*-hooks.ts` |

**DO NOT move:** Files with `.server.ts` suffix — they're server-only web framework code. Also `lightning-address-service.ts` — server-only, uses `process.env`.

#### Transactions, contacts, user, wallet

| File | Moves to SDK | Stays in web |
|------|-------------|--------------|
| `transaction-repository.ts` | Class | Hook to `transaction-hooks.ts` |
| `contact-repository.ts` | Class | Hook to `contact-hooks.ts` |
| `user-service.ts` | Entire file | — |
| `user-repository.ts` | Class(es) | Hook to `user-hooks.tsx` |
| `task-processing-lock-repository.ts` | Entire file | — |

#### QueryClient to Cache migration

Repositories that accept `QueryClient` change to accept `Cache`. Most use only `fetchQuery()` and `cancelQueries()` — same signatures.

**Special attention:** `claim-cashu-token-service.ts` and `receive-cashu-token-service.ts` have heavier `QueryClient` usage than most repos. Their `Cache` migration needs extra care.

**Shim strategy:** Same as prior phases — re-export shims for all moved classes.

**What stays in web app:** All `use*` hooks, all React components, all stores, all `.server.ts` files, all browser-dependent code.

**Verification:**
- `bun run fix:all` passes
- `bun run dev` works
- All mutations and queries work (send, receive, account operations)
- Login/signup works

**Risk:** **Medium.** Many files move, but each is mechanical (class extraction + hook relocation). The `QueryClient` to `Cache` migration in `claim-cashu-token-service.ts` is the riskiest part. Mitigation: `Cache` is a strict subset — test the claim flow specifically.

---

### Phase 6: SDK Public API + Barrel

**Goal:** Clean barrel exports in `packages/sdk/src/index.ts`. Organized by category.

**What changes:**

```typescript
// packages/sdk/src/index.ts

// Configuration
export { configure, getConfig, type AgicashConfig } from './config';
export { measureOperation, setMeasureOperation, type MeasureOperationFn } from './performance';

// Interfaces
export type { KeyProvider } from './interfaces/key-provider';
export type { Cache } from './interfaces/cache';

// Database
export type { AgicashDb, Database } from './db/database';

// Features - types, services, repositories
export { AccountRepository } from './features/accounts/account-repository';
export { AccountService } from './features/accounts/account-service';
export type { Account, CashuAccount, SparkAccount } from './features/accounts/account';
// ... etc for all features

// Shared
export { DomainError, ConcurrencyError, NotFoundError } from './features/shared/error';
export { getEncryption, type Encryption } from './features/shared/encryption';
export { getCashuCryptography, type CashuCryptography } from './features/shared/cashu';
export { getInitializedSparkWallet } from './features/shared/spark';
export { derivePublicKey } from './features/shared/cryptography';

// Lib
export { Money } from './lib/money';
export { ExchangeRateService } from './lib/exchange-rate/exchange-rate-service';
// ... etc
```

The barrel exports the most commonly used items. Deep imports (`@agicash/sdk/lib/cashu/proof`) remain available via the `"./*": "./src/*"` exports field.

Add SDK dependencies to `packages/sdk/package.json`:
```jsonc
{
  "dependencies": {
    "@buildonspark/spark-sdk": "...",
    "@cashu/cashu-ts": "...",
    "@cashu/crypto": "...",
    "@noble/ciphers": "...",
    "@noble/curves": "...",
    "@noble/hashes": "...",
    "@scure/bip32": "...",
    "@scure/bip39": "...",
    "@stablelib/base64": "...",
    "@supabase/supabase-js": "...",
    "big.js": "...",
    "jwt-decode": "...",
    "ky": "...",
    "light-bolt11-decoder": "...",
    "zod": "..."
  },
  "devDependencies": {
    "@types/big.js": "...",
    "type-fest": "...",
    "typescript": "..."
  }
}
```

Note: `@stablelib/base64` is in `devDependencies` in root but used at runtime — fix this when adding to SDK.

**Verification:**
- `bun run fix:all` passes
- `bun run dev` works
- TypeScript can resolve all `@agicash/sdk` and `@agicash/sdk/*` imports

**Risk:** Low. Organizational, no logic changes.

---

### Phase 7: Remove Shims, Update Imports

**Goal:** Remove all re-export shims from `app/`. All web app files import directly from `@agicash/sdk` (or `@agicash/sdk/*`).

**What changes:**
- Delete every shim file in `app/` that only re-exports from `@agicash/sdk`
- Update every import in the web app from `~/lib/money` to `@agicash/sdk/lib/money`, etc.
- Keep thin wrappers that combine SDK + web code (like `app/features/shared/encryption.ts` with hooks)

**Import patterns after cleanup:**

```typescript
// Pure SDK imports:
import { Money } from '@agicash/sdk/lib/money';
import { DomainError } from '@agicash/sdk/features/shared/error';
import { AccountRepository } from '@agicash/sdk/features/accounts/account-repository';

// Or via barrel:
import { Money, DomainError, AccountRepository } from '@agicash/sdk';

// Web files that mix SDK + hooks — keep importing via web wrapper:
import { useEncryption } from '~/features/shared/encryption';
```

**What stays in web app:** All hooks, components, stores, browser-dependent code, server routes. Thin wrappers that add React integration on top of SDK exports.

**Verification:**
Full regression checklist:
- `bun install` completes
- `bun run fix:all` passes
- `bun run dev` starts without errors
- Login/signup works
- Send flow (Cashu + Lightning) works
- Receive flow works
- Account balances display correctly
- Transactions list loads
- Realtime updates work
- `bun test` passes
- `bun run build` completes (production build)

**Risk:** **Medium.** Mass import rename across many files. Mitigation: TypeScript catches broken imports at compile time. `bun run fix:all` catches the rest.

---

### Phase 8: State Machine Processors (Optional / Future)

**Goal:** Extract background task processor logic from React hooks into SDK classes.

This is listed as optional because it's the hardest extraction and isn't required for a CLI that handles one operation at a time. It becomes necessary when the CLI needs to run background task processing (multi-tab coordination, proof state polling).

The current hook-based processors (`useProcessCashuSendQuoteTasks`, etc.) deeply interleave state machine logic, TanStack Query cache invalidation, and React effect lifecycle.

**Strategy:** Extract state transition logic into processor classes that accept callbacks:

```typescript
// packages/sdk/src/processors/cashu-send-quote-processor.ts
export class CashuSendQuoteProcessor {
  constructor(
    private sendQuoteRepo: CashuSendQuoteRepository,
    private sendSwapService: CashuSendSwapService,
    private cache: Cache,
    private onQuoteResolved?: (quoteId: string) => void,
  ) {}

  async processUnresolved(): Promise<void> {
    const unresolved = await this.sendQuoteRepo.getUnresolved();
    for (const quote of unresolved) {
      await this.processQuote(quote);
    }
  }
}
```

Web app wraps these in React hooks for cache invalidation and render cycles. CLI calls `processUnresolved()` directly.

**Risk:** **High.** Complex state logic tightly coupled to React lifecycle. Mitigation: defer until CLI actually needs it. Run existing web tests + add SDK-level tests for each processor.

---

## Portability Assessment

### Truly portable as-is (zero changes needed)

- `lib/money/` — Money class, safe arithmetic, formatting
- `lib/bolt11/` — Lightning invoice parsing
- `lib/ecies/` — ECIES encryption
- `lib/sha256.ts`, `lib/json.ts`, `lib/zod.ts`, `lib/utils.ts` — pure utilities
- `lib/timeout.ts`, `lib/delay.ts`, `lib/type-utils.ts`, `lib/xchacha20poly1305.ts`
- `lib/cashu/proof.ts`, `secret.ts`, `token.ts`, `utils.ts`, `error-codes.ts`, `types.ts`, `payment-request.ts`, `mint-validation.ts` — individual files (NOT the barrel)
- `lib/cashu/melt-quote-subscription-manager.ts`, `mint-quote-subscription-manager.ts`
- `lib/spark/` — Spark utils, signer, identity key
- `lib/exchange-rate/exchange-rate-service.ts` — rate fetching
- `lib/supabase/supabase-realtime-manager.ts`, channel, builder — realtime channels
- `lib/locale/`
- `features/shared/error.ts` — DomainError, ConcurrencyError, NotFoundError
- `features/shared/currencies.ts`
- `features/send/proof-state-subscription-manager.ts`
- All service classes (constructor bodies — no React)
- All repository classes (constructor bodies — no React)
- All type/entity files (account.ts, cashu-send-quote.ts, transaction.ts, etc.)
- All Zod schema files (transaction-details/*, json-models/*)
- Theme types and constants

### Portable with small fixes

| File | Fix needed |
|------|-----------|
| `lib/money/money.ts` | Verify `typeof window === 'undefined'` guard on `registerDevToolsFormatter()` |
| `features/shared/cashu.ts` | Replace `import.meta.env.VITE_CASHU_MINT_BLOCKLIST` with `getConfig()`, replace `measureOperation` import, change `QueryClient` to `Cache`, change OpenSecret imports to `KeyProvider` |
| `features/shared/spark.ts` | Replace `measureOperation` import, change `queryClient` to `cache` |
| `features/shared/encryption.ts` | Split pure functions (already portable) from React hooks |
| `features/shared/cryptography.ts` | Split `derivePublicKey` (portable) from `useCryptography` hook |
| `features/agicash-db/database.ts` | Update generated types import path |
| `claim-cashu-token-service.ts` | Change `QueryClient` to `Cache` (heavier usage than other repos) |
| `receive-cashu-token-service.ts` | Change `QueryClient` to `Cache` |

### Browser-only (stays in web app forever)

- `features/agicash-db/database.client.ts` — `window`, `import.meta.env`
- `features/agicash-db/database.server.ts` — server-only
- `features/agicash-db/supabase-session.ts` — TanStack Query-based token getter
- All `*-hooks.ts` files (11 files)
- All `use*` factory functions (relocated to hooks files)
- All `.tsx` components
- `app/hooks/`, `app/components/` — entire directories
- `lib/cashu/melt-quote-subscription.ts` — React hooks
- `lib/cashu/animated-qr-code/` — React hooks
- `lib/read-clipboard.ts` — `navigator.clipboard`
- `lib/share.ts` — `navigator.share`
- `lib/password-generator.ts` — `window.crypto`
- `lib/validation.ts` — `document.createElement`
- `lib/date.ts` — `navigator.language`
- `lib/cookies.server.ts` — server-only
- `lib/feature-flags.ts` — `import.meta.env`
- `lib/performance/sentry-performance.ts` — `@sentry/react-router`
- `lib/transitions/` — React + DOM
- `lib/use-throttle/`, `lib/use-latest.ts` — React hooks
- `lib/supabase/supabase-realtime-hooks.ts` — `window`, `document`, `navigator`
- `features/user/auth.ts` — React hooks + `localStorage` + `@opensecret/react`
- `features/user/guest-account-storage.ts` — `localStorage`
- `features/user/oauth-login-session-storage.ts` — `sessionStorage`
- `features/user/pending-terms-storage.ts` — `localStorage`
- `features/wallet/task-processing.ts` — React component
- `features/wallet/wallet.tsx` — React component
- `features/wallet/use-track-wallet-changes.ts` — React hooks
- `features/send/send-store.ts` — Zustand + `import.meta.env.MODE`
- `features/receive/receive-store.ts` — Zustand
- `features/transactions/transaction-ack-status-store.ts` — Zustand
- `features/receive/lightning-address-service.ts` — server-only, `process.env`
- All server routes (`*.server.ts`)
- All UI features (login, signup, settings, gift-cards, theme components, pwa, loading)

---

## Key Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Workspace breaks Vite dev server | Low | High | Phase 0 validates `bun run dev` before any code moves |
| Mass import rename introduces bugs | Medium | Medium | TypeScript catches broken imports at compile time. Each phase ends with `bun run fix:all` |
| `getInitializedCashuWallet` breaks with Cache interface | Low | High | Cache is a strict subset of QueryClient — behavioral parity guaranteed. Test Cashu wallet init manually in Phase 4 |
| Spark SDK has hidden browser assumptions | Low | High | Already verified: SDK is pure JS/WASM, works in Node/Bun |
| `claim-cashu-token-service.ts` Cache migration breaks claim flow | Medium | High | Has heavier QueryClient usage than other repos. Test claim flow manually after Phase 5 |
| Poisoned cashu barrel pulls in React | Low | Medium | SDK creates its own clean barrel. Never re-export `melt-quote-subscription.ts` |
| `database.client.ts` unconditional `window` assignment | N/A | N/A | Stays in web app, never moves to SDK |
| Open Secret fork has ~44 localStorage calls | Low | Low | Separate concern from SDK extraction. Web app continues to use window.localStorage. Only matters when CLI needs auth |
| Supabase generated types path changes | Low | Low | Updated `db:generate-types` script copies to both locations |
| State machine extraction misses edge cases | High | Medium | Phase 8 is optional. Defer until CLI needs it. Run existing web tests |

---

## Open Questions

1. **Naming: `@agicash/sdk` vs `@agicash/core`?** The old workspace-refactor plan used `core`. The SDK plan used `sdk`. `core` implies "internal building blocks," `sdk` implies "external consumption ready." Since the CLI is the primary consumer and it's the same team, either works. Pick one before Phase 0.

2. **Should the web app `KeyProvider` and `Cache` adapter be a shared utility?** The `queryClientAsCache()` adapter will be used in many hook files. Recommend creating `app/lib/cache-adapter.ts` with the shared adapter in Phase 4.

3. **Zustand stores: extract or leave?** Zustand's `create()` works outside React, and `send-store.ts` is ~95% portable (only `import.meta.env.MODE` is non-portable). But stores contain UI flow logic. Current decision: leave in web app. Revisit if CLI needs send flow orchestration.

4. **`@stablelib/base64` dependency placement.** Currently in root `devDependencies` but used at runtime. Fix when adding to SDK `dependencies`.

5. **Phase 8 timing.** State machine processor extraction is optional. When does the CLI need background processing? This determines whether Phase 8 ships with the initial extraction or later.

---

## References

- **PR #868** (closed, branch deleted): Prior proof-of-concept for this refactor on MakePrisms/agicash
- **`plans/workspace-refactor.md`**: blob SHA `a924e5ed0681935675b254aefe3946316b9bc791` — detailed workspace refactor plan with file-by-file migration tables
- **`plans/agicash-cli.md`**: blob SHA `c5a47fea055c5ee8c245b9c4ec4ee3ac037ab572` — SDK design, feasibility audit, CLI architecture, migration strategy
- Fetch either via: `gh api repos/MakePrisms/agicash/git/blobs/<sha> --jq '.content' | base64 -d`
