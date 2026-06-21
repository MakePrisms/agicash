# Wallet SDK — S14: server routes (Lightning-Address → `getServerSdk`) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut the three Lightning-Address React-Router routes over to the already-built server-mode SDK (`getServerSdk(domain)`), keeping the LUD JSON wire format + the `LNURL_SERVER_ENCRYPTION_KEY` xchacha verify-token route-side, then delete the now-dead `lightning-address-service.ts`, the four orphaned web `.server` receive repos/services, and `database.server.ts`.

**Architecture:** Slice S14 of the no-cache full migration (spec §9 Phase 2 — the server cut-over). The routes become thin adapters: derive the canonical origin per request, call one of the three `ServerSdk` operations, translate the SDK's structured results + thrown errors back into the exact LUD wire envelopes the old `LightningAddressService` produced. A new shared `.server.ts` codec module owns the xchacha20poly1305 verify-token (the SDK works with a structured `LnurlVerifyRef`, never the encrypted token — S10 D10-3). Web-only slice: NO SDK package changes.

**Tech Stack:** React Router v7 framework-mode loaders, `@agicash/wallet-sdk` (`getServerSdk`, `DomainError`, `NotFoundError`, `LnurlVerifyRef`), `@agicash/money`, `@scure/base` (`base64url`), `@noble/hashes/utils` (`hexToBytes`), the existing `~/lib/xchacha20poly1305` + `~/lib/lnurl/types` + `~/lib/canonical-origin.server`, `zod/mini`, `bun:test`.

## Global Constraints

- **Branch:** `sdk-nocache/full-migration` (auth-slice tip `b24dbf12`, UNPUSHED). bun/bunx only; `master` is the base branch; **do NOT push**.
- **No SDK changes.** S14 edits only `apps/web-wallet/app/**` (+ docs/memory). The `ServerSdk` surface is frozen as built in S10/S11.
- **Wire format is sacred.** Every LUD-16 / LUD-06 / LUD-21 response — success envelope, error envelope, field names, HTTP **200-even-on-error**, and the `Access-Control-Allow-Origin: *` CORS header — must be byte-identical to the old `LightningAddressService` output, with ONE accepted cosmetic exception (F5: the range-error max number loses its `toLocaleString` comma: `1,000,000` → `1000000`).
- **Money invariant.** The metadata host (drives the spark invoice `descriptionHash`) and the callback/verify URLs are TWO different derivations from one canonical origin — see Decisions F1.
- **Errors:** SDK `DomainError`/`NotFoundError` carry `(message, code)` and extend `SdkError` (`readonly code`); both are barrel-exported from `@agicash/wallet-sdk`.
- **Per-task gate:** `bun run fix:all` (biome, exit 0) + `bun run typecheck`; the whole-slice gate (Task 5) adds the web suite (`bun --filter=web-wallet run test`). No SDK suite (no SDK files touched). One git commit per task.

---

## Decisions (locked — carry, do NOT re-litigate)

- **F1 — Domain: `getCanonicalOrigin`, TWO derivations per request.**
  ```ts
  const origin = getCanonicalOrigin(new URL(request.url).origin); // full origin, scheme+host
  const domain = new URL(origin).host;                            // BARE host
  ```
  Pass **`domain`** (bare host, e.g. `agi.cash`) to `getServerSdk(domain)`. Build **callback/verify URLs from `origin`** (full, with scheme): `` `${origin}/api/lnurlp/callback/${userId}` `` and `` `${origin}/api/lnurlp/verify/${token}` ``. Passing `origin` as the domain would yield `alice@https://agi.cash` (corrupts metadata + descriptionHash); passing `domain` as a URL base would drop the scheme. This is a deliberate behavior change from the old service's raw `new URL(request.url).origin` — the rest of the app already commits to the canonical host for Lightning Addresses (client `use-sdk.ts` → `useLocationData` → root `domain`; settings/contacts `${username}@${domain}`).
