-- Migration: Add minting_fee field to cashu_receive_quotes table
-- Purpose: Add optional minting_fee column to track the fee charged by the mint to mint ecash.
-- Affected tables: wallet.cashu_receive_quotes
-- Affected functions: wallet.create_cashu_receive_quote

-- Add minting_fee column to cashu_receive_quotes table
-- This column stores the optional fee that the mint charges to mint ecash.
alter table wallet.cashu_receive_quotes
add column minting_fee numeric default null;

comment on column wallet.cashu_receive_quotes.minting_fee is 'Optional fee that the mint charges to mint ecash. This amount is added to the payment request amount.';

drop function wallet.create_cashu_receive_quote(uuid, uuid, numeric, text, text, text, text, timestamp with time zone, text, text, text, text, text);

-- Update the create_cashu_receive_quote function to accept optional minting_fee parameter
create or replace function wallet.create_cashu_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_unit text,
  p_quote_id text,
  p_payment_request text,
  p_expires_at timestamp with time zone,
  p_state text,
  p_locking_derivation_path text,
  p_receive_type text,
  p_encrypted_transaction_details text,
  p_description text default null::text,
  p_minting_fee numeric default null
)
returns wallet.cashu_receive_quotes
language plpgsql
as $function$
declare
  v_transaction_type text;
  v_transaction_state text;
  v_transaction_id uuid;
  v_quote wallet.cashu_receive_quotes;
begin
  -- Map receive type to transaction type
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'CASHU_LIGHTNING'
    when 'TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception 
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- We create token receives as pending because the lightning payment on the sender
  -- side will be triggered by the receiver, so we know it should get paid.
  -- For lightning, we create a draft transaction record because its not guaranteed that
  -- the invoice will ever be paid.
  v_transaction_state := case v_transaction_type
    when 'CASHU_TOKEN' then 'PENDING'
    else 'DRAFT'
  end;

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
    p_encrypted_transaction_details
  ) returning id into v_transaction_id;

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
    type,
    minting_fee
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
    p_receive_type,
    p_minting_fee
  ) returning * into v_quote;

  return v_quote;
end;
$function$;