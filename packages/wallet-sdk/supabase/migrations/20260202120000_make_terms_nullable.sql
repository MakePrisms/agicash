-- Migration: Make terms_accepted_at nullable for TOS enforcement
--
-- Purpose: Allow new users to be created without TOS acceptance timestamp.
-- Users who haven't accepted terms (terms_accepted_at = NULL) will be
-- redirected to an accept-terms page before accessing protected routes.
--
-- Affected: wallet.users table, wallet.upsert_user_with_accounts function
--
-- Notes:
-- - Existing users retain their current terms_accepted_at values (grandfathered)
-- - New users created via login (not signup) will have NULL until they accept
-- - Signup flow passes the timestamp through session storage

-- Make terms_accepted_at nullable and remove default
-- This allows new users to be created without having accepted terms yet
alter table wallet.users
  alter column terms_accepted_at drop not null,
  alter column terms_accepted_at drop default;

-- Update comment to reflect new behavior
comment on column wallet.users.terms_accepted_at is
  'Timestamp when user accepted terms of service. NULL means user has not yet accepted terms and should be redirected to accept-terms page.';

-- Drop old function signature (without p_terms_accepted_at parameter)
drop function if exists wallet.upsert_user_with_accounts(uuid, text, boolean, wallet.account_input[], text, text, text);

-- Update the upsert function to accept terms_accepted_at parameter
-- This allows the signup flow to pass the acceptance timestamp when creating users
create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid,
  p_email text,
  p_email_verified boolean,
  p_accounts wallet.account_input[],
  p_cashu_locking_xpub text,
  p_encryption_public_key text,
  p_spark_identity_public_key text,
  p_terms_accepted_at timestamp with time zone default null
)
returns wallet.upsert_user_with_accounts_result
language plpgsql
security invoker
set search_path = ''
as $$
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
  -- Note: terms_accepted_at will be NULL for login flows, set for signup flows
  insert into wallet.users (
    id,
    email,
    email_verified,
    cashu_locking_xpub,
    encryption_public_key,
    spark_identity_public_key,
    default_currency,
    default_btc_account_id,
    terms_accepted_at
  )
  values (
    p_user_id,
    p_email,
    p_email_verified,
    p_cashu_locking_xpub,
    p_encryption_public_key,
    p_spark_identity_public_key,
    'BTC',
    placeholder_btc_account_id,
    p_terms_accepted_at
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, wallet.users.email),
    email_verified = excluded.email_verified;

  select *
  into result_user
  from wallet.users u
  where u.id = p_user_id
  for update;

  -- Get existing accounts with their proofs if user already exists
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

  -- If user already has accounts, return early (existing user)
  if result_accounts is not null then
    return (result_user, result_accounts);
  end if;

  -- Validate that accounts array is not empty for new users
  if array_length(p_accounts, 1) is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_accounts cannot be an empty array';
  end if;

  -- Validate that at least one BTC Spark account is provided
  if not exists (select 1 from unnest(p_accounts) as acct where acct.currency = 'BTC' and acct.type = 'spark') then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'At least one BTC Spark account is required';
  end if;

  -- Insert new accounts for the user
  with
    inserted_accounts as (
      insert into wallet.accounts (user_id, type, purpose, currency, name, details)
      select
        p_user_id,
        acct.type,
        acct.purpose,
        acct.currency,
        acct.name,
        acct.details
      from unnest(p_accounts) as acct
      returning *
    ),
    accounts_with_default_flag as (
      select
        ia.*,
        coalesce(acct.is_default, false) as is_default
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
    (select awd.id from accounts_with_default_flag awd where awd.currency = 'USD' and awd.is_default limit 1),
    (select awd.id from accounts_with_default_flag awd where awd.currency = 'BTC' and awd.is_default limit 1)
  into result_accounts, usd_account_id, btc_account_id
  from accounts_with_default_flag awd;

  -- Update the user's default account IDs after account creation
  update wallet.users
  set
    default_btc_account_id = btc_account_id,
    default_usd_account_id = usd_account_id
  where id = p_user_id
  returning * into result_user;

  return (result_user, result_accounts);
end;
$$;
