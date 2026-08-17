import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { adminLogout } from './actions'
import AdminOperatorControls from './components/AdminOperatorControls'
import ExceptionEnginePreview from './components/ExceptionEnginePreview'
import OperationalPeriodsPreview from '../components/OperationalPeriodsPreview'

type OperatorProfile={user_id:string;display_name:string;organisation_id:string|null;account_status:string;must_change_password:boolean;created_at:string;updated_at:string;suspension_reason:string|null;suspended_at:string|null;reactivated_at:string|null;credentials_issued_at:string|null;password_reset_at:string|null}
type Organisation={id:string;name:string}
type OperatorPermission={user_id:string;danger_area_id:string;can_change_status:boolean;created_at:string}
type DangerArea={id:string;code:string;name:string;current_status:string;status_updated_at:string|null;status_valid_until:string|null;reporting_window_start_at:string|null;reporting_window_end_at:string|null;scheduled_activation_at:string|null;organisation_id:string|null}
type StatusEvent={id:number;danger_area_id:string;previous_status:string|null;new_status:string|null;changed_by:string|null;changed_at:string;note:string|null;event_source:string;event_type:string}
type Notification={id:string;danger_area_id:string;user_id:string;notification_type:string;status:string;attempts:number;sent_at:string|null;seen_at:string|null;acknowledged_at:string|null;created_at:string}
type AdminAudit={id:number;admin_user_id:string;action_type:string;target_user_id:string|null;danger_area_id:string|null;summary:string;metadata:Record<string,unknown>;created_at:string}

function utc(value:string|null){if(!value)return'—';return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))+' UTC'}
function badge(status:string){if(status==='ACTIVE'||status==='SENT'||status==='ACKNOWLEDGED')return{color:'#84e8b0',background:'rgba(79,209,139,.10)',border:'rgba(79,209,139,.34)'};if(status==='UNVERIFIED'||status==='FAILED'||status==='SUSPENDED')return{color:'#ff9299',background:'rgba(255,90,100,.10)',border:'rgba(255,90,100,.34)'};return{color:'#fbbf24',background:'rgba(217,119,6,.10)',border:'rgba(245,158,11,.34)'}}
export const dynamic='force-dynamic'

