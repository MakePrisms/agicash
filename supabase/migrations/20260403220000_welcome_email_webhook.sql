-- trigger function: call welcome-email edge function on new user insert
create or replace function wallet.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  edge_function_url text;
  service_role_key text;
  request_id bigint;
begin
  -- skip guest users (no email)
  if new.email is null then
    return new;
  end if;

  -- resolve config from vault secrets
  -- these must be set via: select vault.create_secret('<value>', '<name>');
  select decrypted_secret into edge_function_url
    from vault.decrypted_secrets
    where name = 'edge_function_base_url';

  select decrypted_secret into service_role_key
    from vault.decrypted_secrets
    where name = 'service_role_key';

  if edge_function_url is null or service_role_key is null then
    raise warning 'welcome email: missing vault secrets (edge_function_base_url or service_role_key)';
    return new;
  end if;

  -- fire async HTTP request to the welcome-email edge function via pg_net
  select net.http_post(
    url := edge_function_url || '/functions/v1/welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    body := jsonb_build_object(
      'id', new.id,
      'email', new.email,
      'firstName', new.username
    )
  ) into request_id;

  return new;
end;
$$;

-- trigger: fire after insert on wallet.users
-- note: INSERT ON CONFLICT DO UPDATE fires an UPDATE trigger (not INSERT)
-- so this only fires for genuinely new users, not upsert-updates.
create trigger on_user_created
  after insert on wallet.users
  for each row
  execute function wallet.handle_new_user();
