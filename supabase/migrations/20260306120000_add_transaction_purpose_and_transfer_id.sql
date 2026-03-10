-- Migration: Add transaction purpose, transfer_id, and update quote creation functions
--
-- Purpose:
-- 1. Track the purpose of a transaction — e.g. PAYMENT, BUY_CASHAPP, TRANSFER
-- 2. Link paired send/receive transactions via transferId stored in
--    transaction_details JSONB (same pattern as sparkTransferId, paymentHash)
-- 3. Accept purpose and transfer_id when creating quotes so the purpose is recorded
--    at creation time
--
-- Notes:
-- - purpose defaults to 'PAYMENT' for organic send/receive transactions
-- - transferId in transaction_details is optional: absent = non-transfer transaction
-- - The unique partial index on (transaction_details->>'transferId', direction)
--   ensures at most one send and one receive per transfer, and excludes nulls
--   to avoid indexing the common case

-- 1. Schema changes: enum, column, index, constraint

create type "wallet"."transaction_purpose" as enum ('PAYMENT', 'BUY_CASHAPP', 'TRANSFER');

alter table "wallet"."transactions"
  add column "purpose" "wallet"."transaction_purpose" not null default 'PAYMENT';

create unique index "idx_transactions_transfer_id_direction"
  on "wallet"."transactions" (("transaction_details" ->> 'transferId'), "direction")
  where ("transaction_details" ->> 'transferId') is not null;

alter table "wallet"."transactions"
  add constraint "chk_transfer_id_required_for_transfer"
  check (purpose != 'TRANSFER' or ("transaction_details" ->> 'transferId') is not null);

-- 2. Cashu receive quote: drop old signature, recreate with p_purpose and p_transfer_id

drop function if exists "wallet"."create_cashu_receive_quote"(
  "uuid", "uuid", "wallet"."currency", timestamp with time zone, "text",
  "wallet"."receive_quote_type", "text", "text", "text"
);

create or replace function "wallet"."create_cashu_receive_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "wallet"."currency",
  "p_expires_at" timestamp with time zone,
  "p_locking_derivation_path" "text",
  "p_receive_type" "wallet"."receive_quote_type",
  "p_encrypted_data" "text",
  "p_quote_id_hash" "text",
  "p_payment_hash" "text",
  "p_purpose" "wallet"."transaction_purpose" default 'PAYMENT',
  "p_transfer_id" uuid default null
)
returns "wallet"."cashu_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type wallet.transaction_type;
  v_transaction_state wallet.transaction_state;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_quote wallet.cashu_receive_quotes;
  v_transaction_details jsonb;
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'CASHU_LIGHTNING'
    when 'CASHU_TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, CASHU_TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- CASHU_TOKEN and TRANSFER transactions start as PENDING because the payment
  -- is initiated by the app (not waiting on an external payer).
  -- LIGHTNING and BUY start as DRAFT because the invoice may never be paid.
  v_transaction_state := case
    when v_transaction_type = 'CASHU_TOKEN' then 'PENDING'
    when p_purpose = 'TRANSFER' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  v_transaction_details := jsonb_build_object('paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id::text);
  end if;

  -- Store encrypted data in transactions table as encrypted_transaction_details
  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    purpose
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    p_purpose
  ) returning id into v_transaction_id;

  insert into wallet.cashu_receive_quotes (
    user_id,
    account_id,
    expires_at,
    state,
    locking_derivation_path,
    transaction_id,
    type,
    encrypted_data,
    quote_id_hash,
    payment_hash,
    cashu_token_melt_initiated
  ) values (
    p_user_id,
    p_account_id,
    p_expires_at,
    'UNPAID',
    p_locking_derivation_path,
    v_transaction_id,
    p_receive_type,
    p_encrypted_data,
    p_quote_id_hash,
    p_payment_hash,
    v_cashu_token_melt_initiated
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

-- 3. Spark receive quote: drop old signature, recreate with p_purpose and p_transfer_id

drop function if exists "wallet"."create_spark_receive_quote"(
  "uuid", "uuid", "wallet"."currency", "text", timestamp with time zone,
  "text", "text", "wallet"."receive_quote_type", "text"
);

create or replace function "wallet"."create_spark_receive_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "wallet"."currency",
  "p_payment_hash" "text",
  "p_expires_at" timestamp with time zone,
  "p_spark_id" "text",
  "p_receiver_identity_pubkey" "text",
  "p_receive_type" "wallet"."receive_quote_type",
  "p_encrypted_data" "text",
  "p_purpose" "wallet"."transaction_purpose" default 'PAYMENT',
  "p_transfer_id" uuid default null
)
returns "wallet"."spark_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type wallet.transaction_type;
  v_transaction_state wallet.transaction_state;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_quote wallet.spark_receive_quotes;
  v_transaction_details jsonb;
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'SPARK_LIGHTNING'
    when 'CASHU_TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, CASHU_TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- CASHU_TOKEN and TRANSFER transactions start as PENDING because the payment
  -- is initiated by the app (not waiting on an external payer).
  -- LIGHTNING and BUY start as DRAFT because the invoice may never be paid.
  v_transaction_state := case
    when v_transaction_type = 'CASHU_TOKEN' then 'PENDING'
    when p_purpose = 'TRANSFER' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  v_transaction_details := jsonb_build_object('sparkId', p_spark_id, 'paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id::text);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    purpose
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    p_purpose
  ) returning id into v_transaction_id;

  insert into wallet.spark_receive_quotes (
    user_id,
    account_id,
    type,
    payment_hash,
    expires_at,
    spark_id,
    receiver_identity_pubkey,
    transaction_id,
    state,
    encrypted_data,
    cashu_token_melt_initiated
  ) values (
    p_user_id,
    p_account_id,
    p_receive_type,
    p_payment_hash,
    p_expires_at,
    p_spark_id,
    p_receiver_identity_pubkey,
    v_transaction_id,
    'UNPAID',
    p_encrypted_data,
    v_cashu_token_melt_initiated
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

-- 4. Cashu send quote: drop old signature, recreate with p_purpose and p_transfer_id

drop function if exists "wallet"."create_cashu_send_quote"(
  "uuid", "uuid", "wallet"."currency", timestamp with time zone, "wallet"."currency",
  "text", integer, "uuid"[], "text", "text", "text"
);

create or replace function "wallet"."create_cashu_send_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "wallet"."currency",
  "p_expires_at" timestamp with time zone,
  "p_currency_requested" "wallet"."currency",
  "p_keyset_id" "text",
  "p_number_of_change_outputs" integer,
  "p_proofs_to_send" "uuid"[],
  "p_encrypted_data" "text",
  "p_quote_id_hash" "text",
  "p_payment_hash" "text",
  "p_purpose" "wallet"."transaction_purpose" default 'PAYMENT',
  "p_transfer_id" uuid default null
)
returns "wallet"."create_cashu_send_quote_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_counter integer;
  v_transaction_id uuid;
  v_reserved_proofs wallet.cashu_proofs[];
  v_transaction_details jsonb;
