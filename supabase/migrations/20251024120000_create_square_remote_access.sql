-- Create the mints schema
create schema if not exists mints;

create table mints.square_merchant_credentials (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references wallet.users(id) on delete cascade,
  email text not null,
  merchant_id text not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index square_merchant_credentials_user_id_idx on mints.square_merchant_credentials(user_id);
create index square_merchant_credentials_merchant_id_idx on mints.square_merchant_credentials(merchant_id);

create table mints.square_remote_app_access (
  id uuid primary key default gen_random_uuid(),
  role_name text not null unique,
  merchant_id text not null references mints.square_merchant_credentials(merchant_id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table mints.square_merchant_credentials enable row level security;
alter table mints.square_remote_app_access enable row level security;

create policy "Deny access to square credentials for authenticated"
  on mints.square_merchant_credentials
  for all
  to authenticated
  using (false);

create policy "Enable select on square credentials by role"
  on mints.square_merchant_credentials
  for select
  to public
  using (
    exists (
      select 1 
      from mints.square_remote_app_access 
      where role_name = current_user
      and merchant_id = square_merchant_credentials.merchant_id
    )
  );

create policy "Enable update on square credentials by role"
  on mints.square_merchant_credentials
  for update
  to public
  using (
    exists (
      select 1 
      from mints.square_remote_app_access 
      where role_name = current_user
      and merchant_id = square_merchant_credentials.merchant_id
    )
  )
  with check (
    exists (
      select 1 
      from mints.square_remote_app_access 
      where role_name = current_user
      and merchant_id = square_merchant_credentials.merchant_id
    )
  );

create policy "Deny access to remote app access for authenticated"
  on mints.square_remote_app_access
  for all
  to authenticated
  using (false);

create policy "Enable select on remote app access by role_name"
  on mints.square_remote_app_access
  for select
  to public
  using (role_name = current_user);

create or replace function mints.check_role_exists(p_role_name text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  return exists(select 1 from pg_catalog.pg_roles where rolname = p_role_name);
end;
$$;

create or replace function mints.create_merchant_role(
  p_role_name text,
  p_password text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_role_name !~ '^[a-zA-Z0-9_]+$' then
    raise exception 'Invalid role name format';
  end if;
  
  if length(p_password) < 16 then
    raise exception 'Password must be at least 16 characters';
  end if;
  
  if mints.check_role_exists(p_role_name) then
    raise exception 'Role already exists';
  end if;
  
  execute format('CREATE ROLE %I WITH LOGIN PASSWORD %L', p_role_name, p_password);
  execute format('GRANT CONNECT ON DATABASE postgres TO %I', p_role_name);
  execute format('GRANT USAGE ON SCHEMA mints TO %I', p_role_name);
  execute format('GRANT SELECT, UPDATE ON mints.square_merchant_credentials TO %I', p_role_name);
  execute format('GRANT SELECT ON mints.square_remote_app_access TO %I', p_role_name);
  
  return jsonb_build_object('success', true, 'role_name', p_role_name);
end;
$$;

create or replace function mints.drop_merchant_role(p_role_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terminated_count integer;
begin
  if p_role_name !~ '^[a-zA-Z0-9_]+$' then
    raise exception 'Invalid role name format';
  end if;
  
  if not mints.check_role_exists(p_role_name) then
    raise exception 'Role does not exist';
  end if;
  
  select count(*) into v_terminated_count
  from pg_catalog.pg_stat_activity
  where usename = p_role_name;
  
  if v_terminated_count > 0 then
    perform pg_catalog.pg_terminate_backend(pid)
    from pg_catalog.pg_stat_activity
    where usename = p_role_name;
  end if;
  
  execute format('DROP ROLE %I', p_role_name);
  
  return jsonb_build_object('success', true, 'role_name', p_role_name, 'terminated_connections', v_terminated_count);
end;
$$;

grant execute on function mints.check_role_exists(text) to service_role;
grant execute on function mints.create_merchant_role(text, text) to service_role;
grant execute on function mints.drop_merchant_role(text) to service_role;

-- Grant service_role access to mints schema and tables
grant usage on schema mints to service_role;
grant all on all tables in schema mints to service_role;
grant all on all sequences in schema mints to service_role;
alter default privileges in schema mints grant all on tables to service_role;
alter default privileges in schema mints grant all on sequences to service_role;
