-- Migration: Add feature flags system
--
-- Purpose: Replace build-time env-var feature flags with a Supabase-backed system.
-- Flags are evaluated server-side via a Postgres function. The client receives
-- simple booleans — no rule logic or targeting data leaks to the browser.
--
-- Affected: new wallet.feature_flags table, new wallet.evaluate_feature_flags function
--
-- Notes:
-- - Function uses security definer so anon users can evaluate flags without JWT
-- - Function uses auth.uid() for user identity (not a client parameter) to prevent spoofing
-- - When called by anon, auth.uid() is null so only global flags are evaluated
-- - Table-level grants are inherited from the initial migration's default privileges,
--   but RLS with no permissive policies blocks all direct row access for anon/authenticated
-- - Boolean-only by design. If non-boolean flags are needed, add a `value jsonb`
--   column and update the function in a future migration.

-- Table: feature_flags
create table "wallet"."feature_flags" (
  "key" text primary key,
  "enabled" boolean not null default true,
  "description" text,
  "rules" jsonb not null default '{}'::jsonb,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now()
);

-- Enable RLS (no policies = no direct access for anon/authenticated)
alter table "wallet"."feature_flags" enable row level security;

-- Reuse existing updated_at trigger from public schema
create trigger "feature_flags_handle_updated_at"
  before update on "wallet"."feature_flags"
  for each row execute function "public"."set_updated_at_if_updated"();

-- Function: evaluate_feature_flags
-- Returns {FLAG_KEY: boolean} for all flags.
-- Uses auth.uid() to identify the caller — null for anon, real user ID for authenticated.
-- When auth.uid() is null, only global on/off is evaluated (user-dependent rules default to false).
create or replace function "wallet"."evaluate_feature_flags"()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb := '{}'::jsonb;
  v_flag record;
  v_bucket int;
begin
  for v_flag in
    select key, enabled, rules
    from wallet.feature_flags
  loop
    -- 1. Global kill switch
    if not v_flag.enabled then
      v_result := v_result || jsonb_build_object(v_flag.key, false);
      continue;
    end if;

    -- 2. No rules = globally enabled
    if v_flag.rules = '{}'::jsonb or v_flag.rules is null then
      v_result := v_result || jsonb_build_object(v_flag.key, true);
      continue;
    end if;

    -- 3. No user = can't evaluate user-dependent rules, default to false
    if v_user_id is null then
      v_result := v_result || jsonb_build_object(v_flag.key, false);
      continue;
    end if;

    -- 4. Explicit user targeting (highest priority)
    if v_flag.rules ? 'user_ids' and
       v_flag.rules->'user_ids' @> to_jsonb(v_user_id::text) then
      v_result := v_result || jsonb_build_object(v_flag.key, true);
      continue;
    end if;

    -- 5. Percentage rollout (deterministic hash)
    if v_flag.rules ? 'percentage' then
      v_bucket := abs(('x' || left(md5(v_user_id::text || v_flag.key), 8))::bit(32)::int) % 100;
      if v_bucket < (v_flag.rules->>'percentage')::int then
        v_result := v_result || jsonb_build_object(v_flag.key, true);
        continue;
      end if;
    end if;

    -- 6. No rule matched — flag is off for this user
    v_result := v_result || jsonb_build_object(v_flag.key, false);
  end loop;

  return v_result;
end;
$$;

-- Grant execute to all roles (function is security definer, so it can read the table)
grant execute on function "wallet"."evaluate_feature_flags"() to anon, authenticated, service_role;

-- Seed initial flags (matching current env-var flags)
insert into "wallet"."feature_flags" ("key", "enabled", "description") values
  ('GUEST_SIGNUP', false, 'Allow guest signup without email/OAuth'),
  ('GIFT_CARDS', false, 'Show gift card feature in home screen');
