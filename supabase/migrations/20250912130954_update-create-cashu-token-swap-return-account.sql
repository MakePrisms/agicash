-- Create result type for create_cashu_token_swap function
create type "wallet"."create_cashu_token_swap_result" as ("created_swap" wallet.cashu_token_swaps, "updated_account" wallet.accounts);

-- Drop the old create_cashu_token_swap function
DROP FUNCTION IF EXISTS wallet.create_cashu_token_swap(text, text, uuid, uuid, text, text, text, integer, integer[], numeric, numeric, numeric, integer, text, uuid);

-- Update create_cashu_token_swap function to return both swap and updated account
CREATE OR REPLACE FUNCTION wallet.create_cashu_token_swap(
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
    p_reversed_transaction_id uuid DEFAULT NULL)
 RETURNS wallet.create_cashu_token_swap_result
 LANGUAGE plpgsql
AS $function$
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
