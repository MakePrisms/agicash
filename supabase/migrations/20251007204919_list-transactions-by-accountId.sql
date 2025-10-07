-- Description:
-- This migration adds optional filtering by account_id to the list_transactions function. 
-- 
-- Affected: wallet.list_transactions function
-- 
-- Changes:
-- - Adds optional p_account_id parameter to filter transactions by account
-- - Maintains backward compatibility (parameter is optional)
-- - Preserves existing pagination and sorting behavior
-- ========================================

-- Add composite index for account_id filtering
-- This index optimizes queries that filter by both user_id and account_id
-- It covers the full query pattern: filter by user_id + account_id, then sort by state_sort_order, created_at, id
create index if not exists idx_user_account_filtered_state_ordered
on wallet.transactions (
  user_id,
  account_id,
  state_sort_order desc,
  created_at desc,
  id desc
)
where state in ('PENDING', 'COMPLETED', 'REVERSED');

-- Drop the existing function to recreate it with the new signature
drop function if exists wallet.list_transactions(uuid, integer, timestamptz, uuid, integer);

-- Recreate function with optional account_id filter parameter
create or replace function wallet.list_transactions(
  p_user_id uuid,
  p_cursor_state_sort_order integer default null,
  p_cursor_created_at timestamptz default null,
  p_cursor_id uuid default null,
  p_page_size integer default 25,
  p_account_id uuid default null  -- New optional filter parameter
)
returns setof wallet.transactions
language plpgsql
stable
security definer
set search_path = ''
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
      and (p_account_id is null or t.account_id = p_account_id)  -- Apply account filter if provided
    order by t.state_sort_order desc, t.created_at desc, t.id desc
    limit p_page_size;
  else
    -- Subsequent pages (with cursor)
    return query
    select t.*
    from wallet.transactions t
    where t.user_id = p_user_id
      and t.state in ('PENDING', 'COMPLETED', 'REVERSED')
      and (p_account_id is null or t.account_id = p_account_id)  -- Apply account filter if provided
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
