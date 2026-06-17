# Wallet-SDK Base Plan 5 — Server-Mode SDK + Lightning-Address Routes

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the service-role / no-user-key server SDK path and the LUD-16/06/21 Lightning-address endpoints into `@agicash/wallet-sdk`, then rewire the app's three LN-address routes onto it.

**Architecture:** A dedicated `createServerSdk(config) → ServerSdk { lightningAddress, dispose }` entry point (exported at the `@agicash/wallet-sdk/server` subpath) builds a *slim* runtime — service-role `AgicashDb` (RLS-bypassed) + `MintDataCache` + a server `SparkWalletManager` seeded from the LN-server mnemonic + the already-landed server-safe `DefaultAccountRepository` + `ReadUserRepository` + create-only server receive repos/services + the `LightningAddressService` orchestrator. **No** Open Secret, KeyService, AuthDomain, SessionTokenProvider, realtime, or BackgroundDomain. The app's three routes call `sdk.lightningAddress.*` and the now-dead app server files are deleted.

**Tech Stack:** TypeScript (moduleResolution Bundler), `bun` + `bun:test`, `@agicash/wallet-sdk` (Supabase service-role client, `@agicash/breez-sdk-spark` Node build, `@cashu/cashu-ts`, `@agicash/ecies`, `@agicash/money`, `zod/mini`), React Router v7 framework-mode route loaders.

## Global Constraints

- **Package manager:** `bun` / `bunx` only. Never `npm`/`npx`/`yarn`/`pnpm`.
- **Branch:** all work on `sdkx/base`. Commit after every task. **Do NOT push** `sdkx/base` — it is gated on the Breez-connect smoke (`VITE_BREEZ_API_KEY`) + live realtime validation + the user's nod.
- **Gate (every task):** `bun run typecheck` (exit 0, all 8 packages) **and** `bun run test` (0 failures). **NEVER run `bun run fix:all`** — it is `biome check --write` and reorders imports across the whole repo (80+ files), polluting the tree. This prohibition applies to **implementers AND reviewers**. If any subagent runs it, discard with `git checkout -- .` (all task work is committed, so this is safe). Every subagent prompt must carry a loud ⛔ `fix:all` prohibition.
- **SDK is host-agnostic:** SDK code (`packages/wallet-sdk/src/**`) must NOT read `process.env` / `import.meta.env`, must NOT touch `window`/`localStorage`/`document`, must NOT import Sentry/`measureOperation`/`@tanstack/*`. All secrets (`SUPABASE_SERVICE_ROLE_KEY`, `LNURL_SERVER_SPARK_MNEMONIC`, `LNURL_SERVER_ENCRYPTION_KEY`, `VITE_BREEZ_API_KEY`) and the request origin are read by the **app** (`*.server.ts` host code) and injected into `createServerSdk`.
- **Behavior parity (byte-for-byte LNURL responses):** errors return **HTTP 200** with `{ status: 'ERROR', reason }` (LNURL convention); every response carries `Access-Control-Allow-Origin: *`; `min/maxSendable` reported in **msat** (range = 1 sat … 1,000,000 sat); cashu verify `preimage` is `''` (settled) / `null` (unsettled); spark `settled = status === 'transferCompleted'`; external (non-bypass) payers are forced to the BTC default account.
- **Code standards:** kebab-case files; prefer `type` over `interface`; default to no comments (CLAUDE.md bar); `@agicash/`-scoped package, `~/*` alias maps to `apps/web-wallet/app`.
- **Model assignment:** OPUS implementer + OPUS quality-reviewer on the new-logic tasks (Task 5 service, Task 6 server entry) and the final holistic review; OPUS quality-reviewer on Task 4 (security-boundary crypto); sonnet implementer + sonnet spec-review on the mechanical tasks (1, 2, 3, 7).

---

## File Structure

**New SDK files** (all under `packages/wallet-sdk/src/`):
- `server.ts` — `createServerSdk`, `ServerSdk`, `ServerSdkConfig` (the `@agicash/wallet-sdk/server` entry). One responsibility: build the slim server runtime + the LN-address domain.
- `internal/lightning-address/lnurl-types.ts` — LNURL response/error types (moved from app `lib/lnurl/types.ts`).
- `internal/lightning-address/verify-token.ts` — the symmetric verify-token codec (`encodeVerifyToken`/`decodeVerifyToken` + schema). Pure; testable in isolation; security boundary.
- `internal/lightning-address/lightning-address-service.ts` — the LUD-16/06/21 orchestrator (adapted from the app service: injected deps, per-call `baseUrl`/`bypassAmountValidation`, injected `getExchangeRate`, no env/Sentry/TanStack).
- `internal/lightning-address/cashu-receive-quote-repository.server.ts` — moved verbatim (imports repointed).
- `internal/lightning-address/cashu-receive-quote-service.server.ts` — moved verbatim.
- `internal/lightning-address/spark-receive-quote-repository.server.ts` — moved verbatim.
- `internal/lightning-address/spark-receive-quote-service.server.ts` — moved verbatim.
- `internal/lightning-address/verify-token.test.ts` — carve-out unit test.
- `internal/lightning-address/lightning-address-service.test.ts` — carve-out unit test.
- `internal/lightning-address/server.test.ts` — construction smoke test.

**Modified SDK files:**
- `internal/spark/wallet-manager.ts` — narrow the mnemonic dependency from `KeyService` to a structural `SparkMnemonicSource`.
- `package.json` — add `exports` entries: `"./server"`, `"./internal/lightning-address/lnurl-types"`.

**New app file:**
- `apps/web-wallet/app/features/receive/server-sdk.server.ts` — lazy module-singleton that reads env + builds the server SDK via `createServerSdk`.

**Modified app files:**
- `apps/web-wallet/app/routes/[.]well-known.lnurlp.$username.ts` — rewired to `getServerSdk()`.
- `apps/web-wallet/app/routes/api.lnurlp.callback.$userId.ts` — rewired.
- `apps/web-wallet/app/routes/api.lnurlp.verify.$encryptedQuoteData.ts` — rewired.
- `apps/web-wallet/app/lib/lnurl/types.ts` — becomes a re-export shim from the SDK (if other app code imports it; else deleted).

**Deleted app files** (now owned by the SDK; server-only, no other importers):
- `apps/web-wallet/app/features/receive/lightning-address-service.ts`
- `apps/web-wallet/app/features/receive/cashu-receive-quote-service.server.ts`
- `apps/web-wallet/app/features/receive/cashu-receive-quote-repository.server.ts`
- `apps/web-wallet/app/features/receive/spark-receive-quote-service.server.ts`
- `apps/web-wallet/app/features/receive/spark-receive-quote-repository.server.ts`
- `apps/web-wallet/app/features/agicash-db/database.server.ts`

---

## Task 1: Move the LNURL response types into the SDK

**Files:**
- Create: `packages/wallet-sdk/src/internal/lightning-address/lnurl-types.ts`
- Modify: `packages/wallet-sdk/package.json` (exports map)
- Modify: `apps/web-wallet/app/lib/lnurl/types.ts` (re-export shim) — or delete if no other importers

**Interfaces:**
- Produces: `LNURLError`, `LNURLPayParams`, `LNURLPayResult`, `LNURLVerifyResult` at `@agicash/wallet-sdk/internal/lightning-address/lnurl-types`.

- [ ] **Step 1: Read the app source to copy verbatim.**

