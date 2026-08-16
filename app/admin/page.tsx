import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { adminLogout } from './actions'

type OperatorProfile = {
  user_id: string
  display_name: string
  organisation_id: string | null
  account_status: string
  created_at: string
  updated_at: string
}

type Organisation = {
  id: string
  name: string
}

type OperatorPermission = {
  user_id: string
  danger_area_id: string
  can_change_status: boolean
  created_at: string
}

type DangerArea = {
  id: string
  code: string
  name: string
  current_status: string
  status_updated_at: string | null
  status_valid_until: string | null
  reporting_window_start_at: string | null
  reporting_window_end_at: string | null
  scheduled_activation_at: string | null
  organisation_id: string | null
}

type StatusEvent = {
  id: number
  danger_area_id: string
  previous_status: string | null
  new_status: string | null
  changed_by: string | null
  changed_at: string
  note: string | null
  event_source: string
  event_type: string
}

type Notification = {
  id: string
  danger_area_id: string
  user_id: string
  notification_type: string
  status: string
  attempts: number
  sent_at: string | null
  seen_at: string | null
  acknowledged_at: string | null
  created_at: string
}

type AdminAudit = {
  id: number
  admin_user_id: string
  action_type: string
  target_user_id: string | null
  danger_area_id: string | null
  summary: string
  created_at: string
}

function utc(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value)) + ' UTC'
}

function badge(status: string) {
  if (status === 'ACTIVE' || status === 'SENT' || status === 'ACKNOWLEDGED') {
    return { color:'#84e8b0', background:'rgba(79,209,139,.10)', border:'rgba(79,209,139,.34)' }
  }
  if (status === 'UNVERIFIED' || status === 'FAILED' || status === 'SUSPENDED') {
    return { color:'#ff9299', background:'rgba(255,90,100,.10)', border:'rgba(255,90,100,.34)' }
  }
  return { color:'#fbbf24', background:'rgba(217,119,6,.10)', border:'rgba(245,158,11,.34)' }
}

