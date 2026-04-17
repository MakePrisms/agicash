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
-- reads two values at runtime:
--   app.webhook_base_url  — Postgres setting (GUC) holding the base URL of the app
--   webhook_secret        — vault secret holding the shared HMAC secret
--
-- local dev is seeded automatically by supabase/seed.sql.
-- see README "Event system" section for per-environment setup.

create or replace function "wallet"."emit_event"()
returns "trigger"
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_type text := TG_ARGV[0];
  v_id         text;
  v_base_url   text;
  v_secret     text;
  v_timestamp  text;
  v_payload    jsonb;
  v_body_text  text;
  v_signature  text;
begin
  v_base_url := current_setting('app.webhook_base_url', true);

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'webhook_secret'
   limit 1;

  if v_base_url is null or v_secret is null then
    raise warning 'emit_event: configuration missing (app.webhook_base_url setting or webhook_secret vault entry)';
    return coalesce(new, old);
  end if;

  v_id := gen_random_uuid()::text;
  v_timestamp := extract(epoch from now())::bigint::text;

  v_payload := jsonb_build_object(
    'id',   v_id,
    'type', v_event_type,
    'time', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'data', row_to_json(coalesce(new, old))
  );

  -- convert to text once so the same bytes are signed and sent
  v_body_text := v_payload::text;

  v_signature := encode(
    extensions.hmac(
      v_timestamp || '.' || v_body_text,
      v_secret,
      'sha256'
    ),
    'hex'
  );

  -- use the text overload so the exact bytes we signed are the exact bytes sent
  -- (the jsonb overload would round-trip through jsonb serialization)
  perform net.http_post(
    url                  := v_base_url || '/api/events',
    body                 := v_body_text,
    content_type         := 'application/json',
    headers              := jsonb_build_object(
      'X-Webhook-Signature', 't=' || v_timestamp || ',v1=' || v_signature
    ),
    timeout_milliseconds := 10000
  );

  return coalesce(new, old);

exception when others then
  raise warning 'emit_event(%): failed to send webhook: %', v_event_type, sqlerrm;
  return coalesce(new, old);
end;
$function$;

create trigger on_user_created
  after insert on "wallet"."users"
  for each row
  execute function "wallet"."emit_event"('user.created');

create trigger on_user_upgraded
  after update of email on "wallet"."users"
  for each row
  when (old.email is null and new.email is not null)
  execute function "wallet"."emit_event"('user.upgraded');
