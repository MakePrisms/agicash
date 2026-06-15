# Wallet SDK — Base Plan 2: SDK Core + Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared `@agicash/wallet-sdk` core — `Sdk.create`/config, error taxonomy, typed event bus, an async `StorageAdapter` bridged to Open Secret's `StorageProvider`, on-demand key derivation, an internal Supabase client + JWT session provider, the internal DB wrapper + a minimal user repository, and the full auth state machine returning a real reconciled `User` — all runnable headless under bun, line-identical across both variant PRs.

**Architecture:** React-free SDK in `packages/wallet-sdk`. `Sdk.create(config)` configures Open Secret (`@agicash/opensecret@1.0.0-rc.0`, passing a `StorageProvider` backed by the host's async `StorageAdapter`), constructs the internal Supabase client (schema `wallet`, `accessToken` provider = `generateThirdPartyToken` cached to JWT expiry), and wires the auth + user domains over an internal `OpenSecret` port (dependency-injected for tests), a `KeyService` (in-memory, dropped on `dispose()`), repositories, and a typed `EventBus`. Auth owns the full state machine: sign in/up/guest/upgrade/out, email verification, OAuth begin/complete (redirect host-owned), password change/reset, and session-expiry handling that emits `auth:session-expired` instead of the app's hard reload.

**Tech Stack:** TypeScript (ESM, `moduleResolution: Bundler`, `noEmit`), `bun test`. Deps: `@agicash/opensecret@1.0.0-rc.0`, `@supabase/supabase-js@2.95.2`, `@scure/bip32@1.7.0`, `@scure/bip39@1.6.0`, `@agicash/breez-sdk-spark@0.13.5-1` (signer only — `defaultExternalSigner`), `jwt-decode@4.0.0`, `@stablelib/base64`, `zod`; workspace libs `@agicash/money|utils|cashu|ecies`.

**Gate (every task):** `bun run typecheck` + `bun run test` (run from repo root for the workspace; never `fix:all` — that is biome lint/format only and does NOT typecheck). `tsc` is the catch-all for dangling imports in every form (alias/relative/value/type-only).

**Out of scope (later plans):** accounts/cashu/spark/transactions/contacts/transfers/scan/rates/background domains, services, change-feed/realtime, processors, leader election, engine seams (`runTask`/store-factory/cache-handle), server-mode restrictions, the web-app migration. `resync()` is a defined no-op stub here (real catch-up is Plan 4).

---

## Key design decisions (baked into this plan)

1. **Open Secret target = `1.0.0-rc.0`** (ships the `StorageProvider`). `configure({ apiUrl, clientId, storage })` — `storage` is required.
2. **Storage:** the SDK's public `StorageAdapter` is **async** (spec). It is mapped to OS's `StorageProvider`: `persistent` ← `config.storage` (durable: `access_token`/`refresh_token`); `session` ← `config.sessionStorage` if the host provides one, else an SDK-owned **in-memory** `KeyValueStore` (enclave `sessionKey`/`sessionId`). **Web passes a `window.sessionStorage`-backed adapter** so the enclave handshake survives reloads (matches today); **headless omits it → in-memory**, dropped on `dispose()`. OS's `KeyValueStore` permits sync OR async methods (SDK awaits), so async adapters flow straight in.
3. **Guest credentials** (`{ id, password }`) persist via the host `StorageAdapter` under `agicash.guest-account` (needed to restore the same guest on the same device — matches today's `localStorage.guestAccount`).
4. **Errors** move to the SDK under a new `SdkError` base; `apps/web-wallet/app/features/shared/error.ts` re-exports them (preserves `instanceof` across the boundary; avoids a 37-file codemod). `getErrorMessage` (UI helper) stays in the app.
5. **Key derivation** is in-memory and dropped on `dispose()`. `sparkIdentityPublicKey` requires `@agicash/breez-sdk-spark`'s `defaultExternalSigner` (synchronous, **no** `connect`, no API key). `@agicash/breez-sdk-spark` ships per-environment builds via export conditions — the bare import resolves to the **native Node build under bun/node** and the **WASM build in the browser**, same import line. **Verified working under bun** (`defaultExternalSigner(...).identityPublicKey()` → 33-byte pubkey; "Node.js storage automatically enabled"), so the MCP/headless path uses the Node build, not WASM. The dependency is unavoidable headless (user creation needs the spark identity key), and is now de-risked for the signer path (full `connect()` is validated in Plan 3).
6. **User repository (minimal):** `WriteUserRepository.upsert` builds the `upsert_user_with_accounts` RPC payload (from `defaultAccounts` + derived crypto) and maps **only the returned user row → `User`**. It does **not** map account rows to domain `Account`s or initialize Cashu/Spark wallets — that is Plan 3.
7. **`defaultAccounts`** moves into the SDK as a constant; the dev-only testnut accounts become conditional on `config.includeTestAccounts` (replaces `import.meta.env.MODE`).
8. **UserDomain (partial):** `get`, `updateUsername`, `acceptTerms` here. `setDefaultAccount` / `setDefaultCurrency` are account-dependent (DB constraint requires a default account per currency) → deferred to Plan 3.
9. **`sessionHintCookie`** is an SSR concern and stays in the web app; the SDK never touches `document`.
10. **Tests** run offline (DI fakes for the OS port + DB; BIP39/BIP32 vectors for derivation). The live headless sign-in smoke is a documented script, not part of the CI gate.

---

## File Structure

**Created (in `packages/wallet-sdk/`):**

```
src/
  index.ts                         # public barrel: Sdk, SdkConfig, StorageAdapter, errors, event types, User
  sdk.ts                           # Sdk class: create(config), on(), resync(), dispose()
  config.ts                        # SdkConfig, StorageAdapter, KeyValueStore types
  errors.ts                        # SdkError base + DomainError/ConcurrencyError/NotFoundError/UniqueConstraintError + getErrorMessage
  events.ts                        # SdkCoreEventMap (public event surface for core)
  domains/
    auth.ts                        # AuthDomain (full state machine)
    user.ts                        # UserDomain (get/updateUsername/acceptTerms)
    user-types.ts                  # User, FullUser, GuestUser (moved from app)
  internal/
    event-bus.ts                   # typed EventBus<Map>
    opensecret.ts                  # OpenSecret port (DI seam over @agicash/opensecret standalone fns)
    opensecret-storage.ts          # StorageAdapter -> StorageProvider bridge (+ in-memory session store)
    keys.ts                        # KeyService: derive+cache cashu seed/spark mnemonic/enc keys/xpub/spark-id; clear()
    timeout.ts                     # setLongTimeout/clearLongTimeout (ported, React-free)
    random-password.ts             # generateRandomPassword (ported, WebCrypto global)
    db/
      database.ts                  # AgicashDb type wrapper + Db*Row types + isCashuAccount/isSparkAccount (moved)
      client.ts                    # createAgicashDb(config): supabase client (schema 'wallet', accessToken provider)
      session-token.ts             # SessionTokenProvider: generateThirdPartyToken cached to JWT exp (non-TanStack)
      user-repository.ts           # ReadUserRepository.get/toUser, WriteUserRepository.upsert/update (minimal)
      default-accounts.ts          # defaultAccounts constant (test-account branch config-driven)
      json-models/                 # cashu/spark account-details zod schemas (moved as-is)
storage/
  browser.ts                       # browserStorageAdapter (window.localStorage) for the web host
  memory.ts                        # inMemoryStorageAdapter (tests / ephemeral node)
```

**Modified:**
- Root `package.json` — `workspaces.catalog`: bump `@agicash/opensecret` → `1.0.0-rc.0`; add `@supabase/supabase-js`, `@scure/bip32`, `@scure/bip39`, `@agicash/breez-sdk-spark`, `jwt-decode`.
- `packages/wallet-sdk/package.json`, `packages/wallet-sdk/tsconfig.json` — real deps, `test` script, `types: ["bun"]`.
- `apps/web-wallet/package.json` — add `@agicash/wallet-sdk: workspace:*`; repoint the 5 hoisted deps to `catalog:`.
- `apps/web-wallet/app/features/shared/error.ts` — re-export error classes from `@agicash/wallet-sdk`.

**Relocated from app (git mv where whole-file, otherwise copy+delete):**
- `features/agicash-db/database.ts` + `features/agicash-db/json-models/` → `packages/wallet-sdk/src/internal/db/` (becomes internal; app keeps importing via a re-export shim — see Task 5).
- `features/user/user.ts` (the `User` type) → `packages/wallet-sdk/src/domains/user-types.ts` (app re-exports).
- `lib/timeout.ts`, `lib/password-generator.ts`, `lib/spark/utils.ts#getSparkIdentityPublicKeyFromMnemonic` → ported into the SDK (app keeps its copies for now; de-dup is a later cleanup).

> **Root types note:** the SDK's `db/database.ts` imports the generated DB types from the repo-root `supabase/database.types.ts` via a relative import (`../../../../../../supabase/database.types`). These are `import type` only (erased at build); `tsc` resolves them. The generated file stays at the repo root and `db:generate-types` is unchanged.

---

## Task 0: Catalog bump + package scaffold

**Files:**
- Modify: `package.json` (root `workspaces.catalog`)
- Modify: `apps/web-wallet/package.json`
- Modify: `packages/wallet-sdk/package.json`, `packages/wallet-sdk/tsconfig.json`
- Create: `packages/wallet-sdk/src/index.ts` (replace placeholder)

- [ ] **Step 1: Bump + add catalog entries.** In root `package.json`, set `"@agicash/opensecret": "1.0.0-rc.0"` and add (alphabetical) to `workspaces.catalog`:

```json
"@agicash/breez-sdk-spark": "0.13.5-1",
"@scure/bip32": "1.7.0",
"@scure/bip39": "1.6.0",
"@supabase/supabase-js": "2.95.2",
"jwt-decode": "4.0.0"
```

- [ ] **Step 2: Repoint app deps to catalog.** In `apps/web-wallet/package.json`, change these five from pinned versions to `"catalog:"`: `@agicash/breez-sdk-spark`, `@scure/bip32`, `@scure/bip39`, `@supabase/supabase-js`, `jwt-decode`. Add `"@agicash/wallet-sdk": "workspace:*"`.

- [ ] **Step 3: Write `packages/wallet-sdk/package.json`:**

```json
{
  "name": "@agicash/wallet-sdk",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc"
  },
  "dependencies": {
    "@agicash/breez-sdk-spark": "catalog:",
    "@agicash/cashu": "workspace:*",
    "@agicash/ecies": "workspace:*",
    "@agicash/money": "workspace:*",
    "@agicash/opensecret": "catalog:",
    "@agicash/utils": "workspace:*",
    "@noble/hashes": "catalog:",
    "@scure/bip32": "catalog:",
    "@scure/bip39": "catalog:",
    "@stablelib/base64": "catalog:",
    "@supabase/supabase-js": "catalog:",
    "jwt-decode": "catalog:",
    "zod": "catalog:"
  },
  "devDependencies": {
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 4: Update `packages/wallet-sdk/tsconfig.json`** to add `types: ["bun"]` (match sibling packages; `DOM` is intentionally omitted — the SDK is headless):

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts", "storage/**/*.ts"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["bun"],
    "noEmit": true
  }
}
```

- [ ] **Step 5: Replace `src/index.ts` placeholder** with a temporary barrel (filled in by later tasks):

```ts
export {}; // populated as modules land
```

- [ ] **Step 6: Install + verify.** Ask the user before installing (CLAUDE.md autonomy: installing deps requires approval). Run: `bun install`. Expected: resolves `@agicash/opensecret@1.0.0-rc.0` and the new catalog entries; lockfile updates.

- [ ] **Step 7: Gate.** Run: `bun run typecheck && bun run test`. Expected: PASS (empty package typechecks; no SDK tests yet — `bun test` in wallet-sdk finds none, which fails the bare runner, so add `--pass-with-no-tests` only if needed; otherwise this gate is satisfied once Task 1 adds the first test). If `bun test` errors on "no tests", proceed to Task 1 and run the gate there.

- [ ] **Step 8: Commit.**

```bash
git add package.json apps/web-wallet/package.json packages/wallet-sdk bun.lock
git commit -m "chore(wallet-sdk): scaffold package + hoist auth/db deps to catalog"
```

---

## Task 1: Error taxonomy

**Files:**
- Create: `packages/wallet-sdk/src/errors.ts`
- Test: `packages/wallet-sdk/src/errors.test.ts`
- Modify: `apps/web-wallet/app/features/shared/error.ts` (re-export)

- [ ] **Step 1: Write the failing test** (`src/errors.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import {
  ConcurrencyError,
  DomainError,
  getErrorMessage,
  NotFoundError,
  SdkError,
  UniqueConstraintError,
} from './errors';

describe('error taxonomy', () => {
  test('all SDK errors extend SdkError and Error', () => {
    for (const err of [
      new DomainError('d'),
      new ConcurrencyError('c'),
      new NotFoundError('n'),
      new UniqueConstraintError('u'),
    ]) {
      expect(err).toBeInstanceOf(SdkError);
      expect(err).toBeInstanceOf(Error);
    }
  });

  test('names are set for discrimination', () => {
    expect(new DomainError('d').name).toBe('DomainError');
    expect(new ConcurrencyError('c').name).toBe('ConcurrencyError');
    expect(new NotFoundError('n').name).toBe('NotFoundError');
    expect(new UniqueConstraintError('u').name).toBe('UniqueConstraintError');
  });

  test('ConcurrencyError carries optional details', () => {
    expect(new ConcurrencyError('c', 'row 5').details).toBe('row 5');
    expect(new ConcurrencyError('c').details).toBeUndefined();
  });

  test('getErrorMessage extracts message or falls back', () => {
    expect(getErrorMessage('boom')).toBe('boom');
    expect(getErrorMessage(new Error('nope'))).toBe('nope');
    expect(getErrorMessage(null, 'fallback')).toBe('fallback');
  });
});
```

- [ ] **Step 2: Run it to verify it fails.** Run: `cd packages/wallet-sdk && bun test src/errors.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/errors.ts`:**

```ts
/** Base class for all errors thrown across the SDK boundary. */
export class SdkError extends Error {}

/** User-facing error that must never be retried. */
export class DomainError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'DomainError';
  }
}

/** Transient conflict (optimistic-concurrency clash); always safe to retry. */
export class ConcurrencyError extends SdkError {
  constructor(
    message: string,
    public details: string | undefined = undefined,
  ) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

/** Requested entity does not exist. */
export class NotFoundError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

/** DB unique-constraint violation (Postgres code 23505). */
export class UniqueConstraintError extends SdkError {
  constructor(message: string) {
    super(message);
    this.name = 'UniqueConstraintError';
  }
}

export const getErrorMessage = (
  error: unknown,
  fallbackMessage = 'Unknown error. Please try again or contact support',
): string => {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return fallbackMessage;
};
```

- [ ] **Step 4: Run to verify it passes.** Run: `cd packages/wallet-sdk && bun test src/errors.test.ts`. Expected: PASS.

- [ ] **Step 5: Re-export from the app** so existing 37 importers and `instanceof` keep working. Replace `apps/web-wallet/app/features/shared/error.ts` with:

```ts
export {
  ConcurrencyError,
  DomainError,
  getErrorMessage,
  NotFoundError,
  SdkError,
  UniqueConstraintError,
} from '@agicash/wallet-sdk';
```

(Note: the old app classes did NOT share a base; `SdkError` is new and additive. No call site relied on the absence of a base.)

- [ ] **Step 6: Export from the SDK barrel.** In `src/index.ts` add:

```ts
export {
  ConcurrencyError,
  DomainError,
  getErrorMessage,
  NotFoundError,
  SdkError,
  UniqueConstraintError,
} from './errors';
```

- [ ] **Step 7: Gate.** Run (repo root): `bun run typecheck && bun run test`. Expected: PASS (app still resolves error imports via the SDK; `instanceof` checks in `editable-username.tsx`, `user-repository.ts`, `cashu-receive-swap-repository.ts` still compile).

- [ ] **Step 8: Commit.**

```bash
git add packages/wallet-sdk/src/errors.ts packages/wallet-sdk/src/errors.test.ts packages/wallet-sdk/src/index.ts apps/web-wallet/app/features/shared/error.ts
git commit -m "feat(wallet-sdk): error taxonomy (SdkError base) + app re-export"
```

---

## Task 2: Typed event bus + core event map

**Files:**
- Create: `packages/wallet-sdk/src/internal/event-bus.ts`
- Create: `packages/wallet-sdk/src/events.ts`
- Test: `packages/wallet-sdk/src/internal/event-bus.test.ts`

- [ ] **Step 1: Write the failing test** (`src/internal/event-bus.test.ts`):

```ts
import { describe, expect, mock, test } from 'bun:test';
import { EventBus } from './event-bus';

type TestMap = { ping: { n: number }; pong: Record<string, never> };

describe('EventBus', () => {
  test('emit delivers payload to subscribers of that event only', () => {
    const bus = new EventBus<TestMap>();
    const onPing = mock(() => {});
    const onPong = mock(() => {});
    bus.on('ping', onPing);
    bus.on('pong', onPong);

    bus.emit('ping', { n: 7 });

    expect(onPing).toHaveBeenCalledTimes(1);
    expect(onPing.mock.calls[0][0]).toEqual({ n: 7 });
    expect(onPong).not.toHaveBeenCalled();
  });

  test('unsubscribe stops delivery', () => {
    const bus = new EventBus<TestMap>();
    const cb = mock(() => {});
    const off = bus.on('ping', cb);
    off();
    bus.emit('ping', { n: 1 });
    expect(cb).not.toHaveBeenCalled();
  });

  test('a throwing listener does not block others', () => {
    const bus = new EventBus<TestMap>();
    const good = mock(() => {});
    bus.on('ping', () => {
      throw new Error('listener boom');
    });
    bus.on('ping', good);
    expect(() => bus.emit('ping', { n: 1 })).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  test('clear() removes all listeners', () => {
    const bus = new EventBus<TestMap>();
    const cb = mock(() => {});
    bus.on('ping', cb);
    bus.clear();
    bus.emit('ping', { n: 1 });
    expect(cb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd packages/wallet-sdk && bun test src/internal/event-bus.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Write `src/internal/event-bus.ts`:**

```ts
type Listener<P> = (payload: P) => void;

/**
 * Minimal typed pub/sub. One bus per SDK instance. A throwing listener is
 * isolated (logged, not propagated) so one bad consumer cannot break delivery
 * to the rest or the emitting SDK operation.
 */
export class EventBus<Map extends Record<string, unknown>> {
  private readonly listeners = new global.Map<
    keyof Map,
    Set<Listener<unknown>>
  >();

  on<E extends keyof Map>(event: E, cb: Listener<Map[E]>): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(cb as Listener<unknown>);
    this.listeners.set(event, set);
    return () => {
      set.delete(cb as Listener<unknown>);
    };
  }

  emit<E extends keyof Map>(event: E, payload: Map[E]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const cb of [...set]) {
      try {
        (cb as Listener<Map[E]>)(payload);
      } catch (error) {
        console.error(`SDK event listener for "${String(event)}" threw`, error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
```

> Note: `global.Map` disambiguates the JS `Map` from the `Map` generic type parameter. If `global` is awkward under the bun types, rename the type param to `EventMap` and use plain `Map`.

- [ ] **Step 4: Run to verify it passes.** Run: `cd packages/wallet-sdk && bun test src/internal/event-bus.test.ts`. Expected: PASS.

- [ ] **Step 5: Move the `User` type into the SDK** (`events.ts` depends on it). The app's `features/user/user.ts` is a pure module (only imports `Currency` from `@agicash/money`): the types `User`/`FullUser`/`GuestUser`/`UserProfile` plus three pure guards `shouldVerifyEmail`/`shouldAcceptTerms`/`shouldAcceptGiftCardMintTerms`. Copy its FULL contents verbatim into `packages/wallet-sdk/src/domains/user-types.ts`. Replace the app's `apps/web-wallet/app/features/user/user.ts` with a re-export shim: `export * from '@agicash/wallet-sdk/domains/user-types';` (this is a value+type re-export — the guards are runtime values). Barrel-export the types from `src/index.ts`: `export type { User, FullUser, GuestUser, UserProfile } from './domains/user-types';`. Verify app importers of all these symbols still resolve (grep `from '~/features/user/user'` and relative variants). (This supersedes the original Task 7 type-move; Task 7 now only adds the repository + default accounts.)

- [ ] **Step 6: Write `src/events.ts`** (the public core event surface; only `auth:*` is emitted in this plan, the rest are wired in Plans 3-4 but the type is defined now so the shape is stable):

```ts
import type { Money } from '@agicash/money';
import type { SdkError } from './errors';
import type { User } from './domains/user-types';

export type BackgroundState =
  | 'stopped'
  | 'starting'
  | 'follower'
  | 'leader'
  | 'stopping';

/** Core events present in BOTH variants. Lifecycle events fire once, on a
 * terminal transition, on every instance. (Lifecycle + connection + background
 * emission is implemented in later plans; auth:* is implemented here.) */
export type SdkCoreEventMap = {
  'send:completed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    transactionId: string;
    amount: Money;
  };
  'send:failed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    transactionId?: string;
    error: SdkError;
  };
  'receive:completed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    transactionId: string;
    amount: Money;
  };
  'receive:failed': {
    protocol: 'cashu' | 'spark';
    quoteId: string;
    error: SdkError;
  };
  'receive:expired': { protocol: 'cashu' | 'spark'; quoteId: string };
  'auth:signed-in': { user: User };
  'auth:signed-out': Record<string, never>;
  'auth:session-expired': Record<string, never>;
  'connection:state': { state: 'connected' | 'disconnected' };
  'background:state': { state: BackgroundState };
};
```

- [ ] **Step 7: Gate + commit.** Run (root): `bun run typecheck && bun run test`. Expected: PASS (incl. web-wallet, which now imports the `User` type/guards via the SDK shim).

```bash
git add packages/wallet-sdk/src/internal/event-bus.ts packages/wallet-sdk/src/internal/event-bus.test.ts packages/wallet-sdk/src/events.ts packages/wallet-sdk/src/domains/user-types.ts packages/wallet-sdk/src/index.ts apps/web-wallet/app/features/user/user.ts
git commit -m "feat(wallet-sdk): typed event bus + SdkCoreEventMap + move User type"
```

---

## Task 3: Config, StorageAdapter + Open Secret storage bridge

**Files:**
- Create: `packages/wallet-sdk/src/config.ts`
- Create: `packages/wallet-sdk/src/internal/opensecret-storage.ts`
- Create: `packages/wallet-sdk/storage/memory.ts`, `packages/wallet-sdk/storage/browser.ts`
- Test: `packages/wallet-sdk/src/internal/opensecret-storage.test.ts`

- [ ] **Step 1: Write `src/config.ts`** (the public config + storage contract):

```ts
/** Minimal async key/value store the host provides. Web = localStorage-backed,
 * node = fs/sqlite-backed. Holds session tokens (and guest credentials) only —
 * never seeds or derived keys. */
export interface StorageAdapter {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export type SdkConfig = {
  openSecret: { url: string; clientId: string };
  supabase: { url: string; anonKey: string; serviceRoleKey?: string };
  breezApiKey?: string;
  /** Durable store: auth tokens + guest credentials. Web = localStorage, node = fs/sqlite. */
  storage: StorageAdapter;
  /** Optional ephemeral store for Open Secret's enclave handshake material
   * (sessionKey/sessionId). Web passes a window.sessionStorage-backed adapter so
   * it survives reloads; headless omits it (SDK uses an in-memory store dropped
   * on dispose). */
  sessionStorage?: StorageAdapter;
  /** Leader-election instance id; autogenerated if omitted (used in later plans). */
  clientId?: string;
  /** LN-address domain for contact composition (used in later plans). */
  domain?: string;
  /** Seed dev/test default accounts (testnut mints) on user creation. Replaces
   * the app's `import.meta.env.MODE === 'development'` branch. */
  includeTestAccounts?: boolean;
};
```

- [ ] **Step 2: Write the failing test** (`src/internal/opensecret-storage.test.ts`):

```ts
import { describe, expect, test } from 'bun:test';
import { inMemoryStorageAdapter } from '../../storage/memory';
import { createOpenSecretStorage } from './opensecret-storage';

describe('createOpenSecretStorage', () => {
  test('persistent maps to the host adapter (undefined -> null)', async () => {
    const adapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(adapter);

    expect(await storage.persistent.getItem('access_token')).toBeNull();
    await storage.persistent.setItem('access_token', 'abc');
    expect(await storage.persistent.getItem('access_token')).toBe('abc');
    expect(await adapter.get('access_token')).toBe('abc');

    await storage.persistent.removeItem('access_token');
    expect(await storage.persistent.getItem('access_token')).toBeNull();
  });

  test('session is in-memory and never touches the host adapter', async () => {
    const adapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(adapter);

    await storage.session.setItem('sessionKey', 'k');
    expect(storage.session.getItem('sessionKey')).toBe('k');
    expect(await adapter.get('sessionKey')).toBeUndefined();
  });

  test('clearSession() drops in-memory session material', async () => {
    const adapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(adapter);
    await storage.session.setItem('sessionId', 'x');
    await storage.clearSession();
    expect(storage.session.getItem('sessionId')).toBeNull();
  });

  test('a host session adapter (web sessionStorage) backs the session scope', async () => {
    const persistent = inMemoryStorageAdapter();
    const sessionAdapter = inMemoryStorageAdapter();
    const storage = createOpenSecretStorage(persistent, sessionAdapter);

    await storage.session.setItem('sessionKey', 'k');
    expect(await sessionAdapter.get('sessionKey')).toBe('k');
    expect(await persistent.get('sessionKey')).toBeUndefined();

    await storage.clearSession();
    expect(await sessionAdapter.get('sessionKey')).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run to verify it fails.** Run: `cd packages/wallet-sdk && bun test src/internal/opensecret-storage.test.ts`. Expected: FAIL.

- [ ] **Step 4: Write `storage/memory.ts`:**

```ts
import type { StorageAdapter } from '../src/config';

/** In-memory StorageAdapter for tests and ephemeral headless runs. */
export function inMemoryStorageAdapter(
  seed?: Record<string, string>,
): StorageAdapter {
  const store = new Map<string, string>(Object.entries(seed ?? {}));
  return {
    get: (key) => Promise.resolve(store.get(key)),
    set: (key, value) => {
      store.set(key, value);
      return Promise.resolve();
    },
    remove: (key) => {
      store.delete(key);
      return Promise.resolve();
    },
  };
}
```

- [ ] **Step 5: Write `storage/browser.ts`** (for the web host; relies on `window.localStorage`):

```ts
import type { StorageAdapter } from '../src/config';

const wrap = (store: Storage): StorageAdapter => ({
  get: (key) => Promise.resolve(store.getItem(key) ?? undefined),
  set: (key, value) => {
    store.setItem(key, value);
    return Promise.resolve();
  },
  remove: (key) => {
    store.removeItem(key);
    return Promise.resolve();
  },
});

/** Durable StorageAdapter backed by window.localStorage (web host -> config.storage). */
export const browserStorageAdapter: StorageAdapter = wrap(window.localStorage);

/** Ephemeral StorageAdapter backed by window.sessionStorage (web host ->
 * config.sessionStorage). Keeps the enclave handshake alive across reloads. */
export const browserSessionStorageAdapter: StorageAdapter = wrap(
  window.sessionStorage,
);
```

> `storage/browser.ts` references `window`; it is imported only by the web host, never by the headless core, so the SDK's `tsconfig` keeps `DOM` out. If `tsc` flags `window`, add a local `/// <reference lib="dom" />` at the top of THIS file only, or type it as `declare const window: { localStorage: Storage }`.

- [ ] **Step 6: Write `src/internal/opensecret-storage.ts`:**

```ts
import type { StorageAdapter } from '../config';

/** Open Secret's StorageProvider contract (mirrors @agicash/opensecret@1.x).
 * KeyValueStore methods may be sync OR async; OS always awaits. */
type KeyValueStore = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};
export type StorageProvider = {
  persistent: KeyValueStore;
  session: KeyValueStore;
};

/**
 * Bridges the SDK's async StorageAdapter(s) to Open Secret's StorageProvider:
 * - `persistent` -> `persistent` adapter (durable auth tokens), undefined->null.
 * - `session` -> `sessionAdapter` if provided (web: window.sessionStorage, so the
 *   enclave handshake survives reloads), else an SDK-owned in-memory store.
 * `clearSession()` removes every key written through the session scope (used by
 * signOut + dispose); it is async because a host adapter may be async.
 */
export function createOpenSecretStorage(
  persistent: StorageAdapter,
  sessionAdapter?: StorageAdapter,
): StorageProvider & { clearSession(): Promise<void> } {
  const sessionKeys = new Set<string>();
  const memory = new Map<string, string>();

  const session: KeyValueStore = sessionAdapter
    ? {
        getItem: (key) => sessionAdapter.get(key).then((v) => v ?? null),
        setItem: (key, value) => {
          sessionKeys.add(key);
          return sessionAdapter.set(key, value);
        },
        removeItem: (key) => {
          sessionKeys.delete(key);
          return sessionAdapter.remove(key);
        },
      }
    : {
        getItem: (key) => memory.get(key) ?? null,
        setItem: (key, value) => {
          sessionKeys.add(key);
          memory.set(key, value);
        },
        removeItem: (key) => {
          sessionKeys.delete(key);
          memory.delete(key);
        },
      };

  return {
    persistent: {
      getItem: (key) => persistent.get(key).then((v) => v ?? null),
      setItem: (key, value) => persistent.set(key, value),
      removeItem: (key) => persistent.remove(key),
    },
    session,
    clearSession: async () => {
      for (const key of [...sessionKeys]) {
        if (sessionAdapter) await sessionAdapter.remove(key);
      }
      sessionKeys.clear();
      memory.clear();
    },
  };
}
```

- [ ] **Step 7: Run to verify it passes.** Run: `cd packages/wallet-sdk && bun test src/internal/opensecret-storage.test.ts`. Expected: PASS.

- [ ] **Step 8: Export config types from the barrel.** In `src/index.ts` add: `export type { SdkConfig, StorageAdapter } from './config';`, `export { inMemoryStorageAdapter } from '../storage/memory';`, and `export { browserStorageAdapter, browserSessionStorageAdapter } from '../storage/browser';`.

- [ ] **Step 9: Gate + commit.** Run (root): `bun run typecheck && bun run test`.

```bash
git add packages/wallet-sdk/src/config.ts packages/wallet-sdk/src/internal/opensecret-storage.ts packages/wallet-sdk/src/internal/opensecret-storage.test.ts packages/wallet-sdk/storage packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): SdkConfig + StorageAdapter -> Open Secret StorageProvider bridge"
```

---

## Task 4: Open Secret port (DI seam) + ported utilities

**Files:**
- Create: `packages/wallet-sdk/src/internal/opensecret.ts`
- Create: `packages/wallet-sdk/src/internal/timeout.ts`
- Create: `packages/wallet-sdk/src/internal/random-password.ts`
- Test: `packages/wallet-sdk/src/internal/timeout.test.ts`, `packages/wallet-sdk/src/internal/random-password.test.ts`

- [ ] **Step 1: Write `src/internal/opensecret.ts`** — a port object over the OS standalone functions so domains depend on an injectable seam (tests pass a fake; production passes the real OS module). Verify each signature against `node_modules/@agicash/opensecret/dist/index.d.ts` before wiring.

```ts
import {
  changePassword as osChangePassword,
  configure as osConfigure,
  confirmPasswordReset as osConfirmPasswordReset,
  convertGuestToUserAccount as osConvertGuestToUserAccount,
  fetchUser as osFetchUser,
  generateThirdPartyToken as osGenerateThirdPartyToken,
  getPrivateKey as osGetPrivateKey,
  getPrivateKeyBytes as osGetPrivateKeyBytes,
  getPublicKey as osGetPublicKey,
  handleGoogleCallback as osHandleGoogleCallback,
  initiateGoogleAuth as osInitiateGoogleAuth,
  requestNewVerificationCode as osRequestNewVerificationCode,
  requestPasswordReset as osRequestPasswordReset,
  signIn as osSignIn,
  signInGuest as osSignInGuest,
  signOut as osSignOut,
  signUp as osSignUp,
  signUpGuest as osSignUpGuest,
  verifyEmail as osVerifyEmail,
} from '@agicash/opensecret';
import type { StorageProvider } from './opensecret-storage';

export type AuthUser = Awaited<ReturnType<typeof osFetchUser>>['user'];

/** Injectable seam over @agicash/opensecret standalone functions. */
export type OpenSecret = {
  configure(o: { apiUrl: string; clientId: string; storage: StorageProvider }): void;
  fetchUser: typeof osFetchUser;
  signIn: typeof osSignIn;
  signUp: typeof osSignUp;
  signInGuest: typeof osSignInGuest;
  signUpGuest: typeof osSignUpGuest;
  signOut: typeof osSignOut;
  convertGuestToUserAccount: typeof osConvertGuestToUserAccount;
  changePassword: typeof osChangePassword;
  requestNewVerificationCode: typeof osRequestNewVerificationCode;
  verifyEmail: typeof osVerifyEmail;
  requestPasswordReset: typeof osRequestPasswordReset;
  confirmPasswordReset: typeof osConfirmPasswordReset;
  initiateGoogleAuth: typeof osInitiateGoogleAuth;
  handleGoogleCallback: typeof osHandleGoogleCallback;
  generateThirdPartyToken: typeof osGenerateThirdPartyToken;
  getPrivateKey: typeof osGetPrivateKey;
  getPrivateKeyBytes: typeof osGetPrivateKeyBytes;
  getPublicKey: typeof osGetPublicKey;
};

export const realOpenSecret: OpenSecret = {
  configure: osConfigure,
  fetchUser: osFetchUser,
  signIn: osSignIn,
  signUp: osSignUp,
  signInGuest: osSignInGuest,
  signUpGuest: osSignUpGuest,
  signOut: osSignOut,
  convertGuestToUserAccount: osConvertGuestToUserAccount,
  changePassword: osChangePassword,
  requestNewVerificationCode: osRequestNewVerificationCode,
  verifyEmail: osVerifyEmail,
  requestPasswordReset: osRequestPasswordReset,
  confirmPasswordReset: osConfirmPasswordReset,
  initiateGoogleAuth: osInitiateGoogleAuth,
  handleGoogleCallback: osHandleGoogleCallback,
  generateThirdPartyToken: osGenerateThirdPartyToken,
  getPrivateKey: osGetPrivateKey,
  getPrivateKeyBytes: osGetPrivateKeyBytes,
  getPublicKey: osGetPublicKey,
};
```

> If `1.0.0-rc.0` renamed any export (e.g. the package name shows as `@agicash/opensecret-sdk` in the PR), re-check the published `index.d.ts` and adjust import names. `configure` now REQUIRES `storage` — confirmed in the PR.

- [ ] **Step 2: Port `src/internal/timeout.ts`** — copy `apps/web-wallet/app/lib/timeout.ts` verbatim (it is already React-free and uses only global `setTimeout`/`Date.now`/`clearTimeout`):

```ts
const maxSetTimeoutDelay = 2 ** 31 - 1;

export type LongTimeout = { id: ReturnType<typeof setTimeout> | null };

export function setLongTimeout(callback: () => void, delay: number): LongTimeout {
  const start = Date.now();
  const longTimeout: LongTimeout = { id: null };
  function scheduleNext() {
    const elapsed = Date.now() - start;
    if (elapsed >= delay) {
      callback();
    } else {
      const remaining = delay - elapsed;
      longTimeout.id = setTimeout(scheduleNext, Math.min(remaining, maxSetTimeoutDelay));
    }
  }
  scheduleNext();
  return longTimeout;
}

export function clearLongTimeout(longTimeout: LongTimeout) {
  if (longTimeout.id !== null) {
    clearTimeout(longTimeout.id);
    longTimeout.id = null;
  }
}
```

- [ ] **Step 3: Port `src/internal/random-password.ts`** — adapt `lib/password-generator.ts`: drop the `window.getMockPassword` test hook and use the global WebCrypto `crypto` (available in bun/node) instead of `window.crypto`:

```ts
type PasswordOptions = { letters?: boolean; numbers?: boolean; special?: boolean };

export function generateRandomPassword(
  length = 24,
  options: PasswordOptions = { letters: true, numbers: true, special: true },
): string {
  let charset = '';
  if (options.letters) charset += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.numbers) charset += '0123456789';
  if (options.special) charset += '!@#$%^&*()_+~';
  if (!charset) {
    throw new Error('At least one character set (letters, numbers, special) must be selected.');
  }
  const password: string[] = [];
  for (let i = 0; i < length; i++) {
    const randomIndex = crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }
  return password.join('');
}
```

> Note: this version is synchronous (the app's was `async` only to await the mock hook). Auth callers `await` is harmless on a sync return.

- [ ] **Step 4: Write tests** (`src/internal/timeout.test.ts` + `src/internal/random-password.test.ts`):

```ts
// timeout.test.ts
import { describe, expect, test } from 'bun:test';
import { clearLongTimeout, setLongTimeout } from './timeout';

describe('setLongTimeout', () => {
  test('fires after a short delay', async () => {
    let fired = false;
    setLongTimeout(() => { fired = true; }, 5);
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(true);
  });
  test('clearLongTimeout prevents firing', async () => {
    let fired = false;
    const t = setLongTimeout(() => { fired = true; }, 20);
    clearLongTimeout(t);
    await new Promise((r) => setTimeout(r, 40));
    expect(fired).toBe(false);
  });
});
```

```ts
// random-password.test.ts
import { describe, expect, test } from 'bun:test';
import { generateRandomPassword } from './random-password';

describe('generateRandomPassword', () => {
  test('respects length', () => {
    expect(generateRandomPassword(32).length).toBe(32);
  });
  test('throws when no charset selected', () => {
    expect(() => generateRandomPassword(8, {})).toThrow();
  });
  test('produces different values across calls', () => {
    expect(generateRandomPassword(32)).not.toBe(generateRandomPassword(32));
  });
});
```

- [ ] **Step 5: Run the tests.** Run: `cd packages/wallet-sdk && bun test src/internal/timeout.test.ts src/internal/random-password.test.ts`. Expected: PASS.

- [ ] **Step 6: Gate + commit.** Run (root): `bun run typecheck && bun run test`.

```bash
git add packages/wallet-sdk/src/internal/opensecret.ts packages/wallet-sdk/src/internal/timeout.ts packages/wallet-sdk/src/internal/random-password.ts packages/wallet-sdk/src/internal/timeout.test.ts packages/wallet-sdk/src/internal/random-password.test.ts
git commit -m "feat(wallet-sdk): Open Secret DI port + ported timeout/password utils"
```

---

## Task 5: Internal DB wrapper move + Supabase client + session-token provider

**Files:**
- Move: `apps/web-wallet/app/features/agicash-db/database.ts` + `features/agicash-db/json-models/` → `packages/wallet-sdk/src/internal/db/`
- Create: `packages/wallet-sdk/src/internal/db/client.ts`, `packages/wallet-sdk/src/internal/db/session-token.ts`
- Modify: `apps/web-wallet/app/features/agicash-db/database.ts` (re-export shim), `database.client.ts`
- Test: `packages/wallet-sdk/src/internal/db/session-token.test.ts`

- [ ] **Step 1: Move the type wrapper + json-models.** `git mv apps/web-wallet/app/features/agicash-db/json-models packages/wallet-sdk/src/internal/db/json-models`. Copy `features/agicash-db/database.ts` → `packages/wallet-sdk/src/internal/db/database.ts`. Fix its imports:
  - `DatabaseGenerated` import → relative to repo root: `import type { Database as DatabaseGenerated } from '../../../../../../supabase/database.types';` (count the `../` from `packages/wallet-sdk/src/internal/db/` to repo root: `packages/wallet-sdk/src/internal/db` → 4 up to repo root `packages/..`; verify the depth with `tsc` and adjust until it resolves).
  - json-models imports → `./json-models/...`.
  - `@agicash/cashu`/`@agicash/money` imports stay (workspace deps).
  - Keep exports: `AgicashDb`, all `AgicashDb*` row types, `isCashuAccount`, `isSparkAccount`, the `Database` MergeDeep type.

- [ ] **Step 2: Re-export shim in the app.** Replace `apps/web-wallet/app/features/agicash-db/database.ts` body with `export * from '@agicash/wallet-sdk/internal/db/database';` (so the ~40 app importers keep working unchanged). Verify `json-models` importers in the app now point at the SDK copy — if any app code imports `~/features/agicash-db/json-models/...` directly, add a matching re-export file or repoint those imports (grep `agicash-db/json-models` in `apps/web-wallet/app`).

- [ ] **Step 3: Write `src/internal/db/session-token.ts`** — the non-TanStack port of `supabase-session.ts` (generate the third-party token, cache it until 5s before its JWT `exp`):

```ts
import { jwtDecode } from 'jwt-decode';
import type { OpenSecret } from '../opensecret';

/** Provides the Supabase access token (Open Secret third-party JWT), cached
 * in-memory until 5s before expiry. `isLoggedIn` gates the network call. */
export class SessionTokenProvider {
  private cached: { token: string; expiresAtMs: number } | null = null;
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly os: Pick<OpenSecret, 'generateThirdPartyToken'>,
    private readonly isLoggedIn: () => Promise<boolean>,
  ) {}

  getToken = async (): Promise<string | null> => {
    if (this.cached && this.cached.expiresAtMs > Date.now()) {
      return this.cached.token;
    }
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetch().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  };

  private async fetch(): Promise<string | null> {
    if (!(await this.isLoggedIn())) return null;
    const { token } = await this.os.generateThirdPartyToken();
    const { exp } = jwtDecode<{ exp: number }>(token);
    this.cached = { token, expiresAtMs: (exp - 5) * 1000 };
    return token;
  }

  clear(): void {
    this.cached = null;
    this.inFlight = null;
  }
}
```

- [ ] **Step 4: Write `src/internal/db/client.ts`:**

```ts
import { createClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { AgicashDb, Database } from './database';

/** Constructs the Supabase client the SDK owns. Schema is fixed to `wallet`.
 * The access token is supplied lazily by the SessionTokenProvider. */
export function createAgicashDb(
  config: SdkConfig['supabase'],
  getAccessToken: () => Promise<string | null>,
): AgicashDb {
  const key = config.serviceRoleKey ?? config.anonKey;
  return createClient<Database>(config.url, key, {
    ...(config.serviceRoleKey
      ? {}
      : { accessToken: async () => (await getAccessToken()) ?? '' }),
    db: { schema: 'wallet' },
  });
}
```

> The production realtime `logger` block from `database.client.ts` is realtime config — deferred to Plan 4 (change-feed). `serviceRoleKey` mode skips the `accessToken` provider; full server-mode behavior is Plan 5.

- [ ] **Step 5: Write the failing test** (`src/internal/db/session-token.test.ts`) using `jwt-encode` (already in the root catalog) to mint test JWTs:

```ts
import { describe, expect, mock, test } from 'bun:test';
import sign from 'jwt-encode';
import { SessionTokenProvider } from './session-token';

const jwtWithExp = (secsFromNow: number) =>
  sign({ exp: Math.floor(Date.now() / 1000) + secsFromNow }, 'test');

describe('SessionTokenProvider', () => {
  test('returns null when not logged in (no network call)', async () => {
    const generateThirdPartyToken = mock(async () => ({ token: 'x' }));
    const p = new SessionTokenProvider({ generateThirdPartyToken }, async () => false);
    expect(await p.getToken()).toBeNull();
    expect(generateThirdPartyToken).not.toHaveBeenCalled();
  });

  test('fetches once and caches until near expiry', async () => {
    const token = jwtWithExp(3600);
    const generateThirdPartyToken = mock(async () => ({ token }));
    const p = new SessionTokenProvider({ generateThirdPartyToken }, async () => true);
    expect(await p.getToken()).toBe(token);
    expect(await p.getToken()).toBe(token);
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(1);
  });

  test('refetches when cached token is within 5s of expiry', async () => {
    const generateThirdPartyToken = mock(async () => ({ token: jwtWithExp(3) }));
    const p = new SessionTokenProvider({ generateThirdPartyToken }, async () => true);
    await p.getToken();
    await p.getToken();
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(2);
  });

  test('clear() forces a refetch', async () => {
    const generateThirdPartyToken = mock(async () => ({ token: jwtWithExp(3600) }));
    const p = new SessionTokenProvider({ generateThirdPartyToken }, async () => true);
    await p.getToken();
    p.clear();
    await p.getToken();
    expect(generateThirdPartyToken).toHaveBeenCalledTimes(2);
  });
});
```

(Add `jwt-encode` to wallet-sdk `devDependencies` as `"jwt-encode": "catalog:"` for this test.)

- [ ] **Step 6: Run the test.** Run: `cd packages/wallet-sdk && bun test src/internal/db/session-token.test.ts`. Expected: PASS after implementation.

- [ ] **Step 7: Gate + commit.** Run (root): `bun run typecheck && bun run test`. Expected: PASS (app still resolves `agicash-db/database` via the SDK shim; SDK DB types compile against the root generated types).

```bash
git add packages/wallet-sdk/src/internal/db apps/web-wallet/app/features/agicash-db packages/wallet-sdk/package.json
git commit -m "refactor(wallet-sdk): move agicash-db wrapper internal + supabase client + session-token provider"
```

---

## Task 6: KeyService (on-demand derivation, in-memory, disposable)

**Files:**
- Create: `packages/wallet-sdk/src/internal/keys.ts`
- Test: `packages/wallet-sdk/src/internal/keys.test.ts`

The five derivations (verified against the app):
- **cashu seed**: `getPrivateKey({ seed_phrase_derivation_path: "m/83696968'/39'/0'/12'/0'" })` → `mnemonicToSeedSync(mnemonic)` (`@scure/bip39`).
- **spark mnemonic**: `getPrivateKey({ seed_phrase_derivation_path: "m/83696968'/39'/0'/12'/1'" })` → `.mnemonic`.
- **encryption private key**: `getPrivateKeyBytes({ private_key_derivation_path: "m/10111099'/0'" })` → `hexToBytes(.private_key)` (`@noble/hashes/utils`).
- **encryption public key**: `getPublicKey('schnorr', { private_key_derivation_path: "m/10111099'/0'" })` → `.public_key` (hex).
- **cashu locking xpub**: `HDKey.fromMasterSeed(cashuSeed).derive("m/129372'/0'/0'").publicExtendedKey` (`@scure/bip32`).
- **spark identity public key**: `defaultExternalSigner(sparkMnemonic, null, network).identityPublicKey()` → `bytesToHex(bytes)` (`@agicash/breez-sdk-spark`).

- [ ] **Step 1: Write the failing test** (`src/internal/keys.test.ts`) — inject a fake OS port returning a fixed BIP39 mnemonic so derivations are deterministic; assert against precomputed vectors. Use the canonical test mnemonic `"abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"`.

```ts
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import { bytesToHex } from '@noble/hashes/utils';
import { describe, expect, mock, test } from 'bun:test';
import { KeyService } from './keys';

const MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const fakeOs = () => ({
  getPrivateKey: mock(async () => ({ mnemonic: MNEMONIC })),
  getPrivateKeyBytes: mock(async () => ({
    private_key: '00'.repeat(32),
  })),
  getPublicKey: mock(async () => ({ public_key: 'deadbeef' })),
});

describe('KeyService', () => {
  test('cashu seed = mnemonicToSeedSync of the OS mnemonic', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    expect(bytesToHex(await keys.getCashuSeed())).toBe(
      bytesToHex(mnemonicToSeedSync(MNEMONIC)),
    );
  });

  test('cashu locking xpub matches HDKey derivation', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    const expected = HDKey.fromMasterSeed(mnemonicToSeedSync(MNEMONIC))
      .derive("m/129372'/0'/0'").publicExtendedKey;
    expect(await keys.getCashuLockingXpub()).toBe(expected);
  });

  test('derivations are cached (one OS call each)', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    await keys.getCashuSeed();
    await keys.getCashuSeed();
    expect(os.getPrivateKey).toHaveBeenCalledTimes(1); // cashu path only
  });

  test('clear() drops cached material (next read re-derives)', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    await keys.getEncryptionPrivateKey();
    keys.clear();
    await keys.getEncryptionPrivateKey();
    expect(os.getPrivateKeyBytes).toHaveBeenCalledTimes(2);
  });

  test('spark identity public key derives from mnemonic via Breez signer (WASM loads headless)', async () => {
    const os = fakeOs();
    const keys = new KeyService(os);
    const pub = await keys.getSparkIdentityPublicKey('MAINNET');
    expect(pub).toMatch(/^[0-9a-f]{66}$/); // 33-byte compressed pubkey hex
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd packages/wallet-sdk && bun test src/internal/keys.test.ts`. Expected: FAIL.

- [ ] **Step 3: Write `src/internal/keys.ts`:**

```ts
import { defaultExternalSigner } from '@agicash/breez-sdk-spark';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { HDKey } from '@scure/bip32';
import { mnemonicToSeedSync } from '@scure/bip39';
import type { OpenSecret } from './opensecret';

const CASHU_SEED_PATH = "m/83696968'/39'/0'/12'/0'";
const SPARK_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/1'";
const ENCRYPTION_KEY_PATH = "m/10111099'/0'";
// 129372 = UTF-8 for 🥜 (NUT-13); DO NOT CHANGE without migrating users' xpub.
const CASHU_LOCKING_PATH = "m/129372'/0'/0'";

type Os = Pick<OpenSecret, 'getPrivateKey' | 'getPrivateKeyBytes' | 'getPublicKey'>;
type SparkNetwork = 'MAINNET' | 'REGTEST';

/** Derives and caches the user's key material in memory. Never persists.
 * `clear()` (called by Sdk.dispose) drops every reference. */
export class KeyService {
  private cashuSeed?: Promise<Uint8Array>;
  private sparkMnemonic?: Promise<string>;
  private encryptionPrivateKey?: Promise<Uint8Array>;
  private encryptionPublicKey?: Promise<string>;
  private cashuLockingXpub?: Promise<string>;
  private sparkIdentityPublicKey?: Promise<string>;

  constructor(private readonly os: Os) {}

  getCashuSeed(): Promise<Uint8Array> {
    this.cashuSeed ??= this.os
      .getPrivateKey({ seed_phrase_derivation_path: CASHU_SEED_PATH })
      .then((r) => mnemonicToSeedSync(r.mnemonic));
    return this.cashuSeed;
  }

  getSparkMnemonic(): Promise<string> {
    this.sparkMnemonic ??= this.os
      .getPrivateKey({ seed_phrase_derivation_path: SPARK_MNEMONIC_PATH })
      .then((r) => r.mnemonic);
    return this.sparkMnemonic;
  }

  getEncryptionPrivateKey(): Promise<Uint8Array> {
    this.encryptionPrivateKey ??= this.os
      .getPrivateKeyBytes({ private_key_derivation_path: ENCRYPTION_KEY_PATH })
      .then((r) => hexToBytes(r.private_key));
    return this.encryptionPrivateKey;
  }

  getEncryptionPublicKey(): Promise<string> {
    this.encryptionPublicKey ??= this.os
      .getPublicKey('schnorr', { private_key_derivation_path: ENCRYPTION_KEY_PATH })
      .then((r) => r.public_key);
    return this.encryptionPublicKey;
  }

  getCashuLockingXpub(): Promise<string> {
    this.cashuLockingXpub ??= this.getCashuSeed().then(
      (seed) => HDKey.fromMasterSeed(seed).derive(CASHU_LOCKING_PATH).publicExtendedKey,
    );
    return this.cashuLockingXpub;
  }

  getSparkIdentityPublicKey(network: SparkNetwork): Promise<string> {
    this.sparkIdentityPublicKey ??= this.getSparkMnemonic().then((mnemonic) => {
      const signer = defaultExternalSigner(
        mnemonic,
        null,
        network.toLowerCase() as 'mainnet' | 'regtest',
      );
      return bytesToHex(new Uint8Array(signer.identityPublicKey().bytes));
    });
    return this.sparkIdentityPublicKey;
  }

  clear(): void {
    this.cashuSeed = undefined;
    this.sparkMnemonic = undefined;
    this.encryptionPrivateKey = undefined;
    this.encryptionPublicKey = undefined;
    this.cashuLockingXpub = undefined;
    this.sparkIdentityPublicKey = undefined;
  }
}
```

- [ ] **Step 4: Run to verify it passes.** Run: `cd packages/wallet-sdk && bun test src/internal/keys.test.ts`. Expected: PASS.

> **Breez headless checkpoint:** `@agicash/breez-sdk-spark` resolves to its native **Node build** under bun (not WASM). Verified working during planning (`defaultExternalSigner(...).identityPublicKey()` → 33-byte pubkey, "Node.js storage automatically enabled"). If this regresses under bun in CI, STOP and surface it — Breez-headless is a base-phase requirement (the MCP wallet needs it).

- [ ] **Step 5: Gate + commit.** Run (root): `bun run typecheck && bun run test`.

```bash
git add packages/wallet-sdk/src/internal/keys.ts packages/wallet-sdk/src/internal/keys.test.ts
git commit -m "feat(wallet-sdk): KeyService (on-demand derivation, in-memory, disposable)"
```

---

## Task 7: User type + minimal user repository + default accounts

**Files:**
- Move: `apps/web-wallet/app/features/user/user.ts` → `packages/wallet-sdk/src/domains/user-types.ts`
- Create: `packages/wallet-sdk/src/internal/db/default-accounts.ts`, `packages/wallet-sdk/src/internal/db/user-repository.ts`
- Modify: `apps/web-wallet/app/features/user/user.ts` (re-export shim)
- Test: `packages/wallet-sdk/src/internal/db/user-repository.test.ts`

- [ ] **Step 1: (User type already moved in Task 2.)** `packages/wallet-sdk/src/domains/user-types.ts` exists (`User`/`FullUser`/`GuestUser`/`UserProfile` + the three guards) and the app's `features/user/user.ts` already re-exports it. Nothing to do here — just confirm it's present before the repository imports `User` from `../../domains/user-types`.

- [ ] **Step 2: Write `src/internal/db/default-accounts.ts`** — port `defaultAccounts` from `user-hooks.tsx:114`, replacing the `import.meta.env.MODE === 'development'` branch with a function parameter:

```ts
const PROD_DEFAULT_ACCOUNTS = [
  {
    type: 'spark',
    currency: 'BTC',
    name: 'Bitcoin',
    network: 'MAINNET',
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
] as const;

const TEST_DEFAULT_ACCOUNTS = [
  {
    type: 'cashu',
    currency: 'BTC',
    name: 'Testnut BTC',
    mintUrl: 'https://testnut.cashu.space',
    isTestMint: true,
    isDefault: false,
    purpose: 'transactional',
    expiresAt: null,
  },
  {
    type: 'cashu',
    currency: 'USD',
    name: 'Testnut USD',
    mintUrl: 'https://testnut.cashu.space',
    isTestMint: true,
    isDefault: true,
    purpose: 'transactional',
    expiresAt: null,
  },
] as const;

export function getDefaultAccounts(includeTestAccounts: boolean) {
  return includeTestAccounts
    ? [...PROD_DEFAULT_ACCOUNTS, ...TEST_DEFAULT_ACCOUNTS]
    : [...PROD_DEFAULT_ACCOUNTS];
}

export type DefaultAccountInput = ReturnType<typeof getDefaultAccounts>[number];
```

- [ ] **Step 3: Write `src/internal/db/user-repository.ts`** — port `ReadUserRepository.get`/`toUser` verbatim, and a **minimal** `WriteUserRepository` that builds the `upsert_user_with_accounts` payload and maps **only** the user row (no `accountRepository`, no `toAccount`, no wallet init). Also port `update` (used by UserDomain in Task 9).

```ts
import { normalizeMintUrl } from '@agicash/cashu';
import type { Currency } from '@agicash/money';
import { UniqueConstraintError } from '../../errors';
import type { AgicashDb, AgicashDbUser } from './database';
import { CashuAccountDetailsDbDataSchema } from './json-models/cashu-account-details-db-data';
import { SparkAccountDetailsDbDataSchema } from './json-models/spark-account-details-db-data';
import type { DefaultAccountInput } from './default-accounts';
import type { User } from '../../domains/user-types';

export type UpdateUser = {
  defaultBtcAccountId?: string;
  defaultUsdAccountId?: string | null;
  defaultCurrency?: Currency;
  username?: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

type UpsertUserInput = {
  id: string;
  email?: string | null;
  emailVerified: boolean;
  accounts: readonly DefaultAccountInput[];
  cashuLockingXpub: string;
  encryptionPublicKey: string;
  sparkIdentityPublicKey: string;
  termsAcceptedAt?: string;
  giftCardMintTermsAcceptedAt?: string;
};

export class ReadUserRepository {
  constructor(private readonly db: AgicashDb) {}

  async get(userId: string, options?: { abortSignal?: AbortSignal }): Promise<User> {
    const query = this.db.from('users').select().eq('id', userId);
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.single();
    if (error) throw new Error('Failed to get user', { cause: error });
    return ReadUserRepository.toUser(data);
  }

  async getByUsername(
    username: string,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User | null> {
    const query = this.db.from('users').select().eq('username', username);
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data, error } = await query.maybeSingle();
    if (error) throw new Error('Failed to get user by username', { cause: error });
    return data ? ReadUserRepository.toUser(data) : null;
  }

  static toUser(dbUser: AgicashDbUser): User {
    const commonData = {
      id: dbUser.id,
      username: dbUser.username,
      emailVerified: dbUser.email_verified,
      createdAt: dbUser.created_at,
      updatedAt: dbUser.updated_at,
      cashuLockingXpub: dbUser.cashu_locking_xpub,
      encryptionPublicKey: dbUser.encryption_public_key,
      sparkIdentityPublicKey: dbUser.spark_identity_public_key,
      defaultBtcAccountId: dbUser.default_btc_account_id ?? '',
      defaultUsdAccountId: dbUser.default_usd_account_id,
      defaultCurrency: dbUser.default_currency,
      termsAcceptedAt: dbUser.terms_accepted_at,
      giftCardMintTermsAcceptedAt: dbUser.gift_card_mint_terms_accepted_at,
    };
    if (dbUser.email) return { ...commonData, email: dbUser.email, isGuest: false };
    return { ...commonData, isGuest: true };
  }
}

export class WriteUserRepository {
  constructor(private readonly db: AgicashDb) {}

  /** Creates or reconciles the user (and seeds default account rows server-side).
   * Returns only the mapped User — account-row mapping/wallet init is Plan 3. */
  async upsert(user: UpsertUserInput, options?: { abortSignal?: AbortSignal }): Promise<User> {
    const accountsToAdd = user.accounts.map((account) => ({
      name: account.name,
      type: account.type,
      currency: account.currency,
      is_default: account.isDefault ?? false,
      purpose: account.purpose,
      details:
        account.type === 'cashu'
          ? CashuAccountDetailsDbDataSchema.parse({
              mint_url: normalizeMintUrl(account.mintUrl),
              is_test_mint: account.isTestMint,
              keyset_counters: {},
            })
          : SparkAccountDetailsDbDataSchema.parse({ network: account.network }),
    }));

    const query = this.db.rpc('upsert_user_with_accounts', {
      p_user_id: user.id,
      p_email: user.email ?? null,
      p_email_verified: user.emailVerified,
      p_accounts: accountsToAdd,
      p_cashu_locking_xpub: user.cashuLockingXpub,
      p_encryption_public_key: user.encryptionPublicKey,
      p_spark_identity_public_key: user.sparkIdentityPublicKey,
      p_terms_accepted_at: user.termsAcceptedAt,
      p_gift_card_mint_terms_accepted_at: user.giftCardMintTermsAcceptedAt,
    });
    if (options?.abortSignal) query.abortSignal(options.abortSignal);

    const { data, error } = await query;
    if (error) throw new Error('Failed to upsert user', { cause: error });
    return ReadUserRepository.toUser(data.user);
  }

  async update(
    userId: string,
    data: UpdateUser,
    options?: { abortSignal?: AbortSignal },
  ): Promise<User> {
    const query = this.db
      .from('users')
      .update({
        default_btc_account_id: data.defaultBtcAccountId,
        default_usd_account_id: data.defaultUsdAccountId,
        default_currency: data.defaultCurrency,
        username: data.username,
        terms_accepted_at: data.termsAcceptedAt,
        gift_card_mint_terms_accepted_at: data.giftCardMintTermsAcceptedAt,
      })
      .eq('id', userId)
      .select();
    if (options?.abortSignal) query.abortSignal(options.abortSignal);
    const { data: updated, error } = await query.single();
    if (error) {
      if (error.code === '23505') throw new UniqueConstraintError(error.message);
      throw new Error('Failed to update user', { cause: error });
    }
    return ReadUserRepository.toUser(updated);
  }
}
```

> The `is_default` mapping note: the original code used `account.isDefault ?? false`. `DefaultAccountInput` may not carry `isDefault` on every member — keep the `?? false`. If `tsc` complains the union lacks `isDefault`/`mintUrl`/`isTestMint`/`network`, narrow by `account.type === 'cashu'` (as written) and access cashu-only fields inside that branch; the spark branch only reads `network`.

- [ ] **Step 4: Write the failing test** (`src/internal/db/user-repository.test.ts`) — `toUser` is pure; test it directly with a synthetic `AgicashDbUser` row (full vs guest). Test `upsert` against a hand-rolled fake `db` whose `.rpc()` captures the payload and returns a row.

```ts
import { describe, expect, mock, test } from 'bun:test';
import type { AgicashDb, AgicashDbUser } from './database';
import { ReadUserRepository, WriteUserRepository } from './user-repository';

const row = (overrides: Partial<AgicashDbUser> = {}): AgicashDbUser =>
  ({
    id: 'u1',
    username: 'alice',
    email: 'a@b.c',
    email_verified: true,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    cashu_locking_xpub: 'xpub',
    encryption_public_key: 'enc',
    spark_identity_public_key: 'spark',
    default_btc_account_id: 'btc',
    default_usd_account_id: null,
    default_currency: 'BTC',
    terms_accepted_at: null,
    gift_card_mint_terms_accepted_at: null,
    ...overrides,
  }) as AgicashDbUser;

describe('ReadUserRepository.toUser', () => {
  test('maps a full user', () => {
    const u = ReadUserRepository.toUser(row());
    expect(u).toMatchObject({ id: 'u1', isGuest: false, email: 'a@b.c' });
  });
  test('maps a guest (no email)', () => {
    const u = ReadUserRepository.toUser(row({ email: null }));
    expect(u.isGuest).toBe(true);
    expect('email' in u).toBe(false);
  });
});

describe('WriteUserRepository.upsert', () => {
  test('builds the RPC payload and maps only the user row', async () => {
    const rpc = mock(async () => ({ data: { user: row(), accounts: [] }, error: null }));
    const db = { rpc } as unknown as AgicashDb;
    const repo = new WriteUserRepository(db);
    const result = await repo.upsert({
      id: 'u1',
      email: 'a@b.c',
      emailVerified: true,
      accounts: [
        { type: 'spark', currency: 'BTC', name: 'Bitcoin', network: 'MAINNET', isDefault: true, purpose: 'transactional', expiresAt: null },
      ],
      cashuLockingXpub: 'xpub',
      encryptionPublicKey: 'enc',
      sparkIdentityPublicKey: 'spark',
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fnName, payload] = rpc.mock.calls[0];
    expect(fnName).toBe('upsert_user_with_accounts');
    expect(payload.p_user_id).toBe('u1');
    expect(payload.p_accounts[0].type).toBe('spark');
    expect(result.id).toBe('u1');
  });
});
```

- [ ] **Step 5: Run + implement to green.** Run: `cd packages/wallet-sdk && bun test src/internal/db/user-repository.test.ts`. Expected: PASS.

- [ ] **Step 6: Gate + commit.** Run (root): `bun run typecheck && bun run test`.

```bash
git add packages/wallet-sdk/src/internal/db/user-repository.ts packages/wallet-sdk/src/internal/db/default-accounts.ts packages/wallet-sdk/src/internal/db/user-repository.test.ts packages/wallet-sdk/src/domains/user-types.ts apps/web-wallet/app/features/user/user.ts packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): User type + minimal user repository + default accounts"
```

---

## Task 8: Auth domain + Sdk.create + dispose

**Files:**
- Create: `packages/wallet-sdk/src/domains/auth.ts`, `packages/wallet-sdk/src/sdk.ts`
- Test: `packages/wallet-sdk/src/domains/auth.test.ts`

**Auth design (ported from `features/user/auth.ts`, React stripped):**
- `isLoggedIn()`: read `refresh_token` via the host `StorageAdapter`, decode `exp`, valid if `exp*1000 > now`. (Same tokens OS persists through the bridge.)
- Each sign-in path: call the OS fn → OS writes tokens via the StorageProvider → `ensureUser(authUser)` → emit `auth:signed-in` → return `User`.
- `ensureUser(authUser)`: derive `{encryptionPublicKey, cashuLockingXpub, sparkIdentityPublicKey}` from `KeyService`, `upsert(...)`, then `read(userId)`; returns `User`. (Network = `MAINNET` for identity-key derivation, matching the app's TODO at `_protected.tsx:103`.)
- `signOut()`: OS `signOut` → `keys.clear()` → `sessionToken.clear()` → `storageSession.clearSession()` → emit `auth:signed-out`.
- `signInGuest()` (spec name) = the app's `signUpGuest` create-or-restore via `guestAccountStorage` over the host adapter.
- `upgradeGuest()` = `convertGuestToUserAccount`.
- Session-expiry: schedule `setLongTimeout` at `(refresh exp - 5s)`; on fire — guest → `signInGuest()` (auto-extend, reschedule); full user → `signOut()` + emit `auth:session-expired`; any failure → emit `auth:session-expired`. Replaces `window.location.reload()`.
- OAuth: `beginGoogle()` returns `{ authUrl }` (host performs the redirect); `completeOAuth(params)` calls `handleGoogleCallback(code, state, '')` then `ensureUser`. The app's `sessionId`/`oauthLoginSession` URL-stitching stays host-side (it is browser-redirect bookkeeping); the SDK accepts `{ code, state }`.

- [ ] **Step 1: Write the failing test** (`src/domains/auth.test.ts`) — construct `AuthDomain` with fakes (OS port, KeyService, repos, EventBus, in-memory StorageAdapter). Assert orchestration + events. Example slice:

```ts
import { describe, expect, mock, test } from 'bun:test';
import sign from 'jwt-encode';
import { EventBus } from '../internal/event-bus';
import { inMemoryStorageAdapter } from '../../storage/memory';
import type { SdkCoreEventMap } from '../events';
import { AuthDomain } from './auth';

const refreshJwt = (secs: number) =>
  sign({ exp: Math.floor(Date.now() / 1000) + secs, sub: 'u1', aud: 'refresh' }, 's');

const makeAuth = () => {
  const events = new EventBus<SdkCoreEventMap>();
  const adapter = inMemoryStorageAdapter();
  const os = {
    signIn: mock(async () => { await adapter.set('refresh_token', refreshJwt(3600)); return { id: 'u1' }; }),
    signOut: mock(async () => { await adapter.remove('refresh_token'); }),
    fetchUser: mock(async () => ({ user: { id: 'u1', email: 'a@b.c', email_verified: true } })),
    // ...other fns stubbed as needed
  };
  const keys = {
    getEncryptionPublicKey: mock(async () => 'enc'),
    getCashuLockingXpub: mock(async () => 'xpub'),
    getSparkIdentityPublicKey: mock(async () => 'spark'),
    clear: mock(() => {}),
  };
  const userRepo = {
    upsert: mock(async () => ({ id: 'u1', isGuest: false, email: 'a@b.c' })),
    get: mock(async () => ({ id: 'u1', isGuest: false, email: 'a@b.c' })),
  };
  const auth = new AuthDomain({ os, keys, writeUserRepo: userRepo, readUserRepo: userRepo, events, storage: adapter, sessionToken: { clear: () => {} }, storageSession: { clearSession: () => {} }, includeTestAccounts: false, onSignedIn: () => {}, onSignedOut: () => {} } as any);
  return { auth, events, os, keys, userRepo };
};

describe('AuthDomain', () => {
  test('signIn authenticates, reconciles a User, emits auth:signed-in', async () => {
    const { auth, events, userRepo } = makeAuth();
    const seen: unknown[] = [];
    events.on('auth:signed-in', (p) => seen.push(p));
    const user = await auth.signIn({ email: 'a@b.c', password: 'pw' });
    expect(user.id).toBe('u1');
    expect(userRepo.upsert).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ user }]);
  });

  test('signOut clears keys + session and emits auth:signed-out', async () => {
    const { auth, events, keys } = makeAuth();
    await auth.signIn({ email: 'a@b.c', password: 'pw' });
    let signedOut = false;
    events.on('auth:signed-out', () => { signedOut = true; });
    await auth.signOut();
    expect(keys.clear).toHaveBeenCalled();
    expect(signedOut).toBe(true);
  });
});
```

> Flesh out the fakes for every method you implement; keep the fake OS port shaped like the real `OpenSecret` type. The session-expiry path can be unit-tested by injecting a tiny clock or by setting a near-future `exp` and awaiting the timer (keep delays a few ms).

- [ ] **Step 2: Run to verify it fails.** Run: `cd packages/wallet-sdk && bun test src/domains/auth.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/auth.ts`** — `AuthDomain` class taking all collaborators via a single `deps` object (DI). Methods (return types per spec): `signIn`, `signUp`, `signInGuest`, `upgradeGuest`, `signOut`, `changePassword`, `requestEmailVerification`, `verifyEmail`, `beginGoogle`, `completeOAuth`, plus `requestPasswordReset`/`confirmPasswordReset` (superset — the web app depends on these; flagged below). Include `isLoggedIn()`, the private `ensureUser()`, `guestAccountStorage` over the adapter (key `agicash.guest-account`, JSON `{id,password}`), and `scheduleSessionExpiry()`/`cancelSessionExpiry()` using `setLongTimeout`. Use `generateRandomPassword` for guest signup + reset secret, and `computeSHA256` (`@agicash/ecies`) for the reset hash. Map OS thrown errors into `DomainError` where the app surfaces user-facing messages (sign-in failures), else rethrow.

> Implementation reference: mirror `features/user/auth.ts` exactly for the OS call sequencing and the guest create-or-restore logic; replace `refreshSession()` (invalidateQueries + navigate) with `ensureUser()` + `emit('auth:signed-in')`; replace `useHandleSessionExpiry` with `scheduleSessionExpiry()`. Read each OS signature from `index.d.ts` before calling.

- [ ] **Step 4: Implement `src/sdk.ts`:**

```ts
import { createAgicashDb } from './internal/db/client';
import { ReadUserRepository, WriteUserRepository } from './internal/db/user-repository';
import { SessionTokenProvider } from './internal/db/session-token';
import { EventBus } from './internal/event-bus';
import { KeyService } from './internal/keys';
import { createOpenSecretStorage } from './internal/opensecret-storage';
import { realOpenSecret, type OpenSecret } from './internal/opensecret';
import { AuthDomain } from './domains/auth';
import { UserDomain } from './domains/user';
import type { SdkConfig } from './config';
import type { SdkCoreEventMap } from './events';

export class Sdk {
  readonly auth: AuthDomain;
  readonly user: UserDomain;
  private readonly events: EventBus<SdkCoreEventMap>;
  private readonly keys: KeyService;
  private readonly sessionToken: SessionTokenProvider;

  private constructor(parts: {
    auth: AuthDomain;
    user: UserDomain;
    events: EventBus<SdkCoreEventMap>;
    keys: KeyService;
    sessionToken: SessionTokenProvider;
  }) {
    this.auth = parts.auth;
    this.user = parts.user;
    this.events = parts.events;
    this.keys = parts.keys;
    this.sessionToken = parts.sessionToken;
  }

  static async create(
    config: SdkConfig,
    // test seam: override the OS port
    deps: { openSecret?: OpenSecret } = {},
  ): Promise<Sdk> {
    const os = deps.openSecret ?? realOpenSecret;
    const events = new EventBus<SdkCoreEventMap>();
    const storage = createOpenSecretStorage(config.storage, config.sessionStorage);

    os.configure({
      apiUrl: config.openSecret.url,
      clientId: config.openSecret.clientId,
      storage,
    });

    const keys = new KeyService(os);

    const isLoggedIn = async () => {
      const refresh = await config.storage.get('refresh_token');
      if (!refresh) return false;
      try {
        const { exp } = (await import('jwt-decode')).jwtDecode<{ exp: number }>(refresh);
        return !!exp && exp * 1000 > Date.now();
      } catch {
        return false;
      }
    };

    const sessionToken = new SessionTokenProvider(os, isLoggedIn);
    const db = createAgicashDb(config.supabase, sessionToken.getToken);
    const readUserRepo = new ReadUserRepository(db);
    const writeUserRepo = new WriteUserRepository(db);

    const auth = new AuthDomain({
      os, keys, events, storage: config.storage,
      readUserRepo, writeUserRepo, sessionToken,
      storageSession: storage,
      includeTestAccounts: config.includeTestAccounts ?? false,
      isLoggedIn,
    });
    const user = new UserDomain({ readUserRepo, writeUserRepo, isLoggedIn });

    await auth.initialize(); // restore session-expiry timer if a session exists

    return new Sdk({ auth, user, events, keys, sessionToken });
  }

  on<E extends keyof SdkCoreEventMap>(
    event: E,
    cb: (payload: SdkCoreEventMap[E]) => void,
  ): () => void {
    return this.events.on(event, cb);
  }

  /** Coarse, idempotent catch-up hint. No realtime/processors yet (Plan 4) — no-op. */
  async resync(): Promise<void> {}

  async dispose(): Promise<void> {
    this.auth.cancelSessionExpiry();
    this.keys.clear();
    this.sessionToken.clear();
    this.events.clear();
  }
}
```

> Replace the dynamic `import('jwt-decode')` with a top-level `import { jwtDecode } from 'jwt-decode'` if `tsc`/bun prefer it (dynamic import shown only to keep the snippet self-contained).

- [ ] **Step 5: Run to verify it passes.** Run: `cd packages/wallet-sdk && bun test src/domains/auth.test.ts`. Expected: PASS.

- [ ] **Step 6: Barrel exports.** In `src/index.ts`: `export { Sdk } from './sdk';` and `export type { SdkCoreEventMap, BackgroundState } from './events';`.

- [ ] **Step 7: Gate + commit.** Run (root): `bun run typecheck && bun run test`.

```bash
git add packages/wallet-sdk/src/domains/auth.ts packages/wallet-sdk/src/sdk.ts packages/wallet-sdk/src/domains/auth.test.ts packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): auth state machine + Sdk.create/dispose"
```

---

## Task 9: UserDomain (get / updateUsername / acceptTerms)

**Files:**
- Create: `packages/wallet-sdk/src/domains/user.ts`
- Test: `packages/wallet-sdk/src/domains/user.test.ts`

- [ ] **Step 1: Write the failing test** (`src/domains/user.test.ts`):

```ts
import { describe, expect, mock, test } from 'bun:test';
import { UserDomain } from './user';

const user = { id: 'u1', isGuest: false, email: 'a@b.c', username: 'alice' };

describe('UserDomain', () => {
  test('get returns null when not logged in', async () => {
    const domain = new UserDomain({
      readUserRepo: { get: mock(async () => user) } as any,
      writeUserRepo: {} as any,
      isLoggedIn: async () => false,
    });
    expect(await domain.get()).toBeNull();
  });

  test('get reads the current user when logged in', async () => {
    const get = mock(async () => user);
    const fetchUser = mock(async () => ({ user: { id: 'u1' } }));
    const domain = new UserDomain({
      readUserRepo: { get } as any,
      writeUserRepo: {} as any,
      isLoggedIn: async () => true,
      getCurrentUserId: async () => 'u1',
    });
    expect((await domain.get())?.id).toBe('u1');
    expect(get).toHaveBeenCalledWith('u1');
  });

  test('updateUsername delegates to repo.update', async () => {
    const update = mock(async () => ({ ...user, username: 'bob' }));
    const domain = new UserDomain({
      readUserRepo: {} as any,
      writeUserRepo: { update } as any,
      isLoggedIn: async () => true,
      getCurrentUserId: async () => 'u1',
    });
    const result = await domain.updateUsername('bob');
    expect(result.username).toBe('bob');
    expect(update).toHaveBeenCalledWith('u1', { username: 'bob' });
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Run: `cd packages/wallet-sdk && bun test src/domains/user.test.ts`. Expected: FAIL.

- [ ] **Step 3: Implement `src/domains/user.ts`:**

```ts
import type { ReadUserRepository, WriteUserRepository } from '../internal/db/user-repository';
import type { User } from './user-types';

type Deps = {
  readUserRepo: ReadUserRepository;
  writeUserRepo: WriteUserRepository;
  isLoggedIn: () => Promise<boolean>;
  getCurrentUserId?: () => Promise<string | null>;
};

export class UserDomain {
  constructor(private readonly deps: Deps) {}

  /** Current user, or null when signed out. */
  async get(): Promise<User | null> {
    if (!(await this.deps.isLoggedIn())) return null;
    const id = await this.deps.getCurrentUserId?.();
    if (!id) return null;
    return this.deps.readUserRepo.get(id);
  }

  async updateUsername(username: string): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, { username });
  }

  async acceptTerms(): Promise<User> {
    const id = await this.requireUserId();
    return this.deps.writeUserRepo.update(id, {
      termsAcceptedAt: new Date().toISOString(),
    });
  }

  // setDefaultAccount / setDefaultCurrency are account-dependent (DB constraint
  // requires a default account per currency) -> Plan 3, with the accounts domain.

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId?.();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

> Wire `getCurrentUserId` in `Sdk.create` (e.g. derive from the OS `fetchUser()` id, cached). Pass the same accessor into `UserDomain` and reuse it inside `AuthDomain.ensureUser`.

- [ ] **Step 4: Run + green.** Run: `cd packages/wallet-sdk && bun test src/domains/user.test.ts`. Expected: PASS.

- [ ] **Step 5: Gate + commit.** Run (root): `bun run typecheck && bun run test`.

```bash
git add packages/wallet-sdk/src/domains/user.ts packages/wallet-sdk/src/domains/user.test.ts packages/wallet-sdk/src/sdk.ts
git commit -m "feat(wallet-sdk): UserDomain (get/updateUsername/acceptTerms)"
```

---

## Task 10: Headless sign-in smoke + completeness sweep

**Files:**
- Create: `packages/wallet-sdk/examples/headless-auth.ts` (documented, NOT in the CI gate)
- Create: `packages/wallet-sdk/README.md` (how to run the smoke against the local stack)

- [ ] **Step 1: Write `examples/headless-auth.ts`** — a runnable script that signs in (guest) against the local stack and prints the reconciled `User`, then disposes:

```ts
import { Sdk, inMemoryStorageAdapter } from '@agicash/wallet-sdk';

const sdk = await Sdk.create({
  openSecret: { url: process.env.OPEN_SECRET_URL!, clientId: process.env.OPEN_SECRET_CLIENT_ID! },
  supabase: { url: process.env.SUPABASE_URL!, anonKey: process.env.SUPABASE_ANON_KEY! },
  storage: inMemoryStorageAdapter(),
  includeTestAccounts: true,
});

const user = await sdk.auth.signInGuest();
console.log('signed in as', user.id, 'guest:', user.isGuest);
console.log('current user:', await sdk.user.get());
await sdk.dispose();
```

- [ ] **Step 2: Document running it.** In `README.md`, note: requires the local Supabase + Open Secret stack and env vars (the worktree has no app `.env`; obtain local values via `SELF_SIGNED_CERT_PATH=../certs/ci-localhost-cert.pem bun supabase status -o env` and `NODE_EXTRA_CA_CERTS` set to the mkcert root CA for local TLS). This smoke is **not** part of `bun run test` — it is a manual base-phase validation (the first end-to-end headless auth, per the memory's pending core-runtime checks).

- [ ] **Step 3: Completeness sweep.** Run:
  - `cd packages/wallet-sdk && grep -rn "import.meta.env\|window\.\|document\.\|localStorage\|useState\|useEffect\|from 'react'\|@tanstack" src/` — expect **zero** hits in `src/` (only `storage/browser.ts` may reference `window`). Any hit is a headless leak — fix it.
  - Confirm `@tanstack/query-core`/`react-query` is NOT a dependency of wallet-sdk (engine seams deferred).

- [ ] **Step 4: Final gate.** Run (root): `bun run typecheck && bun run test`. Expected: PASS across all packages.

- [ ] **Step 5: Optional live smoke (ask the user first).** If the local stack is available, run `cd packages/wallet-sdk && OPEN_SECRET_URL=... bun examples/headless-auth.ts` and confirm it prints a `User`. Report the outcome; do NOT gate the branch on it.

- [ ] **Step 6: Commit.**

```bash
git add packages/wallet-sdk/examples packages/wallet-sdk/README.md
git commit -m "docs(wallet-sdk): headless auth example + smoke instructions"
```

---

## Self-Review (run against the spec before declaring done)

**Spec coverage (Shared foundation → Entry point/Auth/Error/Lib sections):**
- `Sdk.create`/`SdkConfig`/`StorageAdapter`/`on`/`resync`/`dispose` → Tasks 3, 8. ✓ (`resync` is a defined no-op; full catch-up is Plan 4 — noted.)
- Auth state machine (10 methods + OAuth split + session-expiry → `auth:session-expired`) → Task 8. ✓ (password reset added as a flagged superset.)
- Key derivation (cashu seed / spark mnemonic / encryption key; + locking xpub + spark identity) → Task 6. ✓
- Error taxonomy moved + exported → Task 1. ✓
- Event bus + `SdkCoreEventMap` → Task 2. ✓ (only `auth:*` emitted here; lifecycle/connection/background in later plans.)
- agicash-db wrapper moved internal → Task 5. ✓
- `User` reconciliation returning the spec's `User` → Tasks 7-8. ✓ (account-row mapping deferred — noted.)
- Server-mode (`serviceRoleKey`) → client construction recognizes it (Task 5); domain restrictions are Plan 5. ✓ (acknowledged, not fully built.)

**Type consistency:** `OpenSecret` port shape (Task 4) is reused by `KeyService` (Task 6), `SessionTokenProvider` (Task 5), `AuthDomain` (Task 8). `User` type (Task 7) is referenced by `events.ts` (Task 2) and both domains. `StorageAdapter` (Task 3) flows into `createOpenSecretStorage` and `Sdk.create`. `getDefaultAccounts`/`DefaultAccountInput` (Task 7) feed `WriteUserRepository.upsert`. Verify these names stay identical during execution.

**Placeholder scan:** no "TBD"/"handle errors appropriately"/"similar to Task N" — every code step shows code; relocation steps name exact source `file:line` to port.

**Resolved with the user (2026-06-15):**
1. **Breez dependency — accepted.** Required headless (user creation needs `sparkIdentityPublicKey`); resolves to the native **Node build** under bun (NOT the browser WASM build) and is **verified working under bun**. Full `connect()` still validated in Plan 3.
2. **Session scope — web uses `window.sessionStorage`.** The web host passes `browserSessionStorageAdapter` as `config.sessionStorage` (enclave handshake survives reloads); headless omits it → in-memory.
3. `requestPasswordReset`/`confirmPasswordReset` included as a spec superset — accepted.

**Carry into execution:**
4. Verify exact `@agicash/opensecret@1.0.0-rc.0` export names against the published `index.d.ts` at Task 0 (the storage PR referenced the package as `@agicash/opensecret-sdk`; adjust import names/`configure` shape if they shifted).
