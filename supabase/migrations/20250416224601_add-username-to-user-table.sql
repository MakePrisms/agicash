alter table "wallet"."users" add column "username" text not null;

CREATE UNIQUE INDEX users_username_key ON wallet.users USING btree (username);

-- This constraint comes from lud16 https://github.com/lnurl/luds/blob/luds/16.md
alter table "wallet"."users" add constraint "users_username_format" CHECK ((username ~ '^[a-z0-9_-]+$'::text)) not valid;

alter table "wallet"."users" validate constraint "users_username_format";

alter table "wallet"."users" add constraint "users_username_key" UNIQUE using index "users_username_key";

alter table "wallet"."users" add constraint "users_username_length" CHECK (((length(username) >= 3) AND (length(username) <= 20))) not valid;

alter table "wallet"."users" validate constraint "users_username_length";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION wallet.set_default_username()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$BEGIN
    -- Set the username field to "user-" concatenated with the last 12 characters of the id
    NEW.username := 'user-' || RIGHT(NEW.id::text, 12);
    
    RETURN NEW;
END;$function$
;

CREATE TRIGGER set_default_username_trigger BEFORE INSERT ON wallet.users FOR EACH ROW EXECUTE FUNCTION wallet.set_default_username();

CREATE OR REPLACE FUNCTION wallet.upsert_user_with_accounts(p_user_id uuid, p_email text, p_email_verified boolean, p_accounts jsonb[])
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
  insert into wallet.users (id, email, email_verified)
  values (p_user_id, p_email, p_email_verified)
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

  if not jsonb_path_exists(array_to_json(p_accounts)::jsonb, '$[*] ? (@.currency == "USD")') then
    raise exception 'At least one USD account is required';
  end if;

  if not jsonb_path_exists(array_to_json(p_accounts)::jsonb, '$[*] ? (@.currency == "BTC")') then
    raise exception 'At least one BTC account is required';
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

  -- Update user with default account IDs (keeping existing values)
  update wallet.users u
  set 
    default_usd_account_id = coalesce(usd_account_id, u.default_usd_account_id),
    default_btc_account_id = coalesce(btc_account_id, u.default_btc_account_id)
  where id = p_user_id
  returning jsonb_build_object(
    'id', u.id,
    'username', u.username,
    'email', u.email,
    'email_verified', u.email_verified,
    'default_usd_account_id', u.default_usd_account_id,
    'default_btc_account_id', u.default_btc_account_id,
    'default_currency', u.default_currency,
    'created_at', u.created_at,
    'updated_at', u.updated_at,
    'accounts', added_accounts
  ) into result_user;

  return result_user;

end;$function$
;



