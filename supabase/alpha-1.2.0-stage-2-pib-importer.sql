-- UK DASS Alpha 1.2.0, Stage 2: controlled NATS PIB PDF import and publication

alter table public.notam_sync_runs
  add column if not exists uploaded_by uuid references auth.users(id) on delete restrict,
  add column if not exists file_name text,
  add column if not exists file_sha256 text,
  add column if not exists pib_reference text,
  add column if not exists report_reference text,
  add column if not exists coverage_start timestamptz,
  add column if not exists coverage_end timestamptz,
  add column if not exists firs text[],
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users(id) on delete restrict,
  add column if not exists parser_version text,
  add column if not exists warning_count integer not null default 0 check (warning_count >= 0);

create unique index if not exists notam_sync_runs_file_sha256_uidx
  on public.notam_sync_runs(file_sha256) where file_sha256 is not null and sync_status <> 'FAILED';

alter table public.danger_area_notams drop constraint if exists danger_area_notams_notam_number_key;
create unique index if not exists danger_area_notams_record_uidx
  on public.danger_area_notams(notam_number,danger_area_id,valid_from);

create table if not exists public.notam_import_items (
  id uuid primary key default gen_random_uuid(),
  import_run_id uuid not null references public.notam_sync_runs(id) on delete cascade,
  notam_number text not null,
  q_code text not null,
  event_kind text not null check (event_kind in ('ACTIVATION','DEACTIVATION','TDA_INSTALLATION','REFERENCE','UNSUPPORTED')),
  designator text,
  danger_area_id uuid references public.danger_areas(id) on delete set null,
  valid_from timestamptz,
  valid_until timestamptz,
  lower_limit text,
  upper_limit text,
  match_status text not null check (match_status in ('MATCHED','UNMATCHED','AMBIGUOUS','NOT_APPLICABLE')),
  schedule_status text not null check (schedule_status in ('RESOLVED','REVIEW_REQUIRED','NOT_APPLICABLE')),
  included boolean not null default false,
  review_note text,
  raw_text text not null,
  created_at timestamptz not null default now(),
  check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create index if not exists notam_import_items_run_idx on public.notam_import_items(import_run_id);
create index if not exists notam_import_items_area_idx on public.notam_import_items(danger_area_id,valid_from);
alter table public.notam_import_items enable row level security;
revoke all on public.notam_import_items from anon,authenticated;
grant select on public.notam_import_items to authenticated;
drop policy if exists notam_import_items_admin_read on public.notam_import_items;
create policy notam_import_items_admin_read on public.notam_import_items for select to authenticated using (
  exists(select 1 from public.admin_profiles a where a.user_id=(select auth.uid()) and a.account_status='ACTIVE')
);

create or replace function public.admin_stage_notam_pib(p_manifest jsonb,p_items jsonb)
returns uuid language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_run uuid;v_item jsonb;v_area_id uuid;v_received int;v_matched int;v_unmatched int;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 if jsonb_typeof(p_manifest)<>'object' or jsonb_typeof(p_items)<>'array' then raise exception 'Invalid PIB payload';end if;
 if coalesce(p_manifest->>'source_name','')<>'NATS_PIB' then raise exception 'Invalid PIB source';end if;
 if coalesce(p_manifest->>'file_sha256','')!~'^[0-9a-f]{64}$' then raise exception 'Invalid file fingerprint';end if;
 if not ((p_manifest->'firs') ? 'EGTT' and (p_manifest->'firs') ? 'EGPX') then raise exception 'PIB must cover EGTT and EGPX';end if;
 if (p_manifest->>'coverage_start')::timestamptz >= (p_manifest->>'coverage_end')::timestamptz then raise exception 'Invalid PIB coverage';end if;
 v_received:=jsonb_array_length(p_items);if v_received=0 or v_received>1000 then raise exception 'Unexpected PIB item count';end if;
 insert into public.notam_sync_runs(source_name,source_reference,started_at,sync_status,received_count,uploaded_by,file_name,file_sha256,pib_reference,report_reference,coverage_start,coverage_end,firs,parser_version,warning_count)
 values('NATS_PIB',p_manifest->>'report_reference',now(),'STARTED',v_received,v_user,left(p_manifest->>'file_name',240),p_manifest->>'file_sha256',left(p_manifest->>'pib_reference',120),left(p_manifest->>'report_reference',120),(p_manifest->>'coverage_start')::timestamptz,(p_manifest->>'coverage_end')::timestamptz,array(select jsonb_array_elements_text(p_manifest->'firs')),left(p_manifest->>'parser_version',40),coalesce((p_manifest->>'warning_count')::int,0)) returning id into v_run;
 for v_item in select value from jsonb_array_elements(p_items) loop
   v_area_id:=null;
   if nullif(v_item->>'designator','') is not null then select d.id into v_area_id from public.danger_areas d where d.aip_current and upper(regexp_replace(d.code,'[^A-Z0-9]','','g'))=upper(regexp_replace(v_item->>'designator','[^A-Z0-9]','','g')) limit 1;end if;
   insert into public.notam_import_items(import_run_id,notam_number,q_code,event_kind,designator,danger_area_id,valid_from,valid_until,lower_limit,upper_limit,match_status,schedule_status,included,review_note,raw_text)
   values(v_run,left(v_item->>'notam_number',30),left(v_item->>'q_code',10),v_item->>'event_kind',nullif(upper(v_item->>'designator'),''),v_area_id,nullif(v_item->>'valid_from','')::timestamptz,nullif(v_item->>'valid_until','')::timestamptz,left(v_item->>'lower_limit',40),left(v_item->>'upper_limit',40),case when v_area_id is not null then 'MATCHED' when (v_item->>'event_kind') in ('REFERENCE','UNSUPPORTED') then 'NOT_APPLICABLE' else 'UNMATCHED' end,v_item->>'schedule_status',coalesce((v_item->>'included')::boolean,false) and v_area_id is not null and v_item->>'event_kind'='ACTIVATION' and v_item->>'schedule_status'='RESOLVED',left(v_item->>'review_note',500),left(v_item->>'raw_text',8000));
 end loop;
 select count(*) filter(where match_status='MATCHED' and included),count(*) filter(where match_status='UNMATCHED' and event_kind='ACTIVATION') into v_matched,v_unmatched from public.notam_import_items where import_run_id=v_run;
 update public.notam_sync_runs set matched_count=v_matched,unmatched_count=v_unmatched where id=v_run;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,'NOTAM_PIB_STAGED','Staged NATS PIB '||coalesce(p_manifest->>'report_reference','unknown'),jsonb_build_object('import_run_id',v_run,'file_sha256',p_manifest->>'file_sha256','received_count',v_received,'matched_count',v_matched,'unmatched_count',v_unmatched));
 return v_run;
