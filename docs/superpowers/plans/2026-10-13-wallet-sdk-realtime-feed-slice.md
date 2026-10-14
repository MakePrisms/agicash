# Wallet SDK — realtime change-feed slice (step 18, sub-slice 3) — implementation plan

> **For agentic workers:** execute the two tasks below **in order**, one PR-ready
> commit per task. Task 2 depends on Task 1's module. Every `path:line` in this
> document is valid at the pinned base `master` = `f1ab0edb` (merge of #1193).
> Re-check a cited line before you edit it. If a line has drifted, the anchor
> text quoted next to it wins. Third-party citations refer to the installed
> `@supabase/supabase-js` / `@supabase/realtime-js` **2.95.2**
> (`packages/wallet-sdk/package.json:34`, `apps/web-wallet/package.json:53-54`),
> under `node_modules/@supabase/realtime-js/dist/module/`.

## Goal

The SDK takes over the realtime change-feed. It owns the per-user Supabase
broadcast channel `wallet:<userId>`, its reconnect state machine and the
decryption of row payloads. It emits the contract's domain events
(`account.*`, `transaction.*`, `contact.*`, the six quote/swap families,
`user.updated`) and `connection.changed`.

The web app deletes its realtime layer (`apps/web-wallet/app/lib/supabase/**`
and `agicashRealtimeClient`). It keeps its TanStack caches fresh by
subscribing to `sdk.events`. Each per-event cache operation, and the
13-invalidate sweep on every `connected`, stays the same as master.

## Order note: why sub-slice 3 lands before sub-slice 2

The design spec lists step 18's sub-slices as 1 (runtime) → 2 (port each
processor) → 3 (realtime)
(`docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md:97-99`).
This slice deliberately lands **3 before 2**, for this reason:

- The six web processors mounted by `TaskProcessor`
  (`apps/web-wallet/app/features/wallet/task-processing.ts:84-92`) learn about
  work created by *other* clients only through the realtime feed.
- Their pending/unresolved caches are populated by the change handlers. For
  example, `CASHU_RECEIVE_QUOTE_CREATED` → `pendingQuotesCache.add`
  (`apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts:281-310`).
- If processors were ported first, every SDK saga would have to consume a feed
  that still lives in React. Moving the feed first avoids that:
  - The processors stay web-side and **unchanged**: they read the same caches,
    which are now fed by SDK events.
  - The later port (sub-slice 2) lets each SDK saga consume the SDK-owned feed
    directly. No React hop is involved, and no temporary bridge is written.

Task 2 applies this verbatim bullet to the design spec's step 18 (see
"Pinned seams → S9").

## Architecture

```
            Supabase Realtime (one socket per tab)
                          │  broadcast  wallet:<userId>  {event, payload}
                          ▼
packages/wallet-sdk/domain/wallet/realtime-feed.ts  (RunScope, one scope per session)
   ├─ reconnect state machine (backoff 0…30s, 9 retries, terminal error)
   ├─ decode: SDK repository mappers (db + session Encryption)
   ├─ fence: scope.alive after every await (session end / identity change)
   └─ emit → WalletEventEmitter  (connection.changed now replay-latest)
                          │  sdk.events.on(...)
                          ▼
apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts
   ├─ 19 domain events → per-feature cache ops (unchanged gates)
   ├─ connection.changed 'connected'  → 13 invalidates (master order)
   └─ connection.changed 'error'      → throw SupabaseRealtimeError (root.tsx UI)
TaskProcessor + six useProcess* hooks: untouched; they read the same caches.
```