Read `apps/web-wallet/app/lib/lnurl/types.ts`. It defines exactly four exported types. Their shapes (from exploration):
```ts
export type LNURLError = { status: 'ERROR'; reason: string };
export type LNURLPayParams = {
  tag: 'payRequest';
  callback: string;
  maxSendable: number;
  minSendable: number;
  metadata: string;
};
export type LNURLPayResult = { pr: string; verify?: string; routes: string[] };
export type LNURLVerifyResult = {
  status: 'OK';
  settled?: boolean;
  preimage: string | null;
  pr?: string;
};
```
Copy the file's exact content (use the real file as the source of truth — match its comments/JSDoc and any fields the sketch above omits).

- [ ] **Step 2: Create the SDK file.** Write `packages/wallet-sdk/src/internal/lightning-address/lnurl-types.ts` with the verbatim content from Step 1.

- [ ] **Step 3: Add the package.json export entry.**

In `packages/wallet-sdk/package.json` `exports`, add (alphabetically near the other `./internal/...` entries):
```json
"./internal/lightning-address/lnurl-types": "./src/internal/lightning-address/lnurl-types.ts",
```

- [ ] **Step 4: Determine whether the app file is still needed.**

Run:
```bash
cd /Users/ditto/Projects/MakePrisms/agicash/.claude/worktrees/sdk-extraction-fable
grep -rn "lib/lnurl/types" apps/web-wallet/app --include='*.ts' --include='*.tsx' | grep -v "app/lib/lnurl/types.ts"
```
- If the **only** match is `lightning-address-service.ts` (deleted in Task 7): the app file can be deleted in Task 7. For now, leave it untouched (it still compiles).
- If there are **other** importers (e.g. LNURL send/withdraw code): convert the app file to a shim now:
```ts
export type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from '@agicash/wallet-sdk/internal/lightning-address/lnurl-types';
```
Record the grep result in the task report so Task 7 knows whether to delete or keep the shim.

- [ ] **Step 5: Gate.**

Run:
```bash
bun run typecheck && bun run test
```
Expected: typecheck exit 0 (8 packages); tests 0 failures. ⛔ Do NOT run `fix:all`.

- [ ] **Step 6: Commit.**

```bash
git add packages/wallet-sdk/src/internal/lightning-address/lnurl-types.ts packages/wallet-sdk/package.json apps/web-wallet/app/lib/lnurl/types.ts
git commit -m "feat(wallet-sdk): move LNURL response types into SDK (base 5)"
```

---

## Task 2: Move the four create-only `.server.ts` receive variants into the SDK

These are pure `(db) → create` units. All runtime deps already live in the SDK (`encryptToPublicKey`, `computeSHA256`, the json-model schemas, `AgicashDb`, the receive-quote cores, the domain quote types). Move verbatim; only the import paths change.

**Files:**
- Create: `packages/wallet-sdk/src/internal/lightning-address/cashu-receive-quote-repository.server.ts`
- Create: `packages/wallet-sdk/src/internal/lightning-address/cashu-receive-quote-service.server.ts`
- Create: `packages/wallet-sdk/src/internal/lightning-address/spark-receive-quote-repository.server.ts`
- Create: `packages/wallet-sdk/src/internal/lightning-address/spark-receive-quote-service.server.ts`

**Interfaces:**
- Consumes (from the SDK): `encryptToPublicKey` (`../crypto/encryption`), `computeSHA256` (`@agicash/ecies`), `CashuLightningReceiveDbDataSchema`/`SparkLightningReceiveDbDataSchema` (`../db/json-models`), `AgicashDb` (`../db/database`), cashu/spark `receive-quote-core` (`../cashu/receive-quote-core`, `../spark/receive-quote-core`), `CashuReceiveQuote`/`SparkReceiveQuote` types (`../../domains/...`).
- Produces: `CashuReceiveQuoteRepositoryServer`, `CashuReceiveQuoteCreated`, `CashuReceiveQuoteServiceServer`, `SparkReceiveQuoteRepositoryServer`, `SparkReceiveQuoteCreated`, `SparkReceiveQuoteServiceServer` (consumed by Task 5).

- [ ] **Step 1: Copy the four app files verbatim** into `packages/wallet-sdk/src/internal/lightning-address/` (same filenames). The class/type bodies do NOT change — only the imports below.

- [ ] **Step 2: Repoint imports in `cashu-receive-quote-repository.server.ts`.**

Replace the app import block:
```ts
import { computeSHA256 } from '@agicash/ecies';
import type { AgicashDb } from '../agicash-db/database';
import { CashuLightningReceiveDbDataSchema } from '../agicash-db/json-models';
import { encryptToPublicKey } from '../shared/encryption';
import type { CashuReceiveQuote } from './cashu-receive-quote';
import type { RepositoryCreateQuoteParams } from './cashu-receive-quote-core';
```
with:
```ts
import { computeSHA256 } from '@agicash/ecies';
import type { AgicashDb } from '../db/database';
import { CashuLightningReceiveDbDataSchema } from '../db/json-models';
import { encryptToPublicKey } from '../crypto/encryption';
import type { CashuReceiveQuote } from '../../domains/cashu-receive-quote';
import type { RepositoryCreateQuoteParams } from '../cashu/receive-quote-core';
```
(Keep the `import type { Money } from '@agicash/money'` and `import type { z } from 'zod/mini'` lines unchanged.)

- [ ] **Step 3: Repoint imports in `cashu-receive-quote-service.server.ts`.**

Replace:
```ts
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  computeTotalFee,
} from './cashu-receive-quote-core';
import type {
  CashuReceiveQuoteCreated,
  CashuReceiveQuoteRepositoryServer,
} from './cashu-receive-quote-repository.server';
```
with:
```ts
import {
  type CreateQuoteBaseParams,
  computeQuoteExpiry,
  computeTotalFee,
} from '../cashu/receive-quote-core';
import type {
  CashuReceiveQuoteCreated,
  CashuReceiveQuoteRepositoryServer,
} from './cashu-receive-quote-repository.server';
```
(Keep `import { MintQuoteState } from '@cashu/cashu-ts'` unchanged.)

- [ ] **Step 4: Repoint imports in `spark-receive-quote-repository.server.ts`.**

Replace:
```ts
import type { AgicashDb } from '../agicash-db/database';
import { SparkLightningReceiveDbDataSchema } from '../agicash-db/json-models';
import { encryptToPublicKey } from '../shared/encryption';
import type { SparkReceiveQuote } from './spark-receive-quote';
import type { RepositoryCreateQuoteParams } from './spark-receive-quote-core';
```
with:
```ts
import type { AgicashDb } from '../db/database';
import { SparkLightningReceiveDbDataSchema } from '../db/json-models';
import { encryptToPublicKey } from '../crypto/encryption';
import type { SparkReceiveQuote } from '../../domains/spark-receive-quote';
import type { RepositoryCreateQuoteParams } from '../spark/receive-quote-core';
```
(Keep `import type { Money } from '@agicash/money'` and `import type { z } from 'zod/mini'` unchanged.)

- [ ] **Step 5: Repoint imports in `spark-receive-quote-service.server.ts`.**

Replace:
```ts
import {
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from './spark-receive-quote-core';
import type {
  SparkReceiveQuoteCreated,
  SparkReceiveQuoteRepositoryServer,
} from './spark-receive-quote-repository.server';
```
with:
```ts
import {
  type CreateQuoteBaseParams,
  type GetLightningQuoteParams,
  type SparkReceiveLightningQuote,
  computeQuoteExpiry,
  getAmountAndFee,
  getLightningQuote,
} from '../spark/receive-quote-core';
import type {
  SparkReceiveQuoteCreated,
  SparkReceiveQuoteRepositoryServer,
} from './spark-receive-quote-repository.server';
```

