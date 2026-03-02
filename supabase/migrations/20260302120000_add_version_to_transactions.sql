-- Migration: Add version column to transactions
--
-- Purpose: Add a monotonically increasing version number to transactions,
-- auto-incremented on every update via a trigger. Clients use this to
-- determine if cached data is stale and avoid overwriting newer data
-- with older data from out-of-order events.
--
-- Affected: wallet.transactions table, new wallet.increment_transaction_version function
--
-- Notes:
-- - Existing rows get version = 0
-- - The trigger auto-increments on every UPDATE — callers cannot opt out
-- - Matches the version pattern used by wallet.accounts and other tables

-- Add version column with default 0 for existing rows
alter table wallet.transactions
  add column version integer default 0 not null;

-- Ensure version is never negative
alter table wallet.transactions
  add constraint transactions_version_check check (version >= 0);

-- Auto-increment version on every update
create or replace function wallet.increment_transaction_version()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.version := old.version + 1;
  return new;
end;
$$;

create trigger increment_transaction_version
before update on wallet.transactions
for each row
execute function wallet.increment_transaction_version();
