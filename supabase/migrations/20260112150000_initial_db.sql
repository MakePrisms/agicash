-- Disable RLS for migration to allow table setup without policy restrictions
set row_security = off;

-- =============================================================================
-- EXTENSIONS
-- =============================================================================

create extension if not exists "pg_cron" with schema "pg_catalog";

create extension if not exists "pg_net" with schema "extensions";

create extension if not exists "pg_stat_statements" with schema "extensions";

create extension if not exists "pgcrypto" with schema "extensions";

create extension if not exists "supabase_vault" with schema "vault";

create extension if not exists "uuid-ossp" with schema "extensions";

-- =============================================================================
-- SCHEMA CREATION
-- =============================================================================

create schema if not exists "wallet";

-- Schema grants
grant usage on schema wallet to anon, authenticated, service_role;
grant all on all tables in schema wallet to anon, authenticated, service_role;
grant all on all routines in schema wallet to anon, authenticated, service_role;
grant all on all sequences in schema wallet to anon, authenticated, service_role;

-- Schema privileges
alter default privileges for role postgres in schema wallet grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema wallet grant all on routines to anon, authenticated, service_role;
alter default privileges for role postgres in schema wallet grant all on sequences to anon, authenticated, service_role;

-- =============================================================================
-- TABLES
-- =============================================================================

-- Table: users
create table if not exists "wallet"."users" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "created_at" timestamp with time zone default "now"() not null,
  "email" "text" unique,
  "email_verified" boolean not null,
  "updated_at" timestamp with time zone default "now"() not null,
  "default_btc_account_id" "uuid",
  "default_currency" "text" default 'BTC'::"text" not null,
  "default_usd_account_id" "uuid",
  "username" "text" not null unique,
  "cashu_locking_xpub" "text" not null unique,
  "encryption_public_key" "text" not null,
  "spark_identity_public_key" "text" not null,
  "terms_accepted_at" timestamp with time zone default "now"() not null,
  constraint "users_default_currency_has_account" check (((("default_currency" = 'BTC'::"text") and ("default_btc_account_id" is not null)) or (("default_currency" = 'USD'::"text") and ("default_usd_account_id" is not null)))),
  constraint "users_username_format" check (("username" ~ '^[a-z0-9_-]+$'::"text")),
  constraint "users_username_length" check ((("length"("username") >= 3) and ("length"("username") <= 20)))
);

comment on column "wallet"."users"."terms_accepted_at" is 'Timestamp when user accepted terms of service. Defaults to now(); UI should enforce acceptance via checkbox before signup.';

-- Indexes
create index "idx_users_username" on "wallet"."users" using "btree" ("username" "text_pattern_ops");
create index "idx_users_default_btc_account_id" on "wallet"."users" using "btree" ("default_btc_account_id");
create index "idx_users_default_usd_account_id" on "wallet"."users" using "btree" ("default_usd_account_id");

-- RLS policies for users
alter table "wallet"."users" enable row level security;

create policy "Enable CRUD for users based on id"
on "wallet"."users"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = id))
with check ((( select auth.uid() as uid) = id));

-- Triggers
create or replace function "wallet"."set_default_username"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  -- Set the username field to "user-" concatenated with the last 12 characters of the id
  new.username := 'user-' || right(new.id::text, 12);
    
  return new;
end;
$function$;

create or replace trigger "set_default_username_trigger" before insert on "wallet"."users" for each row execute function "wallet"."set_default_username"();

create or replace function "public"."set_updated_at_if_updated"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if (new is distinct from old) then
    new.updated_at = current_timestamp;
  end if;
  return new;
end;
$function$;

create or replace trigger "users_handle_updated_at" before update on "wallet"."users" for each row execute function "public"."set_updated_at_if_updated"();

-- Table: accounts
create table if not exists "wallet"."accounts" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "created_at" timestamp with time zone default "now"() not null,
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "name" "text" not null,
  "type" "text" not null,
  "currency" "text" not null,
  "details" "jsonb" not null,
  "version" integer default 0 not null,
  constraint "accounts_version_check" check (("version" >= 0))
);

-- FKs from users to accounts (added after accounts table is created due to circular dependency)
alter table only "wallet"."users"
    add constraint "users_default_btc_account_id_fkey" foreign key ("default_btc_account_id") references "wallet"."accounts"("id") deferrable initially deferred;

alter table only "wallet"."users"
    add constraint "users_default_usd_account_id_fkey" foreign key ("default_usd_account_id") references "wallet"."accounts"("id") deferrable initially deferred;

-- Indexes
create unique index "cashu_accounts_user_currency_mint_url_unique" on "wallet"."accounts" using "btree" ("user_id", "currency", (("details" ->> 'mint_url'::"text"))) where ("type" = 'cashu'::"text");
create index "idx_accounts_user_id" on "wallet"."accounts" using "btree" ("user_id");

-- RLS policies for accounts
alter table "wallet"."accounts" enable row level security;

create policy "Enable CRUD for accounts based on user_id"
on "wallet"."accounts"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: contacts

-- Function: check_not_self_contact (needed for contacts table CHECK constraint)
create or replace function "wallet"."check_not_self_contact"(
  "owner_id" "uuid",
  "contact_username" "text"
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  return not exists (
    select 1 from wallet.users
    where id = owner_id and username = contact_username
  );
end;
$function$;

create table if not exists "wallet"."contacts" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "created_at" timestamp with time zone default "now"() not null,
  "owner_id" "uuid" not null references "wallet"."users"("id"),
  "username" "text" references "wallet"."users"("username") on update cascade,
  constraint "contacts_owner_id_username_key" unique ("owner_id", "username"),
  constraint "prevent_self_contact" check ((("username" is null) or "wallet"."check_not_self_contact"("owner_id", "username")))
);

-- Indexes
create index "idx_contacts_owner_username" on "wallet"."contacts" using "btree" ("owner_id", "username");

-- RLS policies for contacts
alter table "wallet"."contacts" enable row level security;

create policy "Enable CRUD for contacts based on owner_id"
on "wallet"."contacts"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = owner_id))
with check ((( select auth.uid() as uid) = owner_id));

-- Triggers
create or replace function "wallet"."enforce_contacts_limit"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_contact_count integer;
begin
  select count(*) into v_contact_count 
  from wallet.contacts 
  where owner_id = new.owner_id;
  
  if v_contact_count >= 150 then
    raise exception 
      using
        hint = 'LIMIT_REACHED',
        message = 'Maximum number of contacts limit reached.',
        detail = format('Contacts count: %s, limit: 150.', v_contact_count);
  end if;
  
  return new;
end;
$function$;

create or replace trigger "enforce_max_contacts_limit" before insert on "wallet"."contacts" for each row execute function "wallet"."enforce_contacts_limit"();

-- Table: transactions
create table if not exists "wallet"."transactions" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "direction" "text" not null,
  "type" "text" not null,
  "state" "text" not null,
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "currency" "text" not null,
  "created_at" timestamp with time zone default "now"() not null,
  "pending_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "failed_at" timestamp with time zone,
  "reversed_transaction_id" "uuid" unique references "wallet"."transactions"("id"),
  "reversed_at" timestamp with time zone,
  "state_sort_order" integer generated always as (
    case
      when ("state" = 'PENDING'::"text") then 2
      else 1
    end) stored,
  "encrypted_transaction_details" "text" not null,
  "acknowledgment_status" "text",
  "transaction_details" "jsonb",
  constraint "transactions_direction_check" check (("direction" = any (array['SEND'::"text", 'RECEIVE'::"text"]))),
  constraint "transactions_state_check" check (("state" = any (array['DRAFT'::"text", 'PENDING'::"text", 'COMPLETED'::"text", 'FAILED'::"text", 'REVERSED'::"text"]))),
  constraint "transactions_type_check" check (("type" = any (array['CASHU_LIGHTNING'::"text", 'CASHU_TOKEN'::"text", 'SPARK_LIGHTNING'::"text"])))
);

comment on column "wallet"."transactions"."transaction_details" is 'Optional JSONB column for non-encrypted, indexable transaction-type-specific details. For SPARK_LIGHTNING transactions, contains { sparkTransferId: string }.';

-- Indexes
create index "idx_transactions_reversed_transaction_id" on "wallet"."transactions" using "btree" ("reversed_transaction_id") where ("reversed_transaction_id" is not null);
create index "idx_transactions_spark_transfer_id" on "wallet"."transactions" using "btree" ((("transaction_details" ->> 'sparkTransferId'::"text"))) where (("type" = 'SPARK_LIGHTNING'::"text") and (("transaction_details" ->> 'sparkTransferId'::"text") is not null));
create index "idx_transactions_user_acknowledgment_pending" on "wallet"."transactions" using "btree" ("user_id", "acknowledgment_status") where ("acknowledgment_status" = 'pending'::"text");
create index "idx_user_filtered_state_ordered" on "wallet"."transactions" using "btree" ("user_id", "state_sort_order" desc, "created_at" desc, "id" desc) where ("state" = any (array['PENDING'::"text", 'COMPLETED'::"text", 'REVERSED'::"text"]));
create index "idx_transactions_account_id" on "wallet"."transactions" using "btree" ("account_id");

-- RLS policies for transactions
alter table "wallet"."transactions" enable row level security;

create policy "Enable CRUD for transactions based on user_id"
on "wallet"."transactions"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: cashu_proofs
create table if not exists "wallet"."cashu_proofs" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "user_id" "uuid" not null references "wallet"."users"("id") on delete cascade,
  "account_id" "uuid" not null references "wallet"."accounts"("id") on delete cascade,
  "keyset_id" "text" not null,
  "amount" "text" not null,
  "secret" "text" not null,
  "unblinded_signature" "text" not null,
  "public_key_y" "text" not null,
  "dleq" "jsonb",
  "witness" "jsonb",
  "state" "text" default 'UNSPENT'::"text" not null,
  "version" integer default 0 not null,
  "created_at" timestamp with time zone default "now"() not null,
  "reserved_at" timestamp with time zone,
  "spent_at" timestamp with time zone,
  "cashu_receive_quote_id" "uuid",
  "cashu_token_swap_token_hash" "text",
  "cashu_send_quote_id" "uuid",
  "spending_cashu_send_quote_id" "uuid",
  "cashu_send_swap_id" "uuid",
  "spending_cashu_send_swap_id" "uuid",
  constraint "cashu_proofs_state_check" check (("state" = any (array['UNSPENT'::"text", 'RESERVED'::"text", 'SPENT'::"text"])))
);

comment on table "wallet"."cashu_proofs" is 'Stores individual cashu proofs for each account. Proofs are the fundamental unit of value in the cashu protocol. Secrets and amounts are encrypted at the application layer.';
comment on column "wallet"."cashu_proofs"."id" is 'Unique identifier for the proof record';
comment on column "wallet"."cashu_proofs"."user_id" is 'Owner of the proof, used for RLS policies';
comment on column "wallet"."cashu_proofs"."account_id" is 'The account this proof belongs to';
comment on column "wallet"."cashu_proofs"."keyset_id" is 'Identifies which mint keyset was used to create this proof';
comment on column "wallet"."cashu_proofs"."amount" is 'The amount of the proof (encrypted at application layer)';
comment on column "wallet"."cashu_proofs"."secret" is 'The secret value (encrypted at application layer)';
comment on column "wallet"."cashu_proofs"."unblinded_signature" is 'The C field from the Proof structure - the unblinded signature';
comment on column "wallet"."cashu_proofs"."public_key_y" is 'The Y public key of the proof. Derived from the secret (Y = hash_to_curve(secret))';
comment on column "wallet"."cashu_proofs"."dleq" is 'Discrete Log Equality proof data: {s, e, r?}';
comment on column "wallet"."cashu_proofs"."witness" is 'Optional witness data for the proof';
comment on column "wallet"."cashu_proofs"."state" is 'Current state: UNSPENT (available) or RESERVED (locked for spending), SPENT (spent)';
comment on column "wallet"."cashu_proofs"."version" is 'Optimistic locking version number, incremented on state changes';
comment on column "wallet"."cashu_proofs"."created_at" is 'Timestamp when the proof was added to the database';
comment on column "wallet"."cashu_proofs"."reserved_at" is 'Timestamp when the proof was reserved for spending';
comment on column "wallet"."cashu_proofs"."spent_at" is 'Timestamp when the proof was spent (transaction that spent it was completed)';
comment on column "wallet"."cashu_proofs"."cashu_receive_quote_id" is 'The receive quote that added this proof (if added via a cashu receive quote)';
comment on column "wallet"."cashu_proofs"."cashu_token_swap_token_hash" is 'The token hash of the token swap that added this proof (if added via a cashu token swap). Combined with user_id to reference cashu_token_swaps table';
comment on column "wallet"."cashu_proofs"."cashu_send_quote_id" is 'The send quote that added this proof as a change (if added via a send quote)';
comment on column "wallet"."cashu_proofs"."spending_cashu_send_quote_id" is 'The send quote that spent or reserved this proof for sending. Will be null for unspent proofs or if proof was not spent with a send quote';
comment on column "wallet"."cashu_proofs"."cashu_send_swap_id" is 'The send swap that added this proof as a change (if added via a send swap)';
comment on column "wallet"."cashu_proofs"."spending_cashu_send_swap_id" is 'The send swap that spent or reserved this proof for sending. Will be null for unspent proofs or if proof was not spent with a send swap';

