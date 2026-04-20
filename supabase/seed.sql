-- Seed file for local development and Supabase preview branches
-- Runs automatically after migrations during `supabase db reset` and when preview branches are created

-- Enable dev-relevant feature flags
update "wallet"."feature_flags" set "enabled" = true where "key" in (
  'GUEST_SIGNUP',
  'GIFT_CARDS',
  'DEBUG_LOGGING_SPARK'
);

-- Dev-default config for the event system (webhook triggers)
-- These are fake values for local development only — never use in production.
-- host.docker.internal so pg_net (running inside the supabase_db container) can reach the dev server on the host
insert into "wallet"."app_config" ("key", "value") values ('webhook_base_url', 'http://host.docker.internal:3000');
select vault.create_secret('dev-webhook-secret', 'webhook_secret', 'HMAC shared secret for webhook signatures');
