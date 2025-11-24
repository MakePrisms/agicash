/*
 * Migration: Updates the way we are storing cashu proofs
 * 
 * Purpose:
 * Move cashu proofs from accounts.details.proofs (encrypted JSONB array) to individual
 * records in a new cashu_proofs table. This enables parallel receives without race
 * conditions and better concurrency control using proof-level versioning.
 */

-- ++++++++++++++++++++++++++++++++++++
-- Define cashu_proofs table and indexes
-- ++++++++++++++++++++++++++++++++++++

-- Create cashu_proofs table
create table wallet.cashu_proofs (
  "id" uuid primary key default gen_random_uuid(),
  "user_id" uuid not null references wallet.users (id) on delete cascade,
  "account_id" uuid not null references wallet.accounts (id) on delete cascade,
  "keyset_id" text not null,
  "amount" text not null,
  "secret" text not null,
  "unblinded_signature" text not null,
  "public_key_y" text not null,
  "dleq" jsonb,
  "witness" jsonb,
  "state" text not null default 'UNSPENT' check (state in ('UNSPENT', 'RESERVED', 'SPENT')),
  "version" integer not null default 0,
  "created_at" timestamp with time zone not null default now(),
  "reserved_at" timestamp with time zone,
  "spent_at" timestamp with time zone,
  "cashu_receive_quote_id" uuid references wallet.cashu_receive_quotes(id) on delete set null,
  "cashu_token_swap_token_hash" text,
  "cashu_send_quote_id" uuid references wallet.cashu_send_quotes(id) on delete set null,
  "spending_cashu_send_quote_id" uuid references wallet.cashu_send_quotes(id) on delete set null,
  "cashu_send_swap_id" uuid references wallet.cashu_send_swaps(id) on delete set null,
  "spending_cashu_send_swap_id" uuid references wallet.cashu_send_swaps(id) on delete set null,
  constraint cashu_proofs_token_swap_fkey foreign key (cashu_token_swap_token_hash, user_id) 
    references wallet.cashu_token_swaps(token_hash, user_id) on delete set null
);

comment on table wallet.cashu_proofs is 'Stores individual cashu proofs for each account. Proofs are the fundamental unit of value in the cashu protocol. Secrets and amounts are encrypted at the application layer.';
comment on column wallet.cashu_proofs.id is 'Unique identifier for the proof record';
comment on column wallet.cashu_proofs.user_id is 'Owner of the proof, used for RLS policies';
comment on column wallet.cashu_proofs.account_id is 'The account this proof belongs to';
comment on column wallet.cashu_proofs.keyset_id is 'Identifies which mint keyset was used to create this proof';
comment on column wallet.cashu_proofs.amount is 'The amount of the proof (encrypted at application layer)';
comment on column wallet.cashu_proofs.secret is 'The secret value (encrypted at application layer)';
comment on column wallet.cashu_proofs.unblinded_signature is 'The C field from the Proof structure - the unblinded signature';
comment on column wallet.cashu_proofs.public_key_y is 'The Y public key of the proof. Derived from the secret (Y = hash_to_curve(secret))';
comment on column wallet.cashu_proofs.dleq is 'Discrete Log Equality proof data: {s, e, r?}';
comment on column wallet.cashu_proofs.witness is 'Optional witness data for the proof';
comment on column wallet.cashu_proofs.state is 'Current state: UNSPENT (available) or RESERVED (locked for spending), SPENT (spent)';
comment on column wallet.cashu_proofs.version is 'Optimistic locking version number, incremented on state changes';
comment on column wallet.cashu_proofs.created_at is 'Timestamp when the proof was added to the database';
comment on column wallet.cashu_proofs.reserved_at is 'Timestamp when the proof was reserved for spending';
comment on column wallet.cashu_proofs.spent_at is 'Timestamp when the proof was spent (transaction that spent it was completed)';
comment on column wallet.cashu_proofs.cashu_receive_quote_id is 'The receive quote that added this proof (if added via a cashu receive quote)';
comment on column wallet.cashu_proofs.cashu_token_swap_token_hash is 'The token hash of the token swap that added this proof (if added via a cashu token swap). Combined with user_id to reference cashu_token_swaps table';
comment on column wallet.cashu_proofs.cashu_send_quote_id is 'The send quote that added this proof as a change (if added via a send quote)';
comment on column wallet.cashu_proofs.spending_cashu_send_quote_id is 'The send quote that spent or reserved this proof for sending. Will be null for unspent proofs or if proof was not spent with a send quote';
comment on column wallet.cashu_proofs.cashu_send_swap_id is 'The send swap that added this proof as a change (if added via a send swap)';
comment on column wallet.cashu_proofs.spending_cashu_send_swap_id is 'The send swap that spent or reserved this proof for sending. Will be null for unspent proofs or if proof was not spent with a send swap';

-- Create indexes for efficient queries
-- Composite index for the most common query pattern: finding unspent proofs for an account
create index cashu_proofs_account_state_idx on wallet.cashu_proofs (account_id, state);

-- Create index for efficient queries by receive quote
create index cashu_proofs_receive_quote_id_idx on wallet.cashu_proofs (cashu_receive_quote_id) where cashu_receive_quote_id is not null;

-- Create composite index on user_id and cashu_token_swap_token_hash
-- This index can be used for queries filtering by user_id alone (leftmost prefix) or both columns together
-- Covers RLS policy checks and token swap lookups
create index cashu_proofs_user_token_swap_idx on wallet.cashu_proofs (user_id, cashu_token_swap_token_hash);

