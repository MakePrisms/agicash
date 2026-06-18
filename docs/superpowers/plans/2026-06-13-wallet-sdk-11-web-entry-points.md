# Wallet SDK — S11: Web cut-over ENTRY POINTS (`getSdk()` client singleton + `SdkConfig` assembly + `createServer()` server instance) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the web's SDK entry points **additively** — a browser `getSdk()` singleton + a server-mode `getServerSdk()` instance, each assembled from `import.meta.env` / `process.env` via pure, unit-testable `build*SdkConfig` functions — without flipping a single read/write or deleting any existing web code, so the web keeps working exactly as before while the SDK becomes reachable for S12+.

**Architecture:** Slice S11 of the no-cache full migration (spec §9 Phase 2, the FIRST cut-over slice). The web becomes a thin consumer of `@agicash/wallet-sdk` (workspace dep, added here). Client and server entries live in **separate modules** (`features/shared/sdk.ts` browser-only, `features/shared/sdk.server.ts` server-only) so server secrets and the `window`-touching browser client never cross into the wrong bundle — mirroring the existing `database.client.ts` / `database.server.ts` split. The env→`SdkConfig` mapping is a pure function with the env object **dependency-injected**, so the gate's web unit suite can verify the mapping hermetically (no Vite transform, no live OpenSecret session). Nothing consumes these entries from a component/route yet — that wiring is S12 (reads) / S14 (LN-address routes).

**Tech Stack:** Bun workspaces, React Router v7, TypeScript 5.9.3, `@agicash/wallet-sdk` (`Sdk.create` / `createServer` / `SdkConfig` / `MintBlocklistSchema`), `@agicash/opensecret` (`browserStorage`, `StorageProvider`), `bun:test` (web suite; root `./app`), biome.

---

## Scope boundary (read first)

**In scope (S11 — purely ADDITIVE, delete NOTHING):**
- Add `@agicash/wallet-sdk` as a `workspace:*` dependency of `apps/web-wallet` (+ `bun install` — **ASK FIRST**, it installs a dep).
- Re-export `MintBlocklistSchema` (value) + `MintBlocklist` (type) from the SDK public barrel (the consumer needs the schema to parse its env JSON; the `SdkConfig.cashuMintBlocklist` JSDoc points at it). Additive SDK change.
- `apps/web-wallet/app/features/shared/sdk.ts` (client): `buildClientSdkConfig({ lud16Domain, env? })` (pure) + `getSdk(lud16Domain)` (memoized `Promise<Sdk>` singleton).
- `apps/web-wallet/app/features/shared/sdk.server.ts` (server): an in-memory no-op `StorageProvider` + `buildServerSdkConfig({ lud16Domain, env?, processEnv? })` (pure) + `getServerSdk(lud16Domain)` (process-singleton `ServerSdk`).
- Web unit tests for both assemblers + a server `createServer` construction smoke test.

**Out of scope (later slices — do NOT do here):**
- **No read is flipped to `sdk.*`** (that is S12; the active-flow/per-quote bridge + `useSdkEventBridge` is S13). The existing `*-hooks` / repositories / services / realtime / task-processor stay fully intact and in use.
- **No component or route imports `getSdk()`/`getServerSdk()` yet.** S12 wires `getSdk()` into the read hooks; **S14** wires `getServerSdk()` into the three LN-address routes (`[.]well-known.lnurlp.$username.ts`, `api.lnurlp.callback.$userId.ts`, `api.lnurlp.verify.$encryptedQuoteData.ts`) and deletes `lightning-address-service.ts` + `database.server.ts`. The xchacha20poly1305 verify-token + LUD JSON wire format stay route-side (spec §6; S10/D10-3).
- **No deletions.** The S13 atomic orchestration flip (start `sdk.background` ⇄ delete the web task-processor/realtime) is where deletions happen (spec §8/§9). Running the web processor and `sdk.background` together = dual leaders / double melt-mint (real-money bug) — S11 must never start `sdk.background`.

---

## Decisions (locked — carry, do NOT re-litigate)

