# Agicash SDK Extraction & CLI Plan

> Evolving from "CLI that imports app/" to a proper `@agicash/sdk` package that both the web app and CLI consume. Maximal code reuse, minimal abstraction overhead, preserving the patterns that already work.

## Motivation

The original CLI plan imported directly from `app/`. This creates a fragile coupling: the CLI breaks whenever the web app refactors, and it prevents other consumers (mobile, bots, integrations). A shared SDK package solves this without over-engineering — the extraction follows boundaries that already exist in the code.

---

## Part 1: Feasibility Report Audit

Before designing the SDK, we validated every claim in the original feasibility report against the actual codebase. Here's what we found.

### What the Report Got Right

- **Three-layer architecture exists.** `lib/` → `services/repos` → `React hooks` is real and consistent. Every repository uses constructor injection with a `use*` factory hook at the file bottom.
- **Services are portable.** `CashuSendQuoteService`, `CashuSendSwapService`, `CashuReceiveQuoteService`, `SparkSendQuoteService`, `SparkReceiveQuoteService`, `AccountService`, `UserService` — all accept deps via constructor. Zero React imports in the class bodies (with caveats below).
- **Open Secret fork removed React Context.** `configure()` works via module-level state. All API functions are plain async exports. Agicash doesn't use the deprecated Provider.
- **Supabase client works in Node/Bun.** `@supabase/supabase-js` has no browser deps. The `accessToken` callback pattern is standard.
- **Zustand stores are ~95% extractable.** `create()` works outside React. `send-store.ts` only has one non-portable reference (`import.meta.env.MODE`).
- **`ProofStateSubscriptionManager` (148 LOC), `MeltQuoteSubscriptionManager`, `MintQuoteSubscriptionManager`** — all already fully portable, zero React imports.

### What the Report Got Wrong

| Claim | Reality | Impact |
|-------|---------|--------|
| "21 modules reusable as-is" | Several have hidden deps (see below) | Overstates portability |
| "~20 localStorage/sessionStorage calls in Open Secret fork" | Actually **~44 total, ~33 in production paths** across `api.ts` (24), `encryptedApi.ts` (1), `getAttestation.ts` (4), `ai.ts` (1), `platformApi.ts` (3) | Underestimates effort by ~50% |
| "13 hook files" | Actually **11** in current codebase | Minor |
| "`cashu-send-quote-repository.ts` uses `useQueryClient()`" | It does NOT. Report was wrong. | Overstates adaptation needed |
| "`claim-cashu-token-service.ts` uses `useQueryClient()` hook" | Uses `QueryClient` via **constructor injection** — already portable | Misleading |
| "`shared/cashu.ts` uses `useSuspenseQuery`" | It does NOT. Has `queryOptions()` + standalone functions + one `useMemo` hook | Report confused `queryOptions` with hooks |
| "`shared/spark.ts` uses `useMemo`" | Does NOT. Has `useQueries` + `useEffect` + `useRef` in the tracking hook, but `getInitializedSparkWallet()` is standalone | Same confusion |
| "`useOnProofStateChange()` is ~80 LOC" | Actually **39 LOC** — the `ProofStateSubscriptionManager` class is already extracted | LOC overstated 2x |
| "`send-store.ts` `proceedWithSend()` is ~120 LOC" | Actually **91 LOC** | Off by ~25% |
| "`send-store.ts` 80% extractable" | Actually **~95%** — only `import.meta.env.MODE` is non-portable | Understated |
| "Report missed 4 repositories" | `cashu-receive-quote-repository.ts`, `cashu-receive-swap-repository.ts`, `spark-receive-quote-repository.ts`, `cashu-send-swap-repository.ts` | Not cataloged |

### What the Report Missed Entirely

1. **`app/lib/cashu/index.ts` barrel is POISONED.** It re-exports `melt-quote-subscription.ts` which imports `useState`, `useEffect`, `useCallback` from React and `useMutation` from TanStack Query. Any `import { anything } from '~/lib/cashu'` pulls in React at module evaluation time. SDK must use direct file imports, not the barrel.

2. **`measureOperation` from `~/lib/performance` uses `@sentry/react-router`.** This import is inside `getInitializedCashuWallet()` and `getInitializedSparkWallet()` — called from service-layer code, not just hooks. The sentry import makes these functions non-portable.

