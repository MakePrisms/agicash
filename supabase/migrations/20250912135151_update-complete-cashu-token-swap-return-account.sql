-- Update complete_cashu_token_swap_result type to include both swap and account
DROP TYPE IF EXISTS wallet.complete_cashu_token_swap_result;
create type "wallet"."complete_cashu_token_swap_result" as ("updated_swap" wallet.cashu_token_swaps, "updated_account" wallet.accounts);

-- Drop the existing function first since we're changing the return type
DROP FUNCTION IF EXISTS wallet.complete_cashu_token_swap(text, uuid, integer, jsonb, integer);

-- Create complete_cashu_token_swap function to properly return the composite type
CREATE FUNCTION wallet.complete_cashu_token_swap(p_token_hash text, p_user_id uuid, p_swap_version integer, p_proofs jsonb, p_account_version integer)
 RETURNS wallet.complete_cashu_token_swap_result
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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