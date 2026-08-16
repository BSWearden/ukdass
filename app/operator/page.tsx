import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { logout } from './actions'
import StatusControls from './components/StatusControls'

type Status = 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED'

type PermissionRow = {
  can_change_status: boolean
  danger_areas: {
    id: string
    code: string
    name: string
    lower_limit: string
    upper_limit: string
    promulgated_period: string
    authority: string
    airspace_when_inactive: string
    current_status: Status
    status_updated_at: string | null
    status_valid_until: string | null
  } | null
}

type StatusEvent = {
  id: number
  previous_status: string
  new_status: string
  changed_at: string
  note: string | null
  valid_until: string | null
  danger_areas: { code: string } | null
}

function effectiveStatus(declared: Status, validUntil: string | null): Status {
  if (!validUntil) return 'UNVERIFIED'
  if (new Date(validUntil).getTime() <= Date.now()) return 'UNVERIFIED'
  return declared
}

function statusStyle(status: string) {
  if (status === 'ACTIVE') return {color:'#ff828b',border:'1px solid rgba(255,90,100,.35)',background:'rgba(255,90,100,.14)'}
  if (status === 'INACTIVE') return {color:'#7be3a9',border:'1px solid rgba(79,209,139,.32)',background:'rgba(79,209,139,.13)'}
  return {color:'#ffd07d',border:'1px solid rgba(255,186,74,.34)',background:'rgba(255,186,74,.13)'}
}

function formatUtc(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).format(new Date(value)) + ' UTC'
}

