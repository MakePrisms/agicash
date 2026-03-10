-- Seed file for local development
-- Runs after migrations during `supabase db reset`
--
-- Enable feature flags that are useful during development.
-- Production flags are set to false by default in migrations.

update wallet.feature_flags set enabled = true where key = 'GUEST_SIGNUP';
update wallet.feature_flags set enabled = true where key = 'GIFT_CARDS';
