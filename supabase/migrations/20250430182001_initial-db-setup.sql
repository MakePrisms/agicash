set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.set_updated_at_if_updated()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Check if any column value has changed
    IF (NEW IS DISTINCT FROM OLD) THEN
        NEW.updated_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$function$
;


create schema if not exists "wallet";

-- Manually added start. Based on https://supabase.com/docs/guides/api/using-custom-schemas
GRANT USAGE ON SCHEMA wallet TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA wallet TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES IN SCHEMA wallet TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA wallet TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA wallet GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA wallet GRANT ALL ON ROUTINES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA wallet GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
-- Manually added end

create table "wallet"."accounts" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "user_id" uuid not null,
    "name" text not null,
    "type" text not null,
    "currency" text not null,
    "details" jsonb not null,
    "version" integer not null default 0
);


alter table "wallet"."accounts" enable row level security;

create table "wallet"."cashu_receive_quotes" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "quote_id" text not null,
    "account_id" uuid not null,
    "user_id" uuid not null,
    "amount" numeric not null,
    "unit" text not null,
    "description" text,
    "expires_at" timestamp with time zone not null,
    "state" text not null,
    "payment_request" text not null,
    "currency" text not null,
    "keyset_id" text,
    "keyset_counter" integer,
    "version" integer not null default 0,
    "output_amounts" integer[],
    "transaction_id" uuid not null,
    "type" text not null,
    "locking_derivation_path" text not null
);


alter table "wallet"."cashu_receive_quotes" enable row level security;

create table "wallet"."cashu_send_quotes" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "expires_at" timestamp with time zone not null,
    "user_id" uuid not null,
    "account_id" uuid not null,
    "currency" text not null,
    "unit" text not null,
    "payment_request" text not null,
    "amount_requested" numeric not null,
    "currency_requested" text not null,
    "amount_requested_in_msat" bigint not null,
    "amount_to_send" numeric not null,
    "fee_reserve" numeric not null,
    "quote_id" text not null,
    "proofs" text not null,
    "keyset_id" text not null,
    "keyset_counter" integer not null,
    "number_of_change_outputs" integer not null,
    "state" text not null default 'UNPAID'::text,
    "payment_preimage" text,
    "amount_spent" numeric,
    "failure_reason" text,
    "version" integer not null default 0,
    "transaction_id" uuid not null
);


alter table "wallet"."cashu_send_quotes" enable row level security;

create table "wallet"."cashu_token_swaps" (
    "token_hash" text not null,
    "created_at" timestamp with time zone not null default now(),
    "token_proofs" text not null,
    "account_id" uuid not null,
    "user_id" uuid not null,
    "currency" text not null,
    "unit" text not null,
    "keyset_id" text not null,
    "keyset_counter" integer not null,
    "output_amounts" integer[] not null,
    "input_amount" numeric not null,
    "receive_amount" numeric not null,
    "fee_amount" numeric not null,
    "state" text not null default 'PENDING'::text,
    "version" integer not null default 0,
    "failure_reason" text,
    "transaction_id" uuid not null
);


alter table "wallet"."cashu_token_swaps" enable row level security;

create table "wallet"."transactions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid not null,
    "direction" text not null,
    "type" text not null,
    "state" text not null,
    "account_id" uuid not null,
    "amount" numeric not null,
    "currency" text not null,
    "created_at" timestamp with time zone not null default now(),
    "pending_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "failed_at" timestamp with time zone
);


alter table "wallet"."transactions" enable row level security;

create table "wallet"."users" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "email" text,
    "email_verified" boolean not null,
    "updated_at" timestamp with time zone not null default now(),
    "default_btc_account_id" uuid,
    "default_currency" text not null default 'BTC'::text,
    "default_usd_account_id" uuid,
    "username" text not null,
    "cashu_locking_xpub" text not null
);


alter table "wallet"."users" enable row level security;

CREATE UNIQUE INDEX accounts_pkey ON wallet.accounts USING btree (id);

CREATE UNIQUE INDEX cashu_accounts_user_currency_mint_url_unique ON wallet.accounts USING btree (user_id, currency, ((details ->> 'mint_url'::text))) WHERE (type = 'cashu'::text);

CREATE UNIQUE INDEX cashu_receive_quotes_pkey ON wallet.cashu_receive_quotes USING btree (id);

CREATE UNIQUE INDEX cashu_send_quotes_pkey ON wallet.cashu_send_quotes USING btree (id);

CREATE UNIQUE INDEX cashu_token_swaps_pkey ON wallet.cashu_token_swaps USING btree (token_hash, user_id);

CREATE INDEX idx_cashu_receive_quotes_state_created_at ON wallet.cashu_receive_quotes USING btree (state, created_at);

CREATE INDEX idx_cashu_token_swaps_state_created_at ON wallet.cashu_token_swaps USING btree (state, created_at);

CREATE INDEX idx_cashu_send_quotes_state_created_at ON wallet.cashu_receive_quotes USING btree (state, created_at);

CREATE INDEX idx_transactions_state_created_at ON wallet.cashu_receive_quotes USING btree (state, created_at);

CREATE UNIQUE INDEX transactions_pkey ON wallet.transactions USING btree (id);

CREATE UNIQUE INDEX users_cashu_locking_xpub_key ON wallet.users USING btree (cashu_locking_xpub);

CREATE UNIQUE INDEX users_email_key ON wallet.users USING btree (email);