- **F2 — Metadata-host equality is the money invariant.** The paying wallet checks the metadata host == the host it fetched LUD-16 from, and the spark invoice `descriptionHash = sha256(metadata)` commits to it. Acceptance test = `/lnurl-test` against **production** `https://agi.cash` (localhost can't exercise the prod branch of `getCanonicalOrigin` — the only branch where canonical ≠ raw origin).
- **F3 — `getServerSdk` singleton freeze: KEEP it.** It freezes `lud16Domain` on first call (warm Breez wallet reuse). Not poisonable in prod/preview (getCanonicalOrigin ignores the inbound host → returns the Vercel env var). Do NOT build per-request (would reconnect Breez every LNURL hit). Preview-only branch-URL drift is money-irrelevant.
- **F4 — Route-side error translation (the SDK THROWS where the old service RETURNED envelopes).** Each route wraps the SDK call in try/catch and emits `{status:'ERROR', reason}` (HTTP 200) preserving the exact old reason strings + `console.error('...', { cause: error })`:
  - LUD-16: `resolveLightningAddress` returns `null` → `'not found'`; any throw → `'Internal server error'`.
  - LUD-06: `DomainError` with `code === 'amount_out_of_range'` → `error.message`; `NotFoundError` → `'not found'` (**lowercase**); else → `'Internal server error'`. Keep the existing route-side `!amount || NaN` → `'Invalid amount'` pre-check (the SDK's BTC-Money range check does not cover NaN/missing). Do NOT add a route-side min/max pre-check (the SDK owns it).
  - LUD-21: `NotFoundError` → `'Not found'` (**Capital N**); token-decode failure / else → `'Internal server error'`.
- **F5 — `toLocaleString` comma drop: KEEP the SDK behavior** (accept `1000000`, not `1,000,000`). Display-only `ERROR.reason`, never parsed; the message now lives once in the SDK. Do NOT re-add `toLocaleString` route-side.
- **F6 — Verify-token codec: a shared `.server.ts` module with LAZY env read.** `createLnurlVerifyTokenCodec(keyHex)` factory + a lazy `getLnurlVerifyTokenCodec()` that reads+validates `LNURL_SERVER_ENCRYPTION_KEY` on first call (NOT a module-top `const`/throw — that breaks `bun test`, which has no `.env`; mirror `sdk.server.ts`'s lazy env). The `.server.ts` suffix is mandatory: it keeps the secret out of the client bundle AND avoids the flatRoutes route-capture trap (`app/routes.ts` `flatRoutes()` has no ignore → a `.server.ts` under `app/routes/` would be treated as a route).
- **F7 — Schema-drift compile-pin (honor D10-3: the schema stays route-side).** The codec's own `zod/mini` discriminated-union schema must produce exactly the SDK's `LnurlVerifyRef`; pin it by annotating `decode(...): LnurlVerifyRef` (imported as a type from `@agicash/wallet-sdk`) so tsc fails on drift. Do NOT add a runtime `LnurlVerifyRefSchema` to the SDK barrel.
- **F8 — Delete `database.server.ts`** (do not leave it orphaned). Accept the validation-timing shift: `SUPABASE_SERVICE_ROLE_KEY` now fails lazily on first LNURL request inside `createServerClient`; `VITE_SUPABASE_URL` loses its explicit guard (`@supabase/supabase-js` still throws on empty url). Drop `getQueryClient()` from all 3 routes (the SDK owns its warm spark wallet).

---

## Grounding facts (verified 2026-06-21 — authoritative)

**ServerSdk surface (`packages/wallet-sdk/src/server-sdk.ts`, barrel-exported):**
- `getServerSdk(lud16Domain: string): ServerSdk` — `app/features/shared/sdk.server.ts:89` (process-singleton, freezes domain on first call; currently UN-WIRED).
- `resolveLightningAddress(username) → { userId; username; minSendable: Money<'BTC'>; maxSendable: Money<'BTC'>; metadata: string } | null` (`:86-98`). NO `callback`, NO msat conversion.
- `createLightningReceiveQuote({ userId; amount: Money<'BTC'>; bypassAmountValidation? }) → { paymentRequest: string; verify: LnurlVerifyRef }` (`:100-140`). Throws `DomainError('Amount out of range. Min: 1 sats, Max: 1000000 sats.', 'amount_out_of_range')` (`:111-114`) and `NotFoundError('User not found', 'user_not_found')` (`:118`).
- `getLightningReceiveStatus(ref: LnurlVerifyRef) → { settled: boolean; preimage: string | null; paymentRequest: string }` (`:142-171`). Throws `NotFoundError(..., 'not_found')` for a missing spark request (`:160-164`).
- `LnurlVerifyRef = { type:'cashu'; quoteId: string; mintUrl: string } | { type:'spark'; quoteId: string }` (`:20-22`) — structurally identical to the old route-side schema.
- `DomainError` / `NotFoundError` exported from `@agicash/wallet-sdk` (`index.ts:56-57`); both extend `SdkError` with `readonly code: string` (`errors.ts:20`).

**Old code being replaced (`apps/web-wallet/app/features/receive/lightning-address-service.ts`):** the verify-token logic lives at `:42-46` (key), `:52-59` (schema), `:362-376` (encode/decode); the metadata host at `:354-360`; the LUD envelopes throughout.

**Stays (other live importers):** `~/lib/lnurl/types` (`LNURLPayParams`/`LNURLPayResult`/`LNURLVerifyResult`/`LNURLError`), `~/lib/xchacha20poly1305` (`encryptXChaCha20Poly1305`/`decryptXChaCha20Poly1305`), `~/lib/canonical-origin.server` (`getCanonicalOrigin`), `cashu-receive-quote-core.ts`, `user-repository.ts`, `shared/spark.ts`, `query-client.ts`.

**Routes run under `bun test`** (no jsdom; `bunfig.toml` `[test] root = ./app`) — tests must live under `app/`. The route loaders themselves are NOT unit-tested (they call `getServerSdk` which builds real connections / touches `process.env` / lazily connects Breez) — they are verified by `typecheck` + the deferred live `/lnurl-test` (F2). Only the codec (Task 1) is unit-tested.

---

## File Structure

**Created:**
- `app/features/receive/lnurl-verify-token.server.ts` — `createLnurlVerifyTokenCodec(keyHex)` + `getLnurlVerifyTokenCodec()` + `LnurlVerifyTokenCodec` type.
- `app/features/receive/lnurl-verify-token.server.test.ts` — round-trip + tamper tests (fixed key via the factory).

**Modified:**
- `app/routes/[.]well-known.lnurlp.$username.ts` — LUD-16 → `resolveLightningAddress`.
- `app/routes/api.lnurlp.callback.$userId.ts` — LUD-06 → `createLightningReceiveQuote` + verify-token encode.
- `app/routes/api.lnurlp.verify.$encryptedQuoteData.ts` — LUD-21 → verify-token decode + `getLightningReceiveStatus`.
- `app/features/agicash-db/database.client.ts:35` — fix the doc-comment referencing the deleted `agicashDbServer`.
- `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md` — flip the Plan 14 row + carryover (Task 6).
- `.claude/skills/lnurl-test/SKILL.md`, `.claude/skills/agicash-wallet-documentation/references/{lightning-address,cashu-lightning-receive,spark-operations}.md` — refresh the deleted-file references (Task 6).

**Deleted (Task 5):**
- `app/features/receive/lightning-address-service.ts`
- `app/features/receive/cashu-receive-quote-repository.server.ts`
- `app/features/receive/cashu-receive-quote-service.server.ts`
- `app/features/receive/spark-receive-quote-repository.server.ts`
- `app/features/receive/spark-receive-quote-service.server.ts`
- `app/features/agicash-db/database.server.ts`

---

## Task 1: Verify-token codec module (`lnurl-verify-token.server.ts`)

**Files:**
- Create: `app/features/receive/lnurl-verify-token.server.ts`
- Test: `app/features/receive/lnurl-verify-token.server.test.ts`

**Interfaces:**
- Consumes: `encryptXChaCha20Poly1305`/`decryptXChaCha20Poly1305` (`~/lib/xchacha20poly1305`); `base64url` (`@scure/base`); `hexToBytes` (`@noble/hashes/utils`); `z` (`zod/mini`); `LnurlVerifyRef` (type, `@agicash/wallet-sdk`).
- Produces: `type LnurlVerifyTokenCodec = { encode(ref: LnurlVerifyRef): string; decode(token: string): LnurlVerifyRef }`; `function createLnurlVerifyTokenCodec(keyHex: string): LnurlVerifyTokenCodec`; `function getLnurlVerifyTokenCodec(): LnurlVerifyTokenCodec`. Tasks 3 (encode) + 4 (decode) consume `getLnurlVerifyTokenCodec()`.

- [ ] **Step 1: Write the failing test** — `lnurl-verify-token.server.test.ts`. Imports ONLY the factory (a fixed 64-hex-char = 32-byte key) so the env-backed `getLnurlVerifyTokenCodec` never runs (hermetic).

```ts
import { describe, expect, it } from 'bun:test';
import { createLnurlVerifyTokenCodec } from './lnurl-verify-token.server';

// 32-byte symmetric key (64 hex chars) — xchacha20poly1305 requires exactly 32 bytes.
const KEY = '00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff';

describe('lnurl verify-token codec', () => {
  it('round-trips a spark ref', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    const ref = { type: 'spark', quoteId: 'rr-1' } as const;
    expect(codec.decode(codec.encode(ref))).toEqual(ref);
  });

  it('round-trips a cashu ref (with mintUrl)', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    const ref = { type: 'cashu', quoteId: 'mq-1', mintUrl: 'https://mint.test' } as const;
    expect(codec.decode(codec.encode(ref))).toEqual(ref);
  });

  it('produces a URL-safe base64url token', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    expect(codec.encode({ type: 'spark', quoteId: 'rr-1' })).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('throws decoding with the wrong key', () => {
    const a = createLnurlVerifyTokenCodec(KEY);
    const b = createLnurlVerifyTokenCodec(
      'ffeeddccbbaa99887766554433221100ffeeddccbbaa99887766554433221100',
    );
    const token = a.encode({ type: 'spark', quoteId: 'rr-1' });
    expect(() => b.decode(token)).toThrow();
  });

  it('throws decoding a malformed token', () => {
    const codec = createLnurlVerifyTokenCodec(KEY);
    expect(() => codec.decode('not-a-valid-token')).toThrow();
  });
});
```

- [ ] **Step 2: Run it; expect FAIL** — `bun --filter=web-wallet run test lnurl-verify-token` (or from `apps/web-wallet/`: `bun test app/features/receive/lnurl-verify-token.server.test.ts`). Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — `lnurl-verify-token.server.ts`. Port the old encode/decode byte-for-byte; add the factory + lazy accessor.

```ts
import { base64url } from '@scure/base';
import { hexToBytes } from '@noble/hashes/utils';
import type { LnurlVerifyRef } from '@agicash/wallet-sdk';
import { z } from 'zod/mini';
import {
  decryptXChaCha20Poly1305,
  encryptXChaCha20Poly1305,
} from '~/lib/xchacha20poly1305';

/**
 * The quote reference encrypted into the LUD-21 `verify` URL. Mirrors the SDK's
 * `LnurlVerifyRef`; kept route-side because the token is wire-transport
 * obfuscation, not SDK surface (S10 D10-3). `decode`'s return-type annotation
 * pins the schema to `LnurlVerifyRef` so tsc fails if the union ever drifts.
 */
const LnurlVerifyRefSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('spark'), quoteId: z.string() }),
  z.object({
    type: z.literal('cashu'),
    quoteId: z.string(),
    mintUrl: z.string(),
  }),
]);

export type LnurlVerifyTokenCodec = {
  encode(ref: LnurlVerifyRef): string;
  decode(token: string): LnurlVerifyRef;
};

/**
 * Build an xChaCha20-Poly1305 codec for the LNURL verify token (encrypt to
 * obfuscate the quote from the LNURL client, base64url for the URL path).
 * @param keyHex hex-encoded 32-byte symmetric key
 */
export function createLnurlVerifyTokenCodec(
  keyHex: string,
): LnurlVerifyTokenCodec {
  const key = hexToBytes(keyHex);
  return {
    encode(ref: LnurlVerifyRef): string {
      const data = new TextEncoder().encode(JSON.stringify(ref));
      return base64url.encode(encryptXChaCha20Poly1305(data, key));
    },
    decode(token: string): LnurlVerifyRef {
      const decrypted = decryptXChaCha20Poly1305(base64url.decode(token), key);
      return LnurlVerifyRefSchema.parse(
        JSON.parse(new TextDecoder().decode(decrypted)),
      );
    },
  };
}

let codec: LnurlVerifyTokenCodec | undefined;

/**
 * Process-singleton codec keyed by `LNURL_SERVER_ENCRYPTION_KEY`, read +
 * validated LAZILY on first call (never at import, so `bun test` stays hermetic
 * — tests use `createLnurlVerifyTokenCodec` directly).
 */
export function getLnurlVerifyTokenCodec(): LnurlVerifyTokenCodec {
  if (!codec) {
    const keyHex = process.env.LNURL_SERVER_ENCRYPTION_KEY;
    if (!keyHex) {
      throw new Error('LNURL_SERVER_ENCRYPTION_KEY is not set');
    }
    codec = createLnurlVerifyTokenCodec(keyHex);
  }
  return codec;
}
```

> If tsc rejects `decode(...): LnurlVerifyRef` because `zod/mini`'s `.parse` infers a structurally-identical-but-not-named type, that means the schema is still in sync (assignment must succeed for identical shapes) — re-check the schema matches the SDK union exactly; do NOT paper over it with `as LnurlVerifyRef` (that defeats the drift pin).

- [ ] **Step 4: Run it; expect PASS** — `bun test app/features/receive/lnurl-verify-token.server.test.ts` (from `apps/web-wallet/`). Expected: 5 pass.

- [ ] **Step 5: Gate + commit**

```bash
bun run fix:all && bun run typecheck
git add apps/web-wallet/app/features/receive/lnurl-verify-token.server.ts apps/web-wallet/app/features/receive/lnurl-verify-token.server.test.ts
git commit -m "$(cat <<'EOF'
feat(web): route-side LNURL verify-token codec (lazy-env, schema pinned to LnurlVerifyRef)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: LUD-16 route → `resolveLightningAddress`

**Files:**
- Modify (replace body): `app/routes/[.]well-known.lnurlp.$username.ts`

**Interfaces:**
- Consumes: `getServerSdk` (`~/features/shared/sdk.server`); `getCanonicalOrigin` (`~/lib/canonical-origin.server`); `LNURLPayParams`/`LNURLError` (`~/lib/lnurl/types`).
- Produces: a loader returning the LUD-16 JSON (no new exports).

- [ ] **Step 1: Replace the route** — full new file:

```ts
/**
 * This route implements the `/.well-known/lnurlp/$username` endpoint
 * defined by LUD 16: https://github.com/lnurl/luds/blob/luds/16.md
 */

import { getServerSdk } from '~/features/shared/sdk.server';
import { getCanonicalOrigin } from '~/lib/canonical-origin.server';
import type { LNURLError, LNURLPayParams } from '~/lib/lnurl/types';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const origin = getCanonicalOrigin(new URL(request.url).origin);
  const domain = new URL(origin).host;

  let body: LNURLPayParams | LNURLError;
  try {
    const info = await getServerSdk(domain).resolveLightningAddress(
      params.username,
    );
    body = info
      ? {
          callback: `${origin}/api/lnurlp/callback/${info.userId}`,
          maxSendable: info.maxSendable.toNumber('msat'),
          minSendable: info.minSendable.toNumber('msat'),
          metadata: info.metadata,
          tag: 'payRequest',
        }
      : { status: 'ERROR', reason: 'not found' };
  } catch (error) {
    console.error('Error processing LNURL-pay request', { cause: error });
    body = { status: 'ERROR', reason: 'Internal server error' };
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

> Field parity vs old (`lightning-address-service.ts:121-130, 114-119, 131-137`): `callback` from `origin` (not the old raw request origin — F1); `min/maxSendable` via `.toNumber('msat')` on the SDK `Money`; `metadata` verbatim from the SDK (F2 invariant); null → `'not found'`; throw → `'Internal server error'`. No `Money` import (the SDK returns `Money` instances).

- [ ] **Step 2: Gate + commit**

```bash
bun run fix:all && bun run typecheck
git add apps/web-wallet/app/routes/'[.]well-known.lnurlp.$username.ts'
git commit -m "$(cat <<'EOF'
feat(web): LUD-16 route -> sdk.resolveLightningAddress (canonical-origin callback)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: LUD-06 callback route → `createLightningReceiveQuote` + verify-token encode

**Files:**
- Modify (replace body): `app/routes/api.lnurlp.callback.$userId.ts`

**Interfaces:**
- Consumes: `Money` (`@agicash/money`); `DomainError`/`NotFoundError` (`@agicash/wallet-sdk`); `getServerSdk`; `getCanonicalOrigin`; `getLnurlVerifyTokenCodec` (Task 1); `LNURLPayResult`/`LNURLError`.
- Produces: a loader returning the LUD-06 JSON.

- [ ] **Step 1: Replace the route** — full new file:

```ts
/**
 * This route implements the lnurlp callback endpoint
 * defined by LUD 06: https://github.com/lnurl/luds/blob/luds/06.md
 */

import { Money } from '@agicash/money';
import { DomainError, NotFoundError } from '@agicash/wallet-sdk';
import { getLnurlVerifyTokenCodec } from '~/features/receive/lnurl-verify-token.server';
import { getServerSdk } from '~/features/shared/sdk.server';
import { getCanonicalOrigin } from '~/lib/canonical-origin.server';
import type { LNURLError, LNURLPayResult } from '~/lib/lnurl/types';
import type { Route } from './+types/api.lnurlp.callback.$userId';

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const amountMsat = url.searchParams.get('amount');
  const origin = getCanonicalOrigin(url.origin);

  let body: LNURLPayResult | LNURLError;

  if (!amountMsat || Number.isNaN(Number(amountMsat))) {
    body = { status: 'ERROR', reason: 'Invalid amount' };
  } else {
    try {
      const result = await getServerSdk(
        new URL(origin).host,
      ).createLightningReceiveQuote({
        userId: params.userId,
        amount: new Money({ amount: amountMsat, currency: 'BTC', unit: 'msat' }),
        bypassAmountValidation:
          url.searchParams.get('bypassAmountValidation') === 'true',
      });

      const token = getLnurlVerifyTokenCodec().encode(result.verify);
      body = {
        pr: result.paymentRequest,
        verify: `${origin}/api/lnurlp/verify/${token}`,
        routes: [],
      };
    } catch (error) {
      if (error instanceof DomainError && error.code === 'amount_out_of_range') {
        body = { status: 'ERROR', reason: error.message };
      } else if (error instanceof NotFoundError) {
        body = { status: 'ERROR', reason: 'not found' };
      } else {
        console.error('Error processing LNURL-pay callback', { cause: error });
        body = { status: 'ERROR', reason: 'Internal server error' };
      }
    }
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

> Field parity vs old (`lightning-address-service.ts:144-266` + the route's `:16-37`): the `!amount||NaN` → `'Invalid amount'` pre-check stays route-side (F4); `bypassAmountValidation` threaded from the query param; `pr` ← `result.paymentRequest`; `verify` ← `origin` + encoded token; `routes: []`. Error mapping per F4 (note `error.message` for the range case carries the SDK's `1000000` — F5, accepted). `console.error` only on the unknown branch (matches old: the range + not-found paths did not log).

- [ ] **Step 2: Gate + commit**

```bash
bun run fix:all && bun run typecheck
git add apps/web-wallet/app/routes/api.lnurlp.callback.\$userId.ts
git commit -m "$(cat <<'EOF'
feat(web): LUD-06 callback -> sdk.createLightningReceiveQuote + route verify-token encode

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: LUD-21 verify route → verify-token decode + `getLightningReceiveStatus`

**Files:**
- Modify (replace body): `app/routes/api.lnurlp.verify.$encryptedQuoteData.ts`

**Interfaces:**
- Consumes: `NotFoundError` (`@agicash/wallet-sdk`); `getServerSdk`; `getCanonicalOrigin`; `getLnurlVerifyTokenCodec` (Task 1); `LNURLVerifyResult`/`LNURLError`.
- Produces: a loader returning the LUD-21 JSON.

- [ ] **Step 1: Replace the route** — full new file:

```ts
/**
 * This route implements the LNURL-pay verify endpoint
 * defined by LUD21: https://github.com/lnurl/luds/blob/luds/21.md
 */

import { NotFoundError } from '@agicash/wallet-sdk';
import { getLnurlVerifyTokenCodec } from '~/features/receive/lnurl-verify-token.server';
import { getServerSdk } from '~/features/shared/sdk.server';
import { getCanonicalOrigin } from '~/lib/canonical-origin.server';
import type { LNURLError, LNURLVerifyResult } from '~/lib/lnurl/types';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ request, params }: Route.LoaderArgs) {
  const domain = new URL(getCanonicalOrigin(new URL(request.url).origin)).host;

  let body: LNURLVerifyResult | LNURLError;
  try {
    const ref = getLnurlVerifyTokenCodec().decode(params.encryptedQuoteData);
    const status = await getServerSdk(domain).getLightningReceiveStatus(ref);
    body = {
      status: 'OK',
      settled: status.settled,
      preimage: status.preimage,
      pr: status.paymentRequest,
    };
  } catch (error) {
    console.error('Error processing LNURL-pay verify', { cause: error });
    body = {
      status: 'ERROR',
      reason:
        error instanceof NotFoundError ? 'Not found' : 'Internal server error',
    };
  }

  return new Response(JSON.stringify(body), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

> Field parity vs old (`lightning-address-service.ts:273-352`): decode the token route-side → `ref`; map `paymentRequest` → `pr`; pass `settled`/`preimage` through unchanged (cashu `''`/`null`, spark `paymentPreimage ?? null` — all decided in the SDK); `NotFoundError` → `'Not found'` (Capital N), else `'Internal server error'`; log on every catch (matches old `:287`).

- [ ] **Step 2: Gate + commit**

```bash
bun run fix:all && bun run typecheck
git add apps/web-wallet/app/routes/api.lnurlp.verify.\$encryptedQuoteData.ts
git commit -m "$(cat <<'EOF'
feat(web): LUD-21 verify -> route verify-token decode + sdk.getLightningReceiveStatus

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Delete the dead server-LNURL code + fix the dangling comment + whole-slice gate

**Files:**
- Delete: `app/features/receive/lightning-address-service.ts`
- Delete: `app/features/receive/cashu-receive-quote-repository.server.ts`
- Delete: `app/features/receive/cashu-receive-quote-service.server.ts`
- Delete: `app/features/receive/spark-receive-quote-repository.server.ts`
- Delete: `app/features/receive/spark-receive-quote-service.server.ts`
- Delete: `app/features/agicash-db/database.server.ts`
- Modify: `app/features/agicash-db/database.client.ts:35`

**Interfaces:** none (removal only).

- [ ] **Step 1: Confirm nothing else imports the deletion targets** — from `apps/web-wallet/`:

```bash
grep -rn "lightning-address-service\|agicash-db/database.server\|receive-quote-repository.server\|receive-quote-service.server" app/ --include="*.ts" --include="*.tsx"
```
Expected: ZERO hits (Tasks 2-4 removed all route importers; the 4 `.server` files only cross-imported each other + the service). If any hit remains, STOP and resolve before deleting.

- [ ] **Step 2: Delete the six files**

```bash
git rm app/features/receive/lightning-address-service.ts \
       app/features/receive/cashu-receive-quote-repository.server.ts \
       app/features/receive/cashu-receive-quote-service.server.ts \
       app/features/receive/spark-receive-quote-repository.server.ts \
       app/features/receive/spark-receive-quote-service.server.ts \
       app/features/agicash-db/database.server.ts
```

- [ ] **Step 3: Fix the dangling doc-comment** — `app/features/agicash-db/database.client.ts:33-36`:

```ts
/**
 * The client-side Supabase database client.
 * For server-side DB access (bypassing RLS) use the server-mode SDK via
 * `getServerSdk` (`~/features/shared/sdk.server`).
 */
```

- [ ] **Step 4: Whole-slice gate** — from the worktree root:

```bash
bun run fix:all && bun run typecheck && bun --filter=web-wallet run test
```
Expected: `fix:all` exit 0 (catches any now-unused import the route rewrites left behind), typecheck green (web `react-router typegen && tsc` — no route-signature change), web suite green (129 baseline + 5 new codec tests = 134). Confirm the count rose only by the codec tests.

- [ ] **Step 5: Confirm the tree is clean of orphans**

```bash
git grep -n "LightningAddressService\|agicashDbServer" -- apps/web-wallet/app || echo "OK: no references to deleted symbols"
git status --short
```

- [ ] **Step 6: Commit**

```bash
git add apps/web-wallet/app/features/agicash-db/database.client.ts
git commit -m "$(cat <<'EOF'
refactor(web): delete server LightningAddressService + .server receive repos + database.server (folded into ServerSdk)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Docs, memory, and S15 carryover

**Files:**
- Modify: `docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md`
- Modify: `.claude/skills/lnurl-test/SKILL.md`
- Modify: `.claude/skills/agicash-wallet-documentation/references/lightning-address.md`
- Modify: `.claude/skills/agicash-wallet-documentation/references/cashu-lightning-receive.md`
- Modify: `.claude/skills/agicash-wallet-documentation/references/spark-operations.md`
- Memory only otherwise.

- [ ] **Step 1: Refresh the lnurl-test skill's implementation-files table** — in `.claude/skills/lnurl-test/SKILL.md`, replace the `app/features/receive/lightning-address-service.tsx | Core LNURL service` row (note it already has the wrong `.tsx` extension) with rows pointing at: the 3 routes (unchanged paths), `app/features/receive/lnurl-verify-token.server.ts` (verify-token codec), `app/features/shared/sdk.server.ts` (`getServerSdk`), and `packages/wallet-sdk/src/server-sdk.ts` (the three server ops). Update the skill `description` line if it names the deleted service.

- [ ] **Step 2: Refresh the architecture reference trees** — in each of `lightning-address.md`, `cashu-lightning-receive.md`, `spark-operations.md`, update the directory-tree diagrams that list `*-receive-quote-{repository,service}.server.ts` and `lightning-address-service.ts` to reflect their deletion and the `ServerSdk` path. (The historical `docs/superpowers/plans/*.md` are point-in-time records — leave them.)

- [ ] **Step 3: Flip the plan-of-plans Plan 14 row + add the carryover** — set the row to `✅ done` with a one-line summary, and add an `## Plan 14 → S15` carryover section recording: the S15-orphan list (`ReadUserDefaultAccountRepository` at `user-repository.ts:206`, the now-internal-only `sparkWalletQueryOptions` export), the optional boot-time `VITE_SUPABASE_URL` guard in `buildServerSdkConfig`, and the still-deferred `/lnurl-test` prod gate.

- [ ] **Step 4: Update the memories** — in `[[project-wallet-sdk-nocache-track]]` add the S14-done paragraph (tip, commits, what shipped, the F1 canonical-origin behavior change, the deletions, gate result, the deferred `/lnurl-test` gate); mark `[[project-wallet-sdk-s14-grounding]]` as EXECUTED.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-06-13-wallet-sdk-00-plan-of-plans.md docs/superpowers/plans/2026-06-13-wallet-sdk-14-server-routes.md .claude/skills/lnurl-test/SKILL.md .claude/skills/agicash-wallet-documentation/references/lightning-address.md .claude/skills/agicash-wallet-documentation/references/cashu-lightning-receive.md .claude/skills/agicash-wallet-documentation/references/spark-operations.md
git commit -m "$(cat <<'EOF'
docs(wallet-sdk): record S14 (server routes) done + S15 carryover; refresh LNURL skill/docs

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Behavioral gate (DEFERRED — folded into the combined F6 live gate)

Unit/typecheck/biome (Task 5) do NOT prove the money path. Before push/PR, run **`/lnurl-test` against production `https://agi.cash`** (F2 — localhost cannot exercise the prod branch of `getCanonicalOrigin`) for BOTH a Testnut (cashu) and a Spark default account, verifying:
- LUD-16: `callback`/`metadata` host = `agi.cash`; `min/maxSendable` = 1000 / 1000000000 msat.
- LUD-06: a valid `pr` + a reachable `verify` URL; out-of-range amount → `{status:'ERROR', reason:'Amount out of range. Min: 1 sats, Max: 1000000 sats.'}`; unknown username via the callback path → `{reason:'not found'}`.
- LUD-21: `{status:'OK', settled, preimage, pr}`; Testnut settles `true` after auto-pay, Spark stays `false`.
- The **metadata-host-equality / descriptionHash invariant** (F2): the spark invoice's `description_hash` matches `sha256(metadata)`.

This needs `VITE_BREEZ_API_KEY` + the live stack + the `LNURL_SERVER_*` env, and is **PENDING USER DECISION** (combined with the unrun S13 + auth-slice money-path gate). **Do NOT push the branch / open the PR until it runs + the user approves.**

---

## Self-Review

**1. Spec coverage** (plan-of-plans "Plan 10/11/12/13 → S14" carryovers): wire 3 routes → `getServerSdk(domain)` ✓ (T2-4); keep LUD JSON wire format + `LNURL_SERVER_ENCRYPTION_KEY` xchacha verify-token over `LnurlVerifyRef` ✓ (T1 codec + T3/T4); delete `lightning-address-service.ts` + `database.server.ts` (+ the 4 orphaned `.server` repos) ✓ (T5); domain via `getCanonicalOrigin` matching `root.tsx` precedence so the metadata/descriptionHash invariant holds ✓ (F1/F2); singleton freeze accepted ✓ (F3); latent USD-spark `bypassAmountValidation` guard is an SDK concern, untouched here (noted, out of scope).

**2. Placeholder scan:** every route + the codec is shown in full; the only "fill-in" is Task 6's prose doc edits (dir-trees vary by current file content) and the plan-of-plans carryover wording — both are doc text, not code. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency:** `getLnurlVerifyTokenCodec()` (T1) → consumed verbatim in T3 (`.encode`) + T4 (`.decode`); `LnurlVerifyRef` flows SDK → `result.verify` → `codec.encode` (T3) and `codec.decode` → `getLightningReceiveStatus` (T4); `DomainError`/`NotFoundError` imported from `@agicash/wallet-sdk` in T3/T4 match the barrel exports; `origin` (full) vs `domain` (host) used consistently per F1 across T2-T4; `Money` imported only where used (T3 msat parse); `LNURL*` wire types imported per route.

**Risks:** the single biggest one is the F1/F2 metadata-host invariant, only provable via the deferred prod `/lnurl-test`. The codec byte-compatibility (T1) is unit-proven. The deletions (T5) are grep-confirmed safe (only the 3 routes + the closed `.server` cluster).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-06-13-wallet-sdk-14-server-routes.md`.** Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, gate = `bun run fix:all` + `bun run typecheck` (+ web suite at Task 5), one commit per task, no push.
2. **Inline Execution** — execute tasks in this session via `superpowers:executing-plans` with checkpoints.

Note: the behavioral `/lnurl-test` gate is DEFERRED/PENDING USER DECISION (combined with the S13 + auth-slice money-path gate) — do not push/PR until it runs.
