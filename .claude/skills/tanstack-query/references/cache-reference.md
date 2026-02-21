# Cache & Query Reference Tables

## Cache Classes

All cache classes follow the same pattern: static `Key` property, constructor takes `QueryClient`, methods are version-aware. Use `useXxxCache()` hooks for stable instances (wraps `useMemo`).

| Cache Class | Key | Location |
|---|---|---|
| `AccountsCache` | `'accounts'` | `app/features/accounts/account-hooks.ts` |
| `TransactionsCache` | `'transactions'` | `app/features/transactions/transaction-hooks.ts` |
| `ContactsCache` | `'contacts'` | `app/features/contacts/contact-hooks.ts` |
| `CashuSendQuoteCache` | `'cashu-send-quote'` | `app/features/send/cashu-send-quote-hooks.ts` |
| `UnresolvedCashuSendQuotesCache` | `'unresolved-cashu-send-quotes'` | `app/features/send/cashu-send-quote-hooks.ts` |
| `CashuSendSwapCache` | `'cashu-send-swap'` | `app/features/send/cashu-send-swap-hooks.ts` |
| `CashuReceiveQuoteCache` | `'cashu-receive-quote'` | `app/features/receive/cashu-receive-quote-hooks.ts` |
| `PendingCashuReceiveQuotesCache` | `'pending-cashu-receive-quotes'` | `app/features/receive/cashu-receive-quote-hooks.ts` |
| `CashuReceiveSwapCache` | `'cashu-receive-swap'` | `app/features/receive/cashu-receive-swap-hooks.ts` |
| `PendingCashuReceiveSwapsCache` | `'pending-cashu-receive-swaps'` | `app/features/receive/cashu-receive-swap-hooks.ts` |
| `SparkReceiveQuoteCache` | `'spark-receive-quote'` | `app/features/receive/spark-receive-quote-hooks.ts` |
| `PendingSparkReceiveQuotesCache` | `'pending-spark-receive-quotes'` | `app/features/receive/spark-receive-quote-hooks.ts` |
| `UnresolvedSparkSendQuotesCache` | `'unresolved-spark-send-quotes'` | `app/features/send/spark-send-quote-hooks.ts` |

**Standard methods**: `add()`, `update()` / `updateIfExists()`, `upsert()`, `get()` / `getAll()`, `remove()`, `invalidate()`.

## queryOptions Factories

| Factory | staleTime | Location |
|---|---|---|
| `accountsQueryOptions` | `Infinity` | `app/features/accounts/account-hooks.ts` |
| `userQueryOptions` | default | `app/features/user/user-hooks.tsx` |
| `exchangeRatesQueryOptions` | default | `app/hooks/use-exchange-rate.ts` |
| `seedQueryOptions` | `Infinity` | `app/features/shared/cashu.ts` |
| `xpubQueryOptions` | `Infinity` | `app/features/shared/cashu.ts` |
| `privateKeyQueryOptions` | `Infinity` | `app/features/shared/cashu.ts` |
| `mintInfoQueryOptions` | 1 hour | `app/features/shared/cashu.ts` |
| `allMintKeysetsQueryOptions` | 1 hour | `app/features/shared/cashu.ts` |
| `mintKeysQueryOptions` | 1 hour | `app/features/shared/cashu.ts` |
| `isTestMintQueryOptions` | `Infinity` | `app/features/shared/cashu.ts` |
| `sparkMnemonicQueryOptions` | `Infinity` | `app/features/shared/spark.ts` |
| `sparkIdentityPublicKeyQueryOptions` | `Infinity` | `app/features/shared/spark.ts` |
| `sparkWalletQueryOptions` | `Infinity` + `gcTime: Infinity` | `app/features/shared/spark.ts` |

## staleTime Configuration Rationale

| Data Type | staleTime | gcTime | Rationale |
|---|---|---|---|
| Crypto keys, seeds, mnemonics | `Infinity` | `Infinity` | Deterministic derivation, never changes |
| Spark wallet instances | `Infinity` | `Infinity` | Expensive to reinitialize |
| Accounts, transactions, contacts | `Infinity` | default | Updated via Supabase Realtime events |
| Mint metadata (info, keysets, keys) | 1 hour | default | Rarely changes but not event-driven |
| Exchange rates | default | default | Uses `refetchInterval: 15_000` |

## Query Key Patterns

**Pattern 1 — Static keys on cache classes** (single-collection queries):
```typescript
queryKey: [AccountsCache.Key]          // ['accounts']
queryKey: [ContactsCache.Key]          // ['contacts']
```

**Pattern 2 — Hierarchical keys with IDs** (individual resources):
```typescript
queryKey: [CashuSendQuoteCache.Key, quoteId]     // ['cashu-send-quote', 'abc']
queryKey: [TransactionsCache.Key, transactionId]  // ['transactions', '123']
queryKey: ['spark-balance', accountId]            // ['spark-balance', 'acc-1']
```

**Pattern 3 — Derived keys** (computed from base keys):
```typescript
const allTransactionsQueryKey = 'all-transactions';
const unacknowledgedCountQueryKey = `${TransactionsCache.Key}-unacknowledged-count`;
```

**Pattern 4 — Parameterized keys** (list views with filters):
```typescript
queryKey: [allTransactionsQueryKey, accountId]  // ['all-transactions', 'acc-1']
```

## Error Classes

Defined in `app/features/shared/error.ts`:

| Class | Retry behavior | Use |
|---|---|---|
| `DomainError` | Never retry | Business rule violations, user-friendly messages |
| `ConcurrencyError` | Always retry | Optimistic locking conflicts |
| `NotFoundError` | Never retry | Missing resources |
| `UniqueConstraintError` | Never retry | Duplicate entries |