exception when unique_violation then raise exception 'This PIB file has already been staged or published';
end;$function$;
revoke all on function public.admin_stage_notam_pib(jsonb,jsonb) from public,anon;
grant execute on function public.admin_stage_notam_pib(jsonb,jsonb) to authenticated;

create or replace function public.admin_publish_notam_pib(p_import_run_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_run public.notam_sync_runs;v_count int;v_unresolved int;v_result text;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_run from public.notam_sync_runs r where r.id=p_import_run_id for update;if not found then raise exception 'PIB import not found';end if;
 if v_run.source_name<>'NATS_PIB' or v_run.sync_status<>'STARTED' then raise exception 'PIB import is not awaiting publication';end if;
 if v_run.coverage_end<=now() then raise exception 'PIB coverage has expired';end if;
 select count(*) into v_unresolved from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and (i.match_status<>'MATCHED' or i.schedule_status<>'RESOLVED');
 delete from public.danger_area_notams where source_name='NATS_PIB';
 insert into public.danger_area_notams(notam_number,danger_area_id,matched_designator,valid_from,valid_until,lifecycle_status,match_status,match_method,match_confidence,q_code,raw_text,source_name,sync_run_id)
 select i.notam_number,i.danger_area_id,i.designator,i.valid_from,i.valid_until,'ACTIVE','MATCHED','NATS_PIB_QCODE_DESIGNATOR',1.0,i.q_code,i.raw_text,'NATS_PIB',p_import_run_id
 from public.notam_import_items i where i.import_run_id=p_import_run_id and i.included and i.event_kind='ACTIVATION' and i.match_status='MATCHED' and i.schedule_status='RESOLVED';
 get diagnostics v_count=row_count;
 v_result:=case when v_unresolved>0 then 'PARTIAL' else 'SUCCESS' end;
 update public.notam_sync_runs set sync_status=v_result,completed_at=now(),published_at=now(),published_by=v_user,matched_count=v_count,unmatched_count=v_unresolved where id=p_import_run_id;
 update public.notam_system_state set source_name='NATS PIB manual import',last_attempt_at=now(),last_successful_sync_at=case when v_result='SUCCESS' then now() else last_successful_sync_at end,last_sync_status=v_result,updated_at=now() where singleton;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,'NOTAM_PIB_PUBLISHED','Published NATS PIB '||coalesce(v_run.report_reference,'unknown'),jsonb_build_object('import_run_id',p_import_run_id,'published_records',v_count,'unresolved_records',v_unresolved,'result',v_result,'coverage_end',v_run.coverage_end));
