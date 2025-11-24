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

-- Intentionally throw an exception to test transaction rollback
-- If migrations are wrapped in transactions, the table creation above should be rolled back
raise exception 'Intentional error for testing transaction rollback behavior';

-- This index creation will only execute if the exception above doesn't cause a rollback
-- (which would indicate migrations are NOT wrapped in transactions)
create index testing_created_at_idx on wallet.testing (created_at);

