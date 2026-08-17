-- UK DASS Alpha 1.2.0, Stage 3: controlled resolution of PIB schedules requiring review

alter table public.notam_import_items
  add column if not exists resolved_by uuid references auth.users(id) on delete restrict,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolution_note text;

create or replace function public.admin_resolve_notam_import_item(
  p_item_id uuid,
  p_valid_from timestamptz,
  p_valid_until timestamptz,
  p_resolution_note text
)
returns void language plpgsql security definer set search_path='' as $function$
declare
  v_user uuid:=auth.uid();
  v_item public.notam_import_items;
  v_run public.notam_sync_runs;
begin
  if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then
    raise exception 'Active administrator required';
  end if;
  if char_length(trim(coalesce(p_resolution_note,'')))<10 then raise exception 'Resolution justification required';end if;
  if p_valid_from is null or p_valid_until is null or p_valid_until<=p_valid_from then raise exception 'Invalid resolution interval';end if;
  select * into v_item from public.notam_import_items i where i.id=p_item_id for update;
  if not found then raise exception 'PIB review item not found';end if;
  select * into v_run from public.notam_sync_runs r where r.id=v_item.import_run_id for update;
  if v_run.sync_status not in ('STARTED','PARTIAL') then raise exception 'PIB import is not reviewable';end if;
  if v_run.coverage_end<=now() then raise exception 'PIB coverage has expired';end if;
  if v_item.event_kind<>'ACTIVATION' or v_item.schedule_status<>'REVIEW_REQUIRED' then raise exception 'Item does not require schedule review';end if;
  if v_item.match_status<>'MATCHED' or v_item.danger_area_id is null then raise exception 'Danger Area match must be resolved first';end if;
  if p_valid_from<v_run.coverage_start or p_valid_until>v_run.coverage_end then raise exception 'Resolution must remain within PIB coverage';end if;
  update public.notam_import_items set valid_from=p_valid_from,valid_until=p_valid_until,schedule_status='RESOLVED',included=true,resolution_note=left(trim(p_resolution_note),500),resolved_by=v_user,resolved_at=now(),review_note='Manually resolved from '||coalesce(v_item.review_note,'unsupported schedule') where id=p_item_id;
  insert into public.admin_audit_log(admin_user_id,action_type,danger_area_id,summary,metadata)
  values(v_user,'NOTAM_PIB_SCHEDULE_RESOLVED',v_item.danger_area_id,'Resolved '||coalesce(v_item.designator,'Danger Area')||' schedule for NOTAM '||v_item.notam_number,jsonb_build_object('import_run_id',v_item.import_run_id,'item_id',v_item.id,'notam_number',v_item.notam_number,'designator',v_item.designator,'valid_from',p_valid_from,'valid_until',p_valid_until,'justification',left(trim(p_resolution_note),500),'original_review_note',v_item.review_note));
end;$function$;
revoke all on function public.admin_resolve_notam_import_item(uuid,timestamptz,timestamptz,text) from public,anon;
grant execute on function public.admin_resolve_notam_import_item(uuid,timestamptz,timestamptz,text) to authenticated;

create or replace function public.admin_publish_notam_pib(p_import_run_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_run public.notam_sync_runs;v_count int;v_unresolved int;v_review int;v_result text;
begin
 if v_user is null or not exists(select 1 from public.admin_profiles a where a.user_id=v_user and a.account_status='ACTIVE') then raise exception 'Active administrator required';end if;
 select * into v_run from public.notam_sync_runs r where r.id=p_import_run_id for update;if not found then raise exception 'PIB import not found';end if;
 if v_run.source_name<>'NATS_PIB' or v_run.sync_status not in ('STARTED','PARTIAL') then raise exception 'PIB import is not awaiting publication';end if;
 if v_run.coverage_end<=now() then raise exception 'PIB coverage has expired';end if;
 select count(*) into v_review from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.schedule_status='REVIEW_REQUIRED';
 if v_review>0 then raise exception 'PIB_REVIEW_REQUIRED';end if;
 select count(*) into v_unresolved from public.notam_import_items i where i.import_run_id=p_import_run_id and i.event_kind='ACTIVATION' and i.match_status<>'MATCHED';
 delete from public.danger_area_notams where source_name='NATS_PIB';
 insert into public.danger_area_notams(notam_number,danger_area_id,matched_designator,valid_from,valid_until,lifecycle_status,match_status,match_method,match_confidence,q_code,raw_text,source_name,sync_run_id)
 select i.notam_number,i.danger_area_id,i.designator,i.valid_from,i.valid_until,'ACTIVE','MATCHED',case when i.resolved_at is null then 'NATS_PIB_QCODE_DESIGNATOR' else 'NATS_PIB_ADMIN_SCHEDULE_RESOLUTION' end,1.0,i.q_code,i.raw_text,'NATS_PIB',p_import_run_id
 from public.notam_import_items i where i.import_run_id=p_import_run_id and i.included and i.event_kind='ACTIVATION' and i.match_status='MATCHED' and i.schedule_status='RESOLVED';
 get diagnostics v_count=row_count;
 v_result:=case when v_unresolved>0 then 'PARTIAL' else 'SUCCESS' end;
 update public.notam_sync_runs set sync_status=v_result,completed_at=now(),published_at=now(),published_by=v_user,matched_count=v_count,unmatched_count=v_unresolved where id=p_import_run_id;
 update public.notam_system_state set source_name='NATS PIB manual import',last_attempt_at=now(),last_successful_sync_at=case when v_result='SUCCESS' then now() else last_successful_sync_at end,last_sync_status=v_result,updated_at=now() where singleton;
 insert into public.admin_audit_log(admin_user_id,action_type,summary,metadata) values(v_user,'NOTAM_PIB_PUBLISHED','Published NATS PIB '||coalesce(v_run.report_reference,'unknown'),jsonb_build_object('import_run_id',p_import_run_id,'published_records',v_count,'unresolved_records',v_unresolved,'result',v_result,'coverage_end',v_run.coverage_end,'republication',v_run.sync_status='PARTIAL'));
end;$function$;
revoke all on function public.admin_publish_notam_pib(uuid) from public,anon;
grant execute on function public.admin_publish_notam_pib(uuid) to authenticated;

notify pgrst,'reload schema';
