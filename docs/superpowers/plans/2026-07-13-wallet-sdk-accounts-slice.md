# Wallet SDK Accounts Slice (Step 6) Implementation Plan

Sources of truth:

- `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md` — step 6: wrap the accounts domain in `AccountsApi` + flip the web's accounts imports off `/temporary`.
- `docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md` — `AccountsApi` shape, projections, migration mapping.
- `docs/superpowers/plans/2026-07-09-wallet-sdk-auth-slice.md` — step-5 decisions (A1–A13) and its Deferred list, three items of which land here.
- Branch base: `sdk/accounts-slice` off `sdk/auth-slice` @937e23a9 (step 5, unmerged). Behavior baseline for parity is `master`.

## Global Constraints

1. **Behavior parity with `master`.** Where the port surfaces something improvable, port the master behavior as-is and flag the spot in the Decision Record for a now-vs-defer call. Nothing gets silently "fixed".
2. Web keeps TanStack Query + its realtime layer until step 18. The SDK owns no cache.
3. `userId` never crosses the public surface (contract decision #3); namespaces close over the session.
4. **Projection discipline per the B1 ruling:** the public types strip `wallet`/`proofs`/`keysetCounters` at the *type level* now; at runtime the objects stay fat during migration (hidden fields ride along) and the strip becomes physical at step 18. Hidden fields are reachable only through the sanctioned unwrap sites (B1.3); anywhere else is banned and grep-enforced.
5. One instance per process; namespace factories close over the SDK's own db client + key getters (step-5 `AgicashSdk` pattern).
6. **Single mapper choke point:** objects enter the `['accounts']` cache only through the shared domain→projection mapper (computes `balance`, keeps hidden fields). Cashu `balance` must be recomputed wherever proofs change — one entry point or it drifts.

## Decision Record

### B1 — Projection-typed cache over a runtime-fat migration representation (RESOLVED, maintainer 2026-07-13)

Ruling: `sdk.accounts.*` does **not** sit test-only until step 18 — each slice moves real consumers toward end-state; step 18 keeps only what truly depends on it.

1. **The `['accounts']` cache holds projection-typed objects, fetched via `sdk.accounts.list()`** — a production consumer today. At runtime the objects stay fat during migration: domain fields ride along hidden, plus computed `balance` attached. The strip is type-level until step 18, when it becomes physical and this arrangement ends.
2. **One shared mapper** (attach `balance`, keep hidden fields) is the only way objects enter the cache — queryFn, realtime row mapping, `add` onSuccess, `ensure` seed, claim upserts. Never hand-built elsewhere.
3. **`/temporary` bridge shrinks to:** the internal-repo accessor (unmigrated receive/send repo constructors + realtime row mapping) and a **`toDomainAccount()` checked cast** (asserts hidden fields present). The shared mapper is also `/temporary`-exported for the web-side cache-entry paths (realtime) until step 18. All domain access routes through the existing getter hooks (`useGetCashuAccount`, spark listeners, selector→store handoffs), which unwrap internally; touching hidden fields anywhere else is banned (self-review grep).
4. **Display consumers** read projections straight off the cache (`.balance` etc.). Root `Account` types flip to projections — the index.ts domain shadow for accounts types is deleted; code needing domain types imports them from `/temporary`.

Invariant (stands): the bridge and `sdk.accounts.*` are two faces of **one** instance-internal repository — a single data path with a dual type-surface. At no point do two sources of truth exist.

### B2 — `ensureUserData` → `sdk.user.ensure()` (RESOLVED, maintainer 2026-07-13)

Ruling: `sdk.user.ensure(params): Promise<{ user: User; accounts: Account[] }>` — accounts projection-typed, mapped through the same shared mapper; the web seeds its cache from the **public return**. No bridge involvement in the seed; the signature is already the end-state one. User-side home confirmed. The timestamp params are **intentional** (replayed acceptance times from pending-terms storage) — kept, documented in JSDoc. Both sub-calls below are closed by this ruling; retained as the rationale trail.

Master (`_protected.tsx:75–152`): derives 4 keys + warms seed/mnemonic, constructs `AccountRepository` + `WriteUserRepository`, calls `writeUserRepository.upsert({...authUser fields, accounts: defaultAccounts, ...pubkeys, terms}, accountRepository)` with Zod-aware retry, seeds **both** the user cache and the accounts cache from the returned `{ user, accounts }`.

Key derivation, repositories, retry and the default-accounts constant move SDK-internal. The web middleware keeps: pending-terms storage reads, change-detection short-circuit semantics (SDK memoizes per session identity), redirect logic, cache seeding.

`ensureUserData` is cross-domain (user row + default accounts in one operation) — A1 parked it here because of the `AccountRepository` dependency; the verb reads user-side (`sdk.user.ensure`, recommended).

**Open sub-call 1 — return shape:** under B1 the seed no longer needs the bridge: propose `ensure(params): Promise<{ user: User; accounts: Account[] }>` with accounts projection-typed (runtime-fat, through the shared mapper) — the web seeds both caches exactly as master does, zero extra fetch, contract-legal now. Alternative: `Promise<User>` + a follow-up `sdk.accounts.list()` seed (+1 round-trip cold login).

**Open sub-call 2 — terms param shape:** `EnsureUserParams = { termsAcceptedAt?, giftCardMintTermsAcceptedAt? }` carries *timestamps* (replayed from the web's pending-terms storage) while the existing `acceptTerms` takes *booleans* and stamps the time internally — two terms verbs, two philosophies on one `UserApi`. Intentional (bootstrap replays stored acceptance times) or harmonize? Maintainer call.

### B3 — `AddCashuAccountParams` (RESOLVED — verified exact against the domain signature)

```ts
export type AddCashuAccountParams = {
  name: string;
  mintUrl: string;
  currency: Currency;
  purpose: AccountPurpose;
};
```

`type` implied by the rail-nested method; `userId` session-implicit — the `cashu.add` mapper re-injects both before the service call. Return `Promise<CashuAccount>` (projection-typed; fresh account `balance` = zero from empty proofs).

### B4 — `useAddCashuAccount` flips now (RESOLVED by B1)

The mutation calls `sdk.accounts.cashu.add()`; the projection-typed return is runtime-fat, so `onSuccess` upserts it into the cache through the shared mapper — master's immediate-availability semantics preserved, no extra read. (The cache's `version`-guarded upsert works unchanged: `version` is a public projection field.)

### B5 — Statics and balance reads (updated per B1)

- `UserService.getExtendedAccounts` / `isDefaultAccount` → root exports, re-typed over the **projection** types (pure fns over public fields — id/currency/default ids; no hidden-field access). `useAccounts` flips its import; root `ExtendedAccount` flips with the root-type flip (B1.4).
- Balance reads off the cache (`useBalance`, tiles, selectors) read the mapper-computed `.balance` field directly — same values and the same freshness as master's render-time `getAccountBalance` (both derive from the proofs of the object that last entered the cache).
- `getAccountBalance` stays a root export typed over *domain* accounts for `/temporary`/SDK-internal use (the mapper itself uses it).
- `ReadUserRepository.toUser` + realtime row mapping stay `/temporary` → step 18 (step-5 Deferred, unchanged).

### B6 — `sparkDebugLog` inside the web's `AccountsCache` (OPEN, small)

`updateSparkAccountBalance` (an in-place field update on an existing cache entry — not a cache-entry path, so not mapper-gated) logs through `sparkDebugLog`, which the mapping sends internal. Options: (a) root-export the debug fn until step 18 (parity default), (b) drop the log line (dev-telemetry-only delta). **Building on (a) per the parity doctrine (port master as-is); the drop option stays flagged here for a veto any time before the PR merges.**

### B7 — WASM posture (reframed by B1; stands as its direct consequence — veto open until PR)

The fat cache must carry live spark `wallet` handles during migration (unmigrated flows unwrap and use them), so `sdk.accounts.list()`/`get()` **do** construct wallets on the fetch path until step 18 — the earlier "reads never touch WASM" gate cannot hold during migration; it becomes the **step-18 end-state property** (physical strip ⇒ no wallet construction on reads).

Migration-time acceptance instead = **master WASM-posture parity, byte-for-byte**: the web's `ensureBreezWasm` guards stay exactly where master has them (entry + `_protected` middleware before any accounts fetch), and `list()`/`get()`/`toAccount` preserve master's behavior under WASM-unavailable — including the offline/stub wallet path (`domain` spark accounts carry a throwing stub when not online). Build-time verify: what master's protected surface actually does under iOS Lockdown (stub-and-degrade vs throw) — `list()` must match it exactly, whatever it is. A3's login-page concern is untouched: auth surfaces fetch no accounts.

## Accepted behavior deltas (candidates — settle with the remaining rulings)

1. **Reality-class record — `sdk.accounts.*` is TYPE-honest / RUNTIME-fat until step 18** (B1 ruling: "the strip is type-level until step 18"). Public types understate the runtime objects during migration — intended, not incidental. Holds under three conditions, all tracked: (i) **web-internal consumers only** — no external/untrusted host consumes `sdk.accounts.*` before the physical strip, so the fat is reachable only by code already holding the proofs (to confirm with the maintainer alongside the open B points); (ii) time-boxed to step 18, where the strip becomes physical and this record closes; (iii) nobody claims runtime projection-honesty for accounts returns meanwhile. Contained by the mapper choke point, the checked-cast unwrap, and the hidden-fields grep.
2. **`balance` becomes a cache-entry-computed field** read by display consumers (B5): equal values/freshness to master's render-time compute; listed because the mechanism changes.
3. SDK-internal key getters memoize per session **generation-fenced** (cleared in `onSessionEnded` alongside the existing spark-wallet/mint-CAT clears) — same effective lifetime as master's infinity-stale TanStack entries dying with `queryClient.clear()` on sign-out; listed because the mechanism changes.

## Deferred (tracked, out of scope)

- **Physical projection strip + bridge/mapper deletion → step 18/19** (B1.1: "this whole arrangement ends"); the never-touch-WASM read property lands there too (B7). **Strip precondition:** every unwrap site (the getter hooks over `toDomainAccount()`) must already read `wallet`/`proofs` from the SDK instead of the cache *before* the strip lands — once the mapper stops carrying hidden fields, `toDomainAccount()` can no longer unwrap. Cheap to carry now, expensive to discover at 18.
- `useAccountChangeHandlers`' row mapping (`toAccount` + `AgicashDbAccountWithProofs` row types) stays bridge-served → step 18; its cache writes go through the shared mapper now.
- Web `encryption-hooks.ts` / `cashu-hooks.ts` / `spark-query-options.ts` remain for the *unmigrated* domains (transactions/receive/send construct their own repos until steps 8–16); accounts stops consuming them.
- `sdk.accounts.spark.add` — no addable spark rail today; contract already reserves the shape.
- WASM into `init()` → first Spark slice (A3, restated).
- SdkError wrapping for repo-thrown errors → step 17/19 (step-5 deferred, unchanged by this slice).

## Scope map (import-by-import)

| Today (`/temporary` or web-local) | After step 6 |
| --- | --- |
| `account-repository-hooks.ts` (web builds `AccountRepository` + encryption/seed getters) | **deleted** — repository lives inside the SDK |
| `account-service-hooks.ts` (web builds `AccountService`) | **deleted** — service inside the SDK behind `accounts.cashu.add` |
| `accountsQueryOptions` queryFn `repository.getAllActive` | `sdk.accounts.list()` (projection-typed, mapper-fed); query key/staleTime/structuralSharing unchanged |
| `useAccountOrNull` lazy `repository.get` | `sdk.accounts.get(id)` + mapper-gated upsert |
| `useAddCashuAccount` → `service.addCashuAccount` | `sdk.accounts.cashu.add()` (B4) |
| `ensureUserData` in `_protected.tsx` | `sdk.user.ensure()` (B2) |
| Realtime `ACCOUNT_CREATED/UPDATED` → `repository.toAccount` → upsert | bridge repo accessor → `toAccount` → **shared mapper** → upsert |
| Root `Account`/`CashuAccount`/`SparkAccount`/`ExtendedAccount` = domain (index.ts shadow) | shadow **deleted** — root types are the projections; domain-type importers flip to `/temporary` |
| `useAccounts` → `UserService.getExtendedAccounts` | root export re-typed over projections (B5) |
| `useBalance`/display → `getAccountBalance(account)` | `.balance` off the cache (B5); `getAccountBalance` stays root for domain contexts |
| Money flows reading `wallet`/`proofs` off the cache | unchanged call sites via getter hooks, which unwrap through `/temporary` `toDomainAccount()` internally |
| `AccountsCache.updateSparkAccountBalance` → `sparkDebugLog` | B6 |
| `sdk/accounts.ts` `AddCashuAccountParams = unknown` | pinned (B3, resolved) |

## Task outline

1. **SDK-internal key plumbing** — encryption keypair (m/10111099'/0'), cashu seed, spark mnemonic, cashu locking xpub, spark identity pubkey: memoized getters over `@agicash/opensecret`, generation-fenced, cleared in `onSessionEnded`.
2. **Shared mapper + `createAccountsApi`** — the domain→projection mapper (attach `balance` via `getAccountBalance`, keep hidden fields; fresh types — domain `RedactedAccount` strips only `proofs` and must not be reused); factory wraps repository/service; `cashu.add` re-injects `type`+`userId`; wired into `AgicashSdk` (`Pick` grows `'accounts'`); `AddCashuAccountParams` lands in `sdk/accounts.ts`.
3. **`/temporary` bridge v2** — internal-repo accessor; **`toDomainAccount()` checked cast — the integrity linchpin of the fat-cache arrangement**: genuinely asserts the runtime object carries the hidden domain fields and throws a loud typed error naming the missing fields when handed a thin object. Never a bare `as`-cast — that would let a mapper bug flow a thin object into a money path expecting `.wallet`/`.proofs` and explode past the type checker. Mapper re-export; step-18 removal note on all three.
4. **`sdk.user.ensure()`** — port `ensureUserData` internals verbatim (keys, repos, Zod-aware retry, default-accounts constant, change-detection memo semantics); return shape per B2 sub-call 1; web `_protected.tsx` flip with cache seeding through the mapper.
5. **Web flip sweep** — scope map rows: queryFn/lazy-get/add/realtime re-source; delete the two hook files; root shadow deletion + flip web domain-type importers to `/temporary`; display consumers to `.balance`; unwrap sites consolidated into the getter hooks over `toDomainAccount()`.
6. **Tests** — projections complete (type-level: no `wallet`/`proofs`/`keysetCounters` on public types; runtime: hidden fields present + `balance` correct through every mapper-fed path); mapper is the only cache-entry point (each path exercised); checked-cast failure on a stripped object; params; ensure memo/retry; key-getter fencing across session end; WASM-posture parity per B7 reframe.
7. **Verification** — `bun run fix:all` + `bun run typecheck` (workspace incl. web), unit suite, production build; **hidden-fields grep** (no `.proofs`/`.wallet`/`.keysetCounters` outside sanctioned unwrap sites + `/temporary` importers); browser smoke: cold login (user+accounts bootstrap), add mint, accounts settings pages, default-account switch, balances render, send/receive still work off the cache (unwrap path intact).
8. **PR** — base `master` after step 5 merges (two-green-PRs rule: rebase + re-verify against merged master pre-merge); title `feat(wallet-sdk): accounts slice (step 6)`.

## Self-Review Checklist

1. Spec coverage: `AccountsApi` methods wrapped and web-consumed (B1 ruling); web accounts imports flipped per scope map; step-5 deferred items A1/getEncryption landed here or explicitly re-deferred with reason.
2. Parity scan: every master behavior preserved or listed under Accepted behavior deltas.
3. Projection discipline: public types carry no hidden fields; hidden-fields grep clean; every cache write goes through the shared mapper; `toDomainAccount()` is the only cast site.
4. Key-fencing: sign-out → sign-in as a different user cannot serve the first user's keys/seeds from any SDK memo.
5. `/temporary` surface: only the declared bridge v2 (repo accessor, checked cast, mapper), each carrying a step-18 removal note.
6. WASM posture: master parity verified per B7's build-time check, not assumed.
