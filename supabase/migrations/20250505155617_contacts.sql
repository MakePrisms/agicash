CREATE OR REPLACE FUNCTION wallet.find_contact_candidates(partial_username text, current_user_id uuid)
RETURNS TABLE (username text, id uuid) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  pattern text;
BEGIN
  IF length(partial_username) < 3 THEN
    RETURN;
  END IF;

  pattern := lower(partial_username) || '%';

  RETURN QUERY
  SELECT u.username, u.id
  FROM wallet.users u 
  WHERE u.username LIKE pattern
    AND u.id != current_user_id
    AND NOT EXISTS (
      SELECT 1 
      FROM wallet.contacts c 
      WHERE c.owner_id = current_user_id AND c.username = u.username
    )
  ORDER BY u.username ASC;
END;
$$;

GRANT EXECUTE ON FUNCTION wallet.find_contact_candidates TO authenticated;

create table "wallet"."contacts" (
    "id" uuid default gen_random_uuid() not null,
    "created_at" timestamp with time zone not null default now(),
    "owner_id" uuid not null,
    -- defined if another agicash user is the contact
    "username" text 
);

alter table "wallet"."contacts" enable row level security;

alter publication supabase_realtime add table wallet.contacts;

CREATE UNIQUE INDEX contacts_pkey ON wallet.contacts USING btree (id);

alter table "wallet"."contacts" add constraint "contacts_pkey" PRIMARY KEY using index "contacts_pkey";

alter table "wallet"."contacts" add constraint "contacts_owner_id_fkey" FOREIGN KEY (owner_id) REFERENCES wallet.users(id) not valid;

alter table "wallet"."contacts" validate constraint "contacts_owner_id_fkey";

alter table "wallet"."contacts" add constraint "contacts_username_fkey" FOREIGN KEY (username) REFERENCES wallet.users(username) ON UPDATE CASCADE not valid;

alter table "wallet"."contacts" validate constraint "contacts_username_fkey";

-- Create index on users.username to optimize ILIKE queries and sorting
CREATE INDEX IF NOT EXISTS idx_users_username ON wallet.users USING btree (username text_pattern_ops);

-- Create composite index on contacts(owner_id, username) to optimize the NOT EXISTS subquery
CREATE INDEX IF NOT EXISTS idx_contacts_owner_username ON wallet.contacts USING btree (owner_id, username);


-- check that the contact is not the user themselves
CREATE OR REPLACE FUNCTION wallet.check_not_self_contact(owner_id uuid, contact_username text)
RETURNS boolean AS $$
BEGIN
  RETURN NOT EXISTS (
    SELECT 1 FROM wallet.users 
    WHERE id = owner_id AND username = contact_username
  );
END;
$$ LANGUAGE plpgsql;

ALTER TABLE wallet.contacts
ADD CONSTRAINT prevent_self_contact
CHECK (
  username IS NULL OR 
  wallet.check_not_self_contact(owner_id, username)
);

-- can't add same contact twice.
ALTER TABLE wallet.contacts
ADD CONSTRAINT contacts_owner_id_username_key
UNIQUE (owner_id, username);

grant delete on table "wallet"."contacts" to "anon";

grant insert on table "wallet"."contacts" to "anon";

grant references on table "wallet"."contacts" to "anon";

grant select on table "wallet"."contacts" to "anon";

grant trigger on table "wallet"."contacts" to "anon";

grant truncate on table "wallet"."contacts" to "anon";

grant update on table "wallet"."contacts" to "anon";

grant delete on table "wallet"."contacts" to "authenticated";

grant insert on table "wallet"."contacts" to "authenticated";

grant references on table "wallet"."contacts" to "authenticated";

grant select on table "wallet"."contacts" to "authenticated";

grant trigger on table "wallet"."contacts" to "authenticated";

grant truncate on table "wallet"."contacts" to "authenticated";

grant update on table "wallet"."contacts" to "authenticated";

grant delete on table "wallet"."contacts" to "service_role";

grant insert on table "wallet"."contacts" to "service_role";

grant references on table "wallet"."contacts" to "service_role";

grant select on table "wallet"."contacts" to "service_role";

grant trigger on table "wallet"."contacts" to "service_role";

grant truncate on table "wallet"."contacts" to "service_role";

grant update on table "wallet"."contacts" to "service_role";

create policy "Enable CRUD for contacts based on owner_id"
on "wallet"."contacts"
as permissive
for all
to authenticated
using ((( SELECT auth.uid() AS uid) = owner_id))
with check ((( SELECT auth.uid() AS uid) = owner_id));

-- Create a trigger function to enforce maximum contacts limit
CREATE OR REPLACE FUNCTION wallet.enforce_contacts_limit()
RETURNS TRIGGER AS $$
DECLARE
  contact_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO contact_count 
  FROM wallet.contacts 
  WHERE owner_id = NEW.owner_id;
  
  IF contact_count >= 150 THEN
    RAISE EXCEPTION 'Maximum contact limit reached (150)';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create a trigger that uses the function
CREATE TRIGGER enforce_max_contacts_limit
BEFORE INSERT ON wallet.contacts
FOR EACH ROW
EXECUTE FUNCTION wallet.enforce_contacts_limit();

