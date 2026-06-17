# Wallet-SDK Base Plan 6a — Rates Domain (`sdk.rates`)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the app's `ExchangeRateService` + its three HTTP providers into the SDK as an internal `rates` module and expose a public `sdk.rates` domain, so the SDK is self-contained for currency conversion (no host-injected rate provider).

**Architecture:** Move `lib/exchange-rate/` verbatim into `packages/wallet-sdk/src/internal/rates/` (it has zero app coupling — only `ky`, `big.js`, `console.*`). Add a dependency-free `RatesDomain` (`src/domains/rates.ts`) wrapping a default-constructed `ExchangeRateService`, wired onto `Sdk` as `readonly rates`. The app's `~/lib/exchange-rate` files become thin re-export shims so its 15s UI polling keeps working unchanged. The Plan-5 server SDK's injected `getExchangeRate` port gains an internal default.

**Tech Stack:** TypeScript (moduleResolution Bundler), `bun` + `bun:test`, `ky` (HTTP), `big.js`, `@agicash/money`.

**Context:** This is the first of three sub-plans (6a rates · 6b domain facades · 6c receiveToken orchestrators) that build the shared public domain facade on `sdkx/base`. Both variant branches (A `sdkx/stateless`, B `sdkx/store`) inherit it. 6c's cross-account `receiveToken` path depends on `sdk.rates` landing here.

## Global Constraints

- **Package manager:** `bun` / `bunx` only. **Branch:** `sdkx/base`. Commit after each task. **Do NOT push** (gated: Breez smoke + live realtime + `/lnurl-test` + user nod).
- **Gate (every task):** `bun run typecheck` (exit 0, all packages) **and** `bun run test` (0 failures). **NEVER run `bun run fix:all`** — it reorders imports repo-wide; this binds implementers AND reviewers; discard any pollution with `git checkout -- .`. Every subagent prompt carries a loud ⛔ `fix:all` prohibition.
- **SDK is host-agnostic:** SDK code (`packages/wallet-sdk/src/**`) must NOT read `process.env`/`import.meta.env`, touch `window`/`localStorage`/`document`, or import Sentry/`@tanstack/*`. The ported rates files already satisfy this (only `ky`/`big.js`/`console.*`).
- **Dependency hoisting:** `ky` and `big.js` are already in the repo (app deps / catalog). Hoisting them so the SDK can use them is part of the extraction, not a new external install — add via the catalog per CLAUDE.md ("shared by ≥2 packages → catalog"), then `bun install`.
- **Behavior parity:** the ported `ExchangeRateService`/providers are byte-for-byte (same provider priority MempoolSpace→Coingecko→Coinbase, same endpoints/timeouts, same `'1'` same-currency short-circuit, same error strings, `console.warn`/`error` only).
- **Code standards:** kebab-case files; prefer `type` over `interface` (the existing `ExchangeRateProvider` is an `interface` — preserve it as-is in the move; do not churn). `bun:test` for tests.

## File Structure

**New SDK files** (`packages/wallet-sdk/src/`):
- `internal/rates/exchange-rate-service.ts` — moved from app (incl. the `exchangeRateService` singleton).
- `internal/rates/providers/types.ts` — `Ticker`, `GetRatesParams`, `ExchangeRateProvider`, `Rates`.
- `internal/rates/providers/mempool-space.ts`, `coingecko.ts`, `coinbase.ts` — moved.
- `internal/rates/index.ts` — barrel (`export * from './exchange-rate-service'; export * from './providers/types';`).
- `internal/rates/exchange-rate-service.test.ts` — moved (5 pure-mock tests).
- `domains/rates.ts` — `RatesDomain` + `Rate` type.
- `domains/rates.test.ts` — carve-out unit test.

**Modified SDK files:**
- `package.json` — add `"ky": "catalog:"` + `"big.js": "catalog:"` deps, `"@types/big.js": "catalog:"` devDep; add `exports` entries for `./internal/rates/*` + `./domains/rates`.
- `src/sdk.ts` — construct + attach `readonly rates: RatesDomain`.
- `src/index.ts` — export `RatesDomain`-relevant types (`Ticker`, `Rate`).
- `src/server.ts` — default `getExchangeRate` to the internal rates service.

**Modified root:**
- root `package.json` — add `ky` to `workspaces.catalog` (exact `1.14.3`).