-- Create index for efficient queries by send quote
create index cashu_proofs_send_quote_id_idx on wallet.cashu_proofs (cashu_send_quote_id) where cashu_send_quote_id is not null;

-- Create index for efficient queries by spending send quote
create index cashu_proofs_spending_send_quote_id_idx on wallet.cashu_proofs (spending_cashu_send_quote_id) where spending_cashu_send_quote_id is not null;

-- Create index for efficient queries by send swap
create index cashu_proofs_cashu_send_swap_id_idx on wallet.cashu_proofs (cashu_send_swap_id) where cashu_send_swap_id is not null;

-- Create index for efficient queries by spending send swap
create index cashu_proofs_spending_send_swap_id_idx on wallet.cashu_proofs (spending_cashu_send_swap_id) where spending_cashu_send_swap_id is not null;

-- Unique constraint to prevent duplicate proofs within an account
-- This also ensures that the secret is unique within an account, because the public key y is derived from the secret.
create unique index cashu_proofs_account_y_unique_idx on wallet.cashu_proofs (account_id, public_key_y);

-- Enable Row Level Security
alter table wallet.cashu_proofs enable row level security;

-- RLS Policy: Users can CRUD their own proofs
create policy "Enable CRUD on cashu_proofs based on user_id"
on wallet.cashu_proofs
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

-- Cleanup spent proofs, that were spent more than 1 day ago every day at midnight
select cron.schedule('cleanup-cashu-proofs', '0 0 * * *', $$
  DELETE FROM wallet.cashu_proofs
  WHERE state = 'SPENT' AND spent_at < NOW() - INTERVAL '1 day';
$$);

-- Add index for efficient cleanup query
create index idx_cashu_proofs_state_spent_at on wallet.cashu_proofs (state, spent_at) where state = 'SPENT';

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Define composite types for inputs
-- ++++++++++++++++++++++++++++++++++++

-- Create composite type for cashu proof input
drop type if exists wallet.cashu_proof_input cascade;

create type wallet.cashu_proof_input as (
  "keysetId" text,
  "amount" text,
  "secret" text,
  "unblindedSignature" text,
  "publicKeyY" text,
  "dleq" jsonb,
  "witness" jsonb
);

comment on type wallet.cashu_proof_input is 'Input type for cashu proofs passed to database functions. Uses camelCase field names to match application layer.';

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Add utility functions
-- ++++++++++++++++++++++++++++++++++++

-- Add get account proofs function
-- Returns all unspent proofs for an account as a typed array. If no proofs are found, an empty array is returned.
create or replace function wallet.get_account_proofs(
  p_account_id uuid
)
returns wallet.cashu_proofs[]
language sql
as $function$
  select coalesce(array_agg(row(cp.*)::wallet.cashu_proofs), '{}')
  from wallet.cashu_proofs cp
  where cp.account_id = p_account_id and cp.state = 'UNSPENT';
$function$;

--


-- Add get account with proofs function
-- Returns account with all its unspent proofs as a JSONB object
create or replace function wallet.get_account_with_proofs(
  p_account_id uuid
)
returns jsonb
language plpgsql
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


-- Add to_account_with_proofs function
-- Converts a wallet.accounts row to JSONB with unspent proofs included
create or replace function wallet.to_account_with_proofs(
  p_account wallet.accounts
)
returns jsonb
language plpgsql
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

--


-- Add add_cashu_proofs function
-- Adds cashu proofs for the account. Returns the array of added proofs.
create or replace function wallet.add_cashu_proofs(
  p_proofs wallet.cashu_proof_input[],
  p_user_id uuid,
  p_account_id uuid,
  p_proofs_state text default 'UNSPENT',
  p_cashu_receive_quote_id uuid default null,
  p_cashu_token_swap_token_hash text default null,
  p_cashu_send_quote_id uuid default null,
  p_cashu_send_swap_id uuid default null,
  p_spending_cashu_send_swap_id uuid default null
)
returns wallet.cashu_proofs[]
language plpgsql
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

--


-- Add add_cashu_proofs function
-- Adds proofs to an account and updates the account version. Returns the account with all the unspent proofs and the array of added proofs.
drop type if exists wallet.add_cashu_proofs_and_update_account_result cascade;

create type wallet.add_cashu_proofs_and_update_account_result as (
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "added_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.add_cashu_proofs_and_update_account(
  p_proofs wallet.cashu_proof_input[],
  p_user_id uuid,
  p_account_id uuid,
  p_proofs_state text default 'UNSPENT',
  p_cashu_receive_quote_id uuid default null,
  p_cashu_token_swap_token_hash text default null,
  p_cashu_send_quote_id uuid default null,
  p_cashu_send_swap_id uuid default null,
  p_spending_cashu_send_swap_id uuid default null
)
returns wallet.add_cashu_proofs_and_update_account_result
language plpgsql
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

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Cashu receive quotes updates
-- ++++++++++++++++++++++++++++++++++++

-- Update create_cashu_receive_quote function
--
create or replace function wallet.create_cashu_receive_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_amount numeric,
  p_currency text,
  p_unit text,
  p_quote_id text,
  p_payment_request text,
  p_expires_at timestamp with time zone,
  p_state text,
  p_locking_derivation_path text,
  p_receive_type text,
  p_encrypted_transaction_details text,
  p_description text default null::text
)
returns wallet.cashu_receive_quotes
language plpgsql
as $function$
declare
  v_transaction_type text;
  v_transaction_state text;
  v_transaction_id uuid;
  v_quote wallet.cashu_receive_quotes;
