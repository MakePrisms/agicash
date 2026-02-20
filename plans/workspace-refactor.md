# Agicash Workspace Refactor Plan

> Restructure the codebase into a Bun workspace monorepo: `@agicash/core` (environment-agnostic) + web app (current app).

## Goal

Extract all portable business logic, types, and utilities into `packages/core/` — a package with **zero environment-specific dependencies** (no `window`, `document`, `navigator`, `localStorage`, `import.meta.env`, React, TanStack Query, Sentry). The web app imports from `@agicash/core` and provides the React/browser glue. End state: app works exactly like today.

## Principles

1. **Move files, don't rewrite them.** The vast majority of changes are file moves + import path updates.
2. **Each step is independently verifiable.** After every step: `bun run fix:all` passes, `bun run dev` works.
3. **Split mixed files.** Files containing both pure logic and React hooks get split: pure code → core, hooks → web.
4. **No new abstractions except at real boundaries.** Only three small interfaces: `KeyProvider`, `Cache`, and runtime `Config`. Everything else keeps its existing shape.
5. **Web app stays at root.** Moving to `apps/web/` is a separate, optional future step. For now, root IS the web app, and `packages/core/` is the only new directory.

## End-State Directory Structure

```
agicash/
├── packages/
│   └── core/                              # @agicash/core — environment-agnostic
│       ├── package.json
│       ├── tsconfig.json
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
│           ├── db/                        # Database types (from features/agicash-db/)
│           │   ├── database.ts            # AgicashDb type, isCashuAccount, isSparkAccount
│           │   ├── database-generated.types.ts  # Moved from supabase/database.types.ts
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
├── app/                                    # Web app (stays at root, but thinner)
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
│   │   │   ├── account-icons.tsx
│   │   │   ├── account-selector.tsx
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
│   │   │   ├── index.ts                   # Web barrel (re-exports core + adds melt-quote-subscription)
│   │   │   ├── melt-quote-subscription.ts # React hooks
│   │   │   └── animated-qr-code/          # React hooks
│   │   ├── supabase/
│   │   │   ├── index.ts                   # Re-exports core + adds hooks
│   │   │   └── supabase-realtime-hooks.ts # React hooks
│   │   ├── performance/
│   │   │   └── sentry-performance.ts      # Sentry implementation (registers with core)
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
│   └── database.types.ts                  # Still generated here, ALSO copied to core
├── package.json                            # Root = web app + workspace config
├── tsconfig.json
├── vite.config.ts
├── react-router.config.ts
├── biome.jsonc
└── ...other root config files
```

## Package Configuration

### Root `package.json` changes

```jsonc
{
  "name": "agicash",
  // ... existing fields ...
  "workspaces": ["packages/*"],
  "dependencies": {
    "@agicash/core": "workspace:*",
    // ... existing deps (minus those that move to core exclusively) ...
  }
}
```

Dependencies that are used by BOTH core and web stay in both. Dependencies used ONLY by core move to core's `package.json`. In practice, most deps stay in root because the web app still imports them directly in hooks/components.

### `packages/core/package.json`

```jsonc
{
  "name": "@agicash/core",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "dependencies": {
    // Portable deps — only those imported by core source files
    "@buildonspark/spark-sdk": "0.6.3",
    "@cashu/cashu-ts": "2.6.0",
    "@cashu/crypto": "0.3.4",
    "@noble/ciphers": "1.3.0",
    "@noble/curves": "1.9.7",
    "@noble/hashes": "1.8.0",
    "@scure/bip32": "1.7.0",
    "@scure/bip39": "1.6.0",
    "@stablelib/base64": "2.0.1",  // NOTE: currently in devDeps in root, but used at runtime
    "@supabase/supabase-js": "2.95.2",
    "big.js": "7.0.1",
    "jwt-decode": "4.0.0",
    "ky": "1.14.3",
    "light-bolt11-decoder": "3.2.0",
    "zod": "4.3.6"
  },
  "devDependencies": {
    "@types/big.js": "6.2.2",
    "type-fest": "5.4.3",
    "typescript": "5.9.3"
  }
}
```

### `packages/core/tsconfig.json`

```jsonc
{
  "compilerOptions": {
    "lib": ["ES2022"],
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true,
    "composite": true,
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
```

Key differences from root tsconfig:
- **No `"DOM"` in lib** — this enforces no browser API usage at compile time
- **No `"jsx"` setting** — no JSX in core
- **No `"types": ["vite/client"]`** — no `import.meta.env`
- `composite: true` for project references (optional, helps IDE perf)

### Root `tsconfig.json` update

Add project reference to core:

