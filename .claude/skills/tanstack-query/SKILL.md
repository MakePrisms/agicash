---
name: tanstack-query
description: TanStack Query v5 patterns specific to this project. Covers our cache class pattern, repository integration, suspense queries, event-driven updates, version-aware caching, and mutation patterns. Use for all server state management and cache operations.
---

# TanStack Query v5 - Project Guide

**TanStack Query v5** is our async state manager, integrated with React Router v7 for SSR. This guide covers the specific patterns established in our codebase.

## Project Architecture

### Query Client Setup

**File**: `app/query-client.ts`

```typescript
import { QueryClient } from '@tanstack/react-query';

// Singleton pattern with separate instances for server/browser
let browserQueryClient: QueryClient | undefined = undefined;

function makeQueryClient() {
  return new QueryClient();
}

export function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always create new instance per request
    return makeQueryClient();
  } else {
    // Browser: maintain single instance
    if (!browserQueryClient) browserQueryClient = makeQueryClient();
    return browserQueryClient;
  }
}
```

**File**: `app/root.tsx`

```typescript
import { QueryClientProvider } from '@tanstack/react-query';
import { HydrationBoundary } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

export function Layout({ children }: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  const dehydratedState = useDehydratedState(); // Merges dehydrated state from loaders

  return (
    <QueryClientProvider client={queryClient}>
      <HydrationBoundary state={dehydratedState}>
        {children}
        <ReactQueryDevtools initialIsOpen={false} />
      </HydrationBoundary>
    </QueryClientProvider>
  );
}
```

### Cache Class Pattern

**Core pattern**: Create domain-specific cache classes that encapsulate all cache operations.

```typescript
// app/hooks/account-hooks.ts

import { QueryClient } from '@tanstack/react-query';

class AccountsCache {
  // Static key for consistency
  public static Key = 'accounts';

  constructor(private readonly queryClient: QueryClient) {}

  // Direct cache access methods
  getAll(): Account[] | undefined {
    return this.queryClient.getQueryData<Account[]>([AccountsCache.Key]);
  }

  get(accountId: string): Account | undefined {
    const accounts = this.getAll();
    return accounts?.find((account) => account.id === accountId);
  }

  // Optimistic updates
  upsert(account: Account) {
    this.queryClient.setQueryData<Account[]>([AccountsCache.Key], (curr) => {
      if (!curr) return [account];
      const exists = curr.some((a) => a.id === account.id);
      return exists
        ? curr.map((a) => (a.id === account.id ? account : a))
        : [...curr, account];
    });
  }

  update(accountId: string, updater: (account: Account) => Account) {
    this.queryClient.setQueryData<Account[]>([AccountsCache.Key], (curr) =>
      curr?.map((a) => (a.id === accountId ? updater(a) : a)),
    );
  }

  // Cache invalidation
  invalidate() {
    this.queryClient.invalidateQueries({ queryKey: [AccountsCache.Key] });
  }
}

// Wrap in hook with useMemo for stable instance
export function useAccountsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new AccountsCache(queryClient), [queryClient]);
}
```

**Key benefits**:
- Encapsulates all cache operations for a domain
- Type-safe cache access
- Prevents key duplication errors
- Easy to test and maintain
- Stable instance via useMemo

### queryOptions Factory Pattern

**Use `queryOptions` for type-safe, reusable query definitions**.

```typescript
// app/hooks/account-hooks.ts

import { queryOptions, useSuspenseQuery } from '@tanstack/react-query';

// Factory function returns queryOptions
export const accountsQueryOptions = ({
  userId,
  accountRepository,
}: {
  userId: string;
  accountRepository: AccountRepository;
}) => {
  return queryOptions({
    queryKey: [AccountsCache.Key],
    queryFn: () => accountRepository.getAll(userId),
    staleTime: Number.POSITIVE_INFINITY, // Never stale (event-driven updates)
  });
};

// Custom hook uses the factory
export function useAccounts<T extends AccountType = AccountType>({
  currency,
  type,
  isOnline,
}: UseAccountsOptions = {}) {
  const { user } = useUser();
  const accountRepository = useAccountRepository();

  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    // Use select for filtering
    select: useCallback(
      (data: Account[]) => {
        return data.filter((account) => {
          if (currency && account.currency !== currency) return false;
          if (type && account.type !== type) return false;
          if (isOnline !== undefined && account.isOnline !== isOnline) return false;
          return true;
        }) as Account<T>[];
      },
      [currency, type, isOnline],
    ),
  });
}
```