begin
  -- Map receive type to transaction type
  v_transaction_type := case p_receive_type
    when 'LIGHTNING' then 'CASHU_LIGHTNING'
    when 'TOKEN' then 'CASHU_TOKEN'
    else null
  end;

  if v_transaction_type is null then
    raise exception 
      using
        hint = 'INVALID_ARGUMENT',
        message = 'Unsupported receive type',
        detail = format('Expected one of: LIGHTNING, TOKEN. Value provided: %s', p_receive_type);
  end if;

  -- We create token receives as pending because the lightning payment on the sender
  -- side will be triggered by the receiver, so we know it should get paid.
  -- For lightning, we create a draft transaction record because its not guaranteed that
  -- the invoice will ever be paid.
  v_transaction_state := case v_transaction_type
    when 'CASHU_TOKEN' then 'PENDING'
    else 'DRAFT'
  end;

  insert into wallet.transactions (
    user_id,
    account_id,
    direction,
    type,
    state,
    currency,
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'RECEIVE',
    v_transaction_type,
    v_transaction_state,
    p_currency,
    p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_receive_quotes (
    user_id,
    account_id,
    amount,
    currency,
    unit,
    quote_id,
    payment_request,
    expires_at,
    description,
    state,
    locking_derivation_path,
    transaction_id,
    type
  ) values (
    p_user_id,
    p_account_id,
    p_amount,
    p_currency,
    p_unit,
    p_quote_id,
    p_payment_request,
    p_expires_at,
    p_description,
    p_state,
    p_locking_derivation_path,
    v_transaction_id,
    p_receive_type
  ) returning * into v_quote;

  return v_quote;
end;
$function$;

--

-- Update expire_cashu_receive_quote function
--
-- Signature changed: removed p_quote_version parameter
drop function if exists wallet.expire_cashu_receive_quote(uuid, integer);

create or replace function wallet.expire_cashu_receive_quote(
  p_quote_id uuid
)
returns wallet.cashu_receive_quotes
language plpgsql
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

-- 


-- Update fail_cashu_receive_quote function
-- Signature changed: removed p_quote_version parameter
drop function if exists wallet.fail_cashu_receive_quote(uuid, integer, text);

create or replace function wallet.fail_cashu_receive_quote(
  p_quote_id uuid,
  p_failure_reason text
)
returns wallet.cashu_receive_quotes
language plpgsql
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

--


-- Update process_cashu_receive_quote_payment function
-- Signature changed: removed version parameters, changed output_amounts to number_of_outputs
drop function if exists wallet.process_cashu_receive_quote_payment(uuid, integer, text, integer, integer[], integer);
drop type if exists wallet.cashu_receive_quote_payment_result cascade;

create type wallet.cashu_receive_quote_payment_result as (
  "quote" wallet.cashu_receive_quotes,
  "account" jsonb -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
);

create or replace function wallet.process_cashu_receive_quote_payment(
  p_quote_id uuid,
  p_keyset_id text, 
  p_output_amounts integer[]
)
returns wallet.cashu_receive_quote_payment_result
language plpgsql
as $function$
declare
  v_quote wallet.cashu_receive_quotes;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_number_of_outputs integer;
  v_counter integer;
begin
  if p_keyset_id is null or trim(p_keyset_id) = '' then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_keyset_id must not be null or empty.',
        detail = format('Value provided: %s', p_keyset_id);
  end if;

  if p_output_amounts is null
    or array_length(p_output_amounts, 1) is null
    or exists (select 1 from unnest(p_output_amounts) as amount where amount <= 0)
  then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_output_amounts must be a non-null, non-empty array of integers greater than 0.',
        detail = format('Value provided: %s', p_output_amounts);
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

  v_number_of_outputs := array_length(p_output_amounts, 1);

  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + v_number_of_outputs
      ), 
      true
    ),
    version = version + 1
  where a.id = v_quote.account_id
  returning * into v_account;

  v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - v_number_of_outputs;

  update wallet.cashu_receive_quotes q
  set 
    state = 'PAID',
    keyset_id = p_keyset_id,
    keyset_counter = v_counter,
    output_amounts = p_output_amounts,
    version = version + 1
  where q.id = p_quote_id
  returning * into v_quote;

  update wallet.transactions
  set state = 'PENDING',
      pending_at = now()
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs);
end;
$function$;

--


-- Update complete_cashu_receive_quote function
-- Signature changed: removed version parameters, changed jsonb[] to wallet.cashu_proof_input[]
drop function if exists wallet.complete_cashu_receive_quote(uuid, integer, jsonb, integer);
drop type if exists wallet.complete_cashu_receive_quote_result cascade;

create type wallet.complete_cashu_receive_quote_result as (
  "quote" wallet.cashu_receive_quotes,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "added_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.complete_cashu_receive_quote(
  p_quote_id uuid, 
  p_proofs wallet.cashu_proof_input[]
)
returns wallet.complete_cashu_receive_quote_result
language plpgsql
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

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Cashu token swaps updates
-- ++++++++++++++++++++++++++++++++++++

-- Update the RLS policy
-- Existing policy had `to public` which is incorrect, it should be `to authenticated`
drop policy if exists "Enable CRUD based on user_id" on "wallet"."cashu_token_swaps";

