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
--   3. Removed validation requiring at least one USD account in upsert function
--   4. Changed validation to require at least one BTC Spark account in upsert function
--   5. Kept validation that at least one account must be provided (not empty array)
--   6. default_usd_account_id remains nullable, default_btc_account_id must be set
--
-- Special Considerations:
--   - Existing users with both USD and BTC accounts are not affected
--   - The CHECK constraint enforces data integrity at database level
--   - Users can still have multiple accounts of different currencies
--   - Cannot set default_currency without having the corresponding default account ID
--   - BTC Spark account is required, USD account is optional

ALTER TABLE wallet.users ADD COLUMN spark_public_key text NOT NULL;

-- Allow default_currency to be NULL temporarily during user creation
-- It will be set to the appropriate value once accounts are created
ALTER TABLE wallet.users ALTER COLUMN default_currency DROP NOT NULL;

-- Add constraint to ensure default_currency always has a corresponding default account ID.
-- This prevents setting default_currency = 'BTC' without default_btc_account_id being set,
-- and prevents setting default_currency = 'USD' without default_usd_account_id being set.
-- This maintains referential integrity between default_currency and the account IDs.
-- Allows NULL default_currency (only used temporarily during user creation before accounts exist).
ALTER TABLE wallet.users ADD CONSTRAINT users_default_currency_has_account
CHECK (
  default_currency IS NULL OR
  (default_currency = 'BTC' AND default_btc_account_id IS NOT NULL) OR
  (default_currency = 'USD' AND default_usd_account_id IS NOT NULL)
);

-- Drop old function signatures (both the old jsonb[] version and the wallet.account_input[] version)
DROP FUNCTION IF EXISTS wallet.upsert_user_with_accounts(uuid, text, boolean, wallet.account_input[], text, text);

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
begin
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub, encryption_public_key, spark_public_key, default_currency)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub, p_encryption_public_key, p_spark_public_key, NULL)
  on conflict (id) do update set
    email = coalesce(excluded.email, wallet.users.email),
    email_verified = excluded.email_verified;

  select * into result_user
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
    from wallet.accounts a
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

  with inserted_accounts as (
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
    from inserted_accounts ia
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
