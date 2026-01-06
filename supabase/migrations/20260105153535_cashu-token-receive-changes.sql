-- =============================================================================
-- Alter: cashu_receive_quotes table - add cashu_token_melt_initiated column
-- =============================================================================

alter table wallet.cashu_receive_quotes
  add column if not exists cashu_token_melt_initiated boolean;

comment on column wallet.cashu_receive_quotes.cashu_token_melt_initiated is 'Whether the melt has been initiated on the source mint. Required (NOT NULL) when type is CASHU_TOKEN, NULL otherwise.';

-- Add constraint: cashu_token_melt_initiated must be NOT NULL when type is CASHU_TOKEN
alter table wallet.cashu_receive_quotes
  add constraint cashu_receive_quotes_cashu_token_melt_initiated_check
  check (type != 'CASHU_TOKEN' or cashu_token_melt_initiated is not null);

-- =============================================================================
-- Alter: spark_receive_quotes table - add failure_reason and cashu_token_melt_initiated columns and add constraints
-- =============================================================================

alter table wallet.spark_receive_quotes
  add column if not exists failure_reason text;

comment on column wallet.spark_receive_quotes.failure_reason is 'Reason for the failure when state is FAILED. NULL for other states.';

alter table wallet.spark_receive_quotes
  add column if not exists cashu_token_melt_initiated boolean;

comment on column wallet.spark_receive_quotes.cashu_token_melt_initiated is 'Whether the melt has been initiated on the source mint. Required (NOT NULL) when type is CASHU_TOKEN, NULL otherwise.';

-- Drop the existing state constraint
alter table wallet.spark_receive_quotes
  drop constraint if exists spark_receive_quotes_state_check;

-- Add new state constraint that includes FAILED
alter table wallet.spark_receive_quotes
  add constraint spark_receive_quotes_state_check
  check (state in ('UNPAID', 'EXPIRED', 'PAID', 'FAILED'));

-- Add constraint: cashu_token_melt_initiated must be NOT NULL when type is CASHU_TOKEN
alter table wallet.spark_receive_quotes
  add constraint spark_receive_quotes_cashu_token_melt_initiated_check
  check (type != 'CASHU_TOKEN' or cashu_token_melt_initiated is not null);

-- =============================================================================
-- Function: create_cashu_receive_quote
-- Updated to accept CASHU_TOKEN instead of TOKEN for p_receive_type
-- Updated to set cashu_token_melt_initiated to false for CASHU_TOKEN type
-- =============================================================================

drop function if exists wallet.create_cashu_receive_quote(uuid, uuid, text, timestamp with time zone, text, text, text, text, text, text);

create or replace function wallet.create_cashu_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency text,
  p_expires_at timestamp with time zone,
  p_locking_derivation_path text,
  p_receive_type text,
  p_encrypted_transaction_details text,
  p_encrypted_data text,
  p_quote_id_hash text,
  p_payment_hash text
)
returns wallet.cashu_receive_quotes
language plpgsql
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
-- Function: fail_spark_receive_quote
-- Marks a spark receive quote as failed and updates the transaction
-- =============================================================================

create or replace function wallet.fail_spark_receive_quote(
  p_quote_id uuid,
  p_failure_reason text
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
begin
  -- Lock and fetch the quote
  select * into v_quote
  from wallet.spark_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  -- Idempotent: if already failed, return current state
  if v_quote.state = 'FAILED' then
    return v_quote;
  end if;

  -- Can only fail quotes that are in UNPAID state
  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot fail spark receive quote with id %s.', p_quote_id),
        detail = format('Found state %s, but must be UNPAID.', v_quote.state);
  end if;

  -- Update the quote to FAILED state
  update wallet.spark_receive_quotes
  set
    state = 'FAILED',
    failure_reason = p_failure_reason,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  -- Update the corresponding transaction to FAILED
  update wallet.transactions
  set
    state = 'FAILED',
    failed_at = now()
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

-- =============================================================================
-- Function: create_spark_receive_quote
-- Updated to set cashu_token_melt_initiated to false for CASHU_TOKEN type
-- =============================================================================

create or replace function wallet.create_spark_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency text,
  p_payment_hash text,
  p_expires_at timestamp with time zone,
  p_spark_id text,
  p_receiver_identity_pubkey text,
  p_encrypted_transaction_details text,
  p_receive_type text,
  p_encrypted_data text
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_state text;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_quote wallet.spark_receive_quotes;
begin
  -- We create cashu token receive transactions as pending because the lightning payment is initiated
  -- by the receiver (Agicash app does it automatically), so we know it will get paid. For lightning,
  -- we create a draft transaction record because it's not guaranteed that the invoice will ever be paid.
  v_transaction_state := case p_receive_type
    when 'LIGHTNING' then 'DRAFT'
    when 'CASHU_TOKEN' then 'PENDING'
    else null
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
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    'SPARK_LIGHTNING',
    v_transaction_state,
    p_currency,
    p_encrypted_transaction_details
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

-- =============================================================================
-- Function: mark_cashu_receive_quote_cashu_token_melt_initiated
-- Marks the melt as initiated for a CASHU_TOKEN type cashu receive quote.
-- =============================================================================

create or replace function wallet.mark_cashu_receive_quote_cashu_token_melt_initiated(
  p_quote_id uuid
)
returns wallet.cashu_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
begin
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

  if v_quote.cashu_token_melt_initiated = true then
    return v_quote;
  end if;

  if v_quote.type != 'CASHU_TOKEN' then
    raise exception
      using
        hint = 'INVALID_OPERATION',
        message = format('Cannot mark cashu token melt initiated for cashu receive quote with id %s.', p_quote_id),
        detail = format('Found type %s, but must be CASHU_TOKEN.', v_quote.type);
  end if;

  update wallet.cashu_receive_quotes
  set
    cashu_token_melt_initiated = true,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$function$;

-- =============================================================================
-- Function: mark_spark_receive_quote_cashu_token_melt_initiated
-- Marks the melt as initiated for a CASHU_TOKEN type spark receive quote.
-- =============================================================================

create or replace function wallet.mark_spark_receive_quote_cashu_token_melt_initiated(
  p_quote_id uuid
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
begin
  select * into v_quote
  from wallet.spark_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.type != 'CASHU_TOKEN' then
    raise exception
      using
        hint = 'INVALID_OPERATION',
        message = format('Cannot mark cashu token melt initiated for spark receive quote with id %s.', p_quote_id),
        detail = format('Found type %s, but must be CASHU_TOKEN.', v_quote.type);
  end if;

  if v_quote.cashu_token_melt_initiated = true then
    return v_quote;
  end if;

  update wallet.spark_receive_quotes
  set
    cashu_token_melt_initiated = true,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$function$;