-- Indexes
create index "cashu_proofs_account_state_idx" on "wallet"."cashu_proofs" using "btree" ("account_id", "state");
-- Unique constraint to prevent duplicate proofs within an account.
-- This also ensures that the secret is unique within an account, because the public key Y is derived from the secret.
create unique index "cashu_proofs_account_y_unique_idx" on "wallet"."cashu_proofs" using "btree" ("account_id", "public_key_y");
create index "cashu_proofs_cashu_send_swap_id_idx" on "wallet"."cashu_proofs" using "btree" ("cashu_send_swap_id") where ("cashu_send_swap_id" is not null);
create index "cashu_proofs_receive_quote_id_idx" on "wallet"."cashu_proofs" using "btree" ("cashu_receive_quote_id") where ("cashu_receive_quote_id" is not null);
create index "cashu_proofs_send_quote_id_idx" on "wallet"."cashu_proofs" using "btree" ("cashu_send_quote_id") where ("cashu_send_quote_id" is not null);
create index "cashu_proofs_spending_send_quote_id_idx" on "wallet"."cashu_proofs" using "btree" ("spending_cashu_send_quote_id") where ("spending_cashu_send_quote_id" is not null);
create index "cashu_proofs_spending_send_swap_id_idx" on "wallet"."cashu_proofs" using "btree" ("spending_cashu_send_swap_id") where ("spending_cashu_send_swap_id" is not null);
create index "cashu_proofs_user_token_swap_idx" on "wallet"."cashu_proofs" using "btree" ("user_id", "cashu_token_swap_token_hash");
create index "idx_cashu_proofs_state_spent_at" on "wallet"."cashu_proofs" using "btree" ("state", "spent_at") where ("state" = 'SPENT'::"text");

-- RLS policies for cashu_proofs
alter table "wallet"."cashu_proofs" enable row level security;

create policy "Enable CRUD on cashu_proofs based on user_id"
on "wallet"."cashu_proofs"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: cashu_receive_quotes
create table if not exists "wallet"."cashu_receive_quotes" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "created_at" timestamp with time zone default "now"() not null,
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "expires_at" timestamp with time zone not null,
  "state" "text" not null,
  "keyset_id" "text",
  "keyset_counter" integer,
  "version" integer default 0 not null,
  "transaction_id" "uuid" not null references "wallet"."transactions"("id"),
  "type" "text" not null,
  "locking_derivation_path" "text" not null,
  "failure_reason" "text",
  "encrypted_data" "text" not null,
  "payment_hash" "text" not null,
  "quote_id_hash" "text" not null,
  "cashu_token_melt_initiated" boolean,
  constraint "cashu_receive_quotes_cashu_token_melt_initiated_check" check ((("type" <> 'CASHU_TOKEN'::"text") or ("cashu_token_melt_initiated" is not null))),
  constraint "cashu_receive_quotes_keyset_counter_check" check (("keyset_counter" >= 0)),
  constraint "cashu_receive_quotes_state_check" check (("state" = any (array['UNPAID'::"text", 'EXPIRED'::"text", 'PAID'::"text", 'COMPLETED'::"text", 'FAILED'::"text"]))),
  constraint "cashu_receive_quotes_type_check" check (("type" = any (array['LIGHTNING'::"text", 'CASHU_TOKEN'::"text"]))),
  constraint "cashu_receive_quotes_version_check" check (("version" >= 0))
);

comment on column "wallet"."cashu_receive_quotes"."cashu_token_melt_initiated" is 'Whether the melt has been initiated on the source mint. Required (NOT NULL) when type is CASHU_TOKEN, NULL otherwise.';

-- Indexes
create unique index "cashu_receive_quotes_quote_id_hash_key" on "wallet"."cashu_receive_quotes" using "btree" ("account_id", "quote_id_hash") where ("quote_id_hash" is not null);
create index "idx_cashu_receive_quotes_state_created_at" on "wallet"."cashu_receive_quotes" using "btree" ("state", "created_at");
create index "idx_cashu_receive_quotes_user_id" on "wallet"."cashu_receive_quotes" using "btree" ("user_id");
create index "idx_cashu_receive_quotes_transaction_id" on "wallet"."cashu_receive_quotes" using "btree" ("transaction_id");

-- RLS policies for cashu_receive_quotes
alter table "wallet"."cashu_receive_quotes" enable row level security;

create policy "Enable CRUD for cashu receive quotes based on user_id"
on "wallet"."cashu_receive_quotes"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: cashu_token_swaps
create table if not exists "wallet"."cashu_token_swaps" (
  "token_hash" "text" not null,
  "created_at" timestamp with time zone default "now"() not null,
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "keyset_id" "text" not null,
  "keyset_counter" integer not null,
  "state" "text" default 'PENDING'::"text" not null,
  "version" integer default 0 not null,
  "failure_reason" "text",
  "transaction_id" "uuid" not null references "wallet"."transactions"("id"),
  "encrypted_data" "text" not null,
  constraint "cashu_token_swaps_state_check" check (("state" = any (array['PENDING'::"text", 'COMPLETED'::"text", 'FAILED'::"text"]))),
  primary key ("token_hash", "user_id")
);

-- Indexes
create index "idx_cashu_token_swaps_state_created_at" on "wallet"."cashu_token_swaps" using "btree" ("state", "created_at");
create index "idx_cashu_token_swaps_account_id" on "wallet"."cashu_token_swaps" using "btree" ("account_id");
create index "idx_cashu_token_swaps_user_id" on "wallet"."cashu_token_swaps" using "btree" ("user_id");
create index "idx_cashu_token_swaps_transaction_id" on "wallet"."cashu_token_swaps" using "btree" ("transaction_id");

-- RLS policies for cashu_token_swaps
alter table "wallet"."cashu_token_swaps" enable row level security;

create policy "Enable CRUD for cashu token swaps based on user_id"
on "wallet"."cashu_token_swaps"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: cashu_send_quotes
create table if not exists "wallet"."cashu_send_quotes" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "created_at" timestamp with time zone default "now"() not null,
  "expires_at" timestamp with time zone not null,
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "currency_requested" "text" not null,
  "keyset_id" "text" not null,
  "keyset_counter" integer not null,
  "number_of_change_outputs" integer not null,
  "state" "text" default 'UNPAID'::"text" not null,
  "failure_reason" "text",
  "version" integer default 0 not null,
  "transaction_id" "uuid" not null references "wallet"."transactions"("id"),
  "encrypted_data" "text" not null,
  "payment_hash" "text" not null,
  "quote_id_hash" "text" not null,
  constraint "cashu_send_quotes_state_check" check (("state" = any (array['UNPAID'::"text", 'PENDING'::"text", 'EXPIRED'::"text", 'FAILED'::"text", 'PAID'::"text"])))
);

-- Indexes
create unique index "cashu_send_quotes_quote_id_hash_key" on "wallet"."cashu_send_quotes" using "btree" ("account_id", "quote_id_hash") where (("quote_id_hash" is not null) and ("state" <> 'FAILED'::"text"));
create index "idx_cashu_send_quotes_user_id" on "wallet"."cashu_send_quotes" using "btree" ("user_id");
create index "idx_cashu_send_quotes_transaction_id" on "wallet"."cashu_send_quotes" using "btree" ("transaction_id");

-- RLS policies for cashu_send_quotes
alter table "wallet"."cashu_send_quotes" enable row level security;

create policy "Enable CRUD for cashu send quotes based on user_id"
on "wallet"."cashu_send_quotes"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: cashu_send_swaps
create table if not exists "wallet"."cashu_send_swaps" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "transaction_id" "uuid" not null references "wallet"."transactions"("id"),
  "keyset_id" "text",
  "keyset_counter" integer,
  "token_hash" "text",
  "state" "text" not null,
  "version" integer default 0 not null,
  "created_at" timestamp with time zone default "now"() not null,
  "failure_reason" "text",
  "encrypted_data" "text" not null,
  "requires_input_proofs_swap" boolean default false not null,
  constraint "cashu_send_swaps_state_check" check (("state" = any (array['DRAFT'::"text", 'PENDING'::"text", 'COMPLETED'::"text", 'FAILED'::"text", 'REVERSED'::"text"]))),
  constraint "cashu_send_swaps_token_hash_required_check" check (((("state" = any (array['DRAFT'::"text", 'FAILED'::"text"])) and ("token_hash" is null)) or (("state" <> all (array['DRAFT'::"text", 'FAILED'::"text"])) and ("token_hash" is not null))))
);

-- Indexes
create index "idx_cashu_send_swaps_state_created_at" on "wallet"."cashu_send_swaps" using "btree" ("state", "created_at") where ("state" = any (array['COMPLETED'::"text", 'FAILED'::"text", 'REVERSED'::"text"]));
create index "idx_cashu_send_swaps_transaction_id" on "wallet"."cashu_send_swaps" using "btree" ("transaction_id");
create index "idx_cashu_send_swaps_user_id_state" on "wallet"."cashu_send_swaps" using "btree" ("user_id", "state") where ("state" = any (array['DRAFT'::"text", 'PENDING'::"text"]));
create index "idx_cashu_send_swaps_account_id" on "wallet"."cashu_send_swaps" using "btree" ("account_id");

-- RLS policies for cashu_send_swaps
alter table "wallet"."cashu_send_swaps" enable row level security;

create policy "Enable CRUD for cashu send swaps based on user_id"
on "wallet"."cashu_send_swaps"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- FKs for cashu_proofs to tables that were defined above (added here because cashu_proofs is defined before these tables)
alter table only "wallet"."cashu_proofs"
    add constraint "cashu_proofs_cashu_receive_quote_id_fkey" foreign key ("cashu_receive_quote_id") references "wallet"."cashu_receive_quotes"("id") on delete set null;

alter table only "wallet"."cashu_proofs"
    add constraint "cashu_proofs_cashu_send_quote_id_fkey" foreign key ("cashu_send_quote_id") references "wallet"."cashu_send_quotes"("id") on delete set null;

alter table only "wallet"."cashu_proofs"
    add constraint "cashu_proofs_cashu_send_swap_id_fkey" foreign key ("cashu_send_swap_id") references "wallet"."cashu_send_swaps"("id") on delete set null;

alter table only "wallet"."cashu_proofs"
    add constraint "cashu_proofs_spending_cashu_send_quote_id_fkey" foreign key ("spending_cashu_send_quote_id") references "wallet"."cashu_send_quotes"("id") on delete set null;

alter table only "wallet"."cashu_proofs"
    add constraint "cashu_proofs_spending_cashu_send_swap_id_fkey" foreign key ("spending_cashu_send_swap_id") references "wallet"."cashu_send_swaps"("id") on delete set null;

alter table only "wallet"."cashu_proofs"
    add constraint "cashu_proofs_token_swap_fkey" foreign key ("cashu_token_swap_token_hash", "user_id") references "wallet"."cashu_token_swaps"("token_hash", "user_id") on delete set null;


-- Table: spark_receive_quotes
create table if not exists "wallet"."spark_receive_quotes" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "type" "text" not null,
  "state" "text" default 'UNPAID'::"text" not null,
  "created_at" timestamp with time zone default "now"() not null,
  "expires_at" timestamp with time zone not null,
  "payment_hash" "text" not null,
  "spark_id" "text" not null,
  "spark_transfer_id" "text",
  "receiver_identity_pubkey" "text",
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "transaction_id" "uuid" not null references "wallet"."transactions"("id"),
  "version" integer default 0 not null,
  "encrypted_data" "text" not null,
  "failure_reason" "text",
  "cashu_token_melt_initiated" boolean,
  constraint "spark_receive_quotes_cashu_token_melt_initiated_check" check ((("type" <> 'CASHU_TOKEN'::"text") or ("cashu_token_melt_initiated" is not null))),
  constraint "spark_receive_quotes_state_check" check (("state" = any (array['UNPAID'::"text", 'EXPIRED'::"text", 'PAID'::"text", 'FAILED'::"text"]))),
  constraint "spark_receive_quotes_type_check" check (("type" = any (array['LIGHTNING'::"text", 'CASHU_TOKEN'::"text"])))
);

