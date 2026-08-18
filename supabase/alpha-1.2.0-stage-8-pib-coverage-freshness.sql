-- UK DASS Alpha 1.2.0, Stage 8: make manual PIB freshness follow its coverage period

create or replace view public.notam_assurance_state with (security_invoker=true) as
select d.id as danger_area_id,d.code,(current_n.id is not null) as has_live_notam,
 published_n.notam_number,published_n.valid_from as notam_valid_from,published_n.valid_until as notam_valid_until,
 case
  when s.last_sync_status='UNINITIALISED' then 'UNINITIALISED'
  when s.last_sync_status in ('FAILED','PARTIAL') then s.last_sync_status
  when s.last_successful_sync_at is null then 'UNINITIALISED'
  when s.source_name='NATS PIB manual import' and latest_pib.coverage_end is not null
   then case when latest_pib.coverage_end<=now() then 'STALE' else 'CURRENT' end
  when s.last_successful_sync_at<now()-make_interval(mins=>s.freshness_minutes) then 'STALE'
  else 'CURRENT'
 end as feed_state,
 s.visibility_mode,s.last_successful_sync_at,s.source_name,
 (published_n.id is not null) as has_published_notam,
 case when current_n.id is not null then 'CURRENT' when published_n.id is not null then 'UPCOMING' else 'NONE' end as notam_phase
from public.danger_areas d cross join public.notam_system_state s
left join lateral(
 select r.coverage_end
 from public.notam_sync_runs r
 where r.source_name='NATS_PIB' and r.sync_status='SUCCESS' and r.published_at is not null
 order by r.published_at desc,r.started_at desc
 limit 1
) latest_pib on true
left join lateral(select x.id from public.danger_area_notams x where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE' and x.valid_from<=now() and (x.valid_until is null or x.valid_until>now()) order by x.valid_from desc limit 1) current_n on true
left join lateral(select x.id,x.notam_number,x.valid_from,x.valid_until from public.danger_area_notams x where x.danger_area_id=d.id and x.match_status='MATCHED' and x.lifecycle_status='ACTIVE' and (x.valid_until is null or x.valid_until>now()) order by case when x.valid_from<=now() then 0 else 1 end,x.valid_from limit 1) published_n on true
where d.aip_current;

create or replace function public.admin_notam_enforcement_readiness()
returns jsonb language plpgsql security definer set search_path='' stable as $function$
declare v_user uuid:=auth.uid();v_state public.notam_system_state;v_run public.notam_sync_runs;v_review int:=0;v_total int:=0;v_show int:=0;v_reasons jsonb:='[]'::jsonb;v_feed text;v_ready boolean;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_state from public.notam_system_state where singleton;
 select * into v_run from public.notam_sync_runs where source_name='NATS_PIB' order by started_at desc limit 1;
 if v_run.id is not null then select count(*) into v_review from public.notam_import_items where import_run_id=v_run.id and event_kind='ACTIVATION' and schedule_status='REVIEW_REQUIRED';end if;
 v_feed:=case
  when v_state.last_sync_status<>'SUCCESS' then v_state.last_sync_status
  when v_state.last_successful_sync_at is null then 'UNINITIALISED'
  when v_state.source_name='NATS PIB manual import' and v_run.sync_status='SUCCESS' and v_run.coverage_end is not null
   then case when v_run.coverage_end<=now() then 'STALE' else 'CURRENT' end
  when v_state.last_successful_sync_at<now()-make_interval(mins=>v_state.freshness_minutes) then 'STALE'
  else 'CURRENT'
 end;
 if v_run.id is null then v_reasons:=v_reasons||'"No NATS PIB has been imported"'::jsonb;
 elsif v_run.sync_status<>'SUCCESS' then v_reasons:=v_reasons||to_jsonb('Latest PIB result is '||v_run.sync_status);
 end if;
 if v_run.id is not null and v_run.unmatched_count<>0 then v_reasons:=v_reasons||to_jsonb(v_run.unmatched_count||' activation record(s) remain unmatched');end if;
 if v_review<>0 then v_reasons:=v_reasons||to_jsonb(v_review||' schedule review item(s) remain unresolved');end if;
 if v_run.id is not null and v_run.coverage_end<=now() then v_reasons:=v_reasons||'"Latest PIB coverage has expired"'::jsonb;end if;
 if v_feed<>'CURRENT' then v_reasons:=v_reasons||to_jsonb('Effective feed state is '||v_feed);end if;
 select count(*) into v_total from public.danger_areas d where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3;
 select count(*) into v_show from public.danger_areas d join public.notam_assurance_state n on n.danger_area_id=d.id where d.aip_current and jsonb_typeof(d.geometry)='array' and jsonb_array_length(d.geometry)>=3 and (n.has_published_notam or (d.current_status='ACTIVE' and d.status_valid_until>now()));
 v_ready:=jsonb_array_length(v_reasons)=0;
 return jsonb_build_object('ready',v_ready,'reasons',v_reasons,'configured_mode',v_state.visibility_mode,'effective_feed_state',v_feed,'fail_safe_active',v_state.visibility_mode='ENFORCED' and v_feed<>'CURRENT','latest_report_reference',v_run.report_reference,'coverage_end',v_run.coverage_end,'matched_records',coalesce(v_run.matched_count,0),'unmatched_records',coalesce(v_run.unmatched_count,0),'review_required',v_review,'total_map_areas',v_total,'would_show',v_show,'would_hide',greatest(v_total-v_show,0));
end;$function$;

revoke all on function public.admin_notam_enforcement_readiness() from public,anon;
grant execute on function public.admin_notam_enforcement_readiness() to authenticated;

notify pgrst,'reload schema';
