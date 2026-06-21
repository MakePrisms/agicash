# Wallet-SDK extraction — Variant A vs Variant B empirical evaluation

> Both variants built complete + headless-green + per-task/whole-branch reviewed clean. A = `sdkx/stateless` (tip `66431613`). B = `sdkx/store` (tip `23db3fe6`). Both off the frozen base `a210e9db`. The contested axis (per spec) is **caching of hot reads** — the SDK's job (B) or the frontend's job (A); business logic, the 6 processors, leader election, and the `engine.ts` seam are byte-identical in both. Dim 4 (behavior parity) requires a live stack and is **owed** — assessed architecturally here, to be confirmed in the browser/live verification.

## TL;DR — verdict by dimension

| # | Dimension | Winner | Margin |
|---|---|---|---|
| 1 | Web-integration diff (permanent app plumbing) | **B** | clear |
| 2 | Headless ergonomics | **A** (B wins only the long-running-mirror sub-case) | moderate |
| 3 | SDK readability | **A** | clear |
| 4 | Behavior parity | tie (architectural) — **owed on live** | — |
| 5 | Runtime characteristics | **B** for the web app · **A** for a node/MCP host | split |
| 6 | Debuggability | tie, mirror-image (**A** edge for a stuck-PENDING/scheduling bug) | — |

**The split is not noise — it is structural.** Every B *win* traces to its **contract** (the SDK owns hot-read freshness via `Store<T>` → the app keeps almost no cache plumbing). Every B *loss* traces to its **engine** (a hidden, monkey-patched `@tanstack/query-core`). Those two are **separable** — which is the headline finding (see Recommendation).

---

## Dimension 1 — Web-integration diff (permanent app plumbing). Winner: **B**

The spec's central question: *"how much permanent plumbing the app retains."* Hard counts (against the frozen base `a210e9db`):

| | Variant A | Variant B |
|---|---|---|
| App-side cache classes RETAINED (permanent) | **10** (`accounts, user, contacts, transactions, cashu/spark receive-quote, cashu-receive-swap, cashu-send-quote, cashu-send-swap, spark-send-quote`, + pending sets) | **1** (a `TransactionsCache` *key-holder* — constants only, no cache) |
| App-side change-handler / wire hooks RETAINED | **~30** (`useWire*Events` ×10 + `useWalletEvents` fan-in + a 13-cache `connection:resync` invalidator) | **0** (3 generic adapter hooks written once: `useStore/useStoreSuspense/useStoreSelect`) |
| Web cut-over net lines | 59 app files, +739 / −9162 (net −8423) | 71 app files, +986 / −10089 (net −9103) |

A's design **keeps TanStack as the app's wallet cache forever** and rewires it to SDK row events — so every reactive frontend (web today, any future one) re-implements a cache + version-gating + event wiring. B **deletes that layer entirely**: the SDK owns freshness, the app reads stores through 3 hooks. This is precisely the spec's thesis ("an event that exists only to maintain A's frontend cache has no place in B's contract") realized: **B removes ~680 more lines and 9 more permanent cache classes than A**. For the multi-frontend / MCP-reuse goal, B's contract is materially leaner for every consumer.

> Note: B *moves* the version-gating/keep-set coherence logic into the SDK (`store/fanout.ts`, 137 lines) rather than eliminating it. The complexity shrinks per-consumer but is centralized once in the SDK — net win for N>1 frontends, roughly a wash for N=1.

## Dimension 2 — Headless ergonomics. Winner: **A** overall

Neither variant shipped a headless example; assessed from the public read contracts.

- **One-shot / stateless MCP tool (the typical MCP read — request→response): A wins decisively.** `await sdk.cashu.receive.get(id)` is the whole interaction — idempotent, self-seeding (the read self-loads on demand), returns or throws. B forces a choice with a trap on each branch: `store.get()` returns `undefined` before the store is seeded (cannot distinguish *not-loaded* from *empty* without knowing the convention), and `store.toPromise()` is the safe one-shot read but is just a roundabout Promise over a `QueryObserver` that then stays resident for the process lifetime. B's 9 resident observers + fanout + patch are dead weight for a one-shot tool.
- **Long-running reactive headless host (a daemon mirroring wallet state): B wins the primitive** — `Store<T>` (subscribe + snapshot in one object, fanout-fed) is exactly right for a push-based mirror. **But** B imposes a seeding/lifecycle burden A avoids: the host must trigger seeding (`toPromise` or `background.start`), must handle the `undefined`-means-loading convention, and **freshness silently dies if `background.start()` isn't running** (`staleTime: Infinity` disables refetch, so the only freshness path is the change-feed fanout under an elected leader). A reactive host on A builds its own subscribe-then-reread loop (more code, but no hidden lifecycle traps).