CREATE UNIQUE INDEX users_pkey ON wallet.users USING btree (id);

CREATE UNIQUE INDEX users_username_key ON wallet.users USING btree (username);

alter table "wallet"."accounts" add constraint "accounts_pkey" PRIMARY KEY using index "accounts_pkey";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_pkey" PRIMARY KEY using index "cashu_receive_quotes_pkey";

alter table "wallet"."cashu_send_quotes" add constraint "cashu_send_quotes_pkey" PRIMARY KEY using index "cashu_send_quotes_pkey";

alter table "wallet"."cashu_token_swaps" add constraint "cashu_token_swaps_pkey" PRIMARY KEY using index "cashu_token_swaps_pkey";

alter table "wallet"."transactions" add constraint "transactions_pkey" PRIMARY KEY using index "transactions_pkey";

alter table "wallet"."users" add constraint "users_pkey" PRIMARY KEY using index "users_pkey";

alter table "wallet"."accounts" add constraint "accounts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES wallet.users(id) not valid;

alter table "wallet"."accounts" validate constraint "accounts_user_id_fkey";

alter table "wallet"."accounts" add constraint "accounts_version_check" CHECK ((version >= 0)) not valid;

alter table "wallet"."accounts" validate constraint "accounts_version_check";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_account_id_fkey" FOREIGN KEY (account_id) REFERENCES wallet.accounts(id) not valid;

alter table "wallet"."cashu_receive_quotes" validate constraint "cashu_receive_quotes_account_id_fkey";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_keyset_counter_check" CHECK ((keyset_counter >= 0)) not valid;

alter table "wallet"."cashu_receive_quotes" validate constraint "cashu_receive_quotes_keyset_counter_check";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_output_amounts_check" CHECK (((output_amounts IS NULL) OR (array_length(output_amounts, 1) > 0))) not valid;

alter table "wallet"."cashu_receive_quotes" validate constraint "cashu_receive_quotes_output_amounts_check";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES wallet.transactions(id) not valid;

alter table "wallet"."cashu_receive_quotes" validate constraint "cashu_receive_quotes_transaction_id_fkey";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES wallet.users(id) not valid;

alter table "wallet"."cashu_receive_quotes" validate constraint "cashu_receive_quotes_user_id_fkey";

alter table "wallet"."cashu_receive_quotes" add constraint "cashu_receive_quotes_version_check" CHECK ((version >= 0)) not valid;

alter table "wallet"."cashu_receive_quotes" validate constraint "cashu_receive_quotes_version_check";

alter table "wallet"."cashu_send_quotes" add constraint "cashu_send_quotes_account_id_fkey" FOREIGN KEY (account_id) REFERENCES wallet.accounts(id) not valid;

alter table "wallet"."cashu_send_quotes" validate constraint "cashu_send_quotes_account_id_fkey";

alter table "wallet"."cashu_send_quotes" add constraint "cashu_send_quotes_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES wallet.transactions(id) not valid;

alter table "wallet"."cashu_send_quotes" validate constraint "cashu_send_quotes_transaction_id_fkey";

alter table "wallet"."cashu_send_quotes" add constraint "cashu_send_quotes_user_id_fkey" FOREIGN KEY (user_id) REFERENCES wallet.users(id) not valid;

alter table "wallet"."cashu_send_quotes" validate constraint "cashu_send_quotes_user_id_fkey";

alter table "wallet"."cashu_token_swaps" add constraint "cashu_token_swaps_account_id_fkey" FOREIGN KEY (account_id) REFERENCES wallet.accounts(id) not valid;

alter table "wallet"."cashu_token_swaps" validate constraint "cashu_token_swaps_account_id_fkey";

alter table "wallet"."cashu_token_swaps" add constraint "cashu_token_swaps_output_amounts_check" CHECK ((array_length(output_amounts, 1) > 0)) not valid;

alter table "wallet"."cashu_token_swaps" validate constraint "cashu_token_swaps_output_amounts_check";

alter table "wallet"."cashu_token_swaps" add constraint "cashu_token_swaps_transaction_id_fkey" FOREIGN KEY (transaction_id) REFERENCES wallet.transactions(id) not valid;

alter table "wallet"."cashu_token_swaps" validate constraint "cashu_token_swaps_transaction_id_fkey";

alter table "wallet"."cashu_token_swaps" add constraint "cashu_token_swaps_user_id_fkey" FOREIGN KEY (user_id) REFERENCES wallet.users(id) not valid;

alter table "wallet"."cashu_token_swaps" validate constraint "cashu_token_swaps_user_id_fkey";

alter table "wallet"."transactions" add constraint "transactions_account_id_fkey" FOREIGN KEY (account_id) REFERENCES wallet.accounts(id) not valid;

alter table "wallet"."transactions" validate constraint "transactions_account_id_fkey";

alter table "wallet"."transactions" add constraint "transactions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES wallet.users(id) not valid;

alter table "wallet"."transactions" validate constraint "transactions_user_id_fkey";

alter table "wallet"."users" add constraint "users_cashu_locking_xpub_key" UNIQUE using index "users_cashu_locking_xpub_key";

alter table "wallet"."users" add constraint "users_default_btc_account_id_fkey" FOREIGN KEY (default_btc_account_id) REFERENCES wallet.accounts(id) not valid;

alter table "wallet"."users" validate constraint "users_default_btc_account_id_fkey";

