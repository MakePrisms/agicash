# Effect TS assessment — adversarial review

Reviews `docs/research/effect-ts/01-assessment.md` at `887bdc480b554bd5f3a994002259bcce533ed703`. Code tree is unchanged by the draft commit `092ae7f` (only the draft file was added). No Effect dependency. No code changed for this review.

**Effect primitive (first use):** `Effect<A, E, R>` is a lazy program that succeeds with `A`, fails with typed `E`, and needs services `R`. Nothing runs until `runPromise` / `runFork`.

## 0. Verdict

**Yes with fixes.** Do not treat the draft’s numbers or sketches as a spike spec; do treat its recommendation as usable.

The go / no-go holds: do not adopt Effect as a 2026 stack; the live defects are cheaper in plain TypeScript; a 1–2 week spike is optional and must stay off money paths. That conclusion is supported by the code.

The draft cannot be acted on *as written* for scoping:

- Path B’s “3,045 LOC” includes the 694-line **web** realtime manager (`apps/web-wallet/app/lib/supabase/supabase-realtime-manager.ts:1-694`). SDK-internal cost is overstated by that file. The published engineer-week math (`150–250` LOC/week vs 6–14 ew on 3.8–4.5k) does not multiply.
- The session-keys sketch does not compile against `effect@3.22.2`: `SynchronizedRef.updateEffect` returns `Effect<void>` (`unpkg effect@3.22.2` `SynchronizedRef.d.ts:265-275`).
- The realtime sketch does not preserve retry-until-success: `Effect.forEach(delays, …)` runs every delay then resubscribes, unlike `processResubscribeQueue` (`supabase-realtime-manager.ts:461-496`).
- Zero `path:line` citations point at a missing file or missing line. Fourteen citations **misread** the code (decrypt vs `toAccount`, offline vs already-offline, “13 web call sites”, “10 repos”). A pattern of misreads, not invalids.

After the §8 edits, a senior can decide spike / no-spike. Without them, do not budget from §6.

## 1. Method

Read: `CLAUDE.md`, `docs/architecture.md`, `docs/guidelines.md`, `packages/wallet-sdk/index.ts`, `packages/wallet-sdk/lib/error.ts`, `apps/web-wallet/app/lib/error.ts`, the draft, and every file the draft cites (SDK `domain/sdk/*`, `auth-service.ts`, `user-api.ts`, `user-provisioner.ts`, `supabase-session.ts`, `lib/spark/{wallet,wasm}.ts`, `lib/cashu.ts`, `lib/agicash-mint-auth-provider.ts`, `feature-flag-service.ts`, `claim-cashu-token-service.ts`, quote services/repos, `apps/web-wallet/app/lib/supabase/*`, quote `*-hooks.ts`, `task-processing.ts`, `query-client.ts`, `sdk.client.ts`, `packages/utils/src/{with-retry,delay,timeout,index}.ts`, `send-store.ts`, `welcome-email-service.ts`, `entry.server.tsx`, `database.client.ts`, `db/client.ts`, plus missed files in §3).

Ran (cwd `/work`, HEAD `092ae7f`; code identical to pin `887bdc48`):

```
git rev-parse HEAD^
# → 887bdc480b554bd5f3a994002259bcce533ed703

find apps/web-wallet/app -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name '*.test.ts' ! -name '*.test.tsx' | wc -l
# → 293; same find -exec cat | wc -l → 27235

find packages/wallet-sdk -type f -name '*.ts' ! -name '*.test.ts' ! -path '*/node_modules/*' | wc -l
# → 119; -exec cat | wc -l → 18192

# small-lib non-test LOC: bolt11 183, cashu 1292, ecies 265, lnurl 259, money 810, utils 300 = 3109
# packages/money/src/money.ts alone: 699

find apps/web-wallet/app packages/wallet-sdk packages/utils -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.ts' ! -name '*.test.tsx' ! -path '*/node_modules/*' -print0 \
  | xargs -0 grep -lE 'AbortController|AbortSignal|setTimeout\(|Promise\.race|Promise\.all|Promise\.allSettled|retry|withTimeout|backoff|new Promise\(' | wc -l
# → 59  (buyer command; .ts/.tsx only)

git grep -l -E 'AbortController|AbortSignal|setTimeout\(|Promise\.race|Promise\.all|Promise\.allSettled|retry|withTimeout|backoff|new Promise\(' \
  -- 'apps/web-wallet/app' 'packages/wallet-sdk' 'packages/utils' | grep -v '\.test\.' | wc -l
# → 60  (draft’s command as written; includes a .sql hit)

git grep -l "from 'zod/mini'" -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l   # → 53
git grep -l 'instanceof DomainError' -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l  # → 13 files
git grep -n 'instanceof DomainError' -- '*.ts' '*.tsx' | grep -v '\.test\.' | wc -l  # → 19 sites
# web-only: 12 files, 18 sites; SDK: claim-cashu-token-service.ts:62

find . -name '*.test.ts' -o -name '*.test.tsx' | grep -v node_modules | wc -l  # → 31
# web 4 + sdk 19 + money 1 + cashu 5 + ecies 1 + bolt11 1 = 31; utils 0

git grep -l 'abortSignal' -- 'packages/wallet-sdk/domain/**/*repository*.ts' | grep -v test
# → 13 repository files (draft says 10)

git grep -n 'withResolvers\|AbortSignal.any\|AbortSignal.timeout' -- '*.ts' '*.tsx' | grep -v node_modules
# → 0

wc -l <draft high-fit 15 files>   # → 3190 (sum matches)
```

npm registry via `GET https://registry.npmjs.org/<pkg>` (2026-09-21, this pass). `time` fields, not tarball `Last-Modified`:

