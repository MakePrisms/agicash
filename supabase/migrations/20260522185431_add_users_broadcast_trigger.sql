-- broadcast wallet.users updates through the user's private realtime channel
--
-- topic uses new.id because wallet.users has no user_id column —
-- the user is the row itself. existing side-table broadcasts use
-- 'wallet:' || new.user_id::text, which would be wrong here.
create or replace function "wallet"."broadcast_users_changes"()
returns "trigger"
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  perform realtime.send(
    to_jsonb(new),
    'USER_UPDATED',
    'wallet:' || new.id::text,
    true
  );
  return null;
end;
$function$;

create constraint trigger "broadcast_users_changes_trigger" after update on "wallet"."users" deferrable initially deferred for each row execute function "wallet"."broadcast_users_changes"();
