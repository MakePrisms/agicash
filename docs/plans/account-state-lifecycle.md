# Account State Lifecycle Spec

## Summary

Add a `state` column to `wallet.accounts` supporting the lifecycle `active -> expired`. This enables automatic expiry of offer accounts when their keyset's `expires_at` passes, prevents expired accounts from blocking creation of future accounts at the same mint, and a uniqueness constraint scoped only to active accounts.

## Design Decisions

### 1. Expiry-only for v1

`expired` is the terminal state. Expired accounts are hidden from the active UI immediately. No `deleted` state in this migration. Future iterations may add delete functionality, an "expired cards" list, or notifications for approaching expiry -- but those are out of scope for this PR.

### 2. Where to filter `expired` accounts

**Decision: Repository query layer.**

Add `.eq('state', 'active')` to the Supabase query in `AccountRepository.getAll()` so expired accounts never reach the client.

**Why not RLS?** All DB functions (`get_account_with_proofs`, `create_cashu_send_quote`, etc.) are `security invoker`, so they execute with the calling user's RLS context. A restrictive RLS policy hiding expired accounts would break any in-flight quote or swap operation whose account expires mid-transaction. The DB functions need to see expired accounts to complete already-started operations.

### 3. Auto-expiry mechanism

**Decision: pg_cron background job only (every minute).**

A single pg_cron job runs every minute (`'* * * * *'`) and transitions any account with `state = 'active'` and `expires_at <= now()` to `expired`. The existing `broadcast_accounts_changes_trigger` fires realtime events automatically when the cron updates state, so connected clients receive updates without additional plumbing.

No eager expiry in `upsert_user_with_accounts` — the 1-minute cron granularity is sufficient for the UX. At most, a user sees a stale active account for up to 60 seconds before the next cron run corrects it.

**Graceful error handling:** There's a race window of up to 60 seconds where a keyset has expired at the mint but the cron job hasn't marked the account expired yet. If a user initiates an operation during this window, the mint rejects with `KEYSET_INACTIVE` (12002), already defined in `error-codes.ts`. The fix is a single targeted catch in the service layer: when catching `MintOperationError` with code 12002, check `account.purpose === 'offer'` and throw `DomainError("This offer has expired")`. Non-offer accounts fall through to existing generic error handling. No pre-operation checks, no `expires_at` comparisons, no new utilities.

The affected code paths:
- **Lightning send (melt):** `cashu-send-quote-service.ts` → `initiateSend()` → `wallet.meltProofsBolt11()` → mint returns 12002
- **Cashu token send (swap):** `cashu-send-swap-service.ts` → `swapForProofsToSend()` → `mint.swap()` → mint returns 12002
- **Receive swap:** `cashu-receive-swap-service.ts` → `completeSwap()` → `mint.swap()` → mint returns 12002

There's also a client-side variant where cashu-ts throws `Error("No active keyset found")` before hitting the mint, but this is rarer and existing generic error handling covers it. The realtime `ACCOUNT_UPDATED` event from the cron job handles cache updates — no explicit invalidation needed.

### 4. Transitions are one-way

Valid: `active -> expired`. No reactivation. An expired offer account's keyset has expired at the Cashu protocol level -- reactivating it would be misleading. New ecash at the same mint creates a new `active` account (the updated unique index allows this).

Enforced by construction: the pg_cron job's WHERE clause only matches `state = 'active'`, so no invalid transitions are possible.

## DB Migration

**File:** `supabase/migrations/20260325120000_add_account_state.sql`

### New enum + column

```sql
create type "wallet"."account_state" as enum ('active', 'expired');

alter table "wallet"."accounts"
  add column "state" "wallet"."account_state" not null default 'active';
```

### Index changes

```sql
drop index "wallet"."cashu_accounts_user_currency_mint_url_unique";

create unique index "cashu_accounts_active_user_currency_mint_url_unique"
  on "wallet"."accounts" using btree (
    "user_id",
    "currency",
    (("details" ->> 'mint_url'::text))
  )
  where ("type" = 'cashu' and "state" = 'active');

-- Supporting index for the cron job (index on the cast expression so Postgres can use it)
create index "idx_accounts_active_expires_at"
  on "wallet"."accounts" using btree ((("details" ->> 'expires_at')::timestamptz))
  where ("state" = 'active' and ("details" ->> 'expires_at') is not null);

-- General state index for queries filtering by state
create index idx_accounts_state on wallet.accounts(state);
```

### enforce_accounts_limit — count only active

Update `enforce_accounts_limit` in this migration to count only `state = 'active'` accounts toward the 200-account quota. Expired accounts should not block users from creating new accounts at the same mint.

### pg_cron job for auto-expiry (every minute)

