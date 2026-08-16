import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { logout } from './actions'
import StatusControls from './components/StatusControls'

type Status = 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED'

type AssignedArea = {
  user_id: string
  can_change_status: boolean
  id: string
  code: string
  name: string
  lower_limit: string
  upper_limit: string
  promulgated_period: string
  authority: string
  airspace_when_inactive: string
  declared_status: Status
  effective_status: Status
  status_updated_at: string | null
  status_valid_until: string | null
  reporting_window_start_at: string | null
  reporting_window_end_at: string | null
  reporting_window_open: boolean
  pre_activation_lead_minutes: number
  pre_activation_window_open: boolean
  scheduled_activation_at: string | null
  scheduled_activation_created_at: string | null
  scheduled_activation_note: string | null
  activation_scheduled: boolean
}

type StatusEvent = {
  id: number
  previous_status: string | null
  new_status: string | null
  changed_at: string
  note: string | null
  valid_until: string | null
  event_source: 'OPERATOR' | 'SYSTEM'
  event_type:
    | 'STATUS_CHANGE'
    | 'ACTIVATION_SCHEDULED'
    | 'ACTIVATION_CANCELLED'
    | 'SCHEDULED_ACTIVATION_EFFECTIVE'
    | 'SCHEDULED_ACTIVATION_EXPIRED'
  effective_at: string | null
  danger_areas: { code: string } | null
}

function statusStyle(status: string) {
  if (status === 'ACTIVE') return { color:'#ff828b', border:'1px solid rgba(255,90,100,.35)', background:'rgba(255,90,100,.14)' }
  if (status === 'INACTIVE') return { color:'#7be3a9', border:'1px solid rgba(79,209,139,.32)', background:'rgba(79,209,139,.13)' }
  return { color:'#ffd07d', border:'1px solid rgba(255,186,74,.34)', background:'rgba(255,186,74,.13)' }
}

function formatUtc(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC', day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).format(new Date(value)) + ' UTC'
}

function eventTitle(event: StatusEvent) {
  if (event.event_type === 'ACTIVATION_SCHEDULED') return 'Activation scheduled'
  if (event.event_type === 'ACTIVATION_CANCELLED') return 'Scheduled activation cancelled'
  if (event.event_type === 'SCHEDULED_ACTIVATION_EFFECTIVE') return `${event.previous_status ?? 'UNVERIFIED'} → ACTIVE`
  if (event.event_type === 'SCHEDULED_ACTIVATION_EXPIRED') return 'Scheduled activation expired'
  return `${event.previous_status ?? '—'} → ${event.new_status ?? '—'}`
}

