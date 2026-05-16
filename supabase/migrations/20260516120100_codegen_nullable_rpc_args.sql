-- Codegen convention: RPC args that are semantically nullable must carry
-- `DEFAULT NULL` so `pg_get_function_arguments()` exposes them to the
-- codegen tool. See `crates/agicash-storage-supabase-codegen/README.md`.
--
-- `wallet.upsert_user_with_accounts(p_email text, ...)` accepts NULL at the
-- wire (callers pass `p_email: user.email ?? null`) but the original
-- signature has no DEFAULT, so introspection couldn't tell the codegen the
-- arg is nullable. The corresponding TypeScript binding already types it as
-- `string | null` (`app/features/agicash-db/database.ts`).
--
-- The fix is purely signature-level: re-declare the function with
-- `DEFAULT NULL` on the nullable args. The body is preserved verbatim from
-- `20260415180000_add_gift_card_mint_terms.sql` — runtime behavior is
-- unchanged.

create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid,
  p_email text default null,
  p_email_verified boolean default false,
  p_accounts wallet.account_input[] default array[]::wallet.account_input[],
  p_cashu_locking_xpub text default null,
  p_encryption_public_key text default null,
  p_spark_identity_public_key text default null,
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
  -- body preserved verbatim from 20260415180000_add_gift_card_mint_terms.sql
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

  update wallet.users
  set
    default_btc_account_id = btc_account_id,
    default_usd_account_id = usd_account_id
  where id = p_user_id
  returning * into result_user;

  return (result_user, result_accounts);
end;
$$;