3. **`import.meta.env.VITE_*` used in 12 files.** Vite-specific build mechanism. Key occurrences in business logic:
   - `shared/cashu.ts:161` — `VITE_CASHU_MINT_BLOCKLIST`
   - `database.client.ts:7` — `VITE_SUPABASE_URL`
   - `database.client.ts:29` — `VITE_SUPABASE_ANON_KEY`
   - `send-store.ts:33` — `import.meta.env.MODE`
   - `environment.ts:16` — `VITE_ENVIRONMENT`

4. **`database.client.ts:82` has unconditional `(window as any).agicashRealtime = ...`** at module scope — hard browser dep, no guard.

5. **`app/features/wallet/` directory completely missed.** Contains `wallet.tsx` (orchestrator), `task-processing.ts` (distributed lock + `TaskProcessor` component), `use-track-wallet-changes.ts` (realtime subscriptions). These are critical for background task processing and multi-tab coordination.

6. **Agicash's own `auth.ts` reads localStorage directly** (lines 48-49: `localStorage.getItem('access_token')`, `localStorage.getItem('refresh_token')`) — in addition to the Open Secret SDK's reads.

### Corrected Portability Assessment

**Truly portable as-is (zero changes needed):**
- `lib/money/` — Money class, safe arithmetic, formatting
- `lib/bolt11/` — Lightning invoice parsing
- `lib/ecies/` — ECIES encryption
- `lib/sha256.ts` — SHA-256
- `lib/json.ts` — Safe JSON parsing
- `lib/zod.ts` — Zod preprocessor
- `lib/utils.ts` — hex/uint8 conversions
- `lib/cashu/proof.ts`, `secret.ts`, `token.ts`, `utils.ts`, `error-codes.ts`, `types.ts`, `payment-request.ts`, `mint-validation.ts` — individual files (NOT the barrel)
- `lib/cashu/melt-quote-subscription-manager.ts`, `mint-quote-subscription-manager.ts` — subscription managers
- `lib/spark/` — Spark utils, signer, identity key
- `lib/exchange-rate/exchange-rate-service.ts` — rate fetching
- `lib/supabase/supabase-realtime-manager.ts` — realtime channels
- `features/shared/error.ts` — DomainError, ConcurrencyError, NotFoundError
- `features/send/proof-state-subscription-manager.ts` — proof state tracking
- All service classes (constructor bodies only — no React)
- All repository classes (constructor bodies only — no React)

**Portable with small fixes:**
- `lib/performance/sentry-performance.ts` — replace with injectable `measureOperation`
- `features/shared/cashu.ts` — `import.meta.env.VITE_CASHU_MINT_BLOCKLIST` and `measureOperation` import
- `features/shared/spark.ts` — `measureOperation` import
- `features/shared/encryption.ts` — standalone functions are portable; hooks are web-only
- `features/agicash-db/database.ts` — types file, portable

**Browser-only (stay in web app):**
- `features/agicash-db/database.client.ts` — `window`, `import.meta.env`
- `features/agicash-db/supabase-session.ts` — TanStack Query-based token getter
- All `*-hooks.ts` files (11 files)
- All `use*` factory functions in service/repo files
- `lib/cashu/melt-quote-subscription.ts` — React hooks
- `lib/read-clipboard.ts`
- `lib/performance/sentry-performance.ts` (current impl)
- `features/wallet/wallet.tsx`, `task-processing.ts` — React components
- `features/user/guest-account-storage.ts`, `oauth-login-session-storage.ts`

---

## Part 2: SDK Design

### Design Principles

1. **Extract, don't abstract.** Move existing classes/functions to a package. Don't redesign them.
2. **Preserve constructor injection.** Repos and services already accept deps — keep that pattern.
3. **Three interfaces, not twenty.** Only abstract at the three real boundaries: keys, database, caching.
4. **No framework dependency in the SDK.** Zero React, zero TanStack Query, zero Zustand.
5. **Web app stays unchanged.** The web app imports from `@agicash/sdk` and wraps with React hooks, exactly as it does today — just the `import` paths change.

### Package Structure