comment on table "wallet"."spark_receive_quotes" is 'Tracks lightning receive requests created via Spark wallet. Each quote represents a lightning invoice waiting to be paid.';
comment on column "wallet"."spark_receive_quotes"."failure_reason" is 'Reason for the failure when state is FAILED. NULL for other states.';
comment on column "wallet"."spark_receive_quotes"."cashu_token_melt_initiated" is 'Whether the melt has been initiated on the source mint. Required (NOT NULL) when type is CASHU_TOKEN, NULL otherwise.';

-- Indexes
create index "idx_spark_receive_quotes_state_created_at" on "wallet"."spark_receive_quotes" using "btree" ("state", "created_at");
create index "idx_spark_receive_quotes_state_user_id" on "wallet"."spark_receive_quotes" using "btree" ("user_id", "state") where ("state" = 'UNPAID'::"text");
create unique index "spark_receive_quotes_spark_id_unique" on "wallet"."spark_receive_quotes" using "btree" ("spark_id");
create unique index "spark_receive_quotes_spark_transfer_id_unique" on "wallet"."spark_receive_quotes" using "btree" ("spark_transfer_id") where ("spark_transfer_id" is not null);
create index "idx_spark_receive_quotes_account_id" on "wallet"."spark_receive_quotes" using "btree" ("account_id");
create index "idx_spark_receive_quotes_transaction_id" on "wallet"."spark_receive_quotes" using "btree" ("transaction_id");

-- RLS policies for spark_receive_quotes
alter table "wallet"."spark_receive_quotes" enable row level security;

create policy "Enable CRUD for spark receive quotes based on user_id"
on "wallet"."spark_receive_quotes"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: spark_send_quotes
create table if not exists "wallet"."spark_send_quotes" (
  "id" "uuid" default "gen_random_uuid"() not null primary key,
  "state" "text" default 'UNPAID'::"text" not null,
  "created_at" timestamp with time zone default "now"() not null,
  "payment_hash" "text" not null,
  "spark_id" "text",
  "spark_transfer_id" "text",
  "failure_reason" "text",
  "user_id" "uuid" not null references "wallet"."users"("id"),
  "account_id" "uuid" not null references "wallet"."accounts"("id"),
  "transaction_id" "uuid" not null references "wallet"."transactions"("id"),
  "version" integer default 0 not null,
  "payment_request_is_amountless" boolean default false not null,
  "expires_at" timestamp with time zone,
  "encrypted_data" "text" not null,
  constraint "spark_send_quotes_spark_id_required" check ((("state" = 'UNPAID'::"text") or ("state" = 'FAILED'::"text") or ("spark_id" is not null))),
  constraint "spark_send_quotes_state_check" check (("state" = any (array['UNPAID'::"text", 'PENDING'::"text", 'COMPLETED'::"text", 'FAILED'::"text"])))
);

comment on table "wallet"."spark_send_quotes" is 'Tracks lightning send requests created via Spark wallet. Each quote represents a lightning payment in progress.';
comment on column "wallet"."spark_send_quotes"."expires_at" is 'Timestamp when this send quote expires and is no longer valid for payment.';

-- Indexes
create index "idx_spark_send_quotes_state_created_at" on "wallet"."spark_send_quotes" using "btree" ("state", "created_at");
create index "idx_spark_send_quotes_unresolved" on "wallet"."spark_send_quotes" using "btree" ("user_id", "state") where ("state" = any (array['UNPAID'::"text", 'PENDING'::"text"]));
create unique index "spark_send_quotes_payment_hash_active_unique" on "wallet"."spark_send_quotes" using "btree" ("user_id", "payment_hash") where ("state" = any (array['UNPAID'::"text", 'PENDING'::"text"]));
create unique index "spark_send_quotes_spark_id_unique" on "wallet"."spark_send_quotes" using "btree" ("spark_id") where ("spark_id" is not null);
create unique index "spark_send_quotes_spark_transfer_id_unique" on "wallet"."spark_send_quotes" using "btree" ("spark_transfer_id") where ("spark_transfer_id" is not null);
create index "idx_spark_send_quotes_account_id" on "wallet"."spark_send_quotes" using "btree" ("account_id");
create index "idx_spark_send_quotes_transaction_id" on "wallet"."spark_send_quotes" using "btree" ("transaction_id");

-- RLS policies for spark_send_quotes
alter table "wallet"."spark_send_quotes" enable row level security;

create policy "Enable CRUD for spark send quotes based on user_id"
on "wallet"."spark_send_quotes"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- Table: task_processing_locks
create table if not exists "wallet"."task_processing_locks" (
  "user_id" "uuid" not null primary key references "wallet"."users"("id") on update cascade on delete cascade,
  "lead_client_id" "uuid" not null,
  "expires_at" timestamp with time zone not null
);

-- RLS policies for task_processing_locks
alter table "wallet"."task_processing_locks" enable row level security;

create policy "Enable CRUD for task processing locks based on user_id"
on "wallet"."task_processing_locks"
as permissive
for all
to authenticated
using ((( select auth.uid() as uid) = user_id))
with check ((( select auth.uid() as uid) = user_id));


-- =============================================================================
-- DATABASE FUNCTIONS
-- =============================================================================

create type "wallet"."cashu_proof_input" as (
	"keysetId" "text",
	"amount" "text",
	"secret" "text",
	"unblindedSignature" "text",
	"publicKeyY" "text",
	"dleq" "jsonb",
	"witness" "jsonb"
);

comment on type "wallet"."cashu_proof_input" is 'Input type for cashu proofs passed to database functions. Uses camelCase field names to match application layer.';

-- -----------------------------------------------------------------------------
-- REUSABLE FUNCTIONS
-- -----------------------------------------------------------------------------

-- Returns all unspent proofs for an account as a typed array. If no proofs are found, an empty array is returned.
create or replace function "wallet"."get_account_proofs"(
  "p_account_id" "uuid"
)
returns "wallet"."cashu_proofs"[]
language sql
security invoker
set search_path = ''
as $function$
select coalesce(array_agg(row(cp.*)::wallet.cashu_proofs), '{}')
  from wallet.cashu_proofs cp
  where cp.account_id = p_account_id and cp.state = 'UNSPENT';
$function$;

-- Returns account with all its unspent proofs as a JSONB object
create or replace function "wallet"."get_account_with_proofs"(
  "p_account_id" "uuid"
)
returns "jsonb"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
begin
  select * into v_account
  from wallet.accounts
  where id = p_account_id;

  if v_account is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Account %s not found.', p_account_id);
  end if;

  v_account_with_proofs := jsonb_set(
    to_jsonb(v_account), 
    '{cashu_proofs}', 
    to_jsonb(wallet.get_account_proofs(p_account_id))
  );

  return v_account_with_proofs;
end;
$function$;

-- Converts a wallet.accounts row to JSONB with unspent proofs included
create or replace function "wallet"."to_account_with_proofs"(
  "p_account" "wallet"."accounts"
)
returns "jsonb"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account_with_proofs jsonb;
begin
  v_account_with_proofs := jsonb_set(
    to_jsonb(p_account),
    '{cashu_proofs}',
    to_jsonb(wallet.get_account_proofs(p_account.id))
  );

  return v_account_with_proofs;
end;
$function$;

-- Adds cashu proofs for the account. Returns the array of added proofs.
create or replace function "wallet"."add_cashu_proofs"(
  "p_proofs" "wallet"."cashu_proof_input"[],
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_proofs_state" "text" default 'UNSPENT'::"text",
  "p_cashu_receive_quote_id" "uuid" default null::"uuid",
  "p_cashu_token_swap_token_hash" "text" default null::"text",
  "p_cashu_send_quote_id" "uuid" default null::"uuid",
  "p_cashu_send_swap_id" "uuid" default null::"uuid",
  "p_spending_cashu_send_swap_id" "uuid" default null::"uuid"
)
returns "wallet"."cashu_proofs"[]
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_added_proofs wallet.cashu_proofs[];
begin
  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_added_proofs" you will get "query returned more than one row" error.
  with inserted_proofs as (
    insert into wallet.cashu_proofs (
      user_id,
      account_id,
      cashu_receive_quote_id,
      cashu_token_swap_token_hash,
      cashu_send_quote_id,
      cashu_send_swap_id,
      spending_cashu_send_swap_id,
      keyset_id,
      amount,
      secret,
      unblinded_signature,
      public_key_y,
      dleq,
      witness,
      state
    )
    select
      p_user_id,
      p_account_id,
      p_cashu_receive_quote_id,
      p_cashu_token_swap_token_hash,
      p_cashu_send_quote_id,
      p_cashu_send_swap_id,
      p_spending_cashu_send_swap_id,
      proof."keysetId",
      proof."amount",
      proof."secret",
      proof."unblindedSignature",
      proof."publicKeyY",
      proof."dleq",
      proof."witness",
      p_proofs_state
    from unnest(p_proofs) as proof
    returning *
  )
  select array_agg(row(inserted_proofs.*)::wallet.cashu_proofs)
  into v_added_proofs
  from inserted_proofs;

  return v_added_proofs;
end;
$function$;

create type "wallet"."add_cashu_proofs_and_update_account_result" as (
	"account" "jsonb",
	"added_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."add_cashu_proofs_and_update_account"(
  "p_proofs" "wallet"."cashu_proof_input"[],
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_proofs_state" "text" default 'UNSPENT'::"text",
  "p_cashu_receive_quote_id" "uuid" default null::"uuid",
  "p_cashu_token_swap_token_hash" "text" default null::"text",
  "p_cashu_send_quote_id" "uuid" default null::"uuid",
  "p_cashu_send_swap_id" "uuid" default null::"uuid",
  "p_spending_cashu_send_swap_id" "uuid" default null::"uuid"
)
returns "wallet"."add_cashu_proofs_and_update_account_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account wallet.accounts;
  v_added_proofs wallet.cashu_proofs[];
  v_account_with_proofs jsonb;
begin
  v_added_proofs := wallet.add_cashu_proofs(
    p_proofs,
    p_user_id,
    p_account_id,
    p_proofs_state,
    p_cashu_receive_quote_id,
    p_cashu_token_swap_token_hash,
    p_cashu_send_quote_id,
    p_cashu_send_swap_id,
    p_spending_cashu_send_swap_id
  );

  update wallet.accounts a
  set version = version + 1
  where a.id = p_account_id
  returning * into v_account;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_account_with_proofs, v_added_proofs);
end;
$function$;

-- -----------------------------------------------------------------------------
-- USER FUNCTIONS
-- -----------------------------------------------------------------------------
create type "wallet"."account_input" as (
	"type" "text",
	"currency" "text",
	"name" "text",
	"details" "jsonb",
	"is_default" boolean
);

create type "wallet"."upsert_user_with_accounts_result" as (
	"user" "wallet"."users",
	"accounts" "jsonb"[]
);

create or replace function "wallet"."upsert_user_with_accounts"(
  "p_user_id" "uuid",
  "p_email" "text",
  "p_email_verified" boolean,
  "p_accounts" "wallet"."account_input"[],
  "p_cashu_locking_xpub" "text",
  "p_encryption_public_key" "text",
  "p_spark_identity_public_key" "text"
)
returns "wallet"."upsert_user_with_accounts_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  result_user wallet.users;
  result_accounts jsonb[];
  usd_account_id uuid := null;
  btc_account_id uuid := null;
  placeholder_btc_account_id uuid := gen_random_uuid();
