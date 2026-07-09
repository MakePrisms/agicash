# Wallet SDK Auth & User Slice (Step 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement step 5 of the no-cache SDK migration: the first runtime `Sdk` class (`AgicashSdk.create(config)`) with working `auth`, `user`, and `events` namespaces, adopt the React-agnostic `@agicash/opensecret@1.0.0-rc.0`, settle the step-5 contract placeholders, and flip the web app's auth + user imports from `/temporary` to `sdk.*`.

**Architecture:** The SDK configures Open Secret itself inside `create(config)` (host passes `apiUrl`/`clientId`/storage adapter), builds its own Supabase client with an internal Open Secret → Supabase token getter, and keeps an in-memory `AuthSession` snapshot maintained by `AuthService` (restore on `init()`, refresh after every auth verb, refresh-token expiry timer with guest auto-extend and `auth.session-expired` emission). The web keeps thin glue: TanStack `authQueryOptions` wrapping `sdk.init()` + `sdk.auth.getSession()`, plus Sentry/session-hint-cookie/navigation concerns. Specs: `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md` (parent) and `docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md` (contract).

**Tech Stack:** TypeScript (bun workspace monorepo), React Router v7, TanStack Query v5 (web only), `@agicash/opensecret@1.0.0-rc.0`, `@supabase/supabase-js`, `jwt-decode`, `zod/mini`, `bun test` for SDK unit tests.

## Global Constraints

