-- Local harness contract only. Run against the disposable database from test.sh.
do $$
declare
  v_profile_count integer;
  v_required_columns text[] := array[
    'location', 'allow_edit_client_data', 'email_2fa_enabled'
  ];
  v_found_columns text[];
  v_client_required_columns text[] := array[
    'client_code', 'group_name', 'address', 'city', 'state', 'zip'
  ];
  v_client_found_columns text[];
begin
  select array_agg(column_name order by column_name)
    into v_found_columns
  from information_schema.columns
  where table_schema = 'tap_hub_project' and table_name = 'profiles'
    and column_name = any(v_required_columns);

  if coalesce(cardinality(v_found_columns), 0) <> cardinality(v_required_columns) then
    raise exception 'Local profile subset is missing app identity/2FA fields';
  end if;

  select array_agg(column_name order by column_name)
    into v_found_columns
  from information_schema.columns
  where table_schema = 'tap_hub_project' and table_name = 'contacts'
    and column_name = 'updated_at';
  if coalesce(cardinality(v_found_columns), 0) <> 1 then
    raise exception 'Local contacts subset is missing updated_at';
  end if;

  select array_agg(column_name order by column_name)
    into v_client_found_columns
  from information_schema.columns
  where table_schema = 'tap_hub_project' and table_name = 'clients'
    and column_name = any(v_client_required_columns);
  if coalesce(cardinality(v_client_found_columns), 0) <> cardinality(v_client_required_columns) then
    raise exception 'Local clients subset is missing Contacts-directory display fields';
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