```sql
select cron.schedule('expire-offer-accounts', '* * * * *', $$
  update wallet.accounts
  set
    state = 'expired',
    version = version + 1
  where
    state = 'active'
    and (details ->> 'expires_at') is not null
    and (details ->> 'expires_at')::timestamptz <= now();
$$);
```

The existing `broadcast_accounts_changes_trigger` fires automatically on these updates, pushing realtime events to connected clients.

## App Code Changes

### `account.ts` -- Add state to type

```typescript
export type AccountState = 'active' | 'expired';

// Add to Account base type:
state: AccountState;
```

### `account-repository.ts` -- Map state and filter expired

Map `state` in `toAccount()` commonData.

- `getAll()` adds `.eq('state', 'active')` to the Supabase query, so expired accounts are excluded at the repository level and never reach the client.
- `get(id)` does NOT filter by state -- individual account lookups (used by DB functions returning account data) still work for expired accounts if needed by in-flight operations.

### `account-hooks.ts` -- Realtime handling

- Update `ACCOUNT_UPDATED` handler: expired accounts trigger a cache update (state changes from `active` to `expired`), and `useOfferCards()` re-renders to exclude them.

### `gift-cards.tsx` -- Simplify filter

`useOfferCards()` no longer needs to filter by `state === 'active'` since `getAll()` already excludes expired accounts at the query level. It becomes a simple query for `purpose: 'offer'` accounts:

```typescript
function useOfferCards() {
  const { data: offerAccounts } = useAccounts({
    purpose: 'offer',
  });
  return offerAccounts;
}
```

Remove the old client-side `expires_at` Date check -- it is redundant now that the cron job sets `state = 'expired'` and `getAll()` filters by `state = 'active'`.

### Files requiring no changes

- `account-service.ts` -- New accounts default to `active` via DB column default
- `offer-details.tsx` -- Already handles missing offer gracefully
- `all-accounts.tsx` -- Filters by `purpose: 'transactional'`, unaffected
- All DB quote functions -- Operate on specific account IDs, no state awareness needed
- `to_account_with_proofs` -- Uses `select *`, state included automatically

## Data Flow

### active -> expired (pg_cron, every minute)

```
pg_cron (every minute) -> UPDATE state='expired', version+1
  -> broadcast_accounts_changes_trigger fires automatically
  -> realtime ACCOUNT_UPDATED to connected clients
  -> accountCache.update(account) [version higher, accepted]
  -> useOfferCards() re-renders, getAll() already excludes expired
```

### Expired keyset error handling (race condition)

```
User initiates send/receive on offer account during <=60s race window
  -> Mint rejects with KEYSET_INACTIVE (12002)
  -> Service layer catches MintOperationError, checks account.purpose === 'offer'
  -> Throws DomainError("This offer has expired") -> toast shown to user
  -> (Non-offer accounts: 12002 falls through to generic error handling)
  -> Realtime ACCOUNT_UPDATED event from cron updates cache
  -> useOfferCards() re-renders, expired account excluded
```

### New offer after prior expiry

```
User receives new offer token for same mint
  -> INSERT (state defaults to 'active')
  -> unique index only covers WHERE state='active'
  -> no conflict with expired account
  -> new active account created
```

## Implementation Phases

### Phase 1: DB Migration
- [ ] Write migration file
- [ ] Ask user to apply
- [ ] Run `bun run db:generate-types`

### Phase 2: Types and Repository
- [ ] Add `AccountState` type and `state` field to `account.ts`
- [ ] Map `data.state` in `AccountRepository.toAccount()`
- [ ] Add `.eq('state', 'active')` to `getAll()` query (leave `get(id)` unfiltered)
- [ ] Run `bun run fix:all`

### Phase 3: UI + Error Handling
- [ ] Remove client-side `expires_at` Date check in `gift-cards.tsx`
- [ ] Simplify `useOfferCards()` — no `select` filter needed, `getAll()` handles it
- [ ] Add 12002 catch in `cashu-send-quote-service.ts`, `cashu-send-swap-service.ts`, `cashu-receive-swap-service.ts` — offer accounts get `DomainError("This offer has expired")`, non-offer fall through
- [ ] Run `bun run fix:all`

## Prerequisites

- **PR #959 (offer mints) — MERGED.** The prerequisite for this migration has landed.

## Open Questions

- **Expired balance recovery**: Proofs may still be swappable depending on mint's keyset expiry enforcement. Separate feature.
- **Offer re-use on receive**: When a user receives a new offer token for a mint that already has an `active` offer account, existing behavior routes proofs to the existing account. Unchanged by this migration.
- **Future enhancements**: Notifications for approaching expiry, an "expired cards" list in the UI, or user-initiated delete — all deferred to future PRs.
