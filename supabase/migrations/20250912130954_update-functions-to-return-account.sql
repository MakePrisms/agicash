-- Create result type for create_cashu_token_swap function
create type "wallet"."create_cashu_token_swap_result" as ("created_swap" wallet.cashu_token_swaps, "updated_account" wallet.accounts);

-- Drop the old create_cashu_token_swap function
drop function if exists wallet.create_cashu_token_swap(text, text, uuid, uuid, text, text, text, integer, integer[], numeric, numeric, numeric, integer, text, uuid);

-- Update create_cashu_token_swap function to return both swap and updated account
create or replace function wallet.create_cashu_token_swap(
    p_token_hash text, 
    p_token_proofs text, 
    p_account_id uuid, 
    p_user_id uuid, 
    p_currency text, 
    p_unit text, 
    p_keyset_id text, 
    p_keyset_counter integer,
    p_output_amounts integer[],
    p_input_amount numeric,
    p_receive_amount numeric,
    p_fee_amount numeric,
    p_account_version integer,
    p_encrypted_transaction_details text,
    p_reversed_transaction_id uuid default null)
 returns wallet.create_cashu_token_swap_result
 language plpgsql
as $function$
declare
  v_token_swap wallet.cashu_token_swaps;
  v_updated_account wallet.accounts;
  v_updated_counter integer;
  v_transaction_id uuid;
begin

 -- Create transaction record 
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

  -- Calculate new counter
  v_updated_counter := p_keyset_counter + array_length(p_output_amounts, 1);

  -- Update the account with optimistic concurrency and capture the updated account
  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(v_updated_counter), 
      true
    ),
    version = version + 1
  where a.id = p_account_id and a.version = p_account_version
  returning * into v_updated_account;

  if v_updated_account is null then
    raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one', p_account_id, p_account_version;
  end if;

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
    state,
    transaction_id
  ) values (
    p_token_hash,
    p_token_proofs,
    p_account_id,
    p_user_id,
    p_currency,
    p_unit,
    p_keyset_id,
    p_keyset_counter,
    p_output_amounts,
    p_input_amount,
    p_receive_amount,
    p_fee_amount,
    'PENDING',
    v_transaction_id
  ) returning * into v_token_swap;

  return (v_token_swap, v_updated_account);
end;
$function$
;

-- Update complete_cashu_token_swap_result type to include both swap and account
drop type if exists wallet.complete_cashu_token_swap_result;
create type "wallet"."complete_cashu_token_swap_result" as ("updated_swap" wallet.cashu_token_swaps, "updated_account" wallet.accounts);

-- Drop the existing function first since we're changing the return type
drop function if exists wallet.complete_cashu_token_swap(text, uuid, integer, jsonb, integer);

-- Create complete_cashu_token_swap function to properly return the composite type
create function wallet.complete_cashu_token_swap(p_token_hash text, p_user_id uuid, p_swap_version integer, p_proofs jsonb, p_account_version integer)
 returns wallet.complete_cashu_token_swap_result
 language plpgsql
 set search_path to ''
as $function$
declare
    v_token_swap wallet.cashu_token_swaps;
    v_updated_account wallet.accounts;
    v_reversed_transaction_id uuid;
    v_send_swap wallet.cashu_send_swaps;
begin
    select * into v_token_swap
    from wallet.cashu_token_swaps
    where token_hash = p_token_hash and user_id = p_user_id;

    if v_token_swap is null then
        raise exception 'token swap for token hash % not found', p_token_hash;
    end if;

    if v_token_swap.state != 'PENDING' then
        raise exception 'token swap for token hash % cannot be completed because it is not in pending state. current state: %', p_token_hash, v_token_swap.state;
    end if;

    -- update account with optimistic concurrency and capture the updated account
    update wallet.accounts
    set details = jsonb_set(details, '{proofs}', p_proofs, true),
        version = version + 1
    where id = v_token_swap.account_id and version = p_account_version
    returning * into v_updated_account;

    if v_updated_account is null then
        raise exception 'concurrency error: account % was modified by another transaction. expected version %, but found different one', v_token_swap.account_id, p_account_version;
    end if;

    -- update token swap and capture the updated swap
    update wallet.cashu_token_swaps
    set state = 'COMPLETED',
        version = version + 1
    where token_hash = p_token_hash and user_id = p_user_id and version = p_swap_version
    returning * into v_token_swap;

    if v_token_swap is null then
        raise exception 'concurrency error: token swap % was modified by another transaction. expected version %, but found different one', p_token_hash, p_swap_version;
    end if;

    update wallet.transactions
    set state = 'COMPLETED',
        -- only set acknowledgment status to pending if the token swap is not reversing a send swap
        acknowledgment_status = case when reversed_transaction_id is null then 'pending' else null end,
        completed_at = now()
    where id = v_token_swap.transaction_id
    returning reversed_transaction_id into v_reversed_transaction_id;

    -- if not reversing a send swap, we're done
    if v_reversed_transaction_id is null then
        return (v_token_swap, v_updated_account);
    end if;

    -- find the send swap that would be reversed
    select * into v_send_swap
    from wallet.cashu_send_swaps
    where transaction_id = v_reversed_transaction_id
    for update;

    if v_send_swap is null then
        raise exception 'no send swap found for reversed transaction %', v_reversed_transaction_id;
    end if;

    -- check if the send swap can be reversed
    if v_send_swap.state = 'REVERSED' then
        -- already reversed, nothing to do
        return (v_token_swap, v_updated_account);
    end if;

    -- update send swap (already locked for update)
    update wallet.cashu_send_swaps
    set state = 'REVERSED',
        version = version + 1
    where id = v_send_swap.id;

    if not found then
        raise exception 'send swap % not found for update', v_send_swap.id;
    end if;

    -- update the reversed transaction
    update wallet.transactions
    set state = 'REVERSED',
        reversed_at = now()
    where id = v_reversed_transaction_id;

    return (v_token_swap, v_updated_account);