The feed is the second consumer of `RunScope`
(`packages/wallet-sdk/lib/run-scope.ts:68-69` names "the SDK-owned realtime
feed" as a next consumer). Its shape copies the task-processor runtime
(`packages/wallet-sdk/domain/wallet/task-processor-runtime.ts`): a deps type
with `/** Test seam; … */` fields, a module `systemClock`, a class built on
`createRunScopes`, and a facade returned by a `create*` factory.

## Tech stack

TypeScript, Bun workspaces, `bun:test`, `@supabase/supabase-js` 2.95.2
(realtime-js 2.95.2), React Router v7 + TanStack Query v5 (web side only).
There are no new dependencies.

## Global constraints

1. **The SDK stays React-agnostic.** No `react` or `@tanstack/*` import
   appears under `packages/wallet-sdk/`.
2. **No new public contract members.** There are two contract-adjacent edits,
   and the diff for each is pinned below:
   - The `WalletEventEmitter` gains replay-latest for `connection.changed`
     (S2). This adds no member, type or event.
   - The `connection.changed` doc comment gains one sentence about replay.
   - `createRealtimeFeed` is **not** exported from `index.ts`, `temporary.ts`
     or `domain/sdk/index.ts`.
3. **Nothing else changes outside the feed and the web realtime layer:**
   - No DB, RPC, trigger or migration change.
   - No dependency change.
   - `bun.lock` is untouched.
4. **These stay byte-for-byte unchanged:**
   - `TaskProcessor` and the six `useProcess*` hooks.
   - `apps/web-wallet/app/features/wallet/task-processing.ts`.
   - `packages/wallet-sdk/domain/wallet/task-processor-runtime.ts` and its test.
5. **Out of scope:** `account.balance-changed` and the Breez/Spark balance
   listeners (`useTrackAndUpdateSparkAccountBalances`, `wallet.tsx:55`).
6. **Scope of files.** Only files in the File map change. Use `bun`/`bunx`
   only. The base branch is `master`.
7. **Secrets in logs.** No log line, test fixture or comment may contain a
   payload, token or key. The realtime transport logger drops `data` for
   `push` and `receive` frames (Decision 8).

## Resolved design decisions

### 1. Feed home, name and lifecycle (a)

**Home and API**

- **Home:** `packages/wallet-sdk/domain/wallet/realtime-feed.ts` plus
  `realtime-feed.test.ts`. This is a sibling of `task-processor-runtime.ts`.
  Both are background/session runtime that the `AgicashSdk` composes, and
  neither is a namespace.
- **API (internal):**
  - `createRealtimeFeed(deps): RealtimeFeed`, where
    `RealtimeFeed = { open(): void; close(): void; dispose(): void }`.
  - A class sits behind the facade, as with `createTaskProcessor`.

**When the feed opens**

- **Open on session establishment, after provisioning.** `AuthService` calls
  `onSessionStarted` on every session-started transition
  (`packages/wallet-sdk/domain/user/auth-service.ts:66-74`, notified at `:130`,
  `:171`, `:316`). `sdk.ts:118` changes from `onSessionStarted:
  userProvisioner.provision` to:

  ```ts
  onSessionStarted: async (authUser) => {
    await userProvisioner.provision(authUser);
    realtimeFeed.open();
  },
  ```

- **Why open after provisioning:**
  - `auth.session-started` (the seed of user + accounts) is emitted before the
    first broadcast can be decoded and emitted. Master had the same ordering,
    because `Wallet` mounts only after the protected middleware's
    `sdk.init()` → `sdk.user.get()`.
  - A terminal provisioning failure propagates to the caller and the feed is
    not opened. The host's retry of `init()` re-runs `onSessionStarted`.
    `restoreSession` clears a rejection
    (`packages/wallet-sdk/domain/sdk/sdk.ts:229-239`).
  - `provision` is fingerprint-guarded and swallows `SessionEndedError` /
    `DisposedError` (`packages/wallet-sdk/domain/sdk/user-provisioner.ts:30-48`).
    So a re-notification with the same identity is cheap, and `open()`
    re-checks the live session itself.

**How `open()` behaves**

`open()` is idempotent and fenced:

1. It reads `getSession()`.
2. If the session is not logged in, or the feed is disposed, it does nothing.
3. If the feed is already open for the same `user.id`, it does nothing. This
   holds in any state, including `error`: a fingerprint-only change such as
   email verification does not restart a dead feed.
4. Otherwise it calls `close()` and then starts a fresh scope for the new user.

**When the feed closes**

- **Close on session end, before the token reset.** In `onSessionEnded`
  (`sdk.ts:119-137`), insert `realtimeFeed.close()` immediately after
  `void taskProcessor.stop()` and **before** `sessionToken.reset()`.
  Reasons:
  - realtime-js pushes a changed token, including `null`, to *joined* channels
    whenever it re-resolves auth (`RealtimeClient.js:327-335`, `_performAuth`
    `:682-725`, heartbeat `_setAuthSafely` at `:395`).
  - Leaving first means no join is ever attempted with a logged-out token, and
    the next user's resubscribe never reuses the previous user's channel.
  - `events.clear()` stays last, so a replayed `connection.changed` cannot
    outlive the session.
- **Identity change.** `applySessionFromServer` calls `onSessionEnded` while
  the old snapshot is still set and only then installs the new one
  (`auth-service.ts:337-357`, `:350-351`). The sequence is:
  1. `close()` kills the old scope.
  2. The following `notifySessionStarted` → `open()` starts a scope for the
     new user.
  3. Late decodes from the old scope are fenced by `scope.alive` (Decision 4).
- **`dispose()`.** In `AgicashSdk.dispose()` (`sdk.ts:241-251`), call
  `this.realtimeFeed.dispose()` right after `await this.taskProcessor.stop()`
  and before `authService.teardown()` / `keys.dispose()`. `dispose()` is
  `close()` plus a terminal flag, so an `open()` arriving later (a provisioning
  promise resolving after dispose) is a no-op instead of throwing.

**Rejected alternatives**

| Alternative | Why rejected |
|---|---|
| Open from `taskProcessor.start()` | Every tab needs the feed, not only the leader. The 18.1 plan already ruled this out (`docs/superpowers/plans/2026-10-12-wallet-sdk-background-runtime-slice.md:35-44`, deferral reason 1). |
| Open from `events.on('connection.changed')` | The contract says `on()` never initiates (`docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md:402-408`; `packages/wallet-sdk/domain/sdk/events.ts:82-85`). |
| A new public `sdk.realtime.start()` | That would be a new contract member. |

### 2. Route parity: the feed follows the session, not the `Wallet` mount (b)

On master the channel exists only while `Wallet` is mounted. The relevant
calls are `useTrackWalletChanges()` at
`apps/web-wallet/app/features/wallet/wallet.tsx:53`, with the subscribe in
`apps/web-wallet/app/lib/supabase/supabase-realtime-hooks.ts:59-119`.
`Wallet` is rendered for every `_protected.*` route
(`apps/web-wallet/app/routes/_protected.tsx:155-167`).

The SDK opens the feed whenever a session exists. This adds two cases:

- **Marketing pages for a logged-in user.** On `/home` and other marketing
  pages, `marketing-nav.tsx:17` and `join-beta-button.tsx:16` (under
  `apps/web-wallet/app/features/homepage/components/`) call
  `useQuery(authQueryOptions())`, which calls `sdk.init()`
  (`apps/web-wallet/app/features/user/auth.ts:65`) and restores the session.
- **The window between establishing a session and redirecting.** This covers
  login/signup on `_auth` (`apps/web-wallet/app/routes/_auth.tsx:13-32`), the
  guest sign-up from `receive-cashu-token.tsx:411` / `signup.tsx:17`, and
  `_public.receive-cashu-token.tsx:79-84`.

**Named delta:** on those routes a logged-in tab opens one extra socket and
joins one channel. Nothing subscribes to the events there, so this costs no
invalidates and no DB refetches. A broadcast that arrives is decoded (one
ECIES decrypt) and dropped by the emitter. The contract requires this
behaviour: `events.ts:82-85` says "the per-user realtime channel is
established when a session comes into existence", and the contract proposal
says the same at `:402-408`.

**Rejected:** gating the feed on a host signal ("Wallet mounted"). That would
need a new contract member and contradicts the contract text.

### 3. Delivery of `connection.changed`: replay-latest (c)

**Problem.** The session, and so the feed, starts in the protected
middleware: `sdk.init()` runs at `_protected.tsx:48-50`, before `Wallet`
mounts. The first `connected` can fire before the web subscribes. Master ran
the sweep once per `Wallet` mount, because each mount did a fresh subscribe
and `SUBSCRIBED` called `onConnected`
(`supabase-realtime-manager.ts:542-634`). Each reconnect also ran the sweep.

**Decision.** `WalletEventEmitter` retains the latest `connection.changed`
payload and replays it to a handler at `on()` time. This is the same
mechanism that already exists for `auth.session-started` (`events.ts:97-118`,
`:140-143`). The retained payload is cleared in `clear()` (`events.ts:159-167`),
which the SDK calls at session end. The exact diff is S2.

**Resulting sweep parity:**

- One sweep per `Wallet` mount: the replayed `connected`, provided the feed is
  connected.
- One sweep per live reconnect.
- The web subscribes in a `useEffect` with `[]` deps through `useLatest` refs
  (S7), so there is exactly one replay per mount. React StrictMode in dev
  mounts effects twice, giving two sweeps on both master and flipped.

**Retained-value edge cases:**

- If the retained value is `reconnecting`, the late subscriber gets
  `reconnecting` (no sweep) and the next `connected` sweeps.
- If it is `error`, the late subscriber throws immediately (Decision 7).
  Master behaved the same way: a remount after an error started a new
  subscribe cycle, but the manager kept the `error` status until then
  (`supabase-realtime-manager.ts:423-443`).

**Rejected alternatives:**

- **Subscribe-before-connect,** i.e. delaying `open()` until a
  `connection.changed` handler exists. The session starts before any React
  tree mounts. It would also make `on()` initiate work, which the contract
  forbids (`contract-proposal.md:402-408`).
- **A getter such as `sdk.connectionState()`.** That is a new contract member.
- **Emitting `connected` again on every `on()` call.** That is replay without
  state, and it would sweep while reconnecting.

### 4. Mapping, decryption and the session fence (d)

The feed maps the 19 broadcast names to contract events with the SDK's own
repository mappers. There is one mapper per row family, so the realtime path
and the read path cannot drift (design spec `:105-107`).

**Per-decode context.** Each decode builds its context from:

- `db`
- `await keys.getEncryption()` (`packages/wallet-sdk/domain/sdk/session-keys.ts:31`)
- `await getAccountRepository()` (`packages/wallet-sdk/domain/accounts/accounts-api.ts:35-46`), only where a constructor needs it

The repositories are cheap value objects, the same ones the namespaces
construct per call. The fence is applied in two layers:

1. **The keys layer.** `getEncryption` rejects if the session ends mid-derivation
   (`sessionSignal`, `session-keys.ts:43-53`).
2. **The feed layer.** After every await the decode checks `scope.alive`. If
   the scope is dead the decode returns without emitting. This holds for a
   decode started under the old user that resolves after `close()`/`open()`
   for a new user (RunScope rule 2, `run-scope.ts:24-29`).

**Concurrency and ordering.** Decodes run concurrently, which is master
parity. Master's handler `handlers.find(...)?.handleEvent(payload)` is not
awaited (`use-track-wallet-changes.ts:80-83`). Ordering safety comes from the
`version` gates in the web caches, which are unchanged.

**Rejected: serializing decodes.** That would change latency characteristics
relative to master, and it would be redundant with the version gates.

**Unknown events.** An unknown event name is dropped with
`logger.debug('Realtime event ignored', { event })`. Master silently dropped
unknown events (`find` returned `undefined`).

**Decode failures.** A failure is logged as
`logger.error('Realtime event decode failed', { event, cause })`. The log
contains no payload, and the failure does not count toward the reconnect
budget. On master a failure was an unhandled promise rejection from the
`async` handler.

**Contacts domain.** `ContactRepository.toContact(row, domain)` uses
`SdkConfig.lightningAddressDomain`. That is the same value
`sdk.contacts.list()` uses (`sdk.ts:185-190`) to seed the contacts cache, so
realtime rows and fetched rows agree. Master used the root loader's canonical
host instead (`useLocationData()`,
`apps/web-wallet/app/features/contacts/contact-hooks.ts:137`;
`apps/web-wallet/app/root.tsx:92-98`). The web passes
`lightningAddressDomain: window.location.host` (`sdk.client.ts`). **Named
delta:** on a non-canonical origin, a contact added by realtime now renders
the same domain as a fetched one, where on master the two could differ.
`contact.deleted` decodes the OLD row the trigger sends
(`packages/wallet-sdk/db/supabase/migrations/20260112150000_initial_db.sql:3659-3660`)
into a full `Contact`, as the contract requires (`events.ts:48`).

**Route table** (authoritative). It mirrors the web handler catalog (S6). All
decoders are `(payload, ctx) => Promise<emission>`.

| Broadcast `event` | Mapper (SDK) | Emits |
|---|---|---|
| `ACCOUNT_CREATED` | `(await getAccountRepository()).toAccount(row)` (`domain/accounts/account-repository.ts:170`) | `account.created { account }` |
| `ACCOUNT_UPDATED` | same | `account.updated { account }` |
| `TRANSACTION_CREATED` | `new TransactionRepository(db, enc).toTransaction(row)` (`domain/transactions/transaction-repository.ts:167`) | `transaction.created { transaction }` |
| `TRANSACTION_UPDATED` | same (the extra `previous_acknowledgment_status` column is ignored) | `transaction.updated { transaction }` |
| `CASHU_RECEIVE_QUOTE_CREATED` | `new CashuReceiveQuoteRepository(db, enc, accountRepo).toQuote(row)` (`domain/receive/cashu-receive-quote-repository.ts:23-27`, `:428`) | `cashu-receive-quote.created { quote }` |
| `CASHU_RECEIVE_QUOTE_UPDATED` | same | `cashu-receive-quote.updated { quote }` |
| `CASHU_RECEIVE_SWAP_CREATED` | `new CashuReceiveSwapRepository(db, enc, accountRepo).toReceiveSwap(row)` (`domain/receive/cashu-receive-swap-repository.ts:62-66`, `:310`) | `cashu-receive-swap.created { swap }` |
| `CASHU_RECEIVE_SWAP_UPDATED` | same | `cashu-receive-swap.updated { swap }` |
| `CASHU_SEND_QUOTE_CREATED` | `new CashuSendQuoteRepository(db, enc).toQuote(row)` (`domain/send/cashu-send-quote-repository.ts:103-106`, `:452`) | `cashu-send-quote.created { quote }` |
| `CASHU_SEND_QUOTE_UPDATED` | same | `cashu-send-quote.updated { quote }` |
| `CASHU_SEND_SWAP_CREATED` | `new CashuSendSwapRepository(db, enc).toSwap(row)` (`domain/send/cashu-send-swap-repository.ts:88-91`, `:326`) | `cashu-send-swap.created { swap }` |
| `CASHU_SEND_SWAP_UPDATED` | same | `cashu-send-swap.updated { swap }` |
| `CONTACT_CREATED` | `ContactRepository.toContact(row, lightningAddressDomain)` (`domain/contacts/contact-repository.ts:162`) | `contact.created { contact }` |
| `CONTACT_DELETED` | same, on the OLD row | `contact.deleted { contact }` |
| `SPARK_RECEIVE_QUOTE_CREATED` | `new SparkReceiveQuoteRepository(db, enc).toQuote(row)` (`domain/receive/spark-receive-quote-repository.ts:19-22`, `:293`) | `spark-receive-quote.created { quote }` |
| `SPARK_RECEIVE_QUOTE_UPDATED` | same | `spark-receive-quote.updated { quote }` |
| `SPARK_SEND_QUOTE_CREATED` | `new SparkSendQuoteRepository(db, enc).toQuote(row)` (`domain/send/spark-send-quote-repository.ts:59-62`, `:312`) | `spark-send-quote.created { quote }` |
| `SPARK_SEND_QUOTE_UPDATED` | same | `spark-send-quote.updated { quote }` |
| `USER_UPDATED` | `ReadUserRepository.toUser(row)` (`domain/user/user-repository.ts:357`) | `user.updated { user }` |

Paths in the table are relative to `packages/wallet-sdk/`. The row types are
the ones the mappers declare (`AgicashDb*`, `& { cashu_proofs }` for the two
cashu-send families), cast from `unknown` at the table boundary exactly as
the web did with `any` (`use-track-wallet-changes.ts:49-53`).

### 5. New web handler bodies (e)

Each feature's `use*ChangeHandlers()` stays in its hooks file under the same
name. It now returns a typed object keyed by contract event name:
`WalletChangeHandlers<'account.created' | 'account.updated'>`. The body is
the master body minus the repository decode. Cache calls, state predicates
and version gates are unchanged.

The ten bodies are pinned in S6. Each hook drops its
`use*Repository()` call for the realtime path only. Repository hooks used by
other code stay; the canary grep G4 checks this.

**`transaction.updated` acknowledgement gap.** On master the handler compared
the broadcast's `previous_acknowledgment_status` (trigger at
`20260112150000_initial_db.sql:3622-3627`) with the new value, and
invalidated the unacknowledged count when they differed
(`apps/web-wallet/app/features/transactions/transaction-hooks.ts:279-294`).
The contract payload is `{ transaction }` only (`events.ts:50`).

