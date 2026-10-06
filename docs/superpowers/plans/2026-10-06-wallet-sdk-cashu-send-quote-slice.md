# Wallet SDK Cashu Send Quote Slice (Step 13) Implementation Plan

> **Orchestration note:** like steps 10–12, this slice ships as **one whole-slice contribution job**, after an adversarial review of this plan. A separate implementer forks the repo at the base of a new `sdk/cashu-send-quote-slice` branch (off `master`), reads this plan and the referenced code in the fork, and delivers everything together on a branch descending from the base: the first `send` factory and its wiring into `sdk.ts`, the service options param, tests, and the web hook flip. The orchestrator then integrates locally and runs the gates from the Verification summary. Adversarial review of the integrated diff follows. The job text stays task-only; this document is the full spec. All `path:line` citations are valid at the pinned base (`89cda15`, the merge of #1186).

**Goal:** Implement `send.cashu.getLightningQuote` and `send.cashu.createQuote` from the SDK contract. Wire the `send` namespace into `AgicashSdk`; it is the first send slice, so this replaces the throwing `get send()` getter. Flip the web cashu-to-bolt11 quote preview and the confirm (create quote) hooks from `@agicash/wallet-sdk/temporary` to `sdk.send.cashu.*`.

**Architecture:** This is step 13 of the 19-step no-cache extraction (spec `docs/superpowers/specs/2026-06-24-wallet-sdk-no-cache-production-design.md`, step list `:68–116`, step 13 at `:91`). The already-moved `domain/send/cashu-send-quote-service.ts` gets its two host-initiated verbs exposed through a **new** `createSendApi` factory in `domain/send/send-api.ts`. The factory mirrors the merged `createReceiveApi` (`domain/receive/receive-api.ts:45–262`). `sdk.ts` swaps the throwing `get send()` (`sdk.ts:58–60`) for a `readonly send` assigned in the constructor, exactly as step 9 did for `receive` (`sdk.ts:182–187`; step-9 commit `5004d67`). Members owned by later slices stay as throwing getters: `cashu.getSwapQuote`/`createSwap` (step 14), `spark` (step 15), and `resolveDestination` (unowned, decision 5). The cashu send **background lifecycle** (melt initiation, mark-pending, complete, fail, expire in `useProcessCashuSendQuoteTasks`, `cashu-send-quote-hooks.ts:269–521`) stays on `/temporary` until step 18. That is the same boundary style as steps 9–12.

**Tech stack:** TypeScript, bun workspaces, bun:test, Supabase (postgrest-js), TanStack Query v5 (web side only).

## Global constraints

- **Param precedent (binding, set by the #1176 review):** contract methods take the full domain objects the caller supplies (`account: CashuAccount`, the `CashuLightningQuote` the preview returned). They never take an id the SDK re-fetches. Fetch-by-id is reserved for paths with no caller state. A flipped web flow must issue no additional network requests versus master. Binding text: production design "Corollary (foreground parity)" (`2026-06-24-wallet-sdk-no-cache-production-design.md:31–37`) and contract proposal "Conventions across all namespaces" (`2026-07-02-wallet-sdk-contract-proposal.md:297–325`). The merged `receive-api.ts` / `domain/sdk/receive.ts` are authoritative. The step-9 *plan*'s `accountId` text predates its review.
- **`userId` is implicit** (`contract-proposal.md:299–301`): no public param carries it. `createQuote` takes it from `requireUserId()`.
- **`get*` = stateless preview, `create*` = persists** (`contract-proposal.md:302–306`). `getLightningQuote` does no DB write (it is mint HTTP only, `cashu-send-quote-service.ts:150`). `createQuote` persists (`create_cashu_send_quote` RPC, `cashu-send-quote-repository.ts:152`). The verbs are already right; this slice does not rename them.
- **Completion verbs never appear on the public surface** (`contract-proposal.md:317–321`). `initiateSend` / `markSendQuoteAsPending` / `completeSendQuote` / `failSendQuote` / `expireSendQuote` (`cashu-send-quote-service.ts:330–521`) are not exposed.
- **No host/processing split.** Do not split `CashuSendQuoteRepository` / `CashuSendQuoteService` into host and processing halves. The spec gives that to step 18 (`production-design.md:100–107`). This slice wraps the bundled classes as they are.
- The SDK stays React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`.
- **No SDK event emission.** `domain/sdk/events.ts` is untouched.
- No DB schema, RPC, dependency, or migration changes. `create_cashu_send_quote` is used unchanged. No `bun add`, and no `db:generate-types`.
- Session fences follow the merged `receive-api.ts` template (decision 7).
- **Canary rule for `temporary.ts`:** prune only the re-exports this flip makes dead, verified by repo-wide grep. This flip makes **none** dead (decision 10), so `temporary.ts` is untouched. Do not prune pre-existing dead re-exports.
- Do not touch other domains' `/temporary` imports. Only the files in the File map change.
- Root `packages/wallet-sdk/index.ts` is untouched. `export * from './domain/sdk'` (`index.ts:10`) re-exports `domain/sdk/index.ts`, which does `export * from './send'` (`domain/sdk/index.ts:26`), so the two filled param types ship automatically. `CashuAccount`, `CashuLightningQuote`, `DestinationDetails`, and `SendQuoteRequest` are already root-exported (`index.ts:33–36`, `:23`, `:107–111`).
- **`.server.ts` twins are untouched** (step 17). The send domain has none today.
- Package manager: `bun` / `bunx` only. Base branch: `master`. Work branch: `sdk/cashu-send-quote-slice`.

## Resolved design decisions

1. **Slice scope = the two web host entry points into `CashuSendQuoteService`, and nothing else.** A repo-wide grep for `getLightningQuote` / `createSendQuote` / `useCashuSendQuoteService` / `useCashuSendQuoteRepository` outside `domain/receive` finds these callers:
   - (a) `useCreateCashuLightningSendQuote` (`cashu-send-quote-hooks.ts:111–142`). It calls `cashuSendQuoteService.getLightningQuote` (`:129`): the **preview**, despite the hook name. It is consumed as `getCashuLightningQuote` via `send-provider.tsx:32–33` → `createSendStore` (`send-provider.tsx:49`) → `send-store.ts:384–388`.
   - (b) `useInitiateCashuSendQuote` (`cashu-send-quote-hooks.ts:144–191`). It calls `createSendQuote` (`:170`) and is consumed only by `send-confirmation.tsx:124–147` (mutate at `:182–186`).
   - The in-package callers are `transfer-service.ts:189` (`getLightningQuote`) and `:253` (`createSendQuote` with `purpose: 'TRANSFER'` + `transferId`), owned by step 16. They keep compiling unchanged (decision 8).
   - These stay on `/temporary`: `useCashuSendQuoteService` (`:48`), still used by `useProcessCashuSendQuoteTasks` (`:270`, step 18) and `features/transfer/transfer-service-hooks.ts:4,10` (step 16). `useCashuSendQuoteRepository` (`:43`) also stays: it feeds the unresolved-quotes read (`:194`, `:200`), the change handlers (`:236`), and `features/transactions/transaction-additional-details.tsx:71`.
   - Neighbors stay put: send swap/token = step 14 (`send-confirmation.tsx:330–335`, `useCreateCashuSendSwapQuote` at `send-provider.tsx:34`), spark send = step 15 (`useInitiateSparkSendQuote`, `useCreateSparkLightningSendQuote`), transfer = step 16.

2. **Placeholder param types (`send.ts:36–37`): caller-supplied `account: CashuAccount`, no `userId`, no `purpose` / `transferId`, no `exchangeRate`.**
   - `GetCashuSendLightningQuoteParams = { account, paymentRequest, amount? }`. These are the fields the only caller sends (`send-store.ts:384–388`, typed at `:152–156`) and the fields the service reads (`GetCashuLightningQuoteOptions`, `cashu-send-quote-service.ts:22–41`, minus `exchangeRate`, see decision 3).
   - `CreateCashuSendQuoteParams = { account, lightningQuote, destinationDetails? }`.
     - **`account`:** the full object. The service needs `account.wallet`, `account.proofs`, `account.currency`, and `account.id` (`:247–257`, `:305`). No in-SDK `accounts.get`, which would cost a proofs-inclusive row read plus a wallet init (`contract-proposal.md:307–316`).
     - **`lightningQuote: CashuLightningQuote`:** the object `getLightningQuote` returned. It is named like the receive contract's `lightningQuote` (`domain/sdk/receive.ts:66–67`) so preview → create pairs read the same across namespaces. The web already passes exactly this object, `quote as CashuLightningQuote` (`send-confirmation.tsx:184`). `CashuLightningQuote` is a structural superset of the service's `SendQuoteRequest` (`cashu-send-quote-service.ts:43–93`), so the API hands it straight to `sendQuote`. *Rejected:* `sendQuote: SendQuoteRequest`. It is more permissive but names an internal DTO, and it breaks the `get*` → `create*` pairing the receive contract set.
     - **`destinationDetails?: DestinationDetails`:** forwarded verbatim. It is set for LN-address/contact sends (`send-confirmation.tsx:185`).
   - **`purpose` / `transferId` are not on the public param.** The web send flow never passes them (`cashu-send-quote-hooks.ts:170–175`). The only producer is `TransferService.persistSendQuote` (`transfer-service.ts:253–264`), which is in-package and will sit behind its own contract namespace `transfer.initiate` (`domain/sdk/transfer.ts:6`, step 16), not behind `send.cashu.createQuote`. The receive contract *does* carry them (`receive.ts:68–71`) because web receive has real callers (`cashu-receive-quote-hooks.ts:61`, `:196`, `:207`: Cash App buy). Send has none. Adding an optional field later is non-breaking. Shipping one with no caller invites a host to forge `purpose: 'TRANSFER'` rows outside the transfer orchestration. *Rejected:* mirroring receive "for symmetry" (it has no caller and opens that forgery hole).

3. **`exchangeRate` is omitted from `GetCashuSendLightningQuoteParams`. Not `Big`, not `string`.** Evidence:
   - **No caller passes it.** The web hook *declares* `exchangeRate?: Big` (`cashu-send-quote-hooks.ts:122`, `:127`), but its only caller's type has no such field (`send-store.ts:152–156`), and the call omits it (`:384–388`). `transfer-service.ts:189–192` omits it too.
   - **The service cannot use it on any path that returns.** `exchangeRate` is read only when the invoice has no amount (`cashu-send-quote-service.ts:128–135`). Seven lines later that branch throws unconditionally: `'Cashu accounts do not support amountless lightning invoices'` (`:141–145`). With an amount-bearing invoice, `amountRequestedInBtc` comes from the invoice (`:122–127`), and `exchangeRate` is ignored. The only effect it has today is *which* plain `Error` an amountless invoice gets, and the web never sends one, because `selectDestination` sets `allowZeroAmountBolt11: account.type === 'spark'` (`send-store.ts:261–263`).
   - **Cost of each option:**
     - `Big` would put a `big.js` type on the public contract for a dead input. No other contract param uses `Big`.
     - `string` would match step 12 (`receive.ts:119`) and the SDK's own FX output (`exchangeRateService.getRate` returns a decimal string, see the step-12 plan decision 3). But it would need a runtime `new Big(...)` in the API, or a widening of the service type, for a value nothing supplies.
     - Omitting costs nothing. Behavior is identical to master, because master never supplies it either.
   - **Forward path (recorded, not done):** when cashu-ts supports amountless invoices (the TODO at `:140`), add `exchangeRate?: string` to the public param. That is consistent with step 12 and with `Money.convert(currency, exchangeRate: NumberInput)` (`packages/money/src/money.ts:625–628`), which already accepts a string. The service type can widen to `NumberInput` at that point. *Rejected now:* `exchangeRate?: Big` (decision-b option 1) and `exchangeRate?: string` (option 2), for the reasons above.
   - The web hook drops its `exchangeRate?: Big` field and the then-unused `import type Big from 'big.js'` (`cashu-send-quote-hooks.ts:29`; biome `noUnusedImports` is an error).

4. **`createQuote` narrows to exactly `{ transactionId }` at runtime.** The contract fixes `Promise<{ transactionId: string }>` (`send.ts:19–21`). Send returning a bare id is deliberate (`contract-proposal.md:326–341`: "the asymmetry is intentional, not an oversight").
   - Consumer grep: `useInitiateCashuSendQuote`'s result is read only at `send-confirmation.tsx:128` (`data.transactionId`).
   - The unresolved-quote cache is fed by the realtime `CASHU_SEND_QUOTE_CREATED` handler (`cashu-send-quote-hooks.ts:240–248`), not by the mutation result. The hook's `onSuccess` only forwards (`:177–179`).
   - The service returns the full `CashuSendQuote` (`cashu-send-quote-repository.ts:134`), including reserved `proofs`. `CashuSendQuote.transactionId` exists (`cashu-send-quote.ts:106`).
   - The API returns `{ transactionId: quote.transactionId }`. That is a fresh object, so no proof material or quote internals cross the boundary at runtime, even though TS would already hide them.
   - The web hook's `onSuccess` type becomes `(data: { transactionId: string }) => void`, and `send-confirmation.tsx` compiles unchanged.
   - *Rejected:* returning the service result typed as `{ transactionId }`. It structurally satisfies the type but leaks proofs at runtime to any host that logs or serializes it, and it makes the eventual narrowing a breaking change.

5. **`resolveDestination` stays out of scope and keeps throwing `NotImplementedError('send.resolveDestination')`.**
   - The contract signature `(input: string) => Promise<DestinationDetails>` (`send.ts:14`) does not match the implementation `resolveSendDestination(input: string | Contact, { allowZeroAmountBolt11 })` → `Promise<ResolveResult>` (`domain/send/resolve-destination.ts:36–39`, result union at `:32–34`).
   - The mismatch spans input (contacts), options, and output: a `SendDestination` with `sendType`/`destination`/`destinationDisplay` that the store destructures (`send-store.ts:268–272`), versus `DestinationDetails`. Error style differs too: a `{ success: false, error }` result is toasted (`routes/_protected.send.tsx:33–44`), not thrown.
   - Both web callers (`send-store.ts:261`, `routes/_protected.send.tsx:33`) depend on the current shape. Implementing it here means a contract-shape decision that no step owns and that affects spark send (step 15) equally. The function is pure (no DB, no session), so leaving it on `/temporary` (`temporary.ts:135`) costs no parity.
   - *Rejected:* implementing it in step 13. That would widen this slice into an unowned contract redesign. Track it as Open question 1.

6. **Unimplemented members are throwing getters, per the step-9 precedent.** Step 9 shipped `get spark(): ReceiveApi['spark'] { throw new NotImplementedError('receive.spark'); }` and the same for `cashuToken` (commit `5004d67`, `receive-api.ts` at that commit). `NotImplementedError`'s contract is "thrown when a namespace is accessed before its migration slice has landed" (`lib/error.ts:64–70`). So:
   - `get spark(): SendApi['spark']` throws `NotImplementedError('send.spark')`. This is the whole sub-namespace, step 15, an exact precedent.
   - `get resolveDestination(): SendApi['resolveDestination']` throws `NotImplementedError('send.resolveDestination')`.
   - Inside the implemented `cashu` object: `get getSwapQuote(): SendApi['cashu']['getSwapQuote']` and `get createSwap(): SendApi['cashu']['createSwap']` throw `NotImplementedError('send.cashu.getSwapQuote')` / `('send.cashu.createSwap')`. `cashu` is half-landed, so the getter has to sit at member level. Step 14 replaces both with methods.
   - *Rejected:* async methods that reject. Those make "not landed" a call-time rejection that looks like a domain failure inside a mutation's error path, and they break the one-shape-for-unlanded rule. Also rejected: omitting the members, which does not typecheck against `SendApi`.
   - Known consequence: spreading `{ ...sdk.send.cashu }` would throw. Nothing spreads namespaces (grep `sdk.send` in `apps/` → no matches at the base).
   - **`sdk.test.ts`** gains one wiring test (test **p**). Step 9 left `sdk.test.ts` untouched (step-9 plan, global constraint at `:20`), but step 13 is the only change to `sdk.ts` in the send series, and `AgicashSdk.create` does no I/O (`sdk.test.ts:32–46` precedent). The test asserts:
     - `sdk.send` no longer throws and is a stable instance (`sdk.send === sdk.send`).
     - `sdk.send.cashu.getLightningQuote` / `createQuote` are functions.
     - `sdk.send.spark`, `sdk.send.resolveDestination`, `sdk.send.cashu.getSwapQuote`, and `sdk.send.cashu.createSwap` throw `NotImplementedError`.
     - `sdk.transfer` still throws `NotImplementedError`.

7. **Session fences follow the merged receive template.**
   - **`getLightningQuote` (preview)** matches `receive-api.ts:130–141` exactly: **no `requireUserId()`**, capture `deps.keys.sessionSignal()` → `await getService()` → re-check → service call → re-check. The receive previews (`cashu` `:130–141`, `spark` `:183–197`) do not require a user id because they persist nothing. The send preview persists nothing either, so it matches. The mint call (`account.wallet.createMeltQuoteBolt11`, `cashu-send-quote-service.ts:150`) cannot be aborted, so pre/post checks are the only fence. That is the same stance as step 9's mint HTTP. The service takes no options here.
   - **`createQuote`** matches `receive-api.ts:142–160`: `requireUserId()` → capture `sessionSignal()` → `await getService()` → re-check → `createSendQuote({...}, { abortSignal: signal })` → re-check → return `{ transactionId }`. A result is never returned for an ended session.

8. **`createSendQuote` gains `options?: { abortSignal?: AbortSignal }` as a second positional param, forwarded to `cashuSendRepository.create(..., options)`.**
   - The repository already accepts and applies it (`cashu-send-quote-repository.ts:112–134`, `:168–170`).
   - This matches steps 9–12 (`cashu-receive-quote-service.ts` `createReceiveQuote` options; step-12 plan decision 6).
   - Compatibility: the in-package callers are `transfer-service.ts:253` (one argument, so it still compiles) and the web hook this slice flips. `getLightningQuote` gets no options param, because nothing in it can abort.
   - No other method in the service changes.

9. **Factory deps: `db`, `getSession`, `keys`. No accounts bridge and no cashu crypto.**
   - `CashuSendQuoteService`'s constructor takes only the repository (`cashu-send-quote-service.ts:96`). `CashuSendQuoteRepository` takes `(db, encryption)` (`cashu-send-quote-repository.ts:103–106`), with **no** `AccountRepository`. The web builds it the same way: `new CashuSendQuoteRepository(agicashDbClient, encryption)` (`cashu-send-quote-hooks.ts:43–46`).
   - So `Deps` has no `getAccountRepository`, unlike receive (`receive-api.ts:24–25`), and the factory builds no `CashuCryptography`.
   - **Seed non-access (verified by reading):** `getLightningQuote` touches `account.wallet.createMeltQuoteBolt11`, `selectProofsToSend`, and `getFeesForProofs` (`:150`, `:549–566`). `createSendQuote` touches `wallet.getKeyset()`, the same proof selection, `decodeBolt11`, and `repository.create` (`:247–322`). Neither touches `wallet.seed`; only `completeSendQuote` does (`:436–439`, step 18). Neither calls `keys.getCashuSeed`. Test **m** locks this for the create path.
   - `keys.getEncryption()` is the only key material read, and it is memoized per session (`domain/sdk/session-keys.ts:200–262`). It is already warm from `sdk.accounts.list()` (`accounts-api.ts:35–39` builds its repository from `getEncryption`; the protected layout calls it through `account-hooks.ts:142`).
   - `sdk.ts` constructs it as `createSendApi({ db, getSession: getLiveSession, keys })` after `this.receive` (`sdk.ts:182–187`).

10. **Canary: no `/temporary` re-export becomes dead. `temporary.ts` is untouched.**
    - The flip removes the web hooks' calls to `CashuSendQuoteService.getLightningQuote` / `createSendQuote`, but every re-export they used is still imported elsewhere:
      - `CashuSendQuoteService` (`temporary.ts:126`) by `cashu-send-quote-hooks.ts:15` (still used at `:48–51` for the processor) and indirectly by `transfer-service-hooks.ts`.
      - `CashuSendQuoteRepository` (`temporary.ts:125`) by `cashu-send-quote-hooks.ts:14`.
      - `DomainError` / `ConcurrencyError` by the same file (the flipped hooks' `retry` still uses them).
    - Run a repo-wide grep before delivering to confirm. Do **not** prune anything else (e.g. `CashuSendQuoteSchema`, `temporary.ts:124`, or `toDecryptedCashuProofs`, `:133`, even if they look dead; that is step-19 cleanup).

11. **Web flip: two hook bodies in `cashu-send-quote-hooks.ts`. `send-confirmation.tsx`, `send-provider.tsx`, and `send-store.ts` are byte-identical.**
    - **`useInitiateCashuSendQuote` keeps `accountId` + the per-attempt cache lookup inside `mutationFn`.** This is a deliberate, evidence-backed difference from step 10, which moved `useCreateCashuReceiveSwap` to an `account` prop (commit `a16a7a4`). The send hook retries `ConcurrencyError` **forever** (`cashu-send-quote-hooks.ts:181–184`). `create_cashu_send_quote` raises `CONCURRENCY_ERROR` exactly when a selected proof is no longer `UNSPENT` (`packages/wallet-sdk/db/supabase/migrations/20260420152512_denormalize_account_on_transactions.sql:419–431`), i.e. when the proofs it chose came from a stale account.
      - Master recovers because `getCashuAccount(accountId)` re-reads the TanStack accounts cache on **every attempt** (`:169`). Realtime account updates refresh that cache between attempts.
      - If the hook took the caller's `account` as a mutation variable, every retry would re-send the same stale proofs and loop. Step 10's mutation had no such retry (`retry` absent, default 0), so its precedent does not carry over.
      - The lookup is a pure cache read (`useGetAccount`, `features/accounts/account-hooks.ts:355–375`, `useGetCashuAccount` at `:381–383`): zero network. The SDK still receives the full object, so the convention ("the host fetched the entity from its own cache", `contract-proposal.md:307–316`) holds.
      - `send-confirmation.tsx:182–186` therefore does not change. *Rejected:* `account` prop (it breaks ConcurrencyError recovery).
    - `useInitiateCashuSendQuote` drops `useUser` (userId is implicit; `useUser` stays imported for `:195`) and `useCashuSendQuoteService` (the function stays defined for the processor).
    - `useCreateCashuLightningSendQuote` drops `useCashuSendQuoteService` and the `exchangeRate` field. Its `scope` and `retry` are unchanged.
    - Imports: add `import { sdk } from '~/features/shared/sdk.client';` (same form as `contact-hooks.ts:12`). Replace `SendQuoteRequest` with `CashuLightningQuote` in the `@agicash/wallet-sdk` type import (`:3–8`). Delete `import type Big from 'big.js';` (`:29`). Everything else in the file is byte-identical.

12. **No `index.ts` / `events.ts` / `temporary.ts` / `.server.ts` changes.** See Global constraints. `domain/sdk/index.ts` is untouched (it already re-exports `./send`, `:26`).

## Pinned seams (authoritative for the implementation)

### Contract (`packages/wallet-sdk/domain/sdk/send.ts`)

Replace lines 36–37 with the following. Lines 38–42 (the step-14/15 placeholders) and the `SendApi` type stay byte-identical.

```ts
export type GetCashuSendLightningQuoteParams = {
  /** The cashu account to send from. */
  account: CashuAccount;
  /** The bolt11 invoice to pay. Amountless invoices are rejected for cashu accounts. */
  paymentRequest: string;
  /**
   * The amount the user entered, returned as `amountRequested`. The invoice
   * amount always determines what is paid.
   */
  amount?: Money;
};

export type CreateCashuSendQuoteParams = {
  /** The cashu account to send from. Must be the account the quote was created for. */
  account: CashuAccount;
  /** The lightning quote to create the send quote from (see `getLightningQuote`). */
  lightningQuote: CashuLightningQuote;
  /**
   * How the invoice was obtained (lightning address or contact), stored with
   * the send. Omit when paying a bolt11 directly.
   */
  destinationDetails?: DestinationDetails;
};
```

New imports: `import type { Money } from '@agicash/money';` and `import type { CashuAccount } from '../accounts/account';`. `CashuLightningQuote` and `DestinationDetails` are already imported (`send.ts:1`, `:3`). Let `bun run fix:all` order the imports.

### API factory (new file `packages/wallet-sdk/domain/send/send-api.ts`)

```ts
import type { AgicashDb } from '../../db/database';
import {
  NoSessionError,
  NotImplementedError,
  SessionEndedError,
} from '../../lib/error';
import type { AuthSession, SendApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuSendQuoteRepository } from './cashu-send-quote-repository';
import { CashuSendQuoteService } from './cashu-send-quote-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Test seam; defaults to building the repository from db + session-keys encryption. */
  createRepository?: () => Promise<CashuSendQuoteRepository>;
  /** Test seam; defaults to building the service from the repository. */
  createService?: () => Promise<CashuSendQuoteService>;
};

/** Creates the `send` SDK namespace. */
export function createSendApi(deps: Deps): SendApi {
  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const getRepository =
    deps.createRepository ??
    (async (): Promise<CashuSendQuoteRepository> =>
      new CashuSendQuoteRepository(deps.db, await deps.keys.getEncryption()));

  const getService =
    deps.createService ??
    (async (): Promise<CashuSendQuoteService> =>
      new CashuSendQuoteService(await getRepository()));

  return {
    get resolveDestination(): SendApi['resolveDestination'] {
      throw new NotImplementedError('send.resolveDestination');
    },
    cashu: {
      getLightningQuote: async (params) => {
        const signal = deps.keys.sessionSignal();
        const service = await getService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.getLightningQuote({
          account: params.account,
          paymentRequest: params.paymentRequest,
          amount: params.amount,
        });
        if (signal.aborted) throw new SessionEndedError();
        return quote;
      },
      createQuote: async (params) => {
        const userId = requireUserId();
        const signal = deps.keys.sessionSignal();
        const service = await getService();
        if (signal.aborted) throw new SessionEndedError();
        const quote = await service.createSendQuote(
          {
            userId,
            account: params.account,
            sendQuote: params.lightningQuote,
            destinationDetails: params.destinationDetails,
          },
          { abortSignal: signal },
        );
        if (signal.aborted) throw new SessionEndedError();
        return { transactionId: quote.transactionId };
      },
      get getSwapQuote(): SendApi['cashu']['getSwapQuote'] {
        throw new NotImplementedError('send.cashu.getSwapQuote');
      },
      get createSwap(): SendApi['cashu']['createSwap'] {
        throw new NotImplementedError('send.cashu.createSwap');
      },
    },
    get spark(): SendApi['spark'] {
      throw new NotImplementedError('send.spark');
    },
  };
}
```

Notes:
- `sendQuote: params.lightningQuote` passes a `CashuLightningQuote` where `SendQuoteRequest` is expected. It is not a fresh object literal, so there is no excess-property error, and the service reads only the four `SendQuoteRequest` fields (`cashu-send-quote-service.ts:239`, `:301`, `:306–310`).
- If `bun run typecheck` rejects a member-level getter inside `cashu` (it should not; step 9 used the same mechanism at sub-namespace level), the fallback is an explicit `const cashu: SendApi['cashu'] = { ... }` with the same getters. Do **not** switch to rejecting methods (decision 6).

### Service change (`packages/wallet-sdk/domain/send/cashu-send-quote-service.ts`)

Change `createSendQuote` (`:204–238`) to take a second parameter. The first parameter's destructuring and inline type stay byte-identical:

```ts
  async createSendQuote(
    {
      userId,
      account,
      sendQuote,
      destinationDetails,
      purpose,
      transferId,
    }: {
      /* …existing field docs and types, unchanged… */
    },
    options?: { abortSignal?: AbortSignal },
  ) {
```

and pass it through at `:303`:

```ts
    return this.cashuSendRepository.create(
      {
        /* …existing fields, unchanged… */
      },
      options,
    );
```

Nothing else in the file changes. `purpose` / `transferId` stay on the service for `transfer-service.ts:253–264`.

### Wiring (`packages/wallet-sdk/domain/sdk/sdk.ts`)

1. Add `import { createSendApi } from '../send/send-api';` after the `createReceiveApi` import (`:30`). Biome orders it.
2. Delete the `get send()` getter (`:58–60`). Add `readonly send: SendApi;` after `readonly receive: ReceiveApi;` (`:55`).
3. After the `this.receive = createReceiveApi({...});` block (`:182–187`), add:

```ts
    this.send = createSendApi({
      db,
      getSession: getLiveSession,
      keys,
    });
```

`NotImplementedError` stays imported (`:21`); `transfer`, `featureFlags`, and `taskProcessor` still use it (`:61–69`). Leave the class JSDoc (`:44–48`) alone.

### Web flip (`apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts`)

1. Imports: in the `@agicash/wallet-sdk` type import (`:3–8`), replace `SendQuoteRequest` with `CashuLightningQuote`. Keep `CashuAccount`, `CashuSendQuote`, `DestinationDetails`. Delete `import type Big from 'big.js';` (`:29`). Add `import { sdk } from '~/features/shared/sdk.client';`. Keep every other import: `useUser` (`:195`), `useGetCashuAccount` (`:153`, `:272`), `CashuSendQuoteService`/`Repository`, `ConcurrencyError`, `DomainError`, and `Money`.
2. Replace `useCreateCashuLightningSendQuote` (`:111–142`) with:

```ts
export function useCreateCashuLightningSendQuote() {
  return useMutation({
    scope: {
      id: 'create-cashu-lightning-send-quote',
    },
    mutationFn: ({
      account,
      amount,
      paymentRequest,
    }: {
      account: CashuAccount;
      paymentRequest: string;
      amount?: Money;
    }) =>
      sdk.send.cashu.getLightningQuote({
        account,
        amount,
        paymentRequest,
      }),
    retry: (failureCount, error) => {
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
```

3. Replace `useInitiateCashuSendQuote` (`:144–191`) with:

```ts
export function useInitiateCashuSendQuote({
  onSuccess,
  onError,
}: {
  onSuccess: (data: { transactionId: string }) => void;
  onError: (error: Error) => void;
}) {
  const getCashuAccount = useGetCashuAccount();

  return useMutation({
    mutationKey: ['initiate-cashu-send-quote'],
    scope: {
      id: 'initiate-cashu-send-quote',
    },
    mutationFn: ({
      accountId,
      sendQuote,
      destinationDetails,
    }: {
      accountId: string;
      sendQuote: CashuLightningQuote;
      destinationDetails?: DestinationDetails;
    }) => {
      // Read per attempt: a ConcurrencyError retry must reselect proofs from
      // the latest cached account, not the one the first attempt saw.
      const account = getCashuAccount(accountId);
      return sdk.send.cashu.createQuote({
        account,
        lightningQuote: sendQuote,
        destinationDetails,
      });
    },
    onSuccess: (data) => {
      onSuccess(data);
    },
    onError: onError,
    retry: (failureCount, error) => {
      if (error instanceof ConcurrencyError) {
        return true;
      }
      if (error instanceof DomainError) {
        return false;
      }
      return failureCount < 1;
    },
  });
}
```

The comment meets the CLAUDE.md bar: it records a non-obvious constraint (decision 11) that a future "pass the account object" refactor would break. `send-confirmation.tsx` compiles unchanged: `onSuccess` reads `data.transactionId` (`:128`), and the mutate call passes `{ accountId, sendQuote: quote as CashuLightningQuote, destinationDetails }` (`:182–186`). `send-store.ts:152–156` still matches the preview hook's variables (`amount: Money<Currency>` is assignable to `amount?: Money`).

## File map

- Modify: `packages/wallet-sdk/domain/sdk/send.ts` (two param types; decisions 2–3)
- Create: `packages/wallet-sdk/domain/send/send-api.ts` (factory; decisions 4–7, 9)
- Create: `packages/wallet-sdk/domain/send/send-api.test.ts` (tests a–o)
- Modify: `packages/wallet-sdk/domain/send/cashu-send-quote-service.ts` (options param; decision 8)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.ts` (wire `send`; decision 9)
- Modify: `packages/wallet-sdk/domain/sdk/sdk.test.ts` (wiring test p; decision 6)
- Modify: `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts` (web flip; decision 11)
- **Untouched on purpose:**
  - Package root and contract: `packages/wallet-sdk/index.ts`, `temporary.ts` (decision 10), `domain/sdk/index.ts`, `domain/sdk/events.ts`, `domain/sdk/receive.ts`, `domain/sdk/transfer.ts`.
  - Send domain: `cashu-send-quote-repository.ts`, `cashu-send-quote.ts`, `resolve-destination.ts`, `send-destination.ts`, all `cashu-send-swap-*` and `spark-send-quote-*` files.
  - Other domains: `transfer-service.ts`, everything in `domain/receive/`.
  - Web: `send-confirmation.tsx`, `send-provider.tsx`, `send-store.ts`, `routes/_protected.send*.tsx`, `spark-send-quote-hooks.ts`, `cashu-send-swap-hooks.ts`, `transfer-service-hooks.ts`, `transaction-additional-details.tsx`, `sdk.client.ts`.
  - All RPCs and migrations.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The commit that adds this document is the pinned base. The implementation job branches `sdk/cashu-send-quote-slice` off `master` and appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the seven files in the File map, applying the pinned seams verbatim. Working order:

1. **Read first:** `domain/receive/receive-api.ts`, `domain/receive/receive-api.test.ts`, `domain/sdk/sdk.ts`, `domain/sdk/sdk.test.ts`, `domain/send/cashu-send-quote-service.ts`, `domain/send/cashu-send-quote-repository.ts`. Match their structure, naming, and JSDoc style.
2. **Contract + service + factory + wiring** (pinned seams). Confirm `transfer-service.ts:253` still compiles with the one-argument call.
3. **Canary check (no edit):** grep the repo for `CashuSendQuoteService`, `CashuSendQuoteRepository`, `DomainError`, `ConcurrencyError` importers of `@agicash/wallet-sdk/temporary` after the flip. Each must still have one. Do not edit `temporary.ts`.
4. **Tests.** Create `send-api.test.ts` in the harness style of `receive-api.test.ts`:
   - Fake `getSession` (copy `authUser` / `loggedIn` from `receive-api.test.ts:38–52`).
   - Real `createSessionKeys` from `../sdk/session-keys`, with `keys.reset()` as the session-end trigger.
   - Seam injection. Fakes are typed `as unknown as CashuSendQuoteService` / `CashuSendQuoteRepository`, as at `receive-api.test.ts:257–291`.
   - A `makeApi({ session, keys?, repository?, service? })` helper that always injects both seams (like `receive-api.test.ts:257`). Tests that need a **default** builder call `createSendApi` directly and omit that seam.

   Fixtures:
   - `cashuDomain(overrides)`: copy `receive-api.test.ts:54–75`. The default `wallet` marker object is fine for fake-service tests.
   - `fixtureInvoice`: the BOLT11 spec test vector at `receive-api.test.ts:668–669`. It decodes (payment hash `0001020304050607080900010203040506070809000102030405060708090102`) but **expired in 2017**. That is deliberate: `decodeBolt11` does not check expiry (`packages/bolt11/src/index.ts:29–79`), so `createSendQuote` accepts it, while `getLightningQuote` rejects it (`cashu-send-quote-service.ts:113–115`).
   - `makeMeltQuote()`: `{ quote: 'mq-1', amount: 50, fee_reserve: 2, expiry: Math.floor(Date.now() / 1000) + 600, state: 'UNPAID', request: fixtureInvoice, unit: 'sat' }`, cast. A future `expiry` is required (`:240–245`).
   - `makeLightningQuote(): CashuLightningQuote`: cast, with `paymentRequest: fixtureInvoice`, `amountRequested` / `amountRequestedInBtc` = `new Money({ amount: 50, currency: 'BTC', unit: 'sat' })`, `meltQuote: makeMeltQuote()`, and the remaining fields as any `Money`.
   - `makeSendQuote(): CashuSendQuote`: cast, with `id: 'sq-1'`, `transactionId: 'tx-1'`, and non-empty `proofs` (so the narrowing test can see they don't leak).

   Exact test list:

   - **`cashu.getLightningQuote`:**
     - (a) **Passthrough:** calls `service.getLightningQuote` with exactly `{ account, paymentRequest, amount }`. Assert with `toEqual` plus `captured.account` `toBe` the given account. Returns the service result verbatim (`toBe`).
     - (b) **Mid-construction fence:** `createService` calls `keys.reset()` before returning a service whose `getLightningQuote` counts calls. Rejects `SessionEndedError`, with 0 service calls (pattern: `receive-api.test.ts:672–705`).
     - (c) **Post-op fence:** the service's `getLightningQuote` calls `keys.reset()` and then resolves. Rejects `SessionEndedError` (pattern: `:707–735`).
     - (d) **Error propagation:** a service rejection `new DomainError('Insufficient balance. …')` propagates as the **same instance** (`rejects.toBe(error)`).
     - (e) **Default service, no DB or mint work on an invalid quote:** call `createSendApi` directly **without** `createService`, with `createRepository` returning a repository whose `create` increments a counter. The account `wallet.createMeltQuoteBolt11` also increments a counter. Calling with `fixtureInvoice` rejects with `DomainError` message `'Lightning invoice has expired'`. Both counters stay 0. This locks the default builder wiring and that the preview never writes.
   - **`cashu.createQuote`:**
     - (f) **No session:** with `getSession: () => ({ isLoggedIn: false })`, throws `NoSessionError` before any construction. The `createService` and `createRepository` call counters stay 0 (pattern: `receive-api.test.ts:295–322`).
     - (g) **Passthrough + narrowing:** passes exactly `{ userId: 'user-x', account, sendQuote: lightningQuote, destinationDetails }` (`sendQuote` `toBe` the given `lightningQuote`) and `{ abortSignal: keys.sessionSignal() }` as the second argument (`toBe` identity on the signal). The service returns `makeSendQuote()`. Assert the result `toStrictEqual({ transactionId: 'tx-1' })`, and `Object.keys(result)` equals `['transactionId']` (no `proofs` leak).
     - (h) **No hidden fields:** called without `destinationDetails`, the captured first argument's sorted keys are exactly `['account', 'destinationDetails', 'sendQuote', 'userId']`, and `destinationDetails` is `undefined`. No `purpose` / `transferId` is ever forwarded (decision 2).
     - (i) **Mid-construction fence:** `createService` calls `keys.reset()`. Rejects `SessionEndedError`, and `createSendQuote` is never called.
     - (k) **Post-op fence:** `createSendQuote` calls `keys.reset()` and then resolves `makeSendQuote()`. Rejects `SessionEndedError`, so no `transactionId` comes back for an ended session.
     - (l) **Retry-relevant errors propagate unchanged:** a `ConcurrencyError` and, in a separate case, a `DomainError('Quote has expired')` from the service each reject as the **same instance**. The web retry policy depends on `instanceof ConcurrencyError` (`cashu-send-quote-hooks.ts:182`).
     - (m) **Abort-signal identity and seed non-access through the real default service.** Call `createSendApi` directly **without** `createService`, with `keys = createSessionKeys({ readCashuSeed: async () => { throw new Error('cashu seed must not be read'); } })`, and `createRepository` returning `{ create }`. `create` records `(args, options)` and returns `makeSendQuote()`.
       - Account: `cashuDomain` with `proofs: [{ id: 'p1', keysetId: 'ks-1', amount: 64, secret: 's1', unblindedSignature: 'C1' }]` and `wallet: { getKeyset: () => ({ id: 'ks-1' }), selectProofsToSend: (proofs) => ({ send: proofs, keep: [] }), getFeesForProofs: () => 0 }`.
       - Quote: `makeLightningQuote()` (melt `amount 50 + fee_reserve 2 ≤ 64`).
       - Assert that the call resolves to `{ transactionId: 'tx-1' }`.
       - Assert `options?.abortSignal` `toBe(keys.sessionSignal())`. This locks the new service → repository hop, which (g)'s fake service cannot see.
       - Assert `args.userId === 'user-x'`, `args.accountId === 'acct-cashu'`, `args.quoteId === 'mq-1'`, `args.keysetId === 'ks-1'`, `args.paymentHash` = the vector hash above, and `args.purpose` / `args.transferId` are `undefined`.
       - The seed error is never thrown.
   - **Unimplemented members:**
     - (n) Accessing `api.resolveDestination`, `api.cashu.getSwapQuote`, `api.cashu.createSwap`, and `api.spark` each throws `NotImplementedError`. Messages: `'send.resolveDestination is not implemented yet.'`, `'send.cashu.getSwapQuote is not implemented yet.'`, `'send.cashu.createSwap is not implemented yet.'`, `'send.spark is not implemented yet.'` (`lib/error.ts:65–69`).
     - (o) **Lazy construction:** build the api with counting `createRepository` / `createService` / `getSession` seams. Construct it, access `api.cashu`, and trigger the throwing getters (inside `expect(...).toThrow`). Every counter stays 0. Construction does no I/O; `sdk.ts` calls the factory in the constructor, and `AgicashSdk.create` is sync with no I/O (`sdk.ts:191–200`).

   **`sdk.test.ts` addition (p):** add a `describe('AgicashSdk namespaces')` with one `it('wires send: cashu quote methods are callable; unlanded send members throw NotImplementedError')`. Create via `AgicashSdk.create(createConfig())` (helper at `sdk.test.ts:20–30`) in `try/finally { await sdk.dispose(); }`, because `create` refuses a second live instance (`:33–45`). Assertions:
   - `sdk.send` does not throw, and `sdk.send` `toBe` `sdk.send`.
   - `typeof sdk.send.cashu.getLightningQuote === 'function'`, and the same for `createQuote`.
   - `expect(() => sdk.send.spark).toThrow(NotImplementedError)`, and the same for `sdk.send.resolveDestination`, `sdk.send.cashu.getSwapQuote`, `sdk.send.cashu.createSwap`, and `sdk.transfer`.
   - Import `NotImplementedError` from `../../lib/error`.

   Existing suites (`receive-api.test.ts`, the other `*-api.test.ts`, `sdk.test.ts` cases) stay green and unmodified.

5. **Web flip** (pinned). The flipped hooks must not reference `useCashuSendQuoteService`, `useUser`, `exchangeRate`, `Big`, or `SendQuoteRequest`. Every other hook, the cache class, the change handlers, and `useProcessCashuSendQuoteTasks` stay byte-identical.

**Gates in the implementer's fork, all mandatory:**
- `bun install`
- `bun run fix:all` exits 0
- `bun run typecheck` exits 0
- `cd packages/wallet-sdk && bun test` is green: the existing suites plus `send-api.test.ts` and the new `sdk.test.ts` case
- `cd apps/web-wallet && bun test` is green

The delivered branch's changed-file set must equal the seven-file list exactly. The orchestrator verifies this with `git archive` + `diff -rq`.

**Task 2 (local, orchestrator): integration, gates, smoke.** Merge the delivery onto the work branch, re-run all gates at the repo root, then run the smoke plan below. Check the network tab against the Foreground parity tables.

**Task 3 (marketplace): adversarial review** of the integrated diff against this plan. Focus prompts:
- Foreground parity (no added requests; `account` / `lightningQuote` caller-supplied; no in-SDK `accounts.get` / `list` / `user.get`).
- Fence order versus `receive-api.ts:130–160`, including **no** `requireUserId()` on the preview.
- The `{ transactionId }` runtime narrowing.
- The `accountId`-in-hook exception and the ConcurrencyError reasoning behind it (decision 11).
- Omitting `exchangeRate`, `purpose`, and `transferId` (decisions 2–3).
- Throwing-getter shape (decision 6).
- Backward compatibility of `createSendQuote` for `transfer-service.ts:253`.
- No canary prune (decision 10).
- The step-18 boundary: processor, change handlers, and unresolved reads untouched; completion verbs off the contract.

Findings route back through the orchestrator; only confirmed findings trigger a fix cycle.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install` | exit 0, lockfile unchanged |
| Lint/format + write | `bun run fix:all` | exit 0 |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun test` | green (existing + `send-api.test.ts` a–o + `sdk.test.ts` p) |
| Web unit tests | `cd apps/web-wallet && bun test` | green |
| Smoke | manual, browser, local stack | see below |

**Smoke plan** (local stack: `bun run dev`, local Supabase, guest signup):

Background facts:
- Guest signup provisions, in development mode only, **Testnut BTC** and **Testnut USD** cashu accounts on `https://testnut.cashu.space` with `isTestMint: true` (`domain/user/user-api.ts:27–62`), next to the default Spark BTC account (`:29–38`).
- **The send flow does not gate on `canSendToLightning`.** That check (`domain/accounts/account.ts:106–114`, false for test mints at `:110`) is only called by transfer (`transfer-service.ts:84`) and token receive (`receive-cashu-token-service.ts:177`, `:228`; `receive-cashu-token-hooks.ts:357`). A grep of `features/send/` finds no call. `send-store.ts:169–170` lists `BOLT11_INVOICE` / `LN_ADDRESS` / `AGICASH_CONTACT` as supported for every cashu account.
- A testnut account can therefore request a melt quote and create a send quote for any amount-bearing bolt11.
- Lightning **receive** into a testnut account is not gated either (`canReceiveFromLightning` is used only at `transfer-service.ts:89` and `receive-cashu-token-service.ts:212`).
- Testnut runs Nutshell's `FakeWallet`. With `fakewallet_brr` on, which is what makes testnut mint quotes self-pay, `create_invoice` marks its own invoices paid, and `pay_invoice` settles *any* invoice whose hash it issued or, with brr, any invoice at all (Nutshell `cashu/lightning/fake.py`, `pay_invoice` / `mark_invoice_paid`).
- That testnut has brr on is an external, observed property, not a repo fact. Step 1 below verifies it: if funding does not complete, testnut's config changed, and steps 4–5 degrade to "quote created, payment not settled".

Steps:

1. **Fund (runnable locally; needs internet to testnut).** Sign up as guest. Receive Lightning into **Testnut BTC** for e.g. 1,000 sat: `sdk.receive.cashu.createQuote`, step 9. Testnut auto-pays the mint quote; the receive processor (`/temporary`) mints, and the balance shows 1,000 sat.
2. **Get a payable invoice locally.** Open Receive → Lightning on **Testnut USD** (or Testnut BTC from a second guest in another browser profile) for a small amount, and copy the bolt11. That is a testnut mint quote invoice, which carries an amount (cashu accounts reject amountless invoices, `cashu-send-quote-service.ts:141–145`). Do **not** use a Spark-account invoice: that is a real mainnet Breez invoice, and a fake melt would mark the send paid with no sats arriving.
3. **Quote preview (flipped hook a; runnable).** Send → choose Testnut BTC → paste the invoice → Continue. `send-store.ts:384` → `sdk.send.cashu.getLightningQuote`. The confirmation page shows amount, fee reserve, and total.
   - Network: exactly one `POST https://testnut.cashu.space/v1/melt/quote/bolt11`. No Supabase request. No Open Secret key read (encryption is already memoized).
   - Negative check: paste a bolt11 with a past expiry (e.g. the BOLT11 spec vector). Expect the toast "Lightning invoice has expired" and no mint request.
4. **Confirm (flipped hook b; runnable).** Click Confirm. `send-confirmation.tsx:182` → `sdk.send.cashu.createQuote`.
   - Network: exactly one `POST …/rest/v1/rpc/create_cashu_send_quote` to the local Supabase. No `accounts` select and no `users` select.
   - The app navigates to `/transactions/<transactionId>` (`send-confirmation.tsx:128`), which proves the narrowed `{ transactionId }` result is enough.
5. **Background completion (runnable with testnut brr; still `/temporary`).** The realtime `CASHU_SEND_QUOTE_CREATED` → `useProcessCashuSendQuoteTasks` path subscribes to the melt quote, initiates the melt (`initiateSend`), and marks it pending then paid. The transaction shows Paid, and the Testnut BTC balance drops by amount + fee − change. For a testnut-issued invoice, the receiving Testnut USD/BTC quote also completes (internal settlement). This step verifies the step-18 boundary is intact, not new SDK code.
6. **ConcurrencyError path (optional, runnable):** open the confirm page in two tabs for two different invoices that would each select the same proofs. Confirm both quickly. The second either succeeds after retry with re-read proofs or fails with "Insufficient balance". It must **not** spin indefinitely. This exercises decision 11.
7. **Spark default account (regression only):** Send → Spark account → any invoice → Continue should still show the spark quote (step 15's hooks are untouched). Do not confirm with a real Spark balance unless you intend a real payment.

**Paths that need a real Lightning payment and cannot be run locally:**
- Cashu send from a **non-test** mint account to an external (non-testnut) invoice. The quote preview and `createQuote` are runnable against any real mint that issues melt quotes (steps 3–4 apply unchanged), but the melt completing (step 5) requires the mint to actually pay over Lightning.
- LN-address / contact sends (`destinationDetails` set). The invoice comes from an LNURL server (`getInvoiceFromLud16`, `send-provider.tsx:31`). Locally, a testnut account can quote and create the send quote against such an invoice; completion depends on testnut's fake settlement and pays nothing real. To verify `destinationDetails` passthrough, check the created transaction's details page, which shows the LN address; actual delivery needs a real mint.

No console errors on any runnable path.

## Foreground parity accounting

Rule: the flipped flow adds **zero** network requests versus master. Notes for both tables:
- **Encryption.** `keys.getEncryption()` is memoized per session (`session-keys.ts:200–262`) and warmed by `sdk.accounts.list()` (`accounts-api.ts:35–39`, called from the protected layout via `account-hooks.ts:142`). Master's `useEncryption()` is a warm suspense query. Encrypting the payload and `computeSHA256` are local (`cashu-send-quote-repository.ts:147–150`).
- **Supabase JWT.** The SDK's db client (`sdk.ts:146–150`) reuses the third-party token already minted for `accounts.list`. Master's `agicashDbClient` (`features/agicash-db/database.client.ts:11–17`) has its own warm token. Both: 0 token requests on this flow.

### A. Quote preview (`send-store.ts:384` → `getCashuLightningQuote`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Mint `POST /v1/melt/quote/bolt11` | 1 | 1 | `account.wallet.createMeltQuoteBolt11` (`cashu-send-quote-service.ts:150`); same wallet object (caller-supplied account). |
| Mint keyset/info for proof fees | 0 | 0 | `getFeesForProofs` / `selectProofsToSend` use the already-initialized wallet. |
| Supabase (any) | 0 | 0 | Preview persists nothing; repository constructed but unused. |
| Open Secret key read | 0 | 0 | Encryption memoized (see above); no seed read (decision 9). |
| Account / user re-fetch | 0 | 0 | `account` from the store (`send-store.ts:327`, `getSourceAccount`). |
| Retry on non-Domain error | ≤1 extra | ≤1 extra | `retry` unchanged (`cashu-send-quote-hooks.ts:135–140`). |
| **Net added** | | **0** | |

The `getInvoiceFromLud16` LNURL fetch before the preview (LN address / contact) is unchanged and not part of the SDK call.

### B. Confirm / create quote (`send-confirmation.tsx:182` → `useInitiateCashuSendQuote`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Supabase RPC `create_cashu_send_quote` | 1 | 1 | Same args: `userId` now from the session instead of `useUser`, both the same identity. |
| Accounts cache lookup | 0 network | 0 network | `getCashuAccount(accountId)` kept per attempt (decision 11). |
| User read | 0 (`useUser` cache) | 0 (session) | |
| Mint HTTP | 0 | 0 | `createSendQuote` uses `wallet.getKeyset()` locally; the melt runs later in the processor. |
| Retries on `ConcurrencyError` | 1 RPC per attempt, fresh proofs | same | Recovery preserved. |
| Post-create processor (melt, mark pending, complete) | unchanged | unchanged | `/temporary`, step 18. |
| **Net added** | | **0** | |

## Out of scope

- **Background processing (step 18):** `useProcessCashuSendQuoteTasks` (`initiateSend`, `markSendQuoteAsPending`, `completeSendQuote`, `failSendQuote`, `expireSendQuote`), the change handlers, the unresolved-quotes query, and `useCashuSendQuoteService` / `useCashuSendQuoteRepository`.
- **The send repo/service host/processing split:** step 18.
- **`resolveDestination`:** stays throwing; contract shape unresolved (decision 5, Open question 1).
- **`send.cashu.getSwapQuote` / `createSwap`** (step 14) and **`send.spark.*`** (step 15).
- **Transfer (step 16):** `transfer-service.ts` and `transfer-service-hooks.ts`. They keep calling the service directly, with `purpose` / `transferId`.
- **Amountless invoice support / `exchangeRate`:** forward path in decision 3.
- **`temporary.ts` pruning:** none made dead (decision 10). `index.ts`, `events.ts`, `.server.ts`: untouched.
- **No DB schema, RPC, dependency, or migration changes.**

## Open questions

1. **`resolveDestination` contract shape and owner.** The contract has `(input: string) => Promise<DestinationDetails>`, while the implementation takes `string | Contact` plus `{ allowZeroAmountBolt11 }` and returns a `SendDestination` result union. Which step owns reconciling them (15, 19, or a dedicated slice), and should the public verb return `SendDestination` and throw `DomainError` instead of returning `{ success: false }`? This does not block step 13.
2. **Testnut FakeWallet settings** are external. If testnut ever disables brr, smoke steps 1 and 5 stop completing locally. Steps 3–4, the two flipped calls, still run. A local Nutshell FakeWallet mint (`MINT_BACKEND_BOLT11_SAT=FakeWallet`) would remove the dependency, but that is tooling outside this slice.