create policy "Enable CRUD based on user_id"
on "wallet"."cashu_token_swaps"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

--

-- Update create_cashu_token_swap function
-- Signature changed: removed p_account_version parameter, changed output_amounts to number_of_outputs
drop function if exists wallet.create_cashu_token_swap(text, text, uuid, uuid, text, text, text, integer, integer[], numeric, numeric, numeric, integer, text, uuid);
drop type if exists wallet.create_cashu_token_swap_result cascade;

create type wallet.create_cashu_token_swap_result as (
  "swap" wallet.cashu_token_swaps,
  "account" jsonb -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
);

create or replace function wallet.create_cashu_token_swap(
  p_token_hash text, 
  p_token_proofs text, 
  p_account_id uuid, 
  p_user_id uuid, 
  p_currency text, 
  p_unit text, 
  p_keyset_id text,
  p_output_amounts integer[],
  p_input_amount numeric,
  p_receive_amount numeric,
  p_fee_amount numeric,
  p_encrypted_transaction_details text,
  p_reversed_transaction_id uuid default null
)
returns wallet.create_cashu_token_swap_result
language plpgsql
as $function$
declare
  v_number_of_outputs integer;
  v_account wallet.accounts;
  v_counter integer;
  v_transaction_id uuid;
  v_token_swap wallet.cashu_token_swaps;
  v_account_with_proofs jsonb;
begin
  if p_output_amounts is null
    or array_length(p_output_amounts, 1) is null
    or exists (select 1 from unnest(p_output_amounts) as amount where amount <= 0)
  then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'p_output_amounts must be a non-null, non-empty array of integers greater than 0.',
        detail = format('Value provided: %s', p_output_amounts);
  end if;

  v_number_of_outputs := array_length(p_output_amounts, 1);

  update wallet.accounts a
  set 
    details = jsonb_set(
      details, 
      array['keyset_counters', p_keyset_id], 
      to_jsonb(
        coalesce((details->'keyset_counters'->>p_keyset_id)::integer, 0) + v_number_of_outputs
      ), 
      true
    ),
    version = version + 1
  where a.id = p_account_id
  returning * into v_account;

  v_counter := coalesce((v_account.details->'keyset_counters'->>p_keyset_id)::integer, 0) - v_number_of_outputs;

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
    p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_token_swaps (
    token_hash,
    token_proofs,
    account_id,
    user_id,
    currency,
    unit,
    keyset_id,
    keyset_counter,
    output_amounts,
    input_amount,
    receive_amount,
    fee_amount,
    transaction_id
  ) values (
    p_token_hash,
    p_token_proofs,
    p_account_id,
    p_user_id,
    p_currency,
    p_unit,
    p_keyset_id,
    v_counter,
    p_output_amounts,
    p_input_amount,
    p_receive_amount,
    p_fee_amount,
    v_transaction_id
  ) returning * into v_token_swap;

   v_account_with_proofs := wallet.to_account_with_proofs(v_account);

  return (v_token_swap, v_account_with_proofs);
end;
$function$;

--


-- Update fail_cashu_token_swap function
-- Signature changed: removed p_swap_version parameter
drop function if exists wallet.fail_cashu_token_swap(text, uuid, integer, text);

create or replace function wallet.fail_cashu_token_swap(
    p_token_hash text, 
    p_user_id uuid,
    p_failure_reason text
)
returns wallet.cashu_token_swaps
language plpgsql
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

--


-- Update complete_cashu_token_swap function
-- Signature changed: removed version parameters, changed jsonb[] to wallet.cashu_proof_input[]
drop function if exists wallet.complete_cashu_token_swap(text, uuid, integer, jsonb, integer);

drop type if exists wallet.complete_cashu_token_swap_result;
create type "wallet"."complete_cashu_token_swap_result" as (
  "swap" wallet.cashu_token_swaps,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "added_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.complete_cashu_token_swap(
  p_token_hash text, 
  p_user_id uuid,
  p_proofs wallet.cashu_proof_input[]
)
returns wallet.complete_cashu_token_swap_result
language plpgsql
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

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Cashu send quotes updates
-- ++++++++++++++++++++++++++++++++++++

-- Remove proofs column from cashu_send_quotes table
alter table wallet.cashu_send_quotes drop column if exists proofs;

-- Update cashu_send_quotes_quote_id_key to be a partial unique index that only applies when state is not FAILED
-- Drop the existing constraint
alter table "wallet"."cashu_send_quotes" drop constraint if exists "cashu_send_quotes_quote_id_key";
-- Drop the existing index
drop index if exists wallet.cashu_send_quotes_quote_id_key;
-- Create a new partial unique index that only applies when state is not FAILED
create unique index cashu_send_quotes_quote_id_key on wallet.cashu_send_quotes using btree (quote_id) where state <> 'FAILED';
-- Partial indexes cannot back constraints, so we are not re-adding the constraint.

--


-- Update create_cashu_send_quote function
-- Signature changed: removed p_account_version, p_proofs_to_keep and p_keyset_counter, added p_proofs_to_send (uuid array)
drop function if exists wallet.create_cashu_send_quote(uuid, uuid, text, text, text, timestamp with time zone, numeric, text, bigint, numeric, numeric, numeric, text, text, integer, integer, text, integer, text, text);
drop type if exists wallet.create_cashu_send_quote_result;