- [ ] **Step 6: Verify the repointed paths resolve.** Confirm each target exists:
```bash
ls packages/wallet-sdk/src/internal/cashu/receive-quote-core.ts \
   packages/wallet-sdk/src/internal/spark/receive-quote-core.ts \
   packages/wallet-sdk/src/internal/crypto/encryption.ts \
   packages/wallet-sdk/src/internal/db/database.ts \
   packages/wallet-sdk/src/internal/db/json-models/index.ts \
   packages/wallet-sdk/src/domains/cashu-receive-quote.ts \
   packages/wallet-sdk/src/domains/spark-receive-quote.ts
```
Expected: all exist. (`../db/json-models` resolves to the `index.ts` barrel.)

- [ ] **Step 7: Gate.** `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. ⛔ No `fix:all`. (These four files have no consumers yet — typecheck just confirms the moved files themselves compile against the SDK paths.)

- [ ] **Step 8: Commit.**

```bash
git add packages/wallet-sdk/src/internal/lightning-address/
git commit -m "feat(wallet-sdk): move create-only server receive repos/services into SDK (base 5)"
```

---

## Task 3: Narrow `SparkWalletManager`'s mnemonic dependency (the server seam)

`SparkWalletManager` uses its `keys` constructor arg for exactly one call — `this.keys.getSparkMnemonic()`. Narrowing the parameter from `KeyService` to a structural `SparkMnemonicSource` lets server mode supply a trivial mnemonic source (seeded from `LNURL_SERVER_SPARK_MNEMONIC`) while client mode keeps passing `KeyService` unchanged (it satisfies the structural type).

**Files:**
- Modify: `packages/wallet-sdk/src/internal/spark/wallet-manager.ts`

**Interfaces:**
- Produces: `SparkMnemonicSource` (exported type) consumed by Task 6's server runtime.

- [ ] **Step 1: Replace the `KeyService` dependency with a structural type.**

In `packages/wallet-sdk/src/internal/spark/wallet-manager.ts`:

Remove the import:
```ts
import type { KeyService } from '../keys';
```
Add, just above the `SparkWalletManager` class (after the `tryInitLogging` block):
```ts
/** The single capability SparkWalletManager needs from a key source: the BIP39
 * mnemonic for the spark wallet. Client mode passes the user's KeyService (which
 * satisfies this); server mode passes a fixed-mnemonic source. */
export type SparkMnemonicSource = {
  getSparkMnemonic(): Promise<string>;
};
```
Change the constructor parameter type:
```ts
  constructor(
    private readonly keys: SparkMnemonicSource,
    private readonly apiKey: string,
    private readonly storageDir: string,
  ) {}
```
Leave `connect()`/`getWallet()`/`dispose()` and the `this.keys.getSparkMnemonic()` call body unchanged.

- [ ] **Step 2: Confirm `KeyService` is no longer referenced in this file** and that `wallet-runtime.ts` still passes `deps.keys` (a `KeyService`) — it remains assignable to `SparkMnemonicSource`, so no change is needed there:
```bash
grep -n "KeyService" packages/wallet-sdk/src/internal/spark/wallet-manager.ts
```
Expected: no matches.

- [ ] **Step 3: Gate.** `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures (the existing `wallet-runtime.ts` wiring + any SparkWalletManager tests still pass — `KeyService` structurally satisfies `SparkMnemonicSource`). ⛔ No `fix:all`.

- [ ] **Step 4: Commit.**

```bash
git add packages/wallet-sdk/src/internal/spark/wallet-manager.ts
git commit -m "feat(wallet-sdk): narrow SparkWalletManager to a structural mnemonic source (base 5)"
```

---

## Task 4: Extract the verify-token codec + carve-out unit test (TDD)

The LUD-21 verify token is a server-symmetric XChaCha20-Poly1305 blob (base64url) that obfuscates the quote id from the LNURL client. Extracting it into a pure module makes it testable as a security boundary and keeps the service lean.

**Files:**
- Create: `packages/wallet-sdk/src/internal/lightning-address/verify-token.ts`
- Test: `packages/wallet-sdk/src/internal/lightning-address/verify-token.test.ts`

**Interfaces:**
- Produces:
  - `type LnurlVerifyQuoteData = { type: 'spark'; quoteId: string } | { type: 'cashu'; quoteId: string; mintUrl: string }`
  - `encodeVerifyToken(payload: LnurlVerifyQuoteData, key: Uint8Array): string`
  - `decodeVerifyToken(token: string, key: Uint8Array): LnurlVerifyQuoteData`

- [ ] **Step 1: Write the failing test.**

Create `packages/wallet-sdk/src/internal/lightning-address/verify-token.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { decodeVerifyToken, encodeVerifyToken } from './verify-token';

const key = new Uint8Array(32).fill(7);

describe('verify-token codec', () => {
  test('round-trips a cashu payload', () => {
    const payload = {
      type: 'cashu' as const,
      quoteId: 'quote-123',
      mintUrl: 'https://mint.example.com',
    };
    const token = encodeVerifyToken(payload, key);
    expect(typeof token).toBe('string');
    expect(decodeVerifyToken(token, key)).toEqual(payload);
  });

  test('round-trips a spark payload', () => {
    const payload = { type: 'spark' as const, quoteId: 'spark-req-456' };
    const token = encodeVerifyToken(payload, key);
    expect(decodeVerifyToken(token, key)).toEqual(payload);
  });

  test('rejects a token decrypted with the wrong key', () => {
    const token = encodeVerifyToken(
      { type: 'spark', quoteId: 'x' },
      key,
    );
    const wrongKey = new Uint8Array(32).fill(9);
    expect(() => decodeVerifyToken(token, wrongKey)).toThrow();
  });

  test('rejects a garbage / tampered token', () => {
    expect(() => decodeVerifyToken('not-a-valid-token', key)).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

Run:
```bash
cd packages/wallet-sdk && bun test src/internal/lightning-address/verify-token.test.ts
```
Expected: FAIL — cannot resolve `./verify-token`.

- [ ] **Step 3: Implement the codec.**

Create `packages/wallet-sdk/src/internal/lightning-address/verify-token.ts`:
```ts
import {
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
} from '@agicash/ecies';
import { base64url } from '@scure/base';
import { z } from 'zod/mini';

/**
 * Payload encoded into the LUD-21 `verify` URL segment. Encrypted with the
 * server's symmetric key (not a user key) to obfuscate the quote id from the
 * LNURL client. For cashu, `quoteId` is the mint quote id; for spark it is the
 * Spark receive-request id.
 */
export const LnurlVerifyQuoteDataSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spark'), quoteId: z.string() }),
  z.object({
    type: z.literal('cashu'),
    quoteId: z.string(),
    mintUrl: z.string(),
  }),
]);

export type LnurlVerifyQuoteData = z.infer<typeof LnurlVerifyQuoteDataSchema>;

export function encodeVerifyToken(
  payload: LnurlVerifyQuoteData,
  key: Uint8Array,
): string {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = encryptXChaCha20Poly1305(data, key);
  return base64url.encode(encrypted);
}