alter table "wallet"."users" add constraint "users_default_usd_account_id_fkey" FOREIGN KEY (default_usd_account_id) REFERENCES wallet.accounts(id) not valid;

alter table "wallet"."users" validate constraint "users_default_usd_account_id_fkey";

alter table "wallet"."users" add constraint "users_email_key" UNIQUE using index "users_email_key";

alter table "wallet"."users" add constraint "users_username_format" CHECK ((username ~ '^[a-z0-9_-]+$'::text)) not valid;

alter table "wallet"."users" validate constraint "users_username_format";

alter table "wallet"."users" add constraint "users_username_key" UNIQUE using index "users_username_key";

alter table "wallet"."users" add constraint "users_username_length" CHECK (((length(username) >= 3) AND (length(username) <= 20))) not valid;

alter table "wallet"."users" validate constraint "users_username_length";

CREATE OR REPLACE FUNCTION wallet.complete_cashu_receive_quote(p_quote_id uuid, p_quote_version integer, p_proofs jsonb, p_account_version integer)
 RETURNS wallet.cashu_receive_quotes
 LANGUAGE plpgsql
AS $function$
declare
    v_quote wallet.cashu_receive_quotes;
    v_updated_quote wallet.cashu_receive_quotes;
begin
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id;

    if v_quote is null then
        raise exception 'Quote % not found', p_quote_id;
    end if;

    if v_quote.state != 'PAID' then
        raise exception 'Quote % has not been paid yet', v_quote.id;
    end if;

    update wallet.cashu_receive_quotes
    set state = 'COMPLETED'
    where id = v_quote.id and version = p_quote_version
    returning * into v_updated_quote;

    if not found then
        raise exception 'Concurrency error: Quote % was modified by another transaction. Expected version %, but found different one', v_quote.id, p_quote_version;
    end if;

    update wallet.accounts
    set details = jsonb_set(details, '{proofs}', p_proofs, true),
        version = version + 1
    where id = v_quote.account_id and version = p_account_version;

    if not found then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one.', v_quote.account_id, p_account_version;
    end if;

    -- Update the transaction state to COMPLETED
    update wallet.transactions
    set state = 'COMPLETED',
        completed_at = now()
    where id = v_quote.transaction_id;

    return v_updated_quote;
end;
$function$
;

create type "wallet"."update_cashu_send_quote_result" as ("updated_quote" wallet.cashu_send_quotes, "updated_account" wallet.accounts);

CREATE OR REPLACE FUNCTION wallet.complete_cashu_send_quote(p_quote_id uuid, p_quote_version integer, p_payment_preimage text, p_amount_spent numeric, p_account_proofs text, p_account_version integer)
 RETURNS wallet.update_cashu_send_quote_result
 LANGUAGE plpgsql
AS $function$
declare
    v_updated_quote wallet.cashu_send_quotes;
    v_updated_account wallet.accounts;
    v_quote wallet.cashu_send_quotes;
begin
    -- Get the quote and check if it exists and its state
    select * into v_quote
    from wallet.cashu_send_quotes
    where id = p_quote_id;

    if v_quote is null then
        raise exception 'Cashu send quote with id % not found', p_quote_id;
    end if;

    if v_quote.state not in ('UNPAID', 'PENDING') then
        raise exception 'Cannot complete cashu send quote with id %. Current state is %, but must be UNPAID or PENDING', p_quote_id, v_quote.state;
    end if;

    -- Update the quote with optimistic concurrency check
    update wallet.cashu_send_quotes
    set state = 'PAID',
        payment_preimage = p_payment_preimage,
        amount_spent = p_amount_spent,
        version = version + 1
    where id = p_quote_id and version = p_quote_version
    returning * into v_updated_quote;

    -- Check if quote was updated
    if v_updated_quote is null then
        raise exception 'Concurrency error: Cashu send quote % was modified by another transaction. Expected version %, but found different one.', p_quote_id, p_quote_version;
    end if;

    -- Update the account with optimistic concurrency check
    update wallet.accounts
    set details = jsonb_set(details, '{proofs}', to_jsonb(p_account_proofs)),
        version = version + 1
    where id = v_quote.account_id and version = p_account_version
    returning * into v_updated_account;

    -- Check if account was updated
    if v_updated_account is null then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one.', v_quote.account_id, p_account_version;
    end if;

    -- Update the transaction state to COMPLETED
    update wallet.transactions
    set state = 'COMPLETED',
        completed_at = now()
    where id = v_quote.transaction_id;

    return (v_updated_quote, v_updated_account);
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.complete_cashu_token_swap(p_token_hash text, p_user_id uuid, p_swap_version integer, p_proofs jsonb, p_account_version integer)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_token_swap wallet.cashu_token_swaps;
begin
  select * into v_token_swap
  from wallet.cashu_token_swaps
  where token_hash = p_token_hash and user_id = p_user_id 
  for update;

  if v_token_swap is null then
    raise exception 'Token swap for token hash % not found', p_token_hash;
  end if;

  if v_token_swap.state != 'PENDING' then
    raise exception 'Token swap for token hash % cannot be completed because it is not in PENDING state. Current state: %', p_token_hash, v_token_swap.state;
  end if;
  
  -- Update the account with optimistic concurrency
  update wallet.accounts
  set details = jsonb_set(details, '{proofs}', p_proofs, true),
      version = version + 1
  where id = v_token_swap.account_id and version = p_account_version;

  if not found then
    raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one', v_token_swap.account_id, p_account_version;
  end if;

  -- Update the token swap to completed
  update wallet.cashu_token_swaps
  set state = 'COMPLETED',
      version = version + 1
  where token_hash = p_token_hash and version = p_swap_version;

  if not found then
    raise exception 'Concurrency error: Token swap % was modified by another transaction. Expected version %, but found different one', p_token_hash, p_swap_version;
  end if;

  -- Update the transaction state to COMPLETED
  update wallet.transactions
  set state = 'COMPLETED',
      completed_at = now()
  where id = v_token_swap.transaction_id;

  return;
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.create_cashu_receive_quote(p_user_id uuid, p_account_id uuid, p_amount numeric, p_currency text, p_unit text, p_quote_id text, p_payment_request text, p_expires_at timestamp with time zone, p_state text, p_locking_derivation_path text, p_receive_type text, p_description text DEFAULT NULL::text)
 RETURNS wallet.cashu_receive_quotes
 LANGUAGE plpgsql
