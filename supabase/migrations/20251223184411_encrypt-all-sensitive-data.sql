-- ++++++++++++++++++++++++++++++++++++
-- Cashu receive quote changes
-- ++++++++++++++++++++++++++++++++++++

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

create or replace function wallet.process_cashu_receive_quote_payment(
  p_quote_id uuid,
  p_keyset_id text, 
  p_output_amounts integer[]
)
returns wallet.cashu_receive_quote_payment_result
language plpgsql
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_number_of_outputs integer;
  v_counter integer;
begin
  if p_keyset_id is null or trim(p_keyset_id) = '' then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_keyset_id must not be null or empty.',
        detail = format('Value provided: %s', p_keyset_id);
  end if;

  if p_output_amounts is null
    or array_length(p_output_amounts, 1) is null
    or exists (select 1 from unnest(p_output_amounts) as amount where amount <= 0)
  then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_output_amounts must be a non-null, non-empty array of integers greater than 0.',
        detail = format('Value provided: %s', p_output_amounts);
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

  v_number_of_outputs := array_length(p_output_amounts, 1);

  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + v_number_of_outputs
      ), 
      true
    ),
    version = version + 1
  where a.id = v_quote.account_id
  returning * into v_account;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - v_number_of_outputs;

  update wallet.cashu_receive_quotes q
  set 
    state = 'PAID',
    keyset_id = p_keyset_id,
    keyset_counter = v_counter,
    output_amounts = p_output_amounts,
    version = version + 1
  where q.id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set state = 'PENDING',
      pending_at = now()
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs);
end;
$function$;


-- ++++++++++++++++++++++++++++++++++++
-- Cashu token swap changes
-- ++++++++++++++++++++++++++++++++++++

create or replace function wallet.create_cashu_token_swap(
  p_token_hash text, 
  p_token_proofs text, 
  p_account_id uuid, 
  p_user_id uuid, 
  p_currency text, 
  p_unit text, 
  p_keyset_id text,
  p_output_amounts integer[],
  p_input_amount numeric,
  p_receive_amount numeric,
  p_fee_amount numeric,
  p_encrypted_transaction_details text,
  p_reversed_transaction_id uuid default null
)
returns wallet.create_cashu_token_swap_result
language plpgsql
as $function$
declare
  v_number_of_outputs integer;
  v_account wallet.accounts;
  v_counter integer;
  v_transaction_id uuid;
  v_token_swap wallet.cashu_token_swaps;
  v_account_with_proofs jsonb;
begin
  if p_output_amounts is null
    or array_length(p_output_amounts, 1) is null
    or exists (select 1 from unnest(p_output_amounts) as amount where amount <= 0)
  then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_output_amounts must be a non-null, non-empty array of integers greater than 0.',
        detail = format('Value provided: %s', p_output_amounts);
  end if;

  v_number_of_outputs := array_length(p_output_amounts, 1);

  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + v_number_of_outputs
      ), 
      true
    ),
    version = version + 1
  where a.id = p_account_id
  returning * into v_account;

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - v_number_of_outputs;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    reversed_transaction_id,
    pending_at,
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    'CASHU_TOKEN',
    'PENDING',
    p_currency,
    p_reversed_transaction_id,
    now(),
    p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_token_swaps (
    token_hash,
    token_proofs,
    account_id,
    user_id,
    currency,
    unit,
    keyset_id,
    keyset_counter,
    output_amounts,
    input_amount,
    receive_amount,
    fee_amount,
    transaction_id
  ) values (
    p_token_hash,
    p_token_proofs,
    p_account_id,
    p_user_id,
    p_currency,
    p_unit,
    p_keyset_id,
    v_counter,
    p_output_amounts,
    p_input_amount,
    p_receive_amount,
    p_fee_amount,
    v_transaction_id
  ) returning * into v_token_swap;

   v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_token_swap, v_account_with_proofs);
end;
$function$;

-- ++++++++++++++++++++++++++++++++++++
-- Cashu send quote changes
-- ++++++++++++++++++++++++++++++++++++