begin
  -- Insert user with placeholder default_btc_account_id. The FK constraint is deferred,
  -- so it won't be checked until transaction commit. We'll update it with the real
  -- account ID after creating accounts.
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub, encryption_public_key, spark_identity_public_key, default_currency, default_btc_account_id)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub, p_encryption_public_key, p_spark_identity_public_key, 'BTC', placeholder_btc_account_id)
  on conflict (id) do update set
    email = coalesce(excluded.email, wallet.users.email),
    email_verified = excluded.email_verified;

  select *
  into result_user
  from wallet.users u
  where u.id = p_user_id
  for update;

  with accounts_with_proofs as (
    select 
      a.*,
      coalesce(
        jsonb_agg(to_jsonb(cp)) filter (where cp.id is not null),
        '[]'::jsonb
      ) as cashu_proofs
    from
      wallet.accounts a
      left join wallet.cashu_proofs cp on cp.account_id = a.id and cp.state = 'UNSPENT'
    where a.user_id = p_user_id
    group by a.id
  )
  select array_agg(
    jsonb_set(
      to_jsonb(awp),
      '{cashu_proofs}',
      awp.cashu_proofs
    )
  )
  into result_accounts
  from accounts_with_proofs awp;

  if result_accounts is not null then
    return (result_user, result_accounts);
  end if;

  if array_length(p_accounts, 1) is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_accounts cannot be an empty array';
  end if;

  if not exists (select 1 from unnest(p_accounts) as acct where acct.currency = 'BTC' and acct.type = 'spark') then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'At least one BTC Spark account is required';
  end if;

  with
    inserted_accounts as (
      insert into wallet.accounts (user_id, type, currency, name, details)
      select 
        p_user_id,
        acct.type,
        acct.currency,
        acct.name,
        acct.details
      from unnest(p_accounts) as acct
      returning *
    ),
    accounts_with_default_flag as (
      select 
        ia.*,
        coalesce(acct."is_default", false) as "is_default"
      from
        inserted_accounts ia
        join unnest(p_accounts) as acct on 
          ia.type = acct.type and 
          ia.currency = acct.currency and 
          ia.name = acct.name and 
          ia.details = acct.details
    )
  select 
    array_agg(
      jsonb_set(
        to_jsonb(awd),
        '{cashu_proofs}',
        '[]'::jsonb
      )
    ),
    (array_agg(awd.id) filter (where awd.currency = 'USD' and awd."is_default"))[1],
    (array_agg(awd.id) filter (where awd.currency = 'BTC' and awd."is_default"))[1]
  into result_accounts, usd_account_id, btc_account_id
  from accounts_with_default_flag awd;

  update wallet.users u
  set 
    default_usd_account_id = coalesce(usd_account_id, u.default_usd_account_id),
    default_btc_account_id = coalesce(btc_account_id, u.default_btc_account_id),
    default_currency = case
      when btc_account_id is not null then 'BTC'
      when usd_account_id is not null then 'USD'
      else u.default_currency
    end
  where id = p_user_id
  returning * into result_user;

  return (result_user, result_accounts);
end;
$function$;

-- -----------------------------------------------------------------------------
-- CASHU RECEIVE QUOTE FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function "wallet"."create_cashu_receive_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "text",
  "p_expires_at" timestamp with time zone,
  "p_locking_derivation_path" "text",
  "p_receive_type" "text",
  "p_encrypted_data" "text",
  "p_quote_id_hash" "text",
  "p_payment_hash" "text"
)
returns "wallet"."cashu_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type text;
  v_transaction_state text;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_quote wallet.cashu_receive_quotes;
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'CASHU_LIGHTNING'
    when 'CASHU_TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, CASHU_TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- We create token receives as pending because the lightning payment on the sender
  -- side will be triggered by the receiver, so we know it should get paid.
  -- For lightning, we create a draft transaction record because its not guaranteed that
  -- the invoice will ever be paid.
  v_transaction_state := case v_transaction_type
    when 'CASHU_TOKEN' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  -- Store encrypted data in transactions table as encrypted_transaction_details
  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    jsonb_build_object('paymentHash', p_payment_hash)
  ) returning id into v_transaction_id;

  insert into wallet.cashu_receive_quotes (
    user_id,
    account_id,
    expires_at,
    state,
    locking_derivation_path,
    transaction_id,
    type,
    encrypted_data,
    quote_id_hash,
    payment_hash,
    cashu_token_melt_initiated
  ) values (
    p_user_id,
    p_account_id,
    p_expires_at,
    'UNPAID',
    p_locking_derivation_path,
    v_transaction_id,
    p_receive_type,
    p_encrypted_data,
    p_quote_id_hash,
    p_payment_hash,
    v_cashu_token_melt_initiated
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

create type "wallet"."cashu_receive_quote_payment_result" as (
	"quote" "wallet"."cashu_receive_quotes",
	"account" "jsonb"
);

create or replace function "wallet"."process_cashu_receive_quote_payment"(
  "p_quote_id" "uuid",
  "p_keyset_id" "text",
  "p_number_of_outputs" integer,
  "p_encrypted_data" "text"
)
returns "wallet"."cashu_receive_quote_payment_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_counter integer;
begin
  if p_keyset_id is null or trim(p_keyset_id) = '' then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_keyset_id must not be null or empty.',
        detail = format('Value provided: %s', p_keyset_id);
  end if;

  if p_number_of_outputs <= 0 then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_number_of_outputs must be greater than 0.',
        detail = format('Value provided: %s', p_number_of_outputs);
  end if;

  select * into v_quote
  from wallet.cashu_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'PAID' or v_quote.state = 'COMPLETED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    return (v_quote, v_account_with_proofs);
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to process payment for quote with id %s.', v_quote.id),
        detail = format('Quote is not in UNPAID state. Current state: %s.', v_quote.state);
  end if;

  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + p_number_of_outputs
      ), 
      true
    ),
    version = version + 1
  where a.id = v_quote.account_id
  returning * into v_account;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - p_number_of_outputs;

  update wallet.cashu_receive_quotes q
  set 
    state = 'PAID',
    keyset_id = p_keyset_id,
    keyset_counter = v_counter,
    encrypted_data = p_encrypted_data,
    version = version + 1
  where q.id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set 
    state = 'PENDING',
    pending_at = now(),
    encrypted_transaction_details = p_encrypted_data
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs);
end;
$function$;

create type "wallet"."complete_cashu_receive_quote_result" as (
	"quote" "wallet"."cashu_receive_quotes",
	"account" "jsonb",
	"added_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."complete_cashu_receive_quote"(
  "p_quote_id" "uuid",
  "p_proofs" "wallet"."cashu_proof_input"[]
)
returns "wallet"."complete_cashu_receive_quote_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_added_proofs wallet.cashu_proofs[];
begin
  select * into v_quote
  from wallet.cashu_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'COMPLETED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_added_proofs
    from wallet.cashu_proofs cp
    where cp.cashu_receive_quote_id = v_quote.id;

    return (v_quote, v_account_with_proofs, v_added_proofs);
  end if;

  if v_quote.state != 'PAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete quote with id %s.', v_quote.id),
        detail = format('Quote is not in PAID state. Current state: %s.', v_quote.state);
  end if;

  update wallet.cashu_receive_quotes
  set state = 'COMPLETED',
      version = version + 1
  where id = v_quote.id
  returning * into v_quote;

  select * into v_account_with_proofs, v_added_proofs
  from wallet.add_cashu_proofs_and_update_account(
    p_proofs,
    v_quote.user_id,
    v_quote.account_id,
    p_cashu_receive_quote_id => v_quote.id
  );

  update wallet.transactions
  set state = 'COMPLETED',
      acknowledgment_status = 'pending',
      completed_at = now()
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs, v_added_proofs);
end;
$function$;

create or replace function "wallet"."expire_cashu_receive_quote"(
  "p_quote_id" "uuid"
)
returns "wallet"."cashu_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_quote wallet.cashu_receive_quotes;
    v_now timestamp with time zone;
begin
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id
    for update;

    if v_quote is null then
      raise exception
        using
          hint = 'NOT_FOUND',
          message = format('Quote with id %s not found.', p_quote_id);
    end if;

    if v_quote.state = 'EXPIRED' then
      return v_quote;
    end if;

    if v_quote.state != 'UNPAID' then
      raise exception
        using
          hint = 'INVALID_STATE',
          message = format('Failed to expire quote with id %s.', v_quote.id),
          detail = format('Only quote in UNPAID state can be expired. Found state %s.', v_quote.state);
    end if;

    v_now := now();

    if v_quote.expires_at > v_now then
      raise exception
        using
          hint = 'INVALID_STATE',
          message = format('Failed to expire quote with id %s.', v_quote.id),
          detail = format('Quote has not expired at %s. Expires at %s.', v_now, v_quote.expires_at);
    end if;

    update wallet.cashu_receive_quotes
    set state = 'EXPIRED',
        version = version + 1
    where id = v_quote.id
    returning * into v_quote;

    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_quote.transaction_id;

    return v_quote;
end;
$function$;

create or replace function "wallet"."fail_cashu_receive_quote"(
  "p_quote_id" "uuid",
  "p_failure_reason" "text"
)
returns "wallet"."cashu_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_quote wallet.cashu_receive_quotes;
begin
    select * into v_quote
    from wallet.cashu_receive_quotes
    where id = p_quote_id
    for update;

    if v_quote is null then
      raise exception
        using
          hint = 'NOT_FOUND',
          message = format('Quote with id %s not found.', p_quote_id);
    end if;

    if v_quote.state = 'FAILED' then
      return v_quote;
    end if;

    if v_quote.state not in ('PENDING', 'UNPAID') then
      raise exception
        using
          hint = 'INVALID_STATE',
          message = format('Cannot fail cashu receive quote with id %s.', p_quote_id),
          detail = format('Found state %s, but must be PENDING or UNPAID.', v_quote.state);
    end if;

    update wallet.cashu_receive_quotes
    set state = 'FAILED',
        failure_reason = p_failure_reason,
        version = version + 1
    where id = v_quote.id
    returning * into v_quote;

    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_quote.transaction_id;

    return v_quote;
end;
$function$;

create or replace function "wallet"."mark_cashu_receive_quote_cashu_token_melt_initiated"(
  "p_quote_id" "uuid"
)
returns "wallet"."cashu_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
begin
  select * into v_quote
  from wallet.cashu_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.cashu_token_melt_initiated = true then
    return v_quote;
  end if;

  if v_quote.type != 'CASHU_TOKEN' then
    raise exception
      using
        hint = 'INVALID_OPERATION',
        message = format('Cannot mark cashu token melt initiated for cashu receive quote with id %s.', p_quote_id),
        detail = format('Found type %s, but must be CASHU_TOKEN.', v_quote.type);
  end if;

  update wallet.cashu_receive_quotes
  set
    cashu_token_melt_initiated = true,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$function$;

-- -----------------------------------------------------------------------------
-- CASHU TOKEN SWAP FUNCTIONS
-- -----------------------------------------------------------------------------

create type "wallet"."create_cashu_token_swap_result" as (
	"swap" "wallet"."cashu_token_swaps",
	"account" "jsonb"
);

create or replace function "wallet"."create_cashu_token_swap"(
  "p_token_hash" "text",
  "p_account_id" "uuid",
  "p_user_id" "uuid",
  "p_currency" "text",
  "p_keyset_id" "text",
  "p_number_of_outputs" integer,
  "p_encrypted_data" "text",
  "p_reversed_transaction_id" "uuid" default null::"uuid"
)
returns "wallet"."create_cashu_token_swap_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_account wallet.accounts;
  v_counter integer;
  v_transaction_id uuid;
  v_token_swap wallet.cashu_token_swaps;
  v_account_with_proofs jsonb;
begin
  if p_number_of_outputs <= 0 then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_number_of_outputs must be greater than 0.',
        detail = format('Value provided: %s', p_number_of_outputs);
  end if;

  update wallet.accounts a
  set
    details = jsonb_set(
      details,
      array['keyset_counters', p_keyset_id],
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + p_number_of_outputs
      ),
      true
    ),
    version = version + 1
  where a.id = p_account_id
  returning * into v_account;

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - p_number_of_outputs;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    reversed_transaction_id,
    pending_at,
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    'CASHU_TOKEN',
    'PENDING',
    p_currency,
    p_reversed_transaction_id,
    now(),
    p_encrypted_data
  ) returning id into v_transaction_id;

  insert into wallet.cashu_token_swaps (
    token_hash,
    account_id,
    user_id,
    keyset_id,
    keyset_counter,
    encrypted_data,
    transaction_id
  ) values (
    p_token_hash,
    p_account_id,
    p_user_id,
    p_keyset_id,
    v_counter,
    p_encrypted_data,
    v_transaction_id
  ) returning * into v_token_swap;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_token_swap, v_account_with_proofs);
end;
$function$;

create type "wallet"."complete_cashu_token_swap_result" as (
	"swap" "wallet"."cashu_token_swaps",
	"account" "jsonb",
	"added_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."complete_cashu_token_swap"(
  "p_token_hash" "text",
  "p_user_id" "uuid",
  "p_proofs" "wallet"."cashu_proof_input"[]
)
returns "wallet"."complete_cashu_token_swap_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_token_swap wallet.cashu_token_swaps;
  v_reversed_transaction_id uuid;
  v_send_swap wallet.cashu_send_swaps;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_added_proofs wallet.cashu_proofs[];
