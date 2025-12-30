-- Migration: Add FAILED state to spark_receive_quotes
--
-- Purpose:
--   Add FAILED state support for spark receive quotes to handle failed melt operations
--   during cross-account cashu token receives. This allows the system to properly
--   track and recover from melt failures.
--
-- Affected Objects:
--   - wallet.spark_receive_quotes (alter table to add failure_reason column and update state constraint)
--   - wallet.fail_spark_receive_quote (new function)
--
-- Changes:
--   1. Add failure_reason column to spark_receive_quotes table
--   2. Update state check constraint to include 'FAILED'
--   3. Create fail_spark_receive_quote function

-- =============================================================================
-- Alter: spark_receive_quotes table - add failure_reason column
-- =============================================================================

-- Add failure_reason column for storing the reason when a quote fails
alter table wallet.spark_receive_quotes
  add column if not exists failure_reason text;

comment on column wallet.spark_receive_quotes.failure_reason is 'Reason for the failure when state is FAILED. NULL for other states.';

-- =============================================================================
-- Alter: spark_receive_quotes table - update state constraint
-- =============================================================================

-- Drop the existing state constraint
alter table wallet.spark_receive_quotes
  drop constraint if exists spark_receive_quotes_state_check;

-- Add new state constraint that includes FAILED
alter table wallet.spark_receive_quotes
  add constraint spark_receive_quotes_state_check
  check (state in ('UNPAID', 'EXPIRED', 'PAID', 'FAILED'));

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

