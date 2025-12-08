-- Migration: Add Spark Receive Quotes
--
-- Purpose:
--   Create spark_receive_quotes table to track lightning receive requests via Spark
--   Similar to cashu_receive_quotes but for Spark wallet accounts
--
-- Affected Objects:
--   - wallet.spark_receive_quotes (new table)
--   - wallet.transactions (alter table to add transaction_details column)
--   - wallet.create_spark_receive_quote (new function)
--   - wallet.complete_spark_receive_quote (new function)
--   - wallet.expire_spark_receive_quote (new function)
--   - wallet.broadcast_spark_receive_quotes_changes (new function)
--
-- Changes:
--   1. Add transaction_details jsonb column to transactions table
--   2. Add index on transaction_details->>'sparkTransferId' for SPARK_LIGHTNING transactions
--   3. Create spark_receive_quotes table with RLS enabled
--   4. Add RLS policy for authenticated users to CRUD their own records
--   5. Create functions to manage spark receive quote lifecycle
--   6. Create broadcast trigger for realtime updates

-- =============================================================================
-- Alter: transactions table - add transaction_details column
-- =============================================================================

-- Add optional transaction_details jsonb column for non-encrypted, indexable metadata
alter table wallet.transactions add column if not exists transaction_details jsonb;

comment on column wallet.transactions.transaction_details is 'Optional JSONB column for non-encrypted, indexable transaction-type-specific details. For SPARK_LIGHTNING transactions, contains { sparkTransferId: string }.';

-- Create partial index on sparkTransferId for SPARK_LIGHTNING transactions
create index idx_transactions_spark_transfer_id
  on wallet.transactions using btree ((transaction_details->>'sparkTransferId'))
  where type = 'SPARK_LIGHTNING' and transaction_details->>'sparkTransferId' is not null;

-- =============================================================================
-- Table: spark_receive_quotes
-- =============================================================================

create table wallet.spark_receive_quotes (
  id uuid not null default gen_random_uuid(),
  type text not null,
  state text not null default 'UNPAID',
  created_at timestamp with time zone not null default now(),
  expires_at timestamp with time zone not null,
  payment_request text not null,
  payment_preimage text,
  payment_hash text not null,
  amount numeric not null,
  currency text not null,
  unit text not null,
  spark_id text not null,
  spark_transfer_id text,
  receiver_identity_pubkey text,
  user_id uuid not null,
  account_id uuid not null,
  transaction_id uuid not null,
  version integer not null default 0,
  constraint spark_receive_quotes_pkey primary key (id),
  constraint spark_receive_quotes_user_id_fkey foreign key (user_id) references wallet.users(id),
  constraint spark_receive_quotes_account_id_fkey foreign key (account_id) references wallet.accounts(id),
  constraint spark_receive_quotes_transaction_id_fkey foreign key (transaction_id) references wallet.transactions(id),
  constraint spark_receive_quotes_type_check check (type in ('LIGHTNING', 'CASHU_TOKEN')),
  constraint spark_receive_quotes_state_check check (state in ('UNPAID', 'EXPIRED', 'PAID')),
  constraint spark_receive_quotes_paid_state_check check (
    state != 'PAID' or (payment_preimage is not null and spark_transfer_id is not null)
  )
);

comment on table wallet.spark_receive_quotes is 'Tracks lightning receive requests created via Spark wallet. Each quote represents a lightning invoice waiting to be paid.';

-- Create unique constraint on spark_id to prevent duplicate quotes
create unique index spark_receive_quotes_spark_id_unique on wallet.spark_receive_quotes using btree (spark_id);

-- Create unique index on spark_transfer_id (only for non-null values)
create unique index spark_receive_quotes_spark_transfer_id_unique on wallet.spark_receive_quotes using btree (spark_transfer_id) where spark_transfer_id is not null;

-- Create index for efficient lookup of pending quotes
create index idx_spark_receive_quotes_state_user_id on wallet.spark_receive_quotes using btree (user_id, state) where state = 'UNPAID';

-- Enable row level security
alter table wallet.spark_receive_quotes enable row level security;