begin
  select * into v_token_swap
  from wallet.cashu_token_swaps
  where token_hash = p_token_hash and user_id = p_user_id
  for update;

  if v_token_swap is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Swap for token hash %s not found.', p_token_hash);
  end if;

  if v_token_swap.state = 'COMPLETED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_token_swap.account_id);

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_added_proofs
    from wallet.cashu_proofs cp
    where cp.cashu_token_swap_token_hash = v_token_swap.token_hash 
      and cp.user_id = v_token_swap.user_id;

    return (v_token_swap, v_account_with_proofs, v_added_proofs);
  end if;

  if v_token_swap.state != 'PENDING' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot complete swap for token hash %s.', p_token_hash),
        detail = format('Swap is not in PENDING state. Current state: %s.', v_token_swap.state);
  end if;

  update wallet.cashu_token_swaps
  set state = 'COMPLETED',
      version = version + 1
  where token_hash = p_token_hash and user_id = p_user_id
  returning * into v_token_swap;

  select * into v_account_with_proofs, v_added_proofs
  from wallet.add_cashu_proofs_and_update_account(
    p_proofs,
    v_token_swap.user_id,
    v_token_swap.account_id,
    p_cashu_token_swap_token_hash => v_token_swap.token_hash
  );

  update wallet.transactions
  set state = 'COMPLETED',
      -- Only set acknowledgment status to pending if the token swap is not reversing a send swap
      acknowledgment_status = case when reversed_transaction_id is null then 'pending' else null end,
      completed_at = now()
  where id = v_token_swap.transaction_id
  returning reversed_transaction_id into v_reversed_transaction_id;

  if v_reversed_transaction_id is null then
    return (v_token_swap, v_account_with_proofs, v_added_proofs);
  end if;

  -- If here it means that this receive swap is reversing a send swap

  -- Find the send swap to reverse
  select * into v_send_swap
  from wallet.cashu_send_swaps
  where transaction_id = v_reversed_transaction_id
  for update;

  if v_send_swap is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('No send swap found for transaction id %s.', v_reversed_transaction_id);
  end if;

  -- If the send swap is already reversed, there is nothing to do
  if v_send_swap.state = 'REVERSED' then
    return (v_token_swap, v_account_with_proofs, v_added_proofs);
  end if;

  if v_send_swap.state != 'PENDING' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot reverse send swap with id %s.', v_send_swap.id),
        detail = format('Send swap is not in PENDING state. Current state: %s.', v_send_swap.state);
  end if;

  -- We need to reverse the related send swap and mark the reserved proofs of that swap as spent.
  update wallet.cashu_proofs
  set state = 'SPENT',
      spent_at = now(),
      version = version + 1
  where spending_cashu_send_swap_id = v_send_swap.id and state = 'RESERVED';
  -- We don't need to verify all proofs were successfully marked as spent, because we are updating the proofs related with spending_cashu_send_swap_id 
  -- only through the swap db functions and those functions are locking the swap for update and thus are synchronized.

  update wallet.cashu_send_swaps
  set state = 'REVERSED',
      version = version + 1
  where id = v_send_swap.id;

  update wallet.transactions
  set state = 'REVERSED',
      reversed_at = now()
  where id = v_reversed_transaction_id;

  return (v_token_swap, v_account_with_proofs, v_added_proofs);
end;
$function$;

create or replace function "wallet"."fail_cashu_token_swap"(
  "p_token_hash" "text",
  "p_user_id" "uuid",
  "p_failure_reason" "text"
)
returns "wallet"."cashu_token_swaps"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_token_swap wallet.cashu_token_swaps;
    v_reversed_transaction_id uuid;
begin
    select * into v_token_swap
    from wallet.cashu_token_swaps
    where token_hash = p_token_hash and user_id = p_user_id
    for update;

    if v_token_swap is null then
      raise exception
        using
          hint = 'NOT_FOUND',
          message = format('Swap for token hash %s not found.', p_token_hash);
    end if;

    if v_token_swap.state = 'FAILED' then
      return v_token_swap;
    end if;

    if v_token_swap.state != 'PENDING' then
      raise exception
        using
          hint = 'INVALID_STATE',
          message = format('Cannot fail swap for token hash %s.', p_token_hash),
          detail = format('Swap is not in PENDING state. Current state: %s.', v_token_swap.state);
    end if;

    -- special handling for "Token already claimed" failures
    -- this handles the edge case where:
    -- 1. user initiates a send swap reversal (creating a reversal transaction)
    -- 2. receiver claims the token around the same time
    -- 3. receiver's claim is processed first by the mint
    -- 4. when the onSpent event triggers for the send swap, there's a related reversal transaction in pending state
    -- 5. the reversal transaction will eventually fail with "Token already claimed"
    -- 6. without this handling, the original send swap would stay in pending state forever
    -- this ensures the original send swap is properly marked as completed when the reversal fails due to the token being claimed
    if p_failure_reason = 'Token already claimed' then
        -- get the reversed transaction id if this token swap is reversing a send transaction
        select reversed_transaction_id into v_reversed_transaction_id
        from wallet.transactions
        where id = v_token_swap.transaction_id
        for update;

        -- if this is reversing a send transaction, update the corresponding send swap
        if v_reversed_transaction_id is not null then
            -- update send swap to completed
            update wallet.cashu_send_swaps
            set state = 'COMPLETED',
                version = version + 1
            where transaction_id = v_reversed_transaction_id;

            -- update the original send transaction to completed
            update wallet.transactions
            set state = 'COMPLETED',
                completed_at = now()
            where id = v_reversed_transaction_id;

        end if;
    end if;

    -- update the token swap to failed with optimistic concurrency
    update wallet.cashu_token_swaps
    set state = 'FAILED',
        failure_reason = p_failure_reason,
        version = version + 1
    where token_hash = p_token_hash and user_id = p_user_id
    returning * into v_token_swap;

    -- update the transaction state to failed
    update wallet.transactions
    set state = 'FAILED',
        failed_at = now()
    where id = v_token_swap.transaction_id;

    return v_token_swap;
end;
$function$;

-- -----------------------------------------------------------------------------
-- CASHU SEND QUOTE FUNCTIONS
-- -----------------------------------------------------------------------------

create type "wallet"."create_cashu_send_quote_result" as (
	"quote" "wallet"."cashu_send_quotes",
	"account" "jsonb",
	"reserved_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."create_cashu_send_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "text",
  "p_expires_at" timestamp with time zone,
  "p_currency_requested" "text",
  "p_keyset_id" "text",
  "p_number_of_change_outputs" integer,
  "p_proofs_to_send" "uuid"[],
  "p_encrypted_data" "text",
  "p_quote_id_hash" "text",
  "p_payment_hash" "text"
)
returns "wallet"."create_cashu_send_quote_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_counter integer;
  v_transaction_id uuid;
  v_reserved_proofs wallet.cashu_proofs[];
begin
  if p_number_of_change_outputs < 0 then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_number_of_change_outputs cannot be less than 0.',
        detail = format('Value provided: %s', p_number_of_change_outputs);
  end if;

  if p_number_of_change_outputs > 0 then
    update wallet.accounts a
    set
      details = jsonb_set(
        details,
        array['keyset_counters', p_keyset_id],
        to_jsonb(
          coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + p_number_of_change_outputs
        ),
        true
      ),
      version = version + 1
    where a.id = p_account_id
    returning * into v_account;

    v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - p_number_of_change_outputs;
  else
    -- We still want to update the account version because we are reserving account proofs.
    update wallet.accounts a
    set version = version + 1
    where a.id = p_account_id
    returning * into v_account;

    v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0);
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'CASHU_LIGHTNING',
    'PENDING',
    p_currency,
    p_encrypted_data,
    jsonb_build_object('paymentHash', p_payment_hash)
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_quotes (
    user_id,
    account_id,
    currency_requested,
    expires_at,
    keyset_id,
    keyset_counter,
    number_of_change_outputs,
    transaction_id,
    encrypted_data,
    quote_id_hash,
    payment_hash
  ) values (
    p_user_id,
    p_account_id,
    p_currency_requested,
    p_expires_at,
    p_keyset_id,
    v_counter,
    p_number_of_change_outputs,
    v_transaction_id,
    p_encrypted_data,
    p_quote_id_hash,
    p_payment_hash
  )
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows
  -- "returning into" can only be used with a single value so array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_quote_id = v_quote.id,
      version = version + 1
    where id = any(p_proofs_to_send) and account_id = p_account_id and state = 'UNSPENT'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_reserved_proofs
  from updated_proofs;

  -- Verify all proofs were successfully reserved. Proof might not be successfully reserved if it was modified by another transaction and thus is not UNSPENT anymore.
  if coalesce(array_length(v_reserved_proofs, 1), 0) != array_length(p_proofs_to_send, 1) then
    raise exception using
      hint = 'CONCURRENCY_ERROR',
      message = format('Failed to reserve proofs for cashu send quote with id %s.', v_quote.id),
      detail = 'One or more proofs were modified by another transaction and could not be reserved.';
  end if;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_quote, v_account_with_proofs, v_reserved_proofs);
end;
$function$;


create type "wallet"."mark_cashu_send_quote_as_pending_result" as (
	"quote" "wallet"."cashu_send_quotes",
	"proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."mark_cashu_send_quote_as_pending"(
  "p_quote_id" "uuid"
)
returns "wallet"."mark_cashu_send_quote_as_pending_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_quote wallet.cashu_send_quotes;
    v_proofs wallet.cashu_proofs[];
begin
    select * into v_quote
    from wallet.cashu_send_quotes
    where id = p_quote_id
    for update;

    if v_quote is null then
      raise exception
        using
          hint = 'NOT_FOUND',
          message = format('Quote with id %s not found.', p_quote_id);
    end if;

    if v_quote.state = 'PENDING' then
        select array_agg(row(cp.*)::wallet.cashu_proofs)
        into v_proofs
        from wallet.cashu_proofs cp
        where cp.spending_cashu_send_quote_id = v_quote.id and state = 'RESERVED';

        return (v_quote, v_proofs);
    end if;

    if v_quote.state != 'UNPAID' then
      raise exception
        using
          hint = 'INVALID_STATE',
          message = format('Failed to mark cashu send quote with id %s as pending.', v_quote.id),
          detail = format('Found state %s, but must be UNPAID.', v_quote.state);
    end if;

    update wallet.cashu_send_quotes
    set state = 'PENDING',
        version = version + 1
    where id = p_quote_id
    returning * into v_quote;

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_quote_id = v_quote.id and state = 'RESERVED';

    return (v_quote, v_proofs);
end;
$function$;

create type "wallet"."complete_cashu_send_quote_result" as (
	"quote" "wallet"."cashu_send_quotes",
	"account" "jsonb",
	"spent_proofs" "wallet"."cashu_proofs"[],
	"change_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."complete_cashu_send_quote"(
  "p_quote_id" "uuid",
  "p_change_proofs" "wallet"."cashu_proof_input"[],
  "p_encrypted_data" "text"
)
returns "wallet"."complete_cashu_send_quote_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_spent_proofs wallet.cashu_proofs[];
  v_change_proofs wallet.cashu_proofs[];
begin
  select * into v_quote
  from wallet.cashu_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'PAID' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_spent_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_quote_id = v_quote.id;

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_change_proofs
    from wallet.cashu_proofs cp
    where cp.cashu_send_quote_id = v_quote.id;

    return (v_quote, v_account_with_proofs, v_spent_proofs, v_change_proofs);
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete cashu send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.cashu_send_quotes
  set state = 'PAID',
      encrypted_data = p_encrypted_data,
      version = version + 1
  where id = v_quote.id
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows
  -- "returning into" can only be used with a single value so array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_spent_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'SPENT',
        spent_at = now(),
        version = version + 1
    where spending_cashu_send_quote_id = v_quote.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_spent_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as spent, because we are spending the proofs related with spending_cashu_send_quote_id
  -- only through the quote db functions and those functions are locking the quote for update and thus are synchronized.

  select * into v_account_with_proofs, v_change_proofs
  from wallet.add_cashu_proofs_and_update_account(
    p_change_proofs,
    v_quote.user_id,
    v_quote.account_id,
    p_cashu_send_quote_id => v_quote.id
  );

  update wallet.transactions
  set state = 'COMPLETED',
      completed_at = now(),
      encrypted_transaction_details = p_encrypted_data
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs, v_spent_proofs, v_change_proofs);
end;
$function$;

create type "wallet"."expire_cashu_send_quote_result" as (
	"quote" "wallet"."cashu_send_quotes",
	"account" "jsonb",
	"released_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."expire_cashu_send_quote"(
  "p_quote_id" "uuid"
)
returns "wallet"."expire_cashu_send_quote_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_released_proofs wallet.cashu_proofs[];
  v_now timestamp with time zone;
