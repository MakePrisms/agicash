# Wallet SDK Base — Plan 4b: change-feed / realtime ingestion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. Fresh subagent per task; per-task spec review then code-quality review; **dedicated OPUS quality-reviewer on the new-logic tasks** (lifecycle-event derivation + the change-feed module). Gate = `bun run typecheck` + `bun run test`, **NEVER `bun run fix:all`** (it reformats ~91 files repo-wide and pollutes the shared worktree; reviewers must not run it; discard any such pollution with `git checkout -- .` since all task work is committed).

**Goal:** Land the framework-free realtime change-feed: subscribe the per-user Supabase broadcast channel, route each row event through the landed `repo.toX()` converters (decrypt + version-stamp), derive the core lifecycle events (`send:*`/`receive:*`) on terminal transitions, and expose the variant fan-out + processor-trigger **seams** — all inside `@agicash/wallet-sdk`.

**Architecture:** Second of three base-Plan-4 sub-plans (4a feeds/seams ✅ → **4b change-feed** → 4c processors+leader+background). Per the confirmed design, the variant-specific pieces are **injected ports with no base impl**: the change-feed does (1) decrypt+convert+version-stamp + emit *core* lifecycle events and (3) trigger processors; the (2) cache-write/row-event fan-out is a **port** (variant A emits row events; variant B writes stores). The realtime transport (`SupabaseRealtimeManager` + channel builder + channel wrapper) is already framework-free in the app (online/active come via setters; only the React *hooks* touch `window`/`navigator`) — so 4b copies the transport verbatim and the SDK drives online/active + lifecycle itself (no React activity hook).

**Tech stack:** TypeScript, bun, `@supabase/supabase-js` / `@supabase/realtime-js` (RealtimeClient, broadcast channels, `setAuth`), the SDK's Plan-2 internal supabase client + session-token, the Plan-2 `EventBus` + `SdkCoreEventMap`, and the landed 3a/3b repos reached via `sdk[walletRuntimeKey]` (`WalletRuntime` foundation repos + `.protocols`).

**Gate (every task):** `cd packages/wallet-sdk && bun run typecheck` (exit 0) then repo-root `bun run test` (wallet-sdk + web-wallet suites green). Never `fix:all`.

**Testing posture (confirmed: strictly minimal, like 3a/3b/4a):** No new unit tests — not even for version-gating or terminal-event derivation (user decided 2026-06-17). Acceptance = typecheck + existing suites green; correctness verified by per-task spec + OPUS quality review. Live validations remain documented carry-overs (this worktree has no live stack/auth): authorized private broadcast via real OpenSecret JWT (`realtime.setAuth`), end-to-end DB-change→broadcast→headless receipt, reconnect/resync — to run before the variant PRs merge.

**Key resolved design (from 4b exploration 2026-06-17):**
- The change-feed is **BROADCAST-based** (not `postgres_changes`): DB triggers broadcast one event per row change on private channel `wallet:${userId}`; the payload IS the (encrypted) DB row. The app's single subscription is `.on('broadcast', { event: '*' }, ({ event, payload }) => dispatch(event, payload))`.
- **Lifecycle events derive from the six quote/swap entity terminal transitions** — NOT from the transaction. Each quote/swap entity carries everything the event payload needs: `id` (→ `quoteId`), `transactionId`, and `amount` (verified: `cashu-send-quote.ts` has `id`/`quoteId`/`transactionId`; transaction-details do NOT carry a quote id). Fire **once** per entity id (dedup set). The app has **no** existing `send:*`/`receive:*` emission — this is genuinely new SDK logic.
- Lifecycle events are in the Plan-2 `SdkCoreEventMap` (`send:completed|failed`, `receive:completed|failed|expired`); 4b emits them via the existing `EventBus`.

---

## The complete broadcast-event catalog (route table)

19 events; each maps to a landed converter. The router (Task 3) is a switch over the event string. Converters live on the foundation repos (3a: account, transaction, contact, user) and `WalletRuntime.protocols` (3b: the cashu/spark quote/swap repos).

