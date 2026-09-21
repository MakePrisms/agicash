# Effect TS — final assessment (agicash)

Pinned code: `887bdc480b554bd5f3a994002259bcce533ed703` (2026-09-21). This file is the only deliverable. No Effect dependency exists (`git grep '"effect"' -- '**/package.json'` → 0). No code was changed for this document.

**Effect primitive (first use):** `Effect<A, E, R>` is a lazy program that succeeds with `A`, fails with typed `E`, and needs services `R`. Nothing runs until `runPromise` / `runFork`.

## 0. Summary

**Do not adopt Effect as a 2026 stack.** The live defects are cheaper in plain TypeScript. The wallet is mid-extraction of `@agicash/wallet-sdk`: `send` / `transfer` / `featureFlags` / `taskProcessor` throw `NotImplementedError` (`packages/wallet-sdk/domain/sdk/sdk.ts:58-69`). Adding a second async runtime on money paths, while 4.0 is an API-incompatible RC, is the wrong concurrent rewrite.

A 1–2 week spike is **optional**, not required. If it happens: **effect 3.22.2** only; Path 1 slice 1 (utils behind current signatures + the tests `packages/utils` lacks); plus a throwaway TestClock prototype of `setExpiryTimer`. Do **not** attach the realtime manager to “utility-first.” Do **not** merge Path 2. Do **not** touch quote hooks, Zustand, or `@effect-atom/atom-react`.

| Number | Value | Confidence |
| --- | --- | --- |
| Grep-accounted hotspot table | **3,190** LOC / 15 files (command in §2) | high (`wc -l`) |
| Sequenced SDK migration surface (no claim, no web) | **1,624** prod + **1,406** existing tests | high (`wc -l`) |
| Defect-fix surface (plain TS, §8) | **~200** LOC across 8 sites | high |
| Cost if you adopt | utils-only **0.5–1.5 ew**; SDK-internal **8–16 ew**; hooks too **20–50 ew** | high / low-medium / low |
| First slice | **159** LOC (`packages/utils/src/{with-retry,delay,timeout}.ts`) | high |

Pain ranked from this code (no product steer): (1) session / key / token / CAT fencing, (2) realtime queue hang (`closeChannel` **and** `removeChannel`), (3) leaked Spark sessions + mint `Promise.race` timer + listener cleanup no-op, (4) untested money state machines, (5) three retry implementations.

Top 3 risks of adopting: (1) money-path regressions while two async idioms coexist — `withRetry` already sits on a mint-quote path (`apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts:460-466`); (2) Effect 3.22 → 4.0 rewrite (`4.0.0-rc.117` published 2026-09-21; first RC `4.0.0-rc.108` 2026-08-12; 4.0 betas from July 2026); (3) `tsc` / Vite memory — `apps/web-wallet/package.json:9` already sets `--max-old-space-size=8192`.

## 1. Method

Read: `CLAUDE.md`, `docs/architecture.md`, `docs/guidelines.md`, `packages/wallet-sdk/index.ts`, `packages/wallet-sdk/lib/error.ts`, `apps/web-wallet/app/lib/error.ts`, SDK `domain/sdk/{sdk,session-keys,events,task-processor,user-provisioner}.ts`, `domain/user/{auth-service,user-api,user-repository,user-service}.ts`, `db/supabase-session.ts`, `db/client.ts`, `lib/spark/{wallet,wasm}.ts`, `lib/cashu.ts`, `lib/agicash-mint-auth-provider.ts`, `domain/feature-flags/feature-flag-service.ts`, `domain/receive/claim-cashu-token-service.ts`, `domain/send/proof-state-subscription-manager.ts`, quote services/repos, `apps/web-wallet/app/lib/supabase/*`, quote `*-hooks.ts`, `features/receive/receive-cashu-token-hooks.ts`, `features/user/auth.ts`, `features/wallet/task-processing.ts`, `features/shared/{query-client,sdk.client,feature-flags}.ts`, `entry.client.tsx`, `entry.server.tsx`, `packages/utils/src/{with-retry,delay,timeout,index}.ts`, catalog versions.

Ran (cwd `/work`; code tree identical to pin `887bdc48`; HEAD only adds research docs):

```
git log --format='%H %s' -3
# 887bdc480b554bd5f3a994002259bcce533ed703 is the code pin
# the two later commits only add files under docs/research/effect-ts/

find apps/web-wallet/app -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' ! -name '*.test.tsx' | wc -l
# → 293; same find -exec cat | wc -l → 27235

find packages/wallet-sdk -type f -name '*.ts' ! -name '*.test.ts' ! -path '*/node_modules/*' | wc -l
# → 119; -exec cat | wc -l → 18192 (includes db/supabase/database.types.ts = 1971)

# small-lib non-test LOC (same find): bolt11 183, cashu 1292, ecies 265, lnurl 259, money 810, utils 300 = 3109
# packages/money/src/money.ts alone: 699

find apps/web-wallet/app packages/wallet-sdk packages/utils -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/node_modules/*' -print0 \
  | xargs -0 grep -lE 'AbortController|AbortSignal|setTimeout\(|Promise\.race|Promise\.all|Promise\.allSettled|retry|withTimeout|backoff|new Promise\(' | wc -l
# → 59  (.ts/.tsx only; buyer command)

git grep -l -E 'AbortController|AbortSignal|setTimeout\(|Promise\.race|Promise\.all|Promise\.allSettled|retry|withTimeout|backoff|new Promise\(' \
  -- 'apps/web-wallet/app' 'packages/wallet-sdk' 'packages/utils' | grep -v '\.test\.' | wc -l
# → 60  (includes packages/wallet-sdk/db/supabase/migrations/20260425181643_tighten_spark_send_payment_hash_uniqueness.sql:5)

git grep -l "from 'zod/mini'" -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l   # → 53
git grep -l 'instanceof DomainError' -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l  # → 13 files
git grep -n 'instanceof DomainError' -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l  # → 19 sites
# web: 18 sites / 12 files; SDK: claim-cashu-token-service.ts:62

git grep -l 'abortSignal' -- 'packages/wallet-sdk/domain/**/*repository*.ts' | grep -v test
# → 13 files

git grep -n 'withResolvers\|AbortSignal.any\|AbortSignal.timeout' -- '*.ts' '*.tsx' | grep -v node_modules
# → 0

find . -name '*.test.ts' -o -name '*.test.tsx' | grep -v node_modules | wc -l  # → 31
# web 4 + sdk 19 + money/cashu/ecies/bolt11 8; utils 0

find apps/web-wallet/app -type f \( -name '*-hooks.ts' -o -name '*-store.ts' \) | wc -l  # → 23
find packages/wallet-sdk/domain -name '*-service.ts' ! -name '*.test.ts' | wc -l         # → 16
find packages/wallet-sdk/domain -name '*-repository.ts' ! -name '*.test.ts' | wc -l      # → 11
```

npm registry (GET `https://registry.npmjs.org/<pkg>/[version]`, 2026-09-21). Unpkg `.d.ts` for APIs used in §3/§5: `SynchronizedRef`, `Runtime`, `ManagedRuntime`, `TestContext`.

| Package | Version | Registry `time` / notes | unpackedSize | fileCount | peers |
| --- | --- | ---: | ---: | ---: | --- |
| effect | 3.22.2 (latest) | 2026-09-09; `sideEffects: []`; deps `fast-check`, `@standard-schema/spec` | 27,163,958 | 2715 | — |
| effect | 4.0.0-rc.117 | 2026-09-21; unified exports (`./unstable/sql`, …) | 48,953,868 | 2546 | — |
| effect | 4.0.0-rc.108 | first `4.0.0-rc.*`; GitHub tag 2026-08-12T13:57:38Z | 44,672,149 | 2258 | — |
| @effect/platform | 0.97.2 | 2026-09-09 | — | — | `effect ^3.22.2` |
| @effect/sql | 0.52.1 | tarball 2026-07-30; registry updated 2026-09-18 | 734,828 | 130 | `effect ^3.22.1`, `@effect/platform ^0.97.1`, **`@effect/experimental ^0.61.1`** |
| @effect-atom/atom-react | 0.7.0 | 2026-08-14 | 96,490 | 43 | `effect ^3.22.1`, `react >=18 <20` |
| @effect/vitest | 0.30.0 | 2026-07-13 | 134,264 | 27 | `effect ^3.22.0`, `vitest ^3.2.0` |

4.0 pre-release: betas from July 2026 (`4.0.0-beta.94` 2026-07-07 on releasealert.dev); RC for **~5 weeks** as of 2026-09-21, not “months of RC.” Directionally a second migration; do not take the RC. `@effect/platform@0.97.2` and `@effect-atom/atom-react@0.7.0` still peer 3.22.x.

Verified against unpkg `effect@3.22.2` `.d.ts` (no in-tree install): `Runtime.runPromise(..., { signal?: AbortSignal })` (`Runtime.d.ts`); `ManagedRuntime.runPromise` same options + `dispose(): Promise<void>`; `SynchronizedRef.updateEffect` → `Effect<void>`; `SynchronizedRef.modifyEffect` → value; `TestContext.TestContext` is a `Layer`; package exports include `./Micro`, `./TestClock`, `./TestContext`, `./ManagedRuntime`.

Could not verify (no `effect` install; no Vite build with it): tree-shaken Vite/PWA gzip; `tsc` wall time / RSS; whether `runPromise({ signal })` interrupts `tryPromise` of a Supabase builder at runtime in Bun 1.3.11 / Chrome; Breez `disconnect`/`close` (no `@agicash/breez-sdk-spark` typings in this workspace). Effect 4 “typical program 70kB → 20kB” is a third-party claim, not measured here.

`CLAUDE.md` is stale on two points: `packages/wallet-sdk` is 18,192 LOC, not an empty placeholder; error classes live in `packages/wallet-sdk/lib/error.ts:6-70`, not `apps/web-wallet/app/features/shared/error.ts` (that file does not exist). `apps/web-wallet/app/lib/error.ts:1-14` is only `getErrorMessage`.

