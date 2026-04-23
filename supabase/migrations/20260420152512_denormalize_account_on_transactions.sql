-- Denormalize account metadata (name, type, purpose) onto transactions so that
-- transaction detail pages don't need to look up the account. This removes a
-- failure mode where expired accounts (filtered out of the active accounts
-- cache) cause transaction detail pages to crash.
--
-- Currency is already denormalized on transactions and unchanged.
--
-- All six transaction-inserting functions are updated here to populate the new
-- denormalized columns: create_cashu_receive_quote, create_spark_receive_quote,
-- create_cashu_send_quote, create_spark_send_quote, create_cashu_receive_swap,
-- and create_cashu_send_swap. If you are adding a new function that inserts
-- into wallet.transactions, remember to populate account_name/type/purpose.
--
-- account_id becomes nullable with ON DELETE SET NULL so accounts can be
-- deleted later without losing transaction history; the denormalized columns
-- preserve what the account was at the time of the transaction.

-- 1. Add nullable columns
alter table wallet.transactions
  add column account_name text,
  add column account_type wallet.account_type,
  add column account_purpose wallet.account_purpose;

-- 2. Backfill from the accounts table via FK join
update wallet.transactions t
set
  account_name = a.name,
  account_type = a.type,
  account_purpose = a.purpose
from wallet.accounts a
where t.account_id = a.id;

-- 3. Enforce NOT NULL now that every row is populated
alter table wallet.transactions
  alter column account_name set not null,
  alter column account_type set not null,
  alter column account_purpose set not null;

-- 4. Update the 4 quote-creation functions to populate the new columns.
--    We use a subquery on wallet.accounts so callers don't need to change.

create or replace function wallet.create_cashu_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency wallet.currency,
  p_expires_at timestamp with time zone,
  p_locking_derivation_path text,
  p_receive_type wallet.receive_quote_type,
  p_encrypted_data text,
  p_quote_id_hash text,
  p_payment_hash text,
  p_purpose wallet.transaction_purpose default 'PAYMENT',
  p_transfer_id uuid default null
)
returns wallet.cashu_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type wallet.transaction_type;
  v_transaction_state wallet.transaction_state;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_transaction_details jsonb;
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

  -- CASHU_TOKEN and TRANSFER transactions start as PENDING because the payment
  -- is initiated by the app (not waiting on an external payer).
  -- LIGHTNING and BUY start as DRAFT because the invoice may never be paid.
  v_transaction_state := case
    when v_transaction_type = 'CASHU_TOKEN' then 'PENDING'
    when p_purpose = 'TRANSFER' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  v_transaction_details := jsonb_build_object('paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    account_name,
    account_type,
    account_purpose,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    purpose
  )
  select
    p_user_id,
    p_account_id,
    a.name,
    a.type,
    a.purpose,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    p_purpose
  from wallet.accounts a
  where a.id = p_account_id
  returning id into v_transaction_id;

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

create or replace function wallet.create_spark_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency wallet.currency,
  p_payment_hash text,
  p_expires_at timestamp with time zone,
  p_spark_id text,
  p_receiver_identity_pubkey text,
  p_receive_type wallet.receive_quote_type,
  p_encrypted_data text,
  p_purpose wallet.transaction_purpose default 'PAYMENT',
  p_transfer_id uuid default null
)
returns wallet.spark_receive_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type wallet.transaction_type;
  v_transaction_state wallet.transaction_state;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_transaction_details jsonb;
  v_quote wallet.spark_receive_quotes;
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'SPARK_LIGHTNING'
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

  -- CASHU_TOKEN and TRANSFER transactions start as PENDING because the payment
  -- is initiated by the app (not waiting on an external payer).
  -- LIGHTNING and BUY start as DRAFT because the invoice may never be paid.
  v_transaction_state := case
    when v_transaction_type = 'CASHU_TOKEN' then 'PENDING'
    when p_purpose = 'TRANSFER' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  v_transaction_details := jsonb_build_object('sparkId', p_spark_id, 'paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    account_name,
    account_type,
    account_purpose,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    purpose
  )
  select
    p_user_id,
    p_account_id,
    a.name,
    a.type,
    a.purpose,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    p_purpose
  from wallet.accounts a
  where a.id = p_account_id
  returning id into v_transaction_id;

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