create type "wallet"."create_cashu_send_quote_result" as (
  "quote" wallet.cashu_send_quotes, 
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "reserved_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.create_cashu_send_quote(
  p_user_id uuid,
  p_account_id uuid,
  p_currency text,
  p_unit text,
  p_payment_request text,
  p_expires_at timestamp with time zone,
  p_amount_requested numeric,
  p_currency_requested text,
  p_amount_requested_in_msat bigint,
  p_amount_to_receive numeric,
  p_lightning_fee_reserve numeric,
  p_cashu_fee numeric,
  p_quote_id text,
  p_keyset_id text,
  p_number_of_change_outputs integer,
  p_proofs_to_send uuid[],
  p_encrypted_transaction_details text
)
returns wallet.create_cashu_send_quote_result
language plpgsql
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
    encrypted_transaction_details
  ) values (
    p_user_id,
    p_account_id,
    'SEND',
    'CASHU_LIGHTNING',
    'PENDING',
    p_currency,
    p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_quotes (
    user_id,
    account_id,
    currency,
    unit,
    payment_request,
    expires_at,
    amount_requested,
    currency_requested,
    amount_requested_in_msat,
    amount_to_receive,
    lightning_fee_reserve,
    cashu_fee,
    quote_id,
    keyset_id,
    keyset_counter,
    number_of_change_outputs,
    transaction_id
  ) values (
    p_user_id,
    p_account_id,
    p_currency,
    p_unit,
    p_payment_request,
    p_expires_at,
    p_amount_requested,
    p_currency_requested,
    p_amount_requested_in_msat,
    p_amount_to_receive,
    p_lightning_fee_reserve,
    p_cashu_fee,
    p_quote_id,
    p_keyset_id,
    v_counter,
    p_number_of_change_outputs,
    v_transaction_id
  )
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set 
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_quote_id = v_quote.id,
      version = version + 1
    where id = ANY(p_proofs_to_send) and account_id = p_account_id and state = 'UNSPENT'
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

--


-- Create function to mark cashu send quote as pending with atomic version increment
create type "wallet"."mark_cashu_send_quote_as_pending_result" as (
  "quote" wallet.cashu_send_quotes,
  "proofs" wallet.cashu_proofs[]
);

create or replace function wallet.mark_cashu_send_quote_as_pending(
    p_quote_id uuid
)
returns wallet.mark_cashu_send_quote_as_pending_result
language plpgsql
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

--


-- Update complete_cashu_send_quote function
-- Signature changed: removed version parameters and p_account_proofs, changed jsonb[] to wallet.cashu_proof_input[]
drop function if exists wallet.complete_cashu_send_quote(uuid, integer, text, numeric, text, integer, text);
drop type if exists wallet.complete_cashu_send_quote_result;

create type "wallet"."complete_cashu_send_quote_result" as (
  "quote" wallet.cashu_send_quotes,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "spent_proofs" wallet.cashu_proofs[],
  "change_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.complete_cashu_send_quote(
    p_quote_id uuid,
    p_payment_preimage text,
    p_amount_spent numeric,
    p_change_proofs wallet.cashu_proof_input[],
    p_encrypted_transaction_details text
) returns wallet.complete_cashu_send_quote_result
language plpgsql
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
      payment_preimage = p_payment_preimage,
      amount_spent = p_amount_spent,
      version = version + 1
  where id = v_quote.id
  returning * into v_quote;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
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
      encrypted_transaction_details = p_encrypted_transaction_details
  where id = v_quote.transaction_id;

  return (v_quote, v_account_with_proofs, v_spent_proofs, v_change_proofs);
end;
$function$;

--


-- Update expire_cashu_send_quote function
-- Signature changed: removed version and proofs parameters
drop function if exists wallet.expire_cashu_send_quote(uuid, integer, text, integer);
drop type if exists wallet.expire_cashu_send_quote_result;

create type "wallet"."expire_cashu_send_quote_result" as (
  "quote" wallet.cashu_send_quotes,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "released_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.expire_cashu_send_quote(
  p_quote_id uuid
) returns wallet.expire_cashu_send_quote_result
language plpgsql
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
--


-- Update fail_cashu_send_quote function
-- Signature changed: removed version and proofs parameters
drop function if exists wallet.fail_cashu_send_quote(uuid, text, integer, text, integer);
drop type if exists wallet.fail_cashu_send_quote_result;

create type "wallet"."fail_cashu_send_quote_result" as (
  "quote" wallet.cashu_send_quotes,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "released_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.fail_cashu_send_quote(
  p_quote_id uuid,
  p_failure_reason text
) returns wallet.fail_cashu_send_quote_result
language plpgsql
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

--

-- Remove old function result type
drop type if exists wallet.update_cashu_send_quote_result;

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Cashu send swaps updates
-- ++++++++++++++++++++++++++++++++++++

-- Update cashu_send_swaps table
--
alter table wallet.cashu_send_swaps drop column if exists input_proofs;
alter table wallet.cashu_send_swaps drop column if exists proofs_to_send;
alter table wallet.cashu_send_swaps drop column if exists keep_output_amounts;
alter table wallet.cashu_send_swaps add column change_output_amounts integer[] default null;
alter table wallet.cashu_send_swaps add column requires_input_proofs_swap boolean generated always as (amount_to_send != input_amount) stored;

-- Add constraint: token_hash is required when state is not DRAFT or FAILED
alter table wallet.cashu_send_swaps add constraint cashu_send_swaps_token_hash_required_check
  check (
    (state in ('DRAFT', 'FAILED') and token_hash is null) or 
    (state not in ('DRAFT', 'FAILED') and token_hash is not null)
  );

-- Add constraint: keyset_id and keyset_counter are required when requires_input_proofs_swap is true
alter table wallet.cashu_send_swaps add constraint cashu_send_swaps_keyset_required_check
  check (
    (requires_input_proofs_swap = false) or
    (requires_input_proofs_swap = true and keyset_id is not null and keyset_counter is not null)
  );

-- Add constraint: DRAFT state requires requires_input_proofs_swap to be true
alter table wallet.cashu_send_swaps add constraint cashu_send_swaps_draft_requires_swap_check
  check (
    state != 'DRAFT' or requires_input_proofs_swap = true
  );
--


-- Update the RLS policy
-- Existing policy had `to public` which is incorrect, it should be `to authenticated`
drop policy if exists "Enable CRUD for cashu_send_swaps based on user_id" on "wallet"."cashu_send_swaps";

create policy "Enable CRUD for cashu_send_swaps based on user_id"
on "wallet"."cashu_send_swaps"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = user_id))
with check ((( SELECT auth.uid() AS uid) = user_id));

