-- Codegen-only metadata: marks columns that are auto-populated by a trigger
-- (so SQL says NOT NULL with no DEFAULT, but callers never supply them) as
-- optional in the generated `New<Table>` insert struct.
--
-- Convention defined in `crates/agicash-storage-supabase-codegen/README.md`.
-- The codegen tool reads `pg_description` and looks for the literal substring
-- `@codegen optional` in each column's comment.

comment on column "wallet"."users"."username" is
  'Auto-populated by the set_default_username trigger on INSERT; callers never supply it. @codegen optional';