**Benefits**:
- Full type inference across the codebase
- Single source of truth for query configuration
- Works with prefetching, setQueryData, getQueryData
- Prevents key/function mismatches

### Query Key Patterns

**Pattern 1 - Static Keys on Cache Classes** (for single-instance queries):

```typescript
class AccountsCache {
  public static Key = 'accounts'; // Single top-level key
}

// Usage
queryKey: [AccountsCache.Key]
```

**Pattern 2 - Hierarchical Keys with IDs**:

```typescript
// For individual resources
queryKey: [TransactionsCache.Key, transactionId]  // ['transactions', '123']
queryKey: ['cashu-send-quote', quoteId]            // ['cashu-send-quote', 'abc']
queryKey: ['mint-quote', quote.quoteId]            // ['mint-quote', 'xyz']
queryKey: ['spark-balance', accountId]             // ['spark-balance', 'acc-1']

// For invalidation hierarchy
queryClient.invalidateQueries({ queryKey: [TransactionsCache.Key] }); // All transactions
queryClient.setQueryData([TransactionsCache.Key, id], data);           // Specific transaction
```

**Pattern 3 - Computed Keys for Derived Data**:

```typescript
// Unacknowledged count is derived from transactions but has separate key
const unacknowledgedCountQueryKey = `${TransactionsCache.Key}-unacknowledged-count`;

// Usage
queryKey: [unacknowledgedCountQueryKey]
```

**Critical rules**:
- Include ALL variables used in queryFn
- Be consistent with types (`'1'` vs `1`)
- Use static keys on cache classes for consistency

### Suspense Queries (Preferred for Required Data)

**Use `useSuspenseQuery` for data that must exist before rendering**.

```typescript
import { useSuspenseQuery } from '@tanstack/react-query';

export function useAccounts() {
  const { user } = useUser();
  const accountRepository = useAccountRepository();

  // Data is NEVER undefined with suspense queries
  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}

// Component using suspense query
function AccountList() {
  const { data: accounts } = useAccounts(); // data is Account[], never undefined

  return (
    <ul>
      {accounts.map((account) => (
        <li key={account.id}>{account.name}</li>
      ))}
    </ul>
  );
}
```

**Benefits**:
- Eliminates loading state management
- Data always defined (TypeScript enforced)
- Cleaner component code
- Works seamlessly with error boundaries

### Regular Queries (For Optional/Conditional Data)

**Use `useQuery` when data is optional or conditionally fetched**.

```typescript
export function useTransaction({ transactionId }: { transactionId?: string }) {
  const transactionRepository = useTransactionRepository();
  const enabled = !!transactionId;

  return useQuery({
    queryKey: [TransactionsCache.Key, transactionId],
    queryFn: () => transactionRepository.get(transactionId ?? ''),
    enabled, // Only fetch when ID exists
    staleTime: Number.POSITIVE_INFINITY,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
  });
}
```

### Data Transformation with select

**Memoize `select` callbacks to prevent unnecessary recalculations**.

```typescript
export function useAccounts({ currency, type }: UseAccountsOptions = {}) {
  const { user } = useUser();
  const accountRepository = useAccountRepository();

  return useSuspenseQuery({
    ...accountsQueryOptions({ userId: user.id, accountRepository }),
    // ✅ Memoized with useCallback - only re-runs when dependencies change
    select: useCallback(
      (data: Account[]) => {
        return data.filter((account) => {
          if (currency && account.currency !== currency) return false;
          if (type && account.type !== type) return false;
          return true;
        });
      },
      [currency, type], // Stable dependencies
    ),
  });
}
```

**Key principle**: Always memoize select functions with `useCallback` to prevent running on every render.

### Repository Pattern Integration

**All queries use repository classes to abstract data fetching**.

```typescript
// app/repositories/account-repository.ts

import { QueryClient } from '@tanstack/react-query';
import type { Account } from '@/types';

class AccountRepository {
  constructor(
    private readonly db: DatabaseClient,
    private readonly encryption: Encryption,
    private readonly queryClient: QueryClient,
  ) {}

  async get(id: string): Promise<Account> {
    const record = await this.db.from('accounts').select().eq('id', id).single();
    return this.toAccount(record);
  }

  async getAll(userId: string): Promise<Account[]> {
    const records = await this.db
      .from('accounts')
      .select()
      .eq('user_id', userId);
    return Promise.all(records.map((r) => this.toAccount(r)));
  }

  private async toAccount(record: DbAccount): Promise<Account> {
    // Transform DB record to domain model
    // Handle encryption, parsing, etc.
    return { ...record };
  }
}

// Hook for repository instance
export function useAccountRepository() {
  const encryption = useEncryption();
  const queryClient = useQueryClient();
  return new AccountRepository(agicashDbClient, encryption, queryClient);
}
```

