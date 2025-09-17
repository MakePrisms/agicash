-- Migration: Add locked_tokens table with access code security
-- Purpose: Create a table for storing tokens that are protected by access code authentication
-- Security: Uses secure functions for access verification with RLS policies as additional security layer

-- Create the locked_tokens table
create table wallet.locked_tokens (
  token_hash text primary key,
  token text not null,
  user_id uuid not null,
  access_code_hash text default null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

comment on table wallet.locked_tokens is '
Stores plaintext locked cashutokens that are optionally protected by access code authentication.';

-- Enable Row Level Security
alter table wallet.locked_tokens enable row level security;

-- Add foreign key constraint for user_id
alter table wallet.locked_tokens add constraint "locked_tokens_user_id_fkey" FOREIGN KEY (user_id) REFERENCES wallet.users(id) not valid;
alter table wallet.locked_tokens validate constraint "locked_tokens_user_id_fkey";

-- Function to retrieve a token with access code authentication
create or replace function wallet.get_locked_token(
  p_token_hash text,
  p_access_code_hash text default null
)
returns wallet.locked_tokens
language plpgsql
security invoker
as $$
declare
  result_record wallet.locked_tokens;
begin
  -- Set the session access code hash for RLS (transaction-scoped for security)
  -- true makes the setting only persist for the current transaction
  perform set_config('app.current_access_code_hash', coalesce(p_access_code_hash, ''), true);
  
  -- Return the token data if accessible (RLS policy handles access code verification)
  select *
  into result_record
  from wallet.locked_tokens lt
  where lt.token_hash = p_token_hash
  limit 1;
  
  if not found then
    return null;
  end if;
  
  return result_record;
end;
$$;

-- RLS Policies

-- Select policy: Allow if access code hash matches session access code hash 
-- OR if no access code is required (for both authenticated and anonymous users)
-- Note: Primary access should be through the secure functions above, but this provides additional security
create policy "Users can select locked tokens with correct access code" 
on wallet.locked_tokens 
for select 
to authenticated, anon 
using (
  access_code_hash is null OR access_code_hash = current_setting('app.current_access_code_hash', true)
);

-- User-based CRUD policy: Allow full access to tokens owned by the authenticated user
create policy "Enable CRUD for locked tokens based on user_id"
on wallet.locked_tokens
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

-- Grant necessary permissions
grant select, insert, update, delete on wallet.locked_tokens to anon, authenticated, service_role;
grant execute on function wallet.get_locked_token(text, text) to anon, authenticated, service_role;
