-- Account state lifecycle: active -> expired
-- Adds state column, updates indexes, creates pg_cron expiry job

-- New enum
create type "wallet"."account_state" as enum ('active', 'expired');

-- Add state column (defaults to 'active', all existing rows become active)
alter table "wallet"."accounts"
  add column "state" "wallet"."account_state" not null default 'active';

-- Replace uniqueness constraint: scope to active accounts only
drop index "wallet"."cashu_accounts_user_currency_mint_url_unique";

create unique index "cashu_accounts_active_user_currency_mint_url_unique"
  on "wallet"."accounts" using btree (
    "user_id",
    "currency",
    (("details" ->> 'mint_url'::text))
  )
  where ("type" = 'cashu' and "state" = 'active');

-- Index for the cron job: find active accounts with passed expiry
create index "idx_accounts_active_expires_at"
  on "wallet"."accounts" using btree ("expires_at")
  where ("state" = 'active' and "expires_at" is not null);

-- General state index for repository queries filtering by state
create index "idx_accounts_state" on "wallet"."accounts" ("state");

-- Update enforce_accounts_limit to count only active accounts
create or replace function "wallet"."enforce_accounts_limit"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account_count integer;
begin
  select count(*) into v_account_count
  from wallet.accounts
  where user_id = new.user_id
    and state = 'active';

  if v_account_count >= 200 then
    raise exception
      using
        hint = 'LIMIT_REACHED',
        message = 'Maximum number of accounts limit reached.',
        detail = format('Accounts count: %s, limit: 200.', v_account_count);
  end if;

  return new;
end;
$function$;

-- pg_cron job: expire accounts every minute
select cron.schedule('expire-offer-accounts', '* * * * *', $$
  update wallet.accounts
  set
    state = 'expired',
    version = version + 1
  where
    state = 'active'
    and expires_at is not null
    and expires_at <= now();
$$);