begin
  select * into v_quote
  from wallet.cashu_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'EXPIRED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    -- If proofs have spending_cashu_send_quote_id set to the id of the EXPIRED send quote but their state is UNSPENT, 
    -- those are the proofs that were previously reserved for this expired quote.
    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_released_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_quote_id = v_quote.id and state = 'UNSPENT';

    return (v_quote, v_account_with_proofs, v_released_proofs);
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to expire cashu send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID.', v_quote.state);
  end if;

  v_now := now();

  if v_quote.expires_at > v_now then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to expire cashu send quote with id %s.', v_quote.id),
        detail = format('Quote has not expired at %s. Expires at %s.', v_now, v_quote.expires_at);
  end if;

  update wallet.cashu_send_quotes
  set state = 'EXPIRED',
      version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_released_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'UNSPENT',
        version = version + 1
    where spending_cashu_send_quote_id = v_quote.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_released_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as unspent, because we are updating the proofs related with spending_cashu_send_quote_id 
  -- only through the quote db functions and those functions are locking the quote for update and thus are synchronized.

  update wallet.accounts a
  set version = version + 1
  where a.id = v_quote.account_id
  returning * into v_account;

  update wallet.transactions
  set state = 'FAILED',
      failed_at = now()
  where id = v_quote.transaction_id;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_quote, v_account_with_proofs, v_released_proofs);
end;
$function$;

create type "wallet"."fail_cashu_send_quote_result" as (
	"quote" "wallet"."cashu_send_quotes",
	"account" "jsonb",
	"released_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."fail_cashu_send_quote"(
  "p_quote_id" "uuid",
  "p_failure_reason" "text"
)
returns "wallet"."fail_cashu_send_quote_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.cashu_send_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_released_proofs wallet.cashu_proofs[];
begin
  select * into v_quote
  from wallet.cashu_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'FAILED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_quote.account_id);

    -- If proofs have spending_cashu_send_quote_id set to the id of the FAILED send quote but their state is UNSPENT, 
    -- those are the proofs that were previously reserved for this failed quote.
    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_released_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_quote_id = v_quote.id and state = 'UNSPENT';

    return (v_quote, v_account_with_proofs, v_released_proofs);
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot fail cashu send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.cashu_send_quotes
  set state = 'FAILED',
      failure_reason = p_failure_reason,
      version = version + 1
  where id = v_quote.id
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_released_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'UNSPENT',
        version = version + 1
    where spending_cashu_send_quote_id = v_quote.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_released_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as unspent, because we are updating the proofs related with spending_cashu_send_quote_id 
  -- only through the quote db functions and those functions are locking the quote for update and thus are synchronized.

  update wallet.accounts a
  set version = version + 1
  where a.id = v_quote.account_id
  returning * into v_account;

  update wallet.transactions
  set state = 'FAILED',
      failed_at = now()
  where id = v_quote.transaction_id;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_quote, v_account_with_proofs, v_released_proofs);
end;
$function$;

-- -----------------------------------------------------------------------------
-- CASHU SEND SWAP FUNCTIONS
-- -----------------------------------------------------------------------------

create type "wallet"."create_cashu_send_swap_result" as (
	"swap" "wallet"."cashu_send_swaps",
	"account" "jsonb",
	"reserved_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."create_cashu_send_swap"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_input_proofs" "uuid"[],
  "p_currency" "text",
  "p_encrypted_data" "text",
  "p_requires_input_proofs_swap" boolean,
  "p_token_hash" "text" default null::"text",
  "p_keyset_id" "text" default null::"text",
  "p_number_of_outputs" integer default null::integer
)
returns "wallet"."create_cashu_send_swap_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_state text;
  v_keyset_id text; -- We are declaring this variable instead of storing the value directly from p_keyset_id to prevent it being added to db for the state it shouldn't be added for.
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_keyset_counter integer;
  v_transaction_id uuid;
  v_swap wallet.cashu_send_swaps;
  v_reserved_proofs wallet.cashu_proofs[];
begin
  -- If the input amount is equal to the amount to send, there is no need to swap the input proofs so the swap is ready to be committed (set to PENDING).
  if p_requires_input_proofs_swap then
    v_state := 'DRAFT';
  else
    v_state := 'PENDING';
  end if;

  if v_state = 'PENDING' then
    -- Incrementing just the account version because no keyset counter is being updated and we still need to reserve the proofs.
    update wallet.accounts a
    set version = version + 1
    where a.id = p_account_id
    returning * into v_account;

  elsif v_state = 'DRAFT' then
    if p_keyset_id is null or trim(p_keyset_id) = '' then
      raise exception
        using
          hint = 'INVALID_ARGUMENT',
          message = 'When state is DRAFT, p_keyset_id must be provided and not empty.',
          detail = format('Value provided: %s', p_keyset_id);
    end if;

    if p_number_of_outputs is null or p_number_of_outputs <= 0 then
      raise exception
        using
          hint = 'INVALID_ARGUMENT',
          message = 'When state is DRAFT, p_number_of_outputs must be provided and greater than 0.',
          detail = format('Value provided: %s', p_number_of_outputs);
    end if;

    v_keyset_id := p_keyset_id;

    update wallet.accounts a
    set
      details = jsonb_set(
        details,
        array['keyset_counters', v_keyset_id],
        to_jsonb(
          coalesce((details->'keyset_counters'->>v_keyset_id)::integer, 0) + p_number_of_outputs
        ),
        true
      ),
      version = version + 1
    where a.id = p_account_id
    returning * into v_account;

    -- Keyset counter value before the increment (This is the value used for this swap)
    v_keyset_counter := coalesce((v_account.details->'keyset_counters'->>v_keyset_id)::integer, 0) - p_number_of_outputs;
  end if;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    pending_at,
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'CASHU_TOKEN',
    'PENDING',
    p_currency,
    now(),
    p_encrypted_data
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_swaps (
    user_id,
    account_id,
    transaction_id,
    keyset_id,
    keyset_counter,
    token_hash,
    state,
    encrypted_data,
    requires_input_proofs_swap
  ) values (
    p_user_id,
    p_account_id,
    v_transaction_id,
    v_keyset_id,
    v_keyset_counter,
    p_token_hash,
    v_state,
    p_encrypted_data,
    p_requires_input_proofs_swap
  ) returning * into v_swap;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows
  -- "returning into" can only be used with a single value so array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_swap_id = v_swap.id,
      version = version + 1
    where id = any(p_input_proofs) and account_id = p_account_id and state = 'UNSPENT'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_reserved_proofs
  from updated_proofs;

  -- Verify all proofs were successfully reserved. Proof might not be successfully reserved if it was modified by another transaction and thus is not UNSPENT anymore.
  if coalesce(array_length(v_reserved_proofs, 1), 0) != array_length(p_input_proofs, 1) then
    raise exception using
      hint = 'CONCURRENCY_ERROR',
      message = format('Failed to reserve proofs for cashu send swap with id %s.', v_swap.id),
      detail = 'One or more proofs were modified by another transaction and could not be reserved.';
  end if;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_swap, v_account_with_proofs, v_reserved_proofs);
end;
$function$;

create type "wallet"."commit_proofs_to_send_result" as (
	"swap" "wallet"."cashu_send_swaps",
	"account" "jsonb",
	"spent_proofs" "wallet"."cashu_proofs"[],
	"reserved_proofs" "wallet"."cashu_proofs"[],
	"change_proofs" "wallet"."cashu_proofs"[]
);

/**
  Commits the proofs to send, after the swap of the input proofs has been performed.
  The input proofs of the swap are marked as spent, send proofs are added to the account and reserved for the swap, and change proofs of the input swap are added to the account.
**/
create or replace function "wallet"."commit_proofs_to_send"(
  "p_swap_id" "uuid",
  "p_proofs_to_send" "wallet"."cashu_proof_input"[],
  "p_change_proofs" "wallet"."cashu_proof_input"[],
  "p_token_hash" "text"
)
returns "wallet"."commit_proofs_to_send_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_swap wallet.cashu_send_swaps;
  v_spent_proofs wallet.cashu_proofs[];
  v_reserved_proofs wallet.cashu_proofs[];
  v_change_proofs wallet.cashu_proofs[];
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
begin
  select * into v_swap
  from wallet.cashu_send_swaps
  where id = p_swap_id
  for update;

  if v_swap is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Swap with id %s not found.', p_swap_id);
  end if;

  if v_swap.state = 'PENDING' and v_swap.requires_input_proofs_swap then
    v_account_with_proofs := wallet.get_account_with_proofs(v_swap.account_id);

    -- We can find input proofs of this swap by checking the spending_cashu_send_swap_id and state = 'SPENT'.
    -- When the swap is created, the input proofs are reserved, and the spending_cashu_send_swap_id is set to the swap id.
    -- Then after the input proofs are swapped and we commit (reserve) the proofs to send, we mark the input proofs as spent.
    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_spent_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_swap_id = v_swap.id and state = 'SPENT';

    -- We can find reserved proofs of this swap by checking the spending_cashu_send_swap_id and state = 'RESERVED'.
    -- When the input proofs are swapped and we commit (reserve) the proofs to send, we mark the send proofs as reserved with both cashu_send_swap_id and spending_cashu_send_swap_id set to the swap id.
    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_reserved_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_swap_id = v_swap.id and state = 'RESERVED';

    -- When the input proofs are swapped and we commit (reserve) the proofs to send, we mark the change proofs with cashu_send_swap_id. The spending_cashu_send_swap_id is not the swap id because the 
    -- change proofs are not reserved for this swap but just added to the account balance.
    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_change_proofs
    from wallet.cashu_proofs cp
    where cp.cashu_send_swap_id = v_swap.id and cp.spending_cashu_send_swap_id != v_swap.id;

    return (v_swap, v_account_with_proofs, v_spent_proofs, v_reserved_proofs, v_change_proofs);
  end if;

  if v_swap.state != 'DRAFT' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to commit proofs to send for swap with id %s.', v_swap.id),
        detail = format('Found state %s, but must be DRAFT.', v_swap.state);
  end if;

  -- Mark the input proofs as spent (input swap was done to swap the input proofs for the actual proofs to send + change proofs)

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_spent_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'SPENT',
        spent_at = now(),
        version = version + 1
    where spending_cashu_send_swap_id = v_swap.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_spent_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as spent, because we are updating the proofs related with spending_cashu_send_swap_id 
  -- only through the swap db functions and those functions are locking the swap for update and thus are synchronized.

  -- Add the new proofs (proofs to send that were created by swapping the input proofs) to the account and immediately reserve them (they will be spent when the receiver claims the token).
  v_reserved_proofs := wallet.add_cashu_proofs(
    p_proofs_to_send,
    v_swap.user_id,
    v_swap.account_id,
    p_proofs_state => 'RESERVED',
    p_cashu_send_swap_id => v_swap.id,
    p_spending_cashu_send_swap_id => v_swap.id
  );

  -- Add the change proofs (leftover proofs from swapping the input proofs) to the account. 
  v_change_proofs := wallet.add_cashu_proofs(
    p_change_proofs,
    v_swap.user_id,
    v_swap.account_id,
    p_cashu_send_swap_id => v_swap.id
  );

  update wallet.accounts a
  set version = version + 1
  where a.id = v_swap.account_id
  returning * into v_account;

  update wallet.transactions
  set state = 'PENDING',
      pending_at = now()
  where id = v_swap.transaction_id;
  
  update wallet.cashu_send_swaps
  set state = 'PENDING',
      token_hash = p_token_hash,
      version = version + 1
  where id = v_swap.id
  returning * into v_swap;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_swap, v_account_with_proofs, v_spent_proofs, v_reserved_proofs, v_change_proofs);
end;
$function$;

create type "wallet"."complete_cashu_send_swap_result" as (
	"result" "text",
	"swap" "wallet"."cashu_send_swaps",
	"account" "jsonb",
	"spent_proofs" "wallet"."cashu_proofs"[],
	"failure_reason" "text"
);

