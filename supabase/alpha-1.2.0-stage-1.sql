-- UK DASS Alpha 1.2.0, Stage 1: NOTAM assurance foundation
-- Safe initial state: MONITOR. Public visibility is not filtered until a fresh feed exists.

create table if not exists public.notam_system_state (
  singleton boolean primary key default true check (singleton),
  visibility_mode text not null default 'MONITOR' check (visibility_mode in ('MONITOR','ENFORCED')),
  source_name text,
  last_attempt_at timestamptz,
  last_successful_sync_at timestamptz,
  last_sync_status text not null default 'UNINITIALISED' check (last_sync_status in ('UNINITIALISED','SUCCESS','PARTIAL','FAILED')),
  freshness_minutes integer not null default 90 check (freshness_minutes between 5 and 1440),
  updated_at timestamptz not null default now()
);

insert into public.notam_system_state(singleton) values(true) on conflict(singleton) do nothing;

create table if not exists public.notam_sync_runs (
  id uuid primary key default gen_random_uuid(),
  source_name text not null,
  source_reference text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  sync_status text not null default 'STARTED' check (sync_status in ('STARTED','SUCCESS','PARTIAL','FAILED')),
  received_count integer not null default 0 check (received_count >= 0),
  matched_count integer not null default 0 check (matched_count >= 0),
  unmatched_count integer not null default 0 check (unmatched_count >= 0),
  error_summary text
);

