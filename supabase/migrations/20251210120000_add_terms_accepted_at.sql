-- Migration: Add Terms Acceptance Timestamp
-- 
-- Purpose:
--   Track when users accept the terms of service for legal compliance.
--   The UI enforces terms acceptance via checkbox; the column defaults to now().
--
-- Affected Objects:
--   - wallet.users (table - new column)

alter table wallet.users
  add column terms_accepted_at timestamptz not null default now();

comment on column wallet.users.terms_accepted_at is
  'Timestamp when user accepted terms of service. Defaults to now(); UI should enforce acceptance via checkbox before signup.';

