-- UK DASS Alpha 1.2.0, Stage 5: deterministic temporary Danger Areas from NOTAM geometry

alter table public.danger_areas
  add column if not exists airspace_source text not null default 'AIP' check(airspace_source in ('AIP','TDA_NOTAM')),
  add column if not exists temporary_valid_until timestamptz,
  add column if not exists temporary_source_reference text;
alter table public.notam_import_items add column if not exists parsed_geometry jsonb;

create or replace function private.notam_polygon_from_text(p_text text)
returns jsonb language sql immutable set search_path='' as $function$
with points as(
 select ord,
  (case when m[2]='S' then -1 else 1 end)*(substring(m[1],1,2)::numeric+substring(m[1],3,2)::numeric/60+substring(m[1],5,2)::numeric/3600) lat,
  (case when m[4]='W' then -1 else 1 end)*(substring(m[3],1,3)::numeric+substring(m[3],4,2)::numeric/60+substring(m[3],6,2)::numeric/3600) lon
 from regexp_matches(coalesce(p_text,''),'([0-9]{6})([NS])\s+([0-9]{7})([EW])','g') with ordinality x(m,ord)
),dedup as(select distinct on(lat,lon) ord,lat,lon from points order by lat,lon,ord)
select case when count(*)>=3 then jsonb_agg(jsonb_build_array(round(lat,7),round(lon,7)) order by ord) else null end from dedup
$function$;
revoke all on function private.notam_polygon_from_text(text) from public,anon,authenticated;

create or replace function private.populate_notam_import_geometry()
returns trigger language plpgsql set search_path='' as $function$
begin if new.parsed_geometry is null then new.parsed_geometry:=private.notam_polygon_from_text(new.raw_text);end if;return new;end;$function$;
drop trigger if exists notam_import_items_geometry on public.notam_import_items;
create trigger notam_import_items_geometry before insert or update of raw_text on public.notam_import_items for each row execute function private.populate_notam_import_geometry();
update public.notam_import_items set parsed_geometry=private.notam_polygon_from_text(raw_text) where parsed_geometry is null;

create or replace function public.admin_publish_notam_pib(p_import_run_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_run public.notam_sync_runs;v_count int;v_unresolved int;v_review int;v_result text;v_tda int;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_run from public.notam_sync_runs r where r.id=p_import_run_id for update;if not found then raise exception 'PIB import not found';end if;
 if v_run.source_name<>'NATS_PIB' or v_run.sync_status not in ('STARTED','PARTIAL') then raise exception 'PIB import is not awaiting publication';end if;
 if v_run.coverage_end<=now() then raise exception 'PIB coverage has expired';end if;
 select count(*) into v_review from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='REVIEW_REQUIRED';
 if v_review>0 then raise exception 'PIB_REVIEW_REQUIRED';end if;

 update public.danger_areas set aip_current=false where airspace_source='TDA_NOTAM';
 insert into public.danger_areas(code,name,lower_limit,upper_limit,promulgated_period,authority,airspace_when_inactive,geometry,current_status,aip_current,airspace_source,temporary_valid_until,temporary_source_reference,aip_geometry_segment_types)
 select distinct on(i.designator) i.designator,'Temporary Danger Area '||i.designator,coalesce(nullif(i.lower_limit,''),'SFC'),coalesce(nullif(i.upper_limit,''),'See NOTAM'),'NOTAM '||i.notam_number,'Authority stated in NOTAM','Class G',i.parsed_geometry,'UNVERIFIED',true,'TDA_NOTAM',i.valid_until,i.notam_number,array['NOTAM_POLYGON']::text[]
 from public.notam_import_items i
 where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='RESOLVED' and i.match_status='UNMATCHED' and i.designator is not null and jsonb_typeof(i.parsed_geometry)='array' and jsonb_array_length(i.parsed_geometry)>=3 order by i.designator,i.valid_until desc
 on conflict(code) do update set name=excluded.name,lower_limit=excluded.lower_limit,upper_limit=excluded.upper_limit,promulgated_period=excluded.promulgated_period,authority=excluded.authority,geometry=excluded.geometry,aip_current=true,airspace_source='TDA_NOTAM',temporary_valid_until=excluded.temporary_valid_until,temporary_source_reference=excluded.temporary_source_reference,aip_geometry_segment_types=excluded.aip_geometry_segment_types;
 get diagnostics v_tda=row_count;
 update public.notam_import_items i set danger_area_id=d.id,match_status='MATCHED',included=true
 from public.danger_areas d where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='RESOLVED' and i.match_status='UNMATCHED' and d.code=i.designator and d.airspace_source='TDA_NOTAM' and d.aip_current;

 select count(*) into v_unresolved from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.match_status<>'MATCHED';
 delete from public.danger_area_notams where source_name='NATS_PIB';
 insert into public.danger_area_notams(notam_number,danger_area_id,matched_designator,valid_from,valid_until,lifecycle_status,match_status,match_method,match_confidence,q_code,raw_text,source_name,sync_run_id)
 select i.notam_number,i.danger_area_id,i.designator,i.valid_from,i.valid_until,'ACTIVE','MATCHED',case when d.airspace_source='TDA_NOTAM' then 'NATS_PIB_NOTAM_POLYGON' when i.resolved_at is null then 'NATS_PIB_QCODE_DESIGNATOR' else 'NATS_PIB_ADMIN_SCHEDULE_RESOLUTION' end,1.0,i.q_code,i.raw_text,'NATS_PIB',p_import_run_id
 from public.notam_import_items i join public.danger_areas d on d.id=i.danger_area_id where i.import_run_id=p_import_run_id and i.included and i.event_kind='ACTIVATION' and i.match_status='MATCHED' and i.schedule_status='RESOLVED';
 get diagnostics v_count=row_count;
 v_result:=case when v_unresolved>0 then 'PARTIAL' else 'SUCCESS' end;
 update public.notam_sync_runs set sync_status=v_result,completed_at=now(),published_at=now(),published_by=v_user,matched_count=v_count,unmatched_count=v_unresolved where id=p_import_run_id;
 update public.notam_system_state set source_name='NATS PIB manual import',last_attempt_at=now(),last_successful_sync_at=case when v_result='SUCCESS' then now() else last_successful_sync_at end,last_sync_status=v_result,updated_at=now() where singleton;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,'NOTAM_PIB_PUBLISHED','Published NATS PIB '||coalesce(v_run.report_reference,'unknown'),jsonb_build_object('import_run_id',p_import_run_id,'published_records',v_count,'temporary_areas_materialised',v_tda,'unresolved_records',v_unresolved,'result',v_result,'coverage_end',v_run.coverage_end,'republication',v_run.sync_status='PARTIAL'));
end;$function$;
revoke all on function public.admin_publish_notam_pib(uuid) from public,anon;
grant execute on function public.admin_publish_notam_pib(uuid) to authenticated;
notify pgrst,'reload schema';