| Event string | Converter (repo method) | Payload type | Lifecycle-relevant? |
|---|---|---|---|
| `USER_UPDATED` | `ReadUserRepository.toUser` (static) | `AgicashDbUser` | no |
| `ACCOUNT_CREATED` / `ACCOUNT_UPDATED` | `accountRepository.toAccount` | `AgicashDbAccountWithProofs` | no |
| `TRANSACTION_CREATED` / `TRANSACTION_UPDATED` | `transactionRepository.toTransaction` | `AgicashDbTransaction` (+ `previous_acknowledgment_status` on UPDATED) | no |
| `CONTACT_CREATED` | `ContactRepository.toContact(payload, domain)` (static) | `AgicashDbContact` | no |
| `CONTACT_DELETED` | (none — payload.id only) | `AgicashDbContact` | no |
| `CASHU_RECEIVE_QUOTE_CREATED` / `_UPDATED` | `cashuReceiveQuoteRepository.toQuote` | `AgicashDbCashuReceiveQuote` | **receive** |
| `CASHU_RECEIVE_SWAP_CREATED` / `_UPDATED` | `cashuReceiveSwapRepository.toReceiveSwap` | `AgicashDbCashuReceiveSwap` | **receive** |
| `CASHU_SEND_QUOTE_CREATED` / `_UPDATED` | `cashuSendQuoteRepository.toQuote` | `AgicashDbCashuSendQuote & { cashu_proofs }` | **send** |
| `CASHU_SEND_SWAP_CREATED` / `_UPDATED` | `cashuSendSwapRepository.toSwap` | `AgicashDbCashuSendSwap & { cashu_proofs }` | **send** |
| `SPARK_RECEIVE_QUOTE_CREATED` / `_UPDATED` | `sparkReceiveQuoteRepository.toQuote` | `AgicashDbSparkReceiveQuote` | **receive** |
| `SPARK_SEND_QUOTE_CREATED` / `_UPDATED` | `sparkSendQuoteRepository.toQuote` | `AgicashDbSparkSendQuote` | **send** |

Source of truth for the registration + payload types: `apps/web-wallet/app/features/wallet/use-track-wallet-changes.ts` (read it; it imports every `use*ChangeHandlers` and lists all events + the `onConnected` catch-up). The exact converter method names/ctors are the 3a/3b-landed repos — verify each by reading the repo in `packages/wallet-sdk/src/internal/db/`.

## The lifecycle-event derivation (the new logic — per-entity terminal mapping)

Verified state unions + terminal→event mapping (read each `packages/wallet-sdk/src/domains/*` file to confirm the exact string literals before coding):

| Entity (domain file) | state union | terminal → lifecycle event |
|---|---|---|
| cashu-send-quote | `UNPAID\|PENDING\|EXPIRED\|FAILED\|PAID` | `PAID`→`send:completed`; `EXPIRED`,`FAILED`→`send:failed` |
| cashu-send-swap | `DRAFT\|PENDING\|COMPLETED\|FAILED\|REVERSED` | `COMPLETED`→`send:completed`; `FAILED`,`REVERSED`→`send:failed` |
| cashu-receive-quote | `UNPAID\|PAID\|COMPLETED\|EXPIRED\|FAILED` | `COMPLETED`→`receive:completed`; `EXPIRED`→`receive:expired`; `FAILED`→`receive:failed` (PAID is **non-terminal**) |
| cashu-receive-swap | `PENDING\|COMPLETED\|FAILED` | `COMPLETED`→`receive:completed`; `FAILED`→`receive:failed` |
| spark-send-quote | `UNPAID\|PENDING\|COMPLETED\|FAILED` | `COMPLETED`→`send:completed`; `FAILED`→`send:failed` |
| spark-receive-quote | `UNPAID\|PAID\|FAILED\|EXPIRED` | `PAID`→`receive:completed`; `EXPIRED`→`receive:expired`; `FAILED`→`receive:failed` (PAID **is terminal** here) |

