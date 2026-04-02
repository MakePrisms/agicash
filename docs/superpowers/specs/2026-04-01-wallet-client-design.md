# WalletClient SDK Refactor — Design Spec

## Problem

Orchestration logic (query definitions, background task processing, caching strategy) is scattered across the web app's React hooks. The SDK has business logic (services/repos) but no opinion on caching or task processing. This makes it impossible for the CLI (or any non-React consumer) to share the same behavior without duplicating code.

## Design

### Single entry point: `createWalletClient`

```typescript
import { createWalletClient } from '@agicash/sdk';

const wallet = createWalletClient({
  db: supabaseClient,       // AgicashDb
  keyProvider: keyProvider,  // OpenSecret or local
  userId: '...',             // from auth
});
```

Configured once at startup. Returns pre-bound query factories, mutation helpers, and a task manager. No deps passed at call sites.

### Pre-bound query factories

```typescript
const {
  listAccountsQuery,
  getAccountQuery,
  getBalanceQuery,
  pendingReceiveQuotesQuery,
  unresolvedSendQuotesQuery,
  mintInfoQuery,
} = wallet.queries;

// Zero args — deps already bound
const accounts = await wallet.queryClient.fetchQuery(listAccountsQuery());
```

Web app wraps with React hooks:
```typescript
const useAccounts = () => useSuspenseQuery(listAccountsQuery());
```

CLI calls directly:
```typescript
const accounts = await wallet.queryClient.fetchQuery(listAccountsQuery());
```

### Pre-bound mutations / actions

```typescript
const {
  createReceiveQuote,
  completeReceive,
  createSendSwap,
  payInvoice,
  addCashuAccount,
} = wallet.actions;

// Zero args beyond the operation-specific params
const quote = await createReceiveQuote({ amount, accountId });
const result = await payInvoice({ bolt11, accountId });
```

### Background task processing

```typescript
wallet.taskManager.start();  // watches pending quotes/swaps, auto-completes
wallet.taskManager.stop();
wallet.taskManager.on('receive:minted', (event) => { ... });
wallet.taskManager.on('send:completed', (event) => { ... });
wallet.taskManager.on('error', (event) => { ... });
```

Uses same subscription managers already in SDK (MintQuoteSubscriptionManager, MeltQuoteSubscriptionManager, ProofStateSubscriptionManager).

### Caching via @tanstack/query-core

SDK depends on `@tanstack/query-core` (no React). QueryClient handles:
- Deduplication (same mint info fetched once)
- staleTime/gcTime (wallet init cached across operations)
- Retries (configurable per query)
- Background refetch

Web app can pass its own QueryClient:
```typescript
const wallet = createWalletClient({
  db, keyProvider, userId,
  queryClient: existingReactQueryClient,  // optional override
});
```

### Escape hatches

```typescript
wallet.queryClient     // underlying QueryClient
wallet.services        // { accountService, cashuReceiveQuoteService, ... }
wallet.repos           // { accountRepo, transactionRepo, ... }
```

## Architecture

```
@agicash/sdk
├── core/
│   ├── create-wallet-client.ts     # Factory → returns WalletClient
│   └── query-keys.ts               # All query key factories
├── features/
│   ├── accounts/
│   │   ├── account-repository.ts   # unchanged
│   │   ├── account-service.ts      # unchanged
│   │   └── account-queries.ts      # listAccountsQuery, getBalanceQuery, etc.
│   ├── receive/
│   │   ├── *-repository.ts         # unchanged
│   │   ├── *-service.ts            # unchanged
│   │   ├── receive-queries.ts      # pendingReceiveQuotesQuery, etc.
│   │   └── receive-task-processor.ts
│   ├── send/
│   │   ├── *-repository.ts
│   │   ├── *-service.ts
│   │   ├── send-queries.ts
│   │   └── send-task-processor.ts
│   └── wallet/
│       └── task-manager.ts         # coordinates all processors
└── lib/cashu/                      # subscription managers (unchanged)

Web App (thin React layer)
└── hooks wrap useSuspenseQuery(wallet.queries.X()) — one-liners

CLI (thin terminal layer)
└── commands call wallet.queryClient.fetchQuery(wallet.queries.X()) or wallet.actions.X()
```

## Migration path

1. Add `@tanstack/query-core` to SDK, drop custom `Cache` interface
2. Create `WalletClient` factory with pre-bound query factories (additive, no breaking changes)
3. Move queryOptions from web app hooks → SDK query files (one feature at a time)
4. Extract task processors from React hooks → SDK classes
5. Thin out web app hooks to one-liners wrapping SDK queries
6. CLI simplifies to use wallet.actions / wallet.queries

Steps 1-2 are additive (no web app changes needed). Steps 3-5 migrate the web app. Step 6 simplifies the CLI.

## Key decisions

- **Pre-bound factories** — configure once, no deps at call sites
- **@tanstack/query-core** — same caching everywhere, no custom Cache interface
- **Event-based task manager** — processors emit events, consumers handle UI/logging
- **Named exports for queries** — `listAccountsQuery` not `wallet.accounts.queryOptions()`
- **Web app can inject its QueryClient** — shares cache with React DevTools
