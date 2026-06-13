# Wallet SDK Base — Lib Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the general-purpose libraries out of `apps/web-wallet/app/lib` into sibling `@agicash/*` workspace packages so both the app and the forthcoming SDK consume one shared copy. This document implements `@agicash/money` end-to-end as the pattern-setter; the remaining four packages (`bolt11`, `ecies`, `utils`, `cashu`) reuse the identical recipe (see the final section).

**Architecture:** Bun-workspace packages under `packages/*`, `@agicash/`-scoped, each exporting its TypeScript source directly via an `exports` map (`".": "./src/index.ts"`, `"./*": "./src/*"`) — the same pattern `packages/wallet-sdk` already uses. Shared runtime deps live in the root `workspaces.catalog` and are referenced as `"catalog:"`. App import specifiers `~/lib/<x>` are rewritten to `@agicash/<x>` by a mechanical codemod. No behavior changes — this is a move + rewire, verified by the moved tests passing in their new home and the whole repo type-checking.

**Tech Stack:** Bun 1.3.11 workspaces, TypeScript 5.9.3 (`moduleResolution: Bundler`, `noEmit`), `bun test` (built-in runner — the moved tests import `bun:test`), Biome (format/lint), `big.js` 7.0.1.

---

## File Structure

**New package (`@agicash/money`):**
- Create `packages/money/package.json` — package manifest; declares `big.js` (catalog), test + typecheck scripts.
- Create `packages/money/tsconfig.json` — extends root base; `types: ["bun"]` so `bun:test` resolves in the moved test.
- Create `packages/money/biome.json` — extends root `biome.jsonc` (mirrors `packages/wallet-sdk/biome.json`).
- Create `packages/money/src/money.ts` — moved from `apps/web-wallet/app/lib/money/money.ts` (the `Money` class; imports `big.js` + `./types`).
- Create `packages/money/src/types.ts` — moved from `apps/web-wallet/app/lib/money/types.ts` (`Currency`/`CurrencyUnit`/etc.; imports `big.js` type).
- Create `packages/money/src/index.ts` — moved from `apps/web-wallet/app/lib/money/index.ts` (`export { Money }`; `export type { Currency, CurrencyUnit }`).
- Create `packages/money/src/money.test.ts` — moved from `apps/web-wallet/app/lib/money/money.test.ts` (imports `bun:test`, `big.js`, `.`).

**Modified (root + app):**
- Modify `package.json` (root) — add `big.js` + `@types/big.js` to `workspaces.catalog`.
- Modify `apps/web-wallet/package.json` — switch `big.js` and `@types/big.js` to `"catalog:"`.
- Modify ~80 files under `apps/web-wallet/app` — codemod `~/lib/money` → `@agicash/money` (includes the single deep import `~/lib/money/types` → `@agicash/money/types`).
- Delete (via `git mv`) `apps/web-wallet/app/lib/money/` (emptied by the moves).

> **Note on TDD rhythm:** this is a mechanical extraction, not new behavior, so the "test" at each step is the *already-passing* `money.test.ts` continuing to pass in its new location plus the whole repo type-checking. Each task ends at a green, committable state.

---

### Task 1: Move `big.js` + `@types/big.js` into the workspace catalog

`big.js` is used by `@agicash/money` **and** directly by 5 app files (exchange-rate providers, cashu send) — i.e. ≥2 packages — so per the repo convention it belongs in the root catalog, referenced as `"catalog:"` by each consumer.

**Files:**
- Modify: `package.json` (root, `workspaces.catalog`)
- Modify: `apps/web-wallet/package.json`

- [ ] **Step 1: Add both packages to the root catalog**

In `package.json` (root), the `workspaces.catalog` object currently is:

```json
"catalog": {
  "@agicash/opensecret": "0.1.0",
  "@stablelib/base64": "2.0.1",
  "@stablelib/chacha20poly1305": "2.0.1",
  "@types/bun": "1.3.11",
  "dotenv": "16.4.7",
  "jwt-encode": "1.0.1",
  "typescript": "5.9.3"
}
```

