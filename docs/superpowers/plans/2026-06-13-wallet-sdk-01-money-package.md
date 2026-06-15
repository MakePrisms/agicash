# `@agicash/money` Shared Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the `Money` value object into a standalone `@agicash/money` workspace package so the SDK and the web app share one `Money` class (so `instanceof` holds across the SDK↔web boundary).

**Architecture:** `Money` moves verbatim into `packages/money` (a private workspace package, source-consumed as `.ts` like `packages/wallet-sdk`). The web repoints its ~80 `~/lib/money` imports to `@agicash/money`; the SDK replaces its placeholder `types/money.ts` with a re-export of the package. The only browser-coupled code in `money.ts` — the `Money.registerDevToolsFormatter()` Chrome console helper, which references `window` — is extracted into a small web-side module so the shared package stays framework-free (`lib: ["ES2022"]`, no DOM) and the framework-free SDK can compile it as source.

**Tech Stack:** Bun workspaces (`workspace:*` protocol), TypeScript 5.9.3 (`moduleResolution: "Bundler"`), `big.js`, `bun:test`, Biome.

---

## Why the DevTools formatter is extracted (verified, not assumed)

`money.ts`'s only DOM coupling is the static `Money.registerDevToolsFormatter()` (registers a formatter on `window.devtoolsFormatters`; called once at `apps/web-wallet/app/entry.client.tsx:20`). The SDK (`packages/wallet-sdk`, `tsconfig lib: ["ES2022"]`, no DOM — it is framework-free and server-capable) re-exports `Money` from `@agicash/money` consumed as TS **source**. A throwaway-monorepo experiment confirmed tsc pulls that source file into the importer's own program and checks it under the importer's `lib`, so a bare `window` reference fails with `error TS2304: Cannot find name 'window'` (exit 2); adding DOM to the importer's lib makes it pass. Rather than couple the server-capable SDK's typecheck to DOM, we move the browser-only debug helper web-side (the design's "browser concerns live web-side" rule, D5/§3). The shared `Money` then has no DOM reference and compiles cleanly under `ES2022` everywhere. After removal, `money.ts` uses only `Intl`, `Symbol`, `Object.freeze`, and `big.js` — all pure ES2022.

## Grounding facts (re-verified 2026-06-15 against the branch)

- Source: `apps/web-wallet/app/lib/money/` — `index.ts` (barrel), `money.ts` (the `Money` class), `types.ts` (`Currency`/`CurrencyUnit`/`UsdUnit`/`BtcUnit` + internal types), `money.test.ts` (`bun:test`). `money.ts`/`types.ts` depend only on `big.js` + each other; the test imports `{ Money } from '.'` and `{ Big } from 'big.js'`.
- Importer surface in the web — **three forms, ~81 files total**:
  - `from '~/lib/money'` (barrel): **79 files**.
  - `from '~/lib/money/types'` (deep): **1 file** — `apps/web-wallet/app/features/accounts/default-currency-switcher.tsx` (`import type { Currency }`).
  - `from './lib/money'` (relative): **1 file** — `apps/web-wallet/app/entry.client.tsx:14` (`import { Money }`, used only at line 20 for the formatter — removed by the extraction, not repointed).
- The web also imports `big.js` **directly** in 5 files outside the money lib (exchange-rate providers + 2 send files), so the web keeps its own `big.js`/`@types/big.js` deps — **do not touch them**.
- SDK placeholder: `packages/wallet-sdk/src/types/money.ts` is a `declare class Money` + `Currency`/`UsdUnit`/`BtcUnit`/`CurrencyUnit` types. `packages/wallet-sdk/src/index.ts` re-exports `Money` (type-only) + `Currency, CurrencyUnit, BtcUnit, UsdUnit`. Internally only `events.ts` and `domains.ts` import from `./types/money`, both `import type` (unaffected). The SDK references `Money`/`Currency` **type-only** — no `new Money` / `instanceof Money` exists yet.
- Workspace: root `package.json` `workspaces.packages = ["apps/*", "packages/*"]` + a `catalog` (has `@types/bun: 1.3.11`, `typescript: 5.9.3`). `bun.lock` shows the workspace protocol in use (`@agicash/wallet-sdk@workspace:packages/wallet-sdk`); no package declares a `workspace:*` dep yet — `@agicash/money` is the first. The existing `@agicash/*` web deps (`opensecret`, `bc-ur`, …) are **external/published**, not workspace packages — so `@agicash/money` is the first workspace-source TS package the web consumes.
- CI gate for this slice: `bun run typecheck` (= `bun --filter='*' run typecheck`, runs each package's own `tsc`) + `bun run test` (= `bun --filter='*' run test`, runs each package's own `test`). **Not** `fix:all` (Biome only — no typecheck).