end;$function$;
revoke all on function public.admin_publish_notam_pib(uuid) from public,anon;
grant execute on function public.admin_publish_notam_pib(uuid) to authenticated;

create or replace function public.admin_discard_notam_pib(p_import_run_id uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 if char_length(trim(coalesce(p_reason,'')))<5 then raise exception 'Discard reason required';end if;
 update public.notam_sync_runs set sync_status='FAILED',completed_at=now(),error_summary=left(trim(p_reason),500) where id=p_import_run_id and sync_status='STARTED';if not found then raise exception 'PIB import is not awaiting review';end if;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,'NOTAM_PIB_DISCARDED','Discarded staged NATS PIB',jsonb_build_object('import_run_id',p_import_run_id,'reason',left(trim(p_reason),500)));
end;$function$;
revoke all on function public.admin_discard_notam_pib(uuid,text) from public,anon;
grant execute on function public.admin_discard_notam_pib(uuid,text) to authenticated;

create or replace view public.notam_assurance_state with (security_invoker=true) as
select d.id as danger_area_id,d.code,(current_n.id is not null) as has_live_notam,
 published_n.notam_number,published_n.valid_from as notam_valid_from,published_n.valid_until as notam_valid_until,
 case when s.last_sync_status='UNINITIALISED' then 'UNINITIALISED' when s.last_sync_status in ('FAILED','PARTIAL') then s.last_sync_status when s.last_successful_sync_at is null then 'UNINITIALISED' when s.last_successful_sync_at<now()-make_interval(mins=>s.freshness_minutes) then 'STALE' else 'CURRENT' end as feed_state,
 s.visibility_mode,s.last_successful_sync_at,s.source_name,
 (published_n.id is not null) as has_published_notam,
 case when current_n.id is not null then 'CURRENT' when published_n.id is not null then 'UPCOMING' else 'NONE' end as notam_phase
