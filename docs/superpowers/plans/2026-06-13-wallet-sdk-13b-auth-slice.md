# Wallet SDK Auth Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the web app's authentication off the OpenSecret identity onto `sdk.auth`/`sdk.user`, add the SDK's cheap session-presence surface + the `auth:session-expired` producer, and delete the now-redundant web auth machinery (`useHandleSessionExpiry`, `ensureUserData`, `entry.client` `configure()`).

**Architecture:** Two phases. **Phase A (SDK prereqs, additive, unit-tested):** expose a network-free `sdk.auth.isLoggedIn()`/`getCurrentUserId()`, and build a dedicated per-instance session-expiry scheduler that emits `auth:session-expired` only on terminal failure (guest sessions self-heal silently). **Phase B (web cut-over):** the route guards call `sdk.auth.isLoggedIn()` (cheap redirect gate) + `sdk.user.getCurrentUser()` (which bootstraps internally — `resolveSession` IS the old `ensureUserData`); `authQueryOptions.queryFn` flips to `getCurrentUser`; `useAuthActions` becomes a thin name+arg adapter over `sdk.auth.*`; the OAuth callback flips to `sdk.auth.completeOAuth`; terms thread through the signup actions; the `useSdkEventBridge` auth handlers un-stub; and the web's `useHandleSessionExpiry` + `entry.client` `configure()` are deleted.

**Tech Stack:** TypeScript, React Router v7 (framework mode, client middleware), TanStack Query v5, `@agicash/wallet-sdk`, `@agicash/opensecret` (rc), Bun test runner, Biome.

This plan implements the **auth slice** of the larger spec `docs/superpowers/specs/2026-06-13-wallet-sdk-full-migration-design.md` (§5 auth-event bridge rows, §6 AuthDomain deltas, §7b auth row). Grounding + the 6 resolved forks are recorded in the `project-wallet-sdk-auth-slice-grounding` memory.

## Global Constraints

- **Branch:** `sdk-nocache/full-migration` (do NOT push — the whole migration is ONE PR at the very end). Default base branch is `master`. Harness-owned worktree — do NOT `git worktree remove`; ignore the working-tree `sdd/` dir.
- **Package manager:** `bun`/`bunx` only — never npm/npx/yarn/pnpm.
- **Error classes:** `SdkError`/`DomainError`/`NotFoundError` take `(message, code)`; `NotImplementedError` takes `(method)`.
- **Tests:** NEVER bare `mock.module` (process-global, leaks into sibling files). Use DI'd fakes + a real `SdkEventEmitter`, or `spyOn` + `afterAll(() => mock.restore())`. Emit SDK events ONLY on a real transition.
- **Per-task gate:** `bun run typecheck` + `bun run test` for SDK-only tasks; for web tasks add `bun --filter=web-wallet run test` and `bun run fix:all` (Biome, exit 0). `noUnusedLocals` is OFF (tsc won't flag unused imports — delete dead imports manually).
- **One commit per task.** Conventional-commit messages; end with the `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` trailer.
- **Decisions (resolved forks — build to these):** F1 dedicated SDK scheduler (NOT background-poll); F2 SDK self-heals guests (emit only on terminal failure); F3 thin SDK-backed wrappers (keep `authQueryOptions`/`useAuthActions`, flip internals); F4 terms thread into the signup actions; F5 `CompletedSparkLightningSendTransactionDetails` fix DEFERRED to S15 (out of scope here); F6 the `test:e2e` + manual money-path gate runs BEFORE push/PR (Task B7).
- **Auto-resolved (do NOT re-litigate):** `configure()` is a pure idempotent setter (deletion safe); guest creds are byte-compatible web↔SDK; `login_method` is debug-only (drop it); `resetPassword` `{secret}` is a drop-in; `verifyEmail`'s `user:updated` is already bridged.

---

## File Structure

**SDK (`packages/wallet-sdk/src/`):**
- `domains.ts` — MODIFY: add `isLoggedIn()` + `getCurrentUserId()` to the `AuthDomain` interface.
- `domains/auth/auth-domain.ts` — MODIFY: implement the two new methods; construct + wire the `SessionExpiryScheduler`; add the `handleSessionExpiry` guest/full logic.
- `internal/connections/open-secret.ts` — REUSE (no change): existing `isLoggedIn(storage)`, `getCurrentUserId(storage)`, `decodeJwtExp`.
- `internal/auth/session-expiry-scheduler.ts` — CREATE: the dumb refresh-exp timer (DI'd clock/timer + long-delay chaining).
- `internal/auth/session-expiry-scheduler.test.ts` — CREATE.
- `domains/auth/auth-domain.test.ts` — MODIFY/REUSE: add tests for the new methods + the scheduler wiring.

**Web (`apps/web-wallet/app/`):**
- `routes/_protected.tsx` — MODIFY: guard flip; DELETE `ensureUserData`/`hasUserChanged`/`shouldUserVerifyEmail`.
- `routes/_auth.tsx` — MODIFY: guard flip; drop `login_method` debug field.
- `routes/_auth.oauth.$provider.tsx` — MODIFY: flip to `sdk.auth.completeOAuth`; thread terms.
- `features/user/auth.ts` — MODIFY: `authQueryOptions.queryFn` → `sdk.user.getCurrentUser()`; `useAuthActions` adapter over `sdk.auth.*`; DELETE `useHandleSessionExpiry`.
- `features/signup/signup-form.tsx`, `features/signup/signup.tsx` — MODIFY: thread `termsAcceptedAt` into the signup actions (F4).
- `features/wallet/use-sdk-event-bridge.ts` — MODIFY: un-stub the 3 auth handlers.
- `features/wallet/wallet.tsx` — MODIFY: remove the `useHandleSessionExpiry` mount.
- `entry.client.tsx` — MODIFY: delete the `configure()` call.
- `features/shared/sdk.ts` — MODIFY (optional): preserve the missing-env early-throw guard in `buildClientSdkConfig`.

---

## Phase A — SDK prerequisites (additive, SDK-unit-tested, web untouched)

### Task A1: cheap network-free `sdk.auth.isLoggedIn()` + `getCurrentUserId()`

**Files:**
- Modify: `packages/wallet-sdk/src/domains.ts` (the `AuthDomain` interface, currently `:40-88`)
- Modify: `packages/wallet-sdk/src/domains/auth/auth-domain.ts` (the `createAuthDomain` factory, currently `:38-109`)
- Test: `packages/wallet-sdk/src/domains/auth/auth-domain.test.ts`

**Interfaces:**
- Consumes: `isLoggedIn(storage)` and `getCurrentUserId(storage)` from `internal/connections/open-secret.ts` (both already exist, network-free, `:33-43` and `:119-127`); `ctx.config.storage: StorageProvider`.
- Produces: `AuthDomain.isLoggedIn(): Promise<boolean>` and `AuthDomain.getCurrentUserId(): Promise<string | null>` — consumed by Phase B route guards.

- [ ] **Step 1: Write the failing test**

Add to `auth-domain.test.ts` (follow the file's existing DI'd-fake pattern — a fake `StorageProvider` + real `SdkEventEmitter`; do NOT `mock.module`). Helper to mint a JWT with a chosen `sub`/`exp`:

```ts
import { describe, expect, it } from 'bun:test';
import { createAuthDomain } from './auth-domain';
// reuse the test file's existing makeCtx(...) / fake-storage helpers

// base64url-encode a JWT payload (no signing needed — decodeJwtSub/Exp only read payload)
const jwt = (payload: Record<string, unknown>) => {
  const b64 = (o: unknown) =>
    Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64(payload)}.sig`;
};

describe('AuthDomain session-presence surface', () => {
  it('isLoggedIn() is true when both tokens present and refresh exp is future', async () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const storage = makeFakeStorage({
      access_token: jwt({ sub: 'user-1', exp: future }),
      refresh_token: jwt({ sub: 'user-1', exp: future }),
    });
    const auth = createAuthDomain(makeCtx({ storage }));
    expect(await auth.isLoggedIn()).toBe(true);
    expect(await auth.getCurrentUserId()).toBe('user-1');
  });

  it('isLoggedIn() is false and getCurrentUserId() null when tokens absent', async () => {
    const auth = createAuthDomain(makeCtx({ storage: makeFakeStorage({}) }));
    expect(await auth.isLoggedIn()).toBe(false);
    expect(await auth.getCurrentUserId()).toBeNull();
  });

  it('isLoggedIn() is false when the refresh token is expired', async () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const storage = makeFakeStorage({
      access_token: jwt({ sub: 'user-1', exp: past }),
      refresh_token: jwt({ sub: 'user-1', exp: past }),
    });
    const auth = createAuthDomain(makeCtx({ storage }));
    expect(await auth.isLoggedIn()).toBe(false);
  });
});
```

If `makeCtx`/`makeFakeStorage` helpers don't already exist in the test file, add minimal ones: `makeFakeStorage(record)` returns `{ persistent: { getItem: async k => record[k] ?? null, setItem: async()=>{}, removeItem: async()=>{} }, session: {…same…} }`; `makeCtx({storage})` returns `{ config: { storage, /* other required SdkConfig fields with dummy values */ }, connections: {…}, emitter: new SdkEventEmitter() }` — copy the shape the existing auth-domain tests already build.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bunx tsc --noEmit` (expect: `Property 'isLoggedIn' does not exist on type 'AuthDomain'`), then `bun test src/domains/auth/auth-domain.test.ts` → FAIL.