## Decisions locked for this plan

- **Package location/name:** `packages/money`, name `@agicash/money`, source under `src/` (mirrors `packages/wallet-sdk`). Consumers use `"@agicash/money": "workspace:*"`.
- **Package public surface (barrel `src/index.ts`):** `Money` (value) + `Currency`, `CurrencyUnit`, `UsdUnit`, `BtcUnit` (types). This is a **superset** of the old web barrel (which exported only `Money`, `Currency`, `CurrencyUnit`) — it adds `UsdUnit`/`BtcUnit` so the SDK's existing re-export keeps working.
- **Package tsconfig:** `lib: ["ES2022"]` (framework-free; no DOM), `types: ["bun"]` (so `money.test.ts`'s `bun:test` import typechecks).
- **DevTools formatter:** extracted to `apps/web-wallet/app/lib/money-devtools.ts` (web keeps DOM lib); `entry.client.tsx` calls it instead of `Money.registerDevToolsFormatter()`.
- **Repoint mechanism:** scripted `sed` (macOS/BSD `-i ''` form; env is darwin) for the 79 barrel imports + 1 deep import; `entry.client.tsx` is hand-edited (not repointed). Verified afterward by grep returning zero stray references.
- **Two green commits:** Task 1 (relocate + repoint web — repo stays green because the SDK still uses its self-contained placeholder) then Task 2 (point the SDK at the package). Task 3 runs the full gate.
- `git mv` is used for the source move (preserves history; no transient duplicate copy).

## File Structure

**Created**
- `packages/money/package.json` — package manifest (`@agicash/money`; `big.js` dep; `typecheck`+`test` scripts).
- `packages/money/tsconfig.json` — `lib: ES2022`, `types: [bun]`, extends root base.
- `packages/money/biome.json` — extends root `biome.jsonc` (mirrors `packages/wallet-sdk/biome.json`).
- `packages/money/src/index.ts` — moved barrel, extended with `UsdUnit`/`BtcUnit`.
- `packages/money/src/money.ts` — moved `Money` class, `registerDevToolsFormatter` removed.
- `packages/money/src/types.ts` — moved verbatim.
- `packages/money/src/money.test.ts` — moved verbatim.
- `apps/web-wallet/app/lib/money-devtools.ts` — extracted web-side DevTools formatter.
- `apps/web-wallet/app/lib/money-devtools.test.ts` — test for the extracted formatter.

**Modified**
- ~80 web files — `~/lib/money` / `~/lib/money/types` imports repointed to `@agicash/money` (scripted).
- `apps/web-wallet/app/entry.client.tsx` — swap the `Money` import + call for `registerMoneyDevToolsFormatter()`.
- `apps/web-wallet/package.json` — add `"@agicash/money": "workspace:*"`.
- `packages/wallet-sdk/src/types/money.ts` — placeholder → re-export of `@agicash/money`.
- `packages/wallet-sdk/src/index.ts` — `Money` becomes a value export; update the stale placeholder comment.
- `packages/wallet-sdk/package.json` — add `"@agicash/money": "workspace:*"`.
- `tsconfig.json` (root) — add `{ "path": "./packages/money" }` reference (cosmetic; editor project discovery — the gate runs per-package `tsc`, not `tsc -b`).

**Deleted**
- `apps/web-wallet/app/lib/money/{index,money,types,money.test}.ts` — moved into the package via `git mv`.

---

## Task 1: Relocate `Money` into `@agicash/money` and repoint the web

**Files:**
- Create: `packages/money/package.json`, `packages/money/tsconfig.json`, `packages/money/biome.json`
- Move: `apps/web-wallet/app/lib/money/{index,money,types,money.test}.ts` → `packages/money/src/`
- Modify: `packages/money/src/money.ts`, `packages/money/src/index.ts`
- Create: `apps/web-wallet/app/lib/money-devtools.ts`, `apps/web-wallet/app/lib/money-devtools.test.ts`
- Modify: `apps/web-wallet/app/entry.client.tsx`, `apps/web-wallet/package.json`, `tsconfig.json` (root), + ~80 repointed web files

- [ ] **Step 1: Create the package manifests**

`packages/money/package.json`:
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
    "typecheck": "tsc",
    "test": "bun test"
  },
  "dependencies": {
    "big.js": "7.0.1"
  },
  "devDependencies": {
    "@types/big.js": "6.2.2",
    "@types/bun": "catalog:",
    "typescript": "catalog:"
  }
}
```

`packages/money/tsconfig.json`:
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

`packages/money/biome.json`:
```json
{
  "$schema": "https://biomejs.dev/schemas/1.9.4/schema.json",
  "extends": ["../../biome.jsonc"]
}
```

- [ ] **Step 2: Move the source files into the package (preserve history)**

Run:
```bash
mkdir -p packages/money/src
git mv apps/web-wallet/app/lib/money/index.ts      packages/money/src/index.ts
git mv apps/web-wallet/app/lib/money/money.ts       packages/money/src/money.ts
git mv apps/web-wallet/app/lib/money/types.ts       packages/money/src/types.ts
git mv apps/web-wallet/app/lib/money/money.test.ts  packages/money/src/money.test.ts
```
Then confirm the old dir is gone:
```bash
test ! -d apps/web-wallet/app/lib/money && echo "OK: old money dir removed"
```
Expected: `OK: old money dir removed`. (`types.ts` and `money.test.ts` are moved verbatim — no content edits; the test imports `{ Money } from '.'` which still resolves to `src/index.ts`.)

- [ ] **Step 3: Remove the browser-only DevTools formatter from `packages/money/src/money.ts`**

Delete the entire `registerDevToolsFormatter` static method **and its JSDoc**, located between the `[Symbol.for('nodejs.util.inspect.custom')]()` method and the `constructor`. Remove exactly this block:

```ts
  /**
   * Registers a Chrome DevTools custom formatter for Money instances.
   * Call this once at app startup to enable pretty console output.
   *
   * To enable custom formatters in Chrome DevTools:
   * 1. Open DevTools (F12)
   * 2. Click Settings (gear icon) or press F1
   * 3. Under "Console", check "Custom formatters"
   *
   * After enabling, Money instances will display as: Money ₿1,234.00
   */
  static registerDevToolsFormatter(): void {
    if (typeof window === 'undefined') return;

    const formatter = {
      header: (obj: unknown) => {
        if (!(obj instanceof Money)) return null;
        return [
          'div',
          { style: 'font-weight: bold; color: #9c27b0;' },
          `Money ${obj.toLocaleString()}`,
        ];
      },
      hasBody: (obj: unknown) => obj instanceof Money,
      body: (obj: unknown) => {
        if (!(obj instanceof Money)) return null;
        const money = obj as Money;
        return [
          'div',
          { style: 'margin-left: 12px;' },
          [
            'div',
            {},
            ['span', { style: 'color: #888;' }, 'currency: '],
            money.currency,
          ],
          [
            'div',
            {},
            ['span', { style: 'color: #888;' }, 'amount: '],
            money.amount().toString(),
          ],
          [
            'div',
            {},
            ['span', { style: 'color: #888;' }, 'formatted: '],
            money.toLocaleString(),
          ],
        ];
      },
    };

    // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
    window.devtoolsFormatters = window.devtoolsFormatters || [];
    // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
    window.devtoolsFormatters.push(formatter);
  }