**Benefits**:
- Clean separation between data fetching and React Query
- Easy to test repository logic independently
- Encapsulates DB schema transformations
- Reusable across queries and mutations

## Mutations

### Basic Mutation with Cache Update

```typescript
export function useAddCashuAccount() {
  const { user } = useUser();
  const accountCache = useAccountsCache();

  const { mutateAsync } = useMutation({
    mutationFn: async (account: Account) =>
      accountService.addCashuAccount({ userId: user.id, account }),
    onSuccess: (account) => {
      // Immediately update cache (optimistic)
      accountCache.upsert(account);
    },
  });

  return mutateAsync;
}
```

### Mutation with Scope (Concurrency Control)

**Use `scope` to limit concurrent mutations of the same type**.

```typescript
export function useCreateCashuReceiveQuote() {
  const cashuReceiveQuoteCache = useCashuReceiveQuoteCache();

  return useMutation({
    scope: { id: 'create-cashu-receive-quote' }, // Only one can run at a time
    mutationFn: async ({ account, amount, description }: CreateProps) => {
      const quote = await cashuService.createReceiveQuote({
        account,
        amount,
        description,
      });
      return quote;
    },
    onSuccess: (data) => {
      cashuReceiveQuoteCache.add(data);
    },
    retry: 1,
  });
}
```

### Mutation with Custom Retry Logic

```typescript
export function useAcknowledgeTransaction() {
  const transactionRepository = useTransactionRepository();

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      return transactionRepository.acknowledge(transaction.id);
    },
    retry: (failureCount, error) => {
      // Always retry concurrency errors (optimistic locking)
      if (error instanceof ConcurrencyError) {
        return true;
      }
      // Never retry domain errors (business logic failures)
      if (error instanceof DomainError) {
        return false;
      }
      // Default: retry once
      return failureCount < 1;
    },
  });
}
```

### Mutation with Stable Callbacks (useLatest Pattern)

**Use `useLatest` to avoid recreating mutation on callback changes**.

```typescript
import { useLatest } from '@/hooks/use-latest';

export function useReverseTransaction({
  onSuccess,
  onError,
}: {
  onSuccess?: () => void;
  onError?: (error: Error) => void;
}) {
  const transactionRepository = useTransactionRepository();

  // Store latest callbacks without triggering mutation recreation
  const onSuccessRef = useLatest(onSuccess);
  const onErrorRef = useLatest(onError);

  return useMutation({
    mutationFn: async ({ transaction }: { transaction: Transaction }) => {
      return transactionRepository.reverse(transaction.id);
    },
    onSuccess: () => {
      onSuccessRef.current?.();
    },
    onError: (error) => {
      onErrorRef.current?.(error);
    },
  });
}
```

## Event-Driven Cache Updates

**Real-time updates via webhooks/subscriptions**.

```typescript
// app/hooks/transaction-hooks.ts

export function useTransactionChangeHandlers() {
  const transactionRepository = useTransactionRepository();
  const transactionsCache = useTransactionsCache();

  return [
    {
      event: 'TRANSACTION_CREATED',
      handleEvent: async (payload: AgicashDbTransaction) => {
        const transaction = await transactionRepository.toTransaction(payload);
        transactionsCache.add(transaction); // Update cache immediately
      },
    },
    {
      event: 'TRANSACTION_UPDATED',
      handleEvent: async (payload: AgicashDbTransaction) => {
        const transaction = await transactionRepository.toTransaction(payload);
        transactionsCache.upsert(transaction);
      },
    },
    {
      event: 'TRANSACTION_DELETED',
      handleEvent: (payload: { id: string }) => {
        transactionsCache.remove(payload.id);
      },
    },
  ];
}

// Usage in component
function App() {
  const handlers = useTransactionChangeHandlers();

  useEffect(() => {
    // Subscribe to real-time events
    const unsubscribe = subscribeToEvents(handlers);
    return unsubscribe;
  }, [handlers]);

  return <Routes />;
}
```

**Key principle**: Cache updates are event-driven, not polling-based. Set `staleTime: Number.POSITIVE_INFINITY` and update cache manually via events.

## Advanced Patterns

### Version-Aware Cache Updates

**Prevent stale data from overwriting newer data**.