**Decision.** Read the cached transaction before the upsert, using a new
`TransactionsCache.get(id)` that is a one-line
`queryClient.getQueryData([TransactionsCache.Key, id])`. Invalidate the count
when there is no cached entry, or when the cached `acknowledgmentStatus`
differs from the incoming one.

**Named delta:** there is +1 `count` refetch for a `TRANSACTION_UPDATED`
whose transaction is not in the per-id cache **and** whose ack status did not
change. The cost is one `head` count query. When the cache is warm the
behaviour is identical. When an intermediate event was missed, the flipped
behaviour is *more* correct than master.

**Rejected alternatives:**

- Adding `previousAcknowledgmentStatus` to the contract payload. That is a
  contract change for one UI badge.
- Always invalidating. That doubles the count queries on every update.

### 6. Reconnect state machine (f)

There is one channel per session, so master's multi-channel resubscribe queue
(`supabase-realtime-manager.ts:87-91`, `:306-327`, `:452-517`) is dropped.
The semantics that are kept are listed in this table.

| Aspect | Master | Feed |
|---|---|---|
| Retry delays | `[0,100,500,1000,3000,6000,10000,20000,30000]` ms (`:99-102`) | same constant |
| Retry budget | 9, then status `error` (`:452-517`) | 9 consecutive failed retries since the last `SUBSCRIBED`, then `error` |
| Per attempt | `removeChannel` old → rebuild → `await setAuth()` → `subscribe` (`:542-634`) | same: `leave()` old → `await transport.refreshAuth()` → `transport.join()` |
| `SUBSCRIBED` | status `subscribed`; every SUBSCRIBED calls `onConnected` | state `subscribed`; **every** entry emits `connected`; retry counter reset |
| `CHANNEL_ERROR`/`TIMED_OUT` while offline/inactive | `closeChannel` → `closed` (`:383-409`) | `leave()` → state `closed`, no retry |
| `CHANNEL_ERROR`/`TIMED_OUT` while active | `resubscribe` with backoff | retry with backoff |
| `CLOSED` | status `closed` | state `closed` (channel left) |
| Activity regained | `resubscribeInactiveChannels` for `closed`/`error`/idle (`:423-443`) | `closed` → fresh cycle (counter 0). `error` is **not** restarted (Decision 7). |
| Hidden tab, no error | stays subscribed (no proactive unsubscribe, `:334-373`) | same |
| First subscribe | at mount, even if hidden | at `open()`, even if inactive |
| Inactive during a backoff | keeps counting toward `error` | after the delay, if inactive → `closed` (abandon). **Deliberate deviation**, per the RunScope rule "a loop that cannot proceed returns; its next trigger restarts" (`run-scope.ts:76-80`). The result is that a backgrounded tab can no longer reach the terminal error screen while hidden. |
| Online/active source | `navigator.onLine` + `!document.hidden` (`supabase-realtime-hooks.ts:28-36`) | `SdkConfig.activity` (`domain/sdk/index.ts:50-54`, `:62`). The web adapter reports `visibilityState !== 'hidden'` and an online flag seeded `true` (`apps/web-wallet/app/features/shared/browser-activity.client.ts`). **Minor delta:** a tab that boots offline makes a first join attempt, which master skipped. It fails into `closed` and recovers on `online`. |

**Mapping internal states to the public payload.** Emit on change only,
except `connected`, which is emitted on every entry.

| Internal state | Public `connection.changed` |
|---|---|
| `idle`, `subscribing` (first) | none |
| `subscribed` | `connected` |
| `reconnecting`, `closed`, `subscribing` (after a failure) | `reconnecting` |
| `error` | `error` |

**Stale callbacks.** Each `join()` handle is compared against the current
handle before its status or broadcast callbacks act. A superseded join's
`CLOSED`, caused by our own `removeChannel`, is ignored.

**Channel rejoin timers.** realtime-js's channel has its own rejoin timer
(`RealtimeChannel.js:70-105`). As on master, the feed removes and rebuilds
the channel on error rather than relying on it.

### 7. Terminal error and host behaviour (g)

**In the SDK.** When the feed reaches `error`:

1. It leaves the channel. When no channels remain, realtime-js disconnects
   the socket (`RealtimeClient.js:210-216`).
2. It logs `logger.error('Realtime channel failed', { topic, cause })`.
3. It emits `connection.changed { state: 'error' }`, which is retained for
   replay.