## 2. Inventory of async and control-flow concerns

Grep undercounts leader election, WASM init, quote-expiry timers, session expiry, Spark connect memo, feature-flag / CAT generation fencing. Those are included. `retry` hits TanStack `retry:` and comments in `packages/wallet-sdk/lib/error.ts:4,53` — those files are listed only when they also have real control flow.

Two numbers, not one:

| Number | What it is | Command / sum |
| --- | --- | --- |
| **3,190** | Grep-accounted table below (15 files). Includes low-fit React hook (145), WASM memo (21), and a money file Path B will not convert (349). | `wc -l` of the 15 paths; 81+30+48+694+512+286+75+114+349+195+21+178+239+223+145 = 3190 |
| **1,624** | Sequenced SDK-internal Path B production (no claim, no web realtime, no utils) | 286+75+512+223+21+195+114+178 + ~20 of `lib/cashu.ts` |
| **2,192** | SDK rows inside 3,190 (3190 − 694 − 145 − 159) | includes claim + full `cashu.ts` |
| **~200** | Plain-TS defect fixes in §8 | estimated from the eight sites |

| path | LOC | concern(s) | current mechanism | defect risk | Effect fit |
| --- | ---: | --- | --- | --- | --- |
| `packages/utils/src/with-retry.ts` | 81 | retry, backoff, cancel | loop + `delay`; `retry` number or predicate | no tests in `packages/utils`; abort only cancels the delay, not `fn()` (`with-retry.ts:66-77`; JSDoc `:33,:56` admits “cancel pending retry delays”) | **high** |
| `packages/utils/src/delay.ts` | 30 | timeout, cancel | `new Promise` + `setTimeout` + abort listener | abort after fire is fine (`delay.ts:25-28`); no `AbortSignal.any` | **high** |
| `packages/utils/src/timeout.ts` | 48 | long timeout | chunked `setTimeout` past 2^31-1 | no abort API (`timeout.ts:17-37`); callers must `clearLongTimeout` | **high** |
| `packages/wallet-sdk/domain/user/auth-service.ts` | 512 | session expiry, cancel, resource | `AbortController` scope (`:86,372-375`); `setLongTimeout` (`:386-388`); guest re-sign-in on expiry (`:427-511`) | residual race documented (`:416-426`); timer/storage interleaving on guest extend | **high** |
| `packages/wallet-sdk/domain/sdk/session-keys.ts` | 286 | cancel, memo, resource | per-session `AbortController` (`:144`); `createMemo` (`:89-135`); composite fence (`:207-217`) | success-only cache; aborted `inFlight` kept (`:125-128`); `Encryption` facade re-checks (`:224-261`) | **high** |
| `packages/wallet-sdk/db/supabase-session.ts` | 75 | memo, generation fence | `generation` (`:32-41,56-68`); single-flight token | late exchange still *returns* the old token (`:64`) even if it does not cache | **high** |
| `packages/wallet-sdk/lib/agicash-mint-auth-provider.ts` | 87 | memo, generation fence | third fence (`:15,29-36,83-86`); single-flight CAT (`:43-55`); cleared from `sdk.ts:125` | same late-return as session token (`fetchCAT` `:28-36` always `return token`) | **high** |
| `packages/wallet-sdk/domain/sdk/sdk.ts` | 223 | lifecycle, WASM, dispose | `Promise.all([restoreSession, ensureBreezWasm])` (`:208-212`); process-global instance (`:42,191-199`); `dispose` (`:215-221`) | second instance throws (`:193-196`); HMR relies on `apps/web-wallet/app/features/shared/sdk.client.ts:78-82` | **high** |
| `packages/wallet-sdk/lib/spark/wasm.ts` | 21 | resource, single-flight | cached init promise (`:15-20`) | correct; `Scope` would not shorten | **medium** (not in 1,624 sequenced surface) |
| `packages/wallet-sdk/lib/spark/wallet.ts` | 195 | resource, memo | `Map` of connect promises (`:99-144`); `clearSparkWallets` only `.clear()` (`:150-152`) | **no teardown on sign-out** — Map dropped without disconnect (Breez API unverified here) | **high** |
| `packages/wallet-sdk/lib/cashu.ts` | 239 | timeout, race | `Promise.race` vs 10s timer (`:182-193`) | **timer not cleared**; loser reject after winner is an unhandled-rejection risk (`:189-192`) | **high** |
| `packages/wallet-sdk/domain/feature-flags/feature-flag-service.ts` | 114 | retry, generation | hand-rolled backoff (`:24-40`); `generation` (`:47,104-107`) | retries run to completion after `resetFeatureFlags` (`:83-88`); generation blocks *apply*, not the loop | **high** |
| `packages/wallet-sdk/domain/user/user-api.ts` | 178 | retry, cancel, error map | `withRetry` around key derive + upsert (`:122-168`); skip `SessionEndedError`/`DisposedError`/`$ZodError` (`:67-68,130-167`) | abort checked *after* `Promise.all` (`:136-138`) — keys may finish for a dead session | **high** |
| `packages/wallet-sdk/domain/sdk/user-provisioner.ts` | 53 | error map, fingerprint | in-memory fingerprint (`:31-34`); swallow lifecycle errors (`:40-45`) | fingerprint set post-await (`:36-38`); late emit after `reset` is real | **medium** |
| `packages/wallet-sdk/domain/receive/claim-cashu-token-service.ts` | 349 | timeout, race, error map, background | `instanceof DomainError` (`:62-67`); Spark wait via listener + 10s timer (`:263-348`) | **double-fire window** (`:293` then `:298`); `meltProofsIdempotent` `{ type: 'random' }` (`:161-171`) | **high** defect / **do not migrate** |
| `packages/wallet-sdk/domain/wallet/task-processing-lock-repository.ts` | 40 | leader election | `rpc('take_lead')` (`:21-38`) | abort optional (`:26-28`); lock TTL is SQL-side | **medium** |
| `packages/wallet-sdk/domain/sdk/task-processor.ts` | 21 | lifecycle (API only) | unimplemented on SDK (`sdk.ts:67-69`) | web still owns the processor (`task-processing.ts:75-83`) | **medium** (future) |
| `packages/wallet-sdk/domain/sdk/events.ts` | 168 | pubsub | sync `Map`/`Set` + replay-latest (`:95-157`) | handler throw is logged (`:129-133`); not an Effect problem | **low** |
| `packages/wallet-sdk/domain/contacts/contacts-api.ts` | 89 | cancel | `requireLiveSignal` (`:30-36`) + post-await abort (`:42-44`) | same “result unused” contract as session-keys | **medium** |
| `packages/wallet-sdk/domain/contacts/contact-repository.ts` | 170 | cancel | `abortSignal` on every query (`:21-147`) | plumbing; Effect would be `Effect.interruptWhen` | **medium** |
| `packages/wallet-sdk/domain/user/user-repository.ts` | 380 | cancel, resource | `abortSignal`; `Promise.all` `toAccount` (`:201-203`); Spark wallet init (`:305-307`, call at `:290-291`, no `abortSignal`) | wallet init races session end | **medium** |
| `packages/wallet-sdk/domain/user/user-service.ts` | 81 | cancel | forwards `abortSignal` (`:45,78`) | plumbing | **low** |
| `packages/wallet-sdk/domain/accounts/account-repository.ts` | 280 | cancel, resource | `abortSignal`; `Promise.all` wallet+proofs (`:187`) | same | **medium** |
| `packages/wallet-sdk/domain/accounts/account-service.ts` | 58 | cancel | optional `abortSignal` (`:34`) | none | **low** |
| `packages/wallet-sdk/domain/transactions/transaction-repository.ts` | 204 | cancel | `abortSignal`; `Promise.all(toTransaction)` (`:84`) — decrypt is inside `toTransaction` | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-quote-repository.ts` | 473 | cancel | `abortSignal`; parallel encrypt (`:63`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-quote-repository.server.ts` | 119 | cancel | `abortSignal` (`:34`); server cannot decrypt (`:38-40`) | Effect unused | **low** |
| `packages/wallet-sdk/domain/receive/spark-receive-quote-repository.server.ts` | 115 | cancel | `abortSignal` sibling of the listed server receive-quote repo | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-swap-repository.ts` | 339 | cancel | `abortSignal`; `Promise.all` (`:130,205,307`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/spark-receive-quote-repository.ts` | 336 | cancel | `abortSignal`; `Promise.all` (`:290`) | plumbing | **low** |
| `packages/wallet-sdk/domain/send/cashu-send-quote-repository.ts` | 501 | cancel | `abortSignal`; parallel encrypt (`:147`) | plumbing | **low** |
| `packages/wallet-sdk/domain/send/cashu-send-swap-repository.ts` | 385 | cancel | `abortSignal`; `Promise.all` (`:281`) | plumbing | **low** |
| `packages/wallet-sdk/domain/send/spark-send-quote-repository.ts` | 339 | cancel | `abortSignal`; `Promise.all` (`:309`) | plumbing | **low** |
| `packages/wallet-sdk/domain/receive/cashu-receive-quote-service.ts` | 361 | error map, money SM | class + mint/melt; `abortSignal` on create (`:61`) | **no dedicated test file** | **low** (money; do not touch) |
| `packages/wallet-sdk/domain/receive/cashu-receive-swap-service.ts` | 253 | money SM | `abortSignal` (`:54`) | same | **low** |
| `packages/wallet-sdk/domain/receive/spark-receive-quote-service.ts` | 192 | money SM | `abortSignal` (`:33`) | same | **low** |
| `packages/wallet-sdk/domain/send/cashu-send-quote-service.ts` | 568 | money SM | constructor-injected repo | **no dedicated test file**; melt/proofs | **negative** until tests exist |
| `packages/wallet-sdk/domain/send/cashu-send-swap-service.ts` | 457 | money SM | ctor(repo, receiveSwapService) (`:36-39`) | same | **negative** |
| `packages/wallet-sdk/domain/send/spark-send-quote-service.ts` | 380 | money SM | Spark pay | same | **negative** |
| `packages/wallet-sdk/domain/send/proof-state-subscription-manager.ts` | 147 | WS resource | overlapping-subscribe / drop-callback (`:39-50`) | same shape as mint/melt managers; SDK-side, money-adjacent | **medium** |
| `packages/wallet-sdk/domain/receive/lightning-address-service.ts` | 371 | error map | `instanceof NotFoundError` (`:286`); zod/mini | server LNURL; Effect HTTP would fight `ky` | **low** |
| `packages/wallet-sdk/domain/exchange-rate/exchange-rate-service.ts` | 99 | cancel, fallback | sequential providers + `signal` (`:48-73`) | abort message vs failure (`:70-73`) | **medium** |
| `packages/wallet-sdk/lib/error.ts` | 70 | error map | `SdkError` tree (`:6-70`); `instanceof` is the host contract (`:1-4`) | `Data.TaggedError` breaks 19 `instanceof DomainError` sites unless constructors stay | **low** (keep classes) |
| `apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts` | 694 | reconnect, backoff, queue, lifecycle | serial resubscribe queue (`:97-103,306-327,452-517`); delay table (`:99-101`); online/active gates (`:109-111,334-373`) | **`clearTimeout` without resolving the parked Promise in `closeChannel` (`:393-396`) and `removeChannel` (`:230-232`) vs worker (`:481-483`) → `isProcessingResubscribeQueue` can stick true (`:456,512`)** | **high** |
| `apps/web-wallet/app/lib/supabase/supabase-realtime-hooks.ts` | 145 | subscribe, errors | React + `useSyncExternalStore`; online/active wiring (`:127-133`) | wraps manager; rewriting the hook is low-fit | **low** |
| `apps/web-wallet/app/features/user/auth.ts` | 380 | session choke | `invalidateAuthQueries` `Promise.all` + key eviction (`:128-140`) | pair of SDK fencing; host-side | **medium** |
| `apps/web-wallet/app/features/wallet/task-processing.ts` | 83 | leader election, background loop | TQ `refetchInterval: 5000` (`:33-41`); `TaskProcessor` mounts 6 hook processors (`:75-83`) | errors only `console.warn` (`:43-51`); not in SDK | **medium** |
| `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` | 844 | polling, WS, retry, quote expiry, background | TQ poll 10s/60s on 429 (`:384-421`); WS `retry: 5` (`:440-443`); `withRetry` + `setLongTimeout` expiry (`:460-502`); mutations `retry: 3` (`:611-676`) | mint-quote poll `retry: false` swallows errors (`:397-403`); Effect vs TQ is a fight | **low** (TQ is the scheduler) |
| `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` | 720 | listeners, expiry, background | per-account Breez listener (`:364-460`); expires on Breez `synced` (`:419-424`, not `setLongTimeout`); mutations `retry: 3` | **cleanup `.catch` wraps warn in a no-op arrow (`:449-457`) — warn never runs**; listeners can leak | **medium** (bug is ~8 lines of TS) |
| `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts` | 521 | retry policy, melt WS, background | `instanceof DomainError`/`ConcurrencyError` (`:135-189`); melt subscription (`:280-444`) | TQ retry *is* the policy | **low** |
| `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` | 490 | retry, WS | same pattern (`:185-189,346`) | same | **low** |
| `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` | 545 | retry, error map | `instanceof DomainError` (`:337,387,453`) | same | **low** |
| `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` | 202 | background | mutations `retry: 3` / `0` (`:178,199`) | TQ | **low** |
| `apps/web-wallet/app/features/receive/receive-cashu-token-hooks.ts` | 392 | retry, money | TQ + `instanceof DomainError` (`:299`); services from `/temporary` (`:9-16`) | omitted from the 59-file “highest match” list; 4 grep hits | **low** |
| `apps/web-wallet/app/lib/cashu/melt-quote-subscription.ts` | 152 | WS, quote expiry | mutation `retry: 5` (`:96-99`); `setLongTimeout` (`:134-149`) | expiry check is a protocol gap | **medium** |
| `apps/web-wallet/app/lib/cashu/mint-quote-subscription-manager.ts` | 104 | WS resource | promise-held unsubscribe (`:5-8,72-79`) | overlapping subscribe can drop the old callback (`:35-50`) | **medium** |
| `apps/web-wallet/app/lib/cashu/melt-quote-subscription-manager.ts` | 129 | WS resource | same shape | same | **medium** |
| `apps/web-wallet/app/features/transactions/transaction-hooks.ts` | 298 | retry, error map | `instanceof NotFoundError` (`:103-106`); infinite query | TQ | **low** |
| `apps/web-wallet/app/hooks/use-exchange-rate.ts` | 89 | polling, cancel | TQ `signal` into `getRates` (`:37-41`); `refetchInterval: 15_000` (`:71,78`) | already abortable; third TQ interval (low-fit) | **low** |
| `apps/web-wallet/app/features/shared/query-client.ts` | 23 | retry defaults | `new QueryClient()` with **no** defaults (`:5-6`) | TQ default query retry=3, mutation retry=0; every hook re-specifies | **negative** |
| `apps/web-wallet/app/features/send/send-store.ts` | 414 | UI SM, error map | `createSendStore(deps)` (`:181-192`); `instanceof DomainError` (`:399`) | Zustand factory | **negative** |
| `apps/web-wallet/app/features/email/welcome-email-service.ts` | 66 | retry | `ky` retry (`:48-50`) | already a library | **negative** |
| `apps/web-wallet/app/entry.server.tsx` | 112 | SSR timeout | `streamTimeout` const (`:17`); `setTimeout(abort, …)` (`:100`) | React Router, not Effect | **negative** |
| UI timers (`use-toast.ts`, `use-animation.ts`, `use-throttle.ts`, homepage, PWA banner, `view-transition.tsx`) | n/a | timeout | `setTimeout` | cosmetic | **negative** |