Since MCP stdio tools are predominantly request/response, **A is the more ergonomic headless surface overall**; B's advantage is confined to the long-running-mirror case and even there is gated on correct lifecycle wiring.

## Dimension 3 — SDK readability. Winner: **A**, clearly

"Can a new maintainer explain the data flow in 10 minutes?"

- **Conceptual layers for one hot read:** A = **1–2** (`cashu.receive.get` is `repository.get(id)`; `accounts.list` is a resident `Map`). B = **4–5** (`Store` property → `createStore`/`QueryObserver` → `query-client` defaults → the fanout's `setQueryData` freshness model → the load-bearing no-op `subscribe` keep-mounted trick), and two of those layers require understanding `@tanstack/query-core` internals (`fetchOptimistic`, `setQueryData` structural sharing, observer mount lifecycle).
- **The runner:** A's `KeyedQueue` is a self-contained, hand-rolled **79-line** FIFO-per-lane queue with a visible `laneCount` and an explicit retry loop — fully explainable by reading one file. B's `createMutationRunner` is 63 lines but the actual mechanism (FIFO + concurrency + re-entrancy) is *emergent from query-core's `MutationCache`* and only works because of **`patches/@tanstack%2Fquery-core@5.90.20.patch`** — a monkey-patch (adds a per-`mutate()` `scope` via a private field) that is **invisible from the SDK source**, pins an exact version, and is standing maintenance debt.
- **The fanout:** A's is 41 trivial lines (emit a row event). B's is the SDK's most complex file (137 lines) — it must restate every repo's SQL state-filter as a JS `KEEP` predicate + version-gate + keep-set eviction + a per-store key override. Correct and well-commented, but exactly the cache-coherence code the extraction aimed to reduce, now living in the SDK.
- **Dependency asymmetry:** A's SDK package has **no `@tanstack` dependency at all** (the entire engine is ~473 LOC of plain TS, zero external state machine). B carries `@tanstack/query-core` + a `patchedDependencies` entry.

B's genuine win — **TanStack types never leak into domain/processor code** (confinement verified by grep; the `Store<T>` surface is engine-neutral) — is real but narrower than the cost: confinement hides the *types*, not the *behavior you must reason about*. **A is the more explainable SDK on its own.**

## Dimension 4 — Behavior parity. Tie (architectural) — **owed on live**

Both variants share the **identical** 6 processors, leader election (`take_lead` lock), services, repos, change-feed, and `runTask` lane topology — the contested axis (caching) does not touch correctness, only the freshness *mechanism*. Both pass the same ported headless test suite (state-machine, lane-serialization, version-gate, leader-election). The one observable difference, **verified at source**: B's terminal liveness is *precise* (`deriveLifecycleEvent` emits `send`/`receive:completed|failed|expired` with `entity.id` as the id for both quotes and swaps, so the active trackers fire exactly), but B's *intermediate* liveness (e.g. a quote sitting PENDING) is coarser than A's — it refreshes on focus/lifecycle rather than on every row tick (A's row events push every intermediate change to its caches). For balance display, A's caches and B's stores both update live (cashu via the account fanout, spark via an app-side Breez-fed overlay in B).

**Owed live checks** (`bw-verification-checklist.md`, needs a live stack + `VITE_BREEZ_API_KEY`): pay→live balance (both); 2-tab leader + ≤10s failover; kill-leader-mid-flow; reconnect resync; out-of-order events; and **B's #1 risk — no empty-store flash on first render** (the load-before-serve guarantee, regression-locked in code, must be confirmed in the browser). Expected: parity, with B's intermediate-state UX the only judgment call.

## Dimension 5 — Runtime characteristics. **B** for web · **A** for headless