| Package | Version | `time` | unpackedSize | fileCount | peers |
| --- | --- | --- | ---: | ---: | --- |
| effect | 3.22.2 | 2026-09-09T06:35:32.571Z | 27,163,958 | 2715 | — |
| effect | 4.0.0-rc.117 | 2026-09-21T04:54:14.393Z | 48,953,868 | 2546 | — |
| @effect/platform | 0.97.2 | 2026-09-09T04:47:20.052Z | 19,891,956 | 709 | `effect ^3.22.2` |
| @effect/sql | 0.52.1 | 2026-07-30T04:29:15.541Z | 734,828 | 130 | `effect ^3.22.1`, `@effect/platform ^0.97.1`, **`@effect/experimental ^0.61.1`** (draft omitted) |
| @effect-atom/atom-react | 0.7.0 | 2026-08-14T09:22:24.140Z | 96,490 | 43 | `effect ^3.22.1`, `react >=18 <20` |
| @effect/vitest | 0.30.0 | 2026-07-13T15:34:02.019Z | 134,264 | 27 | `effect ^3.22.0`, `vitest ^3.2.0` |

Fetched `https://unpkg.com/effect@3.22.2/dist/dts/{Runtime,SynchronizedRef,TestClock,TestContext}.d.ts` into `/tmp` (not the job tree). Confirmed: `Runtime.runPromise(..., { signal?: AbortSignal })` (`Runtime.d.ts:221-223`); `SynchronizedRef.updateEffect` → `Effect<void>` (`SynchronizedRef.d.ts:265-275`); `TestClock` and `TestContext.TestContext` exist as package exports.

Could not verify: Vite/PWA tree-shaken gzip; `tsc` wall time; Breez `disconnect`/`close` (no `@agicash/breez-sdk-spark` typings in this workspace); tarball `Last-Modified` / `Content-Length` (used registry `time` + `dist.unpackedSize` instead); whether `Effect.timeout` interrupts `tryPromise` under Bun 1.3.11 at runtime (types only). Effect 4 “70kB → 20kB” remains a third-party claim.

`CLAUDE.md` stale points the draft already flagged are correct: `packages/wallet-sdk` is 18,192 LOC; `apps/web-wallet/app/features/shared/error.ts` does not exist; `apps/web-wallet/app/lib/error.ts:1-14` is only `getErrorMessage`.

## 2. Reference audit

**Totals: 156 citations checked** (74 `file:line` tokens plus 82 table/parenthetical ranges). **Invalid (file or line missing): 0. Misread / partial: 14.**

Zero invalids. Fourteen misreads is a pattern — **Important**, not Critical on references alone. Cost/sketch errors in §4–§5 are the Critical items.