- [ ] **Step 3: Add the methods to the `AuthDomain` interface**

In `domains.ts`, inside `interface AuthDomain` (after `requestEmailVerificationCode()`):

```ts
  /** Network-free session-presence check (token presence + refresh-token exp). For route guards. */
  isLoggedIn(): Promise<boolean>;
  /** Network-free current user id from the access-token `sub` claim (no fetch). For early attribution. */
  getCurrentUserId(): Promise<string | null>;
```

- [ ] **Step 4: Implement in the factory**

In `auth-domain.ts`, ensure the imports include the helpers:

```ts
import {
  getCurrentUserId as osGetCurrentUserId,
  isLoggedIn as osIsLoggedIn,
} from '../../internal/connections/open-secret';
```

Add to the returned object (alongside the other methods):

```ts
    isLoggedIn() {
      return osIsLoggedIn(ctx.config.storage);
    },
    getCurrentUserId() {
      return osGetCurrentUserId(ctx.config.storage);
    },
```

- [ ] **Step 5: Run the tests**

Run: `cd packages/wallet-sdk && bunx tsc --noEmit && bun test src/domains/auth/auth-domain.test.ts` → PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/wallet-sdk/src/domains.ts packages/wallet-sdk/src/domains/auth/auth-domain.ts packages/wallet-sdk/src/domains/auth/auth-domain.test.ts
git commit -m "feat(wallet-sdk): expose cheap sdk.auth.isLoggedIn()/getCurrentUserId() (auth slice A1)"
```

---

### Task A2: `SessionExpiryScheduler` — the dumb refresh-exp timer (dark)

**Files:**
- Create: `packages/wallet-sdk/src/internal/auth/session-expiry-scheduler.ts`
- Test: `packages/wallet-sdk/src/internal/auth/session-expiry-scheduler.test.ts`

**Interfaces:**
- Consumes: `decodeJwtExp` from `internal/connections/open-secret.ts` (read its exact signature first; it base64url-decodes the JWT payload and returns `exp` epoch-seconds or `undefined`). `StorageProvider` type.
- Produces: `class SessionExpiryScheduler` with `armIfLoggedIn(): Promise<void>`, `disarm(): void`. Constructed with `{ storage, onExpiry, now?, setTimer?, clearTimer?, marginMs? }`. Consumed by Task A3.

**Design notes (from F1):** key off the **refresh** token's `exp` (the hard ceiling). Fire `marginMs` (default 5000) BEFORE exp. A single `setTimeout` overflows at `2^31-1` ms (~24.8 days) and fires immediately — so chain timers for long delays. The scheduler is DUMB: it only decides *when*, then calls the injected `onExpiry`. Guest-vs-full + re-extend + emit live in the auth domain (Task A3). `setTimer`/`clearTimer`/`now` are injected so tests use fakes (NEVER real timers).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, mock } from 'bun:test';
import { SessionExpiryScheduler } from './session-expiry-scheduler';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (exp: number) => `${b64({ alg: 'none' })}.${b64({ exp })}.sig`;

// a controllable fake timer
const makeFakeTimers = () => {
  let scheduled: { fn: () => void; delay: number } | null = null;
  return {
    setTimer: (fn: () => void, delay: number) => {
      scheduled = { fn, delay };
      return scheduled as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: () => {
      scheduled = null;
    },
    fireNow: () => scheduled?.fn(),
    get scheduledDelay() {
      return scheduled?.delay ?? null;
    },
  };
};

const storageWith = (refreshExpSec: number | null) => ({
  persistent: {
    getItem: async (k: string) =>
      k === 'refresh_token' && refreshExpSec !== null ? jwt(refreshExpSec) : null,
    setItem: async () => {},
    removeItem: async () => {},
  },
  session: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
});

describe('SessionExpiryScheduler', () => {
  it('arms a timer for (exp - margin) and calls onExpiry when it fires', async () => {
    const timers = makeFakeTimers();
    const onExpiry = mock(() => {});
    const nowMs = 1_000_000;
    const expSec = Math.floor(nowMs / 1000) + 100; // 100s out
    const sched = new SessionExpiryScheduler({
      storage: storageWith(expSec),
      onExpiry,
      now: () => nowMs,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      marginMs: 5000,
    });
    await sched.armIfLoggedIn();
    // delay = (expSec*1000 - 5000) - nowMs  == 95000
    expect(timers.scheduledDelay).toBe(95_000);
    timers.fireNow();
    expect(onExpiry).toHaveBeenCalledTimes(1);
  });

  it('does not arm when there is no refresh token', async () => {
    const timers = makeFakeTimers();
    const sched = new SessionExpiryScheduler({
      storage: storageWith(null),
      onExpiry: () => {},
      now: () => 1_000_000,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await sched.armIfLoggedIn();
    expect(timers.scheduledDelay).toBeNull();
  });

  it('chains timers for delays beyond the 2^31-1 ms ceiling', async () => {
    const timers = makeFakeTimers();
    const onExpiry = mock(() => {});
    const nowMs = 0;
    const expSec = 40 * 24 * 60 * 60; // 40 days out, > 24.8d ceiling
    const sched = new SessionExpiryScheduler({
      storage: storageWith(expSec),
      onExpiry,
      now: () => nowMs,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      marginMs: 0,
    });
    await sched.armIfLoggedIn();
    // first hop is clamped to the max safe delay, NOT the full 40d, and does NOT fire onExpiry yet
    expect(timers.scheduledDelay).toBe(2_147_483_647);
    timers.fireNow();
    expect(onExpiry).toHaveBeenCalledTimes(0); // still waiting (chained)
  });

  it('disarm() clears the pending timer', async () => {
    const timers = makeFakeTimers();
    const onExpiry = mock(() => {});
    const expSec = Math.floor(Date.now() / 1000) + 100;
    const sched = new SessionExpiryScheduler({
      storage: storageWith(expSec),
      onExpiry,
      now: () => Date.now(),
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
    });
    await sched.armIfLoggedIn();
    sched.disarm();
    expect(timers.scheduledDelay).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bun test src/internal/auth/session-expiry-scheduler.test.ts` → FAIL ("Cannot find module './session-expiry-scheduler'").

