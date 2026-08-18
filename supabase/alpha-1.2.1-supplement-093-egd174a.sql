-- UK DASS Alpha 1.2.1: authoritative EGD174A geometry from UK AIP SUP 093/2026

create or replace function public.admin_apply_tda_supplement_093(p_import_run_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare
 v_user uuid:=auth.uid();
 v_count integer;
 v_polygon jsonb:='[[51.55849722,-0.16178333],[51.52069444,-0.1112],[51.51754167,-0.136225],[51.52798611,-0.14309167],[51.52910556,-0.13704167],[51.55385556,-0.17331667],[51.55849722,-0.16178333]]'::jsonb;
begin
 if v_user is null or not exists(
  select 1 from public.admin_profiles a
  where a.user_id=v_user and a.account_status='ACTIVE'
 ) then raise exception 'Active administrator required';end if;

 if not exists(
  select 1 from public.notam_sync_runs r
  where r.id=p_import_run_id and r.source_name='NATS_PIB'
   and r.sync_status in('STARTED','PARTIAL') and r.coverage_end>now()
 ) then raise exception 'PIB import is not reviewable';end if;

 update public.notam_import_items
 set parsed_geometry=v_polygon,
     lower_limit='SFC',
     upper_limit='700FT AMSL',
     resolution_note='Geometry and vertical limits verified against UK AIP SUP 093/2026 correction for Temporary Danger Area EGD174: London Health Bridge North Central Hub, valid 23 July 2026 to 23 January 2027.',
     resolved_by=v_user,
     resolved_at=now()
 where import_run_id=p_import_run_id
   and designator='EGD174A'
   and event_kind='ACTIVATION'
   and match_status='UNMATCHED';

 get diagnostics v_count=row_count;
 if v_count<>1 then raise exception 'Expected one unresolved EGD174A activation item, found %',v_count;end if;

 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata)
 values(
  v_user,
  'TDA_SUPPLEMENT_GEOMETRY_APPLIED',
  'Applied UK AIP SUP 093/2026 corrected geometry to EGD174A',
  jsonb_build_object(
   'import_run_id',p_import_run_id,
   'supplement','UK AIP SUP 093/2026',
   'area','EGD174A',
   'supplement_effective_period','2026-07-23 to 2027-01-23',
   'vertical_limits','SFC-700FT AMSL',
   'geometry_points',jsonb_array_length(v_polygon),
   'coordinate_source','User-supplied correction text from the authoritative supplement'
  )
 );
end;$function$;

revoke all on function public.admin_apply_tda_supplement_093(uuid) from public,anon;
grant execute on function public.admin_apply_tda_supplement_093(uuid) to authenticated;

notify pgrst,'reload schema';