- **DB read amplification (narrower than the spec premise):** steady-state on-screen reads are **in-memory in BOTH** (A serves from TanStack caches kept fresh by `setQueryData`; B from stores kept fresh by `setQueryData` — both `staleTime: Infinity`). The processor work-set path **re-reads the DB in both** (B's `toPromise()` = `fetchOptimistic`, which fetches unconditionally — verified in the installed query-core). The real gap is **catch-up/reconnect**: A invalidates **13 app caches** (→13 refetches) + a resident reload; B refetches **9 stores**. Slight edge **B**, from fewer independent read owners — not from a steady-state advantage A lacks.
- **Bundle:** **(web) B is net smaller** — the app already ships `react-query` (one shared, single-copy `query-core@5.90.20`, verified in `bun.lock`), so B's engine adds ≈0 to the app bundle while *deleting* ~20 app files. **(node/MCP host) A is materially smaller** — A's engine is hand-rolled with zero deps; B pulls in the full `query-core` library plus a **fragile patch on minified privates** (re-apply on every bump).
- **Memory:** **B leaner** — one copy of each hot entity (9 observers); A holds a resident account `Map` in the SDK **plus** ~10 app caches (accounts duplicated SDK↔app).

**Deployment-target split:** B is the better runtime for the web app; A is the better runtime for a pure-node MCP host.

## Dimension 6 — Debuggability. Tie, mirror-image (**A** edge for a stuck quote)

- **Inside the SDK, A is easier:** a stuck quote's lane is the hand-rolled `KeyedQueue` (visible lanes, `laneCount`, explicit retry loop) + a typed event bus you can `sdk.on(...)` to observe live. B's lane is a query-core **mutation scope** — to see why a lane parked you step into patched `node_modules` query-core internals, and nothing is labelled a "lane."
- **Inside the app, B is dramatically easier:** B reads through **one** 55-line adapter (`store-hooks.ts`) with a directly-inspectable store; A spreads the same read across **10 cache classes + 10 wire hooks + the `useWalletEvents` fan-in + a 13-entry resync invalidator** — far more surface for "why didn't the UI update" bugs.
- **Both:** exactly one `console.error` in each engine; **neither instruments the success path** — a stuck quote is silent unless a transition throws (a shared improvement opportunity).

For the specific **stuck-PENDING** framing (a *scheduling* problem), **A has the edge** — the thing you open is the readable 79-line runner.

---

## Recommendation

**On the contested axis, B's _contract_ is the better answer for the project's stated goal** (the SDK completely owns business logic *and* hot-read freshness, so no frontend re-implements caching; MCP and web share one live view). The web-integration evidence is decisive: B retains **1 key-holder + 3 generic hooks** where A retains **10 cache classes + ~30 wire hooks of permanent, per-frontend plumbing**.

**But B's chosen _engine_ (patched query-core) is where every B cost lives:** SDK readability (a monkey-patch invisible from source + 4–5-layer reads), one-shot headless ergonomics (the `undefined`-pre-seed trap), node/MCP bundle (a full query library + a fragile patch), and standing patch-maintenance debt. A avoids all of these with a ~79-line dependency-free runner.

Crucially, **these are separable** — and B's seam was built to make them so: `@tanstack` is confined to `internal/engine/` (4 files) behind the engine-neutral `Store<T>`, verified by the lint rule + the gate-runnable seam test. So the spec's deferred **Variant C — "B's `Store<T>` contract on a hand-rolled engine"** is no longer hypothetical; this eval is the strongest evidence *for* building it: a small hand-rolled observable backing `Store<T>` (no query-core, no patch) would capture **B's web-integration + runtime-web + app-debuggability wins** while reclaiming **A's readability, headless-one-shot, node-bundle, and zero-dependency wins**. The only B costs intrinsic to the *contract* (not the engine) are the `undefined`-pre-seed convention and the background-lifecycle coupling — both of which a hand-rolled engine keeps but can document/guard more legibly than query-core does.

**Decision options:**
1. **(Recommended) Adopt B's contract, build Variant C** — keep the `Store<T>` read surface + the SDK-owns-freshness design (B's web/runtime wins), swap the query-core engine for a hand-rolled `Store<T>`/runner inside the frozen `internal/engine/` seam (reclaim A's readability/headless/bundle). The 3-file seam swap the spec promised.
2. **Ship B as-is** — if the patched-dependency + readability costs are acceptable for the web-first reality (shared single copy, types confined), B's contract is the better long-term frontend story today.
3. **Ship A** — if "a clean, minimal, dependency-free SDK that reads naturally headless" outweighs permanent app-cache plumbing, and the MCP target is primarily one-shot tools.

**Before any of these is final:** run the owed live verification for **both** variants (`aw-verification-checklist.md`, `bw-verification-checklist.md`) — especially behavior parity (dim 4) and B's no-empty-store-flash — plus the standing push gate (Breez smoke + live realtime + `/lnurl-test`), and a shared-base biome normalization (kept deferred on both to keep the diffs comparable for this eval).

## Evidence index
- Metrics: `git diff --shortstat` against `a210e9db`; cache-class/wire-hook counts via `git grep` on each tip.
- Qualitative dims grounded in: A engine `stateless/{keyed-queue,fanout,work-sets,resident-accounts,engine,index}.ts`; B engine `internal/engine/{store,mutation-runner,query-client}.ts` + `store/{fanout,stores,work-sets,wallets,engine,index}.ts` + `patches/@tanstack%2Fquery-core@5.90.20.patch`; shared `sdk.ts:250-327`, `engine.ts`, `internal/realtime/{change-feed,lifecycle-events}.ts`, `internal/background/`. `fetchOptimistic` re-fetch + single-copy verified in the installed `query-core` + `bun.lock`. Full gather: workflow `wf_c2e5a540-243`.