- [ ] **Step 3: Implement the scheduler**

Create `internal/auth/session-expiry-scheduler.ts`:

```ts
import type { StorageProvider } from '../connections/open-secret';
import { decodeJwtExp } from '../connections/open-secret';

const MAX_TIMER_MS = 2_147_483_647; // 2^31 - 1; longer setTimeout delays overflow and fire immediately
const DEFAULT_MARGIN_MS = 5_000; // fire 5s before exp (matches the web's getRemainingSessionTimeInMs)

export type SessionExpirySchedulerDeps = {
  storage: StorageProvider;
  /** Invoked once when the refresh token is about to expire. The auth domain decides guest-extend vs emit. */
  onExpiry: () => void;
  now?: () => number;
  setTimer?: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (handle: ReturnType<typeof setTimeout>) => void;
  marginMs?: number;
};

/**
 * Per-instance timer that fires `onExpiry` shortly before the persisted refresh token expires.
 * Dumb by design: it only decides WHEN. It is re-armed by the auth domain after a successful
 * guest re-extend (the rotated token has a new exp). Chains timers for refresh lifetimes beyond
 * setTimeout's ~24.8-day ceiling.
 */
export class SessionExpiryScheduler {
  private handle: ReturnType<typeof setTimeout> | null = null;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly marginMs: number;

  constructor(private readonly deps: SessionExpirySchedulerDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h));
    this.marginMs = deps.marginMs ?? DEFAULT_MARGIN_MS;
  }

  async armIfLoggedIn(): Promise<void> {
    this.disarm();
    const refreshToken = await this.deps.storage.persistent.getItem('refresh_token');
    if (!refreshToken) return;
    const exp = decodeJwtExp(refreshToken);
    if (exp === undefined) return;
    const fireAt = exp * 1000 - this.marginMs;
    this.scheduleAt(fireAt);
  }

  disarm(): void {
    if (this.handle !== null) {
      this.clearTimer(this.handle);
      this.handle = null;
    }
  }

  private scheduleAt(fireAtMs: number): void {
    const remaining = Math.max(fireAtMs - this.now(), 0);
    if (remaining > MAX_TIMER_MS) {
      // chain: wait the max safe slice, then re-evaluate against the same absolute fire time
      this.handle = this.setTimer(() => this.scheduleAt(fireAtMs), MAX_TIMER_MS);
      return;
    }
    this.handle = this.setTimer(() => {
      this.handle = null;
      this.deps.onExpiry();
    }, remaining);
  }
}
```

> Before implementing, READ `internal/connections/open-secret.ts` to confirm `decodeJwtExp` is exported and `StorageProvider` is the right type import (it may re-export from `@agicash/opensecret`). Adjust the import path/name to match.

- [ ] **Step 4: Run the tests**

Run: `cd packages/wallet-sdk && bunx tsc --noEmit && bun test src/internal/auth/session-expiry-scheduler.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/internal/auth/session-expiry-scheduler.ts packages/wallet-sdk/src/internal/auth/session-expiry-scheduler.test.ts
git commit -m "feat(wallet-sdk): add SessionExpiryScheduler (dark; refresh-exp timer + long-delay chaining) (auth slice A2)"
```

---

### Task A3: wire the scheduler into the auth domain — `auth:session-expired` producer

**Files:**
- Modify: `packages/wallet-sdk/src/domains/auth/auth-domain.ts`
- Test: `packages/wallet-sdk/src/domains/auth/auth-domain.test.ts`

**Interfaces:**
- Consumes: `SessionExpiryScheduler` (A2); the existing `GuestCredentialStore` (constructed at `auth-domain.ts:30` as `const guest = new GuestCredentialStore(ctx.config.storage)`); `ctx.emitter` (a `SdkEventEmitter`); the existing `signInGuest`/`signOut` methods.
- Produces: the `auth:session-expired` event (declared at `events.ts:90`, payload `Record<string, never>`), emitted only on terminal failure. Consumed by the web bridge (Task B6).

**Design (F1/F2):** construct one scheduler per auth domain. Wire `onExpiry → handleSessionExpiry`. `handleSessionExpiry`: if guest creds exist → attempt `signInGuest()` (silent re-extend); on success the `auth:signed-in` it emits re-arms the scheduler via the subscription; on failure → `emit('auth:session-expired')` + `disarm()`. If NOT a guest (full account) → `emit('auth:session-expired')` + `disarm()` (full accounts are NOT silently refreshed — matches the web). Subscribe `auth:signed-in → armIfLoggedIn` and `auth:signed-out → disarm`. Arm once at construction (covers cold reload with a restored session): `void scheduler.armIfLoggedIn()`.

- [ ] **Step 1: Write the failing test**

