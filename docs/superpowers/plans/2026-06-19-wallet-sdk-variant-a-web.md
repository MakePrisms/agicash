# Variant A (stateless) — Web Cut-over Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the `apps/web-wallet` app over from its in-app wallet stack (Supabase realtime broadcast channel + leader-election/TaskProcessor + the duplicated TanStack copies of the repositories/services) onto the `@agicash/wallet-sdk` Variant-A stateless engine — the app keeps its TanStack Query caches as its wallet cache but feeds them from `sdk.on('<entity>:created|updated', …)` decrypted-entity events, deletes its background-processing layer, and routes every read/mutation through `sdk.*`.

**Architecture:** A module-singleton `~/lib/sdk.ts` constructs one `createStatelessSdk(config)` (config assembled from app env, LAN-rewrite applied app-side). `<Wallet>` (the auth-gated shell) becomes the `sdk.background.start()/stop()` boundary and forwards `online`/`offline`/`visibilitychange` → `setOnlineStatus`/`setActiveStatus` plus focus/online → `sdk.resync()`. A central `useWalletEvents()` replaces the broadcast channel: per-feature `useWire<Feature>Events()` hooks subscribe `sdk.on('<entity>:created|updated')` and upsert the **existing** cache classes (the `repo.toX()` decrypt step is gone — the SDK emits decrypted entities); the central hook owns `connection:resync` → invalidate-all. Every query `queryFn`/mutation `mutationFn` swaps onto `sdk.{auth,user,accounts,contacts,transactions,transfers,cashu,spark}.*`, and the now-duplicated app repos/services/processors/subscription-managers are deleted. Two small SDK-side prelude changes (Part 0) unblock the accounts read surface and contacts list.

