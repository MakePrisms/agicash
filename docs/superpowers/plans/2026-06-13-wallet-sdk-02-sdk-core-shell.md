# SDK Core Shell (`@agicash/wallet-sdk` S2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the PR1 contract `declare class Sdk` into a real, framework-free SDK core shell — event emitter, error classification, the OpenSecret/Supabase/Breez connection layer, crypto/key-derivation primitives, vendored db-types — with all 11 domains stubbed (`NotImplementedError`).

**Architecture:** The SDK is the sole owner of external clients; the consumer supplies only `SdkConfig`. This slice builds the *connections + primitives*, not the domain business logic (auth flows, repositories, send/receive are later slices). It adopts `@agicash/opensecret@1.0.0-rc.0`'s pluggable `StorageProvider` (so the SDK is MCP-capable), bumping the shared catalog and adapting the web's single `configure()` call. Domains return `NotImplementedError` until their slices land.

**Tech Stack:** Bun workspaces, TypeScript 5.9.3 (`moduleResolution: Bundler`, SDK `lib: ["ES2022"]`), `@agicash/opensecret@1.0.0-rc.0`, `@supabase/supabase-js@2.95.2`, `@agicash/breez-sdk-spark@0.13.5-1`, `@noble/*`, `@scure/bip32`, `@stablelib/base64`, `type-fest`, `bun:test`.

---

## Scope boundary (read first)

**In scope (S2):** event emitter · `classify()` + `NotImplementedError` · `internal/connections/{open-secret,supabase-client,supabase-session,breez}` · `internal/realtime` (the self-healing manager) · `internal/crypto` (sha256, password, key-derivation paths, signing, ECIES) · `internal/db` (vendored generated types) · `Sdk.create/destroy` wiring the connection bundle · the 11 domains **stubbed**.

**Out of scope (later slices):** auth flows / session resolver (S3) · repositories + domain logic (S3+) · cashu/spark send-receive (S5/S6) · the orchestrator incl. the stale-balance `synced` re-read + nutshell-#788 change refetch (S7) · the leader-election background processor (S9) · `ServerSdk`/`createServer` (S10). Breez `connectBreez(...)` is *built* here but only *called* per-account in S6 — `Sdk.create` does NOT connect Breez.

---

## Decisions (locked with the owner 2026-06-15)

- **D-OS1 — Adopt `@agicash/opensecret@1.0.0-rc.0` via a shared-catalog bump.** `0.1.0` hard-wires token storage to `localStorage` (browser-only); the rc adds the pluggable `StorageProvider`. All 19 web-used OpenSecret functions are signature-identical between `0.1.0` and the rc; the *only* break is `OpenSecretConfig` now requiring `storage`. So the catalog bump's entire web impact is **one change**: pass `storage: browserStorage` to the web's single `configure()` call.
- **D-OS2 — Targeted install-quarantine exclude.** The rc was published 2026-06-15; `bunfig.toml` `minimumReleaseAge = 259200` (3 days) would block it. Add `@agicash/opensecret` to `minimumReleaseAgeExcludes` (keeps the 3-day quarantine for every *other* package) so the rc installs now.
- **D-OS3 — `SdkConfig.storage` is the rc's `StorageProvider`**, i.e. `{ persistent: KeyValueStore; session: KeyValueStore }` (each `{ getItem, setItem, removeItem }`, string, sync-or-async) — NOT a flat adapter. The placeholder `StorageAdapter` in `types/dependencies.ts` is deleted; `config.ts` imports `StorageProvider` from `@agicash/opensecret`.
- **D1 — OpenSecret key APIs reach the SDK by dependency injection.** `getPrivateKey`/`getPrivateKeyBytes`/`getPublicKey`/`signMessage` are imported by `internal/connections/open-secret` and exposed to `internal/crypto` via a `KeyProvider` so crypto stays free of a hard OpenSecret import. (BIP-85 derivation runs server-side in the enclave; the SDK passes derivation paths.)
- **D2 — Domains are stubbed via one `notImplementedDomain<T>()` Proxy helper** (cast to the interface), not 40 hand-written throwing methods. Each later slice replaces one stub.
- **D3 — The realtime manager + ECIES + db-types are vendored** (they are already framework-free); everything else is written fresh (no lifting from `sdk/*` prototype branches).
- **CI gate:** `bun run typecheck` + `bun run test` (NOT `fix:all`). Commit per task locally; do not push.

---

## Grounding facts (verified 2026-06-15 — authoritative)

**OpenSecret rc (`1.0.0-rc.0`, inspected from the npm tarball):**
- `configure(options: OpenSecretConfig): void`; `OpenSecretConfig = { apiUrl: string; clientId: string; storage: StorageProvider }`.
- `export declare const browserStorage: StorageProvider` (maps to `localStorage`/`sessionStorage`).
- `StorageProvider = { persistent: KeyValueStore; session: KeyValueStore }`; `KeyValueStore = { getItem(k): string|null|Promise<…>; setItem(k,v): void|Promise<void>; removeItem(k): void|Promise<void> }`.
- All web-used fns present & signature-identical to 0.1.0: `signIn, signUp, signInGuest, signUpGuest, signOut, convertGuestToUserAccount, initiateGoogleAuth, handleGoogleCallback, requestPasswordReset, confirmPasswordReset, verifyEmail, requestNewVerificationCode, generateThirdPartyToken, getPrivateKey, getPrivateKeyBytes, getPublicKey, signMessage, fetchUser` (+ type `UserResponse`).

