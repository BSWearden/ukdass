-- UK DASS Alpha 1.2.1: coverage-aware PIB merging and forward NOTAM planning

alter table public.notam_system_state
  add column if not exists public_lookahead_minutes integer not null default 720
  check (public_lookahead_minutes between 0 and 4320);

create or replace view public.notam_assurance_state with (security_invoker=true) as
select d.id as danger_area_id,d.code,(current_n.id is not null) as has_live_notam,
 published_n.notam_number,published_n.valid_from as notam_valid_from,published_n.valid_until as notam_valid_until,
 case
  when s.source_name='NATS PIB manual import' then
   case when active_pib.id is null then 'STALE'
        when active_pib.sync_status='SUCCESS' then 'CURRENT'
        else active_pib.sync_status end
  when s.last_sync_status='UNINITIALISED' then 'UNINITIALISED'
  when s.last_sync_status in ('FAILED','PARTIAL') then s.last_sync_status
  when s.last_successful_sync_at is null then 'UNINITIALISED'
  when s.last_successful_sync_at<now()-make_interval(mins=>s.freshness_minutes) then 'STALE'
  else 'CURRENT'
 end as feed_state,
 s.visibility_mode,s.last_successful_sync_at,s.source_name,
 (published_n.id is not null) as has_published_notam,
 case when current_n.id is not null then 'CURRENT' when published_n.id is not null then 'UPCOMING' else 'NONE' end as notam_phase