--


-- Update create_cashu_send_swap function
-- Signature changed: completely redesigned parameters - removed p_account_version, proof arrays, added p_input_proofs (uuid array)
drop function if exists wallet.create_cashu_send_swap(uuid, uuid, numeric, numeric, text, text, text, text, text, integer, numeric, numeric, numeric, numeric, text, text, integer, integer, text, text, integer[], integer[]);
drop type if exists wallet.create_cashu_send_swap_result;

create type "wallet"."create_cashu_send_swap_result" as (
  "swap" wallet.cashu_send_swaps, 
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "reserved_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.create_cashu_send_swap(
  p_user_id uuid,
  p_account_id uuid,
  p_amount_requested numeric,
  p_amount_to_send numeric,
  p_input_proofs uuid[],
  p_currency text, 
  p_unit text, 
  p_input_amount numeric,
  p_send_swap_fee numeric,
  p_receive_swap_fee numeric,
  p_total_amount numeric,
  p_encrypted_transaction_details text,
  p_token_hash text default null::text,
  p_keyset_id text default null::text,
  p_send_output_amounts integer[] default null::integer[],
  p_change_output_amounts integer[] default null::integer[]
) returns wallet.create_cashu_send_swap_result
language plpgsql
as $function$
declare
  v_state text;
  v_keyset_id text; -- We are declaring this variable instead of storing the value directly from p_keyset_id to prevent it being added to db for the state it shouldn't be added for.
  v_number_of_outputs integer;
  v_account wallet.accounts;
  v_account_with_proofs jsonb;
  v_keyset_counter integer;
  v_transaction_id uuid;
  v_swap wallet.cashu_send_swaps;
  v_reserved_proofs wallet.cashu_proofs[];