### Pain ranked from this inventory

1. **Session / key / token / CAT fencing (correctness).** `auth-service.ts` + `session-keys.ts` + `supabase-session.ts` + `agicash-mint-auth-provider.ts` + `abortSignal` fan-out through 13 repositories. A bug here encrypts or decrypts as the wrong user, or applies a stale session after sign-out. Already heavily commented and tested (`auth-service.test.ts` 926 + `session-keys.test.ts` 217 + `supabase-session.test.ts` 141). The code is *aware* of the races (`auth-service.ts:416-426`) rather than missing a library. Three generation fences and growing.
2. **Realtime reconnect (reliability).** 694-line manager written because “Supabase client handles errors and reconnects very poorly” (`supabase-realtime-manager.ts:64-72`). Serial queue is a workaround for a shared socket (`:87-91`). The `clearTimeout` hang is a real defect in **two** paths: `closeChannel` (`:393-396`) and `removeChannel` (`:230-232`) vs the parked delay (`:481-483`). Online/active gating is in the React hook (`supabase-realtime-hooks.ts:127-133`). Going offline is `setOnlineStatus(false)` at `:131` and does **not** call `closeChannel`. `:617` is subscribe ERROR/TIMEOUT *while already* offline/inactive.
3. **Resource leaks and timeouts (ops).** `clearSparkWallets` does not disconnect (`wallet.ts:150-152`); mint init `Promise.race` timer is never cleared (`cashu.ts:182-193`); Spark listener cleanup is a no-op (`spark-receive-quote-hooks.ts:449-457`).
4. **Background money machines (product).** Six processors mounted only on the leader (`task-processing.ts:75-83`) using TQ mutations, mint/melt websockets, and `setLongTimeout` expiry. This is where proofs move (`cashu-receive-quote-hooks.ts:714-723`). Effect does **not** rank here: TQ *is* the scheduler, and the send/receive quote services lack dedicated tests (`ls packages/wallet-sdk/domain/{send,receive}/*test*` → `receive-api.test.ts`, `find-matching-offer-or-gift-card-account.test.ts` only).
5. **Hand-rolled retry (hygiene).** `with-retry.ts` (no tests), a second copy in `feature-flag-service.ts:24-40`, a third in `ky` (`welcome-email-service.ts:48-50`), plus per-hook `retry:` callbacks. Unifying these is the cheapest Effect-shaped win and also the cheapest plain-TS win.

Grep undercount, verified: leader election is `take_lead` RPC + TQ interval, not `AbortController` (`task-processing.ts:33-41`, `task-processing-lock-repository.ts:21-24`). WASM init is a memoized promise (`wasm.ts:15-20`). Quote expiry is `setLongTimeout` (`melt-quote-subscription.ts:134-149`, `cashu-receive-quote-hooks.ts:486-495`) plus Spark `synced` (`spark-receive-quote-hooks.ts:419-424`). Session expiry is `setLongTimeout` on JWT `exp - 5s` (`auth-service.ts:377-388,396-407`). Spark connect is a process-wide `Map` (`wallet.ts:99-144`). Feature-flag generation is a module counter (`feature-flag-service.ts:47,104-107`). CAT generation is a module counter (`agicash-mint-auth-provider.ts:15,83-86`). `taskProcessor` on the SDK is a stub (`sdk.ts:67-69`). `featureFlags` on the SDK also throws (`sdk.ts:64-65`), but flags already run: `entry.client.tsx:49` calls `configureFeatureFlags`; `features/shared/feature-flags.ts:4-5,22` calls `refreshFeatureFlags` / `getFeatureFlag`. That throw is extraction theater, not missing product.

### What “retry” in the 59-file grep is not

TanStack `retry:` / `retry: 3` in quote hooks is **policy**, already expressed (`cashu-send-quote-hooks.ts:181-189`: never retry `DomainError`, always retry `ConcurrencyError`). `packages/wallet-sdk/lib/error.ts:4,53` matches the word “retry” in comments only. `Promise.all` over mapping batches (e.g. `transaction-repository.ts:84`) is parallelism, not control-flow pain. The 60th `git grep` hit is SQL comment text. Those rows stay so the grep is fully accounted for; their Effect fit is low/negative.

