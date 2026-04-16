-- generic event system
--
-- replaces per-event webhook functions with a single reusable trigger function.
-- any table can emit events by attaching a trigger that calls wallet.emit_event('event.type').
--
-- event envelope: { id, type, time, data }
-- auth: HMAC-SHA256 signature in X-Webhook-Signature header
-- format: t=<unix_epoch>,v1=<hex_hmac>
-- signed message: <timestamp>.<json_payload>
--
-- vault secrets required:
--   webhook_base_url  — base URL of the app (e.g. https://agi.cash)
--   webhook_secret    — shared HMAC secret

create or replace function wallet.emit_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  _event_type text := TG_ARGV[0];
  _id         text;
  _base_url   text;
  _secret     text;
  _timestamp  text;
  _payload    jsonb;
  _body_text  text;
  _signature  text;
begin
  select decrypted_secret into _base_url
    from vault.decrypted_secrets
   where name = 'webhook_base_url'
   limit 1;

  select decrypted_secret into _secret
    from vault.decrypted_secrets
   where name = 'webhook_secret'
   limit 1;

  if _base_url is null or _secret is null then
    raise warning 'emit_event: vault secrets missing (webhook_base_url or webhook_secret)';
    return coalesce(new, old);
  end if;

  _id := gen_random_uuid()::text;
  _timestamp := extract(epoch from now())::bigint::text;

  _payload := jsonb_build_object(
    'id',   _id,
    'type', _event_type,
    'time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'data', row_to_json(coalesce(new, old))
  );

  -- convert to text once so the same bytes are signed and sent
  _body_text := _payload::text;

  _signature := encode(
    extensions.hmac(
      _timestamp || '.' || _body_text,
      _secret,
      'sha256'
    ),
    'hex'
  );

  -- use the text overload so the exact bytes we signed are the exact bytes sent
  -- (the jsonb overload would round-trip through jsonb serialization)
  perform net.http_post(
    url                  := _base_url || '/api/events',
    body                 := _body_text,
    content_type         := 'application/json',
    headers              := jsonb_build_object(
      'X-Webhook-Signature', 't=' || _timestamp || ',v1=' || _signature
    ),
    timeout_milliseconds := 10000
  );

  return coalesce(new, old);

exception when others then
  raise warning 'emit_event(%): failed to send webhook: %', _event_type, sqlerrm;
  return coalesce(new, old);
end;
$$;

create trigger on_user_created
  after insert on wallet.users
  for each row
  execute function wallet.emit_event('user.created');

create trigger on_user_upgraded
  after update of email on wallet.users
  for each row
  when (old.email is null and new.email is not null)
  execute function wallet.emit_event('user.upgraded');