from public.danger_areas d cross join public.notam_system_state s
left join lateral(
 select r.id,r.sync_status,r.coverage_start,r.coverage_end
 from public.notam_sync_runs r
 where r.source_name='NATS_PIB' and r.published_at is not null
   and r.sync_status in('SUCCESS','PARTIAL')
   and r.coverage_start<=now() and r.coverage_end>now()
 order by r.published_at desc,r.started_at desc limit 1
) active_pib on true
left join lateral(select x.id from public.danger_area_notams x where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE' and x.valid_from<=now() and (x.valid_until is null or x.valid_until>now()) order by x.valid_from desc limit 1) current_n on true
left join lateral(select x.id,x.notam_number,x.valid_from,x.valid_until from public.danger_area_notams x where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE' and (x.valid_until is null or x.valid_until>now()) order by case when x.valid_from<=now() then 0 else 1 end,x.valid_from limit 1) published_n on true
where d.aip_current;

create or replace view public.operator_notam_forward_plan with (security_invoker=true) as
select p.user_id,n.id as notam_id,d.id as danger_area_id,d.code,d.name,n.notam_number,
 n.valid_from,n.valid_until,
 case when n.valid_from<=now() and (n.valid_until is null or n.valid_until>now()) then 'CURRENT' else 'UPCOMING' end as notam_phase,
 n.matched_designator,n.q_code,n.sync_run_id
from public.operator_permissions p
join public.danger_area_notams n on n.danger_area_id=p.danger_area_id
join public.danger_areas d on d.id=n.danger_area_id
where n.match_status='MATCHED' and n.lifecycle_status='ACTIVE'
 and (n.valid_until is null or n.valid_until>now())
 and n.valid_from<now()+interval '4 days'
 and d.aip_current;
revoke all on public.operator_notam_forward_plan from anon;
grant select on public.operator_notam_forward_plan to authenticated;

create or replace function public.admin_publish_notam_pib(p_import_run_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_run public.notam_sync_runs;v_count int;v_unresolved int;v_review int;v_result text;v_tda int;v_retired int;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_run from public.notam_sync_runs r where r.id=p_import_run_id for update;if not found then raise exception 'PIB import not found';end if;
 if v_run.source_name<>'NATS_PIB' or v_run.sync_status not in ('STARTED','PARTIAL') then raise exception 'PIB import is not awaiting publication';end if;
 if v_run.coverage_end<=now() then raise exception 'PIB coverage has expired';end if;
 select count(*) into v_review from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='REVIEW_REQUIRED';
 if v_review>0 then raise exception 'PIB_REVIEW_REQUIRED';end if;

 update public.danger_areas set aip_current=false
 where airspace_source='TDA_NOTAM' and temporary_valid_until is not null and temporary_valid_until<=now();
 insert into public.danger_areas(code,name,lower_limit,upper_limit,promulgated_period,authority,airspace_when_inactive,geometry,current_status,aip_current,airspace_source,temporary_valid_until,temporary_source_reference,aip_geometry_segment_types)
 select distinct on(i.designator) i.designator,'Temporary Danger Area '||i.designator,coalesce(nullif(i.lower_limit,''),'SFC'),coalesce(nullif(i.upper_limit,''),'See NOTAM'),'NOTAM '||i.notam_number,'Authority stated in NOTAM','Class G',i.parsed_geometry,'UNVERIFIED',true,'TDA_NOTAM',i.valid_until,i.notam_number,array['NOTAM_POLYGON']::text[]
 from public.notam_import_items i
 where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='RESOLVED' and i.match_status='UNMATCHED' and i.designator is not null and jsonb_typeof(i.parsed_geometry)='array' and jsonb_array_length(i.parsed_geometry)>=3
 order by i.designator,i.valid_until desc
 on conflict(code) do update set name=excluded.name,lower_limit=excluded.lower_limit,upper_limit=excluded.upper_limit,promulgated_period=excluded.promulgated_period,authority=excluded.authority,geometry=excluded.geometry,aip_current=true,airspace_source='TDA_NOTAM',temporary_valid_until=greatest(public.danger_areas.temporary_valid_until,excluded.temporary_valid_until),temporary_source_reference=excluded.temporary_source_reference,aip_geometry_segment_types=excluded.aip_geometry_segment_types;
 get diagnostics v_tda=row_count;
 update public.notam_import_items i set danger_area_id=d.id,match_status='MATCHED',included=true
 from public.danger_areas d where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='RESOLVED' and i.match_status='UNMATCHED' and d.code=i.designator and d.airspace_source='TDA_NOTAM' and d.aip_current;

 update public.danger_area_notams n set lifecycle_status='CANCELLED',last_seen_at=now()
 where n.source_name='NATS_PIB' and n.lifecycle_status='ACTIVE'
  and n.valid_from<v_run.coverage_end and coalesce(n.valid_until,'infinity'::timestamptz)>v_run.coverage_start
  and not exists(select 1 from public.notam_import_items i where i.import_run_id=p_import_run_id and i.included and i.event_kind='ACTIVATION' and i.match_status='MATCHED' and i.schedule_status='RESOLVED' and i.notam_number=n.notam_number);
 get diagnostics v_retired=row_count;

 insert into public.danger_area_notams(notam_number,danger_area_id,matched_designator,valid_from,valid_until,lifecycle_status,match_status,match_method,match_confidence,q_code,raw_text,source_name,sync_run_id,last_seen_at)
 select i.notam_number,i.danger_area_id,i.designator,i.valid_from,i.valid_until,'ACTIVE','MATCHED',case when d.airspace_source='TDA_NOTAM' then 'NATS_PIB_NOTAM_POLYGON' when i.resolved_at is null then 'NATS_PIB_QCODE_DESIGNATOR' else 'NATS_PIB_ADMIN_SCHEDULE_RESOLUTION' end,1.0,i.q_code,i.raw_text,'NATS_PIB',p_import_run_id,now()
 from public.notam_import_items i join public.danger_areas d on d.id=i.danger_area_id
 where i.import_run_id=p_import_run_id and i.included and i.event_kind='ACTIVATION' and i.match_status='MATCHED' and i.schedule_status='RESOLVED'
 on conflict(notam_number) do update set danger_area_id=excluded.danger_area_id,matched_designator=excluded.matched_designator,valid_from=excluded.valid_from,valid_until=excluded.valid_until,lifecycle_status='ACTIVE',match_status='MATCHED',match_method=excluded.match_method,match_confidence=excluded.match_confidence,q_code=excluded.q_code,raw_text=excluded.raw_text,source_name='NATS_PIB',sync_run_id=excluded.sync_run_id,last_seen_at=now();
 get diagnostics v_count=row_count;

 update public.danger_areas d set aip_current=false
 where d.airspace_source='TDA_NOTAM' and not exists(
  select 1 from public.danger_area_notams n where n.danger_area_id=d.id and n.lifecycle_status='ACTIVE' and (n.valid_until is null or n.valid_until>now())
 );
 select count(*) into v_unresolved from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.match_status<>'MATCHED';
 v_result:=case when v_unresolved>0 then 'PARTIAL' else 'SUCCESS' end;
 update public.notam_sync_runs set sync_status=v_result,completed_at=now(),published_at=now(),published_by=v_user,matched_count=v_count,unmatched_count=v_unresolved where id=p_import_run_id;
 update public.notam_system_state set source_name='NATS PIB manual import',last_attempt_at=now(),last_successful_sync_at=case when v_result='SUCCESS' then now() else last_successful_sync_at end,last_sync_status=v_result,updated_at=now() where singleton;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,'NOTAM_PIB_MERGED','Merged NATS PIB '||coalesce(v_run.report_reference,'unknown')||' into forward plan',jsonb_build_object('import_run_id',p_import_run_id,'merged_records',v_count,'retired_overlapping_records',v_retired,'temporary_areas_materialised',v_tda,'unresolved_records',v_unresolved,'result',v_result,'coverage_start',v_run.coverage_start,'coverage_end',v_run.coverage_end));
end;$function$;
revoke all on function public.admin_publish_notam_pib(uuid) from public,anon;
grant execute on function public.admin_publish_notam_pib(uuid) to authenticated;

create or replace function public.get_public_operational_picture_v4()
returns table(id uuid,code text,name text,lower_limit text,upper_limit text,promulgated_period text,authority text,airspace_when_inactive text,geometry jsonb,declared_status text,effective_status text,status_updated_at timestamptz,status_valid_until timestamptz,validity_state text,operational_period_id uuid,operational_period_phase text,operational_period_starts_at timestamptz,operational_period_ends_at timestamptz,operational_period_reference text,operational_period_source text,has_live_notam boolean,has_published_notam boolean,notam_number text,notam_valid_from timestamptz,notam_valid_until timestamptz,notam_phase text,notam_feed_state text,notam_visibility_mode text,visibility_reason text)
language sql stable security definer set search_path='' as $function$
select d.id,d.code,d.name,d.lower_limit,d.upper_limit,d.promulgated_period,d.authority,d.airspace_when_inactive,d.geometry,d.current_status,case when d.status_valid_until is not null and d.status_valid_until>now() then d.current_status else 'UNVERIFIED' end,d.status_updated_at,d.status_valid_until,case when d.status_valid_until is null then 'NO_VALIDITY' when d.status_valid_until<=now() then 'EXPIRED' else 'CURRENT' end,p.id,case when p.id is null then null when p.starts_at<=now() and p.ends_at>now() then 'CURRENT' else 'UPCOMING' end,p.starts_at,p.ends_at,p.reference,p.source,ns.has_live_notam,ns.has_published_notam,ns.notam_number,ns.notam_valid_from,ns.notam_valid_until,ns.notam_phase,ns.feed_state,ns.visibility_mode,case when ns.has_live_notam then 'CURRENT_NOTAM' when ns.has_published_notam and ns.notam_valid_from<=now()+make_interval(mins=>s.public_lookahead_minutes) then 'UPCOMING_NOTAM' when d.current_status='ACTIVE' and d.status_valid_until>now() then 'ACTIVE_OVERRIDE' when ns.visibility_mode='MONITOR' then 'MONITOR_MODE' else 'FEED_FAIL_SAFE' end
from public.danger_areas d
left join lateral(select op.id,op.starts_at,op.ends_at,op.reference,op.source from public.operational_periods op where op.danger_area_id=d.id and op.period_status='PLANNED' and op.ends_at>now() order by case when op.starts_at<=now() then 0 else 1 end,op.starts_at limit 1)p on true
join public.notam_assurance_state ns on ns.danger_area_id=d.id
cross join public.notam_system_state s
where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3
 and (ns.visibility_mode='MONITOR' or ns.feed_state<>'CURRENT' or ns.has_live_notam or (ns.has_published_notam and ns.notam_valid_from<=now()+make_interval(mins=>s.public_lookahead_minutes)) or (d.current_status='ACTIVE' and d.status_valid_until>now()))
order by d.code;
$function$;
revoke all on function public.get_public_operational_picture_v4() from public,authenticated;
grant execute on function public.get_public_operational_picture_v4() to anon,authenticated;

create or replace function public.admin_notam_enforcement_readiness()
returns jsonb language plpgsql security definer set search_path='' stable as $function$
declare v_user uuid:=auth.uid();v_state public.notam_system_state;v_run public.notam_sync_runs;v_review int:=0;v_total int:=0;v_show int:=0;v_reasons jsonb:='[]'::jsonb;v_feed text;v_ready boolean;v_forward int:=0;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_state from public.notam_system_state where singleton;
 select * into v_run from public.notam_sync_runs where source_name='NATS_PIB' and published_at is not null and sync_status in('SUCCESS','PARTIAL') and coverage_start<=now() and coverage_end>now() order by published_at desc limit 1;
 if v_run.id is not null then select count(*) into v_review from public.notam_import_items where import_run_id=v_run.id and event_kind='ACTIVATION' and schedule_status='REVIEW_REQUIRED';end if;
 v_feed:=case when v_run.id is null then 'STALE' when v_run.sync_status='SUCCESS' then 'CURRENT' else v_run.sync_status end;
 if v_run.id is null then v_reasons:=v_reasons||'"No published NATS PIB covers the current time"'::jsonb;end if;
 if v_run.id is not null and v_run.unmatched_count<>0 then v_reasons:=v_reasons||to_jsonb(v_run.unmatched_count||' activation record(s) remain unmatched');end if;
 if v_review<>0 then v_reasons:=v_reasons||to_jsonb(v_review||' schedule review item(s) remain unresolved');end if;
 if v_feed<>'CURRENT' then v_reasons:=v_reasons||to_jsonb('Effective feed state is '||v_feed);end if;
 select count(*) into v_total from public.danger_areas d where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3;
 select count(*) into v_show from public.danger_areas d join public.notam_assurance_state n on n.danger_area_id=d.id cross join public.notam_system_state s where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3 and (n.has_live_notam or (n.has_published_notam and n.notam_valid_from<=now()+make_interval(mins=>s.public_lookahead_minutes)) or (d.current_status='ACTIVE' and d.status_valid_until>now()));
 select count(*) into v_forward from public.danger_area_notams n where n.source_name='NATS_PIB' and n.lifecycle_status='ACTIVE' and n.match_status='MATCHED' and n.valid_from>now() and n.valid_from<now()+interval '4 days';
 v_ready:=jsonb_array_length(v_reasons)=0;
 return jsonb_build_object('ready',v_ready,'reasons',v_reasons,'configured_mode',v_state.visibility_mode,'effective_feed_state',v_feed,'fail_safe_active',v_state.visibility_mode='ENFORCED' and v_feed<>'CURRENT','latest_report_reference',v_run.report_reference,'coverage_end',v_run.coverage_end,'matched_records',coalesce(v_run.matched_count,0),'unmatched_records',coalesce(v_run.unmatched_count,0),'review_required',v_review,'total_map_areas',v_total,'would_show',v_show,'would_hide',greatest(v_total-v_show,0),'forward_activations',v_forward,'public_lookahead_minutes',v_state.public_lookahead_minutes);
end;$function$;
revoke all on function public.admin_notam_enforcement_readiness() from public,anon;
grant execute on function public.admin_notam_enforcement_readiness() to authenticated;

notify pgrst,'reload schema';
