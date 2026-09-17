-- Migration: Close signups permanently, independently of the WALLET_OPERATIONS flag
--
-- Purpose: 20260917120000 tied new wallet user inserts to WALLET_OPERATIONS. That flag is
-- re-enabled per user after the sunset so existing users can withdraw their funds, and every such
-- exemption would also re-open signups for that session. Signups are closed for good, so the insert
-- policy no longer looks at the flag.
--
-- Affected:
-- - wallet.users: "Require WALLET_OPERATIONS flag for new user insert" replaced by
--   "Block new user signups"
-- - wallet.feature_flags: WALLET_OPERATIONS description no longer mentions signup
--
-- Notes:
-- - upsert_user_with_accounts runs insert ... on conflict (id) do update as the caller and Postgres
--   evaluates insert policies on the proposed row before it detects the conflict, so this policy
--   fires for existing users on every login too. wallet.user_exists is what lets them through.
-- - The policy is restrictive, so it ands with the permissive CRUD policy on wallet.users.

drop policy if exists "Require WALLET_OPERATIONS flag for new user insert" on "wallet"."users";

create policy "Block new user signups"
on "wallet"."users"
as restrictive
for insert
to authenticated
with check (wallet.user_exists(id));

update "wallet"."feature_flags"
set "description" = 'Send, receive, buy, adding gift cards and Lightning Address receives. Set rules to {"user_ids": []} for the sunset and append user ids to let individual users withdraw.'
where "key" = 'WALLET_OPERATIONS';