export default async function OperatorPage() {
  const supabase = await createClient()

  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims?.sub) redirect('/operator/login')

  const { data: profile, error: profileError } = await supabase
    .from('operator_profiles')
    .select('display_name, account_status, organisations(name)')
    .eq('user_id', claims.sub)
    .maybeSingle()

  if (profileError) throw new Error('Unable to load operator profile.')

  if (!profile || profile.account_status !== 'ACTIVE') {
    return (
      <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'32px'}}>
        <div style={{maxWidth:'760px',margin:'0 auto'}}>
          <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Alpha 0.3.4</div>
          <h1>Operator access unavailable</h1>
          <p style={{color:'#91a6b8'}}>Your identity is authenticated, but there is no active DASS operator profile assigned to this account.</p>
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </main>
    )
  }

  const { data: assignedData, error: assignedError } = await supabase
    .from('operator_effective_danger_areas')
    .select(`
      user_id,can_change_status,id,code,name,lower_limit,upper_limit,
      promulgated_period,authority,airspace_when_inactive,declared_status,
      effective_status,status_updated_at,status_valid_until,
      reporting_window_start_at,reporting_window_end_at,reporting_window_open,
      pre_activation_lead_minutes,pre_activation_window_open,
      scheduled_activation_at,scheduled_activation_created_at,
      scheduled_activation_note,activation_scheduled
    `)
    .eq('user_id', claims.sub)
    .order('code', { ascending: true })

  if (assignedError) throw new Error('Unable to load assigned Danger Areas.')

  const assigned = (assignedData ?? []) as AssignedArea[]

  const { data: eventData, error: eventError } = await supabase
    .from('status_events')
    .select(`
      id,previous_status,new_status,changed_at,note,valid_until,
      event_source,event_type,effective_at,danger_areas(code)
    `)
    .order('changed_at', { ascending: false })
    .limit(12)

  if (eventError) throw new Error('Unable to load status audit history.')

  const events = (eventData ?? []) as unknown as StatusEvent[]

  return (
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'24px'}}>
      <div style={{maxWidth:'1120px',margin:'0 auto'}}>
        <div className="operator-dashboard-header" style={{display:'flex',justifyContent:'space-between',gap:'18px',alignItems:'center',borderBottom:'1px solid #203243',paddingBottom:'18px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Alpha 0.3.4 · Pre-planned activation</div>
            <h1 style={{margin:'5px 0 4px',fontSize:'30px'}}>My Danger Areas</h1>
            <div style={{color:'#91a6b8',fontSize:'13px'}}>
              {profile.display_name} · {(profile.organisations as {name?:string}|null)?.name ?? 'No organisation'}
            </div>
          </div>

          <div className="operator-dashboard-actions" style={{display:'flex',gap:'9px'}}>
            <a href="/" style={{textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}}>Live map</a>
            <form action={logout}><button type="submit" style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px'}}>Sign out</button></form>
          </div>
        </div>

        <section style={{marginTop:'22px',borderLeft:'3px solid #59d0f0',background:'rgba(89,208,240,.05)',padding:'12px 14px',color:'#b9dce7',fontSize:'12px',lineHeight:1.55,borderRadius:'0 9px 9px 0'}}>
          <strong>Pre-planned activation:</strong> operators may schedule an ACTIVE declaration during the configured lead period before the reporting window opens. Scheduling records future intent only; the public DASS status does not become ACTIVE until the effective time. Scheduled stand-down is not supported.
        </section>

        <div style={{marginTop:'22px'}}>
          <div style={{fontSize:'11px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800}}>Authorised airspace</div>
          <h2 style={{margin:'5px 0 0',fontSize:'22px'}}>{assigned.length} assigned {assigned.length===1?'area':'areas'}</h2>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:'16px',marginTop:'18px'}}>
          {assigned.map(area => {
            const badge = statusStyle(area.effective_status)

            return (
              <article key={area.id} style={{background:'linear-gradient(180deg,#0b1722,#08131c)',border:'1px solid #203243',borderRadius:'14px',padding:'20px',boxShadow:'0 16px 40px rgba(0,0,0,.20)'}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'flex-start'}}>
                  <div>
                    <div style={{color:'#8fdaf0',fontWeight:850,letterSpacing:'.06em',fontSize:'17px'}}>{area.code}</div>
                    <h3 style={{margin:'5px 0 0',fontSize:'20px'}}>{area.name}</h3>
                  </div>
                  <span style={{...badge,padding:'6px 9px',borderRadius:'999px',fontSize:'11px',fontWeight:900,letterSpacing:'.08em'}}>{area.effective_status}</span>
                </div>

                <div style={{marginTop:'18px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'9px'}}>
                  <DataItem label="Promulgated display" value={area.promulgated_period}/>
                  <DataItem label="Reporting window" value={area.reporting_window_open ? 'OPEN' : 'CLOSED'}/>
                  <DataItem label="Window opens" value={formatUtc(area.reporting_window_start_at)}/>
                  <DataItem label="Window closes" value={formatUtc(area.reporting_window_end_at)}/>
                  <DataItem label="Pre-activation lead" value={`${area.pre_activation_lead_minutes} minutes`}/>
                  <DataItem label="Pre-activation" value={area.pre_activation_window_open ? 'OPEN' : 'CLOSED'}/>
                </div>

                {area.activation_scheduled && (
                  <div style={{
                    marginTop:'13px',
                    border:'1px solid rgba(89,208,240,.28)',
                    background:'rgba(89,208,240,.045)',
                    borderRadius:'9px',
                    padding:'11px'
                  }}>
                    <div style={{fontSize:'9px',color:'#8fdaf0',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>Pending operator intent</div>
                    <div style={{marginTop:'5px',fontSize:'13px',color:'#d6e8ef',fontWeight:750}}>Activation scheduled for {formatUtc(area.scheduled_activation_at)}</div>
                    <div style={{marginTop:'4px',fontSize:'10px',color:'#708b9a'}}>Scheduled at {formatUtc(area.scheduled_activation_created_at)}</div>
                  </div>
                )}

                <div style={{marginTop:'15px',borderTop:'1px solid #203243',paddingTop:'13px'}}>
                  <div style={{fontSize:'10px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800}}>Last effective status update</div>
                  <div style={{marginTop:'5px',fontSize:'13px',color:'#c8d7e2'}}>{formatUtc(area.status_updated_at)}</div>
                </div>

                <StatusControls
                  areaId={area.id}
                  code={area.code}
                  currentStatus={area.effective_status}
                  canChangeStatus={area.can_change_status}
                  reportingWindowOpen={area.reporting_window_open}
                  reportingWindowLabel={
                    area.reporting_window_start_at && area.reporting_window_end_at
                      ? `${formatUtc(area.reporting_window_start_at)} – ${formatUtc(area.reporting_window_end_at)}`
                      : 'Unavailable'
                  }
                  preActivationWindowOpen={area.pre_activation_window_open}
                  preActivationLeadMinutes={area.pre_activation_lead_minutes}
                  activationScheduled={area.activation_scheduled}
                  scheduledActivationAt={area.scheduled_activation_at ?? area.reporting_window_start_at}
                />
              </article>
            )
          })}
        </div>

        <section style={{marginTop:'24px',background:'#0b1722',border:'1px solid #203243',borderRadius:'14px',padding:'20px'}}>
          <div style={{fontSize:'11px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800}}>Audit trail</div>
          <h2 style={{margin:'5px 0 14px',fontSize:'20px'}}>Recent status and scheduling events</h2>

          {events.length === 0 ? (
            <p style={{color:'#91a6b8',fontSize:'13px',marginBottom:0}}>No events have been recorded for your assigned Danger Areas yet.</p>
          ) : (
            <div style={{display:'grid',gap:'8px'}}>
              {events.map(event => {
                const isSystem = event.event_source === 'SYSTEM'
                const schedulingEvent = event.event_type !== 'STATUS_CHANGE'
                return (
                  <div key={event.id} style={{
                    border:isSystem ? '1px solid rgba(255,186,74,.35)' : schedulingEvent ? '1px solid rgba(89,208,240,.30)' : '1px solid #203746',
                    background:isSystem ? 'rgba(255,186,74,.045)' : schedulingEvent ? 'rgba(89,208,240,.035)' : '#091720',
                    borderRadius:'9px',
                    padding:'11px'
                  }}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                      <strong style={{fontSize:'13px'}}>{event.danger_areas?.code ?? 'Danger Area'} · {eventTitle(event)}</strong>
                      <span style={{fontSize:'10px',fontWeight:850,letterSpacing:'.08em',color:isSystem ? '#ffd07d' : '#8fdaf0'}}>
                        {isSystem ? 'DASS SYSTEM' : 'OPERATOR'}
                      </span>
                    </div>

                    <div style={{marginTop:'5px',color:'#7892a4',fontSize:'11px'}}>Event time: {formatUtc(event.changed_at)}</div>
                    {event.effective_at && (
                      <div style={{marginTop:'3px',color:'#7892a4',fontSize:'11px'}}>Effective time: {formatUtc(event.effective_at)}</div>
                    )}
                    {event.valid_until && (
                      <div style={{marginTop:'3px',color:'#7892a4',fontSize:'11px'}}>Valid until: {formatUtc(event.valid_until)}</div>
                    )}
                    {event.note && (
                      <div style={{marginTop:'6px',color:isSystem ? '#d7c79f' : '#91a6b8',fontSize:'11px'}}>{event.note}</div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <footer style={{marginTop:'24px',paddingTop:'16px',borderTop:'1px solid #203243',color:'#607888',fontSize:'11px',lineHeight:1.5}}>
          DASS Alpha is a demonstration system and is not approved for operational use or flight planning.
        </footer>
      </div>
    </main>
  )
}

function DataItem({label,value}:{label:string,value:string}) {
  return (
    <div style={{border:'1px solid #203746',borderRadius:'9px',padding:'10px',background:'#0a1822'}}>
      <div style={{color:'#7892a4',fontSize:'9px',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800,marginBottom:'5px'}}>{label}</div>
      <strong style={{fontSize:'13px'}}>{value}</strong>
    </div>
  )
}