Add `@types/big.js` and `big.js` so it becomes:

```json
"catalog": {
  "@agicash/opensecret": "0.1.0",
  "@stablelib/base64": "2.0.1",
  "@stablelib/chacha20poly1305": "2.0.1",
  "@types/big.js": "6.2.2",
  "@types/bun": "1.3.11",
  "big.js": "7.0.1",
  "dotenv": "16.4.7",
  "jwt-encode": "1.0.1",
  "typescript": "5.9.3"
}
```

- [ ] **Step 2: Point the app at the catalog entries**

In `apps/web-wallet/package.json`, change the two existing lines:

```json
"big.js": "7.0.1",
```
to
```json
"big.js": "catalog:",
```
and
```json
"@types/big.js": "6.2.2",
```
to
```json
"@types/big.js": "catalog:",
```

(Leave them in their current `dependencies` / `devDependencies` sections respectively — only the version value changes.)

- [ ] **Step 3: Reinstall and verify the app still resolves big.js**

Run: `bun install`
Expected: completes without error; `bun.lock` updates. Then run:

Run: `bun --filter='web-wallet' run typecheck`
Expected: PASS (no errors) — the app still type-checks with `big.js` resolved via the catalog.

- [ ] **Step 4: Commit**

```bash
git add package.json apps/web-wallet/package.json bun.lock
git commit -m "chore(catalog): hoist big.js + @types/big.js to workspace catalog"
```

---

### Task 2: Extract `@agicash/money` (scaffold + move + codemod)

This is the atomic extraction: create the package, move the source + test, rewire every importer, and verify the whole repo is green — all in one commit so no intermediate broken state is committed.

**Files:**
- Create: `packages/money/package.json`
- Create: `packages/money/tsconfig.json`
- Create: `packages/money/biome.json`
- Create: `packages/money/src/{money.ts,types.ts,index.ts,money.test.ts}` (via `git mv`)
- Modify: ~80 files under `apps/web-wallet/app` (codemod)

- [ ] **Step 1: Create `packages/money/package.json`**

