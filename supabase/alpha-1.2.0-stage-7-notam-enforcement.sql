-- UK DASS Alpha 1.2.0, Stage 7: guarded NOTAM visibility enforcement

create or replace function public.admin_notam_enforcement_readiness()
returns jsonb language plpgsql security definer set search_path='' stable as $function$
declare v_user uuid:=auth.uid();v_state public.notam_system_state;v_run public.notam_sync_runs;v_review int:=0;v_total int:=0;v_show int:=0;v_reasons jsonb:='[]'::jsonb;v_feed text;v_ready boolean;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_state from public.notam_system_state where singleton;
 select * into v_run from public.notam_sync_runs where source_name='NATS_PIB' order by started_at desc limit 1;
 if v_run.id is not null then select count(*) into v_review from public.notam_import_items where import_run_id=v_run.id and event_kind='ACTIVATION' and schedule_status='REVIEW_REQUIRED';end if;
 v_feed:=case when v_state.last_sync_status<>'SUCCESS' then v_state.last_sync_status when v_state.last_successful_sync_at is null then 'UNINITIALISED' when v_state.last_successful_sync_at<now()-make_interval(mins=>v_state.freshness_minutes) then 'STALE' else 'CURRENT' end;
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

create or replace function public.admin_set_notam_visibility_mode(p_mode text,p_confirmation text)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_readiness jsonb;v_previous text;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 if p_mode not in('MONITOR','ENFORCED') then raise exception 'Invalid visibility mode';end if;
 if p_mode='ENFORCED' and trim(coalesce(p_confirmation,''))<>'ENABLE NOTAM ENFORCEMENT' then raise exception 'ENFORCEMENT_CONFIRMATION_REQUIRED';end if;
 if p_mode='MONITOR' and trim(coalesce(p_confirmation,''))<>'DISABLE NOTAM ENFORCEMENT' then raise exception 'MONITOR_CONFIRMATION_REQUIRED';end if;
 v_readiness:=public.admin_notam_enforcement_readiness();
 if p_mode='ENFORCED' and not coalesce((v_readiness->>'ready')::boolean,false) then raise exception 'ENFORCEMENT_NOT_READY';end if;
 select visibility_mode into v_previous from public.notam_system_state where singleton for update;
 update public.notam_system_state set visibility_mode=p_mode,updated_at=now() where singleton;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,case when p_mode='ENFORCED' then 'NOTAM_ENFORCEMENT_ENABLED' else 'NOTAM_ENFORCEMENT_DISABLED' end,'Changed NOTAM visibility mode from '||v_previous||' to '||p_mode,jsonb_build_object('previous_mode',v_previous,'new_mode',p_mode,'readiness_snapshot',v_readiness));
 return public.admin_notam_enforcement_readiness();
end;$function$;
revoke all on function public.admin_set_notam_visibility_mode(text,text) from public,anon;
grant execute on function public.admin_set_notam_visibility_mode(text,text) to authenticated;
notify pgrst,'reload schema';