AS $function$
declare
    v_transaction_id uuid;
    v_quote wallet.cashu_receive_quotes;
    v_transaction_type text;
begin
    -- Map receive type to transaction type
    v_transaction_type := case p_receive_type
        when 'LIGHTNING' then 'CASHU_LIGHTNING'
        when 'TOKEN' then 'CASHU_TOKEN'
        else null
    end;

    if v_transaction_type is null then
        raise exception 'Unsupported receive type: %', p_receive_type;
    end if;

    -- Create draft transaction record
    insert into wallet.transactions (
        user_id,
        account_id,
        direction,
        type,
        state,
        amount,
        currency
    ) values (
        p_user_id,
        p_account_id,
        'RECEIVE',
        v_transaction_type,
        'DRAFT',
        p_amount,
        p_currency
    ) returning id into v_transaction_id;

    -- Create quote record
    insert into wallet.cashu_receive_quotes (
        user_id,
        account_id,
        amount,
        currency,
        unit,
        quote_id,
        payment_request,
        expires_at,
        description,
        state,
        locking_derivation_path,
        transaction_id,
        type
    ) values (
        p_user_id,
        p_account_id,
        p_amount,
        p_currency,
        p_unit,
        p_quote_id,
        p_payment_request,
        p_expires_at,
        p_description,
        p_state,
        p_locking_derivation_path,
        v_transaction_id,
        p_receive_type
    ) returning * into v_quote;

    return v_quote;
end;
$function$
;

create type "wallet"."create_cashu_send_quote_result" as ("created_quote" wallet.cashu_send_quotes, "updated_account" wallet.accounts);

CREATE OR REPLACE FUNCTION wallet.create_cashu_send_quote(p_user_id uuid, p_account_id uuid, p_currency text, p_unit text, p_payment_request text, p_expires_at timestamp with time zone, p_amount_requested numeric, p_currency_requested text, p_amount_requested_in_msat bigint, p_amount_to_send numeric, p_fee_reserve numeric, p_quote_id text, p_keyset_id text, p_keyset_counter integer, p_number_of_change_outputs integer, p_proofs_to_send text, p_account_version integer, p_proofs_to_keep text)
 RETURNS wallet.create_cashu_send_quote_result
 LANGUAGE plpgsql
AS $function$
declare
    v_created_quote wallet.cashu_send_quotes;
    v_updated_account wallet.accounts;
    v_updated_counter integer;
    v_transaction_id uuid;
begin
    -- Calculate new counter value
    v_updated_counter := p_keyset_counter + p_number_of_change_outputs;

    -- Create transaction record
    insert into wallet.transactions (
        user_id,
        account_id,
        direction,
        type,
        state,
        amount,
        currency
    ) values (
        p_user_id,
        p_account_id,
        'SEND',
        'CASHU_LIGHTNING',
        'PENDING',
        p_amount_to_send,
        p_currency
    ) returning id into v_transaction_id;

    -- Insert the new cashu send quote
    insert into wallet.cashu_send_quotes (
        user_id,
        account_id,
        currency,
        unit,
        payment_request,
        expires_at,
        amount_requested,
        currency_requested,
        amount_requested_in_msat,
        amount_to_send,
        fee_reserve,
        quote_id,
        proofs,
        keyset_id,
        keyset_counter,
        number_of_change_outputs,
        transaction_id
    ) values (
        p_user_id,
        p_account_id,
        p_currency,
        p_unit,
        p_payment_request,
        p_expires_at,
        p_amount_requested,
        p_currency_requested,
        p_amount_requested_in_msat,
        p_amount_to_send,
        p_fee_reserve,
        p_quote_id,
        p_proofs_to_send,
        p_keyset_id,
        p_keyset_counter,
        p_number_of_change_outputs,
        v_transaction_id
    )
    returning * into v_created_quote;

    -- Update the account with optimistic concurrency check
    update wallet.accounts
    set details = jsonb_set(
            jsonb_set(details, '{proofs}', to_jsonb(p_proofs_to_keep)),
            array['keyset_counters', p_keyset_id],
            to_jsonb(v_updated_counter),
            true
        ),
        version = version + 1
    where id = v_created_quote.account_id and version = p_account_version
    returning * into v_updated_account;

    -- Check if account was updated
    if v_updated_account is null then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one.', v_created_quote.account_id, p_account_version;
    end if;

    return (v_created_quote, v_updated_account);
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.create_cashu_token_swap(p_token_hash text, p_token_proofs text, p_account_id uuid, p_user_id uuid, p_currency text, p_unit text, p_keyset_id text, p_keyset_counter integer, p_output_amounts integer[], p_input_amount numeric, p_receive_amount numeric, p_fee_amount numeric, p_account_version integer)
 RETURNS wallet.cashu_token_swaps
 LANGUAGE plpgsql
