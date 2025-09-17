-- Drop the previous version of the function (without type parameter)
drop function if exists wallet.create_cashu_send_swap(
    uuid, uuid, numeric, numeric, text, text, text, text, text, integer, numeric, numeric, 
    numeric, numeric, text, text, integer, integer, text, text, integer[], integer[],
    text, text
);

-- Recreate function with type parameter for CASHU_TOKEN vs GIFT transactions
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
    p_type text, -- CASHU_TOKEN or GIFT
    p_keyset_id text DEFAULT NULL::text,
    p_keyset_counter integer DEFAULT NULL::integer,
    p_updated_keyset_counter integer DEFAULT NULL::integer,
    p_token_hash text DEFAULT NULL::text,
    p_proofs_to_send text DEFAULT NULL::text,
    p_send_output_amounts integer[] DEFAULT NULL::integer[],
    p_keep_output_amounts integer[] DEFAULT NULL::integer[],
    p_spending_condition_data text DEFAULT NULL::text,
    p_unlocking_data text DEFAULT NULL::text
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
        p_type,
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
        unlocking_data,
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
        p_unlocking_data,
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

drop function if exists wallet.list_transactions(
  uuid, integer, timestamptz, uuid, integer
);

-- Function to list user transactions with pagination and type filtering
create or replace function wallet.list_transactions(
  p_user_id uuid,
  p_cursor_state_sort_order integer default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 25,
  p_types text[] default null
)
returns setof wallet.transactions
language plpgsql
stable
security definer
as $$
begin
  -- Check if cursor data is provided
  if p_cursor_created_at is null then
    -- Initial page load (no cursor)
    return query
    select t.*
    from wallet.transactions t
    where t.user_id = p_user_id
      and t.state in ('PENDING', 'COMPLETED', 'REVERSED')
      and (p_types is null or t.type = any(p_types))
    order by t.state_sort_order desc, t.created_at desc, t.id desc
    limit p_page_size;
  else
    -- Subsequent pages (with cursor)
    return query
    select t.*
    from wallet.transactions t
    where t.user_id = p_user_id
      and t.state in ('PENDING', 'COMPLETED', 'REVERSED')
      and (p_types is null or t.type = any(p_types))
      and (t.state_sort_order, t.created_at, t.id) < (
        p_cursor_state_sort_order,
        p_cursor_created_at,
        p_cursor_id
      )
    order by t.state_sort_order desc, t.created_at desc, t.id desc
    limit p_page_size;
  end if;
end;
$$;

-- This index optimizes queries that filter by user_id, type, and state while maintaining efficient ordering
create index idx_user_type_filtered_state_ordered
on wallet.transactions (
  user_id,
  type,
  state_sort_order desc,
  created_at desc, 
  id desc
) 
where state in ('PENDING', 'COMPLETED', 'REVERSED');
