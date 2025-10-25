-- migration: create merchant remote access log table
-- purpose: store connection strings for merchant remote access roles
-- this table is only accessible by service_role (admins)
-- stores sensitive connection information that should never be exposed to regular users

create table mints.merchant_remote_access_log (
  id uuid primary key default gen_random_uuid(),
  merchant_id text not null,
  role_name text not null,
  connection_string text not null,
  host text not null,
  port integer not null,
  database text not null,
  created_at timestamptz not null default now()
);

-- add index for efficient lookup by merchant_id
create index merchant_remote_access_log_merchant_id_idx on mints.merchant_remote_access_log(merchant_id);

-- add index for efficient lookup by role_name
create index merchant_remote_access_log_role_name_idx on mints.merchant_remote_access_log(role_name);

-- add index for efficient lookup by created_at for chronological queries
create index merchant_remote_access_log_created_at_idx on mints.merchant_remote_access_log(created_at desc);

-- enable row level security
alter table mints.merchant_remote_access_log enable row level security;

-- rls policy: deny all access to authenticated users
-- this table is only accessible via service_role
create policy "Authenticated users cannot access merchant remote access log"
  on mints.merchant_remote_access_log
  for all
  to authenticated
  using (false);

-- rls policy: deny all access to anonymous users
create policy "Anonymous users cannot access merchant remote access log"
  on mints.merchant_remote_access_log
  for all
  to anon
  using (false);

-- note: service_role bypasses rls and can access this table
-- this is the intended behavior for admin-only access