AS $function$
declare
  v_token_swap wallet.cashu_token_swaps;
  v_updated_counter integer;
  v_transaction_id uuid;
begin

 -- Create transaction record
    insert into wallet.transactions (
        user_id,
        account_id,
        direction,
        type,
        state,
        amount,
        currency
    ) values (
        p_user_id,
        p_account_id,
        'RECEIVE',
        'CASHU_TOKEN',
        'PENDING',
        p_receive_amount,
        p_currency
    ) returning id into v_transaction_id;

  -- Calculate new counter
  v_updated_counter := p_keyset_counter + array_length(p_output_amounts, 1);

  -- Update the account with optimistic concurrency
  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(v_updated_counter), 
      true
    ),
    version = version + 1
  where a.id = p_account_id and a.version = p_account_version;

  if not found then
    raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one', p_account_id, p_account_version;
  end if;

  insert into wallet.cashu_token_swaps (
    token_hash,
    token_proofs,
    account_id,
    user_id,
    currency,
    unit,
    keyset_id,
    keyset_counter,
    output_amounts,
    input_amount,
    receive_amount,
    fee_amount,
    state,
    transaction_id
  ) values (
    p_token_hash,
    p_token_proofs,
    p_account_id,
    p_user_id,
    p_currency,
    p_unit,
    p_keyset_id,
    p_keyset_counter,
    p_output_amounts,
    p_input_amount,
    p_receive_amount,
    p_fee_amount,
    'PENDING',
    v_transaction_id
  ) returning * into v_token_swap;

  return v_token_swap;
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.expire_cashu_receive_quote(p_quote_id uuid, p_quote_version integer)
 RETURNS wallet.cashu_receive_quotes
 LANGUAGE plpgsql
AS $function$
declare
    v_quote wallet.cashu_receive_quotes;
    v_updated_quote wallet.cashu_receive_quotes;
begin
    -- Get the quote and check if it exists and its state
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id;

    if v_quote is null then
        raise exception 'Quote % not found', p_quote_id;
    end if;

    if v_quote.expires_at > now() then
        raise exception 'Quote % has not expired yet', v_quote.id;
    end if;

    if v_quote.state != 'UNPAID' then
        raise exception 'Only quote in UNPAID state can be expired. Current state is %', v_quote.state;
    end if;

    -- Update the quote with optimistic concurrency
    update wallet.cashu_receive_quotes
    set state = 'EXPIRED'
    where id = v_quote.id and version = p_quote_version
    returning * into v_updated_quote;

    if not found then
        raise exception 'Concurrency error: Quote % was modified by another transaction. Expected version %, but found different one', v_quote.id, p_quote_version;
    end if;

    -- Update the transaction state to FAILED
    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_quote.transaction_id;

    return v_updated_quote;
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.expire_cashu_send_quote(p_quote_id uuid, p_quote_version integer, p_account_proofs text, p_account_version integer)
 RETURNS wallet.update_cashu_send_quote_result
 LANGUAGE plpgsql
AS $function$
declare
    v_quote wallet.cashu_send_quotes;
    v_updated_quote wallet.cashu_send_quotes;
    v_updated_account wallet.accounts;
begin
    select * into v_quote
    from wallet.cashu_send_quotes
    where id = p_quote_id;

    if v_quote is null then
        raise exception 'Cashu send quote with id % not found', p_quote_id;
    end if;

    if v_quote.state != 'UNPAID' then
        raise exception 'Cannot expire cashu send quote with id %. Current state is %, but must be UNPAID', p_quote_id, v_quote.state;
    end if;

    if v_quote.expires_at > now() then
        raise exception 'Cannot expire cashu send quote with id % that has not expired yet', p_quote_id;
    end if;

    update wallet.cashu_send_quotes
    set state = 'EXPIRED',
        version = version + 1
    where id = p_quote_id and version = p_quote_version
    returning * into v_updated_quote;

    if v_updated_quote is null then
        raise exception 'Concurrency error: Cashu send quote % was modified by another transaction. Expected version %, but found different one.', p_quote_id, p_quote_version;
    end if;

    update wallet.accounts
    set details = jsonb_set(details, '{proofs}', to_jsonb(p_account_proofs)),
        version = version + 1
    where id = v_quote.account_id and version = p_account_version
    returning * into v_updated_account;

    if v_updated_account is null then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one.', v_quote.account_id, p_account_version;
    end if;

    -- Update the transaction state to FAILED
    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_quote.transaction_id;

    return (v_updated_quote, v_updated_account);
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.fail_cashu_send_quote(p_quote_id uuid, p_failure_reason text, p_quote_version integer, p_account_proofs text, p_account_version integer)
 RETURNS wallet.update_cashu_send_quote_result
 LANGUAGE plpgsql
AS $function$
declare
    v_quote wallet.cashu_send_quotes;
    v_updated_quote wallet.cashu_send_quotes;
    v_updated_account wallet.accounts;
