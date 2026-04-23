-- add gift_card_mint_terms_accepted_at to wallet.users and enforce it on account creation
--
-- purpose: require users to accept gift-card-mint-specific terms of service before
-- creating gift-card or offer accounts. the column tracks when terms were accepted, and
-- a trigger on wallet.accounts refuses inserts for those purposes when null.
--
-- affected tables: wallet.users (new column), wallet.accounts (new trigger)
-- affected functions: wallet.upsert_user_with_accounts (new parameter)

-- add the column to track when a user accepted gift-card-mint terms
alter table wallet.users add column gift_card_mint_terms_accepted_at timestamptz;

-- trigger function: refuse gift-card/offer account creation if gift-card-mint terms not accepted.
-- runs as security invoker; relies on the wallet.users RLS policy that allows the owner
-- (auth.uid() = id) to select their own row, since account inserts are always scoped to
-- the caller's user_id by RLS on wallet.accounts.
create or replace function wallet.enforce_gift_card_mint_terms_on_account_create()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.purpose in ('offer', 'gift-card') then
    if not exists (
      select 1 from wallet.users
      where id = new.user_id
      and gift_card_mint_terms_accepted_at is not null
    ) then
      raise exception 'gift-card mint terms must be accepted before creating % accounts', new.purpose;
    end if;
  end if;
  return new;
end;
$$;

create trigger check_gift_card_mint_terms_before_account_create
  before insert on wallet.accounts
  for each row execute function wallet.enforce_gift_card_mint_terms_on_account_create();

-- drop the old function signature (without p_gift_card_mint_terms_accepted_at parameter)
-- so postgres doesn't keep two overloads with different arities
drop function if exists wallet.upsert_user_with_accounts(uuid, text, boolean, wallet.account_input[], text, text, text, timestamp with time zone);

-- recreate with the new p_gift_card_mint_terms_accepted_at parameter
create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid,
  p_email text,
  p_email_verified boolean,
  p_accounts wallet.account_input[],
  p_cashu_locking_xpub text,
  p_encryption_public_key text,
  p_spark_identity_public_key text,
  p_terms_accepted_at timestamp with time zone default null,
  p_gift_card_mint_terms_accepted_at timestamp with time zone default null
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
  -- insert user with placeholder default_btc_account_id. the fk constraint is deferred,
  -- so it won't be checked until transaction commit. we'll update it with the real
  -- account id after creating accounts.
  -- note: terms_accepted_at will be null for login flows, set for signup flows
  insert into wallet.users (
    id,
    email,
    email_verified,
    cashu_locking_xpub,
    encryption_public_key,
    spark_identity_public_key,
    default_currency,
    default_btc_account_id,
    terms_accepted_at,
    gift_card_mint_terms_accepted_at
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
    p_terms_accepted_at,
    p_gift_card_mint_terms_accepted_at
  )
  on conflict (id) do update set
    email = coalesce(excluded.email, wallet.users.email),
    email_verified = excluded.email_verified;

  select *
  into result_user
  from wallet.users u
  where u.id = p_user_id
  for update;

  -- get existing accounts with their proofs if user already exists
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

  -- if user already has accounts, return early (existing user)
  if result_accounts is not null then
    return (result_user, result_accounts);
  end if;

  -- validate that accounts array is not empty for new users
  if array_length(p_accounts, 1) is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_accounts cannot be an empty array';
  end if;

  -- validate that at least one btc spark account is provided
  if not exists (select 1 from unnest(p_accounts) as acct where acct.currency = 'BTC' and acct.type = 'spark') then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'At least one BTC Spark account is required';
  end if;

  -- insert new accounts for the user
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

  -- update the user's default account ids after account creation
  update wallet.users
  set
    default_btc_account_id = btc_account_id,
    default_usd_account_id = usd_account_id
  where id = p_user_id
  returning * into result_user;

  return (result_user, result_accounts);
end;
$$;
