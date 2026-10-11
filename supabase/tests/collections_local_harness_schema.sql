-- Local harness contract only. Run against the disposable database from test.sh.
do $$
declare
  v_profile_count integer;
  v_required_columns text[] := array[
    'location', 'allow_edit_client_data', 'email_2fa_enabled'
  ];
  v_found_columns text[];
begin
  select array_agg(column_name order by column_name)
    into v_found_columns
  from information_schema.columns
  where table_schema = 'tap_hub_project' and table_name = 'profiles'
    and column_name = any(v_required_columns);

  if coalesce(cardinality(v_found_columns), 0) <> cardinality(v_required_columns) then
    raise exception 'Local profile subset is missing app identity/2FA fields';
  end if;

  select count(*) into v_profile_count from tap_hub_project.profiles;
  if v_profile_count <> 5 then
    raise exception 'Expected five fictional local role profiles, found %', v_profile_count;
  end if;
  if exists (select 1 from tap_hub_project.profiles where email not like '%@example.invalid') then
    raise exception 'Local harness profile email must use the reserved .invalid domain';
  end if;
end;
$$;