```

Leave the `[Symbol.for('nodejs.util.inspect.custom')]()` method, the blank line after it, and the `constructor(data: MoneyInput<T>)` that follows. Do not touch any other method. (`get formatted()` and the `[Symbol.toStringTag]`/inspect getters stay — they are pure ES.)

- [ ] **Step 4: Extend the package barrel to export `UsdUnit`/`BtcUnit`**

Overwrite `packages/money/src/index.ts` with:
```ts
export { Money } from './money';
export type { Currency, CurrencyUnit, UsdUnit, BtcUnit } from './types';
```

- [ ] **Step 5: Add the workspace dependency to the web app**

In `apps/web-wallet/package.json`, add to `"dependencies"` (keep alphabetical — it sorts to the top of the `@agicash/*` group, before `@agicash/bc-ur`):
```json
    "@agicash/money": "workspace:*",
```

- [ ] **Step 6: Install to link the new workspace package**

Run: `bun install`
Expected: completes without error; `node_modules/@agicash/money` is created as a symlink to `packages/money`. (`big.js@7.0.1` is already in the lockfile via the web app, so no new download is expected.)

Verify the link:
```bash
test -e node_modules/@agicash/money && echo "OK: @agicash/money linked"
```
Expected: `OK: @agicash/money linked`.

- [ ] **Step 7: Verify the package typechecks and its tests pass in isolation**

Run: `bun --filter=@agicash/money run typecheck`
Expected: PASS, no output errors. (A clean pass under `lib: ["ES2022"]` proves `money.ts` is now framework-free — no `window`/DOM references remain.)

Run: `bun --filter=@agicash/money run test`
Expected: PASS — all `Money` tests green (USD/BTC units, locales, conversion, arithmetic) from the moved `src/money.test.ts`.

- [ ] **Step 8: Write the failing test for the extracted DevTools formatter**

Create `apps/web-wallet/app/lib/money-devtools.test.ts`:
```ts
import { afterEach, describe, expect, it } from 'bun:test';
import { Money } from '@agicash/money';
import { registerMoneyDevToolsFormatter } from './money-devtools';

type DevtoolsFormatter = {
  header: (obj: unknown) => unknown;
  hasBody: (obj: unknown) => boolean;
  body: (obj: unknown) => unknown;
};

const getWindow = () => globalThis as { window?: { devtoolsFormatters?: DevtoolsFormatter[] } };

describe('registerMoneyDevToolsFormatter', () => {
  afterEach(() => {
    getWindow().window = undefined;
  });

  it('is a no-op when window is undefined', () => {
    getWindow().window = undefined;
    expect(() => registerMoneyDevToolsFormatter()).not.toThrow();
  });

  it('registers a formatter that discriminates and renders Money instances', () => {
    getWindow().window = {};
    registerMoneyDevToolsFormatter();

    const formatters = getWindow().window?.devtoolsFormatters;
    expect(formatters).toHaveLength(1);
    const formatter = formatters?.[0];

    const money = new Money({ amount: 1000, currency: 'USD' });
    expect(formatter?.hasBody(money)).toBe(true);
    expect(formatter?.hasBody({})).toBe(false);
    expect(formatter?.header({})).toBeNull();

    const header = formatter?.header(money) as unknown[];
    expect(header[0]).toBe('div');
    expect(header[2]).toBe(`Money ${money.toLocaleString()}`);
  });
});
```

- [ ] **Step 9: Run the new test to verify it fails**

Run: `bun --filter=web-wallet run test -- money-devtools`
Expected: FAIL — cannot resolve `./money-devtools` (module does not exist yet).

- [ ] **Step 10: Create the extracted web-side formatter**

Create `apps/web-wallet/app/lib/money-devtools.ts`:
```ts
import { Money } from '@agicash/money';

/**
 * Registers a Chrome DevTools custom formatter for Money instances.
 * Call this once at client startup (dev only) to enable pretty console output.
 *
 * To enable custom formatters in Chrome DevTools:
 * 1. Open DevTools (F12)
 * 2. Click Settings (gear icon) or press F1
 * 3. Under "Console", check "Custom formatters"
 *
 * After enabling, Money instances display as: Money ₿1,234.00
 */
