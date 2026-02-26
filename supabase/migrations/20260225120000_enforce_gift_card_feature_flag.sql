-- Migration: Enforce feature flags at the database level
--
-- Purpose:
-- 1. Prevent creation of gift-card accounts when GIFT_CARDS flag is disabled.
-- 2. Require users to have an email when GUEST_SIGNUP flag is disabled.
--
-- Affected: new wallet.is_feature_enabled function, wallet.evaluate_feature_flags
-- refactored to use it, new restrictive RLS policies on wallet.accounts and wallet.users
--
-- Notes:
-- - is_feature_enabled is the single source of truth for flag evaluation logic
-- - evaluate_feature_flags is rewritten to call is_feature_enabled in a loop
-- - Both use security definer so they can read wallet.feature_flags (which has
--   no permissive RLS policies)
-- - The restrictive policies layer on top of the existing permissive CRUD policy —
--   both must pass for the operation to succeed
-- - Short-circuits for non-gift-card accounts (no feature_flags table hit)

-- Function: is_feature_enabled
-- Evaluates a single feature flag for the current user.
-- This is the single source of truth for flag evaluation logic.
create or replace function "wallet"."is_feature_enabled"(p_flag_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_flag record;
  v_bucket int;
begin
  select enabled, rules
  into v_flag
  from wallet.feature_flags
  where key = p_flag_key;

  -- Unknown flag = disabled
  if not found then
    return false;
  end if;

  -- Global kill switch
  if not v_flag.enabled then
    return false;
  end if;

  -- No rules = globally enabled
  if v_flag.rules = '{}'::jsonb or v_flag.rules is null then
    return true;
  end if;

  -- No user = can't evaluate user-dependent rules
  if v_user_id is null then
    return false;
  end if;

  -- Explicit user targeting
  if v_flag.rules ? 'user_ids' and
     v_flag.rules->'user_ids' @> to_jsonb(v_user_id::text) then
    return true;
  end if;

  -- Percentage rollout (deterministic hash)
  if v_flag.rules ? 'percentage' then
    v_bucket := abs(('x' || left(md5(v_user_id::text || p_flag_key), 8))::bit(32)::int) % 100;
    if v_bucket < (v_flag.rules->>'percentage')::int then
      return true;
    end if;
  end if;

  return false;
end;
$$;

-- Drop the old evaluate_feature_flags (duplicated the evaluation logic inline)
drop function if exists "wallet"."evaluate_feature_flags"();

-- Function: evaluate_feature_flags (rewritten)
-- Returns {FLAG_KEY: boolean} for all flags.
-- Delegates per-flag evaluation to is_feature_enabled.
create or replace function "wallet"."evaluate_feature_flags"()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb := '{}'::jsonb;
  v_key text;
begin
  for v_key in
    select key from wallet.feature_flags
  loop
    v_result := v_result || jsonb_build_object(v_key, wallet.is_feature_enabled(v_key));
  end loop;

  return v_result;
end;
$$;

-- Restrictive policy: block INSERT of gift-card accounts without the flag
create policy "Require GIFT_CARDS flag for gift-card account insert"
on "wallet"."accounts"
as restrictive
for insert
to authenticated
with check (
  purpose != 'gift-card'::wallet.account_purpose
  or wallet.is_feature_enabled('GIFT_CARDS')
);

-- Restrictive policy: block UPDATE that changes purpose to gift-card without the flag
create policy "Require GIFT_CARDS flag for gift-card account update"
on "wallet"."accounts"
as restrictive
for update
to authenticated
using (true)
with check (
  purpose != 'gift-card'::wallet.account_purpose
  or wallet.is_feature_enabled('GIFT_CARDS')
);

-- Restrictive policy: require email when GUEST_SIGNUP is disabled.
-- Guest users (no email) should only be created when guest signup is enabled.
create policy "Require email when GUEST_SIGNUP disabled"
on "wallet"."users"
as restrictive
for insert
to authenticated
with check (
  email is not null
  or wallet.is_feature_enabled('GUEST_SIGNUP')
);
