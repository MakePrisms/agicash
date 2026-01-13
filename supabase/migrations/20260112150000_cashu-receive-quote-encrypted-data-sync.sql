-- Add missing constraints
alter table wallet.cashu_receive_quotes
  add constraint cashu_receive_quotes_type_check
  check (type in ('LIGHTNING', 'CASHU_TOKEN'));

alter table wallet.cashu_receive_quotes
  add constraint cashu_receive_quotes_state_check
  check (state in ('UNPAID', 'EXPIRED', 'PAID', 'COMPLETED', 'FAILED'));

alter table wallet.cashu_token_swaps
  add constraint cashu_token_swaps_state_check
  check (state in ('PENDING', 'COMPLETED', 'FAILED'));

alter table wallet.cashu_send_quotes
  add constraint cashu_send_quotes_state_check
  check (state in ('UNPAID', 'PENDING', 'EXPIRED', 'FAILED', 'PAID'));


-- =============================================================================
-- Migration: Sync encrypted data between cashu_receive_quotes and transactions
-- =============================================================================
--
-- Purpose:
-- This migration updates the cashu receive quote functions to store the encrypted
-- data in both the cashu_receive_quotes and transactions tables. This ensures
-- that the transaction details are properly encrypted and available for both
-- the quote and transaction records.
--
-- Changes:
-- 1. create_cashu_receive_quote: Remove p_encrypted_transaction_details parameter
--    and store p_encrypted_data in both cashu_receive_quotes.encrypted_data and
--    transactions.encrypted_transaction_details columns.
--
-- 2. process_cashu_receive_quote_payment: Update encrypted data on both
--    cashu_receive_quotes and transactions tables when payment is processed.
--
-- =============================================================================

-- =============================================================================
-- Function: create_cashu_receive_quote
-- Removed p_encrypted_transaction_details parameter.
-- Now stores p_encrypted_data in both cashu_receive_quotes and transactions.
-- =============================================================================

-- Drop the existing function signature to avoid conflicts
drop function if exists wallet.create_cashu_receive_quote(uuid, uuid, text, timestamp with time zone, text, text, text, text, text, text);

create or replace function wallet.create_cashu_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency text,
  p_expires_at timestamp with time zone,
  p_locking_derivation_path text,
  p_receive_type text,
  p_encrypted_data text,
  p_quote_id_hash text,
  p_payment_hash text
)
returns wallet.cashu_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type text;
  v_transaction_state text;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_quote wallet.cashu_receive_quotes;
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

  -- We create token receives as pending because the lightning payment on the sender
  -- side will be triggered by the receiver, so we know it should get paid.
  -- For lightning, we create a draft transaction record because its not guaranteed that
  -- the invoice will ever be paid.
  v_transaction_state := case v_transaction_type
    when 'CASHU_TOKEN' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  -- Store encrypted data in transactions table as encrypted_transaction_details
  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data
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

-- =============================================================================
-- Function: process_cashu_receive_quote_payment
-- Updated to store encrypted data on both cashu_receive_quotes and transactions.
-- =============================================================================

create or replace function wallet.process_cashu_receive_quote_payment(
  p_quote_id uuid,
  p_keyset_id text,
  p_number_of_outputs integer,
  p_encrypted_data text
)
returns wallet.cashu_receive_quote_payment_result
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_counter integer;
begin
  if p_keyset_id is null or trim(p_keyset_id) = '' then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_keyset_id must not be null or empty.',
        detail = format('Value provided: %s', p_keyset_id);
  end if;

  if p_number_of_outputs <= 0 then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_number_of_outputs must be greater than 0.',
        detail = format('Value provided: %s', p_number_of_outputs);
  end if;

  select * into v_quote
  from wallet.cashu_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'PAID' or v_quote.state = 'COMPLETED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    return (v_quote, v_account_with_proofs);
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to process payment for quote with id %s.', v_quote.id),
        detail = format('Quote is not in UNPAID state. Current state: %s.', v_quote.state);
  end if;

  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + p_number_of_outputs
      ), 
      true
    ),
    version = version + 1
  where a.id = v_quote.account_id
  returning * into v_account;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - p_number_of_outputs;

  -- Update cashu_receive_quotes with encrypted data
  update wallet.cashu_receive_quotes q
  set 
    state = 'PAID',
    keyset_id = p_keyset_id,
    keyset_counter = v_counter,
    encrypted_data = p_encrypted_data,
    version = version + 1
  where q.id = p_quote_id
  returning * into v_quote;

  -- Update transactions with encrypted data and state
  update wallet.transactions
  set 
    state = 'PENDING',
    pending_at = now(),
    encrypted_transaction_details = p_encrypted_data
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs);
end;
$function$;
