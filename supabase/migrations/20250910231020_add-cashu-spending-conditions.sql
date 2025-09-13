-- Add column to store optional spending conditions as JSON string
alter table wallet.cashu_send_swaps
    add column if not exists spending_condition_data text;

-- Drop the previous version of the function (without spending_condition_data)
drop function if exists wallet.create_cashu_send_swap(
    uuid, uuid, numeric, numeric, text, text, text, text, text, integer, numeric, numeric, 
    numeric, numeric, text, text, integer, integer, text, text, integer[], integer[]
);

-- Recreate function with optional spending_condition_data parameter
create function wallet.create_cashu_send_swap(
    p_user_id uuid,
    p_account_id uuid,
    p_amount_requested numeric,
    p_amount_to_send numeric,
    p_input_proofs text,
    p_account_proofs text,
    p_currency text,
    p_unit text,
    p_state text,
    p_account_version integer,
    p_input_amount numeric,
    p_send_swap_fee numeric,
    p_receive_swap_fee numeric,
    p_total_amount numeric,
    p_encrypted_transaction_details text,
    p_keyset_id text DEFAULT NULL::text,
    p_keyset_counter integer DEFAULT NULL::integer,
    p_updated_keyset_counter integer DEFAULT NULL::integer,
    p_token_hash text DEFAULT NULL::text,
    p_proofs_to_send text DEFAULT NULL::text,
    p_send_output_amounts integer[] DEFAULT NULL::integer[],
    p_keep_output_amounts integer[] DEFAULT NULL::integer[],
    p_spending_condition_data text DEFAULT NULL::text
) RETURNS wallet.cashu_send_swaps
LANGUAGE plpgsql
AS $function$
declare
    v_transaction_id uuid;
    v_swap wallet.cashu_send_swaps;
begin
    -- Validate p_state is one of the allowed values
    IF p_state NOT IN ('DRAFT', 'PENDING') THEN
        RAISE EXCEPTION 'Invalid state: %. State must be either DRAFT or PENDING.', p_state;
    END IF;

    -- Validate input parameters based on the state
    IF p_state = 'PENDING' THEN
        -- For PENDING state, proofs_to_send and token_hash must be defined
        IF p_proofs_to_send IS NULL OR p_token_hash IS NULL THEN
            RAISE EXCEPTION 'When state is PENDING, proofs_to_send and token_hash must be provided';
        END IF;
    ELSIF p_state = 'DRAFT' THEN
        -- For DRAFT state, keyset_id, keyset_counter, updated_keyset_counter, send_output_amounts, and keep_output_amounts must be defined
        IF p_keyset_id IS NULL OR p_keyset_counter IS NULL OR p_updated_keyset_counter IS NULL OR p_send_output_amounts IS NULL OR p_keep_output_amounts IS NULL THEN
            RAISE EXCEPTION 'When state is DRAFT, keyset_id, keyset_counter, updated_keyset_counter, send_output_amounts, and keep_output_amounts must be provided';
        END IF;
    END IF;

    -- Create transaction record with the determined state
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

    -- Create send swap record
    insert into wallet.cashu_send_swaps (
        user_id,
        account_id,
        transaction_id,
        amount_requested,
        amount_to_send,
        send_swap_fee,
        receive_swap_fee,
        total_amount,
        input_proofs,
        input_amount,
        proofs_to_send,
        keyset_id,
        keyset_counter,
        send_output_amounts,
        keep_output_amounts,
        token_hash,
        spending_condition_data,
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
        p_input_proofs,
        p_input_amount,
        p_proofs_to_send,
        p_keyset_id,
        p_keyset_counter,
        p_send_output_amounts,
        p_keep_output_amounts,
        p_token_hash,
        p_spending_condition_data,
        p_currency,
        p_unit,
        p_state
    ) returning * into v_swap;

    if p_updated_keyset_counter is not null then
        update wallet.accounts
        set details = jsonb_set(
                jsonb_set(details, '{proofs}', to_jsonb(p_account_proofs)),
                array['keyset_counters', p_keyset_id],
                to_jsonb(p_updated_keyset_counter),
                true
            ),
            version = version + 1
        where id = v_swap.account_id and version = p_account_version;
    else
        update wallet.accounts
        set details = jsonb_set(details, '{proofs}', to_jsonb(p_account_proofs)),
            version = version + 1
        where id = v_swap.account_id and version = p_account_version;
    end if;
    
    if not found then
        raise exception 'Concurrency error: Account % was modified by another transaction. Expected version %, but found different one', v_swap.account_id, p_account_version;
    end if;

    return v_swap;
end;
$function$
;

-- Add unlocking_data column to cashu_token_swaps table
alter table "wallet"."cashu_token_swaps" add column "unlocking_data" text;

-- Drop the old function
DROP FUNCTION IF EXISTS wallet.create_cashu_token_swap(
    text, text, uuid, uuid, text, text, text, integer, integer[], numeric, numeric, numeric, integer, text, uuid
);

-- Recreate function with optional unlocking_data parameter
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
    p_reversed_transaction_id uuid DEFAULT NULL,
    p_unlocking_data text DEFAULT NULL)
 RETURNS wallet.cashu_token_swaps
 LANGUAGE plpgsql
AS $function$
declare
  v_token_swap wallet.cashu_token_swaps;
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

  -- Update the account with optimistic concurrency
  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(v_updated_counter), 
      true
    ),
    version = version + 1
  where a.id = p_account_id and a.version = p_account_version;

  if not found then
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
    transaction_id,
    unlocking_data
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
    v_transaction_id,
    p_unlocking_data
  ) returning * into v_token_swap;

  return v_token_swap;
end;
$function$
;