4. It stays in `error` until session end, identity change, `dispose()` or a
   page reload. Activation does not restart it, which matches the contract:
   "`error` is terminal after retries exhaust"
   (`events.ts:63-70`; `contract-proposal.md:396-401`).

This matches the contract's statement that change-feed death is reported
through `connection.changed: 'error'` alone and is **not** a background
failure (`contract-proposal.md:280-290`). `task-processor.state-changed` is
not touched.

**On the web.** `useTrackWalletChanges` sets local state on `error` and then
throws `new SupabaseRealtimeError('Realtime channel error')` during render.
The class moves from `apps/web-wallet/app/lib/supabase/supabase-realtime-hooks.ts:14-22`
to `apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts`
unchanged: same name, same `name = 'SupabaseRealtimeError'`, same optional
`originalError`, which the web now leaves `undefined` because the cause is
logged by the SDK. Effects on the rest of the app:

- `root.tsx:37` changes only its import path.
- The 'Connection lost' screen and Reload button (`root.tsx:225-226`,
  `:265-279`) are unchanged.
- Sentry grouping by `name` is unchanged (`root.tsx:371-379`).

**Named delta:** on master, navigating back off the error screen remounted
`Wallet` and started a fresh subscribe cycle. Now it re-throws from the
replayed `error`. Reload is the recovery, which is what the screen offers.

**Rejected:** auto-restarting from `error` on activation. That contradicts
"terminal".

### 8. Logging (h)

**Transport logs.** `createAgicashDbClient` (`packages/wallet-sdk/db/client.ts:11-21`)
gains an optional `logger?: Logger`. When it is set, it installs
`realtime: { logger, logLevel: 'info' }`. The logger forwards
`` `Realtime ${kind}: ${msg}` `` at `debug`, and **drops `data` for `push` and
`receive` frames in every environment**. `data` is kept for the
`transport` / `channel` / `error` kinds (S5).

**Why `push` frames lose their data.** Master's web logger redacted only
`payload` of `receive` frames, and only in production
(`apps/web-wallet/app/features/agicash-db/database.client.ts:19-43`). The
`push` log includes the join's `access_token` (`RealtimeClient.js:299`), and
the `receive` log includes the decrypted-later ciphertext payload (`:472`).
**Named delta (intentional):** dev consoles lose the push/receive frame
bodies. Kind and message, including topic and event, remain.

**Feed logs.** The feed logs at `debug` the lines master's `logDebug` emitted
(`supabase-realtime-manager.ts:52-59`): state transitions, attempt `n/9`,
delay, and topic. A terminal failure logs at `error`. A decode failure logs
at `error` with `{ event, cause }` only. There are no payloads and no tokens.

The web's `consoleLogger` (`apps/web-wallet/app/features/shared/sdk.client.ts`)
already routes `debug` to `console.debug`, so dev visibility is preserved.

### 9. Socket and auth (i)

**One socket per tab.** The SDK client's `db.realtime` is the only realtime
client that ever connects. `agicashDbClient` stays, because PostgREST users
remain:

- `entry.client.tsx`
- the receive/send hooks
- `transaction-repository-hooks.ts`
- `account-repository-hooks.ts`

It loses its realtime options. Since it never has a channel, its socket never
opens. `supabase-js` merely constructs the client
(`node_modules/@supabase/supabase-js/dist/index.mjs:226-230`).

**Token refresh.** The SDK client is created with
`accessToken: sessionToken.getToken` (`sdk.ts:151-155`). At construction
there is no session, so `getToken()` resolves `null` and realtime-js stays in
**callback** mode (`supabase-js/dist/index.mjs:226-230`). In callback mode:

- Every heartbeat calls `_setAuthSafely` (`RealtimeClient.js:395`), which
  re-resolves the memoized token.
- The token is refreshed 5 s before expiry
  (`packages/wallet-sdk/db/supabase-session.ts:73-83`).
- Long sessions keep a valid channel token, as on master.

The feed calls `transport.refreshAuth()` (= `realtime.setAuth()` with no
argument, `RealtimeClient.js:327-335`) before every join, as master did
(`supabase-realtime-manager.ts:414-418`). `_onConnOpen` awaits auth before
flushing the join (`RealtimeClient.js:548-556`). A `refreshAuth()` rejection
(the token mint failed) is treated like `CHANNEL_ERROR`: it is retryable and
counts toward the budget.

### 10. Web deletions and their consumers (j)

| Delete / edit | Consumers | Action |
|---|---|---|
| `apps/web-wallet/app/lib/supabase/index.ts`, `supabase-realtime-channel-builder.ts`, `supabase-realtime-channel.ts`, `supabase-realtime-hooks.ts`, `supabase-realtime-manager.ts` | `use-track-wallet-changes.ts:2`, `wallet.tsx:4`, `database.client.ts` (manager import), `root.tsx:37` | delete all 5; repoint `root.tsx`; rewrite the others |
| `database.client.ts`: `agicashRealtimeClient` (`:51-53`), `window.agicashRealtime` (`:54-55`), `realtime:` options (`:19-43`), manager import | `wallet.tsx:5`, `use-track-wallet-changes.ts:1` | remove; keep `agicashDbClient` |
| `wallet.tsx:4`, `:5`, `:54` (`useSupabaseRealtimeActivityTracking(agicashRealtimeClient)`) | — | remove the lines; `useTrackWalletChanges()` at `:53` stays |
| `use-track-wallet-changes.ts` (150 lines) | `wallet.tsx:53` | rewrite (S7) |

No other file imports `~/lib/supabase` (canary G1). The e2e package has no
reference to `agicashRealtime` or the manager.

### 11. Processors unchanged and their realtime-timing dependencies (k)

`TaskProcessor` (`task-processing.ts:84-92`) and the six `useProcess*` hooks
read the pending/unresolved caches. On master the change handlers fed those
caches, and now the same handler bodies, driven by SDK events, feed them. No
processor file is in the File map.

The processors and flows rely on realtime timing in these places:

1. **Cross-client discovery.** Created/updated rows from other tabs/devices
   reach `pending*`/`unresolved*` caches only through `*.created`/`*.updated`
   (S6 rows 5–18). These are the same cache ops and the same state predicates.
2. **Gap recovery.** The 13-invalidate sweep on every `connected` refetches
   the pending lists after any disconnect (Decision 3).
3. **Delayed `TRANSACTION_UPDATED` compensation.** Two `onSuccess`
   invalidations exist because the realtime transaction update may lag
   (`apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts:625-635`,
   `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts:505-515`).
   They stay. The SDK path adds one async hop (an emitter dispatch is
   synchronous after the decode, so the added latency is ≈0) and does not
   change that assumption.
4. **Leader/follower.** Followers have no processors, but they still need the
   feed for UI freshness. The feed is per tab, not per leader (Decision 1).

## Pinned seams (authoritative code)

### S1. `packages/wallet-sdk/domain/wallet/realtime-feed.ts` (new; Task 1)

The exported surface and skeleton are authoritative. The implementer fills in
the bodies marked `…` exactly as Decisions 4 and 6 describe.