Event payloads (from the Plan-2 `SdkCoreEventMap`): `send:completed`/`receive:completed` = `{ protocol, quoteId, transactionId, amount }`; `send:failed` = `{ protocol, quoteId, transactionId?, error }`; `receive:failed` = `{ protocol, quoteId, error }`; `receive:expired` = `{ protocol, quoteId }`. Source each field from the converted entity: `quoteId = entity.id`, `transactionId = entity.transactionId`, `amount = entity.amount`, `protocol` = cashu|spark by entity type. For `error` on failed: construct from the entity's failure reason if present (VERIFY which field carries it per entity, e.g. `failureReason`); otherwise a generic `DomainError`. **Fire once per entity id** via a `Set<string>` of already-emitted terminal ids (cleared on dispose); a later same-id terminal event is suppressed. Delivered via the `EventBus` to every instance (derived from realtime, not the mutation).

---

## File structure (created in 4b)

```
packages/wallet-sdk/src/internal/realtime/
├── supabase-realtime-channel.ts          # COPY of app lib/supabase/supabase-realtime-channel.ts (thin wrapper)
├── supabase-realtime-channel-builder.ts  # COPY of app lib/supabase/supabase-realtime-channel-builder.ts
├── supabase-realtime-manager.ts          # COPY of app lib/supabase/supabase-realtime-manager.ts
├── change-feed-router.ts                 # NEW — event string → repo.toX() converter dispatch
├── lifecycle-events.ts                   # NEW — terminal-transition → SdkCoreEventMap derivation (+ dedup)
├── change-feed-ports.ts                  # NEW — EntityFanout + ProcessorTrigger PORT types (no impl)
└── change-feed.ts                        # NEW — the change-feed module (subscribe/route/derive/fan-out/catch-up/resync)
```

No `Sdk`/`WalletRuntime` wiring in 4b beyond constructing the change-feed class — it is *started* by the BackgroundDomain in 4c. Add `package.json` exports only if a consumer outside `src/` imports a 4b module (none expected; 4c consumes via relative imports).

---

## Task 1: Copy the realtime transport (manager + builder + channel wrapper)

**Files:**
- Create `packages/wallet-sdk/src/internal/realtime/supabase-realtime-channel.ts` ← copy `apps/web-wallet/app/lib/supabase/supabase-realtime-channel.ts`
- Create `packages/wallet-sdk/src/internal/realtime/supabase-realtime-channel-builder.ts` ← copy app `.../supabase-realtime-channel-builder.ts`
- Create `packages/wallet-sdk/src/internal/realtime/supabase-realtime-manager.ts` ← copy app `.../supabase-realtime-manager.ts`

These three are framework-free in the app (the manager takes online/active via `setOnlineStatus`/`setActiveStatus`; backoff `[0,100,500,1000,3000,6000,10000,20000,30000]`; resubscribe queue; `refreshSessionIfNeeded()` → `realtimeClient.setAuth()`; `onConnected` callbacks fire on `SUBSCRIBED`). COPY verbatim; the ONLY edits are import lines (the three reference each other as siblings — keep the relative imports; keep `@supabase/supabase-js` / `@supabase/realtime-js`). The React hooks file (`supabase-realtime-hooks.ts`) is **NOT** copied — its responsibilities (subscribe-on-mount/unsubscribe, online/visibility listeners) are replicated framework-free in Task 6 + by the host.

