# Wallet SDK Transfer Slice (Step 16) Implementation Plan

> **Orchestration note:** one whole-slice contribution job, after adversarial review of this plan. The implementer forks at the base of `sdk/transfer-slice` (off `master` at `3c48b07`, the step-15 merge, PR #1190) and delivers the File map together. The orchestrator integrates, runs the Verification gates, then sends the diff to adversarial review. All `path:line` citations are valid at `3c48b07`. Stack: TypeScript, bun, bun:test, Supabase, TanStack Query v5 (web only).

**Goal:** Implement `transfer.getQuote` and `transfer.initiate`. Replace the `unknown` params and `{ transactionId: string }` (`domain/sdk/transfer.ts:3–10`) and the throwing `get transfer()` (`domain/sdk/sdk.ts:60–62`) with `readonly transfer` wired like `send` (`sdk.ts:57`, `:187–192`). Flip the two transfer mutations off `@agicash/wallet-sdk/temporary`. `send.resolveDestination`, `featureFlags`, and `taskProcessor` stay throwing getters.

**Architecture:** Step 16 of the no-cache extraction (`2026-06-24-wallet-sdk-no-cache-production-design.md:68–109`, step 16 at `:94`). `createTransferApi` wraps `TransferService` (`transfer-service.ts:58–64`), which already calls the four quote services with `purpose: 'TRANSFER'` and a fresh `transferId` (`:125–140`, `:204–273`). It does not call `sdk.receive.*` or `sdk.send.*`: public send `createQuote` omits those fields (`send-api.ts:173–178`), so that route would persist `PAYMENT`. Background verbs stay on `/temporary` until step 18.

## Global constraints

- **Caller-supplied domain objects** (#1176): `sourceAccount`, `destinationAccount`, and `quote` are full objects, never ids the SDK re-fetches. A flipped flow adds zero network requests versus master (`2026-06-24-wallet-sdk-no-cache-production-design.md:31–37`, `2026-07-02-wallet-sdk-contract-proposal.md:297–324`).
- **`userId` is implicit** (`contract-proposal.md:299–301`). `initiate` uses `requireUserId()` (`send-api.ts:42–48`, `:169`). **`get*` previews, `initiate` persists** (`contract-proposal.md:302–306`; `transfer-service.ts:67–68`, `:75–104`, `:106–154`). **Completion verbs stay off the public surface** (`contract-proposal.md:317–320`); `failReceiveQuote` (`transfer-service.ts:229–244`) is not exposed.
- React-agnostic: `packages/wallet-sdk` never imports `react` or `@tanstack/react-query`. No SDK events (`domain/sdk/events.ts` untouched). No schema, RPC, dependency, or migration changes. Create RPCs: `cashu-receive-quote-repository.ts:68`, `spark-receive-quote-repository.ts:57`, `cashu-send-quote-repository.ts:152`, `spark-send-quote-repository.ts:91`. Fail RPCs: `cashu-receive-quote-repository.ts:137`, `spark-receive-quote-repository.ts:194`. No `bun add`, no `db:generate-types`.
- Fences match `send-api.ts:156–183` (decision 6). `purpose` / `transferId` stay off public params (decision 5). Canary: prune only `TransferService` (decision 9). Only File-map files change.
- `index.ts` is untouched. `TransferQuote` / `TransferReceiveSide` / `TransferSendSide` are already root-exported (`index.ts:121–125`). New types ship via `index.ts:10` → `domain/sdk/index.ts:30`. The root shadowing of `TransferQuote` stays on purpose: `domain/sdk/transfer.ts` imports it and does not re-export it (step 15 kept `SparkSendQuote` the same way).
- `bun` / `bunx` only. Base: `master` at `3c48b07`. Work branch: `sdk/transfer-slice`. Biome `recommended` is on (`biome.jsonc:22`), including `noUnusedVariables` / `noUnusedImports` (`:64`, `:68`). Do not use the `delete` operator.

## Resolved design decisions

1. **Scope = the two web mutations.** `useGetTransferQuote` (`transfer-hooks.ts:8–35`) calls `getTransferQuote` (`:21–25`); `transfer-provider.tsx:27` passes `mutateAsync` into the store (`:34`), which calls it with both accounts and the amount (`transfer-store.ts:44–53`); `transfer-input.tsx:81` awaits that. `useInitiateTransfer` (`transfer-hooks.ts:37–57`) reads `useUser` (`:38`) and calls `initiateTransfer({ userId, quote })` (`:42–43`). `transfer-confirmation.tsx:28` mutates `{ quote }` (`:32–33`) and navigates to `/transactions/${result.receiveTransactionId}` (`:35–39`). The only `TransferService` constructor is `useTransferService` (`transfer-service-hooks.ts:7–17`), the only importer of `temporary.ts:141`. Step 18 keeps the four `use*QuoteService` hooks and their processors; this file is their only transfer caller (`transfer-service-hooks.ts:2–5`).

2. **`GetTransferQuoteParams` = `{ sourceAccount: Account; destinationAccount: Account; amount: Money }`.** Service fields (`transfer-service.ts:75–82`) and store fields (`transfer-store.ts:49–53`). `Account` is the cashu|spark union (`account.ts:25`). Both accounts are already in the store (`transfer-store.ts:44–45`). No `accounts.get` / `list`. **`getQuote` does not call `requireUserId()`** — the preview hook never reads the user (`transfer-hooks.ts:8–10`), matching `send-api.ts:156–167`. A logged-out `getSession` still reaches the service (test q1).

3. **`InitiateTransferParams` = `{ quote: TransferQuote }`.** Confirm passes `{ quote }` (`transfer-confirmation.tsx:32–33`). The API calls `requireUserId()` and passes `userId` into `initiateTransfer`, which keeps that field (`transfer-service.ts:114–119`). The hook drops `useUser` (`transfer-hooks.ts:38`). That hook is a warm suspense read; `requireUserId` reads the in-memory session (`send-api.ts:42–48`). Same identity, no user fetch.

4. **`initiate` returns `{ transferId, receiveTransactionId, sendTransactionId }`.** The placeholder `{ transactionId: string }` (`transfer.ts:6`, sketch `contract-proposal.md:226–228`) names one id. The only consumer reads `receiveTransactionId` (`transfer-confirmation.tsx:35–39`). The service already returns all three (`transfer-service.ts:120–124`, `:136–140`); returning them adds no read. Commit `5ba41825` scoped "send returns only an id" to lightning `createQuote` (`contract-proposal.md:326–343`); step 14 then widened `createSwap` to `{ swap }` because the host needed the object. Transfer widens the same way: the host opens the receive leg, and `transferId` is the link the two quotes already share. The API returns those three fields explicitly. `transfer-confirmation.tsx` stays byte-identical. Do not edit the prose sketch; `domain/sdk/transfer.ts` is binding. `getQuote` returns the domain `TransferQuote` (drop the comment on `transfer.ts:5`). The screen reads `totalCost`, `amountToReceive`, `totalFees`, and both account names (`transfer-confirmation.tsx:70–97`). Narrowing is #1164 (`domain/sdk/send.ts:8–11`).

5. **`purpose` and `transferId` stay off the public params.** `initiateTransfer` mints `transferId` via `crypto.randomUUID()` (`transfer-service.ts:125`) and both persist helpers hardcode `purpose: 'TRANSFER'` (`:215–216`, `:224–225`, `:262–263`, `:270–271`). Public receive `createQuote` still accepts them (`domain/sdk/receive.ts:68–71`); public send `createQuote` does not. Calling `sdk.send` would persist the RPC default `PAYMENT`.

6. **Both methods get the send-template fence.** `getQuote` matches `send-api.ts:156–167`: no `requireUserId()`, capture `sessionSignal()`, await `getService()`, re-check, `getTransferQuote({ sourceAccount, destinationAccount, amount })` with no second argument, re-check, return. `getTransferQuote` gains no `options`. Its callees take none (`cashu-receive-quote-service.ts:42–44`, `spark-receive-quote-core.ts:230`, `cashu-send-quote-service.ts:98–103`, `spark-send-quote-service.ts:112–116`). `initiate` matches `send-api.ts:168–183`: `requireUserId()` first, then the signal, then `initiateTransfer({ userId, quote }, { abortSignal: signal })`, then re-check. No result for an ended session. `initiateTransfer` gains `options?: { abortSignal?: AbortSignal }` and forwards that one object into both `createReceiveQuote` / `createSendQuote` calls, which already take it (`cashu-receive-quote-service.ts:59–61`, `spark-receive-quote-service.ts:31–33`, `cashu-send-quote-service.ts:204–240`, `spark-send-quote-service.ts:200–202`). After the flip there is no in-package caller (decision 1). **`fail` does not gain `options`.** Both `fail` methods take `(quote, reason)` only (`cashu-receive-quote-service.ts:179`, `spark-receive-quote-service.ts:152`). The cleanup (`transfer-service.ts:141–152`), including `console.error` at `:145`, stays byte-identical.

7. **Factory seams.** `createService?` is the fenced object (same role as `createSparkService`, `send-api.ts:36–37`). Each of the four quote services also has a service seam and a repository seam. Default `getService` does `new TransferService(...)` in ctor order (`transfer-service.ts:59–64`) and is skipped when `createService` is set. **db + `getEncryption()` only:** `SparkReceiveQuoteRepository` (`spark-receive-quote-repository.ts:19–22`), `CashuSendQuoteRepository` (`cashu-send-quote-repository.ts:103–106`), `SparkSendQuoteRepository` (`spark-send-quote-repository.ts:59–62`), and their services (`spark-receive-quote-service.ts:15`, `cashu-send-quote-service.ts:96`, `spark-send-quote-service.ts:107`). **`getAccountRepository` is required only by `CashuReceiveQuoteRepository`'s constructor** (`cashu-receive-quote-repository.ts:23–27`). `create()` does not call it (`:33–93`); `toAccount` is the background payment/complete path (`:269`, `:345`). `accounts.getRepository` only constructs (`accounts-api.ts:35–46`). **`CashuCryptography` is also required** (`cashu-receive-quote-service.ts:33–36`) because the cashu preview calls `getXpub` (`:45–47`). Build it from `keys` exactly as `receive-api.ts:54–59` (`getCashuSeed`, `deriveCashuXpub`, `getCashuPrivateKey`). It is not read until `getLightningQuote`. `getSparkMnemonic` is not on this path. **Do not edit `getTransferQuote` / `getReceiveSide` / `getSendSide`.** The spark receive preview calls core `getLightningQuote` (`transfer-service.ts:13`, `:175–178`), not `SparkReceiveQuoteService.getLightningQuote` (`spark-receive-quote-service.ts:21–25`). Initiate still uses that service (`transfer-service.ts:219–227`, `:239–241`).

8. **No per-attempt account re-read.** The mutation variable is the full quote (`transfer-hooks.ts:42`, `transfer-service.ts:126`). A cashu `ConcurrencyError` (`cashu-send-quote-repository.ts:175–176`) retries that same quote. Spark `23505` is a `DomainError` (`spark-send-quote-repository.ts:110–114`) and is not retried. The API does not catch either. **Known pre-existing defect, kept for parity:** the `ConcurrencyError → true` retry re-uses the same stale `quote`, so each attempt re-picks proofs from the same `send.account` (`cashu-send-quote-service.ts:257–260`), hits the same `CONCURRENCY_ERROR` (`cashu-send-quote-repository.ts:175–176`), and first mints a fresh `transferId` plus persists-then-fails a new receive quote (`transfer-service.ts:125`, `:128–143`). Master behaves identically (`transfer-hooks.ts:45–48`), so the flip changes nothing; the fix (re-read `quote.send.account` per attempt, step-13 style) is a follow-up, not this slice (see Out of scope).

9. **Canary: delete `temporary.ts:141` only.** After `transfer-service-hooks.ts` is gone, a repo-wide `TransferService` grep must find only `transfer-service.ts` (the class), `transfer-api.ts` (imports and constructs it), and `transfer-api.test.ts` — no `apps/` hit and no `temporary.ts` hit. The four services stay (`temporary.ts:117`, `:119`, `:126`, `:132`). Grep before and after the delete.

10. **Web flip is `transfer-hooks.ts` only.** Provider, confirmation, store, and input stay byte-identical. Preview retry: `SessionEndedError → false` first, then `DomainError → false`, then `failureCount < 1` (`transfer-hooks.ts:27–33`). No `scope`, no `ConcurrencyError` branch. Initiate retry: `SessionEndedError → false` first, then `ConcurrencyError → true`, then `DomainError → false`, then `failureCount < 1` (`:45–55`). No `scope`. `SessionEndedError` is first because it must never be retried (`lib/error.ts:50–56`); master's initiate predicate would fall through to `failureCount < 1`. **Limit:** an abort during an in-flight `create_*` rejects as a plain repository `Error` (`cashu-receive-quote-repository.ts:89`), skips the post-op fence, and retries once. That retry also re-runs `requireUserId()` against the live session while `quote` stays caller-held; with the ~1 s default backoff an identity swap between attempts is implausible and the RLS-scoped RPCs bound it — recorded with the family-wide in-flight-abort remap follow-up (Out of scope), not patched per-slice. The send-persist failure path still calls `failReceiveQuote` before rethrowing (`transfer-service.ts:141–152`) without the signal (decision 6). Imports: `SessionEndedError` from `@agicash/wallet-sdk`, `sdk` from `~/features/shared/sdk.client`, keep `ConcurrencyError` and `DomainError` on `/temporary` (`transfer-hooks.ts:3`). Drop `useUser` and `useTransferService`. Delete `transfer-service-hooks.ts`.

11. **`sdk.ts`:** `readonly transfer: TransferApi`, assigned from `createTransferApi({ db, getSession: getLiveSession, keys, getAccountRepository: accounts.getRepository })`. `featureFlags` and `taskProcessor` stay throwing (`sdk.ts:63–68`). `index.ts`, `domain/sdk/index.ts`, and `events.ts` stay byte-identical.

## Pinned seams (authoritative for the implementation)

### Contract (`packages/wallet-sdk/domain/sdk/transfer.ts`)

Replace the file with:

```ts
import type { Money } from '@agicash/money';
import type { Account } from '../accounts/account';
import type { TransferQuote } from '../transfer/transfer-service';

export type TransferApi = {
  /** Stateless preview. Computes lightning quotes and does not persist them. */
  getQuote(params: GetTransferQuoteParams): Promise<TransferQuote>;
  /** Persists the receive quote, then the send quote. Completion is background-only. */
  initiate(params: InitiateTransferParams): Promise<InitiateTransferResult>;
};
export type GetTransferQuoteParams = {
  /** Caller-supplied sending account. The SDK does not re-fetch it. */
  sourceAccount: Account;
  /** Caller-supplied receiving account. The SDK does not re-fetch it. */
  destinationAccount: Account;
  /** The amount to transfer. */
  amount: Money;
};
export type InitiateTransferParams = {
  /** The quote returned by `getQuote`. */
  quote: TransferQuote;
};
export type InitiateTransferResult = {
  /** UUID linking the receive and send quotes. */
  transferId: string;
  /** Transaction id of the receive leg. */
  receiveTransactionId: string;
  /** Transaction id of the send leg. */
  sendTransactionId: string;
};
```

Let `bun run fix:all` confirm import order. `TransferQuote` is imported, not re-exported (the root export stays `index.ts:121–125`).

### Service (`packages/wallet-sdk/domain/transfer/transfer-service.ts`)

`getTransferQuote` (`:75–104`), `getReceiveSide`, `getSendSide`, and `failReceiveQuote` stay byte-identical. Change `initiateTransfer` to:

```ts
  async initiateTransfer(
    { userId, quote }: { userId: string; quote: TransferQuote },
    options?: { abortSignal?: AbortSignal },
  ): Promise<{ transferId: string; receiveTransactionId: string; sendTransactionId: string }> {
    const transferId = crypto.randomUUID();
    const { receive, send } = quote;
    const receiveQuote = await this.persistReceiveQuote(
      userId,
      receive,
      transferId,
      options,
    );
    try {
      const sendQuote = await this.persistSendQuote(
        userId,
        send,
        transferId,
        options,
      );
      return {
        transferId,
        receiveTransactionId: receiveQuote.transactionId,
        sendTransactionId: sendQuote.transactionId,
      };
    } catch (error) {
      try {
        await this.failReceiveQuote(receive, receiveQuote);
      } catch (failError) {
        console.error('Failed to cleanup receive quote', {
          cause: failError,
          transferId,
          receiveAccountId: receive.account.id,
          sendAccountId: send.account.id,
        });
      }
      throw error;
    }
  }
```

Add `options?: { abortSignal?: AbortSignal }` as the fourth parameter of `persistReceiveQuote` (`:204`) and `persistSendQuote` (`:246`). Pass it as the second argument of each `createReceiveQuote` / `createSendQuote` call (`:210`, `:219`, `:253`, `:266`). The first-argument objects stay byte-identical, including `purpose: 'TRANSFER'` and `transferId`.

### API factory (`packages/wallet-sdk/domain/transfer/transfer-api.ts`)

```ts
import type { AgicashDb } from '../../db/database';
import { type CashuCryptography, getCashuPrivateKey } from '../../lib/cashu';
import { deriveCashuXpub } from '../../lib/cryptography';
import { NoSessionError, SessionEndedError } from '../../lib/error';
import type { AccountRepository } from '../accounts/account-repository';
import { CashuReceiveQuoteRepository } from '../receive/cashu-receive-quote-repository';
import { CashuReceiveQuoteService } from '../receive/cashu-receive-quote-service';
import { SparkReceiveQuoteRepository } from '../receive/spark-receive-quote-repository';
import { SparkReceiveQuoteService } from '../receive/spark-receive-quote-service';
import type { AuthSession, TransferApi } from '../sdk';
import type { SessionKeys } from '../sdk/session-keys';
import { CashuSendQuoteRepository } from '../send/cashu-send-quote-repository';
import { CashuSendQuoteService } from '../send/cashu-send-quote-service';
import { SparkSendQuoteRepository } from '../send/spark-send-quote-repository';
import { SparkSendQuoteService } from '../send/spark-send-quote-service';
import { TransferService } from './transfer-service';

type Deps = {
  db: AgicashDb;
  getSession: () => AuthSession;
  keys: SessionKeys;
  /** Required by the CashuReceiveQuoteRepository constructor only. */
  getAccountRepository: () => Promise<AccountRepository>;
  /** Test seam. Default builds `TransferService` from the four services. */
  createService?: () => Promise<TransferService>;
  createCashuReceiveRepository?: () => Promise<CashuReceiveQuoteRepository>;
  createCashuReceiveService?: () => Promise<CashuReceiveQuoteService>;
  createSparkReceiveRepository?: () => Promise<SparkReceiveQuoteRepository>;
  createSparkReceiveService?: () => Promise<SparkReceiveQuoteService>;
  createCashuSendRepository?: () => Promise<CashuSendQuoteRepository>;
  createCashuSendService?: () => Promise<CashuSendQuoteService>;
  createSparkSendRepository?: () => Promise<SparkSendQuoteRepository>;
  createSparkSendService?: () => Promise<SparkSendQuoteService>;
};

/** Creates the `transfer` SDK namespace. */
export function createTransferApi(deps: Deps): TransferApi {
  const requireUserId = (): string => {
    const session = deps.getSession();
    if (!session.isLoggedIn) {
      throw new NoSessionError();
    }
    return session.user.id;
  };

  const cryptography: CashuCryptography = {
    getSeed: () => deps.keys.getCashuSeed(),
    getXpub: async (path) =>
      deriveCashuXpub(await deps.keys.getCashuSeed(), path),
    getPrivateKey: getCashuPrivateKey,
  };

  const getCashuReceiveRepository =
    deps.createCashuReceiveRepository ??
    (async (): Promise<CashuReceiveQuoteRepository> => {
      const encryption = await deps.keys.getEncryption();
      const accountRepository = await deps.getAccountRepository();
      return new CashuReceiveQuoteRepository(
        deps.db,
        encryption,
        accountRepository,
      );
    });
  const getCashuReceiveService =
    deps.createCashuReceiveService ??
    (async (): Promise<CashuReceiveQuoteService> =>
      new CashuReceiveQuoteService(
        cryptography,
        await getCashuReceiveRepository(),
      ));
  const getSparkReceiveRepository =
    deps.createSparkReceiveRepository ??
    (async (): Promise<SparkReceiveQuoteRepository> =>
      new SparkReceiveQuoteRepository(deps.db, await deps.keys.getEncryption()));
  const getSparkReceiveService =
    deps.createSparkReceiveService ??
    (async (): Promise<SparkReceiveQuoteService> =>
      new SparkReceiveQuoteService(await getSparkReceiveRepository()));
  const getCashuSendRepository =
    deps.createCashuSendRepository ??
    (async (): Promise<CashuSendQuoteRepository> =>
      new CashuSendQuoteRepository(deps.db, await deps.keys.getEncryption()));
  const getCashuSendService =
    deps.createCashuSendService ??
    (async (): Promise<CashuSendQuoteService> =>
      new CashuSendQuoteService(await getCashuSendRepository()));
  const getSparkSendRepository =
    deps.createSparkSendRepository ??
    (async (): Promise<SparkSendQuoteRepository> =>
      new SparkSendQuoteRepository(deps.db, await deps.keys.getEncryption()));
  const getSparkSendService =
    deps.createSparkSendService ??
    (async (): Promise<SparkSendQuoteService> =>
      new SparkSendQuoteService(await getSparkSendRepository()));
  const getService =
    deps.createService ??
    (async (): Promise<TransferService> =>
      new TransferService(
        await getCashuReceiveService(),
        await getSparkReceiveService(),
        await getCashuSendService(),
        await getSparkSendService(),
      ));

  return {
    getQuote: async (params) => {
      const signal = deps.keys.sessionSignal();
      const service = await getService();
      if (signal.aborted) throw new SessionEndedError();
      const quote = await service.getTransferQuote({
        sourceAccount: params.sourceAccount,
        destinationAccount: params.destinationAccount,
        amount: params.amount,
      });
      if (signal.aborted) throw new SessionEndedError();
      return quote;
    },
    initiate: async (params) => {
      const userId = requireUserId();
      const signal = deps.keys.sessionSignal();
      const service = await getService();
      if (signal.aborted) throw new SessionEndedError();
      const result = await service.initiateTransfer(
        { userId, quote: params.quote },
        { abortSignal: signal },
      );
      if (signal.aborted) throw new SessionEndedError();
      return {
        transferId: result.transferId,
        receiveTransactionId: result.receiveTransactionId,
        sendTransactionId: result.sendTransactionId,
      };
    },
  };
}
```

### `sdk.ts`

Add `import { createTransferApi } from '../transfer/transfer-api';`. Replace the getter at `:60–62` with `readonly transfer: TransferApi;` placed next to `readonly send` (`:57`). In the constructor, immediately after `this.send = createSendApi(...)` (`:187–192`):

```ts
    this.transfer = createTransferApi({
      db,
      getSession: getLiveSession,
      keys,
      getAccountRepository: accounts.getRepository,
    });
```

### Web flip (`apps/web-wallet/app/features/transfer/transfer-hooks.ts`)

Replace the file with:

```ts
import type { Money } from '@agicash/money';
import type { Account, TransferQuote } from '@agicash/wallet-sdk';
import { SessionEndedError } from '@agicash/wallet-sdk';
import { ConcurrencyError, DomainError } from '@agicash/wallet-sdk/temporary';
import { useMutation } from '@tanstack/react-query';
import { sdk } from '~/features/shared/sdk.client';

export function useGetTransferQuote() {
  return useMutation({
    mutationFn: ({
      sourceAccount,
      destinationAccount,
      amount,
    }: {
      sourceAccount: Account;
      destinationAccount: Account;
      amount: Money;
    }) =>
      sdk.transfer.getQuote({ sourceAccount, destinationAccount, amount }),
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }

      if (error instanceof DomainError) {
        return false;
      }

      return failureCount < 1;
    },
  });
}

export function useInitiateTransfer() {
  return useMutation({
    mutationFn: ({ quote }: { quote: TransferQuote }) => {
      return sdk.transfer.initiate({ quote });
    },
    retry: (failureCount, error) => {
      if (error instanceof SessionEndedError) {
        return false;
      }

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

Delete `transfer-service-hooks.ts`.

### Canary (`packages/wallet-sdk/temporary.ts`)

Delete `export { TransferService } from './domain/transfer/transfer-service';` (`:141`). Leave every other export.

## File map

Modify `packages/wallet-sdk/domain/sdk/transfer.ts`, `packages/wallet-sdk/domain/transfer/transfer-service.ts`, `packages/wallet-sdk/domain/sdk/sdk.ts`, `packages/wallet-sdk/domain/sdk/sdk.test.ts`, `packages/wallet-sdk/temporary.ts` (drop the `TransferService` line), `apps/web-wallet/app/features/transfer/transfer-hooks.ts`. Create `packages/wallet-sdk/domain/transfer/transfer-api.ts` and `transfer-api.test.ts`. Delete `apps/web-wallet/app/features/transfer/transfer-service-hooks.ts`.

Untouched: `packages/wallet-sdk/index.ts`, `domain/sdk/index.ts`, `events.ts`, `receive.ts`, `send.ts`, `send-api.ts`, `receive-api.ts`, the four quote services and repositories, `spark-receive-quote-core.ts`, `getTransferQuote` / `getReceiveSide` / `getSendSide` / `failReceiveQuote`, `transfer-provider.tsx`, `transfer-confirmation.tsx`, `transfer-store.ts`, `transfer-input.tsx`, the four `*-quote-hooks.ts` files, `sdk.client.ts`, the contract-proposal doc, every RPC and migration.

## Task specs

**Task 0 (local, orchestrator): branch + plan commit.** The commit that adds this document is the pinned base of the implementation job (`sdk/transfer-slice` off `3c48b07`). The implementation job appends its delivery branch onto it.

**Task 1 (contribution, single implementer): the whole slice.** Edit exactly the File-map paths, applying the pinned seams verbatim. Working order:

1. **Read first:** `domain/send/send-api.ts:156–183` and `send-api.test.ts` (`makeApi` at `:222–249`, spark tests at `:1070–1511`), `domain/receive/receive-api.ts:54–105`, `domain/sdk/sdk.ts:50–68` and `:181–193`, `domain/sdk/sdk.test.ts:81–98`, `domain/transfer/transfer-service.ts`, `domain/sdk/session-keys.ts:72–77` (fake readers) and `:200–213` (encryption memo), `apps/web-wallet/app/features/transfer/transfer-hooks.ts`, `apps/web-wallet/app/features/send/cashu-send-quote-hooks.ts:112–192` (flipped-hook template). Annotate every nested callback param in test fixtures (TS7006). Read every `let`-captured value through optional chaining: `captured?.account`, `capturedOptions?.abortSignal`, `Object.keys(captured ?? {}).sort()` (precedent `send-api.test.ts:1105`, `:1321`).
2. **Contract, service options, factory, `sdk.ts` wiring** (pinned seams).
3. **Tests** in `transfer-api.test.ts`. Harness: fake `getSession` (`authUser` / `loggedIn`, copy `send-api.test.ts:40–54`), real `createSessionKeys` with `keys.reset()` as the session-end trigger, `as unknown as` casts. `makeApi({ session, keys, service })` passes `createService` only when `service` is set, and does not pass the four service seams; tests that count construction seams (i1, t0) and the default-builder / real-service tests (q5, q6, i6–i11, r1–r3) call `createTransferApi` directly. Default-builder tests and the real-`TransferService` tests call `createTransferApi` directly. `db: {} as AgicashDb`. `getAccountRepository` defaults to `async () => ({}) as AccountRepository` except where a test counts it.

   - **`getQuote`:**
     - (q1) **Passthrough, no session read, no options arg.** `createService` returns a fake service whose `getTransferQuote` records `(...args: unknown[])` and resolves a fixed quote object. `getSession` returns `{ isLoggedIn: false }` and counts calls. Call with `{ sourceAccount, destinationAccount, amount }` (plain objects cast as `Account`, `amount` a real `Money`). Assert `args.length === 1`, `captured` `toEqual` those three fields, `captured.sourceAccount` `toBe` the source, `result` `toBe` the quote, `getSession` 0 calls.
     - (q2) **Mid-construction fence.** `createService` calls `keys.reset()` then returns a service whose `getTransferQuote` counts calls. Rejects `SessionEndedError`, count 0 (pattern `send-api.test.ts:1116–1142`).
     - (q3) **Post-op fence.** `getTransferQuote` calls `keys.reset()` then resolves a quote. Rejects `SessionEndedError`.
     - (q4) **Error identity.** `new DomainError('Testnut BTC cannot send Lightning payments')` rejects as the **same instance** (`rejects.toBe(error)`).
     - (q5) **Default builders: capability error, encryption memo not re-read, seed and mnemonic unread, `getAccountRepository` once.** Call `createTransferApi` with **no** service or repository seams. `keys = createSessionKeys({ readEncryptionPrivateKey, readEncryptionPublicKey, readCashuSeed, readSparkMnemonic })` where the seed and mnemonic readers throw `'cashu seed must not be read'` / `'spark mnemonic must not be read'` and count calls, and the encryption readers count and return `new Uint8Array(32).fill(7)` / `'pub'` (`send-api.test.ts:1216–1230`). `await keys.getEncryption()` first. `getAccountRepository` counts and returns `{}`. Source account `{ type: 'cashu', name: 'Testnut BTC', isTestMint: true } as Account` (so `canSendToLightning` returns false at `account.ts:110` before any wallet read, `transfer-service.ts:84–87`). Any destination. Assert `DomainError` whose message is `'Testnut BTC cannot send Lightning payments'`; private-key reads and public-key reads stay `1`; seed reads and mnemonic reads stay `0`; `getAccountRepository` was called at most once (the cashu receive repository only — do not pin the exact construction count).
     - (q6) **Default builders, cashu destination: the locking key comes from the session cashu xpub.** No service seams; repository seams only where needed. Destination = the `receive-api.test.ts:979–1034` fixture account: `wallet.createLockedMintQuote` records its `pubkey` argument and `wallet.getMintInfo().isSupported(4)` returns `{ disabled: false }`; `readCashuSeed` returns a fixed seed. Source = a spark account; `createSparkSendService` returns a fake whose `getLightningSendQuote` resolves a marker quote. Call `getQuote`. Assert the recorded locking pubkey equals the key derived from the session cashu locking xpub exactly as the receive test derives it; the derivation path starts with `BASE_CASHU_LOCKING_DERIVATION_PATH`; and the fake send service received `paymentRequest === mintQuote.request` (covers `extractPaymentRequest`, `transfer-service.ts:49–56`).
   - **`initiate`:**
     - (i1) **No session.** `getSession` logged out. Call `createTransferApi` directly with counting `createService` and all four `create*Service` seams. Rejects `NoSessionError`; every counter stays `0` (requireUserId runs before construction; pattern `send-api.test.ts:1260–1285`).
     - (i2) **Passthrough, abort-signal identity, three-id result.** Fake `createService` `initiateTransfer` captures `(params: Record<string, unknown>, options?: { abortSignal?: AbortSignal })` and returns `{ transferId: 'tid-1', receiveTransactionId: 'tx-recv', sendTransactionId: 'tx-send' }`. Call `initiate({ quote })`. Assert `captured` `toEqual({ userId: 'user-x', quote })`, `captured.quote` `toBe` the quote, `Object.keys(captured).sort()` equals `['quote', 'userId']` (locks `purpose` / `transferId` off the API→service call), `capturedOptions.abortSignal` `toBe(keys.sessionSignal())`, result `toStrictEqual` the three ids, `Object.keys(result).sort()` equals `['receiveTransactionId', 'sendTransactionId', 'transferId']`.
     - (i3) **Mid-construction fence.** `createService` calls `keys.reset()`. Rejects `SessionEndedError`; `initiateTransfer` never called.
     - (i4) **Post-op fence.** `initiateTransfer` calls `keys.reset()` then resolves the three ids. Rejects `SessionEndedError`.
     - (i5) **`DomainError` identity.** Same-instance rejection from `initiateTransfer`.
     - (i6) **Real `TransferService`, cashu rail: both persists get `purpose: 'TRANSFER'`, one shared `transferId`, and the session signal.** No `createService`. `createCashuReceiveService` / `createCashuSendService` return fakes; the spark service seams throw if their `createReceiveQuote` / `createSendQuote` is called. Accounts `{ type: 'cashu', id: 'acct-dst' }` and `{ type: 'cashu', id: 'acct-src' }`. Quote `{ receive: { account: dst, lightningQuote: recvMarker }, send: { account: src, lightningQuote: sendMarker } } as TransferQuote` (`recvMarker` / `sendMarker` are distinct objects). Receive `createReceiveQuote` captures `(params, options)` and returns `{ transactionId: 'tx-recv' } as CashuReceiveQuote`. Send `createSendQuote` captures and returns `{ transactionId: 'tx-send' }`. `getAccountRepository` and the seed/mnemonic readers throw if called. Assert both captures have `userId === 'user-x'`, `purpose === 'TRANSFER'`, the same `transferId` (and `result.transferId` equals it), `options.abortSignal` `toBe(keys.sessionSignal())`; receive `params.account` `toBe` dst, `params.lightningQuote` `toBe` recvMarker, and `params.receiveType === 'LIGHTNING'`; send `params.account` `toBe` src and the send capture's `sendQuote` maps the four fields by identity from `send.lightningQuote` (`paymentRequest`, `amountRequested`, `amountRequestedInBtc`, `meltQuote`; `transfer-service.ts:256–261` — give sendMarker those four fields); result `{ transferId, receiveTransactionId: 'tx-recv', sendTransactionId: 'tx-send' }`; spark creates were not called; receive `fail` was never called.
     - (i7) **Real `TransferService`, spark rail, same forwarding.** Mirror (i6) with `type: 'spark'` accounts and spark service fakes. Cashu service creates throw if called. Spark send captures `params.quote` `toBe` the send-side lightning quote (`transfer-service.ts:266–272`). Spark receive captures `params.lightningQuote` and `params.receiveType === 'LIGHTNING'`; spark receive `fail` was never called.
     - (i8) **Send-persist failure still fails the receive quote, and `fail` takes no options.** Cashu fakes as in (i6). `createSendQuote` throws `error = new DomainError('boom')`. `fail` records its argument list and the receive-quote identity. Assert the rejection `toBe(error)`; `fail` recorded `(...args: unknown[])` once with `args` equal to `[receiveQuote, 'Transfer initiation failed']` and `args.length === 2`; the receive `createReceiveQuote` options signal `toBe(keys.sessionSignal())`.
     - (i9) **Abort between the persists.** Real `TransferService` with cashu fakes. The receive fake's `createReceiveQuote` calls `keys.reset()` and resolves `{ transactionId: 'tx-recv' }`. The send fake's `createSendQuote` throws `new Error('aborted write')` when `options?.abortSignal?.aborted === true`. Assert the receive `fail` was called once with exactly two arguments, and the rejection `toBe` the send error.
     - (i10) **Receive persist throws.** The receive fake's `createReceiveQuote` throws `error`. Assert the send `createSendQuote` and `fail` were never called and the rejection `toBe(error)`.
     - (i11) **`fail` itself throws.** Send persist throws `sendError`; `fail` throws `failError`. Assert `console.error` was called with `'Failed to cleanup receive quote'` (spy and restore) and the rejection `toBe(sendError)` (`transfer-service.ts:144–152`).
   - **Repository-seam and construction tests** (step-15 coverage parity; they also exercise the four repository seams so none ships dead):
     - (r1) **Cashu rail through the real services, repository seams only.** No service seams. `createCashuReceiveRepository` / `createCashuSendRepository` return fakes whose `create(args, options)` record their arguments and resolve rows the services accept; spark repository seams throw if constructed. Assert both repository `create` calls receive `options.abortSignal === keys.sessionSignal()`; both carry `purpose: 'TRANSFER'` and the same `transferId`; the receive repository `fail` is never called; seed and mnemonic readers stay `0`; `getAccountRepository` ran once. If driving the real cashu services end-to-end demands more mint fixture than the receive/send test files already provide, keep (r1)/(r2) at the service-fake level and say so in the delivery commit body — do not invent new fixture layers.
     - (r2) **Spark rail, mirrored.** Spark repository seams record; cashu repository seams throw if constructed. Same assertions minus `getAccountRepository` (stays `0`).
     - (r3) **Expired send quote through the default service rejects with no write.** Default (real) send service over a recording repository fake; an expired lightning quote (`spark-send-quote-service.ts:204–206` or `cashu-send-quote-service.ts:246–248`). Assert a `DomainError`, the receive repository `create` ran once, and the receive `fail` ran once — the compensating path through real services.
     - (t0) **Construction does nothing.** `createTransferApi` with counting seams and a counting `getSession`; assert every counter is `0` right after construction (no session read, no service or repository built, no key read).
   - **`sdk.test.ts` (edit in place, `:81–98`).** Keep `describe` / `try/finally { await sdk.dispose(); }`. Title becomes `'wires send and transfer; resolveDestination throws NotImplementedError'`. Add `expect(sdk.transfer).toBe(sdk.transfer)`, `expect(typeof sdk.transfer.getQuote).toBe('function')`, and the same for `initiate`. Delete `expect(() => sdk.transfer).toThrow(NotImplementedError)` (`:94`). Keep the `resolveDestination` assertion. Do not call `getQuote` or `initiate`.

4. **Web flip** (pinned seams), then delete `transfer-service-hooks.ts`.
5. **Canary:** grep `TransferService`. The only hits are the class and test imports. Delete `temporary.ts:141` and grep again.

Gates are the Verification table. `bun run fix:all` is repo-wide `biome check --write`; revert any path outside the File map. The delivered diff equals the File map.

**Task 2 (local, orchestrator):** merge, re-run the gates, run the smoke plan, and check the network tab against the parity tables.

**Task 3 (marketplace): adversarial review.** Check: zero added requests and no `accounts.get` / `list` / `user.get` / mnemonic read; fence order versus `send-api.ts:156–183` (no `requireUserId` on `getQuote`; `requireUserId` before the signal on `initiate`; no result after session end); three-id result compiling against `transfer-confirmation.tsx:35–39` unchanged; `purpose: 'TRANSFER'` and one shared `transferId` on both persists, off the public params; abort signal on both `create*` calls and not on `fail`; `getAccountRepository` only for `CashuReceiveQuoteRepository`; `SessionEndedError → false` first, `ConcurrencyError → true` on initiate only; `resolveDestination` / `featureFlags` / `taskProcessor` still throw; `temporary.ts` loses only `TransferService`; spark receive preview still calls core `getLightningQuote` (`transfer-service.ts:175–178`). Confirmed findings go back through the orchestrator.

## Verification summary

| Gate | Command | Expectation |
|---|---|---|
| Install | `bun install --frozen-lockfile` | exit 0, lockfile unchanged |
| Lint/format + write | `bun run fix:all` | exit 0; only the File-map paths modified |
| Types (all pkgs) | `bun run typecheck` | exit 0 |
| SDK unit tests | `cd packages/wallet-sdk && bun run test` | green (249 at the pin + q1–q6, i1–i11, r1–r3, t0 + edited namespace test) |
| Web unit tests | `cd apps/web-wallet && bun run test` | green (40 at the pin) |
| Smoke | manual, browser, local stack | see below |

**Smoke** (`bun run dev`, local Supabase, development guest signup). Do not use a non-test mint.

Dev signup provisions **Bitcoin**, **Testnut BTC**, and **Testnut USD** (`isTestMint: true`, `user-api.ts:29–62`). `canSendToLightning` / `canReceiveFromLightning` return false for every test mint (`account.ts:110`, `:122`), and `getTransferQuote` throws before any mint or Breez call (`transfer-service.ts:84–92`). A testnut→testnut transfer never reaches FakeWallet. Spark→spark passes both checks (`account.ts:107–108`, `:121`) and then calls Breez `receivePayment` (`spark-receive-quote-core.ts:237`) and `prepareSendPayment` (`spark-send-quote-service.ts:147`); that is real Lightning and is the maintainer gate. This slice does not change `account.ts`.

The only UI entry into `/transfer/:destinationAccountId` is the gift-card "Add" link (`gift-card-details.tsx:149–152`), so steps 2–3 navigate by URL. The route reads the source from `?sourceAccountId=` and falls back to the default account (`_protected.transfer.$destinationAccountId.tsx:10–14`, `account-hooks.ts:454–461`). Precondition for 2–3: the source account shows online, or `transfer-input.tsx:64–67` shows the offline toast before `getQuote` runs. The network gate is "no request initiated by the Continue click": clear the network log, click, then read — background exchange-rate/realtime/processor traffic keeps flowing either way.

1. **Boot.** Guest signup. Bitcoin, Testnut BTC, and Testnut USD are visible.
2. **Testnut BTC → Testnut USD (runnable, zero click-initiated network).** Open `/transfer/<TestnutUSD-id>?sourceAccountId=<TestnutBTC-id>`. Continue with any amount. `transfer-store.ts:49` → `sdk.transfer.getQuote`. Toast `Testnut BTC cannot send Lightning payments` (`transfer-service.ts:85–87`, `transfer-input.tsx:85–86`). No click-initiated mint HTTP, Supabase RPC, Breez, or Open Secret read.
3. **Bitcoin → Testnut USD (runnable, zero click-initiated network).** Open `/transfer/<TestnutUSD-id>?sourceAccountId=<Bitcoin-id>`. Toast `Testnut USD cannot receive Lightning payments` (`transfer-service.ts:89–92`). No click-initiated request. The destination check still runs.
4. **Regression.** Cashu lightning preview (step 13) and spark lightning preview (step 15) still match those plans. No console errors on steps 1–4.
5. **Funded Bitcoin (spark) → gift-card cashu account (maintainer, real sats).** This is the product's live transfer path: a user holds exactly one spark account (`user-api.ts:29–38`; the public contract adds only cashu accounts, `domain/sdk/accounts.ts:20–22`), and gift cards pass `canReceiveFromLightning` (no purpose check, `account.ts:119–125`). Enter via the gift card's Add link. Preview: one SDK `createLockedMintQuote` call on the destination wallet and one Breez `prepareSendPayment` (SDK-call counts — Breez fans each into several transport requests), no Supabase. Confirm: exactly one `create_cashu_receive_quote` and one `create_spark_send_quote`, no `accounts` / `users` select, then navigation to `/transactions/<receiveTransactionId>`. Processors stay on `/temporary` (step 18). Tests (i6), (i8), (r1) and (r3) cover the cashu-send rail the UI cannot reach without a second non-test cashu account.

## Foreground parity accounting

The flipped flow adds **zero** network requests versus master. Smoke steps 2–3 are the zero-request gate (capability check, then return) and match on both sides. The SDK side serves keys from memos warmed at session start by provisioning (`user-api.ts:124–129`): `keys.getEncryption()` is memoized (`session-keys.ts:89–134`, `:200–213`) and a cashu destination's `getXpub` → `getCashuSeed` (`cashu-receive-quote-service.ts:45–47`) reads the warm seed memo. Master's web-side caches are warmed separately by `_protected.tsx:90–92`; both sides are warm before the flow starts, so neither issues a key read. `getAccountRepository` constructs and awaits the memoized `keys.getEncryption()` (`accounts-api.ts:35–46`), as master's `useAccountRepository` does at render (`account-repository-hooks.ts:9–21`). The two-client Supabase JWT cost shared since step 5 is unchanged and ends at steps 18–19.

### A. Quote preview (`transfer-input.tsx:81` → `transfer-store.ts:49` → `getQuote`)

Cashu destination, cashu source (only when both accounts pass `account.ts:106–124`; testnut does not):

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Mint `createLockedMintQuote` (destination wallet) | 1 | 1 | `cashu-receive-quote-core.ts:268`, on the caller-supplied `account.wallet`. |
| Mint `createMeltQuoteBolt11` (source wallet) | 1 | 1 | `cashu-send-quote-service.ts:150`. |
| Supabase | 0 | 0 | Preview persists nothing. |
| Open Secret key read | 0 | 0 | Seed and encryption memos warm. |
| Account / user re-fetch | 0 | 0 | Both accounts come from the store (`transfer-store.ts:44–45`). |
| **Net added** | | **0** | |

Spark destination, spark source:

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Breez `receivePayment` | 1 | 1 | Core `getLightningQuote` on `account.wallet` (`spark-receive-quote-core.ts:237`). |
| Breez `prepareSendPayment` | 1 | 1 | `spark-send-quote-service.ts:147–150`. |
| Supabase | 0 | 0 | |
| Open Secret / mnemonic | 0 | 0 | Spark preview uses the caller-supplied wallet. `getSparkMnemonic` is not called (test q5). |
| **Net added** | | **0** | |

A mixed pair is one receive row plus one send row from the two tables. Master and flipped issue the same pair. The product's main pair is spark source → non-test cashu destination (the gift-card path, smoke step 5): preview = mint `createLockedMintQuote` + Breez `prepareSendPayment`; confirm = `create_cashu_receive_quote` + `create_spark_send_quote`.

### B. Confirm / initiate (`transfer-confirmation.tsx:32` → `useInitiateTransfer`)

| Request | Master | Flipped | Notes |
|---|---|---|---|
| Receive create RPC (`create_cashu_receive_quote` or `create_spark_receive_quote`) | 1 | 1 | Same args, including `p_purpose: 'TRANSFER'` and `p_transfer_id`. `userId` from the session instead of `useUser`. |
| Send create RPC (`create_cashu_send_quote` or `create_spark_send_quote`) | 1 | 1 | Same. |
| Mint / Breez on initiate | 0 | 0 | Initiate only persists the quotes already on `TransferQuote` (`transfer-service.ts:128–135`). |
| User read | 0 (`useUser` cache) | 0 (session) | |
| Fail RPC | only if the send persist throws | only if the send persist throws | `fail_cashu_receive_quote` / `fail_spark_receive_quote` (`transfer-service.ts:141–143`). Same condition both sides. |
| **Net added** | | **0** | |

After initiate, both sides navigate with `result.receiveTransactionId` (`transfer-confirmation.tsx:36–39`). The transaction page fetches are identical. The other two ids were already on the service result. **Net added: 0.**

## Out of scope

- Step 18: the four `use*QuoteService` hooks, processors, caches, `initiateSend` / `complete` / `fail`. `failReceiveQuote` stays un-aborted (decision 6). `console.error` at `transfer-service.ts:145` stays.
- `canSendToLightning` / `isTestMint` (`account.ts`). Testnut cannot complete a transfer (smoke).
- `resolveDestination` stays a throwing getter (`send-api.ts:92–94`). Do not edit `contract-proposal.md:226–228`.
- In-flight abort remap (steps 9–16): a postgrest abort rejects as a plain repository `Error`, skips the post-op fence, and `failureCount < 1` retries once; that retry re-reads `requireUserId()` from the live session (decision 10 Limit). Follow-up is to rethrow `SessionEndedError` when `signal.aborted` (family-wide; a local catch-wrap in `initiate` would close it for transfer alone and is deliberately not taken per-slice).
- Pre-existing futile `ConcurrencyError` retry on initiate (decision 8): unbounded retries of the same stale quote, 2–3 RPCs per attempt. Follow-up: re-read `quote.send.account` per attempt (step-13 style) or bound the retry.
- A shared `createCashuCryptography(keys)` helper to deduplicate the literal copied across `receive-api.ts` / `transfer-api.ts` (per-slice copies match the established pattern).
- Shared Supabase token source (carried from step 14). `#1164` narrowing of `TransferQuote`. No schema, RPC, dependency, or migration changes.

## Open questions

1. **`resolveDestination` contract shape and owner.** Carried from steps 13–15. Does not block step 16.

## Plan-attack corrections (2026-10-10)

A cross-model adversarial review (claude harness, open-pool contribution job) returned **NOT READY: 0 Critical, 5 Important, 8 Minor, 5 Nit**, with 118 path:line claims checked (1 wrong line number). All pinned seams, the fence order, the conventions, and the parity conclusion survived the attack. Folded here:

- **I1 — the "spark → spark" maintainer smoke could not exist.** A user holds exactly one spark account (`user-api.ts:29–38`) and the public contract adds only cashu accounts (`domain/sdk/accounts.ts:20–22`). Smoke step 5 is now the real product path: funded Bitcoin (spark) → gift-card cashu account via the gift-card Add link, with the matching RPC expectations. The "non-test cashu pair is the only live `create_cashu_*` path" sentence was wrong and is gone.
- **I2 — smoke steps 2–3 were unreachable as written.** They now navigate by explicit URL with `?sourceAccountId=`, carry an online-source precondition, and state the gate as "no request initiated by the Continue click".
- **I3 — q6 added**: the factory's `CashuCryptography` wiring is now tested through the default builders (locking pubkey derived from the session cashu xpub; `extractPaymentRequest` covered).
- **I4 — r1/r2/r3/t0 added** to reach step-15 coverage parity (repository-seam rails with signal/purpose/transferId assertions, the expired-quote compensating path through real services, and construction-does-nothing); the four repository seams no longer ship untested.
- **I5 — i9/i10/i11 added** for the two-persist abort and compensation semantics; i6/i7 also assert `fail` is never called on success.
- **M1** `biome.jsonc:22`. **M2** canary grep expectation now lists `transfer-api.ts` + its test as hits. **M3** decision 8 now records the futile unbounded `ConcurrencyError` retry as a pre-existing master defect kept for parity, with the follow-up in Out of scope. **M4** decision 10's Limit now records the per-attempt `requireUserId()` re-read; the local catch-wrap stays deliberately untaken (family-wide follow-up, Out of scope). **M5** q1/i1/i6/i8 test specs are now implementable as written. **M6** parity evidence now cites the SDK session-start warmers instead of the web caches. **M7** q5 no longer pins the exact `getAccountRepository` construction count. **M8** smoke step 5 states Breez numbers as SDK-call counts.
- **N1** the pinned hook file now carries the repo's blank-line and braced-if formatting. **N2** the `getAccountRepository` seam doc states the constraint, not the wiring origin. **N4** gate commands use `bun run test`. **N5** the deliberate root-export shadowing is stated in Global constraints. **N3** (shared `createCashuCryptography`) noted in Out of scope.
