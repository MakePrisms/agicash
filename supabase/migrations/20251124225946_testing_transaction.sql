/*
 * Migration: Testing transaction rollback behavior
 * 
 * Purpose:
 * This migration is designed to test if Supabase migrations are wrapped in database
 * transactions. It creates a table, then intentionally throws an exception. If migrations
 * are transaction-wrapped, the table creation should be rolled back. If not, the table
 * will remain in the database.
 */

-- Create testing table with id and created_at columns
create table wallet.testing (
  "id" uuid primary key default gen_random_uuid(),
  "created_at" timestamp with time zone not null default now()
);

-- Insert test records into the testing table
-- One record has created_at set to tomorrow to test the constraint
insert into wallet.testing (id, created_at) values
  (gen_random_uuid(), now()),
  (gen_random_uuid(), now() - interval '1 day'),
  (gen_random_uuid(), now() + interval '1 day');

-- Add constraint to ensure no created_at dates are in the future
alter table wallet.testing
  add constraint testing_created_at_no_future
  check (created_at <= now());

-- Create index on created_at column
create index testing_created_at_idx on wallet.testing (created_at);

