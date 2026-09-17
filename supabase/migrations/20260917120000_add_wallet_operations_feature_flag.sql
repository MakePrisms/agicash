-- Migration: Add the WALLET_OPERATIONS feature flag
--
-- Purpose: Gate signup, send, receive and Lightning Address receives behind one
-- flag so the wallet can be wound down on a deadline. After the deadline the
-- flag can be re-enabled for individual users so they can withdraw their funds.
--
-- Affected:
-- - wallet.feature_flags: new WALLET_OPERATIONS row
-- - wallet.user_exists(uuid): new security definer helper for the insert policies
-- - wallet.users: new restrictive insert policy "Require WALLET_OPERATIONS flag for new user insert"
-- - wallet.users: "Require email when GUEST_SIGNUP disabled" recreated so it no longer blocks existing guests
--
-- Notes:
-- - The flag is positive: true means the wallet operates normally. The rules
--   engine in wallet.is_feature_enabled can only turn a flag ON for specific
--   users, so the sunset is expressed as "enabled for nobody" and each
--   exemption is a user id appended to rules.user_ids.
-- - Runbook:
--     sunset:    update wallet.feature_flags set rules = '{"user_ids": []}' where key = 'WALLET_OPERATIONS';
--     exemption: update wallet.feature_flags set rules = jsonb_set(rules, '{user_ids}', rules->'user_ids' || to_jsonb('<user id>'::text)) where key = 'WALLET_OPERATIONS';
--     undo:      update wallet.feature_flags set rules = '{}' where key = 'WALLET_OPERATIONS';
--   Keep enabled = true. Setting enabled = false and later flipping it back on
--   without rules would re-open the wallet for everyone.
-- - The restrictive insert policy blocks the creation of new wallet users while
--   the flag is off, which also covers new Google logins that bypass the signup
--   page. It layers on top of the existing permissive CRUD policy.
-- - upsert_user_with_accounts runs insert ... on conflict (id) do update as the
--   caller. Postgres evaluates insert policies on the proposed row before it
--   detects the conflict, so an insert policy also fires for existing users on
--   every login. Both policies below therefore let a row pass when a user with
--   that id already exists. The previous GUEST_SIGNUP policy lacked this guard
--   and locked out existing guest users whenever GUEST_SIGNUP was off.
-- - A policy cannot query its own table (Postgres reports infinite recursion),
--   so the existence check lives in the security definer function
--   wallet.user_exists. Execute is revoked from public and anon; the policies
--   run it as the authenticated caller.
-- - Send and receive are enforced in the app only. Spark payments settle
--   through the Breez SDK and never touch this database, so a database policy
--   could not cover them.

insert into "wallet"."feature_flags" ("key", "enabled", "description", "rules")
values (
  'WALLET_OPERATIONS',
  true,
  'Signup, send, receive and Lightning Address receives. Set rules to {"user_ids": []} for the sunset and append user ids to let individual users withdraw.',
  '{}'::jsonb
);

-- Helper for the insert policies. Security definer so it can read
-- wallet.users without triggering the policies of wallet.users again.
create or replace function "wallet"."user_exists"(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from wallet.users where id = p_user_id);
$$;

revoke execute on function "wallet"."user_exists"(uuid) from public, anon;

-- Restrictive policy: block insert of new users while WALLET_OPERATIONS is off.
-- The flag is evaluated for the caller (auth.uid()), so a user listed in
-- rules.user_ids can still be created, which is intended. user_exists lets
-- the on conflict do update path through for existing users.
create policy "Require WALLET_OPERATIONS flag for new user insert"
on "wallet"."users"
as restrictive
for insert
to authenticated
with check (
  wallet.is_feature_enabled('WALLET_OPERATIONS')
  or wallet.user_exists(id)
);

-- Recreate the GUEST_SIGNUP policy with the same user_exists guard so existing
-- guests (email is null) keep passing the login-time upsert when GUEST_SIGNUP
-- is off. New guests are still blocked.
drop policy if exists "Require email when GUEST_SIGNUP disabled" on "wallet"."users";

create policy "Require email when GUEST_SIGNUP disabled"
on "wallet"."users"
as restrictive
for insert
to authenticated
with check (
  email is not null
  or wallet.is_feature_enabled('GUEST_SIGNUP')
  or wallet.user_exists(id)
);