- **SDK is React-agnostic and headless-safe.** No file under `packages/wallet-sdk/` may import `react`, `@tanstack/react-query`, or read `window`/`document`/`localStorage`/`sessionStorage`/cookies. Host state enters only via `create(config)` ports (`config.auth.storage`).
- **`@agicash/opensecret` is pinned exact** in the root `workspaces.catalog`: `"1.0.0-rc.0"` after Task 1. Verified: the RC's storage keys are unchanged (`access_token`, `refresh_token`), `browserStorage` maps `persistent`→`localStorage` and `session`→`sessionStorage` lazily, and the package has **no React peer deps**. Existing user sessions survive the upgrade.
- **The contract types in `packages/wallet-sdk/sdk.ts` are the source of truth.** `AuthStorage` binds *verbatim* to the RC's `StorageProvider` shape (scopes `persistent`/`session`, methods `getItem`/`setItem`/`removeItem`, sync-or-async returns) so the SDK ships no adapter over it.
- **`create()` is sync with no I/O; `init()` is memoized single-flight.** In this slice `init()` = session restore only. The web keeps calling `ensureBreezWasm()` from `/temporary` (entry.client + `_protected` middleware) — WASM folds into `init()` when the first Spark namespace lands (decision, see Decision Record).
- **Web-only concerns stay in the web glue:** Sentry user tracking, session-hint cookie, TanStack invalidation, navigation/revalidation, feature-flag load/reset, OAuth deep-link restore (`oauthLoginSessionStorage`), pending-terms storage.
- **Package manager is `bun`; never npm/npx/yarn/pnpm.** In this environment `bun` is NOT on PATH — prefix commands with `export PATH="$PWD/.devenv/profile/bin:$PATH"` (run from the repo root).
- **Branch `sdk/auth-slice` off `master`.** Conventional commits (`feat(wallet-sdk):`, `refactor(web-wallet):`, …). Run `bun run fix:all && bun run typecheck` before every commit — `fix:all` is biome lint/format ONLY (it does not typecheck, despite CLAUDE.md's description); `typecheck` runs each package's `tsc`.
- **Behavior parity is the review bar.** Every auth flow (email login/signup, guest signup + re-signin, Google OAuth, verify email, convert guest, sign out, session expiry) must behave as on `master`; deltas are listed in "Accepted behavior deltas" below and nothing else may change.

## Decision Record (resolved with maintainer, 2026-07-09)

| # | Decision                                                                                                                                                                                                                                                                                                                                                                                                               |
|---|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| A1 | **`ensureUserData` (user + default-accounts upsert in `_protected.tsx`) stays in the web via `/temporary` this slice.** It constructs `AccountRepository` (accounts domain); the accounts slice (step 6) gives it a contract home. Step 5 flips every other user-domain consumer.                                                                                                                                      |
| A2 | **Session-expiry machinery moves into the SDK now.** `AuthService` arms a long-timeout at refresh-token expiry−5s: guests are auto-re-signed-in internally; full accounts get the session cleared + `auth.session-expired` emitted. This requires the minimal typed event emitter now (`auth.session-expired` is explicitly not realtime-backed). Web's `useHandleSessionExpiry` is replaced by an event subscription. |
| A3 | **`init()` = session restore only** this slice (see Global Constraints). Rationale: gating `authQueryOptions` on a combined restore+WASM `init()` would newly break login pages under WASM-unavailable (iOS Lockdown Mode) — a regression. No Spark ops exist on the contract until steps 11/15.                                                                                                                       |
| A4 | **Guest password generation: SDK default + optional host override.** `SdkConfig.auth.generateGuestPassword?: () => Promise<string                                                                                                                                                                                                                                                                                      | null>` — resolving null falls through to the SDK's internal CSPRNG generator, which is the ONLY generator (the web's `~/lib/password-generator.ts` is deleted). The web passes a two-line bridge to `window.getMockPassword`, preserving the e2e seam with zero e2e changes. *(Refined 2026-07-09 from a full-replacement port, removing the duplicated generator body.)* |
| A5 | **`AuthUser` settles to Open Secret's user shape verbatim:** `export type AuthUser = UserResponse['user']` (id, name, email?, email_verified, login_method, created_at, updated_at). The web already consumes exactly these fields (`_protected.tsx`, `_auth.tsx`).                                                                                                                                                    |
| A6 | **The SDK builds its own Supabase client** (contract decision #1 from #1164) with an internal memoized third-party-token getter. Two Supabase clients coexist during migration: web's (`database.client.ts` — unmigrated domains + realtime) and the SDK's (auth/user namespaces). Accepted transitional cost; each caches its own token.                                                                              |
| A7 | **`guestAccountStorage` moves into the SDK** behind `config.auth.storage.persistent` (same `guestAccount` localStorage key → existing guest creds survive). `oauth-login-session-storage`, `pending-terms-storage`, `session-hint-cookie`, and `shared/auth.ts` (`isLoggedIn` for the web's own DB client) **stay in the web**.                                                                                        |
| A8 | **`setLongTimeout`/`clearLongTimeout` move from `~/lib/timeout` to `@agicash/utils`** (needed by both web and SDK).                                                                                                                                                                                                                                                                                                    |
| A9 | **`WriteUserRepository` drops `accountRepository` from its constructor**; `upsert()` takes it as a parameter (only `upsert` uses it). Lets the SDK construct the user namespace without the accounts graph. `UserService.setDefaultAccount` loosens `account` to `Pick<Account, 'id' \| 'currency'>`.                                                                                                                  |
| A10 | Step-5 params settle as: `AcceptTermsParams = { walletTerms?: boolean; giftCardTerms?: boolean }`, `SetDefaultAccountParams = { accountId: string; setDefaultCurrency?: boolean }`, `SetDefaultCurrencyParams = { currency: Currency }`.                                                                                                                                                                               |
| A11 | The `_protected.receive.cashu_.token.tsx` default-account write flips to `sdk.user.setDefaultAccount({ accountId, setDefaultCurrency: true })` now (it is user-domain surface). `UserService`/`ReadUserRepository` remain exported from `/temporary` for their **static** helpers (`isDefaultAccount`, `getExtendedAccounts`, `toUser` for the realtime row mapper) until steps 6/18.                                  |
| A12 | `sdk.featureFlags` namespace is **not** wired this slice (flags stay web-configured via `configureFeatureFlags(agicashDbClient)`); it needs no auth work and has no assigned step — it lands alongside a later slice.                                                                                                                                                                                                  |
| A13 | **`auth.session-refreshed` added to the event map** (2026-07-09, maintainer-approved): fires only on SDK-initiated session refreshes — today exactly the guest auto-extension; host-initiated verbs never fire it (same principle as `auth.session-expired`'s "the host knows its own logout"). Rationale trail: PR #1164 floated `auth.changed` and landed the narrower `auth.session-expired`, but the recorded reasoning covered sign-out, not SDK-internal extension, and the hint-cookie consequence was never discussed there — an unconsidered gap, and the contract states adding events is non-breaking. The web's session-events hook invalidates the auth query on it, restoring master's cookie freshness after a guest auto-extend. |

## Accepted behavior deltas (everything else is parity)

1. **Guest extend failure:** master does `removeKeys()` + `window.location.reload()`; now the SDK falls through to the death path (session cleared + `auth.session-expired`) and the web shows the toast + redirects. Strictly better UX, same terminal state.
2. **Session-hint cookie refresh after guest auto-extend:** restored to master behavior via `auth.session-refreshed` (A13) — the web's session-events hook invalidates the auth query, whose refetch re-sets the cookie with the extended expiry, exactly like master's extend-through-invalidation. Residual: on pages where the hook isn't mounted (public/marketing — where master never armed an extension timer at all, see delta 6), the `staleTime` pinned to fetch-time expiry re-syncs the cookie on the next focus/mount refetch after the old expiry; a background tab there can still hit one cold-load `/home` bounce. Auth itself is unaffected (the cookie is a non-authoritative SSR hint).
3. **Sentry `setUser` timing:** master sets `{id: sub}` from the raw JWT before `fetchUser`; the glue still does this, then upgrades to `{id, isGuest}` after restore — unchanged ordering, but the fetch itself now happens inside `sdk.init()`.
4. **Sign-out memo-clear ordering:** master clears the SDK module memos (`clearSparkWallets`, `clearAgicashMintAuthToken`) last, after `queryClient.clear()`; now they clear at session end inside `sdk.auth.signOut()`. Post-clear repopulation by an in-flight request remains possible for the spark-wallet and mint-CAT memos **under either ordering** (master's clear-last only narrowed the window) but is harmless by construction: the Supabase token cache is generation-fenced (cannot cache post-reset), spark-wallet entries are keyed by the user's mnemonic (never served cross-user), and the mint CAT is wiped again when a *different* user's session begins (the `lastUserId` guard in `applySessionFromServer`). Residual: a same-user memo staying warm across their own sign-out/sign-in (benign), and one theoretical sliver — a CAT fetch from the previous session resolving *after* the next user's sign-in — tracked in Deferred.
5. **`authQueryOptions` is snapshot-driven:** master's queryFn called `fetchUser()` on every refetch; now a refetch awaits the memoized `sdk.init()` and reads the in-memory session snapshot. Every existing invalidation site is preceded by an SDK auth verb that already refreshed the snapshot, so reads stay fresh — but future code calling `invalidateAuthQueries()` with no preceding auth verb reads the snapshot, not the server. (A session-ending failure clears the restore memo, so the next invalidation re-restores from storage — a transient post-login `fetchUser` blip recovers on the glue's own invalidation, like master.)
6. **Expiry-timer scope:** master armed the refresh-expiry timer only under the protected layout's `<Wallet>` (which wraps every protected page, verify-email and accept-terms included); the SDK arms it whenever a session exists — now also on public/marketing pages that read auth state. A full-account expiry there ends the session in place without a toast (the subscriber lives in `Wallet`); master had no timer on those pages and logged out on the next protected navigation. Same terminal state.
7. **`setDefaultAccount` reads the account row (and writes column-minimally):** master passed the cached user + account objects and wrote all three default columns, echoing unchanged fields from the cache — which could revert a concurrent change from another device. Now the update writes only the changed columns (no user read, no echo, lost-update-proof) and reads just the account row by PK to derive the per-currency column server-truthfully. One extra lightweight read on the settings and token-claim paths; strictly safer writes.

## Deferred (tracked, out of scope)

- `ensureUserData` bootstrap → step 6 (A1). `_protected.tsx` keeps `/temporary` imports for it.
- `getEncryption` + the encryption/cryptography key plumbing (`encryption-hooks.ts`, `cryptography-hooks.ts`, `/temporary`'s `getEncryption`): the contract's migration mapping assigns these "internal (auth slice)", but their remaining web consumers are the not-yet-migrated domains and `ensureUserData` — they go SDK-internal with the accounts slice (step 6, alongside A1) at the earliest.
- `ReadUserDefaultAccountRepository` has NO web consumers (its only caller is the SDK-internal `lightning-address-service`); it stays on `/temporary`'s export list untouched and gets dropped there in step 17/19.
- `ReadUserRepository.toUser` in `useUserChangeHandlers` (realtime row mapping) → step 18.
- Breez WASM into `init()` → first Spark slice (A3).
- `sdk.featureFlags` wiring (A12).
- Deleting `UserService`/user repos from `/temporary` → step 6/18 once the statics find contract homes.
- Exposing refresh-token expiry on `getSession()` (so the web glue stops reading Open Secret's storage keys for the hint cookie and `staleTime`) → revisit with the step-18 session/events work.
- SDK-thrown error typing: the user repos throw plain `Error` today, so `sdk.user.*` doesn't yet honor the contract's "everything the SDK throws extends `SdkError`". Wrapping repo errors is a cross-domain pass — tracked for step 17/19. (Web behavior is unaffected: unknown errors already get the generic destructive toast.)
- Generation-fencing the mint-CAT memo (like the Supabase token getter): closes the last theoretical repopulation sliver — a CAT fetch from the previous session resolving after the next user's sign-in (i.e., surviving both the sign-out and the sign-in). Pre-existing on master with the same window; sub-second across two user actions. (Cancellation is not an alternative: the fetch happens inside `@agicash/opensecret`'s encrypted tunnel, which exposes no AbortSignal — and an abort landing after the response is queued can't prevent the write anyway; the fence is the correctness mechanism.)
- Session-scoped AbortController for SDK-internal reads: created per session, aborted on `endSession()`, signal threaded into the namespaces' Supabase queries (the repos already accept `abortSignal`), so in-flight namespace promises reject at session end instead of resolving into a dead session. Implements the contract's `dispose()` teardown semantics ("still-pending namespace promises reject with a typed `SdkError`") → step-18/dispose work.

---

## File Structure

**Created (packages/):**
- `packages/wallet-sdk/lib/events.ts` — `WalletEventEmitter` (typed `on`/`emit`)
- `packages/wallet-sdk/lib/events.test.ts`
- `packages/wallet-sdk/lib/password.ts` — CSPRNG `generateRandomPassword`
- `packages/wallet-sdk/domain/user/guest-account-storage.ts` — port-backed guest creds
- `packages/wallet-sdk/domain/user/guest-account-storage.test.ts`
- `packages/wallet-sdk/domain/user/auth-service.ts` — `AuthService implements AuthApi`
- `packages/wallet-sdk/domain/user/auth-service.test.ts`
- `packages/wallet-sdk/domain/user/user-api.ts` — `createUserApi(deps): UserApi`
- `packages/wallet-sdk/db/client.ts` — `createAgicashDbClient`
- `packages/wallet-sdk/db/supabase-session.ts` — memoized third-party-token getter
- `packages/wallet-sdk/db/supabase-session.test.ts`
- `packages/wallet-sdk/agicash-sdk.ts` — `class AgicashSdk`
- `packages/utils/src/timeout.ts` (moved from web)

**Modified (SDK):**
- `packages/wallet-sdk/sdk.ts` — settle `AuthStorage`, `AuthUser`, 3 param types; add `generateGuestPassword` port
- `packages/wallet-sdk/index.ts` — export `AgicashSdk`
- `packages/wallet-sdk/lib/error.ts` — add internal `NoSessionError`
- `packages/wallet-sdk/domain/user/user-repository.ts` — A9 refactor
- `packages/wallet-sdk/domain/user/user-service.ts` — A9 param loosening
- Root `package.json` — catalog bump to `1.0.0-rc.0`

**Created (web):**
- `apps/web-wallet/app/features/shared/sdk.client.ts` — config assembly + `sdk` singleton

**Modified (web):**
- `apps/web-wallet/app/entry.client.tsx` — drop `configure()`, import `sdk`
- `apps/web-wallet/app/features/agicash-db/database.client.ts` — export `supabaseUrl`/`supabaseAnonKey`
- `apps/web-wallet/app/features/user/auth.ts` — rewrite as thin glue over `sdk.auth`
- `apps/web-wallet/app/features/user/user-hooks.tsx` — flip to `sdk.user`/`sdk.auth`
- `apps/web-wallet/app/features/wallet/wallet.tsx` — expiry hook swap
- `apps/web-wallet/app/routes/_protected.tsx` — `AuthUser` import + A9 call-site
- `apps/web-wallet/app/routes/_auth.oauth.$provider.tsx` — `completeGoogleAuth`
- `apps/web-wallet/app/features/signup/verify-email.ts` — `sdk.auth.verifyEmail`
- `apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx` — A11
- `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts`, `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts`, `apps/web-wallet/app/hooks/use-long-timeout.ts` — timeout import repoint (the hook is later deleted in Task 11)

**Deleted (web):**
- `apps/web-wallet/app/features/user/guest-account-storage.ts` (→ SDK)
- `apps/web-wallet/app/features/user/user-repository-hooks.ts`
- `apps/web-wallet/app/features/user/user-service-hooks.ts`
- `apps/web-wallet/app/lib/timeout.ts` (→ `@agicash/utils`)
- `apps/web-wallet/app/hooks/use-long-timeout.ts` (its only consumer is the old `useHandleSessionExpiry`; dead after Task 11)
- `apps/web-wallet/app/lib/password-generator.ts` (→ SDK `lib/password.ts` as the only generator; the web keeps just the `window.getMockPassword` bridge in `sdk.client.ts` — A4)

---

### Task 1: Adopt `@agicash/opensecret@1.0.0-rc.0`

**Files:**
- Modify: `package.json` (repo root, `workspaces.catalog`)
- Modify: `apps/web-wallet/package.json`, `packages/wallet-sdk/package.json` (`jwt-decode` → `catalog:`)
- Modify: `apps/web-wallet/app/entry.client.tsx:36-39` (temporary `storage` arg to stay green)

**Interfaces:**
- Produces: the RC API for all later tasks — `configure({ apiUrl, clientId, storage })`, `browserStorage`, `StorageProvider`/`KeyValueStore` types, and the unchanged fn set (`signIn`, `signUp`, `signUpGuest`, `signInGuest`, `signOut`, `fetchUser`, `verifyEmail`, `requestNewVerificationCode`, `convertGuestToUserAccount`, `initiateGoogleAuth`, `handleGoogleCallback`, `generateThirdPartyToken`, `getPrivateKey`, `getPrivateKeyBytes`, `getPublicKey`, `signMessage`).

- [ ] **Step 1: Bump the catalog version (+ fold `jwt-decode` into the catalog)**

In root `package.json`, change:

```json
"@agicash/opensecret": "0.1.0",
```

to:

```json
"@agicash/opensecret": "1.0.0-rc.0",
```

and add `"jwt-decode": "4.0.0"` to the same `workspaces.catalog` block, switching the two consumers (`apps/web-wallet/package.json`, `packages/wallet-sdk/package.json`) from `"jwt-decode": "4.0.0"` to `"jwt-decode": "catalog:"` — repo rule: a dep shared by ≥2 packages lives in the catalog.

- [ ] **Step 2: Install**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun install`
Expected: lockfile updates; no peer-dep warnings (RC has no React peer deps).

- [ ] **Step 3: Satisfy the now-required `storage` option in `entry.client.tsx`**

The RC's `configure()` requires `storage`. In `apps/web-wallet/app/entry.client.tsx`, change:

```ts
import { configure } from '@agicash/opensecret';
```
```ts
configure({
  apiUrl: openSecretApiUrl,
  clientId: openSecretClientId,
});
```

to:

```ts
import { browserStorage, configure } from '@agicash/opensecret';
```
```ts
configure({
  apiUrl: openSecretApiUrl,
  clientId: openSecretClientId,
  storage: browserStorage,
});
```

(This is transitional; Task 10 moves `configure()` into `AgicashSdk.create()` and reverts this file further.)

- [ ] **Step 4: Verify types + boot**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck`
Expected: PASS (all used fn signatures are unchanged in the RC).

Smoke: `bun run dev`, open `http://127.0.0.1:3000`, log in (or guest signup), confirm wallet loads. A pre-existing session in localStorage must still be logged in (keys unchanged).

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock apps/web-wallet/package.json packages/wallet-sdk/package.json apps/web-wallet/app/entry.client.tsx
git commit -m "feat(deps): adopt React-agnostic @agicash/opensecret 1.0.0-rc.0"
```

---

### Task 2: Move the long-timeout util to `@agicash/utils`

**Files:**
- Create: `packages/utils/src/timeout.ts` (content = current `apps/web-wallet/app/lib/timeout.ts`, verbatim)
- Modify: `packages/utils/src/index.ts` (add `export * from './timeout';`)
- Delete: `apps/web-wallet/app/lib/timeout.ts`
- Modify: `apps/web-wallet/app/hooks/use-long-timeout.ts` (import `{ clearLongTimeout, setLongTimeout }` from `@agicash/utils`)
- Modify: `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts:~41` (same repoint)
- Modify: `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts:6` (imports the util RELATIVELY: `from '../timeout'` → `from '@agicash/utils'`)

**Interfaces:**
- Produces: `setLongTimeout(callback: () => void, delay: number): LongTimeout`, `clearLongTimeout(timeout: LongTimeout): void`, `type LongTimeout` from `@agicash/utils` — consumed by Task 6's `AuthService`.

- [ ] **Step 1: Move the file** — `git mv` semantics: create `packages/utils/src/timeout.ts` with the exact current content of `apps/web-wallet/app/lib/timeout.ts`, delete the web file, add the barrel export.

- [ ] **Step 2: Repoint the three web importers** — `use-long-timeout.ts` and `cashu-receive-quote-hooks.ts` import via the `~/lib/timeout` alias; `lib/cashu/melt-quote-subscription.ts:6` imports via the RELATIVE specifier `'../timeout'`. Replace all three with `@agicash/utils`. Keep imported names identical (`type LongTimeout`, `clearLongTimeout`, `setLongTimeout`).

- [ ] **Step 3: Verify**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck`
Expected: PASS. `grep -rn "from '.*timeout'" apps/web-wallet/app | grep -v '@agicash/utils'` returns nothing (catches alias AND relative specifiers).

- [ ] **Step 4: Commit**

```bash
git add packages/utils apps/web-wallet
git commit -m "refactor(utils): move setLongTimeout/clearLongTimeout to @agicash/utils"
```

---

### Task 3: Settle the step-5 contract types in `sdk.ts`

**Files:**
- Modify: `packages/wallet-sdk/sdk.ts`

**Interfaces:**
- Produces (consumed by every later task):
  - `AuthKeyValueStore` = `{ getItem(key): string | null | Promise<string | null>; setItem(key, value): void | Promise<void>; removeItem(key): void | Promise<void> }`
  - `AuthStorage` = `{ persistent: AuthKeyValueStore; session: AuthKeyValueStore }`
  - `SdkConfig['auth']` gains `generateGuestPassword?: () => Promise<string>`
  - `AuthUser = UserResponse['user']` (from `@agicash/opensecret`)
  - `AcceptTermsParams`, `SetDefaultAccountParams`, `SetDefaultCurrencyParams` per A10.

- [ ] **Step 1: Replace the `AuthStorage` placeholder** (`sdk.ts:60-65`) with the RC-verbatim shape:

```ts
/**
 * Minimal key/value store — the Web Storage API subset the SDK persists auth
 * state through. Methods may be sync (window.localStorage) or async (React
 * Native AsyncStorage, SQLite); the SDK always awaits results. Matches the
 * @agicash/opensecret StorageProvider interface verbatim, so one host object
 * backs both.
 */
export type AuthKeyValueStore = {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
};

/**
 * Host-backed session persistence. `persistent` must survive restarts (auth
 * tokens, guest credentials); `session` is per-app-session (attestation
 * handshake material). Browser hosts map them to localStorage/sessionStorage.
 */
export type AuthStorage = {
  persistent: AuthKeyValueStore;
  session: AuthKeyValueStore;
};
```

- [ ] **Step 2: Add the guest-password port** to `SdkConfig.auth`:

```ts
  auth: {
    apiUrl: string;
    clientId: string;
    storage: AuthStorage;
    /**
     * Host override for guest credential generation; resolve null to use the
     * SDK's CSPRNG generator. Test seam (the web bridges its e2e password
     * mock through it).
     */
    generateGuestPassword?: () => Promise<string | null>;
  };
```

- [ ] **Step 3: Settle `AuthUser`** — replace `export type AuthUser = unknown; // settles in step 5 (auth & user)` with:

```ts
import type { UserResponse } from '@agicash/opensecret';
// …
export type AuthUser = UserResponse['user'];
```

(import goes at the top with the other imports).

- [ ] **Step 4: Settle the three param placeholders** — replace the `unknown` lines at the bottom:

```ts
export type AcceptTermsParams = {
  walletTerms?: boolean;
  giftCardTerms?: boolean;
};

export type SetDefaultAccountParams = {
  accountId: string;
  /** Also switch the user's default currency to the account's currency. */
  setDefaultCurrency?: boolean;
};

export type SetDefaultCurrencyParams = {
  currency: Currency;
};
```

Add `Currency` to the existing `@agicash/money` type import (`import type { Currency, Money } from '@agicash/money';`).

- [ ] **Step 5: Add `auth.session-refreshed` to `WalletEventMap`** (contract addition per A13 — adding events is non-breaking per the map's own invariant). Insert directly after the `'auth.session-expired'` entry in `sdk.ts`:

```ts
  /**
   * The SDK refreshed the session without a host-initiated verb — today:
   * guest auto-extension at refresh-token expiry. Host-initiated verbs never
   * fire it (the host knows its own actions). Hosts re-sync session-derived
   * state from it (the web: auth query + session-hint cookie).
   */
  'auth.session-refreshed': Record<string, never>;
```

Append the same entry with a one-line A13 note to the event map in `docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md`, so the prose contract stays in sync with `sdk.ts`.

- [ ] **Step 6: Annotate `init()`'s contract JSDoc for the migration window** — the doc-comment on `Sdk['init']` promises session restore AND the Breez WASM load, but step 5 ships restore-only (A3). Append one line to that JSDoc so contract readers aren't misled mid-migration:

```ts
   * Migration note: until the first Spark slice lands, `init()` performs
   * session restore only — the WASM load still runs host-side.
```

- [ ] **Step 7: Verify + commit**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck` → PASS.

```bash
git add packages/wallet-sdk/sdk.ts
git commit -m "feat(wallet-sdk): settle the step-5 contract types (auth storage, AuthUser, user params)"
```

---

### Task 4: Typed event emitter (`lib/events.ts`)

**Files:**
- Create: `packages/wallet-sdk/lib/events.ts`
- Test: `packages/wallet-sdk/lib/events.test.ts`

**Interfaces:**
- Consumes: `WalletEventMap`, `WalletEvents`, `Logger` types from `../sdk`.
- Produces: `class WalletEventEmitter implements WalletEvents` with `on(event, handler): () => void` and `emit(event, payload): void` — consumed by Tasks 6 and 8.

- [ ] **Step 1: Write the failing tests**

```ts
// packages/wallet-sdk/lib/events.test.ts
import { describe, expect, it } from 'bun:test';
import { WalletEventEmitter } from './events';

describe('WalletEventEmitter', () => {
  it('delivers payloads to subscribed handlers', () => {
    const emitter = new WalletEventEmitter();
    const received: unknown[] = [];
    emitter.on('auth.session-expired', (payload) => received.push(payload));

    emitter.emit('auth.session-expired', {});

    expect(received).toEqual([{}]);
  });

  it('stops delivering after unsubscribe', () => {
    const emitter = new WalletEventEmitter();
    let calls = 0;
    const unsubscribe = emitter.on('auth.session-expired', () => {
      calls += 1;
    });

    unsubscribe();
    emitter.emit('auth.session-expired', {});

    expect(calls).toBe(0);
  });

  it('isolates a throwing handler and reports it to the logger', () => {
    const errors: string[] = [];
    const emitter = new WalletEventEmitter({
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: (message) => {
        errors.push(message);
      },
    });
    let secondHandlerRan = false;
    emitter.on('auth.session-expired', () => {
      throw new Error('boom');
    });
    emitter.on('auth.session-expired', () => {
      secondHandlerRan = true;
    });

    emitter.emit('auth.session-expired', {});

    expect(secondHandlerRan).toBe(true);
    expect(errors).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && cd packages/wallet-sdk && bun test lib/events.test.ts`
Expected: FAIL — `events.ts` does not exist.

- [ ] **Step 3: Implement**

```ts
// packages/wallet-sdk/lib/events.ts
import type { Logger, WalletEventMap, WalletEvents } from '../sdk';

type Handler = (payload: never) => void;

export class WalletEventEmitter implements WalletEvents {
  private readonly handlers = new Map<keyof WalletEventMap, Set<Handler>>();

  constructor(private readonly logger?: Logger) {}

  on<K extends keyof WalletEventMap>(
    event: K,
    handler: (payload: WalletEventMap[K]) => void,
  ): () => void {
    const set = this.handlers.get(event) ?? new Set<Handler>();
    set.add(handler as Handler);
    this.handlers.set(event, set);
    return () => {
      set.delete(handler as Handler);
    };
  }

  emit<K extends keyof WalletEventMap>(
    event: K,
    payload: WalletEventMap[K],
  ): void {
    const set = this.handlers.get(event);
    if (!set) {
      return;
    }
    for (const handler of set) {
      try {
        (handler as (payload: WalletEventMap[K]) => void)(payload);
      } catch (error) {
        this.logger?.error(`Event handler for ${event} threw`, error);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests** — same command, expected: 3 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/lib/events.ts packages/wallet-sdk/lib/events.test.ts
git commit -m "feat(wallet-sdk): add the typed wallet event emitter"
```

---

### Task 5: SDK password generator + guest-account storage

**Files:**
- Create: `packages/wallet-sdk/lib/password.ts`
- Create: `packages/wallet-sdk/domain/user/guest-account-storage.ts`
- Test: `packages/wallet-sdk/domain/user/guest-account-storage.test.ts`

**Interfaces:**
- Consumes: `AuthKeyValueStore`, `Logger` from `../../sdk`; `safeJsonParse` from `@agicash/utils`.
- Produces:
  - `generateRandomPassword(length?: number): Promise<string>` (CSPRNG, no window access)
  - `type GuestAccountDetails = { id: string; password: string }`
  - `createGuestAccountStorage(store: AuthKeyValueStore, logger?: Logger): GuestAccountStorage` where `GuestAccountStorage = { get(): Promise<GuestAccountDetails | null>; store(details): Promise<void>; clear(): Promise<void> }` — consumed by Task 6.

- [ ] **Step 1: Write the failing storage tests**

```ts
// packages/wallet-sdk/domain/user/guest-account-storage.test.ts
import { describe, expect, it } from 'bun:test';
import type { AuthKeyValueStore } from '../../sdk';
import { createGuestAccountStorage } from './guest-account-storage';

const createMemoryStore = (): AuthKeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

describe('guestAccountStorage', () => {
  it('round-trips guest account details under the legacy key', async () => {
    const store = createMemoryStore();
    const storage = createGuestAccountStorage(store);

    await storage.store({ id: 'guest-1', password: 'pw' });

    expect(store.data.has('guestAccount')).toBe(true);
    expect(await storage.get()).toEqual({ id: 'guest-1', password: 'pw' });
  });

  it('returns null when nothing is stored', async () => {
    const storage = createGuestAccountStorage(createMemoryStore());
    expect(await storage.get()).toBeNull();
  });

  it('returns null for corrupt or invalid data', async () => {
    const store = createMemoryStore();
    store.data.set('guestAccount', 'not-json');
    const storage = createGuestAccountStorage(store);
    expect(await storage.get()).toBeNull();

    store.data.set('guestAccount', JSON.stringify({ id: 42 }));
    expect(await storage.get()).toBeNull();
  });

  it('clear removes the stored account', async () => {
    const store = createMemoryStore();
    const storage = createGuestAccountStorage(store);
    await storage.store({ id: 'guest-1', password: 'pw' });

    await storage.clear();

    expect(await storage.get()).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd packages/wallet-sdk && bun test domain/user/guest-account-storage.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement storage**

```ts
// packages/wallet-sdk/domain/user/guest-account-storage.ts
import { safeJsonParse } from '@agicash/utils';
import { z } from 'zod/mini';
import type { AuthKeyValueStore, Logger } from '../../sdk';

// Key predates the SDK move — existing devices have guest credentials stored
// under it, so it must not change.
const storageKey = 'guestAccount';

const GuestAccountDetailsSchema = z.object({
  id: z.string(),
  password: z.string(),
});

export type GuestAccountDetails = z.infer<typeof GuestAccountDetailsSchema>;

export type GuestAccountStorage = {
  get(): Promise<GuestAccountDetails | null>;
  store(details: GuestAccountDetails): Promise<void>;
  clear(): Promise<void>;
};

export function createGuestAccountStorage(
  store: AuthKeyValueStore,
  logger?: Logger,
): GuestAccountStorage {
  return {
    async get() {
      const dataString = await store.getItem(storageKey);
      if (!dataString) {
        return null;
      }
      const parseResult = safeJsonParse(dataString);
      if (!parseResult.success) {
        return null;
      }
      const validationResult = GuestAccountDetailsSchema.safeParse(
        parseResult.data,
      );
      if (!validationResult.success) {
        logger?.warn('Invalid guest account data found in the storage');
        return null;
      }
      return validationResult.data;
    },
    async store(details) {
      await store.setItem(storageKey, JSON.stringify(details));
    },
    async clear() {
      await store.removeItem(storageKey);
    },
  };
}
```

- [ ] **Step 4: Implement the password generator** (moved from `apps/web-wallet/app/lib/password-generator.ts`, minus the `window.getMockPassword` hook and `window.` prefixes — this becomes the ONLY generator; the web file is deleted in Task 11 once its last importer, the old `auth.ts`, is rewritten):

```ts
// packages/wallet-sdk/lib/password.ts
type PasswordOptions = {
  letters?: boolean;
  numbers?: boolean;
  special?: boolean;
};

export async function generateRandomPassword(
  length = 24,
  options: PasswordOptions = { letters: true, numbers: true, special: true },
): Promise<string> {
  let charset = '';

  if (options.letters)
    charset += 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.numbers) charset += '0123456789';
  if (options.special) charset += '!@#$%^&*()_+~';

  if (!charset) {
    throw new Error(
      'At least one character set (letters, numbers, special) must be selected.',
    );
  }

  const password: string[] = [];

  for (let i = 0; i < length; i++) {
    const randomIndex =
      globalThis.crypto.getRandomValues(new Uint32Array(1))[0] % charset.length;
    password.push(charset[randomIndex]);
  }

  return password.join('');
}
```

- [ ] **Step 5: Run tests** — storage tests pass; `bun run fix:all && bun run typecheck` passes.

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-sdk/lib/password.ts packages/wallet-sdk/domain/user
git commit -m "feat(wallet-sdk): add port-backed guest-account storage and CSPRNG password generator"
```

---### Task 6: `AuthService` — session state, verbs, expiry machinery

**Files:**
- Create: `packages/wallet-sdk/domain/user/auth-service.ts`
- Test: `packages/wallet-sdk/domain/user/auth-service.test.ts`
- Modify: `packages/wallet-sdk/lib/error.ts` (add `NoSessionError`)

**Interfaces:**
- Consumes: `AuthApi`, `AuthSession`, `AuthStorage`, `Logger` from `../../sdk`; `WalletEventEmitter` from `../../lib/events`; `GuestAccountStorage` from `./guest-account-storage`; `setLongTimeout`/`clearLongTimeout`/`LongTimeout` from `@agicash/utils`; `jwtDecode` from `jwt-decode`.
- Produces: `class AuthService implements AuthApi` with constructor `new AuthService(deps: AuthServiceDeps)`, plus `restoreSession(): Promise<void>` and `teardown(): void` beyond the contract surface. `type OpenSecretAuthApi` naming the 11 Open Secret fns it uses (so `import * as openSecret` satisfies it structurally). Consumed by Task 8.

- [ ] **Step 1: Add the internal error class** to `packages/wallet-sdk/lib/error.ts`:

```ts
/** Thrown when a namespace method requiring an authenticated session runs without one. */
export class NoSessionError extends SdkError {
  constructor() {
    super('No authenticated session');
    this.name = 'NoSessionError';
  }
}
```

(Not added to `index.ts`/`temporary.ts` — hosts catch it via the exported `SdkError` base.)

- [ ] **Step 2: Write the failing tests.** Use fake deps throughout — no module mocking. Helper to mint JWTs with a chosen `exp` so timer math is real:

```ts
// packages/wallet-sdk/domain/user/auth-service.test.ts
import { describe, expect, it } from 'bun:test';
import type { AuthKeyValueStore, AuthStorage } from '../../sdk';
import { WalletEventEmitter } from '../../lib/events';
import { AuthService, type OpenSecretAuthApi } from './auth-service';
import { createGuestAccountStorage } from './guest-account-storage';

const createMemoryStore = (): AuthKeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
};

const createStorage = (): AuthStorage & { persistent: ReturnType<typeof createMemoryStore> } => ({
  persistent: createMemoryStore(),
  session: createMemoryStore(),
});

const toBase64Url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const createJwt = (expSecondsFromNow: number, sub = 'user-1') =>
  `${toBase64Url({ alg: 'none' })}.${toBase64Url({
    sub,
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.sig`;

const fullUser = {
  id: 'user-1',
  name: null,
  email: 'a@b.c',
  email_verified: true,
  login_method: 'email',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
};

const guestUser = { ...fullUser, email: undefined };

const createOsFake = (
  tokenStore: ReturnType<typeof createMemoryStore>,
  overrides: Partial<OpenSecretAuthApi> = {},
) => {
  const calls: string[] = [];
  // The real Open Secret SDK persists fresh tokens on every login path; the
  // fakes mirror that so a timer re-arm after login reads a live refresh token.
  const login = (id: string) => {
    tokenStore.data.set('access_token', createJwt(600, id));
    tokenStore.data.set('refresh_token', createJwt(3600, id));
    return { id, access_token: 'a', refresh_token: 'r' };
  };
  const os: OpenSecretAuthApi = {
    fetchUser: async () => ({ user: fullUser }),
    signIn: async () => login('user-1'),
    signUp: async () => login('user-1'),
    signUpGuest: async () => login('guest-1'),
    signInGuest: async () => login('guest-1'),
    signOut: async () => {},
    verifyEmail: async () => {},
    requestNewVerificationCode: async () => {},
    convertGuestToUserAccount: async () => {},
    initiateGoogleAuth: async () => ({ auth_url: 'https://accounts.google/x', csrf_token: 'c' }),
    handleGoogleCallback: async () => login('user-1'),
    ...overrides,
  };
  // wrap every fn to record invocation order
  for (const key of Object.keys(os) as (keyof OpenSecretAuthApi)[]) {
    const original = os[key] as (...args: unknown[]) => unknown;
    // biome-ignore lint/suspicious/noExplicitAny: test instrumentation
    (os as any)[key] = (...args: unknown[]) => {
      calls.push(key);
      return original(...args);
    };
  }
  return { os, calls };
};

const createService = (options: {
  os?: Partial<OpenSecretAuthApi>;
  storage?: ReturnType<typeof createStorage>;
  onSessionEnded?: () => void;
} = {}) => {
  const storage = options.storage ?? createStorage();
  const { os, calls } = createOsFake(storage.persistent, options.os);
  const events = new WalletEventEmitter();
  const service = new AuthService({
    os,
    storage,
    guestAccountStorage: createGuestAccountStorage(storage.persistent),
    generateGuestPassword: async () => 'generated-pw',
    events,
    onSessionEnded: options.onSessionEnded,
  });
  return { service, storage, calls, events };
};

describe('AuthService', () => {
  it('starts anonymous', () => {
    const { service } = createService();
    expect(service.getSession()).toEqual({ isLoggedIn: false });
  });

  describe('restoreSession', () => {
    it('stays anonymous without stored tokens and does not call fetchUser', async () => {
      const { service, calls } = createService();
      await service.restoreSession();
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(calls).not.toContain('fetchUser');
    });

    it('restores a session from stored tokens', async () => {
      const { service, storage } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await service.restoreSession();

      expect(service.getSession()).toEqual({ isLoggedIn: true, user: fullUser });
      service.teardown();
    });

    it('rejects when tokens exist but the user fetch fails, then recovers on retry', async () => {
      let sessionEnded = false;
      let failFetch = true;
      const { service, storage } = createService({
        os: {
          fetchUser: async () => {
            if (failFetch) {
              throw new Error('network');
            }
            return { user: fullUser };
          },
        },
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await expect(service.restoreSession()).rejects.toThrow('network');
      // per-session caches were torn down with the failed restore
      expect(sessionEnded).toBe(true);
      expect(service.getSession().isLoggedIn).toBe(false);

      // the rejection is not memoized — a retry can succeed
      failFetch = false;
      await service.restoreSession();

      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('is single-flight', async () => {
      const { service, storage, calls } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await Promise.all([service.restoreSession(), service.restoreSession()]);

      expect(calls.filter((c) => c === 'fetchUser')).toHaveLength(1);
      service.teardown();
    });
  });

  describe('signUpGuest', () => {
    it('creates a new guest account and stores the credentials', async () => {
      const { service, storage, calls } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
      });

      await service.signUpGuest();

      expect(calls).toContain('signUpGuest');
      expect(JSON.parse(storage.persistent.data.get('guestAccount') ?? '')).toEqual({
        id: 'guest-1',
        password: 'generated-pw',
      });
      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('re-signs-in the stored guest account instead of creating a new one', async () => {
      const { service, storage, calls } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'stored-pw' }),
      );

      await service.signUpGuest();

      expect(calls).toContain('signInGuest');
      expect(calls).not.toContain('signUpGuest');
      service.teardown();
    });
  });

  describe('signOut', () => {
    it('clears the session, keeps guest credentials, and runs onSessionEnded', async () => {
      let sessionEnded = false;
      const { service, storage } = createService({
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(3600));
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      await service.restoreSession();

      await service.signOut();

      expect(service.getSession().isLoggedIn).toBe(false);
      expect(sessionEnded).toBe(true);
      expect(storage.persistent.data.has('guestAccount')).toBe(true);
    });

    it('wipes per-session caches again when a different user signs in after sign-out', async () => {
      let sessionEndedCount = 0;
      const userIds = ['user-a', 'user-b'];
      let fetchCalls = 0;
      const { service } = createService({
        os: {
          fetchUser: async () => ({
            user: { ...fullUser, id: userIds[Math.min(fetchCalls++, 1)] },
          }),
        },
        onSessionEnded: () => {
          sessionEndedCount += 1;
        },
      });

      await service.signIn('a@b.c', 'pw');
      await service.signOut(); // ends user-a's session → 1
      await service.signIn('b@b.c', 'pw'); // different user → wiped again → 2

      expect(sessionEndedCount).toBe(2);
      service.teardown();
    });
  });

  describe('convertGuestToFullAccount', () => {
    it('clears the stored guest credentials', async () => {
      const { service, storage } = createService();
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('refresh_token', createJwt(3600));

      await service.convertGuestToFullAccount('a@b.c', 'pw2');

      expect(storage.persistent.data.has('guestAccount')).toBe(false);
      service.teardown();
    });
  });

  describe('session expiry', () => {
    it('emits auth.session-expired and ends the session for a full account', async () => {
      let sessionEnded = false;
      const { service, storage, events } = createService({
        onSessionEnded: () => {
          sessionEnded = true;
        },
      });
      // refresh token expiring "now" (exp-5s already past) → timer fires immediately
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // the 1ms-floored timer fires on the next macrotask
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(expired).toHaveLength(1);
      expect(service.getSession().isLoggedIn).toBe(false);
      expect(sessionEnded).toBe(true);
    });

    it('auto-extends a guest session instead of expiring it', async () => {
      const { service, storage, calls, events } = createService({
        os: { fetchUser: async () => ({ user: guestUser }) },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));
      const refreshed: unknown[] = [];
      events.on('auth.session-refreshed', (payload) => refreshed.push(payload));

      await service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(calls).toContain('signInGuest');
      expect(expired).toHaveLength(0);
      // the host is told about the refresh it didn't initiate
      expect(refreshed).toHaveLength(1);
      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('re-arms instead of expiring when the stored refresh token was rotated forward', async () => {
      const { service, storage, events } = createService();
      storage.persistent.data.set('access_token', createJwt(600));
      // (exp - 5s) is ~100ms away, so the timer fires shortly after restore
      storage.persistent.data.set('refresh_token', createJwt(5.1));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      // the Open Secret SDK rotates the refresh token during its internal
      // refresh flow; simulate a rotation landing before the timer fires
      storage.persistent.data.set('refresh_token', createJwt(3600));
      await new Promise((resolve) => setTimeout(resolve, 200));

      expect(expired).toHaveLength(0);
      expect(service.getSession().isLoggedIn).toBe(true);
      service.teardown();
    });

    it('ends the session when the extension cannot restore the guest user', async () => {
      let fetchCalls = 0;
      const { service, storage, events } = createService({
        os: {
          fetchUser: async () => {
            fetchCalls += 1;
            // restore succeeds; the post-extend fetch fails
            if (fetchCalls > 1) {
              throw new Error('network');
            }
            return { user: guestUser };
          },
        },
      });
      storage.persistent.data.set(
        'guestAccount',
        JSON.stringify({ id: 'guest-1', password: 'pw' }),
      );
      storage.persistent.data.set('access_token', createJwt(600));
      storage.persistent.data.set('refresh_token', createJwt(4));
      const expired: unknown[] = [];
      events.on('auth.session-expired', (payload) => expired.push(payload));

      await service.restoreSession();
      await new Promise((resolve) => setTimeout(resolve, 10));

      // no wedged half-session: the death path ran and told the host
      expect(expired).toHaveLength(1);
      expect(service.getSession().isLoggedIn).toBe(false);
    });
  });

  it('initiateGoogleAuth returns the raw auth url', async () => {
    const { service } = createService();
    expect(await service.initiateGoogleAuth()).toEqual({
      authUrl: 'https://accounts.google/x',
    });
  });
});
```

Note: the login fakes MUST write fresh tokens into the store (mirroring the real Open Secret SDK, which persists tokens on every login path) — otherwise the guest-extend test would end the session instead of extending it: the post-extend expiry check would see an unmoved expiry and fall through to the death path. (In production that check plus the 1ms timer floor is what guards against a hot extend loop when a returned token is already expired.) Bun runs all test files in one process, so every test that leaves a session (and therefore a live expiry timer) ends with `service.teardown()` to avoid leaking timers into the rest of the suite.

- [ ] **Step 3: Run to verify failure** — `cd packages/wallet-sdk && bun test domain/user/auth-service.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement `AuthService`**

```ts
// packages/wallet-sdk/domain/user/auth-service.ts
import {
  type LongTimeout,
  clearLongTimeout,
  setLongTimeout,
} from '@agicash/utils';
import type {
  GoogleAuthResponse,
  LoginResponse,
  UserResponse,
} from '@agicash/opensecret';
import { jwtDecode } from 'jwt-decode';
import type { WalletEventEmitter } from '../../lib/events';
import type { AuthApi, AuthSession, AuthStorage, Logger } from '../../sdk';
import type { GuestAccountStorage } from './guest-account-storage';

// Keys are owned by @agicash/opensecret's token persistence; the service reads
// them (never writes) for session detection and expiry math.
const accessTokenKey = 'access_token';
const refreshTokenKey = 'refresh_token';

// A corrupt stored token must degrade (no timer / expiry path), never throw
// from a timer callback or a query fn.
const decodeJwt = (token: string): { exp?: number } | null => {
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
};

/** The subset of @agicash/opensecret the auth service drives. `import * as openSecret` satisfies it. */
export type OpenSecretAuthApi = {
  fetchUser(): Promise<UserResponse>;
  signIn(email: string, password: string): Promise<LoginResponse>;
  signUp(
    email: string,
    password: string,
    inviteCode: string,
    name?: string | null,
  ): Promise<LoginResponse>;
  signUpGuest(password: string, inviteCode: string): Promise<LoginResponse>;
  signInGuest(id: string, password: string): Promise<LoginResponse>;
  signOut(): Promise<void>;
  verifyEmail(code: string): Promise<void>;
  requestNewVerificationCode(): Promise<void>;
  convertGuestToUserAccount(
    email: string,
    password: string,
    name?: string | null,
  ): Promise<void>;
  initiateGoogleAuth(inviteCode?: string): Promise<GoogleAuthResponse>;
  handleGoogleCallback(
    code: string,
    state: string,
    inviteCode: string,
  ): Promise<LoginResponse>;
};

type AuthServiceDeps = {
  os: OpenSecretAuthApi;
  storage: AuthStorage;
  guestAccountStorage: GuestAccountStorage;
  generateGuestPassword: () => Promise<string>;
  events: WalletEventEmitter;
  /** Instance-memo cleanup on any session end (sign-out or expiry). */
  onSessionEnded?: () => void;
  logger?: Logger;
};

export class AuthService implements AuthApi {
  private session: AuthSession = { isLoggedIn: false };
  private restorePromise: Promise<void> | undefined;
  private expiryTimeout: LongTimeout | undefined;
  // Survives endSession() deliberately — see applySessionFromServer.
  private lastUserId: string | undefined;

  constructor(private readonly deps: AuthServiceDeps) {}

  getSession(): AuthSession {
    return this.session;
  }

  /**
   * Idempotent session restore from the storage port; resolving anonymous is
   * a state, not a failure. A rejection (unreadable storage) is not memoized,
   * so the host's query retries can recover.
   */
  restoreSession(): Promise<void> {
    this.restorePromise ??= this.doRestore().catch((error) => {
      this.restorePromise = undefined;
      throw error;
    });
    return this.restorePromise;
  }

  private async doRestore(): Promise<void> {
    const [accessToken, refreshToken] = await Promise.all([
      this.deps.storage.persistent.getItem(accessTokenKey),
      this.deps.storage.persistent.getItem(refreshTokenKey),
    ]);
    if (!accessToken || !refreshToken) {
      return;
    }
    try {
      await this.applySessionFromServer();
    } catch (error) {
      if (this.session.isLoggedIn) {
        // An auth verb established a session while this restore was in
        // flight; the restore result is moot.
        return;
      }
      // Contract: init() rejects on refresh errors (tokens exist but can't
      // be validated). endSession keeps the instance consistent; the
      // rejection is un-memoized by restoreSession, so a retry can succeed.
      this.endSession();
      throw error;
    }
  }

  async signUp(email: string, password: string): Promise<void> {
    await this.deps.os.signUp(email, password, '');
    await this.refreshSessionSnapshot('sign up');
  }

  async signUpGuest(): Promise<void> {
    const existingGuestAccount = await this.deps.guestAccountStorage.get();
    if (existingGuestAccount) {
      await this.deps.os.signInGuest(
        existingGuestAccount.id,
        existingGuestAccount.password,
      );
    } else {
      const password = await this.deps.generateGuestPassword();
      const guestAccount = await this.deps.os.signUpGuest(password, '');
      await this.deps.guestAccountStorage.store({
        id: guestAccount.id,
        password,
      });
    }
    await this.refreshSessionSnapshot('guest sign up');
  }

  async signIn(email: string, password: string): Promise<void> {
    await this.deps.os.signIn(email, password);
    await this.refreshSessionSnapshot('sign in');
  }

  async signOut(): Promise<void> {
    try {
      await this.deps.os.signOut();
    } finally {
      this.endSession();
    }
  }

  async verifyEmail(code: string): Promise<void> {
    await this.deps.os.verifyEmail(code);
    await this.refreshSessionSnapshot('email verification');
  }

  requestNewVerificationCode(): Promise<void> {
    return this.deps.os.requestNewVerificationCode();
  }

  async convertGuestToFullAccount(
    email: string,
    password: string,
  ): Promise<void> {
    await this.deps.os.convertGuestToUserAccount(email, password);
    await this.deps.guestAccountStorage.clear();
    await this.refreshSessionSnapshot('guest conversion');
  }

  async initiateGoogleAuth(): Promise<{ authUrl: string }> {
    const response = await this.deps.os.initiateGoogleAuth('');
    return { authUrl: response.auth_url };
  }

  async completeGoogleAuth(params: {
    code: string;
    state: string;
  }): Promise<void> {
    await this.deps.os.handleGoogleCallback(params.code, params.state, '');
    await this.refreshSessionSnapshot('google auth');
  }

  /** Cancels the expiry timer; the instance stays usable. */
  teardown(): void {
    this.disarmExpiryTimer();
  }

  private async refreshSessionSnapshot(context: string): Promise<void> {
    try {
      await this.applySessionFromServer();
    } catch (error) {
      // Swallowed for parity: a verb whose fetchUser fails leaves an
      // anonymous session the host discovers on its next read, like the old
      // web glue. endSession (not a bare snapshot clear) so the per-session
      // caches die with the session — the Supabase token cache in particular
      // must never outlive it.
      this.deps.logger?.error(`Failed to fetch user (${context})`, error);
      this.endSession();
    }
  }

  private async applySessionFromServer(): Promise<void> {
    const response = await this.deps.os.fetchUser();
    // Compared against the last seen user rather than the live session: a
    // memo repopulated by a request that resolved after sign-out must still
    // be wiped when a DIFFERENT user's session begins, and by then the
    // session is anonymous. Same-user re-login keeps its memos warm.
    if (this.lastUserId && this.lastUserId !== response.user.id) {
      this.deps.onSessionEnded?.();
    }
    this.lastUserId = response.user.id;
    this.session = { isLoggedIn: true, user: response.user };
    await this.armExpiryTimer();
  }

  private endSession(): void {
    this.session = { isLoggedIn: false };
    this.disarmExpiryTimer();
    // Un-memoize the restore so the next init() re-evaluates from storage —
    // a verb whose post-login fetchUser failed leaves tokens behind, and the
    // next invalidation can then recover the session like the old glue did.
    this.restorePromise = undefined;
    this.deps.onSessionEnded?.();
  }

  private async armExpiryTimer(): Promise<void> {
    const remaining = await this.getRemainingSessionTimeMs();
    // Disarm only after the await, so disarm+assign form one synchronous
    // block — two overlapping arms can't interleave and orphan a timer.
    this.disarmExpiryTimer();
    if (remaining === null) {
      return;
    }
    // Floor of 1ms: setLongTimeout fires synchronously at delay 0, which
    // would recurse into handleSessionExpiry from inside a login verb.
    this.expiryTimeout = setLongTimeout(
      () => {
        void this.handleSessionExpiry();
      },
      Math.max(remaining, 1),
    );
  }

  /**
   * Milliseconds until the stored refresh token is treated as expired (5s
   * before actual expiry, matching the previous web behavior), floored at 0.
   * Null when the token is absent or undecodable.
   */
  private async getRemainingSessionTimeMs(): Promise<number | null> {
    const refreshToken =
      await this.deps.storage.persistent.getItem(refreshTokenKey);
    if (!refreshToken) {
      return null;
    }
    const decoded = decodeJwt(refreshToken);
    if (!decoded?.exp) {
      return null;
    }
    return Math.max((decoded.exp - 5) * 1000 - Date.now(), 0);
  }

  private disarmExpiryTimer(): void {
    if (this.expiryTimeout) {
      clearLongTimeout(this.expiryTimeout);
      this.expiryTimeout = undefined;
    }
  }

  private async handleSessionExpiry(): Promise<void> {
    const session = this.session;
    if (!session.isLoggedIn) {
      return;
    }
    // The Open Secret SDK rotates the refresh token during its internal
    // refresh flow, so the expiry this timer was armed for may have moved.
    // Re-check the stored token and re-arm instead of expiring a live session.
    const remaining = await this.getRemainingSessionTimeMs();
    if (remaining !== null && remaining > 0) {
      await this.armExpiryTimer();
      return;
    }
    const isGuest = !session.user.email;
    if (isGuest) {
      try {
        // Re-signing-in the stored guest account gets fresh tokens and re-arms
        // the timer; the host never observes the expiry.
        await this.signUpGuest();
        const extendedRemaining = await this.getRemainingSessionTimeMs();
        if (
          extendedRemaining !== null &&
          extendedRemaining > 0 &&
          this.session.isLoggedIn
        ) {
          // The host didn't initiate this refresh, so it must be told —
          // the web re-syncs its auth query + session-hint cookie from it.
          this.deps.events.emit('auth.session-refreshed', {});
          return;
        }
        // Falls through when the extension produced no live session (already-
        // expired token — also guards a hot extend loop — or a failed
        // post-extend user fetch), so the death path emits the event instead
        // of leaving a wedged half-session.
        this.deps.logger?.warn(
          'Guest session extension did not produce a live session; ending it',
        );
      } catch (error) {
        this.deps.logger?.error('Failed to extend guest session', error);
      }
    }
    try {
      await this.deps.os.signOut();
    } catch (error) {
      this.deps.logger?.warn('Sign out during session expiry failed', error);
    }
    this.endSession();
    this.deps.events.emit('auth.session-expired', {});
  }
}
```

- [ ] **Step 5: Run tests** — all `auth-service.test.ts` tests pass; run `bun test` (whole SDK) and `bun run fix:all && bun run typecheck` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-sdk/domain/user/auth-service.ts packages/wallet-sdk/domain/user/auth-service.test.ts packages/wallet-sdk/lib/error.ts
git commit -m "feat(wallet-sdk): add AuthService with session snapshot and expiry machinery"
```

---

### Task 7: SDK Supabase client + internal session-token getter

**Files:**
- Create: `packages/wallet-sdk/db/client.ts`
- Create: `packages/wallet-sdk/db/supabase-session.ts`
- Test: `packages/wallet-sdk/db/supabase-session.test.ts`

**Interfaces:**
- Consumes: `Database`, `AgicashDb` types from `./database`; `generateThirdPartyToken` from `@agicash/opensecret`.
- Produces:
  - `createSupabaseSessionTokenGetter(deps: { isLoggedIn: () => boolean; generateToken?: () => Promise<{ token: string }> }): SupabaseSessionTokenSource` where `SupabaseSessionTokenSource = { getToken: () => Promise<string | null>; reset: () => void }`. `reset` MUST be invoked on session end (Task 9 wires it into `onSessionEnded`) — the cache is otherwise only re-validated by expiry, and a token minted for one user must never survive into another user's session (sign out → sign in as a different user would otherwise query with the old JWT until it expires).
  - `createAgicashDbClient(config: { url: string; anonKey: string; accessToken: () => Promise<string | null> }): AgicashDb` — consumed by Task 9.

- [ ] **Step 1: Write the failing token-getter tests**

```ts
// packages/wallet-sdk/db/supabase-session.test.ts
import { describe, expect, it } from 'bun:test';
import { createSupabaseSessionTokenGetter } from './supabase-session';

const toBase64Url = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString('base64url');

const createToken = (expSecondsFromNow: number) =>
  `${toBase64Url({ alg: 'none' })}.${toBase64Url({
    exp: Math.floor(Date.now() / 1000) + expSecondsFromNow,
  })}.sig`;

describe('createSupabaseSessionTokenGetter', () => {
  it('returns null and skips token generation when logged out', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => false,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    expect(await getToken()).toBeNull();
    expect(generated).toBe(0);
  });

  it('memoizes the token until close to expiry', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    const first = await getToken();
    const second = await getToken();

    expect(first).toBe(second as string);
    expect(generated).toBe(1);
  });

  it('re-generates once the cached token is within 5s of expiry', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        // expires in 3s → refreshAt is already in the past
        return { token: createToken(3) };
      },
    });

    await getToken();
    await getToken();

    expect(generated).toBe(2);
  });

  it('shares one in-flight request between concurrent callers', async () => {
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { token: createToken(3600) };
      },
    });

    await Promise.all([getToken(), getToken(), getToken()]);

    expect(generated).toBe(1);
  });

  it('drops the cache when the session ends', async () => {
    let loggedIn = true;
    let generated = 0;
    const { getToken } = createSupabaseSessionTokenGetter({
      isLoggedIn: () => loggedIn,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    await getToken();
    loggedIn = false;
    expect(await getToken()).toBeNull();
    loggedIn = true;
    await getToken();

    expect(generated).toBe(2);
  });

  it('reset drops the cached token so the next session cannot reuse it', async () => {
    let generated = 0;
    const source = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        return { token: createToken(3600) };
      },
    });

    await source.getToken();
    source.reset();
    await source.getToken();

    expect(generated).toBe(2);
  });

  it('does not cache a token that resolves after reset', async () => {
    let generated = 0;
    let release: (() => void) | undefined;
    const source = createSupabaseSessionTokenGetter({
      isLoggedIn: () => true,
      generateToken: async () => {
        generated += 1;
        if (generated === 1) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return { token: createToken(3600) };
      },
    });

    const firstCall = source.getToken();
    // session ends while the first exchange is still in flight
    source.reset();
    release?.();
    await firstCall;

    await source.getToken();

    // the stale in-flight token was not cached; the new session exchanged fresh
    expect(generated).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd packages/wallet-sdk && bun test db/supabase-session.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/wallet-sdk/db/supabase-session.ts
import { generateThirdPartyToken } from '@agicash/opensecret';
import { jwtDecode } from 'jwt-decode';

type Deps = {
  isLoggedIn: () => boolean;
  /** Test seam; defaults to Open Secret's generateThirdPartyToken. */
  generateToken?: () => Promise<{ token: string }>;
};

export type SupabaseSessionTokenSource = {
  /** Supabase `accessToken` callback; null selects the anon key. */
  getToken: () => Promise<string | null>;
  /**
   * Drops the cached token. Must be called when the session ends — the cache
   * is otherwise only re-validated by expiry, and a token minted for one user
   * must never survive into another user's session.
   */
  reset: () => void;
};

/**
 * Builds the Supabase `accessToken` source: exchanges the Open Secret JWT
 * for a Supabase third-party token and memoizes it until 5 seconds before its
 * expiry. Concurrent callers share one in-flight exchange. Returns null when
 * no session exists (the client then uses the anon key).
 */
export function createSupabaseSessionTokenGetter(
  deps: Deps,
): SupabaseSessionTokenSource {
  const generateToken = deps.generateToken ?? (() => generateThirdPartyToken());
  let cached: { token: string; refreshAtMs: number } | undefined;
  let inFlight: Promise<string> | undefined;
  // Incremented by reset(); an exchange started under an older generation
  // must not populate the cache — its token belongs to the ended session.
  let generation = 0;

  const invalidate = () => {
    generation += 1;
    cached = undefined;
    inFlight = undefined;
  };

  return {
    reset: invalidate,
    getToken: async () => {
      if (!deps.isLoggedIn()) {
        // Same full invalidation as reset(): an exchange in flight when the
        // session ended must not populate the cache either.
        invalidate();
        return null;
      }
      if (cached && Date.now() < cached.refreshAtMs) {
        return cached.token;
      }
      if (!inFlight) {
        const startedGeneration = generation;
        inFlight = (async () => {
          try {
            const { token } = await generateToken();
            if (generation === startedGeneration) {
              const { exp } = jwtDecode(token);
              cached = { token, refreshAtMs: exp ? (exp - 5) * 1000 : 0 };
            }
            return token;
          } finally {
            if (generation === startedGeneration) {
              inFlight = undefined;
            }
          }
        })();
      }
      return inFlight;
    },
  };
}
```

```ts
// packages/wallet-sdk/db/client.ts
import { createClient } from '@supabase/supabase-js';
import type { AgicashDb, Database } from './database';

type AgicashDbClientConfig = {
  url: string;
  anonKey: string;
  /** Resolves the Supabase session JWT; null selects the anon key. */
  accessToken: () => Promise<string | null>;
};

/** Builds the SDK's own Supabase client (wallet schema). */
export function createAgicashDbClient(config: AgicashDbClientConfig): AgicashDb {
  return createClient<Database>(config.url, config.anonKey, {
    accessToken: config.accessToken,
    db: {
      schema: 'wallet',
    },
  });
}
```

If `AgicashDb` in `db/database.ts` is not exactly the return type of this `createClient` call, type the function's return as `AgicashDb` only if it assigns cleanly — otherwise return the inferred type and alias it; check `db/database.ts`'s `AgicashDb` definition first and match it.

- [ ] **Step 4: Run tests** — token tests pass; `bun run fix:all && bun run typecheck` passes.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/db
git commit -m "feat(wallet-sdk): add the SDK-internal Supabase client and session token getter"
```

---

### Task 8: `WriteUserRepository`/`UserService` refactor (A9) + `createUserApi`

**Files:**
- Modify: `packages/wallet-sdk/domain/user/user-repository.ts:56-60,107-201`
- Modify: `packages/wallet-sdk/domain/user/user-service.ts:49-73`
- Modify: `apps/web-wallet/app/routes/_protected.tsx:124-127` (call-site)
- Modify: `apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx:92-95` (call-site — there are THREE `new WriteUserRepository(...)` sites, not two)
- Modify: `apps/web-wallet/app/features/user/user-repository-hooks.ts` (drop accountRepository arg)
- Create: `packages/wallet-sdk/domain/user/user-api.ts`

**Interfaces:**
- Consumes: `ReadUserRepository`, `WriteUserRepository`, `UserService` (existing), `NoSessionError` (Task 6), `AgicashDb`, contract types from `../../sdk`.
- Produces:
  - `new WriteUserRepository(db)` (constructor loses `accountRepository`); `upsert(user, accountRepository: AccountRepository, options?)` gains it as a param.
  - `UserService.setDefaultAccount(user: Pick<User, 'id'>, account: Pick<Account, 'id' | 'currency'>, options?)` — column-minimal update; no field echo.
  - `createUserApi(deps: { db: AgicashDb; getSession: () => AuthSession }): UserApi` — consumed by Task 9.

- [ ] **Step 1: Refactor `WriteUserRepository`**

```ts
export class WriteUserRepository {
  constructor(private readonly db: AgicashDb) {}
```

and change `upsert`'s signature (body unchanged except `this.accountRepository` → `accountRepository`):

```ts
  async upsert(
    user: {
      // ... existing param docs unchanged ...
    },
    accountRepository: AccountRepository,
    options?: Options,
  ): Promise<{ user: User; accounts: Account[] }> {
```

- [ ] **Step 2: Loosen `UserService.setDefaultAccount`'s params and make the update column-minimal**

```ts
  async setDefaultAccount(
    user: Pick<User, 'id'>,
    account: Pick<Account, 'id' | 'currency'>,
    options: SetDefaultAccountOptions = {
      setDefaultCurrency: false,
    },
  ): Promise<User> {
    if (!['BTC', 'USD'].includes(account.currency)) {
      throw new Error('Unsupported currency');
    }

    return this.userRepository.update(
      user.id,
      {
        ...(account.currency === 'BTC'
          ? { defaultBtcAccountId: account.id }
          : { defaultUsdAccountId: account.id }),
        ...(options.setDefaultCurrency
          ? { defaultCurrency: account.currency }
          : {}),
      },
      { abortSignal: options.abortSignal },
    );
  }
```

Only the changed columns are written — `WriteUserRepository.update` passes `undefined` for the omitted fields and supabase-js drops them (behavior the `acceptTerms` path already relies on in production), so the untouched defaults can't be clobbered by stale caller state under concurrency. `user` narrows to `Pick<User, 'id'>` because the echo of unchanged fields is gone — the service no longer needs the rest of the user. (Existing callers pass full `User`/`Account` objects — assignable, no further changes.)

- [ ] **Step 3: Update the three web call-sites**

`apps/web-wallet/app/routes/_protected.tsx` (`ensureUserData`):

```ts
    const writeUserRepository = new WriteUserRepository(agicashDbClient);

    const { user: upsertedUser, accounts } = await withRetry({
      fn: () =>
        writeUserRepository.upsert(
          {
            id: authUser.id,
            email: authUser.email,
            emailVerified: authUser.email_verified,
            accounts: [...defaultAccounts],
            cashuLockingXpub,
            encryptionPublicKey,
            sparkIdentityPublicKey,
            termsAcceptedAt,
            giftCardMintTermsAcceptedAt,
          },
          accountRepository,
        ),
```

`apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx:92-95` — the route never calls `upsert`, so the `accountRepository` arg simply goes:

```ts
  const userRepository = new WriteUserRepository(agicashDbClient);
```

`apps/web-wallet/app/features/user/user-repository-hooks.ts`:

```ts
export function useWriteUserRepository() {
  return new WriteUserRepository(agicashDbClient);
}
```

(and drop the now-unused `useAccountRepository` import; the whole file is deleted in Task 12.)

- [ ] **Step 4: Create `createUserApi`**

```ts
// packages/wallet-sdk/domain/user/user-api.ts
import type { Currency } from '@agicash/money';
import type { AgicashDb } from '../../db/database';
import { NoSessionError } from '../../lib/error';
import type { AuthSession, UserApi } from '../../sdk';
import { ReadUserRepository, WriteUserRepository } from './user-repository';
import { UserService } from './user-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
};

export function createUserApi(deps: Deps): UserApi {
  const readRepository = new ReadUserRepository(deps.db);
  const writeRepository = new WriteUserRepository(deps.db);
  const userService = new UserService(writeRepository);

  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const getAccountRef = async (
    accountId: string,
  ): Promise<{ id: string; currency: Currency }> => {
    const { data, error } = await deps.db
      .from('accounts')
      .select('id, currency')
      .eq('id', accountId)
      // RLS already scopes rows to the user; this is defense-in-depth per the
      // "userId implicit from session" convention.
      .eq('user_id', requireUserId())
      .single();
    if (error) {
      throw new Error('Failed to get account', { cause: error });
    }
    return data;
  };

  // Methods are async so a missing session surfaces as a rejection, matching
  // the Promise-returning contract, not a synchronous throw.
  return {
    get: async () => readRepository.get(requireUserId()),
    updateUsername: async (username) =>
      writeRepository.update(requireUserId(), { username }),
    acceptTerms: async (params) => {
      const now = new Date().toISOString();
      return writeRepository.update(requireUserId(), {
        termsAcceptedAt: params.walletTerms ? now : undefined,
        giftCardMintTermsAcceptedAt: params.giftCardTerms ? now : undefined,
      });
    },
    setDefaultCurrency: async (params) =>
      writeRepository.update(requireUserId(), {
        defaultCurrency: params.currency,
      }),
    setDefaultAccount: async (params) => {
      // One read, not two: the account row is fetched to derive the
      // per-currency column server-truthfully; the user row isn't needed
      // because the update only writes the changed columns.
      const account = await getAccountRef(params.accountId);
      return userService.setDefaultAccount({ id: requireUserId() }, account, {
        setDefaultCurrency: params.setDefaultCurrency,
      });
    },
  };
}
```

(`accounts.currency` resolves to the `wallet` schema's currency enum, `'BTC' | 'USD'`, which is exactly `Currency` — `data` assigns cleanly.)

- [ ] **Step 5: Verify + commit**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck` → PASS.

```bash
git add packages/wallet-sdk/domain/user apps/web-wallet/app/routes/_protected.tsx "apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx" apps/web-wallet/app/features/user/user-repository-hooks.ts
git commit -m "refactor(wallet-sdk): free WriteUserRepository from the accounts graph; add createUserApi"
```

---

### Task 9: `AgicashSdk` class

**Files:**
- Create: `packages/wallet-sdk/agicash-sdk.ts`
- Modify: `packages/wallet-sdk/index.ts` (export it)

**Interfaces:**
- Consumes: everything produced by Tasks 3–8; `configure` + module fns from `@agicash/opensecret`; `clearSparkWallets` from `./lib/spark/wallet`; `clearAgicashMintAuthToken` from `./lib/agicash-mint-auth-provider`.
- Produces: `class AgicashSdk` with `static create(config: SdkConfig): AgicashSdk`, `readonly auth: AuthApi`, `readonly user: UserApi`, `readonly events: WalletEvents`, `init(): Promise<void>`, `dispose(): Promise<void>` — consumed by the web in Task 10. Exported from `@agicash/wallet-sdk`.

- [ ] **Step 1: Implement**

```ts
// packages/wallet-sdk/agicash-sdk.ts
import * as openSecret from '@agicash/opensecret';
import { createAgicashDbClient } from './db/client';
import { createSupabaseSessionTokenGetter } from './db/supabase-session';
import { AuthService } from './domain/user/auth-service';
import { createGuestAccountStorage } from './domain/user/guest-account-storage';
import { createUserApi } from './domain/user/user-api';
import { clearAgicashMintAuthToken } from './lib/agicash-mint-auth-provider';
import { WalletEventEmitter } from './lib/events';
import { generateRandomPassword } from './lib/password';
import { clearSparkWallets } from './lib/spark/wallet';
import type { AuthApi, SdkConfig, UserApi, WalletEvents } from './sdk';

/**
 * Runtime implementation of the SDK contract, filled namespace-by-namespace
 * as the migration slices land (auth/user/events since step 5). It will
 * declare `implements Sdk` once every namespace exists.
 */
export class AgicashSdk {
  readonly auth: AuthApi;
  readonly user: UserApi;
  readonly events: WalletEvents;

  private readonly authService: AuthService;

  private constructor(config: SdkConfig) {
    // The Open Secret client is module-scoped in @agicash/opensecret, so auth
    // configuration is process-global: a second AgicashSdk instance would
    // re-configure it. One instance per process until the library ships an
    // instance API.
    openSecret.configure({
      apiUrl: config.auth.apiUrl,
      clientId: config.auth.clientId,
      storage: config.auth.storage,
    });

    const events = new WalletEventEmitter(config.logger);

    // Created before authService — the isLoggedIn closure dereferences it
    // lazily at request time, after the constructor has assigned it.
    const sessionToken = createSupabaseSessionTokenGetter({
      isLoggedIn: () => this.authService.getSession().isLoggedIn,
    });

    this.authService = new AuthService({
      os: openSecret,
      storage: config.auth.storage,
      guestAccountStorage: createGuestAccountStorage(
        config.auth.storage.persistent,
        config.logger,
      ),
      generateGuestPassword: async () =>
        (await config.auth.generateGuestPassword?.()) ??
        generateRandomPassword(32),
      events,
      onSessionEnded: () => {
        // The token cache must die with the session: a token minted for one
        // user must never serve the next login's queries.
        sessionToken.reset();
        clearSparkWallets();
        clearAgicashMintAuthToken();
      },
      logger: config.logger,
    });

    const db = createAgicashDbClient({
      url: config.db.url,
      anonKey: config.db.anonKey,
      accessToken: sessionToken.getToken,
    });

    this.auth = this.authService;
    this.user = createUserApi({
      db,
      getSession: () => this.authService.getSession(),
    });
    this.events = events;
  }

  /** Sync; no I/O. */
  static create(config: SdkConfig): AgicashSdk {
    return new AgicashSdk(config);
  }

  /**
   * Session restore only for now — the Breez WASM load folds in when the
   * first Spark namespace lands. Resolves when no session exists. Delegates
   * to the auth service, which is single-flight and memoizes success but
   * clears a rejection, so the host's query retries can recover.
   */
  init(): Promise<void> {
    return this.authService.restoreSession();
  }

  async dispose(): Promise<void> {
    this.authService.teardown();
  }
}
```

Check the actual export site of `clearSparkWallets`: it lives in `lib/spark/wallet.ts:150`; import from `'./lib/spark'` if the barrel re-exports it (temporary.ts does `export * from './lib/spark'`), otherwise from `'./lib/spark/wallet'`.

- [ ] **Step 2: Export from `index.ts`** — add below the `export * from './sdk';` line:

```ts
export { AgicashSdk } from './agicash-sdk';
```

(The root export is the contract-mandated surface ("Runtime public surface = the `Sdk` class"). `agicash-sdk.ts` has no top-level side effects, so bundles that never touch the class tree-shake it; its spark/supabase graph is already server-import-safe via `/temporary`'s use in `_protected.tsx`.)

- [ ] **Step 3: Verify + commit**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck && cd packages/wallet-sdk && bun test` → PASS.
Then from the repo root: `bun run build` → PASS. (`fix:all` won't catch an SSR-bundle break; this is the first task that changes what the root export pulls into consumers, so exercise the real client + server build now, not only in Task 13.)

```bash
git add packages/wallet-sdk/agicash-sdk.ts packages/wallet-sdk/index.ts
git commit -m "feat(wallet-sdk): add the AgicashSdk runtime with auth, user, and events namespaces"
```

---

### Task 10: Web config assembly (`sdk.client.ts`) + entry wiring

**Files:**
- Create: `apps/web-wallet/app/features/shared/sdk.client.ts`
- Modify: `apps/web-wallet/app/features/agicash-db/database.client.ts` (export url/key consts)
- Modify: `apps/web-wallet/app/entry.client.tsx` (drop `configure`, import `sdk`)

**Interfaces:**
- Consumes: `AgicashSdk` from `@agicash/wallet-sdk`; `browserStorage` from `@agicash/opensecret`; `breezApiKey` from `~/lib/breez`; the `window.getMockPassword` global (declared in `vite-env.d.ts`, armed only by the Playwright fixture).
- Produces: `export const sdk: AgicashSdk` — the web's singleton, imported by Tasks 11–12. (`.client.ts` suffix keeps it out of the server module graph, like `database.client.ts`.)

- [ ] **Step 1: Export the resolved Supabase config from `database.client.ts`** — change the two consts to exported:

```ts
export const supabaseUrl = getSupabaseUrl();
```
```ts
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';
```

(only the `const` declarations gain `export`; everything else unchanged).

- [ ] **Step 2: Create `sdk.client.ts`**

```ts
// apps/web-wallet/app/features/shared/sdk.client.ts
import { browserStorage } from '@agicash/opensecret';
import { AgicashSdk } from '@agicash/wallet-sdk';
import {
  supabaseAnonKey,
  supabaseUrl,
} from '~/features/agicash-db/database.client';
import { breezApiKey } from '~/lib/breez';

const openSecretApiUrl = import.meta.env.VITE_OPEN_SECRET_API_URL ?? '';
if (!openSecretApiUrl) {
  throw new Error('VITE_OPEN_SECRET_API_URL is not set');
}

const openSecretClientId = import.meta.env.VITE_OPEN_SECRET_CLIENT_ID ?? '';
if (!openSecretClientId) {
  throw new Error('VITE_OPEN_SECRET_CLIENT_ID is not set');
}

const consoleLogger = {
  debug: (message: string, meta?: unknown) =>
    meta === undefined ? console.debug(message) : console.debug(message, meta),
  info: (message: string, meta?: unknown) =>
    meta === undefined ? console.info(message) : console.info(message, meta),
  warn: (message: string, meta?: unknown) =>
    meta === undefined ? console.warn(message) : console.warn(message, meta),
  error: (message: string, meta?: unknown) =>
    meta === undefined ? console.error(message) : console.error(message, meta),
};

export const sdk = AgicashSdk.create({
  db: {
    url: supabaseUrl,
    anonKey: supabaseAnonKey,
  },
  auth: {
    apiUrl: openSecretApiUrl,
    clientId: openSecretClientId,
    storage: browserStorage,
    // e2e bridge: the Playwright fixture arms window.getMockPassword; in
    // production it's absent, so this resolves null and the SDK generates.
    generateGuestPassword: async () =>
      (await window.getMockPassword?.()) ?? null,
  },
  spark: {
    breezApiKey,
    network: 'MAINNET',
  },
  lightningAddressDomain: window.location.host,
  logger: consoleLogger,
});

if (import.meta.hot) {
  // A hot reload of this module constructs a second SDK; dispose the old one
  // so its expiry timer doesn't leak.
  import.meta.hot.dispose(() => void sdk.dispose());
}
```

(`window.location.host` includes the port, matching what `useLocationData` derives for the settings screen today; nothing consumes the value until the contacts/receive slices.)

- [ ] **Step 3: Rewire `entry.client.tsx`** — remove the `configure` import and call (added in Task 1), remove the now-unused env reads, and import the sdk module first so Open Secret is configured before any consumer runs:

```ts
import {
  configureFeatureFlags,
  ensureBreezWasm,
} from '@agicash/wallet-sdk/temporary';
// ... existing imports ...
import { agicashDbClient } from './features/agicash-db/database.client';
// Importing the module constructs the SDK, which configures Open Secret as an
// import-evaluation side effect — before any body code below runs.
import './features/shared/sdk.client';
```

Delete these lines: the `import { browserStorage, configure } from '@agicash/opensecret';`, the `openSecretApiUrl`/`openSecretClientId` env-read blocks, and the `configure({ ... })` call. Everything else (Breez WASM kickoff, feature flags, Sentry) stays.

- [ ] **Step 4: Verify**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck` → PASS.
Smoke: `bun run dev` → app boots; existing session still logged in; network tab shows Open Secret calls working (attestation/session handshake unchanged).

- [ ] **Step 5: Commit**

```bash
git add apps/web-wallet/app/features/shared/sdk.client.ts apps/web-wallet/app/features/agicash-db/database.client.ts apps/web-wallet/app/entry.client.tsx
git commit -m "feat(web-wallet): construct the wallet SDK instance and move Open Secret config into it"
```

---

### Task 11: Web auth glue flip

**Files:**
- Modify: `apps/web-wallet/app/features/user/auth.ts` (full rewrite below)
- Modify: `apps/web-wallet/app/features/wallet/wallet.tsx`
- Modify: `apps/web-wallet/app/routes/_protected.tsx:30-34` (`AuthUser` import)
- Modify: `apps/web-wallet/app/routes/_auth.oauth.$provider.tsx`
- Modify: `apps/web-wallet/app/features/signup/verify-email.ts`
- Delete: `apps/web-wallet/app/hooks/use-long-timeout.ts` (its only consumer is the old `useHandleSessionExpiry`, which this task removes)
- Delete: `apps/web-wallet/app/lib/password-generator.ts` (its last importer is the old `auth.ts`; the SDK's `lib/password.ts` is now the only generator — A4)

**Interfaces:**
- Consumes: `sdk` from `~/features/shared/sdk.client`; `AuthSession`, `AuthUser` from `@agicash/wallet-sdk`.
- Produces (same names as today so forms/pages don't change): `authQueryOptions`, `authStateQueryKey`, `invalidateAuthQueries`, `useAuthState`, `useAuthActions` (same verb signatures incl. `signOut(options?: { redirectTo?: string })`), `useSignOut`, `type AuthUser`; NEW `useHandleSessionEvents(onSessionExpired: () => void)` replacing `useHandleSessionExpiry` (subscribes to both `auth.session-expired` and `auth.session-refreshed`).

- [ ] **Step 1: Rewrite `features/user/auth.ts`**

```ts
import type { AuthUser } from '@agicash/wallet-sdk';
import * as Sentry from '@sentry/react-router';
import { decodeURLSafe, encodeURLSafe } from '@stablelib/base64';
import {
  queryOptions,
  useQueryClient,
  useSuspenseQuery,
} from '@tanstack/react-query';
import { jwtDecode } from 'jwt-decode';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useRevalidator } from 'react-router';
import {
  loadFeatureFlags,
  resetFeatureFlags,
} from '~/features/shared/feature-flags';
import { getQueryClient } from '~/features/shared/query-client';
import { sdk } from '~/features/shared/sdk.client';
import { useLatest } from '~/lib/use-latest';
import { oauthLoginSessionStorage } from './oauth-login-session-storage';
import { sessionHintCookie } from './session-hint-cookie';

export type { AuthUser };

type AuthState =
  | {
      isLoggedIn: true;
      user: AuthUser;
      /** Unix seconds, captured at fetch time; drives the hint-cookie lifetime and query staleness. */
      refreshTokenExpiresAt: number | null;
    }
  | {
      isLoggedIn: false;
      user?: undefined;
    };

export const authStateQueryKey = 'auth-state';

// A corrupt stored token must degrade to "no value", never throw from a query
// fn or staleTime callback (that would error-page every route, /login included).
const safeJwtDecode = (
  token: string,
): { exp?: number; sub?: string } | null => {
  try {
    return jwtDecode(token);
  } catch {
    return null;
  }
};

const getRefreshTokenExpiry = (): number | null => {
  const refreshToken = window.localStorage.getItem('refresh_token');
  if (!refreshToken) {
    return null;
  }
  return safeJwtDecode(refreshToken)?.exp ?? null;
};

export const authQueryOptions = () =>
  queryOptions({
    queryKey: [authStateQueryKey],
    queryFn: async (): Promise<AuthState> => {
      // Associate Sentry events with the user as early as possible, before
      // session restore completes.
      const accessToken = window.localStorage.getItem('access_token');
      const sub = accessToken ? safeJwtDecode(accessToken)?.sub : undefined;
      if (sub) {
        Sentry.setUser({ id: sub });
      }

      try {
        await sdk.init();
      } catch (error) {
        // Restore failed with tokens present (e.g. a network blip at boot).
        // Boot anonymous; init()'s rejection is not memoized, so a later
        // invalidateAuthQueries() retries the restore.
        console.error('Failed to restore session', { cause: error });
        Sentry.setUser(null);
        sessionHintCookie.clear();
        return { isLoggedIn: false };
      }
      const session = sdk.auth.getSession();

      if (!session.isLoggedIn) {
        Sentry.setUser(null);
        sessionHintCookie.clear();
        return { isLoggedIn: false };
      }

      Sentry.setUser({ id: session.user.id, isGuest: !session.user.email });

      // Mirror auth state into a hint cookie so the server can short-circuit
      // SSR for unauthenticated visits. Lifetime matches the refresh token
      // so we don't leave a stale "logged in" hint after the session
      // genuinely expires.
      const exp = getRefreshTokenExpiry();
      if (exp) {
        sessionHintCookie.set(exp - Math.floor(Date.now() / 1000));
      }

      return { ...session, refreshTokenExpiresAt: exp };
    },
    // Logged-in state is fresh until the refresh token expires; a refetch
    // after that point re-reads the (SDK-extended or ended) session and
    // re-syncs the hint cookie. Anonymous state only changes through explicit
    // invalidation. Staleness is pinned to the expiry captured AT FETCH TIME
    // (not re-read from storage), so an SDK-internal guest extension can't
    // slide freshness forward and postpone the cookie re-sync forever.
    staleTime: ({ state: { data, dataUpdatedAt } }) => {
      if (!data?.isLoggedIn) {
        return Number.POSITIVE_INFINITY;
      }
      if (!data.refreshTokenExpiresAt) {
        return 0;
      }
      return Math.max(
        (data.refreshTokenExpiresAt - 5) * 1000 - dataUpdatedAt,
        0,
      );
    },
  });

/**
 * Invalidates all queries that depend on the current auth session.
 * Call after any auth state change (login, logout, email verification, etc.)
 */
export const invalidateAuthQueries = async () => {
  const queryClient = getQueryClient();
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: [authStateQueryKey],
      refetchType: 'all',
    }),
    loadFeatureFlags(),
  ]);
};

export const useAuthState = (): AuthState => {
  const { data } = useSuspenseQuery(authQueryOptions());
  return data;
};

type SignOutOptions = {
  /**
   * The URL to redirect to after signing out. If not provided, the user will be redirected to the singup page by the protected layout.
   */
  redirectTo?: string;
};

type AuthActions = {
  signUp: (email: string, password: string) => Promise<void>;
  signUpGuest: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: (options?: SignOutOptions) => Promise<void>;
  initiateGoogleAuth: () => Promise<{ authUrl: string }>;
  verifyEmail: (code: string) => Promise<void>;
  convertGuestToFullAccount: (email: string, password: string) => Promise<void>;
};

/**
 * Authentication actions backed by the wallet SDK, wrapped with the web
 * concerns the SDK doesn't own: query invalidation, navigation, Sentry user
 * tracking, and the OAuth deep-link session.
 */
export const useAuthActions = (): AuthActions => {
  const queryClient = useQueryClient();
  const { revalidate } = useRevalidator();
  const navigate = useNavigate();

  const refreshSession = useCallback(
    async (redirectTo?: string) => {
      await invalidateAuthQueries();
      if (redirectTo) {
        await navigate(redirectTo);
      } else {
        await revalidate();
      }
    },
    [navigate, revalidate],
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      await sdk.auth.signUp(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signIn = useCallback(
    async (email: string, password: string) => {
      await sdk.auth.signIn(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  const signUpGuest = useCallback(async () => {
    await sdk.auth.signUpGuest();
    await refreshSession();
  }, [refreshSession]);

  const signOut = useCallback(
    async (options: SignOutOptions = {}) => {
      await sdk.auth.signOut();
      // Before the refresh below so the previous user's flags are gone even if
      // the anon re-fetch fails, and so its result isn't clobbered afterwards.
      resetFeatureFlags();
      await refreshSession(options.redirectTo);
      Sentry.setUser(null);
      queryClient.clear();
    },
    [refreshSession, queryClient],
  );

  const initiateGoogleAuth = useCallback(async () => {
    const { authUrl } = await sdk.auth.initiateGoogleAuth();

    // Stash the current location under a session id and thread it through the
    // OAuth state param, so the callback route can restore the deep link.
    const authLocation = new URL(authUrl);
    const stateParam = authLocation.searchParams.get('state');
    const state = stateParam
      ? JSON.parse(new TextDecoder().decode(decodeURLSafe(stateParam)))
      : {};

    const oauthLoginSession = oauthLoginSessionStorage.create({
      search: location.search,
      hash: location.hash,
    });
    state.sessionId = oauthLoginSession.sessionId;

    const stateEncoded = encodeURLSafe(
      new TextEncoder().encode(JSON.stringify(state)),
    );
    authLocation.searchParams.set('state', stateEncoded);

    return { authUrl: authLocation.href };
  }, []);

  const verifyEmail = useCallback(
    async (code: string) => {
      await sdk.auth.verifyEmail(code);
      await refreshSession();
    },
    [refreshSession],
  );

  const convertGuestToFullAccount = useCallback(
    async (email: string, password: string) => {
      await sdk.auth.convertGuestToFullAccount(email, password);
      await refreshSession();
    },
    [refreshSession],
  );

  return {
    signUp,
    signUpGuest,
    signIn,
    signOut,
    initiateGoogleAuth,
    verifyEmail,
    convertGuestToFullAccount,
  };
};

export const useSignOut = () => {
  const { signOut } = useAuthActions();
  const [loading, setLoading] = useState(false);

  const handleSignOut = async () => {
    setLoading(true);
    await signOut({ redirectTo: '/home' });
    setLoading(false);
  };
  return { isSigningOut: loading, signOut: handleSignOut };
};

/**
 * Reacts to SDK-initiated session transitions the host didn't trigger.
 * Expiry (refresh-token death with failed/impossible extension): notifies the
 * user and resets the web session state. Refresh (guest auto-extension):
 * re-runs the auth query so the session-hint cookie picks up the new expiry,
 * matching master's extend-through-invalidation behavior.
 */
export const useHandleSessionEvents = (onSessionExpired: () => void) => {
  const queryClient = useQueryClient();
  const { revalidate } = useRevalidator();
  const onSessionExpiredRef = useLatest(onSessionExpired);

  useEffect(() => {
    const unsubscribeExpired = sdk.events.on('auth.session-expired', () => {
      void (async () => {
        onSessionExpiredRef.current();
        resetFeatureFlags();
        await invalidateAuthQueries();
        await revalidate();
        Sentry.setUser(null);
        queryClient.clear();
      })();
    });
    const unsubscribeRefreshed = sdk.events.on('auth.session-refreshed', () => {
      void invalidateAuthQueries();
    });
    return () => {
      unsubscribeExpired();
      unsubscribeRefreshed();
    };
  }, [queryClient, revalidate, onSessionExpiredRef]);
};
```

Deleted vs master: `useHandleSessionExpiry`, the `OpenSecretJwt` helpers (`getJwt`, `removeKeys`, `getRefreshToken`, `getRemainingSessionTimeInMs`), the direct `@agicash/opensecret` + `/temporary` imports, `guestAccountStorage` usage, `generateRandomPassword` usage (now the SDK's concern via the config port).

- [ ] **Step 2: Update `wallet.tsx`** — replace the `useHandleSessionExpiry` import + call:

```ts
import { useHandleSessionEvents } from '../user/auth';
```
```ts
  useHandleSessionEvents(() => {
    toast({
      title: 'Session expired',
      description:
        'The session has expired. You will be redirected to the login page.',
    });
  });
```

(the `isGuestAccount` prop disappears — guests are auto-extended inside the SDK).

- [ ] **Step 3: Repoint `AuthUser` in `_protected.tsx`**

```ts
import type { AuthUser } from '@agicash/wallet-sdk';
import { authQueryOptions, useAuthState } from '~/features/user/auth';
```

- [ ] **Step 4: Flip the OAuth callback route** (`_auth.oauth.$provider.tsx`) — replace the `handleGoogleCallback` import with the sdk and change the call:

```ts
import { sdk } from '~/features/shared/sdk.client';
```
```ts
    switch (provider) {
      case 'google':
        await sdk.auth.completeGoogleAuth({ code, state });
        break;
```

- [ ] **Step 5: Flip `features/signup/verify-email.ts`** — replace `import { verifyEmail as osVerifyEmail } from '@agicash/opensecret';` with the sdk import and change the call:

```ts
import { sdk } from '~/features/shared/sdk.client';
```
```ts
    await sdk.auth.verifyEmail(code);
    await invalidateAuthQueries();
```

- [ ] **Step 6: Delete `apps/web-wallet/app/hooks/use-long-timeout.ts` and `apps/web-wallet/app/lib/password-generator.ts`** — their only consumers were the removed `useHandleSessionExpiry` and the old guest-signup path (the SDK's generator + the `window.getMockPassword` bridge in `sdk.client.ts` replace the latter). Verify: `grep -rn "useLongTimeout\|password-generator" apps/web-wallet/app` returns nothing.

- [ ] **Step 7: Verify + commit**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck` → PASS.

```bash
git add apps/web-wallet
git commit -m "refactor(web-wallet): route auth flows through sdk.auth"
```

---

### Task 12: Web user-domain flip

**Files:**
- Modify: `apps/web-wallet/app/features/user/user-hooks.tsx`
- Delete: `apps/web-wallet/app/features/user/user-repository-hooks.ts`
- Delete: `apps/web-wallet/app/features/user/user-service-hooks.ts`
- Delete: `apps/web-wallet/app/features/user/guest-account-storage.ts` (moved into the SDK in Task 5; `user-hooks.tsx` is its last importer and stops using it in Step 2)
- Modify: `apps/web-wallet/app/routes/_protected.receive.cashu_.token.tsx`

**Interfaces:**
- Consumes: `sdk.user`, `sdk.auth` from `~/features/shared/sdk.client`.
- Produces: unchanged hook names/signatures (`useUser`, `useUserRef`, `useUpgradeGuestToFullAccount`, `useRequestNewEmailVerificationCode`, `useVerifyEmail`, `useSetDefaultCurrency`, `useSetDefaultAccount`, `useUpdateUsername`, `useAcceptTerms`, `UserCache`, `useUserCache`, `useUserChangeHandlers`, `getUserFromCache`, `getUserFromCacheOrThrow`, `defaultAccounts`).

- [ ] **Step 1: Flip `useUser`** — drop the repository plumbing:

```ts
const userQueryOptions = <TData = User>({
  select,
}: {
  select?: (data: User) => TData;
}) => ({
  queryKey: [UserCache.Key],
  queryFn: () => sdk.user.get(),
  select,
});

export const useUser = <TData = User>(
  select?: (data: User) => TData,
): TData => {
  const authState = useAuthState();
  if (!authState.user) {
    throw new Error('Cannot use useUser hook in anonymous context');
  }

  const { data } = useSuspenseQuery(userQueryOptions({ select }));

  return data;
};
```

(imports: add `import { sdk } from '~/features/shared/sdk.client';`, drop `ReadUserRepository`, `useReadUserRepository`, `useWriteUserRepository`, `useUserService`, `requestNewVerificationCode`, `guestAccountStorage`; keep the `ReadUserRepository` import **only** via `@agicash/wallet-sdk/temporary` for `useUserChangeHandlers`'s static `toUser` — that usage stays.)

- [ ] **Step 2: Flip the mutations**

```ts
export const useUpgradeGuestToFullAccount = (): ((
  email: string,
  password: string,
) => Promise<void>) => {
  const userRef = useUserRef();
  const { convertGuestToFullAccount } = useAuthActions();

  const { mutateAsync } = useMutation({
    mutationKey: ['upgrade-guest-to-full-account'],
    mutationFn: (variables: { email: string; password: string }) => {
      if (!userRef.current.isGuest) {
        throw new Error('User already has a full account');
      }

      return convertGuestToFullAccount(variables.email, variables.password);
    },
    scope: {
      id: 'upgrade-guest-to-full-account',
    },
  });

  return useCallback(
    (email: string, password: string) => mutateAsync({ email, password }),
    [mutateAsync],
  );
};
```

(the `guestAccountStorage.clear()` follow-up is gone — the SDK clears it inside `convertGuestToFullAccount`).

```ts
export const useRequestNewEmailVerificationCode = (): (() => Promise<void>) => {
  const userRef = useUserRef();

  const { mutateAsync } = useMutation({
    mutationKey: ['request-new-email-verification-code'],
    mutationFn: () => {
      if (userRef.current.isGuest) {
        throw new Error('Cannot request email verification for guest account');
      }
      if (userRef.current.emailVerified) {
        throw new Error('Email is already verified');
      }

      return sdk.auth.requestNewVerificationCode();
    },
    scope: {
      id: 'request-new-email-verification-code',
    },
  });

  return mutateAsync;
};
```

Replace `useUpdateUser` + the three wrappers with direct sdk calls (the `UpdateUser` type import from `/temporary` goes away):

```ts
const useUserUpdatingMutation = <TVariables>(
  mutationFn: (variables: TVariables) => Promise<User>,
) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      queryClient.setQueryData([UserCache.Key], data);
    },
  });
};

export const useSetDefaultCurrency = () => {
  const { mutateAsync } = useUserUpdatingMutation((currency: Currency) =>
    sdk.user.setDefaultCurrency({ currency }),
  );
  return mutateAsync;
};

export const useSetDefaultAccount = () => {
  const { mutateAsync } = useUserUpdatingMutation((account: Account) =>
    sdk.user.setDefaultAccount({ accountId: account.id }),
  );
  return mutateAsync;
};

export const useUpdateUsername = () => {
  const { mutateAsync } = useUserUpdatingMutation((username: string) =>
    sdk.user.updateUsername(username),
  );
  return mutateAsync;
};

export const useAcceptTerms = () => {
  const { mutateAsync } = useUserUpdatingMutation(
    (params: { walletTerms?: boolean; giftCardTerms?: boolean }) =>
      sdk.user.acceptTerms(params),
  );
  return mutateAsync;
};
```

(`useVerifyEmail` is unchanged — it already goes through `useAuthActions`.)

- [ ] **Step 3: Delete `user-repository-hooks.ts`, `user-service-hooks.ts`, and `guest-account-storage.ts`.** Verify no importers remain: `grep -rn "user-repository-hooks\|user-service-hooks\|user/guest-account-storage" apps/` → empty.

- [ ] **Step 4: Flip the receive-token route** (`_protected.receive.cashu_.token.tsx`) — in `trySetReceiveAccountAsDefault` (line 117), replace the `userService.setDefaultAccount(user, account, { setDefaultCurrency: true })` call with:

```ts
    const updatedUser = await sdk.user.setDefaultAccount({
      accountId: account.id,
      setDefaultCurrency: true,
    });
    new UserCache(queryClient).set(updatedUser);
```

Concretely, five removals or the file won't compile clean: (1) drop `userService` and the `userRepository` construction feeding it from `getServices()` (construction + return object); (2) remove `userService` from the destructure at ~line 176; (3) remove the `userService: UserService` parameter from `trySetReceiveAccountAsDefault` (line ~117-122); (4) remove the corresponding argument at its call site (~line 197); (5) drop the now-unused `WriteUserRepository` import. Keep the `UserService.isDefaultAccount` static usage (its `/temporary` import stays). Add the `sdk` import.

- [ ] **Step 5: Verify + commit**

Run: `export PATH="$PWD/.devenv/profile/bin:$PATH" && bun run fix:all && bun run typecheck` → PASS.
Confirm the only remaining web importers of user-domain classes from `/temporary` are: `_protected.tsx` (`WriteUserRepository` for `ensureUserData`, A1), `user-hooks.tsx` (`ReadUserRepository.toUser` static), the receive route + any accounts/transactions files (`UserService` statics, `ReadUserDefaultAccountRepository`) — run `grep -rn "UserRepository\|UserService" apps/web-wallet/app --include='*.ts*'` and check the list matches the Deferred section.

```bash
git add apps/web-wallet
git commit -m "refactor(web-wallet): route user reads and writes through sdk.user"
```

---

### Task 13: Full verification

- [ ] **Step 1: Static + unit + production build**

```bash
export PATH="$PWD/.devenv/profile/bin:$PATH"
bun run fix:all && bun run typecheck
bun run test
bun run build
```
Expected: all PASS. The build step exercises the real client + server bundles (the dev server alone doesn't), confirming the root `AgicashSdk` export is server-bundle-safe.

- [ ] **Step 2: Browser smoke (dev server + Chrome MCP or manual)** — `bun run dev`, then walk:

1. `/home` (marketing, anonymous) → Sign Up → **Create wallet as Guest** → wallet home renders (dev auto-creates Testnut accounts).
2. Reload → still signed in (session restore through `sdk.init()`).
3. Settings → Sign Out → back at signup; localStorage keeps `guestAccount`.
4. **Create wallet as Guest** again → re-signs into the SAME guest account (no new account).
5. Settings → edit username → persists after reload (`sdk.user.updateUsername` + cache).
6. Switch default account/currency in settings → theme flips (USD/BTC), persists.
7. Google login page renders and the Google button redirects to an accounts.google.com URL with a `state` containing `sessionId` (don't complete externally).
8. DevTools: no console errors; `wallet.users` reads go through the SDK client (two Supabase token exchanges are expected — web + SDK clients).

- [ ] **Step 3: E2E (ask the user before running)**

```bash
cd apps/web-wallet-e2e && bun run test:e2e -- --grep "signup|login|verify"
```
(Run from the package dir — arg forwarding through the root script's `bun --filter` isn't guaranteed to reach playwright, and a silently-unfiltered full run is the failure mode.)
Expected: signup.spec, login.spec, verify-email.spec pass unchanged (the RC talks to the same endpoints; the password mock still applies through the config port).

- [ ] **Step 4: Existing-session upgrade check** — with a session created on `master` (localStorage tokens present), switch to the branch, reload: still logged in.

- [ ] **Step 5: Commit any fixes; then push and open the PR**

```bash
git push -u origin sdk/auth-slice
```

PR: base `master`, title `feat(wallet-sdk): auth & user slice (step 5)`, description listing: contract placeholders settled, opensecret RC adoption, AgicashSdk runtime, web flips, Decision Record A1–A12, deferred items.

---

## Self-Review Checklist (run after Task 13)

1. **Spec coverage:** step-5 line items — contract methods wrapped (AuthApi ✓ Task 6/9, UserApi ✓ Task 8/9), web imports flipped (✓ Tasks 11–12 minus documented deferrals), storage-adapter port settled (✓ Task 3), React-agnostic opensecret adopted (✓ Task 1), port shapes settled (✓ Tasks 3–5).
2. **Placeholder scan:** no TBDs; every step has code or exact commands.
3. **Type consistency:** `AuthKeyValueStore`/`AuthStorage` (Task 3) = what `guest-account-storage.ts` (Task 5), `AuthService` (Task 6), and `browserStorage` (Task 10) consume; `OpenSecretAuthApi` fn names = RC exports; `SetDefaultAccountParams.setDefaultCurrency` used in Task 12 Step 4.
4. **Parity scan:** every master behavior either preserved or listed under "Accepted behavior deltas".