/**
  This function is used to complete a send swap. It marks the reserved swap proofs as spent, updates the swap, transaction and account states.
  Returns the swap, account with proofs and spent proofs, unless there is a related reversal transaction that is not failed, in which case it returns the swap and null for the account and spent proofs.
**/
create or replace function "wallet"."complete_cashu_send_swap"(
  "p_swap_id" "uuid"
)
returns "wallet"."complete_cashu_send_swap_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_swap wallet.cashu_send_swaps;
  v_reversal_transaction_state text;
  v_spent_proofs wallet.cashu_proofs[];
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
begin
  select * into v_swap
  from wallet.cashu_send_swaps
  where id = p_swap_id
  for update;

  if v_swap is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Swap with id %s not found.', p_swap_id);
  end if;

  if v_swap.state = 'COMPLETED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_swap.account_id);

    -- If the send swap had to swap the input proofs, the spent proofs are not the input proofs but the send proofs that were created by the input swap.
    -- We can recognize those proofs because they have both cashu_send_swap_id and spending_cashu_send_swap_id set to the swap id (they were both added and spent in the same send swap).
    if v_swap.requires_input_proofs_swap then
      select array_agg(row(cp.*)::wallet.cashu_proofs)
      into v_spent_proofs
      from wallet.cashu_proofs cp
      where cp.spending_cashu_send_swap_id = v_swap.id and cp.cashu_send_swap_id = v_swap.id and state = 'SPENT';
    else
      select array_agg(row(cp.*)::wallet.cashu_proofs)
      into v_spent_proofs
      from wallet.cashu_proofs cp
      where cp.spending_cashu_send_swap_id = v_swap.id and state = 'SPENT';
    end if;

    return ('COMPLETED'::text, v_swap, v_account_with_proofs, v_spent_proofs, null::text);
  end if;

  if v_swap.state != 'PENDING' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete swap with id %s.', v_swap.id),
        detail = format('Found state %s, but must be PENDING.', v_swap.state);
  end if;

  -- Check if there's a non-failed reversal transaction pointing to this transaction
  select state into v_reversal_transaction_state
  from wallet.transactions
  where reversed_transaction_id = v_swap.transaction_id
  for update;

  if v_reversal_transaction_state is not null and v_reversal_transaction_state != 'FAILED' then
    -- If there's a reversal transaction that is not failed, return early.
    -- The token swap completion will handle updating the send swap state.
    return ('FAILED'::text, v_swap, null::jsonb, null::wallet.cashu_proofs[], 'Reversal in progress'::text);
  end if;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_spent_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'SPENT',
        spent_at = now(),
        version = version + 1
    where spending_cashu_send_swap_id = v_swap.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_spent_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as spent, because we are updating the proofs related with spending_cashu_send_swap_id 
  -- only through the swap db functions and those functions are locking the swap for update and thus are synchronized.

  update wallet.accounts a
  set version = version + 1
  where a.id = v_swap.account_id
  returning * into v_account;

  update wallet.cashu_send_swaps
  set state = 'COMPLETED',
      version = version + 1
  where id = v_swap.id
  returning * into v_swap;

  update wallet.transactions
  set state = 'COMPLETED',
      completed_at = now()
  where id = v_swap.transaction_id;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return ('COMPLETED'::text, v_swap, v_account_with_proofs, v_spent_proofs, null::text);
end;
$function$;

create type "wallet"."fail_cashu_send_swap_result" as (
	"swap" "wallet"."cashu_send_swaps",
	"account" "jsonb",
	"released_proofs" "wallet"."cashu_proofs"[]
);

create or replace function "wallet"."fail_cashu_send_swap"(
  "p_swap_id" "uuid",
  "p_reason" "text"
)
returns "wallet"."fail_cashu_send_swap_result"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_swap wallet.cashu_send_swaps;
  v_released_proofs wallet.cashu_proofs[];
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
begin
  select * into v_swap
  from wallet.cashu_send_swaps
  where id = p_swap_id
  for update;

  if v_swap is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Swap with id %s not found.', p_swap_id);
  end if;

  if v_swap.state = 'FAILED' then
    v_account_with_proofs := wallet.get_account_with_proofs(v_swap.account_id);

    select array_agg(row(cp.*)::wallet.cashu_proofs)
    into v_released_proofs
    from wallet.cashu_proofs cp
    where cp.spending_cashu_send_swap_id = v_swap.id and state = 'UNSPENT';

    return (v_swap, v_account_with_proofs, v_released_proofs);
  end if;

  if v_swap.state != 'DRAFT' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot fail swap with id %s.', v_swap.id),
        detail = format('Found state %s, but must be DRAFT.', v_swap.state);
  end if;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_released_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set state = 'UNSPENT',
        version = version + 1
    where spending_cashu_send_swap_id = v_swap.id and state = 'RESERVED'
    returning *
  )
  select array_agg(row(updated_proofs.*)::wallet.cashu_proofs) into v_released_proofs
  from updated_proofs;

  -- We don't need to verify all proofs were successfully marked as unspent, because we are updating the proofs related with spending_cashu_send_swap_id 
  -- only through the quote db functions and those functions are locking the quote for update and thus are synchronized.

  update wallet.accounts a
  set version = version + 1
  where a.id = v_swap.account_id
  returning * into v_account;

  update wallet.cashu_send_swaps
  set state = 'FAILED',
      failure_reason = p_reason,
      version = version + 1
  where id = v_swap.id
  returning * into v_swap;

  update wallet.transactions
  set state = 'FAILED',
      failed_at = now()
  where id = v_swap.transaction_id;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_swap, v_account_with_proofs, v_released_proofs);
end;
$function$;

-- -----------------------------------------------------------------------------
-- SPARK RECEIVE QUOTE FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function "wallet"."create_spark_receive_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "text",
  "p_payment_hash" "text",
  "p_expires_at" timestamp with time zone,
  "p_spark_id" "text",
  "p_receiver_identity_pubkey" "text",
  "p_receive_type" "text",
  "p_encrypted_data" "text"
)
returns "wallet"."spark_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_type text;
  v_transaction_state text;
  v_cashu_token_melt_initiated boolean;
  v_transaction_id uuid;
  v_quote wallet.spark_receive_quotes;
begin
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'SPARK_LIGHTNING'
    when 'CASHU_TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, CASHU_TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- We create cashu token receive transactions as pending because the lightning payment is initiated
  -- by the receiver (Agicash app does it automatically), so we know it will get paid. For lightning,
  -- we create a draft transaction record because it's not guaranteed that the invoice will ever be paid.
  v_transaction_state := case v_transaction_type
    when 'CASHU_TOKEN' then 'PENDING'
    else 'DRAFT'
  end;

  v_cashu_token_melt_initiated := case p_receive_type
    when 'CASHU_TOKEN' then false
    else null
  end;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_data,
    jsonb_build_object('sparkId', p_spark_id, 'paymentHash', p_payment_hash)
  ) returning id into v_transaction_id;

  insert into wallet.spark_receive_quotes (
    user_id,
    account_id,
    type,
    payment_hash,
    expires_at,
    spark_id,
    receiver_identity_pubkey,
    transaction_id,
    state,
    encrypted_data,
    cashu_token_melt_initiated
  ) values (
    p_user_id,
    p_account_id,
    p_receive_type,
    p_payment_hash,
    p_expires_at,
    p_spark_id,
    p_receiver_identity_pubkey,
    v_transaction_id,
    'UNPAID',
    p_encrypted_data,
    v_cashu_token_melt_initiated
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

create or replace function "wallet"."complete_spark_receive_quote"(
  "p_quote_id" "uuid",
  "p_spark_transfer_id" "text",
  "p_encrypted_data" "text"
)
returns "wallet"."spark_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
begin
  select * into v_quote
  from wallet.spark_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'PAID' then
    return v_quote;
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in UNPAID state.', v_quote.state);
  end if;

  update wallet.spark_receive_quotes
  set
    state = 'PAID',
    spark_transfer_id = p_spark_transfer_id,
    encrypted_data = p_encrypted_data,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set
    state = 'COMPLETED',
    acknowledgment_status = 'pending',
    completed_at = now(),
    encrypted_transaction_details = p_encrypted_data,
    transaction_details = coalesce(transaction_details, '{}'::jsonb) || jsonb_build_object('sparkTransferId', p_spark_transfer_id)
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

create or replace function "wallet"."expire_spark_receive_quote"(
  "p_quote_id" "uuid"
)
returns "wallet"."spark_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
  v_now timestamp with time zone;
begin
  select * into v_quote
  from wallet.spark_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'EXPIRED' then
    return v_quote;
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to expire quote with id %s.', v_quote.id),
        detail = format('Quote is in state %s but must be in UNPAID state.', v_quote.state);
  end if;

  v_now := now();

  if v_quote.expires_at > v_now then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to expire quote with id %s.', v_quote.id),
        detail = format('Quote has not expired at %s. Expires at %s.', v_now, v_quote.expires_at);
  end if;

  update wallet.spark_receive_quotes
  set
    state = 'EXPIRED',
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set
    state = 'FAILED',
    failed_at = now()
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

create or replace function "wallet"."fail_spark_receive_quote"(
  "p_quote_id" "uuid",
  "p_failure_reason" "text"
)
returns "wallet"."spark_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
begin
  -- Lock and fetch the quote
  select * into v_quote
  from wallet.spark_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  -- Idempotent: if already failed, return current state
  if v_quote.state = 'FAILED' then
    return v_quote;
  end if;

  -- Can only fail quotes that are in UNPAID state
  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot fail spark receive quote with id %s.', p_quote_id),
        detail = format('Found state %s, but must be UNPAID.', v_quote.state);
  end if;

  -- Update the quote to FAILED state
  update wallet.spark_receive_quotes
  set
    state = 'FAILED',
    failure_reason = p_failure_reason,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  -- Update the corresponding transaction to FAILED
  update wallet.transactions
  set
    state = 'FAILED',
    failed_at = now()
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

create or replace function "wallet"."mark_spark_receive_quote_cashu_token_melt_initiated"(
  "p_quote_id" "uuid"
)
returns "wallet"."spark_receive_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_receive_quotes;
begin
  select * into v_quote
  from wallet.spark_receive_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.type != 'CASHU_TOKEN' then
    raise exception
      using
        hint = 'INVALID_OPERATION',
        message = format('Cannot mark cashu token melt initiated for spark receive quote with id %s.', p_quote_id),
        detail = format('Found type %s, but must be CASHU_TOKEN.', v_quote.type);
  end if;

  if v_quote.cashu_token_melt_initiated = true then
    return v_quote;
  end if;

  update wallet.spark_receive_quotes
  set
    cashu_token_melt_initiated = true,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  return v_quote;
end;
$function$;

-- -----------------------------------------------------------------------------
-- SPARK SEND QUOTE FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function "wallet"."create_spark_send_quote"(
  "p_user_id" "uuid",
  "p_account_id" "uuid",
  "p_currency" "text",
  "p_payment_hash" "text",
  "p_payment_request_is_amountless" boolean,
  "p_encrypted_data" "text",
  "p_expires_at" timestamp with time zone default null::timestamp with time zone
)
returns "wallet"."spark_send_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_transaction_id uuid;
  v_quote wallet.spark_send_quotes;
begin
  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details,
    transaction_details,
    pending_at
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'SPARK_LIGHTNING',
    'DRAFT',
    p_currency,
    p_encrypted_data,
    jsonb_build_object('paymentHash', p_payment_hash),
    now()
  ) returning id into v_transaction_id;

  insert into wallet.spark_send_quotes (
    user_id,
    account_id,
    payment_hash,
    payment_request_is_amountless,
    transaction_id,
    state,
    expires_at,
    encrypted_data
  ) values (
    p_user_id,
    p_account_id,
    p_payment_hash,
    p_payment_request_is_amountless,
    v_transaction_id,
    'UNPAID',
    p_expires_at,
    p_encrypted_data
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

create or replace function "wallet"."mark_spark_send_quote_as_pending"(
  "p_quote_id" "uuid",
  "p_spark_id" "text",
  "p_spark_transfer_id" "text",
  "p_encrypted_data" "text"
)
returns "wallet"."spark_send_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Spark send quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state in ('PENDING', 'COMPLETED') then
    return v_quote;
  end if;

  if v_quote.state != 'UNPAID' then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to mark spark send quote with id %s as pending.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID.', v_quote.state);
  end if;

  update wallet.spark_send_quotes
  set
    state = 'PENDING',
    spark_id = p_spark_id,
    spark_transfer_id = p_spark_transfer_id,
    encrypted_data = p_encrypted_data,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set 
    state = 'PENDING',
    transaction_details = coalesce(transaction_details, '{}'::jsonb) || jsonb_build_object(
      'sparkId', p_spark_id,
      'sparkTransferId', p_spark_transfer_id
    ),
    encrypted_transaction_details = p_encrypted_data
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

create or replace function "wallet"."complete_spark_send_quote"(
  "p_quote_id" "uuid",
  "p_encrypted_data" "text"
)
returns "wallet"."spark_send_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Spark send quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'COMPLETED' then
    return v_quote;
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Failed to complete spark send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.spark_send_quotes
  set
    state = 'COMPLETED',
    encrypted_data = p_encrypted_data,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set
    state = 'COMPLETED',
    acknowledgment_status = 'pending',
    completed_at = now(),
    encrypted_transaction_details = p_encrypted_data
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

create or replace function "wallet"."fail_spark_send_quote"(
  "p_quote_id" "uuid",
  "p_failure_reason" "text"
)
returns "wallet"."spark_send_quotes"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_quote wallet.spark_send_quotes;
begin
  select * into v_quote
  from wallet.spark_send_quotes
  where id = p_quote_id
  for update;

  if v_quote is null then
    raise exception
      using
        hint = 'NOT_FOUND',
        message = format('Spark send quote with id %s not found.', p_quote_id);
  end if;

  if v_quote.state = 'FAILED' then
    return v_quote;
  end if;

  if v_quote.state not in ('UNPAID', 'PENDING') then
    raise exception
      using
        hint = 'INVALID_STATE',
        message = format('Cannot fail spark send quote with id %s.', v_quote.id),
        detail = format('Found state %s, but must be UNPAID or PENDING.', v_quote.state);
  end if;

  update wallet.spark_send_quotes
  set
    state = 'FAILED',
    failure_reason = p_failure_reason,
    version = version + 1
  where id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set
    state = 'FAILED',
    failed_at = now()
  where id = v_quote.transaction_id;

  return v_quote;
end;
$function$;

-- -----------------------------------------------------------------------------
-- TRANSACTION FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function "wallet"."list_transactions"(
  "p_user_id" "uuid",
  "p_cursor_state_sort_order" integer default null::integer,
  "p_cursor_created_at" timestamp with time zone default null::timestamp with time zone,
  "p_cursor_id" "uuid" default null::"uuid",
  "p_page_size" integer default 25
)
returns setof "wallet"."transactions"
language plpgsql
security invoker
set search_path = ''
stable
as $function$
begin
  -- Check if cursor data is provided
  if p_cursor_created_at is null then
    -- Initial page load (no cursor)
    return query
    select t.*
    from wallet.transactions t
    where t.user_id = p_user_id
      and t.state in ('PENDING', 'COMPLETED', 'REVERSED')
    order by t.state_sort_order desc, t.created_at desc, t.id desc
    limit p_page_size;
  else
    -- Subsequent pages (with cursor)
    return query
    select t.*
    from wallet.transactions t
    where t.user_id = p_user_id
      and t.state in ('PENDING', 'COMPLETED', 'REVERSED')
      and (t.state_sort_order, t.created_at, t.id) < (
        p_cursor_state_sort_order,
        p_cursor_created_at,
        p_cursor_id
      )
    order by t.state_sort_order desc, t.created_at desc, t.id desc
    limit p_page_size;
  end if;
end;
$function$;

-- -----------------------------------------------------------------------------
-- TASK PROCESSING LOCK FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function "wallet"."take_lead"(
  "p_user_id" "uuid",
  "p_client_id" "uuid"
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $function$
declare
    v_record wallet.task_processing_locks;
    v_now timestamp with time zone := now();
    v_expiry timestamp with time zone := v_now + interval '6 seconds';
    v_inserted boolean := false;
begin
    -- First try to select and lock the existing record
    select * into v_record
    from wallet.task_processing_locks
    where user_id = p_user_id
    for update;

    -- If no record exists, try to insert
    if v_record is null then
        insert into wallet.task_processing_locks (user_id, lead_client_id, expires_at)
        values (p_user_id, p_client_id, v_expiry)
        on conflict (user_id) do nothing
        returning true into v_inserted;

        -- Return the result of insert attempt. If v_inserted is false it means that another transaction has taken the lead.
        return v_inserted;
    end if;

    -- If lead_client_id matches, extend expiry
    if v_record.lead_client_id = p_client_id then
        update wallet.task_processing_locks
        set expires_at = v_expiry
        where user_id = p_user_id;
        return true;
    end if;

    -- If current lock has expired, take the lead
    if v_record.expires_at <= v_now then
        update wallet.task_processing_locks
        set lead_client_id = p_client_id,
            expires_at = v_expiry
        where user_id = p_user_id;
        return true;
    end if;

    -- If we get here, other client is the lead and the lock hasn't expired
    return false;
end;
$function$;

-- -----------------------------------------------------------------------------
-- CONTACT FUNCTIONS
-- -----------------------------------------------------------------------------

create or replace function "wallet"."find_contact_candidates"(
  "partial_username" "text",
  "current_user_id" "uuid"
)
returns table("username" "text", "id" "uuid")
language plpgsql
security definer -- Needs to be definer to be able to search for users by username. Outside this function, user can read only their own username.
set search_path = ''
as $function$
declare
  pattern text;
begin
  if length(partial_username) < 3 then
    return;
  end if;

  pattern := lower(partial_username) || '%';

  return query
  select u.username, u.id
  from wallet.users u 
  where u.username like pattern
    and u.id != current_user_id
    and not exists (
      select 1 
      from wallet.contacts c 
      where c.owner_id = current_user_id and c.username = u.username
    )
  order by u.username asc;
end;
$function$;

-- =============================================================================
-- REALTIME BROADCAST CONFIGURATION
-- =============================================================================

-- Setup policy that allows authenticated users to read only their own messages
create policy "Authenticated users can read their own broadcasted messages"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'wallet:' || (select auth.uid())::text
  );

-- Setup policy that allows authenticated users to read only their own messages
create policy "Authenticated users create messages to broadcast to themselves"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'wallet:' || (select auth.uid())::text
  );