| reference | exists | claims? | note |
| --- | --- | --- | --- |
| `sdk.ts:58-69` send/transfer/featureFlags/taskProcessor throw | y | y | `packages/wallet-sdk/domain/sdk/sdk.ts:58-69` |
| `sdk.ts:208-212` `Promise.all([restoreSession, ensureBreezWasm])` | y | y | |
| `sdk.ts:42,191-199` one instance | y | y | `:42` is `currentInstance`; throw is `:193-196` |
| `sdk.ts:215-221` dispose | y | y | |
| `sdk.ts:75-189` ctor / `:156-188` wiring | y | y | |
| `sdk.ts:117-132` `onSessionEnded` + `clearSparkWallets` | y | y | |
| `sdk.ts:76-84` process-global Open Secret | y | y | |
| `sdk.client.ts:78-82` HMR dispose | y | y | `apps/web-wallet/app/features/shared/sdk.client.ts:78-82` |
| `index.ts:1-9` / `temporary.ts:1-5` extraction | y | y | |
| `index.ts:10-21` “Promise/AbortSignal surface” | y | **partial** | those lines are re-exports; no AbortSignal API |
| `index.ts:14-21` host error exports | y | **partial** | exports 6 classes; **not** `NoSessionError` / `DisposedError` / `NotImplementedError` |
| `lib/error.ts:6-70` SdkError tree | y | y | |
| `lib/error.ts:1-4, :4,53` retry comments | y | y | word “retry” only |
| `lib/error.ts:17-21` DomainError ctor arity | y | y | |
| `error.ts` class line table (`:6,:8,:10-14,:24-31,:35-39,:43-47,:57-61,:65-69`) | y | y | |
| `session-keys.ts:114-132` / `:89-135` memo | y | y | |
| `session-keys.ts:144` AbortController | y | y | |
| `session-keys.ts:207-217` composite fence | y | y | |
| `session-keys.ts:224-261` facade re-check | y | y | |
| `session-keys.ts:125-128` “rejection not cached” | y | **partial** | finally keeps `inFlight` when aborted; `reset()` clears via `clearMemos` |
| `session-keys.ts:29-31` Promise façade | y | y | |
| `session-keys.ts:51,269` `sessionSignal` | y | **partial** | `:51` is JSDoc; impl is `:269` |
| `supabase-session.ts:32-41,56-68` generation | y | y | |
| `supabase-session.ts:64` late return of old token | y | y | `return token` even when generation moved |
| `auth-service.ts:86,372-375` scope | y | y | |
| `auth-service.ts:377-388` / `:377-414` timer | y | y | |
| `auth-service.ts:386-388` `setLongTimeout` | y | y | |
| `auth-service.ts:396-407` 5s margin | y | y | |
| `auth-service.ts:202-221` persist-or-undo | y | y | |
| `auth-service.ts:284-288` teardown | y | y | |
| `auth-service.ts:416-426` residual race | y | y | |
| `auth-service.ts:427-511` guest extend | y | y | |
| `user-api.ts:113` capture signal | y | y | |
| `user-api.ts:122-168` / `:67-68,:130-167` retry skip | y | y | |
| `user-api.ts:136-138` abort after `Promise.all` | y | y | |
| `user-provisioner.ts:31-34,40-45,36-38` | y | y | fingerprint set post-await; late emit after `reset` is real |
| `wasm.ts:15-20` memoized init | y | y | |
| `wallet.ts:99-144` connect Map | y | y | |
| `wallet.ts:150-152` `.clear()` only | y | y | no `disconnect`; Breez API unverified here too |
| `cashu.ts:182-193` uncleared `Promise.race` timer | y | y | loser reject after win is an unhandled-rejection risk |
| `feature-flag-service.ts:24-40,47,83-88,104-107` | y | y | retries ignore `reset`; generation blocks *apply*, not the loop |
| `claim-cashu-token-service.ts:62-67` DomainError | y | y | |
| `claim-cashu-token-service.ts:161-171` `meltProofsIdempotent` random | y | y | |
| `claim-cashu-token-service.ts:263-348` / `:282-290` / `:292-294` | y | y | double-fire window is real |
| `task-processing-lock-repository.ts:21-28` `take_lead` | y | y | |
| `task-processor.ts` 21 LOC stub | y | y | |
| `events.ts:95-157,129-133` pubsub | y | y | |
| `contacts-api.ts:17-20,24-27,30-36,42-44` | y | y | |
| `contact-repository.ts:21-134` abort on queries | y | y | |
| `user-repository.ts:201` “Promise.all decrypt” | y | **n** | `:201-203` is `toAccount`, not decrypt |
| `user-repository.ts:305-307` “Spark wallet init” | y | **partial** | method def; call is `:290-291`; no `abortSignal` |
| `user-service.ts:45,78` / `account-service.ts:34` | y | y | plumbing |
| `account-repository.ts:187` wallet+proofs | y | y | |
| `transaction-repository.ts:84` “decrypt batches” | y | **partial** | `Promise.all(toTransaction)` — decrypt is inside `toTransaction` |
| receive/send repo `Promise.all` lines (`:63,:130,:205,:307,:290,:147,:281,:309`) | y | y | parallelism |
| `cashu-receive-quote-repository.server.ts:34,36-40` | y | y | `:36-40` is the “server cannot decrypt” JSDoc |
| quote service `abortSignal` (`:61,:54,:33`) | y | y | |
| `cashu-send-swap-service.ts:36-39` ctor | y | y | |
| `lightning-address-service.ts:286` NotFoundError | y | y | |
| `exchange-rate-service.ts:48-73` | y | y | |
| `supabase-realtime-manager.ts:64-72,87-91,99-101` | y | y | |
| `…:393-396` / `:481-483` hang | y | y | `clearTimeout` does not resolve the delay Promise |
| `…:456,512` `isProcessingResubscribeQueue` | y | y | |
| `…:452-517` queue worker | y | y | |
| `…:617` “tab goes offline into closeChannel” | y | **n** | `:617` is subscribe ERROR/TIMEOUT *while already* offline/inactive. Going offline is `setOnlineStatus(false)` at `supabase-realtime-hooks.ts:131`, which does **not** call `closeChannel` |
| `…:73-76,556-633` “postgres_changes fully connected” | y | **partial** | `:76` mentions a “comment below” that is **not in the file**. `:556-633` waits for `SUBSCRIBED`, not a postgres_changes ok |
| `supabase-realtime-hooks.ts:127-133` online/active | y | y | |
| `task-processing.ts:33-41,75-83` | y | y | 6 processors on the leader |
| quote-hook ranges (`384-421,440-443,460-502,397-403,486-495,611-676,714-723,364-460,449-457,135-189,181-189,280-444,185-189,346,337,387,453,178,199`) | y | y | |
| `spark-receive-quote-hooks.ts:449-457` warn no-op | y | y | unused inner `() => { console.warn(...) }` |
| `melt-quote-subscription.ts:96-99,134-149` | y | y | |
| mint/melt manager `5-8,35-50,72-79` | y | y | overlapping subscribe can drop callback |
| `transaction-hooks.ts:103-106` NotFoundError | y | y | |
| `use-exchange-rate.ts:37-41,71,78` | y | y | |
| `query-client.ts:5-6` no defaults | y | y | |
| `send-store.ts:181-192,399` | y | y | |
| `welcome-email-service.ts:48-50` ky retry | y | y | |
| `entry.server.tsx:17,30,100` | y | **partial** | `:17` is `streamTimeout` const; `setTimeout(abort)` is `:100` |
| `db/client.ts:12-20` / `database.client.ts:11-44` | y | y | |
| `with-retry.ts:44-57` JSDoc / `:66-77` abort only delays | y | y | `fn` is `() => Promise<T>` — no signal into `fn` |
| `delay.ts:25-28` / `timeout.ts:17-37` | y | y | |
| `packages/utils/src/index.ts:7-10` “current signatures” | y | **partial** | `:7-10` re-exports timeout, **xchacha20**, delay, with-retry |
| `package.json:66-71` TQ patch | y | y | root `patchedDependencies` |
| `apps/web-wallet/package.json:9` 8 GB heap | y | y | |
| `wallet-sdk/package.json:19` / `web-wallet/package.json:12` `bun test` | y | y | |
| `apps/web-wallet/app/lib/error.ts:1-14` | y | y | |
| “13 web call sites” `instanceof DomainError` | n/a | **n** | **13 files** total (incl. SDK `:62`); **18 web sites** / 12 web files |
| “10 `abortSignal` repos” | n/a | **n** | **13** `*repository*.ts` files (command in §1) |