```typescript
class CashuSendQuoteCache {
  updateIfExists(quote: CashuSendQuote) {
    this.queryClient.setQueryData<CashuSendQuote>(
      [CashuSendQuoteCache.Key, quote.id],
      (curr) => {
        // Only update if quote is newer than current cached version
        if (curr && curr.version < quote.version) {
          return quote;
        }
        return curr; // Keep current if newer or same version
      },
    );
  }
}
```

**Key principle**: Always check version before updating cache to prevent race conditions.

### useQueries for Parallel Queries

**Track and update multiple resources in parallel**.

```typescript
export function useTrackAndUpdateSparkAccountBalances() {
  const { data: sparkAccounts } = useAccounts({ type: 'spark' });
  const accountCache = useAccountsCache();

  useQueries({
    queries: sparkAccounts.map((account) => ({
      queryKey: ['spark-balance', account.id],
      queryFn: async () => {
        const { balance } = await account.wallet.getBalance();
        // Update cache directly
        accountCache.updateSparkBalance({ ...account, balance });
        return balance;
      },
      staleTime: Number.POSITIVE_INFINITY,
      refetchInterval: 3000, // Poll every 3 seconds
    })),
  });
}
```

### Dynamic Polling with Error-Aware Intervals

**Adjust polling frequency based on response status**.

```typescript
export function usePollMintQuotes() {
  const { data: quotes } = useCashuReceiveQuotes();
  const account = useSelectedAccount();

  useQueries({
    queries: quotes.map((quote) => ({
      queryKey: ['mint-quote', quote.quoteId],
      queryFn: async () => checkMintQuote(account, quote),
      refetchInterval: (query: Query) => {
        const error = query.state.error;
        const isRateLimitError =
          error instanceof HttpResponseError && error.status === 429;

        // Back off to 60s on rate limit, otherwise poll every 10s
        return isRateLimitError ? 60 * 1000 : 10 * 1000;
      },
      refetchIntervalInBackground: true, // Continue polling in background
    })),
  });
}
```

### Infinite Queries (Cursor-Based Pagination)

```typescript
const PAGE_SIZE = 20;

export function useTransactions() {
  const { user } = useUser();
  const transactionRepository = useTransactionRepository();

  return useInfiniteQuery({
    queryKey: ['all-transactions'],
    initialPageParam: null as Cursor | null,
    queryFn: async ({ pageParam }: { pageParam: Cursor | null }) => {
      const result = await transactionRepository.list({
        userId: user.id,
        cursor: pageParam,
        pageSize: PAGE_SIZE,
      });

      return {
        transactions: result.transactions,
        // Only set nextCursor if we got a full page
        nextCursor:
          result.transactions.length === PAGE_SIZE ? result.nextCursor : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: 'always',
    retry: 1,
  });
}
```

### Updating InfiniteQuery Cache

**Manually update paginated data in cache**.

```typescript
const acknowledgeTransactionInHistoryCache = (
  queryClient: QueryClient,
  transaction: Transaction,
) => {
  queryClient.setQueryData<
    InfiniteData<{
      transactions: Transaction[];
      nextCursor: Cursor | null;
    }>
  >(['all-transactions'], (old) => {
    if (!old) return old;

    return {
      ...old,
      pages: old.pages.map((page) => ({
        ...page,
        transactions: page.transactions.map((tx) =>
          tx.id === transaction.id && tx.acknowledgmentStatus === 'pending'
            ? { ...tx, acknowledgmentStatus: 'acknowledged' }
            : tx,
        ),
      })),
    };
  });
};
```

## Configuration Patterns

### Common Query Options

**Standard options used across the project**:

```typescript
// Event-driven data (updated via webhooks/subscriptions)
{
  staleTime: Number.POSITIVE_INFINITY,    // Never stale, updated by events
  gcTime: Number.POSITIVE_INFINITY,       // Keep in cache forever
  refetchOnWindowFocus: 'always',         // Always refetch on focus
  refetchOnReconnect: 'always',           // Always refetch on reconnect
}

// Polled data (balances, pending quotes)
{
  staleTime: Number.POSITIVE_INFINITY,
  refetchInterval: 3000,                  // Poll every 3 seconds
  refetchIntervalInBackground: true,      // Continue in background
}

// Conditional queries
{
  enabled: !!someId,                      // Only fetch when ID exists
  staleTime: Number.POSITIVE_INFINITY,
  refetchOnWindowFocus: 'always',
  refetchOnReconnect: 'always',
}
```

### Retry Configuration