```jsonc
{
  // ... existing config ...
  "references": [
    { "path": "./packages/core" }
  ]
}
```

### `packages/core/biome.json`

```jsonc
{
  "extends": ["../../biome.jsonc"]
}
```

## Detailed Step-by-Step Migration

Each step ends with verification: `bun run fix:all` + `bun run dev` + manual smoke test.

---

### Step 1: Workspace Infrastructure

**Goal:** Bun workspace set up, core package exists but is empty, web app unchanged.

1. Add `"workspaces": ["packages/*"]` to root `package.json`
2. Create `packages/core/package.json` (minimal — name, type, exports, empty deps)
3. Create `packages/core/tsconfig.json` (no DOM lib)
4. Create `packages/core/biome.json` (extends root)
5. Create `packages/core/src/index.ts` (empty barrel: `// @agicash/core`)
6. Add `"@agicash/core": "workspace:*"` to root `package.json` dependencies
7. Run `bun install` — verifies workspace symlinks created
8. Run `bun run fix:all` — passes
9. Run `bun run dev` — web app works

**No code moves. Pure infrastructure.**

---

### Step 2: Core Abstractions

**Goal:** Create the three small abstraction files that don't exist yet. Wire them into the web app so they're ready for moved files to use.

#### 2a: Runtime Config

Create `packages/core/src/config.ts`:

```typescript
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
  if (!_config) throw new Error('Call configure() before using @agicash/core');
  return _config;
}
```

#### 2b: Injectable Performance Measurement

Create `packages/core/src/performance.ts`:

```typescript
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

#### 2c: KeyProvider Interface

Create `packages/core/src/interfaces/key-provider.ts`:

```typescript
/**
 * Provides cryptographic key material.
 * Web: delegates to @opensecret/react. CLI: file-based key storage.
 */
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

#### 2d: Cache Interface

Create `packages/core/src/interfaces/cache.ts`:

```typescript
/**
 * Minimal cache interface. Replaces QueryClient dependency in core.
 * Web: wraps QueryClient. CLI: Map-backed.
 */
export type Cache = {
  fetchQuery<T>(options: {
    queryKey: readonly unknown[];
    queryFn: () => Promise<T>;
    staleTime?: number;
  }): Promise<T>;

  cancelQueries?(params: { queryKey: readonly unknown[] }): Promise<void>;
};
```

#### 2e: Wire into Web App

Update `app/entry.client.tsx` to call `configure()` and `setMeasureOperation()`:

```typescript
import { configure } from '@agicash/core/config';
import { setMeasureOperation } from '@agicash/core/performance';
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

**Verify:** `bun run fix:all` + `bun run dev`.

---

### Step 3: Move Pure Lib Modules

**Goal:** All portable utility modules live in `packages/core/src/lib/`.

These files require **zero logic changes** — just move and update internal imports between moved files. The only work is updating consumer imports in the web app.

#### 3a: Pure utilities (zero deps on other app code)

| Source | Destination |
|--------|-------------|
| `app/lib/money/` (entire dir) | `packages/core/src/lib/money/` |
| `app/lib/bolt11/` | `packages/core/src/lib/bolt11/` |
| `app/lib/ecies/` | `packages/core/src/lib/ecies/` |
| `app/lib/sha256.ts` | `packages/core/src/lib/sha256.ts` |
| `app/lib/json.ts` | `packages/core/src/lib/json.ts` |
| `app/lib/zod.ts` | `packages/core/src/lib/zod.ts` |
| `app/lib/utils.ts` | `packages/core/src/lib/utils.ts` |
| `app/lib/timeout.ts` | `packages/core/src/lib/timeout.ts` |
| `app/lib/delay.ts` | `packages/core/src/lib/delay.ts` |
| `app/lib/type-utils.ts` | `packages/core/src/lib/type-utils.ts` |
| `app/lib/xchacha20poly1305.ts` | `packages/core/src/lib/xchacha20poly1305.ts` |
| `app/lib/locale/` | `packages/core/src/lib/locale/` |
| `app/lib/spark/` (all files) | `packages/core/src/lib/spark/` |
| `app/lib/exchange-rate/` (entire dir) | `packages/core/src/lib/exchange-rate/` |
| `app/lib/lnurl/` | `packages/core/src/lib/lnurl/` |

**Minor fix needed:** `app/lib/money/money.ts` has `window.devtoolsFormatters` in `registerDevToolsFormatter()` static method. It already has a `typeof window === 'undefined'` guard — verify it's present before moving, no change needed if so.

#### 3b: Cashu lib (individual files, NOT the barrel)

| Source | Destination |
|--------|-------------|
| `app/lib/cashu/proof.ts` | `packages/core/src/lib/cashu/proof.ts` |
| `app/lib/cashu/secret.ts` | `packages/core/src/lib/cashu/secret.ts` |
| `app/lib/cashu/token.ts` | `packages/core/src/lib/cashu/token.ts` |
| `app/lib/cashu/utils.ts` | `packages/core/src/lib/cashu/utils.ts` |
| `app/lib/cashu/error-codes.ts` | `packages/core/src/lib/cashu/error-codes.ts` |
| `app/lib/cashu/types.ts` | `packages/core/src/lib/cashu/types.ts` |
| `app/lib/cashu/payment-request.ts` | `packages/core/src/lib/cashu/payment-request.ts` |
| `app/lib/cashu/mint-validation.ts` | `packages/core/src/lib/cashu/mint-validation.ts` |
| `app/lib/cashu/melt-quote-subscription-manager.ts` | `packages/core/src/lib/cashu/melt-quote-subscription-manager.ts` |
| `app/lib/cashu/mint-quote-subscription-manager.ts` | `packages/core/src/lib/cashu/mint-quote-subscription-manager.ts` |

**DO NOT move:** `melt-quote-subscription.ts` (React hooks), `animated-qr-code/` (React hooks).

Create clean barrel `packages/core/src/lib/cashu/index.ts` — re-exports only the portable files above.

Update `app/lib/cashu/index.ts` to re-export from `@agicash/core/lib/cashu` plus the web-only files:
```typescript
export * from '@agicash/core/lib/cashu';
export * from './melt-quote-subscription';
export * from './melt-quote-subscription-manager'; // now comes from core via the re-export above
```

#### 3c: Supabase realtime (manager + channel, not hooks)

| Source | Destination |
|--------|-------------|
| `app/lib/supabase/supabase-realtime-manager.ts` | `packages/core/src/lib/supabase/supabase-realtime-manager.ts` |
| `app/lib/supabase/supabase-realtime-channel.ts` | `packages/core/src/lib/supabase/supabase-realtime-channel.ts` |
| `app/lib/supabase/supabase-realtime-channel-builder.ts` | `packages/core/src/lib/supabase/supabase-realtime-channel-builder.ts` |

**DO NOT move:** `supabase-realtime-hooks.ts` (React hooks using `window`, `document`, `navigator`).

Update `app/lib/supabase/index.ts` to re-export from core + web hooks.

#### 3d: Update all web app imports

Every file that imported from `~/lib/money`, `~/lib/cashu`, etc. now imports from `@agicash/core/lib/money`, `@agicash/core/lib/cashu`, etc.

For files that import through the cashu barrel (`~/lib/cashu`), they can keep importing from `~/lib/cashu` since we updated that barrel to re-export from core. Only files that need ONLY portable cashu code should switch to `@agicash/core/lib/cashu`.

**Verify:** `bun run fix:all` + `bun run dev`. All features still work.

---

### Step 4: Move Types, Error Classes, Database Types

**Goal:** All shared types and type-only files live in core.

#### 4a: Shared types and errors

| Source | Destination |
|--------|-------------|
| `app/features/shared/error.ts` | `packages/core/src/features/shared/error.ts` |
| `app/features/shared/currencies.ts` | `packages/core/src/features/shared/currencies.ts` |

#### 4b: Database types

| Source | Destination |
|--------|-------------|
| `app/features/agicash-db/database.ts` | `packages/core/src/db/database.ts` |
| `app/features/agicash-db/json-models/` (entire dir) | `packages/core/src/db/json-models/` |

Update `database.ts` to import generated types from local path:
```typescript
// Before:
import type { Database as DatabaseGenerated } from 'supabase/database.types';