```json
{
  "name": "@agicash/money",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "scripts": {
    "test": "bun test",
    "typecheck": "tsc"
  },
  "dependencies": {
    "big.js": "catalog:"
  },
  "devDependencies": {
    "@types/big.js": "catalog:",
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 2: Create `packages/money/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"],
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["bun"],
    "noEmit": true
  }
}
```

- [ ] **Step 3: Create `packages/money/biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "extends": ["../../biome.jsonc"]
}
```

- [ ] **Step 4: Move the source + test files into the package**

Run:
```bash
mkdir -p packages/money/src
git mv apps/web-wallet/app/lib/money/money.ts      packages/money/src/money.ts
git mv apps/web-wallet/app/lib/money/types.ts      packages/money/src/types.ts
git mv apps/web-wallet/app/lib/money/index.ts      packages/money/src/index.ts
git mv apps/web-wallet/app/lib/money/money.test.ts packages/money/src/money.test.ts
```
Expected: the four files move; `apps/web-wallet/app/lib/money/` is now empty (gone). The moved files' internal imports (`./types`, `./money`, `.`, `big.js`, `bun:test`) remain valid inside the package — no edits needed.

- [ ] **Step 5: Link the new workspace package**

Run: `bun install`
Expected: completes without error; `node_modules/@agicash/money` is symlinked to `packages/money`.

- [ ] **Step 6: Verify the package's own tests pass in the new location**

Run: `bun --filter='@agicash/money' run test`
Expected: PASS — `money.test.ts` runs green (it imports `.` → `src/index.ts`, `big.js`, `bun:test`).

- [ ] **Step 7: Verify the package type-checks**

Run: `bun --filter='@agicash/money' run typecheck`
Expected: PASS (no errors).

- [ ] **Step 8: Codemod every app importer `~/lib/money` → `@agicash/money`**

Run:
```bash
grep -rl "~/lib/money" apps/web-wallet/app | xargs sed -i '' "s|~/lib/money|@agicash/money|g"
```
Expected: ~80 files rewritten. This single substring replace also converts the one deep import `~/lib/money/types` → `@agicash/money/types`, which resolves via the package's `"./*": "./src/*"` export to `src/types.ts`.

(On Linux, use `sed -i` without the `''` argument: `xargs sed -i "s|~/lib/money|@agicash/money|g"`.)

- [ ] **Step 9: Confirm no stale references remain**

Run: `grep -rn "~/lib/money" apps/web-wallet/app`
Expected: no output (exit 1) — every reference was rewritten.

- [ ] **Step 10: Format + type-check the whole repo**

Run: `bun run fix:all`
Expected: PASS — Biome formats the codemod's output (import ordering) and the repo type-checks. `Money`/`Currency`/`CurrencyUnit` resolve from `@agicash/money`; the `instanceof Money` checks in `apps/web-wallet/app/features/shared/encryption.ts` now compare against the single shared class.

- [ ] **Step 11: Commit**

```bash
git add packages/money apps/web-wallet bun.lock
git commit -m "refactor(money): extract @agicash/money workspace package"
```

---

### Task 3: End-to-end verification

Confirm the extraction is green across the whole workspace, not just the money package.

**Files:** none (verification only)

- [ ] **Step 1: Run the full workspace test suite**

Run: `bun run test`
Expected: PASS — `apps/web-wallet` tests and `@agicash/money` tests both run green (`bun run test` = `bun --filter='*' run test`).

- [ ] **Step 2: Confirm a single resolved copy of big.js**

Run: `bun pm ls --all | grep -c "big.js@7.0.1"`
Expected: a single resolved version line (one `big.js@7.0.1`) — no duplicate copies that would split `Money`/`Big` identity.

- [ ] **Step 3: Spot-check the build resolves the package**

Run: `bun --filter='web-wallet' run build`
Expected: the production build completes — confirming Vite resolves `@agicash/money` (and the `/types` subpath) from the workspace.

- [ ] **Step 4: Commit (only if Step 1-3 surfaced and required a fix)**

```bash
git add -A
git commit -m "test(money): verify @agicash/money extraction across the workspace"
```

If Steps 1-3 were already green with no changes, skip this commit.

---

## Applying this pattern to the remaining four packages

Each of these is a separate follow-on plan that reuses Tasks 1-3 verbatim, substituting the package's files, deps, and import specifier. Extraction order (leaf → dependent): **bolt11, ecies, utils** (independent — any order), then **cashu** (depends on money + utils). Per-package deltas:

### `@agicash/bolt11` (from `app/lib/bolt11`)
- **Move:** `app/lib/bolt11/index.ts`, `app/lib/bolt11/bolt11.test.ts` → `packages/bolt11/src/`.
- **Deps (catalog — shared with ecies and/or app):** `@noble/curves`, `@noble/hashes`, `light-bolt11-decoder`. Verify `@scure/base` is a direct import; if so add it to the catalog too.
- **Codemod:** `~/lib/bolt11` → `@agicash/bolt11` (10 sites).
- **Notes:** pure; no browser coupling; no internal `@agicash/*` deps.

### `@agicash/ecies` (from `app/lib/ecies` + crypto primitives)
- **Move:** `app/lib/ecies/ecies.ts`, `app/lib/ecies/index.ts`, `app/lib/ecies/ecies.test.ts`, **plus** `app/lib/sha256.ts` and `app/lib/xchacha20poly1305.ts` (the "crypto primitives" folded in per the spec) → `packages/ecies/src/`. Give the package an `index.ts` that re-exports ecies + `computeSHA256` + the xchacha helpers.
- **Deps (catalog):** `@noble/ciphers`, `@noble/curves`, `@noble/hashes`.
- **Codemod:** `~/lib/ecies` → `@agicash/ecies`; `~/lib/sha256` → `@agicash/ecies/sha256` (or the package root if re-exported); `~/lib/xchacha20poly1305` → `@agicash/ecies/xchacha20poly1305`. (6 sha256 sites, 1 ecies site, 1 xchacha site.)
- **Notes:** `sha256.ts` uses `crypto.subtle` and `xchacha20poly1305.ts` uses `@noble/ciphers/webcrypto` — both are **WebCrypto, available globally in bun/node** (verified by the realtime spike exercising bun's WebCrypto). **No seam needed; they work headless as-is.**

### `@agicash/utils` (from `app/lib/json.ts`, `zod.ts`, `type-utils.ts`)
- **Move:** `app/lib/json.ts`, `app/lib/zod.ts`, `app/lib/type-utils.ts` → `packages/utils/src/` with an `index.ts` re-exporting them (or keep subpath exports `@agicash/utils/json` etc.).
- **Deps (catalog):** `zod`, `type-fest`.
- **Codemod:** `~/lib/json` → `@agicash/utils/json`, `~/lib/zod` → `@agicash/utils/zod`, `~/lib/type-utils` → `@agicash/utils/type-utils` (with `"./*": "./src/*"` exports).
- **Notes:** **`app/lib/utils.ts` (`cn`, UI-only) and `app/lib/validation.ts` (uses `document`) stay in the app** — not general-purpose, the SDK does not need them. Do not move them.

### `@agicash/cashu` (pure protocol only, from `app/lib/cashu`)
- **Move:** `proof.ts`, `secret.ts`, `token.ts`, `payment-request.ts`, `error-codes.ts`, `protocol-extensions.ts`, `blind-signature-matching.ts`, `types.ts` + their `*.test.ts` → `packages/cashu/src/`.
- **Stay in the app (move into the SDK later, NOT into this lib):** `melt-quote-subscription-manager.ts`, `mint-quote-subscription-manager.ts`, `melt-quote-subscription.ts` (React hook), `mint-validation.ts`, and the `ExtendedCashuWallet` / `getCashuWallet` factory. If `app/lib/cashu/utils.ts` mixes pure mapping helpers with `ExtendedCashuWallet`, **split it**: pure helpers (`getCashuUnit`, `getCashuProtocolUnit`, etc.) move to `@agicash/cashu`; the wallet factory + managers stay.
- **Deps:** `@cashu/cashu-ts` (catalog — shared with the app's retained runtime cashu); internal `@agicash/money` (Currency) and `@agicash/utils` (`nullToUndefined`, `safeJsonParse`) — declare both as `"dependencies": { "@agicash/money": "workspace:*", "@agicash/utils": "workspace:*" }`.
- **Codemod:** rewrite `~/lib/cashu` and its subpaths → `@agicash/cashu` for the moved symbols only; **leave** imports of the retained managers/factory pointing at their app paths (~40 importer files — split carefully, this is the one package whose imports are not a blanket replace).
- **Notes:** must be extracted *after* money + utils. This is the only non-leaf package and needs per-symbol codemod care rather than a blanket substring replace.

---

## Self-Review

**Spec coverage:** This plan covers the spec's "Lib extraction (shared base commits)" section — `@agicash/money|bolt11|ecies|cashu|utils`, Money extracted (not copied) so `instanceof` holds (Task 2 Step 10 + Task 3 Step 2), the generated `supabase/database.types.ts` untouched (out of scope here), and cashu's pure-vs-runtime split deferred to its own plan with the boundary spelled out. The SDK scaffolding, auth, repos, change-feed, processors, and server-mode SDK are explicitly *other* base plans, not this one.

**Placeholder scan:** No TBD/TODO. Every code step shows exact file content or an exact command + expected output. The ~80 import sites are handled by a concrete codemod command (not an enumeration) plus a grep guard.

**Type consistency:** Package name `@agicash/money` and import specifier `@agicash/money` are used consistently. The `exports` map (`".": "./src/index.ts"`, `"./*": "./src/*"`) matches the deep-import codemod target `@agicash/money/types`. `bun:test` types are satisfied by `@types/bun` (catalog) + tsconfig `types: ["bun"]`.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-base-lib-extraction.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