begin
  if p_number_of_change_outputs < 0 then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_number_of_change_outputs cannot be less than 0.',
        detail = format('Value provided: %s', p_number_of_change_outputs);
  end if;

  if p_number_of_change_outputs > 0 then
    update wallet.accounts a
    set
      details = jsonb_set(
        details,
        array['keyset_counters', p_keyset_id],
        to_jsonb(
          coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + p_number_of_change_outputs
        ),
        true
      ),
      version = version + 1
    where a.id = p_account_id
    returning * into v_account;

    v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - p_number_of_change_outputs;
  else
    -- We still want to update the account version because we are reserving account proofs.
    update wallet.accounts a
    set version = version + 1
    where a.id = p_account_id
    returning * into v_account;

    v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0);
  end if;

  v_transaction_details := jsonb_build_object('paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id::text);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    purpose
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'CASHU_LIGHTNING',
    'PENDING',
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    p_purpose
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_quotes (
    user_id,
    account_id,
    currency_requested,
    expires_at,
    keyset_id,
    keyset_counter,
    number_of_change_outputs,
    transaction_id,
    encrypted_data,
    quote_id_hash,
    payment_hash
  ) values (
    p_user_id,
    p_account_id,
    p_currency_requested,
    p_expires_at,
    p_keyset_id,
    v_counter,
    p_number_of_change_outputs,
    v_transaction_id,
    p_encrypted_data,
    p_quote_id_hash,
    p_payment_hash
  )
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows
  -- "returning into" can only be used with a single value so array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_quote_id = v_quote.id,
      version = version + 1
    where id = any(p_proofs_to_send) and account_id = p_account_id and state = 'UNSPENT'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_reserved_proofs
  from updated_proofs;

  -- Verify all proofs were successfully reserved. Proof might not be successfully reserved if it was modified by another transaction and thus is not UNSPENT anymore.
  if coalesce(array_length(v_reserved_proofs, 1), 0) != array_length(p_proofs_to_send, 1) then
    raise exception using
      hint = 'CONCURRENCY_ERROR',
      message = format('Failed to reserve proofs for cashu send quote with id %s.', v_quote.id),
      detail = 'One or more proofs were modified by another transaction and could not be reserved.';
  end if;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_quote, v_account_with_proofs, v_reserved_proofs);
end;
$function$;

-- 5. Spark send quote: drop old signature, recreate with p_purpose and p_transfer_id

drop function if exists "wallet"."create_spark_send_quote"(
  "uuid", "uuid", "wallet"."currency", "text", boolean, "text",
  timestamp with time zone
);

create or replace function "wallet"."create_spark_send_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "wallet"."currency",
  "p_payment_hash" "text",
  "p_payment_request_is_amountless" boolean,
  "p_encrypted_data" "text",
  "p_expires_at" timestamp with time zone default null::timestamp with time zone,
  "p_purpose" "wallet"."transaction_purpose" default 'PAYMENT',
  "p_transfer_id" uuid default null
)
returns "wallet"."spark_send_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_id uuid;
  v_quote wallet.spark_send_quotes;
  v_transaction_details jsonb;
begin
  v_transaction_details := jsonb_build_object('paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id::text);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    pending_at,
    purpose
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'SPARK_LIGHTNING',
    'DRAFT',
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    now(),
    p_purpose
  ) returning id into v_transaction_id;

  insert into wallet.spark_send_quotes (
    user_id,
    account_id,
    payment_hash,
    payment_request_is_amountless,
    transaction_id,
    state,
    expires_at,
    encrypted_data
  ) values (
    p_user_id,
    p_account_id,
    p_payment_hash,
    p_payment_request_is_amountless,
    v_transaction_id,
    'UNPAID',
    p_expires_at,
    p_encrypted_data
  ) returning * into v_quote;

  return v_quote;
end;
$function$;