```typescript
// Default: retry once
{
  retry: 1,
}

// Custom retry logic
{
  retry: (failureCount, error) => {
    if (error instanceof ConcurrencyError) return true;  // Always retry
    if (error instanceof DomainError) return false;      // Never retry
    return failureCount < 1;                             // Default: retry once
  },
}
```

## SSR & Dehydration

### Dehydrated State Pattern

**Merge dehydrated states from multiple route loaders**.

```typescript
// app/hooks/use-dehydrated-state.ts

import { useMatches } from 'react-router';
import { DehydratedState } from '@tanstack/react-query';
import { merge } from 'deepmerge-ts';

export const useDehydratedState = (): DehydratedState | undefined => {
  const matches = useMatches();

  const dehydratedState = matches
    .map(
      (match) =>
        (match.loaderData as { dehydratedState?: DehydratedState } | undefined)
          ?.dehydratedState,
    )
    .filter((x): x is DehydratedState => Boolean(x));

  return dehydratedState.length
    ? dehydratedState.reduce(
        (accumulator, currentValue) => merge(accumulator, currentValue),
        {} as DehydratedState,
      )
    : undefined;
};
```

### Route Loader Integration

```typescript
// app/routes/_index.tsx

import { dehydrate } from '@tanstack/react-query';
import { accountsQueryOptions } from '@/hooks/account-hooks';

export async function loader({ request }: LoaderFunctionArgs) {
  const queryClient = getQueryClient();
  const userId = await getUserId(request);

  // Prefetch data on server
  await queryClient.prefetchQuery(
    accountsQueryOptions({ userId, accountRepository }),
  );

  return {
    dehydratedState: dehydrate(queryClient),
  };
}
```

## Anti-Patterns to Avoid

**❌ Don't update cache without version checks**:

```typescript
// ❌ Wrong - can overwrite newer data with stale data
updateQuote(quote: Quote) {
  this.queryClient.setQueryData([QuoteCache.Key, quote.id], quote);
}

// ✅ Correct - check version first
updateQuote(quote: Quote) {
  this.queryClient.setQueryData([QuoteCache.Key, quote.id], (curr) =>
    curr && curr.version < quote.version ? quote : curr,
  );
}
```

**❌ Don't forget to memoize select functions**:

```typescript
// ❌ Wrong - creates new function every render
const { data } = useQuery({
  queryKey: ['accounts'],
  queryFn: fetchAccounts,
  select: (data) => data.filter((a) => a.type === type), // New function each render!
});

// ✅ Correct - memoize with useCallback
const { data } = useQuery({
  queryKey: ['accounts'],
  queryFn: fetchAccounts,
  select: useCallback(
    (data) => data.filter((a) => a.type === type),
    [type], // Stable dependencies
  ),
});
```

**❌ Don't create cache class instances directly**:

```typescript
// ❌ Wrong - new instance every render
function MyComponent() {
  const queryClient = useQueryClient();
  const cache = new AccountsCache(queryClient); // New instance!
}

// ✅ Correct - use hook with useMemo
function MyComponent() {
  const cache = useAccountsCache(); // Stable instance
}
```

**❌ Don't use invalidateQueries when you should use setQueryData**:

```typescript
// ❌ Wrong - triggers refetch unnecessarily
onSuccess: (data) => {
  queryClient.invalidateQueries({ queryKey: ['accounts'] });
};

// ✅ Correct - update cache directly for known data
onSuccess: (account) => {
  accountCache.upsert(account); // Direct cache update, no refetch
};
```

**❌ Don't forget query keys must include all variables**:

```typescript
// ❌ Wrong - missing dependency
const { data } = useQuery({
  queryKey: ['transaction'],
  queryFn: () => fetchTransaction(transactionId), // transactionId not in key!
});

// ✅ Correct - include all variables
const { data } = useQuery({
  queryKey: ['transaction', transactionId],
  queryFn: () => fetchTransaction(transactionId),
});
```

## Key Principles Summary

1. **Cache Classes**: Use domain-specific cache classes with static keys
2. **queryOptions Factory**: Create reusable query configurations
3. **Suspense Queries**: Prefer for required data to eliminate loading states
4. **Event-Driven Updates**: Set `staleTime: Number.POSITIVE_INFINITY` and update via events
5. **Version-Aware Updates**: Always check version before updating cache
6. **Repository Pattern**: Abstract data fetching from React Query logic
7. **Mutation Scope**: Use scope to control concurrent mutations
8. **Memoize select**: Always wrap select functions in useCallback
9. **Dynamic Polling**: Adjust refetch intervals based on errors
10. **SSR Integration**: Use dehydration with React Router v7 loaders