```
agicash/
├── packages/
│   └── sdk/
│       ├── package.json          # @agicash/sdk
│       ├── tsconfig.json
│       ├── biome.json
│       └── src/
│           ├── index.ts          # Public API barrel
│           ├── types.ts          # Shared types (Account, CashuAccount, SparkAccount, etc.)
│           ├── config.ts         # Runtime configuration (replaces import.meta.env)
│           │
│           ├── interfaces/       # The three boundary interfaces
│           │   ├── key-provider.ts
│           │   ├── database-client.ts
│           │   └── cache.ts
│           │
│           ├── lib/              # Moved from app/lib/ (portable modules)
│           │   ├── money/
│           │   ├── cashu/        # Individual files, NO barrel re-export of React hooks
│           │   ├── bolt11/
│           │   ├── spark/
│           │   ├── ecies/
│           │   ├── sha256.ts
│           │   ├── json.ts
│           │   ├── zod.ts
│           │   ├── utils.ts
│           │   ├── exchange-rate/
│           │   ├── supabase/     # SupabaseRealtimeManager
│           │   └── performance.ts  # Injectable measureOperation (no Sentry)
│           │
│           ├── features/         # Moved from app/features/ (services + repos + types only)
│           │   ├── shared/
│           │   │   ├── error.ts
│           │   │   ├── cashu.ts  # getCashuCryptography(), getInitializedCashuWallet(), etc.
│           │   │   │             # NO hooks, NO import.meta.env (uses config)
│           │   │   ├── spark.ts  # getInitializedSparkWallet() — NO hooks
│           │   │   ├── encryption.ts  # getEncryption() — NO hooks
│           │   │   ├── cryptography.ts  # derivePublicKey() — NO hooks
│           │   │   └── currencies.ts
│           │   ├── accounts/
│           │   │   ├── account.ts              # Types
│           │   │   ├── account-cryptography.ts  # Key derivation
│           │   │   ├── cashu-account.ts         # Cashu proof types
│           │   │   ├── account-service.ts       # Business logic
│           │   │   └── account-repository.ts    # DB access (class only, no use* hook)
│           │   ├── send/
│           │   │   ├── cashu-send-quote-service.ts
│           │   │   ├── cashu-send-quote-repository.ts
│           │   │   ├── cashu-send-swap-service.ts
│           │   │   ├── cashu-send-swap-repository.ts
│           │   │   ├── spark-send-quote-service.ts
│           │   │   ├── spark-send-quote-repository.ts
│           │   │   └── proof-state-subscription-manager.ts
│           │   ├── receive/
│           │   │   ├── cashu-receive-quote-service.ts
│           │   │   ├── cashu-receive-quote-repository.ts
│           │   │   ├── cashu-receive-swap-repository.ts
│           │   │   ├── receive-cashu-token-service.ts
│           │   │   ├── spark-receive-quote-service.ts
│           │   │   └── spark-receive-quote-repository.ts
│           │   ├── transactions/
│           │   │   └── transaction-repository.ts
│           │   ├── contacts/
│           │   │   └── contact-repository.ts
│           │   ├── user/
│           │   │   ├── user-service.ts
│           │   │   └── user-repository.ts  # ReadUserRepository + WriteUserRepository
│           │   └── wallet/
│           │       └── task-processing-lock-repository.ts
│           │
│           └── processors/       # Extracted state machines (from hooks → classes)
│               ├── cashu-send-quote-processor.ts
│               ├── cashu-send-swap-processor.ts
│               ├── cashu-receive-quote-processor.ts
│               ├── cashu-receive-swap-processor.ts
│               ├── spark-send-quote-processor.ts
│               ├── spark-receive-quote-processor.ts
│               └── task-processor-runner.ts
│
├── apps/
│   └── web/                      # Current app/ directory (renamed)
│       └── (existing structure, but now imports from @agicash/sdk)
│
├── cli/                          # Future CLI app
│   └── (Sprint 0-8 from original plan, but imports from @agicash/sdk)
│
├── package.json                  # Workspace root
└── turbo.json / bun workspace config
```

### The Three Boundary Interfaces

These are the **only** new abstractions. They match shapes that already exist in the codebase.

#### 1. `KeyProvider` — replaces `@opensecret/react` direct imports