create or replace function wallet.create_cashu_send_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency text,
  p_unit text,
  p_payment_request text,
  p_expires_at timestamp with time zone,
  p_amount_requested numeric,
  p_currency_requested text,
  p_amount_requested_in_msat bigint,
  p_amount_to_receive numeric,
  p_lightning_fee_reserve numeric,
  p_cashu_fee numeric,
  p_quote_id text,
  p_keyset_id text,
  p_number_of_change_outputs integer,
  p_proofs_to_send uuid[],
  p_encrypted_transaction_details text
)
returns wallet.create_cashu_send_quote_result
language plpgsql
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_counter integer;
  v_transaction_id uuid;
  v_reserved_proofs wallet.cashu_proofs[];
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
    'SEND',
    'CASHU_LIGHTNING',
    'PENDING',
    p_currency,
    p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_quotes (
    user_id,
    account_id,
    currency,
    unit,
    payment_request,
    expires_at,
    amount_requested,
    currency_requested,
    amount_requested_in_msat,
    amount_to_receive,
    lightning_fee_reserve,
    cashu_fee,
    quote_id,
    keyset_id,
    keyset_counter,
    number_of_change_outputs,
    transaction_id
  ) values (
    p_user_id,
    p_account_id,
    p_currency,
    p_unit,
    p_payment_request,
    p_expires_at,
    p_amount_requested,
    p_currency_requested,
    p_amount_requested_in_msat,
    p_amount_to_receive,
    p_lightning_fee_reserve,
    p_cashu_fee,
    p_quote_id,
    p_keyset_id,
    v_counter,
    p_number_of_change_outputs,
    v_transaction_id
  )
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set 
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_quote_id = v_quote.id,
      version = version + 1
    where id = ANY(p_proofs_to_send) and account_id = p_account_id and state = 'UNSPENT'
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

create or replace function wallet.complete_cashu_send_quote(
    p_quote_id uuid,
    p_payment_preimage text,
    p_amount_spent numeric,
    p_change_proofs wallet.cashu_proof_input[],
    p_encrypted_transaction_details text
) returns wallet.complete_cashu_send_quote_result
language plpgsql
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_spent_proofs wallet.cashu_proofs[];
  v_change_proofs wallet.cashu_proofs[];
begin
  select * into v_quote
  from wallet.cashu_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'PAID' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_spent_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_quote_id = v_quote.id;

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_change_proofs
    from wallet.cashu_proofs cp
    where cp.cashu_send_quote_id = v_quote.id;

    return (v_quote, v_account_with_proofs, v_spent_proofs, v_change_proofs);
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete cashu send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.cashu_send_quotes
  set state = 'PAID',
      payment_preimage = p_payment_preimage,
      amount_spent = p_amount_spent,
      version = version + 1
  where id = v_quote.id
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_spent_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'SPENT',
        spent_at = now(),
        version = version + 1
    where spending_cashu_send_quote_id = v_quote.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_spent_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as spent, because we are spending the proofs related with spending_cashu_send_quote_id 
  -- only through the quote db functions and those functions are locking the quote for update and thus are synchronized.

  select * into v_account_with_proofs, v_change_proofs
  from wallet.add_cashu_proofs_and_update_account(
    p_change_proofs,
    v_quote.user_id,
    v_quote.account_id,
    p_cashu_send_quote_id => v_quote.id
  );

  update wallet.transactions
  set state = 'COMPLETED',
      completed_at = now(),
      encrypted_transaction_details = p_encrypted_transaction_details
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs, v_spent_proofs, v_change_proofs);
end;
$function$;

-- ++++++++++++++++++++++++++++++++++++
-- Cashu send swap changes
-- ++++++++++++++++++++++++++++++++++++

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

-- ++++++++++++++++++++++++++++++++++++
-- Spark receive quote changes
-- ++++++++++++++++++++++++++++++++++++

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

  if v_quote.state = 'PAID' then
    return v_quote;
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in UNPAID state.', v_quote.state);
  end if;

  update wallet.spark_receive_quotes
  set
    state = 'PAID',
    payment_preimage = p_payment_preimage,
    spark_transfer_id = p_spark_transfer_id,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

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

-- ++++++++++++++++++++++++++++++++++++
-- Spark send quote changes
-- ++++++++++++++++++++++++++++++++++++

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

create or replace function wallet.mark_spark_send_quote_as_pending(
  p_quote_id uuid,
  p_spark_id text,
  p_spark_transfer_id text,
  p_fee numeric,
  p_encrypted_transaction_details text
)
returns wallet.spark_send_quotes
language plpgsql
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Spark send quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state in ('PENDING', 'COMPLETED') then
    return v_quote;
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to mark spark send quote with id %s as pending.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID.', v_quote.state);
  end if;

  update wallet.spark_send_quotes
  set
    state = 'PENDING',
    spark_id = p_spark_id,
    spark_transfer_id = p_spark_transfer_id,
    fee = p_fee,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set transaction_details = jsonb_build_object(
      'sparkId', p_spark_id,
      'sparkTransferId', p_spark_transfer_id
    ),
    encrypted_transaction_details = p_encrypted_transaction_details
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

create or replace function wallet.complete_spark_send_quote(
  p_quote_id uuid,
  p_payment_preimage text,
  p_encrypted_transaction_details text
)
returns wallet.spark_send_quotes
language plpgsql
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Spark send quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'COMPLETED' then
    return v_quote;
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete spark send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.spark_send_quotes
  set
    state = 'COMPLETED',
    payment_preimage = p_payment_preimage,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set
    state = 'COMPLETED',
    acknowledgment_status = 'pending',
    completed_at = now(),
    encrypted_transaction_details = p_encrypted_transaction_details
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;
