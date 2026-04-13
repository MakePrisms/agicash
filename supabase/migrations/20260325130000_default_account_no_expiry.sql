-- Prevent default accounts from having expires_at set.
-- Two triggers: one guards setting a default, the other guards adding expiry.

-- Trigger A: block setting an expiring account as default
create or replace function wallet.enforce_default_account_no_expiry()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.default_btc_account_id is distinct from old.default_btc_account_id
     and new.default_btc_account_id is not null then
    if exists (
      select 1 from wallet.accounts
      where id = new.default_btc_account_id
        and expires_at is not null
    ) then
      raise exception 'Cannot set expiring account as default'
        using hint = 'DEFAULT_ACCOUNT_EXPIRES';
    end if;
  end if;

  if new.default_usd_account_id is distinct from old.default_usd_account_id
     and new.default_usd_account_id is not null then
    if exists (
      select 1 from wallet.accounts
      where id = new.default_usd_account_id
        and expires_at is not null
    ) then
      raise exception 'Cannot set expiring account as default'
        using hint = 'DEFAULT_ACCOUNT_EXPIRES';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_default_account_no_expiry_trigger
  before insert or update on wallet.users
  for each row
  execute function wallet.enforce_default_account_no_expiry();

-- Trigger B: block adding expires_at to an account that's someone's default
create or replace function wallet.enforce_no_expiry_on_default_account()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.expires_at is not null and old.expires_at is null then
    if exists (
      select 1 from wallet.users
      where default_btc_account_id = new.id
         or default_usd_account_id = new.id
    ) then
      raise exception 'Cannot add expiry to a default account'
        using hint = 'DEFAULT_ACCOUNT_EXPIRES';
    end if;
  end if;

  return new;
end;
$$;

create trigger enforce_no_expiry_on_default_account_trigger
  before update on wallet.accounts
  for each row
  execute function wallet.enforce_no_expiry_on_default_account();