```typescript
// packages/sdk/src/interfaces/key-provider.ts

/**
 * Provides cryptographic key material. In the web app, this delegates to
 * Open Secret. A CLI could use file-based key storage. Tests can use
 * deterministic keys.
 */
export type KeyProvider = {
  /** Get the raw private key bytes for a derivation path. */
  getPrivateKeyBytes(params: {
    seed_phrase_derivation_path?: string;
    private_key_derivation_path?: string;
  }): Promise<{ private_key: string }>;

  /** Get the public key for a derivation path. */
  getPublicKey(
    type: 'schnorr',
    params: { private_key_derivation_path: string },
  ): Promise<{ public_key: string }>;

  /** Get the mnemonic for a seed phrase derivation path. */
  getMnemonic(params: {
    seed_phrase_derivation_path: string;
  }): Promise<{ mnemonic: string }>;
};
```

This is a thin wrapper around the three Open Secret functions the SDK actually uses: `getPrivateKeyBytes`, `getPublicKey`, and `getPrivateKey` (renamed `getMnemonic` for clarity). The web app implements it by calling `@opensecret/react`. The CLI implements it by loading a mnemonic from `~/.agicash/`.

#### 2. `DatabaseClient` — the `AgicashDb` type already exists

```typescript
// packages/sdk/src/interfaces/database-client.ts

// This is the existing AgicashDb type — just re-exported from the SDK.
// No new abstraction needed. The web app creates it via database.client.ts,
// the CLI creates it via createClient() with file-based token.
export type { AgicashDb } from './database-types';
```

