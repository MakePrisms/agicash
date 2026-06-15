# Wallet SDK Full Migration — Plan-of-Plans (index)

**Design spec:** `docs/superpowers/specs/2026-06-13-wallet-sdk-full-migration-design.md` (read it first).
**Branch:** `sdk-nocache/full-migration` (based on `sdk/pr1-contract`, the PR #1119 contract).

> **Standalone exploration.** This is an independent, single-approach (no-cache,
> one-PR) full-migration design. It is **intentionally separate from** the
> `sdkx/base` two-variant track and must **not** depend on, derive from, or
> modify it. Lib extraction (`@agicash/money` + the rest) **is in scope here** —
> this branch is based on the contract, which does not carry those packages.

## How this is planned & executed

- **One PR**, built as the ordered slices in spec §9 (Phase 0 foundation →
  Phase 1 "dark" SDK domains → Phase 2 web cut-over).
- **One plan document per slice**, written **just-in-time** — each plan is
  authored in a **fresh session** grounded in the *actual* code shapes the
  previous slice established, not guessed up front (we write the SDK fresh; we
  do **not** lift the `sdk/pr2-core` / `sdk/pr3-auth-user` / `sdk-reactive/*`
  prototype code — reference only).
- Per slice: write the plan with `superpowers:writing-plans`, then execute with
  `superpowers:subagent-driven-development`. SDK domain slices (Phase 1) are
  verified by **SDK unit tests alone** — the web is untouched until cut-over.
- **Verification gate** (spec §10) before the PR is "done": unit tests per slice
  (incl. the regression tests for stale-balance `synced` re-read, nutshell-#788
  change refetch, taken-username → `DomainError`, transfer auto-fail), then
  `fix:all` + web unit suite + `test:e2e`, then manual money-path checks.

## Plans

| # | Slice(s) | Produces (testable on its own) | Status |
|---|---|---|---|
| 01 | S1 | `@agicash/money` shared package; app + SDK build on it | ✅ [done](2026-06-13-wallet-sdk-01-money-package.md) (2 commits) |
| 02 | S2 | SDK core shell — config · events · errors+classify · connections · crypto (domains stubbed) | [written](2026-06-13-wallet-sdk-02-sdk-core-shell.md) — adopts `@agicash/opensecret@1.0.0-rc.0` (catalog bump + storage provider) |
| 03 | S3 | auth + user (+ session resolver, ensure-on-resolve bootstrap) | not written |
| 04 | S4 | accounts + scan + exchangeRate (+ live wallet-handle resolution) | not written |
| 05 | S5 | cashu ops (send / receive / token-claim) | not written |
| 06 | S6 | spark ops (client + server spark wallet) | not written |
| 07 | S7 | orchestrator (executeQuote + #788; receiveToken; balance listener incl. `synced`) | not written |
| 08 | S8 | transactions + contacts + transfers | not written |
| 09 | S9 | background (leader election) + realtime forwarder | not written |
| 10 | S10 | `ServerSdk` facade over shared internals | not written |
| 11 | S11–S15 | web cut-over (reads → flip → server routes → cleanup) | not written |

Dependency order is largely forced: 01 → 02 → 03 → {04} → {05, 06} → 07 → 08 →
09 → 10 → 11. Reads (S12) subdivide freely; **S13 (the orchestration flip) is
necessarily atomic** — see spec §9.

## Starting notes for Plan 01 (`@agicash/money`)

Facts gathered 2026-06-13 (re-verify before writing the plan):
- Source lives at `apps/web-wallet/app/lib/money/` — `index.ts` (barrel),
  `money.ts` (~24 KB, the `Money` class; has a `window.devtoolsFormatters`
  registration guarded by `typeof window === 'undefined'`), `types.ts`
  (`Currency` / `CurrencyUnit` / `UsdUnit` / `BtcUnit`), `money.test.ts`.
- **79** files import `from '~/lib/money'` (the repoint surface). The `~` alias
  is the web app's tsconfig path.
- The SDK currently has a **placeholder** at
  `packages/wallet-sdk/src/types/money.ts` (a `declare class Money` + the
  `Currency`/unit types) re-exported from `packages/wallet-sdk/src/index.ts`.
  Plan 01 replaces the placeholder with a re-export of `@agicash/money` (so the
  same `Money` constructor — and `instanceof` — is shared across the boundary).
- Workspace: root `package.json` `workspaces.packages = ["apps/*", "packages/*"]`
  with a `catalog`. New package goes at `packages/money` (name `@agicash/money`);
  consumers reference it via the workspace protocol. Check how an existing
  cross-package dep is declared before adding (none may exist yet on this branch).
- Verify with `bun run fix:all` + `bun test` after the move; behaviour identical.
