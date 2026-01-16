-- Description:
-- This migration updates the list_transactions function to support optional account ID filtering.
-- It also optimizes the query logic by splitting it into seperate branches using dynamic SQL.
--
-- Affected Functions: wallet.list_transactions
-- Affected Indexes: wallet.transactions (new index idx_transactions_user_account_filtered_state_ordered)
-- ========================================

-- Drop the existing function
drop function if exists wallet.list_transactions(uuid, integer, timestamptz, uuid, integer);

-- Create a composite index to support efficient filtering by account_id while maintaining sort order
create index if not exists idx_transactions_user_account_filtered_state_ordered
on wallet.transactions (
  user_id,
  account_id,
  state_sort_order desc,
  created_at desc, 
  id desc
) 
where state in ('PENDING', 'COMPLETED', 'REVERSED');

-- Recreate the function with optional account_id parameter using dynamic SQL
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
declare
  query text;
begin
  -- Build base query
  query := '
    select t.*
    from wallet.transactions t
    where t.user_id = $1
      and t.state in (''PENDING'', ''COMPLETED'', ''REVERSED'')';

  -- Add account filter if provided
  if p_account_id is not null then
    query := query || ' and t.account_id = $6';
  end if;

  -- Add cursor filter if provided
  if p_cursor_created_at is not null then
    query := query || ' and (t.state_sort_order, t.created_at, t.id) < ($2, $3, $4)';
  end if;

  -- Add ordering and limit
  query := query || ' order by t.state_sort_order desc, t.created_at desc, t.id desc limit $5';

  return query execute query
    using p_user_id, p_cursor_state_sort_order, p_cursor_created_at, p_cursor_id, p_page_size, p_account_id;
end;
$$;
