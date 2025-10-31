-- Migration: Allow Single Currency Accounts
-- 
-- Purpose:
--   Remove the requirement that users must have both USD and BTC accounts.
--   This allows users to be created with only a single account (e.g., just a BTC Spark account).
--
-- Affected Objects:
--   - wallet.users (table - new constraint)
--   - wallet.upsert_user_with_accounts (function)
--
-- Changes:
--   1. Added CHECK constraint to ensure default_currency always has corresponding account ID
--   2. Removed validation requiring at least one USD account in upsert function
--   3. Removed validation requiring at least one BTC account in upsert function
--   4. Kept validation that at least one account must be provided (not empty array)
--   5. default_usd_account_id and default_btc_account_id remain nullable in the database
--
-- Special Considerations:
--   - Existing users with both USD and BTC accounts are not affected
--   - The CHECK constraint enforces data integrity at database level
--   - Users can still have multiple accounts of different currencies
--   - Cannot set default_currency without having the corresponding default account ID

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

DROP FUNCTION IF EXISTS wallet.upsert_user_with_accounts(uuid, text, boolean, jsonb[], text, text, text);

CREATE OR REPLACE FUNCTION wallet.upsert_user_with_accounts(p_user_id uuid, p_email text, p_email_verified boolean, p_accounts jsonb[], p_cashu_locking_xpub text, p_encryption_public_key text, p_spark_public_key text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$declare
  result_user jsonb;
  existing_accounts jsonb;
  acct jsonb;
  new_acc wallet.accounts%ROWTYPE;
  added_accounts jsonb := '[]'::jsonb;
  usd_account_id uuid := null;
  btc_account_id uuid := null;
begin
  -- Upsert user
  -- Set default_currency to NULL initially to avoid constraint violation before accounts are created
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub, encryption_public_key, spark_public_key, default_currency)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub, p_encryption_public_key, p_spark_public_key, NULL)
  on conflict (id) do update set
    email = coalesce(EXCLUDED.email, wallet.users.email),
    email_verified = EXCLUDED.email_verified;

  -- Select and lock the user row
  select jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'email', u.email,
    'email_verified', u.email_verified,
    'default_usd_account_id', u.default_usd_account_id,
    'default_btc_account_id', u.default_btc_account_id,
    'default_currency', u.default_currency,
    'cashu_locking_xpub', u.cashu_locking_xpub,
    'encryption_public_key', u.encryption_public_key,
    'spark_public_key', u.spark_public_key,
    'created_at', u.created_at,
    'updated_at', u.updated_at
  ) into result_user
  from wallet.users u
  where u.id = p_user_id
  for update;

  -- Select existing accounts
  select jsonb_agg(jsonb_build_object(
    'id', a.id,
    'type', a.type,
    'currency', a.currency,
    'name', a.name,
    'details', a.details,
    'created_at', a.created_at,
    'version', a.version
  )) into existing_accounts
  from wallet.accounts a
  where a.user_id = p_user_id;

  -- If user already has accounts, return user with accounts
  if jsonb_array_length(coalesce(existing_accounts, '[]'::jsonb)) > 0 then    
    result_user := jsonb_set(result_user, '{accounts}', existing_accounts);
    return result_user;
  end if;

  -- Validate accounts to insert
  if array_length(p_accounts, 1) is null then
    raise exception 'p_accounts cannot be empty array';
  end if;

  -- Insert accounts
  foreach acct in array p_accounts loop
    insert into wallet.accounts (user_id, type, currency, name, details)
    values (
      p_user_id,
      acct->>'type',
      acct->>'currency',
      acct->>'name',
      acct->'details'
    )
    returning * into new_acc;

    -- Append to added accounts list
    added_accounts := added_accounts || jsonb_build_object(
      'id', new_acc.id,
      'user_id', new_acc.user_id,
      'type', new_acc.type,
      'currency', new_acc.currency,
      'name', new_acc.name,
      'details', new_acc.details,
      'version', new_acc.version,
      'created_at', new_acc.created_at
    );

    -- Set default account IDs
    if new_acc.currency = 'USD' then
      usd_account_id := new_acc.id;
    elsif new_acc.currency = 'BTC' then
      btc_account_id := new_acc.id;
    end if;
  end loop;

  -- Update user with default account IDs and default currency (keeping existing values)
  -- Set default_currency to BTC if BTC account exists, otherwise USD
  -- If user already has a default_currency set (existing user), keep it
  update wallet.users u
  set 
    default_usd_account_id = coalesce(usd_account_id, u.default_usd_account_id),
    default_btc_account_id = coalesce(btc_account_id, u.default_btc_account_id),
    default_currency = coalesce(
      u.default_currency,
      case 
        when btc_account_id is not null then 'BTC'
        when usd_account_id is not null then 'USD'
        else u.default_currency
      end
    )
  where id = p_user_id
  returning jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'email', u.email,
    'email_verified', u.email_verified,
    'default_usd_account_id', u.default_usd_account_id,
    'default_btc_account_id', u.default_btc_account_id,
    'default_currency', u.default_currency,
    'cashu_locking_xpub', u.cashu_locking_xpub,
    'encryption_public_key', u.encryption_public_key,
    'spark_public_key', u.spark_public_key,
    'created_at', u.created_at,
    'updated_at', u.updated_at,
    'accounts', added_accounts
  ) into result_user;

  return result_user;

end;$function$
;

