# Wallet SDK Background Runtime Slice (Step 18, sub-slice 1) Implementation Plan

> **Orchestration note:** one whole-slice contribution job, after adversarial review of this plan. The implementer forks at `master` @ `210572602055265fdba653e92fc0c01e75d2491a` (step 17 merge, PR #1192) on branch `sdk/background-runtime-slice` and delivers the File map together. The orchestrator integrates, runs the Verification gates, then sends the diff to adversarial review. All `path:line` citations are valid at `210572602055265fdba653e92fc0c01e75d2491a`. Stack: TypeScript, bun, bun:test, Supabase, React Router v7 framework mode (`apps/web-wallet/package.json:73`, `@react-router/dev` `7.14.2` at `:82`). No React and no `@tanstack/react-query` in the SDK.

**Goal:** Replace the throwing `taskProcessor` getter with a real `TaskProcessorApi`: a React-free leader loop that calls the existing `take_lead` RPC on the same 5s / 6s cadence as the web poll, exposes `state`, and emits `task-processor.state-changed` on every transition. The web calls `start()` / `stop()` and mounts the existing six `useProcess*Tasks` hooks only while `state === 'leader'`. The realtime change-feed stays in the web (decision 2).

**Architecture:** Step 18 sub-slice 1 of the no-cache extraction (`docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md:68–116`, step 18 at `:96–108`). The pinned surface is `TaskProcessorApi` (`packages/wallet-sdk/domain/sdk/task-processor.ts:1–21`), wired like earlier namespaces: a factory the `AgicashSdk` constructor assigns, the way `createTransferApi` is assigned for `transfer`. The prose contract still says `sdk.background` and `background.state-changed` (`docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md:267`, `:363`, `:414`). The pinned names win: `sdk.taskProcessor`, event `task-processor.state-changed` (`events.ts:75–78`). Sub-slice 2 (port each flow's processor) and sub-slice 3 (web drops its realtime layer and subscribes to SDK domain events) stay landable on top of this slice; neither is implemented here (decisions 1 and 2, Out of scope).

## Global constraints

- **No contract drift.** Do not edit `packages/wallet-sdk/domain/sdk/task-processor.ts`, `domain/sdk/events.ts`, `domain/sdk/index.ts`, or `packages/wallet-sdk/index.ts`. (Amended 2026-10-13: the maintainer approved one additive contract change in `domain/sdk/index.ts` — the `ActivityMonitor` type, the `alwaysActive` export, and the required `SdkConfig.activity` field; see "Activity port".) `start(): void` throws an `SdkError` when there is no authenticated session (`task-processor.ts:10–13`). `stop(): Promise<void>` matches the JSDoc (`:14–19`). `state` is `'stopped' | 'follower' | 'leader' | 'error'` (`:1`, `:20`). Do not add a `background` alias, a processor-registration method, or a `userId` parameter (proposal `:297–301`: user id is implicit).
- **React-agnostic.** `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`. The loop is a hand-rolled scheduler. No new dependencies, no `bun add`. `bun` / `bunx` only.
- **No schema, RPC, or migration changes.** The only lock write is the existing `wallet.take_lead` (`packages/wallet-sdk/db/supabase/migrations/20260112150000_initial_db.sql:3461–3512`). Lease is `now() + interval '6 seconds'` (`:3473`). Do not add a release RPC, do not `UPDATE` or `DELETE` the lock row, do not run `db:generate-types`.
- **Behavior parity for the lock.** 5s poll (`apps/web-wallet/app/features/wallet/task-processing.ts:39`), immediate attempt on start, skip interval ticks while the document is hidden (`:40`, decision 4), same client id across renewals, one in-flight `take_lead` at a time. The SQL row stays the one-leader mechanism across an old bundle and a new bundle. This slice removes the web poll in the same change that starts the SDK loop, so one tab never runs both.
- **SDK diagnostics go through `Logger`.** The SDK never writes to the console (`domain/sdk/index.ts:33–39`). The web logger forwards to `console.*` (`apps/web-wallet/app/features/shared/sdk.client.ts:45–54`).
- **Biome `recommended` is on** (`biome.jsonc:22`), including `noUnusedVariables` / `noUnusedImports` (`:64`, `:68`), `noAssignInExpressions` (`:72`), `noEmptyBlockStatements` (`:83`). Do not use the `delete` operator. `bun run fix:all` may rewrite import order; revert any path outside the File map.
- **Session fence.** A `take_lead` started under generation N is applied only if N is still current. `stop()` bumps the generation and aborts the in-flight call (`TaskProcessingLockRepository.takeLead` already takes `abortSignal`, `task-processing-lock-repository.ts:16–28`). A late `true` must not move `state` to `'leader'`. This loop does not throw `SessionEndedError` (nothing host-facing awaits `take_lead` except `stop()`, which swallows the abort). `start()` throws `NoSessionError` (`lib/error.ts:34–40`) or lets `DisposedError` (`:42–48`) propagate from `getLiveSession` (`sdk.ts:137–142`).
- Only File-map files change. Base: `master` at `210572602055265fdba653e92fc0c01e75d2491a`.

## Resolved design decisions

1. **(a) The six web processors keep running by mounting `<TaskProcessor />` only while `state === 'leader'`.** `TaskProcessor` stays the component that calls the six hooks (`task-processing.ts:75–82`): `useProcessCashuReceiveQuoteTasks` (`cashu-receive-quote-hooks.ts:600`), `useProcessCashuReceiveSwapTasks` (`cashu-receive-swap-hooks.ts:160`), `useProcessCashuSendQuoteTasks` (`cashu-send-quote-hooks.ts:270`), `useProcessCashuSendSwapTasks` (`cashu-send-swap-hooks.ts:415`), `useProcessSparkReceiveQuoteTasks` (`spark-receive-quote-hooks.ts:467`), `useProcessSparkSendQuoteTasks` (`spark-send-quote-hooks.ts:402`). The SDK runner does not call them and has no processor list. The web reads `sdk.taskProcessor.state` through `useSyncExternalStore`, subscribed to `task-processor.state-changed`. **Rejected:** a `/temporary` registration seam the runner drives. The hooks are React hooks over the web TanStack caches (representative: `useMutation` at `cashu-receive-quote-hooks.ts:611`, `useQueries` at `cashu-receive-swap-hooks.ts:188–201`). The SDK cannot call them, and extracting them is sub-slice 2. A register method is also not on `TaskProcessorApi`. **Rejected:** auto-starting processors inside `start()` by importing the web hooks.

   Tab close and handoff, matching today:

   - **Tab close / process kill.** No `pagehide` / `beforeunload` handler (master has none). The timer dies with the page. The row's `expires_at` lapses. Another client's next `take_lead` can win once `expires_at <= now()` (`initial_db.sql:3501–3507`).
   - **Visible follower.** `take_lead` returns false. `state` stays `'follower'`. `<TaskProcessor />` is not mounted. Same as `takeLeadResult ?? false` (`task-processing.ts:66`, `wallet.tsx:57–61`).
   - **Hidden leader.** Interval ticks do not call `take_lead` and do not change `state`. A hidden tab that was leader stays `'leader'`, so `<TaskProcessor />` stays mounted and keeps processing. Master does this: `refetchIntervalInBackground: false` skips the fetch while `focusManager` is unfocused, and the query data stays at the last `true`, so `isLead` stays true. **Rejected:** demoting to `'follower'` on `visibilityState === 'hidden'`. That would unmount the only tab's processors immediately and open a gap until some visible tab's next poll, which master does not have.
   - **Return to visible.** One immediate `take_lead` (master's default `refetchOnWindowFocus`, below). `false` moves `'leader' → 'follower'` and unmounts `TaskProcessor`. `true` keeps `'leader'`.
   - **Two tabs.** Both poll `take_lead` with their own client id. The SQL function is the mutex. A hidden leader and a visible leader can both have processors mounted until the hidden tab refocuses and observes `false`. That overlap exists on master. Do not add a client-side mutex to close it.
   - **One tab, one loop.** Delete `useTakeTaskProcessingLead`. Do not leave the TanStack poll beside the SDK loop.

   Sub-slice 2 lands without rework by deleting one `useProcess*` call from `TaskProcessor` in the same commit that teaches the runner that one flow, and by pushing that flow's in-flight iteration onto the checkpoint set `stop()` already races (decision 3). The runner starts with no flow invocations, so a half-ported flow cannot run twice.

2. **(b) The realtime change-feed does not move in this slice.** `useTrackWalletChanges` (`use-track-wallet-changes.ts:92–149`), `useSupabaseRealtime` / `useSupabaseRealtimeActivityTracking` (`supabase-realtime-hooks.ts:57–145`), `agicashRealtimeClient` (`database.client.ts:51–55`), and `root.tsx`'s `SupabaseRealtimeError` branch stay byte-identical. `wallet.tsx` still calls `useTrackWalletChanges()` (`:53`) and `useSupabaseRealtimeActivityTracking(agicashRealtimeClient)` (`:54`). This slice emits no `connection.changed` and does not mention the topic `wallet:${userId}` (`use-track-wallet-changes.ts:81`).

   The spec groups the change-feed into sub-slice 1 (`2026-06-24-wallet-sdk-no-cache-production-design.md:97`) and leaves "web drops its realtime layer and subscribes to SDK events" as sub-slice 3 (`:99`). Moving the socket now is rejected for four reasons a reviewer can falsify:

   - **Lifecycle.** `events.on` does not open the channel; a session does (`events.ts:82–85`, proposal `:402–408`). `taskProcessor.start()` is a separate, host-called entry that throws with no session (`task-processor.ts:10–13`). Feed death is `connection.changed: 'error'`, not a task-processor failure (proposal `:288–290`). Owning the socket inside the processor would force sub-slice 3 to split that coupling. The hard constraint is that the socket must not hang off `taskProcessor.start()`; sub-slice 3 opens it from session establishment (plan-attack F4 narrowed this bullet).
   - **Invalidate timing.** The 13 `invalidate()` calls run from `onConnected` (`use-track-wallet-changes.ts:131–147`), including the first connect. `connection.changed` is not replay-latest; only `auth.session-started` is retained (`events.ts:97–118`, cleared at `:165–167`). Session establishment happens in `init()` / the protected client middleware, before `Wallet` mounts (`_protected.tsx:109`, `:145–167`). Opening the channel on session start in this slice would emit `connected` before the web subscribed, and the 13 invalidates would not run. Opening it from a temporary bridge at `Wallet` mount, and also leaving the current subscriber, would invalidate twice and fan out the 10 handlers twice.
   - **Operational logs live on the web client (corrected per plan-attack F4).** The redacting realtime logger exists only on `agicashDbClient` (`database.client.ts:19–42`); `createAgicashDbClient` sets none (`db/client.ts:12–20`) and `realtime-js` defaults the logger to a no-op, so an SDK-owned socket would be silent, not leaky. Moving the socket in this slice would drop the production realtime diagnostics the web relies on until sub-slice 3 re-homes them onto `Logger`.
   - **The manager is not a mechanical move.** It logs through `console.debug` (`supabase-realtime-manager.ts:52–58`) while the SDK sink is `Logger`. The reconnect state machine is the rest of that file (`:93` onward, active/online gating at `:357–373`). Rewriting it in the same change as the lock flip is the risk sub-slice 3 is allowed to take alone, against the handler list that already exists.

   **Rejected:** move the manager, bridge raw `{ event, payload }` through `/temporary`, and emit `connection.changed` from this slice. Sub-slice 3 would delete that bridge (the handlers would move twice) and would still have to re-home establishment onto the session, which is the rework this decision avoids. The later slice's diff stays "replace the body of `useTrackWalletChanges`". Landing constraints for that slice are in Out of scope. The implementer of this plan does not move the feed, even partially.

3. **(c) `stop()` drops the loop synchronously, aborts the in-flight `take_lead`, and resolves when that call settles or 5s elapses. It does not write the lock row.** Master's unmount does not await anything: the query disappears, the lock lapses by TTL. The contract requires a promise (`task-processor.ts:14–19`, proposal `:292–295`, `Sdk.dispose` at `domain/sdk/index.ts:91–96`).

   **Checkpoint, this slice.** The only in-SDK iteration is one `take_lead`. Its checkpoint is that promise settling (resolve, reject, or abort). `stop()`'s synchronous prefix, before its first await: bump generation, set `inFlight` to false (the attempt that is still between `await`s clears `inFlight` in `finally` only if its generation is still current, so this prefix is what lets a same-turn `start()` arm a new attempt), clear the interval, unsubscribe activity, abort the attempt `AbortController`, resolve a pending retry delay, wake a pending "runnable" wait, set `state` to `'stopped'` (and emit if that is a change), forget the last lead boolean (`clientId` persists on the instance, plan-attack F3). It then races `Promise.all` of the checkpoint promises already recorded (each rejection mapped to `undefined`) against a 5_000ms timer. Whichever finishes first resolves `stop()`. The timer is cancelled if the checkpoints win, so a fast abort does not leave a 5s timer. The completion callback does not write `state`.

   **Checkpoint, the React processors.** They are not in the set. Unmounting `TaskProcessor` when `state` leaves `'leader'` stops scheduling new hook iterations. In-flight `useMutation` work is not joined. Master doesn't join it either (no cleanup await in `task-processing.ts`). Sub-slice 2 appends a promise to the same set for each in-flight flow iteration and removes it when that iteration returns (one quote/swap attempt, including that attempt's own retries). `stop()` already races the set. Sub-slice 2 does not replace `stop()`. It may raise `STOP_CHECKPOINT_TIMEOUT_MS` in that later slice if mint round-trips need a longer bound; the race stays.

   **Release.** "Releases the leader lock" means stop renewing. There is no release function in the migration (the only lock routine is `take_lead`, `:3461–3512`). The last successful call set `expires_at` to `now() + 6 seconds`. **Rejected:** `DELETE` or `expires_at = now()` under RLS. That is a new write, it shortens the lease, and a second client can enter before the previous processors have observed `'stopped'`. **Rejected:** blocking `stop()` on the React unmount. `start(): void` cannot await, and `stop()` has no hook back into React.

   **Who awaits.** `dispose()` sets `this.disposed = true` FIRST and then awaits `stop()` (maintainer review 2026-10-13 re-flipped the original pin: `stop()` reads neither the session nor the flag, so it runs fine after the flag, and flag-first makes a `start()` during the drain throw `DisposedError` instead of arming a loop that outlives the instance). `AuthService.endSession` is synchronous (`auth-service.ts:359–368`) and already runs `onSessionEnded` after the snapshot is cleared (`:361`, `:367`). This slice does not edit `auth-service.ts`. `onSessionEnded` calls `void taskProcessor.stop()` as its first statement, before `sessionToken.reset()` (`sdk.ts:121`). The synchronous prefix therefore runs before `signOut()` resolves (`auth-service.ts:230–236` calls `endSession()` in `finally`). That is what `AuthApi.signOut`'s "Stops the task processor" sentence requires (`auth.ts:38–41`). The web effect also calls `void stop()` on cleanup. Both are idempotent. **Rejected:** making `endSession` async so `signOut` can await the checkpoint. Every `onSessionEnded` spy in `auth-service.test.ts` is written against the sync callback, and disposal-is-not-sign-out (`auth-service.ts:275–282`) must stay.

4. **(d) Activity gating comes from a host-supplied `ActivityMonitor` (`SdkConfig.activity`, required; the SDK reads no platform globals). SSR does not call `start()`.**

   **Superseded by the single-flag model (maintainer 2026-10-13b).** The port carries ONE bit — `isActive()`: can and should this client run background work now — and the host computes it (the web adapter reports foreground AND online; a never-suspended host returns a constant true). Rationale: a backgrounded client may be throttled, frozen, or killed by its platform, so it is as unreliable as an offline one; both must stop renewing so a live client takes the lease. The runtime no longer distinguishes the two: every attempt path (mount, interval, resume, parked-retry release) gates on `isActive() && !inFlight`. Two deliberate deviations from the TanStack-parity baseline below: a hidden tab no longer mounts into leadership (it attempts on first activation), and a hidden tab no longer renews on an offline→online flip (the lease lapses to a live client within ~11s). The per-flag bullets below describe the pre-collapse parity baseline and stand as history. Master: `clientId` is `''` when `typeof window === 'undefined'`, and the query is `enabled: !!clientId` (`task-processing.ts:25–34`), so SSR issues no `take_lead` and starts no timer. `@tanstack/react-query` `5.90.20` (`apps/web-wallet/package.json:55`) with an unconfigured `QueryClient` (`query-client.ts:6`) then does all of the following on the client. Copy the observable policy, not the library:

   - **Immediate attempt on start,** even when the document is hidden. The initial `useQuery` fetch is not gated on focus. A background-opened tab can become leader and, per decision 1, stays leader without renewing.
   - **`setInterval(..., 5000)` armed at start,** not "5s after the RPC returns". A tick calls `take_lead` only when foreground and online and no attempt is in flight. A tick while hidden does not change `state`.
   - **Active** comes from the host's monitor. The web adapter maps it to `document.visibilityState !== 'hidden'` and listens to `visibilitychange`, the event TanStack's focus manager uses — not `focus` / `blur`. The runtime itself only calls `isActive()`.
   - **Becoming foreground while the loop is running:** one immediate `take_lead` if foreground and online and nothing is in flight. This is `refetchOnWindowFocus` (library default `true`, stale time default `0`, so every return refetches).
   - **The `online` event while idle renews even when hidden (plan-attack F2).** Master's `Query.onOnline` refetches without consulting the focus manager (`query-core` `query.js` `onOnline`; default `refetchOnReconnect` is on for an unconfigured client). The SDK therefore calls `take_lead` on an offline→online flip when `isOnline() && !inFlight`, foreground not required. The kind-less activity callback cannot say which event fired: the runtime remembers the previous `isOnline()` value and treats a false→true change as this reconnect kick. A parked retry is different — it resumes only when foreground and online (`retryer` `canContinue`).
   - **Online flag starts `true`.** Flip it only on `window` `offline` / `online`. Do not read `navigator.onLine` at construction. TanStack's online manager starts `true` and learns from events; a page that loads offline still attempts until an `offline` event.
   - **Retry pause.** After a failed attempt's delay, if the document is hidden or the online flag is false, wait until both are clear before the next try. The wait does not consume a retry. Only `stop()` or an activity change that lands runnable (foreground and online) wakes the wait (plan-attack F1): a hidden or offline interval tick must not release it, and after any wake the loop re-checks runnable and parks again when it is not. Master keeps a paused retry stuck until focus plus online (`retryer` `canContinue`), and a hidden interval tick never fetches (`queryObserver` interval gate), so a released-by-tick hidden `take_lead` would be a second-leader sequence master cannot run. *(Superseded 2026-10-13d: no pause — the bid is abandoned and the next activation restarts it; see the Runtime-behavior note.)*
   - **No signal.** A host without one passes the exported `alwaysActive` monitor (active true, online true, no-op subscribe): `start()` polls unconditionally. That is the MCP host (proposal `:267–268`: a request/response host must call `start()` or nothing moves money). **Rejected:** treating "no signal" as "`start()` is a no-op". That would make the headless host's `start()` silent. **Rejected:** an optional config field with an always-active default — a browser host that forgot it would silently lose the hidden-tab economy; required-with-exported-default makes every host state its choice (the `auth.storage` adapter precedent).
   - **Web SSR no-op.** The only web caller is a `useEffect` (effects do not run on the server). Do not call `start()` from render, from the module scope, or from `AgicashSdk.create` / `init` / `onSessionStarted`. Protected routes set `clientLoader.hydrate = true` (`_protected.tsx:145–149`); the effect is still the guard, because the lead hook's own SSR guard shows the component was written to render with `window` missing. `useSyncExternalStore`'s server snapshot is `'stopped'`, so a server render does not mount `TaskProcessor`.

   **Rejected:** importing `@tanstack/query-core` to reuse `focusManager`. The SDK must not depend on TanStack. **Rejected:** `refetchIntervalInBackground: true`. Hidden tabs would keep the lease and two visible-policy tabs would no longer yield.

5. **(e) Lock RPC failures retry like the query, then warn, and do not enter `'error'`.** Client queries retry while `failureCount < 3`, delay `min(1000 * 2 ** failureCount, 30_000)` computed with the pre-increment count (1s, then 2s, then 4s), then surface `error`. The web effect warns once that error is set (`task-processing.ts:43–52`) and the interval keeps scheduling. Copy that: four `take_lead` calls per cycle (first try + three retries), then

   ```ts
   logger.warn('Error. Take lead request failed. Will retry in 5 seconds.', {
     cause: error,
   });
   ```

   `state` stays whatever it was (`'follower'` or `'leader'`). The next interval tick starts a fresh cycle. An abort or a stale generation is not a failure: no warn, no retry. **Rejected:** `state → 'error'` when the three retries exhaust (proposal `:284–287` describes that tier for a lock that is unrenewable). Master does not do it: the lead query sets no `throwOnError` (defaults false), so a PostgREST blip is stored on the query result — the warn effect fires once, the error reducer leaves the last `data` boolean in place, `isLead` stays `true`, and `refetchInterval` starts a new cycle (plan-attack F5). The boundary throw is the proposal's host recovery (`:286–287`), which this slice lands in `wallet.tsx` and never reaches. `'error'` stays in the type and in `transition`. This slice has no caller that passes it. The web hook that throws on `'error'` is landed anyway (pinned seams), so sub-slice 2 adds a transition and not a new subscription. Per-task failures inside the six hooks stay in those hooks; they do not change `state` (event comment `events.ts:72–74`).

6. **(f) This slice emits `task-processor.state-changed` from the runtime, through the emitter `AgicashSdk` already owns.** `events.ts` is not edited. Payload is `{ state }` with no `error` key on `'stopped' | 'follower' | 'leader'`. The `'error'` payload, when a later slice sends it, is `{ state: 'error', error }` with `error` an `SdkError`. Emit only when `state` changes. Do not emit for a `take_lead` result that matches the previous boolean, and do not emit from an idempotent `start()` / `stop()`. The event is not replay-latest; the web snapshot reads `sdk.taskProcessor.state` on subscribe, so a listener mounted after the transition still sees the current state. **Rejected:** not emitting until sub-slice 2. The host's mount gate is this event plus `state`, and the contract says the event fires on every transition (`events.ts:72–74`). **Rejected:** adding replay-latest. `clear()` would have to learn a second retained payload (`events.ts:159–167`), which is an `events.ts` edit.

   Log lines, only on a change of the lead boolean, not on `stop()` and not on a renewal:

   - `true` → `logger.debug('Taking lead on task processing', { clientId })` (`task-processing.ts:56–58`)
   - `false` → `logger.debug('Yielded lead on task processing', { clientId })` (`:59–62`)

7. **(g) Identity, session, and wiring.** One `clientId` per processor instance (plan-attack F3), minted on the first `start()` by `globalThis.crypto.randomUUID()` (same global the SDK already uses for bytes, `lib/password.ts:31`) and kept across `stop()` / `start()`. Master behaves this way: the uuid is `useState` state that survives the strict-mode effect replay, so cleanup plus re-run renews the row it already holds instead of waiting out its own 6s lease. Renewals pass the same id. The id is a uuid because `p_client_id` is `uuid` (`initial_db.sql:3463`); never pass `''`.

   `userId` is `session.user.id`, read at the beginning of each attempt. That is the wallet user id: provisioning writes `authUser.id` (`user-api.ts:149`) and every namespace reads `session.user.id` (`user-api.ts:75–80`). The public method takes no user id.

   `start()` while `'follower'` or `'leader'` returns without minting an id or arming a second interval. `start()` while `'error'` throws the stored `SdkError`. `start()` with `isLoggedIn: false` throws `new NoSessionError()` and does not arm the loop. `getLiveSession` throwing `DisposedError` propagates. A tick that observes `isLoggedIn: false` calls `stop()` and does not call `take_lead` (the session snapshot is already cleared before `onSessionEnded`, `auth-service.ts:361`).

   `userId` changes without an unmount (login over a live session, `auth-service.ts:348–356`) are the web effect's job: the effect depends on `useUser((user) => user.id)` (`user-hooks.tsx:82–92`). Cleanup `stop()`s, then `start()` runs under the new session. `onSessionEnded` has already `stop()`ped during the id change, while the old snapshot was still current; `stop()` does not read the session. The new `start()` reuses the instance client id and attempts immediately (a different `p_user_id` is a different lock row; master's `useState` uuid also survives a user change without unmount). The old user's row lapses by TTL. **Rejected:** caching `userId` once inside `start()`. **Rejected:** leaving the effect deps empty. After an id change the component stays mounted (`Wallet` wraps every protected route, `_protected.tsx:163–167`), so an empty dep list would never `start()` the new user.

   Strict mode double-invokes effects (`entry.client.tsx:156–162`). That is start → cleanup `stop()` → `start()` with one persistent client id (plan-attack F3): the second `start()` renews the row the first one took, so the dev tab never waits out its own lease. Master's `useState` uuid survives the replay the same way. The generation fence covers the in-flight call. **Rejected:** `useEffectNoStrictMode` (`use-effect-no-strict-mode.ts:16–31`). The lead poll does not use it today.

   Constructor order in `sdk.ts`: `events` already exists (`:84`). Declare `let taskProcessor: TaskProcessorApi | undefined` before `new AuthService`. `onSessionEnded`'s first statement is `if (taskProcessor) { void taskProcessor.stop(); }`. Assign `taskProcessor` after `db` (`:144–148`) and `getLiveSession` (`:137–142`) exist, and assign `this.taskProcessor` to that value. Replace the getter at `:65–67` with `readonly taskProcessor: TaskProcessorApi` next to `readonly events` (`:60`). Leave the `featureFlags` getter (`:62–64`). Do not edit the class comment at `:46–49`. `init()` stays session restore plus WASM (`:218–223`). Do not `start()` there.

   `dispose()`:

   ```ts
   async dispose(): Promise<void> {
     this.disposed = true;
     await this.taskProcessor.stop();
     this.authService.teardown();
     this.keys.dispose();
     if (currentInstance === this) {
       currentInstance = undefined;
     }
   }
   ```

   HMR already returns `sdk.dispose()` (`sdk.client.ts:78–82`); the await is the checkpoint. Do not edit `sdk.client.ts`. `stop()` after `dispose()` resolves and does not throw (the prefix already ran; a host `finally` may call it). `start()` after `dispose()` throws `DisposedError` via `getLiveSession`, including during the drain (the flag is already set).

8. **(h) Production `take_lead` goes through `TaskProcessingLockRepository` on the SDK's db client.** Construct `new TaskProcessingLockRepository(deps.db)` only when the test seam is absent. Pass `{ abortSignal }`. The web's `agicashDbClient` (`database.client.ts:11–45`) is no longer on this path. The SDK token getter is already warmed by `sdk.user.get()` in the protected middleware (`_protected.tsx:109`; memo documented at `db/supabase-session.ts:20–25`, filled at `:60–62`, hit at `:52–54`) before `Wallet`'s effect runs, so the first `take_lead` does not mint an extra Open Secret token versus a master load that already called `sdk.user.get()`. Do not edit `temporary.ts`. The repository export stays (`temporary.ts:141`) until step 19; after this slice nothing under `apps/` imports it.

## Pinned seams (authoritative for the implementation)

### Constants (`packages/wallet-sdk/domain/wallet/task-processor-runtime.ts`)

```ts
const LEAD_POLL_INTERVAL_MS = 5_000;
const STOP_CHECKPOINT_TIMEOUT_MS = 5_000;
const LEAD_RETRY_LIMIT = 3;
```

Retry delay is `Math.min(1000 * 2 ** failureCount, 30_000)` with `failureCount` still 0, 1, 2.

### Deps and factory

```ts
import type { AgicashDb } from '../../db/database';
import { DisposedError, NoSessionError, type SdkError } from '../../lib/error';
import type { AuthSession, Logger } from '../sdk';
import type { TaskProcessorApi, TaskProcessorState } from '../sdk/task-processor';
import { TaskProcessingLockRepository } from './task-processing-lock-repository';

type TakeLead = (
  userId: string,
  clientId: string,
  options?: { abortSignal?: AbortSignal },
) => Promise<boolean>;

export type TaskProcessorDeps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  activity: ActivityMonitor; // the contract port; see "Activity port" below
  emit: (payload: { state: TaskProcessorState; error?: SdkError }) => void;
  logger: Logger;
  /** Test seam; defaults to `TaskProcessingLockRepository.takeLead` on `db`. */
  takeLead?: TakeLead;
  /** Test seam; defaults to `globalThis.crypto.randomUUID`. */
  randomUUID?: () => string;
  /** Test seam; defaults to the global `setInterval` / `setTimeout`. */
  clock?: ScopeClock;
};

export function createTaskProcessor(deps: TaskProcessorDeps): TaskProcessorApi;
```

Seams are flat optional members of `Deps`, each tagged `/** Test seam; defaults to … */` — the house pattern of the `create*Api` factories (`receive-api.ts`, `send-api.ts`, `accounts-api.ts`, `transfer-api.ts`). The originally pinned nested `seams?: TaskProcessorSeams` bag was flattened in the maintainer round of 2026-10-13, and the two timer seams became one `clock?: ScopeClock` (the type `lib/run-scope.ts` already defines). `import type` for `AuthSession` / `Logger` / `TaskProcessorApi` so the runtime does not value-import `sdk.ts` (that file value-imports the runtime). Let `bun run fix:all` fix import order. Production `AgicashSdk` passes no seams. Defaults:

- `takeLead`: `new TaskProcessingLockRepository(deps.db).takeLead(userId, clientId, options)`.
- `randomUUID`: `() => globalThis.crypto.randomUUID()`.
- `clock`: a module-level `systemClock` over the global `setInterval` / `setTimeout`, each returning a function that clears that one id.

`activity` is NOT a seam: it is a required dep, wired from `SdkConfig.activity` (maintainer 2026-10-13).

Return a facade object, not the class, so only `start`, `stop`, and `state` are reachable:

```ts
return {
  start: () => runtime.start(),
  stop: () => runtime.stop(),
  get state() {
    return runtime.state;
  },
};
```

### Activity port (reshaped per maintainer review 2026-10-13, collapsed to one flag 2026-10-13b)

The contract (`domain/sdk/index.ts`) owns the neutral port; the browser sensing lives in the web host. No `document` / `window` word remains in `packages/wallet-sdk`.

- `ActivityMonitor` = `{ isActive(); subscribe(onChange) → unsubscribe }`, a required `SdkConfig.activity` field. One bit: false while the host is backgrounded or offline. There is NO SDK-exported implementation (maintainer: the `auth.storage` pattern — every host implements the port; tests inline a constant-true monitor).
- The web adapter is `apps/web-wallet/app/features/shared/browser-activity.client.ts`: `isActive` = `document.visibilityState !== 'hidden' && online`, where `online` is a flag starting `true` (never `navigator.onLine`); `subscribe` installs lifetime `offline` / `online` listeners that write the flag and are never removed — the flag must keep learning between `stop()` and the next `start()`, or a restarted loop is blind to an offline→online flip that happened while unsubscribed (adversarial-review finding R1; master's `onlineManager` listens for the `QueryClient` lifetime) — plus per-subscription forward listeners (`visibilitychange` / `offline` / `online` → `onChange`) that the unsubscribe removes. Its two tests (the conjunction, the lifetime flag) live beside it in the web package.

### Runtime behavior

**Superseded in mechanics, not in behavior (maintainer 2026-10-13c).** The cancellation machinery described below — the generation fence, `cancelDelay`, `runnableWaiter`, the checkpoint set, the stop token — moved into the generic `packages/wallet-sdk/lib/run-scope.ts` (`createRunScopes`: `renew`/`cancel`/`join`; `RunScope`: `alive`/`signal`/`delay`/`track`/`every`/`onCleanup`). Scope identity replaces the generation integer; `attempt` is named `bidForLead`; `tick`/`onActivity`/`kick` are gone: every trigger (start, the interval, an activity change) calls `bidForLead` directly, which owns all of its guards (scope alive, no bid in flight, host active) — maintainer 2026-10-13e. All 16 lettered tests pass unchanged against the new shape — the behaviors below still bind. One deliberate improvement over the text below: work still unsettled when the stop bound fires is purged from the checkpoint set (the contract's "abandons the remaining queue"), so a hung request taxes `stop()` once, not forever. The 18.2 sagas `scope.track()` their iterations into the same join. **Park removed (maintainer 2026-10-13d).** The retry park (`waitUntilRunnable` / `runnableWaiter` below, later `scope.waitFor` / `scope.wake`) is gone: a bid that finds the host inactive after a backoff is ABANDONED — it returns and clears `inFlight` — and the next activation starts a fresh bid with a fresh retry budget. Observably equivalent for the F1 rule (no `take_lead` while inactive; exactly one on activation), and simpler, because `take_lead` is idempotent and its state lives in the lock row. The same rule applies to the 18.2 sagas, whose state is durable: a stopped or inactive saga is cancelled and the next leader picks the work up from the database; no suspended in-memory continuation survives a change of conditions. Test (h) keeps its assertions under the new name "abandons a retry while inactive and bids afresh on activation".

`state` starts `'stopped'`. `transition(next, error?)`: if `next === this.current` and `next !== 'error'`, return. Else set current, set `failure` to `error` only when `next === 'error'` (otherwise `undefined`), and `emit` either `{ state: 'error', error }` or `{ state: next }` with exactly the key `state`.

`start()`:

1. `const session = this.deps.getSession()` (may throw `DisposedError`).
2. If `!session.isLoggedIn`, throw `new NoSessionError()`.
3. If `current === 'error'`, throw `this.failure` when it is set, otherwise `new NoSessionError()`.
4. If `current === 'follower'` or `current === 'leader'`, return.
5. Bump `generation`. Mint `clientId` if the instance has none yet (plan-attack F3). Set `lastLead = undefined`. `transition('follower')` (this emits).
6. `activity.subscribe` → `onActivity`. `setInterval(tick, LEAD_POLL_INTERVAL_MS)`.
7. `void this.attempt(generation, 'mount')`, then return `undefined`. `start` is not async.

`onActivity` / `tick`: if `generation` is stale or `current === 'stopped'`, return. Wake `runnableWaiter` only when `isForeground() && isOnline()` (plan-attack F1; `stop()` wakes it unconditionally through its prefix). `onActivity` also updates the remembered online flag and records whether this change is an offline→online flip. Then `kick`:

- `'interval'` and `'resume'` call `attempt` only when `isForeground() && isOnline() && !inFlight`.
- `'reconnect'` (the offline→online flip, plan-attack F2) calls `attempt` when `isOnline() && !inFlight`. Foreground is not required.
- `'mount'` calls `attempt` when `!inFlight`. Mount does not require foreground. Mount does require `isOnline()`; if the flag is false, return and let `'resume'` / `'reconnect'` try later.

`attempt` sets `inFlight` for the whole cycle, including retries and delays. `finally` clears `inFlight` only when `this.generation` is still the generation that started that attempt. `stop()`'s prefix bumps the generation and then sets `inFlight = false`, so a `start()` in the same synchronous turn (strict-mode cleanup, or `stop()` then `start()`) is not blocked by the attempt that has not reached `finally` yet, and that old `finally` does not clear the new attempt's flag. One `AbortController` for the cycle, stored so `stop()` can abort it. Body:

1. If generation is stale or `current === 'stopped'`, return.
2. Read the session. `DisposedError` → return (do not log, do not retry). `!isLoggedIn` → `void this.stop()` and return. This check is before `inFlight` would matter for a second call; still clear `inFlight` in `finally`.
3. `'mount'` while offline: return. `'interval'` / `'resume'` while not runnable: return.
4. `failureCount = 0`. Loop:
   - Stale generation or aborted signal → return, no warn.
   - `const lead = await track(takeLead(session.user.id, clientId, { abortSignal }))`.
   - Stale generation or aborted signal → return, no warn, do not apply.
   - Apply: if `lead !== lastLead`, set `lastLead`, log the matching debug line, `transition(lead ? 'leader' : 'follower')`. Return.
   - On throw: if aborted or stale, return. If `failureCount >= LEAD_RETRY_LIMIT`, warn with `{ cause: error }` and return. Otherwise delay `Math.min(1000 * 2 ** failureCount, 30_000)`, increment `failureCount`, then `waitUntilRunnable`. If the generation died or `current === 'stopped'` after either wait, return. After the waits re-check `isForeground() && isOnline()`; if the tab is hidden or offline again, park on `waitUntilRunnable` once more instead of calling `take_lead` (plan-attack F1).

`track` adds `work.then(() => undefined, () => undefined)` to `checkpoints` and removes it when that settled promise fulfills. `stop()` snapshots the set.

`delay`: `setTimeout(resolve, ms)`, and remember a `cancelDelay` that clears the timer and resolves. `waitUntilRunnable`: if runnable or the generation is stale, resolve immediately; otherwise store `runnableWaiter`. `stop()`'s prefix calls `cancelDelay` and `runnableWaiter` after the generation bump, so those awaits resume and see the stale generation.

`stop()`:

1. If `current === 'stopped'` and there is no interval and `inFlight` is false, return the in-flight `stopPromise` or `Promise.resolve()`.
2. Otherwise run the synchronous prefix in decision 3 (including `transition('stopped')`, which emits only on a real change, and clearing `lastLead` / the activity subscription / the interval; `clientId` stays, plan-attack F3).
3. Replace `stopPromise` with the checkpoint race. A token identifies this call so an older race's completion does not clear a newer `stopPromise`. The race is `Promise.all(snapshot)` against `setTimeout(..., STOP_CHECKPOINT_TIMEOUT_MS)`. Cancel the timer when the checkpoints win. The promise resolves; it does not reject. Completion writes nothing except clearing `stopPromise` when the token still matches.

A `start()` that runs after the prefix and before the race finishes is legal: `current` is already `'stopped'`, so `start()` arms a new generation. The old race must not touch `state`.

### `sdk.ts`

Add `import { createTaskProcessor } from '../wallet/task-processor-runtime'`. Field and constructor as decision 7. `emit` is `(payload) => events.emit('task-processor.state-changed', payload)`. `getSession` is `getLiveSession`. `logger` is `config.logger`. `db` is the client already built at `:144–148`. No `seams`.

### Web (`apps/web-wallet/app/features/wallet/task-processing.ts`)

Delete `useTakeTaskProcessingLead`, the repository construction (`:13–15`), and the imports of `@tanstack/react-query`, `TaskProcessingLockRepository`, `agicashDbClient`, `useState`. Keep `TaskProcessor` and its six hook calls byte-identical.

Add:

```ts
import type { SdkError, TaskProcessorState } from '@agicash/wallet-sdk';
import { useEffect, useSyncExternalStore } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import { useUser } from '../user/user-hooks';
```

`sdk` is the existing export (`sdk.client.ts:56`). `TaskProcessorState` comes from `export *` of the contract (`packages/wallet-sdk/index.ts:10`). `SdkError` is the explicit re-export at `:19`. `sdk.client.ts` does not re-export those types. Keep the six processor-hook imports. Drop `useState`, `@tanstack/react-query`, `TaskProcessingLockRepository`, and `agicashDbClient`.

Module-level snapshot cache. `useSyncExternalStore` requires a stable `getSnapshot` reference when nothing changed.

```ts
const SERVER_SNAPSHOT: { state: TaskProcessorState; error?: SdkError } = {
  state: 'stopped',
};

let cached: { state: TaskProcessorState; error?: SdkError } = SERVER_SNAPSHOT;

function publish(next: { state: TaskProcessorState; error?: SdkError }): void {
  if (cached.state === next.state && cached.error === next.error) {
    return;
  }
  cached = next;
}

function subscribeTaskProcessor(onStoreChange: () => void): () => void {
  publish(
    sdk.taskProcessor.state === 'error'
      ? cached.state === 'error'
        ? cached
        : { state: 'error' }
      : { state: sdk.taskProcessor.state },
  );
  return sdk.events.on('task-processor.state-changed', (payload) => {
    publish(
      payload.state === 'error'
        ? { state: payload.state, error: payload.error }
        : { state: payload.state },
    );
    onStoreChange();
  });
}

function getTaskProcessorSnapshot(): {
  state: TaskProcessorState;
  error?: SdkError;
} {
  const current = sdk.taskProcessor.state;
  if (cached.state !== current && current !== 'error') {
    publish({ state: current });
  }
  return cached;
}

export function useTaskProcessor(): {
  state: TaskProcessorState;
  error?: SdkError;
} {
  const userId = useUser((user) => user.id);
  useEffect(() => {
    sdk.taskProcessor.start();
    return () => {
      void sdk.taskProcessor.stop();
    };
  }, [userId]);
  return useSyncExternalStore(
    subscribeTaskProcessor,
    getTaskProcessorSnapshot,
    () => SERVER_SNAPSHOT,
  );
}
```

One hook, not a run/snapshot pair (merged per maintainer review 2026-10-13 — the wallet layout is the only caller and no other caller is planned). The effect owns the loop: its cleanup stops task processing for the tab, so exactly one mounted component may call it.

```ts
```

`subscribe`'s `'error'` branch without a payload exists only for the reconcile-before-subscribe case. This slice never sets `'error'`, so that branch does not run. Do not invent an `SdkError` there.

`useUser` is already the import path `../user/user-hooks` (`wallet.tsx:8`). `TaskProcessor` stays in this file, so this module keeps importing the six hooks.

### Web (`apps/web-wallet/app/features/wallet/wallet.tsx`)

Replace the `task-processing` import (`:9`) with `TaskProcessor`, `useTaskProcessor`. Keep `useTrackWalletChanges()` and `useSupabaseRealtimeActivityTracking(agicashRealtimeClient)` where they are (`:53–54`). Replace `:57–61` with:

```ts
  const taskProcessor = useTaskProcessor();
  if (taskProcessor.state === 'error') {
    throw (
      taskProcessor.error ?? new Error('Task processor entered error')
    );
  }

  return (
    <>
      {taskProcessor.state === 'leader' && <TaskProcessor />}
      {children}
    </>
  );
```

The `throw` is the host recovery from proposal `:286–287`. It is unreachable in this slice. Do not special-case it in `root.tsx`. A thrown `SdkError` is not `SupabaseRealtimeError` (`root.tsx:265`).

### Canary

`grep -rn <pattern> apps packages --exclude-dir=node_modules`. Hits under `docs/` and `.claude/` are historical and expected.

- `useTakeTaskProcessingLead` — zero hits.
- `take-lead` — zero hits under `apps/`.
- `TaskProcessingLockRepository` — zero hits under `apps/`. The class, the runtime, and `temporary.ts:141` still match under `packages/`.
- `refetchInterval: 5000` — zero hits under `apps/web-wallet/app/features/wallet/`.
- `from 'react'` and `@tanstack/react-query` — zero hits under `packages/wallet-sdk/domain/wallet/task-processor-runtime.ts` and `packages/wallet-sdk/lib/run-scope.ts`.
- `document` and `window` — zero hits under `packages/wallet-sdk/domain/wallet/` (the browser sensing lives in `apps/web-wallet/app/features/shared/browser-activity.client.ts`).
- `connection.changed` and `` `wallet:` `` — zero hits under `task-processor-runtime.ts`.
- `console.` — zero hits under `task-processor-runtime.ts`.

## File map

Modify `packages/wallet-sdk/domain/sdk/sdk.ts`, `apps/web-wallet/app/features/wallet/wallet.tsx`, `apps/web-wallet/app/features/wallet/task-processing.ts`. Create `packages/wallet-sdk/domain/wallet/task-processor-runtime.ts`, `packages/wallet-sdk/domain/wallet/task-processor-runtime.test.ts`. Maintainer round 2026-10-13 adds: modify `packages/wallet-sdk/domain/sdk/index.ts` (the activity contract) and `apps/web-wallet/app/features/shared/sdk.client.ts` (passes `browserActivity`); create `apps/web-wallet/app/features/shared/browser-activity.client.ts` and `browser-activity.test.ts`. The 2026-10-13c RunScope extraction adds `packages/wallet-sdk/lib/run-scope.ts`.

Untouched: `domain/sdk/task-processor.ts`, `domain/sdk/events.ts`, `packages/wallet-sdk/index.ts`, `temporary.ts`, `domain/user/auth-service.ts`, `domain/wallet/task-processing-lock-repository.ts`, `db/client.ts`, `use-track-wallet-changes.ts`, `apps/web-wallet/app/lib/supabase/**`, `database.client.ts`, `root.tsx`, the six `useProcess*` modules, every RPC and migration. (`domain/sdk/index.ts` and `sdk.client.ts` left this list in the 2026-10-13 maintainer round.)

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The commit that adds this document is the pinned base of the implementation job (`sdk/background-runtime-slice` off `210572602055265fdba653e92fc0c01e75d2491a`). The implementation job appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the File-map paths, applying the pinned seams. Working order:

1. **Read first:** `task-processor.ts`, `events.ts` (`:64–78`, `:82–167`), `sdk.ts` (constructor, `getLiveSession`, `dispose`), `auth.ts:38–41`, `auth-service.ts` `signOut` / `endSession` / the id-change branch (`:230–236`, `:348–368`), `task-processing-lock-repository.ts`, `task-processing.ts`, `wallet.tsx`, `use-track-wallet-changes.ts:74–149`, `initial_db.sql:3461–3512`. Do not port the feed.
2. **Runtime** (pinned seams). No `console`. No React.
3. **Tests** in `task-processor-runtime.test.ts`. `bun:test`. No supabase, no Breez, no mint. Logger is a recording fake; empty methods are `() => undefined` (`noEmptyBlockStatements`). Session fixture: `{ isLoggedIn: true, user: { id: 'user-1' } } as AuthSession` and `{ isLoggedIn: false }`. `db` is `{} as AgicashDb` whenever the `takeLead` seam is set. Every test except (p) passes a recording `clock`: its `setInterval` and `setTimeout` record `{ ms, callback, cancel }` and do not call `callback` until the test does. `randomUUID` returns `'00000000-0000-4000-8000-000000000001'` then `'00000000-0000-4000-8000-000000000002'`. Tests that care about activity pass their own `activity` monitor. (p) constructs `AgicashSdk` and passes no seams.

   - **(a) No session.** `getSession` logged out. `start()` throws `NoSessionError`. `takeLead` was not called. `state` is `'stopped'`. `emit` was not called. `setInterval` was not called.
   - **(b) Mount, leader, renewal, payload keys.** Deferred `takeLead`. `start()` returns `undefined` (assert without `await`). `emit` has been called once with `{ state: 'follower' }`. `Object.keys` of that payload equals `['state']`. `takeLead` was called once with `('user-1', '00000000-0000-4000-8000-000000000001')` and an `AbortSignal`. Resolve `true`. `state` is `'leader'`. Second emit is `{ state: 'leader' }` and `Object.keys` equals `['state']`. Logger debug was called once with `'Taking lead on task processing'` and `{ clientId: '00000000-0000-4000-8000-000000000001' }`. Fire the interval callback (`ms === 5000`). The second `takeLead` sees the same client id. Resolve `true`. No third emit. Debug was not called again.
   - **(c) Yield.** Become leader (b's shape). Next attempt resolves `false`. `state` is `'follower'`. Debug was called with `'Yielded lead on task processing'` and the same `clientId`. A further `false` does not log again and does not emit.
   - **(d) Idempotent start.** While `'leader'`, `start()` again. `randomUUID` was called once. `setInterval` was called once.
   - **(e) Hidden leader.** Activity starts foreground. Become leader. Set foreground false. Fire the interval. `takeLead` call count stays put. `state` stays `'leader'`. Set foreground true (and invoke the activity subscriber the runtime registered). Exactly one new `takeLead`. Resolve `false`. `state` is `'follower'`.
   - **(f) Mount while hidden still attempts.** Activity starts hidden. `start()`. `takeLead` was called once (mount is not focus-gated). Resolve `true`. `state` is `'leader'`. Fire the interval. No second call.
   - **(g) Retries, then warn, state unchanged.** Become leader. Next four `takeLead` calls reject `error = new Error('db down')`. After the first rejection the timeout list contains `1000`. Fire it. After the second, `2000`. Fire it. After the third, `4000`. Fire it. The fourth rejection warns once: `'Error. Take lead request failed. Will retry in 5 seconds.'` and `{ cause: error }` (`toBe` the same error). `state` is still `'leader'`. No emit whose `state` is `'error'`. The next interval tick calls `takeLead` a fifth time (a new cycle).
   - **(h) Abandon while inactive, fresh bid on activation.** First failure, fire the `1000` delay, then set the host inactive before the continuation runs: no second `takeLead` (the bid is abandoned). Fire the `5000` interval while still inactive: the call count does not move. Set the host active and run the subscriber: exactly one new `takeLead`, without an extra interval tick. (Rewritten 2026-10-13d from the original park semantics; the call counts are unchanged.)
   - **(i) Abort finishes stop.** `takeLead` rejects when its signal aborts (`addEventListener('abort', ...)`). `start()`, do not resolve. `await stop()`. `state` is `'stopped'`. The signal's `aborted` is true. `stop()` arms a `5000` timer and its `cancel` has been called (the abort settled the checkpoint, so the timer must not be left running). A second `await stop()` resolves and does not emit again. Emit history contains `'follower'` then `'stopped'` only.
   - **(j) Hung attempt, late true.** `takeLead` returns a promise that ignores abort. `await` a `stop()` that the test completes by firing the `5000` timeout. `state` is `'stopped'`. Then resolve the hung call with `true`. `state` is still `'stopped'`. No emit after the `'stopped'` emit.
   - **(k) stop then start, same turn.** `takeLead` returns a promise that ignores abort (same as j). `start()`, then call `stop()` and `start()` again with no `await` between them. The second `takeLead` has already been invoked with `'00000000-0000-4000-8000-000000000001'` again (the old `inFlight` flag must not swallow this `start()`, and the client id persists across `stop()` / `start()` — `randomUUID` was called exactly once; plan-attack F3). Resolve the first promise `true`. `state` is not `'leader'` from that resolution. Resolve the second `true`. `state` is `'leader'`. Then `await` the first `stop()` after firing its `5000` timer if it is still pending, so the test process does not keep a timer.
   - **(l) Logged-out tick.** Become leader. Flip `getSession` to logged out. Fire the interval. `takeLead` is not called again. `state` is `'stopped'`.
   - **(m) In-flight guard.** `takeLead` pending. Invoke the activity subscriber (foreground stays true) and fire the interval. Call count stays 1 until the first resolves.
   - **(n) Production repository path.** Do not pass the `takeLead` seam. Still pass the recording clock and `randomUUID`. `db.rpc` records `(fn, args)` and returns a thenable `{ data: true, error: null }` with `abortSignal()` returning itself (`Object.assign` onto `Promise.resolve(...)` is enough). `start()`. `rpc` was called with `'take_lead'` and `{ p_user_id: 'user-1', p_client_id: '00000000-0000-4000-8000-000000000001' }`. `await stop()`.
   - **(o) Constant-true activity.** Pass a constant-true `activity` monitor (the shape a never-suspended host supplies), `takeLead`, and the recording clock. `start()` calls `takeLead` once; after resolving it, an interval tick calls it a second time — proof that interval ticks poll unconditionally under a constant-true monitor. `await stop()`. (Rewritten 2026-10-13: the SDK no longer reads `document`, so the original "missing document counts as foreground" premise no longer exists.)
   - **(p) `AgicashSdk` wiring.** Copy `createMemoryStore` (`sdk.test.ts:8–19`) and `createConfig` (`:21–31`, `nullLogger`). `const sdk = AgicashSdk.create(createConfig())`. `sdk.taskProcessor` is `sdk.taskProcessor` (stable). `sdk.taskProcessor.state` is `'stopped'` without a throw. `start()` throws `NoSessionError`. `featureFlags` access throws `NotImplementedError`. `await sdk.dispose()` resolves. `start()` then throws `DisposedError`. `await sdk.taskProcessor.stop()` resolves. A second `AgicashSdk.create` after dispose succeeds; dispose it in `finally`. This test does not resolve a real `take_lead` (no session, so the repository is not called).
   - **(q) Idle online flip renews while hidden (plan-attack F2).** Become leader. Set foreground false. Run the subscriber with the online flag flipped to false (no new call). Run it again with the flag back to true: exactly one new `takeLead`, without an interval tick. Resolve `true`. `state` stays `'leader'`, no new emit, no new debug log.

4. **Web flip** (pinned seams). `useTaskProcessor()` is unconditional inside `Wallet`, which still returns `null` from the parent when there is no auth user (`_protected.tsx:157–160`). Do not wrap `start()` in `try/catch`.
5. **Canary greps.**

Gates are the Verification table. `bun run fix:all` is repo-wide `biome check --write`; revert any path outside the File map. The delivered diff equals the File map.

**Task 2 (local, orchestrator):** merge, re-run the gates, and run the maintainer two-tab check below.

**Task 3 (marketplace): adversarial review.** Check: `task-processor.ts`, `events.ts`, `index.ts`, `temporary.ts`, `auth-service.ts`, `use-track-wallet-changes.ts`, `lib/supabase/**`, `database.client.ts` byte-identical; `taskProcessor` is a field assigned from `createTaskProcessor`, `featureFlags` still throws; `dispose` sets `this.disposed = true` and then awaits `stop()` (flag-first per maintainer review 2026-10-13); `onSessionEnded` calls `stop()` before `sessionToken.reset()`; no `console` and no React import in the runtime; no release RPC and no lock-row write; an inactive tick does not call `take_lead` and does not leave `'leader'` (tests e, f); a retry abandoned while inactive is not re-sent by an inactive tick and a fresh bid follows activation (h); `clientId` persists across `stop()` / `start()` (k); late `true` after `stop` does not become leader (j, k); retry warn string and 1s/2s/4s delays (g); `take_lead` args (n); web mounts `TaskProcessor` only for `'leader'` and still calls `useTrackWalletChanges` plus `useSupabaseRealtimeActivityTracking`; `useTakeTaskProcessingLead` is gone; this slice does not emit `connection.changed`. Confirmed findings go back through the orchestrator. A finding that the change-feed should have moved is an overturn of decision 2: it needs a new plan, not an improvised bridge in the implementation diff.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, lockfile unchanged |
| Lint/format + write | `bun run fix:all` | exit 0; only the File-map paths modified |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun run test` | green (292 `it`/`test` calls at `2105726` + the lettered additions a–p after the 2026-10-13b single-flag collapse removed the two split-flag cases; the lifetime-online-flag regression lives with the web adapter) |
| Web unit tests | `cd apps/web-wallet && bun run test` | green (40 at the pin + the two browser-activity adapter tests) |
| Canary | greps in Task 1 | as written |
| Live | maintainer, two browsers | below |

`bun run test` in each package runs that package's `test` script (`packages/wallet-sdk/package.json:17`, `apps/web-wallet/package.json:12`). Bare `bun test` is Bun's unscoped runner and is not used. No `bun run build` gate: this slice does not change the server module graph. `bun run typecheck` includes the web `tsc`.

**Maintainer live gate** (design `:123` asks for leader failover on step 18; this sub-slice's share is the lock, not a money-path completion). Two profiles, same account, `bun run dev`.

1. Both tabs open and visible. Within one poll, exactly one tab's console shows `Taking lead on task processing` and the other shows `Yielded lead on task processing` on the transitions (not on every tick). Only the leader tab runs processor logs for a pending quote.
2. Hide the leader (switch to the other tab, or minimize so `document.hidden` is true). Within about 11s of the last renewal (6s lease plus one 5s poll phase, plan-attack F7) the follower's next poll logs `Taking lead`. The hidden tab does not log `Yielded` until it is visible again.
3. Show the old leader. It either logs `Yielded` or takes the lead back, and both tabs are not renewing with two client ids at a steady state (one `true` from `take_lead` per user). A short overlap while the hidden tab had not yet refetched is the master behavior; it ends on that refetch.
4. Sign out on the leader. The console stops the 5s `take_lead` traffic for that tab without a multi-second hang (the effect and `onSessionEnded` do not await the checkpoint on the click path). The other tab can take the lead after the lease lapses.

Orchestrator unit gates do not need a funded wallet. If the maintainer has no second profile, say so and skip; do not block the slice on it.

## Parity accounting

**Deviations (maintainer 2026-10-13b, single-flag collapse):** two master behaviors were dropped deliberately. A hidden tab no longer mounts into leadership (master's initial fetch was not focus-gated); it attempts on its first activation instead. A hidden tab no longer renews on an offline→online flip (master's `Query.onOnline` refetches regardless of focus); the lease lapses to a live client within ~11s. Both follow the reliability model: backgrounded ≈ may-be-frozen ≈ offline → yield. Everything below describes the unchanged remainder.

The flipped lead poll adds **zero** network requests versus master on a visible tab. `take_lead` is one RPC per attempt. Master: one immediate fetch on mount, then one per 5s while the document is visible, plus one on the transition to visible and one on the `online` event, with a single in-flight call. The SDK loop does the same. The RPC name, argument names, and 6s lease are unchanged, so a tab still on the old bundle and a tab on the new bundle share one lock. Neither tab runs two loops.

Token exchange: the protected middleware already calls `sdk.user.get()` (`_protected.tsx:109`) through the SDK db client before `Wallet` mounts, which fills `createSupabaseSessionTokenGetter`'s memo (fill at `db/supabase-session.ts:60–62`; later calls hit at `:52–54`, plan-attack F6). Moving `take_lead` from `agicashDbClient` onto that client does not add an Open Secret `generateThirdPartyToken` on the steady path.

Realtime: still one private `wallet:${userId}` channel, still created in `useTrackWalletChanges`, still the web `agicashRealtimeClient`. No second socket. The 13 invalidates and the 10 handler domains are unchanged.

Hidden tab: zero `take_lead` calls per skipped tick, on both sides. Processors stay mounted on both sides while the last result was `true`.

`dispose` / HMR can wait up to 5s when a `take_lead` ignores abort. `signOut` does not wait that long: `endSession` does not await the promise. Master waited for neither.

### A. Visible leader, steady poll

| Request | Master | Flipped | Notes |
|---|---|---|---|
| `wallet.take_lead` | 1 on mount, then 1 / 5s | same | same `p_user_id`, a stable `p_client_id` per loop |
| Open Secret token | 0 beyond the middleware's `user.get` | 0 | SDK memo |
| Realtime socket | 1 | 1 | not moved |
| **Net added** | | **0** | |

### B. Hidden tab

| Request | Master | Flipped | Notes |
|---|---|---|---|
| `take_lead` on interval ticks | 0 | 0 | state / `isLead` stays at the last `true` |
| `take_lead` on show | 1 | 1 | focus refetch |
| **Net added** | | **0** | |

## Out of scope

- **Sub-slice 2 — port processors one flow at a time.** The runner has no flow calls. For each flow, in one commit: move that processor's iteration into the SDK, `track()` its promise so `stop()` already waits for it, and delete that one `useProcess*` call from `TaskProcessor` (`task-processing.ts:76–81`). Do not leave the hook and the SDK iteration both live. When the last hook is gone, delete `TaskProcessor` and the `state === 'leader'` mount. `'error'` transitions, if a flow is wedged past the checkpoint timeout, are added here; the web `throw` is already in `wallet.tsx`. When the leader gate dies, fold that throw into `useTaskProcessor` itself (maintainer, 2026-10-13): the throw becomes the snapshot's only consumer, so the hook collapses to `useTaskProcessor(): void` — run the lifecycle, throw on `'error'` — instead of returning a state nobody reads. Do not put flow code behind a new public register method.
- **Sub-slice 3 — web drops the realtime layer.** Open the channel when a session starts (`events.ts:82–85`), not from `taskProcessor.start()` and not from inside the runtime class. `dispose` / `onSessionEnded` already stop the processor first; remove the channel after that prefix, without changing `stop()`'s state machine. Give `connection.changed` a replay or subscribe before connect, or the 13 invalidates at `use-track-wallet-changes.ts:135–147` will miss the boot-time `connected`. Decrypt in the SDK and emit the existing map. Broadcast event → contract event, from today's handlers (do not rediscover these):

  | Broadcast event | Contract event | Handler |
  |---|---|---|
  | `ACCOUNT_CREATED` | `account.created` | `account-hooks.ts:123` |
  | `ACCOUNT_UPDATED` | `account.updated` | `:130` |
  | `TRANSACTION_CREATED` | `transaction.created` | `transaction-hooks.ts:269` |
  | `TRANSACTION_UPDATED` | `transaction.updated` | `:280` |
  | `CASHU_RECEIVE_QUOTE_CREATED` | `cashu-receive-quote.created` | `cashu-receive-quote-hooks.ts:288` |
  | `CASHU_RECEIVE_QUOTE_UPDATED` | `cashu-receive-quote.updated` | `:295` |
  | `CASHU_RECEIVE_SWAP_CREATED` | `cashu-receive-swap.created` | `cashu-receive-swap-hooks.ts:138` |
  | `CASHU_RECEIVE_SWAP_UPDATED` | `cashu-receive-swap.updated` | `:145` |
  | `CASHU_SEND_QUOTE_CREATED` | `cashu-send-quote.created` | `cashu-send-quote-hooks.ts:241` |
  | `CASHU_SEND_QUOTE_UPDATED` | `cashu-send-quote.updated` | `:252` |
  | `CASHU_SEND_SWAP_CREATED` | `cashu-send-swap.created` | `cashu-send-swap-hooks.ts:384` |
  | `CASHU_SEND_SWAP_UPDATED` | `cashu-send-swap.updated` | `:395` |
  | `CONTACT_CREATED` | `contact.created` | `contact-hooks.ts:141` |
  | `CONTACT_DELETED` | `contact.deleted` | `:148` |
  | `SPARK_RECEIVE_QUOTE_CREATED` | `spark-receive-quote.created` | `spark-receive-quote-hooks.ts:215` |
  | `SPARK_RECEIVE_QUOTE_UPDATED` | `spark-receive-quote.updated` | `:222` |
  | `SPARK_SEND_QUOTE_CREATED` | `spark-send-quote.created` | `spark-send-quote-hooks.ts:105` |
  | `SPARK_SEND_QUOTE_UPDATED` | `spark-send-quote.updated` | `:112` |
  | `USER_UPDATED` | `user.updated` | `user-hooks.tsx:45` |

  `onConnected`'s 13 caches, in order (`use-track-wallet-changes.ts:135–147`): accounts, transactions, cashu receive quote, pending cashu receive quotes, pending cashu receive swaps, unresolved cashu send quotes, cashu send swap, unresolved cashu send swaps, contacts, spark receive quote, pending spark receive quotes, unresolved spark send quotes, user. `account.balance-changed` is not one of these rows (proposal: spark balance is rail state, not this broadcast). The web `SupabaseRealtimeError` throw (`supabase-realtime-hooks.ts:110–116`, `root.tsx:265`) is replaced by `connection.changed: 'error'` in that slice, not this one.

- **Step 18's host/processing repository split** (design `:100–107`) and step 19's deletion of `/temporary`.
- Editing `events.ts` to rename `task-processor.state-changed` back to `background.state-changed`, or adding `sdk.background`.
- A `pagehide` release, a lock-row delete, and any change to the 6s lease or the 5s cadence.
- `featureFlags`, `send.resolveDestination`, and the class-comment at `sdk.ts:46–49`.

## Open questions

None. Decisions 1–8 cover the slice, with the plan-attack corrections F1–F7 folded in (no `take_lead` while inactive, including retries; an idle offline→online flip renews even while hidden; one `clientId` per processor instance; the change-feed deferral stands with its log rationale corrected). Decision 2 is a deliberate divergence from the spec's grouping of the change-feed into sub-slice 1; the remaining reasons and the canary greps are the review surface. The 5s checkpoint cap is a constant sub-slice 2 may raise without changing `stop()`'s race.