**Tech Stack:** React Router v7, TanStack Query v5, Zustand, `@agicash/wallet-sdk` (+ `/stateless` entry), `@agicash/opensecret`, Supabase, `bun:test`. App code under `apps/web-wallet/app/` (the `~/*` alias). SDK code under `packages/wallet-sdk/src/`.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test`. NEVER `bun run fix:all`** ⛔ (biome `check --write` reorders imports repo-wide and pollutes the working tree — applies to implementers AND reviewers). Discard any such pollution with `git checkout -- .` (committed work is safe). Every subagent prompt MUST carry this prohibition verbatim.
- **Branch: `sdkx/stateless`** (worktree `.claude/worktrees/sdkx-stateless`), off the extended base `a210e9db`, A-engine tip `65a95d68`. Run all commands from that worktree. Do NOT touch `sdkx/base`, the original repo root, or the independent `sdk-nocache/full-migration` track.
- **Do NOT push** `sdkx/base` or `sdkx/stateless` — push is gated on the Breez connect smoke (`VITE_BREEZ_API_KEY` + regtest) + live realtime validation + `/lnurl-test` + the user's nod.
- **Testing posture (matches the whole extraction):** Part 0 (SDK, headless) tasks are full TDD (failing test → impl → green). Part 1–3 (app integration) tasks are **gate-green only** — typecheck + the existing test suite stay green; NO new app unit tests for mechanical rewiring (the integration cannot be meaningfully unit-tested headless). Each such task ends with a `git grep` orphan-import sweep. Browser/live verification is **owed** and collected in Task 15's checklist (run via Chrome DevTools MCP + the `verify`/`run` skills against a live stack — NOT in-loop here).
- **Model:** OPUS implementer + reviewer on Tasks 1, 3, 4, 5, 6, 11, 12, 15 (new logic / lynchpin / hardest); sonnet on Tasks 2, 7, 8, 9, 10, 13, 14 (mechanical). Two-stage review per task (spec review + quality review) per subagent-driven-development; OPUS quality-reviewer on the OPUS tasks + final holistic.
- **Commit prefix:** `feat(wallet-web): A-web …` (app), `feat(wallet-sdk): A-web …` (SDK prelude). Base for the whole-branch diff = `65a95d68`.
- **The frozen base seam is NOT touched.** Part 0 modifies only `stateless/index.ts` and `domains/contacts.ts` (variant-local; both cherry-pickable to base later). `sdk.ts`, `engine.ts`, the `EventBus`, the `ChangeFeedChange` union, and the repos stay byte-identical.

**Resolved design forks (AskUserQuestion 2026-06-19, verbatim — do not re-litigate):**
1. **Accounts wiring** = closure-capture in `createStatelessSdk` (zero base change): wrap the engine factory to capture `engine.wallets`, wire `createStatelessAccounts`, override `sdk.accounts`, re-type `StatelessSdk.accounts: StatelessAccounts` (Task 1).
2. **`sdk.contacts.list()`** = added to base `ContactsDomain` as a Promise reading `contactRepository.getAll` (Task 2) — variant-independent like `transactions.list`.
3. **SDK init** = module singleton `~/lib/sdk.ts` `getSdk()`, constructed lazily once `domain` is available from the root loader (Task 3).
4. **Auth state** = hybrid: keep the cheap synchronous `isLoggedIn()` localStorage gate for route middleware/marketing; re-source authoritative `User` (`useUser`) from `sdk.user`; wire `sessionHintCookie`/Sentry as host effects off `sdk.on('auth:signed-in'|'auth:session-expired')` (Task 4).

**Adopted (critique-resolved, not re-asked — noted at point of use):** token-send share route reads `sdk.cashu.send.get` + cache (createTokenSend returns PENDING synchronously) [Task 11]; create-only `execute` navigates to `/transactions/:id` on create-success, receive uses existing `useTrack*` reads off the cache [Tasks 11/12]; `transaction:updated` always invalidates the unack count (no `previous_acknowledgment_status` in the SDK payload) [Task 9]; feature-flags gets its own minimal Supabase client [Task 14]; `confirmPasswordReset` positional→object adapt inside the wrapper [Task 4]; remove the `SupabaseRealtimeError` error-boundary branch in `root.tsx` [Task 14]; `AccountService.getExtendedAccounts`+`isDefaultAccount` stay app-side, only `addCashuAccount` is dropped [Task 7]; live Spark balance poll + `updateSparkAccountBalance` stay app-side [Task 7]; the signed-out `_public` token-receive placeholder helpers stay app-side (SDK `getTokenAccounts` requires auth) [Task 12].

---

## File Structure

**Part 0 — SDK prelude (`packages/wallet-sdk/src/`):**
- Modify `stateless/index.ts` — `createStatelessSdk` wires `createStatelessAccounts`; `StatelessSdk.accounts: StatelessAccounts` (Task 1).
- Modify `domains/contacts.ts` — add `list()` (Task 2).
- Co-located `*.test.ts` for both.

**Part 1 — App foundation (`apps/web-wallet/app/`):**
- Create `lib/sdk.ts` — config assembly + `getSdk()/initSdk()/disposeSdk()` module singleton (Task 3).
- Create `lib/storage-adapter.ts` — `localStorage`/`sessionStorage` → SDK `StorageAdapter` (Task 3).
- Rewire `features/user/auth.ts`, `routes/_auth.oauth.$provider.tsx`, `features/signup/verify-email.ts`, `features/user/user-hooks.tsx` (auth bits) (Task 4).
- Rewire `routes/_protected.tsx`, `features/wallet/wallet.tsx`; create `features/wallet/use-sdk-activity-tracking.ts`; delete `features/wallet/task-processing.ts` + `task-processing-lock-repository.ts` (Task 5).
- Rewrite `features/wallet/use-track-wallet-changes.ts` → `use-wallet-events.ts`; add `useWire<Feature>Events()` per feature; delete `lib/supabase/*` realtime files (Task 6).

**Part 2 — Per-feature rewire (`apps/web-wallet/app/features/`):** accounts (Task 7), contacts (Task 8), transactions (Task 9), user/settings (Task 10), send (Task 11), receive + token claim (Task 12), transfer (Task 13).

**Part 3 — Teardown + holistic:** final deletions + `root.tsx` + feature-flags client (Task 14); holistic review + biome pass + verification checklist (Task 15).

---

## Part 0 — SDK prelude (headless, TDD)

### Task 1: Wire `createStatelessAccounts` into `createStatelessSdk`

The engine builds a `ResidentAccounts` (`engine.wallets`) but never exposes it; `sdk.accounts` stays the base `AccountsDomain` (no `list()`, no first-of-currency `getDefault` fallback). Capture the engine via a wrapping `createEngine` closure (it runs synchronously inside `Sdk.create` at `sdk.ts:251`), then wire `createStatelessAccounts` and override `sdk.accounts`. Zero base change.

**Files:**
- Modify: `packages/wallet-sdk/src/stateless/index.ts`
- Test: `packages/wallet-sdk/src/stateless/index.test.ts` (create)

**Interfaces:**
- Consumes: `Sdk.create(config, { createEngine })` (`sdk.ts:107`), `createStatelessEngine` (`stateless/engine.ts`), `createStatelessAccounts({base, accounts, getUser})` + `StatelessAccounts` (`stateless/accounts-surface.ts`), `ResidentAccounts` (`stateless/resident-accounts.ts`), `SdkEngine.wallets: WalletAccess` (`engine.ts`).
- Produces: `createStatelessSdk(config, deps?): Promise<StatelessSdk>` where `StatelessSdk = Omit<Sdk,'on'|'accounts'> & { on<E…>(…); accounts: StatelessAccounts }`.

- [ ] **Step 1: Verify `sdk.user.get()`'s signature** — read `packages/wallet-sdk/src/domains/user.ts`. `createStatelessAccounts`'s `getUser` is `() => Promise<User | null>`. If `UserDomain.get()` returns `Promise<User>` and throws when signed out, the wiring uses `() => sdk.user.get().catch(() => null)`; if it already returns `User | null`, pass it directly. Record which.

- [ ] **Step 2: Write the failing test** — `stateless/index.test.ts`. Inject a fake `OpenSecret` + a `createEngine` is supplied by `createStatelessSdk` itself, so drive it through `createStatelessSdk` with a fake config/OS (mirror the seams used in the existing `sdk.test.ts`). Assert: `typeof sdk.accounts.list === 'function'` and `typeof sdk.accounts.getDefault === 'function'` (the base `AccountsDomain` has neither `list` nor the fallback — so this fails today), and that `sdk.accounts.list()` resolves to the resident accounts seeded into the engine's `ResidentAccounts`.

```ts
// representative shape — align fakes with sdk.test.ts
const sdk = await createStatelessSdk(fakeConfig, { openSecret: fakeOs });
expect(typeof (sdk.accounts as StatelessAccounts).list).toBe('function');
```

- [ ] **Step 3: Run the test — expect FAIL** (`sdk.accounts.list` is undefined on the base domain). Run: `bun --cwd packages/wallet-sdk test stateless/index.test.ts`

- [ ] **Step 4: Implement the wiring** in `stateless/index.ts`:

```ts
import { Sdk } from '../sdk';
import { createStatelessEngine } from './engine';
import { createStatelessAccounts, type StatelessAccounts } from './accounts-surface';
import type { ResidentAccounts } from './resident-accounts';
import type { CreateEngine } from '../engine';
import type { SdkEventMapA } from './event-map';

export type StatelessSdk = Omit<Sdk, 'on' | 'accounts'> & {
  on<E extends keyof SdkEventMapA>(event: E, cb: (payload: SdkEventMapA[E]) => void): () => void;
  accounts: StatelessAccounts;
};

export async function createStatelessSdk(
  config: Parameters<typeof Sdk.create>[0],
  deps?: Omit<NonNullable<Parameters<typeof Sdk.create>[1]>, 'createEngine'>,
): Promise<StatelessSdk> {
  let resident: ResidentAccounts | undefined;
  const createEngine: CreateEngine = (ctx) => {
    const engine = createStatelessEngine(ctx);
    resident = engine.wallets as ResidentAccounts; // wallets IS the ResidentAccounts (engine.ts:23)
    return engine;
  };
  const sdk = await Sdk.create(config, { ...deps, createEngine });
  if (!resident) throw new Error('stateless engine did not initialise resident accounts');
  const accounts = createStatelessAccounts({
    base: sdk.accounts,
    accounts: resident,
    getUser: () => sdk.user.get(), // or .catch(() => null) per Step 1
  });
  Object.defineProperty(sdk, 'accounts', { value: accounts, writable: false, configurable: true });
  return sdk as unknown as StatelessSdk;
}
```
Keep the existing `createStatelessEngine`/`SdkEventMapA`/`createStatelessAccounts`/`StatelessAccounts` re-exports.

- [ ] **Step 5: Run the new test + the full SDK suite — expect PASS.** Run: `bun --cwd packages/wallet-sdk test` and `bun run typecheck`. Expected: typecheck exit 0; wallet-sdk suite 0 fail (was 184).

- [ ] **Step 6: Commit.** `git add packages/wallet-sdk/src/stateless/index.ts packages/wallet-sdk/src/stateless/index.test.ts && git commit -m "feat(wallet-sdk): A-web wire createStatelessAccounts into createStatelessSdk"`

---

### Task 2: Add `ContactsDomain.list()` to base

`ContactsDomain` has `get/add/remove/search` but no `list()` (deferred as a "per-variant hot read"). The app's `useContacts` needs it. Contacts require no synchronous access (no processor reads them), so `list()` is a plain Promise reading the repo — variant-independent, belongs in base. `sdk.contacts.list()` then works on `StatelessSdk` with no stateless change.

**Files:**
- Modify: `packages/wallet-sdk/src/domains/contacts.ts`
- Test: the existing contacts domain test (find via `git grep -l "ContactsDomain" packages/wallet-sdk/src/**/*.test.ts`; create `domains/contacts.test.ts` if none).

**Interfaces:**
- Consumes: `ContactRepository.getAll(userId, …): Promise<Contact[]>` (`internal/db/contact-repository.ts:36`), the existing `requireUserId()` + `Deps.getCurrentUserId`.
- Produces: `ContactsDomain.list(): Promise<Contact[]>`.

- [ ] **Step 1: Confirm `getAll`'s signature** — read `internal/db/contact-repository.ts:36`. Note whether it is `getAll(userId)` or `getAll(userId, options?)`. Use the exact arity.

- [ ] **Step 2: Write the failing test** — assert `await contacts.list()` returns the repo's `getAll(currentUserId)` result (inject a fake `ContactRepository` whose `getAll` returns a known array; assert pass-through + that `requireUserId` throws `No authenticated user` when `getCurrentUserId` returns null).

- [ ] **Step 3: Run — expect FAIL** (`list` undefined). Run: `bun --cwd packages/wallet-sdk test <contacts test>`

- [ ] **Step 4: Implement** in `domains/contacts.ts`:

```ts
/** All contacts for the current user. */
async list(): Promise<Contact[]> {
  return this.deps.contactRepository.getAll(await this.requireUserId());
}
```

- [ ] **Step 5: Run the test + full SDK suite — expect PASS.** `bun --cwd packages/wallet-sdk test` + `bun run typecheck` (0 fail / exit 0).

- [ ] **Step 6: Commit.** `git commit -m "feat(wallet-sdk): A-web ContactsDomain.list()"`

---

## Part 1 — App foundation (gate-green)

### Task 3: SDK init module — `~/lib/sdk.ts`

A module-singleton SDK with config assembled from app env. The LAN-rewrite is inlined app-side (the SDK never touches `window`). `domain` comes from the root loader's canonical origin, so construction is **lazy** (gated on `domain`), not eager in `entry.client.tsx`. New module with no consumers yet — old bootstrap (`database.client.ts`, `supabase-session.ts`, the `entry.client.tsx` configure) stays until later tasks (strangler).

**Files:**
- Create: `apps/web-wallet/app/lib/sdk.ts`
- Create: `apps/web-wallet/app/lib/storage-adapter.ts`
- Modify: `apps/web-wallet/app/routes/_protected.tsx` (kick off `initSdk(domain)` in the existing client middleware, after `domain` is known; do NOT yet remove the bootstrap block — that is Task 4/5).

**Interfaces:**
- Consumes: `createStatelessSdk` + `StatelessSdk` (Task 1), `SdkConfig`/`StorageAdapter` (`@agicash/wallet-sdk`), `import.meta.env.VITE_*`, the root loader's `domain` (`root.tsx:90-96`, `getCanonicalOrigin()`).
- Produces: `getSdk(): StatelessSdk` (throws if not yet initialised), `initSdk(domain: string): Promise<StatelessSdk>` (idempotent — returns the in-flight/resolved singleton), `disposeSdk(): Promise<void>` (calls `sdk.dispose()` and nulls the singleton for the next sign-in).

- [ ] **Step 1: Read the current bootstrap** to copy values verbatim: `entry.client.tsx:23-37` (`VITE_OPEN_SECRET_API_URL`, `VITE_OPEN_SECRET_CLIENT_ID`), `features/agicash-db/database.client.ts:6-32` (the `getSupabaseUrl()` LAN-rewrite + `VITE_SUPABASE_ANON_KEY`), `features/shared/spark.ts:23` (`VITE_BREEZ_API_KEY`), `features/shared/cashu.ts:138` (`VITE_CASHU_MINT_BLOCKLIST` + `MintBlocklistSchema`), `user-hooks.tsx:112` (`import.meta.env.MODE === 'development'` → `includeTestAccounts`), and `config.ts` (the exact `SdkConfig`/`StorageAdapter` shape).

- [ ] **Step 2: Write `lib/storage-adapter.ts`** — two `StorageAdapter`s (async `get→string|undefined` / `set` / `remove`) wrapping `window.localStorage` and `window.sessionStorage`:

```ts
import type { StorageAdapter } from '@agicash/wallet-sdk';
const wrap = (store: Storage): StorageAdapter => ({
  get: async (k) => store.getItem(k) ?? undefined,
  set: async (k, v) => { store.setItem(k, v); },
  remove: async (k) => { store.removeItem(k); },
});
export const browserLocalStorageAdapter = wrap(window.localStorage);
export const browserSessionStorageAdapter = wrap(window.sessionStorage);
```

- [ ] **Step 3: Write `lib/sdk.ts`** — inline the LAN-rewrite, assemble `SdkConfig`, hold the singleton:

```ts
import { createStatelessSdk, type StatelessSdk } from '@agicash/wallet-sdk/stateless';
import { browserLocalStorageAdapter, browserSessionStorageAdapter } from './storage-adapter';