```ts
import {
  REALTIME_SUBSCRIBE_STATES,
  type RealtimeClient,
} from '@supabase/supabase-js';
import type { ActivityMonitor, AuthSession, Logger, WalletEventMap } from '../sdk';
import type { AgicashDb } from '../../db/database';
import type { Encryption } from '../../lib/encryption'; // as session-keys.ts:6-14 imports it
import type { AccountRepository } from '../accounts/account-repository';
import { createRunScopes, type RunScope, type ScopeClock } from '../../lib/run-scope';

export const RETRY_DELAYS_MS = [0, 100, 500, 1000, 3000, 6000, 10000, 20000, 30000];

/** The `connection.changed` and domain events the feed emits. */
export type FeedEvent =
  | 'connection.changed'
  | 'user.updated'
  | 'account.created' | 'account.updated'
  | 'contact.created' | 'contact.deleted'
  | 'transaction.created' | 'transaction.updated'
  | 'cashu-receive-quote.created' | 'cashu-receive-quote.updated'
  | 'cashu-receive-swap.created' | 'cashu-receive-swap.updated'
  | 'spark-receive-quote.created' | 'spark-receive-quote.updated'
  | 'cashu-send-quote.created' | 'cashu-send-quote.updated'
  | 'cashu-send-swap.created' | 'cashu-send-swap.updated'
  | 'spark-send-quote.created' | 'spark-send-quote.updated';

export type FeedEmission = {
  [K in FeedEvent]: { event: K; payload: WalletEventMap[K] };
}[FeedEvent];

/** A joined channel; `leave()` resolves once the channel is removed. */
export type RealtimeJoin = { leave(): Promise<void> };

/** The narrow seam over realtime-js the feed drives; faked in tests. */
export type RealtimeTransport = {
  /** Re-resolves the access token for the socket (`realtime.setAuth()`). */
  refreshAuth(): Promise<void>;
  /** Joins a private broadcast channel and reports its status changes. */
  join(
    topic: string,
    listener: {
      onBroadcast(event: string, payload: unknown): void;
      onStatus(status: REALTIME_SUBSCRIBE_STATES, error?: Error): void;
    },
  ): RealtimeJoin;
};

export function createSupabaseRealtimeTransport(client: RealtimeClient): RealtimeTransport {
  return {
    refreshAuth: () => client.setAuth(),
    join(topic, listener) {
      const channel = client
        .channel(topic, { config: { private: true } })
        .on('broadcast', { event: '*' }, ({ event, payload }) =>
          listener.onBroadcast(event, payload),
        )
        .subscribe((status, error) => listener.onStatus(status, error));
      return {
        leave: async () => {
          await client.removeChannel(channel);
        },
      };
    },
  };
}

export type RealtimeFeedDeps = {
  transport: RealtimeTransport;
  getSession: () => AuthSession;
  db: AgicashDb;
  getEncryption: () => Promise<Encryption>;
  getAccountRepository: () => Promise<AccountRepository>;
  lightningAddressDomain: string;
  activity: ActivityMonitor;
  emit: (emission: FeedEmission) => void;
  logger: Logger;
  /** Test seam; defaults to the global timers. */
  clock?: ScopeClock;
};

export type RealtimeFeed = {
  /** Opens the channel for the live session's user; no-op when logged out, disposed, or already open for that user. */
  open(): void;
  /** Leaves the channel and fences every in-flight decode. Synchronous; idempotent. */
  close(): void;
  /** `close()`, then every later `open()` is a no-op. */
  dispose(): void;
};

export function createRealtimeFeed(deps: RealtimeFeedDeps): RealtimeFeed { … }
```

**Body rules.** The module-level `systemClock` copies
`task-processor-runtime.ts:40-49`. The class must follow these rules:

- `open()` resolves the session as described in Decision 1. It then runs
  `scope = scopes.renew()` and
  `scope.onCleanup(deps.activity.subscribe(() => onActivity(scope)))`. Finally
  it subscribes via `void subscribe(scope)` at attempt 0.
- **`subscribe(scope)`:**
  1. Leave any current join, tracked with `void scope.track(join.leave())`.
  2. Run `await scope.track(deps.transport.refreshAuth())`. If it rejects,
     treat it as a failure (go to `retry`).
  3. `if (!scope.alive) return;`
  4. Call `deps.transport.join(\`wallet:${userId}\`, …)` and keep the handle.
     Callbacks act only when `scope.alive && current === handle`.
- **`onStatus`:**
  - `SUBSCRIBED` → reset the counter, set state `subscribed`, emit `connected`.
  - `CLOSED` → leave, set `closed`.
  - `CHANNEL_ERROR` / `TIMED_OUT` → `void retry(scope, error)`.
- **`retry`:**
  1. Leave the channel.
  2. If inactive → `closed` and return.
  3. If the counter equals `RETRY_DELAYS_MS.length` → `error`, log, and
     return.
  4. Otherwise set `reconnecting` and
     `await scope.delay(RETRY_DELAYS_MS[counter++])`.
  5. If the scope is dead, return. If inactive → `closed` and return.
  6. Otherwise `subscribe(scope)`.
- **`onActivity(scope)`:** if `isActive()` and the state is `closed`, reset
  the counter and `subscribe(scope)`. Any other state does nothing.
- **`onBroadcast`:**
  1. Look up the route (Decision 4). If none → `debug` log and return.
  2. `emission = await scope.track(route(payload))`.
  3. `if (!scope.alive) return;` then `deps.emit(emission)`.
  4. In the catch block: if the scope is alive → `logger.error('Realtime event decode failed', { event, cause })`.
- **`close()`:**
  1. Leave the current join with `void` (not tracked; the scope is dying).
  2. `scopes.cancel()`.
  3. Reset the state to `idle`, the user id to `undefined` and the counter
     to 0.
  4. Emit **nothing**.

### S2. `packages/wallet-sdk/domain/sdk/events.ts` replay diff (Task 1)

```diff
@@ (doc on 'connection.changed', events.ts:63-69)
    * the invalidate-all / refetch-after-a-gap signal; `error` is terminal after
-   * retries exhaust, distinct from a long `reconnecting`.
+   * retries exhaust, distinct from a long `reconnecting`. Replay-latest: a
+   * handler that subscribes later immediately receives the current state.
    */
@@ class WalletEventEmitter (events.ts:95-104)
   private lastSessionStarted:
     | WalletEventMap['auth.session-started']
     | undefined;
+  // Replay-latest for connection.changed: a host that mounts after the
+  // channel connected still runs its connected-sweep once.
+  private lastConnectionChanged:
+    | WalletEventMap['connection.changed']
+    | undefined;
@@ on() (events.ts:112-118)
     if (event === 'auth.session-started' && this.lastSessionStarted) {
       …unchanged…
     }
+    if (event === 'connection.changed' && this.lastConnectionChanged) {
+      this.dispatch(
+        handler as (payload: WalletEventMap['connection.changed']) => void,
+        'connection.changed',
+        this.lastConnectionChanged,
+      );
+    }
@@ emit() (events.ts:140-143)
     if (event === 'auth.session-started') { …unchanged… }
+    if (event === 'connection.changed') {
+      this.lastConnectionChanged =
+        payload as WalletEventMap['connection.changed'];
+    }
@@ clear() (events.ts:159-167)
-   * retained `auth.session-started` user and accounts; extend here as more events
-   * adopt replay-latest). Called by the SDK on session end.
+   * retained `auth.session-started` user and accounts and the latest
+   * `connection.changed`). Called by the SDK on session end.
    */
   clear(): void {
     this.lastSessionStarted = undefined;
+    this.lastConnectionChanged = undefined;
   }
```

### S3. `packages/wallet-sdk/domain/sdk/sdk.ts` wiring (Task 2)