**Modified app files (re-export shims, behavior unchanged):**
- `apps/web-wallet/app/lib/exchange-rate/exchange-rate-service.ts`, `providers/types.ts`, `index.ts` → re-export from the SDK.
- `apps/web-wallet/package.json` — `"ky": "1.14.3"` → `"ky": "catalog:"`.
- Provider impl files under `apps/web-wallet/app/lib/exchange-rate/providers/` deleted if no direct importer (grep-gated).

---

## Task 1: Hoist `ky` to the catalog; add rates deps to wallet-sdk

**Files:**
- Modify: `package.json` (root — `workspaces.catalog`)
- Modify: `packages/wallet-sdk/package.json`
- Modify: `apps/web-wallet/package.json`

- [ ] **Step 1: Add `ky` to the root catalog.**

In root `package.json`, under `workspaces.catalog`, add (keeping alphabetical order, exact version matching the app's current pin):
```json
"ky": "1.14.3",
```
Confirm `big.js` (`7.0.1`) and `@types/big.js` (`6.2.2`) are already present in the catalog (per exploration they are at lines ~19/21) — do NOT duplicate.

- [ ] **Step 2: Reference the catalog deps in wallet-sdk.**

In `packages/wallet-sdk/package.json`, add to `dependencies`:
```json
"big.js": "catalog:",
"ky": "catalog:",
```
and to `devDependencies`:
```json
"@types/big.js": "catalog:",
```

- [ ] **Step 3: Point the app's `ky` at the catalog.**

In `apps/web-wallet/package.json`, change `"ky": "1.14.3"` → `"ky": "catalog:"`.

- [ ] **Step 4: Install.**

Run:
```bash
cd /Users/ditto/Projects/MakePrisms/agicash/.claude/worktrees/sdk-extraction-fable
bun install
```
Expected: resolves with one hoisted `ky@1.14.3` + `big.js@7.0.1`; no version conflicts. `git diff bun.lock` should show only the catalog re-pointing, not a `ky` version change.

- [ ] **Step 5: Gate.** `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures (no code changed yet — this just confirms the dep graph still resolves). ⛔ No `fix:all`.

- [ ] **Step 6: Commit.**

```bash
git add package.json packages/wallet-sdk/package.json apps/web-wallet/package.json bun.lock
git commit -m "build(wallet-sdk): hoist ky to catalog + add big.js/ky deps (base 6a)"
```

---

## Task 2: Move `ExchangeRateService` + providers into the SDK

**Files:**
- Create: `packages/wallet-sdk/src/internal/rates/exchange-rate-service.ts`, `internal/rates/providers/{types,mempool-space,coingecko,coinbase}.ts`, `internal/rates/index.ts`, `internal/rates/exchange-rate-service.test.ts`
- Modify: `packages/wallet-sdk/package.json` (exports)

**Interfaces:**
- Produces: `ExchangeRateService` (ctor `(providers?: ExchangeRateProvider[])`; `getRates({tickers, signal?}): Promise<Rates>`; `getRate(ticker, signal?): Promise<string>`), the module singleton `exchangeRateService`, and the types `Ticker = \`${string}-${string}\``, `GetRatesParams`, `ExchangeRateProvider`, `Rates` at `@agicash/wallet-sdk/internal/rates/*`.

- [ ] **Step 1: Copy the six files verbatim** from `apps/web-wallet/app/lib/exchange-rate/` into `packages/wallet-sdk/src/internal/rates/` (same relative layout: `exchange-rate-service.ts`, `index.ts`, `exchange-rate-service.test.ts` at the root; `types.ts`, `mempool-space.ts`, `coingecko.ts`, `coinbase.ts` under `providers/`). Their imports are all relative (`./types`, `./providers/*`) or third-party (`ky`, `big.js`) — **no import paths change**. Do not alter any logic.

- [ ] **Step 2: Confirm no app-coupling slipped in.**

```bash
grep -rnE "process\.env|import\.meta|window|@tanstack|@sentry|~/|\.\./\.\./" packages/wallet-sdk/src/internal/rates/ || echo "CLEAN"
```
Expected: `CLEAN` (only `./`-relative + `ky`/`big.js` imports). If a `~/` alias or `../../` import appears, the source had a hidden coupling — STOP and report.

- [ ] **Step 3: Add package.json exports.**

In `packages/wallet-sdk/package.json` `exports`, add (so the app shims + other SDK code can import these explicitly — the `./*` wildcard is not honored by the app's tsc):
```json
"./internal/rates/exchange-rate-service": "./src/internal/rates/exchange-rate-service.ts",
"./internal/rates/providers/types": "./src/internal/rates/providers/types.ts",
```

- [ ] **Step 4: Run the ported test in isolation.**

```bash
cd packages/wallet-sdk && bun test src/internal/rates/exchange-rate-service.test.ts
```
Expected: PASS (5 tests — they use pure mock providers, no network). If the test file imports anything via a path that no longer resolves, fix the relative import (it should be `./exchange-rate-service` / `./providers/*`).

- [ ] **Step 5: Full gate.** From repo root: `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. (The app still imports its own copy; nothing else consumes the new module yet.) ⛔ No `fix:all`.

- [ ] **Step 6: Commit.**

```bash
git add packages/wallet-sdk/src/internal/rates/ packages/wallet-sdk/package.json
git commit -m "feat(wallet-sdk): move ExchangeRateService + providers into SDK internal/rates (base 6a)"
```

---

## Task 3: Re-point the app at the SDK rates module (shims)

The app's 15s UI rate-polling (`~/hooks/use-exchange-rate.ts`) stays app-side (spec open-Q#2) but must now source `ExchangeRateService`/`exchangeRateService`/`Ticker` from the SDK. Convert the app's `lib/exchange-rate` to re-export shims so all importers keep working unchanged.

**Files:**
- Modify: `apps/web-wallet/app/lib/exchange-rate/exchange-rate-service.ts` (shim)
- Modify: `apps/web-wallet/app/lib/exchange-rate/providers/types.ts` (shim)
- Modify: `apps/web-wallet/app/lib/exchange-rate/index.ts` (verify it re-exports the shims)
- Delete (grep-gated): `apps/web-wallet/app/lib/exchange-rate/providers/{mempool-space,coingecko,coinbase}.ts`

- [ ] **Step 1: Find direct importers of the provider impls.**

```bash
cd /Users/ditto/Projects/MakePrisms/agicash/.claude/worktrees/sdk-extraction-fable
grep -rnE "exchange-rate/providers/(mempool-space|coingecko|coinbase)" apps/web-wallet/app --include='*.ts' --include='*.tsx'
```
- If no matches (expected — only `exchange-rate-service.ts` imported them, and it's becoming a shim): delete the three provider impl files in Step 4.
- If there are matches: leave those provider files as shims too (re-export from `@agicash/wallet-sdk/internal/rates/providers/<name>` — add the matching package.json export in Task 2's style). Record the result in the report.

- [ ] **Step 2: Shim `exchange-rate-service.ts`.**

Replace the body of `apps/web-wallet/app/lib/exchange-rate/exchange-rate-service.ts` with:
```ts
export {
  ExchangeRateService,
  exchangeRateService,
} from '@agicash/wallet-sdk/internal/rates/exchange-rate-service';
```

- [ ] **Step 3: Shim `providers/types.ts`.**

Replace the body of `apps/web-wallet/app/lib/exchange-rate/providers/types.ts` with:
```ts
export type {
  Ticker,
  GetRatesParams,
  ExchangeRateProvider,
  Rates,
} from '@agicash/wallet-sdk/internal/rates/providers/types';
```

- [ ] **Step 4: Confirm `index.ts` + delete moved impls.**

`apps/web-wallet/app/lib/exchange-rate/index.ts` should already be `export * from './exchange-rate-service'; export * from './providers/types';` — leave it (it now re-exports the shims). Then, per Step 1's result:
```bash
git rm apps/web-wallet/app/lib/exchange-rate/providers/mempool-space.ts \
       apps/web-wallet/app/lib/exchange-rate/providers/coingecko.ts \
       apps/web-wallet/app/lib/exchange-rate/providers/coinbase.ts
```
(Skip any that Step 1 found a direct importer for — shim those instead.)

- [ ] **Step 5: Gate (app typecheck is the real check).** `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures — every `~/lib/exchange-rate` importer (`use-exchange-rate.ts`, `money-with-converted-amount.tsx`, `use-money-input.ts`, `send-scanner.tsx`, `server-sdk.server.ts`, etc.) still resolves through the shims. ⛔ No `fix:all`.

- [ ] **Step 6: Commit.**

```bash
git add apps/web-wallet/app/lib/exchange-rate/
git commit -m "refactor(web): re-point lib/exchange-rate at SDK internal/rates (base 6a)"
```

---

## Task 4: `RatesDomain` + wire `sdk.rates` (TDD carve-out)

**Files:**
- Create: `packages/wallet-sdk/src/domains/rates.ts`
- Test: `packages/wallet-sdk/src/domains/rates.test.ts`
- Modify: `packages/wallet-sdk/src/sdk.ts` (construct + attach `rates`)
- Modify: `packages/wallet-sdk/src/index.ts` (export `Ticker`, `Rate`)
- Modify: `packages/wallet-sdk/package.json` (export `./domains/rates`)

**Interfaces:**
- Consumes: `ExchangeRateService`, `Ticker` (`../internal/rates/...`), `Money`, `Currency` (`@agicash/money`).
- Produces: `class RatesDomain` with `get(ticker: Ticker): Promise<Rate>` and `convert(p: { amount: Money; to: Currency }): Promise<Money>`; `type Rate = string`. Attached as `sdk.rates`.

- [ ] **Step 1: Write the failing test.**

Create `packages/wallet-sdk/src/domains/rates.test.ts`:
```ts
import { Money } from '@agicash/money';
import { describe, expect, test } from 'bun:test';
import type { ExchangeRateProvider } from '../internal/rates/providers/types';
import { ExchangeRateService } from '../internal/rates/exchange-rate-service';
import { RatesDomain } from './rates';

// A stub provider supporting BTC-USD / USD-BTC with a fixed rate.
const stubProvider: ExchangeRateProvider = {
  supportedTickers: ['BTC-USD', 'USD-BTC'],
  async getRates({ tickers }) {
    const out: Record<string, string> = { timestamp: '0' } as never;
    const rates: Record<string, string> = { 'BTC-USD': '100000', 'USD-BTC': '0.00001' };
    const result: { timestamp: number; [k: string]: string | number } = { timestamp: 0 };
    for (const t of tickers) result[t] = rates[t];
    return result as never;
  },
};

function makeDomain() {
  return new RatesDomain(new ExchangeRateService([stubProvider]));
}

describe('RatesDomain.get', () => {
  test('returns the decimal-string rate for a ticker', async () => {
    expect(await makeDomain().get('BTC-USD')).toBe('100000');
  });
  test('returns "1" for a same-currency ticker (short-circuit)', async () => {
    expect(await makeDomain().get('USD-USD')).toBe('1');
  });
});

describe('RatesDomain.convert', () => {
  test('converts an amount into the target currency using the fetched rate', async () => {
    const usd = await makeDomain().convert({
      amount: new Money({ amount: 1, currency: 'BTC', unit: 'btc' }),
      to: 'USD',
    });
    expect(usd.currency).toBe('USD');
    expect(usd.toNumber('usd')).toBe(100000);
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
cd packages/wallet-sdk && bun test src/domains/rates.test.ts
```
Expected: FAIL — cannot resolve `./rates`.

- [ ] **Step 3: Implement `RatesDomain`.**

Create `packages/wallet-sdk/src/domains/rates.ts`:
```ts
import type { Currency, Money } from '@agicash/money';
import { ExchangeRateService } from '../internal/rates/exchange-rate-service';
import type { Ticker } from '../internal/rates/providers/types';

/** A decimal exchange-rate string (e.g. "100000"), in source/target orientation
 * for the requested ticker — pass directly to `Money.convert(target, rate)`. */
export type Rate = string;

/**
 * Currency conversion via the SDK's internal exchange-rate providers
 * (MempoolSpace → Coingecko → Coinbase, with fallback). Self-contained: needs
 * no host-injected rate source.
 */
export class RatesDomain {
  constructor(
    private readonly exchangeRateService: ExchangeRateService = new ExchangeRateService(),
  ) {}

  /** The exchange rate for `ticker` (e.g. 'BTC-USD'). '1' for same-currency. */
  get(ticker: Ticker, signal?: AbortSignal): Promise<Rate> {
    return this.exchangeRateService.getRate(ticker, signal);
  }

  /** Convert `amount` into `to`, fetching the rate for `${amount.currency}-${to}`. */
  async convert(params: {
    amount: Money;
    to: Currency;
    signal?: AbortSignal;
  }): Promise<Money> {
    const { amount, to, signal } = params;
    if (amount.currency === to) return amount;
    const rate = await this.get(`${amount.currency}-${to}` as Ticker, signal);
    return amount.convert(to, rate);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes.**

```bash
cd packages/wallet-sdk && bun test src/domains/rates.test.ts
```
Expected: PASS (3 tests). If `Money` unit strings (`'btc'`/`'usd'`) or `convert` behavior differ from the assertions, fix the assertions against real `Money` behavior — not the production logic.

- [ ] **Step 5: Wire `sdk.rates` onto `Sdk`.**

In `packages/wallet-sdk/src/sdk.ts`:
- Add the import: `import { RatesDomain } from './domains/rates';`
- Add the public field (near `readonly user`): `readonly rates: RatesDomain;`
- Add to the private ctor `parts` type and assign in the ctor body: `this.rates = parts.rates;`
- In `static async create`, construct it (it is dependency-free) before `return new Sdk(...)`: `const rates = new RatesDomain();`
- Add `rates` to the `new Sdk({ ... })` parts object.

- [ ] **Step 6: Export the rates types from the barrel + package.json.**

In `packages/wallet-sdk/src/index.ts`, add:
```ts
export type { Rate } from './domains/rates';
export type { Ticker } from './internal/rates/providers/types';
```
In `packages/wallet-sdk/package.json` `exports`, add:
```json
"./domains/rates": "./src/domains/rates.ts",
```

- [ ] **Step 7: Full gate.** From repo root: `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. ⛔ No `fix:all`.

- [ ] **Step 8: Commit.**

```bash
git add packages/wallet-sdk/src/domains/rates.ts packages/wallet-sdk/src/domains/rates.test.ts packages/wallet-sdk/src/sdk.ts packages/wallet-sdk/src/index.ts packages/wallet-sdk/package.json
git commit -m "feat(wallet-sdk): RatesDomain (sdk.rates) + tests (base 6a)"
```

---

## Task 5: Default the server SDK's `getExchangeRate` to the internal rates service

The Plan-5 `createServerSdk` declares `getExchangeRate?: (ticker: string) => Promise<string>` and threads it into `LightningAddressService`. Now that the SDK owns rates, default it internally so the host needn't inject one.

**Files:**
- Modify: `packages/wallet-sdk/src/server.ts`

- [ ] **Step 1: Default the port.**

In `packages/wallet-sdk/src/server.ts`, import the service: `import { ExchangeRateService } from './internal/rates/exchange-rate-service';`. Where `getExchangeRate` is read from config and passed to `LightningAddressService` (currently `getExchangeRate: config.getExchangeRate`), default it:
```ts
getExchangeRate:
  config.getExchangeRate ??
  ((ticker) => new ExchangeRateService().getRate(ticker as never)),
```
(The cast bridges the SDK port's `(ticker: string)` to `ExchangeRateService.getRate`'s `Ticker` param — the LightningAddressService only ever passes `${currency}-${currency}` tickers, so it is unviolatable, mirroring the app's existing `ticker as Ticker` cast.) Keep `getExchangeRate` optional in `ServerSdkConfig` (hosts may still override).

- [ ] **Step 2: Gate.** `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. ⛔ No `fix:all`.

- [ ] **Step 3: Commit.**

```bash
git add packages/wallet-sdk/src/server.ts
git commit -m "feat(wallet-sdk): server SDK defaults getExchangeRate to internal rates (base 6a)"
```

---

## Final: review

- [ ] **Holistic review.** Dispatch a reviewer over `git diff <6a-base>..HEAD`. Confirm: (1) the ported rates files are byte-for-byte vs the app originals (only their location changed); (2) no env/window/Sentry/@tanstack leaked into `packages/wallet-sdk/src/internal/rates`; (3) the app shims re-export the full surface its importers use (no dangling `~/lib/exchange-rate` imports — app typecheck proves it); (4) `RatesDomain` is dependency-free and attached as `sdk.rates`; (5) `Money.convert` rate-direction matches the app's usage; (6) gate green; (7) no `fix:all` pollution. Reviewer must NOT run `fix:all`.

- [ ] **Carry-forward note (for 6c):** `sdk.rates` is the rate source 6c's cross-account `receiveToken` path uses (replacing the app's `getExchangeRate(queryClient, ticker)`). 6c constructs its orchestrator with a `RatesDomain` (or the internal `ExchangeRateService`) dep.

## Self-Review (author checklist — completed)

**Spec coverage:** Rates extraction (decision: port ExchangeRateService into the SDK) → Tasks 2/4; `sdk.rates` public domain → Task 4; server-SDK rate default → Task 5; app keeps 15s polling via shims → Task 3.
**Placeholder scan:** no TBD; new files (RatesDomain, test) shown in full; moves specify verbatim + exact shim lines; commands have expected output.
**Type consistency:** `Ticker` (from `internal/rates/providers/types`), `Rate` (`domains/rates`), `RatesDomain.get/convert` signatures match the test + the Sdk wiring + the 6c carry-forward.