```ts
describe('AuthDomain session-expiry producer', () => {
  it('full account: onExpiry emits auth:session-expired exactly once', async () => {
    const emitter = new SdkEventEmitter();
    const events: string[] = [];
    emitter.on('auth:session-expired', () => events.push('expired'));
    // no guest creds in storage -> treated as a full account
    const storage = makeFakeStorage({ /* access+refresh present, no guestAccount */
      access_token: jwt({ sub: 'u', exp: future }),
      refresh_token: jwt({ sub: 'u', exp: future }),
    });
    // inject the scheduler's onExpiry by capturing the constructed scheduler via DI'd timers
    const auth = createAuthDomain(makeCtx({ storage, emitter }));
    await auth.__triggerSessionExpiryForTest(); // see Step 3 (test seam)
    expect(events).toEqual(['expired']);
  });

  it('guest account: onExpiry re-extends and does NOT emit auth:session-expired', async () => {
    const emitter = new SdkEventEmitter();
    const expired: string[] = [];
    emitter.on('auth:session-expired', () => expired.push('expired'));
    const storage = makeFakeStorage({
      guestAccount: JSON.stringify({ id: 'guest-1', password: 'pw' }),
      access_token: jwt({ sub: 'guest-1', exp: future }),
      refresh_token: jwt({ sub: 'guest-1', exp: future }),
    });
    // fake OpenSecret sign-in-guest so signInGuest() resolves (spyOn the os* import, restore in afterAll)
    const auth = createAuthDomain(makeCtx({ storage, emitter }));
    await auth.__triggerSessionExpiryForTest();
    expect(expired).toEqual([]); // silent self-heal
  });
});
```

> Prefer a real DI seam over a `__test` hook if the existing test harness already lets you capture the scheduler's `onExpiry` (e.g. by injecting a fake `setTimer` through the ctx/config). If a clean seam isn't available, expose the scheduler's `onExpiry` by extracting `handleSessionExpiry` as a named local you can unit-test directly, and test the wiring (subscribe/arm) separately. Match the file's existing `spyOn` + `afterAll(mock.restore)` discipline for the `signInGuest` OpenSecret dependency — NEVER bare `mock.module`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bun test src/domains/auth/auth-domain.test.ts` → FAIL.

- [ ] **Step 3: Implement the wiring**

In `auth-domain.ts`, after the `guest` store is constructed and before the returned object, add the scheduler + handler. (READ the current factory body first — `signInGuest` and `signOut` are defined inline; reference them.)

```ts
import { SessionExpiryScheduler } from '../../internal/auth/session-expiry-scheduler';

