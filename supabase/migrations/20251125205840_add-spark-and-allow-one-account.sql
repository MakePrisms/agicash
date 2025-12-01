-- Migration: Allow Single Currency Accounts and Add Spark Public Key to user
-- 
-- Purpose:
--   1. Add spark_public_key column to users table
--   2. Remove the requirement that users must have both USD and BTC accounts
--   3. Require at least one BTC Spark account (USD accounts are now optional)
--   4. This allows users to be created with only a BTC Spark account
--
-- Affected Objects:
--   - wallet.users (table - new column, modified constraint)
--   - wallet.upsert_user_with_accounts (function)
--
-- Changes:
--   1. Added spark_public_key column to users table
--   2. Added CHECK constraint to ensure default_currency always has corresponding account ID
--   3. Made FK constraints on default_btc_account_id and default_usd_account_id DEFERRABLE
--   4. Removed validation requiring at least one USD account in upsert function
--   5. Changed validation to require at least one BTC Spark account in upsert function
--   6. Kept validation that at least one account must be provided (not empty array)
--
-- Special Considerations:
--   - Cannot set default_currency without having the corresponding default account ID
--   - BTC Spark account is required, USD account is optional
--   - Deferred FK constraints allow setting a placeholder UUID during user insert,
--     which is then updated with the real account ID before transaction commits

alter table wallet.users add column spark_public_key text not null;

-- Make FK constraints DEFERRABLE INITIALLY DEFERRED so we can insert user with a 
-- placeholder default_btc_account_id, then update it with the real account ID after 
-- accounts are created.
alter table wallet.users drop constraint users_default_btc_account_id_fkey;
alter table wallet.users add constraint users_default_btc_account_id_fkey 
  foreign key (default_btc_account_id) references wallet.accounts(id) 
  deferrable initially deferred;

alter table wallet.users drop constraint users_default_usd_account_id_fkey;
alter table wallet.users add constraint users_default_usd_account_id_fkey 
  foreign key (default_usd_account_id) references wallet.accounts(id) 
  deferrable initially deferred;

-- Add constraint to ensure default_currency always has a corresponding default account ID.
-- This prevents setting default_currency = 'BTC' without default_btc_account_id being set,
-- and prevents setting default_currency = 'USD' without default_usd_account_id being set.
-- This maintains referential integrity between default_currency and the account IDs.
alter table wallet.users add constraint users_default_currency_has_account
check (
  (default_currency = 'BTC' and default_btc_account_id is not null) or
  (default_currency = 'USD' and default_usd_account_id is not null)
);

-- Drop old function signatures (both the old jsonb[] version and the wallet.account_input[] version)
drop function if exists wallet.upsert_user_with_accounts(uuid, text, boolean, wallet.account_input[], text, text);

-- Update upsert_user_with_accounts function to return structured result with accounts including proofs
create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid, 
  p_email text, 
  p_email_verified boolean, 
  p_accounts wallet.account_input[], 
  p_cashu_locking_xpub text, 
  p_encryption_public_key text,
  p_spark_public_key text
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
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub, encryption_public_key, spark_public_key, default_currency, default_btc_account_id)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub, p_encryption_public_key, p_spark_public_key, 'BTC', placeholder_btc_account_id)
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
      insert into wallet.accounts (user_id, type, currency, name, details)
      select 
        p_user_id,
        acct.type,
        acct.currency,
        acct.name,
        acct.details
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
