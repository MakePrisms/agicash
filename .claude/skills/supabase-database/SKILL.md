---
name: supabase-database
description: Guidelines for writing Supabase database migrations, functions, RLS policies, and SQL. Use when creating or modifying database schemas, writing migrations, creating Postgres functions, or setting up Row Level Security policies.
---

# Supabase Database Guidelines

Expert guidance for Postgres database work in a Supabase environment.

## Reference Files

| Topic | Reference |
|-------|-----------|
| Creating migrations | `references/migrations.md` |
| Database functions | `references/functions.md` |
| Row Level Security policies | `references/rls-policies.md` |
| SQL style guide | `references/sql-style-guide.md` |

## Quick Rules

- Write all SQL in lowercase
- Always enable RLS on new tables
- Separate RLS policies per operation (select/insert/update/delete) and per role (anon/authenticated)
- Migration files: `YYYYMMDDHHmmss_short_description.sql` in `supabase/migrations/`
- Functions default to `SECURITY INVOKER` with `set search_path = ''`
- Use fully qualified names (e.g., `public.table_name`) in functions