export default async function AdminPage(){
  const supabase=await createClient()
  const {data:userData,error:userError}=await supabase.auth.getUser()
  if(userError||!userData.user)redirect('/admin/login')
  const {data:adminProfile,error:adminError}=await supabase.from('admin_profiles').select('user_id,display_name,admin_role,account_status').eq('user_id',userData.user.id).maybeSingle()
  if(adminError)throw new Error('Unable to verify DASS administrator permissions.')
  if(!adminProfile||adminProfile.account_status!=='ACTIVE')return <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'32px'}}><div style={{maxWidth:'760px',margin:'0 auto'}}><h1>Administrative access unavailable</h1><p style={{color:'#91a6b8'}}>This account does not hold an active DASS administrator profile.</p><form action={adminLogout}><button type="submit">Sign out</button></form></div></main>

  const [operatorResult,organisationResult,permissionResult,areaResult,eventResult,notificationResult,auditResult]=await Promise.all([
    supabase.from('operator_profiles').select('user_id,display_name,organisation_id,account_status,must_change_password,created_at,updated_at,suspension_reason,suspended_at,reactivated_at,credentials_issued_at,password_reset_at').order('display_name',{ascending:true}),
    supabase.from('organisations').select('id,name').order('name',{ascending:true}),
    supabase.from('operator_permissions').select('user_id,danger_area_id,can_change_status,created_at'),
    supabase.from('danger_areas').select('id,code,name,current_status,status_updated_at,status_valid_until,reporting_window_start_at,reporting_window_end_at,scheduled_activation_at,organisation_id').order('code',{ascending:true}),
    supabase.from('status_events').select('id,danger_area_id,previous_status,new_status,changed_by,changed_at,note,event_source,event_type').order('changed_at',{ascending:false}).limit(100),
    supabase.from('operational_notifications').select('id,danger_area_id,user_id,notification_type,status,attempts,sent_at,seen_at,acknowledged_at,created_at').order('created_at',{ascending:false}).limit(30),
    supabase.from('admin_audit_log').select('id,admin_user_id,action_type,target_user_id,danger_area_id,summary,metadata,created_at').order('created_at',{ascending:false}).limit(100),
  ])
  if([operatorResult.error,organisationResult.error,permissionResult.error,areaResult.error,eventResult.error,notificationResult.error,auditResult.error].some(Boolean))throw new Error('Unable to load one or more DASS administration datasets.')

  const operators=(operatorResult.data??[]) as OperatorProfile[]
  const organisations=(organisationResult.data??[]) as Organisation[]
  const permissions=(permissionResult.data??[]) as OperatorPermission[]
  const areas=(areaResult.data??[]) as DangerArea[]
  const events=(eventResult.data??[]) as StatusEvent[]
  const notifications=(notificationResult.data??[]) as Notification[]
  const audits=(auditResult.data??[]) as AdminAudit[]
  const areaMap=new Map(areas.map(a=>[a.id,a]))
  const operatorMap=new Map(operators.map(o=>[o.user_id,o]))
  const orgMap=new Map(organisations.map(o=>[o.id,o]))

  const enhancedOperators=operators.map(o=>({...o,last_operational_activity:events.find(e=>e.changed_by===o.user_id)?.changed_at??null}))
  const activeOperators=operators.filter(o=>o.account_status==='ACTIVE').length
  const activeAreas=areas.filter(a=>a.current_status==='ACTIVE').length
  const unverifiedAreas=areas.filter(a=>a.current_status==='UNVERIFIED').length
  const failedNotifications=notifications.filter(n=>n.status==='FAILED').length
  const unack=notifications.filter(n=>n.status==='SENT'&&!n.acknowledged_at).length

  return <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(14px,3vw,26px)'}}><div style={{maxWidth:'1280px',margin:'0 auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px',flexWrap:'wrap',paddingBottom:'18px',borderBottom:'1px solid #203243'}}>
      <div><div style={{fontSize:'10px',letterSpacing:'.16em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>DASS Alpha 0.5.2 · Governance & Account Assurance</div><h1 style={{margin:'5px 0 4px',fontSize:'clamp(25px,5vw,32px)'}}>Administrator Dashboard</h1><div style={{fontSize:'13px',color:'#91a6b8'}}>{adminProfile.display_name} · {adminProfile.admin_role}</div></div>
      <div style={{display:'flex',gap:'9px',flexWrap:'wrap'}}><a href="/operator" style={nav}>Operator interface</a><a href="/" style={nav}>Live map</a><form action={adminLogout}><button type="submit" style={{...nav,height:'100%'}}>Sign out</button></form></div>
    </header>

    <section style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'10px'}}>
      <Summary label="Operators" value={String(operators.length)} accent="#d7e5ed"/><Summary label="Active operators" value={String(activeOperators)} accent="#84e8b0"/><Summary label="Danger Areas" value={String(areas.length)} accent="#d7e5ed"/><Summary label="Currently active" value={String(activeAreas)} accent={activeAreas?'#ff9299':'#84e8b0'}/><Summary label="Unverified" value={String(unverifiedAreas)} accent={unverifiedAreas?'#fbbf24':'#84e8b0'}/><Summary label="Unack. alerts" value={String(unack)} accent={unack?'#fbbf24':'#84e8b0'}/><Summary label="Failed email" value={String(failedNotifications)} accent={failedNotifications?'#ff9299':'#84e8b0'}/>
    </section>

    <OperationalPeriodsPreview mode="admin"/>

    <AdminOperatorControls organisations={organisations} areas={areas.map(a=>({id:a.id,code:a.code,name:a.name}))} operators={enhancedOperators} permissions={permissions} audits={audits}/>

    <ExceptionEnginePreview/>

    <section style={{marginTop:'26px'}}><Heading eyebrow="Operational oversight" title="Danger Area State"/><div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'10px'}}>{areas.map(a=>{const s=badge(a.current_status);return <article key={a.id} style={card}><div style={{display:'flex',justifyContent:'space-between',gap:'10px'}}><div><strong style={{color:'#8fdaf0'}}>{a.code}</strong><div style={{marginTop:'3px',fontSize:'11px',color:'#91a6b8'}}>{a.name}</div></div><span style={{fontSize:'9px',fontWeight:900,padding:'5px 8px',borderRadius:'999px',color:s.color,background:s.background,border:`1px solid ${s.border}`}}>{a.current_status}</span></div><div style={{marginTop:'12px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'7px'}}><Data label="Last status update" value={utc(a.status_updated_at)}/><Data label="Valid until" value={utc(a.status_valid_until)}/><Data label="Window opens" value={utc(a.reporting_window_start_at)}/><Data label="Window closes" value={utc(a.reporting_window_end_at)}/><Data label="Scheduled activation" value={utc(a.scheduled_activation_at)}/><Data label="Organisation" value={a.organisation_id?orgMap.get(a.organisation_id)?.name??'Unknown':'—'}/></div></article>})}</div></section>

    <section style={{marginTop:'26px'}}><Heading eyebrow="System activity" title="Recent Status Events"/><div style={listBox}>{events.slice(0,30).map((e,i)=><div key={e.id} style={{padding:'11px 13px',borderTop:i?'1px solid #182b38':0}}><div style={{display:'flex',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}><strong style={{fontSize:'11px'}}>{areaMap.get(e.danger_area_id)?.code??'Unknown DA'} · {e.event_type}</strong><span style={{fontSize:'9px',color:e.event_source==='SYSTEM'?'#fbbf24':'#8fdaf0',fontWeight:900}}>{e.event_source}</span></div><div style={{marginTop:'4px',fontSize:'10px',color:'#91a6b8'}}>{e.previous_status??'—'} → {e.new_status??'—'} · {utc(e.changed_at)}</div><div style={{marginTop:'3px',fontSize:'9px',color:'#607888'}}>Actor: {e.changed_by?operatorMap.get(e.changed_by)?.display_name??e.changed_by:'DASS system'}</div></div>)}</div></section>

    <section style={{marginTop:'26px'}}><Heading eyebrow="Administrative accountability" title="Admin Audit Log"/><div style={listBox}>{audits.length===0?<Empty text="No administrative write actions recorded."/>:audits.slice(0,30).map((a,i)=><div key={a.id} style={{padding:'11px 13px',borderTop:i?'1px solid #182b38':0}}><strong style={{fontSize:'11px'}}>{a.action_type}</strong><div style={{marginTop:'4px',fontSize:'10px',color:'#91a6b8'}}>{a.summary}</div><div style={{marginTop:'3px',fontSize:'9px',color:'#607888'}}>{utc(a.created_at)}</div></div>)}</div></section>

    <section style={{marginTop:'22px',borderLeft:'3px solid #d97706',background:'rgba(217,119,6,.055)',padding:'11px 13px',fontSize:'10px',lineHeight:1.5,color:'#cfbf9d'}}><strong>Governance boundary:</strong> Administrators manage identity and authority. They still cannot ACTIVATE, STAND DOWN or schedule a Danger Area from this interface.</section>
  </div></main>
}

const nav:React.CSSProperties={textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}
const card:React.CSSProperties={border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',padding:'15px'}
const listBox:React.CSSProperties={border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',overflow:'hidden'}
function Summary({label,value,accent}:{label:string;value:string;accent:string}){return <div style={{border:'1px solid #203746',background:'#0a1822',borderRadius:'11px',padding:'11px 12px'}}><div style={{fontSize:'8px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>{label}</div><div style={{marginTop:'5px',fontSize:'17px',fontWeight:900,color:accent}}>{value}</div></div>}
function Data({label,value}:{label:string;value:string}){return <div style={{border:'1px solid #1d3341',background:'#091720',borderRadius:'8px',padding:'9px'}}><div style={{fontSize:'8px',color:'#708998',textTransform:'uppercase',letterSpacing:'.11em',fontWeight:850}}>{label}</div><div style={{marginTop:'4px',fontSize:'10px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div></div>}
function Heading({eyebrow,title}:{eyebrow:string;title:string}){return <div style={{marginBottom:'10px'}}><div style={{fontSize:'9px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.13em',fontWeight:850}}>{eyebrow}</div><h2 style={{margin:'4px 0 0',fontSize:'19px'}}>{title}</h2></div>}
function Empty({text}:{text:string}){return <div style={{padding:'15px',fontSize:'11px',color:'#91a6b8'}}>{text}</div>}
