-- UK DASS Alpha 1.2.0, Stage 4: explicit validity for declarations outside a reporting window

create or replace function private.set_danger_area_status_guarded_v3(p_danger_area_id uuid,p_new_status text,p_note text,p_notam_override boolean,p_override_reason text,p_confirmed_designator text,p_declaration_valid_until timestamptz)
returns public.danger_areas language plpgsql security definer set search_path='' as $function$
declare v_user uuid:=auth.uid();v_area public.danger_areas;v_previous text;v_valid_until timestamptz;v_window_start timestamptz;v_window_end timestamptz;v_period_id uuid;v_has_notam boolean;v_feed_state text;v_outside_window boolean;
begin
 if v_user is null then raise exception 'Authentication required';end if;
 if not private.operator_account_active(v_user) then raise exception 'Operator account inactive';end if;
 if p_new_status not in ('ACTIVE','INACTIVE') then raise exception 'Invalid status';end if;
 if not exists(select 1 from public.operator_permissions p where p.user_id=v_user and p.danger_area_id=p_danger_area_id and p.can_change_status=true) then raise exception 'Not authorised for this danger area';end if;
 select * into v_area from public.danger_areas d where d.id=p_danger_area_id for update;if not found then raise exception 'Danger area not found';end if;
 select op.id,op.starts_at,op.ends_at into v_period_id,v_window_start,v_window_end from public.operational_periods op where op.danger_area_id=p_danger_area_id and op.period_status='PLANNED' and now()>=op.starts_at and now()<op.ends_at order by op.starts_at limit 1;
 if v_period_id is null then v_window_start:=v_area.reporting_window_start_at;v_window_end:=v_area.reporting_window_end_at;end if;
 v_outside_window:=v_window_start is null or v_window_end is null or now()<v_window_start or now()>=v_window_end;
 if v_outside_window then
   if p_declaration_valid_until is null or p_declaration_valid_until<=now() then raise exception 'DECLARATION_VALIDITY_REQUIRED';end if;
   if p_declaration_valid_until>now()+interval '24 hours' then raise exception 'DECLARATION_VALIDITY_TOO_LONG';end if;
   v_valid_until:=p_declaration_valid_until;
   p_note:=concat_ws(' | ',nullif(trim(p_note),''),'OUTSIDE REPORTING WINDOW DECLARATION');
 else v_valid_until:=v_window_end;end if;
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
 update public.danger_areas set current_status=p_new_status,status_updated_at=now(),status_updated_by=v_user,status_valid_until=v_valid_until where id=p_danger_area_id returning * into v_area;
 insert into public.status_events(danger_area_id,previous_status,new_status,changed_by,note,valid_until,event_source,operational_period_id) values(p_danger_area_id,v_previous,p_new_status,v_user,nullif(trim(p_note),''),v_valid_until,'OPERATOR',v_period_id);
 return v_area;
end;$function$;

revoke all on function private.set_danger_area_status_guarded_v3(uuid,text,text,boolean,text,text,timestamptz) from public,anon,authenticated;

create or replace function public.request_danger_area_status_change_v3(p_danger_area_id uuid,p_new_status text,p_note text default null,p_notam_override boolean default false,p_override_reason text default null,p_confirmed_designator text default null,p_declaration_valid_until timestamptz default null)
returns public.danger_areas language sql set search_path='' as $function$
select private.set_danger_area_status_guarded_v3(p_danger_area_id,p_new_status,p_note,p_notam_override,p_override_reason,p_confirmed_designator,p_declaration_valid_until)
$function$;
revoke all on function public.request_danger_area_status_change_v3(uuid,text,text,boolean,text,text,timestamptz) from public,anon;
grant execute on function public.request_danger_area_status_change_v3(uuid,text,text,boolean,text,text,timestamptz) to authenticated;
notify pgrst,'reload schema';
