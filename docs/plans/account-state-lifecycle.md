# Account State Lifecycle Spec

## Summary

Add a `state` column to `wallet.accounts` supporting the lifecycle `active -> expired` (with `deleted` state under discussion). This enables automatic expiry of offer accounts when their keyset's `expires_at` passes, prevents expired accounts from blocking creation of future accounts at the same mint, and a uniqueness constraint scoped only to active accounts.

## Design Decisions

### 1. Where to filter `deleted` accounts — PENDING DECISION

> **Status:** Under discussion between gudnuf and josip. Two options are being considered:
>
> - **Option A: Ship expiry-only.** `expired` is a terminal state. Expired accounts are hidden immediately. No `deleted` state in this migration.
> - **Option B: Keep both states.** Show expired accounts briefly in the UI, then a second cron job moves `expired -> deleted` after N days, hiding them permanently.
>
> The design below retains `deleted` for completeness, but it may be scoped out of the initial migration.

**Proposed: RLS (restrictive SELECT policy).**

A restrictive RLS policy makes `deleted` accounts invisible for SELECT. Every caller -- `getAll()`, `get()`, realtime subscriptions -- automatically excludes deleted rows without any app-layer change.

### 2. Where to filter `expired` accounts

**Decision: App layer.**

Expired accounts remain visible in `getAll()` -- the RLS policy does not hide them. The existing `useActiveOffers()` filter in `gift-cards.tsx` is simplified from the `expiresAt > now()` check to `account.state === 'active'`.

### 3. Auto-expiry mechanism

**Decision: pg_cron background job only (every minute).**

A single pg_cron job runs every minute (`'* * * * *'`) and transitions any account with `state = 'active'` and `expires_at <= now()` to `expired`. The existing `broadcast_accounts_changes_trigger` fires realtime events automatically when the cron updates state, so connected clients receive updates without additional plumbing.

No eager expiry in `upsert_user_with_accounts` — the 1-minute cron granularity is sufficient for the UX. At most, a user sees a stale active account for up to 60 seconds before the next cron run corrects it.

**Graceful error handling:** If the client attempts to use an expired keyset and the mint rejects it, show the user "this offer has expired" and trigger a cache refresh to pull the updated account state.

### 4. Delete — PENDING DECISION

> **Status:** Depends on the outcome of decision #1 above. If Option A is chosen, this section is deferred. If Option B is chosen, the design below applies.

**Proposed: Client-initiated app-layer mutation.**

A new `wallet.delete_account(p_account_id uuid)` DB function sets `state = 'deleted'` and bumps `version`. The `ACCOUNT_UPDATED` realtime event fires; the client removes the account from the cache.

### 5. Transitions are one-way

Valid: `active -> expired`. If the `deleted` state is included: `active -> deleted`, `expired -> deleted`. No reactivation. An expired offer account's keyset has expired at the Cashu protocol level -- reactivating it would be misleading. New ecash at the same mint creates a new `active` account (the updated unique index allows this).

Enforced by construction: each DB function's WHERE clause only matches valid source states. No trigger needed — the pg_cron job only transitions `active → expired`, and `delete_account` (if included) only transitions `active/expired → deleted`.

### 6. Realtime handling for deleted accounts

The `ACCOUNT_UPDATED` handler must detect `state === 'deleted'` in the broadcast payload and call `accountCache.remove(id)` rather than `accountCache.update(account)`.

## DB Migration

**File:** `supabase/migrations/20260325120000_add_account_state.sql`

### New enum + column

```sql
create type "wallet"."account_state" as enum ('active', 'expired', 'deleted');

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

### RLS: hide deleted accounts

```sql
create policy "Exclude deleted accounts from select"
on "wallet"."accounts"
as restrictive
for select
to authenticated
using (state != 'deleted'::wallet.account_state);
```

### enforce_accounts_limit — count only active

Update `enforce_accounts_limit` in this migration to count only `state = 'active'` accounts toward the 200-account quota. Expired (and deleted, if included) accounts should not block users from creating new accounts at the same mint.

### Delete DB function — PENDING DECISION

> Included if the `deleted` state is kept (see decision #1).

```sql
create or replace function "wallet"."delete_account"(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update wallet.accounts
  set state = 'deleted', version = version + 1
  where id = p_account_id
    and state != 'deleted';

  if not found then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Account with id %s not found.', p_account_id);
  end if;
end;
$function$;
```

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
export type AccountState = 'active' | 'expired' | 'deleted';

// Add to Account base type:
state: AccountState;
```

### `account-repository.ts` -- Map state, add delete

Map `state` in `toAccount()` commonData. If the `deleted` state is included, add `deleteAccount(id)` calling `delete_account` RPC.

### `account-hooks.ts` -- Cache removal + realtime handling

- Add `AccountsCache.remove(id)` method
- Update `ACCOUNT_UPDATED` handler: if `payload.state === 'deleted'`, call `remove` instead of `update`
- Add `useDeleteAccount` hook

### `gift-cards.tsx` -- Simplify filter

Use the `useQuery` `select` option to filter at the query level rather than manual `.filter()`:

```typescript
function useActiveOffers() {
  const { data: offerAccounts } = useAccounts({
    purpose: 'offer',
    select: (accounts) => accounts.filter((a) => a.state === 'active'),
  });
  return offerAccounts;
}
```

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
  -> useActiveOffers() re-renders, select filters by state === 'active'
```

### Expired keyset error handling

```
Client tries to use account with expired keyset
  -> Mint rejects operation
  -> Show "this offer has expired"
  -> Trigger cache refresh to pull updated account state
```

### active/expired -> deleted (user-initiated) — PENDING DECISION

> Included if the `deleted` state is kept (see decision #1).

```
useDeleteAccount()(accountId)
  -> db.rpc('delete_account', { p_account_id: id })
  -> broadcast ACCOUNT_UPDATED with state='deleted'
  -> client: accountCache.remove(id)
  -> account gone from all UI
```

### New offer after prior expiry

```
User receives new offer token for same mint
  -> INSERT (state defaults to 'active')
  -> unique index only covers WHERE state='active'
  -> no conflict with expired/deleted account
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
- [ ] Add `AccountRepository.deleteAccount(id)` calling RPC
- [ ] Add `AccountsCache.remove(id)`
- [ ] Update `ACCOUNT_UPDATED` handler for deleted state
- [ ] Add `useDeleteAccount` hook
- [ ] Run `bun run fix:all`

### Phase 3: UI
- [ ] Update `useActiveOffers()` to filter by `state === 'active'`
- [ ] Run `bun run fix:all`

## Prerequisites

- **PR #959 (offer mints) — MERGED.** The prerequisite for this migration has landed.

## Open Questions

- **Delete state**: See decision #1 above. gudnuf and josip are still deciding whether to include `deleted` in this migration or ship expiry-only.
- **Delete UI placement**: If the `deleted` state is included, the hook is specced but UX (which screen, what confirmation) is a separate decision.
- **Expired balance recovery**: Proofs may still be swappable depending on mint's keyset expiry enforcement. Separate feature.
- **Offer re-use on receive**: When a user receives a new offer token for a mint that already has an `active` offer account, existing behavior routes proofs to the existing account. Unchanged by this migration.
