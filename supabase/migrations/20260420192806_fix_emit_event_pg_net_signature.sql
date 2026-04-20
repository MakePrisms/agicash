-- fix emit_event to match the only pg_net http_post signature that actually exists:
--   net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds int)
-- the previous version used `content_type := ...` and a text body — that overload does
-- not exist in any pg_net release, so the call raised on every invocation and the
-- exception handler swallowed it silently (no webhook, just a postgres warning).
--
-- HMAC still verifies: pg_net's jsonb-body overload serializes via body::text before
-- sending, so the bytes transmitted equal v_payload::text — which is what we sign.

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
  select value into v_base_url
    from wallet.app_config
   where key = 'webhook_base_url'
   limit 1;

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'webhook_secret'
   limit 1;

  if v_base_url is null or v_secret is null then
    raise warning 'emit_event: configuration missing (wallet.app_config.webhook_base_url or webhook_secret vault entry)';
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

  -- sign the canonical jsonb text representation; pg_net serializes body via
  -- body::text before transmitting, producing identical bytes on the wire
  v_body_text := v_payload::text;

  v_signature := encode(
    extensions.hmac(
      v_timestamp || '.' || v_body_text,
      v_secret,
      'sha256'
    ),
    'hex'
  );

  perform net.http_post(
    url                  := v_base_url || '/api/events',
    body                 := v_payload,
    headers              := jsonb_build_object(
      'Content-Type',        'application/json',
      'X-Webhook-Signature', 't=' || v_timestamp || ',v1=' || v_signature
    ),
    timeout_milliseconds := 10000
  );

  return coalesce(new, old);

exception when others then
  -- catches errors from config reads, hmac signing, or net.http_post
  -- argument validation. actual delivery failures (timeout, HTTP errors,
  -- DNS) are async and recorded in net._http_response, not here.
  raise warning 'emit_event(%): failed to queue webhook: %', v_event_type, sqlerrm;
  return coalesce(new, old);
end;
$function$;
