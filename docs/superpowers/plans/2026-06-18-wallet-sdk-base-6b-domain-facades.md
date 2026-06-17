# Wallet-SDK Base Plan 6b — Shared Domain Facades Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the shared (variant-independent) public domain facades to `@agicash/wallet-sdk` — the `UserDomain` reconcile plus new `AccountsDomain`, `ContactsDomain`, `TransactionsDomain`, `TransfersDomain` — and wire them onto `Sdk` so `sdk.{accounts,contacts,transactions,transfers}` and the extended `sdk.user` work in both variants A and B.

**Architecture:** Each facade is a plain class with a single `deps` ctor object, mirroring the landed `domains/{auth,user,rates}.ts` pattern. They wrap already-extracted, already-tested SDK repositories/services (`runtime.accountRepository`, `runtime.accountService`, `runtime.protocols.*`) with Promise-returning methods, threading the current user id via the in-scope `getCurrentUserId` closure. No TanStack, no React, no caches — all reads are DB-on-demand (variant A's strategy, which variant B later overrides for the hot reads). The 7 resident **hot-read accessors** (`accounts.list`, `contacts.list`, current-user resident read, and the 6 work-set `listUnresolved/listPending` reads) are explicitly **out of scope** — they diverge per variant (A=Promise, B=Store) and land in the variant plans. The 4 `*Ops` (Cashu/Spark Send/Receive) and their `awaitTerminal` are **out of scope** — they land in the follow-up Plan 6b-ops (the `awaitTerminal` resolution = event + repo state-check backstop, decided 2026-06-18). Scan and the 6c `receiveToken` orchestrators are later plans.

**Tech Stack:** TypeScript, `bun:test`, `@agicash/money`, `type-fest`, Supabase (via the SDK-internal `AgicashDb` wrapper). React-free; headless under bun.

## Global Constraints

- **Gate = `bun run typecheck` + `bun run test` ONLY.** Run both from the worktree root (`/Users/ditto/Projects/MakePrisms/agicash/.claude/worktrees/sdk-extraction-fable`). `typecheck` = `react-router typegen && tsc`; it is the catch-all for dangling/type-only imports. `test` runs all 8 workspace packages.
- **⛔ NEVER run `bun run fix:all`** (it is `biome check --write` = lint/format across the WHOLE repo; it reorders imports in ~80+ files and pollutes the working tree — it does NOT typecheck). This applies to implementers AND reviewers. If any pollution appears, discard with `git checkout -- .` (all task work is committed, so this is safe).
- **Package manager: `bun` / `bunx` only.** Never npm/npx/yarn/pnpm.
- **Branch: `sdkx/base`.** Do NOT push (gated on the Breez smoke + live realtime + `/lnurl-test` + user nod).
- **No hot-read accessors:** do NOT add `accounts.list()`, `contacts.list()`, or any work-set `listUnresolved/listPending`. Those are variant-specific. `transactions.list()` IS in scope (Promise in both variants — no transaction store).
- **Domain classes are NOT barrel-exported** (accessed structurally via `sdk.x.method()`, like `auth`/`user`/`rates`). Only NEW public param/return *types* get barrel `export type` entries.
- **Error parity:** use plain `Error` for precondition failures (`No authenticated user`, `Unsupported currency`, `No default account found ...`) — matches the existing `UserDomain.requireUserId` and the app's `UserService`/`useDefaultAccount`. Do NOT introduce `DomainError` where the source used plain `Error`.
- **No retry/cache in facades:** facades are thin async methods. Retry classification (ConcurrencyError-retry / DomainError-never) stays with the background processors (Plan 4c) and the host's mutation layer — do NOT bake retry or TanStack pokes into these facades.
- **Verify-before-using:** read the actual repo/service source before wiring; signatures in this plan are copied verbatim from the landed code as of tip `00005ea1`.

**Reachability (verified, tip `00005ea1`):**
- `walletRuntime.accountRepository: AccountRepository`, `walletRuntime.accountService: AccountService`, `walletRuntime.defaultAccountRepository: DefaultAccountRepository`
- `walletRuntime.protocols.contactRepository: ContactRepository`, `.transactionRepository: TransactionRepository`, `.transferService: TransferService`
- In `Sdk.create`, already in scope: `walletRuntime`, `readUserRepo`, `writeUserRepo`, `getCurrentUserId: () => Promise<string | null>`.

---

## File Structure

- **Modify** `packages/wallet-sdk/src/domains/user.ts` — granular `acceptTerms` + `setDefaultAccount` reconcile.
- **Modify** `packages/wallet-sdk/src/domains/user.test.ts` — cover the reconcile.
- **Create** `packages/wallet-sdk/src/domains/accounts.ts` — `AccountsDomain` + `AddCashuAccountInput`.
- **Create** `packages/wallet-sdk/src/domains/accounts.test.ts` — `getDefault`/`suggestFor` selection.
- **Create** `packages/wallet-sdk/src/domains/contacts.ts` — `ContactsDomain`.
- **Create** `packages/wallet-sdk/src/domains/transactions.ts` — `TransactionsDomain`.
- **Create** `packages/wallet-sdk/src/domains/transfers.ts` — `TransfersDomain`.
- **Modify** `packages/wallet-sdk/src/sdk.ts` — construct + expose the 4 new domains.
- **Modify** `packages/wallet-sdk/src/sdk.test.ts` — assert the new surface is present.
- **Modify** `packages/wallet-sdk/src/index.ts` — barrel `export type` for `AddCashuAccountInput` + `Cursor`.

**Testing posture (matches every prior base plan — minimal + new-logic carve-out, user-confirmed):** unit tests ONLY for the genuinely-new logic — the `UserDomain` reconcile (Task 1) and the `AccountsDomain` `getDefault`/`suggestFor` selection (Task 2). `ContactsDomain`/`TransactionsDomain`/`TransfersDomain` are thin passthroughs over already-tested repos/services → gate-green only (no new unit tests). OPUS implements/reviews Tasks 1, 2, and 7 (holistic); sonnet implements Tasks 3–6 with sonnet spec review.

---

## Task 1: UserDomain reconcile (granular acceptTerms + setDefaultAccount)

**Files:**
- Modify: `packages/wallet-sdk/src/domains/user.ts`
- Test: `packages/wallet-sdk/src/domains/user.test.ts`

**Interfaces:**
- Consumes: `WriteUserRepository.update(userId, data: UpdateUser, options?)` where `UpdateUser = { defaultBtcAccountId?: string; defaultUsdAccountId?: string | null; defaultCurrency?: Currency; username?: string; termsAcceptedAt?: string; giftCardMintTermsAcceptedAt?: string }`; `Account` (from `./account-types`, carries `id` + `currency: Currency`); `User` (from `./user-types`).
- Produces: `UserDomain.acceptTerms(params: { walletTerms?: boolean; giftCardTerms?: boolean }): Promise<User>` and `UserDomain.setDefaultAccount(params: { account: Account; setDefaultCurrency?: boolean }): Promise<User>`. (Both are signature changes from the Plan-2 nullary `acceptTerms()` / single-arg `setDefaultAccount(account)`.)

**Context:** Supabase `.update()` is a partial write — only provided columns change, `undefined` keys are ignored. So `setDefaultAccount` does NOT need a fresh `User` (the app's `UserService.setDefaultAccount` passes `user` only to re-send the unchanged columns; sending just the changed ones is equivalent). The two terms columns are `termsAcceptedAt` (wallet terms) and `giftCardMintTermsAcceptedAt` (gift-card mint terms). No SDK-internal caller invokes these yet (only `user.test.ts`) — grep to confirm before changing.

- [ ] **Step 1: Confirm no other SDK caller depends on the old signatures**

Run: `rg -n "\.acceptTerms\(|\.setDefaultAccount\(" packages/wallet-sdk/src`
Expected: only `domains/user.ts` (definition) and `domains/user.test.ts` (caller). If anything else appears, stop and reconcile.

- [ ] **Step 2: Update the failing tests in `user.test.ts`**

Replace the `acceptTerms` test (the `test('acceptTerms sets termsAcceptedAt and requires a user', ...)` block) and add `setDefaultAccount` coverage. The existing `makeDomain` helper, `USER` const, and other tests stay unchanged.

```ts
  test('acceptTerms sets only the requested terms columns', async () => {
    const update = mock(async () => USER);
    const domain = makeDomain({ update, userId: 'u1' });

    await domain.acceptTerms({ walletTerms: true });
    const wallet = update.mock.calls[0] as unknown as [
      string,
      { termsAcceptedAt?: string; giftCardMintTermsAcceptedAt?: string },
    ];
    expect(wallet[0]).toBe('u1');
    expect(typeof wallet[1].termsAcceptedAt).toBe('string');
    expect(wallet[1].giftCardMintTermsAcceptedAt).toBeUndefined();

    await domain.acceptTerms({ giftCardTerms: true });
    const gift = update.mock.calls[1] as unknown as [
      string,
      { termsAcceptedAt?: string; giftCardMintTermsAcceptedAt?: string },
    ];
    expect(gift[1].termsAcceptedAt).toBeUndefined();
    expect(typeof gift[1].giftCardMintTermsAcceptedAt).toBe('string');
  });

  test('acceptTerms requires a user', async () => {
    await expect(
      makeDomain({ userId: null }).acceptTerms({ walletTerms: true }),
    ).rejects.toThrow();
  });

  test('setDefaultAccount writes the currency-matched id, currency only when asked', async () => {
    const update = mock(async () => USER);
    const domain = makeDomain({ update, userId: 'u1' });

    await domain.setDefaultAccount({
      account: { id: 'acc-btc', currency: 'BTC' } as never,
    });
    expect(update.mock.calls[0]).toEqual([
      'u1',
      { defaultBtcAccountId: 'acc-btc' },
    ] as never);

    await domain.setDefaultAccount({
      account: { id: 'acc-usd', currency: 'USD' } as never,
      setDefaultCurrency: true,
    });
    expect(update.mock.calls[1]).toEqual([
      'u1',
      { defaultUsdAccountId: 'acc-usd', defaultCurrency: 'USD' },
    ] as never);
  });

  test('setDefaultAccount rejects unsupported currencies', async () => {
    const domain = makeDomain({ userId: 'u1' });
    await expect(
      domain.setDefaultAccount({
        account: { id: 'x', currency: 'EUR' } as never,
      }),
    ).rejects.toThrow('Unsupported currency');
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd packages/wallet-sdk && bun test src/domains/user.test.ts`
Expected: FAIL — `acceptTerms` no longer accepts the nullary/old call shape; `setDefaultAccount` signature mismatch.

- [ ] **Step 4: Implement the reconcile in `user.ts`**

Replace the `setDefaultAccount`, `setDefaultCurrency`, and `acceptTerms` methods. Keep `get`, `updateUsername`, and `requireUserId` unchanged. Update the class JSDoc to describe the granular terms + combined default-account option. (Drop the now-redundant standalone `setDefaultCurrency` method — its behavior is folded into `setDefaultAccount({ setDefaultCurrency: true })`; confirm Step 1 showed no caller.)

```ts
  async setDefaultAccount(params: {
    account: Account;
    setDefaultCurrency?: boolean;
  }): Promise<User> {
    const id = await this.requireUserId();
    const { account, setDefaultCurrency } = params;
    if (account.currency !== 'BTC' && account.currency !== 'USD') {
      throw new Error('Unsupported currency');
    }
    return this.deps.writeUserRepo.update(id, {
      ...(account.currency === 'BTC'
        ? { defaultBtcAccountId: account.id }
        : { defaultUsdAccountId: account.id }),
      ...(setDefaultCurrency ? { defaultCurrency: account.currency } : {}),
    });
  }

  async acceptTerms(params: {
    walletTerms?: boolean;
    giftCardTerms?: boolean;
  }): Promise<User> {
    const id = await this.requireUserId();
    const now = new Date().toISOString();
    return this.deps.writeUserRepo.update(id, {
      ...(params.walletTerms ? { termsAcceptedAt: now } : {}),
      ...(params.giftCardTerms ? { giftCardMintTermsAcceptedAt: now } : {}),
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd packages/wallet-sdk && bun test src/domains/user.test.ts`
Expected: PASS (all UserDomain tests).

- [ ] **Step 6: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: 8 packages typecheck exit 0; full suite 0 fail.

```bash
git add packages/wallet-sdk/src/domains/user.ts packages/wallet-sdk/src/domains/user.test.ts
git commit -m "feat(wallet-sdk): granular UserDomain acceptTerms + setDefaultAccount reconcile (base 6b)"
```

---

## Task 2: AccountsDomain

**Files:**
- Create: `packages/wallet-sdk/src/domains/accounts.ts`
- Test: `packages/wallet-sdk/src/domains/accounts.test.ts`
- Modify: `packages/wallet-sdk/src/index.ts` (barrel `export type { AddCashuAccountInput }`)

**Interfaces:**
- Consumes: `AccountRepository.get(id, options?): Promise<Account | null>` (any state — DB-fallback for expired); `AccountService.addCashuAccount({ userId, account }): Promise<CashuAccount>` where `account` is `DistributedOmit<CashuAccount, 'id'|'createdAt'|'expiresAt'|'isTestMint'|'keysetCounters'|'proofs'|'version'|'wallet'|'isOnline'|'state'>`; `ReadUserRepository.get(userId, options?): Promise<User>`; `User` carries `defaultCurrency: Currency`, `defaultBtcAccountId: string`, `defaultUsdAccountId: string | null`; `Account`/`CashuAccount` from `./account-types`; `Currency` from `@agicash/money`.
- Produces: `AccountsDomain` with `get(id): Promise<Account | null>`, `getDefault(currency?: Currency): Promise<Account>`, `suggestFor(params: { accountId?: string; currency: Currency }): Promise<Account>`, `add(account: AddCashuAccountInput): Promise<CashuAccount>`. Exports `type AddCashuAccountInput`. Ctor `deps = { accountRepository, accountService, readUserRepo, getCurrentUserId }`.

- [ ] **Step 1: Write the failing test `accounts.test.ts`**

```ts
import { describe, expect, mock, test } from 'bun:test';
import { AccountsDomain } from './accounts';

const makeDomain = (over: {
  user?: unknown;
  accountGet?: ReturnType<typeof mock>;
  addCashuAccount?: ReturnType<typeof mock>;
  userId?: string | null;
}) =>
  new AccountsDomain({
    accountRepository: { get: over.accountGet ?? mock(async () => null) },
    accountService: {
      addCashuAccount: over.addCashuAccount ?? mock(async () => ({})),
    },
    readUserRepo: { get: mock(async () => over.user ?? {}) },
    getCurrentUserId: async () => over.userId ?? null,
  } as unknown as ConstructorParameters<typeof AccountsDomain>[0]);

const USER = {
  defaultCurrency: 'USD',
  defaultBtcAccountId: 'acc-btc',
  defaultUsdAccountId: 'acc-usd',
};

describe('AccountsDomain', () => {
  test('get delegates to the repository', async () => {
    const acc = { id: 'a1' };
    const get = mock(async () => acc);
    const result = await makeDomain({ accountGet: get }).get('a1');
    expect(result).toBe(acc as never);
    expect(get).toHaveBeenCalledWith('a1');
  });

  test('getDefault returns the currency-matched default account', async () => {
    const btc = { id: 'acc-btc', currency: 'BTC' };
    const get = mock(async (id: string) => (id === 'acc-btc' ? btc : null));
    const result = await makeDomain({
      user: USER,
      accountGet: get,
      userId: 'u1',
    }).getDefault('BTC');
    expect(result.id).toBe('acc-btc');
    expect(get).toHaveBeenCalledWith('acc-btc');
  });

  test('getDefault falls back to the user default currency', async () => {
    const usd = { id: 'acc-usd', currency: 'USD' };
    const get = mock(async (id: string) => (id === 'acc-usd' ? usd : null));
    const result = await makeDomain({
      user: USER,
      accountGet: get,
      userId: 'u1',
    }).getDefault();
    expect(result.id).toBe('acc-usd');
  });

  test('getDefault throws when no default account is set', async () => {
    const domain = makeDomain({
      user: { defaultCurrency: 'BTC', defaultBtcAccountId: '', defaultUsdAccountId: null },
      userId: 'u1',
    });
    await expect(domain.getDefault('BTC')).rejects.toThrow(
      'No default account found',
    );
  });

  test('getDefault requires a user', async () => {
    await expect(makeDomain({ userId: null }).getDefault('BTC')).rejects.toThrow(
      'No authenticated user',
    );
  });

  test('suggestFor returns the requested account when it resolves', async () => {
    const acc = { id: 'acc-x', currency: 'BTC' };
    const get = mock(async (id: string) => (id === 'acc-x' ? acc : null));
    const result = await makeDomain({ accountGet: get, userId: 'u1' }).suggestFor(
      { accountId: 'acc-x', currency: 'BTC' },
    );
    expect(result.id).toBe('acc-x');
  });

  test('suggestFor falls back to the default when the account is missing', async () => {
    const btc = { id: 'acc-btc', currency: 'BTC' };
    const get = mock(async (id: string) => (id === 'acc-btc' ? btc : null));
    const result = await makeDomain({
      user: { defaultCurrency: 'BTC', defaultBtcAccountId: 'acc-btc', defaultUsdAccountId: null },
      accountGet: get,
      userId: 'u1',
    }).suggestFor({ accountId: 'missing', currency: 'BTC' });
    expect(result.id).toBe('acc-btc');
  });

  test('add delegates to accountService with the current userId', async () => {
    const addCashuAccount = mock(async () => ({ id: 'new' }));
    const input = {
      name: 'Mint',
      type: 'cashu',
      currency: 'BTC',
      mintUrl: 'https://mint.example',
      purpose: 'transactional',
    };
    await makeDomain({ addCashuAccount, userId: 'u1' }).add(input as never);
    expect(addCashuAccount).toHaveBeenCalledWith({
      userId: 'u1',
      account: input,
    });
  });

  test('add requires a user', async () => {
    await expect(
      makeDomain({ userId: null }).add({} as never),
    ).rejects.toThrow('No authenticated user');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/wallet-sdk && bun test src/domains/accounts.test.ts`
Expected: FAIL — `Cannot find module './accounts'`.

- [ ] **Step 3: Implement `accounts.ts`**

```ts
import type { Currency } from '@agicash/money';
import type { DistributedOmit } from 'type-fest';
import type { AccountRepository } from '../internal/db/account-repository';
import type { ReadUserRepository } from '../internal/db/user-repository';
import type { AccountService } from '../internal/services/account-service';
import type { Account, CashuAccount } from './account-types';

/**
 * The user-supplied fields for adding a cashu account. The SDK derives id /
 * version / state / proofs / wallet / isTestMint / keysetCounters / expiresAt.
 * Mirrors `AccountService.addCashuAccount`'s `account` parameter.
 */
export type AddCashuAccountInput = DistributedOmit<
  CashuAccount,
  | 'id'
  | 'createdAt'
  | 'expiresAt'
  | 'isTestMint'
  | 'keysetCounters'
  | 'proofs'
  | 'version'
  | 'wallet'
  | 'isOnline'
  | 'state'
>;

type Deps = {
  accountRepository: AccountRepository;
  accountService: AccountService;
  readUserRepo: ReadUserRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `accounts` domain: single-account reads, the add mutation, and
 * default/suggested-account selection. The resident `list()` of all active
 * accounts is a per-variant hot read (A=Promise, B=Store), so it is not here.
 */
export class AccountsDomain {
  constructor(private readonly deps: Deps) {}

  /** A single account by id, including expired ones (DB-fallback). Null if absent. */
  get(id: string): Promise<Account | null> {
    return this.deps.accountRepository.get(id);
  }

  /**
   * The user's default account for `currency` (defaults to the user's default
   * currency). Throws if no default account is set for that currency.
   */
  async getDefault(currency?: Currency): Promise<Account> {
    const userId = await this.requireUserId();
    const user = await this.deps.readUserRepo.get(userId);
    const accountCurrency = currency ?? user.defaultCurrency;
    const defaultAccountId =
      accountCurrency === 'BTC'
        ? user.defaultBtcAccountId
        : user.defaultUsdAccountId;
    if (!defaultAccountId) {
      throw new Error(
        `No default account found for currency ${accountCurrency}`,
      );
    }
    const account = await this.deps.accountRepository.get(defaultAccountId);
    if (!account) {
      throw new Error(
        `No default account found for currency ${accountCurrency}`,
      );
    }
    return account;
  }

  /** The given account if `accountId` resolves, otherwise the default for `currency`. */
  async suggestFor(params: {
    accountId?: string;
    currency: Currency;
  }): Promise<Account> {
    if (params.accountId) {
      const account = await this.deps.accountRepository.get(params.accountId);
      if (account) return account;
    }
    return this.getDefault(params.currency);
  }

  /** Adds a cashu account for the current user. */
  async add(account: AddCashuAccountInput): Promise<CashuAccount> {
    const userId = await this.requireUserId();
    return this.deps.accountService.addCashuAccount({ userId, account });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 4: Add the barrel type export in `index.ts`**

Add near the other `domains/*` type exports:

```ts
export type { AddCashuAccountInput } from './domains/accounts';
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd packages/wallet-sdk && bun test src/domains/accounts.test.ts`
Expected: PASS.

- [ ] **Step 6: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/domains/accounts.ts packages/wallet-sdk/src/domains/accounts.test.ts packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): AccountsDomain (get/getDefault/suggestFor/add) (base 6b)"
```

---

## Task 3: ContactsDomain

**Files:**
- Create: `packages/wallet-sdk/src/domains/contacts.ts`

**Interfaces:**
- Consumes: `ContactRepository.get(contactId): Promise<Contact>` (throws on missing — `.single()`); `.create({ ownerId, username }, options?): Promise<Contact>`; `.delete(contactId, options?): Promise<void>`; `.findContactCandidates(query, currentUserId, options?: { abortSignal?; sort?: 'desc'|'asc' }): Promise<UserProfile[]>` (returns `[]` for <3 trimmed chars); `Contact` from `./contact`; `UserProfile` from `./user-types`.
- Produces: `ContactsDomain` with `get(contactId): Promise<Contact>`, `add(params: { username: string }): Promise<Contact>`, `remove(contactId): Promise<void>`, `search(query, options?): Promise<UserProfile[]>`. Ctor `deps = { contactRepository, getCurrentUserId }`. (`list()` is a per-variant hot read — not here.)

**No new unit tests** (thin passthrough over the already-tested `ContactRepository`; gate-green only — `search`/`add` require auth, `get`/`remove` rely on RLS like the repo).

- [ ] **Step 1: Implement `contacts.ts`**

```ts
import type { ContactRepository } from '../internal/db/contact-repository';
import type { Contact } from './contact';
import type { UserProfile } from './user-types';

type Deps = {
  contactRepository: ContactRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `contacts` domain: add/remove a contact, fetch one by id, and search for
 * candidate users to add. The resident `list()` of all contacts is a per-variant
 * hot read, so it is not here.
 */
export class ContactsDomain {
  constructor(private readonly deps: Deps) {}

  /** A single contact by id. Throws if not found. */
  get(contactId: string): Promise<Contact> {
    return this.deps.contactRepository.get(contactId);
  }

  /** Adds a contact (by app username) for the current user. */
  async add(params: { username: string }): Promise<Contact> {
    const ownerId = await this.requireUserId();
    return this.deps.contactRepository.create({
      ownerId,
      username: params.username,
    });
  }

  /** Removes a contact by id. */
  remove(contactId: string): Promise<void> {
    return this.deps.contactRepository.delete(contactId);
  }

  /**
   * Searches for users to add as contacts, excluding existing contacts. Returns
   * an empty array for queries shorter than 3 trimmed characters.
   */
  async search(
    query: string,
    options?: { abortSignal?: AbortSignal; sort?: 'desc' | 'asc' },
  ): Promise<UserProfile[]> {
    const currentUserId = await this.requireUserId();
    return this.deps.contactRepository.findContactCandidates(
      query,
      currentUserId,
      options,
    );
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 2: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/domains/contacts.ts
git commit -m "feat(wallet-sdk): ContactsDomain (get/add/remove/search) (base 6b)"
```

---

## Task 4: TransactionsDomain

**Files:**
- Create: `packages/wallet-sdk/src/domains/transactions.ts`
- Modify: `packages/wallet-sdk/src/index.ts` (barrel `export type { Cursor }`)

**Interfaces:**
- Consumes: `TransactionRepository.list({ userId, cursor?, pageSize?, accountId?, abortSignal? }): Promise<{ transactions: Transaction[]; nextCursor: Cursor }>`; `.get(transactionId, options?): Promise<Transaction | null>`; `.countTransactionsPendingAck({ userId }, options?): Promise<number>`; `.acknowledgeTransaction({ userId, transactionId }, options?): Promise<void>`; `Cursor = { stateSortOrder: number; createdAt: string; id: string } | null` (exported from `../internal/db/transaction-repository`); `Transaction` from `./transaction`.
- Produces: `TransactionsDomain` with `list(params?): Promise<{ transactions: Transaction[]; nextCursor: Cursor }>`, `get(transactionId): Promise<Transaction | null>`, `countPendingAck(): Promise<number>`, `acknowledge(transactionId): Promise<void>`. Ctor `deps = { transactionRepository, getCurrentUserId }`.

**No new unit tests** (thin passthrough over the already-tested `TransactionRepository`; gate-green only).

- [ ] **Step 1: Implement `transactions.ts`**

```ts
import type {
  Cursor,
  TransactionRepository,
} from '../internal/db/transaction-repository';
import type { Transaction } from './transaction';

type Deps = {
  transactionRepository: TransactionRepository;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `transactions` domain: cursor-paginated history, single lookup, and the
 * unacknowledged-count + acknowledge mutation. Promise-based in both variants
 * (there is no transaction store), so the full surface lives here.
 */
export class TransactionsDomain {
  constructor(private readonly deps: Deps) {}

  /** A page of the user's transaction history. Pass `nextCursor` back to paginate. */
  async list(params?: {
    accountId?: string;
    cursor?: Cursor;
    pageSize?: number;
    abortSignal?: AbortSignal;
  }): Promise<{ transactions: Transaction[]; nextCursor: Cursor }> {
    const userId = await this.requireUserId();
    return this.deps.transactionRepository.list({
      userId,
      accountId: params?.accountId,
      cursor: params?.cursor,
      pageSize: params?.pageSize,
      abortSignal: params?.abortSignal,
    });
  }

  /** A single transaction by id. Null if not found. */
  get(transactionId: string): Promise<Transaction | null> {
    return this.deps.transactionRepository.get(transactionId);
  }

  /** Count of the user's transactions pending acknowledgement. */
  async countPendingAck(): Promise<number> {
    const userId = await this.requireUserId();
    return this.deps.transactionRepository.countTransactionsPendingAck({
      userId,
    });
  }

  /** Marks a transaction as acknowledged. */
  async acknowledge(transactionId: string): Promise<void> {
    const userId = await this.requireUserId();
    return this.deps.transactionRepository.acknowledgeTransaction({
      userId,
      transactionId,
    });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 2: Add the barrel type export in `index.ts`**

Add near the transaction type exports:

```ts
export type { Cursor } from './internal/db/transaction-repository';
```

- [ ] **Step 3: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/domains/transactions.ts packages/wallet-sdk/src/index.ts
git commit -m "feat(wallet-sdk): TransactionsDomain (list/get/countPendingAck/acknowledge) (base 6b)"
```

---

## Task 5: TransfersDomain

**Files:**
- Create: `packages/wallet-sdk/src/domains/transfers.ts`

**Interfaces:**
- Consumes: `TransferService.getTransferQuote({ sourceAccount, destinationAccount, amount }): Promise<TransferQuote>` (throws `DomainError` if the source can't send / dest can't receive Lightning); `.initiateTransfer({ userId, quote }): Promise<{ transferId: string; receiveTransactionId: string; sendTransactionId: string }>`; `TransferQuote` from `../internal/services/transfer-service` (already barrel-exported); `Account` from `./account-types`; `Money` from `@agicash/money`.
- Produces: `TransfersDomain` with `createQuote(params: { sourceAccount: Account; destinationAccount: Account; amount: Money }): Promise<TransferQuote>`, `execute(quote: TransferQuote): Promise<{ transferId: string; receiveTransactionId: string; sendTransactionId: string }>`. Ctor `deps = { transferService, getCurrentUserId }`.

**No new unit tests** (thin passthrough over the already-tested `TransferService`; gate-green only).

- [ ] **Step 1: Implement `transfers.ts`**

```ts
import type { Money } from '@agicash/money';
import type {
  TransferQuote,
  TransferService,
} from '../internal/services/transfer-service';
import type { Account } from './account-types';

type Deps = {
  transferService: TransferService;
  /** Resolves the current user's id, or null when signed out. */
  getCurrentUserId: () => Promise<string | null>;
};

/**
 * The `transfers` domain: moving funds between the user's own accounts over
 * Lightning. `createQuote` fetches both Lightning quotes without persisting;
 * `execute` persists the receive + send quotes and the background processors
 * carry the send to completion.
 */
export class TransfersDomain {
  constructor(private readonly deps: Deps) {}

  /** A transfer quote (Lightning quotes for both sides; nothing persisted). */
  createQuote(params: {
    sourceAccount: Account;
    destinationAccount: Account;
    amount: Money;
  }): Promise<TransferQuote> {
    return this.deps.transferService.getTransferQuote(params);
  }

  /** Persists the transfer's receive + send quotes; processors do the rest. */
  async execute(quote: TransferQuote): Promise<{
    transferId: string;
    receiveTransactionId: string;
    sendTransactionId: string;
  }> {
    const userId = await this.requireUserId();
    return this.deps.transferService.initiateTransfer({ userId, quote });
  }

  private async requireUserId(): Promise<string> {
    const id = await this.deps.getCurrentUserId();
    if (!id) throw new Error('No authenticated user');
    return id;
  }
}
```

- [ ] **Step 2: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/domains/transfers.ts
git commit -m "feat(wallet-sdk): TransfersDomain (createQuote/execute) (base 6b)"
```

---

## Task 6: Wire the four domains onto Sdk

**Files:**
- Modify: `packages/wallet-sdk/src/sdk.ts`
- Test: `packages/wallet-sdk/src/sdk.test.ts`

**Interfaces:**
- Consumes: `AccountsDomain`/`ContactsDomain`/`TransactionsDomain`/`TransfersDomain` (Tasks 2–5); the in-scope `walletRuntime`, `readUserRepo`, `getCurrentUserId` (already present in `Sdk.create`).
- Produces: `sdk.accounts: AccountsDomain`, `sdk.contacts: ContactsDomain`, `sdk.transactions: TransactionsDomain`, `sdk.transfers: TransfersDomain`.

- [ ] **Step 1: Add the imports in `sdk.ts`**

Add alongside the existing `./domains/*` imports (after the `UserDomain` import):

```ts
import { AccountsDomain } from './domains/accounts';
import { ContactsDomain } from './domains/contacts';
import { TransactionsDomain } from './domains/transactions';
import { TransfersDomain } from './domains/transfers';
```

- [ ] **Step 2: Add the readonly fields**

In the `Sdk` class body, after `readonly rates: RatesDomain;`:

```ts
  readonly accounts: AccountsDomain;
  readonly contacts: ContactsDomain;
  readonly transactions: TransactionsDomain;
  readonly transfers: TransfersDomain;
```

- [ ] **Step 3: Extend the constructor parts type + assignments**

In the private constructor's `parts` parameter type, after `rates: RatesDomain;`:

```ts
    accounts: AccountsDomain;
    contacts: ContactsDomain;
    transactions: TransactionsDomain;
    transfers: TransfersDomain;
```

And in the constructor body, after `this.rates = parts.rates;`:

```ts
    this.accounts = parts.accounts;
    this.contacts = parts.contacts;
    this.transactions = parts.transactions;
    this.transfers = parts.transfers;
```

- [ ] **Step 4: Construct the domains in `create`**

In `Sdk.create`, immediately after `const rates = new RatesDomain();`:

```ts
    const accounts = new AccountsDomain({
      accountRepository: walletRuntime.accountRepository,
      accountService: walletRuntime.accountService,
      readUserRepo,
      getCurrentUserId,
    });
    const contacts = new ContactsDomain({
      contactRepository: walletRuntime.protocols.contactRepository,
      getCurrentUserId,
    });
    const transactions = new TransactionsDomain({
      transactionRepository: walletRuntime.protocols.transactionRepository,
      getCurrentUserId,
    });
    const transfers = new TransfersDomain({
      transferService: walletRuntime.protocols.transferService,
      getCurrentUserId,
    });
```

- [ ] **Step 5: Pass them into the final `return new Sdk({ ... })`**

Add to the object passed to the `Sdk` constructor (alongside `rates`):

```ts
      accounts,
      contacts,
      transactions,
      transfers,
```

- [ ] **Step 6: Assert the surface in `sdk.test.ts`**

Extend the first test (`configures Open Secret and exposes the auth domain`) — after `expect(sdk.auth).toBeDefined();`:

```ts
    expect(sdk.accounts).toBeDefined();
    expect(sdk.contacts).toBeDefined();
    expect(sdk.transactions).toBeDefined();
    expect(sdk.transfers).toBeDefined();
```

- [ ] **Step 7: Run sdk tests to verify they pass**

Run: `cd packages/wallet-sdk && bun test src/sdk.test.ts`
Expected: PASS (both Sdk.create tests).

- [ ] **Step 8: Gate + commit**

Run: `bun run typecheck && bun run test` (from worktree root)
Expected: typecheck exit 0; 0 fail.

```bash
git add packages/wallet-sdk/src/sdk.ts packages/wallet-sdk/src/sdk.test.ts
git commit -m "feat(wallet-sdk): wire accounts/contacts/transactions/transfers domains onto Sdk (base 6b)"
```

---

## Task 7: Holistic review (OPUS)

**Files:** none (review only).

- [ ] **Step 1: Whole-diff review**

Dispatch an OPUS reviewer over `git diff 00005ea1..HEAD -- packages/wallet-sdk` with the brief:
- Behavior parity: each facade method matches the app's corresponding service/hook semantics (`setDefaultAccount` partial-write equivalence; `acceptTerms` 2-column mapping; `getDefault` selection + throw message; `suggestFor` fallback; `transactions.list` cursor shape; transfer create/execute split).
- Boundary correctness: NO hot-read accessors leaked in (`accounts.list`/`contacts.list`/work-set lists absent); NO `*Ops`/`awaitTerminal`; NO scan/receiveToken; NO TanStack/Sentry/retry baked into facades; domain classes NOT barrel-exported (only `AddCashuAccountInput` + `Cursor` types added).
- Wiring: the 4 ctor wiring points in `sdk.ts` are complete and consistent (field + parts-type + assignment + construction + return); deps resolve from `walletRuntime` / `walletRuntime.protocols` correctly.
- Error parity: plain `Error` (not `DomainError`) for preconditions.
- Confirm `bun run typecheck` exit 0 and `bun run test` 0 fail. The reviewer MUST NOT run `bun run fix:all`.

- [ ] **Step 2: Address any Critical/Important findings, then update the ledger**

Fix blockers inline (re-gate after). Append the Plan-6b outcome to `.git/worktrees/sdk-extraction-fable/sdd/progress.md` and report the final tip + test count.

---

## Self-Review

**1. Spec coverage** (against the 6b scope from the variant-phase memory + the user's task brief):
- UserDomain reconcile (granular `acceptTerms`, combined `setDefaultAccount`) → Task 1. ✓
- AccountsDomain (get/getDefault/add/suggestFor; NO list) → Task 2. ✓
- ContactsDomain (add/remove/search/get wrapping `findContactCandidates`; NO list) → Task 3. ✓
- TransactionsDomain (list/get/countPendingAck/acknowledge — Promise in both) → Task 4. ✓
- TransfersDomain (createQuote/execute) → Task 5. ✓
- Sdk wiring (field + ctor-parts + construction + return) + barrel type exports → Tasks 2/4/6. ✓
- Out of scope (correctly excluded): the 7 hot-read accessors, the 4 `*Ops` + `awaitTerminal` (→ 6b-ops), scan, 6c receiveToken. ✓

**2. Placeholder scan:** every code step contains full source; gate commands have expected output; no TBD/TODO. ✓

**3. Type consistency:** `getCurrentUserId: () => Promise<string | null>` and the private `requireUserId(): Promise<string>` helper are identical across all 4 new domains and match `domains/user.ts`. `AddCashuAccountInput` (Task 2) is the exact `DistributedOmit` `AccountService.addCashuAccount` consumes. `Cursor` (Task 4) is re-exported from the repo that defines it. `TransferQuote` is already barrel-exported (no duplicate). Field names (`accountRepository`, `accountService`, `contactRepository`, `transactionRepository`, `transferService`, `readUserRepo`) match the runtime/protocols reachability table verbatim.
