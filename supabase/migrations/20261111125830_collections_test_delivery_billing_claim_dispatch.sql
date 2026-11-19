-- Route Billing-only claims to the Billing eligibility function before the
-- source-aware PDF claim looks for a source identity row. Billing invoices do
-- not have collection_source_invoice_identities rows; PDF claims still use the
-- existing identity lock and source-specific safeguards.
begin;

alter function tap_hub_project.claim_collection_test_delivery(uuid,uuid)
  rename to claim_collection_test_delivery_pre_billing_dispatch;
revoke all on function tap_hub_project.claim_collection_test_delivery_pre_billing_dispatch(uuid,uuid)
  from public,anon,authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery_pre_billing_dispatch(uuid,uuid)
  to service_role;

create function tap_hub_project.claim_collection_test_delivery(p_attempt_id uuid,p_actor uuid default null)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_attempt tap_hub_project.collection_delivery_attempts%rowtype;
  v_identity tap_hub_project.collection_source_invoice_identities%rowtype;
  v_count integer;
  v_email text;
begin
  select * into v_attempt from tap_hub_project.collection_delivery_attempts where id=p_attempt_id;
  if not found or v_attempt.status<>'queued' then
    return tap_hub_project.claim_collection_test_delivery_pre_billing_dispatch(p_attempt_id,p_actor);
  end if;

  -- Preserve the final email syntax gate for both sources. The older Billing
  -- claim still checks its own contact, invoice, balance, hold and stage rules.
  if v_attempt.stage between 1 and 3 then
    select count(*),max(nullif(btrim(email),'')) into v_count,v_email
    from tap_hub_project.contacts
    where client_id=v_attempt.client_id and category='client' and is_primary;
    if v_count<>1 then return 'CONTACT_REVIEW_REQUIRED'; end if;
    if v_email is null then return 'EMAIL_CONTACT_MISSING'; end if;
    if v_email !~ '^[^[:space:]@"<>]+@[^[:space:]@"<>]+\.[^[:space:]@"<>]+$' then
      return 'EMAIL_CONTACT_INVALID';
    end if;
  end if;

  if v_attempt.source='billing' then
    -- Billing normally has no source identity row. If one exists, retain the
    -- existing identity lock/cleared-state checks; only the missing-row case
    -- takes the legacy Billing claim directly.
    select * into v_identity
    from tap_hub_project.collection_source_invoice_identities
    where canonical_collection_identity=v_attempt.canonical_collection_identity
    for update;
    if not found then
      return tap_hub_project.claim_collection_test_delivery_pre_phase5(p_attempt_id,p_actor);
    end if;
  end if;
  return tap_hub_project.claim_collection_test_delivery_pre_billing_dispatch(p_attempt_id,p_actor);
end; $$;

revoke all on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) from public,anon,authenticated;
grant execute on function tap_hub_project.claim_collection_test_delivery(uuid,uuid) to service_role;

commit;