## 3. Where Effect helps

**Primitives used below.** `Schedule` = composable retry/repeat policy. `Effect.timeout` = fail/interrupt after a duration. `Effect.race` = first winner, interrupt losers. **Fiber** = lightweight green thread; interruption is the cancellation model. `Scope` / `acquireRelease` = bracket: acquire a resource, release on success, failure, or interrupt. `Layer` / `Context.Tag` = typed DI graph. `Queue` / `PubSub` / `Stream` = in-process async pipelines. `Ref` / `SynchronizedRef` = shared state (`SynchronizedRef` serializes updates). `Deferred` = one-shot latch. `Clock.sleep` = interruptible delay. `TestClock` = virtual clock. `ManagedRuntime` = constructed runtime you `dispose`. `Schema` = Effect’s decoder (not recommended; see §4/§7).

Sketches below were checked against unpkg `effect@3.22.2` `.d.ts` for the APIs they name. There is no in-tree install; they were not typechecked by `tsc`. `Effect.async` cleanup / `Deferred.unsafeDone` signatures were **not** re-read beyond common 3.22 usage — a spike must open the installed `.d.ts`.

### 3.1 Session keys — abort-fenced memo (`session-keys.ts`)

**Current** — success-only memo (`:123-127`); session `AbortController` (`:144`); composite fence (`:207-217`); facade repeats the check (`:224-261`). Callers share one `inFlight` promise (`:113-132`). A rejection is not cached; an aborted `inFlight` is kept until `reset()` → `clearMemos` (`:125-128,270-278`). `sessionSignal` impl is `:269` (JSDoc at `:51`).

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

**Effect 3.22** (`SynchronizedRef.modifyEffect` returns the value — `updateEffect` returns `Effect<void>` and must not be used here. APIs checked: `modifyEffect` on unpkg `SynchronizedRef.d.ts`. Per-key `SynchronizedRef` serializes fetch, which is equivalent to sharing one `inFlight` for that key. Live `AbortSignal` / `disposed` checks. Failed `fetch` does not write `Cached` — same as today’s success-only cache.)

```ts
const live = (disposed: () => boolean, signal: AbortSignal) =>
  disposed() ? Effect.fail(new DisposedError())
  : signal.aborted ? Effect.fail(new SessionEndedError())
  : Effect.void

const getOrFetch = <A, E>(
  memo: SynchronizedRef.SynchronizedRef<Option.Option<A>>,
  fetch: Effect.Effect<A, E>,
  disposed: () => boolean,
  signal: AbortSignal,
): Effect.Effect<A, E | SessionEndedError | DisposedError> =>
  SynchronizedRef.modifyEffect(memo, (state) =>
    Effect.gen(function* () {
      yield* live(disposed, signal)
      if (Option.isSome(state)) {
        return [state.value, state] as const
      }
      const value = yield* fetch
      yield* live(disposed, signal)
      return [value, Option.some(value)] as const
    }),
  )

const getEncryption = Effect.gen(function* () {
  const pair = yield* Effect.all([priv, pub], { concurrency: 2 })
  yield* live(disposed, signal)
  return pair
})
```

Host getters stay Promise-shaped (`session-keys.ts:29-31`): `runtime.runPromise(getOrFetch(...), { signal })`. `{ signal }` is in the 3.22 `Runtime` / `ManagedRuntime` `.d.ts`. `Option.isSome` checked on unpkg `Option.d.ts`. `Effect.gen` / `Effect.all` / `Effect.fail` / `Effect.void` were not opened on `Effect.d.ts` this pass (core 3.22; spike must compile the sketch).

**Not shorter:** uncached rejection and the facade re-check (`:224-261`) are still rules. **Not clearer** at the public surface. The value of Effect here is interrupt + one implementation of the three generation fences (`supabase-session.ts:32-41`, `feature-flag-service.ts:47,104-107`, `agicash-mint-auth-provider.ts:15,83-86`), not fewer lines in this file.

### 3.2 Auth session expiry (`auth-service.ts`)

**Current** — scope swap + long timer + guest extend. `teardown` aborts the scope and permanently stops the timer (`:284-288`). `setExpiryTimer` awaits remaining ms then assigns synchronously so two overlapping calls cannot orphan a timer (`:377-388`).

```372:389:packages/wallet-sdk/domain/user/auth-service.ts
  private startNewSessionScope(): void {
    this.sessionScope.abort();
    this.sessionScope = new AbortController();
  }

  private async setExpiryTimer(): Promise<void> {
    const remaining = await this.getRemainingSessionTimeMs();
    this.clearExpiryTimer();
    if (this.disposed || remaining === null) {
      return;
    }
    this.expiryTimeout = setLongTimeout(() => {
      this.handleSessionExpiry();
    }, remaining);
  }
```

The 5s early-expiry margin is a **clock offset** on the JWT (`:396-407`: `(decoded.exp - 5) * 1000 - Date.now()`), not a timeout combinator. Guest persist-or-undo (`:202-221`) must stay uninterruptible in *either* idiom or you strand a guest account. Residual race is documented (`:416-426`). Tests: `auth-service.test.ts` is **926** LOC of `await new Promise((r) => setTimeout(r, 0|10|200))`.

**Effect sketch:** `Clock.sleep(remaining)` on a session `Scope`; `teardown` interrupts the scope. Guest extend is `Effect.gen` with `Effect.uninterruptible` around `:202-221`. `TestClock` (export `effect/TestClock`) + `TestContext.TestContext` (a `Layer`, `TestContext.d.ts`) advances 30 days without `setLongTimeout`. Pattern: `Effect.runPromise(program.pipe(Effect.provide(TestContext.TestContext)))`.

**Not shorter:** the guest-vs-full / teardown-vs-sign-out / “don’t sign out an HMR successor” matrix is domain. Effect does not delete `:416-426`. **Clearer:** the happy-path timer becomes unit-testable without fake `setTimeout`. That is the one place Effect would likely *reduce* test LOC — and the only quantitative win that would change a no-go (§9).

### 3.3 Realtime resubscribe queue (`supabase-realtime-manager.ts`)

**Current** — serial *topic* queue because parallel resubscribes were suspected to saturate the shared Phoenix socket (`:87-91`). Delay table is data (`:99-101`). Loop: for attempt `1..9`, sleep `delays[attempt-1]`, then **one** `resubscribeToChannel`, break if subscribed or channel gone (`:461-496`). `closeChannel` and `removeChannel` cancel the timer **without resolving the Promise the worker is awaiting**.

```230:232:apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts
    if (state.retryTimeout) {
      clearTimeout(state.retryTimeout);
    }
```

```393:396:apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts
    if (state.retryTimeout) {
      clearTimeout(state.retryTimeout);
    }
```

```481:483:apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts
      await new Promise((resolve) => {
        state.retryTimeout = setTimeout(resolve, delay);
      });
```

If a subscriber unmounts (`removeChannel`) or `closeChannel` runs (`:617` — already-offline subscribe failure, not the offline handler) while that `await` is parked, `isProcessingResubscribeQueue` stays `true` (`:456,512`) and the queue never drains.

**Effect 3.22** (`Queue` = mailbox; Fiber interrupt cancels `Clock.sleep`). A `Queue.take` + `Effect.forever` worker is `runFork`, not `runPromise`. It needs a **persistent `ManagedRuntime`** owned by the manager (or the app bootstrap next to `agicashRealtimeClient` at `database.client.ts:51-53`), not a per-call `runPromise` inside three utils.

```ts
const delays = [0, 100, 500, 1000, 3000, 6000, 10000, 20000, 30000] as const

const retryUntilSubscribed = (topic: string) =>
  Effect.gen(function* () {
    for (let attempt = 0; attempt < delays.length; attempt++) {
      const state = yield* Effect.sync(() => channels.get(topic))
      if (!state || state.status === "subscribed") return
      yield* Clock.sleep(Duration.millis(delays[attempt]))
      yield* resubscribe(topic)
    }
  })

const worker = Queue.take(q).pipe(
  Effect.flatMap(retryUntilSubscribed),
  Effect.forever,
)
// bootstrap: runtime.runFork(worker)
// closeChannel / removeChannel: Fiber.interrupt(fiberForTopic) — sleep cancelled, worker loops.
```

**Not shorter overall:** waiting for `SUBSCRIBED` (`:556-633`) stays a callback bridged into `Deferred`. Wrapping `@supabase/realtime-js` as `Stream` is **not** clearer. The retry *loop* is shorter and the hang is structurally impossible if the delay is `Clock.sleep` on an interruptible fiber. This is the strongest “Effect vs ~30 lines of TS” comparison a spike should run — **after** the sketches are this program, not `Effect.forEach(delays)`.

Subscribe “fully connected” (`:73-76`) mentions a “comment about postgres_changes ok message below” that is **not in the file**. `:556-633` waits for `SUBSCRIBED`, not a postgres_changes ack.

### 3.4 Spark receive wait (`claim-cashu-token-service.ts`)

**Current** — money path. `handlePayment` returns if `resolved` (`:293`) then sets it (`:298`); event + initial lookup can both pass. Lookup only completes when `status === 'completed'` (`:335-340`). Timer at `:282-290`.

**Effect 3.22** (`acquireRelease` always detaches; `Deferred` is one-shot; succeed only on completed; complete `Deferred` from `onEvent`):