```diff
+import {
+  createRealtimeFeed,
+  createSupabaseRealtimeTransport,
+  type RealtimeFeed,
+} from '../wallet/realtime-feed';
@@ fields
+  private readonly realtimeFeed: RealtimeFeed;
@@ before `this.authService = new AuthService({` (sdk.ts:111)
+    // Same two-assignment pattern as taskProcessor: the session callbacks
+    // below capture the binding before the feed (which needs db) exists.
+    let realtimeFeed: RealtimeFeed | undefined = undefined;
@@ AuthService deps (sdk.ts:118-121)
-      onSessionStarted: userProvisioner.provision,
+      onSessionStarted: async (authUser) => {
+        await userProvisioner.provision(authUser);
+        realtimeFeed?.open();
+      },
       onSessionEnded: () => {
         if (taskProcessor) {
           void taskProcessor.stop();
         }
+        // Leave before the token reset: a joined channel would otherwise be
+        // pushed the logged-out (null) token on the next auth refresh.
+        realtimeFeed?.close();
         // The token cache must die with the session: …
@@ createAgicashDbClient (sdk.ts:151-155)
     const db = createAgicashDbClient({
       url: config.db.url,
       anonKey: config.db.anonKey,
       accessToken: sessionToken.getToken,
+      logger: config.logger,
     });
@@ after `this.taskProcessor = taskProcessor;` and after `accounts` is built (sdk.ts:170-175)
+    realtimeFeed = createRealtimeFeed({
+      transport: createSupabaseRealtimeTransport(db.realtime),
+      getSession: () => this.authService.getSession(),
+      db,
+      getEncryption: () => keys.getEncryption(),
+      getAccountRepository: accounts.getRepository,
+      lightningAddressDomain: config.lightningAddressDomain,
+      activity: config.activity,
+      emit: ({ event, payload }) => events.emit(event, payload),
+      logger: config.logger,
+    });
+    this.realtimeFeed = realtimeFeed;
@@ dispose() (sdk.ts:241-251)
     this.disposed = true;
     await this.taskProcessor.stop();
+    this.realtimeFeed.dispose();
     this.authService.teardown();
```

If `events.emit(event, payload)` does not type-check against the correlated
union, write
`emit: (e) => events.emit(e.event, e.payload as never)`. Do **not** widen
`WalletEventEmitter.emit`.

`getSession` must not use `getLiveSession`. It throws `DisposedError`, and a
late `open()` after `dispose` must be a quiet no-op (Decision 1).

### S4. Close/open ordering inside `onSessionEnded` (Task 2, canary G3)

The order after the change is:

1. `taskProcessor.stop()`
2. `realtimeFeed.close()`
3. `sessionToken.reset()`
4. `clearSparkWallets()`
5. `clearAgicashMintAuthToken()`
6. `keys.reset()`
7. `userProvisioner.reset()`
8. `events.clear()`

### S5. `packages/wallet-sdk/db/client.ts` logger (Task 2)

```ts
type AgicashDbClientConfig = {
  url: string;
  anonKey: string;
  /** Resolves the Supabase session JWT; null selects the anon key. */
  accessToken: () => Promise<string | null>;
  /** Receives realtime transport logs at debug; frame bodies of `push`/`receive` are dropped (they carry the access token and row payloads). */
  logger?: Logger;
};

export function createAgicashDbClient(config: AgicashDbClientConfig): AgicashDb {
  const { logger } = config;
  return createClient<Database>(config.url, config.anonKey, {
    accessToken: config.accessToken,
    db: { schema: 'wallet' },
    ...(logger && {
      realtime: {
        logger: (kind: string, msg: string, data?: unknown) => {
          const keepData = kind !== 'push' && kind !== 'receive';
          logger.debug(`Realtime ${kind}: ${msg}`, keepData ? { data } : undefined);
        },
        logLevel: 'info',
      },
    }),
  });
}
```

`Logger` is declared at `domain/sdk/index.ts:34-39`. Import it type-only:
`import type { Logger } from '../domain/sdk';`. `lib/logger.ts:1` already
imports it the same way, and a type-only import is erased, so it adds no
runtime cycle.

### S6. Web handler bodies (Task 2)

Shared type, exported from `use-track-wallet-changes.ts`:

```ts
export type WalletChangeHandlers<K extends keyof WalletEventMap> = {
  [E in K]: (payload: WalletEventMap[E]) => void;
};
```

The table below gives each body. "Same as master" means the cache calls copy
the cited lines verbatim. Only the decode line and the payload parameter
change.

| # | Hook (file:lines at base) | New entries |
|---|---|---|
| 1 | `useAccountChangeHandlers` (`accounts/account-hooks.ts:117-136`) | `'account.created': ({ account }) => accountCache.upsert(account)`; `'account.updated'`: same. Drop `useAccountRepository()` here. |
| 2 | `useTransactionChangeHandlers` (`transactions/transaction-hooks.ts:263-295`) | `'transaction.created': ({ transaction }) => { cache.upsert(transaction); if (transaction.acknowledgmentStatus === 'pending') cache.invalidateUnacknowledgedCount(); }`; `'transaction.updated': ({ transaction }) => { const cached = cache.get(transaction.id); cache.upsert(transaction); if (!cached \|\| cached.acknowledgmentStatus !== transaction.acknowledgmentStatus) cache.invalidateUnacknowledgedCount(); }`. Add `get(id: string) { return this.queryClient.getQueryData<Transaction>([TransactionsCache.Key, id]); }` to `TransactionsCache` (`:29-90`), with a one-line JSDoc. |
| 3 | `useCashuReceiveQuoteChangeHandlers` (`receive/cashu-receive-quote-hooks.ts:281-310`) | `.created ({ quote })` → `pendingQuotesCache.add(quote)`; `.updated ({ quote })` → same as master `:297-306` |
| 4 | `useCashuReceiveSwapChangeHandlers` (`receive/cashu-receive-swap-hooks.ts:132-156`) | `.created ({ swap })` → `pendingSwapsCache.add(swap)`; `.updated` → same as master `:144-155` |
| 5 | `useCashuSendQuoteChangeHandlers` (`send/cashu-send-quote-hooks.ts:235-266`) | `.created ({ quote })` → `unresolved.add`; `.updated` → same as master `:251-265` |
| 6 | `useCashuSendSwapChangeHandlers` (`send/cashu-send-swap-hooks.ts:377-411`) | `.created ({ swap })` → `unresolved.add`; `.updated` → `cashuSendSwapCache.updateIfExists` + DRAFT/PENDING update else remove (`:394-410`) |
| 7 | `useContactChangeHandlers` (`contacts/contact-hooks.ts:135-153`) | `'contact.created': ({ contact }) => contactsCache.add(contact)`; `'contact.deleted': ({ contact }) => contactsCache.remove(contact.id)`. Drop `useLocationData()` (`:137`) if no longer used in the hook. |
| 8 | `useSparkReceiveQuoteChangeHandlers` (`receive/spark-receive-quote-hooks.ts:208-235`) | `.created` → `pending.add`; `.updated` → `updateIfExists` + UNPAID update else remove (`:221-234`) |
| 9 | `useSparkSendQuoteChangeHandlers` (`send/spark-send-quote-hooks.ts:99-124`) | `.created` → `unresolved.add`; `.updated` → UNPAID/PENDING update else remove (`:111-123`) |
| 10 | `useUserChangeHandlers` (`user/user-hooks.tsx:40-50`) | `'user.updated': ({ user }) => userCache.set(user)` |

All paths in the table are under `apps/web-wallet/app/features/`.

Remove now-unused `AgicashDb*` type imports and repository-hook calls from
each file. Keep any repository hook that other code in the file still uses.
`biome` (via `bun run fix:all`) flags anything left unused.

### S7. `apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts` (Task 2; full rewrite)

```ts
import type { WalletEventMap } from '@agicash/wallet-sdk';
import { useEffect, useState } from 'react';
import { sdk } from '~/features/shared/sdk.client';
import { useLatest } from '~/lib/use-latest';
// …the same 10 handler-hook and 13 cache-hook imports as base :4-47
//   (minus `useUser`, no longer needed)

/** Thrown during render when the SDK's realtime channel fails terminally. */
export class SupabaseRealtimeError extends Error {
  constructor(
    message: string,
    public readonly originalError?: Error,
  ) {
    super(message);
    this.name = 'SupabaseRealtimeError';
  }
}

export type WalletChangeHandlers<K extends keyof WalletEventMap> = { … }; // S6

export const useTrackWalletChanges = () => {
  // the 10 handler hooks and 13 cache hooks, as base :93-116
  const handlers = {
    ...accountChangeHandlers,
    ...transactionChangeHandlers,
    // … the other 8, same order as base :119-129
  };
  const handlersRef = useLatest(handlers);
  const onConnectedRef = useLatest(() => {
    // the 13 invalidates, verbatim and in order, from base :135-147
  });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const events = Object.keys(handlersRef.current) as (keyof typeof handlers)[];
    const unsubscribes = events.map((event) =>
      sdk.events.on(event, (payload) =>
        (handlersRef.current[event] as (p: typeof payload) => void)(payload),
      ),
    );
    unsubscribes.push(
      sdk.events.on('connection.changed', ({ state }) => {
        if (state === 'connected') onConnectedRef.current();
        if (state === 'error') setFailed(true);
      }),
    );
    return () => {
      for (const unsubscribe of unsubscribes) unsubscribe();
    };
  }, [handlersRef, onConnectedRef]);

  if (failed) {
    throw new SupabaseRealtimeError('Realtime channel error');
  }
};
```

- `useLatest` refs are stable, so the effect runs once per mount and gives
  one replay per mount (Decision 3).
- The domain-event handlers are registered **before** `connection.changed`.
  The replayed `connected` therefore sweeps only after every handler is in
  place, so an event emitted during the sweep's refetch window is not lost.
  This is the same window as master's subscribe-then-`onConnected`.
- If TypeScript rejects the per-event cast, keep the cast local to this one
  call. Do not loosen `WalletEvents.on`.

### S8. `apps/web-wallet/app/root.tsx:37` and `wallet.tsx` (Task 2)

```diff
-import { SupabaseRealtimeError } from '~/lib/supabase/supabase-realtime-hooks';
+import { SupabaseRealtimeError } from '~/features/wallet/use-track-wallet-changes';
```

In `wallet.tsx`, delete line 4 (`useSupabaseRealtimeActivityTracking`
import), line 5 (`agicashRealtimeClient` import) and line 54 (the call).

### S9. Design-spec bullet (Task 2, verbatim)

Insert this as a new sub-bullet under step 18 in
`docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`,
directly after line 99 (`3. web drops its realtime layer …`) and before the
`- **Split the receive/send repos …` bullet at `:100`:

```markdown
    - **Order: sub-slice 3 lands before sub-slice 2** (decided in the step-18.3
      plan, `docs/superpowers/plans/2026-10-13-wallet-sdk-realtime-feed-slice.md`).
      The web processors discover cross-client work only through the realtime
      feed — the change handlers feed their pending/unresolved caches — so moving
      the feed into the SDK first leaves the processors web-side and unchanged
      (they read the same caches, now fed by SDK events), and the later processor
      port lets each SDK saga consume the SDK feed directly instead of a feed
      still owned by React.
```

## Canary greps (run before and after Task 2)

| # | Command (repo root) | Expect after Task 2 |
|---|---|---|
| G1 | `rg -n "lib/supabase" apps/web-wallet/app` | no matches |
| G2 | `rg -n "agicashRealtime\|SupabaseRealtimeManager\|useSupabaseRealtime" apps packages` | no matches |
| G3 | `rg -n "realtimeFeed\|sessionToken.reset" packages/wallet-sdk/domain/sdk/sdk.ts` | `realtimeFeed?.close()` appears on a line before `sessionToken.reset()` |
| G4 | `rg -n "useCashuReceiveQuoteRepository\|useTransactionRepository\|useAccountRepository" apps/web-wallet/app` | each hook still has ≥1 non-realtime caller, or its definition was removed together with its last caller (list any removal in the PR) |
| G5 | `rg -n "from 'react'\|@tanstack" packages/wallet-sdk` | no matches |
| G6 | `git diff --stat master -- apps/web-wallet/app/features/wallet/task-processing.ts packages/wallet-sdk/domain/wallet/task-processor-runtime.ts` and the six `useProcess*` files | empty |
| G7 | `rg -n "createRealtimeFeed" packages/wallet-sdk/index.ts packages/wallet-sdk/temporary.ts packages/wallet-sdk/domain/sdk/index.ts` | no matches (internal) |

## File map

**Task 1:**

| File | Change |
|---|---|
| `packages/wallet-sdk/domain/wallet/realtime-feed.ts` | new (S1) |
| `packages/wallet-sdk/domain/wallet/realtime-feed.test.ts` | new (tests a–p) |
| `packages/wallet-sdk/domain/sdk/events.ts` | replay-latest for `connection.changed` (S2) |
| `packages/wallet-sdk/domain/sdk/events.test.ts` | tests q–s |

**Task 2:**

| File | Change |
|---|---|
| `packages/wallet-sdk/domain/sdk/sdk.ts` | wiring (S3/S4) |
| `packages/wallet-sdk/domain/sdk/sdk.test.ts` | test t |
| `packages/wallet-sdk/db/client.ts` | optional realtime logger (S5) |
| `packages/wallet-sdk/db/client.test.ts` | new, test u |
| `apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts` | rewrite (S7) |
| `apps/web-wallet/app/features/wallet/wallet.tsx` | remove `:4`, `:5`, `:54` |
| `apps/web-wallet/app/root.tsx` | import path (S8) |
| `apps/web-wallet/app/features/agicash-db/database.client.ts` | remove realtime options, manager, window hook |
| `apps/web-wallet/app/features/accounts/account-hooks.ts` | S6 row 1 |
| `apps/web-wallet/app/features/transactions/transaction-hooks.ts` | S6 row 2 + `TransactionsCache.get` |
| `apps/web-wallet/app/features/receive/cashu-receive-quote-hooks.ts` | S6 row 3 |
| `apps/web-wallet/app/features/receive/cashu-receive-swap-hooks.ts` | S6 row 4 |
| `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts` | S6 row 5 |
| `apps/web-wallet/app/features/send/cashu-send-swap-hooks.ts` | S6 row 6 |
| `apps/web-wallet/app/features/contacts/contact-hooks.ts` | S6 row 7 |
| `apps/web-wallet/app/features/receive/spark-receive-quote-hooks.ts` | S6 row 8 |
| `apps/web-wallet/app/features/send/spark-send-quote-hooks.ts` | S6 row 9 |
| `apps/web-wallet/app/features/user/user-hooks.tsx` | S6 row 10 |
| `apps/web-wallet/app/lib/supabase/index.ts` and the four `supabase-realtime-*.ts` | delete |
| `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md` | S9 bullet |

The following stay **untouched**:

- `task-processing.ts`, the six `useProcess*` hooks, `task-processor-runtime.ts` (+ test)
- `browser-activity.client.ts`, `sdk.client.ts`, `session-started.ts`, `entry.client.tsx`
- `auth-service.ts`, `user-provisioner.ts`, `session-keys.ts`, `supabase-session.ts`
- all SDK repositories
- every migration
- `package.json` files and `bun.lock`

## Task 1: SDK feed module and unit tests (not wired)

**Steps**

1. Write `realtime-feed.ts` per S1 and Decisions 4/6/7/8 (feed log lines).
2. Write `realtime-feed.test.ts`. Use a fake `RealtimeTransport` that records
   `refreshAuth`/`join`/`leave` calls in order and exposes
   `fire(status, error?)` / `broadcast(event, payload)` on the current join.
   Use a fake activity monitor (an `isActive` flag plus `set(active)` that
   notifies subscribers), and the manual `ScopeClock` pattern from
   `task-processor-runtime.test.ts`.
3. For decoding, inject stubs: pass a fake `db` (unused by the stubs) and
   `getEncryption` returning a sentinel. Test the route table **by event
   name**, which is the table-driven test (b). Stub the mappers through
   `mock.module` for the repository modules, or extract the route table as an
   internal `createRoutes(ctx)` the test can call with stub repositories.
   Prefer the latter, which needs no module mocking, and keep it unexported
   from the package entry points (G7).
4. Apply S2 to `events.ts` and add tests q–s to `events.test.ts`, beside the
   `auth.session-started replay-latest` block (`events.test.ts:76`).
5. Gates: `bun run fix:all`, `bun run typecheck`, `cd packages/wallet-sdk && bun test`.

**Lettered tests** (`realtime-feed.test.ts` unless noted)

- **a. Open joins after auth.** With a logged-in session, `open()` calls
  `refreshAuth()` **then** `join('wallet:<id>')`. `SUBSCRIBED` emits exactly
  one `connection.changed { connected }`.
- **b. Mapping, table-driven.** For each of the 19 broadcast names, a broadcast
  produces one emission with the contract event name and the stub-mapped
  object. `TRANSACTION_UPDATED`'s extra column does not reach the mapper's
  output. `CONTACT_DELETED` maps the old row with the configured domain.
- **c. Unknown event.** A broadcast `FOO` emits nothing and logs at debug
  with `{ event: 'FOO' }` and no payload.
- **d. Decode failure.** A rejecting mapper produces no emission and one
  `error` log with `{ event, cause }`, whose meta has no `payload` key. The
  feed state is unchanged.
- **e. Transient error, backoff, recovery.** `CHANNEL_ERROR` while active
  causes, in order:
  1. `leave` of the old join
  2. `connection.changed { reconnecting }`
  3. a 0 ms delay
  4. `refreshAuth`
  5. a new join

  `SUBSCRIBED` then emits `connected` again (every entry emits).
- **f. Delay schedule.** Consecutive failures wait exactly
  `RETRY_DELAYS_MS[0..8]`. Advance the clock by `delay - 1` and assert that no
  join happened yet.
- **g. Budget exhausted.** Nine failed retries after the initial join (ten
  joins in total) lead to:
  - one `connection.changed { error }`
  - one `error` log
  - the channel left and no further join

  Activation afterwards does not rejoin.
- **h. Counter resets on success.** After 5 failures, `SUBSCRIBED`, then 9
  more failures, the feed is still retrying. The terminal error comes only on
  the 10th consecutive failure.
- **i. Inactive error.** `TIMED_OUT` while inactive leads to leave and
  `reconnecting` (if it was `connected`), with no delay armed and no join.
  Activation (`set(true)`) then causes a fresh join, and `SUBSCRIBED` emits
  `connected`.
- **j. Inactive during backoff.** A failure while active arms the delay. Going
  inactive before it fires means that when the delay fires there is no join
  and the state is `closed`. Activation then rejoins with a fresh budget.
- **k. Hidden with no error.** An activity change to inactive while
  subscribed causes no leave and no emission.
- **l. `CLOSED`.** The feed leaves and the state is `closed`. Activation
  rejoins.
- **m. Session end fences in-flight decodes.** Start a decode whose mapper
  promise is pending, call `close()`, then resolve the mapper: no emission.
  `close()` leaves the join. Status callbacks on the old join after `close()`
  are ignored.
- **n. Identity change.** Open as user A with a decode pending, `close()`,
  switch the session to user B, `open()`, then resolve A's decode. Assert:
  - nothing is emitted for A
  - the join topic is `wallet:B`
  - B's `SUBSCRIBED` emits `connected`
- **o. Idempotence and guards.**
  - A second `open()` for the same user, connected or `error`, does nothing.
  - `open()` while logged out does nothing.
  - `dispose()` then `open()` does nothing.
  - `close()` twice is safe.
- **p. `refreshAuth` rejection** counts as a failure: `reconnecting`, then a
  backoff, then a retry.
- **q.** (`events.test.ts`) After an emitted `connected`, a late `on()`
  receives it once, synchronously.
- **r.** (`events.test.ts`) Replay is the **latest** value: after `connected`
  then `reconnecting`, a late subscriber receives only `reconnecting`.
- **s.** (`events.test.ts`) After `clear()`, a late subscriber receives no
  replay. The existing `auth.session-started` replay tests still pass.

## Task 2: wire into `AgicashSdk`, flip the web, delete the web realtime layer

**Steps**

1. Apply S5 (`db/client.ts`) and add test u.
2. Apply S3/S4 to `sdk.ts` and add test t.
3. Rewrite `use-track-wallet-changes.ts` per S7, and apply S6 to the ten hook
   files plus `TransactionsCache.get`.
4. Apply S8 (`root.tsx`, `wallet.tsx`). Edit `database.client.ts` per
   Decision 10. Delete the five `lib/supabase` files.
5. Apply S9 to the design spec.
6. Run canaries G1–G7.
7. Run all six gates.

**Lettered tests**

- **t.** (`sdk.test.ts`) `AgicashSdk.create(createConfig())` with no session:
  a `connection.changed` handler registered via `sdk.events.on` is never
  called, and `dispose()` resolves. This covers no-session wiring. Session
  wiring is covered by tests a/m/n against the module plus the G3 ordering
  canary, because `sdk.test.ts` has no auth fake (`sdk.test.ts:1-37`).
- **u.** (`db/client.test.ts`) With a recording logger, invoke the installed
  realtime logger:
  - `client.realtime.log('push', 'wallet:x phx_join (1)', { access_token: 'secret' })`
    logs a debug line containing `Realtime push:` whose meta does not contain
    `'secret'`.
  - The same check holds for `'receive'` with a `payload`.
  - `'transport'` keeps its data.
  - Without `logger`, nothing is installed.

  Verify the method name (`log`) against `RealtimeClient.d.ts` before writing
  the test.

There is no web unit test. The handler bodies are cache-op transcriptions,
and the web package has no hook-test harness for TanStack caches. The `get`
helper is one line. Coverage comes from the smoke plan, steps 3–5.

## Verification gates

| Gate | Command | Task 1 | Task 2 |
|---|---|---|---|
| 1 | `bun install --frozen-lockfile` | ✓ | ✓ |
| 2 | `bun run fix:all` | ✓ | ✓ |
| 3 | `bun run typecheck` | ✓ | ✓ |
| 4 | `cd packages/wallet-sdk && bun test` | ✓ (a–s) | ✓ (+t, u) |
| 5 | `cd apps/web-wallet && bun test` | ✓ | ✓ |
| 6 | `cd apps/web-wallet && bun run build` | ✓ | ✓ |

## Smoke plan

Run this locally with `bun run dev` and local Supabase (`bun supabase start`;
realtime is part of the local stack). Use two tabs, A and B, logged into the
same user, with the DevTools console filtered to `Realtime`.

| # | Step | Expect | Runnable locally? |
|---|---|---|---|
| 1 | Load `/` in A | One WS to `/realtime/v1/websocket`. One `phx_join wallet:<id>` logged **without** a frame body. One sweep: 13 query refetches in the Network tab, as on master. | yes |
| 2 | In B, create a Lightning receive quote | A's pending receive list (the processor cache) gains the quote without a refetch. The leader tab's processor picks it up. | yes |
| 3 | In B, add then delete a contact | A's contact list updates both times, with the domain shown as in a fetched contact. | yes |
| 4 | Acknowledge a transaction in B | A's unacknowledged badge count updates (one count query). | yes |
| 5 | Hide A for 1 minute, then show it | No leave while hidden. No sweep on return if the channel stayed up. | yes |
| 6 | In A, DevTools → Network → Offline for 30 s, then Online | `reconnecting` while offline, no join attempts while offline after the first failure, one rejoin and one sweep when back online | yes |
| 7 | Sign out in A | WS closes (no channels). No `connection.changed` after sign-out. The login page shows no realtime logs. | yes |
| 8 | Log in, then stop local realtime (`docker stop` the `realtime` container), keeping A visible for > 75 s (sum of delays ≈ 70.6 s, plus join timeouts) | Nine retries logged `n/9`, then the 'Connection lost' screen. Reload recovers after the container restarts. | yes |
| 9 | Visit `/home` logged in | One socket and one join, with no sweep (named delta, Decision 2). | yes |
| 10 | Leader failover with A and B open: close the leader | The other tab takes the lead. Its processors see pending work via caches the SDK events keep fresh. | yes (live money path: maintainer) |
| 11 | Real Lightning receive and send, plus `/lnurl-test`, on alpha | Completions appear in both tabs, and the transaction updates without a manual refresh. | maintainer |

## Parity accounting (master → flipped)

| Scenario | Master | Flipped | Net |
|---|---|---|---|
| Boot into `/` (logged in) | 1 socket, 1 join, 1 sweep (13 invalidates) at `Wallet` mount | 1 socket, 1 join at session start, 1 sweep via replay at mount | 0 |
| Steady broadcast | 1 decode per event in React; cache op | 1 decode in the SDK; same cache op | 0 |
| `TRANSACTION_UPDATED`, uncached tx, ack unchanged | no count query | +1 count query | **+1 (named, Decision 5)** |
| Tab hidden | channel stays | channel stays | 0 |
| Error while hidden/offline | channel closed; rejoin on return | same | 0 |
| Offline → online | rejoin, 1 sweep | rejoin, 1 sweep | 0 |
| Inactive during a backoff | keeps counting; may hit `error` while hidden | abandons → `closed`; rejoins on activation | **deliberate deviation (Decision 6)** |
| Sign-out | `Wallet` unmount → channel removed | `close()` before token reset → channel removed | 0 |
| Terminal error | 'Connection lost'; back-nav retried a fresh cycle | 'Connection lost'; back-nav re-throws; reload recovers | **named (Decision 7)** |
| Public/marketing route, logged in | no socket | +1 socket, +1 join, 0 sweeps, 0 refetches | **+1 socket (named, Decision 2)** |
| Boot offline | no join until online | one failed join → `closed` → join on `online` | **named (Decision 6)** |
| Contact domain on a non-canonical origin | realtime contact uses the canonical host | realtime contact uses `window.location.host`, same as fetched contacts | **named (Decision 4)** |
| Dev console logs | full push/receive bodies (token included) | kind + message only | **named (Decision 8)** |

All rows other than the named ones net to 0. No row adds a DB request in the
steady state.

## Maintainer live gate

The design spec requires full live verification for step 18 (`:123`). Before
merging Task 2:

- Run smoke steps 10–11 on alpha.
- Run a reconnect/resync check: put the device in airplane mode during a
  pending Lightning receive, pay it from another wallet, then restore the
  network. The sweep must surface the completion and the processor must
  finish it.
- Run a two-user identity switch in one tab (sign out, sign in as another
  user). The new user's lists show none of the previous user's events.

## Out of scope

- `account.balance-changed` and the Spark/Breez balance listeners.
- Porting any processor (sub-slice 2), and the host/processing repository
  split (design spec `:100-107`).
- Removing `agicashDbClient` or the web repository hooks used for non-realtime
  reads/writes.
- Deleting `/temporary` (step 19).
- Changing triggers to emit `previous_acknowledgment_status` differently.

## Open questions

1. **Is the deliberate deviation in Decision 6 acceptable?** A tab that goes
   inactive mid-backoff abandons the cycle instead of counting toward the
   terminal error. If the maintainer prefers exact master behaviour, drop the
   post-delay activity check in `retry`. Tests j and i change accordingly; no
   other part of the plan is affected.
