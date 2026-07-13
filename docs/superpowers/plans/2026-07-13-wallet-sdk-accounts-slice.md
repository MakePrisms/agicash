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
4. Public projections stay honest: no `wallet` handles, `proofs`, or `keysetCounters` cross the contract surface (the #1164 review class).
5. One instance per process; namespace factories close over the SDK's own db client + key getters (step-5 `AgicashSdk` pattern).

## Open Decision Points (need maintainer rulings before task bodies freeze)

### B1 — The projection boundary vs the web's domain-account cache (central call)

**Fact:** the web's single accounts cache (`AccountsCache`, key `['accounts']`) holds **domain** accounts — cashu accounts carry `proofs`/`wallet`/`keysetCounters`, spark accounts carry live `wallet` handles. Every unmigrated money flow (send/receive/transfer, steps 9–16) reads those fields from this one cache (`useGetCashuAccount().wallet`, `canSendToLightning`, …). The contract's `Account` union deliberately strips exactly those fields.

**Consequence:** the cache's fetch path cannot flip to `sdk.accounts.list()` returning honest projections without breaking every downstream money flow; and returning domain objects merely *typed* as projections would physically leak proofs/wallets across the contract surface — the class #1164's review closed.

**Proposal (recommended):** the *migration bridge* pattern.

- `sdk.accounts.*` ships with **honest projections** (strip + compute `balance`).
- `/temporary` exports a bridge accessor over the SDK instance's *internal* accounts repository (domain-typed). The web's accounts data layer (query fn, realtime `toAccount`, lazy `get`) re-sources to the bridge: **one** repository (the SDK's, using SDK-internal keys), one cache, domain objects keep flowing to steps-9–16 consumers.
- The web's own `AccountRepository`/`AccountService` construction (`account-repository-hooks.ts`, `account-service-hooks.ts`, and their `useEncryption`/`useCashuCryptography` pulls) is deleted — that is this slice's real import flip.
- The bridge dies with `/temporary` (step 18/19). Until then `sdk.accounts.*` has no web consumer; it is exercised by tests. Later slices consume it as their flows move inside the SDK.

**Alternatives considered:** (a) type-level flip returning domain objects as projections — rejected: physical leak, recreates the reviewed class; (b) honest projections + a second web fetch path for domain accounts — rejected: two sources for one cache, double-fetch, drift.

### B2 — `ensureUserData`'s contract home (step-5 A1 lands here)

**Fact (master):** `_protected.tsx` middleware derives 4 keys (encryption keypair, cashu locking xpub, spark identity pubkey) + warms seed/mnemonic, constructs `AccountRepository` + `WriteUserRepository`, calls `writeUserRepository.upsert({...authUser fields, accounts: defaultAccounts, ...pubkeys, terms}, accountRepository)` with Zod-aware retry, then seeds **both** the user cache and the accounts cache from the returned `{ user, accounts }`.

**Proposal:** `sdk.user.ensure(params): Promise<User>` with `EnsureUserParams = { termsAcceptedAt?: string; giftCardMintTermsAcceptedAt?: string }` — key derivation, repositories, retry and the default-accounts constant all move SDK-internal. The web middleware keeps: pending-terms storage reads, `hasUserChanged` short-circuit semantics (SDK memoizes per session identity), redirect logic, and its cache seeding.

**Sub-call for the accounts seed (pick one):**
- **(a, recommended)** the bridge (B1) also exposes the domain-typed `{ user, accounts }` result of the ensure upsert, so the web seeds `AccountsCache` exactly as today — zero extra fetch, byte-parity.
- **(b)** `ensure()` returns `User` only; the web seeds the accounts cache with a follow-up bridge `getAllActive` read — one extra round-trip on cold login (behavior delta to accept).

### B3 — `AddCashuAccountParams` pin (the contract's one placeholder)

Domain service residual after its omits ⇒ propose

```ts
export type AddCashuAccountParams = {
  name: string;
  mintUrl: string;
  currency: Currency;
  purpose: AccountPurpose;
};
```

`type` implied by the rail-nested method; `userId` session-implicit. Return `Promise<CashuAccount>` (projection; fresh account `balance` = zero from empty proofs).

### B4 — `useAddCashuAccount` flip timing

Under B1 the mutation can flip to `sdk.accounts.cashu.add()` only if its `onSuccess` re-sources a **domain** account for the cache (bridge `get(id)` — one extra read), since the projection return can't be upserted into a domain cache. Master's immediate-upsert exists so dependent hooks see the account instantly.

- **(a, recommended)** keep the mutation on the bridge service this slice (pure parity, zero extra read); the public `add()` is test-covered and web-consumed when the cache itself flips (step 18).
- **(b)** flip now + bridge re-read in `onSuccess` (one extra read on account creation; public method gets a real consumer today).

### B5 — Homes for the `/temporary` statics `useAccounts` pulls (step-5 A11 residue)

- `UserService.getExtendedAccounts(user, accounts)` (the `isDefault` join) and `UserService.isDefaultAccount` — pure fns over domain types ⇒ **root exports** per the migration mapping's predicate-helpers row; `useAccounts` flips its import. (`ReadUserRepository.toUser` stays `/temporary` → step 18, per step-5 Deferred.)
- `getAccountBalance` — already mapping-ruled a root export; `account-hooks.ts` currently imports it from `/temporary` ⇒ import flip only.

### B6 — `sparkDebugLog` inside the web's `AccountsCache`

`updateSparkAccountBalance` logs through `sparkDebugLog`, which the mapping sends internal (logger port). The cache stays web-side. Options: (a) root-export the debug fn until step 18, (b) drop the log line (dev-telemetry-only delta). Maintainer taste; (a) is the parity default.

### B7 — WASM precondition on `accounts.*` (note, not a change)

The repository constructs spark wallet handles; master guards with web-side `ensureBreezWasm()` before `ensureUserData`/accounts reads. `init()` stays WASM-free until the first Spark slice (step-5 A3). Under B1 the web keeps its existing guards (parity); the public `accounts.*` docs state the precondition, and folding WASM into `init()` remains deferred to step 11/15. During the build I verify whether wallet construction in `toAccount` is lazy enough that projection-only paths never touch WASM — if so the note narrows.

## Accepted behavior deltas (candidates — final list settles with the rulings)

1. B2(b) or B4(b), if chosen, each add one lightweight read (cold login / account creation).
2. SDK-internal key getters memoize per session **generation-fenced** (cleared in `onSessionEnded` alongside the existing spark-wallet/mint-CAT clears) — same lifetime as master's infinity-stale TanStack entries which die with `queryClient.clear()` on sign-out, so no observable delta expected; listed because the mechanism changes.

## Deferred (tracked, out of scope)

- `useAccountChangeHandlers` + `AgicashDbAccountWithProofs` row types: realtime row mapping stays on `/temporary` → step 18 (mapping's db-row-types row; same precedent as `ReadUserRepository.toUser`).
- Web `encryption-hooks.ts` / `cashu-hooks.ts` / `spark-query-options.ts` remain for the *unmigrated* domains (transactions/receive/send construct their own repos until steps 8–16); accounts stops consuming them. They go fully internal when their last consumer flips.
- `sdk.accounts.spark.add` — no addable spark rail today; contract already reserves the shape.
- WASM into `init()` → first Spark slice (A3, restated).
- SdkError wrapping for repo-thrown errors → step 17/19 (step-5 deferred, unchanged by this slice).

## Scope map (import-by-import)

| Today (`/temporary` or web-local) | After step 6 |
| --- | --- |
| `account-repository-hooks.ts` (web builds `AccountRepository` + encryption/seed getters) | **deleted** — repository lives inside the SDK; web reaches it via the migration bridge |
| `account-service-hooks.ts` (web builds `AccountService`) | **deleted** — service inside the SDK (`accounts.cashu.add` / bridge per B4) |
| `ensureUserData` in `_protected.tsx` (keys + repos + upsert) | `sdk.user.ensure()` + web glue (B2) |
| `accountsQueryOptions` queryFn `repository.getAllActive` | bridge call (B1); query key/staleTime/structuralSharing unchanged |
| `useAccountOrNull` lazy `repository.get` | bridge call (B1) |
| `useAccounts` → `UserService.getExtendedAccounts` | root export (B5) |
| `useBalance`/others → `getAccountBalance` from `/temporary` | root export import flip (B5) |
| `AccountsCache.updateSparkAccountBalance` → `sparkDebugLog` | B6 |
| `useAccountChangeHandlers` → `repository.toAccount` + row types | stays `/temporary` → step 18 |
| `sdk/accounts.ts` `AddCashuAccountParams = unknown` | pinned (B3) |

## Task outline (bodies freeze after rulings)

1. **SDK-internal key plumbing** — encryption keypair (m/10111099'/0'), cashu seed, spark mnemonic, cashu locking xpub, spark identity pubkey: memoized getters over `@agicash/opensecret`, generation-fenced, cleared in `onSessionEnded`. (The "key getters AccountsApi closes over" from the step-5 skeleton charter.)
2. **`createAccountsApi` factory** — wraps repository/service; projection mappers (strip + `balance`); wired into `AgicashSdk` (`Pick` grows `'accounts'`); `AddCashuAccountParams` lands in `sdk/accounts.ts` (B3).
3. **Migration bridge on `/temporary`** (B1) — domain-typed accessor over the instance's repository (+ ensure result per B2a).
4. **`sdk.user.ensure()`** (B2) — port `ensureUserData` internals verbatim (incl. Zod-aware retry + `hasUserChanged` memo semantics); web `_protected.tsx` flip.
5. **Web accounts data-layer flip** — hooks re-source per the scope map; delete the two hook files; static-import flips (B5, B6).
6. **Tests** — unit: projections (no proofs/wallet/keysetCounters escape; balance math), params, ensure memo/retry, key-getter fencing across session end; integration vs the step-5 harness patterns.
7. **Verification** — `bun run fix:all` + `bun run typecheck` (workspace incl. web), unit suite, production build, browser smoke: cold login (user+accounts bootstrap), add mint, accounts settings pages, default-account switch, send/receive still working off the cache (domain objects intact).
8. **PR** — base `master` after step 5 merges (two-green-PRs rule: rebase + re-verify against merged master pre-merge); title `feat(wallet-sdk): accounts slice (step 6)`.

## Self-Review Checklist

1. Spec coverage: `AccountsApi` methods wrapped; web accounts imports flipped per scope map; step-5 deferred items A1/getEncryption landed here or explicitly re-deferred with reason.
2. Parity scan: every master behavior preserved or listed under Accepted behavior deltas.
3. Projection honesty: grep the built package surface for `proofs`/`wallet` reachability from `sdk.accounts.*` returns.
4. Key-fencing: sign-out → sign-in as a different user cannot serve the first user's keys/seeds from any SDK memo.
5. No new `/temporary` surface except the declared bridge; bridge carries a step-18 removal note.