- [ ] **Step 1: Read all three app source files** (`supabase-realtime-channel.ts` — not yet inspected; read it fully) and confirm none import React/`@tanstack`/`window`/`document`/`navigator`. The manager + builder were confirmed framework-free in exploration; verify the channel wrapper is too. If the wrapper references `window`, report it (it shouldn't).

- [ ] **Step 2: Copy the three files verbatim into `internal/realtime/`**, editing only import paths so the three resolve each other within `internal/realtime/`. Do NOT change any logic, field, or method.

- [ ] **Step 3: Gate** — `cd packages/wallet-sdk && bun run typecheck` → 0; `bun run test` green. (No SDK consumer yet, so typecheck only proves the copies compile in isolation; that's expected.)

- [ ] **Step 4: Commit** — `git add packages/wallet-sdk/src/internal/realtime/ && git commit -m "feat(wallet-sdk): copy Supabase realtime transport into SDK (base 4b)"`

---

## Task 2: Realtime client accessor + online/active control

**Files:** Modify the SDK's internal db/client module (the Plan-2 supabase client) and/or add `internal/realtime/realtime-client.ts` to expose `new SupabaseRealtimeManager(client.realtime)`.

The app builds `agicashRealtimeClient = new SupabaseRealtimeManager(agicashDbClient.realtime)` where `agicashDbClient` is `createClient(url, anonKey, { accessToken: getSupabaseSessionToken, realtime: {...} })`. The SDK already has its own supabase client + session-token (Plan 2).

- [ ] **Step 1: VERIFY (read Plan-2 code first)** — find the SDK's internal supabase client (created in Plan 2; grep `createClient` under `packages/wallet-sdk/src/internal/db/`). Confirm: (a) it is created with `accessToken` wired to the SDK session-token provider (so `realtime.setAuth()` gets a fresh token), and (b) it has a `.realtime` `RealtimeClient`. If realtime config (the `logger`) is absent, decide whether to add it (optional; the app's logger redacts payloads in prod — port it only if trivial).

- [ ] **Step 2: Expose the manager** — construct/obtain a `SupabaseRealtimeManager` from the SDK client's `.realtime`, owned by the change-feed (Task 6) or a small accessor. Do NOT replicate the app's `window.agicashRealtime` debug global.

- [ ] **Step 3: Online/active** — the SDK has no React activity hook. Expose host-callable control so the web host can forward `online`/`offline`/`visibilitychange` to `manager.setOnlineStatus`/`setActiveStatus`. Decide the surface (likely methods on the change-feed/SDK, finalized when 4c wires `Sdk`); for 4b, ensure the manager's setters are reachable. Headless hosts default online+active=true.

- [ ] **Step 4: Gate + commit** (`feat(wallet-sdk): SDK realtime client accessor + online/active control (base 4b)`).

VERIFY-DURING-EXEC: whether Plan 2's client already enables realtime + accessToken (it should — the SDK owns the Supabase session). If Plan 2's client is auth-only with no realtime, this task wires realtime onto it.

---

## Task 3: Change-feed router (event → converter)

**Files:** Create `packages/wallet-sdk/src/internal/realtime/change-feed-router.ts`.

A framework-free dispatcher: given `(event: string, payload: unknown)` and the foundation repos + protocol repos, convert to a domain entity (decrypt + version-stamp happen inside the landed `repo.toX()` — do not re-implement). Returns a discriminated result `{ kind: 'user'|'account'|'transaction'|'contact'|'cashu-send-quote'|... ; entity }` (or `{ kind: 'contact-deleted', id }`) so Task 6 can fan out + derive lifecycle events.

- [ ] **Step 1: Define the result union + the router** — one `switch (event)` over the 19 strings (see the catalog table), each calling the matching converter. Inject the converters as a deps object `{ user, account, transaction, contact, cashuSendQuote, cashuSendSwap, cashuReceiveQuote, cashuReceiveSwap, sparkSendQuote, sparkReceiveQuote, domain }` sourced from `WalletRuntime` (foundation repos) + `WalletRuntime.protocols` (3b) + `config.domain` (for `ContactRepository.toContact`). Read each repo to confirm the exact method name + payload param type; `ReadUserRepository.toUser` and `ContactRepository.toContact` are static.

- [ ] **Step 2: Unknown-event handling** — log + ignore unknown event strings (forward-compatible).

- [ ] **Step 3: Gate + commit** (`feat(wallet-sdk): change-feed event router (base 4b)`).

VERIFY-DURING-EXEC: the exact `AgicashDb*` payload types per event (read `internal/db/database.ts` + the repos); whether converters need the proofs join (`cashu_proofs`) shape preserved (the send quote/swap payloads include it).

---

## Task 4: Lifecycle-event derivation (new logic — OPUS review)

**Files:** Create `packages/wallet-sdk/src/internal/realtime/lifecycle-events.ts`.

Pure function(s) over a converted quote/swap entity → zero or one `SdkCoreEventMap` emission, with fire-once dedup. No I/O.

- [ ] **Step 1: Implement the per-entity terminal mapping** (use the table above; read each domain file for the exact state literals + the `failureReason`/error-bearing field). Signature roughly:
```ts
type LifecycleEmit =
  | { type: 'send:completed'; payload: SdkCoreEventMap['send:completed'] }
  | { type: 'send:failed'; payload: SdkCoreEventMap['send:failed'] }
  | { type: 'receive:completed'; payload: SdkCoreEventMap['receive:completed'] }
  | { type: 'receive:failed'; payload: SdkCoreEventMap['receive:failed'] }
  | { type: 'receive:expired'; payload: SdkCoreEventMap['receive:expired'] };

// returns null if the entity is not in a terminal state (or already emitted)
function deriveLifecycleEvent(kind, entity, emittedTerminalIds: Set<string>): LifecycleEmit | null
```
Source: `quoteId = entity.id`, `transactionId = entity.transactionId`, `amount = entity.amount`, `protocol` from `kind`. For failed, build `error` from the entity's failure field (VERIFY field) or a `DomainError`. Add `entity.id` to `emittedTerminalIds` when emitting; return null if already present.

- [ ] **Step 2: Gate + commit** (`feat(wallet-sdk): core lifecycle-event derivation from terminal transitions (base 4b)`).

OPUS quality review focus: correctness of every terminal mapping (esp. cashu-receive PAID=non-terminal vs spark-receive PAID=terminal), dedup correctness (fire-once, no suppression of distinct entities), payload field sourcing, and that `receive:expired` carries no amount/transactionId per the map.

---

## Task 5: Variant ports (fan-out + processor-trigger)

**Files:** Create `packages/wallet-sdk/src/internal/realtime/change-feed-ports.ts`.

Two PORT types, no impl (variant supplies):
```ts
/** Variant fan-out of a converted row: A emits row-level entity events; B writes stores. Base ships the seam only. */
export type EntityFanout = { emit(change: ChangeFeedChange): void };
/** Processor trigger: the change-feed signals processors a relevant entity changed (4c wires concrete processors). */
export type ProcessorTrigger = { onEntityChange(change: ChangeFeedChange): void };
```
where `ChangeFeedChange` is the router result union (Task 3). Keep it minimal; the concrete impls are variant/4c.

- [ ] **Step 1: Define the port types + `ChangeFeedChange`** (re-export/import the router union). **Step 2: Gate + commit** (`feat(wallet-sdk): change-feed fan-out + processor-trigger ports (base 4b)`).

---

## Task 6: The change-feed module (new logic — OPUS review)

**Files:** Create `packages/wallet-sdk/src/internal/realtime/change-feed.ts`.

Ties it together, framework-free. Owns the `SupabaseRealtimeManager` + the per-user channel; on each broadcast event: route (Task 3) → derive + emit core lifecycle events (Task 4, via the Plan-2 `EventBus`) → call the fan-out + trigger ports (Task 5). Plus reconnect catch-up + `resync()`.

- [ ] **Step 1: Construct + subscribe** — `start(userId)`: build channel `manager.channel(\`wallet:${userId}\`, { private: true }).on('broadcast', { event: '*' }, ({ event, payload }) => this.handle(event, payload))`, `manager.addChannel` + `subscribe(onConnected)`. `handle()` routes → emits lifecycle → fan-out + trigger. `dispose()`/`stop()`: `removeChannel` + clear the emitted-terminal-ids set.

- [ ] **Step 2: onConnected catch-up + `connection:state`** — on `SUBSCRIBED` (the manager's onConnected), emit `connection:state {state:'connected'}` and run the catch-up: the base part is "re-establish subscriptions + signal a reload" — emit a catch-up signal the trigger port / 4c processors consume to reload work sets, and (variant) A emits `connection:resync`. The app's `onConnected` invalidated all caches (`use-track-wallet-changes.ts` lines ~131-149) — the SDK equivalent is the trigger/fan-out catch-up hook, NOT cache invalidation (no cache in base). Emit `connection:state {state:'disconnected'}` on channel error/close.

- [ ] **Step 3: `resync()`** — public, coarse, idempotent: run the same catch-up path on demand (re-verify subscription + signal reload). Web host wires it to focus/online; headless rarely calls it.

- [ ] **Step 4: Gate + commit** (`feat(wallet-sdk): realtime change-feed module (subscribe/route/derive/catch-up) (base 4b)`).

OPUS quality review focus: subscription lifecycle (no double-subscribe; clean dispose), the broadcast `event:'*'` dispatch, version-gating is delegated to the converters/consumers (the entity carries `version`; the base emits — the *cache* version-gate is variant; confirm the base does not regress anything), catch-up coherence (emit-once connection events; resync idempotent), and that nothing here imports React/window or a concrete runner.

VERIFY-DURING-EXEC: the Plan-2 `EventBus` emit API + `SdkCoreEventMap` key/payload shapes; how `connection:resync` (A-only) is gated (likely emitted via the fan-out port, not the core bus).

---

## Task 7: Holistic gate + sanity

- [ ] **Step 1:** repo-root `bun run typecheck` (8 pkgs exit 0) + `bun run test` (all green).
- [ ] **Step 2:** headless sanity — grep the new `internal/realtime/` files for `react`/`@tanstack` value imports / `window`/`document`/`navigator`/`localStorage` / `~/` / app-relative imports → expect none (a doc-comment mention is fine).
- [ ] **Step 3:** confirm no 4b internal leaked into the public barrel `src/index.ts`; add `package.json` exports only if a non-`src/` consumer needs one (none expected).
- [ ] **Step 4:** final OPUS holistic review of `402a73f3..HEAD` minus 4a (i.e., the 4b commits) for cross-cutting coherence; commit any export/touch-ups.

---

## Self-review (against spec §Change-feed ingestion, §Event map)

- **Single per-user subscription, decrypt+convert+version-stamp** — Tasks 1–3 (transport copy + router over the 19 events via landed `repo.toX()`). ✓
- **Core lifecycle events, fire-once, derived from realtime transitions** — Task 4 (per-entity terminal mapping + dedup), emitted via Plan-2 `EventBus`. ✓
- **Variant fan-out (A row events / B store writes) + processor trigger are seams, no base impl** — Task 5 ports. ✓
- **Reconnect catch-up (`onConnected`) + `connection:state` + `resync()`** — Task 6. ✓
- **Row-level entity events / `connection:resync` are A-only** — left to the variant via the fan-out port (base emits core only). ✓
- **No TanStack/React/window in the SDK** — Task 7 sanity. ✓
- **Processors themselves, leader election, BackgroundDomain, `Sdk` wiring** — NOT 4b (4c). The change-feed is constructed but started by 4c's BackgroundDomain. ✓

## Forward to 4c (carry-overs, incl. from 4a)

- Wire the change-feed into `BackgroundDomain.start()` (subscribe) / `stop()`/`dispose()` (unsubscribe); provide the concrete `ProcessorTrigger` (the six processors) + the base/variant `EntityFanout`.
- `Sdk` engine-injection seam: variant supplies `TaskRunner` (4a port) + `WorkSetSource` + `EntityFanout`.
- From 4a: (i) fire-and-forget unhandled-rejection hardening at the WS-callback sites (wrap at the runner/wiring layer — Node crash risk); (ii) decide WS-subscription teardown on `background.stop()`; (iii) cosmetic rename of melt-tracker `callbacks`→`deps`.
- Online/active host wiring (Task 2) finalized when `Sdk` is wired in 4c.
- Live validations (auth'd private broadcast, DB→broadcast→headless receipt, reconnect/resync) + the Breez-connect smoke — run against a live local stack before the variant PRs merge.