export function registerMoneyDevToolsFormatter(): void {
  if (typeof window === 'undefined') return;

  const formatter = {
    header: (obj: unknown) => {
      if (!(obj instanceof Money)) return null;
      return [
        'div',
        { style: 'font-weight: bold; color: #9c27b0;' },
        `Money ${obj.toLocaleString()}`,
      ];
    },
    hasBody: (obj: unknown) => obj instanceof Money,
    body: (obj: unknown) => {
      if (!(obj instanceof Money)) return null;
      const money = obj as Money;
      return [
        'div',
        { style: 'margin-left: 12px;' },
        ['div', {}, ['span', { style: 'color: #888;' }, 'currency: '], money.currency],
        ['div', {}, ['span', { style: 'color: #888;' }, 'amount: '], money.amount().toString()],
        ['div', {}, ['span', { style: 'color: #888;' }, 'formatted: '], money.toLocaleString()],
      ];
    },
  };

  // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
  window.devtoolsFormatters = window.devtoolsFormatters || [];
  // @ts-expect-error - devtoolsFormatters is a non-standard Chrome API
  window.devtoolsFormatters.push(formatter);
}
```

- [ ] **Step 11: Run the new test to verify it passes**

Run: `bun --filter=web-wallet run test -- money-devtools`
Expected: PASS — both cases green.

- [ ] **Step 12: Update `entry.client.tsx` to call the extracted formatter**

In `apps/web-wallet/app/entry.client.tsx`, replace the import line:
```ts
import { Money } from './lib/money';
```
with:
```ts
import { registerMoneyDevToolsFormatter } from './lib/money-devtools';
```
and replace the dev-only call:
```ts
// Register Chrome DevTools custom formatter for Money class (dev only)
if (process.env.NODE_ENV === 'development') {
  Money.registerDevToolsFormatter();
}
```
with:
```ts
// Register Chrome DevTools custom formatter for Money class (dev only)
if (process.env.NODE_ENV === 'development') {
  registerMoneyDevToolsFormatter();
}
```
(`Money` is not used elsewhere in this file, so the import is fully replaced.)

- [ ] **Step 13: Repoint the remaining web imports to `@agicash/money`**

Repoint the 79 barrel imports and the 1 deep import (macOS/BSD `sed`; env is darwin — on GNU/Linux use `sed -i` without the `''`):
```bash
# 79 barrel imports: from '~/lib/money'  ->  from '@agicash/money'
grep -rlF --include='*.ts' --include='*.tsx' "from '~/lib/money'" apps/web-wallet/app \
  | xargs sed -i '' "s|from '~/lib/money'|from '@agicash/money'|g"