export function decodeVerifyToken(
  token: string,
  key: Uint8Array,
): LnurlVerifyQuoteData {
  const encrypted = base64url.decode(token);
  const decrypted = decryptXChaCha20Poly1305(encrypted, key);
  return LnurlVerifyQuoteDataSchema.parse(
    JSON.parse(new TextDecoder().decode(decrypted)),
  );
}
```

- [ ] **Step 4: Run the test to verify it passes.**

Run:
```bash
cd packages/wallet-sdk && bun test src/internal/lightning-address/verify-token.test.ts
```
Expected: PASS (4 tests).

- [ ] **Step 5: Full gate.** From repo root: `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. ⛔ No `fix:all`.

- [ ] **Step 6: Commit.**

```bash
git add packages/wallet-sdk/src/internal/lightning-address/verify-token.ts packages/wallet-sdk/src/internal/lightning-address/verify-token.test.ts
git commit -m "feat(wallet-sdk): verify-token codec + tests (base 5)"
```

---

## Task 5: Create the SDK `LightningAddressService` (adapted) + carve-out unit test

Adapt the app's `LightningAddressService` to the SDK: dependencies are injected (no `process.env`, no module-load side effects), `baseUrl` and `bypassAmountValidation` move to per-call params (the service is now a reusable singleton), currency conversion goes through an injected `getExchangeRate` port, the spark wallet comes from the injected `SparkWalletManager` (no TanStack `queryClient`), and Sentry's `measureOperation` is dropped. Logic is otherwise byte-for-byte.

**Files:**
- Create: `packages/wallet-sdk/src/internal/lightning-address/lightning-address-service.ts`
- Test: `packages/wallet-sdk/src/internal/lightning-address/lightning-address-service.test.ts`

**Interfaces:**
- Consumes: `ReadUserRepository` (`../db/user-repository`), `DefaultAccountRepository` (`../db/default-account-repository`), `SparkWalletManager` (`../spark/wallet-manager`), `AgicashDb` (`../db/database`), `getCashuWallet` (`../cashu/wallet`), `getLightningQuote` (`../cashu/receive-quote-core`), the four `*.server` classes (Task 2), the verify-token codec (Task 4), the LNURL types (Task 1), `NotFoundError` (`../../errors`), `Money` (`@agicash/money`), `sha256`/`bytesToHex` (`@noble/hashes`).
- Produces: `class LightningAddressService` with:
  - `constructor(deps: LightningAddressServiceDeps)`
  - `handleLud16Request(params: { username: string; baseUrl: string }): Promise<LNURLPayParams | LNURLError>`
  - `handleLnurlpCallback(params: { userId: string; amount: Money<'BTC'>; baseUrl: string; bypassAmountValidation?: boolean }): Promise<LNURLPayResult | LNURLError>`
  - `handleLnurlpVerify(params: { encryptedQuoteData: string }): Promise<LNURLVerifyResult | LNURLError>`
  - `type LightningAddressServiceDeps = { db: AgicashDb; userRepository: ReadUserRepository; defaultAccountRepository: DefaultAccountRepository; sparkWallets: SparkWalletManager; verifyEncryptionKey: Uint8Array; getExchangeRate?: (ticker: string) => Promise<string> }`

- [ ] **Step 1: Write the failing test.**

Create `packages/wallet-sdk/src/internal/lightning-address/lightning-address-service.test.ts`:
```ts
import { Money } from '@agicash/money';
import { describe, expect, test } from 'bun:test';
import { LightningAddressService } from './lightning-address-service';

// Minimal deps: only what each tested path touches. The cast keeps the unused
// repos/wallets out of the test — handleLud16Request only reads userRepository,
// and the range guard returns before touching anything.
function makeService(overrides: Partial<{
  getByUsername: (u: string) => Promise<unknown>;
}> = {}) {
  const userRepository = {
    getByUsername:
      overrides.getByUsername ??
      (async () => ({ id: 'user-1', username: 'alice' })),
    get: async () => ({ id: 'user-1', username: 'alice' }),
  };
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  return new LightningAddressService({
    db: {} as any,
    userRepository: userRepository as any,
    defaultAccountRepository: {} as any,
    sparkWallets: {} as any,
    verifyEncryptionKey: new Uint8Array(32),
  });
}

describe('LightningAddressService.handleLud16Request', () => {
  test('returns LUD-16 payRequest params with msat bounds', async () => {
    const service = makeService();
    const res = await service.handleLud16Request({
      username: 'alice',
      baseUrl: 'https://agi.cash',
    });
    expect(res).toEqual({
      tag: 'payRequest',
      callback: 'https://agi.cash/api/lnurlp/callback/user-1',
      minSendable: 1000, // 1 sat = 1000 msat
      maxSendable: 1_000_000_000, // 1,000,000 sat = 1e9 msat
      metadata: JSON.stringify([
        ['text/plain', 'Pay to alice@agi.cash'],
        ['text/identifier', 'alice@agi.cash'],
      ]),
    });
  });

  test('returns not-found when the username does not resolve', async () => {
    const service = makeService({ getByUsername: async () => null });
    const res = await service.handleLud16Request({
      username: 'ghost',
      baseUrl: 'https://agi.cash',
    });
    expect(res).toEqual({ status: 'ERROR', reason: 'not found' });
  });
});

describe('LightningAddressService.handleLnurlpCallback range guard', () => {
  test('rejects amounts below the minimum', async () => {
    const service = makeService();
    const res = await service.handleLnurlpCallback({
      userId: 'user-1',
      amount: new Money({ amount: 0, currency: 'BTC', unit: 'msat' }),
      baseUrl: 'https://agi.cash',
    });
    expect(res).toMatchObject({ status: 'ERROR' });
    expect((res as { reason: string }).reason).toContain('Amount out of range');
  });

  test('rejects amounts above the maximum', async () => {
    const service = makeService();
    const res = await service.handleLnurlpCallback({
      userId: 'user-1',
      amount: new Money({ amount: 2_000_000, currency: 'BTC', unit: 'sat' }),
      baseUrl: 'https://agi.cash',
    });
    expect(res).toMatchObject({ status: 'ERROR' });
    expect((res as { reason: string }).reason).toContain('Amount out of range');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails.**

```bash
cd packages/wallet-sdk && bun test src/internal/lightning-address/lightning-address-service.test.ts
```
Expected: FAIL — cannot resolve `./lightning-address-service`.

- [ ] **Step 3: Implement the service.**

Create `packages/wallet-sdk/src/internal/lightning-address/lightning-address-service.ts`. This is the app service adapted per the rules above; verify each method against the app original (`apps/web-wallet/app/features/receive/lightning-address-service.ts`) to confirm behavior parity.
```ts
import { Money } from '@agicash/money';
import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex } from '@noble/hashes/utils';
import { NotFoundError } from '../../errors';
import { getLightningQuote } from '../cashu/receive-quote-core';
import { getCashuWallet } from '../cashu/wallet';
import type { AgicashDb } from '../db/database';
import type { DefaultAccountRepository } from '../db/default-account-repository';
import type { ReadUserRepository } from '../db/user-repository';
import type { SparkWalletManager } from '../spark/wallet-manager';
import { CashuReceiveQuoteRepositoryServer } from './cashu-receive-quote-repository.server';
import { CashuReceiveQuoteServiceServer } from './cashu-receive-quote-service.server';
import type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from './lnurl-types';
import { SparkReceiveQuoteRepositoryServer } from './spark-receive-quote-repository.server';
import { SparkReceiveQuoteServiceServer } from './spark-receive-quote-service.server';
import { decodeVerifyToken, encodeVerifyToken } from './verify-token';