**Web `configure()` call** — `apps/web-wallet/app/entry.client.tsx:33-36`:
```ts
configure({ apiUrl: openSecretApiUrl, clientId: openSecretClientId });
```

**Supabase** (`@supabase/supabase-js@2.95.2`):
- Browser: `createClient<Database>(url, anonKey, { accessToken: getToken, db: { schema: 'wallet' }, realtime: {…} })` — uses the async `accessToken` option (NOT `setSession`); no `persistSession`/`autoRefresh`. `database.client.ts`.
- `accessToken` → `generateThirdPartyToken()` (OpenSecret JWT → Supabase JWT), cached with expiry-aware staleness (`(exp-5)*1000 - now`); returns `null` when logged out. `supabase-session.ts`.
- Server: `createClient<Database>(url, serviceRoleKey, { db: { schema: 'wallet' } })` — RLS bypass, no session. `database.server.ts`.
- Realtime manager (`app/lib/supabase/supabase-realtime-manager.ts` + `supabase-realtime-channel.ts` + `supabase-realtime-channel-builder.ts`): framework-free; serial resubscribe queue, backoff `[0,100,500,1000,3000,6000,10000,20000,30000]`ms ×9, reference-counted channels, `setOnlineStatus`/`setActiveStatus` seams driven externally; `refreshSessionIfNeeded` calls `realtimeClient.setAuth()` before each subscribe. Constructor takes a `RealtimeClient`.
- Gotchas: LAN-rewrite + `window.agicashRealtime` debug write are browser-only → drop in SDK (SDK gets a resolved URL); keep the resubscribe queue serial; no env reads in the SDK.

**Breez/Spark** (`@agicash/breez-sdk-spark@0.13.5-1`):
- `ensureBreezWasm()` single-flight (`wasmInitPromise ??= initBreezWasm()`), guards `typeof WebAssembly === 'undefined'` (throws `WebAssemblyUnavailableError`). `app/lib/spark/wasm.ts`.
- `initLogging` single-global-subscriber guard (Rust `tracing`): module-scoped `loggingStatus` — `if (loggingStatus !== undefined) return` (any prior status, incl. `'initializing'`/`'failed'`, makes it a no-op; failure does NOT retry). `app/features/shared/spark.ts:37-56`. **Regression-relevant (spec §8).**
- `connect({ config: { ...defaultConfig(network), apiKey, lnurlDomain: undefined, privateEnabledDefault: true, optimizationConfig: { autoEnabled: true, multiplicity: 2 } }, seed: { type: 'mnemonic', mnemonic }, storageDir })`. `network` is `SparkNetwork.toLowerCase()` (`'mainnet'|'regtest'`). `storageDir` = `'./.spark-data'` (browser) / `'/tmp/.spark-data'` (server).

**Crypto / key derivation:**
- BIP-85 child mnemonics (server-side via OpenSecret `getPrivateKey({ seed_phrase_derivation_path })`): cashu `m/83696968'/39'/0'/12'/0'`, spark `m/83696968'/39'/0'/12'/1'` (`account-cryptography.ts`; indexes `{cashu:0, spark:1}`).
- Encryption key (BIP-32 via `getPrivateKeyBytes`/`getPublicKey` `{ private_key_derivation_path }`): `m/10111099'/0'` (`encryption.ts:15`).
- `sha256` (`app/lib/sha256.ts`): `crypto.subtle.digest('SHA-256')` → hex (async). Password (`app/lib/password-generator.ts`): `crypto.getRandomValues` (use `globalThis.crypto`). xpub→child pubkey via `@scure/bip32` `HDKey.fromExtendedKey(xpub).derive(path)`.
- ECIES (`app/lib/ecies/ecies.ts`): `eciesEncrypt/eciesDecrypt/eciesEncryptBatch/eciesDecryptBatch`; format `[ephemeralPubKey(33)‖nonce(12)‖ciphertext+tag]`; `@noble/curves` secp256k1 ECDH, `@noble/hashes` hkdf+sha256 (salt empty, info `'ecies-key-derivation'`), `@noble/ciphers` chacha20poly1305, counter-based nonce; accepts 32/33/65-byte pubkeys. Self-contained, `@noble/*`-only.

**Errors / classify:**
- Master error sources: `23505` unique-violation → user-facing failure (`user-repository.ts:94`); RPC `error.hint === 'CONCURRENCY_ERROR'` → concurrency (`cashu-send-quote-repository.ts:177`); no-rows/`!result` → `NotFoundError` thrown in hook layer (`transaction-hooks.ts:97`); cashu-ts `NetworkError` (`cashu.ts:304`); fallthrough `throw new Error('Failed to…', { cause })`.
- Retry today: `new QueryClient()` defaults (queries 3, mutations 0); per-hook `retry: (n, e) => e instanceof DomainError ? false : e instanceof ConcurrencyError ? true : n <= 3`.
- `classify(error)` mapping (net-new SDK function): `23505` → `DomainError('UNIQUE_CONSTRAINT')` · RPC hint `CONCURRENCY_ERROR` or version conflict → `ConcurrencyError('CONCURRENCY_ERROR')` · `PGRST116`/no-rows → `NotFoundError('NOT_FOUND')` · cashu-ts `NetworkError`/`fetch` failure → `SdkError('NETWORK_ERROR')` · fallthrough → `SdkError('UNKNOWN')`.

**db-types:** `supabase/database.types.ts` = 1,971 lines / 66 KB, fully self-contained (no `import`s; inline `Json`; ends `} as const`), `export type Database`. App augments it with a `MergeDeep` overlay (`agicash-db/database.ts`, deps `type-fest` + `@supabase/supabase-js`). Imported via tsconfig path `supabase/database.types`.

