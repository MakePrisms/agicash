# Effect TS migration assessment (agicash)

Pinned commit: `887bdc480b554bd5f3a994002259bcce533ed703` (2026-09-21). No Effect dependency exists. No code was changed for this document.

## 0. Summary

**Do not adopt Effect as a stack in 2026.** The wallet is mid-extraction of `@agicash/wallet-sdk` (`send` / `transfer` / `featureFlags` / `taskProcessor` still throw `NotImplementedError` at `packages/wallet-sdk/domain/sdk/sdk.ts:58-69`). The real pain is ~3.2k LOC of session fencing, reconnect, retry, and resource lifecycle — not the React/TanStack/Zustand/zod/Money surface. That pain is cheaper to fix in plain TypeScript than to wrap in a new runtime the team has never used, on money paths, while Effect 4.0 is still an API-incompatible RC.

A 1–2 week spike is **optional**, not required. If it happens, keep it SDK-internal or utility-first; do not touch quote hooks, Zustand, or `@effect-atom/atom-react`. Target **effect 3.22.2**, not 4.0 RC.

| Number | Value | Confidence |
| --- | --- | --- |
| High-fit hotspot LOC | **~3,190** (15 files; command in §6) | high (wc -l) |
| Cost if you adopt | utility-first **1–3 ew**; SDK-internal **6–14 ew**; hooks too **20–40 ew** | medium / low-medium / low |
| First-slice size | **159 LOC** (`packages/utils/src/{with-retry,delay,timeout}.ts`) or **361 LOC** (`session-keys.ts` + `supabase-session.ts`) | high |

Top 3 risks: (1) money-path regressions in Cashu melt/mint and Spark pay while two async idioms coexist; (2) Effect 3.22 → 4.0 rewrite with no stable date (`4.0.0-rc.117` published 2026-09-21); (3) `tsc` / Vite memory — `apps/web-wallet/package.json:9` already sets `--max-old-space-size=8192`.

## 1. Method

Read: `CLAUDE.md`, `docs/architecture.md`, `docs/guidelines.md`, `packages/wallet-sdk/index.ts`, `packages/wallet-sdk/lib/error.ts`, `apps/web-wallet/app/lib/error.ts`, SDK `domain/sdk/{sdk,session-keys,events,task-processor,user-provisioner}.ts`, `domain/user/auth-service.ts`, `db/supabase-session.ts`, `lib/spark/{wallet,wasm}.ts`, `lib/cashu.ts`, `domain/feature-flags/feature-flag-service.ts`, `domain/receive/claim-cashu-token-service.ts`, `apps/web-wallet/app/lib/supabase/*`, quote `*-hooks.ts`, `features/wallet/task-processing.ts`, `features/shared/{query-client,sdk.client}.ts`, `packages/utils/src/{with-retry,delay,timeout}.ts`, `packages/money/src/money.ts`, catalog versions in root / app `package.json`.

Ran (cwd `/work`):

```
git rev-parse HEAD
# → 887bdc480b554bd5f3a994002259bcce533ed703

find apps/web-wallet/app -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' ! -name '*.test.tsx' | wc -l
# → 293 files; same find -exec cat | wc -l → 27235 LOC

find packages/wallet-sdk -type f -name '*.ts' ! -name '*.test.ts' ! -path '*/node_modules/*' | wc -l
# → 119 files; -exec cat | wc -l → 18192 LOC (includes db/supabase/database.types.ts = 1971)

# small libs non-test LOC (same find): bolt11 183, cashu 1292, ecies 265, lnurl 259, money 810, utils 300 = 3109

git grep -l -E 'AbortController|AbortSignal|setTimeout\(|Promise\.race|Promise\.all|Promise\.allSettled|retry|withTimeout|backoff|new Promise\(' \
  -- 'apps/web-wallet/app' 'packages/wallet-sdk' 'packages/utils' | grep -v '\.test\.' | wc -l
# → 59 (matches the buyer inventory)

git grep -l "from 'zod/mini'" -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l   # → 53
git grep -l 'instanceof DomainError' -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l  # → 13
find . -name '*.test.ts' -o -name '*.test.tsx' | grep -v node_modules | wc -l  # → 31
# 23 of those are apps/web-wallet (4) + packages/wallet-sdk (19); 8 more in money/cashu/ecies/bolt11

wc -l <inventory files>   # per-file LOC in §2
```

npm registry (GET `https://registry.npmjs.org/<pkg>/[version]`, HEAD tarball `Last-Modified`):

| Package | Version | Published (tarball Last-Modified) | Notes |
| --- | --- | --- | --- |
| effect | 3.22.2 (latest) | 2026-09-09 | unpackedSize 27,163,958; fileCount 2715; `sideEffects: []`; deps `fast-check`, `@standard-schema/spec` |
| effect | 4.0.0-rc.117 | 2026-09-21 | unpackedSize 48,953,868; fileCount 2546; unified exports (`./unstable/sql`, etc.) |
| @effect/platform | 0.97.2 | 2026-09-09 | peer `effect ^3.22.2` |
| @effect/sql | 0.52.1 | tarball 2026-07-30 (registry updated 2026-09-18) | peer `effect ^3.22.1`, `@effect/platform ^0.97.1` |
| @effect-atom/atom-react | 0.7.0 | 2026-08-14 | peer `effect ^3.22.1`, `react >=18 <20` |
| @effect/vitest | 0.30.0 | 2026-07-13 | peer `effect ^3.22.0`, `vitest ^3.2.0` |

