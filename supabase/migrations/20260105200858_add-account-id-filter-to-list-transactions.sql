-- Description:
-- This migration updates the list_transactions function to support optional account ID filtering.
-- This allows fetching transactions for a specific account while maintaining the same ordering and pagination.
--
-- Affected Functions: wallet.list_transactions
-- ========================================

-- Drop the existing function
drop function if exists wallet.list_transactions(uuid, integer, timestamptz, uuid, integer);

-- Recreate the function with optional account_id parameter
create or replace function wallet.list_transactions(
  p_user_id uuid,
  p_cursor_state_sort_order integer default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 25,
  p_account_id uuid default null
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
      and (p_account_id is null or t.account_id = p_account_id)
    order by t.state_sort_order desc, t.created_at desc, t.id desc
    limit p_page_size;
  else
    -- Subsequent pages (with cursor)
    return query
    select t.*
    from wallet.transactions t
    where t.user_id = p_user_id
      and t.state in ('PENDING', 'COMPLETED', 'REVERSED')
      and (p_account_id is null or t.account_id = p_account_id)
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