export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const supabase = await createClient()

  const { data: userData, error: userError } = await supabase.auth.getUser()
  if (userError || !userData.user) redirect('/admin/login')

  const { data: adminProfile, error: adminError } = await supabase
    .from('admin_profiles')
    .select('user_id,display_name,admin_role,account_status')
    .eq('user_id', userData.user.id)
    .maybeSingle()

  if (adminError) throw new Error('Unable to verify DASS administrator permissions.')

  if (!adminProfile || adminProfile.account_status !== 'ACTIVE') {
    return (
      <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'32px'}}>
        <div style={{maxWidth:'760px',margin:'0 auto'}}>
          <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Alpha 0.5.0</div>
          <h1>Administrative access unavailable</h1>
          <p style={{color:'#91a6b8',lineHeight:1.6}}>
            Your identity is authenticated, but this account does not hold an active DASS administrator profile.
          </p>
          <div style={{display:'flex',gap:'10px',flexWrap:'wrap'}}>
            <a href="/operator" style={{textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px'}}>Operator interface</a>
            <form action={adminLogout}>
              <button type="submit" style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px'}}>Sign out</button>
            </form>
          </div>
        </div>
      </main>
    )
  }

  const [
    operatorResult,
    organisationResult,
    permissionResult,
    areaResult,
    eventResult,
    notificationResult,
    auditResult,
  ] = await Promise.all([
    supabase.from('operator_profiles')
      .select('user_id,display_name,organisation_id,account_status,created_at,updated_at')
      .order('display_name', { ascending:true }),
    supabase.from('organisations')
      .select('id,name')
      .order('name', { ascending:true }),
    supabase.from('operator_permissions')
      .select('user_id,danger_area_id,can_change_status,created_at'),
    supabase.from('danger_areas')
      .select('id,code,name,current_status,status_updated_at,status_valid_until,reporting_window_start_at,reporting_window_end_at,scheduled_activation_at,organisation_id')
      .order('code', { ascending:true }),
    supabase.from('status_events')
      .select('id,danger_area_id,previous_status,new_status,changed_by,changed_at,note,event_source,event_type')
      .order('changed_at', { ascending:false })
      .limit(30),
    supabase.from('operational_notifications')
      .select('id,danger_area_id,user_id,notification_type,status,attempts,sent_at,seen_at,acknowledged_at,created_at')
      .order('created_at', { ascending:false })
      .limit(30),
    supabase.from('admin_audit_log')
      .select('id,admin_user_id,action_type,target_user_id,danger_area_id,summary,created_at')
      .order('created_at', { ascending:false })
      .limit(30),
  ])

  const errors = [
    operatorResult.error,
    organisationResult.error,
    permissionResult.error,
    areaResult.error,
    eventResult.error,
    notificationResult.error,
    auditResult.error,
  ].filter(Boolean)

  if (errors.length) throw new Error('Unable to load one or more DASS administration datasets.')

  const operators = (operatorResult.data ?? []) as OperatorProfile[]
  const organisations = (organisationResult.data ?? []) as Organisation[]
  const permissions = (permissionResult.data ?? []) as OperatorPermission[]
  const areas = (areaResult.data ?? []) as DangerArea[]
  const events = (eventResult.data ?? []) as StatusEvent[]
  const notifications = (notificationResult.data ?? []) as Notification[]
  const audits = (auditResult.data ?? []) as AdminAudit[]

  const organisationById = new Map(organisations.map(o => [o.id, o]))
  const areaById = new Map(areas.map(a => [a.id, a]))
  const operatorById = new Map(operators.map(o => [o.user_id, o]))

  const activeOperators = operators.filter(o => o.account_status === 'ACTIVE').length
  const activeAreas = areas.filter(a => a.current_status === 'ACTIVE').length
  const unverifiedAreas = areas.filter(a => a.current_status === 'UNVERIFIED').length
  const failedNotifications = notifications.filter(n => n.status === 'FAILED').length
  const unacknowledgedNotifications = notifications.filter(n => n.status === 'SENT' && !n.acknowledged_at).length

  return (
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(14px,3vw,26px)'}}>
      <div style={{maxWidth:'1280px',margin:'0 auto'}}>
        <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px',flexWrap:'wrap',paddingBottom:'18px',borderBottom:'1px solid #203243'}}>
          <div>
            <div style={{fontSize:'10px',letterSpacing:'.16em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>DASS Alpha 0.5.0 · Administration & Oversight</div>
            <h1 style={{margin:'5px 0 4px',fontSize:'clamp(25px,5vw,32px)'}}>Administrator Dashboard</h1>
            <div style={{fontSize:'13px',color:'#91a6b8'}}>{adminProfile.display_name} · {adminProfile.admin_role}</div>
          </div>
          <div style={{display:'flex',gap:'9px',flexWrap:'wrap'}}>
            <a href="/operator" style={{textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}}>Operator interface</a>
            <a href="/" style={{textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}}>Live map</a>
            <form action={adminLogout}>
              <button type="submit" style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',height:'100%'}}>Sign out</button>
            </form>
          </div>
        </header>

        <section style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'10px'}}>
          <Summary label="Operators" value={String(operators.length)} accent="#d7e5ed"/>
          <Summary label="Active operators" value={String(activeOperators)} accent="#84e8b0"/>
          <Summary label="Danger Areas" value={String(areas.length)} accent="#d7e5ed"/>
          <Summary label="Currently active" value={String(activeAreas)} accent={activeAreas ? '#ff9299' : '#84e8b0'}/>
          <Summary label="Unverified" value={String(unverifiedAreas)} accent={unverifiedAreas ? '#fbbf24' : '#84e8b0'}/>
          <Summary label="Unack. alerts" value={String(unacknowledgedNotifications)} accent={unacknowledgedNotifications ? '#fbbf24' : '#84e8b0'}/>
          <Summary label="Failed email" value={String(failedNotifications)} accent={failedNotifications ? '#ff9299' : '#84e8b0'}/>
        </section>

        <section style={{marginTop:'20px',border:'1px solid rgba(89,208,240,.24)',background:'rgba(89,208,240,.045)',borderRadius:'12px',padding:'14px 16px'}}>
          <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>ALPHA 0.5.0 CONTROL BOUNDARY</div>
          <div style={{marginTop:'5px',fontSize:'12px',lineHeight:1.55,color:'#b9cbd5'}}>
            This interface is read-only. Administrators can oversee operator access, assignments, system events and notification state, but cannot ACTIVATE, STAND DOWN or schedule a Danger Area from the admin interface.
          </div>
        </section>

        <section style={{marginTop:'24px'}}>
          <SectionHeading eyebrow="Access governance" title="Range Operators"/>
          <div style={{display:'grid',gap:'10px'}}>
            {operators.length === 0 ? (
              <Empty text="No operator profiles exist."/>
            ) : operators.map(operator => {
              const operatorPermissions = permissions.filter(p => p.user_id === operator.user_id)
              const org = operator.organisation_id ? organisationById.get(operator.organisation_id) : null
              const style = badge(operator.account_status)
              return (
                <article key={operator.user_id} style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',padding:'15px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:'12px',flexWrap:'wrap'}}>
                    <div>
                      <strong style={{fontSize:'14px'}}>{operator.display_name}</strong>
                      <div style={{marginTop:'4px',fontSize:'11px',color:'#849bab'}}>{org?.name ?? 'No organisation assigned'}</div>
                    </div>
                    <span style={{fontSize:'9px',fontWeight:900,letterSpacing:'.08em',padding:'5px 8px',borderRadius:'999px',color:style.color,background:style.background,border:`1px solid ${style.border}`}}>
                      {operator.account_status}
                    </span>
                  </div>

                  <div style={{marginTop:'12px',display:'flex',gap:'7px',flexWrap:'wrap'}}>
                    {operatorPermissions.length === 0 ? (
                      <span style={{fontSize:'10px',color:'#ffb0b5'}}>No Danger Area permissions assigned</span>
                    ) : operatorPermissions.map(permission => {
                      const area = areaById.get(permission.danger_area_id)
                      return (
                        <span key={permission.danger_area_id} style={{fontSize:'10px',border:'1px solid #2c4858',background:'#091720',borderRadius:'7px',padding:'6px 8px',color:'#bcd1dc'}}>
                          {area?.code ?? 'Unknown DA'} · {permission.can_change_status ? 'STATUS CONTROL' : 'READ ONLY'}
                        </span>
                      )
                    })}
                  </div>
                  <div style={{marginTop:'10px',fontSize:'9px',color:'#607888'}}>Profile updated {utc(operator.updated_at)}</div>
                </article>
              )
            })}
          </div>
        </section>

        <section style={{marginTop:'26px'}}>
          <SectionHeading eyebrow="Operational oversight" title="Danger Area State"/>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'10px'}}>
            {areas.map(area => {
              const style = badge(area.current_status)
              return (
                <article key={area.id} style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',padding:'15px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'10px'}}>
                    <div><strong style={{color:'#8fdaf0'}}>{area.code}</strong><div style={{marginTop:'3px',fontSize:'11px',color:'#91a6b8'}}>{area.name}</div></div>
                    <span style={{fontSize:'9px',fontWeight:900,padding:'5px 8px',borderRadius:'999px',color:style.color,background:style.background,border:`1px solid ${style.border}`}}>{area.current_status}</span>
                  </div>
                  <div style={{marginTop:'12px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'7px'}}>
                    <Data label="Last status update" value={utc(area.status_updated_at)}/>
                    <Data label="Valid until" value={utc(area.status_valid_until)}/>
                    <Data label="Window opens" value={utc(area.reporting_window_start_at)}/>
                    <Data label="Window closes" value={utc(area.reporting_window_end_at)}/>
                    <Data label="Scheduled activation" value={utc(area.scheduled_activation_at)}/>
                    <Data label="Organisation" value={area.organisation_id ? organisationById.get(area.organisation_id)?.name ?? 'Unknown' : '—'}/>
                  </div>
                </article>
              )
            })}
          </div>
        </section>

        <section style={{marginTop:'26px'}}>
          <SectionHeading eyebrow="System activity" title="Recent Status Events"/>
          <div style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',overflow:'hidden'}}>
            {events.length === 0 ? <Empty text="No status events recorded."/> : events.map((event, index) => {
              const area = areaById.get(event.danger_area_id)
              const operator = event.changed_by ? operatorById.get(event.changed_by) : null
              return (
                <div key={event.id} style={{padding:'11px 13px',borderTop:index ? '1px solid #182b38' : 0}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}>
                    <strong style={{fontSize:'11px'}}>{area?.code ?? 'Unknown DA'} · {event.event_type}</strong>
                    <span style={{fontSize:'9px',color:event.event_source === 'SYSTEM' ? '#fbbf24' : '#8fdaf0',fontWeight:900}}>{event.event_source}</span>
                  </div>
                  <div style={{marginTop:'4px',fontSize:'10px',color:'#91a6b8'}}>
                    {event.previous_status ?? '—'} → {event.new_status ?? '—'} · {utc(event.changed_at)}
                  </div>
                  <div style={{marginTop:'3px',fontSize:'9px',color:'#607888'}}>
                    Actor: {operator?.display_name ?? (event.event_source === 'SYSTEM' ? 'DASS system' : event.changed_by ?? 'Unknown')}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section style={{marginTop:'26px'}}>
          <SectionHeading eyebrow="Notification assurance" title="Recent Operational Notifications"/>
          <div style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',overflow:'hidden'}}>
            {notifications.length === 0 ? <Empty text="No operational notifications recorded."/> : notifications.map((notification, index) => {
              const area = areaById.get(notification.danger_area_id)
              const operator = operatorById.get(notification.user_id)
              const state = notification.acknowledged_at ? 'ACKNOWLEDGED' : notification.seen_at ? 'SEEN' : notification.status
              const style = badge(state)
              return (
                <div key={notification.id} style={{padding:'11px 13px',borderTop:index ? '1px solid #182b38' : 0}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}>
                    <strong style={{fontSize:'11px'}}>{area?.code ?? 'Unknown DA'} · {notification.notification_type}</strong>
                    <span style={{fontSize:'9px',fontWeight:900,color:style.color}}>{state}</span>
                  </div>
                  <div style={{marginTop:'4px',fontSize:'10px',color:'#91a6b8'}}>
                    {operator?.display_name ?? 'Unknown operator'} · Attempts {notification.attempts} · Created {utc(notification.created_at)}
                  </div>
                  <div style={{marginTop:'3px',fontSize:'9px',color:'#607888'}}>
                    Sent {utc(notification.sent_at)} · Seen {utc(notification.seen_at)} · Acknowledged {utc(notification.acknowledged_at)}
                  </div>
                </div>
              )
            })}
          </div>
        </section>

        <section style={{marginTop:'26px'}}>
          <SectionHeading eyebrow="Administrative accountability" title="Admin Audit Log"/>
          <div style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',overflow:'hidden'}}>
            {audits.length === 0 ? (
              <div style={{padding:'15px',fontSize:'11px',lineHeight:1.5,color:'#91a6b8'}}>
                No administrative write actions have occurred. This is expected in Alpha 0.5.0 because the interface is intentionally read-only. Account issuance in 0.5.1 will write to this log.
              </div>
            ) : audits.map((audit, index) => (
              <div key={audit.id} style={{padding:'11px 13px',borderTop:index ? '1px solid #182b38' : 0}}>
                <strong style={{fontSize:'11px'}}>{audit.action_type}</strong>
                <div style={{marginTop:'4px',fontSize:'10px',color:'#91a6b8'}}>{audit.summary}</div>
                <div style={{marginTop:'3px',fontSize:'9px',color:'#607888'}}>{utc(audit.created_at)}</div>
              </div>
            ))}
          </div>
        </section>

        <section style={{marginTop:'26px',border:'1px dashed #345062',background:'#091720',borderRadius:'13px',padding:'16px'}}>
          <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>NEXT: ALPHA 0.5.1</div>
          <h2 style={{margin:'5px 0 6px',fontSize:'17px'}}>Operator Account Administration</h2>
          <p style={{margin:0,fontSize:'11px',lineHeight:1.55,color:'#91a6b8'}}>
            Create range operators, issue temporary credentials, assign organisations and Danger Areas, suspend/reactivate access, reset credentials, and record every administrative action. These controls are deliberately absent from Alpha 0.5.0.
          </p>
        </section>

        <footer style={{marginTop:'20px',paddingTop:'14px',borderTop:'1px solid #203243',fontSize:'9px',lineHeight:1.5,color:'#607888'}}>
          DASS Alpha 0.5.0 is a demonstration administration interface. Administrative oversight does not confer authority to declare an operational Danger Area state.
        </footer>
      </div>
    </main>
  )
}

function Summary({label,value,accent}:{label:string,value:string,accent:string}) {
  return (
    <div style={{border:'1px solid #203746',background:'#0a1822',borderRadius:'11px',padding:'11px 12px'}}>
      <div style={{fontSize:'8px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>{label}</div>
      <div style={{marginTop:'5px',fontSize:'17px',fontWeight:900,color:accent}}>{value}</div>
    </div>
  )
}

function Data({label,value}:{label:string,value:string}) {
  return (
    <div style={{border:'1px solid #1d3341',background:'#091720',borderRadius:'8px',padding:'9px'}}>
      <div style={{fontSize:'8px',color:'#708998',textTransform:'uppercase',letterSpacing:'.11em',fontWeight:850}}>{label}</div>
      <div style={{marginTop:'4px',fontSize:'10px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div>
    </div>
  )
}

function SectionHeading({eyebrow,title}:{eyebrow:string,title:string}) {
  return (
    <div style={{marginBottom:'10px'}}>
      <div style={{fontSize:'9px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.13em',fontWeight:850}}>{eyebrow}</div>
      <h2 style={{margin:'4px 0 0',fontSize:'19px'}}>{title}</h2>
    </div>
  )
}

function Empty({text}:{text:string}) {
  return <div style={{padding:'15px',fontSize:'11px',color:'#91a6b8'}}>{text}</div>
}
