-- Migration: Add expires_at column to spark_send_quotes
--
-- Purpose:
--   Add an optional expires_at timestamp column to track when spark send quotes expire.
--   This allows the system to know when a quote is no longer valid.
--
-- Affected Objects:
--   - wallet.spark_send_quotes (modified table)
--   - wallet.create_spark_send_quote (updated function)
--
-- Changes:
--   1. Add expires_at column (nullable)
--   2. Update create_spark_send_quote function to accept expires_at parameter

-- =============================================================================
-- Step 1: Add expires_at column (nullable)
-- =============================================================================

alter table wallet.spark_send_quotes
  add column expires_at timestamp with time zone;

comment on column wallet.spark_send_quotes.expires_at is 'Timestamp when this send quote expires and is no longer valid for payment.';

-- =============================================================================
-- Step 2: Update create_spark_send_quote function to accept expires_at
-- Drop the old function first since we're changing the signature (adding a parameter).
-- PostgreSQL identifies functions by name + parameter types, so CREATE OR REPLACE
-- would create an overloaded function instead of replacing the existing one.
-- =============================================================================

drop function if exists wallet.create_spark_send_quote(
  uuid, uuid, numeric, numeric, text, text, text, text, boolean, text
);

create or replace function wallet.create_spark_send_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_estimated_fee numeric,
  p_currency text,
  p_unit text,
  p_payment_request text,
  p_payment_hash text,
  p_payment_request_is_amountless boolean,
  p_encrypted_transaction_details text,
  p_expires_at timestamp with time zone default null
)
returns wallet.spark_send_quotes
language plpgsql
as $function$
declare
  v_transaction_id uuid;
  v_quote wallet.spark_send_quotes;
begin
  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    pending_at
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'SPARK_LIGHTNING',
    'PENDING',
    p_currency,
    p_encrypted_transaction_details,
    now()
  ) returning id into v_transaction_id;

  insert into wallet.spark_send_quotes (
    user_id,
    account_id,
    amount,
    estimated_fee,
    currency,
    unit,
    payment_request,
    payment_hash,
    payment_request_is_amountless,
    transaction_id,
    state,
    expires_at
  ) values (
    p_user_id,
    p_account_id,
    p_amount,
    p_estimated_fee,
    p_currency,
    p_unit,
    p_payment_request,
    p_payment_hash,
    p_payment_request_is_amountless,
    v_transaction_id,
    'UNPAID',
    p_expires_at
  ) returning * into v_quote;

  return v_quote;
end;
$function$;