end;
$function$
;

-- Update complete_cashu_receive_quote_result type to include both quote and account
drop type if exists wallet.complete_cashu_receive_quote_result;
create type "wallet"."complete_cashu_receive_quote_result" as ("updated_quote" wallet.cashu_receive_quotes, "updated_account" wallet.accounts);

-- Drop the existing function first since we're changing the return type
drop function if exists wallet.complete_cashu_receive_quote(uuid, integer, jsonb, integer);

-- Create complete_cashu_receive_quote function to properly return the composite type
create function wallet.complete_cashu_receive_quote(p_quote_id uuid, p_quote_version integer, p_proofs jsonb, p_account_version integer)
 returns wallet.complete_cashu_receive_quote_result
 language plpgsql
as $function$
declare
    v_quote wallet.cashu_receive_quotes;
    v_updated_quote wallet.cashu_receive_quotes;
    v_updated_account wallet.accounts;
begin
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id;

    if v_quote is null then
        raise exception 'Quote % not found', p_quote_id;
    end if;

    if v_quote.state != 'PAID' then
        raise exception 'Quote % has not been paid yet', v_quote.id;
    end if;

    update wallet.cashu_receive_quotes
    set state = 'COMPLETED',
        version = version + 1
    where id = v_quote.id and version = p_quote_version
    returning * into v_updated_quote;

    if v_updated_quote is null then
        raise exception 'Concurrency error: Quote % was modified by another transaction. Expected version %, but found different one', v_quote.id, p_quote_version;
    end if;

    update wallet.accounts
    set details = jsonb_set(details, '{proofs}', p_proofs, true),
        version = version + 1
    where id = v_quote.account_id and version = p_account_version
    returning * into v_updated_account;

    if v_updated_account is null then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one.', v_quote.account_id, p_account_version;
    end if;

    -- Update the transaction state to COMPLETED with pending acknowledgment
    update wallet.transactions
    set state = 'COMPLETED',
        acknowledgment_status = 'pending',
        completed_at = now()
    where id = v_quote.transaction_id;

    return (v_updated_quote, v_updated_account);
end;
$function$
;

drop function if exists wallet.fail_cashu_token_swap(text, uuid, integer, text);

create function wallet.fail_cashu_token_swap(
    p_token_hash text, 
    p_user_id uuid, 
    p_swap_version integer, 
    p_failure_reason text
)
returns wallet.cashu_token_swaps
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_token_swap wallet.cashu_token_swaps;
    v_reversed_transaction_id uuid;
begin
    select * into v_token_swap
    from wallet.cashu_token_swaps
    where token_hash = p_token_hash and user_id = p_user_id;

    if v_token_swap is null then
        raise exception 'token swap for token hash % not found', p_token_hash;
    end if;

    if v_token_swap.state != 'PENDING' then
        raise exception 'token swap for token hash % cannot be failed because it is not in pending state. current state: %', p_token_hash, v_token_swap.state;
    end if;

    -- special handling for "Token already claimed" failures
    -- this handles the edge case where:
    -- 1. user initiates a send swap reversal (creating a reversal transaction)
    -- 2. receiver claims the token around the same time
    -- 3. receiver's claim is processed first by the mint
    -- 4. when the onSpent event triggers for the send swap, there's a related reversal transaction in pending state
    -- 5. the reversal transaction will eventually fail with "Token already claimed"
    -- 6. without this handling, the original send swap would stay in pending state forever
    -- this ensures the original send swap is properly marked as completed when the reversal fails due to the token being claimed
    if p_failure_reason = 'Token already claimed' then
        -- get the reversed transaction id if this token swap is reversing a send transaction
        select reversed_transaction_id into v_reversed_transaction_id
        from wallet.transactions
        where id = v_token_swap.transaction_id
        for update;

        -- if this is reversing a send transaction, update the corresponding send swap
        if v_reversed_transaction_id is not null then
            -- update send swap to completed
            update wallet.cashu_send_swaps
            set state = 'COMPLETED',
                version = version + 1
            where transaction_id = v_reversed_transaction_id;

            if not found then
                raise exception 'no send swap found for transaction %', v_reversed_transaction_id;
            end if;

            -- update the original send transaction to completed
            update wallet.transactions
            set state = 'COMPLETED',
                completed_at = now()
            where id = v_reversed_transaction_id;

        end if;
    end if;

    -- update the token swap to failed with optimistic concurrency
    update wallet.cashu_token_swaps
    set state = 'FAILED',
        failure_reason = p_failure_reason,
        version = version + 1
    where token_hash = p_token_hash and user_id = p_user_id and version = p_swap_version
    returning * into v_token_swap;

    if not found then
        raise exception 'concurrency error: token swap % was modified by another transaction. expected version %, but found different one', p_token_hash, p_swap_version;
    end if;

    -- update the transaction state to failed
    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_token_swap.transaction_id;

    return v_token_swap;
end;
$function$;