begin
  -- If the input amount is equal to the amount to send, there is no need to swap the input proofs so the swap is ready to be committed (set to PENDING).
  if p_input_amount = p_amount_to_send then
    v_state := 'PENDING';
  else
    v_state := 'DRAFT';
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

      if p_send_output_amounts is null
        or array_length(p_send_output_amounts, 1) is null
        or exists (select 1 from unnest(p_send_output_amounts) as amount where amount <= 0)
      then
        raise exception
          using
            hint = 'INVALID_ARGUMENT',
            message = 'When state is DRAFT, p_send_output_amounts must be a non-null, non-empty array of integers greater than 0.',
            detail = format('Value provided: %s', p_send_output_amounts);
      end if;

      if p_change_output_amounts is not null
        and array_length(p_change_output_amounts, 1) is not null
        and exists (select 1 from unnest(p_change_output_amounts) as amount where amount <= 0)
      then
        raise exception
          using
            hint = 'INVALID_ARGUMENT',
            message = 'When state is DRAFT and p_change_output_amounts is provided, all values must be integers greater than 0.',
            detail = format('Value provided: %s', p_change_output_amounts);
      end if;

      v_keyset_id := p_keyset_id;
      v_number_of_outputs := array_length(p_send_output_amounts, 1) + array_length(p_change_output_amounts, 1);

      update wallet.accounts a
      set 
        details = jsonb_set(
          details, 
          array['keyset_counters', v_keyset_id], 
          to_jsonb(
            coalesce((details->'keyset_counters'->>v_keyset_id)::integer, 0) + v_number_of_outputs
          ), 
          true
        ),
        version = version + 1
      where a.id = p_account_id
      returning * into v_account;

      -- Keyset counter value before the increment (This is the value used for this swap)
      v_keyset_counter := coalesce((v_account.details->'keyset_counters'->>v_keyset_id)::integer, 0) - v_number_of_outputs;
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
      p_encrypted_transaction_details
  ) returning id into v_transaction_id;

  insert into wallet.cashu_send_swaps (
      user_id,
      account_id,
      transaction_id,
      amount_requested,
      amount_to_send,
      send_swap_fee,
      receive_swap_fee,
      total_amount,
      input_amount,
      keyset_id,
      keyset_counter,
      send_output_amounts,
      change_output_amounts,
      token_hash,
      currency,
      unit,
      state
  ) values (
      p_user_id,
      p_account_id,
      v_transaction_id,
      p_amount_requested,
      p_amount_to_send,
      p_send_swap_fee,
      p_receive_swap_fee,
      p_total_amount,
      p_input_amount,
      v_keyset_id,
      v_keyset_counter,
      p_send_output_amounts,
      p_change_output_amounts,
      p_token_hash,
      p_currency,
      p_unit,
      v_state
  ) returning * into v_swap;

  -- CTE (Common Table Expression) + array_agg is needed in plpgsql when using "returning into" with multiple rows 
  -- "returning into" can only be used with a single value so we array_agg is used to aggregate the rows into a single array value.
  -- If you just do "returning * into v_reserved_proofs" you will get "query returned more than one row" error.
  with updated_proofs as (
    update wallet.cashu_proofs
    set 
      state = 'RESERVED',
      reserved_at = now(),
      spending_cashu_send_swap_id = v_swap.id,
      version = version + 1
    where id = ANY(p_input_proofs) and account_id = p_account_id and state = 'UNSPENT'
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

--


-- Update commit_proofs_to_send function
-- Signature changed: changed jsonb[] to wallet.cashu_proof_input[]
drop function if exists wallet.commit_proofs_to_send(uuid, integer, integer, text, jsonb, text);
drop type if exists wallet.commit_proofs_to_send_result;

create type "wallet"."commit_proofs_to_send_result" as (
  "swap" wallet.cashu_send_swaps,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "spent_proofs" wallet.cashu_proofs[], -- The input proofs that are spent to perform the input swap
  "reserved_proofs" wallet.cashu_proofs[], -- The send proofs that were created by the input swap and committed (reserved) to be spent by the receiver of this swap's token.
  "change_proofs" wallet.cashu_proofs[] -- The change proofs of the input swap that are added to the account balance.
);

/**
  Commits the proofs to send, after the swap of the input proofs has been performed.
  The input proofs of the swap are marked as spent, send proofs are added to the account and reserved for the swap, and change proofs of the input swap are added to the account.
**/
create or replace function wallet.commit_proofs_to_send(
  p_swap_id uuid,
  p_proofs_to_send wallet.cashu_proof_input[],
  p_change_proofs wallet.cashu_proof_input[],
  p_token_hash text
)
returns wallet.commit_proofs_to_send_result
language plpgsql
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

--


-- Update complete_cashu_send_swap function
-- Signature changed: removed p_swap_version parameter
drop function if exists wallet.complete_cashu_send_swap(uuid, integer);
drop type if exists wallet.complete_cashu_send_swap_result;

create type "wallet"."complete_cashu_send_swap_result" as (
  "result" text, -- 'COMPLETED' or 'FAILED'
  "swap" wallet.cashu_send_swaps,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "spent_proofs" wallet.cashu_proofs[],
  "failure_reason" text -- null when result is 'COMPLETED'
);

/**
  This function is used to complete a send swap. It marks the reserved swap proofs as spent, updates the swap, transaction and account states.
  Returns the swap, account with proofs and spent proofs, unless there is a related reversal transaction that is not failed, in which case it returns the swap and null for the account and spent proofs.
**/
create or replace function wallet.complete_cashu_send_swap(p_swap_id uuid)
returns wallet.complete_cashu_send_swap_result
language plpgsql
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

--


-- Update fail_cashu_send_swap function
-- Signature changed: removed p_swap_version parameter
drop function if exists wallet.fail_cashu_send_swap(uuid, integer, text);
drop type if exists wallet.fail_cashu_send_swap_result;

create type "wallet"."fail_cashu_send_swap_result" as (
  "swap" wallet.cashu_send_swaps,
  "account" jsonb, -- wallet.accounts row + "cashu_proofs" property of type wallet.cashu_proofs[]
  "released_proofs" wallet.cashu_proofs[]
);

create or replace function wallet.fail_cashu_send_swap(
  p_swap_id uuid,
  p_reason text
)
returns wallet.fail_cashu_send_swap_result
language plpgsql
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

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Users updates
-- ++++++++++++++++++++++++++++++++++++

-- Create composite type for account input
drop type if exists wallet.account_input cascade;
create type wallet.account_input as (
  "type" text,
  "currency" text,
  "name" text,
  "details" jsonb,
  "is_default" boolean
);

--

-- Create composite type for upsert_user_with_accounts return value
drop type if exists wallet.upsert_user_with_accounts_result cascade;
create type wallet.upsert_user_with_accounts_result as (
  "user" wallet.users,
  accounts jsonb[]
);

--

-- Drop old function signature
drop function if exists wallet.upsert_user_with_accounts(uuid, text, boolean, jsonb[], text, text);

-- Update upsert_user_with_accounts function to return structured result with accounts including proofs
create or replace function wallet.upsert_user_with_accounts(
  p_user_id uuid, 
  p_email text, 
  p_email_verified boolean, 
  p_accounts wallet.account_input[], 
  p_cashu_locking_xpub text, 
  p_encryption_public_key text
)
returns wallet.upsert_user_with_accounts_result
language plpgsql
as $function$
declare
  result_user wallet.users;
  result_accounts jsonb[];
  usd_account_id uuid := null;
  btc_account_id uuid := null;
begin
  insert into wallet.users (id, email, email_verified, cashu_locking_xpub, encryption_public_key)
  values (p_user_id, p_email, p_email_verified, p_cashu_locking_xpub, p_encryption_public_key)
  on conflict (id) do update set
    email = coalesce(excluded.email, wallet.users.email),
    email_verified = excluded.email_verified;

  select * into result_user
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
    from wallet.accounts a
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

  if not exists (select 1 from unnest(p_accounts) as acct where acct.currency = 'USD') then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'At least one USD account is required';
  end if;

  if not exists (select 1 from unnest(p_accounts) as acct where acct.currency = 'BTC') then
    raise exception
      using
        hint = 'INVALID_ARGUMENT',
        message = 'At least one BTC account is required';
  end if;

  with inserted_accounts as (
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
    from inserted_accounts ia
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
    default_btc_account_id = coalesce(btc_account_id, u.default_btc_account_id)
  where id = p_user_id
  returning * into result_user;

  return (result_user, result_accounts);
end;
$function$;

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Broadcast notifications updates
-- ++++++++++++++++++++++++++++++++++++

-- Update broadcast messages RLS policy
-- Drop existing policy that was allowing all authenticated users to read all messages
drop policy if exists "Authenticated users can receive broadcasts" on realtime.messages;

-- Setup new policy that allows authenticated users to read only their own messages
create policy "Authenticated users can read their own broadcasted messages"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'wallet:' || auth.uid()::text
  );

-- Setup new policy that allows authenticated users to read only their own messages
create policy "Authenticated users create messages to broadcast to themselves"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'wallet:' || auth.uid()::text
  );