---

## File Structure

**Created (SDK):**
- `packages/wallet-sdk/src/internal/event-emitter.ts` — `SdkEventEmitter<M>` (impl of `EventEmitter<M>` + internal `emit`/`removeAll`).
- `packages/wallet-sdk/src/internal/not-implemented.ts` — `notImplementedDomain<T>(name)` Proxy helper.
- `packages/wallet-sdk/src/internal/classify.ts` — `classify(error): SdkError`.
- `packages/wallet-sdk/src/internal/db/database.types.ts` — vendored generated types (copied).
- `packages/wallet-sdk/src/internal/db/database.ts` — `Database` = `MergeDeep<Generated, …>` overlay.
- `packages/wallet-sdk/src/internal/connections/open-secret.ts` — `configureOpenSecret(config)`, `isLoggedIn()`, key/token passthroughs.
- `packages/wallet-sdk/src/internal/connections/supabase-client.ts` — `createBrowserClient` / `createServerClient`.
- `packages/wallet-sdk/src/internal/connections/supabase-session.ts` — `SupabaseSessionTokenProvider` (expiry-aware cache).
- `packages/wallet-sdk/src/internal/connections/breez.ts` — `initBreezWasm`, `tryInitLogging`, `connectBreez`.
- `packages/wallet-sdk/src/internal/realtime/{supabase-realtime-manager,supabase-realtime-channel,supabase-realtime-channel-builder}.ts` — vendored.
- `packages/wallet-sdk/src/internal/crypto/{sha256,password,keys,signing}.ts` + `internal/lib/ecies/ecies.ts` (vendored).
- Tests: `*.test.ts` colocated for event-emitter, classify, sha256, password, ecies, keys, supabase-client, supabase-session, breez, open-secret, sdk.

**Modified (SDK):**
- `packages/wallet-sdk/src/config.ts` — `storage: StorageProvider` (from `@agicash/opensecret`).
- `packages/wallet-sdk/src/types/dependencies.ts` — delete the `StorageAdapter` placeholder.
- `packages/wallet-sdk/src/errors.ts` — add `NotImplementedError`.
- `packages/wallet-sdk/src/sdk.ts` — real `Sdk` class (replaces `declare class`).
- `packages/wallet-sdk/src/index.ts` — `export { Sdk }` (value), `export { NotImplementedError }`, `export type { StorageProvider }`.
- `packages/wallet-sdk/package.json` — runtime deps.

**Modified (root / web):**
- `package.json` — catalog `@agicash/opensecret: 1.0.0-rc.0`.
- `bunfig.toml` — `minimumReleaseAgeExcludes = ["@agicash/opensecret"]`.
- `apps/web-wallet/app/entry.client.tsx` — `configure({ …, storage: browserStorage })` + import.

---

## Phase A — Bump + skeleton

### Task 1: Bump OpenSecret to the rc + adapt the web's `configure()`

**Files:** Modify `package.json`, `bunfig.toml`, `apps/web-wallet/app/entry.client.tsx`.

- [ ] **Step 1: Add the install-quarantine exclude.** In `bunfig.toml` under `[install]` add:
```toml
# 1.0.0-rc.0 was published 2026-06-15; exclude our own freshly-cut package from
# the 3-day quarantine (kept for every other package).
minimumReleaseAgeExcludes = ["@agicash/opensecret"]
```

- [ ] **Step 2: Bump the catalog.** In `package.json` `workspaces.catalog`, change `"@agicash/opensecret": "0.1.0"` → `"@agicash/opensecret": "1.0.0-rc.0"`.

- [ ] **Step 3: Adapt the web `configure()` call.** In `apps/web-wallet/app/entry.client.tsx`, change the import on line 1:
```ts
import { browserStorage, configure } from '@agicash/opensecret';
```
and the call (lines 33-36):
```ts
configure({
  apiUrl: openSecretApiUrl,
  clientId: openSecretClientId,
  storage: browserStorage,
});
```

- [ ] **Step 4: Install.** Run `bun install`. Expected: resolves `@agicash/opensecret@1.0.0-rc.0` (not blocked), updates `bun.lock`.