LOC numbers in the draft inventory table all match `wc -l` at this commit (spot-checked every row, including 844/720/521/490/545/202/152/104/129/298/89/23/414/66/112/83/694/512/286/75/114/349/195/21/178/239/223/145/81/30/48). Test LOC 926 + 217 also match. `supabase-session.test.ts` is **141**, not cited as a number (Path 2 only names the file).

## 3. Inventory audit

Draft high-fit command and sum **3190** are correct. Grep 59 on `.ts/.tsx` is correct. Draft’s own `git grep` without a type filter is **60** because `packages/wallet-sdk/db/supabase/migrations/20260425181643_tighten_spark_send_payment_hash_uniqueness.sql:5` matches the word `retry`. They reported 59 to match the buyer and did not disclose the SQL hit.

### Required undercount checks

| Concern | Where | Draft? | Notes |
| --- | --- | --- | --- |
| Leader election | `task-processing.ts:33-41` TQ `refetchInterval: 5000`; `task-processing-lock-repository.ts:21-24` `rpc('take_lead')` | yes | Not AbortController. SQL TTL. Correctly medium/future. |
| Background poll loop | same `refetchInterval` + mint-quote poll `cashu-receive-quote-hooks.ts:384-421` (`10s` / `60s` on 429) + `use-exchange-rate.ts:71,78` (`15_000`) | **partial** | Draft covers leader + mint poll. Misses exchange-rate poll as a third TQ interval (low-fit; say so). |
| Realtime reconnect | manager `64-72,87-91,452-517` + hooks `127-133` | yes | Hang at `:393-396` vs `:481-483` is real. **Missed:** `removeChannel` has the same `clearTimeout` without resolve (`supabase-realtime-manager.ts:230-232`). |
| Quote-expiry scheduling | `setLongTimeout` at `melt-quote-subscription.ts:134-149`, `cashu-receive-quote-hooks.ts:486-495` | yes | Also `spark-receive-quote-hooks.ts:419-424` expires on Breez `synced` (not `setLongTimeout`). |
| Session expiry | `auth-service.ts:377-388` JWT `exp - 5s` | yes | |
| WASM init | `wasm.ts:15-20` | yes | Correct that Scope would not shorten it. Then **do not** put 21 LOC in the 3,190 “pain” total. |

### Hotspots the draft missed

| path | LOC (`wc -l`) | why it is control-flow |
| --- | --- | --- |
| `packages/wallet-sdk/lib/agicash-mint-auth-provider.ts` | 87 | Third generation fence (`:15,29-36,83-86`) + single-flight CAT (`:43-55`). Same class of bug as `supabase-session.ts`. Cleared from `sdk.ts:125`. |
| `packages/wallet-sdk/domain/send/proof-state-subscription-manager.ts` | 147 | Same overlapping-subscribe / drop-callback shape as mint/melt managers (`:39-50`). SDK-side, money-adjacent. |
| `apps/web-wallet/app/features/receive/receive-cashu-token-hooks.ts` | 392 | 4 grep hits; TQ + `instanceof DomainError` (`:299`); calls `melt`/claim via `/temporary`. Omitted from the inventory table. |
| `apps/web-wallet/app/features/user/auth.ts` | 380 | Host session-change choke point: `invalidateAuthQueries` `Promise.all` + key eviction (`:128-140`). Pair of SDK fencing. |
| `packages/wallet-sdk/domain/receive/spark-receive-quote-repository.server.ts` | 115 | `abortSignal` sibling of the listed `.server.ts` receive-quote repo. |
| `supabase-realtime-manager.ts:230-232` | (already in 694) | Hang is not only `closeChannel`. |

Grep files the draft correctly parked as low/negative (UI timers, `entry.server.tsx`, `welcome-email-service.ts`, `_protected.tsx:89`, `api.events.ts:168` `Promise.allSettled`) stay low-fit.

### Hotspots the draft overstated

- **`supabase-realtime-hooks.ts` (145)** is in the 3,190 high-fit sum while the table marks it **low** and Path 1 says “do not rewrite the React hook.” Padding.
- **`wasm.ts` (21)** and **`claim-cashu-token-service.ts` (349)** are in “the pain” while §6/§7 say do not convert money files and Scope does not shorten WASM. The 3,190 figure is not a migration surface.
- **`featureFlags` `NotImplementedError` (`sdk.ts:64-65`)** is extraction theater. Flags already run: `entry.client.tsx` calls `configureFeatureFlags`; `features/shared/feature-flags.ts` calls `refreshFeatureFlags` / `getFeatureFlag`. Not evidence that Effect would collide with missing product.

Pain ranked from this pass (no product steer): (1) session/key/token/CAT fencing, (2) realtime queue hang (`closeChannel` **and** `removeChannel`), (3) leaked Spark sessions + mint race timer + listener cleanup no-op, (4) untested money state machines, (5) three retry implementations. Agree with the draft’s order; extend (1) with the mint CAT fence and (2) with `removeChannel`.

## 4. Sketch audit

**Primitives used here.** `SynchronizedRef` = mutexed `Ref` (updates are serialized). **Fiber** = lightweight thread; interruption is cancellation. `Clock.sleep` = interruptible delay. `Schedule` = composable retry/repeat. `Queue` = in-process mailbox. `Scope` / `acquireRelease` = bracket (release on success, fail, or interrupt). `Deferred` = one-shot latch. `TestClock` = virtual clock. `ManagedRuntime` = constructed runtime you `dispose`.

### 4.1 Session keys (`session-keys.ts:114-132`)

