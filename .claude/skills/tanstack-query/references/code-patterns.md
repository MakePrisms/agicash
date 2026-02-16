# Code Patterns

## Cache Class Pattern

```typescript
// app/features/accounts/account-hooks.ts
export class AccountsCache {
  public static Key = 'accounts';

  constructor(private readonly queryClient: QueryClient) {}

  upsert(account: Account) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) => {
      const exists = curr.findIndex((x) => x.id === account.id);
      if (exists !== -1) {
        // Version check: only update if newer
        return curr.map((x) =>
          x.id === account.id && account.version > x.version ? account : x,
        );
      }
      return [...curr, account];
    });
  }

  update(account: Account) {
    this.queryClient.setQueryData([AccountsCache.Key], (curr: Account[]) =>
      curr.map((x) =>
        x.id === account.id && account.version > x.version ? account : x,
      ),
    );
  }

  getAll() {
    return this.queryClient.getQueryData<Account[]>([AccountsCache.Key]);
  }

  get(id: string) {
    return this.getAll()?.find((x) => x.id === id) ?? null;
  }

  invalidate() {
    return this.queryClient.invalidateQueries({
      queryKey: [AccountsCache.Key],
    });
  }
}

// Hook for stable instance (useMemo prevents re-creation on every render)
export function useAccountsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new AccountsCache(queryClient), [queryClient]);
}
```

## queryOptions Factory

```typescript
export const accountsQueryOptions = ({
  userId,
  accountRepository,
}: { userId: string; accountRepository: AccountRepository }) => {
  return queryOptions({
    queryKey: [AccountsCache.Key],
    queryFn: () => accountRepository.getAll(userId),
    staleTime: Number.POSITIVE_INFINITY,
  });
};

// Use in component
const { data } = useSuspenseQuery(accountsQueryOptions({ userId, accountRepository }));

// Use in route loader
await queryClient.ensureQueryData(accountsQueryOptions({ userId, accountRepository }));
```

## Suspense Query with Select

```typescript
export function useAccounts<T extends AccountType = AccountType>(
  select?: UseAccountsSelect<T>,
): UseSuspenseQueryResult<ExtendedAccount<T>[]> {
  const user = useUser();
  const accountRepository = useAccountRepository();

  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    // ALWAYS memoize select to prevent re-computation every render
    select: useCallback(
      (data: Account[]) => data.filter(/* ... */) as ExtendedAccount<T>[],
      [select?.currency, select?.type],
    ),
  });
}
```

## useUser Select Pattern

Extract specific fields to avoid re-renders when other user fields change:
```typescript
const userId = useUser((user) => user.id);
const defaultCurrency = useUser((x) => x.defaultCurrency);
```

## Mutation with Cache Update

```typescript
export function useAddCashuAccount() {
  const userId = useUser((x) => x.id);
  const accountCache = useAccountsCache();
  const accountService = useAccountService();

  const { mutateAsync } = useMutation({
    mutationFn: async (account) =>
      accountService.addCashuAccount({ userId, account }),
    onSuccess: (account) => {
      accountCache.upsert(account); // Direct cache update, no refetch
    },
  });

  return mutateAsync;
}
```

## Mutation with Static Scope

```typescript
useMutation({
  mutationKey: ['initiate-cashu-send-quote'],
  scope: { id: 'initiate-cashu-send-quote' }, // All calls serialized
  mutationFn: /* ... */,
  onSuccess: (data) => {
    cashuSendQuoteCache.add(data);
    onSuccess(data);
  },
  retry: (failureCount, error) => {
    if (error instanceof ConcurrencyError) return true;
    if (error instanceof DomainError) return false;
    return failureCount < 1;
  },
});
```

## Dynamic Scope at Call Site

```typescript
// Per-entity scope: "complete quote A" doesn't block "expire quote B"
markSendQuoteAsPending(sendQuote.id, {
  scope: { id: `cashu-send-quote-${sendQuote.id}` },
});

completeSwap(swap.id, {
  scope: { id: `send-swap-${swap.id}` },
});
```

## Infinite Query (Transactions)

```typescript
const PAGE_SIZE = 20;

export function useTransactions(accountId?: string) {
  return useInfiniteQuery({
    queryKey: [allTransactionsQueryKey, accountId],
    initialPageParam: null,
    queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
      const result = await transactionRepository.list({
        userId, cursor: pageParam, pageSize: PAGE_SIZE, accountId,
      });
      return {
        transactions: result.transactions,
        nextCursor: result.transactions.length === PAGE_SIZE
          ? result.nextCursor : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });
}
```

## Updating Infinite Query Cache

Use `getQueriesData` to update all filtered views at once:
```typescript
const acknowledgeInHistoryCache = (queryClient, transaction) => {
  const queries = queryClient.getQueriesData<InfiniteData<{ transactions: Transaction[] }>>({
    queryKey: [allTransactionsQueryKey],
  });

  queries.forEach(([queryKey, data]) => {
    if (!data) return;
    queryClient.setQueryData(queryKey, {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        transactions: page.transactions.map((tx) =>
          tx.id === transaction.id ? { ...tx, acknowledgmentStatus: 'acknowledged' } : tx,
        ),
      })),
    });
  });
};
```

## Event-Driven Cache Updates (Supabase Realtime)

```typescript
// app/features/wallet/use-track-wallet-changes.ts
export const useTrackWalletChanges = () => {
  const accountChangeHandlers = useAccountChangeHandlers();
  const transactionChangeHandlers = useTransactionChangeHandlers();

  useTrackDatabaseChanges({
    handlers: [...accountChangeHandlers, ...transactionChangeHandlers],
    onConnected: () => {
      accountsCache.invalidate(); // Catch events missed during disconnect
      transactionsCache.invalidate();
    },
  });
};

// Change handler pattern
export function useAccountChangeHandlers() {
  const accountRepository = useAccountRepository();
  const accountCache = useAccountsCache();

  return [
    {
      event: 'ACCOUNT_CREATED',
      handleEvent: async (payload) => {
        const account = await accountRepository.toAccount(payload);
        accountCache.upsert(account);
      },
    },
    {
      event: 'ACCOUNT_UPDATED',
      handleEvent: async (payload) => {
        const account = await accountRepository.toAccount(payload);
        accountCache.update(account); // Version-checked
      },
    },
  ];
}
```

## Route Loader Prefetching

```typescript
// app/routes/_protected.tsx
const ensureUserData = async (queryClient, authUser) => {
  const [encryptionPrivateKey, encryptionPublicKey, cashuLockingXpub] =
    await Promise.all([
      queryClient.ensureQueryData(encryptionPrivateKeyQueryOptions()),
      queryClient.ensureQueryData(encryptionPublicKeyQueryOptions()),
      queryClient.ensureQueryData(xpubQueryOptions({ queryClient, derivationPath })),
    ]);
};
```

## Query Client Setup

**File**: `app/query-client.ts`

```typescript
let browserQueryClient: QueryClient | undefined = undefined;

function makeQueryClient() {
  return new QueryClient();
}

export function getQueryClient() {
  if (isServer) {
    return makeQueryClient(); // New instance per SSR request
  }
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient; // Singleton in browser
}
```

Provider with HydrationBoundary and devtools in `app/root.tsx`.