- [ ] **Step 5: Verify the web still typechecks + tests pass on the rc.** Run `bun --filter=web-wallet run typecheck` → PASS (the `configure` call now satisfies the rc's required `storage`). Run `bun run test` → PASS (all packages). If typecheck surfaces any *other* rc signature drift (none expected — all 19 used fns are identical), fix per the compiler.

- [ ] **Step 6: Commit.**
```bash
git add -A && git commit -m "$(cat <<'EOF'
feat(deps): adopt @agicash/opensecret 1.0.0-rc.0 (pluggable storage)

Bump the shared catalog to the rc that adds a StorageProvider, exclude it from
the 3-day install quarantine, and pass browserStorage to the web's configure()
call (the rc's only breaking change). Enables the framework-free SDK storage.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

### Task 2: Event emitter

**Files:** Create `packages/wallet-sdk/src/internal/event-emitter.ts` + `.test.ts`.

- [ ] **Step 1: Write the failing test** (`internal/event-emitter.test.ts`):
```ts
import { describe, expect, it } from 'bun:test';
import { SdkEventEmitter } from './event-emitter';

type M = { ping: { n: number }; pong: Record<string, never> };

describe('SdkEventEmitter', () => {
  it('delivers emitted payloads to on() handlers', () => {
    const e = new SdkEventEmitter<M>();
    const seen: number[] = [];
    e.on('ping', (d) => seen.push(d.n));
    e.emit('ping', { n: 1 });
    e.emit('ping', { n: 2 });
    expect(seen).toEqual([1, 2]);
  });
  it('unsubscribe stops delivery', () => {
    const e = new SdkEventEmitter<M>();
    const seen: number[] = [];
    const off = e.on('ping', (d) => seen.push(d.n));
    e.emit('ping', { n: 1 });
    off();
    e.emit('ping', { n: 2 });
    expect(seen).toEqual([1]);
  });
  it('once() fires exactly once then auto-unsubscribes', () => {
    const e = new SdkEventEmitter<M>();
    let count = 0;
    e.once('ping', () => count++);
    e.emit('ping', { n: 1 });
    e.emit('ping', { n: 2 });
    expect(count).toBe(1);
  });
  it('emit with no handlers is a no-op; unsubscribe during emit is safe', () => {
    const e = new SdkEventEmitter<M>();
    expect(() => e.emit('pong', {})).not.toThrow();
    const seen: number[] = [];
    const off = e.on('ping', (d) => { seen.push(d.n); off(); });
    e.on('ping', (d) => seen.push(d.n * 10));
    e.emit('ping', { n: 1 });
    expect(seen).toEqual([1, 10]);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`bun --filter=@agicash/wallet-sdk run test` — cannot resolve `./event-emitter`).

- [ ] **Step 3: Implement** (`internal/event-emitter.ts`):
```ts
import type { EventEmitter } from '../events';

type AnyHandler = (data: unknown) => void;

/**
 * In-memory typed event emitter. Implements the public read-only
 * {@link EventEmitter} surface (on/once) and adds an internal `emit` the SDK
 * uses to publish. Handlers are snapshotted per emit so a handler may
 * unsubscribe (incl. via `once`) mid-dispatch without skipping siblings.
 */
export class SdkEventEmitter<M> implements EventEmitter<M> {
  private readonly handlers = new Map<keyof M, Set<AnyHandler>>();

  on<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as AnyHandler);
    return () => {
      set.delete(handler as AnyHandler);
      if (set.size === 0) this.handlers.delete(event);
    };
  }

  once<K extends keyof M>(event: K, handler: (data: M[K]) => void): () => void {
    const off = this.on(event, (data) => {
      off();
      handler(data);
    });
    return off;
  }

  emit<K extends keyof M>(event: K, data: M[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(data as unknown);
  }

  removeAll(): void {
    this.handlers.clear();
  }
}
```

- [ ] **Step 4: Run it — expect PASS.** `bun --filter=@agicash/wallet-sdk run test`.

- [ ] **Step 5: Commit** (`feat(wallet-sdk): typed SDK event emitter`).

### Task 3: SDK skeleton — `Sdk` class + stubbed domains

**Files:** Create `internal/not-implemented.ts` + `.test.ts`; modify `errors.ts`, `sdk.ts`, `index.ts`; create `sdk.test.ts`.

- [ ] **Step 1: Add `NotImplementedError`** to `packages/wallet-sdk/src/errors.ts` (after `NotFoundError`):
```ts
/** A contract surface that exists but has no implementation yet (build-in-progress). */
export class NotImplementedError extends SdkError {
  constructor(method: string) {
    super(`${method} is not implemented`, 'not_implemented');
  }
}
```

- [ ] **Step 2: Write the failing test** (`internal/not-implemented.test.ts`):
```ts
import { describe, expect, it } from 'bun:test';
import { NotImplementedError } from '../errors';
import { notImplementedDomain } from './not-implemented';

type Demo = { doThing(): Promise<void> };

describe('notImplementedDomain', () => {
  it('throws NotImplementedError naming domain.method on any call', () => {
    const d = notImplementedDomain<Demo>('demo');
    expect(() => d.doThing()).toThrow(NotImplementedError);
    try { d.doThing(); } catch (e) {
      expect((e as NotImplementedError).message).toBe('demo.doThing() is not implemented');
      expect((e as NotImplementedError).code).toBe('not_implemented');
    }
  });
  it('does not masquerade as a thenable', () => {
    const d = notImplementedDomain<Demo>('demo') as unknown as { then?: unknown };
    expect(d.then).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run — expect FAIL.**

- [ ] **Step 4: Implement** (`internal/not-implemented.ts`):
```ts
import { NotImplementedError } from '../errors';

/**
 * A typed stand-in for a domain interface whose every method throws
 * {@link NotImplementedError}. Used to stub domains until their slice lands.
 * `then`/symbol access returns undefined so the stub is never treated as a
 * thenable or mangled by inspection.
 */
export function notImplementedDomain<T extends object>(domain: string): T {
  return new Proxy({} as T, {
    get(_t, prop) {
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return () => {
        throw new NotImplementedError(`${domain}.${String(prop)}()`);
      };
    },
  });
}
```

- [ ] **Step 5: Run — expect PASS.**

- [ ] **Step 6: Replace the `declare class Sdk`** in `packages/wallet-sdk/src/sdk.ts` with a real class. Change the type-only imports to value imports where needed and add the domain-ops imports:
```ts
import type { SdkConfig } from './config';
import type {
  AccountsDomain, AuthDomain, BackgroundDomain, CashuDomain, CashuReceiveOps,
  CashuSendOps, ContactsDomain, ExchangeRateDomain, ScanDomain, SparkDomain,
  SparkReceiveOps, SparkSendOps, TransactionsDomain, TransfersDomain, UserDomain,
} from './domains';
import type { EventEmitter, SdkEventMap } from './events';
import { SdkEventEmitter } from './internal/event-emitter';
import { notImplementedDomain } from './internal/not-implemented';

/**
 * The Agicash wallet SDK. Construct with {@link Sdk.create}; reach functionality
 * through the domain accessors; subscribe via {@link Sdk.events}; tear down with
 * {@link Sdk.destroy}. Framework-free, no general domain cache.
 *
 * S2 (core shell): events + connection wiring are real; the 11 domains are
 * stubbed (`NotImplementedError`) until their slices implement them.
 */
export class Sdk {
  readonly auth: AuthDomain = notImplementedDomain<AuthDomain>('auth');
  readonly user: UserDomain = notImplementedDomain<UserDomain>('user');
  readonly accounts: AccountsDomain = notImplementedDomain<AccountsDomain>('accounts');
  readonly cashu: CashuDomain = {
    send: notImplementedDomain<CashuSendOps>('cashu.send'),
    receive: notImplementedDomain<CashuReceiveOps>('cashu.receive'),
  };
  readonly spark: SparkDomain = {
    send: notImplementedDomain<SparkSendOps>('spark.send'),
    receive: notImplementedDomain<SparkReceiveOps>('spark.receive'),
  };
  readonly transactions: TransactionsDomain = notImplementedDomain<TransactionsDomain>('transactions');
  readonly contacts: ContactsDomain = notImplementedDomain<ContactsDomain>('contacts');
  readonly transfers: TransfersDomain = notImplementedDomain<TransfersDomain>('transfers');
  readonly scan: ScanDomain = notImplementedDomain<ScanDomain>('scan');
  readonly exchangeRate: ExchangeRateDomain = notImplementedDomain<ExchangeRateDomain>('exchangeRate');
  readonly background: BackgroundDomain = notImplementedDomain<BackgroundDomain>('background');

  private readonly emitter = new SdkEventEmitter<SdkEventMap>();
  readonly events: EventEmitter<SdkEventMap> = this.emitter;

  protected constructor(protected readonly config: SdkConfig) {}

  /** Construct the SDK from `config`. S2: stores config + wires events; the
   * connection bundle is attached in Task 12 (still domains-stubbed). */
  static async create(config: SdkConfig): Promise<Sdk> {
    return new Sdk(config);
  }

  /** Tear down: clear event handlers (connection teardown added in Task 12). */
  async destroy(): Promise<void> {
    this.emitter.removeAll();
  }
}
```

- [ ] **Step 7: Update the barrel** `packages/wallet-sdk/src/index.ts`:
  - Change `export type { Sdk } from './sdk';` → `export { Sdk } from './sdk';`
  - In the errors block add `NotImplementedError`.

- [ ] **Step 8: Write `sdk.test.ts`** (`packages/wallet-sdk/src/sdk.test.ts`):
```ts
import { describe, expect, it } from 'bun:test';
import { NotImplementedError, Sdk } from './index';
import type { SdkConfig } from './config';

const config = {
  openSecret: { url: 'https://os.test', clientId: 'c' },
  supabase: { url: 'https://sb.test', anonKey: 'anon' },
  storage: { persistent: makeMem(), session: makeMem() },
} as unknown as SdkConfig;

function makeMem() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('Sdk core shell', () => {
  it('create() returns an Sdk with a live event surface', async () => {
    const sdk = await Sdk.create(config);
    const seen: unknown[] = [];
    sdk.events.on('auth:signed-out', (d) => seen.push(d));
    // @ts-expect-error reach the internal emitter to drive the event in the test
    sdk.emitter.emit('auth:signed-out', {});
    expect(seen).toHaveLength(1);
    await sdk.destroy();
  });
  it('every stubbed domain throws NotImplementedError', async () => {
    const sdk = await Sdk.create(config);
    expect(() => sdk.auth.signIn({ email: 'a', password: 'b' })).toThrow(NotImplementedError);
    expect(() => sdk.cashu.send.failQuote({} as never, 'x')).toThrow(NotImplementedError);
    expect(() => sdk.background.state()).toThrow(NotImplementedError);
  });
});
```
(If reaching `sdk.emitter` is awkward under `protected`, assert event wiring by subscribing and emitting from a follow-up domain slice instead; the stub-throws cases are the load-bearing assertions here.)

- [ ] **Step 9: Run + verify** `bun run typecheck` (4 pkgs) + `bun --filter=@agicash/wallet-sdk run test` PASS.

- [ ] **Step 10: Commit** (`feat(wallet-sdk): real Sdk shell with stubbed domains`).

---

## Phase B — Connections + crypto (the rc + supabase/breez/noble deps are installed by Task 1/their tasks)

### Task 4: Config storage retype + vendored db-types

**Files:** Modify `config.ts`, `types/dependencies.ts`, `package.json`; create `internal/db/database.types.ts`, `internal/db/database.ts`.

- [ ] **Step 1: Add SDK deps** to `packages/wallet-sdk/package.json` `dependencies`: `"@agicash/opensecret": "catalog:"`, `"@supabase/supabase-js": "2.95.2"`, `"type-fest": "5.4.3"`. Run `bun install`.

- [ ] **Step 2: Vendor the generated types.** Copy the file verbatim (it is self-contained):
```bash
cp supabase/database.types.ts packages/wallet-sdk/src/internal/db/database.types.ts
```

- [ ] **Step 3: Create the augmented `Database`** (`packages/wallet-sdk/src/internal/db/database.ts`) — port the `MergeDeep` overlay from `apps/web-wallet/app/features/agicash-db/database.ts` (read it; reproduce the Functions/CompositeTypes return-type overrides), importing `Database as Generated` from `./database.types` and `MergeDeep` from `type-fest`. Export `type Database`.

- [ ] **Step 4: Retype config storage.** In `packages/wallet-sdk/src/config.ts`: replace `import type { StorageAdapter } from './types/dependencies';` with `import type { StorageProvider } from '@agicash/opensecret';`, and the field `storage: StorageAdapter;` → `storage: StorageProvider;` (update the doc comment to note browser passes `browserStorage`, MCP implements `{ persistent, session }`).

- [ ] **Step 5: Delete the placeholder.** Remove the `StorageAdapter` block from `packages/wallet-sdk/src/types/dependencies.ts`. Add `export type { StorageProvider } from '@agicash/opensecret';` to `index.ts` (replacing the `StorageAdapter` re-export if present in the dependencies re-export list).

- [ ] **Step 6: Verify** `bun --filter=@agicash/wallet-sdk run typecheck` PASS. **Commit** (`feat(wallet-sdk): vendor db-types + StorageProvider config`).

### Task 5: `internal/connections/open-secret.ts`

**Files:** Create `internal/connections/open-secret.ts` + `.test.ts`.

- [ ] **Step 1: Test (mock `@agicash/opensecret`)** — assert `configureOpenSecret(config)` calls the rc `configure` with `{ apiUrl, clientId, storage }` mapped from `SdkConfig`, and that `isLoggedIn()`/`generateSupabaseToken()` delegate. Use `mock.module('@agicash/opensecret', …)` (bun) to capture args. (Write concrete cases: configure arg-mapping; logged-out → token provider returns null.)

- [ ] **Step 2: Implement** — thin wrapper exposing exactly what S2 connections need (NOT auth flows):
```ts
import { configure, generateThirdPartyToken, isLoggedIn } from '@agicash/opensecret';
import type { SdkConfig } from '../../config';

/** Configure the OpenSecret SDK from SdkConfig (idempotent at the app layer). */
export function configureOpenSecret(config: SdkConfig): void {
  configure({
    apiUrl: config.openSecret.url,
    clientId: config.openSecret.clientId,
    storage: config.storage,
  });
}

export { generateThirdPartyToken, isLoggedIn };
```
(Key APIs `getPrivateKey*`/`getPublicKey`/`signMessage` are re-exported here too for the `KeyProvider` in Task 8.)

- [ ] **Step 3: Run + Commit** (`feat(wallet-sdk): OpenSecret connection wrapper`).

### Task 6: Supabase client + session

**Files:** Create `internal/connections/supabase-client.ts`, `internal/connections/supabase-session.ts` + tests.

- [ ] **Step 1: Test** — mock `@supabase/supabase-js` `createClient`; assert `createBrowserClient(config, getToken)` passes `(url, anonKey, { accessToken: getToken, db: { schema: 'wallet' } })` and `createServerClient(config)` passes `(url, serviceRoleKey, { db: { schema: 'wallet' } })`. For session: a `SupabaseSessionTokenProvider` returns `null` when `isLoggedIn()` is false, fetches via `generateThirdPartyToken` otherwise, and re-uses a cached token until within 5s of `exp` (decode with a stub jwt).

- [ ] **Step 2: Implement `supabase-client.ts`:**
```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SdkConfig } from '../../config';
import type { Database } from '../db/database';

export function createBrowserClient(
  config: SdkConfig,
  getAccessToken: () => Promise<string | null>,
): SupabaseClient<Database> {
  return createClient<Database>(config.supabase.url, config.supabase.anonKey, {
    accessToken: getAccessToken,
    db: { schema: 'wallet' },
  });
}

export function createServerClient(config: SdkConfig): SupabaseClient<Database> {
  if (!config.supabase.serviceRoleKey) {
    throw new Error('createServerClient requires supabase.serviceRoleKey');
  }
  return createClient<Database>(config.supabase.url, config.supabase.serviceRoleKey, {
    db: { schema: 'wallet' },
  });
}
```

- [ ] **Step 3: Implement `supabase-session.ts`** — a small class (no TanStack) that caches the third-party token with expiry-aware staleness (`(exp-5)*1000`), single-flights concurrent fetches, returns `null` when logged out:
```ts
import { jwtDecode } from 'jwt-decode';

export class SupabaseSessionTokenProvider {
  private token: string | null = null;
  private expMs = 0;
  private inflight: Promise<string | null> | null = null;

  constructor(
    private readonly generateToken: () => Promise<string>,
    private readonly isLoggedIn: () => boolean,
  ) {}

  getToken = async (): Promise<string | null> => {
    if (!this.isLoggedIn()) { this.token = null; return null; }
    if (this.token && Date.now() < this.expMs - 5000) return this.token;
    this.inflight ??= this.fetch();
    try { return await this.inflight; } finally { this.inflight = null; }
  };

  private async fetch(): Promise<string> {
    const t = await this.generateToken();
    const { exp } = jwtDecode<{ exp: number }>(t);
    this.token = t;
    this.expMs = exp * 1000;
    return t;
  }
}
```
(Add `jwt-decode` to SDK deps — version `4.0.0` to match the web.)

- [ ] **Step 4: Run + Commit** (`feat(wallet-sdk): Supabase client + session provider`).

### Task 7: Realtime manager (vendored)

**Files:** Create `internal/realtime/{supabase-realtime-manager,supabase-realtime-channel,supabase-realtime-channel-builder}.ts` + a manager test.

- [ ] **Step 1:** Copy the three files from `apps/web-wallet/app/lib/supabase/` into `internal/realtime/`, fixing relative imports. **Drop** any `window`/`document` references (there are none in the manager; the activity-tracking hook stays web-side). Keep the serial resubscribe queue + backoff array verbatim.

- [ ] **Step 2: Test** — construct `SupabaseRealtimeManager` with a fake `RealtimeClient` (stub `channel`/`removeChannel`/`setAuth`); assert `subscribe`/`removeChannel` reference-count and that a simulated channel error enqueues a resubscribe. (Port/trim the existing manager test if one exists; otherwise write the construction + reference-count + status-transition cases.)

- [ ] **Step 3: Run + Commit** (`feat(wallet-sdk): vendor self-healing realtime manager`).

### Task 8: Crypto primitives + ECIES

**Files:** Create `internal/lib/ecies/ecies.ts` (vendored), `internal/crypto/{sha256,password,keys,signing}.ts` + tests; add `@noble/*`, `@scure/bip32`, `@scure/bip39`, `@stablelib/base64` deps.

- [ ] **Step 1: Vendor ECIES.** Copy `apps/web-wallet/app/lib/ecies/ecies.ts` → `internal/lib/ecies/ecies.ts` (and any sibling it imports). Add deps `@noble/ciphers@1.3.0`, `@noble/curves@1.9.7`, `@noble/hashes@1.8.0` to `package.json`; `bun install`.

- [ ] **Step 2: ECIES round-trip test** — `eciesDecrypt(eciesEncrypt(data, pub), priv) === data` for a generated secp256k1 keypair; batch variant; 32/33-byte pubkey acceptance.

- [ ] **Step 3: Implement `sha256.ts`** (`async sha256Hex(s: string): Promise<string>` via `globalThis.crypto.subtle`) + test against a known vector (`sha256Hex('abc')` = `ba7816...`). `password.ts` (`generateRandomPassword(length=24, opts?)` via `globalThis.crypto.getRandomValues`; no `window`) + test (length, charset). `signing.ts` (re-export `signMessage` from the open-secret connection) — thin.

- [ ] **Step 4: Implement `keys.ts`** — the path constants + `KeyProvider` DI type:
```ts
/** BIP-85 child-mnemonic paths (derived server-side in the OpenSecret enclave). */
export const CASHU_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/0'";
export const SPARK_MNEMONIC_PATH = "m/83696968'/39'/0'/12'/1'";
/** BIP-32 encryption-key path. */
export const ENCRYPTION_KEY_PATH = "m/10111099'/0'";

export type KeyProvider = {
  getChildMnemonic(seedPhraseDerivationPath: string): Promise<string>;
  getPrivateKeyBytes(privateKeyDerivationPath: string): Promise<Uint8Array>;
  getPublicKeyHex(privateKeyDerivationPath: string, algorithm: 'schnorr' | 'ecdsa'): Promise<string>;
};
```
Add an `openSecretKeyProvider()` factory in `internal/connections/open-secret.ts` that adapts the rc's `getPrivateKey`/`getPrivateKeyBytes`/`getPublicKey` to this shape (hex→bytes via `@noble/hashes` `hexToBytes`). Test the path constants are exactly the grounded strings.

- [ ] **Step 5: Run + Commit** (`feat(wallet-sdk): crypto primitives + ECIES`).

### Task 9: `internal/connections/breez.ts`

**Files:** Create `internal/connections/breez.ts` + `.test.ts`; add `@agicash/breez-sdk-spark@0.13.5-1` dep.

- [ ] **Step 1: Test (mock `@agicash/breez-sdk-spark`)** — `initBreezWasm()` calls the default WASM init once across concurrent callers (single-flight) and rejects with a `WebAssemblyUnavailableError` when `WebAssembly` is undefined; `tryInitLogging()` calls `initLogging` at most once regardless of repeated calls / failure (the single-global guard, spec §8); `connectBreez(config, mnemonic)` calls `connect` with `{ config: { ...apiKey, network, optimizationConfig }, seed: { type: 'mnemonic', mnemonic }, storageDir }`.

- [ ] **Step 2: Implement** — module-level `wasmInitPromise` single-flight + `loggingStatus` guard + `connectBreez`, mirroring the grounded master logic (fresh code):
```ts
import initBreezWasm, { connect, initLogging, type BreezSdk } from '@agicash/breez-sdk-spark';

export class WebAssemblyUnavailableError extends Error {}

let wasmInitPromise: Promise<unknown> | null = null;
export function initBreezWasm(): Promise<unknown> {
  if (typeof WebAssembly === 'undefined') {
    return Promise.reject(new WebAssemblyUnavailableError('WebAssembly is unavailable'));
  }
  wasmInitPromise ??= initBreezWasm__inner();
  return wasmInitPromise;
}
// (call the package default export; aliased to avoid name clash)

let loggingStatus: 'initializing' | 'initialized' | 'failed' | undefined;
export function tryInitLogging(debug: boolean): void {
  if (loggingStatus !== undefined) return; // single global subscriber (Rust tracing)
  loggingStatus = 'initializing';
  initLogging({ log: (e) => { if (debug) console.debug('[breez]', e); } })
    .then(() => { loggingStatus = 'initialized'; })
    .catch(() => { loggingStatus = 'failed'; });
}

export type BreezConnectConfig = {
  apiKey: string;
  network: 'mainnet' | 'regtest';
  storageDir: string;
  debugLogging?: boolean;
};
export async function connectBreez(cfg: BreezConnectConfig, mnemonic: string): Promise<BreezSdk> {
  tryInitLogging(cfg.debugLogging ?? false);
  return connect({
    config: { apiKey: cfg.apiKey, network: cfg.network, /* + defaults: privateEnabledDefault, optimizationConfig {autoEnabled:true,multiplicity:2}, lnurlDomain:undefined */ },
    seed: { type: 'mnemonic', mnemonic },
    storageDir: cfg.storageDir,
  });
}
```
(Reconcile the exact `connect` config object against `@agicash/breez-sdk-spark`'s `ConnectRequest`/`Config` types in `node_modules` when implementing — fill in `defaultConfig(network)` fields. Resolve the `initBreezWasm` self-name by importing the default export under an alias.)

- [ ] **Step 3: Run + Commit** (`feat(wallet-sdk): Breez WASM + connect (initLogging guarded)`).

### Task 10: `classify(error)`

**Files:** Create `internal/classify.ts` + `.test.ts`; export `classify` from `index.ts`.

- [ ] **Step 1: Test** — table-driven over the mapping in Grounding: `{ code: '23505' }` → `DomainError`/`UNIQUE_CONSTRAINT`; `{ hint: 'CONCURRENCY_ERROR' }` → `ConcurrencyError`; `{ code: 'PGRST116' }` → `NotFoundError`; a `TypeError: fetch failed` → `SdkError`/`NETWORK_ERROR`; an arbitrary `Error` → `SdkError`/`UNKNOWN`; an already-`SdkError` passes through unchanged.

- [ ] **Step 2: Implement** `classify(error: unknown): SdkError` per the mapping (pass through existing `SdkError`; detect Postgrest `code`/`hint`; detect network failures; fallthrough `SdkError('UNKNOWN')`). Use `getErrorMessage`-style message extraction.

- [ ] **Step 3: Run + Commit** (`feat(wallet-sdk): classify() error mapping`).

### Task 11: Wire `Sdk.create` to the connection bundle

**Files:** Modify `sdk.ts`; create `internal/connections/index.ts` (the `SdkConnections` bundle) + test.

- [ ] **Step 1: Define `SdkConnections`** (`internal/connections/index.ts`): `{ supabase: SupabaseClient<Database>; session: SupabaseSessionTokenProvider; realtime: SupabaseRealtimeManager; keys: KeyProvider }` + a `buildConnections(config): SdkConnections` that: `configureOpenSecret(config)`; builds the session provider (`new SupabaseSessionTokenProvider(generateThirdPartyToken, isLoggedIn)`); `createBrowserClient(config, session.getToken)`; the realtime manager from `client.realtime`; the `openSecretKeyProvider()`. (Breez is NOT connected here — per the scope boundary it's per-account in S6.)

- [ ] **Step 2: Wire `Sdk`** — store `private readonly connections`, build it in `create()` (`const connections = buildConnections(config)`), pass to the constructor; `destroy()` tears down realtime (`removeChannel` all / close) + `emitter.removeAll()`. Keep domains stubbed.

- [ ] **Step 3: Test** — `create(config)` (with `@supabase/supabase-js`, `@agicash/opensecret` mocked) builds a connection bundle (assert `configure` called, client constructed); `destroy()` resolves and clears. Domains still throw `NotImplementedError`.

- [ ] **Step 4: Run the full gate** `bun run typecheck` + `bun run test` PASS. **Commit** (`feat(wallet-sdk): wire Sdk.create connection bundle`).

---

## Verification Gate (slice done when)

- `bun run typecheck` green (4 packages) and `bun run test` green (incl. all new SDK unit tests). Per spec §10, the S2-relevant regression test is the **`initLogging` single-attempt guard** (Task 9). The stale-balance `synced` re-read + nutshell-#788 refetch are **S7** (orchestrator) — explicitly not in this slice.
- The web still typechecks + tests on the rc (Task 1) — proves the catalog bump is non-breaking beyond the one `configure` change.
- (Recommended, non-gating) `bun run build` still resolves `@agicash/wallet-sdk` + `@agicash/money` (the web doesn't import the SDK yet, so this only re-confirms the money slice + the rc bump).

## Self-Review

**1. Spec coverage (§9 S2):** config ✔(T4) · events ✔(T2) · errors+classify ✔(T3 NotImplementedError, T10 classify) · connections ✔(T5 open-secret, T6 supabase, T7 realtime, T9 breez, T11 bundle) · crypto ✔(T8) · domains stubbed ✔(T3) · vendor db-types ✔(T4). OpenSecret rc adoption (D-OS1/2/3) ✔(T1, T4).

**2. Placeholder scan:** vendored files (ecies, db-types, realtime) are concrete copies with named source paths; new code shows signatures + critical logic. The two "reconcile against `node_modules` types when implementing" notes (Breez `connect` config fields; the `MergeDeep` overlay) point at exact files to read — not open-ended TODOs. Tests give concrete cases per task.

**3. Type consistency:** `StorageProvider` (rc) used in `config.ts` (T4) + `index.ts` export; `Database` from `internal/db/database` used by `supabase-client` (T6) + bundle (T11); `KeyProvider` defined in `keys.ts` (T8) + built in open-secret (T8) + bundled (T11); `SdkEventEmitter`/`notImplementedDomain`/`NotImplementedError` defined T2/T3 and consumed in `sdk.ts` (T3) + bundle (T11). `classify`→`SdkError` subtypes match `errors.ts`.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-02-sdk-core-shell.md`. **Subagent-Driven (recommended)** — fresh subagent per task + two-stage review; Phase A (T1–T3) is low-risk and unblocked, Phase B (T4–T11) runs on the freshly-installed rc + supabase/breez/noble deps. (Alternative: inline execution via executing-plans.)