// After:
import type { Database as DatabaseGenerated } from './database-generated.types';
```

For `supabase/database.types.ts`: keep it where it is for Supabase CLI. Update `db:generate-types` script to ALSO copy to `packages/core/src/db/database-generated.types.ts`:
```jsonc
"db:generate-types": "supabase gen types typescript --local --schema wallet > supabase/database.types.ts && cp supabase/database.types.ts packages/core/src/db/database-generated.types.ts"
```

#### 4c: Account types

| Source | Destination |
|--------|-------------|
| `app/features/accounts/account.ts` | `packages/core/src/features/accounts/account.ts` |
| `app/features/accounts/cashu-account.ts` | `packages/core/src/features/accounts/cashu-account.ts` |
| `app/features/accounts/account-cryptography.ts` | `packages/core/src/features/accounts/account-cryptography.ts` |

#### 4d: Feature entity types

| Source | Destination |
|--------|-------------|
| `app/features/send/cashu-send-quote.ts` | `packages/core/src/features/send/cashu-send-quote.ts` |
| `app/features/send/cashu-send-swap.ts` | `packages/core/src/features/send/cashu-send-swap.ts` |
| `app/features/send/spark-send-quote.ts` | `packages/core/src/features/send/spark-send-quote.ts` |
| `app/features/receive/cashu-receive-quote.ts` | `packages/core/src/features/receive/cashu-receive-quote.ts` |
| `app/features/receive/cashu-token-melt-data.ts` | `packages/core/src/features/receive/cashu-token-melt-data.ts` |
| `app/features/receive/receive-cashu-token-models.ts` | `packages/core/src/features/receive/receive-cashu-token-models.ts` |
| `app/features/receive/spark-receive-quote.ts` | `packages/core/src/features/receive/spark-receive-quote.ts` |
| `app/features/transactions/transaction.ts` | `packages/core/src/features/transactions/transaction.ts` |
| `app/features/transactions/transaction-enums.ts` | `packages/core/src/features/transactions/transaction-enums.ts` |
| `app/features/contacts/contact.ts` | `packages/core/src/features/contacts/contact.ts` |
| `app/features/user/user.ts` | `packages/core/src/features/user/user.ts` |

#### 4e: Transaction detail schemas

All files in this directory are pure Zod schemas with no React/browser deps:

| Source | Destination |
|--------|-------------|
| `app/features/transactions/transaction-details/transaction-details-types.ts` | `packages/core/src/features/transactions/transaction-details/transaction-details-types.ts` |
| `app/features/transactions/transaction-details/transaction-details-parser.ts` | `packages/core/src/features/transactions/transaction-details/transaction-details-parser.ts` |
| `app/features/transactions/transaction-details/cashu-lightning-receive-transaction-details.ts` | `packages/core/src/features/transactions/transaction-details/cashu-lightning-receive-transaction-details.ts` |
| `app/features/transactions/transaction-details/cashu-lightning-send-transaction-details.ts` | `packages/core/src/features/transactions/transaction-details/cashu-lightning-send-transaction-details.ts` |
| `app/features/transactions/transaction-details/cashu-token-receive-transaction-details.ts` | `packages/core/src/features/transactions/transaction-details/cashu-token-receive-transaction-details.ts` |
| `app/features/transactions/transaction-details/cashu-token-send-transaction-details.ts` | `packages/core/src/features/transactions/transaction-details/cashu-token-send-transaction-details.ts` |
| `app/features/transactions/transaction-details/spark-lightning-receive-transaction-details.ts` | `packages/core/src/features/transactions/transaction-details/spark-lightning-receive-transaction-details.ts` |
| `app/features/transactions/transaction-details/spark-lightning-send-transaction-details.ts` | `packages/core/src/features/transactions/transaction-details/spark-lightning-send-transaction-details.ts` |

#### 4f: Theme types and constants

Pure constants and type definitions, no React deps:

| Source | Destination |
|--------|-------------|
| `app/features/theme/theme.types.ts` | `packages/core/src/features/theme/theme.types.ts` |
| `app/features/theme/theme.constants.ts` | `packages/core/src/features/theme/theme.constants.ts` |
| `app/features/theme/colors.ts` | `packages/core/src/features/theme/colors.ts` |

**DO NOT move:** `app/features/theme/index.ts` (re-exports React components/hooks).

**Verify:** Update all web app imports → `bun run fix:all` + `bun run dev`.

---

### Step 5: Split Mixed Files

**Goal:** Extract portable logic from files that mix pure functions with React hooks/queryOptions.

Each file gets split into:
- **Core version** — pure functions, types, factories that accept interfaces
- **Web version** — queryOptions, `use*` hooks, OpenSecret calls, imports from core

#### 5a: `encryption.ts` split

**Core** (`packages/core/src/features/shared/encryption.ts`):
- `Encryption` type
- `getEncryption(privateKey, publicKeyHex)` factory
- `encryptToPublicKey()`, `encryptBatchToPublicKey()`
- `decryptWithPrivateKey()`, `decryptBatchWithPrivateKey()`
- `preprocessData()`, `serializeData()`, `deserializeData()`

These are already pure — they take `Uint8Array`/`string` params and return results. Zero changes to function signatures or logic. Just move.

**Web** (`app/features/shared/encryption.ts`) becomes:
```typescript
import {
  type Encryption,
  getEncryption,
  encryptToPublicKey,
  // ... other re-exports consumers may need
} from '@agicash/core/features/shared/encryption';
import { getPrivateKeyBytes, getPublicKey } from '@opensecret/react';
import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { hexToUint8Array } from '@agicash/core/lib/utils';

