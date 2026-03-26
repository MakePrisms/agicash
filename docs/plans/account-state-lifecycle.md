# Account State Lifecycle Spec

## Summary

Add a `state` column to `wallet.accounts` supporting the lifecycle `active -> expired -> deleted` (soft delete). This enables automatic expiry of offer accounts when their keyset's `expires_at` passes, soft delete so expired/deleted accounts don't block creation of future accounts at the same mint, and a uniqueness constraint scoped only to active accounts.

## Design Decisions

### 1. Where to filter `deleted` accounts

**Decision: RLS (restrictive SELECT policy).**

A restrictive RLS policy makes `deleted` accounts invisible for SELECT. Every caller -- `getAll()`, `get()`, realtime subscriptions -- automatically excludes deleted rows without any app-layer change. The `enforce_accounts_limit` trigger must also be updated to exclude `deleted` accounts from its count.

### 2. Where to filter `expired` accounts

**Decision: App layer.**

Expired accounts remain visible in `getAll()` -- the RLS policy does not hide them. The existing `useActiveOffers()` filter in `gift-cards.tsx` is simplified from the `expiresAt > now()` check to `account.state === 'active'`.

### 3. Auto-expiry mechanism

**Decision: pg_cron, hourly.**

A cron job updates `state = 'expired'` for accounts where `state = 'active'` and `expires_at <= now()`. This UPDATE fires `broadcast_accounts_changes_trigger`, emitting `ACCOUNT_UPDATED` to connected clients.

pg_cron is already installed and used for 8 daily cleanup jobs. No new infrastructure needed. Hourly frequency because expiry visibility matters within an hour. The client-side filter hides visually expired offers immediately; the DB catches up within an hour.

### 4. Soft delete

**Decision: Client-initiated app-layer mutation.**

A new `wallet.soft_delete_account(p_account_id uuid)` DB function sets `state = 'deleted'` and bumps `version`. The `ACCOUNT_UPDATED` realtime event fires; the client removes the account from the cache.

### 5. Transitions are one-way

Valid: `active -> expired`, `active -> deleted`, `expired -> deleted`. No reactivation. An expired offer account's keyset has expired at the Cashu protocol level -- reactivating it would be misleading. New ecash at the same mint creates a new `active` account (the updated unique index allows this).

Enforced by a BEFORE UPDATE trigger at the DB level.

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

### State transition enforcement trigger

```sql
create or replace function "wallet"."enforce_account_state_transition"()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.state = 'deleted' then
    raise exception
      using
        hint = 'INVALID_TRANSITION',
        message = 'Cannot transition out of deleted state.';
  end if;

  if old.state = 'expired' and new.state not in ('expired', 'deleted') then
    raise exception
      using
        hint = 'INVALID_TRANSITION',
        message = format('Invalid account state transition: %s -> %s', old.state, new.state);
  end if;

  return new;
end;
$function$;

create trigger "enforce_account_state_transition"
  before update of state on "wallet"."accounts"
  for each row
  when (old.state is distinct from new.state)
  execute function "wallet"."enforce_account_state_transition"();
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

### enforce_accounts_limit (deferred)

The current trigger counts all accounts regardless of state. Deleted accounts will count toward the 200-account quota. Changing this limit is a separate discussion — the limit exists for a reason and adjusting what counts toward it has implications beyond this feature. For now, soft-deleted accounts are rare (only offer accounts) and won't meaningfully impact the quota.

### Soft delete DB function

```sql
create or replace function "wallet"."soft_delete_account"(p_account_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  update wallet.accounts
  set state = 'deleted', version = version + 1
  where id = p_account_id;

  if not found then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Account with id %s not found.', p_account_id);
  end if;
end;
$function$;
```

### pg_cron job for auto-expiry

```sql
select cron.schedule('expire-offer-accounts', '0 * * * *', $$
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

## App Code Changes

### `account.ts` -- Add state to type

```typescript
export type AccountState = 'active' | 'expired' | 'deleted';

// Add to Account base type:
state: AccountState;
```

### `account-repository.ts` -- Map state, add delete

Map `state` in `toAccount()` commonData. Add `deleteAccount(id)` calling `soft_delete_account` RPC.

### `account-hooks.ts` -- Cache removal + realtime handling

- Add `AccountsCache.remove(id)` method
- Update `ACCOUNT_UPDATED` handler: if `payload.state === 'deleted'`, call `remove` instead of `update`
- Add `useDeleteAccount` hook

### `gift-cards.tsx` -- Simplify filter

```typescript
function useActiveOffers() {
  const { data: offerAccounts } = useAccounts({ purpose: 'offer' });
  return offerAccounts.filter((account) => account.state === 'active');
}
```

### Files requiring no changes

- `account-service.ts` -- New accounts default to `active` via DB column default
- `offer-details.tsx` -- Already handles missing offer gracefully
- `all-accounts.tsx` -- Filters by `purpose: 'transactional'`, unaffected
- All DB quote functions -- Operate on specific account IDs, no state awareness needed
- `to_account_with_proofs` -- Uses `select *`, state included automatically

## Data Flow

### active -> expired (automatic, hourly)

```
pg_cron -> UPDATE state='expired', version+1
  -> broadcast_accounts_changes_trigger fires
  -> realtime ACCOUNT_UPDATED to client
  -> accountCache.update(account) [version higher, accepted]
  -> useActiveOffers() re-renders, filtered by state === 'active'
```

### active/expired -> deleted (user-initiated)

```
useDeleteAccount()(accountId)
  -> db.rpc('soft_delete_account', { p_account_id: id })
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

## Open Questions

- **Delete UI placement**: The hook is specced; UX (which screen, what confirmation) is a separate decision.
- **Expired balance recovery**: Proofs may still be swappable depending on mint's keyset expiry enforcement. Separate feature.
- **Offer re-use on receive**: When a user receives a new offer token for a mint that already has an `active` offer account, existing behavior routes proofs to the existing account. Unchanged by this migration.