# 1 deep import: from '~/lib/money/types'  ->  from '@agicash/money'  (Currency lives in the barrel)
sed -i '' "s|from '~/lib/money/types'|from '@agicash/money'|g" \
  apps/web-wallet/app/features/accounts/default-currency-switcher.tsx
```
(`grep -F` matches the literal `from '~/lib/money'` including the trailing quote, so it does **not** touch `~/lib/money/types`. `entry.client.tsx` was already handled in Step 12 — it is not in the barrel-grep result.)

- [ ] **Step 14: Verify no stale money references remain in the web**

Run:
```bash
echo -n "old barrel/deep imports: "; grep -rcF "~/lib/money" apps/web-wallet/app | grep -v ':0' | wc -l
echo -n "old relative import:     "; grep -rF "'./lib/money'" apps/web-wallet/app | wc -l
echo -n "old money dir:           "; test -d apps/web-wallet/app/lib/money && echo PRESENT || echo gone
```
Expected:
```
old barrel/deep imports: 0
old relative import:     0
old money dir:           gone
```
(`'./lib/money-devtools'` does not match `'./lib/money'` — the trailing quote differs — so the new module is not a false positive.)

- [ ] **Step 15: Add the package to the root tsconfig references**

In `tsconfig.json` (repo root), add `./packages/money` to `references` so editors discover the project (cosmetic — the gate runs per-package `tsc`, not `tsc -b`):
```json
{
  "files": [],
  "references": [
    { "path": "./apps/web-wallet" },
    { "path": "./apps/web-wallet-e2e" },
    { "path": "./packages/wallet-sdk" },
    { "path": "./packages/money" }
  ]
}
```

- [ ] **Step 16: Verify the web typechecks and tests pass on the package**

Run: `bun --filter=web-wallet run typecheck`
Expected: PASS — `react-router typegen && tsc` complete with no errors; every repointed `@agicash/money` import resolves.

Run: `bun --filter=web-wallet run test`
Expected: PASS — the full web unit suite (now including `money-devtools.test.ts`; no longer including the moved `money.test.ts`).

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(money): extract Money into @agicash/money shared package

Move app/lib/money into packages/money (workspace package, source-consumed
as TS) so the SDK and web share one Money class (instanceof holds across the
boundary). Repoint the web's ~80 imports to @agicash/money. Extract the
browser-only Money.registerDevToolsFormatter() into a web-side module so the
shared package stays framework-free (lib ES2022, no DOM).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```
(The SDK still uses its self-contained placeholder `types/money.ts`, so the whole repo is green at this commit.)

