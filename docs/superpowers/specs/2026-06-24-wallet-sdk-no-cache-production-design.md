# Wallet SDK — no-cache production migration design

- **Date:** 2026-06-24
- **Status:** Design under review

## Problem & goal

All wallet business logic — Cashu + Spark send/receive, accounts, transactions,
auth, contacts, transfers, and the background payment state machines + leader
election — currently lives inside the React web app (`apps/web-wallet/app`),
entangled with React and TanStack Query. We want the same logic usable headless
(a future MCP stdio wallet under bun/node, against the same Supabase + Open Secret
backend).

`@agicash/wallet-sdk` must **own the wallet's business logic and background
processing** behind a clean, minimal public contract. The web app becomes a
consumer of that contract.

## Core decision: no cache in the SDK

The SDK holds **no cache**. Reads are `Promise`s (hit the DB); state changes
surface as events. Caching/freshness is the frontend's concern — the web app
keeps its own TanStack Query cache.

**Why:** MCP is request/response, so a resident cache buys it ~nothing. For the
web app, the only effect of no SDK cache is that background/orchestrator work
reads the DB instead of an in-memory copy — negligible. In exchange the SDK stays
simple: no resident store, no cache-coherence/version-gating, no embedded query
engine to keep in sync.

## Boundary mechanism (the spine)

- `packages/wallet-sdk` holds the domain layer: `*-repository`, `*-service`,
  `*-core`, and domain-type files. The web app keeps the UI glue
  (`*-hooks`, `*-store`, `*-provider`, `.tsx`).
- `index.ts` exports **domain types only** — e.g. `import { type Account } from
  '@agicash/wallet-sdk'`.
- `@agicash/wallet-sdk/temporary` re-exports services/repos/db-types **during
  migration only** — e.g. `import { accountRepository } from
  '@agicash/wallet-sdk/temporary'`.
- The final step **deletes `/temporary`**. Any remaining internal import then
  fails the build → the contract boundary is enforced by the compiler, not by
  review.
- Runtime public surface = the `Sdk` class. `ServerSdk` is a separate class for
  the Lightning-address server routes.

## No-cache reactive model (two phases)

Reads return `Promise`s (hit the DB); state changes surface as events.

- **During migration:** the web app routes reads + mutations through `sdk.*` but
  keeps its TanStack cache and its existing realtime layer
  (`use-track-wallet-changes`) feeding those caches. Each slice is a small rebind
  of the data source, nothing more.
- **At the end (step 18):** the SDK takes over the realtime change-feed + row
  decryption and emits domain events; the web app drops its own realtime layer and
  instead **subscribes to SDK events to keep its TanStack cache fresh**. This is
  why background processing comes last.

## Slice sequence

Steps 5–16 each = wrap the (already-moved) domain code in a contract method +
switch the web app's imports for that domain from `/temporary` to `sdk.*`. Order
is dependency-sensible but flexible — `/temporary` and in-package calls resolve
every cross-domain reference, so each slice is self-contained. The one hard rule
is **step 2 (cycle-break) before step 3 (move)**.

0. **Extract `@agicash/*` libs** (money, ecies, bolt11, lnurl, cashu, utils). *Merged in #1159.*
1. **Remove the query-client dependency** from repos/services — they become plain async, cache-free.
2. **Break the `accounts ↔ user` cycle** — dedicated PR whose description states the cycle-break as the reason. (Only domain-layer cycle; see Dependency facts.)
3. **Mechanical move** — all domain files, the `agicash-db` module (Supabase client `database.client.ts`/`.server.ts`, `supabase-session.ts`, `json-models/`), `shared`, and the **entire `supabase/` project** → `packages/wallet-sdk`. Web imports via `/temporary`; `index.ts` exports types only. Reviewed as a pure move (paths only, no logic change).
   - `supabase/` → `packages/wallet-sdk/supabase/` (migrations, `config.toml`, `seed.sql`, `snippets`, generated `database.types.ts`). No edge functions; `config.toml` paths are relative so they survive the move; the `db:generate-types` script and the three `supabase/` references in `.github/workflows/ci.yml` get repointed.
   - **Infra sub-step (owner = maintainer):** repoint Supabase's hosted git-integration directory to `packages/wallet-sdk/supabase`, verifying deploys still trigger on `next` → `alpha` before `live`.
4. **Define the contract** — `Sdk` + `create(config)`, the per-domain namespaces, the separate `ServerSdk`, and the *shape* of the background contract (`start`/`stop`, leader election). `create(config)` receives the host ports: the Supabase connection (browser / server / node) and the auth storage adapter (see Design notes). Background *implementation* lands in step 18.
5. **auth & user**
6. **accounts**
7. **contacts**
8. **transactions**
9. **cashu receive quote**
10. **cashu receive swap**
11. **spark receive quote**
12. **receive cashu token**
13. **cashu send quote**
14. **cashu send swap**
15. **spark send quote**
16. **transfer**
17. **server SDK** — Lightning-address routes → `ServerSdk`.
18. **background processing** — the most concurrency-sensitive part; sub-sliced:
    1. move the shared runtime (task runner + leader-election lock + change-feed) into the SDK behind the contract; web calls `sdk.background.start/stop`;
    2. port each flow's processor into the SDK one at a time;
    3. web drops its realtime layer and subscribes to SDK events to keep its cache fresh.
    - Live money-path verification is mandatory here.
19. **Cleanup** — delete `@agicash/wallet-sdk/temporary`; route remaining consumers through the contract. Boundary now build-enforced.

## Verification

- **Smoke test after every PR** — app boots + the touched path works.
- **Test coverage is a per-PR judgment** — cover what genuinely earns confidence (e.g. deterministic state-machine transition logic); don't mandate tests where they wouldn't add real confidence.
- **Live money-path checks run periodically** (by the maintainer), ideally before several money-path slices stack so a regression stays bisectable.
- **Step 18:** full live verification — leader failover, reconnect/resync, and money-path completions (Lightning send/receive, `/lnurl-test`).

## Dependency facts (from import analysis of `features/*` domain-layer files)

- **Exactly one** cross-feature domain cycle: `accounts ↔ user` (`account-service.ts` → user; `user-repository.ts` / `user-service.ts` → accounts). Broken in step 2.
- `receive` and `send` domain code **import `transactions`** → `transactions` precedes the flows.
- `transfer` imports both `receive` and `send` → it comes after both.
- `contacts` depends only on `user` → cheap to do early.
- Foundational, imported by nearly everything: `agicash-db` and `shared` → move with step 3.
- Heaviest feature: `receive` (16 domain files), then `send` (6); all others 1–2.

## Design notes

- **Supabase ownership:** the entire `supabase/` project moves into the SDK package (step 3). No edge functions exist; the only non-code cost is the Supabase git-integration directory setting, which the maintainer accepts.
- **Auth:** logic lives in `features/user/auth.ts` + `features/shared/auth.ts` (moves to SDK); the login UI stays in `features/login/*`. Persistence is **mechanism-agnostic**: the SDK takes a storage adapter (`get`/`set`/`remove`) via `create(config)`, and the web host backs it with its existing browser storage. The SDK knows nothing about cookies or `localStorage`. This mirrors `@agicash/opensecret`'s React-agnostic build (its own storage-adapter API); the repo currently pins the React-coupled `0.1.0`, so the auth slice adopts the React-agnostic version. Exact port shapes are settled in the auth slice.
- **Web reactivity without an SDK cache:** the web keeps TanStack; from step 18 it subscribes to SDK domain events to keep entries fresh, replacing its current realtime layer.