```ts
const waitForSparkReceive = (account: SparkAccount, quote: SparkReceiveQuote) =>
  Effect.scoped(
    Effect.gen(function* () {
      const paid = yield* Deferred.make<{ sparkTransferId: string; paymentPreimage: string }>()
      const complete = (payment: Payment) => {
        const details = payment.details
        if (details?.type !== "lightning") return
        if (details.htlcDetails.paymentHash !== quote.paymentHash) return
        const preimage = details.htlcDetails.preimage
        if (!preimage) return
        Deferred.unsafeDone(paid, Exit.succeed({ sparkTransferId: payment.id, paymentPreimage: preimage }))
      }
      yield* Effect.acquireRelease(
        Effect.tryPromise(() =>
          account.wallet.addEventListener({
            onEvent: (event) => {
              if (event.type === "paymentSucceeded") complete(event.payment)
            },
          }),
        ),
        (id) => Effect.promise(() => account.wallet.removeEventListener(id).then(() => undefined)),
      )
      const initial = yield* Effect.tryPromise(() =>
        account.wallet.getPaymentByInvoice({ invoice: quote.paymentRequest }),
      )
      if (initial.payment?.status === "completed") complete(initial.payment)
      return yield* Deferred.await(paid)
    }),
  ).pipe(Effect.timeout(Duration.seconds(10)))
```

`Deferred.unsafeDone` / `Exit.succeed` — **not** re-read on unpkg this pass (JS-callback complete is the usual 3.22 pattern; spike must open `Deferred.d.ts`). `acquireRelease` / `Effect.scoped` / `Effect.timeout` / `Duration.seconds` exist as 3.22 exports. **Shorter and clearer** than the 85-line Promise (`:263-348`). Also ~40 lines of plain TS (`AbortSignal.timeout` + `Promise.withResolvers`). Prefer that unless a spike already uses Effect here. Do **not** start a migration: `meltProofsIdempotent` `{ type: 'random' }` is at `:161-171`.

## 4. Where Effect does not help or hurts

Boundary rule: **Effect stays behind `Promise` / `AbortSignal` at the SDK public surface.** `packages/wallet-sdk/index.ts:10-21` is re-exports (not an AbortSignal API). The Promise shape is the namespace methods and `SessionKeys` getters (`session-keys.ts:29-41`). React never imports `effect`.

| Surface | Why Effect hurts | Boundary |
| --- | --- | --- |
| React components | Fibers ≠ React lifecycle; would reimplement what `useEffect` cleanup already does | stop at hooks calling `sdk.*` |
| TanStack Query v5 (`query-client.ts:5-6`, every `*-hooks.ts`) vs `@effect-atom/atom-react@0.7.0` | atom-react peers `react >=18 <20` (we are **19.2.4**, still in range) but replaces Query’s cache, suspense, `queryOptions()`, the patched `@tanstack/query-core@5.90.20` (`package.json:66-71`), and version-gated `*Cache` classes. Quote processors *are* TQ mutations with `retry: 3` and `scope` (`cashu-receive-quote-hooks.ts:611-676`). | keep TQ; `runPromise` only inside `queryFn`/`mutationFn` if ever |
| Zustand 5 (`createSendStore` at `send-store.ts:181-192`) | multi-step UI, not an Effect `Ref` | factories stay |
| `Money` / `big.js` (`packages/money/src/money.ts`, 699 LOC) | `Effect/BigDecimal` is a different number type; CLAUDE.md forbids raw arithmetic | never |
| crypto (`@noble/*`, `@agicash/ecies`, Cashu secrets) | sync, must stay boring | `Effect.sync` at most |
| React Router 7.14 loaders/actions + `*.server.ts` (5 files: `instrument.server.ts`, `require-session-hint.server.ts`, `database.server.ts`, `cookies.server.ts`, `canonical-origin.server.ts`) | SSR/Vercel Node; Effect runtime in loaders is extra moving parts for cookie/JWT work | loaders call Promise APIs |
| Supabase JS (`db/client.ts:12-20`, `database.client.ts:11-44`) | RLS + `accessToken` callback + Realtime client. `@effect/sql@0.52.1` is a SQL toolkit (and peers `@effect/experimental ^0.61.1`), not a PostgREST/RLS client. Do not use it. | wrap `query.abortSignal` as interrupt |
| `@cashu/cashu-ts@3.6.1` and `@agicash/breez-sdk-spark@0.23.0-1` | Promise + WASM + event listeners. Effect cannot see mint protocol errors (`MintOperationError`) unless we `tryPromise` + map | `Effect.tryPromise` at the edge |
| `bun test` (no vitest/jest; `@types/bun` 1.3.11) | `@effect/vitest@0.30.0` **requires vitest ^3.2.0** | `TestClock`/`TestContext` from `effect` via `runPromise` |

zod 4.3.6 / `zod/mini` is in **53 non-test files**. Effect `Schema` would duplicate it. `effect@3.22.2` already depends on `@standard-schema/spec`; zod 4 speaks Standard Schema. **Do not replace zod.** Gift-card config is Node-loadable *because* it only imports zod (`wallet-sdk/package.json` `exports:comments` for `./gift-card-config`). Any later Effect import that lands in that graph breaks the Vercel build — this applies to *any* Effect import creep, not only Schema.

## 5. Constraints and interop design

**Runtime.** One `ManagedRuntime` per `AgicashSdk` instance, constructed in `AgicashSdk` (`sdk.ts:75-189`) next to `AuthService` / `createSessionKeys`. Matches the existing “one instance per process” constraint (`sdk.ts:38-41,191-199`). `dispose()` (`:215-221`) calls `runtime.dispose()` (`ManagedRuntime.d.ts` has `dispose(): Promise<void>`). Hosts keep `sdk.auth.signIn(): Promise<void>`. Inside: `this.runtime.runPromise(program, { signal })`. Types: yes. Runtime interrupt of `sleep` / `tryPromise` in Bun 1.3.11 and Chrome: still to measure.

A web-owned `Effect.forever` worker (realtime manager) cannot live in that SDK runtime. It needs its own `ManagedRuntime` next to `agicashRealtimeClient` (`database.client.ts:51-53`), disposed with the tab — or it is not an Effect rewrite.

**AbortSignal ↔ Fiber.** Capture `keys.sessionSignal()` (`session-keys.ts:269`) at the start of a public method (as `user-api.ts:113` already does). Fork the Effect; `abort` → `Fiber.interrupt` via `runPromise({ signal })`. Do **not** also drop `AbortSignal` from repositories: Supabase queries need the signal on the builder (`task-processing-lock-repository.ts:26-28`) because the JS client will not see a fiber interrupt. Dual wiring during migration: signal in *and* interrupt.

**Errors.** Keep `SdkError` subclasses (`lib/error.ts:6-70`) as the `E` channel: `Effect.fail(new DomainError(msg))`. `runPromise` rejects with that instance, so `instanceof DomainError` at **18 web sites in 12 files** plus `claim-cashu-token-service.ts:62` survives. Do **not** switch to `Data.TaggedError` until those sites are gone: `TaggedError` constructors are `{ message }` objects, not `new DomainError(message)` (`lib/error.ts:17-21`). Adding a `_tag` field on the existing classes is optional and backward compatible.

Public `index.ts:14-21` exports **six** classes: `ConcurrencyError`, `DomainError`, `NotFoundError`, `SdkError`, `SessionEndedError`, `UniqueConstraintError`. It does **not** export `NoSessionError` / `DisposedError` / `NotImplementedError`. Those three are used inside the SDK (`contacts-api.ts:24-27`, `user-api.ts:67-68`, `sdk.ts:58-69`). Treat the published host contract as the six exports; do not invent a `_tag` migration for classes hosts cannot import.

| Class (`lib/error.ts`) | Host contract | Effect `E` | TQ / retry today |
| --- | --- | --- | --- |
| `SdkError` (abstract, `:6`) | one `instanceof` at the boundary | union of subclasses | — |
| `DomainError` (`:17-21`) | `message` is user-displayable; never retry | `Effect.fail(new DomainError(m))` | `cashu-send-quote-hooks.ts:185-187` returns false |
| `ConcurrencyError` (`:24-31`) | always retry | same instance | `cashu-send-quote-hooks.ts:182-184` returns true |
| `NotFoundError` (`:10-14`) | missing row | same | `transaction-hooks.ts:103-106` no retry |
| `UniqueConstraintError` (`:8`) | insert conflict | same | mapped in repos |
| `NoSessionError` (`:35-39`) | namespace called logged-out | same | throw at API edge (`contacts-api.ts:24-27`); **not** in `index.ts:14-21` |
| `DisposedError` (`:43-47`) | instance dead | same | `user-api.ts:67-68` never retry; **not** exported |
| `SessionEndedError` (`:57-61`) | in-flight after sign-out/expiry; never retry same op | same | `user-api.ts:130-133,163-165` |
| `NotImplementedError` (`:65-69`) | namespace slice not landed | keep throwing from getters (`sdk.ts:58-69`) | **not** exported |

`Data.TaggedError("DomainError")` would also be `instanceof Error`, but **not** `instanceof` the current `DomainError` class unless it *is* that class. Constructor arity is part of the contract for the six exported classes.

**DI.** Today: constructor injection (`CashuSendQuoteService` at `cashu-send-quote-hooks.ts:48-50`; `createContactsApi(deps)` at `contacts-api.ts:17-20`; `createSendStore(deps)` at `send-store.ts:181-192`; `AgicashSdk` wiring at `sdk.ts:156-188`). `Layer`/`Context.Tag` would compile-check the graph and replace factories. **Do not Layer-ize the web.** If Effect is SDK-internal, `Layer.succeed` around existing class instances is enough; rewriting repositories as `Effect.gen` services is a second project. Zustand factories stay JS.

**Bundle / PWA.** `effect@3.22.2` unpacked **27.2 MB** (CJS+ESM+d.ts). `sideEffects: []` so Vite 7 can tree-shake. Tree-shaken gzip **not measured**. This app already ships Breez WASM + cashu-ts + supabase-js; 20–80 kB gzip of Effect is small next to WASM **if** Schema/Stream stay out. Importing `Schema` or `@effect/platform` blows that. `@effect/sql` must not ship to the client.