Could not verify (no `effect` install; HEAD omitted `Content-Length`): tree-shaken Vite/PWA gzip size; `tsc` wall time with Effect; tarball gzip bytes; `Runtime.runPromise` options object against installed `.d.ts` (spike must open it). Effect 4 “typical program 70kB → 20kB” is a third-party claim ([byteiota, 2026](https://byteiota.com/effect-ts-4-rc-migrate-now/)), not measured here.

`CLAUDE.md` is stale on two points the buyer already flagged: `packages/wallet-sdk` is ~18k LOC, not an empty placeholder; error classes live in `packages/wallet-sdk/lib/error.ts:6-70`, not `apps/web-wallet/app/features/shared/error.ts` (that file does not exist). `apps/web-wallet/app/lib/error.ts:1-14` is only `getErrorMessage`.

## 2. Inventory of async and control-flow concerns

Grep undercounts leader election, WASM init, quote-expiry timers, session expiry, Spark connect memo, feature-flag generation fencing. Those are included. `retry` hits TanStack `retry:` and comments in `packages/wallet-sdk/lib/error.ts:4,53` — those files are listed only when they also have real control flow.

**Effect primitive (first use):** `Effect<A, E, R>` is a lazy description of a success `A`, typed failure `E`, and required services `R`. Nothing runs until `runPromise` / `runFork`.

| path | LOC | concern(s) | current mechanism | defect risk | Effect fit |
| --- | ---: | --- | --- | --- | --- |
| `packages/utils/src/with-retry.ts` | 81 | retry, backoff, cancel | loop + `delay`; `retry` number or predicate | no tests in `packages/utils`; abort only cancels the delay, not `fn()` (`with-retry.ts:66-77`) | **high** |
| `packages/utils/src/delay.ts` | 30 | timeout, cancel | `new Promise` + `setTimeout` + abort listener | abort after fire is fine (`delay.ts:25-28`); no `AbortSignal.any` | **high** |
| `packages/utils/src/timeout.ts` | 48 | long timeout | chunked `setTimeout` past 2^31-1 | no abort API (`timeout.ts:17-37`); callers must `clearLongTimeout` | **high** |
| `packages/wallet-sdk/domain/user/auth-service.ts` | 512 | session expiry, cancel, resource | `AbortController` scope (`auth-service.ts:86,372-375`); `setLongTimeout` (`386-388`); guest re-sign-in on expiry (`427-511`) | authors document a residual race (`416-426`); timer/storage interleaving on guest extend | **high** |
| `packages/wallet-sdk/domain/sdk/session-keys.ts` | 286 | cancel, memo, resource | per-session `AbortController` (`144`); `createMemo` (`89-135`); composite fence (`207-217`) | in-flight rejection not cached (`125-128`) is easy to break; `Encryption` facade re-checks signal (`224-261`) | **high** |
| `packages/wallet-sdk/db/supabase-session.ts` | 75 | memo, generation fence | `generation` counter (`32-41,56-68`); single-flight token | late exchange can still *return* an old token to its caller even if it does not cache (`64`) | **high** |
| `packages/wallet-sdk/domain/sdk/sdk.ts` | 223 | lifecycle, WASM, dispose | `Promise.all([restoreSession, ensureBreezWasm])` (`208-212`); process-global instance (`42,191-199`); `dispose` (`215-221`) | second instance throws (`193-196`); HMR relies on `sdk.client.ts:78-82` | **high** |
| `packages/wallet-sdk/lib/spark/wasm.ts` | 21 | resource, single-flight | cached init promise (`15-20`) | correct; Effect Scope would not shorten | **medium** |
| `packages/wallet-sdk/lib/spark/wallet.ts` | 195 | resource, memo | `Map` of connect promises (`99-144`); `clearSparkWallets` only `.clear()` (`150-152`) | **no `disconnect()` on sign-out** — leaked Breez sessions (`150-152`) | **high** |
| `packages/wallet-sdk/lib/cashu.ts` | 239 | timeout, race | `Promise.race` vs 10s timer (`182-193`) | **timer not cleared**; loser reject after winner is a classic unhandled-rejection (`189-192`) | **high** |
| `packages/wallet-sdk/domain/feature-flags/feature-flag-service.ts` | 114 | retry, generation | hand-rolled backoff (`24-40`); `generation` (`47,104-107`) | retries run to completion even after `resetFeatureFlags` (`83-88,104-107`) | **high** |
| `packages/wallet-sdk/domain/user/user-api.ts` | 178 | retry, cancel, error map | `withRetry` around key derive + upsert (`122-168`); skip `SessionEndedError`/`DisposedError`/`$ZodError` (`67-68,130-167`) | abort checked *after* `Promise.all` (`136-138`) — keys may finish for a dead session | **high** |
| `packages/wallet-sdk/domain/sdk/user-provisioner.ts` | 53 | error map, fingerprint | in-memory fingerprint (`31-34`); swallow lifecycle errors (`40-45`) | late provision can emit after `reset` if fingerprint is set post-await (`36-38`) | **medium** |
| `packages/wallet-sdk/domain/receive/claim-cashu-token-service.ts` | 349 | timeout, race, error map, background | `instanceof DomainError` (`62-67`); Spark wait via listener + 10s timer (`263-348`) | **double-fire window** (`292-294` then `resolved=true`); listener cleanup no-ops if `addEventListener` hangs past timeout | **high** |
| `packages/wallet-sdk/domain/wallet/task-processing-lock-repository.ts` | 40 | leader election | `rpc('take_lead')` (`21-38`) | abort optional (`26-28`); lock TTL is SQL-side | **medium** |
| `packages/wallet-sdk/domain/sdk/task-processor.ts` | 21 | lifecycle (API only) | unimplemented on SDK (`sdk.ts:67-69`) | web still owns the processor (`task-processing.ts:75-83`) | **medium** (future) |
| `packages/wallet-sdk/domain/sdk/events.ts` | 168 | pubsub | sync `Map`/`Set` + replay-latest (`95-157`) | handler throw is logged (`129-133`); not an Effect problem | **low** |
| `packages/wallet-sdk/domain/contacts/contacts-api.ts` | 89 | cancel | `requireLiveSignal` (`30-36`) + post-await abort (`42-44`) | same “result unused” contract as session-keys | **medium** |
| `packages/wallet-sdk/domain/contacts/contact-repository.ts` | 170 | cancel | `abortSignal` on every query (`21-134`) | plumbing only; Effect would be `Effect.interruptWhen` | **medium** |
| `packages/wallet-sdk/domain/user/user-repository.ts` | 380 | cancel, resource | `abortSignal`; `Promise.all` decrypt (`201`); Spark wallet init (`305-307`) | wallet init races session end | **medium** |
| `packages/wallet-sdk/domain/user/user-service.ts` | 81 | cancel | forwards `abortSignal` (`45,78`) | none beyond plumbing | **low** |
| `packages/wallet-sdk/domain/accounts/account-repository.ts` | 280 | cancel, resource | `abortSignal`; `Promise.all` wallet+proofs (`187`) | same | **medium** |
| `packages/wallet-sdk/domain/accounts/account-service.ts` | 58 | cancel | optional `abortSignal` (`34`) | none | **low** |
| `packages/wallet-sdk/domain/transactions/transaction-repository.ts` | 204 | cancel | `abortSignal`; `Promise.all` decrypt (`84`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-quote-repository.ts` | 473 | cancel | `abortSignal`; parallel encrypt (`63`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-quote-repository.server.ts` | 119 | cancel | `abortSignal` (`34`); encrypt without private key (`36-40`) | server cannot decrypt; Effect unused | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-swap-repository.ts` | 339 | cancel | `abortSignal`; `Promise.all` (`130,205,307`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/spark-receive-quote-repository.ts` | 336 | cancel | `abortSignal`; `Promise.all` (`290`) | plumbing | **low** |
| `packages/wallet-sdk/domain/send/cashu-send-quote-repository.ts` | 501 | cancel | `abortSignal`; parallel encrypt (`147`) | plumbing | **low** |
| `packages/wallet-sdk/domain/send/cashu-send-swap-repository.ts` | 385 | cancel | `abortSignal`; `Promise.all` (`281`) | plumbing | **low** |
| `packages/wallet-sdk/domain/send/spark-send-quote-repository.ts` | 339 | cancel | `abortSignal`; `Promise.all` (`309`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-quote-service.ts` | 361 | error map, money SM | class + mint/melt; `abortSignal` on create (`61`) | **no dedicated test file**; Effect would not clarify the Cashu state machine | **low** (money; do not touch) |
| `packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts` | 253 | money SM | `abortSignal` (`54`) | same | **low** |
| `packages/wallet-sdk/domain/receive/spark-receive-quote-service.ts` | 192 | money SM | `abortSignal` (`33`) | same | **low** |
| `packages/wallet-sdk/domain/send/cashu-send-quote-service.ts` | 568 | money SM | constructor-injected repo | **no dedicated test file**; melt/proofs | **negative** until tests exist |
| `packages/wallet-sdk/domain/send/cashu-send-swap-service.ts` | 457 | money SM | ctor(repo, receiveSwapService) (`36-39`) | same | **negative** |
| `packages/wallet-sdk/domain/send/spark-send-quote-service.ts` | 380 | money SM | Spark pay | same | **negative** |
| `packages/wallet-sdk/domain/receive/lightning-address-service.ts` | 371 | error map | `instanceof NotFoundError` (`286`); zod/mini | server LNURL; Effect HTTP layer would fight `ky` | **low** |
| `packages/wallet-sdk/domain/exchange-rate/exchange-rate-service.ts` | 99 | cancel, fallback | sequential providers + `signal` (`48-73`) | abort message vs failure (`70-73`) | **medium** |
| `packages/wallet-sdk/lib/error.ts` | 70 | error map | `SdkError` tree (`6-70`); `instanceof` is the host contract (`1-4`) | replacing with `Data.TaggedError` breaks 13 `instanceof DomainError` call sites unless constructors stay | **low** (keep classes) |
| `apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts` | 694 | reconnect, backoff, queue, lifecycle | serial resubscribe queue (`97-103,306-327,452-517`); `setTimeout` delays (`99-101,481-483`); online/active gates (`109-111,334-373`) | **`closeChannel` `clearTimeout`s the delay without resolving the Promise (`393-396,481-483`) → `isProcessingResubscribeQueue` can stick true** | **high** |
| `apps/web-wallet/app/lib/supabase/supabase-realtime-hooks.ts` | 145 | subscribe, errors | React + `useSyncExternalStore` | wraps manager; Effect would fight React lifecycle | **low** |
| `apps/web-wallet/app/features/wallet/task-processing.ts` | 83 | leader election, background loop | TQ `refetchInterval: 5000` (`33-41`); `TaskProcessor` mounts 6 hook processors (`75-83`) | errors only `console.warn` (`43-51`); not in SDK | **medium** |
| `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` | 844 | polling, WS, retry, quote expiry, background | TQ `useQueries` poll 10s/60s on 429 (`384-421`); WS subscribe `retry: 5` (`440-443`); `withRetry` + `setLongTimeout` expiry (`460-502`); mutations `retry: 3` (`611-676`) | mint-quote poll `retry: false` swallows errors (`397-403`); Effect vs TQ is a fight | **low** (TQ is the scheduler) |
| `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` | 720 | listeners, expiry, background | per-account Breez listener (`364-460`); mutations `retry: 3` | **cleanup `.catch` wraps warn in a no-op arrow (`449-457`) — warn never runs**; listeners can leak | **medium** (bug is 8 lines of TS) |
| `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts` | 521 | retry policy, melt WS, background | `instanceof DomainError`/`ConcurrencyError` (`135-189`); melt subscription + complete/expire mutations (`280-444`) | TQ retry *is* the policy; Effect duplicate | **low** |
| `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` | 490 | retry, WS | same pattern (`185-189,346`) | same | **low** |
| `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` | 545 | retry, error map | `instanceof DomainError` (`337,387,453`) | same | **low** |
| `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` | 202 | background | mutations `retry: 3` / `0` (`178,199`) | TQ | **low** |
| `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts` | 152 | WS, quote expiry | mutation `retry: 5` (`96-99`); `setLongTimeout` (`134-149`) | expiry check is a protocol gap, not an Effect gap | **medium** |
| `apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts` | 104 | WS resource | promise-held unsubscribe (`5-8,72-79`) | overlapping subscribe can drop the old callback (`35-50`) | **medium** |
| `apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts` | 129 | WS resource | same shape | same | **medium** |
| `apps/web-wallet/app/features/transactions/transaction-hooks.ts` | 298 | retry, error map | `instanceof NotFoundError` (`103-108`); infinite query | TQ | **low** |
| `apps/web-wallet/app/hooks/use-exchange-rate.ts` | 89 | polling, cancel | TQ `signal` into `getRates` (`37-41`); `refetchInterval: 15_000` (`71,78`) | already abortable | **low** |
| `apps/web-wallet/app/features/shared/query-client.ts` | 23 | retry defaults | `new QueryClient()` with **no** defaults (`5-6`) | TQ default query retry=3, mutation retry=0; every hook re-specifies | **negative** |
| `apps/web-wallet/app/features/send/send-store.ts` | 414 | UI SM, error map | `createSendStore(deps)` (`181-192`); `instanceof DomainError` (`399`) | Zustand factory; Layer would not help | **negative** |
| `apps/web-wallet/app/features/email/welcome-email-service.ts` | 66 | retry | `ky` retry (`48-50`) | already a library | **negative** |
| `apps/web-wallet/app/entry.server.tsx` | 112 | SSR timeout | `renderToPipeableStream` + `setTimeout(abort, …)` (`17,30,100`) | React Router, not Effect | **negative** |
| UI timers (`use-toast.ts`, `use-animation.ts`, `use-throttle.ts`, homepage, PWA banner, `view-transition.tsx`) | n/a | timeout | `setTimeout` | cosmetic | **negative** |

High-fit LOC command and sum (15 files; `realtime-hooks.ts` is counted because it owns the online/active wiring, but rewriting the React hook is low-fit):

```
wc -l packages/utils/src/with-retry.ts packages/utils/src/delay.ts packages/utils/src/timeout.ts \
  apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts \
  packages/wallet-sdk/domain/user/auth-service.ts \
  packages/wallet-sdk/domain/sdk/session-keys.ts \
  packages/wallet-sdk/db/supabase-session.ts \
  packages/wallet-sdk/domain/feature-flags/feature-flag-service.ts \
  packages/wallet-sdk/domain/receive/claim-cashu-token-service.ts \
  packages/wallet-sdk/lib/spark/wallet.ts \
  packages/wallet-sdk/lib/spark/wasm.ts \
  packages/wallet-sdk/domain/user/user-api.ts \
  packages/wallet-sdk/lib/cashu.ts \
  packages/wallet-sdk/domain/sdk/sdk.ts \
  apps/web-wallet/app/lib/supabase/supabase-realtime-hooks.ts
# 81+30+48+694+512+286+75+114+349+195+21+178+239+223+145 = 3190
```

### Pain ranked from this inventory (no product steer)

1. **Session/key fencing (correctness).** `auth-service.ts` + `session-keys.ts` + `supabase-session.ts` + the `abortSignal` fan-out through every repository. A bug here encrypts or decrypts as the wrong user, or applies a stale session after sign-out. Already heavily commented and tested (926 + 217 test LOC) — the code is *aware* of the races (`auth-service.ts:416-426`) rather than missing a library.
2. **Realtime reconnect (reliability).** 694-line manager written because “Supabase client handles errors and reconnects very poorly” (`supabase-realtime-manager.ts:64-72`). Serial queue is a workaround for a shared socket (`87-91`). The `clearTimeout` hang (`393-396` vs `481-483`) is a real defect. Wired from `supabase-realtime-hooks.ts:127-133`.
3. **Resource leaks and timeouts (ops).** `clearSparkWallets` does not disconnect (`wallet.ts:150-152`); mint init `Promise.race` timer is never cleared (`cashu.ts:182-193`); Spark listener cleanup is a no-op (`spark-receive-quote-hooks.ts:449-457`).
4. **Background money machines (product).** Six processors mounted only on the leader (`task-processing.ts:75-83`) using TQ mutations, mint/melt websockets, and `setLongTimeout` expiry. This is where proofs move (`cashu-receive-quote-hooks.ts:714-723`). Effect does **not** rank here: TQ *is* the scheduler, and the services lack dedicated tests.
5. **Hand-rolled retry (hygiene).** `with-retry.ts` (no tests), a second copy in `feature-flag-service.ts:24-40`, a third in `ky` (`welcome-email-service.ts:48-50`), plus per-hook `retry:` callbacks. Unifying these is the cheapest Effect-shaped win and also the cheapest plain-TS win.

Grep undercount, verified in code: leader election is `take_lead` RPC + TQ interval, not `AbortController` (`task-processing.ts:33-41`, `task-processing-lock-repository.ts:21-24`). WASM init is a memoized promise (`wasm.ts:15-20`). Quote expiry is `setLongTimeout` (`melt-quote-subscription.ts:134-149`, `cashu-receive-quote-hooks.ts:486-495`). Session expiry is `setLongTimeout` on JWT `exp` (`auth-service.ts:377-388`). Spark connect is a process-wide `Map` (`wallet.ts:99-144`). Feature-flag generation is a module counter (`feature-flag-service.ts:47,104-107`). `taskProcessor` on the SDK is a stub (`sdk.ts:67-69`).

### What “retry” in the 59-file grep is not

TanStack `retry:` / `retry: 3` in quote hooks is **policy**, already expressed (`cashu-send-quote-hooks.ts:181-189`: never retry `DomainError`, always retry `ConcurrencyError`). `packages/wallet-sdk/lib/error.ts:4,53` matches the word “retry” in comments only. `Promise.all` over decrypt batches (e.g. `transaction-repository.ts:84`) is parallelism, not control-flow pain. Those rows stay in the table so the grep is fully accounted for; their Effect fit is low/negative.

## 3. Where Effect helps

**Primitives used below.** `Schedule` = composable retry/repeat policy. `Effect.timeout` = fail/interrupt after a duration. `Effect.race` = first winner, interrupt losers. **Fiber** = lightweight green thread; interruption is the cancellation model. `Scope` / `acquireRelease` = bracket: acquire a resource, release on success, failure, or interrupt. `Layer` / `Context.Tag` = typed DI graph. `Queue` / `PubSub` / `Stream` = in-process async pipelines. `Ref` / `SynchronizedRef` = STM-ish shared state (`SynchronizedRef` serializes updates). `Deferred` = one-shot promise. `Schema` = Effect’s decoder (not recommended here; see §4/§7).

### 3.1 Session keys — abort-fenced memo (`session-keys.ts`)

**Current** — success-only memo (`123-127`); session `AbortController` (`144`); composite fence (`207-217`); facade repeats the check (`224-261`):

```114:132:packages/wallet-sdk/domain/sdk/session-keys.ts
        inFlight = (async () => {
          try {
            const value = await fetcher();
            if (isDisposed()) {
              throw new DisposedError();
            }
            if (signal.aborted) {
              throw new SessionEndedError();
            }
            cached = { value };
            return value;
          } finally {
            if (!signal.aborted) {
              inFlight = undefined;
            }
          }
        })();
```

**Effect 3.22** (`SynchronizedRef` = mutexed `Ref`; Fiber interrupt = `abort`):

```ts
const getOrFetch = <A>(ref: SynchronizedRef.SynchronizedRef<Option.Option<A>>, fetch: Effect.Effect<A, SessionEndedError | DisposedError>) =>
  SynchronizedRef.updateEffect(ref, (c) =>
    disposed ? Effect.fail(new DisposedError())
    : sessionEnded ? Effect.fail(new SessionEndedError())
    : Option.match(c, { onSome: (a) => Effect.succeed(Option.some(a)), onNone: () => fetch.pipe(Effect.map(Option.some)) }),
  ).pipe(Effect.flatten, Effect.flatten)
const getEncryption = Effect.all([priv, pub], { concurrency: 2 }).pipe(Effect.interruptWhen(sessionEnded))
```

**Not shorter:** uncached rejection is still a rule. **Not clearer:** the JS facade must stay Promise-shaped (`29-31`).

### 3.2 Auth session expiry (`auth-service.ts`)

**Current** — scope swap + long timer + guest extend. `teardown` aborts the scope and permanently stops the timer (`284-288`). `setExpiryTimer` awaits remaining ms then assigns synchronously so two overlapping calls cannot orphan a timer (`377-388`).

```372:389:packages/wallet-sdk/domain/user/auth-service.ts
  private startNewSessionScope(): void {
    this.sessionScope.abort();
    this.sessionScope = new AbortController();
  }

  private async setExpiryTimer(): Promise<void> {
    const remaining = await this.getRemainingSessionTimeMs();
    // Clear only after the await, so clear + check + assign run as one
    // synchronous block: two overlapping calls can't interleave and orphan a
    // timer, and a teardown during the await can't be overridden.
    this.clearExpiryTimer();
    if (this.disposed || remaining === null) {
      return;
    }
    this.expiryTimeout = setLongTimeout(() => {
      this.handleSessionExpiry();
    }, remaining);
  }
```

Guest expiry (`427-511`) re-reads the stored refresh token (Open Secret may have rotated it), maybe re-signs-in the stored guest, then scope-checks, then may compensate with `os.signOut`. The residual race is documented in-tree (`416-426`): token writes can interleave with a sign-out’s storage clear. Tests: `auth-service.test.ts` is **926 LOC**, full of `await new Promise((r) => setTimeout(r, 0|10|200))`.

**Effect sketch:** `Clock.sleep(remaining)` on a session `Scope`; `teardown` interrupts the scope (`Fiber.interrupt` of children). Guest extend is `Effect.gen` with `Effect.uninterruptible` around credential persist (`202-221` — that block must be uninterruptible in *either* idiom or you strand a guest account). `TestClock` (ships in `effect` 3.22.2 as `effect/TestClock`) advances 30 days without `setLongTimeout`. `Effect.timeoutTo` encodes the 5s early-expiry margin (`396-407`).

**Not shorter:** the guest-vs-full / teardown-vs-sign-out / “don’t sign out an HMR successor” matrix is domain. Effect does not delete `416-426`. **Clearer:** the happy-path timer becomes unit-testable without fake clocks in `setTimeout`. That is the one place Effect would likely *reduce* test LOC.

### 3.3 Realtime resubscribe queue (`supabase-realtime-manager.ts`)

**Current** — serial queue because parallel resubscribes were suspected to saturate the shared Phoenix socket (`87-91`). Delay table is data (`99-101`). `closeChannel` cancels the timer **without resolving the Promise the worker is awaiting**.

```394:396:apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts
    if (state.retryTimeout) {
      clearTimeout(state.retryTimeout);
    }
```

```481:483:apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts
      await new Promise((resolve) => {
        state.retryTimeout = setTimeout(resolve, delay);
      });
```

If a subscriber unmounts (`removeChannel`) or the tab goes offline into `closeChannel` (`617`) while that `await` is parked, `isProcessingResubscribeQueue` stays `true` (`456,512`) and the queue never drains. Online/active gating is in the React hook (`supabase-realtime-hooks.ts:127-133`).

**Effect sketch** (`Queue` = mailbox; `Schedule` = the delay table; Fiber interrupt cancels `Clock.sleep`):

```ts
const delays = [0, 100, 500, 1000, 3000, 6000, 10000, 20000, 30000]
const worker = Queue.take(q).pipe(
  Effect.flatMap((topic) =>
    Effect.forEach(delays, (ms) =>
      Clock.sleep(Duration.millis(ms)).pipe(
        Effect.zipRight(resubscribe(topic)),
      ),
    ),
  ),
  Effect.forever,
)
// closeChannel: Fiber.interrupt(fiberForTopic) — sleep cancelled, worker loops.
```

**Not shorter overall:** postgres_changes “fully connected” (`73-76,556-633`) stays a callback bridged into `Deferred`. Wrapping `@supabase/realtime-js` as `Stream` is **not** clearer. The retry *loop* is shorter and the hang is structurally impossible. This is the strongest “Effect vs 30 lines of TS” comparison the spike should run.

### 3.4 Spark receive wait (`claim-cashu-token-service.ts`)

**Current** — money path. `handlePayment` returns if `resolved` (`293`) then sets it (`298`); event + initial lookup can both pass. Timer:

```282:290:packages/wallet-sdk/domain/receive/claim-cashu-token-service.ts
      const timeoutId = setTimeout(() => {
        resolved = true;
        cleanup();
        reject(
          new Error(
            `Spark receive request ${quote.sparkId} timed out after ${timeoutMs / 1000} seconds`,
          ),
        );
      }, timeoutMs);
```

**Effect 3.22** (`acquireRelease` always detaches; `Deferred` is one-shot; `Effect.race` interrupts losers):

```ts
const wait = Effect.acquireRelease(
  Effect.tryPromise(() => account.wallet.addEventListener({ onEvent })),
  (id) => Effect.promise(() => account.wallet.removeEventListener(id).then(() => undefined)),
).pipe(
  Effect.flatMap(() => Effect.race(Deferred.await(paid), Effect.tryPromise(() => account.wallet.getPaymentByInvoice({ invoice: quote.paymentRequest })))),
  Effect.timeout(Duration.seconds(10)),
)
```

**Shorter and clearer** than the 85-line Promise (`263-348`). Also ~40 lines of plain TS (`AbortSignal.timeout` + `Promise.withResolvers`). Prefer that unless a spike already uses Effect here. Do not start a migration: `meltProofsIdempotent` `{ type: 'random' }` is at `161-171`.

## 4. Where Effect does not help or hurts

Boundary rule: **Effect stays behind `Promise`/`AbortSignal` at the SDK public surface** (`packages/wallet-sdk/index.ts:10-21`, `domain/sdk/index.ts`). React never imports `effect`.

| Surface | Why Effect hurts | Boundary |
| --- | --- | --- |
| React components | Fibers ≠ React lifecycle; would reimplement what `useEffect` cleanup already does | stop at hooks calling `sdk.*` |
| TanStack Query v5 (`query-client.ts:5-6`, every `*-hooks.ts`) vs `@effect-atom/atom-react@0.7.0` | atom-react peers `react >=18 <20` (we are **19.2.4**, still in range) but replaces Query’s cache, suspense, `queryOptions()`, the patched `@tanstack/query-core@5.90.20` (`package.json:66-71`), and version-gated `*Cache` classes. Quote processors *are* TQ mutations with `retry: 3` and `scope`. | keep TQ; `Effect.runPromise` only inside `queryFn`/`mutationFn` if ever |
| Zustand 5 (`createSendStore` at `send-store.ts:181-192`) | multi-step UI, not an Effect `Ref` | factories stay |
| `Money` / `big.js` (`packages/money/src/money.ts`, 699 LOC) | `Effect/BigDecimal` is a different number type; CLAUDE.md forbids raw arithmetic | never |
| crypto (`@noble/*`, `@agicash/ecies`, Cashu secrets) | sync, must stay boring | `Effect.sync` at most |
| React Router 7.14 loaders/actions + `*.server.ts` (5 files under `apps/web-wallet`) | SSR/Vercel Node; Effect runtime in loaders is extra moving parts for cookie/JWT work | loaders call Promise APIs |
| Supabase JS (`db/client.ts:12-20`, `database.client.ts:11-44`) | RLS + `accessToken` callback + Realtime client. `@effect/sql@0.52.1` is a SQL toolkit, not a PostgREST/RLS client. Do not use it. | wrap `query.abortSignal` as interrupt |
| `@cashu/cashu-ts@3.6.1` and `@agicash/breez-sdk-spark@0.23.0-1` | Promise + WASM + event listeners. Effect cannot see mint protocol errors (`MintOperationError`) unless we `tryPromise` + map | `Effect.tryPromise` at the edge |
| `bun test` (no vitest/jest; `@types/bun` 1.3.11) | `@effect/vitest@0.30.0` **requires vitest ^3.2.0**. Optional. Use `TestClock`/`TestContext` from `effect` itself via `Effect.runPromise` | see §5 |

zod 4.3.6 / `zod/mini` is in **53 non-test files**. Effect `Schema` would duplicate it. `effect@3.22.2` already depends on `@standard-schema/spec`; zod 4 speaks Standard Schema. **Do not replace zod.**

## 5. Constraints and interop design

**Runtime.** One `ManagedRuntime` per `AgicashSdk` instance, constructed in `AgicashSdk` (`sdk.ts:75-189`) next to `AuthService` / `createSessionKeys`. Matches the existing “one instance per process” constraint (`sdk.ts:38-41,191-199`). `dispose()` (`215-221`) calls `runtime.dispose()` so fibers die with the instance. Hosts keep `sdk.auth.signIn(): Promise<void>`. Inside: `this.runtime.runPromise(program)` (confirm `{ signal }` on the 3.22 `Runtime.runPromise` options in the installed `.d.ts` during a spike).

**AbortSignal ↔ Fiber.** Capture `keys.sessionSignal()` (`session-keys.ts:51,269`) at the start of a public method (as `user-api.ts:113` already does). Fork the Effect; `abort` → `Fiber.interrupt`. Do **not** also thread `AbortSignal` into every repository if interruption already cancels `Effect.tryPromise` — but Supabase queries need the signal on the builder (`task-processing-lock-repository.ts:26-28`) because the JS client will not see a fiber interrupt. Dual wiring during migration: signal in *and* interrupt.

**Errors.** Keep `SdkError` subclasses (`lib/error.ts:6-70`) as the `E` channel: `Effect.fail(new DomainError(msg))`. `Effect.runPromise` rejects with that instance, so `instanceof DomainError` at 13 web call sites survives. Do **not** switch to `Data.TaggedError` until those sites are gone: `TaggedError` constructors are `{ message }` objects, not `new DomainError(message)` (`lib/error.ts:17-21`). Adding a `_tag` field on the existing classes is optional and backward compatible.

| Class (`lib/error.ts`) | Host contract | Effect `E` | TQ / retry today |
| --- | --- | --- | --- |
| `SdkError` (abstract, `:6`) | one `instanceof` at the boundary | union of subclasses | — |
| `DomainError` (`:17-21`) | `message` is user-displayable; never retry | `Effect.fail(new DomainError(m))` | `cashu-send-quote-hooks.ts:185-187` returns false |
| `ConcurrencyError` (`:24-31`) | always retry | same instance | `cashu-send-quote-hooks.ts:182-184` returns true |
| `NotFoundError` (`:10-14`) | missing row | same | `transaction-hooks.ts:103-106` no retry |
| `UniqueConstraintError` (`:8`) | insert conflict | same | mapped in repos |
| `NoSessionError` (`:35-39`) | namespace called logged-out | same | throw at API edge (`contacts-api.ts:24-27`) |
| `DisposedError` (`:43-47`) | instance dead | same | `user-api.ts:67-68` never retry |
| `SessionEndedError` (`:57-61`) | in-flight after sign-out/expiry; never retry same op | same | `user-api.ts:130-133,163-165` |
| `NotImplementedError` (`:65-69`) | namespace slice not landed | keep throwing from getters (`sdk.ts:58-69`) | — |

`Data.TaggedError("DomainError")` would also be `instanceof Error`, but **not** `instanceof` the current `DomainError` class unless it *is* that class. Hosts import from `@agicash/wallet-sdk` (`index.ts:14-21`). Constructor arity is part of the contract.

**DI.** Today: constructor injection (`CashuSendQuoteService` at `cashu-send-quote-hooks.ts:48-50`; `createContactsApi(deps)` at `contacts-api.ts:17-20`; `createSendStore(deps)` at `send-store.ts:181-192`; `AgicashSdk` wiring at `sdk.ts:156-188`). `Layer`/`Context.Tag` would compile-check the graph and replace factories. **Do not Layer-ize the web.** If Effect is SDK-internal, `Layer.succeed` around existing class instances is enough; rewriting repositories as `Effect.gen` services is a second project. Zustand factories stay JS.

**zod 4 vs Schema.** 53 files on `zod/mini`. Gift-card config is Node-loadable *because* it only imports zod (`wallet-sdk/package.json` `exports:comments` for `./gift-card-config`). Effect Schema would break that Vite/Node split. Skip Schema.

**Bundle / PWA.** `effect@3.22.2` unpacked **27.2 MB** (CJS+ESM+d.ts). `sideEffects: []` so Vite 7 can tree-shake. Tree-shaken gzip **not measured** (no install). Third-party claim for a typical v3 `Effect`+`Stream`+`Schema` program: ~70 kB; v4 ~20 kB. This app already ships Breez WASM + cashu-ts + supabase-js; 20–80 kB gzip of Effect is small next to WASM **if** Schema/Stream stay out. Importing `Schema` or `@effect/platform` blows that. `@effect/sql` must not ship to the client.

**TypeScript.** Catalog `typescript` 5.9.3. Effect 3 inference (especially `Layer` + `Schema`) is a known `tsc` tax. Dev server already needs 8 GB heap (`apps/web-wallet/package.json:9`). Spike must record `tsc` wall time before/after. Biome 1.9.4 has no Effect knowledge; `@effect/language-service` would be extra.

**Tests.** Runner is `bun test` (`wallet-sdk/package.json:19`, `web-wallet/package.json:12`). `@effect/vitest` is **not required** and **cannot** be used without adding Vitest. `TestClock` / `TestContext` ship in `effect` 3.22.2 (package exports list). Pattern: `Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)))`. Highest payoff: `auth-service.test.ts` (926 lines).

## 6. Cost model, per adoption path

Assumptions (also §10): 1–2 senior TS engineers, **new to Effect**; ~4–6 calendar days to write non-embarrassing `Effect.gen`; review is 1.5–2× a plain-TS PR because readers must learn the idiom; two idioms (Promise + Effect) live until a path completes; **no money-path Effect** until that file has tests. Engineer-week = 5 engineer-days.

LOC bases (all `wc -l` at this commit):

| Path | Files | LOC touched (count) | ew range | confidence |
| --- | ---: | --- | --- | --- |
| A. Utility-first | 4–6: `with-retry.ts`,`delay.ts`,`timeout.ts` (159) + `supabase-realtime-manager.ts` (694) + thin `auth-service` timer adapter | **~850–1,100** | **1–3** | medium |
| B. SDK-internal | high-fit SDK files 3,190 minus realtime-hooks 145 = **3,045**, plus abort plumbing in ~10 repos (~2.5k of mostly-untouched method bodies; estimate **+800** of real edits) | **~3,800–4,500** | **6–14** | low-medium |
| C. B + web realtime + quote-expiry managers | B + manager 694 + melt/mint subscription 152+104+129 | **~4,900–5,500** | **10–18** | low |
| D. C + quote `*-hooks.ts` | +844+720+521+490+545+202 | **~8.5k–9.5k** | **20–40** | low |
| Schema + typed errors only | 53 zod files + 13 `instanceof DomainError` + `lib/error.ts` | **thousands of schema lines, ~0 control-flow gain** | **4–10** and **negative ROI** | medium |

Learning-curve math (assumption, not measured): 4–6 days to write `Effect.gen` that a second senior can review without the author present. That is **1–2 ew** sunk before Path B is faster than the same engineer writing `AbortSignal`. Included in B’s 6–14; **not** included in A’s 1–3 if A only wraps `Schedule` behind existing functions (callers unchanged, review is “does `withRetry` still match its JSDoc at `with-retry.ts:44-57`?”).

Review burden: Path A is reviewable by anyone who reads `with-retry.ts` today. Path B requires the whole team to read Effect or the SDK becomes a two-class codebase (`createMemo` in one file, `SynchronizedRef` in the next). Path D is unreviewable on money PRs.

Two-idiom cost during migration: every `abortSignal?:` repository (10 files under `packages/wallet-sdk/domain/**`) must keep working while fibers exist. Dual wiring (`user-api.ts:113` plus `Fiber.interrupt`) is the tax, not the happy-path `runPromise`. Estimate **+15–25%** elapsed on Path B (folded into 6–14, not extra).

Throughput assumption used for ew ranges: 150–250 touched LOC/week for Effect-new work including tests and review; 400–600 LOC/week for utility wrappers with unchanged signatures. Path D’s 20–40 weeks is 8.5k LOC at the low end of that band plus a 2× money-path review multiplier.

**Dependency risk.** Spike and any 2026 code: **effect 3.22.2**. Do not take `4.0.0-rc.117`: months of RC, API-incompatible, `@effect/platform@0.97.2` and `@effect-atom/atom-react@0.7.0` still peer 3.22.x, unpacked 4.0 tarball is *larger* because it swallowed the ecosystem (48.9 MB vs 27.2 MB) even if tree-shaken apps get smaller. Move to 4.0 **after** a stable release and a written migration of the spike’s import paths — budget **another 1–3 ew** for that alone (confidence low).

**Money-path risk.** Highest in D (hooks call `meltProofsIdempotent` at `cashu-receive-quote-hooks.ts:714-723` and `claim-cashu-token-service.ts:161-171`). Path B touching `claim-cashu-token-service.ts` is still a funds path. Path A (utils + realtime) does not move proofs. Prefer A; if B, land session/auth/keys/flags **before** claim/send services. `cashu-send-quote-service.ts` (568) and `cashu-send-swap-service.ts` (457) have **no dedicated test files**.

## 7. Adoption paths (ranked)

### Path 1 — Utility-first (recommended spike, if any)

**Scope.** Reimplement `withRetry` / `delay` / `setLongTimeout` on Effect **behind the current signatures** (`packages/utils/src/index.ts:7-10`). Then rewrite `SupabaseRealtimeManager.processResubscribeQueue` (`supabase-realtime-manager.ts:452-517`) using `Queue` + `Schedule` + fiber interrupt, public class API unchanged. Optionally drive `auth-service` expiry with `Clock` behind `setExpiryTimer` (`377-388`).

**First slice.** `packages/utils/src/{with-retry,delay,timeout}.ts` (159 LOC). No callers change. Add the tests this package currently lacks.

**Interop.** Zero at the app boundary. `Effect.runPromise` inside the three functions. `signal` → interrupt.

**Sequencing (ordered slices with sizes).**

| # | Slice | Files | LOC (`wc -l`) | ew |
| --- | --- | --- | ---: | --- |
| 1 | Utils behind current signatures | `packages/utils/src/{with-retry,delay,timeout}.ts` + new tests (package has **zero** tests today) | 159 + tests | 0.5–1 |
| 2 | Realtime queue | `supabase-realtime-manager.ts` (public API frozen) | 694 | 1–2 |
| 3 | Optional auth timer only | `setExpiryTimer`/`clearExpiryTimer` in `auth-service.ts:377-414` | ~40 of 512 | 0.5 |

Stop after 1 or 2. Do not continue into session-keys on this path.

**Exit criteria.** `withRetry` abort cancels `fn` (today it does not, `with-retry.ts:66-77`); realtime close during backoff does not deadlock the queue (`393-396`/`481-483`); existing SDK tests green; no `effect` import outside `packages/utils` and the manager file.

**Stop halfway.** After slice 1 the repo is coherent: three functions, one new dep, same signatures. After slice 2 the manager is Effect internally; hooks (`supabase-realtime-hooks.ts`) unchanged.

**Cost.** §6 Path A, 1–3 ew, medium confidence.

**Risks.** Reviewers still need Effect literacy for the manager. Bundle: utils + Schedule + Effect core (keep Schema out).

**Does not solve.** Session-key fencing, Spark wallet leak (`wallet.ts:150-152`), mint `Promise.race` timer (`cashu.ts:182-193`), quote processors, SDK extraction (`sdk.ts:58-69`).

### Path 2 — SDK-internal Effect, Promise APIs for the web (required shape)

**Scope.** `AgicashSdk` owns a `ManagedRuntime`. Convert session/auth/keys/token/flags/wasm/spark-wallet-lifecycle. Public `packages/wallet-sdk/index.ts` stays Promise. Web keeps TQ + Zustand. **Do not convert quote services until they have tests.**

**First slice.** `session-keys.ts` (286) + `supabase-session.ts` (75) = **361 LOC**, plus `session-keys.test.ts` (217) and `supabase-session.test.ts`.

**Interop.** `runPromise` at namespace methods (`createUserApi`, `AuthService` public methods). `AbortSignal` from `sessionSignal()` interrupts the fiber **and** is still passed to Supabase.

**Sequencing (ordered slices with sizes).**

| # | Slice | Files | LOC | ew |
| --- | --- | --- | ---: | --- |
| 1 | Keys + token memo | `session-keys.ts` 286, `supabase-session.ts` 75, tests 217 + supabase-session.test.ts | 361 + tests | 1–2 |
| 2 | Auth + TestClock | `auth-service.ts` 512, `auth-service.test.ts` 926 | 512 + test rewrite | 2–4 |
| 3 | Runtime + WASM + Spark connect | `sdk.ts` 223, `wasm.ts` 21, `wallet.ts` 195 | 439 | 1–2 |
| 4 | Feature flags | `feature-flag-service.ts` 114 + its existing test | 114 | 0.5 |
| 5 | Provision retry | `user-api.ts` 178 | 178 | 0.5–1 |
| 6 | Mint init timeout | `lib/cashu.ts` race at `182-193` | ~20 of 239 | 0.25 |
| 7 | **Stop.** Do not convert quote services. | — | — | — |

**Exit criteria.** `SessionEndedError`/`DisposedError` still `instanceof` (`lib/error.ts:42-61`); no Effect type in `apps/web-wallet`; `sdk.init()` (`sdk.ts:208-212`) still `Promise<void>`; Spark wallets disconnect on `onSessionEnded` (`sdk.ts:117-132`).

**Stop halfway.** After (1)–(3) the SDK is mixed: Effect internals, Promise façade — **this is a valid steady state** and matches how the SDK is already a façade over Open Secret / Supabase / Breez. After (7) quote hooks still call class methods.

**Cost.** §6 Path B, 6–14 ew, low-medium.

**Risks.** Collides with the in-flight `/temporary` extraction (`temporary.ts:1-5`, `index.ts:1-9`). `send` is not even on the SDK yet (`sdk.ts:58-60`). Two migrations on one module graph.

**Does not solve.** Realtime manager (lives in the web app). TQ retry policy. Leader election UX (`task-processing.ts`).

### Path 3 — Path 2 + web realtime/expiry helpers (still no TQ rewrite)

**Scope.** Path 2 plus Path 1’s manager + `melt-quote-subscription.ts` timers. Quote `*-hooks.ts` stay TQ.

**First slice.** Same as Path 1 slice 1, **or** Path 2 slice 1 — do not start both in one PR.

**Sequencing.** Finish Path 1 or 2 to its stop-halfway, then the other. Never merge them in one slice.

**Exit criteria.** Union of Path 1+2. Web app still has no `import from 'effect'` except the realtime manager file.

**Stop halfway.** Either Path 1 or Path 2 completed; the other not started. Coherent.

**Cost.** §6 Path C, 10–18 ew, low.

**Does not solve.** TanStack Query, Zustand, Money, zod, React Router, Cashu protocol.

### Schema + typed errors only

**Not worth it.** 53 `zod/mini` files, working Standard Schema interop, gift-card Node entry that forbids extra imports, and `instanceof DomainError` as a published host contract (`lib/error.ts:1-4`). Zero help for reconnect or session races.

## 8. Case against

The honest no: **this repo’s hard problems are protocol and product, not missing `Schedule`.** Session fencing is already explicit and tested (`session-keys.test.ts` 217, `auth-service.test.ts` 926). The SDK extraction is unfinished (`sdk.ts:58-69`). Quote money machines have no dedicated tests. The team has no Effect readers. Effect 4.0 has been in RC for months with no stable date; adopting 3.22 is buying a second migration. Dev `tsc` is already heap-heavy. `@effect-atom` would torch a working TQ+Zustand design. `@effect/sql` does not speak Supabase RLS.

**Fix the hotspots in plain TS instead:**

| Bug | Fix without Effect |
| --- | --- |
| Mint init timer leak (`cashu.ts:182-193`) | `AbortSignal.timeout(10_000)` + `AbortSignal.any`; clear on settle. ~15 LOC. |
| Realtime queue hang (`supabase-realtime-manager.ts:393-396,481-483`) | store `{ timeoutId, resolve }` and resolve(false) on close; or `AbortSignal`. ~30 LOC. |
| Spark wallet leak (`wallet.ts:150-152`) | `wallet.disconnect()` before `Map.clear()`. Need to confirm Breez API; ~20 LOC. |
| Spark listener cleanup no-op (`spark-receive-quote-hooks.ts:449-457`) | call `console.warn` in the catch. 1 LOC. |
| Claim wait race (`claim-cashu-token-service.ts:263-348`) | `AbortSignal.timeout` + `Promise.withResolvers` + always `removeEventListener`. ~40 LOC. |
| `withRetry` doesn’t cancel `fn` (`with-retry.ts:66-77`) | pass `signal` into `fn`. ~10 LOC. |
| Feature-flag retries after reset (`feature-flag-service.ts:24-40,104-107`) | abort/generation check inside the loop. ~10 LOC. |

None of these require a runtime. `Promise.withResolvers`, `AbortSignal.any`, and `AbortSignal.timeout` are in the runtimes this app uses (browser + Node 24 / Bun 1.3.11). The repo currently uses **none** of them (`git grep` for `withResolvers|AbortSignal.any|AbortSignal.timeout` → 0 hits). A 150-line `Scheduler` for quote expiry would replace `setLongTimeout` without 27 MB of types.

Further against:

- **Concurrent migration.** `packages/wallet-sdk/index.ts:1-9` and `temporary.ts:1-5` describe an in-progress extraction: web still imports repositories from `@agicash/wallet-sdk/temporary`. `send`/`transfer`/`featureFlags`/`taskProcessor` throw (`sdk.ts:58-69`). Adding Effect is a third concurrent rewrite of the same graph.
- **Test holes on money files.** `wc -l` of `domain/send/cashu-send-quote-service.ts` is 568 with no `cashu-send-quote-service.test.ts`. Same for receive quote/swap services. `receive-api.test.ts` exists; it is not a substitute for rewriting those classes in `Effect.gen`.
- **Editor/lint.** Biome 1.9.4 (`package.json` root `devDependencies`) has no Effect plugin. Reviewers read diffs as unfamiliar syntax.
- **Heap.** `apps/web-wallet/package.json:9` already sets `--max-old-space-size=8192` for `tsx watch`. Effect 3 inference is a known `tsc` cost; we did not measure it (no install).
- **Ecosystem mismatch.** `@effect/sql` is the wrong database client. `@effect/vitest` requires Vitest, which this repo does not use. `@effect-atom/atom-react` would replace a patched TanStack Query (`package.json:66-71`). `@effect/platform` duplicates `ky` (`wallet-sdk/package.json` deps).

The “Effect is the missing stdlib” pitch is true in a greenfield Node service. This is a browser PWA + Vercel + WASM + RLS + an unfinished SDK façade. The stdlib it is missing is `AbortSignal.timeout`.

**Evidence that would change this recommendation:** (1) Effect 4.0 **stable**, measured Vite gzip < 30 kB for Schedule+Effect+TestClock, and a migration guide from 3.22; (2) a spike showing `TestClock` deleting ≥400 lines of `auth-service.test.ts` *and* catching a real guest-expiry race the current tests miss; (3) SDK extraction complete (`/temporary` gone, `taskProcessor` implemented in-SDK) so Layer is not a third concurrent migration; (4) dedicated tests for send/receive quote services so an Effect rewrite of those files is falsifiable.

## 9. Recommendation and decision criteria

**Do now (no Effect):** land the plain-TS fixes in §8. They are the actual defects. Continue the wallet-sdk extraction.

**Spike (optional, 1–2 weeks, Path 1 first slice + a throwaway Path 2 prototype of `session-keys.ts`):** only if two seniors are idle *after* extraction work and want a 2027 option. Target effect **3.22.2**. Do not merge Path 2 without the go criteria below.

**Measure in the spike**

1. Vite production client gzip delta (network tab or `vite build` analysis), Schema **not** imported.
2. `bun run typecheck` wall time and peak RSS before/after.
3. `auth-service.test.ts` line count and wall time on `TestClock` vs `setTimeout`.
4. Whether `Runtime.runPromise(effect, { signal })` actually interrupts `Effect.sleep` and `tryPromise` in Bun 1.3.11 and Chrome.
5. Whether `instanceof DomainError` still holds across `runPromise` rejection.
6. Repro + fix of the realtime queue hang, compared LOC-for-LOC with the plain-TS fix.

**Go (continue past a spike)** if all of: gzip delta < 40 kB; `tsc` regression < 20%; TestClock removes real test complexity; `instanceof` contract intact; plain-TS fix of the same bugs is *longer* or *weaker* on interruption; SDK `/temporary` extraction is finished or paused by explicit team decision.

**No-go (default)** if any of: gzip or `tsc` blows the budget; 4.0 stable is “weeks away” and the spike would be throwaway; reviewers cannot review `Effect.gen` without the author in the room; the spike touches a melt/mint function; the queue hang is fixed in 30 lines of TS (then the lesson is “we didn’t need Effect”).

## 10. Assumptions and open questions

**Assumptions (not blocked).** Team size 1–2 seniors, zero Effect production time. 2026 priority is finishing `@agicash/wallet-sdk` extraction, not a new runtime. PWA budget can absorb tens of kB gzip but not Schema. Bun test stays. Supabase JS stays (no `@effect/sql`). Host contract `instanceof SdkError` stays through 2026. `ManagedRuntime` per SDK instance is the right grain (one OS client per process, `sdk.ts:76-84`). Quote-hook `retry:` values are product policy, not missing infrastructure. Leader election stays SQL `take_lead` (`task-processing-lock-repository.ts:21-24`).

**Open questions (genuinely unknown).** Breez `disconnect`/`close` API for `clearSparkWallets` — not verified against `@agicash/breez-sdk-spark` types in this pass. Exact `Runtime.runPromise` options in effect 3.22.2 `.d.ts`. Tree-shaken size in *this* Vite graph. Whether Effect 4.0 stable lands in 2026. Whether the team would accept `@effect/language-service` as a biome/editor add-on.

---

Pain ranked from the code, not from a steer: (1) session/key fencing correctness, (2) realtime reconnect reliability, (3) leaked Spark sessions and mint timeouts, (4) untested money state machines — which Effect would make *more* expensive to change. Effect is a good fit for (1)–(3) *in the abstract* and a bad fit for this repo’s 2026 constraints. Fix the defects; keep the option; do not migrate.
