-- Migration: Remove the GIFT_CARDS feature flag
--
-- Purpose: Gift cards are now unconditionally available. Drop the two
-- restrictive RLS policies on wallet.accounts that gated gift-card account
-- create/update on the flag, and remove the feature_flags row.
--
-- Affected:
-- - wallet.accounts: drops "Require GIFT_CARDS flag for gift-card account insert"
-- - wallet.accounts: drops "Require GIFT_CARDS flag for gift-card account update"
-- - wallet.feature_flags: deletes row where key = 'GIFT_CARDS'

drop policy if exists "Require GIFT_CARDS flag for gift-card account insert"
  on "wallet"."accounts";

drop policy if exists "Require GIFT_CARDS flag for gift-card account update"
  on "wallet"."accounts";

delete from "wallet"."feature_flags" where "key" = 'GIFT_CARDS';