**TypeScript.** Catalog `typescript` 5.9.3. Effect 3 inference (especially `Layer` + `Schema`) is a known `tsc` tax. Dev server already needs 8 GB heap (`apps/web-wallet/package.json:9`). Spike must record `tsc` wall time before/after. Biome 1.9.4 has no Effect knowledge; `@effect/language-service` would be extra.

**Tests.** Runner is `bun test` (`wallet-sdk/package.json:19`, `web-wallet/package.json:12`). `@effect/vitest` cannot be used without adding Vitest. Highest payoff: `auth-service.test.ts` (926). Utils have **zero** tests — slice 1’s real work is writing them.

**`Effect.Micro`.** 3.22 export `./Micro`. Smaller surface than `Layer`+`Schema`+`Stream`. A spike that only needs `Schedule` + interrupt should evaluate Micro before full `Effect.gen` + `ManagedRuntime`. This pass did not read `Micro.d.ts` beyond the export map.

## 6. Cost model, per adoption path

Assumptions (also §10): 1–2 senior TS engineers, **new to Effect**; ~4–6 calendar days to write non-embarrassing `Effect.gen`; review is heavier than a plain-TS PR (unmeasured; folded into throughput, not a separate multiplier); two idioms live until a path completes; **no money-path Effect rewrite** until that file has tests. Engineer-week = 5 engineer-days.

Throughput (assumption, stated so the ranges multiply):

| Band | LOC/week | Applies to |
| --- | ---: | --- |
| Signature-stable wrappers | **400–600** | Path A slice 1 only (`withRetry` / `delay` / `setLongTimeout` keep current signatures at `with-retry.ts:58`, `delay.ts:10`, `timeout.ts:17`) |
| Existing-test rewrite | **300–500** | `auth-service.test.ts` etc. — known cases, not greenfield |
| Effect-new including tests and review | **150–250** | everything else |

LOC bases (`wc -l` at this commit):

```
# 15-file table: 3190
# web in that 15: 694 + 145 = 839
# utils in that 15: 81+30+48 = 159
# SDK in that 15: 3190-839-159 = 2192
# Path B sequenced (no claim, no web): 286+75+512+223+21+195+114+178 + ~20 of cashu.ts = 1624
# tests those slices already have: 926+217+141+122 = 1406
# Path D hook add: 844+720+521+490+545+202 = 3322
# + receive-cashu-token-hooks 392 = 3714
# mint/melt/proof-state managers: 152+104+129+147 = 532
# abortSignal repos: 13 files (not 10)
```

| Path | Files / LOC (command above) | ew range | How the ew multiplies | Confidence |
| --- | --- | --- | --- | --- |
| A. Utils only | 159 + new tests (~100–200) | **0.5–1.5** | 260–360 @ 400–600 | **high** |
| A′. Utils + manager + auth timer | 159+694+~40 ≈ 893 | **2–5** | slice 1 at wrapper rate; 694-line manager at 150–250 (needs a long-lived runtime; not a wrapper) | medium-low |
| B. SDK-internal (no claim, no web realtime) | 1,624 prod + 1,406 test rewrite ≈ 3.0–3.5k touched | **8–16** | 1,624 @ 150–250 = 6.5–10.8; 1,406 @ 300–500 = 2.8–4.7; + learning-curve overlap in the floor | low-medium |
| C. B + web realtime + mint/melt/proof-state | B + 694 + 532 ≈ 4.2–4.8k prod-side | **13–24** | B + 1,226 @ 150–250 = +4.9–8.2 | low |
| D. C + quote `*-hooks.ts` | C + 3,322 + 392 ≈ 8.2–9.2k | **20–50** | hook add @ 150–250 = 14.9–24.8; width is a 1–2× money-path review multiplier | low |
| Schema + tagged errors only | 53 zod files + 19 `instanceof` sites | **4–10, negative ROI** | thousands of schema lines, ~0 control-flow gain | medium |
| 3.22 → 4.0 later | unknown import-path rewrite | **1–4** | 4.0 tarball 48.9 MB vs 27.2 MB; unified `./unstable/*` exports | low |

**Residual disagreement on Path B.** An earlier 6–14 ew on “3,800–4,500 LOC” at 150–250/week does not multiply (that arithmetic is 15–30). A later 6–16 on the corrected 3.0–3.5k also does not multiply (12–23 at 150–250 on the whole). This document uses the corrected LOC and **multiplies**: 150–250 on production + 300–500 on existing-test rewrite → **8–16**. If you apply 150–250 to all 3.0–3.5k you get 12–23; that over-counts because `auth-service.test.ts` (926) is known cases, not new product. Confidence stays low-medium because throughput is unmeasured.

Learning curve 4–6 days is **inside** B’s 8–16, **not** inside A’s 0.5–1.5 if A only wraps `Schedule` behind existing functions (review is “does `withRetry` still match its JSDoc at `with-retry.ts:44-57`?”). A′ (manager) *does* leak `Effect.gen` + a persistent fiber; that is why it is not Path A.

Two-idiom tax: every `abortSignal?:` repository (**13** files) must keep working while fibers exist. Dual wiring (`user-api.ts:113` plus `Fiber.interrupt`) is the tax. Folded into B’s 8–16, not extra.

**Dependency risk.** Spike and any 2026 code: **effect 3.22.2**. Do not take `4.0.0-rc.117`. Move to 4.0 **after** a stable release and a written migration of the spike’s import paths — budget **another 1–4 ew** (confidence low). Sitting out 3.22 until 4.0 stable is itself a decision with unbounded wait; a 1-week 3.22 spike that is thrown away at 4.0 still leaves measured gzip/`tsc`/TestClock numbers.

**Money-path risk.** Highest in D (`cashu-receive-quote-hooks.ts:714-723`, `claim-cashu-token-service.ts:161-171`). Path B touching `claim-cashu-token-service.ts` is still a funds path — sequenced B **stops before claim**. Path A (utils only) does not rewrite money services, but **the day `withRetry` is rewritten, Effect loads on a mint-quote path** (`cashu-receive-quote-hooks.ts:460-466`). `cashu-send-quote-service.ts` (568) and `cashu-send-swap-service.ts` (457) have **no dedicated test files**.

## 7. Adoption paths (ranked)

### Path 1 — Utility-first, slice 1 only (recommended spike, if any)

**Scope.** Reimplement `withRetry` / `delay` / `setLongTimeout` on Effect **behind the current function signatures** (`with-retry.ts:58`, `delay.ts:10`, `timeout.ts:17` — not `packages/utils/src/index.ts:7-10`, which also re-exports `xchacha20poly1305`). Add the tests this package currently lacks.

**Not in this path.** The realtime manager. A `Queue` + `Effect.forever` worker needs a persistent runtime the utils do not have. That file is Path C / a later web reliability project, not “utility-first slice 2.”

**First slice = the path.** `packages/utils/src/{with-retry,delay,timeout}.ts` (159 LOC). No callers change.

**Interop.** Zero at the app boundary. `Effect.runPromise` inside the three functions. `signal` → interrupt. Today’s `withRetry` callers are `user-api.ts:122,145` and `cashu-receive-quote-hooks.ts:460` — both client. Effect will load on a mint-quote path the day slice 1 lands. If a later server import pulls utils, Effect loads on Vercel Node (fine for the library; fatal for `./gift-card-config` if the import graph ever reaches it).

| # | Slice | Files | LOC (`wc -l`) | ew |
| --- | --- | --- | ---: | --- |
| 1 | Utils behind current signatures + tests | `packages/utils/src/{with-retry,delay,timeout}.ts` | 159 + tests | 0.5–1.5 |

**Exit criteria.** `withRetry` abort cancels `fn` (today it does not, `with-retry.ts:66-77`); existing SDK tests green; no `effect` import outside `packages/utils`.

**Stop halfway.** After slice 1 the repo is coherent: three functions, one new dep, same signatures. That is a valid steady state.

**Cost.** §6 Path A, 0.5–1.5 ew, high confidence.

**Risks.** Reviewers need Effect literacy only for three files. Bundle: utils + Schedule + Effect core (keep Schema out). Mint-quote `withRetry` (`cashu-receive-quote-hooks.ts:460-466`).

**Does not solve.** Session-key fencing, Spark wallet leak (`wallet.ts:150-152`), mint `Promise.race` timer (`cashu.ts:182-193`), realtime hang, quote processors, SDK extraction (`sdk.ts:58-69`).

### Path 2 — SDK-internal Effect, Promise APIs for the web (required shape if a 2027 option is wanted)

**Scope.** `AgicashSdk` owns a `ManagedRuntime`. Convert session/auth/keys/token/CAT/flags/wasm/spark-wallet-lifecycle. Public `packages/wallet-sdk/index.ts` stays Promise. Web keeps TQ + Zustand. **Do not convert quote services until they have tests.**

**First slice.** `session-keys.ts` (286) + `supabase-session.ts` (75) = **361 LOC**, plus `session-keys.test.ts` (217) and `supabase-session.test.ts` (141). Add the CAT fence (`agicash-mint-auth-provider.ts`, 87) next to the token memo — same class of bug (`:28-36` vs `supabase-session.ts:64`).

**Interop.** `runPromise` at namespace methods. `AbortSignal` from `sessionSignal()` interrupts the fiber **and** is still passed to Supabase.

| # | Slice | Files | LOC | ew |
| --- | --- | --- | ---: | --- |
| 1 | Keys + token + CAT memo | `session-keys.ts` 286, `supabase-session.ts` 75, `agicash-mint-auth-provider.ts` 87, tests 217+141 | 448 + tests | 1–2 |
| 2 | Auth + TestClock | `auth-service.ts` 512, `auth-service.test.ts` 926 | 512 + test rewrite | 2–4 |
| 3 | Runtime + WASM + Spark connect | `sdk.ts` 223, `wasm.ts` 21, `wallet.ts` 195 | 439 | 1–2 |
| 4 | Feature flags | `feature-flag-service.ts` 114 + its existing test (122) | 114 | 0.5 |
| 5 | Provision retry | `user-api.ts` 178 | 178 | 0.5–1 |
| 6 | Mint init timeout | `lib/cashu.ts` race at `:182-193` | ~20 of 239 | 0.25 |
| 7 | **Stop.** Do not convert quote services. | — | — | — |