create or replace function wallet.create_cashu_send_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency wallet.currency,
  p_expires_at timestamp with time zone,
  p_currency_requested wallet.currency,
  p_keyset_id text,
  p_number_of_change_outputs integer,
  p_proofs_to_send uuid[],
  p_encrypted_data text,
  p_quote_id_hash text,
  p_payment_hash text,
  p_purpose wallet.transaction_purpose default 'PAYMENT',
  p_transfer_id uuid default null
)
returns wallet.create_cashu_send_quote_result
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_counter integer;
  v_transaction_id uuid;
  v_transaction_details jsonb;
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

  v_transaction_details := jsonb_build_object('paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    account_name,
    account_type,
    account_purpose,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    purpose
  ) values (
    p_user_id,
    p_account_id,
    v_account.name,
    v_account.type,
    v_account.purpose,
    'SEND',
    'CASHU_LIGHTNING',
    'PENDING',
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    p_purpose
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_quotes (
    user_id,
    account_id,
    currency_requested,
    expires_at,
    keyset_id,
    keyset_counter,
    number_of_change_outputs,
    transaction_id,
    encrypted_data,
    quote_id_hash,
    payment_hash
  ) values (
    p_user_id,
    p_account_id,
    p_currency_requested,
    p_expires_at,
    p_keyset_id,
    v_counter,
    p_number_of_change_outputs,
    v_transaction_id,
    p_encrypted_data,
    p_quote_id_hash,
    p_payment_hash
  )
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows
  -- "returning into" can only be used with a single value so array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_quote_id = v_quote.id,
      version = version + 1
    where id = any(p_proofs_to_send) and account_id = p_account_id and state = 'UNSPENT'
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

create or replace function wallet.create_spark_send_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency wallet.currency,
  p_payment_hash text,
  p_payment_request_is_amountless boolean,
  p_encrypted_data text,
  p_expires_at timestamp with time zone default null::timestamp with time zone,
  p_purpose wallet.transaction_purpose default 'PAYMENT',
  p_transfer_id uuid default null
)
returns wallet.spark_send_quotes
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_id uuid;
  v_transaction_details jsonb;
  v_quote wallet.spark_send_quotes;
begin
  v_transaction_details := jsonb_build_object('paymentHash', p_payment_hash);
  if p_transfer_id is not null then
    v_transaction_details := v_transaction_details || jsonb_build_object('transferId', p_transfer_id);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    account_name,
    account_type,
    account_purpose,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    pending_at,
    purpose
  )
  select
    p_user_id,
    p_account_id,
    a.name,
    a.type,
    a.purpose,
    'SEND',
    'SPARK_LIGHTNING',
    'DRAFT',
    p_currency,
    p_encrypted_data,
    v_transaction_details,
    now(),
    p_purpose
  from wallet.accounts a
  where a.id = p_account_id
  returning id into v_transaction_id;

  insert into wallet.spark_send_quotes (
    user_id,
    account_id,
    payment_hash,
    payment_request_is_amountless,
    transaction_id,
    state,
    expires_at,
    encrypted_data
  ) values (
    p_user_id,
    p_account_id,
    p_payment_hash,
    p_payment_request_is_amountless,
    v_transaction_id,
    'UNPAID',
    p_expires_at,
    p_encrypted_data
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

-- 5. Update the 2 swap-creation functions to populate the new columns.
--    v_account is already populated from the UPDATE ... RETURNING * earlier in
--    each function body, so we reference it directly in the values clause.

create or replace function wallet.create_cashu_receive_swap(
  p_token_hash text,
  p_account_id uuid,
  p_user_id uuid,
  p_currency wallet.currency,
  p_keyset_id text,
  p_number_of_outputs integer,
  p_encrypted_data text,
  p_reversed_transaction_id uuid default null::uuid
)
returns wallet.create_cashu_receive_swap_result
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account wallet.accounts;
  v_counter integer;
  v_transaction_id uuid;
  v_receive_swap wallet.cashu_receive_swaps;
  v_account_with_proofs jsonb;
begin
  if p_number_of_outputs <= 0 then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_number_of_outputs must be greater than 0.',
        detail = format('Value provided: %s', p_number_of_outputs);
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
  where a.id = p_account_id
  returning * into v_account;

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - p_number_of_outputs;

  insert into wallet.transactions (
    user_id,
    account_id,
    account_name,
    account_type,
    account_purpose,
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
    v_account.name,
    v_account.type,
    v_account.purpose,
    'RECEIVE',
    'CASHU_TOKEN',
    'PENDING',
    p_currency,
    p_reversed_transaction_id,
    now(),
    p_encrypted_data
  ) returning id into v_transaction_id;

  insert into wallet.cashu_receive_swaps (
    token_hash,
    account_id,
    user_id,
    keyset_id,
    keyset_counter,
    encrypted_data,
    transaction_id
  ) values (
    p_token_hash,
    p_account_id,
    p_user_id,
    p_keyset_id,
    v_counter,
    p_encrypted_data,
    v_transaction_id
  ) returning * into v_receive_swap;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_receive_swap, v_account_with_proofs);
