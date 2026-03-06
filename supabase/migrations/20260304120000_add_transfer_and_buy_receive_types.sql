-- =============================================================================
-- Add TRANSFER and BUY to receive_quote_type and transaction_type enums
-- =============================================================================
--
-- This migration extends both the receive_quote_type and transaction_type enums
-- with two new values and updates both quote-creation functions to handle them.
--
-- New receive_quote_type values:
--
--   BUY      — A purchase of bitcoin where the buyer pays a Lightning invoice
--              via an external payment method (e.g. Cash App Pay). Treated the
--              same as LIGHTNING: the invoice may never be paid, so the
--              transaction starts as DRAFT.
--
--   TRANSFER — An internal transfer between accounts initiated by the app
--              itself. Because the payment is app-controlled it is guaranteed
--              to be sent, so the transaction starts as PENDING (like
--              CASHU_TOKEN).
--
-- New transaction_type values:
--
--   BUY      — Transaction created from a BUY receive quote. Carries the
--              semantic meaning that the user purchased bitcoin rather than
--              receiving a regular Lightning payment.
--
--   TRANSFER — Transaction created from a TRANSFER receive quote. Carries the
--              semantic meaning that funds were moved between accounts rather
--              than received externally.
--
-- Functions updated:
--   wallet.create_cashu_receive_quote — BUY → BUY, TRANSFER → TRANSFER
--   wallet.create_spark_receive_quote — BUY → BUY, TRANSFER → TRANSFER
-- =============================================================================

alter type "wallet"."receive_quote_type" add value 'TRANSFER';
alter type "wallet"."receive_quote_type" add value 'BUY';

alter type "wallet"."transaction_type" add value 'TRANSFER';
alter type "wallet"."transaction_type" add value 'BUY';
  
-- Update create_cashu_receive_quote to handle TRANSFER and BUY receive types.
-- TRANSFER → TRANSFER (PENDING) — payment is app-initiated.
-- BUY → BUY (DRAFT) — invoice may never be paid.
create or replace function "wallet"."create_cashu_receive_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "wallet"."currency",
  "p_expires_at" timestamp with time zone,
  "p_locking_derivation_path" "text",
  "p_receive_type" "wallet"."receive_quote_type",
  "p_encrypted_data" "text",
  "p_quote_id_hash" "text",
  "p_payment_hash" "text"
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
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'CASHU_LIGHTNING'
    when 'TRANSFER' then 'TRANSFER'
    when 'BUY' then 'BUY'
    when 'CASHU_TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, TRANSFER, BUY, CASHU_TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- CASHU_TOKEN and TRANSFER transactions start as PENDING because the payment
  -- is initiated by the app (not waiting on an external payer).
  -- LIGHTNING and BUY start as DRAFT because the invoice may never be paid.
  v_transaction_state := case p_receive_type
    when 'CASHU_TOKEN' then 'PENDING'
    when 'TRANSFER' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    jsonb_build_object('paymentHash', p_payment_hash)
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

-- Update create_spark_receive_quote to handle TRANSFER and BUY receive types.
-- TRANSFER → TRANSFER (PENDING) — payment is app-initiated.
-- BUY → BUY (DRAFT) — invoice may never be paid.
create or replace function "wallet"."create_spark_receive_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "wallet"."currency",
  "p_payment_hash" "text",
  "p_expires_at" timestamp with time zone,
  "p_spark_id" "text",
  "p_receiver_identity_pubkey" "text",
  "p_receive_type" "wallet"."receive_quote_type",
  "p_encrypted_data" "text"
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
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'SPARK_LIGHTNING'
    when 'TRANSFER' then 'TRANSFER'
    when 'BUY' then 'BUY'
    when 'CASHU_TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, TRANSFER, BUY, CASHU_TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- CASHU_TOKEN and TRANSFER transactions start as PENDING because the payment
  -- is initiated by the app (not waiting on an external payer).
  -- LIGHTNING and BUY start as DRAFT because the invoice may never be paid.
  v_transaction_state := case p_receive_type
    when 'CASHU_TOKEN' then 'PENDING'
    when 'TRANSFER' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    jsonb_build_object('sparkId', p_spark_id, 'paymentHash', p_payment_hash)
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
