---
name: tanstack-query
description: TanStack Query v5 patterns specific to this project. Covers our cache class pattern, repository integration, suspense queries, event-driven updates, version-aware caching, and mutation patterns. Use for all server state management and cache operations.
---

# TanStack Query v5 — Project Conventions

`@tanstack/react-query` v5.90+ with React 19, React Router v7.

**References** (load when needed):
- [cache-reference.md](references/cache-reference.md) — All cache classes, queryOptions factories, staleTime config, query key patterns, error classes
- [code-patterns.md](references/code-patterns.md) — Full code examples for each pattern below

## Architecture Decisions

### Event-Driven Updates (not polling)

Most data uses `staleTime: Infinity` and is updated via **Supabase Realtime** subscriptions, not polling or refetching. Cache classes receive Realtime events and update the query cache directly. `invalidate()` is used on reconnection as a safety net for missed events.

The only polled query is exchange rates (`refetchInterval: 15_000`).

### Cache Class Pattern

Domain-specific classes encapsulate all cache operations with a static `Key` property. Provides typed API over raw `setQueryData`. Use `useXxxCache()` hooks for stable instances.

```typescript
class AccountsCache {
  public static Key = 'accounts';
  constructor(private readonly queryClient: QueryClient) {}
  upsert(account: Account) { /* version-checked setQueryData */ }
  update(account: Account) { /* version-checked setQueryData */ }
  getAll() { /* getQueryData */ }
  invalidate() { /* invalidateQueries */ }
}

// Stable instance via useMemo
export function useAccountsCache() {
  const queryClient = useQueryClient();
  return useMemo(() => new AccountsCache(queryClient), [queryClient]);
}
```

### Version-Aware Updates

All cache updates check a `version` field to prevent stale data overwriting newer data (Supabase Realtime events can arrive out of order):

```typescript
// Always compare versions before updating
curr.map((x) =>
  x.id === item.id && item.version > x.version ? item : x,
);
```

### queryOptions() Factories

Primary abstraction for reusable query configs. Co-locates `queryKey` + `queryFn` with full type inference. Used across `useSuspenseQuery`, `ensureQueryData`, `prefetchQuery`, etc.

### Query Keys

Use static `Key` properties from cache classes. Structure generic-to-specific for fuzzy invalidation:
- `[AccountsCache.Key]` — collection
- `[CashuSendQuoteCache.Key, quoteId]` — individual resource
- `[allTransactionsQueryKey, accountId]` — filtered list

## Key Patterns

### Required Data → `useSuspenseQuery`

Data guaranteed non-undefined. Loading/error handled by boundaries. **Gotcha**: Multiple suspense queries in one component run serially — use `useSuspenseQueries` or prefetch in loader for parallel fetching.

### Select → always `useCallback`

Memoize `select` callbacks to prevent re-computation every render.

### useUser Select

`useUser((user) => user.id)` — components only re-render when selected field changes.

### Route Loaders

Use `ensureQueryData` for critical data (blocks rendering), `prefetchQuery` for nice-to-have data (non-blocking). Parallel `Promise.all` in `_protected.tsx` loader.

### Invalidate vs Direct Update

- **Direct update** (`setQueryData` via cache class) when you have the new data — avoids network round-trip
- **Invalidation** when server computes the result

### Mutation Callbacks — Two Levels

1. `useMutation({ onSuccess })` — always runs, survives unmount → put cache updates here
2. `mutate(vars, { onSuccess })` — only runs if mounted → put navigation/toasts here

### Retry Strategy

```typescript
retry: (failureCount, error) => {
  if (error instanceof DomainError) return false;      // Never retry
  if (error instanceof ConcurrencyError) return true;  // Always retry
  return failureCount < 1;                             // Network: once
},
```

## Dynamic Scope (Custom Patch)

**We patch `@tanstack/query-core`** (`patches/@tanstack%2Fquery-core@5.90.20.patch`) to support passing `scope` on individual `mutate()` / `mutateAsync()` calls. Stock TanStack Query only allows `scope` on `useMutation` options (static per-hook).

**Why**: Payment state machines need global serialization for creation (one quote at a time) but per-entity serialization for state transitions (complete/expire/fail). Without dynamic scope, "complete quote A" blocks "expire quote B."

```typescript
// Static scope on hook — all create calls serialized globally
useMutation({
  scope: { id: 'initiate-cashu-send-quote' },
  mutationFn: /* ... */,
});

// Dynamic scope at call site — per-entity serialization
markAsPending(sendQuote.id, {
  scope: { id: `cashu-send-quote-${sendQuote.id}` },
});
```

**How it works**: `MutationObserver.mutate()` merges `options.scope` into mutation options when building the mutation. A `#mutationScopeOverride` flag preserves the scope across React re-renders (which trigger `setOptions`).

**Upgrade warning**: When upgrading `@tanstack/query-core`, this patch must be reapplied.

## Anti-Patterns

| Don't | Do Instead |
|-------|-----------|
| `useEffect` for data fetching | `useQuery` / `useSuspenseQuery` |
| `onSuccess`/`onError` on `useQuery` | Removed in v5. Use mutation callbacks or `useEffect` on query state |
| Cache update without version check | Always compare `version` field |
| `new AccountsCache(queryClient)` in render | `useAccountsCache()` hook (useMemo) |
| `invalidateQueries` when you have the data | Direct cache update via cache class |
| Unmemoized `select` callback | Wrap in `useCallback` |
| Copy query data to `useState` | Use query data directly, transform with `select` |
| Missing variables in query key | Include ALL `queryFn` dependencies in key |