// inline copy of database.client.ts:6-25 — browser-only, SDK is host-agnostic
function getSupabaseUrl(): string { /* VITE_SUPABASE_URL + 127.0.0.1→window.location.hostname LAN rewrite */ }

let sdkPromise: Promise<StatelessSdk> | undefined;
let sdkInstance: StatelessSdk | undefined;

export function initSdk(domain: string): Promise<StatelessSdk> {
  if (!sdkPromise) {
    sdkPromise = createStatelessSdk({
      openSecret: { url: import.meta.env.VITE_OPEN_SECRET_API_URL, clientId: import.meta.env.VITE_OPEN_SECRET_CLIENT_ID },
      supabase: { url: getSupabaseUrl(), anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY },
      storage: browserLocalStorageAdapter,
      sessionStorage: browserSessionStorageAdapter,
      breezApiKey: import.meta.env.VITE_BREEZ_API_KEY,
      domain,
      includeTestAccounts: import.meta.env.MODE === 'development',
      cashuMintBlocklist: MintBlocklistSchema.parse(JSON.parse(import.meta.env.VITE_CASHU_MINT_BLOCKLIST ?? '[]')),
    }).then((s) => { sdkInstance = s; return s; });
  }
  return sdkPromise;
}
export function getSdk(): StatelessSdk {
  if (!sdkInstance) throw new Error('SDK not initialised — call initSdk() first');
  return sdkInstance;
}
export async function disposeSdk(): Promise<void> {
  const s = sdkInstance; sdkInstance = undefined; sdkPromise = undefined;
  await s?.dispose();
}
```
(Confirm `MintBlocklistSchema` import path from `features/shared/cashu.ts`.)

- [ ] **Step 4: Kick off `initSdk(domain)`** in `_protected.tsx`'s client middleware (where `domain` is available from the root loader) — store nothing else yet; do not remove the existing bootstrap. This proves the module wires and gives Breez/connect a head-start as soon as the protected area is entered.

- [ ] **Step 5: Gate.** `bun run typecheck` (exit 0) + `bun run test` (0 fail). New module compiles; no behavior change yet.

- [ ] **Step 6: Orphan sweep + commit.** `git commit -m "feat(wallet-web): A-web SDK init module + storage adapters"`.

> ⚠️ Verification owed (Task 15): `initSdk` does not block `hydrateRoot`; `domain` is the canonical origin (correct lud16 on Vercel previews); `getSupabaseUrl` LAN-rewrite matches the old behavior and the SDK never double-rewrites.

---

### Task 4: Auth cut-over → `sdk.auth` + hybrid auth-state

Rewire `useAuthActions` and the OAuth/verify paths onto `sdk.auth` (a near-1:1 superset). Keep the cheap `isLoggedIn()` localStorage gate; re-source `useUser` identity from `sdk.user`. Delete `useHandleSessionExpiry` (the SDK owns expiry + guest silent re-auth and emits `auth:session-expired`); keep the host side-effects (toast/redirect/Sentry/`queryClient.clear`/`sessionHintCookie`) wired to `sdk.on`. Remove the `_protected` `ensureUserData` bootstrap (the SDK's `auth.ensureUser` upserts the user row + default accounts at sign-in; `KeyService` derives keys on demand).

**Files:**
- Modify: `features/user/auth.ts` (rewire `useAuthActions`; delete `useHandleSessionExpiry` + helpers `getJwt`/`getRefreshToken`/`getRemainingSessionTimeInMs`/`removeKeys`/`OpenSecretJwt` 339-391; `signOut` adds `disposeSdk()`; keep `authQueryOptions`/`isLoggedIn` gate per fork 4).
- Modify: `routes/_auth.oauth.$provider.tsx` (`handleGoogleCallback` → `sdk.auth.completeOAuth({code,state})`; keep `oauthLoginSessionStorage` redirect bookkeeping).
- Modify: `features/signup/verify-email.ts` (`osVerifyEmail` → `sdk.auth.verifyEmail({code})`).
- Modify: `features/user/user-hooks.tsx` (auth bits only: `requestNewVerificationCode` → `sdk.auth.requestEmailVerification()`; `convertGuestToFullAccount` → `sdk.auth.upgradeGuest`; `useUser` identity from `sdk.user`).
- Modify: `routes/_protected.tsx` (delete the `ensureUserData` key-derivation + `WriteUserRepository.upsert` block 74-152; the gate stays via `isLoggedIn`/`authQueryOptions`).

**Interfaces:** Consumes `getSdk().auth.{signIn,signUp,signInGuest,upgradeGuest,signOut,verifyEmail,requestEmailVerification,requestPasswordReset,confirmPasswordReset,beginGoogle,completeOAuth}` + `sdk.user.get()` + `sdk.on('auth:session-expired'|'auth:signed-in'|'auth:signed-out')` + `disposeSdk()`. Method map (verified) below.

- [ ] **Step 1: Rewire `useAuthActions` method-by-method** (keep the same hook names/signatures so all call sites are untouched):
  - `signUp` → `sdk.auth.signUp({email,password})`; `signIn` → `sdk.auth.signIn({email,password})`.
  - `signUpGuest`/`signInGuest` → `sdk.auth.signInGuest()` (SDK folds existing-vs-new + guest-cred storage — **delete** the `guestAccountStorage` branch).
  - `signOut` → `await disposeSdk(); await sdk.auth.signOut();` then keep `Sentry.setUser(null)` + `queryClient.clear()` + redirect.
  - `convertGuestToFullAccount` → `sdk.auth.upgradeGuest({email,password})` (drop the now-redundant `guestAccountStorage.clear()`).
  - `verifyEmail` → `sdk.auth.verifyEmail({code})`; `requestPasswordReset` → `sdk.auth.requestPasswordReset({email})` (drop the app's secret-gen/hash duplication).
  - `confirmPasswordReset` → adapt positional→object: `sdk.auth.confirmPasswordReset({ email, code: alphanumericCode, secret: plaintextSecret, newPassword })` (keep the call site shape).
  - `initiateGoogleAuth` → keep the `oauthLoginSessionStorage` bookkeeping, call `sdk.auth.beginGoogle()` → `{authUrl}`.

- [ ] **Step 2: Delete `useHandleSessionExpiry`** (auth.ts:398-429) + its private helpers (339-391) + the `useLongTimeout`/`jwtDecode` imports if now unused. Its host effect moves to `<Wallet>` (Task 5) as `sdk.on('auth:session-expired', …)`.

- [ ] **Step 3: Hybrid auth-state.** Keep `features/shared/auth.ts` `isLoggedIn()` and `authQueryOptions` for route gating (`_auth.tsx`, `_protected.tsx`, `marketing-nav.tsx`, `join-beta-button.tsx` — works pre-SDK-bootstrap, no network). Re-source `useUser` (user-hooks.tsx) identity from `sdk.user` (the User entity), keeping the `['user']` cache fed by `sdk.on('user:updated')` (wired in Task 6). Keep `sessionHintCookie` + Sentry user as host effects (wire Sentry to `sdk.on('auth:signed-in')` in Task 5, or leave reacting to `useUser`).

- [ ] **Step 4: Remove `_protected` `ensureUserData` (74-152)** — the SDK upserts the user row + default accounts at sign-in (`auth.ensureUser`) and derives keys on demand (`KeyService`). Keep the route gate. ⚠️ Verification owed: fresh sign-in AND returning-session reload both land in `<Wallet>` with a populated user + accounts.

- [ ] **Step 5: Rewire the OAuth callback + verify-email + request-new-code** files (one `sdk.auth.*` call each, keep host redirect/toast).

- [ ] **Step 6: Gate** (`bun run typecheck` exit 0, `bun run test` 0 fail) + orphan sweep (`git grep "useHandleSessionExpiry\|@agicash/opensecret" apps/web-wallet/app/features/user apps/web-wallet/app/features/signup` — auth OS imports should be gone) + **commit** `feat(wallet-web): A-web auth → sdk.auth + hybrid auth-state`.

> ⚠️ Verification owed (Task 15): full-user session expiry fires toast+redirect; guest expiry is silent (no event); Google OAuth round-trip; `confirmPasswordReset` validates against Open Secret; StorageAdapter/enclave survives reload; route gates + public marketing pages behave without forcing SDK init.

---

### Task 5: `<Wallet>` background lifecycle + activity forwarding

`<Wallet>` (mounted by `ProtectedRoute` when a user is present) becomes the `sdk.background.start()/stop()` boundary, forwards browser activity to `setOnlineStatus`/`setActiveStatus`, wires `auth:session-expired`, and disposes on unmount/sign-out. Deletes the app's leader-election/TaskProcessor.

**Files:**
- Create: `features/wallet/use-sdk-activity-tracking.ts` (verbatim port of `supabase-realtime-hooks.ts:123-145`, receiver swapped to `sdk.background`).
- Modify: `features/wallet/wallet.tsx` (remove `useHandleSessionExpiry`, `useTakeTaskProcessingLead`, `{isLead && <TaskProcessor/>}`, `useSupabaseRealtimeActivityTracking`; add `sdk.background.start()/stop()`, `useSDKActivityTracking`, `sdk.on('auth:session-expired')`, focus/online → `sdk.resync()`; keep `Sentry.setUser`, `useSyncThemeWithDefaultCurrency`, `useTrackAndUpdateSparkAccountBalances`, `useTrackWalletChanges` [rewired in Task 6]).
- Modify: `routes/_protected.tsx` (place `disposeSdk()` on the unmount/sign-out boundary).
- Delete: `features/wallet/task-processing.ts`, `features/wallet/task-processing-lock-repository.ts`.

**Interfaces:** Consumes `getSdk().background.{start,stop,setOnlineStatus,setActiveStatus}`, `sdk.resync()`, `sdk.on('auth:session-expired')`, `disposeSdk()`. Note `sdk.background` is `?:` on the base type but always present on `StatelessSdk` (engine injected) — guard or `!`.

- [ ] **Step 1: Port activity tracking** — `useSDKActivityTracking(sdk)` copying the verbatim handlers (initial seed, `online`→`setOnlineStatus(true)`, `offline`→`setOnlineStatus(false)`, `visibilitychange`→`setActiveStatus(!document.hidden)`, add/remove listener symmetry). Reuse the `isOnline()`/`isTabActive()` helpers.

- [ ] **Step 2: Rewire `<Wallet>`** — a `useEffect` that calls `sdk.background.start()` on mount and `sdk.background.stop()` on unmount; `useSDKActivityTracking(sdk)`; a `useEffect` subscribing `sdk.on('auth:session-expired', () => { toast('Session expired…'); signOut(); })` (replacing the old `onLogout`); focus/online listeners → `sdk.resync()`. Delete the leader/TaskProcessor lines + imports.

- [ ] **Step 3: Delete `task-processing.ts` + `task-processing-lock-repository.ts`.** The six `useProcess*Tasks` in the feature files become unused exports (compile fine) — deleted in Tasks 11/12.

- [ ] **Step 4: `disposeSdk()` on the sign-out/unmount boundary** in `ProtectedRoute` (or via `signOut`, Task 4 — pick one place, not both).

- [ ] **Step 5: Gate + orphan sweep** (`git grep "task-processing\|TaskProcessor\|useTakeTaskProcessingLead" apps/web-wallet/app` → only dead `useProcess*Tasks` exports remain) + **commit** `feat(wallet-web): A-web <Wallet> background lifecycle + activity tracking`.

> ⚠️ Verification owed (Task 15): 2-tab leader election + ≤10s failover; online/offline + visibility pause/resume; session-expiry toast+redirect once; sign-out disposes spark sockets cleanly; no double-start under StrictMode.

---

### Task 6: Realtime swap — `useWalletEvents` + per-feature wire hooks

Replace the single Supabase broadcast channel with `sdk.on` subscriptions. Each feature gets a `useWire<Feature>Events()` that subscribes its `sdk.on('<entity>:created|updated')` and updates its **existing** cache class (dropping the `repo.toX()` decrypt step — the SDK emits decrypted entities). A central `useWalletEvents()` (replacing `useTrackWalletChanges`) owns `sdk.on('connection:resync')` → invalidate-all and calls every feature's wire hook. Delete the channel plumbing.

**Files:**
- Rewrite: `features/wallet/use-track-wallet-changes.ts` → thin `useWalletEvents()` (rename allowed; keep the `wallet.tsx` call site name or update it).
- Modify each feature file — replace the old `use<Feature>ChangeHandlers` body with `useWire<Feature>Events()` (sdk.on → existing cache method): `accounts/account-hooks.ts`, `user/user-hooks.tsx`, `contacts/contact-hooks.ts`, `transactions/transaction-hooks.ts`, `receive/cashu-receive-quote-hooks.ts`, `receive/cashu-receive-swap-hooks.ts`, `receive/spark-receive-quote-hooks.ts`, `send/cashu-send-quote-hooks.ts`, `send/cashu-send-swap-hooks.ts`, `send/spark-send-quote-hooks.ts`.
- Delete: `lib/supabase/supabase-realtime-hooks.ts`, `supabase-realtime-manager.ts`, `supabase-realtime-channel.ts`, `supabase-realtime-channel-builder.ts`, `lib/supabase/index.ts`; remove `agicashRealtimeClient` (78-82) + `window.agicashRealtime` from `database.client.ts`.

**Interfaces:** Consumes `getSdk().on('<entity>:created'|':updated'|'contact:deleted'|'connection:resync', cb): () => void`. The 13 caches + their methods are UNCHANGED. Event→cache map (verbatim from gather R3/R4):

| sdk.on event | cache call | notes |
|---|---|---|
| `user:updated` | `userCache.set(entity)` | no version field |
| `account:created` / `account:updated` | `accountsCache.upsert(entity)` | version-gated in `upsert` |
| `contact:created` | `contactsCache.add(entity)` | append-only |
| `contact:deleted` | `contactsCache.remove(id)` | payload `{id}` not `{entity}` |
| `transaction:created` | `upsert(entity)` + `if pending invalidateUnacknowledgedCount()` | |
| `transaction:updated` | `upsert(entity)` + `invalidateUnacknowledgedCount()` | always-invalidate (Task 9 fork) |
| `cashu-receive-quote:updated` | `cashuReceiveQuoteCache.updateIfExists` + state-gated `pendingQuotesCache.update`/`remove` (`['UNPAID','PAID']` keeps) | created → `pendingQuotesCache.add` |
| `cashu-receive-swap:updated` | `PENDING` → `update` else `remove` | created → `add` |
| `spark-receive-quote:updated` | `updateIfExists` + `UNPAID` keeps else `remove` | created → `add` |
| `cashu-send-quote:updated` | `['UNPAID','PENDING']` keeps else `remove` | created → `add` |
| `cashu-send-swap:updated` | `updateIfExists` + `['DRAFT','PENDING']` keeps else `remove` | created → `add` |
| `spark-send-quote:updated` | `['UNPAID','PENDING']` keeps else `remove` | created → `add` |

- [ ] **Step 1: Write each `useWire<Feature>Events()`** in its feature file — a `useEffect` registering the `sdk.on(...)` subscriptions for that feature's entities (return the unsubscribers as cleanup), bodies per the table (drop every `repository.toX(payload)` call + the raw `AgicashDb*`/`cashu_proofs`/`useLocationData(domain)` imports). Delete the old `use<Feature>ChangeHandlers`.

- [ ] **Step 2: Write `useWalletEvents()`** (rewriting `use-track-wallet-changes.ts`): call every `useWire<Feature>Events()`; one `useEffect` subscribing `sdk.on('connection:resync', () => { /* invalidate all 13 caches — same set as the old onConnected, lines 135-147 */ })`. Delete `useTrackDatabaseChanges` + the broadcast-channel construction.

- [ ] **Step 3: Delete the `lib/supabase/*` realtime files + the `agicashRealtimeClient` construction** in `database.client.ts` (lines 78-82) + the `root.tsx` `SupabaseRealtimeError` import — actually leave the `root.tsx` boundary edit to Task 14 (it also needs the error-boundary branch removed); here just stop importing/constructing the realtime client.

- [ ] **Step 4: Gate + orphan sweep** (`git grep "useSupabaseRealtime\|agicashRealtimeClient\|use.*ChangeHandlers\|supabase-realtime" apps/web-wallet/app` → only `root.tsx`'s `SupabaseRealtimeError` remains, handled in Task 14) + **commit** `feat(wallet-web): A-web realtime swap → sdk.on (delete broadcast channel)`.

> ⚠️ Verification owed (Task 15): `sdk.on` subscription lifecycle (no double-sub under StrictMode, no leak across user switch, stops after `dispose`); `connection:resync` fires on reconnect/online and invalidates once; intermediate `:updated` row events still arrive for dark-processed quotes/swaps so pending caches stay live (live mint/Spark + leader running).

---

## Part 2 — Per-feature query/mutation rewire + deletions (gate-green)

### Task 7: Accounts read surface

**Files:** Modify `features/accounts/account-hooks.ts`; modify `features/accounts/account-service.ts` (split); delete `features/accounts/account-repository.ts`.

- [ ] **Step 1:** `accountsQueryOptions.queryFn`: `accountRepository.getAllActive(userId)` → `getSdk().accounts.list()`. `useAccountOrNull`'s DB-fallback → `sdk.accounts.get(id)`. `useAddCashuAccount.mutationFn` → `sdk.accounts.add(input)` (input = `AddCashuAccountInput` from `@agicash/wallet-sdk`; keep `onSuccess accountCache.upsert`). Keep `useDefaultAccount`/`useAccountOrDefault`/`useSelectItemsWithOnlineAccount`/`useBalance` reading the cache unchanged. (Wire hook done in Task 6.)
- [ ] **Step 2:** `account-service.ts` — delete `addCashuAccount` + `useAccountService`; **keep** `getExtendedAccounts` + `isDefaultAccount` (pure presentation helpers used by `useAccounts.select`).
- [ ] **Step 3:** Keep the Spark balance poll + `AccountsCache.updateSparkAccountBalance` app-side (no DB event for live balance).
- [ ] **Step 4:** Delete `account-repository.ts` once `git grep "account-repository\|useAccountRepository" apps/web-wallet/app` is empty.
- [ ] **Step 5:** Gate + sweep + **commit** `feat(wallet-web): A-web accounts → sdk.accounts`.

> ⚠️ Verification owed: `sdk.accounts.list()` returns warm wallet/proofs equivalent to `getAllActive`; live Spark balance still updates.

### Task 8: Contacts

**Files:** Modify `features/contacts/contact-hooks.ts`; delete `features/contacts/contact-repository.ts`.

- [ ] **Step 1:** `useContacts.queryFn` → `getSdk().contacts.list()`; `useCreateContact.mutationFn` → `sdk.contacts.add({username})`; `useDeleteContact.mutationFn` → `sdk.contacts.remove(contactId)`; `useFindContactCandidates.queryFn` → `sdk.contacts.search(query, {sort})`. (Wire hook done in Task 6.)
- [ ] **Step 2:** Delete `contact-repository.ts` once `git grep "contact-repository\|useContactRepository" apps/web-wallet/app` is empty.
- [ ] **Step 3:** Gate + sweep + **commit** `feat(wallet-web): A-web contacts → sdk.contacts`.

### Task 9: Transactions

**Files:** Modify `features/transactions/transaction-hooks.ts`; delete `features/transactions/transaction-repository.ts`.

- [ ] **Step 1:** `useTransactions.queryFn` → `getSdk().transactions.list({cursor: pageParam ?? undefined, pageSize: PAGE_SIZE, accountId})` (drop `userId`); switch `Cursor` import to `@agicash/wallet-sdk`; keep the post-loop `transactionsCache.upsert` and the **verbatim** SWR config (no `staleTime`, `refetchOnWindowFocus:'always'`, `refetchOnReconnect:'always'`, `retry:1`).
- [ ] **Step 2:** `useTransaction.queryFn` → `sdk.transactions.get(id)` (keep `NotFoundError` guard + `staleTime: Infinity` + refetch flags); `useHasTransactionsPendingAck.queryFn` → `sdk.transactions.countPendingAck()`; `useAcknowledgeTransaction.mutationFn` → `sdk.transactions.acknowledge(transaction.id)` (keep `onSuccess`).
- [ ] **Step 3:** The `transaction:updated` wire (Task 6) **always** calls `invalidateUnacknowledgedCount()` (the SDK payload lacks `previous_acknowledgment_status`; cheap given `staleTime: Infinity`). Keep `TransactionsCache` + `useTransactionsCache` (used by receive hooks).
- [ ] **Step 4:** Delete `transaction-repository.ts` once `git grep "transaction-repository\|useTransactionRepository" apps/web-wallet/app` is empty (`useReverseTransaction`'s `useUser`/`getCashuAccount` are unrelated — keep).
- [ ] **Step 5:** Gate + sweep + **commit** `feat(wallet-web): A-web transactions → sdk.transactions`.

### Task 10: User / settings

**Files:** Modify `features/user/user-hooks.tsx` (mutations), `features/settings/*`, `routes/_protected.accept-terms.tsx`.

- [ ] **Step 1:** `useUpdateUser`/username mutation → `sdk.user.updateUsername`; `useSetDefaultAccount` → `sdk.user.setDefaultAccount({account, setDefaultCurrency?})`; accept-terms mutation → `sdk.user.acceptTerms({walletTerms?, giftCardTerms?})`. Keep the `onSuccess setQueryData` cache pokes (they hold the domain `User`). (`useUser` identity re-source + `user:updated` wire are Tasks 4/6.)
- [ ] **Step 2:** Confirm the exact `sdk.user.*` signatures against `domains/user.ts`; delete any app `WriteUserRepository`/`ReadUserRepository` use that is now fully SDK-owned (verify no other consumer first).
- [ ] **Step 3:** Gate + sweep + **commit** `feat(wallet-web): A-web user/settings → sdk.user`.

### Task 11: Send flows (cashu + spark) [OPUS]

**Files:** Modify `features/send/{send-provider.tsx, cashu-send-quote-hooks.ts, cashu-send-swap-hooks.ts, spark-send-quote-hooks.ts, send-confirmation.tsx}`, `routes/_protected.send.share.$swapId.tsx`. Delete `features/send/{cashu-send-quote-service.ts, cashu-send-quote-repository.ts, cashu-send-swap-service.ts, cashu-send-swap-repository.ts, spark-send-quote-service.ts, spark-send-quote-repository.ts, proof-state-subscription-manager.ts}`.

- [ ] **Step 1: Estimate + execute hooks.** `useCreateCashuLightningSendQuote` → `sdk.cashu.send.createLightningQuote`; `useInitiateCashuSendQuote` → `sdk.cashu.send.execute(...)` (CREATE-ONLY — the SDK leader melts). `useCreateSparkLightningSendQuote` → `sdk.spark.send.createLightningQuote`; `useInitiateSparkSendQuote` → `sdk.spark.send.execute(...)`. `send-provider.tsx` store deps: `getCashuLightningQuote`/`getSparkLightningQuote` → the `createLightningQuote` estimates (`getInvoiceFromLud16` stays app-side).
- [ ] **Step 2: Token send.** `useCreateCashuSendSwap` → `sdk.cashu.send.createTokenSend` (returns `{token, swap: PENDING}` synchronously). The share route `_protected.send.share.$swapId.tsx` reads `sdk.cashu.send.get(swapId)` + the cache fed by `sdk.on('cashu-send-swap:updated')` and renders the token immediately (no DRAFT→PENDING wait — fork F6). `useTrackCashuSendSwap.queryFn` → `sdk.cashu.send.get`. `reverse` → `sdk.cashu.send.reverse`.
- [ ] **Step 3: Delete the 6 send service/repo files + `proof-state-subscription-manager.ts`** and the now-dead `useProcess{Cashu,Spark}Send*Tasks` + `useOnProofStateChange`/`useOnSparkSendStateChange` + the private work-set/melt helpers. Re-source the type-only imports (`CashuLightningQuote`/`CashuSwapQuote`/`SparkLightningQuote`/`DestinationDetails`) in `send-confirmation.tsx`/send-store from `@agicash/wallet-sdk`.
- [ ] **Step 4:** `send-confirmation.tsx` navigates to `/transactions/${transactionId}` on `execute()` create-success (preserved contract — fork F7); `CreateCashuTokenConfirmation` adapts to `createTokenSend`'s `{token, swap}`.
- [ ] **Step 5:** Gate + sweep (`git grep "send-quote-service\|send-swap-service\|send-quote-repository\|proof-state-subscription\|useProcessCashuSendQuoteTasks\|useProcessCashuSendSwapTasks\|useProcessSparkSendQuoteTasks" apps/web-wallet/app` empty) + **commit** `feat(wallet-web): A-web send flows → sdk.{cashu,spark}.send`.

> ⚠️ Verification owed: token-send renders QR immediately (no DRAFT hang); Lightning send UNPAID→PENDING→PAID advances on the leader + live-updates `/transactions/:id`.

### Task 12: Receive flows + token claim (cashu + spark) [OPUS]

**Files:** Modify `features/receive/{cashu-receive-quote-hooks.ts, cashu-receive-swap-hooks.ts, spark-receive-quote-hooks.ts, receive-cashu-token.tsx, receive-cashu-token-hooks.ts}`, `routes/_protected.receive.cashu_.token.tsx`. Delete `features/receive/{cashu-receive-quote-service.ts, cashu-receive-quote-repository.ts, cashu-receive-swap-service.ts, cashu-receive-swap-repository.ts, spark-receive-quote-service.ts, spark-receive-quote-repository.ts, cashu-receive-quote-core.ts, spark-receive-quote-core.ts, cashu-token-melt-data.ts, claim-cashu-token-service.ts, receive-cashu-token-service.ts, receive-cashu-token-quote-service.ts}`. Investigate/delete `receive-cashu-token-models.ts` (import types from the SDK barrel instead).
Delete `lib/cashu/{mint-quote-subscription-manager.ts, melt-quote-subscription-manager.ts, melt-quote-subscription.ts}` + remove lines 5-7 from `lib/cashu/index.ts` (keep `ExtendedCashuWallet`/`getCashuWallet`/`buildMintValidator`/`MintBlocklistSchema`).

- [ ] **Step 1: Create hooks.** `useCreateCashuReceiveQuote` (currently inline `getLightningQuote`+`createReceiveQuote`) → `sdk.cashu.receive.createLightningQuote` then `sdk.cashu.receive.execute(...)` (create-only). `useCreateSparkReceiveQuote` → `sdk.spark.receive.createLightningQuote` then `.execute`. `useTrackCashuReceiveQuote`/`useTrackSparkReceiveQuote.queryFn` → `sdk.{cashu,spark}.receive.get`.
- [ ] **Step 2: Deep-link claim** (`_protected.receive.cashu_.token.tsx`) — delete `getClaimCashuTokenService`; the `?claimTo` branch calls `sdk.cashu.receive.receiveToken({token, claimTo})` inside a **try/catch** (it throws `DomainError`, no `{success:false}` union — fork). Map `result.destinationAccount.purpose` to the gift-card vs explicit redirect.
- [ ] **Step 3: Interactive screen** (`receive-cashu-token.tsx` + `-hooks.ts`) — `useCashuTokenWithClaimableProofs` → `sdk.cashu.receive.getClaimableToken({token, cashuPubKey})`; `useReceiveCashuTokenAccounts`/`useCashuTokenSourceAccountQuery` → `sdk.cashu.receive.getTokenAccounts({token, preferredReceiveAccountId})`; replace the entire inline `claimTokenMutation` (same-account swap vs cross-account quotes + `addAndSetReceiveAccount`) with `sdk.cashu.receive.createTokenClaim({token, sourceAccount, destinationAccount})` (add-unknown-account fold-in is inside; NO setDefault). **Keep** `useReceiveCashuTokenAccountPlaceholders`/`getSparkAccountPlaceholder`/`useBuildCashuAccountPlaceholder` for the signed-out `_public` path (SDK `getTokenAccounts` requires auth).
- [ ] **Step 4: Delete** the 12 receive service/repo/core/orchestrator files + the 3 `lib/cashu` subscription managers + the dead `useProcess*ReceiveTasks`/`useOn*ReceiveStateChange`/`useOnMintQuoteStateChange`/`usePendingMeltQuotes` helpers. Import token-receive types (`ReceiveCashuTokenAccount`/`CashuAccountWithTokenFlags`/`isClaimingToSameCashuAccount`) from `@agicash/wallet-sdk`.
- [ ] **Step 5:** Gate + sweep (`git grep "receive-quote-service\|receive-swap-service\|receive-quote-repository\|receive-swap-repository\|receive-quote-core\|claim-cashu-token-service\|receive-cashu-token-service\|receive-cashu-token-quote-service\|cashu-token-melt-data\|mint-quote-subscription\|melt-quote-subscription\|useProcessCashuReceiveQuoteTasks\|useProcessCashuReceiveSwapTasks\|useProcessSparkReceiveQuoteTasks" apps/web-wallet/app` empty) + **commit** `feat(wallet-web): A-web receive + token claim → sdk.{cashu,spark}.receive`.

> ⚠️ Verification owed: Lightning receive paid transition reaches `useTrack*` via the cache; deep-link `?claimTo` (gift-card + normal) success-redirect + DomainError toast; interactive claim same-account AND cross-account (add-unknown-account, no default set).

### Task 13: Transfers

**Files:** Modify `features/transfer/transfer-hooks.ts`; delete `features/transfer/transfer-service.ts`.

- [ ] **Step 1:** `useGetTransferQuote.mutationFn` → `getSdk().transfers.createQuote({sourceAccount, destinationAccount, amount})`; `useInitiateTransfer.mutationFn` → `sdk.transfers.execute(quote)`. Keep the Concurrency/DomainError retry policy in the hook wrapper. Re-source `TransferQuote` from `@agicash/wallet-sdk`.
- [ ] **Step 2:** Delete `transfer-service.ts` once `git grep "transfer-service\|useTransferService" apps/web-wallet/app` is empty.
- [ ] **Step 3:** Gate + sweep + **commit** `feat(wallet-web): A-web transfers → sdk.transfers`.

---

## Part 3 — Teardown + holistic

### Task 14: Final cleanup [sonnet, OPUS-reviewed]

**Files:** `entry.client.tsx`, `features/agicash-db/database.client.ts`, `features/agicash-db/supabase-session.ts`, `features/shared/feature-flags.ts`, `routes/_protected.tsx`, `root.tsx`.

- [ ] **Step 1:** Remove the `opensecret.configure()` call in `entry.client.tsx:33-37` (the SDK configures Open Secret internally); keep `ensureBreezWasm()` + Sentry init.
- [ ] **Step 2: feature-flags** — give `feature-flags.ts` its own minimal `createClient(getSupabaseUrl(), VITE_SUPABASE_ANON_KEY)` (anon-only `evaluate_feature_flags` RPC; reuse the inlined `getSupabaseUrl`). ⚠️ Verify the RPC works anon-only.
- [ ] **Step 3:** Delete `database.client.ts` + `supabase-session.ts` (the `agicashDbClient`/`agicashRealtimeClient`/session-token singletons) once `git grep "agicashDbClient\|agicashRealtimeClient\|getSupabaseSessionToken\|supabaseSessionTokenQuery\|database.client\|supabase-session" apps/web-wallet/app` shows only the deletions (feature-flags now has its own client; server routes use `server-sdk.server.ts`).
- [ ] **Step 4:** `root.tsx` — remove the `SupabaseRealtimeError` import (34) + the `error instanceof SupabaseRealtimeError` error-boundary branch (263); connection failures degrade via the non-throwing `connection:state` event (fork S4).
- [ ] **Step 5:** Remove the `supabaseSessionTokenQuery` prefetch in `_protected.tsx:83` (SDK session token self-warms).
- [ ] **Step 6:** Full orphan sweep across `apps/web-wallet/app` for every deleted symbol/file; gate; **commit** `feat(wallet-web): A-web teardown (delete db/session glue, feature-flags client, root cleanup)`.

### Task 15: Holistic review + biome pass + verification checklist [OPUS]

- [ ] **Step 1:** Whole-branch OPUS review (diff vs `65a95d68`): seam untouched (base `sdk.ts`/`engine.ts` byte-identical); no app import of `@agicash/opensecret` auth, the deleted repos/services, or `lib/supabase` realtime; `sdk.on` subscriptions all clean up; the 13 caches' version-gates intact; create-only contract preserved.
- [ ] **Step 2:** Controller-verified gate: `bun run typecheck` (8/8 exit 0) + `bun run test` (all packages 0 fail). Run from the worktree, capture output.
- [ ] **Step 3: ONE biome pass** on `sdkx/stateless` (variant-local lint/formatter churn — the per-task diffs were logic-only). `bun run fix:all` ONCE here, review the churn is cosmetic, commit separately `style(wallet-web): A-web biome pass`.
- [ ] **Step 4: Assemble the browser/live verification checklist** (owed — run separately via Chrome DevTools MCP + `verify`/`run` against a live stack with `VITE_BREEZ_API_KEY`): boot + sign-in (fresh + returning), live balance via `sdk.on` (pay→balance), 2-tab leader + ≤10s failover, kill-leader-mid-flow, reconnect `connection:resync` invalidate-all, online/offline + visibility, session-expiry (full + guest-silent), Google OAuth, password-reset, Lightning send/receive (cashu + spark) terminal transitions, token-send QR-immediate, deep-link + interactive token claim (same + cross account), accounts/contacts/transactions live, feature-flags anon RPC, LAN dev, `/lnurl-test`. Record in the SDD ledger; do NOT mark A-web "done" until these are run.

---

## Self-Review (writing-plans checklist — completed)

- **Shopping-list coverage:** all 12 grounding-doc items mapped to tasks (config/LAN T3; singleton T3; auth/session-expiry T4; 13 caches+handlers T6; channel→sdk.on + resync T6; transactions T9; leader/TaskProcessor delete T5; `<Wallet>` lifecycle T5; `config.domain` T3; `createStatelessAccounts` wiring T1; duplicated-file deletions T7-T13; engine fold-ins already done — not re-done). Plus the critic's GAP: contacts read/write layer = T2 (SDK) + T8 (app).
- **SDK-missing resolved:** S1 contacts.list → T2; S2/S3 accounts wiring → T1; S4 connection-error boundary → T14.
- **Type consistency:** `getSdk()`/`StatelessSdk`/`StatelessAccounts`/`AddCashuAccountInput`/`Cursor`/`TransferQuote`/`CashuLightningQuote`/token-receive types are introduced in Tasks 1/3 and consumed consistently in Tasks 4-13.
- **Ordering keeps the gate green:** T3 (new module) → T4 (auth) → T5 (background + delete leader) → T6 (atomic realtime swap) → T7-T13 (per-feature queries/mutations + processor/service/repo deletions; the dead `useProcess*Tasks` left by T5 are removed here) → T14 (final glue deletions) → T15 (holistic + biome + verification).