| Question | Answer |
| --- | --- |
| Compiles on 3.22? | **No.** `SynchronizedRef.updateEffect` returns `Effect<void>` (`SynchronizedRef.d.ts:275`). `.pipe(Effect.flatten, Effect.flatten)` is a type error. The value-returning API is `modifyEffect` (`:169`). `disposed` / `sessionEnded` are free booleans, not live `AbortSignal` checks. |
| Semantics? | **No.** `updateEffect` serializes callers; current `inFlight` **shares** one promise (`session-keys.ts:113-132`). Success-only cache is not encoded (failed `fetch` vs aborted `inFlight` kept). Facade re-check (`:224-261`) is omitted. |
| Simpler? | Draft already says no. The sketch is also wrong, so it cannot be the spike’s target. |

### 4.2 Auth expiry (`auth-service.ts:372-389`)

| Question | Answer |
| --- | --- |
| Compiles on 3.22? | **In principle.** `Clock.sleep`, `Effect.uninterruptible`, `Effect.timeoutTo`, `TestClock`, `TestContext.TestContext` exist (exports + `TestClock.d.ts`, `TestContext.d.ts:14`). |
| Semantics? | **Partial.** `teardown` → interrupt scope matches `:284-288`. Guest persist **must** stay uninterruptible (`:202-221`) — correct. `Effect.timeoutTo` does **not** “encode the 5s margin”: the margin is `exp - 5` on a JWT (`:396-407`), a clock offset, not a timeout combinator. Residual race `:416-426` is unchanged — draft says so. |
| Simpler? | Happy-path timer, yes (TestClock vs `setTimeout` in 926-line `auth-service.test.ts`). Domain matrix, no. |

### 4.3 Realtime queue (`supabase-realtime-manager.ts:452-517`)

| Question | Answer |
| --- | --- |
| Compiles on 3.22? | APIs exist (`Queue.take`, `Clock.sleep`, `Duration.millis`, `Effect.forEach`, `Effect.forever`, `Fiber.interrupt`). |
| Semantics? | **No.** Current loop: for attempt `1..9`, sleep `delays[attempt-1]`, then **one** `resubscribeToChannel`, break if subscribed or channel gone (`:461-496`). Sketch `Effect.forEach(delays, ms => sleep(ms) *> resubscribe)` **always** walks the full table and resubscribes after every delay, including after success. Serial *topic* queue is also missing (`:87-91` is the reason the queue exists). `closeChannel` / `removeChannel` must complete the parked delay — Fiber interrupt does that; `forEach` is still the wrong program. |
| Simpler? | The retry *loop* would be, if written as `Schedule` + interrupt. The posted sketch is not that program. Strongest comparison in the draft is still the right spike experiment — rewrite the sketch first. |

### 4.4 Spark wait (`claim-cashu-token-service.ts:263-348`)

| Question | Answer |
| --- | --- |
| Compiles on 3.22? | APIs exist (`acquireRelease`, `Effect.race`, `Effect.timeout`, `Deferred.await`, `Duration.seconds`). Sketch leaves `paid` never completed (`onEvent` not wired). |
| Semantics? | **No.** Current: register listener, then `getPaymentByInvoice`; complete only if `status === 'completed'` (`:335-340`); timeout sets `resolved` and cleans up. Sketch `race(Deferred.await(paid), tryPromise(getPaymentByInvoice))` treats **any** lookup result as a win (including unpaid). Double-fire (`:292-298`) is fixed by `Deferred` (one-shot) — that part is right. |
| Simpler? | Yes vs 85 lines, as the draft says. Also yes as ~40 lines of `AbortSignal.timeout` + `Promise.withResolvers`. Do not start a migration here: `meltProofsIdempotent` `{ type: 'random' }` is `:161-171`. |

**Interop fact the draft left open:** `Runtime.runPromise(effect, { signal })` **is** in `effect@3.22.2` (`Runtime.d.ts:221-223`). Spike item 4 is a *runtime* check (Bun/Chrome interrupt), not a types check.

## 5. Cost audit

Draft bases I re-ran (`wc -l`):

```
# high-fit 15 files (draft command): 3190
# of which web: realtime-manager 694 + realtime-hooks 145 = 839
# of which utils: 81+30+48 = 159
# of which SDK high-fit: 3190-839-159 = 2192
# Path 2 sequenced files only (no claim, no realtime):
#   286+75+512+223+21+195+114+178 + ~20 of cashu.ts = 1624
# tests those slices already have: 926+217+141+122 = 1406
# Path D hook add: 844+720+521+490+545+202 = 3322
# abortSignal repos: 13 files (not 10)
```

**Path B LOC error.** Draft: “high-fit SDK files 3,190 minus realtime-hooks 145 = 3,045”. They subtracted the hook and **kept the 694-line web manager** inside an “SDK-internal” total. Correct SDK high-fit (including claim + cashu.ts, excluding utils) is **2,192**. Sequenced Path B without claim is **1,624**.

**Throughput math does not multiply.** Stated 150–250 touched LOC/week on 3,800–4,500 → **15–30 ew**, not 6–14. Path D: 8.5k / 150–250 = 34–57, ×2 money multiplier → 68–114, not 20–40. The ew ranges only match if you silently use ~300–600 LOC/week or the *corrected* (smaller) Path B LOC.

**Assumptions I challenge.** (1) Review 1.5–2× is not measured. (2) “400–600 LOC/week for utility wrappers” is plausible for slice 1; applying it to the 694-line manager is not — that file is product reliability, not a signature wrap. (3) Counting `claim-cashu-token-service.ts` + `wasm.ts` + realtime-hooks in “pain LOC” then forbidding those files inflates the headline. (4) Learning curve 4–6 days is an assumption; putting it inside B but not A is consistent only if A never leaks `Effect.gen` into the manager. Slice 2 of Path 1 *does*.

