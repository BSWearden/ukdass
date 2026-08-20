-- DASS Alpha 1.4.1
-- Live map: show current NOTAM activity, not merely published/upcoming NOTAMs.
-- Future NOTAMs remain available through get_public_operational_picture_at(...).

create or replace function public.get_public_operational_picture_v4()
returns table(
  id uuid,
  code text,
  name text,
  lower_limit text,
  upper_limit text,
  promulgated_period text,
  authority text,
  airspace_when_inactive text,
  geometry jsonb,
  declared_status text,
  effective_status text,
  status_updated_at timestamptz,
  status_valid_until timestamptz,
  validity_state text,
  operational_period_id uuid,
  operational_period_phase text,
  operational_period_starts_at timestamptz,
  operational_period_ends_at timestamptz,
  operational_period_reference text,
  operational_period_source text,
  has_live_notam boolean,
  has_published_notam boolean,
  notam_number text,
  notam_valid_from timestamptz,
  notam_valid_until timestamptz,
  notam_phase text,
  notam_feed_state text,
  notam_visibility_mode text,
  visibility_reason text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select
    d.id,
    d.code,
    d.name,
    coalesce(ns.notam_lower_limit, d.lower_limit),
    coalesce(ns.notam_upper_limit, d.upper_limit),
    d.promulgated_period,
    d.authority,
    d.airspace_when_inactive,
    d.geometry,
    d.current_status,
    case
      when d.status_valid_until is not null and d.status_valid_until > now()
        then d.current_status
      else 'UNVERIFIED'
    end,
    d.status_updated_at,
    d.status_valid_until,
    case
      when d.status_valid_until is null then 'NO_VALIDITY'
      when d.status_valid_until <= now() then 'EXPIRED'
      else 'CURRENT'
    end,
    p.id,
    case
      when p.id is null then null
      when p.starts_at <= now() and p.ends_at > now() then 'CURRENT'
      else 'UPCOMING'
    end,
    p.starts_at,
    p.ends_at,
    p.reference,
    p.source,
    ns.has_live_notam,
    ns.has_published_notam,
    ns.notam_number,
    ns.notam_valid_from,
    ns.notam_valid_until,
    ns.notam_phase,
    ns.feed_state,
    ns.visibility_mode,
    case
      when ns.has_live_notam then 'CURRENT_NOTAM'
      when ns.has_published_notam then 'UPCOMING_NOTAM'
      when d.current_status = 'ACTIVE' and d.status_valid_until > now() then 'ACTIVE_OVERRIDE'
      when ns.visibility_mode = 'MONITOR' then 'MONITOR_MODE'
      else 'FEED_FAIL_SAFE'
    end
  from public.danger_areas d
  left join lateral (
    select op.id, op.starts_at, op.ends_at, op.reference, op.source
    from public.operational_periods op
    where op.danger_area_id = d.id
      and op.period_status = 'PLANNED'
      and op.ends_at > now()
    order by
      case when op.starts_at <= now() then 0 else 1 end,
      op.starts_at
    limit 1
  ) p on true
  join public.notam_assurance_state ns on ns.danger_area_id = d.id
  where d.aip_current
    and jsonb_typeof(d.geometry) = 'array'
    and jsonb_array_length(d.geometry) >= 3
    and (
      ns.visibility_mode = 'MONITOR'
      or ns.feed_state <> 'CURRENT'
      or ns.has_live_notam
      or (d.current_status = 'ACTIVE' and d.status_valid_until > now())
    )
  order by d.code;
$function$;

-- Verification: EGD201J must not be returned before M5721/26 becomes current.
select
  code,
  effective_status,
  notam_phase,
  notam_valid_from,
  notam_valid_until,
  visibility_reason
from public.get_public_operational_picture_v4()
where code = 'EGD201J';