begin
    select * into v_quote
    from wallet.cashu_send_quotes
    where id = p_quote_id;

    if v_quote is null then
        raise exception 'Cashu send quote with id % not found', p_quote_id;
    end if;

    if v_quote.state not in ('UNPAID', 'PENDING') then
        raise exception 'Cannot fail cashu send quote with id %. Current state is %, but must be UNPAID or PENDING', p_quote_id, v_quote.state;
    end if;

    update wallet.cashu_send_quotes
    set state = 'FAILED',
        failure_reason = p_failure_reason,
        version = version + 1
    where id = p_quote_id and version = p_quote_version
    returning * into v_updated_quote;

    if v_updated_quote is null then
        raise exception 'Concurrency error: Cashu send quote % was modified by another transaction. Expected version %, but found different one.', p_quote_id, p_quote_version;
    end if;

    update wallet.accounts
    set details = jsonb_set(details, '{proofs}', to_jsonb(p_account_proofs)),
        version = version + 1
    where id = v_quote.account_id and version = p_account_version
    returning * into v_updated_account;

    if v_updated_account is null then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one.', v_quote.account_id, p_account_version;
    end if;

    -- Update the transaction state to FAILED
    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_quote.transaction_id;

    return (v_updated_quote, v_updated_account);
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.fail_cashu_token_swap(p_token_hash text, p_user_id uuid, p_swap_version integer, p_failure_reason text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
declare
  v_token_swap wallet.cashu_token_swaps;
begin
  select * into v_token_swap
  from wallet.cashu_token_swaps
  where token_hash = p_token_hash and user_id = p_user_id 
  for update;

  if v_token_swap is null then
    raise exception 'Token swap for token hash % not found', p_token_hash;
  end if;

  if v_token_swap.state != 'PENDING' then
    raise exception 'Token swap for token hash % cannot be failed because it is not in PENDING state. Current state: %', p_token_hash, v_token_swap.state;
  end if;

  -- Update the token swap to failed with optimistic concurrency
  update wallet.cashu_token_swaps
  set state = 'FAILED',
      failure_reason = p_failure_reason,
      version = version + 1
  where token_hash = p_token_hash and user_id = p_user_id and version = p_swap_version;

  if not found then
    raise exception 'Concurrency error: Token swap % was modified by another transaction. Expected version %, but found different one', p_token_hash, p_swap_version;
  end if;

  -- Update the transaction state to FAILED
  update wallet.transactions
  set state = 'FAILED',
      failed_at = now()
  where id = v_token_swap.transaction_id;

  return;
end;
$function$
;

create type "wallet"."cashu_receive_quote_payment_result" as ("updated_quote" wallet.cashu_receive_quotes, "updated_account" wallet.accounts);

CREATE OR REPLACE FUNCTION wallet.process_cashu_receive_quote_payment(p_quote_id uuid, p_quote_version integer, p_keyset_id text, p_keyset_counter integer, p_output_amounts integer[], p_account_version integer)
 RETURNS wallet.cashu_receive_quote_payment_result
 LANGUAGE plpgsql
AS $function$
declare
    v_quote wallet.cashu_receive_quotes;
    v_account wallet.accounts;
    v_updated_counter integer;
    v_updated_quote wallet.cashu_receive_quotes;
    v_updated_account wallet.accounts;
begin
    -- Check if the quote is already PAID and if yes return the quote and account without doing any updates
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id
    for update;

    if v_quote.state = 'PAID' then
        select * into v_account
        from wallet.accounts
        where id = v_quote.account_id;

        return (v_quote, v_account);
    end if;

    -- Calculate new counter
    v_updated_counter := p_keyset_counter + array_length(p_output_amounts, 1);

    -- Update the quote with optimistic concurrency
    update wallet.cashu_receive_quotes q
    set 
        state = 'PAID',
        keyset_id = p_keyset_id,
        keyset_counter = p_keyset_counter,
        output_amounts = p_output_amounts,
        version = version + 1
    where q.id = p_quote_id and q.version = p_quote_version
    returning * into v_updated_quote;

    if not found then
        raise exception 'Concurrency error: Quote % was modified by another transaction. Expected version %, but found different one', p_quote_id, p_quote_version;
    end if;

    -- Update the account with optimistic concurrency
    update wallet.accounts a
    set 
        details = jsonb_set(
            details, 
            array['keyset_counters', p_keyset_id], 
            to_jsonb(v_updated_counter), 
            true
        ),
        version = version + 1
    where a.id = v_updated_quote.account_id and a.version = p_account_version
    returning * into v_updated_account;

    if not found then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one', v_updated_quote.account_id, p_account_version;
    end if;

    -- Update the transaction state to PENDING
    update wallet.transactions
    set state = 'PENDING',
        pending_at = now()
    where id = v_updated_quote.transaction_id;

    return (v_updated_quote, v_updated_account);
end;
$function$
;

CREATE OR REPLACE FUNCTION wallet.set_default_username()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$BEGIN
    -- Set the username field to "user-" concatenated with the last 12 characters of the id
    NEW.username := 'user-' || RIGHT(NEW.id::text, 12);
    
    RETURN NEW;
END;$function$
;

CREATE OR REPLACE FUNCTION wallet.upsert_user_with_accounts(p_user_id uuid, p_email text, p_email_verified boolean, p_accounts jsonb[], p_cashu_locking_xpub text)
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
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub)
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
    'cashu_locking_xpub', u.cashu_locking_xpub,
    'created_at', u.created_at,
    'updated_at', u.updated_at,
    'accounts', added_accounts
  ) into result_user;

  return result_user;

end;$function$
;

grant delete on table "wallet"."accounts" to "anon";