create or replace function "wallet"."broadcast_accounts_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
  v_account_with_proofs jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'ACCOUNT_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'ACCOUNT_UPDATED';
  end if;

  v_account_with_proofs := wallet.to_account_with_proofs(new);

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    v_account_with_proofs,
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_accounts_changes_trigger" after insert or update on "wallet"."accounts" deferrable initially deferred for each row execute function "wallet"."broadcast_accounts_changes"();

create or replace function "wallet"."broadcast_transactions_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'TRANSACTION_CREATED';
    v_payload := to_jsonb(new);
  elsif tg_op = 'UPDATE' then
    v_event := 'TRANSACTION_UPDATED';
    v_payload := jsonb_set(
      to_jsonb(new),
      '{previous_acknowledgment_status}',
      coalesce(to_jsonb(old.acknowledgment_status), 'null'::jsonb)
    );
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    v_payload,
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_transactions_changes_trigger" after insert or update on "wallet"."transactions" deferrable initially deferred for each row execute function "wallet"."broadcast_transactions_changes"();

create or replace function "wallet"."broadcast_contacts_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
  v_contact wallet.contacts;
begin
  if tg_op = 'INSERT' then
    v_event := 'CONTACT_CREATED';
    v_contact := new;
  elsif tg_op = 'DELETE' then
    v_event := 'CONTACT_DELETED';
    v_contact := old;
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    to_jsonb(v_contact),
    v_event,
    'wallet:' || v_contact.owner_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_contacts_changes_trigger" after insert or delete on "wallet"."contacts" deferrable initially deferred for each row execute function "wallet"."broadcast_contacts_changes"();

create or replace function "wallet"."broadcast_cashu_receive_quotes_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'CASHU_RECEIVE_QUOTE_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'CASHU_RECEIVE_QUOTE_UPDATED';
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    to_jsonb(new),
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_cashu_receive_quotes_changes_trigger" after insert or update on "wallet"."cashu_receive_quotes" deferrable initially deferred for each row execute function "wallet"."broadcast_cashu_receive_quotes_changes"();

create or replace function "wallet"."broadcast_cashu_token_swaps_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'CASHU_TOKEN_SWAP_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'CASHU_TOKEN_SWAP_UPDATED';
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    to_jsonb(new),
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_cashu_token_swaps_changes_trigger" after insert or update on "wallet"."cashu_token_swaps" deferrable initially deferred for each row execute function "wallet"."broadcast_cashu_token_swaps_changes"();

create or replace function "wallet"."broadcast_cashu_send_quotes_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
  v_related_proofs wallet.cashu_proofs[];
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'CASHU_SEND_QUOTE_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'CASHU_SEND_QUOTE_UPDATED';
  end if;

  select coalesce(array_agg(row(cp.*)::wallet.cashu_proofs), '{}') into v_related_proofs
  from wallet.cashu_proofs cp
  where cp.spending_cashu_send_quote_id = new.id;

  v_payload := jsonb_set(
    to_jsonb(new),
    '{cashu_proofs}',
    to_jsonb(v_related_proofs)
  );

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    v_payload,
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_cashu_send_quotes_changes_trigger" after insert or update on "wallet"."cashu_send_quotes" deferrable initially deferred for each row execute function "wallet"."broadcast_cashu_send_quotes_changes"();

create or replace function "wallet"."broadcast_cashu_send_swaps_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
  v_related_proofs wallet.cashu_proofs[];
  v_payload jsonb;
begin
  if tg_op = 'INSERT' then
    v_event := 'CASHU_SEND_SWAP_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'CASHU_SEND_SWAP_UPDATED';
  end if;

  select coalesce(array_agg(row(cp.*)::wallet.cashu_proofs), '{}') into v_related_proofs
  from wallet.cashu_proofs cp
  where cp.spending_cashu_send_swap_id = new.id;

  v_payload := jsonb_set(
    to_jsonb(new),
    '{cashu_proofs}',
    to_jsonb(v_related_proofs)
  );

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    v_payload,
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_cashu_send_swaps_changes_trigger" after insert or update on "wallet"."cashu_send_swaps" deferrable initially deferred for each row execute function "wallet"."broadcast_cashu_send_swaps_changes"();

create or replace function "wallet"."broadcast_spark_receive_quotes_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'SPARK_RECEIVE_QUOTE_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'SPARK_RECEIVE_QUOTE_UPDATED';
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    to_jsonb(new),
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_spark_receive_quotes_changes_trigger" after insert or update on "wallet"."spark_receive_quotes" deferrable initially deferred for each row execute function "wallet"."broadcast_spark_receive_quotes_changes"();

create or replace function "wallet"."broadcast_spark_send_quotes_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_event text;
begin
  if tg_op = 'INSERT' then
    v_event := 'SPARK_SEND_QUOTE_CREATED';
  elsif tg_op = 'UPDATE' then
    v_event := 'SPARK_SEND_QUOTE_UPDATED';
  end if;

  -- Broadcast using realtime.send
  -- Parameters: payload (jsonb), event_name (text), topic (text), is_private (boolean)
  perform realtime.send(
    to_jsonb(new),
    v_event,
    'wallet:' || new.user_id::text,
    true -- private message
  );

  return null;
end;
$function$;

create constraint trigger "broadcast_spark_send_quotes_changes_trigger" after insert or update on "wallet"."spark_send_quotes" deferrable initially deferred for each row execute function "wallet"."broadcast_spark_send_quotes_changes"();

-- =============================================================================
-- CRON JOBS
-- =============================================================================

select cron.schedule('cleanup-cashu-receive-quotes', '0 0 * * *', $$
  delete from wallet.cashu_receive_quotes
  where state in ('EXPIRED', 'COMPLETED') and created_at < now() - interval '1 day';
$$);

select cron.schedule('cleanup-cashu-token-swaps', '0 0 * * *', $$
  delete from wallet.cashu_token_swaps
  where state in ('COMPLETED', 'FAILED') and created_at < now() - interval '1 day';
$$);

select cron.schedule('cleanup-cashu-send-quotes', '0 0 * * *', $$
  delete from wallet.cashu_send_quotes
  where state in ('EXPIRED', 'COMPLETED') and created_at < now() - interval '1 day';
$$);

select cron.schedule('cleanup-transactions', '0 0 * * *', $$
  delete from wallet.transactions
  where state = 'FAILED' and created_at < now() - interval '30 day';
$$);

select cron.schedule('cleanup-cashu-send-swaps', '0 0 * * *', $$
  delete from wallet.cashu_send_swaps
  where state in ('COMPLETED', 'FAILED', 'REVERSED') and created_at < now() - interval '1 day';
$$);

select cron.schedule('cleanup-cashu-proofs', '0 0 * * *', $$
  delete from wallet.cashu_proofs
  where state = 'SPENT' and spent_at < now() - interval '1 day';
$$);

select cron.schedule('cleanup-spark-receive-quotes', '0 0 * * *', $$
  delete from wallet.spark_receive_quotes
  where state in ('EXPIRED', 'PAID') and created_at < now() - interval '1 day';
$$);

select cron.schedule('cleanup-spark-send-quotes', '0 0 * * *', $$
  delete from wallet.spark_send_quotes
  where state in ('COMPLETED', 'FAILED') and created_at < now() - interval '1 day';
$$);
