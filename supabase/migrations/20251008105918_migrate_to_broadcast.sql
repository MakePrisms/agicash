-- Migration: Migrate from postgres_changes to broadcast for realtime updates
-- 
-- Purpose: 
-- - Set up broadcast authorization policies for authenticated users
-- - Create trigger functions that broadcast changes for each table
-- - Attach triggers to all relevant tables
--
-- Affected tables:
-- - accounts, transactions, cashu_receive_quotes, cashu_token_swaps
-- - cashu_send_quotes, cashu_send_swaps, contacts
--
-- Note: This migration adds triggers for broadcasting changes. The postgres_changes
-- publication will be removed in a future migration after client code is updated.

-- Step 1: Create broadcast authorization policies
-- These policies allow authenticated users to receive broadcast messages

-- Drop existing policies if they exist
drop policy if exists "Authenticated users can receive broadcasts" on realtime.messages;

-- Create policy for authenticated users to receive broadcasts
create policy "Authenticated users can receive broadcasts"
  on realtime.messages
  for select
  to authenticated
  using (true);

-- Step 2: Create trigger functions for broadcasting changes

-- This function will be called by triggers on each table which has a user_id column to broadcast changes

create or replace function wallet.broadcast_table_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'wallet:' || coalesce(new.user_id, old.user_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

-- This function will be called by contacts table trigger to broadcast changes

create or replace function wallet.broadcast_contacts_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform realtime.broadcast_changes(
    'wallet:' || coalesce(new.owner_id, old.owner_id)::text,
    tg_op,
    tg_op,
    tg_table_name,
    tg_table_schema,
    new,
    old
  );
  return null;
end;
$$;

-- Step 3: Create triggers for each table
-- Each trigger will call the broadcast function after any change

drop trigger if exists broadcast_accounts_changes on wallet.accounts;
create trigger broadcast_accounts_changes
  after insert or update or delete
  on wallet.accounts
  for each row
  execute function wallet.broadcast_table_changes();

drop trigger if exists broadcast_transactions_changes on wallet.transactions;
create trigger broadcast_transactions_changes
  after insert or update or delete
  on wallet.transactions
  for each row
  execute function wallet.broadcast_table_changes();

drop trigger if exists broadcast_cashu_receive_quotes_changes on wallet.cashu_receive_quotes;
create trigger broadcast_cashu_receive_quotes_changes
  after insert or update or delete
  on wallet.cashu_receive_quotes
  for each row
  execute function wallet.broadcast_table_changes();

drop trigger if exists broadcast_cashu_token_swaps_changes on wallet.cashu_token_swaps;
create trigger broadcast_cashu_token_swaps_changes
  after insert or update or delete
  on wallet.cashu_token_swaps
  for each row
  execute function wallet.broadcast_table_changes();

drop trigger if exists broadcast_cashu_send_quotes_changes on wallet.cashu_send_quotes;
create trigger broadcast_cashu_send_quotes_changes
  after insert or update or delete
  on wallet.cashu_send_quotes
  for each row
  execute function wallet.broadcast_table_changes();

drop trigger if exists broadcast_cashu_send_swaps_changes on wallet.cashu_send_swaps;
create trigger broadcast_cashu_send_swaps_changes
  after insert or update or delete
  on wallet.cashu_send_swaps
  for each row
  execute function wallet.broadcast_table_changes();

drop trigger if exists broadcast_contacts_changes on wallet.contacts;
create trigger broadcast_contacts_changes
  after insert or update or delete
  on wallet.contacts
  for each row
  execute function wallet.broadcast_contacts_changes();