grant insert on table "wallet"."accounts" to "anon";

grant references on table "wallet"."accounts" to "anon";

grant select on table "wallet"."accounts" to "anon";

grant trigger on table "wallet"."accounts" to "anon";

grant truncate on table "wallet"."accounts" to "anon";

grant update on table "wallet"."accounts" to "anon";

grant delete on table "wallet"."accounts" to "authenticated";

grant insert on table "wallet"."accounts" to "authenticated";

grant references on table "wallet"."accounts" to "authenticated";

grant select on table "wallet"."accounts" to "authenticated";

grant trigger on table "wallet"."accounts" to "authenticated";

grant truncate on table "wallet"."accounts" to "authenticated";

grant update on table "wallet"."accounts" to "authenticated";

grant delete on table "wallet"."accounts" to "service_role";

grant insert on table "wallet"."accounts" to "service_role";

grant references on table "wallet"."accounts" to "service_role";

grant select on table "wallet"."accounts" to "service_role";

grant trigger on table "wallet"."accounts" to "service_role";

grant truncate on table "wallet"."accounts" to "service_role";

grant update on table "wallet"."accounts" to "service_role";

grant delete on table "wallet"."cashu_receive_quotes" to "anon";

grant insert on table "wallet"."cashu_receive_quotes" to "anon";

grant references on table "wallet"."cashu_receive_quotes" to "anon";

grant select on table "wallet"."cashu_receive_quotes" to "anon";

grant trigger on table "wallet"."cashu_receive_quotes" to "anon";

grant truncate on table "wallet"."cashu_receive_quotes" to "anon";

grant update on table "wallet"."cashu_receive_quotes" to "anon";

grant delete on table "wallet"."cashu_receive_quotes" to "authenticated";

grant insert on table "wallet"."cashu_receive_quotes" to "authenticated";

grant references on table "wallet"."cashu_receive_quotes" to "authenticated";

grant select on table "wallet"."cashu_receive_quotes" to "authenticated";

grant trigger on table "wallet"."cashu_receive_quotes" to "authenticated";

grant truncate on table "wallet"."cashu_receive_quotes" to "authenticated";

grant update on table "wallet"."cashu_receive_quotes" to "authenticated";

grant delete on table "wallet"."cashu_receive_quotes" to "service_role";

grant insert on table "wallet"."cashu_receive_quotes" to "service_role";

grant references on table "wallet"."cashu_receive_quotes" to "service_role";

grant select on table "wallet"."cashu_receive_quotes" to "service_role";

grant trigger on table "wallet"."cashu_receive_quotes" to "service_role";

grant truncate on table "wallet"."cashu_receive_quotes" to "service_role";

grant update on table "wallet"."cashu_receive_quotes" to "service_role";

grant delete on table "wallet"."cashu_send_quotes" to "anon";

grant insert on table "wallet"."cashu_send_quotes" to "anon";

grant references on table "wallet"."cashu_send_quotes" to "anon";

grant select on table "wallet"."cashu_send_quotes" to "anon";

grant trigger on table "wallet"."cashu_send_quotes" to "anon";

grant truncate on table "wallet"."cashu_send_quotes" to "anon";

grant update on table "wallet"."cashu_send_quotes" to "anon";

grant delete on table "wallet"."cashu_send_quotes" to "authenticated";

grant insert on table "wallet"."cashu_send_quotes" to "authenticated";

grant references on table "wallet"."cashu_send_quotes" to "authenticated";

grant select on table "wallet"."cashu_send_quotes" to "authenticated";

grant trigger on table "wallet"."cashu_send_quotes" to "authenticated";

grant truncate on table "wallet"."cashu_send_quotes" to "authenticated";

grant update on table "wallet"."cashu_send_quotes" to "authenticated";

grant delete on table "wallet"."cashu_send_quotes" to "service_role";

grant insert on table "wallet"."cashu_send_quotes" to "service_role";

grant references on table "wallet"."cashu_send_quotes" to "service_role";

grant select on table "wallet"."cashu_send_quotes" to "service_role";

grant trigger on table "wallet"."cashu_send_quotes" to "service_role";

grant truncate on table "wallet"."cashu_send_quotes" to "service_role";

grant update on table "wallet"."cashu_send_quotes" to "service_role";

grant delete on table "wallet"."cashu_token_swaps" to "anon";

grant insert on table "wallet"."cashu_token_swaps" to "anon";

grant references on table "wallet"."cashu_token_swaps" to "anon";

grant select on table "wallet"."cashu_token_swaps" to "anon";

grant trigger on table "wallet"."cashu_token_swaps" to "anon";

grant truncate on table "wallet"."cashu_token_swaps" to "anon";

grant update on table "wallet"."cashu_token_swaps" to "anon";

grant delete on table "wallet"."cashu_token_swaps" to "authenticated";

grant insert on table "wallet"."cashu_token_swaps" to "authenticated";

grant references on table "wallet"."cashu_token_swaps" to "authenticated";

grant select on table "wallet"."cashu_token_swaps" to "authenticated";

grant trigger on table "wallet"."cashu_token_swaps" to "authenticated";

grant truncate on table "wallet"."cashu_token_swaps" to "authenticated";

grant update on table "wallet"."cashu_token_swaps" to "authenticated";

grant delete on table "wallet"."cashu_token_swaps" to "service_role";

grant insert on table "wallet"."cashu_token_swaps" to "service_role";

grant references on table "wallet"."cashu_token_swaps" to "service_role";