create table if not exists public.danger_area_notams (
  id uuid primary key default gen_random_uuid(),
  notam_number text not null unique,
  danger_area_id uuid references public.danger_areas(id) on delete set null,
  matched_designator text,
  valid_from timestamptz not null,
  valid_until timestamptz,
  lifecycle_status text not null default 'ACTIVE' check (lifecycle_status in ('ACTIVE','CANCELLED','REPLACED')),
  match_status text not null default 'UNMATCHED' check (match_status in ('MATCHED','UNMATCHED','AMBIGUOUS')),
  match_method text,
  match_confidence numeric(5,4) check (match_confidence between 0 and 1),
  q_code text,
  raw_text text,
  source_name text not null,
  sync_run_id uuid references public.notam_sync_runs(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  check (valid_until is null or valid_until > valid_from),
  check ((match_status = 'MATCHED' and danger_area_id is not null) or match_status <> 'MATCHED')
);

create table if not exists public.notam_activation_overrides (
  id uuid primary key default gen_random_uuid(),
  danger_area_id uuid not null references public.danger_areas(id) on delete restrict,
  operator_user_id uuid not null references auth.users(id) on delete restrict,
  reason text not null check (char_length(trim(reason)) between 10 and 500),
  confirmed_designator text not null,
  feed_state_at_override text not null,
  created_at timestamptz not null default now()
);

create index if not exists danger_area_notams_live_idx on public.danger_area_notams(danger_area_id,valid_from,valid_until) where lifecycle_status='ACTIVE' and match_status='MATCHED';
create index if not exists danger_area_notams_sync_run_idx on public.danger_area_notams(sync_run_id);
create index if not exists notam_sync_runs_started_idx on public.notam_sync_runs(started_at desc);
create index if not exists notam_overrides_area_created_idx on public.notam_activation_overrides(danger_area_id,created_at desc);
create index if not exists notam_overrides_operator_idx on public.notam_activation_overrides(operator_user_id,created_at desc);

alter table public.notam_system_state enable row level security;
alter table public.notam_sync_runs enable row level security;
alter table public.danger_area_notams enable row level security;
alter table public.notam_activation_overrides enable row level security;

revoke all on public.notam_system_state,public.notam_sync_runs,public.danger_area_notams,public.notam_activation_overrides from anon,authenticated;
grant select on public.notam_system_state,public.notam_sync_runs,public.danger_area_notams,public.notam_activation_overrides to authenticated;

drop policy if exists notam_state_admin_read on public.notam_system_state;
create policy notam_state_admin_read on public.notam_system_state for select to authenticated using (
  exists(select 1 from public.admin_profiles a where a.user_id=(select auth.uid()) and a.account_status='ACTIVE')
);
drop policy if exists notam_runs_admin_read on public.notam_sync_runs;
create policy notam_runs_admin_read on public.notam_sync_runs for select to authenticated using (
  exists(select 1 from public.admin_profiles a where a.user_id=(select auth.uid()) and a.account_status='ACTIVE')
);
drop policy if exists notams_authorised_read on public.danger_area_notams;
create policy notams_authorised_read on public.danger_area_notams for select to authenticated using (
  exists(select 1 from public.admin_profiles a where a.user_id=(select auth.uid()) and a.account_status='ACTIVE')
  or exists(select 1 from public.operator_permissions p where p.user_id=(select auth.uid()) and p.danger_area_id=danger_area_notams.danger_area_id)
);
drop policy if exists notam_overrides_authorised_read on public.notam_activation_overrides;
create policy notam_overrides_authorised_read on public.notam_activation_overrides for select to authenticated using (
  operator_user_id=(select auth.uid())
  or exists(select 1 from public.admin_profiles a where a.user_id=(select auth.uid()) and a.account_status='ACTIVE')
);

create or replace view public.notam_assurance_state with (security_invoker=true) as
select d.id as danger_area_id,d.code,
  (n.id is not null) as has_live_notam,n.notam_number,n.valid_from as notam_valid_from,n.valid_until as notam_valid_until,
  case
    when s.last_sync_status='UNINITIALISED' then 'UNINITIALISED'
    when s.last_sync_status in ('FAILED','PARTIAL') then s.last_sync_status
    when s.last_successful_sync_at is null then 'UNINITIALISED'
    when s.last_successful_sync_at < now()-make_interval(mins=>s.freshness_minutes) then 'STALE'
    else 'CURRENT'
  end as feed_state,
  s.visibility_mode,s.last_successful_sync_at,s.source_name
from public.danger_areas d
cross join public.notam_system_state s
left join lateral(
  select x.id,x.notam_number,x.valid_from,x.valid_until
  from public.danger_area_notams x
  where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE'
    and x.valid_from<=now() and (x.valid_until is null or x.valid_until>now())
  order by x.valid_from desc limit 1
) n on true
where d.aip_current;
grant select on public.notam_assurance_state to authenticated;

create or replace view public.operator_effective_danger_areas with (security_invoker=true) as
select p.user_id,p.can_change_status,d.id,d.code,d.name,d.lower_limit,d.upper_limit,d.promulgated_period,d.authority,d.airspace_when_inactive,
 d.current_status as declared_status,case when d.status_valid_until is not null and d.status_valid_until>now() then d.current_status else 'UNVERIFIED' end as effective_status,
 d.status_updated_at,d.status_valid_until,coalesce(periods.starts_at,d.reporting_window_start_at) as reporting_window_start_at,
 coalesce(periods.ends_at,d.reporting_window_end_at) as reporting_window_end_at,
 coalesce(periods.starts_at,d.reporting_window_start_at) is not null and coalesce(periods.ends_at,d.reporting_window_end_at) is not null and now()>=coalesce(periods.starts_at,d.reporting_window_start_at) and now()<coalesce(periods.ends_at,d.reporting_window_end_at) as reporting_window_open,
 d.pre_activation_lead_minutes,coalesce(periods.starts_at,d.reporting_window_start_at) is not null and now()>=coalesce(periods.starts_at,d.reporting_window_start_at)-make_interval(mins=>d.pre_activation_lead_minutes) and now()<coalesce(periods.starts_at,d.reporting_window_start_at) as pre_activation_window_open,
 d.scheduled_activation_at,d.scheduled_activation_by,d.scheduled_activation_created_at,d.scheduled_activation_note,d.scheduled_activation_at is not null as activation_scheduled,d.scheduled_activation_period_id,
 periods.id as operational_period_id,periods.reference as operational_period_reference,periods.source as operational_period_source,periods.period_status as operational_period_status,
 ns.has_live_notam,ns.notam_number,ns.notam_valid_from,ns.notam_valid_until,ns.feed_state as notam_feed_state,ns.visibility_mode as notam_visibility_mode
from public.operator_permissions p join public.danger_areas d on d.id=p.danger_area_id
left join lateral(select op.id,op.starts_at,op.ends_at,op.reference,op.source,op.period_status from public.operational_periods op where op.danger_area_id=d.id and op.period_status='PLANNED' and op.ends_at>now() order by case when now()>=op.starts_at and now()<op.ends_at then 0 else 1 end,op.starts_at limit 1) periods on true
left join public.notam_assurance_state ns on ns.danger_area_id=d.id
where d.aip_current;

create or replace function private.set_danger_area_status_guarded(p_danger_area_id uuid,p_new_status text,p_note text,p_notam_override boolean,p_override_reason text,p_confirmed_designator text)
returns public.danger_areas language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_area public.danger_areas;v_previous text;v_valid_until timestamptz;v_window_start timestamptz;v_window_end timestamptz;v_period_id uuid;v_has_notam boolean;v_feed_state text;
begin
 if v_user is null then raise exception 'Authentication required'; end if;
 if not private.operator_account_active(v_user) then raise exception 'Operator account inactive'; end if;
 if p_new_status not in ('ACTIVE','INACTIVE','UNVERIFIED') then raise exception 'Invalid status'; end if;
 if not exists(select 1 from public.operator_permissions p where p.user_id=v_user and p.danger_area_id=p_danger_area_id and p.can_change_status=true) then raise exception 'Not authorised for this danger area'; end if;
 select * into v_area from public.danger_areas d where d.id=p_danger_area_id for update;if not found then raise exception 'Danger area not found';end if;
 if p_new_status='ACTIVE' then
   select coalesce(ns.has_live_notam,false),coalesce(ns.feed_state,'UNINITIALISED') into v_has_notam,v_feed_state from public.notam_assurance_state ns where ns.danger_area_id=p_danger_area_id;
   if not coalesce(v_has_notam,false) then
     if not coalesce(p_notam_override,false) then raise exception 'NOTAM_OVERRIDE_REQUIRED: No live matched NOTAM is held for %',v_area.code;end if;
     if upper(trim(coalesce(p_confirmed_designator,'')))<>upper(v_area.code) then raise exception 'NOTAM_OVERRIDE_DESIGNATOR_MISMATCH';end if;
     if char_length(trim(coalesce(p_override_reason,'')))<10 then raise exception 'NOTAM_OVERRIDE_REASON_REQUIRED';end if;
     insert into public.notam_activation_overrides(danger_area_id,operator_user_id,reason,confirmed_designator,feed_state_at_override) values(v_area.id,v_user,trim(p_override_reason),upper(trim(p_confirmed_designator)),v_feed_state);
     p_note:=concat_ws(' | ',nullif(trim(p_note),''),'NO VERIFIED NOTAM OVERRIDE: '||trim(p_override_reason));
   end if;
 end if;
 v_previous:=case when v_area.status_valid_until is not null and v_area.status_valid_until>now() then v_area.current_status else 'UNVERIFIED' end;
 select op.id,op.starts_at,op.ends_at into v_period_id,v_window_start,v_window_end from public.operational_periods op where op.danger_area_id=p_danger_area_id and op.period_status='PLANNED' and now()>=op.starts_at and now()<op.ends_at order by op.starts_at limit 1;
 if v_period_id is null then v_window_start:=v_area.reporting_window_start_at;v_window_end:=v_area.reporting_window_end_at;end if;
 if p_new_status<>'UNVERIFIED' then if v_window_start is null or v_window_end is null then raise exception 'Reporting window unavailable';end if;if now()<v_window_start or now()>=v_window_end then raise exception 'Reporting window is closed';end if;v_valid_until:=v_window_end;else v_valid_until:=null;end if;
 update public.danger_areas set current_status=p_new_status,status_updated_at=now(),status_updated_by=v_user,status_valid_until=v_valid_until where id=p_danger_area_id returning * into v_area;
 insert into public.status_events(danger_area_id,previous_status,new_status,changed_by,note,valid_until,event_source,operational_period_id) values(p_danger_area_id,v_previous,p_new_status,v_user,nullif(trim(p_note),''),v_valid_until,'OPERATOR',v_period_id);
 return v_area;
end;$function$;
revoke all on function private.set_danger_area_status_guarded(uuid,text,text,boolean,text,text) from public,anon,authenticated;

create or replace function public.request_danger_area_status_change_v2(p_danger_area_id uuid,p_new_status text,p_note text default null,p_notam_override boolean default false,p_override_reason text default null,p_confirmed_designator text default null)
returns public.danger_areas language sql security invoker set search_path='' as $$select private.set_danger_area_status_guarded(p_danger_area_id,p_new_status,p_note,p_notam_override,p_override_reason,p_confirmed_designator)$$;
revoke all on function public.request_danger_area_status_change_v2(uuid,text,text,boolean,text,text) from public,anon;
grant execute on function public.request_danger_area_status_change_v2(uuid,text,text,boolean,text,text) to authenticated;

create or replace function public.request_danger_area_status_change(p_danger_area_id uuid,p_new_status text,p_note text default null)
returns public.danger_areas language sql security invoker set search_path='' as $$select private.set_danger_area_status_guarded(p_danger_area_id,p_new_status,p_note,false,null,null)$$;
revoke all on function public.request_danger_area_status_change(uuid,text,text) from public,anon;
grant execute on function public.request_danger_area_status_change(uuid,text,text) to authenticated;

create or replace function public.get_public_operational_picture_v3()
returns table(id uuid,code text,name text,lower_limit text,upper_limit text,promulgated_period text,authority text,airspace_when_inactive text,geometry jsonb,declared_status text,effective_status text,status_updated_at timestamptz,status_valid_until timestamptz,validity_state text,operational_period_id uuid,operational_period_phase text,operational_period_starts_at timestamptz,operational_period_ends_at timestamptz,operational_period_reference text,operational_period_source text,has_live_notam boolean,notam_number text,notam_valid_from timestamptz,notam_valid_until timestamptz,notam_feed_state text,notam_visibility_mode text,visibility_reason text)
language sql stable security definer set search_path='' as $function$
select d.id,d.code,d.name,d.lower_limit,d.upper_limit,d.promulgated_period,d.authority,d.airspace_when_inactive,d.geometry,d.current_status,
 case when d.status_valid_until is not null and d.status_valid_until>now() then d.current_status else 'UNVERIFIED' end,d.status_updated_at,d.status_valid_until,
 case when d.status_valid_until is null then 'NO_VALIDITY' when d.status_valid_until<=now() then 'EXPIRED' else 'CURRENT' end,
 p.id,case when p.id is null then null when p.starts_at<=now() and p.ends_at>now() then 'CURRENT' else 'UPCOMING' end,p.starts_at,p.ends_at,p.reference,p.source,
 ns.has_live_notam,ns.notam_number,ns.notam_valid_from,ns.notam_valid_until,ns.feed_state,ns.visibility_mode,
 case when ns.has_live_notam then 'LIVE_NOTAM' when d.current_status='ACTIVE' and d.status_valid_until>now() then 'ACTIVE_OVERRIDE' when ns.visibility_mode='MONITOR' then 'MONITOR_MODE' else 'FEED_FAIL_SAFE' end
from public.danger_areas d
left join lateral(select op.id,op.starts_at,op.ends_at,op.reference,op.source from public.operational_periods op where op.danger_area_id=d.id and op.period_status='PLANNED' and op.ends_at>now() order by case when op.starts_at<=now() then 0 else 1 end,op.starts_at limit 1)p on true
join public.notam_assurance_state ns on ns.danger_area_id=d.id
where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3
 and (ns.visibility_mode='MONITOR' or ns.feed_state<>'CURRENT' or ns.has_live_notam or (d.current_status='ACTIVE' and d.status_valid_until>now()))
order by d.code;
$function$;
revoke all on function public.get_public_operational_picture_v3() from public,authenticated;
grant execute on function public.get_public_operational_picture_v3() to anon,authenticated;

notify pgrst,'reload schema';
