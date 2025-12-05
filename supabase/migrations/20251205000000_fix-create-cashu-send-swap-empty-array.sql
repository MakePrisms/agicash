-- Migration: Fix create_cashu_send_swap function for empty change_output_amounts
-- 
-- Bug Fix:
--   In PostgreSQL, array_length([], 1) returns NULL, not 0.
--   When p_change_output_amounts is an empty array [], the calculation:
--     v_number_of_outputs := array_length(p_send_output_amounts, 1) + array_length(p_change_output_amounts, 1)
--   Results in NULL because any arithmetic with NULL produces NULL.
--   This causes jsonb_set() to return NULL, violating the NOT NULL constraint on details.
--
-- Fix:
--   Wrap array_length calls with coalesce(..., 0) to handle empty arrays.

create or replace function wallet.create_cashu_send_swap(
  p_user_id uuid,
  p_account_id uuid,
  p_amount_requested numeric,
  p_amount_to_send numeric,
  p_input_proofs uuid[],
  p_currency text, 
  p_unit text, 
  p_input_amount numeric,
  p_send_swap_fee numeric,
  p_receive_swap_fee numeric,
  p_total_amount numeric,
  p_encrypted_transaction_details text,
  p_token_hash text default null::text,
  p_keyset_id text default null::text,
  p_send_output_amounts integer[] default null::integer[],
  p_change_output_amounts integer[] default null::integer[]
) returns wallet.create_cashu_send_swap_result
language plpgsql
as $function$
declare
  v_state text;
  v_keyset_id text; -- We are declaring this variable instead of storing the value directly from p_keyset_id to prevent it being added to db for the state it shouldn't be added for.
  v_number_of_outputs integer;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_keyset_counter integer;
  v_transaction_id uuid;
  v_swap wallet.cashu_send_swaps;
  v_reserved_proofs wallet.cashu_proofs[];
begin
  -- If the input amount is equal to the amount to send, there is no need to swap the input proofs so the swap is ready to be committed (set to PENDING).
  if p_input_amount = p_amount_to_send then
    v_state := 'PENDING';
  else
    v_state := 'DRAFT';
  end if;

  if v_state = 'PENDING' then
      -- Incrementing just the account version because no keyset counter is being updated and we still need to reserve the proofs.
      update wallet.accounts a
      set version = version + 1
      where a.id = p_account_id
      returning * into v_account;

  elsif v_state = 'DRAFT' then
      if p_keyset_id is null or trim(p_keyset_id) = '' then
        raise exception
          using
            hint = 'INVALID_ARGUMENT',
            message = 'When state is DRAFT, p_keyset_id must be provided and not empty.',
            detail = format('Value provided: %s', p_keyset_id);
      end if;

      if p_send_output_amounts is null
        or array_length(p_send_output_amounts, 1) is null
        or exists (select 1 from unnest(p_send_output_amounts) as amount where amount <= 0)
      then
        raise exception
          using
            hint = 'INVALID_ARGUMENT',
            message = 'When state is DRAFT, p_send_output_amounts must be a non-null, non-empty array of integers greater than 0.',
            detail = format('Value provided: %s', p_send_output_amounts);
      end if;

      if p_change_output_amounts is not null
        and array_length(p_change_output_amounts, 1) is not null
        and exists (select 1 from unnest(p_change_output_amounts) as amount where amount <= 0)
      then
        raise exception
          using
            hint = 'INVALID_ARGUMENT',
            message = 'When state is DRAFT and p_change_output_amounts is provided, all values must be integers greater than 0.',
            detail = format('Value provided: %s', p_change_output_amounts);
      end if;

      v_keyset_id := p_keyset_id;
      v_number_of_outputs := array_length(p_send_output_amounts, 1) + coalesce(array_length(p_change_output_amounts, 1), 0);

      update wallet.accounts a
      set 
        details = jsonb_set(
          details, 
          array['keyset_counters', v_keyset_id], 
          to_jsonb(
            coalesce((details->'keyset_counters'->>v_keyset_id)::integer, 0) + v_number_of_outputs
          ), 
          true
        ),
        version = version + 1
      where a.id = p_account_id
      returning * into v_account;

      -- Keyset counter value before the increment (This is the value used for this swap)
      v_keyset_counter := coalesce((v_account.details->'keyset_counters'->>v_keyset_id)::integer, 0) - v_number_of_outputs;
  end if;

  insert into wallet.transactions (
      user_id,
      account_id,
      direction,
      type,
      state,
      currency,
      pending_at,
      encrypted_transaction_details
  ) values (
      p_user_id,
      p_account_id,
      'SEND',
      'CASHU_TOKEN',
      'PENDING',
      p_currency,
      now(),
      p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_swaps (
      user_id,
      account_id,
      transaction_id,
      amount_requested,
      amount_to_send,
      send_swap_fee,
      receive_swap_fee,
      total_amount,
      input_amount,
      keyset_id,
      keyset_counter,
      send_output_amounts,
      change_output_amounts,
      token_hash,
      currency,
      unit,
      state
  ) values (
      p_user_id,
      p_account_id,
      v_transaction_id,
      p_amount_requested,
      p_amount_to_send,
      p_send_swap_fee,
      p_receive_swap_fee,
      p_total_amount,
      p_input_amount,
      v_keyset_id,
      v_keyset_counter,
      p_send_output_amounts,
      p_change_output_amounts,
      p_token_hash,
      p_currency,
      p_unit,
      v_state
  ) returning * into v_swap;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set 
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_swap_id = v_swap.id,
      version = version + 1
    where id = ANY(p_input_proofs) and account_id = p_account_id and state = 'UNSPENT'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_reserved_proofs
  from updated_proofs;

  -- Verify all proofs were successfully reserved. Proof might not be successfully reserved if it was modified by another transaction and thus is not UNSPENT anymore.
  if coalesce(array_length(v_reserved_proofs, 1), 0) != array_length(p_input_proofs, 1) then
    raise exception using
      hint = 'CONCURRENCY_ERROR',
      message = format('Failed to reserve proofs for cashu send swap with id %s.', v_swap.id),
      detail = 'One or more proofs were modified by another transaction and could not be reserved.';
  end if;  

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_swap, v_account_with_proofs, v_reserved_proofs);
end;
$function$;