// Re-export core types/functions for convenience
export { type Encryption, getEncryption, encryptToPublicKey, /* ... */ } from '@agicash/core/features/shared/encryption';

const encryptionKeyDerivationPath = `m/10111099'/0'`;

export const encryptionPrivateKeyQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption-private-key'],
    queryFn: () => getPrivateKeyBytes({ private_key_derivation_path: encryptionKeyDerivationPath })
      .then((response) => hexToUint8Array(response.private_key)),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useEncryptionPrivateKey = () => {
  const { data } = useSuspenseQuery(encryptionPrivateKeyQueryOptions());
  return data;
};

export const encryptionPublicKeyQueryOptions = () =>
  queryOptions({
    queryKey: ['encryption-public-key'],
    queryFn: () => getPublicKey('schnorr', { private_key_derivation_path: encryptionKeyDerivationPath })
      .then((response) => response.public_key),
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useEncryptionPublicKeyHex = () => {
  const { data } = useSuspenseQuery(encryptionPublicKeyQueryOptions());
  return data;
};

export const useEncryption = (): Encryption => {
  const privateKey = useEncryptionPrivateKey();
  const publicKeyHex = useEncryptionPublicKeyHex();
  return useMemo(() => getEncryption(privateKey, publicKeyHex), [privateKey, publicKeyHex]);
};
```

The derivation path constant (`encryptionKeyDerivationPath`) stays in web because it's used by the queryOptions that call OpenSecret. If other consumers need this derivation path, it can be moved to core later.

#### 5b: `cryptography.ts` split

**Core** (`packages/core/src/features/shared/cryptography.ts`):
```typescript
import { HDKey } from '@scure/bip32';

export const derivePublicKey = (xpub: string, derivationPath: string) => {
  // ... existing logic, unchanged
};
```

**Web** (`app/features/shared/cryptography.ts`):
```typescript
export { derivePublicKey } from '@agicash/core/features/shared/cryptography';
import { getPrivateKey, getPrivateKeyBytes, getPublicKey, signMessage } from '@opensecret/react';
import { useMemo } from 'react';

export const useCryptography = () => {
  return useMemo(() => ({
    getMnemonic: getPrivateKey,
    signMessage,
    getPublicKey,
    getPrivateKeyBytes,
  }), []);
};
```

#### 5c: `cashu.ts` split

This is the most complex split. The current file has:
- Pure: `CashuCryptography` type, `getCashuCryptography()`, `getInitializedCashuWallet()`, `tokenToMoney()`, `getTokenHash()`, constants
- Web: `seedQueryOptions()`, `xpubQueryOptions()`, `privateKeyQueryOptions()`, `mintInfoQueryOptions()`, `allMintKeysetsQueryOptions()`, `mintKeysQueryOptions()`, `isTestMintQueryOptions()`, `useCashuCryptography()`

**Core** (`packages/core/src/features/shared/cashu.ts`):
- Move all pure functions and types
- `getCashuCryptography()` signature changes from `(queryClient: QueryClient)` to `(keyProvider: KeyProvider, cache: Cache)`:
  - `getSeed()` calls `keyProvider.getMnemonic()` + `cache.fetchQuery()` instead of `queryClient.fetchQuery(seedQueryOptions())`
  - `getXpub()` calls `keyProvider.getPrivateKeyBytes()` + `cache.fetchQuery()` instead of `queryClient.fetchQuery(xpubQueryOptions())`
  - `getPrivateKey()` calls `keyProvider.getPrivateKeyBytes()` + `cache.fetchQuery()` instead of `queryClient.fetchQuery(privateKeyQueryOptions())`
- `getInitializedCashuWallet()` uses `cache` instead of `queryClient`, and `getConfig().cashuMintBlocklist` instead of `import.meta.env.VITE_CASHU_MINT_BLOCKLIST`
- Uses `measureOperation` from `@agicash/core/performance` instead of `~/lib/performance`

**Web** (`app/features/shared/cashu.ts`):
- All `queryOptions()` definitions stay
- `useCashuCryptography()` creates a `KeyProvider` from `@opensecret/react` functions and wraps `QueryClient` as `Cache`
- Re-exports core types/functions for convenience

#### 5d: `spark.ts` split

**Core** (`packages/core/src/features/shared/spark.ts`):
- `getInitializedSparkWallet(cache, mnemonic, network)` — uses `cache` instead of `queryClient`, uses `measureOperation` from core
- `getLeafDenominations()`

**Web** (`app/features/shared/spark.ts`):
- All `queryOptions()` definitions
- `useTrackAndUpdateSparkAccountBalances()` — the heavy React hook with `useQueries`, `useEffect`, `useRef`
- `useSparkBalances()`

**Verify:** `bun run fix:all` + `bun run dev`. Cashu wallet init, Spark wallet init, encryption all work.

---

### Step 6: Move Repositories and Services

**Goal:** All repository classes and service classes live in core. Only `use*` factory hooks stay in web.

Every repo/service follows the same pattern:
1. Move the **class** to core
2. The `use*()` hook factory at the bottom of the file stays in web (typically in the corresponding `*-hooks.ts` file)
3. Update the class to import types/deps from core paths
4. Where a class accepts `QueryClient`, change to `Cache`

#### 6a: Account feature

| File | What moves to core | What stays in web |
|------|-------------------|------------------|
| `account-service.ts` | Entire file (pure static methods) | — |
| `account-repository.ts` | `AccountRepository` class | `useAccountRepository()` → moves to `account-hooks.ts` |
| `utils.ts` | Entire file | — |

#### 6b: Send feature

| File | What moves to core | What stays in web |
|------|-------------------|------------------|
| `cashu-send-quote-service.ts` | Entire file | — |
| `cashu-send-quote-repository.ts` | Class | `use*` hook → `cashu-send-quote-hooks.ts` |
| `cashu-send-swap-service.ts` | Entire file | — |
| `cashu-send-swap-repository.ts` | Class | `use*` hook → `cashu-send-swap-hooks.ts` |
| `spark-send-quote-service.ts` | Entire file | — |
| `spark-send-quote-repository.ts` | Class | `use*` hook → `spark-send-quote-hooks.ts` |
| `proof-state-subscription-manager.ts` | Entire file | — |
| `utils.ts` | Entire file | — |

#### 6c: Receive feature

| File | What moves to core | What stays in web |
|------|-------------------|------------------|
| `cashu-receive-quote-core.ts` | Entire file (pure business logic: types + functions) | — |
| `cashu-receive-quote-service.ts` | Entire file | — |
| `cashu-receive-quote-repository.ts` | Class | Hook → `*-hooks.ts` |
| `cashu-receive-swap-repository.ts` | Class | Hook → `*-hooks.ts` |
| `cashu-receive-swap-service.ts` | `CashuReceiveSwapService` class | `useCashuReceiveSwapService()` → `cashu-receive-swap-hooks.ts` |
| `receive-cashu-token-quote-service.ts` | Entire file | — |
| `receive-cashu-token-service.ts` | `ReceiveCashuTokenService` class | `useReceiveCashuTokenService()` → `receive-cashu-token-hooks.ts`. Class uses `QueryClient` → change to `Cache` |
| `claim-cashu-token-service.ts` | `ClaimCashuTokenService` class | Hook stays in web. Class uses `QueryClient` heavily → change to `Cache` |
| `spark-receive-quote-core.ts` | Entire file (pure business logic: types + functions) | — |
| `spark-receive-quote-service.ts` | Entire file | — |
| `spark-receive-quote-repository.ts` | Class | Hook → `*-hooks.ts` |

Files with `.server.ts` suffix stay in web — they're server-only web framework code:
- `cashu-receive-quote-repository.server.ts`
- `cashu-receive-quote-service.server.ts`
- `spark-receive-quote-repository.server.ts`
- `spark-receive-quote-service.server.ts`

**DO NOT move:** `lightning-address-service.ts` — server-only, uses `process.env`.

#### 6d: Transaction, contact, user repos

| File | What moves to core | What stays in web |
|------|-------------------|------------------|
| `transaction-repository.ts` | Class | Hook → `transaction-hooks.ts` |
| `contact-repository.ts` | Class | Hook → `contact-hooks.ts` |
| `user-service.ts` | Entire file | — |
| `user-repository.ts` | Class(es) | Hook → `user-hooks.tsx` |
| `task-processing-lock-repository.ts` | Entire file | — |

#### 6e: QueryClient → Cache migration in repositories

Repositories that accept `QueryClient` as a constructor parameter need to accept `Cache` instead. Most repos use `QueryClient` only for:
- `queryClient.fetchQuery()` → `cache.fetchQuery()` (same signature)
- `queryClient.cancelQueries()` → `cache.cancelQueries()` (same signature)

The web app's `use*Repository()` hooks wrap `QueryClient` as `Cache`:
```typescript
function queryClientAsCache(qc: QueryClient): Cache {
  return {
    fetchQuery: (opts) => qc.fetchQuery(opts),
    cancelQueries: (params) => qc.cancelQueries(params),
  };
}
```

This adapter can live in a shared web utility file (e.g., `app/lib/cache-adapter.ts`).

**Verify:** `bun run fix:all` + `bun run dev`. All mutations and queries work.

---

### Step 7: Core Public API + Cleanup

**Goal:** Clean barrel exports, verify everything works.

#### 7a: Core barrel (`packages/core/src/index.ts`)

Organize exports by category:
```typescript
// Configuration
export { configure, getConfig, type AgicashConfig } from './config';
export { measureOperation, setMeasureOperation, type MeasureOperationFn } from './performance';

// Interfaces
export type { KeyProvider } from './interfaces/key-provider';
export type { Cache } from './interfaces/cache';

// Database
export type { AgicashDb, Database, /* ... */ } from './db/database';

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

// Lib - re-export key utilities
export { Money } from './lib/money';
export { ExchangeRateService } from './lib/exchange-rate/exchange-rate-service';
// ... etc
```

The barrel exports the most commonly used items. Deep imports (`@agicash/core/lib/cashu/proof`) remain available for everything else via the `"./*": "./src/*"` exports field.

#### 7b: Remove stale re-exports

After migration, some `app/` files may have become empty wrappers that just re-export from core. If a file only re-exports and adds nothing, consider removing it and updating consumers to import from core directly. But keep thin wrappers that combine core + web code (like the `encryption.ts` wrapper with hooks).

#### 7c: Verify web app has no regressions

Full verification checklist:
- [ ] `bun install` completes (workspace resolution works)
- [ ] `bun run fix:all` passes (types, lint, format)
- [ ] `bun run dev` starts without errors
- [ ] Login/signup works
- [ ] Send flow (Cashu + Lightning) works
- [ ] Receive flow works
- [ ] Account balances display correctly
- [ ] Transactions list loads
- [ ] Realtime updates work (receive notification)
- [ ] `bun test` passes
- [ ] `bun run build` completes (production build)

#### 7d: Update `db:generate-types` script

```jsonc
"db:generate-types": "supabase gen types typescript --local --schema wallet > supabase/database.types.ts && cp supabase/database.types.ts packages/core/src/db/database-generated.types.ts"
```

---

## What Stays in Web App

These files have browser/framework dependencies and belong in the web app:

### React hooks and components
- All `*-hooks.ts` files (11 files)
- All `use*` factory functions (moved from repo/service files into hooks files)
- All `.tsx` components
- `app/hooks/` (entire directory)
- `app/components/` (entire directory)

### Browser-dependent libs
- `app/lib/read-clipboard.ts` — `navigator.clipboard`
- `app/lib/share.ts` — `navigator.share`
- `app/lib/password-generator.ts` — `window.crypto`, `window.getMockPassword`
- `app/lib/validation.ts` — `document.createElement`
- `app/lib/date.ts` — `navigator.language` in `getStartOfWeek`
- `app/lib/cookies.server.ts` — server-only web framework
- `app/lib/feature-flags.ts` — `import.meta.env`
- `app/lib/performance/sentry-performance.ts` — `@sentry/react-router`, `performance.mark/measure`
- `app/lib/transitions/` — React + DOM APIs
- `app/lib/use-throttle/` — React hooks
- `app/lib/use-latest.ts` — React hook (single file, not a directory)
- `app/lib/supabase/supabase-realtime-hooks.ts` — `window`, `document`, `navigator`
- `app/lib/cashu/melt-quote-subscription.ts` — React hooks
- `app/lib/cashu/animated-qr-code/` — React hooks

### Web-specific feature code
- `app/features/agicash-db/database.client.ts` — `window`, `import.meta.env`
- `app/features/agicash-db/database.server.ts` — server-only
- `app/features/agicash-db/supabase-session.ts` — `QueryClient` + `@opensecret/react`
- `app/features/user/auth.ts` — React hooks + `localStorage` + `@opensecret/react`
- `app/features/user/guest-account-storage.ts` — `localStorage`
- `app/features/user/oauth-login-session-storage.ts` — `sessionStorage`
- `app/features/user/pending-terms-storage.ts` — `localStorage`
- `app/features/wallet/task-processing.ts` — React component
- `app/features/wallet/wallet.tsx` — React component
- `app/features/send/send-store.ts` — Zustand + `import.meta.env.MODE`
- `app/features/receive/receive-store.ts` — Zustand
- `app/features/transactions/transaction-ack-status-store.ts` — Zustand
- `app/features/receive/lightning-address-service.ts` — server-only, `process.env`
- `app/features/send/use-get-invoice-from-lud16.ts` — React hook (`useMutation`)
- `app/features/signup/verify-email.ts` — React Router middleware + hooks + `window.location`
- `app/features/wallet/use-track-wallet-changes.ts` — React hooks orchestrating Supabase realtime
- `app/features/theme/index.ts` — re-exports React components/hooks
- `app/features/pwa/use-should-show-pwa-prompt.ts` — web-specific hook
- `app/features/gift-cards/use-discover-cards.ts` — React hook
- All server routes (`*.server.ts` in routes/)
- All UI features (login, signup, settings, gift-cards, theme, pwa, loading)

### Zustand stores
Zustand stores are technically portable (zustand works outside React), but they contain UI-flow logic that's web-specific. Keep them in the web app.

---

## Import Migration Guide

### Pattern for moved files

```typescript
// Before:
import { Money } from '~/lib/money';
import { DomainError } from '~/features/shared/error';
import { AccountRepository } from '~/features/accounts/account-repository';

// After:
import { Money } from '@agicash/core/lib/money';
import { DomainError } from '@agicash/core/features/shared/error';
import { AccountRepository } from '@agicash/core/features/accounts/account-repository';

// Or via barrel:
import { Money, DomainError, AccountRepository } from '@agicash/core';
```

### Pattern for split files

Web files that import from a split file keep using `~/features/shared/encryption` — the web version re-exports core types plus adds hooks:

```typescript
// This still works — web's encryption.ts re-exports from core:
import { useEncryption } from '~/features/shared/encryption';

// For code that only needs the pure type:
import type { Encryption } from '@agicash/core/features/shared/encryption';
```

### Pattern for `use*Repository()` hooks

```typescript
// Before (in account-repository.ts):
export const useAccountRepository = () => { ... };

// After (in account-hooks.ts):
import { AccountRepository } from '@agicash/core/features/accounts/account-repository';

export const useAccountRepository = () => {
  const db = useAgicashDb();
  const encryption = useEncryption();
  const cache = useCache(); // wraps QueryClient
  // ... same wiring, just imports from core
  return new AccountRepository(db, encryption, cache, ...);
};
```

---

## Risk Mitigations

| Risk | Mitigation |
|------|-----------|
| Workspace breaks Vite dev server | Step 1 validates `bun run dev` before any code moves |
| Mass import rename introduces bugs | Each step ends with `bun run fix:all`. TypeScript catches broken imports at compile time |
| Core tsconfig (no DOM) catches unexpected browser deps | Exactly the point — compiler errors surface any `window`/`document` usage in core |
| `getInitializedCashuWallet` breaks with Cache | Cache is a strict subset of QueryClient — behavioral parity guaranteed |
| Supabase generated types path changes | Copy step in `db:generate-types` keeps both locations in sync |
| Deep imports (`@agicash/core/lib/cashu/proof`) don't resolve | `"./*": "./src/*"` in `exports` field + `moduleResolution: "Bundler"` handles this |

---

## Execution Order Summary

| Step | What | Files touched | Risk |
|------|------|--------------|------|
| 1 | Workspace infrastructure | 5 new config files | Low |
| 2 | Core abstractions (config, perf, interfaces) | 5 new files + entry.client.tsx | Low |
| 3 | Move pure lib modules | ~25 file moves + import updates | Low |
| 4 | Move types + error classes + DB types + schemas | ~30 file moves + import updates | Low |
| 5 | Split mixed files (encryption, cashu, spark, crypto) | 4 file splits + import updates | **Medium** |
| 6 | Move repos + services | ~25 class moves + hook relocations | **Medium** |
| 7 | Public API + cleanup | Barrel + verification | Low |

Steps 1-4 are mechanical (move + update imports). Steps 5-6 require care because they change function signatures (adding `KeyProvider`/`Cache` params). Step 7 is verification.

**Note:** `claim-cashu-token-service.ts` and `receive-cashu-token-service.ts` have heavier `QueryClient` usage than most repos — their Cache migration in Step 6 needs extra attention.

---

## Future: Move Web to `apps/web/`

Not part of this plan, but once the core extraction is complete, moving the web app to `apps/web/` becomes straightforward:

1. Create `apps/web/` directory
2. Move `app/`, `public/`, config files, `.env` files
3. Update `package.json` workspaces: `["packages/*", "apps/*"]`
4. Update Vercel config: `{ "rootDirectory": "apps/web" }`
5. Update all relative paths in config files
6. `supabase/` stays at root (shared across apps)

This is optional and can be done whenever a second app (CLI, mobile) is added.