- **D11-1 — S11 is ENTRY-ONLY + additive; NO reads-flip (Fork B resolved).** The only session-free observable SDK read is `sdk.user.getCurrentUser() === null` (empty storage, no network — proven by SDK `sdk.test.ts:54`); flipping `authQueryOptions`' `queryFn` to the SDK buys **no extra unit-test signal** because the logged-in branch needs a live OpenSecret session (e2e/manual only — lands at the S12 checkpoint regardless). So S11 keeps the web on its own code and only stands up the entries + their pure assemblers + construction smoke tests.
- **D11-2 — Build the server `createServer()` instance NOW (Fork A resolved).** `createServer` is self-contained, network-free at construction (Breez connect is lazy), and on-spec (spec line 283 lists both `getSdk()` and `createServer()` under S11; only the *route flip* is S14). Standing up `getServerSdk()` additively is cheap, hermetically testable (throws on missing server config), and de-risks S14. Routes keep using `LightningAddressService`.
- **D11-3 — Separate client/server modules.** `sdk.ts` is browser-only (imports `browserStorage`, builds a client `Sdk` whose connections include the `window`-touching Supabase browser client). `sdk.server.ts` is server-only (reads `process.env` secrets — `SUPABASE_SERVICE_ROLE_KEY`, `LNURL_SERVER_SPARK_MNEMONIC` — that must never reach the browser bundle). Mirrors `database.client.ts`/`database.server.ts`. `sdk.server.ts` must NOT import `sdk.ts` (and vice-versa).
- **D11-4 — Pure assemblers with DI'd env, exported separately from the memoized getters.** `buildClientSdkConfig`/`buildServerSdkConfig` take the env as a parameter (default = a `readClientEnv()`/`readServerEnv()` that reads each `import.meta.env.VITE_X` / `process.env.X` **directly**, so Vite statically inlines + `process.env` resolves at runtime). Tests inject a plain fake env object → fully hermetic, with **no** reliance on bun's `import.meta.env`↔`process.env` proxy behaviour (unreliable for runtime mutation). This is the key that makes the env→config mapping unit-testable in the web suite.
- **D11-5 — `lud16Domain` is INJECTED, not env-read; getters memoize on first call.** The web derives `lud16Domain` from the root loader's canonical-origin host (`root.tsx`: `new URL(getCanonicalOrigin(url.origin)).host`, Vercel-aware), NOT from an env var — a module-level singleton can't read it at import. So `getSdk(lud16Domain)` / `getServerSdk(lud16Domain)` take it as an argument and memoize on the first call (the value is stable per session / per prod origin). S12 will pass the client domain from `useRouteLoaderData('root').domain`; S14 will pass the server domain from the request origin.
- **D11-6 — Server `storage` = in-memory no-op `StorageProvider`.** `SdkConfig.storage` is type-required even in server mode, but `buildServerConnections` never reads it (it builds no OpenSecret client) and `browserStorage`'s getters touch `window` (absent server-side). Supply a tiny Map-backed `{ persistent, session }` in `sdk.server.ts`.
- **D11-7 — Client `getSdk()` caches a `Promise<Sdk>` (not the resolved instance).** `Sdk.create` is async; caching the promise (mirroring `query-client.ts`'s `let browserQueryClient | undefined` guard) prevents a second client from being constructed if React suspends mid-render — which would re-run OpenSecret `configure()` and rebuild connections.
- **D11-8 — Default accounts are owned by `sdk.ts` (SDK-shaped), not imported from the web.** `buildClientSdkConfig` defines the SDK-shaped `DefaultAccountConfig[]` inline (BTC spark always; dev-mode adds the two testnut cashu accounts), stripping the web const's extra `expiresAt: null` field (not in the SDK type). Forward-correct: the web's `defaultAccounts` const (`user-hooks.tsx`) is dead post-S15 and removed in cleanup. Transient duplication on the branch is expected (spec §9).
- **D11-9 — Keep the existing `entry.client.tsx` `configure()` call.** Constructing a client `Sdk` re-runs OpenSecret `configure()` (same `apiUrl`/`clientId`/`browserStorage` → harmless no-op). S11 is additive; the redundant web-side `configure()` is removed at S13 when the SDK owns the lifecycle. Do not touch `entry.client.tsx`.
- **CI gate (EXPANDED, Phase 2 — see Global Constraints):** `bun run fix:all` **+** `bun run typecheck` **+** the web unit suite **+** the SDK unit suite (Task 1 touches the SDK barrel). `fix:all` is biome-only and does **not** typecheck. (test:e2e + manual money-path checks come at the S13/S14 gate — spec §10 — ask before running.)

---

## Global Constraints

- **Additive only — delete nothing.** The web must keep building and behaving identically; the SDK entries are reachable but unconsumed by components/routes until S12/S14.
- **`fix:all` ≠ typecheck.** `bun run fix:all` = `biome check --write --verbose` (lint+format autofix ONLY). The slice gate MUST also run `bun run typecheck` (= `bun --filter='*' run typecheck`; web = `react-router typegen && tsc`, sdk = `tsc`).
- **Suites are per-workspace, run on `bun test`.** Web suite: `bun --filter=web-wallet run test` (`bunfig.toml` pins `[test] root = "./app"` → new web tests MUST live under `app/`). SDK suite: `bun --filter=@agicash/wallet-sdk run test`. No vitest, no jsdom.
- **Errors:** `SdkError`/`DomainError`/`NotFoundError` take `(message, code)`; `NotImplementedError(method)`. (S11 itself throws no SDK errors — it only assembles config.)
- **One git commit per task** (`feat(web): …` for web tasks, `feat(wallet-sdk): …` for the SDK barrel task). **Do not push.** The worktree is harness-owned (`.claude/worktrees/…`) — do NOT `git worktree remove` it. Ignore/`rm` the untracked `sdd/` scratch dir if present.
- **Installing a dependency requires asking first** (autonomy rules): Task 2's `bun install` for the new `workspace:*` dep must be approved by the user before running.
- bun/bunx only. `master` is the default branch. Branch: `sdk-nocache/full-migration` (S10 tip `6cb24311`).

---

## Grounding facts (verified 2026-06-18 — authoritative; see memory `project-wallet-sdk-s11-grounding`)

**Published SDK surface (reuse as-is):**
- `Sdk.create(config: SdkConfig): Promise<Sdk>` — static async; `buildConnections(config)` (calls OpenSecret `configure()` as a global side-effect, NO network) then `new Sdk(...)`; ctor `protected`. Does NOT start background.
- `createServer(config: SdkConfig): ServerSdk` — **synchronous**, network-free at construction (Breez connect lazy). Throws eagerly: missing `supabase.serviceRoleKey` FIRST (`'createServerClient requires supabase.serviceRoleKey'`), then missing `serverSparkMnemonic` (`'createServer requires config.serverSparkMnemonic'`).
- `SdkConfig` (`packages/wallet-sdk/src/config.ts:45-110`) required: `openSecret{url,clientId}`, `supabase{url,anonKey}`, `storage: StorageProvider`, `lud16Domain`. Optional: `supabase.serviceRoleKey`, `serverSparkMnemonic`, `breezApiKey`, `sparkStorageDir`, `debugLoggingSpark`, `allowLocalhostLightningAddress`, `defaultAccounts`, `cashuMintBlocklist`, `clientId`.
- `DefaultAccountConfig` (config.ts:21-38) spark = `{ type:'spark'; currency:'BTC'; name; network: SparkNetwork; purpose: AccountPurpose; isDefault }`; cashu = `{ type:'cashu'; currency: Currency; name; mintUrl; isTestMint; purpose; isDefault }`. **No `expiresAt` field.**
- Barrel (`packages/wallet-sdk/src/index.ts`) VALUE exports: `Sdk`, `createServer`, `ServerSdk`, `Money`, the 5 error classes, `classify`. Re-exports `StorageProvider` (type) from `@agicash/opensecret`. **Does NOT export `MintBlocklistSchema`/`MintBlocklist` (Task 1 adds them) nor `browserStorage`.**
- `MintBlocklistSchema` (internal `internal/lib/cashu/mint-validation.ts`, zod/mini): `z.array(z.object({ mintUrl: z.url(), unit: z.nullable(z.enum(CASHU_PROTOCOL_UNITS)) }))` → `{ mintUrl: string; unit: <cashu-unit> | null }[]`. `config.ts:10` already imports `MintBlocklist` from this path.

**OpenSecret rc (`@agicash/opensecret@1.0.0-rc.0`, catalog dep, already a web dep):**
- `StorageProvider = { persistent: KeyValueStore; session: KeyValueStore }`; `KeyValueStore = { getItem(k): string|null|Promise<string|null>; setItem(k,v): void|Promise<void>; removeItem(k): void|Promise<void> }`.
- `browserStorage: StorageProvider` exported directly from `@agicash/opensecret` (lazy getters → `window.localStorage`/`sessionStorage`). The web already imports it in `entry.client.tsx:1`.

**Web current shapes (file:line):**
- `features/shared/sdk.ts` does NOT exist (S11 creates it). `features/shared/sdk.server.ts` does NOT exist.
- Client singleton pattern to mirror — `features/shared/query-client.ts`:
  ```ts
  let browserQueryClient: QueryClient | undefined = undefined;
  export function getQueryClient() {
    if (isServer) return makeQueryClient();
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
  ```
- Server singleton precedent — `features/agicash-db/database.server.ts`: module const reading `import.meta.env.VITE_SUPABASE_URL` + `process.env.SUPABASE_SERVICE_ROLE_KEY`.
- Web `defaultAccounts` (`features/user/user-hooks.tsx:114`): one MAINNET BTC spark (`isDefault:true, purpose:'transactional'`) + (when `import.meta.env.MODE === 'development'`) two testnut cashu accounts (`https://testnut.cashu.space`, BTC `isDefault:false` + USD `isDefault:true`). **Each entry carries `expiresAt: null`** (not in the SDK type → strip).
- Env reads (all VITE_ keys below are already read elsewhere in the web, so they typecheck): `VITE_OPEN_SECRET_API_URL`/`_CLIENT_ID` (entry.client.tsx:23,28), `VITE_SUPABASE_URL`/`_ANON_KEY` (database.client.ts:7,29), `VITE_BREEZ_API_KEY` (spark.ts:23), `VITE_CASHU_MINT_BLOCKLIST` (cashu.ts:167, parsed `MintBlocklistSchema.parse(JSON.parse(... ?? '[]'))`), `import.meta.env.MODE === 'development'` (classify-input.ts:7). Server secrets via `process.env`: `SUPABASE_SERVICE_ROLE_KEY` (database.server.ts:9), `LNURL_SERVER_SPARK_MNEMONIC` (lightning-address-service.ts:33).
- `debugLoggingSpark` is a DB feature flag (NOT env) → leave `undefined` in S11.
- Web package.json LACKS `@agicash/wallet-sdk` (has `@agicash/money: workspace:*`, `@agicash/opensecret: catalog:`). SDK exports `"." → "./src/index.ts"` (raw TS; Vite/tsc consume source).

**Test/gate (verified):** root `fix:all` = `biome check --write --verbose` (no typecheck); root `typecheck` = `bun --filter='*' run typecheck`; root `test` = `bun --filter='*' run test`. Web `typecheck` = `react-router typegen && tsc`, `test` = `bun test`. SDK name `@agicash/wallet-sdk`, `test`/`typecheck` from `packages/wallet-sdk/`.

---

## File Structure

**Created:**
- `apps/web-wallet/app/features/shared/sdk.ts` — client entry: `ClientSdkEnv`, `readClientEnv`, `buildClientSdkConfig`, `getSdk`.
- `apps/web-wallet/app/features/shared/sdk.test.ts` — `buildClientSdkConfig` assembler tests (bun:test).
- `apps/web-wallet/app/features/shared/sdk.server.ts` — server entry: in-memory `StorageProvider`, `ServerSdkEnv`, `readServerEnv`, `buildServerSdkConfig`, `getServerSdk`.
- `apps/web-wallet/app/features/shared/sdk.server.test.ts` — `buildServerSdkConfig` + `createServer` construction smoke tests.

**Modified:**
- `packages/wallet-sdk/src/index.ts` — re-export `MintBlocklistSchema` (value) + `MintBlocklist` (type).
- `packages/wallet-sdk/src/index.test.ts` — append a barrel smoke assertion for `MintBlocklistSchema`.
- `apps/web-wallet/package.json` — add `"@agicash/wallet-sdk": "workspace:*"` to `dependencies`.

**Not touched:** every existing web repository/service/hook/realtime/task-processor; `entry.client.tsx`; `database.client.ts`/`database.server.ts`; the LN-address routes; the web's `defaultAccounts` const; the SDK `sdk.ts`/`server-sdk.ts`.

---

## Task 1: Re-export `MintBlocklistSchema` + `MintBlocklist` from the SDK barrel

**Files:**
- Modify: `packages/wallet-sdk/src/index.ts`
- Modify: `packages/wallet-sdk/src/index.test.ts`

**Interfaces:**
- Produces: `export { MintBlocklistSchema }` (zod/mini value) + `export type { MintBlocklist }` from `@agicash/wallet-sdk`. The web client assembler (Task 2) consumes both to parse `VITE_CASHU_MINT_BLOCKLIST` into `SdkConfig.cashuMintBlocklist`.

- [ ] **Step 1: Write the failing test** — append to `packages/wallet-sdk/src/index.test.ts` (it exists from Plan 10 Task 9; if absent, create it with the `import * as sdk from './index'` header):

```ts
describe('public barrel — cashu mint blocklist', () => {
  it('re-exports MintBlocklistSchema (value) so consumers can parse their env JSON', () => {
    expect(typeof sdk.MintBlocklistSchema).toBe('object'); // a zod/mini schema object
    const parsed = sdk.MintBlocklistSchema.parse([
      { mintUrl: 'https://mint.example.com', unit: null },
    ]);
    expect(parsed).toEqual([{ mintUrl: 'https://mint.example.com', unit: null }]);
  });
});
```

> Confirm the existing file already does `import * as sdk from './index'` (Plan 10's `createServer` barrel test). Reuse that import; just add the `describe` block. If `MintBlocklistSchema.parse` rejects the fixture, re-read `internal/lib/cashu/mint-validation.ts` for the exact field names/enum and adjust the fixture to a valid value — do not change the schema.

- [ ] **Step 2: Run it; expect FAIL** — `cd packages/wallet-sdk && bun test src/index.test.ts -t "mint blocklist"`. Expected: FAIL (`sdk.MintBlocklistSchema` is `undefined`).

- [ ] **Step 3: Add the barrel exports** — in `packages/wallet-sdk/src/index.ts`, add a block adjacent to the cashu type exports (after the `// --- cashu (§5) ---` block):

```ts
// --- cashu mint blocklist (config helper) ----------------------------------
// Re-exported so the consumer can Zod-parse its env JSON before assembling
// `SdkConfig.cashuMintBlocklist` (the SdkConfig JSDoc points the consumer here).
export { MintBlocklistSchema } from './internal/lib/cashu/mint-validation';
export type { MintBlocklist } from './internal/lib/cashu/mint-validation';
```

> Match the file's existing export style (named `export {…} from`, with `export type` for types). The path `./internal/lib/cashu/mint-validation` is confirmed by `config.ts:10`'s existing `import type { MintBlocklist }` from it. `MintBlocklistSchema` is a value (zod/mini schema) — use `export {…}`, not `export type`.

- [ ] **Step 4: Run it; expect PASS** — `cd packages/wallet-sdk && bun test src/index.test.ts`. Expected: all pass (incl. the existing `createServer` barrel test).

- [ ] **Step 5: Gate + commit**

```bash
bun run fix:all
cd packages/wallet-sdk && bun run typecheck && bun run test && cd ../..
git add packages/wallet-sdk/src/index.ts packages/wallet-sdk/src/index.test.ts
git commit -m "$(cat <<'EOF'
feat(wallet-sdk): re-export MintBlocklistSchema + MintBlocklist from the barrel

The web consumer (S11 getSdk config assembly) needs MintBlocklistSchema to
Zod-parse VITE_CASHU_MINT_BLOCKLIST before passing SdkConfig.cashuMintBlocklist
(the SdkConfig JSDoc already points here). Additive barrel export; no behaviour
change. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Add the `@agicash/wallet-sdk` workspace dep + the CLIENT entry (`sdk.ts`)

**Files:**
- Modify: `apps/web-wallet/package.json`
- Create: `apps/web-wallet/app/features/shared/sdk.ts`
- Create: `apps/web-wallet/app/features/shared/sdk.test.ts`

**Interfaces:**
- Consumes: `Sdk`, `SdkConfig`, `DefaultAccountConfig`, `MintBlocklist`, `MintBlocklistSchema` from `@agicash/wallet-sdk` (Task 1); `browserStorage` from `@agicash/opensecret`.
- Produces: `export type ClientSdkEnv`; `export function buildClientSdkConfig(params: { lud16Domain: string; env?: ClientSdkEnv }): SdkConfig`; `export function getSdk(lud16Domain: string): Promise<Sdk>`. S12 will call `getSdk(domain)` from the read hooks.

- [ ] **Step 1: Add the workspace dependency (ASK FIRST before `bun install`)** — in `apps/web-wallet/package.json` `dependencies`, add alongside `@agicash/money`:

```jsonc
"@agicash/wallet-sdk": "workspace:*",
```

Then **ask the user to approve installing the dependency**, and run:

```bash
bun install
```

> A `workspace:*` dep is a local symlink (same as the existing `@agicash/money`). Per the autonomy rules, installing a dependency is ask-first — surface this to the orchestrator before running `bun install`. Do not proceed to Step 2 until the install succeeds (otherwise the `@agicash/wallet-sdk` import won't resolve).

- [ ] **Step 2: Write the failing test** — `apps/web-wallet/app/features/shared/sdk.test.ts`. Inject a fake `env` object (hermetic — no `import.meta.env`, no `window`):

```ts
import { describe, expect, test } from 'bun:test';
import { browserStorage } from '@agicash/opensecret';
import { type ClientSdkEnv, buildClientSdkConfig } from './sdk';

const baseEnv: ClientSdkEnv = {
  VITE_OPEN_SECRET_API_URL: 'https://os.test',
  VITE_OPEN_SECRET_CLIENT_ID: 'os-client',
  VITE_SUPABASE_URL: 'https://x.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_BREEZ_API_KEY: 'breez-key',
  VITE_CASHU_MINT_BLOCKLIST: '[]',
  MODE: 'production',
};

describe('buildClientSdkConfig', () => {
  test('maps the browser env into a client SdkConfig (no service-role, no server mnemonic)', () => {
    const cfg = buildClientSdkConfig({ lud16Domain: 'agi.cash', env: baseEnv });

    expect(cfg.openSecret).toEqual({ url: 'https://os.test', clientId: 'os-client' });
    expect(cfg.supabase).toEqual({ url: 'https://x.supabase.co', anonKey: 'anon-key' });
    expect(cfg.supabase.serviceRoleKey).toBeUndefined();
    expect(cfg.serverSparkMnemonic).toBeUndefined();
    expect(cfg.breezApiKey).toBe('breez-key');
    expect(cfg.lud16Domain).toBe('agi.cash');
    expect(cfg.sparkStorageDir).toBe('./.spark-data');
    // by reference only — do NOT touch the getters (no window under bun test):
    expect(cfg.storage).toBe(browserStorage);
    expect(cfg.allowLocalhostLightningAddress).toBe(false);
  });

  test('parses VITE_CASHU_MINT_BLOCKLIST into the {mintUrl,unit}[] shape', () => {
    const cfg = buildClientSdkConfig({
      lud16Domain: 'agi.cash',
      env: { ...baseEnv, VITE_CASHU_MINT_BLOCKLIST: JSON.stringify([{ mintUrl: 'https://bad.mint', unit: null }]) },
    });
    expect(cfg.cashuMintBlocklist).toEqual([{ mintUrl: 'https://bad.mint', unit: null }]);
  });

  test('production mode → only the BTC spark default account; no expiresAt leaks through', () => {
    const cfg = buildClientSdkConfig({ lud16Domain: 'agi.cash', env: { ...baseEnv, MODE: 'production' } });
    expect(cfg.defaultAccounts).toEqual([
      { type: 'spark', currency: 'BTC', name: 'Bitcoin', network: 'MAINNET', isDefault: true, purpose: 'transactional' },
    ]);
    expect('expiresAt' in (cfg.defaultAccounts?.[0] ?? {})).toBe(false);
  });

  test('development mode → adds the two testnut cashu accounts + allowLocalhost', () => {
    const cfg = buildClientSdkConfig({ lud16Domain: 'agi.cash', env: { ...baseEnv, MODE: 'development' } });
    expect(cfg.defaultAccounts).toHaveLength(3);
    expect(cfg.allowLocalhostLightningAddress).toBe(true);
    expect(cfg.defaultAccounts?.filter((a) => a.type === 'cashu')).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run it; expect FAIL** — `bun --filter=web-wallet run test sdk.test.ts` (or from `apps/web-wallet`: `bun test app/features/shared/sdk.test.ts`). Expected: FAIL (`./sdk` module not found).

- [ ] **Step 4: Implement** — `apps/web-wallet/app/features/shared/sdk.ts`:

```ts
import { browserStorage } from '@agicash/opensecret';
import {
  type DefaultAccountConfig,
  type MintBlocklist,
  MintBlocklistSchema,
  Sdk,
  type SdkConfig,
} from '@agicash/wallet-sdk';

/** The client-relevant env vars (each read directly so Vite can statically inline it). */
export type ClientSdkEnv = {
  VITE_OPEN_SECRET_API_URL?: string;
  VITE_OPEN_SECRET_CLIENT_ID?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_BREEZ_API_KEY?: string;
  VITE_CASHU_MINT_BLOCKLIST?: string;
  MODE?: string;
};

function readClientEnv(): ClientSdkEnv {
  return {
    VITE_OPEN_SECRET_API_URL: import.meta.env.VITE_OPEN_SECRET_API_URL,
    VITE_OPEN_SECRET_CLIENT_ID: import.meta.env.VITE_OPEN_SECRET_CLIENT_ID,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_BREEZ_API_KEY: import.meta.env.VITE_BREEZ_API_KEY,
    VITE_CASHU_MINT_BLOCKLIST: import.meta.env.VITE_CASHU_MINT_BLOCKLIST,
    MODE: import.meta.env.MODE,
  };
}

function parseMintBlocklist(raw: string | undefined): MintBlocklist {
  return MintBlocklistSchema.parse(JSON.parse(raw ?? '[]'));
}

function buildDefaultAccounts(isDevelopment: boolean): DefaultAccountConfig[] {
  const accounts: DefaultAccountConfig[] = [
    {
      type: 'spark',
      currency: 'BTC',
      name: 'Bitcoin',
      network: 'MAINNET',
      isDefault: true,
      purpose: 'transactional',
    },
  ];
  if (isDevelopment) {
    accounts.push(
      {
        type: 'cashu',
        currency: 'BTC',
        name: 'Testnut BTC',
        mintUrl: 'https://testnut.cashu.space',
        isTestMint: true,
        isDefault: false,
        purpose: 'transactional',
      },
      {
        type: 'cashu',
        currency: 'USD',
        name: 'Testnut USD',
        mintUrl: 'https://testnut.cashu.space',
        isTestMint: true,
        isDefault: true,
        purpose: 'transactional',
      },
    );
  }
  return accounts;
}

/**
 * Assemble the client-mode SdkConfig from the browser env. `lud16Domain` is
 * supplied by the caller (the web derives it from the root loader's canonical
 * origin host — it is NOT an env var). `env` is injectable for testing.
 */
export function buildClientSdkConfig({
  lud16Domain,
  env = readClientEnv(),
}: {
  lud16Domain: string;
  env?: ClientSdkEnv;
}): SdkConfig {
  const isDevelopment = env.MODE === 'development';
  return {
    openSecret: {
      url: env.VITE_OPEN_SECRET_API_URL ?? '',
      clientId: env.VITE_OPEN_SECRET_CLIENT_ID ?? '',
    },
    supabase: {
      url: env.VITE_SUPABASE_URL ?? '',
      anonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
    },
    breezApiKey: env.VITE_BREEZ_API_KEY,
    sparkStorageDir: './.spark-data',
    allowLocalhostLightningAddress: isDevelopment,
    storage: browserStorage,
    defaultAccounts: buildDefaultAccounts(isDevelopment),
    cashuMintBlocklist: parseMintBlocklist(env.VITE_CASHU_MINT_BLOCKLIST),
    lud16Domain,
  };
}

let clientSdk: Promise<Sdk> | undefined;

/**
 * The browser-singleton SDK. Caches the `Promise<Sdk>` (not the resolved
 * instance) so a React-suspense re-render doesn't construct a second client
 * (which would re-run OpenSecret `configure()` and rebuild connections).
 * `lud16Domain` is read on the first call (stable per session); later calls
 * return the cached promise.
 */
export function getSdk(lud16Domain: string): Promise<Sdk> {
  if (!clientSdk) {
    clientSdk = Sdk.create(buildClientSdkConfig({ lud16Domain }));
  }
  return clientSdk;
}
```

> `buildClientSdkConfig` reads env only via the injected `env` param (default `readClientEnv()`), and `readClientEnv` is the only place that touches `import.meta.env` — keep these reads as direct `import.meta.env.VITE_X` member accesses so Vite inlines them at build. Do NOT read env at module top-level (the test must control it). The test never calls `getSdk()` (that would touch `browserStorage`'s `window` getters under bun test). Every `VITE_*` key here is already read elsewhere in the web, so the web `tsc` resolves their `ImportMetaEnv` types — if typecheck flags an unknown key, re-check it against the existing web reads listed in Grounding facts.

- [ ] **Step 5: Run it; expect PASS** — `bun --filter=web-wallet run test sdk.test.ts`. Expected: 4 pass.

- [ ] **Step 6: Gate + commit**

```bash
bun run fix:all
bun --filter=web-wallet run typecheck
bun --filter=web-wallet run test
git add apps/web-wallet/package.json apps/web-wallet/app/features/shared/sdk.ts apps/web-wallet/app/features/shared/sdk.test.ts
# (bun.lock / node_modules changes from the install ride along — add bun.lock if tracked)
git add bun.lock 2>/dev/null || true
git commit -m "$(cat <<'EOF'
feat(web): client SDK entry point (getSdk singleton + buildClientSdkConfig)

Add @agicash/wallet-sdk as a workspace dep and stand up the browser SDK entry
ADDITIVELY: a pure buildClientSdkConfig(import.meta.env -> SdkConfig) assembler
(DI'd env for testing) + a memoized getSdk(lud16Domain) Promise<Sdk> singleton.
Nothing consumes it yet (S12 flips reads). Web unchanged otherwise. Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: The SERVER entry (`sdk.server.ts`) + `createServer` construction smoke

**Files:**
- Create: `apps/web-wallet/app/features/shared/sdk.server.ts`
- Create: `apps/web-wallet/app/features/shared/sdk.server.test.ts`

**Interfaces:**
- Consumes: `createServer`, `ServerSdk`, `SdkConfig`, `StorageProvider` from `@agicash/wallet-sdk`.
- Produces: `export type ServerSdkEnv`; `export function buildServerSdkConfig(params: { lud16Domain: string; env?: ServerSdkEnv; processEnv?: Record<string, string | undefined> }): SdkConfig`; `export function getServerSdk(lud16Domain: string): ServerSdk`. S14 will call `getServerSdk(domain)` from the LN-address routes.

- [ ] **Step 1: Write the failing test** — `apps/web-wallet/app/features/shared/sdk.server.test.ts` (inject both `env` and `processEnv` — hermetic, network-free):

```ts
import { describe, expect, test } from 'bun:test';
import { ServerSdk, createServer } from '@agicash/wallet-sdk';
import { type ServerSdkEnv, buildServerSdkConfig } from './sdk.server';

const baseEnv: ServerSdkEnv = {
  VITE_OPEN_SECRET_API_URL: 'https://os.test',
  VITE_OPEN_SECRET_CLIENT_ID: 'os-client',
  VITE_SUPABASE_URL: 'https://x.supabase.co',
  VITE_SUPABASE_ANON_KEY: 'anon-key',
  VITE_BREEZ_API_KEY: 'breez-key',
};

const TEST_MNEMONIC =
  'test test test test test test test test test test test junk';
const serverSecrets = {
  SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key',
  LNURL_SERVER_SPARK_MNEMONIC: TEST_MNEMONIC,
};

describe('buildServerSdkConfig', () => {
  test('maps VITE env + process secrets into a server SdkConfig', () => {
    const cfg = buildServerSdkConfig({ lud16Domain: 'agi.cash', env: baseEnv, processEnv: serverSecrets });
    expect(cfg.supabase.serviceRoleKey).toBe('svc-role-key');
    expect(cfg.serverSparkMnemonic).toBe(TEST_MNEMONIC);
    expect(cfg.sparkStorageDir).toBe('/tmp/.spark-data');
    expect(cfg.lud16Domain).toBe('agi.cash');
    // a usable (no-op) StorageProvider — never read server-side, but type-required:
    expect(cfg.storage.persistent.getItem('missing')).toBeNull();
  });
});

describe('createServer construction (server entry smoke)', () => {
  test('builds a ServerSdk from a valid server config (sync, network-free)', () => {
    const sdk = createServer(buildServerSdkConfig({ lud16Domain: 'agi.cash', env: baseEnv, processEnv: serverSecrets }));
    expect(sdk).toBeInstanceOf(ServerSdk);
  });

  test('throws without serverSparkMnemonic', () => {
    expect(() =>
      createServer(buildServerSdkConfig({
        lud16Domain: 'agi.cash',
        env: baseEnv,
        processEnv: { SUPABASE_SERVICE_ROLE_KEY: 'svc-role-key' },
      })),
    ).toThrow('serverSparkMnemonic');
  });

  test('throws without serviceRoleKey', () => {
    expect(() =>
      createServer(buildServerSdkConfig({
        lud16Domain: 'agi.cash',
        env: baseEnv,
        processEnv: { LNURL_SERVER_SPARK_MNEMONIC: TEST_MNEMONIC },
      })),
    ).toThrow('serviceRoleKey');
  });
});
```

> `createServer` is sync + network-free at construction (Breez connect is lazy), so constructing it in a unit test is hermetic. The throw order is `serviceRoleKey` first (inside `createServerClient`), then `serverSparkMnemonic` — so the "without serverSparkMnemonic" case must still supply `serviceRoleKey` (it does). Do NOT call any method on the returned `ServerSdk` (that would init Breez WASM / hit the network).

- [ ] **Step 2: Run it; expect FAIL** — `bun --filter=web-wallet run test sdk.server.test.ts`. Expected: FAIL (`./sdk.server` not found).

- [ ] **Step 3: Implement** — `apps/web-wallet/app/features/shared/sdk.server.ts`:

```ts
import {
  type SdkConfig,
  ServerSdk,
  type StorageProvider,
  createServer,
} from '@agicash/wallet-sdk';

/**
 * A no-op in-memory StorageProvider. Server mode (`createServer`) never reads
 * `storage` (it builds no OpenSecret client), but `SdkConfig.storage` is
 * type-required and `browserStorage` touches `window` (absent server-side).
 */
function createMemoryStorageProvider(): StorageProvider {
  const makeStore = () => {
    const map = new Map<string, string>();
    return {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    };
  };
  return { persistent: makeStore(), session: makeStore() };
}

/** The server-relevant VITE env vars (read directly so Vite can inline them, server-side too). */
export type ServerSdkEnv = {
  VITE_OPEN_SECRET_API_URL?: string;
  VITE_OPEN_SECRET_CLIENT_ID?: string;
  VITE_SUPABASE_URL?: string;
  VITE_SUPABASE_ANON_KEY?: string;
  VITE_BREEZ_API_KEY?: string;
};

function readServerEnv(): ServerSdkEnv {
  return {
    VITE_OPEN_SECRET_API_URL: import.meta.env.VITE_OPEN_SECRET_API_URL,
    VITE_OPEN_SECRET_CLIENT_ID: import.meta.env.VITE_OPEN_SECRET_CLIENT_ID,
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
    VITE_BREEZ_API_KEY: import.meta.env.VITE_BREEZ_API_KEY,
  };
}

/**
 * Assemble the server-mode SdkConfig. Public Supabase/OpenSecret params come
 * from import.meta.env (Vite inlines them server-side too); the server secrets
 * (`serviceRoleKey`, `serverSparkMnemonic`) come from process.env and MUST never
 * reach the browser bundle (this is a `.server.ts`). `env`/`processEnv` are
 * injectable for testing.
 */
export function buildServerSdkConfig({
  lud16Domain,
  env = readServerEnv(),
  processEnv = process.env,
}: {
  lud16Domain: string;
  env?: ServerSdkEnv;
  processEnv?: Record<string, string | undefined>;
}): SdkConfig {
  return {
    openSecret: {
      url: env.VITE_OPEN_SECRET_API_URL ?? '',
      clientId: env.VITE_OPEN_SECRET_CLIENT_ID ?? '',
    },
    supabase: {
      url: env.VITE_SUPABASE_URL ?? '',
      anonKey: env.VITE_SUPABASE_ANON_KEY ?? '',
      serviceRoleKey: processEnv.SUPABASE_SERVICE_ROLE_KEY,
    },
    breezApiKey: env.VITE_BREEZ_API_KEY,
    sparkStorageDir: '/tmp/.spark-data',
    storage: createMemoryStorageProvider(),
    lud16Domain,
    serverSparkMnemonic: processEnv.LNURL_SERVER_SPARK_MNEMONIC,
  };
}

let serverSdk: ServerSdk | undefined;

/**
 * The process-singleton server-mode SDK (warm Breez wallet reused across
 * requests). Memoized on the first call's `lud16Domain` (stable per origin in
 * prod). Consumed by the Lightning-Address routes in S14.
 */
export function getServerSdk(lud16Domain: string): ServerSdk {
  if (!serverSdk) {
    serverSdk = createServer(buildServerSdkConfig({ lud16Domain }));
  }
  return serverSdk;
}
```

> `process.env` is typed `Record<string, string | undefined>`-compatible, so the default `processEnv = process.env` typechecks. Read `import.meta.env` only inside `readServerEnv` (direct member access so Vite inlines, server-side included — proven by `database.server.ts:4`). `getServerSdk` is a thin memoized wrapper over the tested `buildServerSdkConfig` + `createServer`; it is intentionally NOT unit-tested (it requires real `process.env` secrets and caches a module singleton) — typecheck covers its shape.

- [ ] **Step 4: Run it; expect PASS** — `bun --filter=web-wallet run test sdk.server.test.ts`. Expected: 4 pass.

- [ ] **Step 5: Gate + commit**

```bash
bun run fix:all
bun --filter=web-wallet run typecheck
bun --filter=web-wallet run test
git add apps/web-wallet/app/features/shared/sdk.server.ts apps/web-wallet/app/features/shared/sdk.server.test.ts
git commit -m "$(cat <<'EOF'
feat(web): server-mode SDK entry point (getServerSdk + buildServerSdkConfig)

Stand up the server createServer() instance ADDITIVELY in a server-only module:
a pure buildServerSdkConfig (VITE env + process.env secrets -> SdkConfig, DI'd
for testing) with an in-memory no-op StorageProvider, plus a memoized
getServerSdk(lud16Domain) process singleton. createServer construction smoke
test covers build + throw-on-missing-server-config. Routes still use the
existing LightningAddressService (S14 flips them). Gate green.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Whole-slice gate + plan-of-plans + memory + carryover

**Files:**
- Modify: `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`
- Docs/memory only otherwise.

- [ ] **Step 1: Whole-slice gate (the expanded Phase-2 gate)** — from the worktree root:

```bash
bun run fix:all          # biome lint+format (NOT typecheck)
bun run typecheck        # all workspaces: web = react-router typegen && tsc; sdk = tsc
bun --filter=web-wallet run test
bun --filter=@agicash/wallet-sdk run test
```
Expected: all green. The web suite count rose by the two new test files (Tasks 2+3 = 8 tests); the SDK suite count rose by 1 (Task 1).

- [ ] **Step 2: Confirm additive / nothing deleted / web intact**

```bash
git status --short    # only NEW files + the 3 modified (package.json, index.ts, index.test.ts) + bun.lock
git diff --stat master -- apps/web-wallet/app | grep -v 'features/shared/sdk' || echo "OK: no other web app files changed"
git grep -n "sdk.background.start" apps/web-wallet/app || echo "OK: background NOT started in S11"
git grep -nl "getSdk\|getServerSdk" apps/web-wallet/app/routes apps/web-wallet/app/features | grep -v 'shared/sdk' || echo "OK: no component/route consumes the entries yet (S12/S14)"
```
Expected: the only `apps/web-wallet/app` changes are the four `features/shared/sdk*` files; `sdk.background.start` appears nowhere; nothing consumes `getSdk`/`getServerSdk` outside their own modules.

- [ ] **Step 3: Update the plan-of-plans index** — flip the Plan 11 row. In `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`, change the `| 11 | S11–S15 | … | not written |` row to reflect S11 done + the remaining S12–S15, and append the carryover block below.

- [ ] **Step 4: Commit the docs**

```bash
git add docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md docs/superpowers/plans/2026-06-13-wallet-sdk-11-web-entry-points.md
git commit -m "docs(wallet-sdk): record S11 (web entry points) done + S12/S13/S14 carryover"
```

- [ ] **Step 5: Update the `project-wallet-sdk-nocache-track` memory** — Phase 2 started; S11 done (entry points live, additive); next = S12 reads-flip. Note the gate now = `fix:all` + `typecheck` + web suite + SDK suite.

**Carryover to record (S11 → S12 / S13 / S14):**
- **(S12 reads)** Flip each web read `queryFn` to `sdk.*`, threading `getSdk(domain)` where `domain = useRouteLoaderData('root').domain`. The safest first canary is `authQueryOptions` → `sdk.user.getCurrentUser()` (null ⇒ `{isLoggedIn:false}`; a user ⇒ `{isLoggedIn:true,user}`); the logged-in branch is only provable via e2e/manual (needs a live OpenSecret session). `useUser`/`useAccounts` require an already-resolved `user.id` so they flip after auth-state. Web realtime still drives reactivity through S12 (checkpoint: app works on SDK reads).
- **(S13 atomic flip — real-money guardrail)** Mount the one `useSdkEventBridge(queryClient)`, flip the write mutations, AND in the SAME step call `sdk.background.start()` on sign-in / `stop()` on sign-out while DELETING the web TaskProcessor + `useTakeTaskProcessingLead` + `use-track-wallet-changes` + all `*ChangeHandlers` + the web realtime wiring. Never run the web processor and `sdk.background` together (dual leaders / double melt-mint — spec §8). `getSdk()` already caches a `Promise<Sdk>`; `background.start/stop` are auth-lifecycle only (D10). At S13 also remove the now-redundant `entry.client.tsx` `configure()` (the SDK owns it).
- **(S14 server routes)** Wire the three LN-address routes to `getServerSdk(domain)` (domain from the request origin host, Vercel-aware — match `root.tsx`'s `getCanonicalOrigin` precedence so the spark `descriptionHash`/LUD-16 `metadata` invariant holds — S10 carryover). The routes keep the LUD JSON wire format + the `LNURL_SERVER_ENCRYPTION_KEY` xchacha verify-token (operating on the SDK's structured `LnurlVerifyRef`). Delete `lightning-address-service.ts` + `database.server.ts` in that step. The `getServerSdk` singleton freezes `lud16Domain` on first request (stable per prod origin); if per-request domains ever matter, build per-request instead.
- **(S15 cleanup)** Delete the web's `defaultAccounts` const (`user-hooks.tsx`), the web's `~/lib/cashu/mint-validation` copy (the assembler now imports `MintBlocklistSchema` from `@agicash/wallet-sdk`), and the other now-dead web lib copies; drop unused deps; final `fix:all`.
- **(gate note)** `fix:all` is biome-only — every Phase-2 slice gate must add `bun run typecheck` + the web suite (+ the SDK suite if the SDK is touched).

---

## Self-Review

**1. Spec coverage (§5 reactive bridge intro / §7c web residue / §7d stays-web-only / §9 S11 / §10 gate / §11):**
- `features/shared/sdk.ts` `getSdk()` client singleton from `VITE_*` → `SdkConfig` (incl. `cashuMintBlocklist`, lud16 domain, `defaultAccounts`) → Task 2 (spec §7c). ✓
- Server entry builds a `createServer()` instance → Task 3 (spec §7c/§9 line 283; D11-2). ✓
- `SdkConfig` assembled from `import.meta.env`/`process.env` only — env reads stay web-side (spec §7d) → Tasks 2/3. ✓
- Additive, non-destructive; web keeps working; no reads flipped, no deletions, `sdk.background` not started (spec §9 S11; D11-1) → scope boundary + Task 4 Step 2. ✓
- The one `useSdkEventBridge` + reads-flip + orchestration flip are explicitly NOT in S11 (spec §9 S12/S13) → scope boundary + carryover. ✓
- Gate = `fix:all` + `typecheck` + web suite + SDK suite (spec §10, corrected for `fix:all`≠typecheck) → Global Constraints + Task 4. ✓
- `serverSparkMnemonic` rides `SdkConfig` from `LNURL_SERVER_SPARK_MNEMONIC` (spec §11 / S10 carryover) → Task 3. ✓
- `MintBlocklistSchema` promoted to the barrel (Plan-05 → S11 cut-over polish) → Task 1. ✓

**2. Placeholder scan:** every code step shows complete code; commands have expected output. The `>`-notes are verification reminders (confirm an existing signature/type before writing — the index.test.ts header, the `ImportMetaEnv` keys, the `createServer` throw order), not deferred work. No "TBD"/"add validation"/"similar to Task N".

**3. Type consistency:** `ClientSdkEnv`/`ServerSdkEnv` defined in Tasks 2/3 and consumed by their own tests; `buildClientSdkConfig`/`buildServerSdkConfig` both return `SdkConfig`; `DefaultAccountConfig[]` matches the SDK type (no `expiresAt`); `MintBlocklist`/`MintBlocklistSchema` flow Task 1 → Task 2; `StorageProvider` from the barrel feeds the in-memory provider (Task 3) and the `browserStorage` reference (Task 2); `getSdk(lud16Domain): Promise<Sdk>` (async, memoized promise) vs `getServerSdk(lud16Domain): ServerSdk` (sync, memoized value) — distinct shapes per `Sdk.create` async vs `createServer` sync. `serviceRoleKey`/`serverSparkMnemonic` present only in the server config.

**Risks / carryover:** the biggest downstream coupling is S14's domain-derivation (the LUD-16 `metadata` ⟷ spark `descriptionHash` invariant — must reuse `getCanonicalOrigin`) and the S13 atomic flip (never two leaders). Both are recorded in the carryover. The `getServerSdk` singleton freezing `lud16Domain` on first request is acceptable for a stable prod origin; flagged for S14.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-11-web-entry-points.md`.**

Per the task, execution proceeds with **superpowers:subagent-driven-development** — a fresh subagent per task, two-stage review between tasks. Per-task gate: `bun run fix:all` + the workspace `typecheck` + the relevant `test` suite; whole-slice gate (Task 4): `fix:all` + full `typecheck` + web suite + SDK suite. One commit per task, no push. **Task 2 Step 1 installs a dependency (`bun install` for the new `workspace:*` dep) — surface this for approval before running it.**