--

-- Update accounts broadcast to include proofs using realtime.send
-- This replaces the generic broadcast_table_changes for accounts table
-- to provide richer data including related proofs.
drop trigger if exists broadcast_accounts_changes on wallet.accounts;
drop trigger if exists broadcast_accounts_changes_trigger on wallet.accounts;

create or replace function wallet.broadcast_accounts_changes()
returns trigger
language plpgsql
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

create constraint trigger broadcast_accounts_changes_trigger
  after insert or update
  on wallet.accounts
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_accounts_changes();

--


-- Update transactions broadcast to use realtime.send
drop trigger if exists broadcast_transactions_changes on wallet.transactions;
drop trigger if exists broadcast_transactions_changes_trigger on wallet.transactions;

create or replace function wallet.broadcast_transactions_changes()
returns trigger
language plpgsql
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

create constraint trigger broadcast_transactions_changes_trigger
  after insert or update
  on wallet.transactions
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_transactions_changes();

--


-- Update cashu receive quotes broadcast to use realtime.send
drop trigger if exists broadcast_cashu_receive_quotes_changes on wallet.cashu_receive_quotes;
drop trigger if exists broadcast_cashu_receive_quotes_changes_trigger on wallet.cashu_receive_quotes;

create or replace function wallet.broadcast_cashu_receive_quotes_changes()
returns trigger
language plpgsql
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

exception
  when others then
    raise warning 'Error broadcasting cashu receive quote changes: %', sqlerrm;
end;
$function$;

create constraint trigger broadcast_cashu_receive_quotes_changes_trigger
  after insert or update
  on wallet.cashu_receive_quotes
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_cashu_receive_quotes_changes();

--


-- Update cashu token swaps broadcast to use realtime.send
drop trigger if exists broadcast_cashu_token_swaps_changes on wallet.cashu_token_swaps;
drop trigger if exists broadcast_cashu_token_swaps_changes_trigger on wallet.cashu_token_swaps;

create or replace function wallet.broadcast_cashu_token_swaps_changes()
returns trigger
language plpgsql
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

create constraint trigger broadcast_cashu_token_swaps_changes_trigger
  after insert or update
  on wallet.cashu_token_swaps
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_cashu_token_swaps_changes();

--


-- Update cashu send quotes broadcast to use realtime.send
drop trigger if exists broadcast_cashu_send_quotes_changes on wallet.cashu_send_quotes;
drop trigger if exists broadcast_cashu_send_quotes_changes_trigger on wallet.cashu_send_quotes;

create or replace function wallet.broadcast_cashu_send_quotes_changes()
returns trigger
language plpgsql
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

create constraint trigger broadcast_cashu_send_quotes_changes_trigger
  after insert or update
  on wallet.cashu_send_quotes
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_cashu_send_quotes_changes();

--


-- Update cashu send swaps broadcast to use realtime.send
drop trigger if exists broadcast_cashu_send_swaps_changes on wallet.cashu_send_swaps;
drop trigger if exists broadcast_cashu_send_swaps_changes_trigger on wallet.cashu_send_swaps;

create or replace function wallet.broadcast_cashu_send_swaps_changes()
returns trigger
language plpgsql
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

create constraint trigger broadcast_cashu_send_swaps_changes_trigger
  after insert or update
  on wallet.cashu_send_swaps
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_cashu_send_swaps_changes();

--


-- Update contacts broadcast to use realtime.send
drop trigger if exists broadcast_contacts_changes on wallet.contacts;
drop trigger if exists broadcast_contacts_changes_trigger on wallet.contacts;

create or replace function wallet.broadcast_contacts_changes()
returns trigger
language plpgsql
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

create constraint trigger broadcast_contacts_changes_trigger
  after insert or delete
  on wallet.contacts
  deferrable initially deferred
  for each row
  execute function wallet.broadcast_contacts_changes();

--


-- Drop broadcast_table_changes table because it is no longer used
drop function if exists wallet.broadcast_table_changes();

--

-- ++++++++++++++++++++++++++++++++++++
-- ++++++++++++++++++++++++++++++++++++



-- ++++++++++++++++++++++++++++++++++++
-- Unrelated changes for consistency
-- ++++++++++++++++++++++++++++++++++++

-- Update enforce_contacts_limit function to use new exception format
--
create or replace function wallet.enforce_contacts_limit()
returns trigger
language plpgsql
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

--