export type LightningAddressServiceDeps = {
  db: AgicashDb;
  userRepository: ReadUserRepository;
  defaultAccountRepository: DefaultAccountRepository;
  sparkWallets: SparkWalletManager;
  /** Symmetric key (raw bytes) for the LUD-21 verify-token obfuscation. */
  verifyEncryptionKey: Uint8Array;
  /** Resolves a fiat/BTC exchange rate for the bypassAmountValidation path
   * (e.g. ticker 'BTC-USD'). Required only when an agicash↔agicash payment
   * lands on a non-BTC default account. */
  getExchangeRate?: (ticker: string) => Promise<string>;
};

export class LightningAddressService {
  private readonly db: AgicashDb;
  private readonly userRepository: ReadUserRepository;
  private readonly defaultAccountRepository: DefaultAccountRepository;
  private readonly sparkWallets: SparkWalletManager;
  private readonly verifyEncryptionKey: Uint8Array;
  private readonly getExchangeRate?: (ticker: string) => Promise<string>;
  private readonly minSendable: Money<'BTC'>;
  private readonly maxSendable: Money<'BTC'>;

  constructor(deps: LightningAddressServiceDeps) {
    this.db = deps.db;
    this.userRepository = deps.userRepository;
    this.defaultAccountRepository = deps.defaultAccountRepository;
    this.sparkWallets = deps.sparkWallets;
    this.verifyEncryptionKey = deps.verifyEncryptionKey;
    this.getExchangeRate = deps.getExchangeRate;
    this.minSendable = new Money({ amount: 1, currency: 'BTC', unit: 'sat' });
    this.maxSendable = new Money({
      amount: 1_000_000,
      currency: 'BTC',
      unit: 'sat',
    });
  }

  async handleLud16Request(params: {
    username: string;
    baseUrl: string;
  }): Promise<LNURLPayParams | LNURLError> {
    try {
      const user = await this.userRepository.getByUsername(params.username);
      if (!user) {
        return { status: 'ERROR', reason: 'not found' };
      }
      const callback = `${params.baseUrl}/api/lnurlp/callback/${user.id}`;
      const metadata = this.buildLnurlpMetadata(user.username, params.baseUrl);
      return {
        callback,
        maxSendable: this.maxSendable.toNumber('msat'),
        minSendable: this.minSendable.toNumber('msat'),
        metadata,
        tag: 'payRequest',
      };
    } catch (error) {
      console.error('Error processing LNURL-pay request', { cause: error });
      return { status: 'ERROR', reason: 'Internal server error' };
    }
  }