| Path | Draft LOC / ew | My LOC (command above) | My ew | Confidence |
| --- | --- | --- | --- | --- |
| A utils only | 159 / (inside 1–3) | 159 + new tests | **0.5–1.5** | **high** |
| A as written (utils + manager + auth timer) | 850–1,100 / 1–3 | 159+694+~40 = ~893 | **2–5** | medium-low (manager needs a long-lived runtime; not a wrapper) |
| B SDK-internal (no claim, no web realtime) | 3,800–4,500 / 6–14 | 1,624 prod + ~1,400 test rewrite ≈ 3.0–3.5k touched | **6–16** | low-medium |
| C B + realtime + mint/melt managers | 4,900–5,500 / 10–18 | ~3.0k + 694 + 152+104+129+147 proof-state ≈ 4.2–4.8k | **10–20** | low |
| D + quote hooks | 8.5–9.5k / 20–40 | ~4.5k + 3,322 + 392 token-hooks ≈ 8.2–9.2k | **20–50** | low |
| Schema + tagged errors | 4–10 / negative | 53 zod files + 19 `instanceof` sites | **4–10, negative ROI** | medium |
| 3.22 → 4.0 later | 1–3 ew | unknown import-path rewrite; 4.0 tarball 48.9 MB vs 27.2 MB | **1–4** | low |

3 → 4: `4.0.0-rc.117` is real (registry `time` 2026-09-21). First `4.0.0-rc.*` on the registry listing I saw is **rc.108 (2026-08-12)** after July betas — “months of RC” is ~5 weeks of RC + ~2 months of 4.0 pre-release. Directionally right; tighten the wording. `@effect/platform@0.97.2` and `@effect-atom/atom-react@0.7.0` still peer 3.22.x. Do not take the RC.

## 6. Adoption-path audit

**Fiber** (reminder): interruption is the cancel model. A long-running worker is `runFork`, not `runPromise`.

| Path | First slice real? | Stop-halfway holds? |
| --- | --- | --- |
| 1 Utility-first | **Slice 1 yes:** `packages/utils/src/{with-retry,delay,timeout}.ts` exist (159). Signatures live on the functions, not `index.ts:7-10` (that re-export list includes `xchacha20poly1305`). **Slice 2 strained:** manager exists (`:452-517`) but Path 1 interop only specifies `runPromise` inside three functions. A `Queue` + `Effect.forever` worker needs a **persistent runtime / fiber** the draft never places. | After slice 1: **yes** (one dep, same signatures). After slice 2: **weak** — Effect runtime owned by a React-mounted web class, no `ManagedRuntime` story. |
| 2 SDK-internal | **Yes:** `session-keys.ts` 286 + `supabase-session.ts` 75 = 361; tests 217 + 141 exist. Public `packages/wallet-sdk/index.ts` is Promise-shaped. | After (1)–(3): **yes**, matches today’s façade over OS / Supabase / Breez. After (7): quote hooks still call classes. Collides with `/temporary` (`index.ts:1-9`, `temporary.ts:1-5`) — real. |
| 3 union | First slice “1 or 2, not both” is the right constraint. | Holds only if 1 or 2 is finished. |
| Schema-only | 53 `zod/mini` files exist. Gift-card Node entry forbids extra imports (`wallet-sdk/package.json` `exports:comments` `./gift-card-config`). | N/A — correctly rejected. |

**Boundaries.**

- **React Router client / `.server.ts`:** 5 server files (`instrument.server.ts`, `require-session-hint.server.ts`, `database.server.ts`, `cookies.server.ts`, `canonical-origin.server.ts`). Loaders should stay on Promise APIs (draft is right). Path 1 puts Effect in `@agicash/utils`. Today `withRetry` callers are `user-api.ts:122,145` and `cashu-receive-quote-hooks.ts:460` — both client. If a later server import pulls utils, Effect loads on Vercel Node; that is fine for the library and fatal for the gift-card Vite/Node split if the import graph ever reaches `./gift-card-config`.
- **TanStack Query:** `query-client.ts:5-6` has no defaults. Quote processors *are* TQ mutations (`cashu-receive-quote-hooks.ts:611-676` `retry: 3`). `runPromise` inside `queryFn` is the only sane interop. `@effect-atom/atom-react@0.7.0` peers `react >=18 <20` (we are **19.2.4**, in range) and would replace the patched `@tanstack/query-core@5.90.20` (`package.json:66-71`). Keep TQ. Path 1 slice 1 still puts Effect under a TQ-called `withRetry` on a mint-quote path (`cashu-receive-quote-hooks.ts:460-466`).
- **Supabase realtime:** `@effect/sql@0.52.1` is a SQL toolkit (and needs `@effect/experimental`). Not PostgREST/RLS. Dual-wire `query.abortSignal` (`task-processing-lock-repository.ts:26-28`) is mandatory — a Fiber interrupt does not cancel the JS client. Path 1 slice 2 fights the Phoenix socket *and* React `useEffect` cleanup (`supabase-realtime-hooks.ts:95-107`) unless the class API stays frozen *and* a runtime lives outside React.
- **`bun test`:** runner is `bun test` (`wallet-sdk/package.json:19`, `web-wallet/package.json:12`). `@effect/vitest@0.30.0` requires `vitest ^3.2.0` — cannot use. `TestClock` / `TestContext` from `effect` itself is the path. Highest payoff remains `auth-service.test.ts` (926). Utils have **zero** tests today — slice 1’s real work is writing them.

**Rank first:** Path 1 **slice 1 only** (utils behind current signatures + the tests the package lacks). It is the only Effect slice whose stop-halfway state is coherent, does not need a `ManagedRuntime`, and does not move proofs. I would **not** attach the realtime manager as “utility-first slice 2” — it is a different risk class (web reliability, persistent fiber, 694 LOC). Path 2 is the right *shape* if a 2027 option is wanted, and the wrong 2026 project while `/temporary` and `sdk.ts:58-69` are open.