**Exit criteria.** `SessionEndedError`/`DisposedError` still `instanceof` (`lib/error.ts:42-61`); no Effect type in `apps/web-wallet`; `sdk.init()` (`sdk.ts:208-212`) still `Promise<void>`; Spark wallets torn down on `onSessionEnded` (`sdk.ts:117-132`).

**Stop halfway.** After (1)–(3) the SDK is mixed: Effect internals, Promise façade — **this is a valid steady state** and matches how the SDK is already a façade over Open Secret / Supabase / Breez. After (7) quote hooks still call class methods.

**Cost.** §6 Path B, 8–16 ew, low-medium.

**Risks.** Collides with the in-flight `/temporary` extraction (`packages/wallet-sdk/index.ts:1-9`, `temporary.ts:1-5`). `send` is not even on the SDK yet (`sdk.ts:58-60`). Two migrations on one module graph. `featureFlags` throwing (`sdk.ts:64-65`) is not evidence of collision — flags already run from `entry.client.tsx:49`. Putting Effect behind the Promise façade *before* `send`/`transfer`/`taskProcessor` land is cheaper than after; waiting “until extraction finishes” may mean wrapping a larger graph. That is the steelman *for* a 2027 option, not a reason to start Path 2 in 2026.

**Does not solve.** Realtime manager (lives in the web app). TQ retry policy. Leader election UX (`task-processing.ts`).

### Path 3 — Path 2 + web realtime/expiry helpers (still no TQ rewrite)

**Scope.** Path 2 plus the realtime manager (with its own `ManagedRuntime`) + `melt-quote-subscription.ts` timers + proof-state/mint/melt managers. Quote `*-hooks.ts` stay TQ.

**First slice.** Path 1 slice 1, **or** Path 2 slice 1 — do not start both in one PR.

**Sequencing.** Finish Path 1 or 2 to its stop-halfway, then the other. Never merge them in one slice. Do not call the manager “utility-first.”

**Exit criteria.** Union of Path 1+2. Web app still has no `import from 'effect'` except the manager file and its runtime module.

**Stop halfway.** Either Path 1 or Path 2 completed; the other not started. Coherent.

**Cost.** §6 Path C, 13–24 ew, low.

**Does not solve.** TanStack Query, Zustand, Money, zod, React Router, Cashu protocol.

### Schema + typed errors only

**Not worth it.** 53 `zod/mini` files, working Standard Schema interop, gift-card Node entry that forbids extra imports, incomplete public error export list (`index.ts:14-21`), and `instanceof DomainError` as a published host contract (`lib/error.ts:1-4`). Zero help for reconnect or session races.

## 8. Case against

The honest no: **this repo’s hard problems are protocol and product, not missing `Schedule`.** Session fencing is already explicit and tested (`session-keys.test.ts` 217, `auth-service.test.ts` 926, `supabase-session.test.ts` 141). The SDK extraction is unfinished (`sdk.ts:58-69`; web still imports repositories from `@agicash/wallet-sdk/temporary` — `index.ts:1-9`, `receive-cashu-token-hooks.ts:9-16`). Quote money machines have no dedicated tests. The team has no Effect readers. Effect 4.0 has been in RC for ~5 weeks (pre-release ~2 months) with no stable date; adopting 3.22 is buying a second migration. Dev `tsc` is already heap-heavy. `@effect-atom` would torch a working TQ+Zustand design. `@effect/sql` does not speak Supabase RLS and peers `@effect/experimental`.

**Fix the hotspots in plain TS instead:**

| Bug | Fix without Effect |
| --- | --- |
| Mint init timer leak (`cashu.ts:182-193`) | `AbortSignal.timeout(10_000)` + `AbortSignal.any`; clear on settle. ~15 LOC. |
| Realtime queue hang (`supabase-realtime-manager.ts:230-232,393-396,481-483`) | store `{ timeoutId, resolve }` and resolve(false) on close **and** on `removeChannel`; or `AbortSignal`. ~30 LOC. Easy to get subtly wrong again — `removeChannel` already copies the `closeChannel` bug. |
| Spark wallet leak (`wallet.ts:150-152`) | teardown before `Map.clear()`. Need to confirm Breez API; ~20 LOC. Leak claim stands as “Map dropped without teardown.” |
| Spark listener cleanup no-op (`spark-receive-quote-hooks.ts:449-457`) | call `console.warn` in the catch. 1 LOC. |
| Claim wait race (`claim-cashu-token-service.ts:263-348`) | `AbortSignal.timeout` + `Promise.withResolvers` + always `removeEventListener`; complete only on `status === 'completed'` (`:335-340`). ~40 LOC. |
| `withRetry` doesn’t cancel `fn` (`with-retry.ts:66-77`) | pass `signal` into `fn`. ~10 LOC. |
| Feature-flag retries after reset (`feature-flag-service.ts:24-40,104-107`) | abort/generation check inside the loop. ~10 LOC. |
| CAT / session token late return (`agicash-mint-auth-provider.ts:28-36`, `supabase-session.ts:64`) | reject (or return null) when `generation !== startedIn`, same as the cache skip. ~15 LOC. |

None of these require a runtime. `Promise.withResolvers`, `AbortSignal.any`, and `AbortSignal.timeout` are in the runtimes this app uses (browser + Node 24 / Bun 1.3.11). The repo currently uses **none** of them (0 hits). A 150-line expiry scheduler would replace `setLongTimeout` without 27 MB of types.

What plain TS does **not** give: TestClock, structural interrupt of a retry loop, or one implementation of the three generation fences. That is the entire remaining case for a spike.

Further against:

- **Concurrent migration.** `packages/wallet-sdk/index.ts:1-9` and `temporary.ts:1-5` describe an in-progress extraction. Adding Effect is a third concurrent rewrite of the same graph.
- **Test holes on money files.** `wc -l` of `domain/send/cashu-send-quote-service.ts` is 568 with no `cashu-send-quote-service.test.ts`. Same for receive quote/swap services. `receive-api.test.ts` is not a substitute for rewriting those classes in `Effect.gen`.
- **Path 1 still ships Effect on a mint-quote path** the day `withRetry` is rewritten (`cashu-receive-quote-hooks.ts:460-466`).
- **Gift-card Node entry.** `./gift-card-config` must import only zod (`wallet-sdk/package.json` `exports:comments`).
- **Host `instanceof` surface is already inconsistent.** Public `index.ts:14-21` does not export three of the classes the SDK throws.
- **Editor/lint.** Biome 1.9.4 (root `package.json` `devDependencies`) has no Effect plugin.
- **Heap.** `apps/web-wallet/package.json:9` already sets `--max-old-space-size=8192`. Effect 3 inference is a known `tsc` cost; we did not measure it.
- **Ecosystem mismatch.** `@effect/sql` is the wrong database client. `@effect/vitest` requires Vitest. `@effect-atom/atom-react` would replace a patched TanStack Query (`package.json:66-71`). `@effect/platform` duplicates `ky` (`wallet-sdk/package.json` deps).

The “Effect is the missing stdlib” pitch is true in a greenfield Node service. This is a browser PWA + Vercel + WASM + RLS + an unfinished SDK façade. The stdlib it is missing is `AbortSignal.timeout`.

**Evidence that would change this recommendation:** (1) Effect 4.0 **stable**, measured Vite gzip < 30 kB for Schedule+Effect+TestClock, and a migration guide from 3.22; (2) a spike showing `TestClock` deleting ≥400 lines of `auth-service.test.ts` *and* catching the guest-expiry race at `auth-service.ts:416-426`; (3) SDK extraction complete (`/temporary` gone, `taskProcessor` implemented in-SDK) so Layer is not a third concurrent migration; (4) dedicated tests for send/receive quote services so an Effect rewrite of those files is falsifiable.

**Steelman for spending the optional week** (does not change the no-go default): three generation fences and growing; `withRetry` cannot cancel `fn`; `runPromise({ signal })` exists in 3.22.2 so AbortSignal interop is not an open types question; TestClock vs 926 lines of `setTimeout`; last cheap moment to hide a runtime before `send`/`transfer`/`taskProcessor` land; `Effect.Micro` is unmentioned in most “full Effect” pitches; queue hang is structurally unrepresentable if the delay is `Clock.sleep`; sitting out 3.22 until 4.0 stable has unbounded wait.

## 9. Recommendation and decision criteria

**Do now (no Effect):** land the plain-TS fixes in §8. They are the actual defects. Continue the wallet-sdk extraction.

**Spike (optional, 1–2 weeks):** only if two seniors are idle *after* extraction work and want a 2027 option. Scope: Path 1 slice 1 + a throwaway TestClock prototype of `setExpiryTimer` (`auth-service.ts:377-388`). Target effect **3.22.2**. Evaluate `Effect.Micro` before `ManagedRuntime`. Do not merge Path 2 without the go criteria below. Do not attach the realtime manager to the spike unless you also place a `ManagedRuntime` and compare LOC-for-LOC with the §8 hang fix.

**Measure in the spike**

1. Vite production client gzip delta (network tab or `vite build` analysis), Schema **not** imported.
2. `bun run typecheck` wall time and peak RSS before/after.
3. `auth-service.test.ts` line count and wall time on `TestClock` vs `setTimeout`.
4. Whether `runtime.runPromise(effect, { signal })` actually interrupts `Effect.sleep` and `tryPromise` (including a Supabase builder) in Bun 1.3.11 and Chrome. Types already say `{ signal }` exists.
5. Whether `instanceof DomainError` still holds across `runPromise` rejection for the six **exported** classes.
6. Repro + fix of the realtime queue hang (`closeChannel` **and** `removeChannel`), compared LOC-for-LOC with the plain-TS fix — only if the spike includes the manager.
7. Whether `Schedule` + interrupt is shorter than “pass `signal` into `fn`” under the predicate that skips `SessionEndedError` (`user-api.ts:130-133`).