grant select on table "wallet"."cashu_token_swaps" to "service_role";

grant trigger on table "wallet"."cashu_token_swaps" to "service_role";

grant truncate on table "wallet"."cashu_token_swaps" to "service_role";

grant update on table "wallet"."cashu_token_swaps" to "service_role";

grant delete on table "wallet"."transactions" to "anon";

grant insert on table "wallet"."transactions" to "anon";

grant references on table "wallet"."transactions" to "anon";

grant select on table "wallet"."transactions" to "anon";

grant trigger on table "wallet"."transactions" to "anon";

grant truncate on table "wallet"."transactions" to "anon";

grant update on table "wallet"."transactions" to "anon";

grant delete on table "wallet"."transactions" to "authenticated";

grant insert on table "wallet"."transactions" to "authenticated";

grant references on table "wallet"."transactions" to "authenticated";

grant select on table "wallet"."transactions" to "authenticated";

grant trigger on table "wallet"."transactions" to "authenticated";

grant truncate on table "wallet"."transactions" to "authenticated";

grant update on table "wallet"."transactions" to "authenticated";

grant delete on table "wallet"."transactions" to "service_role";

grant insert on table "wallet"."transactions" to "service_role";

grant references on table "wallet"."transactions" to "service_role";

grant select on table "wallet"."transactions" to "service_role";

grant trigger on table "wallet"."transactions" to "service_role";

grant truncate on table "wallet"."transactions" to "service_role";

grant update on table "wallet"."transactions" to "service_role";

grant delete on table "wallet"."users" to "anon";

grant insert on table "wallet"."users" to "anon";

grant references on table "wallet"."users" to "anon";

grant select on table "wallet"."users" to "anon";

grant trigger on table "wallet"."users" to "anon";

grant truncate on table "wallet"."users" to "anon";

grant update on table "wallet"."users" to "anon";

grant delete on table "wallet"."users" to "authenticated";

grant insert on table "wallet"."users" to "authenticated";

grant references on table "wallet"."users" to "authenticated";

grant select on table "wallet"."users" to "authenticated";

grant trigger on table "wallet"."users" to "authenticated";

grant truncate on table "wallet"."users" to "authenticated";

grant update on table "wallet"."users" to "authenticated";

grant delete on table "wallet"."users" to "service_role";

grant insert on table "wallet"."users" to "service_role";

grant references on table "wallet"."users" to "service_role";

grant select on table "wallet"."users" to "service_role";

grant trigger on table "wallet"."users" to "service_role";

grant truncate on table "wallet"."users" to "service_role";

grant update on table "wallet"."users" to "service_role";

create policy "Enable CRUD for accounts based on user_id"
on "wallet"."accounts"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));


create policy "Enable CRUD for cashu receive quotes based on user_id"
on "wallet"."cashu_receive_quotes"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));


create policy "Enable CRUD for cashu send quotes based on user_id"
on "wallet"."cashu_send_quotes"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));


create policy "Enable CRUD based on user_id"
on "wallet"."cashu_token_swaps"
as permissive
for all
to public
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));


create policy "Enable CRUD for transactions based on user_id"
on "wallet"."transactions"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));


create policy "Enable CRUD for users based on id"
on "wallet"."users"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = id))
with check ((( SELECT auth.uid() AS uid) = id));


CREATE TRIGGER set_default_username_trigger BEFORE INSERT ON wallet.users FOR EACH ROW EXECUTE FUNCTION wallet.set_default_username();

CREATE TRIGGER users_handle_updated_at BEFORE UPDATE ON wallet.users FOR EACH ROW EXECUTE FUNCTION set_updated_at_if_updated();

-- Manually added start

-- Enable realtime
alter publication supabase_realtime add table wallet.accounts;
alter publication supabase_realtime add table wallet.cashu_receive_quotes;
alter publication supabase_realtime add table wallet.cashu_token_swaps;
alter publication supabase_realtime add table wallet.cashu_send_quotes;
alter publication supabase_realtime add table wallet.transactions;

-- Install pg_cron extension
create extension pg_cron with schema pg_catalog;

grant usage on schema cron to postgres;
grant all privileges on all tables in schema cron to postgres;

-- Cleanup expired and completed quotes every day at midnight
select cron.schedule('cleanup-cashu-receive-quotes', '0 0 * * *', $$
  DELETE FROM wallet.cashu_receive_quotes
  WHERE state IN ('EXPIRED', 'COMPLETED') AND created_at < NOW() - INTERVAL '1 day';
$$);

-- Cleanup failed and completed token swaps every day at midnight
select cron.schedule('cleanup-cashu-token-swaps', '0 0 * * *', $$
  DELETE FROM wallet.cashu_token_swaps
  WHERE state IN ('COMPLETED', 'FAILED') AND created_at < NOW() - INTERVAL '1 day';
$$);

-- Cleanup expired and completed send quotes every day at midnight
select cron.schedule('cleanup-cashu-send-quotes', '0 0 * * *', $$
  DELETE FROM wallet.cashu_send_quotes
  WHERE state IN ('EXPIRED', 'COMPLETED') AND created_at < NOW() - INTERVAL '1 day';
$$);

-- Cleanup failed transactions every day at midnight
select cron.schedule('cleanup-transactions', '0 0 * * *', $$
  DELETE FROM wallet.transactions
  WHERE state = 'FAILED' AND created_at < NOW() - INTERVAL '30 day';
$$);

-- Manually added end