---

## Task 2: Point the SDK's public `Money` at `@agicash/money`

**Files:**
- Modify: `packages/wallet-sdk/src/types/money.ts`, `packages/wallet-sdk/src/index.ts`, `packages/wallet-sdk/package.json`

- [ ] **Step 1: Replace the SDK placeholder with a re-export of the shared package**

Overwrite `packages/wallet-sdk/src/types/money.ts` with:
```ts
/**
 * Money / Currency value types — re-exported from the shared @agicash/money package.
 *
 * `Money` instances cross the SDK↔web boundary, so both sides must resolve to ONE
 * class (so `instanceof` holds). @agicash/money is the single source of truth; this
 * module re-exports it for the SDK's public surface. `events.ts` and `domains.ts`
 * import `Money`/`Currency` from here via `import type`, so they are unaffected.
 */
export { Money } from '@agicash/money';
export type { Currency, CurrencyUnit, UsdUnit, BtcUnit } from '@agicash/money';
```

- [ ] **Step 2: Make `Money` a value export from the SDK barrel**

In `packages/wallet-sdk/src/index.ts`, replace the value-types comment + the type-only `Money` export. Change:
```ts
// --- value types -----------------------------------------------------------
// `Money` is a TYPE-ONLY export in PR1 (it is a placeholder `declare class` with
// no runtime binding — see ./types/money). Slice 0 replaces it with a real
// re-export of `app/lib/money`'s `Money`, at which point this becomes a value export.
export type { Money } from './types/money';
export type { Currency, CurrencyUnit, BtcUnit, UsdUnit } from './types/money';
```
to:
```ts
// --- value types -----------------------------------------------------------
// `Money` is a real class re-exported from the shared @agicash/money package, so
// `instanceof` holds across the SDK↔web boundary (see ./types/money).
export { Money } from './types/money';
export type { Currency, CurrencyUnit, BtcUnit, UsdUnit } from './types/money';
```
(Only the `Money` line flips from `export type` to `export`. The `Currency, CurrencyUnit, BtcUnit, UsdUnit` line stays `export type` — they are types.)

- [ ] **Step 3: Add the workspace dependency to the SDK**

In `packages/wallet-sdk/package.json`, add a `dependencies` block (there is none today — insert it before `devDependencies`):
```json
  "dependencies": {
    "@agicash/money": "workspace:*"
  },
```
Result (for reference):
```json
{
  "name": "@agicash/wallet-sdk",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./*": "./src/*"
  },
  "scripts": {
    "typecheck": "tsc"
  },
  "dependencies": {
    "@agicash/money": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:"
  }
}
```

- [ ] **Step 4: Install to link the dependency**

Run: `bun install`
Expected: completes without error.

- [ ] **Step 5: Verify the SDK typechecks against the real `Money`**

Run: `bun --filter=@agicash/wallet-sdk run typecheck`
Expected: PASS. The SDK now compiles `@agicash/money`'s framework-free source (`money.ts` + `types.ts`) under its own `lib: ["ES2022"]` — clean because the DevTools/`window` code was extracted in Task 1.

> **Contingency (only if this step errors with `Cannot find module 'big.js' or its corresponding type declarations`):** `@types/big.js` was not resolvable from the SDK's package dir. Fix by adding it to `packages/wallet-sdk/package.json` `devDependencies`: `"@types/big.js": "6.2.2"`, then re-run `bun install` and this step. (Expected to be unnecessary — `big.js`/`@types/big.js` hoist to the root `node_modules` via `@agicash/money`.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(wallet-sdk): re-export real Money from @agicash/money

Replace the PR1 placeholder types/money.ts with a re-export of the shared
@agicash/money package and make Money a value export from the barrel, so the
SDK's public Money is the same class the web uses (instanceof holds).

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Verify the full slice gate

**Files:** none (verification only; commit only if a contingency fix was applied).

