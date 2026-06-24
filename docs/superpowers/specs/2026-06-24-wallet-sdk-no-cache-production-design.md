# Wallet SDK — no-cache production migration design

- **Date:** 2026-06-24
- **Status:** Design approved; pending spec review → implementation planning
- **Supersedes:** the explore-and-compare track (PRs #1155–#1158) and the earlier "variant B for now" lean. Those are closed as exploration.

## Problem & goal

All wallet business logic — Cashu + Spark send/receive, accounts, transactions,
auth, contacts, transfers, and the background payment state machines + leader
election — currently lives inside the React web app (`apps/web-wallet/app`),
entangled with React and TanStack Query. We want the same logic usable headless
(a future MCP stdio wallet under bun/node, same Supabase + Open Secret backend).

`@agicash/wallet-sdk` must **completely own the wallet's business logic and
background processing** behind a clean, minimal public contract. The web app
becomes a consumer of that contract.

## Core decision: no cache in the SDK

The SDK holds **no cache**. Reads are `Promise`s (hit the DB); state changes
surface as events. Caching/freshness is the frontend's concern — the web app
keeps its own TanStack Query cache.

**Rationale:** MCP is request/response and gains ~nothing from a resident cache.
For the web app the only cost is background/orchestrator reads hitting the DB
instead of a cache — insignificant (and per the 2026-06-21 A/B eval, the
store-based variant's orchestrators re-read the DB anyway via `fetchOptimistic`).
A cache in the SDK is not worth the added complexity. This removes the resident
store, fanout/version-gating, the patched `@tanstack/query-core`, and **all**
engine/seam/swappability machinery explored in the earlier variants.

## Non-goals

- Building the MCP wallet (future work; this only makes the SDK *capable* of it).
- A swappable engine / hand-rolled-runtime "Variant C" (no cache ⇒ no engine to
  swap; deferred indefinitely).
- Redesigning the web app's UX or routing — the web change is a rebind of data
  access, not a redesign.
- Any abstraction whose only purpose is to keep two implementations swappable.

## Boundary mechanism (the spine)

- `packages/wallet-sdk` holds the domain layer: `*-repository`, `*-service`,
  `*-core`, and domain-type files. The web app keeps the UI glue
  (`*-hooks`, `*-store`, `*-provider`, `.tsx`).
- `index.ts` exports **domain types only** — e.g. `import { type Account } from
  '@agicash/wallet-sdk'`.
- `@agicash/wallet-sdk/temporary` re-exports services/repos/db-types **during
  migration only** — e.g. `import { accountRepository } from
  '@agicash/wallet-sdk/temporary'`.
- The final cleanup step **deletes `/temporary`**. Any lingering internal import
  then fails the build → the contract boundary is *enforced by the compiler*,
  not by review.
- Runtime public surface = the `Sdk` class. `ServerSdk` is a separate class for
  the Lightning-address server routes.

## No-cache reactive model (two phases)

The contract: reads return `Promise`s (hit the DB); state changes surface as
events.

- **During migration:** the web app routes reads + mutations through `sdk.*`,
  but **keeps its TanStack cache and its existing realtime layer**
  (`use-track-wallet-changes`) feeding those caches. Per-slice change stays
  small — a rebind of the data source, nothing more.
- **At the background step:** the SDK takes over the realtime change-feed +
  row decryption and emits domain events; the web's realtime layer collapses
  into a **single event→cache bridge**. "Changes are events" fully lands here,
  which is why background processing is sequenced second-to-last (below).

## Slice sequence

Each domain slice = wrap the (already-moved) domain code in a contract method +
switch the web app's imports for that domain from `/temporary` to `sdk.*`.

**Prep**
- `P-2` Extract `@agicash/*` libs (money, ecies, bolt11, lnurl, cashu, utils) — **open as #1159**.
- `P-1` Remove the query-client dependency from repos/services (plain async, cache-free).
- `P0a` **Break the `accounts ↔ user` cycle** — dedicated PR; the description must
  state that breaking the cycle is the reason for the change. (This is the *only*
  domain-layer cycle — see Dependency facts.)
- `P0b` **Mechanical move** — all domain files → `packages/wallet-sdk`; web imports
  via `/temporary`; `index.ts` exports types only. Reviewed as a pure move
  (paths only, no logic change). Foundations (`agicash-db` types + `shared`) move
  first / with it.

**Contract foundation**
- `P1` Define the contract — `Sdk` + `create`, the per-domain namespaces, the
  separate `ServerSdk`, and the *shape* of the background-processing contract
  (`start`/`stop`, leader election). Background *implementation* is deferred to
  the background step.

**Domain contract slices** (order below is dependency-sensible, but flexible —
see Δ2):
- auth & user → accounts → contacts → transactions → receive (cashu receive
  quote, cashu receive swap, spark receive quote, receive cashu token) → send
  (cashu send quote, cashu send swap, spark send quote) → transfer

**Server SDK**
- LN-address server routes → `ServerSdk`.

**Background processing** (second-to-last, **sub-sliced** — the largest and most
concurrency-sensitive chunk):
1. Move the shared runtime (task runner + leader-election lock + change-feed)
   into the SDK behind the contract; web calls `sdk.background.start/stop`.
2. Port each flow's processor into the SDK one at a time.
3. Swap the web's realtime layer for the single SDK event→cache bridge.
- Live money-path verification is **mandatory** for this step.

**Cleanup**
- Delete `@agicash/wallet-sdk/temporary`; route every remaining consumer through
  the contract. Boundary now build-enforced.

## Definition of done (verification)

- **Smoke test after every PR** — app boots + the touched path works.
- **Money-path slices** carry strong headless **state-machine unit tests** as the
  per-PR safety net. Live money-path checks are run **periodically** (by the
  maintainer), ideally before several money slices stack, to keep regressions
  bisectable.
- **Background step:** full live verification — leader failover, reconnect/resync,
  and money-path completions (Lightning send/receive, `/lnurl-test`).

## Dependency facts (from import analysis of `features/*` domain-layer files)

- **Exactly one** cross-feature domain cycle: `accounts ↔ user`
  (`account-service.ts` → user; `user-repository.ts` / `user-service.ts` →
  accounts). Broken in `P0a`.
- `receive` and `send` domain code **import `transactions`** → `transactions`
  precedes the flows (**Δ1**).
- `transfer` imports both `receive` and `send` → `transfer` comes after both.
- `contacts` depends only on `user` → cheap to do early (**Δ1**).
- Foundational, imported by nearly everything: `agicash-db` (db types) and
  `shared` → move first / with the move.
- Heaviest feature: `receive` (16 domain files), then `send` (6); all others 1–2.

### Deltas from the original written breakdown
- **Δ1:** `transactions` and `contacts` move *earlier* (before the receive/send
  flows) — `transactions` is a dependency of the flows; `contacts` is cheap.
- **Δ2:** contract-slice order is **flexible**, not rigid — `/temporary` +
  in-package calls bridge every cross-domain reference, so each slice is
  self-contained (wrap + switch) and can be reordered if priorities change. The
  only *hard* ordering constraint is `P0a` (cycle-break) before the move.

## Open items to confirm during implementation

- **Supabase migrations** likely must stay in `supabase/` (CLI requirement); the
  SDK owns the *generated* db types + repository SQL. Confirm before `P0b`.
- **`auth` location** — not under `features/`; confirm where it lives for the
  auth & user slice.
- **The single event→cache bridge** shape — designed/built at the background step.

## Decisions log

1. No SDK cache (reads = `Promise`, changes = events; web keeps TanStack).
2. Background processing migrates second-to-last, sub-sliced; web keeps it via
   `/temporary` until then. `P1` defines the background contract; implementation
   lands at the background step.
3. Step 0 = a single mechanical move; cycle-breaking is pulled out as dedicated,
   explained prep PR(s) first.
4. Contract-slice order is flexible (bridged by `/temporary`); the only hard
   constraint is the cycle-break before the move.
5. Verification: smoke per PR; periodic manual money-path checks by the
   maintainer; full live verification at the background step.