end;
$function$;

create or replace function wallet.create_cashu_send_swap(
  p_user_id uuid,
  p_account_id uuid,
  p_input_proofs uuid[],
  p_currency wallet.currency,
  p_encrypted_data text,
  p_requires_input_proofs_swap boolean,
  p_token_hash text default null::text,
  p_keyset_id text default null::text,
  p_number_of_outputs integer default null::integer
)
returns wallet.create_cashu_send_swap_result
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_state wallet.cashu_send_swap_state;
  v_keyset_id text; -- We are declaring this variable instead of storing the value directly from p_keyset_id to prevent it being added to db for the state it shouldn't be added for.
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_keyset_counter integer;
  v_transaction_id uuid;
  v_swap wallet.cashu_send_swaps;
  v_reserved_proofs wallet.cashu_proofs[];
begin
  -- If the input amount is equal to the amount to send, there is no need to swap the input proofs so the swap is ready to be committed (set to PENDING).
  if p_requires_input_proofs_swap then
    v_state := 'DRAFT';
  else
    v_state := 'PENDING';
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

    if p_number_of_outputs is null or p_number_of_outputs <= 0 then
      raise exception
        using
          hint = 'INVALID_ARGUMENT',
          message = 'When state is DRAFT, p_number_of_outputs must be provided and greater than 0.',
          detail = format('Value provided: %s', p_number_of_outputs);
    end if;

    v_keyset_id := p_keyset_id;

    update wallet.accounts a
    set
      details = jsonb_set(
        details,
        array['keyset_counters', v_keyset_id],
        to_jsonb(
          coalesce((details->'keyset_counters'->>v_keyset_id)::integer, 0) + p_number_of_outputs
        ),
        true
      ),
      version = version + 1
    where a.id = p_account_id
    returning * into v_account;

    -- Keyset counter value before the increment (This is the value used for this swap)
    v_keyset_counter := coalesce((v_account.details->'keyset_counters'->>v_keyset_id)::integer, 0) - p_number_of_outputs;
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    account_name,
    account_type,
    account_purpose,
    direction,
    type,
    state,
    currency,
    pending_at,
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    v_account.name,
    v_account.type,
    v_account.purpose,
    'SEND',
    'CASHU_TOKEN',
    'PENDING',
    p_currency,
    now(),
    p_encrypted_data
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_swaps (
    user_id,
    account_id,
    transaction_id,
    keyset_id,
    keyset_counter,
    token_hash,
    state,
    encrypted_data,
    requires_input_proofs_swap
  ) values (
    p_user_id,
    p_account_id,
    v_transaction_id,
    v_keyset_id,
    v_keyset_counter,
    p_token_hash,
    v_state,
    p_encrypted_data,
    p_requires_input_proofs_swap
  ) returning * into v_swap;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows
  -- "returning into" can only be used with a single value so array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_swap_id = v_swap.id,
      version = version + 1
    where id = any(p_input_proofs) and account_id = p_account_id and state = 'UNSPENT'
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

-- 6. Make account_id nullable with ON DELETE SET NULL so accounts can be
--    deleted later without dropping transaction history.
alter table wallet.transactions
  drop constraint transactions_account_id_fkey;

alter table wallet.transactions
  alter column account_id drop not null;

alter table wallet.transactions
  add constraint transactions_account_id_fkey
    foreign key (account_id) references wallet.accounts (id)
    on delete set null;