- [ ] **Step 1: Run the typecheck gate across all packages**

Run: `bun run typecheck`
Expected: PASS for `@agicash/money`, `web-wallet`, `@agicash/wallet-sdk` (and `web-wallet-e2e`).

- [ ] **Step 2: Run the test gate across all packages**

Run: `bun run test`
Expected: PASS — `@agicash/money` (`Money` suite) and `web-wallet` (incl. `money-devtools.test.ts`) green.

- [ ] **Step 3 (recommended, non-gating): smoke-build the web to confirm runtime resolution**

The slice gate is typecheck + test only. But `@agicash/money` is the **first workspace-source TS package the web bundles**, so confirm vite/SSR resolves it before moving on:

Run: `bun run build`
Expected: client + server build complete without `Failed to resolve "@agicash/money"` / "cannot parse" errors.

> **Contingency (only if the build fails to resolve/parse `@agicash/money` under SSR):** vite externalized the workspace package for SSR and Node couldn't load its `.ts`. Add to `apps/web-wallet/vite.config.ts` inside the returned config object:
> ```ts
>     ssr: {
>       noExternal: ['@agicash/money'],
>     },
> ```
> Re-run `bun run build`. If applied, `git add apps/web-wallet/vite.config.ts && git commit -m "fix(web): bundle @agicash/money for SSR"` (with the standard `Co-Authored-By` trailer). This config is a candidate to generalize to `@agicash/*` when the web starts consuming `@agicash/wallet-sdk` in a later slice — note it but do not over-build here.

- [ ] **Step 4: Confirm the working tree is clean**

Run: `git status --porcelain`
Expected: empty (all changes committed across Tasks 1–2, plus any Task 3 contingency commit).

---

## Self-Review (run against the spec §8/§9-S1 + the plan-of-plans Plan 01 row)

**1. Spec coverage**
- §9 S1 "`@agicash/money` shared package (web + SDK import it; behaviour identical)" → Tasks 1–2. Web imports it (Step 1.13), SDK imports it (Step 2.1). Behaviour identical: `Money` moved verbatim except the extracted browser-only debug helper (behaviour-preserving — formatter still registers at client startup); the moved `money.test.ts` passing (Step 1.7) is the regression proof.
- §9 S1 "First, because its instances cross the boundary" → single class via one workspace package; SDK re-exports it as a **value** (Step 2.2) so `instanceof` holds.
- Plan-of-plans Plan 01 "app + SDK build on it" → typecheck gate covers app + SDK (Task 3 Step 1); build smoke for the app's bundler (Task 3 Step 3).
- D8 "`@agicash/money` is a standalone shared workspace package; the other libs are SDK-internal" → only `money` is extracted here; no other lib touched.

**2. Placeholder scan** — no "TBD"/"handle errors"/"similar to" placeholders; every code/command step shows full content. The two contingencies (big.js types; SSR resolution) have exact fixes, not vague instructions.

**3. Type consistency** — `registerMoneyDevToolsFormatter` is the name used in the test (1.8), the module (1.10), and the `entry.client.tsx` call (1.12). Barrel exports `Money` + `Currency`/`CurrencyUnit`/`UsdUnit`/`BtcUnit` (1.4); SDK re-export consumes exactly those four types + `Money` (2.1); SDK barrel re-exports the same set (2.2). `workspace:*` is used identically in both consumers (1.5, 2.3).

## Known risks / notes

- **Workspace-source consumption is new for the web.** Typecheck (tsc, `moduleResolution: Bundler`) resolves the package's `exports` to `./src/index.ts` natively (same as the SDK already does for itself). The runtime bundlers — tsx (dev), `bun build` (prod server), vite/rollup (client) — all transpile TS; the residual risk is vite SSR externalization, covered by the Task 3 Step 3 smoke + `ssr.noExternal` contingency.
- **`bun install` runs twice** (Task 1 Step 6, Task 2 Step 4). Both are workspace-link operations over deps already in the lockfile — no new external downloads expected.
- **Do not remove the web's `big.js`/`@types/big.js` deps** — 5 web files import `big.js` directly outside the money lib. Dependency pruning is deferred to the cut-over cleanup slice (spec §9 S15).

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-01-money-package.md`. Two execution options:

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.
2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?