  async handleLnurlpCallback(params: {
    userId: string;
    amount: Money<'BTC'>;
    baseUrl: string;
    bypassAmountValidation?: boolean;
  }): Promise<LNURLPayResult | LNURLError> {
    const { userId, amount, baseUrl } = params;
    const bypassAmountValidation = params.bypassAmountValidation ?? false;

    if (
      amount.lessThan(this.minSendable) ||
      amount.greaterThan(this.maxSendable)
    ) {
      return {
        status: 'ERROR',
        reason: `Amount out of range. Min: ${this.minSendable.toNumber('sat')} sats, Max: ${this.maxSendable.toNumber('sat').toLocaleString()} sats.`,
      };
    }

    try {
      const user = await this.userRepository.get(userId);
      if (!user) {
        return { status: 'ERROR', reason: 'not found' };
      }

      // External lightning-address requests only support BTC to avoid exchange
      // rate mismatches. bypassAmountValidation (agicash↔agicash) allows the
      // user's default currency + a conversion.
      const account = await this.defaultAccountRepository.getDefault(
        userId,
        bypassAmountValidation ? undefined : 'BTC',
      );

      let amountToReceive = amount as Money;
      if (amount.currency !== account.currency) {
        if (!this.getExchangeRate) {
          throw new Error(
            'getExchangeRate is required to convert across currencies',
          );
        }
        const rate = await this.getExchangeRate(
          `${amount.currency}-${account.currency}`,
        );
        amountToReceive = amount.convert(account.currency, rate) as Money;
      }

      if (account.type === 'cashu') {
        // cashu cannot set the invoice description_hash:
        // https://github.com/cashubtc/nuts/issues/110#issuecomment-2062898765
        const lightningQuote = await getLightningQuote({
          wallet: account.wallet,
          amount: amountToReceive,
          xPub: user.cashuLockingXpub,
        });

        const cashuReceiveQuoteService = new CashuReceiveQuoteServiceServer(
          new CashuReceiveQuoteRepositoryServer(this.db),
        );
        await cashuReceiveQuoteService.createReceiveQuote({
          userId,
          userEncryptionPublicKey: user.encryptionPublicKey,
          account,
          receiveType: 'LIGHTNING',
          lightningQuote,
        });

        const encryptedQuoteData = encodeVerifyToken(
          {
            type: 'cashu',
            quoteId: lightningQuote.mintQuote.quote,
            mintUrl: account.mintUrl,
          },
          this.verifyEncryptionKey,
        );

        return {
          pr: lightningQuote.mintQuote.request,
          verify: `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
          routes: [],
        };
      }

      const sparkReceiveQuoteService = new SparkReceiveQuoteServiceServer(
        new SparkReceiveQuoteRepositoryServer(this.db),
      );
      const metadata = this.buildLnurlpMetadata(user.username, baseUrl);
      const descriptionHash = bytesToHex(
        sha256(new TextEncoder().encode(metadata)),
      );

      const lightningQuote = await sparkReceiveQuoteService.getLightningQuote({
        wallet: account.wallet,
        amount: amountToReceive,
        receiverIdentityPubkey: user.sparkIdentityPublicKey,
        descriptionHash,
      });
      await sparkReceiveQuoteService.createReceiveQuote({
        userId,
        userEncryptionPublicKey: user.encryptionPublicKey,
        account,
        lightningQuote,
        receiveType: 'LIGHTNING',
      });

      const encryptedQuoteData = encodeVerifyToken(
        { type: 'spark', quoteId: lightningQuote.id },
        this.verifyEncryptionKey,
      );

      return {
        pr: lightningQuote.invoice.paymentRequest,
        verify: `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}`,
        routes: [],
      };
    } catch (error) {
      console.error('Error processing LNURL-pay callback', { cause: error });
      return { status: 'ERROR', reason: 'Internal server error' };
    }
  }

  async handleLnurlpVerify(params: {
    encryptedQuoteData: string;
  }): Promise<LNURLVerifyResult | LNURLError> {
    try {
      const payload = decodeVerifyToken(
        params.encryptedQuoteData,
        this.verifyEncryptionKey,
      );
      if (payload.type === 'cashu') {
        return await this.handleCashuLnurlpVerify(
          payload.quoteId,
          payload.mintUrl,
        );
      }
      return await this.handleSparkLnurlpVerify(payload.quoteId);
    } catch (error) {
      console.error('Error processing LNURL-pay verify', { cause: error });
      const reason =
        error instanceof NotFoundError ? 'Not found' : 'Internal server error';
      return { status: 'ERROR', reason };
    }
  }

  private async handleCashuLnurlpVerify(
    mintQuoteId: string,
    mintUrl: string,
  ): Promise<LNURLVerifyResult> {
    const wallet = getCashuWallet(mintUrl);
    const mintQuote = await wallet.checkMintQuoteBolt11(mintQuoteId);
    if (['PAID', 'ISSUED'].includes(mintQuote.state)) {
      return {
        status: 'OK',
        settled: true,
        preimage: '',
        pr: mintQuote.request,
      };
    }
    return {
      status: 'OK',
      settled: false,
      preimage: null,
      pr: mintQuote.request,
    };
  }

  private async handleSparkLnurlpVerify(
    receiveRequestId: string,
  ): Promise<LNURLVerifyResult> {
    const { wallet } = await this.sparkWallets.getWallet('MAINNET');
    const receiveRequest = await wallet.getLightningReceiveRequest({
      requestId: receiveRequestId,
    });
    if (!receiveRequest) {
      throw new NotFoundError(
        `Spark lightning receive request ${receiveRequestId} not found`,
      );
    }
    const settled = receiveRequest.status === 'transferCompleted';
    return {
      status: 'OK',
      settled,
      preimage: receiveRequest.paymentPreimage ?? null,
      pr: receiveRequest.invoice,
    };
  }

  private buildLnurlpMetadata(username: string, baseUrl: string): string {
    const address = `${username}@${new URL(baseUrl).host}`;
    return JSON.stringify([
      ['text/plain', `Pay to ${address}`],
      ['text/identifier', address],
    ]);
  }
}
```

- [ ] **Step 4: Verify against the app original.** Open `apps/web-wallet/app/features/receive/lightning-address-service.ts` side by side and confirm: (a) the cashu/spark branch logic, verify-token payloads, and return shapes match; (b) the only intentional deltas are the injected deps, per-call `baseUrl`/`bypassAmountValidation`, `getExchangeRate` replacing `ExchangeRateService`, `sparkWallets.getWallet('MAINNET')` replacing `queryClient.fetchQuery(sparkWalletQueryOptions(...))`, and the dropped `measureOperation`. If `account.type === 'cashu'` does not narrow `account.wallet`/`account.mintUrl`, confirm `RedactedAccount` is a discriminated union on `type` (it is — `RedactedCashuAccount` carries `mintUrl`+`wallet`).

- [ ] **Step 5: Run the test to verify it passes.**

```bash
cd packages/wallet-sdk && bun test src/internal/lightning-address/lightning-address-service.test.ts
```
Expected: PASS (4 tests). If `toNumber('msat')` returns a non-integer or the metadata host differs, fix the assertion against real `Money`/`URL` behavior — do not change production logic to satisfy a wrong assertion.

- [ ] **Step 6: Full gate.** From repo root: `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. ⛔ No `fix:all`.

- [ ] **Step 7: Commit.**

```bash
git add packages/wallet-sdk/src/internal/lightning-address/lightning-address-service.ts packages/wallet-sdk/src/internal/lightning-address/lightning-address-service.test.ts
git commit -m "feat(wallet-sdk): LightningAddressService (LUD-16/06/21) + tests (base 5)"
```

---

## Task 6: Create the server entry — `createServerSdk` / `ServerSdk` / `ServerSdkConfig`

The slim server runtime. Builds only what the LN-address flow needs; no Open Secret / auth / realtime / background.

**Files:**
- Create: `packages/wallet-sdk/src/server.ts`
- Test: `packages/wallet-sdk/src/internal/lightning-address/server.test.ts`
- Modify: `packages/wallet-sdk/package.json` (exports map)

**Interfaces:**
- Consumes: `createAgicashDb` (`./internal/db/client`), `MintDataCache` (`./internal/cashu/mint-cache`), `AgicashMintAuthProvider` (`./internal/cashu/mint-auth-provider`), `SparkWalletManager`+`SparkMnemonicSource` (`./internal/spark/wallet-manager`), `DefaultAccountRepository` (`./internal/db/default-account-repository`), `ReadUserRepository` (`./internal/db/user-repository`), `LightningAddressService` (`./internal/lightning-address/lightning-address-service`), `hexToBytes` (`@noble/hashes/utils`).
- Produces: `createServerSdk`, `ServerSdk`, `ServerSdkConfig`; re-exports the LNURL types.

- [ ] **Step 1: Write the construction smoke test.**

Create `packages/wallet-sdk/src/internal/lightning-address/server.test.ts`:
```ts
import { describe, expect, test } from 'bun:test';
import { createServerSdk } from '../../server';

describe('createServerSdk', () => {
  test('builds a server SDK with a lightningAddress domain and dispose, without I/O', async () => {
    const sdk = await createServerSdk({
      supabase: {
        url: 'https://example.supabase.co',
        serviceRoleKey: 'service-role-key',
      },
      breezApiKey: 'breez-key',
      lightningAddress: {
        serverSparkMnemonic:
          'test test test test test test test test test test test junk',
        verifyEncryptionKey: '00'.repeat(32),
      },
    });
    expect(typeof sdk.lightningAddress.handleLud16Request).toBe('function');
    expect(typeof sdk.lightningAddress.handleLnurlpCallback).toBe('function');
    expect(typeof sdk.lightningAddress.handleLnurlpVerify).toBe('function');
    await sdk.dispose();
  });
});
```

- [ ] **Step 2: Run to verify it fails.**

```bash
cd packages/wallet-sdk && bun test src/internal/lightning-address/server.test.ts
```
Expected: FAIL — cannot resolve `../../server`.

- [ ] **Step 3: Implement the server entry.**

Create `packages/wallet-sdk/src/server.ts`:
```ts
import { hexToBytes } from '@noble/hashes/utils';
import { AgicashMintAuthProvider } from './internal/cashu/mint-auth-provider';
import { MintDataCache } from './internal/cashu/mint-cache';
import { createAgicashDb } from './internal/db/client';
import { DefaultAccountRepository } from './internal/db/default-account-repository';
import { ReadUserRepository } from './internal/db/user-repository';
import { LightningAddressService } from './internal/lightning-address/lightning-address-service';
import {
  type SparkMnemonicSource,
  SparkWalletManager,
} from './internal/spark/wallet-manager';

export type {
  LNURLError,
  LNURLPayParams,
  LNURLPayResult,
  LNURLVerifyResult,
} from './internal/lightning-address/lnurl-types';

/** Configuration for the server-mode SDK (LN-address routes). All values are
 * supplied by the host — the SDK reads no environment itself. */
export type ServerSdkConfig = {
  supabase: {
    url: string;
    /** Service-role key — RLS-bypassed. There is no authenticated end user. */
    serviceRoleKey: string;
  };
  /** Breez API key for the server's own spark wallet. */
  breezApiKey: string;
  /** Writable dir for the Breez SDK's local state. Default './.spark-data'. */
  sparkStorageDir?: string;
  lightningAddress: {
    /** The LN-address server's own BIP39 mnemonic (its spark wallet). */
    serverSparkMnemonic: string;
    /** Hex-encoded symmetric key for the LUD-21 verify-token obfuscation. */
    verifyEncryptionKey: string;
  };
  /** Resolves an exchange rate (e.g. 'BTC-USD') for the bypassAmountValidation
   * conversion path. Required only if an agicash↔agicash payment can land on a
   * non-BTC default account. */
  getExchangeRate?: (ticker: string) => Promise<string>;
};

export type ServerSdk = {
  lightningAddress: LightningAddressService;
  dispose(): Promise<void>;
};

/**
 * Builds a server-mode SDK: a service-role Supabase client (RLS-bypassed) plus
 * the slim runtime the LN-address routes need (mint cache, a server spark wallet
 * seeded from the LN-server mnemonic, the server-safe default-account read, and
 * the create-only receive services). No Open Secret, auth, realtime, or
 * background processing. Pure construction — spark connect() is lazy.
 */
export async function createServerSdk(
  config: ServerSdkConfig,
): Promise<ServerSdk> {
  const db = createAgicashDb(
    {
      url: config.supabase.url,
      anonKey: '',
      serviceRoleKey: config.supabase.serviceRoleKey,
    },
    async () => null,
  );

  const mintCache = new MintDataCache();

  // Server mode is never "logged in": fetch() short-circuits before touching
  // Open Secret, so the throwing stub below is never reached. External LN-address
  // payments only target transactional BTC accounts (no NUT-21 Clear Auth), so no
  // CAT is ever required.
  const mintAuth = new AgicashMintAuthProvider(
    {
      generateThirdPartyToken: () => {
        throw new Error('Open Secret is unavailable in server mode');
      },
    },
    async () => false,
  );

  const mnemonicSource: SparkMnemonicSource = {
    getSparkMnemonic: () =>
      Promise.resolve(config.lightningAddress.serverSparkMnemonic),
  };
  const sparkWallets = new SparkWalletManager(
    mnemonicSource,
    config.breezApiKey,
    config.sparkStorageDir ?? './.spark-data',
  );

  const defaultAccountRepository = new DefaultAccountRepository(
    db,
    mintCache,
    mintAuth,
    sparkWallets,
  );
  const userRepository = new ReadUserRepository(db);

  const lightningAddress = new LightningAddressService({
    db,
    userRepository,
    defaultAccountRepository,
    sparkWallets,
    verifyEncryptionKey: hexToBytes(
      config.lightningAddress.verifyEncryptionKey,
    ),
    getExchangeRate: config.getExchangeRate,
  });

  return {
    lightningAddress,
    dispose: async () => {
      mintCache.clear();
      await sparkWallets.dispose();
    },
  };
}
```

- [ ] **Step 4: Verify the `AgicashMintAuthProvider` stub typechecks.** Confirm the ctor's first param type is `Pick<OpenSecret, 'generateThirdPartyToken'>` and that `generateThirdPartyToken: () => { throw }` is assignable (a `() => never` is assignable to a `(...args) => Promise<...>` return). If the real signature requires args or a specific return, match it with a never-returning async stub: `generateThirdPartyToken: async () => { throw new Error(...) }`. Confirm by reading `packages/wallet-sdk/src/internal/cashu/mint-auth-provider.ts` (ctor) and `packages/wallet-sdk/src/internal/opensecret.ts` (the `generateThirdPartyToken` type).

- [ ] **Step 5: Add the `./server` package.json export.**

In `packages/wallet-sdk/package.json` `exports`, add (near `./engine`):
```json
"./server": "./src/server.ts",
```

- [ ] **Step 6: Run the smoke test to verify it passes.**

```bash
cd packages/wallet-sdk && bun test src/internal/lightning-address/server.test.ts
```
Expected: PASS (1 test). Construction must not perform network I/O (spark connect is lazy; `dispose()` disconnects nothing since no wallet was acquired).

- [ ] **Step 7: Full gate.** From repo root: `bun run typecheck && bun run test`. Expected: exit 0 / 0 failures. ⛔ No `fix:all`.

- [ ] **Step 8: Commit.**

```bash
git add packages/wallet-sdk/src/server.ts packages/wallet-sdk/src/internal/lightning-address/server.test.ts packages/wallet-sdk/package.json
git commit -m "feat(wallet-sdk): createServerSdk server-mode entry (@agicash/wallet-sdk/server) (base 5)"
```

---

## Task 7: Rewire the app routes onto the server SDK + delete the dead app files

**Files:**
- Create: `apps/web-wallet/app/features/receive/server-sdk.server.ts`
- Modify: `apps/web-wallet/app/routes/[.]well-known.lnurlp.$username.ts`
- Modify: `apps/web-wallet/app/routes/api.lnurlp.callback.$userId.ts`
- Modify: `apps/web-wallet/app/routes/api.lnurlp.verify.$encryptedQuoteData.ts`
- Delete: `apps/web-wallet/app/features/receive/lightning-address-service.ts`
- Delete: `apps/web-wallet/app/features/receive/cashu-receive-quote-service.server.ts`
- Delete: `apps/web-wallet/app/features/receive/cashu-receive-quote-repository.server.ts`
- Delete: `apps/web-wallet/app/features/receive/spark-receive-quote-service.server.ts`
- Delete: `apps/web-wallet/app/features/receive/spark-receive-quote-repository.server.ts`
- Delete: `apps/web-wallet/app/features/agicash-db/database.server.ts`
- Modify or delete: `apps/web-wallet/app/lib/lnurl/types.ts` (per Task 1's grep result)

**Interfaces:**
- Consumes: `createServerSdk`, `ServerSdk` from `@agicash/wallet-sdk/server`; `ExchangeRateService` from `~/lib/exchange-rate/exchange-rate-service`; `Money` from `@agicash/money`.

- [ ] **Step 1: Create the app's lazy server-SDK singleton.**

The `.server.ts` suffix keeps env reads + the service-role key out of the client bundle (React Router strips server modules). A module singleton preserves the spark-wallet connection cache across requests (a per-request SDK would reconnect Breez on every verify).

Create `apps/web-wallet/app/features/receive/server-sdk.server.ts`:
```ts
import { createServerSdk, type ServerSdk } from '@agicash/wallet-sdk/server';
import { ExchangeRateService } from '~/lib/exchange-rate/exchange-rate-service';

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

let instance: Promise<ServerSdk> | undefined;

/** Lazily constructs (and memoizes) the server-mode SDK from server env. */
export function getServerSdk(): Promise<ServerSdk> {
  instance ??= createServerSdk({
    supabase: {
      url: requireEnv('VITE_SUPABASE_URL', import.meta.env.VITE_SUPABASE_URL),
      serviceRoleKey: requireEnv(
        'SUPABASE_SERVICE_ROLE_KEY',
        process.env.SUPABASE_SERVICE_ROLE_KEY,
      ),
    },
    breezApiKey: requireEnv(
      'VITE_BREEZ_API_KEY',
      import.meta.env.VITE_BREEZ_API_KEY,
    ),
    sparkStorageDir: '/tmp/.spark-data',
    lightningAddress: {
      serverSparkMnemonic: requireEnv(
        'LNURL_SERVER_SPARK_MNEMONIC',
        process.env.LNURL_SERVER_SPARK_MNEMONIC,
      ),
      verifyEncryptionKey: requireEnv(
        'LNURL_SERVER_ENCRYPTION_KEY',
        process.env.LNURL_SERVER_ENCRYPTION_KEY,
      ),
    },
    getExchangeRate: (ticker) => new ExchangeRateService().getRate(ticker),
  });
  return instance;
}
```

- [ ] **Step 2: Rewire the LUD-16 route.**

Replace the full body of `apps/web-wallet/app/routes/[.]well-known.lnurlp.$username.ts`:
```ts
import { getServerSdk } from '~/features/receive/server-sdk.server';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const sdk = await getServerSdk();
  const baseUrl = new URL(request.url).origin;
  const response = await sdk.lightningAddress.handleLud16Request({
    username: params.username,
    baseUrl,
  });
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

- [ ] **Step 3: Rewire the LUD-06 callback route.**

Replace the full body of `apps/web-wallet/app/routes/api.lnurlp.callback.$userId.ts`:
```ts
import { Money } from '@agicash/money';
import { getServerSdk } from '~/features/receive/server-sdk.server';
import type { Route } from './+types/api.lnurlp.callback.$userId';

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const amountMsat = url.searchParams.get('amount');

  if (!amountMsat || Number.isNaN(Number(amountMsat))) {
    return new Response(
      JSON.stringify({ status: 'ERROR', reason: 'Invalid amount' }),
      {
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      },
    );
  }

  const amount = new Money({
    amount: amountMsat,
    currency: 'BTC',
    unit: 'msat',
  });
  const bypassAmountValidation =
    url.searchParams.get('bypassAmountValidation') === 'true';

  const sdk = await getServerSdk();
  const response = await sdk.lightningAddress.handleLnurlpCallback({
    userId: params.userId,
    amount,
    baseUrl: url.origin,
    bypassAmountValidation,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

- [ ] **Step 4: Rewire the LUD-21 verify route.**

Replace the full body of `apps/web-wallet/app/routes/api.lnurlp.verify.$encryptedQuoteData.ts`:
```ts
import { getServerSdk } from '~/features/receive/server-sdk.server';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ params }: Route.LoaderArgs) {
  const sdk = await getServerSdk();
  const response = await sdk.lightningAddress.handleLnurlpVerify({
    encryptedQuoteData: params.encryptedQuoteData,
  });
  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

- [ ] **Step 5: Confirm no other importers of the to-be-deleted files.**

```bash
cd /Users/ditto/Projects/MakePrisms/agicash/.claude/worktrees/sdk-extraction-fable
grep -rn -e "features/receive/lightning-address-service" \
        -e "features/receive/cashu-receive-quote-service.server" \
        -e "features/receive/cashu-receive-quote-repository.server" \
        -e "features/receive/spark-receive-quote-service.server" \
        -e "features/receive/spark-receive-quote-repository.server" \
        -e "agicash-db/database.server" \
        -e "agicashDbServer" \
        apps/web-wallet/app --include='*.ts' --include='*.tsx'
```
Expected: matches only inside the three rewired routes (now removed) and the files being deleted themselves. If anything else references them, STOP and report — do not delete.

- [ ] **Step 6: Delete the dead app files.**

```bash
git rm apps/web-wallet/app/features/receive/lightning-address-service.ts \
       apps/web-wallet/app/features/receive/cashu-receive-quote-service.server.ts \
       apps/web-wallet/app/features/receive/cashu-receive-quote-repository.server.ts \
       apps/web-wallet/app/features/receive/spark-receive-quote-service.server.ts \
       apps/web-wallet/app/features/receive/spark-receive-quote-repository.server.ts \
       apps/web-wallet/app/features/agicash-db/database.server.ts
```

- [ ] **Step 7: Resolve `lib/lnurl/types.ts` per Task 1's grep.**

- If Task 1 found no other importers, delete it: `git rm apps/web-wallet/app/lib/lnurl/types.ts`.
- If Task 1 left it as a shim (other importers exist), leave the shim in place. Re-run the Task 1 grep to confirm the current state and act accordingly.

- [ ] **Step 8: Gate (app typecheck is the real check here).**

```bash
bun run typecheck && bun run test
```
Expected: typecheck exit 0 (the rewired routes resolve `@agicash/wallet-sdk/server`; `+types/*` regenerate via `react-router typegen`); tests 0 failures. ⛔ No `fix:all`. If typecheck reports a dangling import to a deleted file, fix the importer (it should have surfaced in Step 5).

- [ ] **Step 9: Commit.**

```bash
git add apps/web-wallet/app/features/receive/server-sdk.server.ts apps/web-wallet/app/routes/ apps/web-wallet/app/lib/lnurl/types.ts
git commit -m "feat(web): rewire LN-address routes onto @agicash/wallet-sdk/server; drop app server copies (base 5)"
```

---

## Final: holistic review + validation

- [ ] **Holistic review (OPUS).** Dispatch a fresh OPUS reviewer over the whole Plan-5 diff (`git diff c3e875b6..HEAD`). Confirm: (1) behavior parity vs the deleted app code (response shapes, error mapping, BTC-forcing, min/max, cashu/spark branches, verify settled logic); (2) no `process.env`/`import.meta.env`/`window`/Sentry/TanStack leaked into `packages/wallet-sdk/src`; (3) the server entry builds only the slim runtime (no AuthDomain/OS/background); (4) the `SparkWalletManager` narrowing did not change client-mode behavior; (5) no `fix:all` pollution in the tree (`git status` clean apart from intended files); (6) the gate is green (`bun run typecheck && bun run test`). Reviewer must NOT run `fix:all`.

- [ ] **Endpoint validation (user-run, post-merge — NOT in the execution loop).** This worktree has no live stack/auth/env, so the e2e cannot run here. After the user supplies env and runs the dev server, validate with the `lnurl-test` skill against both a Testnut-default and a Spark-default account:
  - `bun run dev`
  - `/lnurl-test <username>` (Testnut default) — expect LUD-16 params, LUD-06 `pr`+`verify`, LUD-21 `settled:true` after the FakeWallet auto-pay (3s).
  - switch the user's default account to Spark, `/lnurl-test <username>` — expect `settled:false` (no real payment).
  Confirm all three endpoints pass for each account type (byte-for-byte parity with the pre-extraction behavior).

- [ ] **Carry-forward / out-of-scope (document in the task report, do NOT implement):**
  - Token-claim orchestrators (`claim-cashu-token-service`, `receive-cashu-token-service`, `receive-cashu-token-quote-service`) remain **facade/variant** scope (cache-coupled; not server-mode) — re-confirmed, not Plan 5.
  - Gift-card/offer default accounts in server mode stay **unsupported** (external LN targets transactional BTC only) — preserves current behavior; `getMintAuthProvider` returns `undefined` and the throwing OS stub is never reached.
  - A full SDK rates domain (`sdk.rates`) is deferred to its own plan (spec open-Q #2); Plan 5 satisfies LN-address conversion via the injected `getExchangeRate` port.
  - `@supabase/realtime-js` phantom-dep + the spec's `./*` export-wildcard tightening remain pre-public-release carry-overs (from 4b / Plan 2).
  - **Do NOT push `sdkx/base`** — gated on the Breez-connect smoke (`VITE_BREEZ_API_KEY`) + live realtime validation + the user's nod.

---

## Self-Review (author checklist — completed)

**Spec coverage:** Every Plan-5 deferral from the exploration's deferral checklist is mapped — server-mode `Sdk`/serviceRoleKey (Task 6; the DB branch was already landed), the 4 `.server` variants (Task 2), `LightningAddressService` (Task 5), route rewire (Task 7), LN-server secrets placement → host-injected `ServerSdkConfig` (Tasks 6+7), rates conversion → injected `getExchangeRate` (Tasks 5+6), server spark mnemonic seam → `SparkMnemonicSource` (Tasks 3+6), `ReadUserRepository.getByUsername` server read → already in SDK (used in Task 5), gift-card/offer + token-claim orchestrators → documented out-of-scope (Final). LNURL types → Task 1.

**Placeholder scan:** No TBD/TODO; all code shown in full for new files; moves show exact before/after import blocks; commands have expected output.

**Type consistency:** `createServerSdk`/`ServerSdk`/`ServerSdkConfig` (Task 6) match the route usage (Task 7) and the `LightningAddressService` ctor (Task 5). `SparkMnemonicSource` (Task 3) is consumed by Task 6. The service's per-call method param objects (`{ username, baseUrl }`, `{ userId, amount, baseUrl, bypassAmountValidation }`, `{ encryptedQuoteData }`) match the route call sites. `encodeVerifyToken`/`decodeVerifyToken` (Task 4) are used by the service (Task 5).
