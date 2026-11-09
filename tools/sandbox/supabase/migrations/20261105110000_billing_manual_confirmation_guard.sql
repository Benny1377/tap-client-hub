begin;

-- One manual completion is billable per client service and confirmed date.
-- The idempotency key still handles retries of that same request; this index
-- also prevents a second key from minting a duplicate candidate.
create unique index if not exists billing_manual_confirmation_service_date_key
  on tap_hub_project.billing_manual_confirmations(client_service_id, confirmed_date);

create or replace function tap_hub_project.guard_billing_manual_confirmation_date()
returns trigger
language plpgsql
set search_path = tap_hub_project, public
as $$
begin
  if new.confirmed_date > (clock_timestamp() at time zone 'America/Chicago')::date then
    raise exception 'confirmation_date_future: manual confirmation must be on or before today in Houston time'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists billing_manual_confirmation_date_guard
  on tap_hub_project.billing_manual_confirmations;
create trigger billing_manual_confirmation_date_guard
  before insert or update of confirmed_date on tap_hub_project.billing_manual_confirmations
  for each row execute function tap_hub_project.guard_billing_manual_confirmation_date();

revoke all on function tap_hub_project.guard_billing_manual_confirmation_date() from public, anon, authenticated;

commit;