from public.danger_areas d cross join public.notam_system_state s
left join lateral(select x.id from public.danger_area_notams x where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE' and x.valid_from<=now() and (x.valid_until is null or x.valid_until>now()) order by x.valid_from desc limit 1) current_n on true
left join lateral(select x.id,x.notam_number,x.valid_from,x.valid_until from public.danger_area_notams x where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE' and (x.valid_until is null or x.valid_until>now()) order by case when x.valid_from<=now() then 0 else 1 end,x.valid_from limit 1) published_n on true
where d.aip_current;

create or replace view public.operator_effective_danger_areas with (security_invoker=true) as
select p.user_id,p.can_change_status,d.id,d.code,d.name,d.lower_limit,d.upper_limit,d.promulgated_period,d.authority,d.airspace_when_inactive,d.current_status as declared_status,case when d.status_valid_until is not null and d.status_valid_until>now() then d.current_status else 'UNVERIFIED' end as effective_status,d.status_updated_at,d.status_valid_until,coalesce(periods.starts_at,d.reporting_window_start_at) as reporting_window_start_at,coalesce(periods.ends_at,d.reporting_window_end_at) as reporting_window_end_at,coalesce(periods.starts_at,d.reporting_window_start_at) is not null and coalesce(periods.ends_at,d.reporting_window_end_at) is not null and now()>=coalesce(periods.starts_at,d.reporting_window_start_at) and now()<coalesce(periods.ends_at,d.reporting_window_end_at) as reporting_window_open,d.pre_activation_lead_minutes,coalesce(periods.starts_at,d.reporting_window_start_at) is not null and now()>=coalesce(periods.starts_at,d.reporting_window_start_at)-make_interval(mins=>d.pre_activation_lead_minutes) and now()<coalesce(periods.starts_at,d.reporting_window_start_at) as pre_activation_window_open,d.scheduled_activation_at,d.scheduled_activation_by,d.scheduled_activation_created_at,d.scheduled_activation_note,d.scheduled_activation_at is not null as activation_scheduled,d.scheduled_activation_period_id,periods.id as operational_period_id,periods.reference as operational_period_reference,periods.source as operational_period_source,periods.period_status as operational_period_status,ns.has_live_notam,ns.notam_number,ns.notam_valid_from,ns.notam_valid_until,ns.feed_state as notam_feed_state,ns.visibility_mode as notam_visibility_mode,ns.has_published_notam,ns.notam_phase
from public.operator_permissions p join public.danger_areas d on d.id=p.danger_area_id left join lateral(select op.id,op.starts_at,op.ends_at,op.reference,op.source,op.period_status from public.operational_periods op where op.danger_area_id=d.id and op.period_status='PLANNED' and op.ends_at>now() order by case when now()>=op.starts_at and now()<op.ends_at then 0 else 1 end,op.starts_at limit 1) periods on true left join public.notam_assurance_state ns on ns.danger_area_id=d.id where d.aip_current;

create or replace function public.get_public_operational_picture_v4()
returns table(id uuid,code text,name text,lower_limit text,upper_limit text,promulgated_period text,authority text,airspace_when_inactive text,geometry jsonb,declared_status text,effective_status text,status_updated_at timestamptz,status_valid_until timestamptz,validity_state text,operational_period_id uuid,operational_period_phase text,operational_period_starts_at timestamptz,operational_period_ends_at timestamptz,operational_period_reference text,operational_period_source text,has_live_notam boolean,has_published_notam boolean,notam_number text,notam_valid_from timestamptz,notam_valid_until timestamptz,notam_phase text,notam_feed_state text,notam_visibility_mode text,visibility_reason text)
language sql stable security definer set search_path='' as $function$
select d.id,d.code,d.name,d.lower_limit,d.upper_limit,d.promulgated_period,d.authority,d.airspace_when_inactive,d.geometry,d.current_status,case when d.status_valid_until is not null and d.status_valid_until>now() then d.current_status else 'UNVERIFIED' end,d.status_updated_at,d.status_valid_until,case when d.status_valid_until is null then 'NO_VALIDITY' when d.status_valid_until<=now() then 'EXPIRED' else 'CURRENT' end,p.id,case when p.id is null then null when p.starts_at<=now() and p.ends_at>now() then 'CURRENT' else 'UPCOMING' end,p.starts_at,p.ends_at,p.reference,p.source,ns.has_live_notam,ns.has_published_notam,ns.notam_number,ns.notam_valid_from,ns.notam_valid_until,ns.notam_phase,ns.feed_state,ns.visibility_mode,case when ns.has_live_notam then 'CURRENT_NOTAM' when ns.has_published_notam then 'UPCOMING_NOTAM' when d.current_status='ACTIVE' and d.status_valid_until>now() then 'ACTIVE_OVERRIDE' when ns.visibility_mode='MONITOR' then 'MONITOR_MODE' else 'FEED_FAIL_SAFE' end
from public.danger_areas d left join lateral(select op.id,op.starts_at,op.ends_at,op.reference,op.source from public.operational_periods op where op.danger_area_id=d.id and op.period_status='PLANNED' and op.ends_at>now() order by case when op.starts_at<=now() then 0 else 1 end,op.starts_at limit 1)p on true join public.notam_assurance_state ns on ns.danger_area_id=d.id
where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3 and (ns.visibility_mode='MONITOR' or ns.feed_state<>'CURRENT' or ns.has_published_notam or (d.current_status='ACTIVE' and d.status_valid_until>now())) order by d.code;
$function$;
revoke all on function public.get_public_operational_picture_v4() from public,authenticated;
grant execute on function public.get_public_operational_picture_v4() to anon,authenticated;
notify pgrst,'reload schema';