export default async function OperatorPage() {
  const supabase = await createClient()
  const {data:claimsData} = await supabase.auth.getClaims()
  const claims = claimsData?.claims
  if (!claims?.sub) redirect('/operator/login')

  const {data:profile,error:profileError} = await supabase
    .from('operator_profiles')
    .select('display_name, account_status, organisations(name)')
    .eq('user_id', claims.sub)
    .maybeSingle()

  if (profileError) throw new Error('Unable to load operator profile.')

  if (!profile || profile.account_status !== 'ACTIVE') {
    return (
      <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'32px'}}>
        <div style={{maxWidth:'760px',margin:'0 auto'}}>
          <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Alpha 0.3.1</div>
          <h1>Operator access unavailable</h1>
          <p style={{color:'#91a6b8'}}>Your identity is authenticated, but there is no active DASS operator profile assigned to this account.</p>
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </main>
    )
  }

  const {data:permissionData,error:permissionError} = await supabase
    .from('operator_permissions')
    .select(`
      can_change_status,
      danger_areas (
        id,code,name,lower_limit,upper_limit,promulgated_period,
        authority,airspace_when_inactive,current_status,status_updated_at,status_valid_until
      )
    `)
    .eq('user_id', claims.sub)
    .order('created_at',{ascending:true})

  if (permissionError) throw new Error('Unable to load assigned Danger Areas.')

  const permissions = (permissionData ?? []) as unknown as PermissionRow[]
  const assigned = permissions.filter(row => row.danger_areas)

  const {data:eventData} = await supabase
    .from('status_events')
    .select(`id,previous_status,new_status,changed_at,note,valid_until,danger_areas(code)`)
    .order('changed_at',{ascending:false})
    .limit(8)

  const events = (eventData ?? []) as unknown as StatusEvent[]

  return (
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'24px'}}>
      <div style={{maxWidth:'1120px',margin:'0 auto'}}>
        <div className="operator-dashboard-header" style={{display:'flex',justifyContent:'space-between',gap:'18px',alignItems:'center',borderBottom:'1px solid #203243',paddingBottom:'18px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Alpha 0.3.1 · Status validity</div>
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

        <section style={{marginTop:'22px',borderLeft:'3px solid #ffba4a',background:'rgba(255,186,74,.06)',padding:'12px 14px',color:'#d7c79f',fontSize:'12px',lineHeight:1.55,borderRadius:'0 9px 9px 0'}}>
          <strong>Status validity protection:</strong> ACTIVE and INACTIVE declarations are trusted only until the stored validity deadline. Once expired, DASS presents the area as UNVERIFIED. This does not cancel or amend the promulgated NOTAM.
        </section>

        <div style={{marginTop:'22px'}}>
          <div style={{fontSize:'11px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800}}>Authorised airspace</div>
          <h2 style={{margin:'5px 0 0',fontSize:'22px'}}>{assigned.length} assigned {assigned.length===1?'area':'areas'}</h2>
        </div>

        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:'16px',marginTop:'18px'}}>
          {assigned.map(permission => {
            const area = permission.danger_areas!
            const effective = effectiveStatus(area.current_status, area.status_valid_until)
            const badge = statusStyle(effective)

            return (
              <article key={area.id} style={{background:'linear-gradient(180deg,#0b1722,#08131c)',border:'1px solid #203243',borderRadius:'14px',padding:'20px',boxShadow:'0 16px 40px rgba(0,0,0,.20)'}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'flex-start'}}>
                  <div>
                    <div style={{color:'#8fdaf0',fontWeight:850,letterSpacing:'.06em',fontSize:'17px'}}>{area.code}</div>
                    <h3 style={{margin:'5px 0 0',fontSize:'20px'}}>{area.name}</h3>
                  </div>
                  <span style={{...badge,padding:'6px 9px',borderRadius:'999px',fontSize:'11px',fontWeight:900,letterSpacing:'.08em'}}>{effective}</span>
                </div>

                <div style={{marginTop:'18px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'9px'}}>
                  <DataItem label="Promulgated period" value={area.promulgated_period}/>
                  <DataItem label="Vertical limits" value={`${area.lower_limit} – ${area.upper_limit}`}/>
                  <DataItem label="Stored declaration" value={area.current_status}/>
                  <DataItem label="Valid until" value={area.status_valid_until ? formatUtc(area.status_valid_until) : 'No current validity'}/>
                </div>

                <div style={{marginTop:'15px',borderTop:'1px solid #203243',paddingTop:'13px'}}>
                  <div style={{fontSize:'10px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800}}>Last operator declaration</div>
                  <div style={{marginTop:'5px',fontSize:'13px',color:'#c8d7e2'}}>{formatUtc(area.status_updated_at)}</div>
                  {effective === 'UNVERIFIED' && area.current_status !== 'UNVERIFIED' && (
                    <div style={{marginTop:'7px',color:'#ffd07d',fontSize:'11px',lineHeight:1.45}}>
                      Previous {area.current_status} declaration is no longer within a valid reporting period.
                    </div>
                  )}
                </div>

                <StatusControls areaId={area.id} code={area.code} currentStatus={effective} canChangeStatus={permission.can_change_status}/>
              </article>
            )
          })}
        </div>

        <section style={{marginTop:'24px',background:'#0b1722',border:'1px solid #203243',borderRadius:'14px',padding:'20px'}}>
          <div style={{fontSize:'11px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:800}}>Audit trail</div>
          <h2 style={{margin:'5px 0 14px',fontSize:'20px'}}>Recent status events</h2>
          {events.length === 0 ? (
            <p style={{color:'#91a6b8',fontSize:'13px',marginBottom:0}}>No status events have been recorded for your assigned Danger Areas yet.</p>
          ) : (
            <div style={{display:'grid',gap:'8px'}}>
              {events.map(event => (
                <div key={event.id} style={{border:'1px solid #203746',background:'#091720',borderRadius:'9px',padding:'11px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}>
                    <strong style={{fontSize:'13px'}}>{event.danger_areas?.code ?? 'Danger Area'} · {event.previous_status} → {event.new_status}</strong>
                    <span style={{color:'#7892a4',fontSize:'11px'}}>{formatUtc(event.changed_at)}</span>
                  </div>
                  <div style={{marginTop:'5px',color:'#7892a4',fontSize:'11px'}}>Valid until: {event.valid_until ? formatUtc(event.valid_until) : 'No validity / UNVERIFIED'}</div>
                  {event.note && <div style={{marginTop:'6px',color:'#91a6b8',fontSize:'11px'}}>{event.note}</div>}
                </div>
              ))}
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
