-- Migration: Add Spark Send Quotes
--
-- Purpose:
--   Create spark_send_quotes table to track lightning send requests via Spark
--   Mirrors the spark_receive_quotes pattern for tracking outgoing payments
--
-- Affected Objects:
--   - wallet.spark_send_quotes (new table)
--   - wallet.create_spark_send_quote (new function)
--   - wallet.complete_spark_send_quote (new function)
--   - wallet.fail_spark_send_quote (new function)
--   - wallet.broadcast_spark_send_quotes_changes (new function)
--
-- Changes:
--   1. Create spark_send_quotes table with RLS enabled
--   2. Add RLS policy for authenticated users to CRUD their own records
--   3. Create functions to manage spark send quote lifecycle
--   4. Create broadcast trigger for realtime updates

-- =============================================================================
-- Table: spark_send_quotes
-- =============================================================================

create table wallet.spark_send_quotes (
  id uuid not null default gen_random_uuid(),
  state text not null default 'PENDING',
  created_at timestamp with time zone not null default now(),
  payment_request text not null,
  payment_hash text not null,
  payment_preimage text,
  amount numeric not null,
  fee numeric not null,
  currency text not null,
  unit text not null,
  spark_id text not null,
  spark_transfer_id text,
  failure_reason text,
  user_id uuid not null,
  account_id uuid not null,
  transaction_id uuid not null,
  version integer not null default 0,
  constraint spark_send_quotes_pkey primary key (id),
  constraint spark_send_quotes_user_id_fkey foreign key (user_id) references wallet.users(id),
  constraint spark_send_quotes_account_id_fkey foreign key (account_id) references wallet.accounts(id),
  constraint spark_send_quotes_transaction_id_fkey foreign key (transaction_id) references wallet.transactions(id),
  constraint spark_send_quotes_state_check check (state in ('PENDING', 'COMPLETED', 'FAILED')),
  constraint spark_send_quotes_completed_state_check check (
    state != 'COMPLETED' or (payment_preimage is not null and spark_transfer_id is not null)
  )
);

comment on table wallet.spark_send_quotes is 'Tracks lightning send requests created via Spark wallet. Each quote represents a lightning payment in progress.';

-- Create unique constraint on spark_id to prevent duplicate quotes
create unique index spark_send_quotes_spark_id_unique on wallet.spark_send_quotes using btree (spark_id);

-- Create unique index on spark_transfer_id (only for non-null values)
create unique index spark_send_quotes_spark_transfer_id_unique on wallet.spark_send_quotes using btree (spark_transfer_id) where spark_transfer_id is not null;

-- Create index for efficient lookup of pending quotes
create index idx_spark_send_quotes_state_user_id on wallet.spark_send_quotes using btree (user_id, state) where state = 'PENDING';

-- Enable row level security
alter table wallet.spark_send_quotes enable row level security;

-- =============================================================================
-- RLS Policies for spark_send_quotes
-- =============================================================================

-- Policy: Users can only access their own quotes (all operations)
create policy "Users can access their own spark send quotes"
on wallet.spark_send_quotes
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- =============================================================================
-- Broadcast Function and Trigger
-- =============================================================================

create or replace function wallet.broadcast_spark_send_quotes_changes()
returns trigger
language plpgsql
as $function$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'SPARK_SEND_QUOTE_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'SPARK_SEND_QUOTE_UPDATED';
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
    raise warning 'Error broadcasting spark send quote changes: %', sqlerrm;
    return null;
end;
$function$;

create constraint trigger broadcast_spark_send_quotes_changes_trigger
  after insert or update
  on wallet.spark_send_quotes
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_spark_send_quotes_changes();

-- =============================================================================
-- Function: create_spark_send_quote
-- Creates a new spark send quote and associated transaction record
-- =============================================================================

create or replace function wallet.create_spark_send_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_fee numeric,
  p_currency text,
  p_unit text,
  p_payment_request text,
  p_payment_hash text,
  p_spark_id text,
  p_encrypted_transaction_details text
)
returns wallet.spark_send_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_id uuid;
  v_quote wallet.spark_send_quotes;
begin
  -- Create pending transaction record
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

  -- Create spark send quote record
  insert into wallet.spark_send_quotes (
    user_id,
    account_id,
    amount,
    fee,
    currency,
    unit,
    payment_request,
    payment_hash,
    spark_id,
    transaction_id,
    state
  ) values (
    p_user_id,
    p_account_id,
    p_amount,
    p_fee,
    p_currency,
    p_unit,
    p_payment_request,
    p_payment_hash,
    p_spark_id,
    v_transaction_id,
    'PENDING'
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

-- =============================================================================
-- Function: complete_spark_send_quote
-- Marks a spark send quote as completed and updates the transaction
-- =============================================================================

create or replace function wallet.complete_spark_send_quote(
  p_quote_id uuid,
  p_payment_preimage text,
  p_spark_transfer_id text,
  p_fee numeric,
  p_encrypted_transaction_details text
)
returns wallet.spark_send_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  -- Get the quote with a lock to prevent race conditions
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  -- If already completed, return the quote (idempotent)
  if v_quote.state = 'COMPLETED' then
    return v_quote;
  end if;

  -- Only PENDING quotes can be completed
  if v_quote.state != 'PENDING' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in PENDING state.', v_quote.state);
  end if;

  -- Update quote to completed state
  update wallet.spark_send_quotes
  set
    state = 'COMPLETED',
    payment_preimage = p_payment_preimage,
    spark_transfer_id = p_spark_transfer_id,
    fee = p_fee,
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
-- Function: fail_spark_send_quote
-- Marks a spark send quote as failed and updates the transaction
-- =============================================================================

create or replace function wallet.fail_spark_send_quote(
  p_quote_id uuid,
  p_failure_reason text
)
returns wallet.spark_send_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  -- Get the quote with a lock to prevent race conditions
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  -- If already failed, return the quote (idempotent)
  if v_quote.state = 'FAILED' then
    return v_quote;
  end if;

  -- Only PENDING quotes can be failed
  if v_quote.state != 'PENDING' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to fail quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in PENDING state.', v_quote.state);
  end if;

  -- Update quote to failed state
  update wallet.spark_send_quotes
  set
    state = 'FAILED',
    failure_reason = p_failure_reason,
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

-- =============================================================================
-- Cron Jobs: Cleanup spark quotes
-- =============================================================================

-- Cleanup expired and paid spark receive quotes every day at midnight
select cron.schedule('cleanup-spark-receive-quotes', '0 0 * * *', $$
  DELETE FROM wallet.spark_receive_quotes
  WHERE state IN ('EXPIRED', 'PAID') AND created_at < NOW() - INTERVAL '1 day';
$$);

-- Cleanup completed and failed spark send quotes every day at midnight
select cron.schedule('cleanup-spark-send-quotes', '0 0 * * *', $$
  DELETE FROM wallet.spark_send_quotes
  WHERE state IN ('COMPLETED', 'FAILED') AND created_at < NOW() - INTERVAL '1 day';
$$);