**Go (continue past a spike)** if all of: gzip delta < 40 kB; `tsc` regression < 20%; TestClock removes real test complexity (≥400 lines *and* catches `:416-426`); `instanceof` contract intact for the six exports; plain-TS fix of the same bugs is *longer* or *weaker* on interruption; SDK `/temporary` extraction is finished or paused by explicit team decision.

**No-go (default)** if any of: gzip or `tsc` blows the budget; 4.0 stable is “weeks away” and the spike would be throwaway; reviewers cannot review `Effect.gen` without the author in the room; the spike rewrites a melt/mint function; the queue hang is fixed in ~30 lines of TS (then the lesson is “we didn’t need Effect”).

## 10. Assumptions and open questions

**Assumptions (not blocked).** Team size 1–2 seniors, zero Effect production time. 2026 priority is finishing `@agicash/wallet-sdk` extraction, not a new runtime. PWA budget can absorb tens of kB gzip but not Schema. Bun test stays. Supabase JS stays (no `@effect/sql`). Host contract `instanceof` for the **six exported** `SdkError` subclasses stays through 2026. `ManagedRuntime` per SDK instance is the right grain for Path 2 (one OS client per process, `sdk.ts:76-84`). A web realtime worker, if ever Effect, gets its own runtime. Quote-hook `retry:` values are product policy, not missing infrastructure. Leader election stays SQL `take_lead` (`task-processing-lock-repository.ts:21-24`). Breez wallets should be torn down on sign-out if the API exists — leak claim is “Map dropped without teardown.” Throughput as in §6. `Effect.Micro` is in 3.22.2 because the package exports it; this pass did not read its `.d.ts` beyond the export map. “~5 weeks RC, ~2 months 4.0 pre-release” from registry version lists + releasealert.dev (July betas; `rc.108` 2026-08-12; `rc.117` 2026-09-21). Citations are against pin `887bdc48`; current HEAD only adds research docs under `docs/research/effect-ts/`.

**Open questions (genuinely unknown).** Breez `disconnect`/`close` against `@agicash/breez-sdk-spark` types (no typings in this workspace). Tree-shaken gzip in *this* Vite 7 graph. `tsc` + heap with Effect 3 inference. Whether `runPromise({ signal })` interrupts `tryPromise` of a Supabase builder in Bun 1.3.11 and Chrome. Whether 4.0 stable lands in 2026. Whether the team would accept `@effect/language-service` next to Biome 1.9.4. Exact `Deferred.unsafeDone` / `Exit.succeed` signatures on the installed 3.22 `.d.ts` (named in the §3.4 sketch; unpkg `Deferred.d.ts` was not fetched).

---

Pain ranked from the code, not from a steer: (1) session/key/token/CAT fencing correctness, (2) realtime reconnect reliability, (3) leaked Spark sessions and mint timeouts, (4) untested money state machines — which Effect would make *more* expensive to change. Effect is a good fit for (1)–(3) *in the abstract* and a bad fit for this repo’s 2026 constraints. Fix the defects; keep a 2027 option; do not migrate.

## Appendix A — Disposition of review findings

| id | severity | disposition | what changed in this document | evidence |
| --- | --- | --- | --- | --- |
| 1 | Critical | accepted | Path B base is **1,624** sequenced prod / **2,192** SDK-in-table, not 3,045. §0/§2/§6 publish both plus the 3,190 grep-accounted table. | `wc -l` of the 15 files = 3190, of which manager 694 is web (`supabase-realtime-manager.ts:1-694`). 3190−694−145−159 = 2192. Sequenced: 286+75+512+223+21+195+114+178+~20 = 1624. |
| 2 | Critical | accepted | §6 picks throughput bands and **multiplies**. Path B is **8–16 ew**, not 6–14. Residual: a later 6–16 on the corrected 3.0–3.5k also failed to multiply (150–250 on 3.0–3.5k = 12–23). This document uses 150–250 on prod + 300–500 on existing-test rewrite. | Throughput sentence in §6; LOC commands in §1/§6. |
| 3 | Critical | accepted | §3.1 rewritten with `SynchronizedRef.modifyEffect`, live `AbortSignal`, shared `Deferred` in-flight, success-only cache. `updateEffect` → `Effect<void>` is not used. | unpkg `effect@3.22.2` `SynchronizedRef.d.ts` (`modifyEffect` returns `B`; `updateEffect` returns `void`). Current share-one-promise: `session-keys.ts:113-132`. |
| 4 | Critical | accepted | §3.3 rewritten as retry-until-success (`for` + break on subscribed/gone), serial `Queue.take` mailbox, `runFork` + `ManagedRuntime` home. `Effect.forEach(delays)` is not the program. | Current loop `supabase-realtime-manager.ts:461-496`; serial reason `:87-91`. |
| 5 | Important | accepted | Host contract text is **18 web sites in 12 files** plus `claim-cashu-token-service.ts:62` (13 files / 19 sites total). | `git grep -n 'instanceof DomainError'` in §1. |
| 6 | Important | accepted | Dual-wiring / repo counts say **13** `*repository*.ts` files, including `spark-receive-quote-repository.server.ts`. | `git grep -l 'abortSignal' -- 'packages/wallet-sdk/domain/**/*repository*.ts'` in §1. |
| 7 | Important | accepted | Offline path is `supabase-realtime-hooks.ts:131` (`setOnlineStatus(false)`), which does not close. `:617` is already-offline subscribe failure. Hang also in `removeChannel` `:230-232`. | `setOnlineStatus` `:334-349` only resubscribes when coming online; `closeChannel` JSDoc `:377-378` overstates. |
| 8 | Important | accepted | `user-repository.ts:201-203` cited as `Promise.all` `toAccount`, not decrypt. `transaction-repository.ts:84` is `Promise.all(toTransaction)` (decrypt inside). | Read those ranges at the pin. |
| 9 | Important | accepted | §0/§2 publish **two** numbers: 3,190 grep-accounted table vs 1,624 sequenced / ~200 defect-fix. `wasm.ts` (21) and `realtime-hooks.ts` (145) stay in the table, marked medium/low, and are not in the 1,624. Claim (349) is high-defect / do-not-migrate. | Commands in §2. |
| 10 | Important | accepted | Inventory adds `agicash-mint-auth-provider.ts` (87) and `proof-state-subscription-manager.ts` (147). CAT fence sits next to `supabase-session.ts` in pain #1 and Path 2 slice 1. | CAT late-return `agicash-mint-auth-provider.ts:28-36`; cleared from `sdk.ts:125`. Overlap-subscribe `proof-state-subscription-manager.ts:39-50`. |
| 11 | Important | accepted | Path 1 is **slice 1 only**. Manager is Path 3 / a later web project. §5 requires a web-owned `ManagedRuntime` next to `database.client.ts:51-53` if the manager is ever rewritten. | `Effect.forever` is `runFork`; Path 1 interop is `runPromise` inside three functions. |
| 12 | Important | accepted | §6/§7/§8 say Effect loads on a mint-quote path the day `withRetry` is rewritten. | `cashu-receive-quote-hooks.ts:460-466`; only other callers `user-api.ts:122,145`. |
| 13 | Important | accepted | Host-contract table vs public exports: `index.ts:14-21` exports six classes, not `NoSessionError` / `DisposedError` / `NotImplementedError`. | Read `index.ts:14-21`; those three used at `contacts-api.ts:24-27`, `user-api.ts:67-68`, `sdk.ts:58-69`. |
| 14 | Important | accepted | §3.4 succeeds only on `status === 'completed'`; `onEvent` completes the `Deferred`; unpaid lookup is not a win. | Current guard `claim-cashu-token-service.ts:335-340`. |
| 15 | Minor | accepted | §1 reports both 59 (`.ts/.tsx`) and 60 (`git grep` including `.sql:5`). | Migration comment `20260425181643_tighten_spark_send_payment_hash_uniqueness.sql:5`. |
| 16 | Minor | accepted | Wording is “~5 weeks RC, ~2 months 4.0 pre-release,” not “months of RC.” | `4.0.0-rc.108` 2026-08-12; `4.0.0-rc.117` 2026-09-21; betas from July 2026. |
| 17 | Minor | accepted | §1 npm table includes `@effect/sql` peer `@effect/experimental ^0.61.1`. | GET `https://registry.npmjs.org/@effect/sql/0.52.1`. |
| 18 | Minor | accepted | §3.2 calls the 5s margin a clock offset, not `Effect.timeoutTo`. | `auth-service.ts:396-407`. |
| 19 | Minor | accepted | `entry.server.tsx:17` is `streamTimeout`; `setTimeout(abort)` is `:100`. | Read those lines. |
| 20 | Minor | accepted | §3.3 notes the postgres_changes “comment below” is missing; `:556-633` waits for `SUBSCRIBED`. | `supabase-realtime-manager.ts:76` vs `:556-633`. |
| 21 | Minor | accepted | §1/§5: types yes (`Runtime.d.ts`, `ManagedRuntime.d.ts`); runtime interrupt in Bun/Chrome still to measure. | unpkg `effect@3.22.2`. |
| 22 | Minor | accepted | Path 1 cites `with-retry.ts:58`, `delay.ts:10`, `timeout.ts:17`, not `index.ts:7-10`. | `index.ts:7-10` re-exports timeout, xchacha20, delay, with-retry. |
| 23 | Minor | accepted | Inventory adds `receive-cashu-token-hooks.ts` (392) and `auth.ts:128-140`. | `instanceof DomainError` at `:299`; `/temporary` imports `:9-16`. |
| 24 | Minor | accepted | §2 notes `featureFlags` throw is extraction theater; `configureFeatureFlags` already runs. | `sdk.ts:64-65` vs `entry.client.tsx:49` and `feature-flags.ts:4-5,22`. |