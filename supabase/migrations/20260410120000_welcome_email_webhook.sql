-- Welcome-email webhook: fires on new user creation, sends POST to the app API
-- which then calls Resend to deliver the welcome email.
--
-- Note: our insert path uses INSERT ... ON CONFLICT DO UPDATE, which means a
-- conflict fires an UPDATE trigger (not INSERT). This trigger therefore only
-- fires for genuinely new rows — not upsert-updates.

create or replace function wallet.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _base_url  text;
  _secret    text;
  _payload   jsonb;
begin
  -- skip users without an email (e.g. guest accounts)
  if new.email is null then
    return new;
  end if;

  -- read secrets from vault; warn but don't block if missing
  select decrypted_secret into _base_url
    from vault.decrypted_secrets
   where name = 'webhook_base_url'
   limit 1;

  select decrypted_secret into _secret
    from vault.decrypted_secrets
   where name = 'webhook_secret'
   limit 1;

  if _base_url is null or _secret is null then
    raise warning 'welcome-email: vault secrets missing (webhook_base_url or webhook_secret)';
    return new;
  end if;

  _payload := jsonb_build_object(
    'id',        new.id,
    'email',     new.email,
    'firstName', new.username
  );

  perform net.http_post(
    url     := _base_url || '/api/welcome-email',
    body    := _payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || _secret
    ),
    timeout_milliseconds := 10000
  );

  return new;
end;
$$;

create trigger on_user_created
  after insert on wallet.users
  for each row
  execute function wallet.handle_new_user();