The `AgicashDb` type (from Supabase's generated types) is already the right abstraction. Repositories accept it via constructor. No changes needed.

#### 3. `Cache` — minimal interface replacing `QueryClient` dependency

```typescript
// packages/sdk/src/interfaces/cache.ts

/**
 * Minimal cache interface used by SDK internals (mint info, keysets,
 * seed material). Replaces direct QueryClient dependency.
 *
 * The web app implements this by wrapping QueryClient.fetchQuery().
 * The CLI implements this with a simple Map.
 */
export type Cache = {
  /** Fetch a cached value, or compute and cache it if missing/stale. */
  fetchQuery<T>(options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<T>;
    staleTime?: number;
  }): Promise<T>;

  /** Cancel any in-flight queries matching this key. */
  cancelQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
};
```

This is the subset of `QueryClient` that SDK code actually uses. `getInitializedCashuWallet()` calls `queryClient.fetchQuery()` and `queryClient.cancelQueries()` — that's it. The web app wraps its existing `QueryClient`. The CLI uses a `Map`-backed implementation.

### Configuration

Replace `import.meta.env.VITE_*` with runtime configuration:

```typescript
// packages/sdk/src/config.ts

export type AgicashConfig = {
  supabaseUrl: string;
  supabaseAnonKey: string;
  cashuMintBlocklist: string[];
  environment: 'local' | 'production' | 'alpha' | 'next' | 'preview';
  sparkNetwork: 'MAINNET' | 'REGTEST';
};

let _config: AgicashConfig | null = null;

export function configure(config: AgicashConfig): void {
  _config = config;
}

export function getConfig(): AgicashConfig {
  if (!_config) throw new Error('Call configure() before using the SDK');
  return _config;
}
```

The web app calls `configure()` in `entry.client.tsx` with values from `import.meta.env`. The CLI calls it from its entry point with values from `~/.agicash/config.json` or env vars.

### Performance Measurement Abstraction

Replace Sentry-coupled `measureOperation` with injectable implementation:

```typescript
// packages/sdk/src/lib/performance.ts

export type MeasureOperationFn = <T>(
  name: string,
  operation: () => Promise<T>,
  attributes?: Record<string, string | number | boolean>,
) => Promise<T>;

/** Default: just run the operation (no instrumentation). */
let _measureOperation: MeasureOperationFn = (_name, operation) => operation();

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

Web app calls `setMeasureOperation()` with Sentry wrapper in `entry.client.tsx`. CLI can use `console.time()` or skip instrumentation entirely.

---

## Part 3: Migration Strategy

### Guiding Principle: Move Files, Don't Rewrite Them

The SDK extraction is **primarily file moves + import path updates**. Service and repository classes don't need logic changes. The only code changes are:

1. Replace `import { ... } from '@opensecret/react'` with `KeyProvider` parameter
2. Replace `import.meta.env.VITE_*` with `getConfig()`
3. Replace `import { measureOperation } from '~/lib/performance'` with SDK's injectable version
4. Remove `use*` factory hooks from moved files (they stay in the web app)
5. Replace `QueryClient` parameters with `Cache` interface
6. Fix the cashu barrel import (use direct file imports)

### Phase 0: Workspace Setup (~1 session)

**Goal:** Bun/npm workspace with `packages/sdk/` and the existing app.

1. Add `"workspaces"` to root `package.json`
2. Create `packages/sdk/package.json` with `"name": "@agicash/sdk"`
3. Create `packages/sdk/tsconfig.json` extending root config
4. Create `packages/sdk/biome.json`
5. Verify `bun install` resolves workspace deps
6. Verify `bun run dev` still works for web app

**No code moves yet.** Just infrastructure.

### Phase 1: Move Pure Lib Modules (~1 session)

**Goal:** `packages/sdk/src/lib/` contains all portable utility modules.

Move these files (they have zero deps to change):

```
app/lib/money/         → packages/sdk/src/lib/money/
app/lib/bolt11/        → packages/sdk/src/lib/bolt11/
app/lib/ecies/         → packages/sdk/src/lib/ecies/
app/lib/sha256.ts      → packages/sdk/src/lib/sha256.ts
app/lib/json.ts        → packages/sdk/src/lib/json.ts
app/lib/zod.ts         → packages/sdk/src/lib/zod.ts
app/lib/utils.ts       → packages/sdk/src/lib/utils.ts
app/lib/spark/         → packages/sdk/src/lib/spark/
app/lib/exchange-rate/ → packages/sdk/src/lib/exchange-rate/
app/lib/supabase/      → packages/sdk/src/lib/supabase/
```

For `app/lib/cashu/`:
- Move individual files: `proof.ts`, `secret.ts`, `token.ts`, `utils.ts`, `error-codes.ts`, `types.ts`, `payment-request.ts`, `mint-validation.ts`, `melt-quote-subscription-manager.ts`, `mint-quote-subscription-manager.ts`
- **Do NOT move** `melt-quote-subscription.ts` (React hook) or the barrel `index.ts`
- Create a new clean barrel in the SDK that only re-exports portable files

Update `app/` to import from `@agicash/sdk/lib/...` instead of `~/lib/...`. This can be done with path aliases in tsconfig.

Create `packages/sdk/src/lib/performance.ts` with the injectable `measureOperation` (replacing the Sentry-coupled version).

**Validation:**
- `bun run fix:all` passes
- `bun run dev` works
- All existing tests pass

### Phase 2: Move Types + Error Classes (~1 session)

**Goal:** Shared types and error classes in the SDK.

```
app/features/shared/error.ts            → packages/sdk/src/features/shared/error.ts
app/features/shared/currencies.ts       → packages/sdk/src/features/shared/currencies.ts
app/features/accounts/account.ts        → packages/sdk/src/features/accounts/account.ts
app/features/accounts/cashu-account.ts  → packages/sdk/src/features/accounts/cashu-account.ts
app/features/accounts/account-cryptography.ts → packages/sdk/src/features/accounts/account-cryptography.ts
app/features/agicash-db/database.ts     → packages/sdk/src/features/agicash-db/database.ts  (types only)
app/features/agicash-db/json-models/    → packages/sdk/src/features/agicash-db/json-models/
```

**Validation:** Same as Phase 1.

### Phase 3: Define Interfaces + Config (~1 session)

**Goal:** The three boundary interfaces and runtime config exist. No consumers yet.

1. Create `packages/sdk/src/interfaces/key-provider.ts`
2. Create `packages/sdk/src/interfaces/cache.ts`
3. Create `packages/sdk/src/config.ts` (runtime config replacing `import.meta.env`)
4. Update web app's `entry.client.tsx` to call `configure()` with Vite env vars
5. Update web app to call `setMeasureOperation()` with Sentry wrapper

**Validation:** Web app works identically. SDK compiles.

### Phase 4: Move Shared Feature Modules (~2 sessions)

**Goal:** `encryption.ts`, `cashu.ts`, `spark.ts`, `cryptography.ts` in the SDK, accepting `KeyProvider` + `Cache` instead of importing `@opensecret/react` + `QueryClient`.

This is the **most impactful phase**. For each file:

1. Move the file to SDK
2. Replace `import { getPrivateKeyBytes, getPublicKey } from '@opensecret/react'` with `KeyProvider` parameter
3. Replace `QueryClient` parameter with `Cache` interface
4. Replace `import.meta.env.VITE_*` with `getConfig()`
5. Replace `measureOperation` import with SDK version
6. **Remove** `use*` hooks and `queryOptions()` definitions — these stay in the web app

Example — `cashu.ts` becomes:

```typescript
// packages/sdk/src/features/shared/cashu.ts
import type { KeyProvider } from '../../interfaces/key-provider';
import type { Cache } from '../../interfaces/cache';
import { getConfig } from '../../config';

export function getCashuCryptography(
  keyProvider: KeyProvider,
  cache: Cache,
): CashuCryptography {
  return {
    getSeed: () => cache.fetchQuery({
      queryKey: ['cashu-seed'],
      queryFn: async () => {
        const response = await keyProvider.getMnemonic({ seed_phrase_derivation_path: seedDerivationPath });
        return mnemonicToSeedSync(response.mnemonic);
      },
      staleTime: Number.POSITIVE_INFINITY,
    }),
    // ... same pattern for getXpub, getPrivateKey
  };
}

export async function getInitializedCashuWallet(
  cache: Cache,
  mintUrl: string,
  currency: Currency,
  bip39seed?: Uint8Array,
): Promise<{ wallet: ExtendedCashuWallet; isOnline: boolean }> {
  // Same logic, but uses `cache.fetchQuery()` instead of `queryClient.fetchQuery()`
  // and `measureOperation` from SDK's injectable version
}
```

The **web app** keeps thin wrapper files that provide the React integration:

```typescript
// app/features/shared/cashu.ts (stays in web app, much smaller now)
import { getCashuCryptography, getInitializedCashuWallet, ... } from '@agicash/sdk';
import { queryOptions, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import { getPrivateKeyBytes, getPublicKey, getPrivateKey as getMnemonic } from '@opensecret/react';

// Web-specific KeyProvider implementation
const webKeyProvider: KeyProvider = { getPrivateKeyBytes, getPublicKey, getMnemonic };

// Web-specific Cache implementation (wraps QueryClient)
function queryClientCache(qc: QueryClient): Cache {
  return {
    fetchQuery: (opts) => qc.fetchQuery(opts),
    cancelQueries: (params) => qc.cancelQueries(params),
  };
}

// React hooks that stay in the web app
export function useCashuCryptography(): CashuCryptography {
  const qc = useQueryClient();
  return useMemo(() => getCashuCryptography(webKeyProvider, queryClientCache(qc)), [qc]);
}

// queryOptions that reference SDK functions
export const mintInfoQueryOptions = (mintUrl: string) =>
  queryOptions({ queryKey: ['mint-info', mintUrl], queryFn: ... });
```

**Validation:**
- All TanStack Query hooks still work
- Encryption round-trips correctly
- Cashu wallet initializes against real mint
- Spark wallet initializes

### Phase 5: Move Repositories + Services (~2 sessions)

**Goal:** All repos and services in the SDK.

For each repository:
1. Move the class definition to SDK
2. Remove the `use*` factory hook (stays in web app)
3. Replace `agicashDbClient` singleton import with `AgicashDb` constructor parameter (already done in most repos)
4. Replace `Encryption` import with SDK's version

For each service:
1. Move the class/function
2. Update imports to SDK paths
3. Replace `measureOperation` import

The web app keeps `use*Repository()` hooks that construct the SDK classes:

```typescript
// app/features/accounts/account-hooks.ts (stays in web app)
import { AccountRepository } from '@agicash/sdk';

export function useAccountRepository() {
  const db = useAgicashDb();
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  // ... construct SDK class with web-specific deps
  return new AccountRepository(db, encryption, ...);
}
```

**Validation:** All mutations and queries work. Full `bun run fix:all` passes.

### Phase 6: Extract State Machine Processors (~3 sessions)

**Goal:** Background task processors exist as SDK classes (not React hooks).

This is the **hardest extraction.** The current hook-based processors (`useProcessCashuSendQuoteTasks`, etc.) deeply interleave:
- State machine logic (portable)
- TanStack Query cache invalidation (web-specific)
- React effect lifecycle (web-specific)

Strategy: Extract the state transition logic into processor classes that accept callbacks for side effects:

```typescript
// packages/sdk/src/processors/cashu-send-quote-processor.ts
export class CashuSendQuoteProcessor {
  constructor(
    private sendQuoteRepo: CashuSendQuoteRepository,
    private sendSwapService: CashuSendSwapService,
    private cache: Cache,
    private onQuoteResolved?: (quoteId: string) => void,  // Web: invalidate cache
  ) {}

  async processUnresolved(): Promise<void> {
    const unresolved = await this.sendQuoteRepo.getUnresolved();
    for (const quote of unresolved) {
      await this.processQuote(quote);
    }
  }

  private async processQuote(quote: CashuSendQuote): Promise<void> {
    // State machine logic extracted from hook
  }
}
```

The web app wraps these in React hooks that handle cache invalidation and render cycles. The CLI calls `processUnresolved()` directly.

**Validation:** Background processing works for both web and (future) CLI.

### Phase 7: SDK Public API + Tests (~1 session)

**Goal:** Clean `index.ts` barrel, JSDoc on public types, basic integration tests.

1. Create `packages/sdk/src/index.ts` with organized exports
2. Add JSDoc to `KeyProvider`, `Cache`, `AgicashConfig` interfaces
3. Write integration tests that use in-memory implementations of the interfaces
4. Verify `bun test packages/sdk/` passes

---

## Part 4: CLI Plan (Post-SDK)

Once the SDK exists, the CLI becomes much simpler. Instead of importing from `app/` and working around React, it imports from `@agicash/sdk` and provides CLI-specific implementations of the three interfaces.

### CLI Architecture (simplified)

```
cli/
├── src/
│   ├── index.ts                 # Entry point (Commander.js)
│   ├── config.ts                # Load config from ~/.agicash/ + env vars
│   ├── providers/
│   │   ├── key-provider.ts      # KeyProvider backed by Open Secret SDK
│   │   ├── database.ts          # AgicashDb via createClient() with file token
│   │   └── cache.ts             # Cache backed by simple Map
│   ├── auth/
│   │   ├── auth-service.ts      # signIn/signUp/signOut orchestration
│   │   ├── session-manager.ts   # Token lifecycle (persist, refresh, expiry)
│   │   └── file-storage.ts      # localStorage replacement for Open Secret
│   ├── commands/
│   │   ├── auth.ts              # login, logout, signup, whoami
│   │   ├── accounts.ts          # list, create, set-default
│   │   ├── balance.ts           # balance [--account]
│   │   ├── send.ts              # send <destination> <amount>
│   │   ├── receive.ts           # receive <amount> [--type cashu|lightning|spark]
│   │   └── transactions.ts      # history, status <id>
│   └── wallet-context.ts        # Build WalletContext from SDK components
├── package.json
└── tsconfig.json
```

### CLI `WalletContext` (from SDK)

```typescript
import {
  type KeyProvider, type Cache, type AgicashDb,
  configure, getCashuCryptography, getEncryption,
  getInitializedCashuWallet, getInitializedSparkWallet,
  AccountRepository, WriteUserRepository,
  CashuSendQuoteService, CashuSendQuoteRepository,
  // ... all SDK exports
} from '@agicash/sdk';

export async function buildWalletContext(
  keyProvider: KeyProvider,
  db: AgicashDb,
  cache: Cache,
): Promise<WalletContext> {
  const encryption = await getEncryption(keyProvider);
  const cashuCryptography = getCashuCryptography(keyProvider, cache);
  const accountRepo = new AccountRepository(db, encryption, cache, ...);
  // ... wire everything up
  return { db, encryption, accountRepo, ... };
}
```

### CLI Sprint Plan (from original plan, simplified with SDK)

The original 8-sprint plan still applies, but with reduced effort because the SDK handles the heavy lifting:

| Sprint | Original Estimate | With SDK | What Changes |
|--------|------------------|----------|-------------|
| 0 — Scaffolding | 30 min | 30 min | Same |
| 1 — Open Secret Storage | 1-2h | 1-2h | Same (fork work is independent) |
| 2 — Auth + Supabase | 1-2h | 1h | Less wiring — SDK provides types |
| 3 — Service Wiring | 2-3h | **1h** | Just implement 3 interfaces |
| 4 — Read-Only Commands | 1h | 1h | Same |
| 5 — Send Flow | 2-3h | 2-3h | Same (payment testing is the bottleneck) |
| 6 — Receive Flow | 2-3h | 2-3h | Same |
| 7 — Background Processors | 3-4h | **1-2h** | SDK has processor classes, just call them |
| 8 — Polish | 2-3h | 2-3h | Same |

**Total CLI: ~12-16h** (down from ~15-21h), with the SDK extraction being ~10-12h upfront.

---

## Part 5: Effort Summary

| Phase | Work | Estimate | Risk |
|-------|------|----------|------|
| **Phase 0** — Workspace setup | package.json, tsconfig, biome | 1 session | Low |
| **Phase 1** — Move pure lib | File moves + import updates | 1 session | Low |
| **Phase 2** — Move types/errors | File moves + import updates | 1 session | Low |
| **Phase 3** — Interfaces + config | 3 new files + configure() call | 1 session | Low |
| **Phase 4** — Shared feature modules | KeyProvider/Cache refactor of cashu.ts, spark.ts, encryption.ts | 2 sessions | **Medium** — wallet init must still work |
| **Phase 5** — Repos + services | Move classes, keep hooks in web | 2 sessions | Low-Medium |
| **Phase 6** — State machines | Extract from hooks → classes | 3 sessions | **High** — complex state logic |
| **Phase 7** — Public API + tests | Barrel, docs, tests | 1 session | Low |
| **SDK Total** | | **~12 sessions** | |
| **CLI Total** (post-SDK) | | **~12-16 sessions** | |

---

## Part 6: Key Risks

| Risk | Mitigation |
|------|-----------|
| **Workspace breaks Vite dev server** | Phase 0 validates `bun run dev` works before any code moves |
| **Import path mass-rename introduces bugs** | Each phase ends with `bun run fix:all` + existing tests |
| **`getInitializedCashuWallet` breaks with Cache interface** | Cache is a strict subset of QueryClient — behavioral parity guaranteed |
| **Spark SDK has browser assumptions** | Already verified: SDK is pure JS/WASM, works in Node. Test in Phase 4 |
| **State machine extraction misses edge cases** | Phase 6 runs existing web tests. Add SDK-level tests for each processor |
| **Open Secret fork changes (~44 storage calls)** | Separate PR in fork repo. Web app defaults to window.localStorage — backward compatible |

---

## Part 7: What We're NOT Doing

- **Not creating a monorepo build tool.** Bun workspaces are sufficient. No Turborepo/Nx.
- **Not abstracting the database layer.** Supabase's generated types are the interface. Repos already accept `AgicashDb`.
- **Not rewriting services.** Move them, fix imports, done.
- **Not adding new features.** SDK extraction is purely structural.
- **Not changing the web app's UX.** Hooks, components, routes, stores — all stay in the web app.
- **Not over-testing.** SDK tests focus on interface contracts. Web app's existing tests validate behavior.

---

## Appendix A: Files That Need the Cashu Barrel Fix

The poisoned `app/lib/cashu/index.ts` barrel re-exports `melt-quote-subscription.ts` (React hooks). These files import from the barrel and must be updated to use direct imports:

The SDK's `lib/cashu/index.ts` will be a clean barrel that only exports portable modules. The web app can keep its own barrel that also includes the React-specific `melt-quote-subscription.ts`.

## Appendix B: `import.meta.env` Occurrences Requiring Migration

| File | Env Var | SDK Migration |
|------|---------|---------------|
| `features/shared/cashu.ts:161` | `VITE_CASHU_MINT_BLOCKLIST` | `getConfig().cashuMintBlocklist` |
| `features/agicash-db/database.client.ts:7,29` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Stays in web app (not in SDK) |
| `features/send/send-store.ts:33` | `import.meta.env.MODE` | Stays in web app (store not in SDK) |
| `environment.ts:16,48` | `VITE_ENVIRONMENT`, `VITE_LOCAL_DEV` | `getConfig().environment` |
| `lib/feature-flags.ts` | Various | Stays in web app |
| `entry.client.tsx` | Various | Stays in web app (calls `configure()`) |
| `instrument.server.ts` | Various | Stays in web app |
| `features/user/user-hooks.tsx` | Various | Stays in web app |
| `features/send/send-input.tsx` | Various | Stays in web app |
| `hooks/use-effect-no-strict-mode.ts` | Various | Stays in web app |
| `routes/api.logs.ts` | Various | Stays in web app |

Most `import.meta.env` usages are in web-only files. Only 2-3 occurrences need migration to `getConfig()`.