export function createAuthDomain(ctx: DomainContext): AuthDomain {
  const guest = new GuestCredentialStore(ctx.config.storage);

  const scheduler = new SessionExpiryScheduler({
    storage: ctx.config.storage,
    onExpiry: () => {
      void handleSessionExpiry();
    },
  });

  const handleSessionExpiry = async (): Promise<void> => {
    const isGuest = (await guest.get()) !== null;
    if (isGuest) {
      try {
        await domain.signInGuest(); // re-extends; emits auth:signed-in -> re-arms via subscription
        return;
      } catch (error) {
        console.error('guest session re-extend failed', { cause: error });
        // fall through to terminal emit
      }
    }
    scheduler.disarm();
    ctx.emitter.emit('auth:session-expired', {});
  };

  // re-arm on sign-in (fresh/rotated refresh token), disarm on sign-out
  ctx.emitter.on('auth:signed-in', () => {
    void scheduler.armIfLoggedIn();
  });
  ctx.emitter.on('auth:signed-out', () => {
    scheduler.disarm();
  });

  const domain: AuthDomain = {
    /* ... all existing methods, plus A1's isLoggedIn/getCurrentUserId ... */
  };

  // cold-reload: arm if a session is already present (no auth:signed-in fires on reload)
  void scheduler.armIfLoggedIn();

  return domain;
}
```

> Note the forward reference: `handleSessionExpiry` calls `domain.signInGuest()`, and the `auth:signed-in` subscription calls `scheduler.armIfLoggedIn()`. Declare `domain` with the object literal and ensure `handleSessionExpiry`/the subscriptions are defined so the closure captures `domain` (a `const domain: AuthDomain = {…}` assigned before the `void scheduler.armIfLoggedIn()` line; the subscription callbacks run later, so the forward `const` capture is fine). If the existing factory returns the object literal directly, refactor to a named `const domain` first.

- [ ] **Step 4: Run the SDK suite**

Run: `cd packages/wallet-sdk && bunx tsc --noEmit && bun test` → PASS (the full suite, to catch the `SdkEventEmitter` subscription/teardown interaction).

- [ ] **Step 5: Commit**

```bash
git add packages/wallet-sdk/src/domains/auth/auth-domain.ts packages/wallet-sdk/src/domains/auth/auth-domain.test.ts
git commit -m "feat(wallet-sdk): produce auth:session-expired (guest self-heal, full-account terminal) (auth slice A3)"
```

> **Atomicity note:** after A3 the SDK emits `auth:session-expired`, but the web still runs `useHandleSessionExpiry` — a transient dual-handler that only matters at runtime-on-expiry, which is not deployed (the branch is gated, not pushed). Task B6 deletes the web handler + un-stubs the bridge in one commit. Land B6 promptly after Phase B's read flips.

---

## Phase B — web cut-over (typecheck + web-suite gated; behavioural proof = Task B7)

> Phase B web tasks have no jsdom unit coverage for route guards/bridge; their per-task gate is `bun run typecheck` + `bun --filter=web-wallet run test` (the existing web suite must stay green) + `bun run fix:all`. The behavioural proof is the deferred F6 gate (Task B7). Order matters: **B1 and B2 must precede B5** (the guards stop reading `authQueryOptions`' OpenSecret `AuthUser` before its return shape flips), and **A3 must precede B6**.

### Task B1: flip the `_protected.tsx` guard onto `sdk.auth` + `sdk.user`; delete `ensureUserData`

**Files:**
- Modify: `apps/web-wallet/app/routes/_protected.tsx` (`routeGuardMiddleware` `:154-229`; `ensureUserData` `:74-152`; `shouldUserVerifyEmail` `:46-49`; `hasUserChanged` `:64-72`)

**Interfaces:**
- Consumes: `sdk.auth.isLoggedIn()` (A1), `sdk.user.getCurrentUser()` (returns the bootstrapped wallet `User | null`; `resolveSession` does the upsert-on-missing/drift internally), `getSdk(host)` (`features/shared/sdk.ts:114`), `shouldVerifyEmail(user)` + `shouldAcceptTerms(user)` from `features/user/user.ts` (wallet-`User` variants).
- Produces: a guard that no longer reads the OpenSecret `AuthUser`, no longer defines `ensureUserData`/`hasUserChanged`/`shouldUserVerifyEmail`.

- [ ] **Step 1: Verify the SDK bootstrap parity first (throwaway check, no commit)**

Read `packages/wallet-sdk/src/domains/user/session-resolver.ts:41-91` and confirm `bootstrapUser` derives the SAME three keys (`cashuLockingXpub`, `encryptionPublicKey`, `sparkIdentityPublicKey`) + default accounts + `upsert` that the web `ensureUserData` does (`_protected.tsx:74-152`). CONFIRM where Breez WASM is initialized for the spark-pubkey derivation: today the guard `await ensureBreezWasm()` (`:206-209`) before bootstrap. Grep the SDK for whether `deriveSparkIdentityPublicKey`/the connections layer inits WASM itself. **If the SDK does NOT init WASM, keep an `await ensureBreezWasm()` call in the guard before `getCurrentUser()`** (the SDK assumes a ready signer). Record the finding in the commit message.

- [ ] **Step 2: Rewrite the guard middleware**

Replace the body of `routeGuardMiddleware` (`:154-229`). The new shape (preserve the URL/hash handling + the pending-terms POP only if Step 1 of Task B3/F4 hasn't yet moved terms to signup — see the note below):

```tsx
const routeGuardMiddleware: Route.ClientMiddlewareFunction = async ({ request }, next) => {
  const sdk = await getSdk(new URL(window.location.origin).host);

  if (!(await sdk.auth.isLoggedIn())) {
    const url = new URL(request.url);
    throw redirect(`/home?redirectTo=${encodeURIComponent(url.pathname + url.search)}`);
  }

  // resolveSession bootstraps the wallet.users row on missing/drift internally
  await ensureBreezWasm(); // keep iff Step 1 found the SDK does not init WASM for spark-pubkey derivation
  const user = await sdk.user.getCurrentUser();
  if (!user) {
    // token present but the server rejected it mid-resolve -> treat as logged out
    throw redirect('/home');
  }

  if (shouldAcceptTerms(user)) throw redirect('/accept-terms');
  if (shouldVerifyEmail(user)) throw redirect('/verify-email');

  await next();
};
```

DELETE `ensureUserData` (`:74-152`), `hasUserChanged` (`:64-72`), `shouldUserVerifyEmail` (`:46-49`), and now-unused imports (`WriteUserRepository`, `AccountRepository`, the key-derivation imports, `UserCache`/`AccountsCache` if only used for the seed, `AuthUser`). Keep the server `loader` `requireSessionHintOrRedirect` (`:239-242`) and the `ProtectedRoute` default export untouched in this task.

> **Accounts-cache parity:** the old guard did `setQueryData([AccountsCache.Key], accounts)` from the bootstrap. `getCurrentUser` returns only `User`. Accounts now come from the S12/S13-flipped `sdk.accounts.list()` read. Confirm `useAccounts`/`useBalance` consumers suspend-and-fetch cleanly on first render without the seed (they did after S13); if a flash/extra round-trip appears, add a `void sdk.accounts.list()` warm-up in the guard (do NOT re-introduce a manual `setQueryData`).
>
> **Pending-terms:** F4 moves terms to the signup actions (Task B3), so the guard should NOT pop `pendingWalletTermsStorage`/`pendingGiftCardMintTermsStorage` anymore. If B3 lands after B1, leave the pop out here from the start (the bootstrap no longer threads terms — the signup actions already created the row with terms). Verify no `/accept-terms` regression in Task B7.

- [ ] **Step 3: Gate**

Run: `bun run typecheck && bun --filter=web-wallet run test && bun run fix:all` → all green (the web suite has no guard test; rely on typecheck + the F6 gate for behaviour).

- [ ] **Step 4: Commit**

```bash
git add apps/web-wallet/app/routes/_protected.tsx
git commit -m "feat(web): flip _protected guard onto sdk.auth.isLoggedIn + sdk.user.getCurrentUser; delete ensureUserData (auth slice B1)"
```

---

### Task B2: flip the `_auth.tsx` guard; drop the `login_method` debug field

**Files:**
- Modify: `apps/web-wallet/app/routes/_auth.tsx` (`routeGuardMiddleware` `:13-32`, debug log `:21-22`)

**Interfaces:**
- Consumes: `sdk.auth.isLoggedIn()` (A1), `getSdk(host)`.
- Produces: an `_auth` guard that gates solely on `sdk.auth.isLoggedIn()` and no longer reads `authQueryOptions`/`login_method`.

- [ ] **Step 1: Rewrite the guard**

Replace the `ensureQueryData(authQueryOptions())` read + `isLoggedIn` gate with the cheap SDK check; preserve the `redirectTo` strip + `window.location.hash` reconstruction verbatim:

```tsx
const routeGuardMiddleware: Route.ClientMiddlewareFunction = async ({ request }, next) => {
  const sdk = await getSdk(new URL(window.location.origin).host);
  const loggedIn = await sdk.auth.isLoggedIn();
  if (loggedIn) {
    const location = new URL(request.url);
    const redirectTo = location.searchParams.get('redirectTo') ?? '/';
    location.searchParams.delete('redirectTo');
    const newSearch = location.searchParams.size > 0 ? `?${location.searchParams}` : '';
    throw redirect(`${redirectTo}${newSearch}${window.location.hash}`);
  }
  await next();
};
```

DELETE the `console.debug` block that read `user.login_method`/`user.email` (`:21-22`) and the now-unused `authQueryOptions` import.

- [ ] **Step 2: Gate**

Run: `bun run typecheck && bun --filter=web-wallet run test && bun run fix:all` → green.

- [ ] **Step 3: Commit**

```bash
git add apps/web-wallet/app/routes/_auth.tsx
git commit -m "feat(web): flip _auth guard onto sdk.auth.isLoggedIn; drop login_method debug field (auth slice B2)"
```

---

### Task B3: `useAuthActions` → thin adapter over `sdk.auth.*`; thread terms into the signup actions

**Files:**
- Modify: `apps/web-wallet/app/features/user/auth.ts` (`useAuthActions` `:198`, return `:314-324`; `signOut` `:239-247`; `initiateGoogleAuth` `:249-270`; `refreshSession` `:203-213`)
- Modify: `apps/web-wallet/app/features/signup/signup-form.tsx`, `apps/web-wallet/app/features/signup/signup.tsx` (thread `termsAcceptedAt`)
- Modify (if they call `useAuthActions` with positional args): `apps/web-wallet/app/features/login/login-form.tsx`, `login/request-password-reset.tsx`, `login/password-reset.tsx`, `features/receive/receive-cashu-token.tsx`, `features/user/user-hooks.tsx` (`useUpgradeGuestToFullAccount`, `useVerifyEmail`) — only if the adapter changes their call signatures (keep adapter signatures identical to today to avoid touching these).

**Interfaces:**
- Consumes: `sdk.auth.*` (`signIn`/`signUp`/`signInGuest`/`signOut`/`resetPassword`/`confirmPasswordReset`/`beginGoogleSignIn`/`verifyEmail`/`upgradeGuest`/`requestEmailVerificationCode`), `getSdk(host)`, `pendingWalletTermsStorage`/`pendingGiftCardMintTermsStorage` (`features/user/pending-terms-storage.ts`).
- Produces: `useAuthActions()` with the SAME public method names + arg shapes as today (so the 11 call sites don't change), internally calling `sdk.auth.*`. Web action→SDK map (name + arg remap) is the adapter's job.

> **F3 decision:** keep `useAuthActions` as an adapter — its public surface (positional args, web names like `signUpGuest`/`initiateGoogleAuth`/`convertGuestToFullAccount`) stays identical so call sites are untouched; only the internals call `sdk.auth.*`. This minimizes churn.

- [ ] **Step 1: Rewrite the adapter internals**

In `useAuthActions`, replace each `os*` call with the SDK equivalent (read the current `:215-312` bodies first). The mapping:

```ts
// inside useAuthActions(), after `const sdk = await getSdk(new URL(window.location.origin).host)` per call
signIn:  (email, password) => sdk.auth.signIn({ email, password }).then(() => refreshSession()),
signUp:  (email, password) => sdk.auth.signUp({
           email, password,
           termsAcceptedAt: pendingWalletTermsStorage.get(),
           giftCardMintTermsAcceptedAt: pendingGiftCardMintTermsStorage.get(),
         }).then(() => { pendingWalletTermsStorage.remove(); pendingGiftCardMintTermsStorage.remove(); return refreshSession(); }),