The draft’s “do the plain-TS fixes now” is still the first engineering move. That is not an Effect path.

## 7. Missing arguments

### Steelman FOR a spike (draft under-sold this)

1. **Three generation fences and growing.** `supabase-session.ts:32-41`, `feature-flag-service.ts:47,104-107`, `agicash-mint-auth-provider.ts:15,83-86`. The next SDK slice will add a fourth. A `Scope` + interrupt is the library for this; copying the counter is how the CAT leak class returns.
2. **`withRetry` cannot cancel `fn`** (`with-retry.ts:66-77`, JSDoc `:33` admits “cancel pending retry delays”). Fiber interrupt is the primitive the helper is missing. Plain-TS “pass `signal` into `fn`” (~10 LOC) also works — the spike’s job is to prove whether `Schedule` + interrupt is *shorter to get right* under a predicate that skips `SessionEndedError` (`user-api.ts:130-133`).
3. **`Runtime.runPromise({ signal })` exists in 3.22.2.** AbortSignal interop is not an open types question. The spike measures Bun/Chrome interrupt of `sleep` / `tryPromise`.
4. **TestClock vs 926 lines of `setTimeout(..., 0|10|200)`.** If a spike deletes ≥400 lines *and* catches the guest-expiry race documented at `auth-service.ts:416-426`, that is the only quantitative win that would change a no-go. The draft lists this as evidence-that-would-change; it should also be the steelman *for* spending the week.
5. **Last cheap moment to hide a runtime.** `send` / `transfer` / `taskProcessor` are not on the SDK yet (`sdk.ts:58-69`). Putting Effect behind the Promise façade *before* those slices land is cheaper than after. Waiting “until extraction finishes” may mean wrapping a larger graph.
6. **`Effect.Micro` is unmentioned.** It is a 3.22 export (package `exports["./Micro"]`). Smaller surface than `Layer`+`Schema`+`Stream`. A spike that only needs `Schedule` + interrupt should evaluate Micro before full `Effect.gen` + `ManagedRuntime`.
7. **Queue hang is structurally unrepresentable** if the delay is `Clock.sleep` on an interruptible fiber. The plain-TS fix is ~30 LOC and easy to get subtly wrong again (`removeChannel` already copies the bug at `:230-232`). That is the honest “stdlib vs 30 lines” case.
8. **4.0 has no date.** Sitting out 3.22 until 4.0 stable is itself a decision with unbounded wait. A 1-week 3.22 spike that is thrown away at 4.0 still leaves measured gzip/`tsc`/TestClock numbers.

### Steelman AGAINST (draft has most; these were omitted)

1. **Path 1 slice 1 still ships Effect on a mint-quote path.** `cashu-receive-quote-hooks.ts:460-466` calls `withRetry`. “Utils are not money paths” is false once the helper is shared.
2. **Gift-card Node entry.** `./gift-card-config` must import only zod (`wallet-sdk/package.json` `exports:comments`). Any later Effect import that lands in that graph breaks the Vercel build. The draft says this for Schema; it applies to *any* Effect import creep.
3. **`@effect/sql` also peers `@effect/experimental ^0.61.1`.** Worse mismatch than stated.
4. **Host `instanceof` surface is already inconsistent.** Public `index.ts:14-21` does not export `NoSessionError` / `DisposedError` / `NotImplementedError`, but the draft treats them as a published host contract. Adding `_tag` / `TaggedError` on top of an incomplete export list is more contract work, not less.
5. **Sketches in the draft do not compile / do not preserve semantics** (§4). A team new to Effect will cargo-cult them. That is a reason not to spike from this document until the sketches are fixed.
6. **`4.0.0-rc` is ~5 weeks, not “months.”** The 3 → 4 tax is real; the timeline wording overstates certainty that 4.0 is “stuck.”

### Plain-TS alternative

The §8 bug table is the right alternative and the citations are good. Add `removeChannel` (`:230-232`) and the mint CAT fence (`agicash-mint-auth-provider.ts:28-36` still *returns* a late token, same as `supabase-session.ts:64`). `AbortSignal.timeout` / `AbortSignal.any` / `Promise.withResolvers` are unused (0 hits). A 150-line expiry scheduler is still a smaller stdlib than 27 MB of types.

What plain TS does **not** give: TestClock, structural interrupt of a retry loop, or one implementation of the three generation fences. That is the entire remaining case for a spike.

## 8. Findings