-- =============================================================================
-- RLS Policies for spark_receive_quotes
-- =============================================================================

-- Policy: Users can only access their own quotes (all operations)
create policy "Users can access their own spark receive quotes"
on wallet.spark_receive_quotes
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- =============================================================================
-- Broadcast Function and Trigger
-- =============================================================================

create or replace function wallet.broadcast_spark_receive_quotes_changes()
returns trigger
language plpgsql
as $function$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'SPARK_RECEIVE_QUOTE_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'SPARK_RECEIVE_QUOTE_UPDATED';
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    to_jsonb(new),
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;

exception
  when others then
    raise warning 'Error broadcasting spark receive quote changes: %', sqlerrm;
    return null;
end;
$function$;

create constraint trigger broadcast_spark_receive_quotes_changes_trigger
  after insert or update
  on wallet.spark_receive_quotes
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_spark_receive_quotes_changes();

-- =============================================================================
-- Function: create_spark_receive_quote
-- Creates a new spark receive quote and associated transaction record
-- =============================================================================

create or replace function wallet.create_spark_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_unit text,
  p_payment_request text,
  p_payment_hash text,
  p_expires_at timestamp with time zone,
  p_spark_id text,
  p_receiver_identity_pubkey text,
  p_encrypted_transaction_details text,
  p_receive_type text
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_state text;
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

  -- Create spark receive quote record
  insert into wallet.spark_receive_quotes (
    user_id,
    account_id,
    type,
    amount,
    currency,
    unit,
    payment_request,
    payment_hash,
    expires_at,
    spark_id,
    receiver_identity_pubkey,
    transaction_id,
    state
  ) values (
    p_user_id,
    p_account_id,
    p_receive_type,
    p_amount,
    p_currency,
    p_unit,
    p_payment_request,
    p_payment_hash,
    p_expires_at,
    p_spark_id,
    p_receiver_identity_pubkey,
    v_transaction_id,
    'UNPAID'
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

-- =============================================================================
-- Function: complete_spark_receive_quote
-- Marks a spark receive quote as paid and updates the transaction
-- =============================================================================

create or replace function wallet.complete_spark_receive_quote(
  p_quote_id uuid,
  p_payment_preimage text,
  p_spark_transfer_id text,
  p_encrypted_transaction_details text
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
begin
  -- Get the quote with a lock to prevent race conditions
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

  -- If already paid, return the quote (idempotent)
  if v_quote.state = 'PAID' then
    return v_quote;
  end if;

  -- Only UNPAID quotes can be completed
  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in UNPAID state.', v_quote.state);
  end if;

  -- Update quote to paid state
  update wallet.spark_receive_quotes
  set
    state = 'PAID',
    payment_preimage = p_payment_preimage,
    spark_transfer_id = p_spark_transfer_id,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  -- Update transaction to completed state
  update wallet.transactions
  set
    state = 'COMPLETED',
    acknowledgment_status = 'pending',
    completed_at = now(),
    encrypted_transaction_details = p_encrypted_transaction_details,
    transaction_details = jsonb_build_object('sparkTransferId', p_spark_transfer_id)
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

-- =============================================================================
-- Function: expire_spark_receive_quote
-- Marks a spark receive quote as expired and updates the transaction
-- =============================================================================

create or replace function wallet.expire_spark_receive_quote(
  p_quote_id uuid
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
  v_now timestamp with time zone;
begin
  -- Get the quote with a lock to prevent race conditions
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

  -- If already expired, return the quote (idempotent)
  if v_quote.state = 'EXPIRED' then
    return v_quote;
  end if;

  -- Only UNPAID quotes can be expired
  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to expire quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in UNPAID state.', v_quote.state);
  end if;

  v_now := now();

  if v_quote.expires_at > v_now then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to expire quote with id %s.', v_quote.id),
        detail = format('Quote has not expired at %s. Expires at %s.', v_now, v_quote.expires_at);
  end if;

  -- Update quote to expired state
  update wallet.spark_receive_quotes
  set
    state = 'EXPIRED',
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  -- Update transaction to failed state
  update wallet.transactions
  set
    state = 'FAILED',
    failed_at = now()
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;