signUpGuest: () => sdk.auth.signInGuest({
           termsAcceptedAt: pendingWalletTermsStorage.get(),
           giftCardMintTermsAcceptedAt: pendingGiftCardMintTermsStorage.get(),
         }).then(() => { /* remove pending terms */ return refreshSession(); }),
signOut: (options = {}) => sdk.auth.signOut().then(() => refreshSession(options.redirectTo)),
requestPasswordReset: (email) => sdk.auth.resetPassword(email).then(({ secret }) => ({ email, secret })),
confirmPasswordReset: (email, code, secret, newPassword) =>
           sdk.auth.confirmPasswordReset({ email, code, secret, newPassword }),
verifyEmail: (code) => sdk.auth.verifyEmail(code).then(() => refreshSession()),
convertGuestToFullAccount: (email, password) =>
           sdk.auth.upgradeGuest({ email, password }).then(() => refreshSession()),
initiateGoogleAuth: async () => {
           const { authUrl } = await sdk.auth.beginGoogleSignIn();
           // KEEP the existing oauthLoginSessionStorage.create + state.sessionId re-encode (auth.ts:252-269) AROUND this
           return { authUrl: reencodeWithSessionState(authUrl) };
         },
```

Notes:
- `requestPasswordReset` re-adds `email` to the return for caller compatibility (the SDK trims it; the one caller already discards it, but keeping the return shape avoids touching `request-password-reset.tsx`).
- `signOut` must NO LONGER call `queryClient.clear()` + `Sentry.setUser(null)` directly — those move to the bridge `auth:signed-out` handler (Task B6). Remove them here. (Transient on-branch gap until B6 — acceptable, not deployed.)
- `refreshSession` stays as-is for now (`invalidateAuthQueries` + navigate/revalidate); the bridge `auth:signed-in` handler (B6) will also invalidate, which is idempotent. If you prefer no double-invalidate, drop `invalidateAuthQueries` from `refreshSession` once B6 lands and keep only the navigate/revalidate. Decide at B6.
- `requestNewVerificationCode` (raw OpenSecret, used by `user-hooks.tsx:169`) → `sdk.auth.requestEmailVerificationCode()`. Update that hook.
- `getSdk` needs the host; in this hook use `new URL(window.location.origin).host` (client-only hook).

- [ ] **Step 2: Confirm signup call sites already pass through the adapter unchanged**

`signup-form.tsx` calls `signUp(data.email, data.password)` and `signup.tsx` calls `signUpGuest()` — unchanged (terms are read inside the adapter from `pendingTerms` storage). VERIFY `signup-options.tsx` still SETS `pendingWalletTermsStorage`/`pendingGiftCardMintTermsStorage` before navigating to signup (it does today). If a signup path sets terms via a checkbox at submit time instead, pass them as new optional args — but the default (read pending storage inside the adapter) covers today's flow.

- [ ] **Step 3: Gate**

Run: `bun run typecheck && bun --filter=web-wallet run test && bun run fix:all` → green.

- [ ] **Step 4: Commit**

```bash
git add apps/web-wallet/app/features/user/auth.ts apps/web-wallet/app/features/user/user-hooks.tsx
git commit -m "feat(web): useAuthActions adapts to sdk.auth.*; thread terms into signup actions (auth slice B3)"
```

---

### Task B4: flip the OAuth callback route to `sdk.auth.completeOAuth`

**Files:**
- Modify: `apps/web-wallet/app/routes/_auth.oauth.$provider.tsx` (clientLoader `:38-87`)

**Interfaces:**
- Consumes: `sdk.auth.completeOAuth({ code, state, termsAcceptedAt?, giftCardMintTermsAcceptedAt? })` (`domains.ts:78-83`), `getSdk(host)`, `oauthLoginSessionStorage`, `pendingWalletTermsStorage`/`pendingGiftCardMintTermsStorage`.
- Produces: an OAuth callback that bootstraps via the SDK and preserves redirect-state replay.

- [ ] **Step 1: Replace the OS call block, keep the redirect replay**

Replace `:38-65` (the provider switch + raw `handleGoogleCallback` + `invalidateAuthQueries`) — keep the `try/catch` + the `UnsupportedOAuthProviderError` guard for non-google providers:

```tsx
try {
  switch (provider) {
    case 'google': {
      const sdk = await getSdk(new URL(window.location.origin).host);
      await sdk.auth.completeOAuth({
        code,
        state,
        termsAcceptedAt: pendingWalletTermsStorage.get(),
        giftCardMintTermsAcceptedAt: pendingGiftCardMintTermsStorage.get(),
      });
      pendingWalletTermsStorage.remove();
      pendingGiftCardMintTermsStorage.remove();
      break;
    }
    default:
      throw new UnsupportedOAuthProviderError(`Unsupported OAuth provider: ${provider}`);
  }
} catch (error) {
  console.error('OAuth callback failed', { cause: error });
  toast({ title: 'Login failed', variant: 'destructive' });
  throw redirect('/login');
}
await invalidateAuthQueries(); // keep until the bridge auth:signed-in handler (B6) drives this
```

KEEP `:67-87` verbatim (the `decodeURLSafe(state)` decode, `oauthLoginSessionStorage.get/remove`, `window.history.replaceState(hash)`, `throw redirect(url)`). Remove the direct `handleGoogleCallback` import from `@agicash/opensecret`.

> **F4 note:** threading terms here is net-new behaviour (the route didn't thread terms before). Verify in Task B7 that an OAuth signup that accepted terms lands authenticated without an `/accept-terms` bounce.

- [ ] **Step 2: Gate**

Run: `bun run typecheck && bun --filter=web-wallet run test && bun run fix:all` → green.

- [ ] **Step 3: Commit**

```bash
git add apps/web-wallet/app/routes/_auth.oauth.\$provider.tsx
git commit -m "feat(web): OAuth callback uses sdk.auth.completeOAuth + threads terms (auth slice B4)"
```

---

### Task B5: flip `authQueryOptions.queryFn` to `sdk.user.getCurrentUser()`

**Files:**
- Modify: `apps/web-wallet/app/features/user/auth.ts` (`authQueryOptions` `:47-84`, `AuthUser`/`AuthState` types `:33-43`, `useAuthState` `:104-107`)

**Interfaces:**
- Consumes: `sdk.user.getCurrentUser(): Promise<User | null>` (returns the bootstrapped wallet `User`), `getSdk(host)`, the refresh-token exp for the session-hint cookie (read from `browserStorage`/`localStorage`).
- Produces: `authQueryOptions` returning `{ isLoggedIn: true; user: User } | { isLoggedIn: false }` where `user` is the **wallet** `User` (camelCase). `useAuthState()` returns this. Key stays `['auth-state']`.

> Sequenced AFTER B1/B2 so the only remaining `authQueryOptions` consumers are `useAuthState` (2 consumers, read `.user` truthiness — `_protected.tsx:255`, `user-hooks.tsx:82`) + the homepage `useQuery` consumers (`join-beta-button.tsx`, `marketing-nav.tsx`, read `isLoggedIn` only). None read OpenSecret `AuthUser` fields, so the shape flip is safe.

- [ ] **Step 1: Flip the queryFn + types**

```ts
export type AuthUser = User; // wallet User now (was UserResponse['user'])
type AuthState = { isLoggedIn: true; user: User } | { isLoggedIn: false; user?: undefined };

