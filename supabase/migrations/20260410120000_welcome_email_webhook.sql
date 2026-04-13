-- Welcome-email webhook: sends POST to the app API route which calls Resend.
--
-- Fires on:
--   1. New user with email (AFTER INSERT)
--   2. Guest user adding email (AFTER UPDATE when email changes from null)
--
-- The upsert path (INSERT ... ON CONFLICT DO UPDATE) fires an UPDATE trigger
-- on conflict, not INSERT — so the INSERT trigger only fires for genuinely new
-- rows, and the UPDATE trigger catches guest→email upgrades.

create or replace function wallet.handle_new_email_user()
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
  if new.email is null then
    return new;
  end if;

  select decrypted_secret into _base_url
    from vault.decrypted_secrets
   where name = 'webhook_base_url'
   limit 1;

  select decrypted_secret into _secret
    from vault.decrypted_secrets
   where name = 'webhook_secret'
   limit 1;

  -- Warning only — raising an exception would roll back the user creation.
  -- Missing secrets = no welcome email, but signup still works.
  -- Check Supabase Postgres logs for this warning if emails stop sending.
  if _base_url is null or _secret is null then
    raise warning 'welcome-email: vault secrets missing (webhook_base_url or webhook_secret)';
    return new;
  end if;

  _payload := jsonb_build_object(
    'id',    new.id,
    'email', new.email
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
  execute function wallet.handle_new_email_user();

create trigger on_user_email_added
  after update of email on wallet.users
  for each row
  when (old.email is null and new.email is not null)
  execute function wallet.handle_new_email_user();
