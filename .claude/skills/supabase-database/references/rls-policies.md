# Database: Create RLS Policies

Guidelines for writing Postgres Row Level Security policies in Supabase.

## Output Rules

- The generated SQL must be valid SQL.
- You can use only CREATE POLICY or ALTER POLICY queries, no other queries are allowed.
- Always use double apostrophe in SQL strings (eg. 'Night''s watch')
- The result should be a valid markdown. The SQL code should be wrapped in ``` (including sql language tag).
- Always use "auth.uid()" instead of "current_user".
- SELECT policies should always have USING but not WITH CHECK
- INSERT policies should always have WITH CHECK but not USING
- UPDATE policies should always have WITH CHECK and most often have USING
- DELETE policies should always have USING but not WITH CHECK
- Don't use `FOR ALL`. Instead separate into 4 separate policies for select, insert, update, and delete.
- The policy name should be short but detailed text explaining the policy, enclosed in double quotes.
- Always put explanations as separate text. Never use inline SQL comments.
- Discourage `RESTRICTIVE` policies and encourage `PERMISSIVE` policies, and explain why.

Example:

```sql
create policy "My descriptive policy." on books for insert to authenticated using ( (select auth.uid()) = author_id ) with ( true );
```

## Authenticated and unauthenticated roles

Supabase maps every request to one of the roles:

- `anon`: an unauthenticated request (the user is not logged in)
- `authenticated`: an authenticated request (the user is logged in)

Use these roles within your Policies using the `TO` clause:

```sql
create policy "Profiles are viewable by everyone"
on profiles
for select
to authenticated, anon
using ( true );

-- OR

create policy "Public profiles are viewable only by authenticated users"
on profiles
for select
to authenticated
using ( true );
```

Note that `for ...` must be added after the table but before the roles. `to ...` must be added after `for ...`.

## Multiple operations

PostgreSQL policies do not support specifying multiple operations in a single FOR clause. You need to create separate policies for each operation.

### Incorrect

```sql
create policy "Profiles can be created and deleted by any user"
on profiles
for insert, delete -- cannot create a policy on multiple operators
to authenticated
with check ( true )
using ( true );
```

### Correct

```sql
create policy "Profiles can be created by any user"
on profiles
for insert
to authenticated
with check ( true );

create policy "Profiles can be deleted by any user"
on profiles
for delete
to authenticated
using ( true );
```

## Helper functions

### `auth.uid()`

Returns the ID of the user making the request.

### `auth.jwt()`

Returns the JWT of the user making the request. Anything that you store in the user's `raw_app_meta_data` column or the `raw_user_meta_data` column will be accessible using this function.

- `raw_user_meta_data` - can be updated by the authenticated user using the `supabase.auth.update()` function. It is not a good place to store authorization data.
- `raw_app_meta_data` - cannot be updated by the user, so it's a good place to store authorization data.

Example using team data from `app_metadata`:

```sql
create policy "User is in team"
on my_table
to authenticated
using ( team_id in (select auth.jwt() -> 'app_metadata' -> 'teams'));
```

### MFA

The `auth.jwt()` function can be used to check for Multi-Factor Authentication:

```sql
create policy "Restrict updates."
on profiles
as restrictive
for update
to authenticated using (
  (select auth.jwt()->>'aal') = 'aal2'
);
```

## RLS performance recommendations

### Add indexes

Make sure you've added indexes on any columns used within the Policies which are not already indexed (or primary keys):

```sql
create index userid
on test_table
using btree (user_id);
```

### Call functions with `select`

Wrap functions in a `select` to allow the Postgres optimizer to cache results per-statement:

```sql
-- Good: cached per-statement
create policy "Users can access their own records" on test_table
to authenticated
using ( (select auth.uid()) = user_id );

-- Bad: called per-row
create policy "Users can access their own records" on test_table
to authenticated
using ( auth.uid() = user_id );
```

Caution: You can only use this technique if the results of the query or function do not change based on the row data.

### Minimize joins

Rewrite policies to avoid joins between the source and the target table. Instead, fetch all relevant data from the target table into an array or set:

```sql
-- Good: no join
create policy "Users can access records belonging to their teams" on test_table
to authenticated
using (
  team_id in (
    select team_id
    from team_user
    where user_id = (select auth.uid())
  )
);
```

### Specify roles in your policies

Always use the Role inside your policies with the `TO` operator. This prevents policies from running for irrelevant roles:

```sql
create policy "Users can access their own records" on rls_test
to authenticated
using ( (select auth.uid()) = user_id );
```
