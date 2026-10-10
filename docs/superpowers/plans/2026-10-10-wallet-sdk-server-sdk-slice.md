# Wallet SDK Server SDK Slice (Step 17) Implementation Plan

> **Orchestration note:** one whole-slice contribution job, after adversarial review of this plan. The implementer forks at the base of `sdk/server-sdk-slice` (off `master` at `85d3977`, the step-16 merge, PR #1191) and delivers the File map together. The orchestrator integrates, runs the Verification gates, then sends the diff to adversarial review. All `path:line` citations are valid at `85d3977`. Stack: TypeScript, bun, bun:test, Supabase, React Router v7 framework mode (`apps/web-wallet/package.json:73`, `@react-router/dev` `7.14.2` at `:82`). No React in the SDK.

**Goal:** Implement the pinned `ServerSdk` (`packages/wallet-sdk/domain/sdk/server.ts:14–48`) as `AgicashServerSdk`, and point the three Lightning-address routes at it. `LightningAddressService` stays the implementation: config-injected, no `Request`, no module-scope env. `baseUrl` and `bypassAmountValidation` become per-call params. Response bodies stay byte-identical, including LUD-06 / LUD-16 / LUD-21 envelope differences. Delete `temporary.server.ts` and web `database.server.ts`. The package root stays `.server`-free.

**Architecture:** Step 17 of the no-cache extraction (`docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md:68–109`, step 17 at `:95`). `ServerSdk` is a separate class from the client runtime (`:52–53`). The contract trust model is service-role, no user session, per-request scope (`server.ts:10–13`; proposal `docs/superpowers/specs/2026-07-02-wallet-sdk-contract-proposal.md:422–460`). The web host assembles `ServerSdkConfig` once per process and calls the three methods. Quote create/read `.server` twins stay where they are; this slice does not split them (step 18, design `:100–107`).

## Global constraints

- **No contract drift.** `domain/sdk/server.ts` is not edited. `ServerSdkConfig`, `ServerSdk`, and `ServerSdkConstructor` are implemented as written. `AgicashServerSdk` is assignable to `ServerSdkConstructor` (`server.ts:45–48`). An extra `dispose()` on the class is recorded in decision 3; it is not added to the `ServerSdk` type.
- **Conventions** (`contract-proposal.md:297–324`) stay binding for the client SDK. This surface is the documented server exception: `userId` is a callback param because there is no session (`server.ts:32–34`, `:11–12`); fetch-by-id is reserved for server routes (`contract-proposal.md:312–316`); `handleLnurlpCallback` persists a receive quote and is not renamed to `create*` (the pinned method names win). Completion verbs (`fail` / `complete` / `expire`) are not added. No SDK events (`domain/sdk/events.ts` untouched). No `auth`, no `taskProcessor` (`server.ts:10–13`).
- React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`. No schema, RPC, dependency, or migration changes. The server repositories already omit `p_purpose` / `p_transfer_id` (`cashu-receive-quote-repository.server.ts:85–95`, `spark-receive-quote-repository.server.ts:81–91`); the SQL default `'PAYMENT'` stays (`packages/wallet-sdk/db/supabase/migrations/20260420152512_denormalize_account_on_transactions.sql:58`, `:178`). Do not pass `purpose` or `transferId`. No `bun add`, no `db:generate-types`.
- **Client module graph stays `.server`-free.** The runtime pulls `cashu-receive-quote-*.server.ts` and `spark-receive-quote-*.server.ts` (`lightning-address-service.ts:26–29`). That graph is reachable only from the package export `./server`. `packages/wallet-sdk/index.ts` and `domain/sdk/index.ts` stay byte-identical (`packages/wallet-sdk/index.ts:10` already re-exports the type-only `domain/sdk/server.ts` via `domain/sdk/index.ts:27`). Proof gate: `cd apps/web-wallet && bun run build` (`apps/web-wallet/package.json:5–7`).
- Only File-map files change. `bun` / `bunx` only. Base: `master` at `85d3977`. Work branch: `sdk/server-sdk-slice`. Biome `recommended` is on (`biome.jsonc:22`), including `noUnusedVariables` / `noUnusedImports` (`:64`, `:68`). Do not use the `delete` operator.
- `minSendable` / `maxSendable` stay hardcoded (`contract-proposal.md:458`; `lightning-address-service.ts:90–99`). The host still parses the millisat query string into `Money<'BTC'>` (`contract-proposal.md:459–461`; `api.lnurlp.callback.$userId.ts:16–34`).

## Resolved design decisions

Letters j, l, and m are the parity section, the lettered tests in Task 1, and the File map plus Verification table.

1. **(a) Runtime home is `@agicash/wallet-sdk/server`, class name `AgicashServerSdk`.** The web client imports `AgicashSdk` from the package root (`apps/web-wallet/app/features/shared/sdk.client.ts:2`). `index.ts:10–11` re-exports `./domain/sdk` and the class. A value export added to `domain/sdk/server.ts` or `domain/sdk/sdk.ts` would ride that root entry into the client graph, and the service imports `.server` modules (`lightning-address-service.ts:26–29`). `./temporary.server` exists so those modules stay out of the client graph (`temporary.server.ts:1–4`, `packages/wallet-sdk/package.json:9`, `packages/wallet-sdk/package.json:15`). **Rejected:** exporting the runtime from `.` / `index.ts`. **Rejected:** naming the class `ServerSdk`. That name is the instance type (`server.ts:26–43`); the client precedent is `AgicashSdk implements Sdk` (`sdk.ts:51`) with `static create` (`sdk.ts:202`). The class lives in `domain/sdk/server-sdk.ts`. `packages/wallet-sdk/server.ts` is the thin export entry, same role as `temporary.server.ts:5`. `static create(config: ServerSdkConfig): AgicashServerSdk` satisfies `ServerSdkConstructor`. **No contract deviation:** `domain/sdk/server.ts` is not edited.

2. **(b) Keep `LightningAddressService`; inject config; per-call `baseUrl` and `bypassAmountValidation`.** The three handlers share db, spark config, the encryption key, min/max, and the user repository (`lightning-address-service.ts:62–100`). The contract namespace is those three methods (`server.ts:27–42`). **Rejected:** free functions. They would either close over the same fields or thread config through every call, and the pinned signatures do not take config. The constructor loses `request`, the module-scope env (`:31–44`), and the `options` bag (`:80–82`). `this.baseUrl` (`:89`) and `this.bypassAmountValidation` (`:88`) are deleted. `handleLud16Request` and `handleLnurlpCallback` take the contract's object params (`server.ts:28–37`). `handleLnurlpVerify` takes `{ encryptedQuoteData }` only (`:39–41`); verify does not read `baseUrl` today (`:270–292`). `bypassAmountValidation ?? false` matches `:88`. Method bodies, return-object key order, `console.error` strings, and the cashu description-hash comment (`:189–190`) stay. The NUT comment is a protocol quirk and stays.

   Envelopes the new code must return unchanged. JSON key order is the object-literal order (what `JSON.stringify` emits). HTTP status stays the route default 200 (`new Response(...)` with no `status`).

   | Surface | Condition | Body | Source |
   |---|---|---|---|
   | LUD-16 success | user row exists | `{ callback, maxSendable, minSendable, metadata, tag: 'payRequest' }` — no `status` | `lightning-address-service.ts:122–128` |
   | LUD-16 missing user | `getByUsername` returns null (`.maybeSingle()`, `user-repository.ts:347`) | `{ status: 'ERROR', reason: 'not found' }` | `:112–117` |
   | LUD-06 unknown userId | `get` throws — `.single()` errors on zero rows (`user-repository.ts:329–333`), so the `if (!user)` at `:159–164` is unreachable dead code that stays verbatim (plan-attack C1) | `{ status: 'ERROR', reason: 'Internal server error' }` | `:256–262` |
   | LUD-16 internal | lookup throws | `{ status: 'ERROR', reason: 'Internal server error' }` | `:129–135` |
   | LUD-06 range | amount &lt; 1 sat or &gt; 1_000_000 sat | `{ status: 'ERROR', reason: 'Amount out of range. Min: 1 sats, Max: ' + (1000000).toLocaleString() + ' sats.' }` | `:146–153`, min/max at `:90–99` |
   | LUD-06 internal | anything else thrown | `{ status: 'ERROR', reason: 'Internal server error' }` | `:256–262` |
   | LUD-06 success | quote created | `{ pr, verify, routes: [] }` — no `status` | `:215–219` cashu, `:251–255` spark |
   | LUD-21 cashu settled | mint state `PAID` or `ISSUED` | `{ status: 'OK', settled: true, preimage: '', pr }` — `preimage` is the empty string | `:301–307` |
   | LUD-21 cashu unsettled | any other mint state | `{ status: 'OK', settled: false, preimage: null, pr }` | `:310–315` |
   | LUD-21 spark | receive request found | `{ status: 'OK', settled, preimage, pr }` with `settled === (status === 'transferCompleted')` and `preimage: paymentPreimage ?? null` | `:338–345` |
   | LUD-21 missing spark request | `getLightningReceiveRequest` returns null | `{ status: 'ERROR', reason: 'Not found' }` — capital N | `:332–335` thrown `NotFoundError`, mapped at `:285–289` |
   | LUD-21 other failure | decrypt, zod, or any non-`NotFoundError` | `{ status: 'ERROR', reason: 'Internal server error' }` | `:283–290` |
   | Route only, not the SDK | callback `amount` missing or `Number(amount)` is `NaN` | `{ status: 'ERROR', reason: 'Invalid amount' }` | `api.lnurlp.callback.$userId.ts:18–27` |

   `console.error` first arguments stay `'Error processing LNURL-pay request'` (`:130`), `'Error processing LNURL-pay callback'` (`:257`), `'Error processing LNURL-pay verify'` (`:284`), each with `{ cause: error }`. LUD-16 `callback` is `` `${baseUrl}/api/lnurlp/callback/${user.id}` `` (`:119`). LUD-06 `verify` is `` `${baseUrl}/api/lnurlp/verify/${encryptedQuoteData}` `` (`:217`, `:253`). Metadata stays `JSON.stringify([['text/plain', \`Pay to ${address}\`], ['text/identifier', address]])` with `address = \`${username}@${new URL(baseUrl).host}\`` (`:348–353`). `maxSendable` is `1_000_000` sat converted with `toNumber('msat')` = `1000000000`; `minSendable` is `1` sat = `1000` msat (`money.ts:145–148` factor `1e-8`, `:175–178` factor `1e-11`). Range uses `lessThan` / `greaterThan` (`lightning-address-service.ts:147–148`), so 1 sat and 1_000_000 sat are inside the range. `toLocaleString()` is called with no locale argument (`:151`).

3. **(c) Host module `apps/web-wallet/app/features/shared/sdk.server.ts`, throw-at-import, singleton in `create` plus this module.** Style template is `sdk.client.ts` (module-scope reads, throw if empty, one `create` call, `import.meta.hot.dispose`). The `.server.ts` suffix is what keeps a client import illegal; the three routes already import `database.server.ts` the same way. Field map:

   | `ServerSdkConfig` field | Source | Empty check, current message |
   |---|---|---|
   | `db.url` | `import.meta.env.VITE_SUPABASE_URL` | `'VITE_SUPABASE_URL is not set'` (`database.server.ts:4–7`). Raw string. Do not use `getSupabaseUrl` from `sdk.client.ts:5–24` (that rewrites `127.0.0.1` from `window`, and importing `sdk.client.ts` pulls `AgicashSdk`). |
   | `db.serviceRoleKey` | `process.env.SUPABASE_SERVICE_ROLE_KEY` | `'SUPABASE_SERVICE_ROLE_KEY is not set'` (`database.server.ts:9–12`) |
   | `spark.breezApiKey` | `breezApiKey` from `~/lib/breez` | `'VITE_BREEZ_API_KEY is not set'` (`breez.ts:1–4`), thrown by that module |
   | `spark.network` | literal `'MAINNET'` | no env var. Decision 4. |
   | `spark.mnemonic` | `process.env.LNURL_SERVER_SPARK_MNEMONIC` | `'LNURL_SERVER_SPARK_MNEMONIC is not set'` (`lightning-address-service.ts:31–34`). Keep `\|\| ''` then `if (!sparkMnemonic)`. |
   | `spark.storageDir` | literal `'/tmp/.spark-data'` | all three routes (`[.]well-known.lnurlp.$username.ts:15`, `api.lnurlp.callback.$userId.ts:42`, `api.lnurlp.verify.$encryptedQuoteData.ts:17`) |
   | `quoteEncryptionKey` | `process.env.LNURL_SERVER_ENCRYPTION_KEY` | `'LNURL_SERVER_ENCRYPTION_KEY is not set'` (`lightning-address-service.ts:40–43`). Keep `\|\| ''`. Pass the hex string through. `hexToBytes` stays in the service constructor (`:44`), so a non-empty bad hex still throws while `sdk.server.ts` is evaluating. |

   **Throw-at-import, not lazy-at-first-request.** Today's throws are top-level, in modules the routes import at top level (`[.]well-known.lnurlp.$username.ts:6–8` and the same two imports in the other routes), so they run when the route module evaluates, before the loader. Production evaluates the server build at process start (`apps/web-wallet/app/server.ts:36–39`, the `await import(...)` branch). Dev evaluates `virtual:react-router/server-build` on `ssrLoadModule` (`server.ts:37–38`). `@react-router/dev@7.14.2` `getServerEntry` emits a static `import * as routeN from "<route>"` for every route (published plugin; `node_modules` is not in git; version pin `apps/web-wallet/package.json:82`). SSR is on (`react-router.config.ts:15`) and prerender loads that build (`:26–36`), so a missing variable fails `bun run build` the same way it fails boot. `sdk.server.ts` keeps the checks at module scope and calls `AgicashServerSdk.create` at module scope. **Rejected:** reading env inside the loader or on first method call. The failure would move from module evaluation to a JSON handler, and a missing `LNURL_SERVER_*` would no longer take down server-build evaluation.

   **Singleton.** `AgicashServerSdk.create` stores one instance and throws on a second call until `dispose()`, copying `AgicashSdk` (`sdk.ts:40–44`, `:202–209`, cleared at `:225–231`). The message is `'An AgicashServerSdk instance already exists in this process. dispose() it before creating another.'` `dispose()` only clears that slot. It does not call `clearSparkWallets` (`wallet.ts:150–152`); an HMR dispose must not drop the Breez memo. `dispose` is not added to `ServerSdk` (`server.ts:26–43` has no lifecycle method). `sdk.server.ts` exports `const serverSdk = AgicashServerSdk.create(...)` guarded by a `globalThis` dev handle: `(globalThis as { agicashServerSdk?: AgicashServerSdk }).agicashServerSdk?.dispose()` runs before `create`, and the new instance is stored back on that handle after (plan-attack I1). Reason: dev serves SSR through `viteDevServer.ssrLoadModule` (`apps/web-wallet/app/server.ts:36–39`), where `import.meta.hot` is **undefined**, so an HMR dispose hook would never register; vite invalidation is upward-only, so editing `sdk.server.ts` (or `~/lib/breez.ts`) re-evaluates `sdk.server.ts` while the cached `server-sdk.ts` module still holds `currentInstance` — a bare second `create` would throw at module scope and break every SSR request until restart (`tsx watch` does not watch vite-loaded modules). The handle is a no-op in prod and at build (fresh process, single evaluation). **Rejected:** `import.meta.hot.dispose` mirroring `sdk.client.ts:78–82` — dead code under `ssrLoadModule`. **Rejected:** `create` returning the first instance and ignoring a second config (a wrong key would stick). **Rejected:** no process guard, host module only. The type comment is `Singleton per process` (`server.ts:45`), and `AgicashSdk.create` is the precedent that already has tests (`sdk.test.ts:33–46`).

   **Import-order note.** ESM evaluates static imports before the module body, in source order. Today the first route import is `temporary.server` → the service module, which throws the mnemonic error before `database.server.ts` and before `breez.ts`. After this flip the service module does not read env. `sdk.server.ts` therefore checks mnemonic, then encryption key, then `VITE_SUPABASE_URL`, then `SUPABASE_SERVICE_ROLE_KEY` in its body, and its static import of `~/lib/breez` runs before that body. The one observable change: if `VITE_BREEZ_API_KEY` is unset along with another variable, the breez message (`breez.ts:3`) wins instead of the mnemonic message. Each message is unchanged when that variable is the one that is unset. The client cannot boot without the breez key either (`sdk.client.ts:3`). **Rejected:** top-level `await import('~/lib/breez')` to preserve the multi-unset order. It makes the host module async for a process that fails either way.

4. **(d) Server-wallet network comes from `ServerSdkConfig.spark.network`, and the web passes `'MAINNET'`.** The only network literal in the LNURL service is the verify `getSparkWallet` call (`lightning-address-service.ts:321–326`). `SparkWalletConfig` has `storageDir` and `apiKey` only (`lib/spark/wallet.ts:17–22`); the routes never passed a network. `getSparkWallet` lowercases `SparkNetwork` (`wallet.ts:123`). The callback path does not use this literal: `ReadUserDefaultAccountRepository` initializes the user's spark wallet with `data.details.network` (`user-repository.ts:288–307`). Provisioning writes `'MAINNET'` (`user-api.ts:34`). The client SDK passes the same literal (`sdk.client.ts:72`). There is no env var. `sdk.server.ts` sets `network: 'MAINNET'`. The service forwards `config.spark.network` into verify's `getSparkWallet`. **Rejected:** leaving `'MAINNET'` inside the service. The contract field would be dead, and a test could not tell. **Rejected:** using `config.spark.network` as the user's account network inside `ReadUserDefaultAccountRepository`. That would change a `REGTEST` account row. Do not edit `user-repository.ts`. Latent divergence, recorded (plan-attack M9): the callback issues the invoice on the ACCOUNT ROW's network (`user-repository.ts:288–291`) while verify opens the wallet for `config.spark.network`; both are `'MAINNET'` today (`user-api.ts:34`; host literal), and a future mismatch yields verify `'Not found'`. Not addressed in this slice.

5. **(e) The singleton does not add per-request work.**

   | Resource | Master | After |
   |---|---|---|
   | Supabase client | one per process, module scope (`database.server.ts:18–26`), schema `'wallet'`, service-role key, no `accessToken` | one, built inside `AgicashServerSdk.create` with those same `createClient` options |
   | `getSparkWallet` | process map keyed `${sha256(mnemonic)}:${network}:${storageDir}` (`wallet.ts:99–144`); failed connect evicted (`:140–142`); `apiKey` is not part of the key | same function, same key when mnemonic, `'MAINNET'`, and `'/tmp/.spark-data'` are unchanged |
   | `getCashuWallet` | new wallet every verify call, no memo (`packages/cashu/src/utils.ts:272–286`; call site `lightning-address-service.ts:298`) | same call, still per verify |
   | `ExchangeRateService` | constructed per request (`lightning-address-service.ts:84`); providers only, no rate cache (`exchange-rate-service.ts:11–20`) | once per process. Do not add a cache |
   | `ReadUserRepository` | constructed per request (`:86`) | once per process. It only holds `db` (`user-repository.ts:311`) |
   | `ReadUserDefaultAccountRepository` | constructed inside the callback (`lightning-address-service.ts:166–170`) | still inside the callback, every call, on the production path |
   | Cashu/spark quote service + repository | constructed inside the matching branch (`:197–199`, `:222–224`); one spark service instance does both `getLightningQuote` and `createReceiveQuote` | same, on the production path |
   | `baseUrl`, `bypassAmountValidation` | instance fields set from that request's `Request` (`:88–89`) | arguments. Two overlapping calls cannot clobber each other (`server.ts:36–37`) |

   `createAgicashDbClient` is the wrong constructor: it always sets `accessToken` (`db/client.ts:12–19`). Do not edit `db/client.ts`. Build the service-role client in `server-sdk.ts`.

6. **(f) Deletions are `temporary.server.ts`, its `package.json` export and comment, and web `database.server.ts`.** Importers of `LightningAddressService` / `temporary.server` are the three routes (`[.]well-known.lnurlp.$username.ts:6`, `api.lnurlp.callback.$userId.ts:7`, `api.lnurlp.verify.$encryptedQuoteData.ts:6`). Importers of `agicashDbServer` are the same three routes. `temporary.ts` is not edited. `Database` stays exported (`temporary.ts:17`) because `database.client.ts:1` still imports it. `ReadUserDefaultAccountRepository` stays exported (`temporary.ts:102`); it already has no web importer, and this slice does not prune pre-existing dead exports. After the flip the only `agicashDbServer` hit left in the repo is the comment at `database.client.ts:9`. Do not edit that file.

7. **(g) Routes keep response shaping; they pass origin and, on the callback, `Money`.** Pinned loaders are below. `new URL(request.url).origin` is what the service stored (`lightning-address-service.ts:89`). The callback uses the `url` it already parsed (`api.lnurlp.callback.$userId.ts:15`), so `baseUrl: url.origin`. Amount parsing stays in the callback, including passing the query string (not `Number(...)`) into `Money` (`:30–34`); `new Big` accepts that string (`money.ts:270`). `bypassAmountValidation` stays `searchParams.get('bypassAmountValidation') === 'true'` (`:36–37`) and is always passed, including `false`. Verify stops taking `request`; it was only used to build `baseUrl`, which verify does not read. CORS headers and `JSON.stringify(response)` stay on the route. No `status` field is added to the `Response`.

8. **(h) SDK tests do not call Breez or a mint.** Pattern for the service file: colocated `bun:test` like `packages/wallet-sdk/domain/exchange-rate/exchange-rate-service.test.ts`. Pattern for the constructor: `sdk.test.ts:33–46` (`try/finally` `dispose()`). Optional second constructor argument `deps` (pinned below) is the seam. Production `AgicashServerSdk` does not pass `deps`. The service test file static-imports `lightning-address-service.ts` without setting `LNURL_SERVER_SPARK_MNEMONIC` or `LNURL_SERVER_ENCRYPTION_KEY`; if the module-scope throw remains, the file fails to load. That is test (s).

   Verify-blob fixture, produced by the base encrypt steps (`lightning-address-service.ts:356–359`): `JSON.stringify` of the object literal, `TextEncoder`, `encryptXChaCha20Poly1305` (`packages/utils/src/xchacha20poly1305.ts:13–23`), `base64url.encode` from `@scure/base` (import at `lightning-address-service.ts:15`). Library versions are the workspace catalog pins (root `package.json:12`, `:14`, `:15`: `@noble/ciphers` `1.3.0`, `@noble/hashes` `1.8.0`, `@scure/base` `2.0.0`). Key hex `1111111111111111111111111111111111111111111111111111111111111111` (32 bytes of `0x11`). The nonce is random (`xchacha20poly1305.ts:17`), so the assertion is decrypt-these-bytes, not re-encrypt-and-compare. Plaintext and ciphertext:

   - spark plaintext `{"type":"spark","quoteId":"srv-quote-1"}` → `eFJ9LwX3hcc3SIpRzfnItaAQ1CwHgFG83EWC3YEpt0rgxTUquRBqhl2pqf8UvmfV9fpXMWcsUMNh8G_dby5XmKUep27-jNxrY7x5S3LaJ-E=`
   - cashu plaintext `{"type":"cashu","quoteId":"mint-quote-1","mintUrl":"https://mint.example"}` → `9lhIjEaNYq99oEC_CCyx8bXuI8tWxVR2KSTt7X_ZgFByMdbkjDY8RVKYdliK9r_riz0BH8IU6SUiZi5TodfChS86A0Q_1yX3OH0cqLSgdQ4ElCmgo3y4fwTxg9gLc0oFdvb0as7IweVaXnkgOWlenen6`

   Those plaintexts are the `JSON.stringify` of the object literals the service encrypts (`:209–213`, `:246–249`). Tests drive decrypt through `handleLnurlpVerify` and observe the quote id / mint URL the wallet seam receives (test m), so a private reimplementation of decrypt in the test does not count.

9. **(i) Smoke is split.** Orchestrator curls do not need Breez, a mint, or a funded wallet. Maintainer curls are the ones that create an invoice. Details in Verification. `bun run dev` is the root script (`package.json:30`), which runs the web server via tsx (`apps/web-wallet/package.json:9`).

10. **(k) No session fences on this surface.** Client fences exist because namespaces close over a user session (`contract-proposal.md:299–301`; template `send-api.ts` as used by step 16). These routes are public LUD endpoints: no auth cookie, service-role key, anon+RLS would return nothing (`contract-proposal.md:452–454`). `ServerSdk` has no `auth`, `events`, or `taskProcessor` (`server.ts:10–13`). Per-request scope is the two params that used to be instance fields (`server.ts:36–37`), not an `AbortSignal`. Today `get` / `getByUsername` are called with one argument (`lightning-address-service.ts:110`, `:157`) even though the repository accepts `abortSignal` (`user-repository.ts:320–321`, `:338–340`). Do not thread a signal. Do not throw `SessionEndedError`. There is no session to end.

11. **Cashu quote lookup stays the core function; spark quote lookup stays the server-twin method.** Cashu callback calls `getLightningQuote` from `cashu-receive-quote-core` (`lightning-address-service.ts:21`, `:191–195`) and uses `CashuReceiveQuoteServiceServer` only for `createReceiveQuote` (`:197–207`). The cashu server service has no `getLightningQuote` (`cashu-receive-quote-service.server.ts:32`). Spark uses one `SparkReceiveQuoteServiceServer` for both (`lightning-address-service.ts:222–244`), and that class delegates `getLightningQuote` to core (`spark-receive-quote-service.server.ts:36–39`). Do not edit either `.server` twin. Do not pass `description` on either quote call. Cashu omits it (`:191–195`, comment `:189–190`). Spark passes `descriptionHash` and not `description` (`:226–236`).

## Pinned seams (authoritative for the implementation)

### `packages/wallet-sdk/server.ts` (new)

```ts
// Server-only runtime. Kept off the package root so the `.server` receive-quote
// twins this graph imports never enter the client module graph.
export { AgicashServerSdk } from './domain/sdk/server-sdk';
```

### `packages/wallet-sdk/domain/sdk/server-sdk.ts` (new)

```ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../../db/database';
import { LightningAddressService } from '../receive/lightning-address-service';
import type { ServerSdk, ServerSdkConfig } from './server';

let currentInstance: AgicashServerSdk | undefined;

/** Runtime for `ServerSdkConstructor`. One instance per process until `dispose()`. */
export class AgicashServerSdk implements ServerSdk {
  readonly lightningAddress: ServerSdk['lightningAddress'];

  private constructor(config: ServerSdkConfig) {
    const db = createClient<Database>(
      config.db.url,
      config.db.serviceRoleKey,
      {
        db: { schema: 'wallet' },
      },
    );
    const service = new LightningAddressService({
      db,
      spark: {
        apiKey: config.spark.breezApiKey,
        network: config.spark.network,
        mnemonic: config.spark.mnemonic,
        storageDir: config.spark.storageDir,
      },
      quoteEncryptionKey: config.quoteEncryptionKey,
    });
    this.lightningAddress = {
      handleLud16Request: (params) => service.handleLud16Request(params),
      handleLnurlpCallback: (params) => service.handleLnurlpCallback(params),
      handleLnurlpVerify: (params) => service.handleLnurlpVerify(params),
    };
  }

  /** Sync; no I/O. Throws while an undisposed instance exists. */
  static create(config: ServerSdkConfig): AgicashServerSdk {
    if (currentInstance) {
      throw new Error(
        'An AgicashServerSdk instance already exists in this process. dispose() it before creating another.',
      );
    }
    currentInstance = new AgicashServerSdk(config);
    return currentInstance;
  }

  /** Drops the process slot so a later `create` can run. Does not disconnect Breez. */
  dispose(): void {
    if (currentInstance === this) {
      currentInstance = undefined;
    }
  }
}
```

Let `bun run fix:all` fix import order. The facade is an object literal so the class's `dispose` is not part of `lightningAddress`, and so `this` inside the service stays the service.

### Service (`packages/wallet-sdk/domain/receive/lightning-address-service.ts`)

Delete lines 31–44 (both env reads, both throws, `encryptionKeyBytes`, `getSparkWalletMnemonic`). The file must contain no `process.env`.

Add:

```ts
export type LightningAddressServiceConfig = {
  db: AgicashDb;
  spark: {
    apiKey: string;
    network: SparkNetwork;
    mnemonic: string;
    storageDir: string;
  };
  /** Hex. `hexToBytes` runs in the constructor. */
  quoteEncryptionKey: string;
};

export type LightningAddressDeps = {
  userRepository?: Pick<ReadUserRepository, 'get' | 'getByUsername'>;
  exchangeRateService?: Pick<ExchangeRateService, 'getRate'>;
  createDefaultAccountRepository?: (
    db: AgicashDb,
    getSparkWalletMnemonic: () => Promise<string>,
    sparkConfig: SparkWalletConfig,
  ) => Pick<ReadUserDefaultAccountRepository, 'getDefaultAccount'>;
  getCashuLightningQuote?: typeof getLightningQuote;
  createCashuReceiveQuote?: (
    params: Parameters<
      CashuReceiveQuoteServiceServer['createReceiveQuote']
    >[0],
  ) => Promise<unknown>;
  getSparkLightningQuote?: (
    params: Parameters<SparkReceiveQuoteServiceServer['getLightningQuote']>[0],
  ) => ReturnType<SparkReceiveQuoteServiceServer['getLightningQuote']>;
  createSparkReceiveQuote?: (
    params: Parameters<
      SparkReceiveQuoteServiceServer['createReceiveQuote']
    >[0],
  ) => Promise<unknown>;
  getCashuWallet?: typeof getCashuWallet;
  getSparkWallet?: typeof getSparkWallet;
};
```

Imports, pinned (plan-attack M2/I2): keep the existing `type SparkWalletConfig` import (`lightning-address-service.ts:19`) — the factory seam uses it; add `import type { SparkNetwork } from '../../db/json-models/spark-account-details-db-data'` (the path `user-repository.ts:13` and `domain/sdk/server.ts:8` already use) for `LightningAddressServiceConfig.spark.network`. `ReadUserDefaultAccountRepository` stays a value import. Test files import `RedactedAccount` from `../accounts/account` for their `as RedactedAccount` fixtures. Do not add a dependency.

Constructor becomes `(config: LightningAddressServiceConfig, deps?: LightningAddressDeps)`. It still assigns `db`, builds `ReadUserRepository` unless `deps.userRepository` is set, builds `ExchangeRateService` unless `deps.exchangeRateService` is set, and builds the same `minSendable` / `maxSendable` (`:90–99`). It stores `apiKey`, `network`, `mnemonic`, `storageDir` from `config.spark`, and `encryptionKeyBytes = hexToBytes(config.quoteEncryptionKey)`. It stores `deps` (default `{}`). It does not store `baseUrl` or `bypassAmountValidation`. It does not call `getSparkWallet` or `getCashuWallet`.

Signatures:

```ts
async handleLud16Request(params: {
  username: string;
  baseUrl: string;
}): Promise<LNURLPayParams | LNURLError>

async handleLnurlpCallback(params: {
  userId: string;
  amount: Money<'BTC'>;
  baseUrl: string;
  bypassAmountValidation?: boolean;
}): Promise<LNURLPayResult | LNURLError>

async handleLnurlpVerify(params: {
  encryptedQuoteData: string;
}): Promise<LNURLVerifyResult | LNURLError>
```

Substitutions inside the existing bodies, and nowhere else:

- `this.baseUrl` → the `baseUrl` param. `buildLnurlpMetadata(username: string, baseUrl: string)` uses `new URL(baseUrl).host`.
- `this.bypassAmountValidation` → `params.bypassAmountValidation ?? false`, still in the `getDefaultAccount` currency argument (`:175–178`).
- The default-account lookup goes through the factory seam (plan-attack I2): `const repository = (this.deps.createDefaultAccountRepository ?? defaultCreateDefaultAccountRepository)(this.db, () => Promise.resolve(this.mnemonic), { storageDir: this.storageDir, apiKey: this.apiKey })` then `repository.getDefaultAccount(userId, bypass ? undefined : 'BTC')`, invoked on EVERY callback — per-callback construction is pinned by test (v). The module-level default is `const defaultCreateDefaultAccountRepository = (db: AgicashDb, getSparkWalletMnemonic: () => Promise<string>, sparkConfig: SparkWalletConfig) => new ReadUserDefaultAccountRepository(db, getSparkWalletMnemonic, sparkConfig)`.
- Cashu `getLightningQuote({ wallet, amount, xPub })` argument object stays (`:191–195`). Callee is `this.deps.getCashuLightningQuote ?? getLightningQuote`.
- Cashu `createReceiveQuote` argument object stays (`:201–207`). If `this.deps.createCashuReceiveQuote` is set, call it with that object and do not construct the service. Otherwise keep `new CashuReceiveQuoteServiceServer(new CashuReceiveQuoteRepositoryServer(this.db))`.
- Spark: if BOTH spark seams are set, call them and do not construct `SparkReceiveQuoteServiceServer`; tests must set both or neither — a single seam is ignored and the real service would run against the test db (plan-attack M7). Otherwise keep one service instance and both calls. The `getLightningQuote` argument object stays (`:231–236`), including `descriptionHash` and `receiverIdentityPublicKey`, and not `description`. The `createReceiveQuote` argument object stays (`:238–244`).
- Verify cashu: `const wallet = (this.deps.getCashuWallet ?? getCashuWallet)(mintUrl)`.
- Verify spark:

```ts
const wallet = await (this.deps.getSparkWallet ?? getSparkWallet)({
  network: this.network,
  mnemonic: this.mnemonic,
  storageDir: this.storageDir,
  apiKey: this.apiKey,
});
```

- `encryptLnurlVerifyQuoteData` / `decryptLnurlVerifyQuoteData` use `this.encryptionKeyBytes`. Payload object literals stay (`:209–213`, `:246–249`). Schema stays (`:50–57`).

`handleLnurlpCallback` reads `user.encryptionPublicKey`, `user.cashuLockingXpub`, `user.username`, and `user.sparkIdentityPublicKey` as it does now. Do not add fields to those calls.

### `packages/wallet-sdk/package.json`

In `exports`, delete `"./temporary.server"` and add `"./server": "./server.ts"` (after `"./gift-card-config"`, before `"./temporary"`). In `exports:comments`, delete the `./temporary.server` entry and add:

```json
"./server": "Server-only runtime (AgicashServerSdk). Imports the Lightning-address service, which pulls the `.server` receive-quote twins. Not on the package root: the client graph imports `.` and must not reach those modules."
```

Leave `.`, `./gift-card-config`, and `./temporary` as they are.

### `apps/web-wallet/app/features/shared/sdk.server.ts` (new)

```ts
import { AgicashServerSdk } from '@agicash/wallet-sdk/server';
import { breezApiKey } from '~/lib/breez';

const sparkMnemonic = process.env.LNURL_SERVER_SPARK_MNEMONIC || '';
if (!sparkMnemonic) {
  throw new Error('LNURL_SERVER_SPARK_MNEMONIC is not set');
}

const quoteEncryptionKey = process.env.LNURL_SERVER_ENCRYPTION_KEY || '';
if (!quoteEncryptionKey) {
  throw new Error('LNURL_SERVER_ENCRYPTION_KEY is not set');
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? '';
if (!supabaseUrl) {
  throw new Error('VITE_SUPABASE_URL is not set');
}

const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
if (!supabaseServiceRoleKey) {
  throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set');
}

export const serverSdk = AgicashServerSdk.create({
  db: {
    url: supabaseUrl,
    serviceRoleKey: supabaseServiceRoleKey,
  },
  spark: {
    breezApiKey,
    network: 'MAINNET',
    mnemonic: sparkMnemonic,
    storageDir: '/tmp/.spark-data',
  },
  quoteEncryptionKey,
});
devHandle.agicashServerSdk = serverSdk;
```

with, directly above the `create` call (after the env checks):

```ts
const devHandle = globalThis as { agicashServerSdk?: AgicashServerSdk };
devHandle.agicashServerSdk?.dispose();
```

`breezApiKey` is a static import, so `breez.ts` evaluates before these checks (decision 3). Separate statements — `noAssignInExpressions` is an error (`biome.jsonc:72`).

### Routes

Keep each file's leading LUD comment.

`apps/web-wallet/app/routes/[.]well-known.lnurlp.$username.ts` loader:

```ts
import { serverSdk } from '~/features/shared/sdk.server';
import type { Route } from './+types/[.]well-known.lnurlp.$username';

export async function loader({ request, params }: Route.LoaderArgs) {
  const response = await serverSdk.lightningAddress.handleLud16Request({
    username: params.username,
    baseUrl: new URL(request.url).origin,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

`apps/web-wallet/app/routes/api.lnurlp.callback.$userId.ts` loader. The amount-invalid branch stays byte-identical (`api.lnurlp.callback.$userId.ts:12–29`). Replace the service construction and call with:

```ts
  const response = await serverSdk.lightningAddress.handleLnurlpCallback({
    userId,
    amount,
    baseUrl: url.origin,
    bypassAmountValidation,
  });
```

Imports become `Money` from `@agicash/money`, `serverSdk` from `~/features/shared/sdk.server`, and the `Route` type. Drop `LightningAddressService`, `agicashDbServer`, and `breezApiKey`.

`apps/web-wallet/app/routes/api.lnurlp.verify.$encryptedQuoteData.ts` loader:

```ts
import { serverSdk } from '~/features/shared/sdk.server';
import type { Route } from './+types/api.lnurlp.verify.$encryptedQuoteData';

export async function loader({ params }: Route.LoaderArgs) {
  const { encryptedQuoteData } = params;

  const response = await serverSdk.lightningAddress.handleLnurlpVerify({
    encryptedQuoteData,
  });

  return new Response(JSON.stringify(response), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
```

### Canary (`temporary.server.ts` and `database.server.ts`)

Delete both files. Then grep, scoped `grep -rn <pattern> apps packages --exclude-dir=node_modules` — `docs/` and `.claude/` hits are historical plans/skills and expected (plan-attack M1):

- `temporary.server` — zero hits.
- `LightningAddressService` — the class, its test, and `server-sdk.ts` only. No `apps/` hit.
- `agicashDbServer` — only the `database.client.ts:9` comment.
- `from '@agicash/wallet-sdk/server'` — only `sdk.server.ts`.
- `process.env` inside `lightning-address-service.ts` — zero hits.
- `this.baseUrl` and `this.bypassAmountValidation` inside `lightning-address-service.ts` — zero hits.

## File map

Modify `packages/wallet-sdk/domain/receive/lightning-address-service.ts`, `packages/wallet-sdk/package.json`, `apps/web-wallet/app/routes/[.]well-known.lnurlp.$username.ts`, `apps/web-wallet/app/routes/api.lnurlp.callback.$userId.ts`, `apps/web-wallet/app/routes/api.lnurlp.verify.$encryptedQuoteData.ts`. Create `packages/wallet-sdk/server.ts`, `packages/wallet-sdk/domain/sdk/server-sdk.ts`, `packages/wallet-sdk/domain/sdk/server-sdk.test.ts`, `packages/wallet-sdk/domain/receive/lightning-address-service.test.ts`, `apps/web-wallet/app/features/shared/sdk.server.ts`. Delete `packages/wallet-sdk/temporary.server.ts`, `apps/web-wallet/app/features/agicash-db/database.server.ts`.

Untouched: `packages/wallet-sdk/index.ts`, `domain/sdk/index.ts`, `domain/sdk/server.ts`, `domain/sdk/sdk.ts`, `domain/sdk/events.ts`, `temporary.ts`, `db/client.ts`, `lib/spark/wallet.ts`, both cashu and spark `*.server.ts` twins, `user-repository.ts`, `apps/web-wallet/app/features/shared/sdk.client.ts`, `apps/web-wallet/app/lib/breez.ts`, `apps/web-wallet/app/features/agicash-db/database.client.ts`, every RPC and migration, the contract-proposal doc.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The commit that adds this document is the pinned base of the implementation job (`sdk/server-sdk-slice` off `85d3977`). The implementation job appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the File-map paths, applying the pinned seams. Working order:

1. **Read first:** `domain/sdk/server.ts`, `lightning-address-service.ts`, the three route files, `database.server.ts`, `sdk.client.ts`, `breez.ts`, `db/client.ts`, `lib/spark/wallet.ts` (`SparkWalletConfig`, `getSparkWallet`), `user-repository.ts` `ReadUserDefaultAccountRepository` (`:208–308`) and `ReadUserRepository` (`:311–355`), `cashu-receive-quote-service.server.ts`, `spark-receive-quote-service.server.ts`, `temporary.server.ts`, `package.json` exports. Annotate every nested callback param in test fixtures (TS7006).
2. **Service refactor** (pinned seams). Production path with `deps` omitted must construct the same objects as today.
3. **Tests.** No live Breez, no mint, no supabase. `db: {} as AgicashDb` whenever a seam covers the db. Service config in tests uses `network: 'REGTEST'` so a leftover `'MAINNET'` literal fails (q). `quoteEncryptionKey` is the fixture key. `mnemonic: 'mnemonic-from-config'`, `storageDir: '/tmp/test-spark'`, `apiKey: 'test-api-key'`. Callback tests (i)–(l) and (v) supply `createDefaultAccountRepository` returning `{ getDefaultAccount }` (plan-attack I2); a reference to "the `getDefaultAccount` seam" below means that returned method. Console spies use the house form `spyOn(console, 'error').mockImplementation(() => undefined)` (`transfer-api.test.ts:1027–1029`) — `() => {}` violates `noEmptyBlockStatements` (`biome.jsonc:83`); restore in `finally`/`afterEach` (plan-attack M8). Pin `const walletMarker = {}` with no extra properties — a propertied marker makes the `as RedactedAccount` cast a TS2352 error (plan-attack N4).

   - **(a) LUD-16 success, per-call baseUrl, no shared state.** `getByUsername` returns a user for `'alice'` (`id: 'user-1'`, `username: 'alice'`) and `'bob'` (`id: 'user-2'`). `Promise.all` two `handleLud16Request` calls on one instance: alice + `https://a.example`, bob + `https://b.example`. Alice's result `toEqual` `{ callback: 'https://a.example/api/lnurlp/callback/user-1', maxSendable: 1000000000, minSendable: 1000, metadata: '[["text/plain","Pay to alice@a.example"],["text/identifier","alice@a.example"]]', tag: 'payRequest' }`. `Object.keys` equals `['callback', 'maxSendable', 'minSendable', 'metadata', 'tag']`. Bob's callback host is `b.example` and the metadata identifier is `bob@b.example`. Neither result has `status`.
   - **(b) LUD-16 not found.** `getByUsername` resolves `null`. `{ status: 'ERROR', reason: 'not found' }`. `Object.keys` equals `['status', 'reason']`.
   - **(c) LUD-16 internal.** `getByUsername` throws `error = new Error('db down')`. Reason `'Internal server error'`. `console.error` called with `'Error processing LNURL-pay request'` and `{ cause: error }` (`toBe` the same error). Spy and restore.
   - **(d) Below min.** Amount `new Money({ amount: 999, currency: 'BTC', unit: 'msat' })`. Reason equals `` `Amount out of range. Min: 1 sats, Max: ${(1_000_000).toLocaleString()} sats.` ``. `get` and `getByUsername` are not called.
   - **(e) Above max.** Amount `1_000_000_001` msat. Same reason. No user lookup.
   - **(f) Bounds are inclusive.** `1000` msat and `1_000_000_000` msat do not take the range branch. `get` records its `userId` and throws `new Error('no rows')` (`.single()` semantics, `user-repository.ts:329–333`): both amounts return `{ status: 'ERROR', reason: 'Internal server error' }`, and `get` was called once per amount — proof the range branch was not taken (plan-attack C1).
   - **(g) Removed (plan-attack C1).** `get` never resolves `null` (`user-repository.ts:319–336`; `.single()` throws on zero rows), so a LUD-06 `'not found'` envelope is unreachable on master; unknown-userId behavior is (h)'s internal-error envelope. The dead `if (!user)` at `:159–164` stays verbatim.
   - **(h) LUD-06 internal.** `get` throws. Reason `'Internal server error'`. `console.error` first arg `'Error processing LNURL-pay callback'`.
   - **(i) `bypassAmountValidation` is per call.** `get` returns a user. `getDefaultAccount` records `(userId, currency)` and then throws, so quote creation does not run. That call sits inside the existing `try` (`lightning-address-service.ts:156`), so the throw becomes the internal-error envelope; assert the recordings, not `rejects.toBe`. Use a distinct `userId` per call. On one instance, `Promise.all` a bypass-`true` call and a bypass-`false` call, then a third call that omits the field. The `true` call records `undefined`; the `false` call and the omitted call record `'BTC'`. `args.length === 2` on every call (the currency argument is passed, not dropped). Correlate by `userId`, not by `Promise.all` completion order.
   - **(j) Cashu callback success, no mint.** Amount `1000` msat (so no FX). `getDefaultAccount` returns `{ type: 'cashu', currency: 'BTC', id: 'acct-1', mintUrl: 'https://mint.example', wallet: walletMarker } as RedactedAccount`. `getCashuLightningQuote` records its argument and resolves `{ mintQuote: { quote: 'mint-quote-1', request: 'lnbc1cashu' } }`. `createCashuReceiveQuote` records its argument and resolves. Assert the quote callee received `wallet` `toBe` `walletMarker`, `amount` `toBe` the Money passed in, `xPub` `toBe` the user's `cashuLockingXpub`, and `Object.keys` of that argument sorted equals `['amount', 'wallet', 'xPub']`. Create-params `userId`, `userEncryptionPublicKey` `toBe` the user's key, `account` `toBe` the account, `receiveType === 'LIGHTNING'`, `lightningQuote` `toBe` the quote object. Sorted keys equal `['account', 'lightningQuote', 'receiveType', 'userEncryptionPublicKey', 'userId']` (no `purpose`, no `transferId`). Result `toEqual` a subset is not enough: `pr === 'lnbc1cashu'`, `routes` deep-equals `[]`, `Object.keys` equals `['pr', 'verify', 'routes']`, no `status`. `verify` starts with `https://pay.example/api/lnurlp/verify/`. `getRate`, spark seams, and `getSparkWallet` are not called. `getDefaultAccount` second arg is `'BTC'`.
   - **(k) Spark callback success.** Account `{ type: 'spark', currency: 'BTC', id: 'acct-s', wallet: walletMarker }`. `getSparkLightningQuote` resolves `{ id: 'srv-quote-9', invoice: { paymentRequest: 'lnbc1spark' } }`. Same create-param key set and `receiveType === 'LIGHTNING'`. `descriptionHash` equals `bytesToHex(sha256(new TextEncoder().encode(metadata)))` for username `alice` and `baseUrl` `https://pay.example` (metadata string from (a)'s shape). Sorted keys of the quote argument equal `['amount', 'descriptionHash', 'receiverIdentityPublicKey', 'wallet']`. `wallet` `toBe` `walletMarker` (plan-attack N4). `receiverIdentityPublicKey` `toBe` the user's `sparkIdentityPublicKey`. Result `pr === 'lnbc1spark'`, `routes` deep-equals `[]`. Take that `verify` path segment and call `handleLnurlpVerify`; the spark wallet seam's `getLightningReceiveRequest` receives `{ requestId: 'srv-quote-9' }`. Cashu seams are not called.
   - **(l) FX only when currencies differ.** Bypass `true`. `getDefaultAccount` returns a cashu account with `currency: 'USD'`. `getRate` records the ticker and resolves `'1'`. `getCashuLightningQuote` records its argument and resolves a quote with `mintQuote.quote` / `mintQuote.request`; `createCashuReceiveQuote` resolves. The recorded quote `amount.currency === 'USD'`. `getRate` was called once with `'BTC-USD'`. Do not pin the converted number. (j) already asserts a BTC account does not call `getRate`.
   - **(m) Frozen blobs decrypt.** Service config key is the fixture key. Cashu fixture: `getCashuWallet` receives `'https://mint.example'` and `checkMintQuoteBolt11` receives `'mint-quote-1'`, then returns `{ state: 'UNPAID', request: 'lnbc-old' }`. Result is the unsettled LUD-21 envelope with that `pr`. Spark fixture: `getSparkWallet` is invoked and `getLightningReceiveRequest` receives `{ requestId: 'srv-quote-1' }`. Wallet identity can return null so the reason is `'Not found'` — the request id is the decrypt assertion.
   - **(n) Garbage verify.** `encryptedQuoteData: '%%%%'`. Reason `'Internal server error'`. `console.error` first arg `'Error processing LNURL-pay verify'`. Neither wallet seam is called.
   - **(o) Spark not found vs other errors.** Fresh spark payload (encrypt via the (k) verify URL, or the fixture). `getLightningReceiveRequest` resolves `null`. Reason `'Not found'`, not `'not found'`. A thrown `new Error('boom')` from the wallet yields `'Internal server error'`. `console.error` is called on BOTH paths with `'Error processing LNURL-pay verify'` — master logs before mapping (`:284`), and a quiet-not-found refactor must fail (plan-attack N6).
   - **(p) Cashu verify envelopes.** `checkMintQuoteBolt11` returns `request: 'lnbc-c'`. State `'PAID'` → `{ status: 'OK', settled: true, preimage: '', pr: 'lnbc-c' }`, keys `['status', 'settled', 'preimage', 'pr']`, `preimage` `toBe('')`. State `'ISSUED'` → same with `settled: true`. State `'UNPAID'` → `settled: false`, `preimage` `toBe(null)`.
   - **(q) Spark verify envelope and config forwarding.** `getSparkWallet` argument `toEqual` `{ network: 'REGTEST', mnemonic: 'mnemonic-from-config', storageDir: '/tmp/test-spark', apiKey: 'test-api-key' }`. Receive request `{ status: 'transferCompleted', paymentPreimage: 'ab', invoice: 'lnbc-s' }` → `{ status: 'OK', settled: true, preimage: 'ab', pr: 'lnbc-s' }`. A second call with `status: 'pending'` and `paymentPreimage` omitted → `settled: false`, `preimage: null`, `pr` the invoice. `status === 'transferCompleted'` is the only settled check.
   - **(r) Roundtrip the service just encrypted.** From (j), take the verify path segment, call `handleLnurlpVerify`, and assert the cashu wallet saw `quoteId === 'mint-quote-1'` and `mintUrl === 'https://mint.example'`. This is the new-code encrypt/decrypt pair. (m) is the old-blob pair. Both are required.
   - **(s) Module import does not read LNURL env.** The test file's top import of the service runs with `LNURL_SERVER_SPARK_MNEMONIC` and `LNURL_SERVER_ENCRYPTION_KEY` unset. No `beforeAll` sets them. A constructor call with the fixture key does not throw. `getSparkWallet` is not called from the constructor (assert in (a), which never verifies). The test body first asserts `expect(process.env.LNURL_SERVER_SPARK_MNEMONIC).toBeUndefined()` and the same for `LNURL_SERVER_ENCRYPTION_KEY`, so a polluted shell fails loudly instead of passing vacuously (plan-attack M5); the canary grep "no `process.env` in the service" stays the authoritative gate.
   - **(t) `ServerSdkConstructor` pin and singleton.** In `server-sdk.test.ts`:

```ts
import type { ServerSdkConstructor } from './server';
import { AgicashServerSdk } from './server-sdk';

const serverSdkConstructor: ServerSdkConstructor = AgicashServerSdk;
void serverSdkConstructor;
```

     `create` with `db: { url: 'http://127.0.0.1:54321', serviceRoleKey: 'service-role-test' }`, spark `{ breezApiKey: 'k', network: 'MAINNET', mnemonic: 'mn', storageDir: '/tmp/test-spark' }`, and the fixture `quoteEncryptionKey`. The return is not a Promise (`expect(sdk.lightningAddress).toBeDefined()` without `await` on `create`). All three methods are `'function'`. A second `create` throws `/dispose\(\)/`. `dispose()` then `create` again succeeds, and that instance is `dispose()`d in `finally`. Two I/O-free facade calls prove forwarding and `this` binding (plan-attack M6): an out-of-range callback amount returns the range envelope (`:146–154`), and `handleLnurlpVerify({ encryptedQuoteData: '%%%%' })` returns `'Internal server error'` (console spied per M8). The invalid-hex case runs AFTER the `finally` dispose, when no instance exists (otherwise the singleton throw masks it): `'zz'` as `quoteEncryptionKey` throws `/hex/` from `create()` synchronously, and a following valid `create` succeeds — the slot stayed empty because `currentInstance` is assigned only after the constructor returns. A well-formed hex of the WRONG length passes `hexToBytes` and fails only at first encrypt/decrypt, same as master (plan-attack N5) — not asserted.
   - **(u) No web test file.** The invalid-amount envelope is route-local and is smoke step 2. Web unit tests stay the existing 40.
   - **(v) Factory wiring (plan-attack I2).** Two sequential callbacks (any outcome) call `createDefaultAccountRepository` twice — per-callback construction pinned. On each call: `db` `toBe` the config db; `await getSparkWalletMnemonic()` resolves `'mnemonic-from-config'`; `sparkConfig` `toEqual({ storageDir: '/tmp/test-spark', apiKey: 'test-api-key' })`.

4. **Web module and route flip** (pinned seams).
5. **Delete** `temporary.server.ts` and `database.server.ts`. Run the canary greps.

Gates are the Verification table. `bun run fix:all` is repo-wide `biome check --write`; revert any path outside the File map. The delivered diff equals the File map.

**Task 2 (local, orchestrator):** merge, re-run the gates, run the orchestrator smoke, and check the parity tables.

**Task 3 (marketplace): adversarial review.** Check: `domain/sdk/server.ts` and `index.ts` byte-identical; `AgicashServerSdk` assignable to `ServerSdkConstructor`; runtime not exported from `.`; `./temporary.server` gone; `temporary.ts` unchanged; service has no `process.env`, no `this.baseUrl`, no `this.bypassAmountValidation`; verify `getSparkWallet` receives `config.spark.network`; web passes `'MAINNET'` and `'/tmp/.spark-data'`; service-role client has schema `'wallet'` and no `accessToken`; `createAgicashDbClient` unused by this path; per-call baseUrl and bypass (tests a, i); envelope strings including `'not found'` vs `'Not found'`, cashu `preimage: ''` vs `null`, `routes: []`; fixture blobs decrypt (m) and a fresh blob roundtrips (r); callback still builds `Money` and still returns `'Invalid amount'` before the SDK; `ReadUserDefaultAccountRepository` still constructed per callback on the production path (factory default + test (v)); account-row network still used there (`user-repository.ts` untouched); the `globalThis` dev handle disposes the prior instance before `create` in `sdk.server.ts` (I1); LUD-06 unknown-userId stays the internal-error envelope (C1); no `purpose` / `transferId` added; no session fence and no `AbortSignal` added; `dispose` does not call `clearSparkWallets`; client build is the `.server` gate. Confirmed findings go back through the orchestrator.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, lockfile unchanged |
| Lint/format + write | `bun run fix:all` | exit 0; only the File-map paths modified |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun run test` | green (271 `it`/`test` calls at `85d3977` + the lettered additions) |
| Web unit tests | `cd apps/web-wallet && bun run test` | green (40 at the pin; no new web test) |
| Client graph | `cd apps/web-wallet && bun run build` | exit 0. Proof the client bundle does not reach `.server` modules. Precondition: `apps/web-wallet/.env` present (gitignored; copy from `.env.example`) — prerender evaluates the server build and needs the same env as boot; if it fails, run master's build first as the control. Local-only gate: CI (`.github/workflows/ci.yml`) runs no build; Vercel does on merge (plan-attack M4) |
| Smoke | `bun run dev`, curl | orchestrator steps below |

`bun run test` in each package runs that package's `test` script (`packages/wallet-sdk/package.json:19`, `apps/web-wallet/package.json:12`); bare `bun test` is Bun's unscoped built-in runner and is not used (plan-attack N1). `bun run build` runs `react-router build` and the server bundle (`apps/web-wallet/package.json:6–8`). Prerender (`react-router.config.ts:26–36`) loads the server build, which evaluates route modules, so the build needs the same env a boot needs. That is true on master today.

**Smoke** (`bun run dev`, local Supabase). Names the process needs, from `apps/web-wallet/.env.example` (values stay in that file; do not copy them into the diff): `VITE_SUPABASE_URL` (`:2`), `VITE_SUPABASE_ANON_KEY` (`:3`), `SUPABASE_SERVICE_ROLE_KEY` (`:4`), `VITE_OPEN_SECRET_CLIENT_ID` (`:6`), `VITE_OPEN_SECRET_API_URL` (`:7`), `LNURL_SERVER_SPARK_MNEMONIC` (`:14`), `LNURL_SERVER_ENCRYPTION_KEY` (`:15`), `VITE_BREEZ_API_KEY` (`:22`). If any is unset, the first request fails while the server build evaluates, before a LUD JSON body. That matches master.

Orchestrator (no Breez, no mint, no payment). Base `http://127.0.0.1:3000`. Every response is HTTP 200 with `Content-Type: application/json` and `Access-Control-Allow-Origin: *`.

1. **Boot.** `bun run dev` answers step 2. A failure here is module-eval env, not the slice's JSON.
2. **Invalid amount, no I/O.** `curl -i 'http://127.0.0.1:3000/api/lnurlp/callback/00000000-0000-0000-0000-000000000000?amount=abc'` → `{"status":"ERROR","reason":"Invalid amount"}`. Missing `amount` does the same. `amount=1` (1 msat) → `{"status":"ERROR","reason":"Amount out of range. Min: 1 sats, Max: 1,000,000 sats."}` when `toLocaleString` groups with commas; otherwise the max segment equals `(1000000).toLocaleString()` and the rest of the sentence matches. No supabase query is required for these three: range and invalid-amount return before lookup (`lightning-address-service.ts:146–154`, route `:18–27`).
2b. **Dev re-evaluation (plan-attack I1).** With `bun run dev` still running, `touch apps/web-wallet/app/features/shared/sdk.server.ts`, then repeat step 2. Same JSON — the `globalThis` handle disposes the previous instance when vite re-evaluates the module (`import.meta.hot` is undefined under `ssrLoadModule`; without the handle this edit would brick every SSR request).
3. **Unknown user, LUD-16.** `curl -i http://127.0.0.1:3000/.well-known/lnurlp/no-such-user` → `{"status":"ERROR","reason":"not found"}`. One supabase read, no Breez, no mint. Needs local supabase.
4. **Unknown user, LUD-06.** `curl -i 'http://127.0.0.1:3000/api/lnurlp/callback/00000000-0000-0000-0000-000000000000?amount=10000'` → `{"status":"ERROR","reason":"Internal server error"}` — `ReadUserRepository.get` uses `.single()` and throws on zero rows (`user-repository.ts:329–333`), on master and after the flip (plan-attack C1). One `users` read.
5. **Garbage verify.** `curl -i http://127.0.0.1:3000/api/lnurlp/verify/not-a-blob` → `{"status":"ERROR","reason":"Internal server error"}`. No Breez.
6. **LUD-16 success, if a username exists.** `curl -i http://127.0.0.1:3000/.well-known/lnurlp/<username>` → `tag` `"payRequest"`, `minSendable` `1000`, `maxSendable` `1000000000`, `callback` `http://127.0.0.1:3000/api/lnurlp/callback/<userId>`, metadata containing `text/identifier`. No `status`. If the local database has no username, skip and say so. Do not require signup.

Maintainer live gate (real Breez, and optionally the test mint). A provisioned user's `default_currency` is `'BTC'` (`20260112150000_initial_db.sql:943`) and the default BTC account is the spark account named Bitcoin (`user-api.ts:29–36`). The default callback therefore calls Breez `receivePayment` (`spark-receive-quote-core.ts:237–245`). That is not an orchestrator step.

7. **Spark invoice (maintainer).** Callback `?amount=10000` for a real user id → HTTP 200, `pr` starting with `lnbc`, `verify` under `/api/lnurlp/verify/`, `routes` `[]`, no `status`. One Breez receive (plus the wallet-init `getInfo` inside `getDefaultAccount` — plan-attack M3), one `create_spark_receive_quote`, the user and default-account reads. No `accounts` list, no Open Secret. The invoice is a MAINNET invoice (plan-attack M9).
8. **Spark verify unpaid (maintainer).** GET that `verify` URL → `{"status":"OK","settled":false,...}` with the same `pr` and `preimage` null. Paying the invoice is real sats and is not required for this slice.
9. **Cashu / testnut (maintainer, only after the user points the default at Testnut BTC or sets default currency to USD).** Invoice then comes from the mint (`cashu-receive-quote-core.ts:268`), not Breez. After the test mint's auto-settle, verify returns `settled: true` and `preimage: ""`. Skip if the default was not switched.

## Foreground parity accounting

The flipped routes add **zero** network requests versus master. The singleton removes per-request object construction that did not perform I/O (decision 5). `ExchangeRateService` gains no cache, so a cross-currency callback still does one rate fetch (`exchange-rate-service.ts:80` via `lightning-address-service.ts:182–185`).

Module-load: master evaluates `temporary.server` → `lightning-address-service.ts` (env throws, `:31–44`) and `database.server.ts` (env throws, `:4–12`) and `breez.ts` because the server build static-imports every route and the routes import those modules. After, the routes import `sdk.server.ts`, which evaluates the server SDK (service + `.server` twins + one `createClient`) and the same breez module. The client bundle does not gain this graph: the routes have no component export, and `sdk.server.ts` is a `.server` module. `bun run build` is the check. `getSparkWallet`'s connect stays once per process (`wallet.ts:119–121`). `getCashuWallet` stays once per verify (`utils.ts:272–286`).

### A. `GET /.well-known/lnurlp/:username`

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Supabase `users` by username | 1 | 1 | `ReadUserRepository.getByUsername` (`user-repository.ts:338–354`) |
| Breez / mint / exchange rate | 0 | 0 | Returns before any wallet (`lightning-address-service.ts:106–128`) |
| **Net added** | | **0** | |

### B. `GET /api/lnurlp/callback/:userId`

Invalid amount and out-of-range: 0 requests on both sides (route `:18–27`; service `:146–154`).

Unknown userId: 1 `users` read by id (`user-repository.ts:319–336`), 0 Breez, both sides; the body is the internal-error envelope (`.single()` throws — plan-attack C1).

Cashu success (default account is cashu, or bypass selects a cashu currency):

| Request | Master | Flipped | Notes |
|---|---|---|---|
| `users` by id | 1 | 1 | `:157` |
| `users` + `accounts` + unspent proofs | 1 | 1 | `getDefaultAccount` (`user-repository.ts:220–231`) |
| Mint `getInfo` + `getKeySets` + `getKeys` (wallet init inside `getDefaultAccount`) | 3 | 3 | `user-repository.ts:271` → `lib/cashu.ts:181–192` (10 s race) — plan-attack M3 |
| Mint `createLockedMintQuote` | 1 | 1 | core `getLightningQuote` (`cashu-receive-quote-core.ts:268`) on `account.wallet` |
| `create_cashu_receive_quote` | 1 | 1 | same args; `p_purpose` still omitted, SQL default `'PAYMENT'` |
| Exchange rate | 1 iff currencies differ | 1 iff currencies differ | ticker `${amount.currency}-${account.currency}` (`:182–184`) |
| Breez | 0 | 0 | |
| **Net added** | | **0** | |

Spark success (the dev default, smoke step 7):

| Request | Master | Flipped | Notes |
|---|---|---|---|
| `users` by id | 1 | 1 | |
| `users` + `accounts` + proofs | 1 | 1 | |
| Breez `getInfo({})` (wallet init inside `getDefaultAccount`) | 1 | 1 | `lib/spark/wallet.ts:177` — plan-attack M3 |
| Breez `connect` via `getSparkWallet` | 1 per process | 1 per process | memo key unchanged when network is `MAINNET` (decision 4) |
| Breez `receivePayment` | 1 | 1 | `spark-receive-quote-core.ts:237` |
| `create_spark_receive_quote` | 1 | 1 | `p_purpose` still omitted |
| Exchange rate | 1 iff currencies differ | same | |
| **Net added** | | **0** | |

### C. `GET /api/lnurlp/verify/:encryptedQuoteData`

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Supabase | 0 | 0 | Verify does not read the db (`lightning-address-service.ts:270–292`) |
| Cashu `checkMintQuoteBolt11` | 1 | 1 | `getCashuWallet(mintUrl)` then `checkMintQuoteBolt11` (`:298–299`) |
| Spark `getSparkWallet` + `getLightningReceiveRequest` | memoized connect, then 1 read | same | network argument is the config value, which the host sets to `'MAINNET'` |
| **Net added** | | **0** | |

## Out of scope

- Step 18: host/processing split of the receive repositories and services; background processors; deleting `/temporary` (step 19). The `.server` twins stay. `ReadUserDefaultAccountRepository` stays on `temporary.ts`.
- `database.client.ts`, including the comment that still names `agicashDbServer` (`:9`).
- `db/client.ts`, `sdk.client.ts`, `breez.ts`, `lib/spark/wallet.ts`, `user-repository.ts`.
- Adding `init()` / `ensureBreezWasm` to `ServerSdk`. Verify already calls `getSparkWallet`, which calls `connect` (`wallet.ts:125`). The contract has no `init`.
- Caching exchange rates. Changing min/max sendable. Passing `description` or `purpose`. Remapping in-flight errors. Sharing one supabase client with the browser `AgicashSdk`.
- The `database.client.ts` LAN rewrite of `127.0.0.1` (`sdk.client.ts:11–22`). The server client talks to `VITE_SUPABASE_URL` as written (`database.server.ts:4`).
- `.claude/skills/lnurl-test/SKILL.md` still describes the pre-slice wiring; historical, not updated here (plan-attack M1).
- No schema, RPC, dependency, or migration changes.

## Open questions

None. Decisions 1–11 cover the slice. The multi-unset env precedence note in decision 3 is a recorded behavior, not an open choice.

## Plan-attack corrections (2026-10-10)

A cross-model adversarial review (claude harness) returned NOT READY with 1 Critical, 2 Important, 9 Minor, 6 Nits; every finding was verified and folded in above. The substance:

- **C1 (Critical, applied):** the LUD-06 "missing user → `'not found'`" envelope never existed — `ReadUserRepository.get` uses `.single()` and throws on zero rows, so master returns the internal-error envelope and `lightning-address-service.ts:159–164` is dead code (kept verbatim). Envelope table split; test (f) rewritten; test (g) removed; smoke 4 and parity B corrected.
- **I1 (Important, applied):** `import.meta.hot` is undefined under vite `ssrLoadModule`, so the pinned HMR dispose was dead and a dev edit of `sdk.server.ts`/`breez.ts` would throw the singleton error at module scope on re-evaluation, breaking all SSR until restart. Replaced with a `globalThis` dev handle (dispose-before-create); smoke 2b added.
- **I2 (Important, applied):** the `getDefaultAccount` dep seam skipped the one rewritten production line (mnemonic/config wiring into `ReadUserDefaultAccountRepository` — the wallet invoices are issued from). Replaced with a `createDefaultAccountRepository` factory seam; test (v) pins the wiring and per-callback construction.
- **M1–M9, N1–N6 (applied):** canary greps scoped to `apps packages`; service import list pinned (`SparkNetwork` added; `SparkWalletConfig` kept for the factory); parity tables gained the wallet-init I/O rows (mint getInfo/getKeySets/getKeys ×3; Breez getInfo) — net added stays 0; build-gate `.env` precondition + "CI runs no build" note; test (s) asserts the env vars are unset; test (t) reordered (invalid-hex after dispose, `/hex/` match) and gained two I/O-free facade calls; partial spark seams = both-or-neither; console spies pinned to `mockImplementation(() => undefined)`; decision-4 callback/verify network divergence recorded; `bun run test` (not bare `bun test`); `this.deps.` throughout; package.json cites fixed (`:6–8`, `:9`); (k) asserts `wallet` `toBe(walletMarker)`; `walletMarker = {}` pinned; N5 hex-length nuance recorded; (o) asserts `console.error` on both verify paths.

Gate note from the attack run: the reviewer's sandbox had no bun/curl (all toolchain gates honestly BLOCKED); it verified the frozen fixture blobs with an independent XChaCha20-Poly1305 implementation (both authenticate and decrypt to the pinned plaintexts) and re-read every `path:line` citation statically.
