-- Migration: Add Account Purpose Column
-- 
-- Purpose:
--   1. Add 'purpose' column to accounts table to distinguish account types
--   2. Update account_input composite type to include purpose
--   3. Update upsert_user_with_accounts function to handle purpose
--
-- Affected Objects:
--   - wallet.accounts (table - new column)
--   - wallet.account_input (composite type - new field)
--   - wallet.upsert_user_with_accounts (function)
--
-- Changes:
--   1. Added purpose column with values: 'transactional' (default) or 'gift-card'
--   2. Modified account_input type to include purpose field
--   3. Modified upsert function to insert purpose when creating accounts
--
-- Special Considerations:
--   - Existing accounts default to 'transactional' purpose
--   - The purpose distinguishes regular accounts from closed-loop gift card accounts

-- Add purpose column to accounts table with default value for existing rows
alter table wallet.accounts 
  add column purpose text not null default 'transactional';

-- Add check constraint to validate purpose values
alter table wallet.accounts 
  add constraint accounts_purpose_check 
  check (purpose in ('transactional', 'gift-card'));

-- Recreate account_input type with purpose field
-- Must drop and recreate since ALTER TYPE doesn't support adding fields to composite types
drop type if exists wallet.account_input cascade;
create type wallet.account_input as (
  "type" text,
  "currency" text,
  "name" text,
  "details" jsonb,
  "is_default" boolean,
  "purpose" text
);

-- Drop old function signature before recreating
drop function if exists wallet.upsert_user_with_accounts(uuid, text, boolean, wallet.account_input[], text, text, text);

-- Recreate upsert_user_with_accounts function with purpose support
create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid, 
  p_email text, 
  p_email_verified boolean, 
  p_accounts wallet.account_input[], 
  p_cashu_locking_xpub text, 
  p_encryption_public_key text,
  p_spark_identity_public_key text
)
returns wallet.upsert_user_with_accounts_result
language plpgsql
as $function$
declare
  result_user wallet.users;
  result_accounts jsonb[];
  usd_account_id uuid := null;
  btc_account_id uuid := null;
  placeholder_btc_account_id uuid := gen_random_uuid();
begin
  -- Insert user with placeholder default_btc_account_id. The FK constraint is deferred,
  -- so it won't be checked until transaction commit. We'll update it with the real
  -- account ID after creating accounts.
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub, encryption_public_key, spark_identity_public_key, default_currency, default_btc_account_id)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub, p_encryption_public_key, p_spark_identity_public_key, 'BTC', placeholder_btc_account_id)
  on conflict (id) do update set
    email = coalesce(excluded.email, wallet.users.email),
    email_verified = excluded.email_verified;

  select *
  into result_user
  from wallet.users u
  where u.id = p_user_id
  for update;

  with accounts_with_proofs as (
    select 
      a.*,
      coalesce(
        jsonb_agg(to_jsonb(cp)) filter (where cp.id is not null),
        '[]'::jsonb
      ) as cashu_proofs
    from
      wallet.accounts a
      left join wallet.cashu_proofs cp on cp.account_id = a.id and cp.state = 'UNSPENT'
    where a.user_id = p_user_id
    group by a.id
  )
  select array_agg(
    jsonb_set(
      to_jsonb(awp),
      '{cashu_proofs}',
      awp.cashu_proofs
    )
  )
  into result_accounts
  from accounts_with_proofs awp;

  if result_accounts is not null then
    return (result_user, result_accounts);
  end if;

  if array_length(p_accounts, 1) is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_accounts cannot be an empty array';
  end if;

  if not exists (select 1 from unnest(p_accounts) as acct where acct.currency = 'BTC' and acct.type = 'spark') then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'At least one BTC Spark account is required';
  end if;

  with
    inserted_accounts as (
      insert into wallet.accounts (user_id, type, currency, name, details, purpose)
      select 
        p_user_id,
        acct.type,
        acct.currency,
        acct.name,
        acct.details,
        acct.purpose
      from unnest(p_accounts) as acct
      returning *
    ),
    accounts_with_default_flag as (
      select 
        ia.*,
        coalesce(acct."is_default", false) as "is_default"
      from
        inserted_accounts ia
        join unnest(p_accounts) as acct on 
          ia.type = acct.type and 
          ia.currency = acct.currency and 
          ia.name = acct.name and 
          ia.details = acct.details
    )
  select 
    array_agg(
      jsonb_set(
        to_jsonb(awd),
        '{cashu_proofs}',
        '[]'::jsonb
      )
    ),
    (array_agg(awd.id) filter (where awd.currency = 'USD' and awd."is_default"))[1],
    (array_agg(awd.id) filter (where awd.currency = 'BTC' and awd."is_default"))[1]
  into result_accounts, usd_account_id, btc_account_id
  from accounts_with_default_flag awd;

  update wallet.users u
  set 
    default_usd_account_id = coalesce(usd_account_id, u.default_usd_account_id),
    default_btc_account_id = coalesce(btc_account_id, u.default_btc_account_id),
    default_currency = case
      when btc_account_id is not null then 'BTC'
      when usd_account_id is not null then 'USD'
      else u.default_currency
    end
  where id = p_user_id
  returning * into result_user;

  return (result_user, result_accounts);
end;
$function$;
