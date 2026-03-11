-- Seed file for local development and Supabase preview branches
-- Runs automatically after migrations during `supabase db reset` and when preview branches are created

-- Enable dev-relevant feature flags
update "wallet"."feature_flags" set "enabled" = true where "key" in (
  'GUEST_SIGNUP',
  'GIFT_CARDS',
  'DEBUG_LOGGING_SPARK'
);