export const authQueryOptions = () =>
  queryOptions({
    queryKey: [authStateQueryKey],
    queryFn: async () => {
      const sdk = await getSdk(new URL(window.location.origin).host);
      const user = await sdk.user.getCurrentUser(); // null when logged out (network-free); bootstraps when logged in
      if (!user) {
        sessionHintCookie.clear();
        Sentry.setUser(null);
        return { isLoggedIn: false } as const;
      }
      Sentry.setUser({ id: user.id, isGuest: user.isGuest });
      const refreshToken = window.localStorage.getItem('refresh_token');
      if (refreshToken) {
        const { exp } = jwtDecode<OpenSecretJwt>(refreshToken);
        sessionHintCookie.set(exp - Math.floor(Date.now() / 1000));
      }
      return { isLoggedIn: true, user } as const;
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
```

> Keep the `sessionHintCookie` set/clear (SSR concern, web-owned per §7b) and a minimal `Sentry.setUser` here. The rich Sentry tag stays in `wallet.tsx`. `AuthUser` is now an alias of the wallet `User`; grep for `AuthUser` field reads (`email_verified`, `login_method`, `name`, `created_at`) — there should be NONE left after B1/B2 (verified: only the middleware read them). Fix any stragglers.

- [ ] **Step 2: Gate**

Run: `bun run typecheck && bun --filter=web-wallet run test && bun run fix:all` → green. Pay attention to typecheck errors at the 2 `useAuthState` consumers + homepage — they should compile unchanged (truthiness/`isLoggedIn` only).

- [ ] **Step 3: Commit**

```bash
git add apps/web-wallet/app/features/user/auth.ts
git commit -m "feat(web): authQueryOptions.queryFn -> sdk.user.getCurrentUser (wallet User) (auth slice B5)"
```

---

### Task B6: un-stub the bridge auth handlers; delete `useHandleSessionExpiry` + `entry.client` `configure()`

**Files:**
- Modify: `apps/web-wallet/app/features/wallet/use-sdk-event-bridge.ts` (auth stubs `:103-112`)
- Modify: `apps/web-wallet/app/features/user/auth.ts` (DELETE `useHandleSessionExpiry` `:398-429`, and the `getRefreshToken`/`getRemainingSessionTimeInMs`/`removeKeys` helpers `:361-391` if now unused)
- Modify: `apps/web-wallet/app/features/wallet/wallet.tsx` (remove the `useHandleSessionExpiry` mount `:40-49`)
- Modify: `apps/web-wallet/app/entry.client.tsx` (DELETE the `configure()` call `:33-37` + the `configure`/`browserStorage` imports if now unused)
- Modify (optional): `apps/web-wallet/app/features/shared/sdk.ts` (`buildClientSdkConfig`) — preserve the missing-`VITE_OPEN_SECRET_*` early-throw guard that `entry.client.tsx:23-31` provided.

**Interfaces:**
- Consumes: the SDK `auth:signed-in`/`auth:signed-out`/`auth:session-expired` events (A3 produces the last); `queryClient` (captured in the bridge); `Sentry`; `sdk.auth.signOut()`; the `featureFlagsQueryOptions.queryKey` (import it, don't re-literal); `toast`.
- Produces: a fully wired auth-event bridge; no web session-expiry timer; no web `configure()`.

> **Atomicity:** this is the task that resolves all the "delete in the same change" hazards — the SDK producer (A3) is live, so deleting `useHandleSessionExpiry` here removes the dual handler; the bridge now drives auth-state/feature-flags invalidation + Sentry/cache clear; `configure()` deletion is safe because B1–B5 routed the first OpenSecret call through `getSdk()` (which configures).

- [ ] **Step 1: Un-stub the bridge auth handlers**

Replace `:103-112` (read the bridge's `on()`/teardown pattern + the captured `queryClient` first):

```ts
on('auth:signed-in', () => {
  void queryClient.invalidateQueries({ queryKey: [authStateQueryKey], refetchType: 'all' });
  void queryClient.invalidateQueries({ queryKey: featureFlagsQueryOptions.queryKey, refetchType: 'all' });
}),
on('auth:signed-out', () => {
  queryClient.clear();
  Sentry.setUser(null);
}),
on('auth:session-expired', () => {
  // full-account terminal expiry (guests self-heal silently in the SDK and never emit this)
  toast({
    title: 'Session expired',
    description: 'Your session has expired. You will be redirected to the login page.',
  });
  void getSdk(new URL(window.location.origin).host).then((sdk) => sdk.auth.signOut());
}),
```

> **All-tabs single-owner:** the bridge runs on every tab, and each tab's SDK instance fires its own `auth:session-expired` → N toasts + N `signOut` calls. Mitigate: (a) `signOut` is idempotent on tokens; (b) gate the toast to a single owner — reuse the existing single-owner signal if one exists (e.g. the leader flag the bridge can read), OR accept N idempotent toasts (low severity, only on involuntary expiry). Decide and document; do NOT replicate the old destructive `removeKeys()` + `window.location.reload()` here (it belongs nowhere portable). If a hard reset is needed on `signOut` failure, wrap it in the catch web-side only.

- [ ] **Step 2: Delete `useHandleSessionExpiry` + its mount**

Remove `useHandleSessionExpiry` (`auth.ts:398-429`) and the now-dead helpers (`getRefreshToken`, `getRemainingSessionTimeInMs`, and `removeKeys` if unused — grep first). Remove the `useHandleSessionExpiry({...})` call + its `onLogout` toast from `wallet.tsx:40-49` (the bridge now owns the toast).

- [ ] **Step 3: Delete `entry.client.tsx` `configure()`**

Remove the `configure({...})` call (`:33-37`) and the `configure`/`browserStorage` imports from `entry.client.tsx` if unused elsewhere in the file. Optionally, move the explicit missing-env throw (`:23-31`) into `buildClientSdkConfig` so a missing `VITE_OPEN_SECRET_*` still fails with a clear message rather than OpenSecret's generic throw.

- [ ] **Step 4: Resolve the `refreshSession` double-invalidate (from B3)**

Now that the bridge `auth:signed-in` invalidates `['auth-state']`+`['feature-flags']`, the `refreshSession` `invalidateAuthQueries()` is redundant for sign-in/up/guest/verify/convert (which emit `auth:signed-in`). Decide: leave `invalidateAuthQueries` in `refreshSession` (idempotent double-invalidate, simplest) OR remove it and rely on the events + keep only `navigate`/`revalidate`. Recommended: leave it (idempotent, lower risk); note for S15 cleanup.

- [ ] **Step 5: Gate**

Run: `bun run typecheck && bun --filter=web-wallet run test && bun run fix:all` → green.

- [ ] **Step 6: Commit**

```bash
git add apps/web-wallet/app/features/wallet/use-sdk-event-bridge.ts apps/web-wallet/app/features/user/auth.ts apps/web-wallet/app/features/wallet/wallet.tsx apps/web-wallet/app/entry.client.tsx apps/web-wallet/app/features/shared/sdk.ts
git commit -m "feat(web): wire bridge auth handlers; delete useHandleSessionExpiry + entry.client configure() (auth slice B6)"
```

---

### Task B7: full-suite gate + the deferred behavioural proof (F6)

**Files:** none (verification only).

- [ ] **Step 1: Run the full static gate**

Run, from the worktree root:

```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test && (cd packages/wallet-sdk && bun test)
```

Expected: Biome exit 0; typecheck clean; web suite green (≈129); SDK suite green (≥638 + the new A1–A3 tests). Record counts in the commit/PR notes.

- [ ] **Step 2: Run the DEFERRED behavioural gate (needs `VITE_BREEZ_API_KEY` + a live stack — ASK the user before running)**

This gate also covers S13's still-unrun money paths. Run `bun run test:e2e`, then manual money-path via Chrome DevTools MCP. Exercise, at minimum:
- sign in (email) → bootstrap → land on `/`; sign out → `/home`.
- sign up (email) with terms accepted → no `/accept-terms` bounce → verify-email gate fires for unverified.
- guest sign-up (`signUpGuest`) → no toast; guest session silently survives a refresh-token expiry (F2 — may require a short-lived token to observe).
- full-account refresh-token expiry → "Session expired" toast (once) + redirect to login (F1).
- Google OAuth round-trip → returns to the stashed `redirectTo` + hash; bootstraps; terms threaded.
- verify-email → `user:updated` flips the UI (already-bridged handler).
- logout → login as a DIFFERENT user (cache clears via bridge `auth:signed-out`; `sdk.background` restarts).
- the S13 money paths (send-to-contact/ln-address, cashu BUY_CASHAPP, token-receive 3 branches, spark balance refresh, reconnect catch-up).

- [ ] **Step 3: Do NOT push.** The whole migration is one PR opened at the very end. Update the `project-wallet-sdk-nocache-track` memory with the slice outcome (commits + gate status). The PR opens only after this gate is green AND the user approves.

---

## Self-Review

**1. Spec coverage:**
- §6 AuthDomain deltas → consumed as-is (the SDK already implements them; A1 adds the only net-new methods the guards need). ✓
- §7b auth row ("web deletes `useAuthActions` internals + `useHandleSessionExpiry` timer; keeps `authQueryOptions`/`useAuthState` queryFn→sdk, login/signup UI, OAuth redirect plumbing, session-hint cookie") → B3 (adapter internals), B6 (delete timer), B5 (authQueryOptions queryFn→sdk), B4 (OAuth plumbing kept), B5 (cookie kept). ✓
- §5 auth-event rows (`auth:signed-in` invalidate `['auth-state']`+`['feature-flags']`; `auth:signed-out` clear + Sentry; `auth:session-expired` toast + sign-out/guest) → B6. ✓
- The SDK prereqs from the prompt (cheap `isLoggedIn`/`getCurrentUserId`; `auth:session-expired` producer + scheduler) → A1, A2, A3. ✓
- `login_method` proven debug-only → dropped (B2). ✓
- `entry.client` `configure()` deletion (spec §8.5 Step 12 reassigned here) → B6. ✓
- `CompletedSparkLightningSendTransactionDetails` → DEFERRED to S15 (F5), explicitly out of scope. ✓

**2. Placeholder scan:** SDK tasks (A1–A3) carry full test + impl code. Web tasks carry exact before/after edits with file:line. The one deliberate verify-step is B1/Step1 (WASM-init parity) — it's a concrete read with a stated decision rule, not a placeholder. ✓

**3. Type consistency:** `isLoggedIn()`/`getCurrentUserId()` names match A1↔B1/B2. `SessionExpiryScheduler.armIfLoggedIn()`/`disarm()` names match A2↔A3. `sdk.user.getCurrentUser()` returns wallet `User` consistently (B1, B5). `AuthUser` re-aliased to wallet `User` in B5 (after B1/B2 remove OpenSecret-field reads). `authStateQueryKey`/`featureFlagsQueryOptions.queryKey` reused (B6) rather than re-literaled. ✓

**Risk callouts carried into execution:** (a) the on-branch transient dual-expiry-handler between A3 and B6 (harmless, not deployed); (b) WASM-init ownership for the SDK bootstrap (B1/Step1 resolves); (c) accounts-cache warming after dropping the guard seed (B1 note); (d) the all-tabs `auth:session-expired` single-owner toast (B6/Step1). None block the static gate; all are covered by the F6 behavioural gate (B7).