1. **Critical** — `01-assessment.md:364` Path B “3,045 LOC”. Evidence: high-fit `wc -l` = 3190 includes `supabase-realtime-manager.ts` (694, web). Edit: Path B base = 3190 − 694 − 145 − 159 = **2,192** SDK high-fit, or **1,624** sequenced files; recompute ew.
2. **Critical** — `01-assessment.md:373-375` 150–250 LOC/week vs 6–14 / 20–40 ew. Arithmetic does not hold on the published LOC. Edit: pick one throughput and multiply; or drop the throughput sentence.
3. **Critical** — `01-assessment.md:196-202` session-keys sketch. `updateEffect` → `Effect<void>` (`SynchronizedRef.d.ts:275`). Edit: use `modifyEffect`, live `AbortSignal`, shared in-flight, or delete the sketch.
4. **Critical** — `01-assessment.md:259-270` realtime sketch. `forEach(delays)` ≠ retry-until-success (`supabase-realtime-manager.ts:461-496`). Edit: `Schedule.exponential` / indexed delays + interrupt on subscribed/closed; one fiber per topic, serial mailbox for the socket.
5. **Important** — `01-assessment.md:329` “13 web call sites”. Evidence: 13 files / 19 sites / 18 web (`git grep` in §1). Edit: “18 web sites in 12 files; plus `claim-cashu-token-service.ts:62`.”
6. **Important** — `01-assessment.md:373` “10 abortSignal repos”. Evidence: 13 `*repository*.ts` files (§1). Edit: 13; include `spark-receive-quote-repository.server.ts`.
7. **Important** — `01-assessment.md:254` `closeChannel` (`617`) as the offline path. Evidence: `:617` is already-offline subscribe failure; offline handler is `supabase-realtime-hooks.ts:131` and does not close. Edit: cite `:617` correctly; add `removeChannel` `:230-232` as a second hang.
8. **Important** — `user-repository.ts:201` cited as decrypt. Evidence: `:201-203` `toAccount`. Edit: drop or point at the decrypt call inside `toAccount`.
9. **Important** — high-fit 3,190 used as “the pain” (`01-assessment.md:13,148`) while including low-fit hooks, WASM, and a money file Path B says not to touch. Edit: publish two numbers — defects (~1.6k sequenced + 694 manager) vs grep-accounted table.
10. **Important** — missed `agicash-mint-auth-provider.ts:15-86` (87 LOC) and `proof-state-subscription-manager.ts` (147). Edit: add both to §2; CAT fence next to `supabase-session.ts`.
11. **Important** — Path 1 slice 2 has no runtime home (`01-assessment.md:389-401`). `Effect.forever` is not `runPromise`. Edit: require a `ManagedRuntime` (or drop slice 2 from Path 1).
12. **Important** — Path 1 “utils are not money” (`01-assessment.md:379`). Evidence: `cashu-receive-quote-hooks.ts:460-466`. Edit: say Effect will load on a mint-quote path the day `withRetry` is rewritten.
13. **Important** — `index.ts:14-21` does not export `NoSessionError` / `DisposedError` / `NotImplementedError`. Edit: host-contract table vs public exports.
14. **Important** — claim sketch races unpaid `getPaymentByInvoice` (`01-assessment.md:294-300` vs `claim-cashu-token-service.ts:335-340`). Edit: succeed only on `status === 'completed'`; complete `Deferred` from `onEvent`.
15. **Minor** — draft `git grep` → 60 including `.sql:5`. Edit: filter `*.ts`/`*.tsx` or report 60.
16. **Minor** — “months of RC” (`01-assessment.md:7,377`). Registry: 4.0 betas July 2026, `rc.108` 2026-08-12, `rc.117` 2026-09-21. Edit: “~5 weeks RC, ~2 months 4.0 pre-release.”
17. **Minor** — `@effect/sql` peer `@effect/experimental ^0.61.1` omitted. Edit: add to §1 table.
18. **Minor** — `Effect.timeoutTo` for the 5s JWT margin (`01-assessment.md:234` vs `auth-service.ts:396-407`). Edit: call it a clock offset.
19. **Minor** — `entry.server.tsx:17` is the constant, not `setTimeout` (`:100`). Edit: `:100`.
20. **Minor** — `postgres_changes` comment at `supabase-realtime-manager.ts:76` has no matching comment below. Edit: do not cite `:556-633` as that wait.
21. **Minor** — `Runtime.runPromise({ signal })` marked unverified (`01-assessment.md:60,325,514`). Types confirm it. Edit: “types yes; runtime in Bun/Chrome still to measure.”
22. **Minor** — `packages/utils/src/index.ts:7-10` as the signature boundary includes `xchacha20poly1305`. Edit: cite `with-retry.ts:58`, `delay.ts:10`, `timeout.ts:17`.
23. **Minor** — `receive-cashu-token-hooks.ts` (392) and `auth.ts:128-140` omitted from the table. Edit: add as low/medium rows so the 59-file grep is fully accounted.
24. **Minor** — `featureFlags` throw used as extraction risk without noting `configureFeatureFlags` already runs from `entry.client.tsx`. Edit: one sentence.

## 9. Assumptions and open questions

**Assumptions (not blocked).** Pin for citations is `887bdc48`; current HEAD only adds the draft. Team is 1–2 seniors, zero Effect production time. Bun test stays. Supabase JS stays. `instanceof SdkError` subclasses that *are* exported stay. PWA can absorb tens of kB gzip if Schema/Stream stay out. Leader election stays SQL `take_lead`. Quote-hook `retry:` is product policy. Breez wallets should be disconnected on sign-out if the API exists — leak claim stands as “Map dropped without teardown.” Throughput for my ew ranges: 150–250 LOC/week Effect-new including tests/review; 400–600 for signature-stable utils. `Effect.Micro` is in 3.22.2 because the package exports it; I did not read its `.d.ts` beyond the export map. “Months of 4.0 pre-release” from registry version lists (July betas).

**Open questions.** Breez `disconnect`/`close` against `@agicash/breez-sdk-spark` types (no typings in this workspace). Tree-shaken gzip in *this* Vite 7 graph. `tsc` + heap with Effect 3 inference (dev already `--max-old-space-size=8192` at `apps/web-wallet/package.json:9`). Whether `runPromise({ signal })` interrupts `tryPromise` of a Supabase builder in Bun 1.3.11 and Chrome. Whether 4.0 stable lands in 2026. Whether the team would accept `@effect/language-service` next to Biome 1.9.4.

---

The draft’s recommendation survives: fix the defects in TypeScript; keep a 2027 option; do not migrate. Its sketches and Path B numbers do not survive. Rank a spike — if any — as Path 1 slice 1 plus a throwaway TestClock prototype of `setExpiryTimer`, after the §8 edits, targeting `effect@3.22.2`.
