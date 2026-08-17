'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type Organisation={id:string;name:string}
type Area={id:string;code:string;name:string}
type Operator={
  user_id:string
  display_name:string
  organisation_id:string|null
  account_status:string
  must_change_password:boolean
  created_at:string
  updated_at:string
  suspension_reason:string|null
  suspended_at:string|null
  reactivated_at:string|null
  credentials_issued_at:string|null
  password_reset_at:string|null
  last_operational_activity:string|null
}
type Permission={user_id:string;danger_area_id:string;can_change_status:boolean}
type Audit={id:number;action_type:string;target_user_id:string|null;summary:string;metadata:Record<string,unknown>;created_at:string}
type Assurance={id:string;email:string|null;created_at:string;last_sign_in_at:string|null;updated_at:string;banned_until:string|null}

type Props={
  organisations:Organisation[]
  areas:Area[]
  operators:Operator[]
  permissions:Permission[]
  audits:Audit[]
}

type Credentials={email?:string;temporaryPassword:string;heading:string}

function utc(value:string|null){
  if(!value)return'—'
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false
  }).format(new Date(value))+' UTC'
}

function daysSince(value:string|null){
  if(!value)return null
  return Math.max(0,Math.floor((Date.now()-new Date(value).getTime())/86400000))
}

export default function AdminOperatorControls({organisations,areas,operators,permissions,audits}:Props){
  const supabase=useMemo(()=>createClient(),[])
  const [assurance,setAssurance]=useState<Record<string,Assurance>>({})
  const [assuranceError,setAssuranceError]=useState('')
  const [query,setQuery]=useState('')
  const [statusFilter,setStatusFilter]=useState('ALL')
  const [orgFilter,setOrgFilter]=useState('ALL')
  const [areaFilter,setAreaFilter]=useState('ALL')
  const [showCreate,setShowCreate]=useState(false)
  const [detailUser,setDetailUser]=useState<string|null>(null)
  const [editingUser,setEditingUser]=useState<string|null>(null)
  const [suspendingUser,setSuspendingUser]=useState<string|null>(null)
  const [suspensionReason,setSuspensionReason]=useState('')
  const [editingAreas,setEditingAreas]=useState<string[]>([])
  const [working,setWorking]=useState(false)
  const [message,setMessage]=useState('')
  const [credentials,setCredentials]=useState<Credentials|null>(null)
  const [displayName,setDisplayName]=useState('')
  const [email,setEmail]=useState('')
  const [organisationId,setOrganisationId]=useState('')
  const [selectedAreas,setSelectedAreas]=useState<string[]>([])

  useEffect(()=>{
    let cancelled=false
    async function load(){
      const {data,error}=await supabase.functions.invoke('admin-operator-management',{body:{action:'LIST_OPERATOR_ASSURANCE'}})
      if(cancelled)return
      if(error||data?.error){
        setAssuranceError(data?.error||error?.message||'Unable to load Auth assurance data.')
        return
      }
      const next:Record<string,Assurance>={}
      for(const user of data.users??[])next[user.id]=user
      setAssurance(next)
    }
    load()
    return()=>{cancelled=true}
  },[supabase])

  async function invoke(body:Record<string,unknown>){
    setWorking(true)
    setMessage('')
    const {data,error}=await supabase.functions.invoke('admin-operator-management',{body})
    setWorking(false)
    if(error){
      setMessage(error.message||'DASS administration request failed.')
      return null
    }
    if(data?.error){
      setMessage(String(data.error))
      return null
    }
    return data
  }

  async function createOperator(){
    if(!displayName.trim()||!email.trim()||!organisationId||selectedAreas.length===0){
      setMessage('Name, email, organisation and at least one Danger Area are required.')
      return
    }
    const data=await invoke({
      action:'CREATE_OPERATOR',
      displayName:displayName.trim(),
      email:email.trim(),
      organisationId,
      dangerAreaIds:selectedAreas,
    })
    if(!data)return
    setCredentials({email:data.email,temporaryPassword:data.temporaryPassword,heading:'Range operator account created'})
    setShowCreate(false)
  }

  async function suspendOperator(){
    if(!suspendingUser)return
    const reason=suspensionReason.trim()
    if(reason.length<5){
      setMessage('Enter a meaningful suspension reason of at least 5 characters.')
      return
    }
    const data=await invoke({action:'SUSPEND_OPERATOR',targetUserId:suspendingUser,reason})
    if(data)window.location.reload()
  }

  async function reactivateOperator(operator:Operator){
    if(!window.confirm(`Reactivate ${operator.display_name}? Existing DA assignments will become usable again.`))return
    const data=await invoke({action:'REACTIVATE_OPERATOR',targetUserId:operator.user_id})
    if(data)window.location.reload()
  }

  async function resetPassword(operator:Operator){
    if(!window.confirm(`Issue a new temporary password for ${operator.display_name}? Their previous password will stop working.`))return
    const data=await invoke({action:'RESET_PASSWORD',targetUserId:operator.user_id})
    if(!data)return
    setCredentials({temporaryPassword:data.temporaryPassword,heading:`Temporary credentials reset — ${operator.display_name}`})
  }

  function beginAssignments(operator:Operator){
    setEditingUser(operator.user_id)
    setEditingAreas(permissions.filter(p=>p.user_id===operator.user_id).map(p=>p.danger_area_id))
    setMessage('')
  }

  async function saveAssignments(){
    if(!editingUser)return
    if(!window.confirm('Replace this operator’s Danger Area assignments with the selected list?'))return
    const data=await invoke({action:'UPDATE_ASSIGNMENTS',targetUserId:editingUser,dangerAreaIds:editingAreas})
    if(data)window.location.reload()
  }

  function toggle(list:string[],id:string,setter:(v:string[])=>void){
    setter(list.includes(id)?list.filter(x=>x!==id):[...list,id])
  }

  const filtered=operators.filter(operator=>{
    const auth=assurance[operator.user_id]
    const org=organisations.find(o=>o.id===operator.organisation_id)
    const assigned=permissions.filter(p=>p.user_id===operator.user_id).map(p=>p.danger_area_id)
    const q=query.trim().toLowerCase()
    const matchesQuery=!q||[
      operator.display_name,
      auth?.email??'',
      org?.name??'',
      ...assigned.map(id=>areas.find(a=>a.id===id)?.code??'')
    ].join(' ').toLowerCase().includes(q)
    const matchesStatus=statusFilter==='ALL'||operator.account_status===statusFilter||(statusFilter==='TEMP'&&operator.must_change_password)||(statusFilter==='DORMANT'&&((daysSince(auth?.last_sign_in_at??null)??999)>=90))
    const matchesOrg=orgFilter==='ALL'||operator.organisation_id===orgFilter
    const matchesArea=areaFilter==='ALL'||assigned.includes(areaFilter)
    return matchesQuery&&matchesStatus&&matchesOrg&&matchesArea
  })

  const detail=detailUser?operators.find(o=>o.user_id===detailUser)??null:null

  return(
    <>
      <section style={{marginTop:'22px',border:'1px solid rgba(89,208,240,.28)',background:'rgba(89,208,240,.04)',borderRadius:'14px',padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>ALPHA 0.5.2 · ACCOUNT ASSURANCE</div>
            <h2 style={{margin:'5px 0 4px',fontSize:'18px'}}>Range Operator Governance</h2>
            <div style={{fontSize:'11px',lineHeight:1.5,color:'#91a6b8'}}>
              Identity assurance, account lifecycle, DA permissions and administrative accountability. Operator accounts are suspended rather than deleted so historical actions remain attributable.
            </div>
          </div>
          <button onClick={()=>setShowCreate(true)} style={primaryCompact}>+ Create Range Operator</button>
        </div>

        <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'minmax(180px,2fr) repeat(3,minmax(130px,1fr))',gap:'8px'}}>
          <input placeholder="Search name, email, organisation or DA…" value={query} onChange={e=>setQuery(e.target.value)} style={input}/>
          <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)} style={input}>
            <option value="ALL">All account states</option>
            <option value="ACTIVE">Active</option>
            <option value="SUSPENDED">Suspended</option>
            <option value="TEMP">Temporary credentials</option>
            <option value="DORMANT">Dormant / never signed in</option>
          </select>
          <select value={orgFilter} onChange={e=>setOrgFilter(e.target.value)} style={input}>
            <option value="ALL">All organisations</option>
            {organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
          <select value={areaFilter} onChange={e=>setAreaFilter(e.target.value)} style={input}>
            <option value="ALL">All Danger Areas</option>
            {areas.map(a=><option key={a.id} value={a.id}>{a.code}</option>)}
          </select>
        </div>

        {assuranceError&&<div style={errorBox}>{assuranceError}</div>}
        {message&&<div style={errorBox}>{message}</div>}
      </section>

      <section style={{marginTop:'14px',display:'grid',gap:'10px'}}>
        {filtered.length===0?<div style={{padding:'14px',color:'#91a6b8',fontSize:'11px'}}>No operators match the current filters.</div>:filtered.map(operator=>{
          const org=organisations.find(o=>o.id===operator.organisation_id)
          const assigned=permissions.filter(p=>p.user_id===operator.user_id)
          const auth=assurance[operator.user_id]
          const dormantDays=daysSince(auth?.last_sign_in_at??null)
          return(
            <article key={operator.user_id} style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',padding:'14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap',alignItems:'center'}}>
                <div>
                  <div style={{display:'flex',gap:'7px',alignItems:'center',flexWrap:'wrap'}}>
                    <strong style={{fontSize:'13px'}}>{operator.display_name}</strong>
                    <StateBadge label={operator.account_status} tone={operator.account_status==='ACTIVE'?'green':'red'}/>
                    {operator.must_change_password&&<StateBadge label="TEMP CREDENTIALS" tone="amber"/>}
                    {(dormantDays===null||dormantDays>=90)&&<StateBadge label="DORMANT" tone="amber"/>}
                  </div>
                  <div style={{marginTop:'4px',fontSize:'10px',color:'#849bab'}}>{auth?.email??'Loading email…'} · {org?.name??'No organisation'}</div>
                  <div style={{marginTop:'4px',fontSize:'9px',color:'#607888'}}>Last sign-in {utc(auth?.last_sign_in_at??null)} · Last operational activity {utc(operator.last_operational_activity)}</div>
                  {operator.suspension_reason&&<div style={{marginTop:'5px',fontSize:'9px',color:'#ffb3b8'}}>Suspension reason: {operator.suspension_reason}</div>}
                </div>
                <div style={{display:'flex',gap:'7px',flexWrap:'wrap'}}>
                  <button onClick={()=>setDetailUser(operator.user_id)} style={smallButton}>Details</button>
                  <button onClick={()=>beginAssignments(operator)} style={smallButton}>Assignments</button>
                  <button onClick={()=>resetPassword(operator)} style={smallButton}>Reset password</button>
                  {operator.account_status==='ACTIVE'
                    ? <button onClick={()=>{setSuspendingUser(operator.user_id);setSuspensionReason('')}} style={{...smallButton,borderColor:'rgba(255,90,100,.5)',color:'#ffb3b8'}}>Suspend</button>
                    : <button onClick={()=>reactivateOperator(operator)} style={{...smallButton,borderColor:'rgba(79,209,139,.5)',color:'#9ae9bc'}}>Reactivate</button>}
                </div>
              </div>
              <div style={{marginTop:'10px',display:'flex',gap:'6px',flexWrap:'wrap'}}>
                {assigned.length===0?<span style={{fontSize:'9px',color:'#ffb0b5'}}>No DA assignments</span>:assigned.map(p=><span key={p.danger_area_id} style={pill}>{areas.find(a=>a.id===p.danger_area_id)?.code??'Unknown DA'} · STATUS CONTROL</span>)}
              </div>
            </article>
          )
        })}
      </section>

      {detail&&(
        <Modal title={`Operator Assurance — ${detail.display_name}`} onClose={()=>setDetailUser(null)}>
          {(()=>{
            const auth=assurance[detail.user_id]
            const org=organisations.find(o=>o.id===detail.organisation_id)
            const assigned=permissions.filter(p=>p.user_id===detail.user_id)
            const history=audits.filter(a=>a.target_user_id===detail.user_id).slice(0,12)
            return <>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                <Data label="Email" value={auth?.email??'—'}/>
                <Data label="Organisation" value={org?.name??'—'}/>
                <Data label="Account state" value={detail.account_status}/>
                <Data label="Credential state" value={detail.must_change_password?'TEMPORARY — CHANGE REQUIRED':'PRIVATE PASSWORD SET'}/>
                <Data label="Auth account created" value={utc(auth?.created_at??detail.created_at)}/>
                <Data label="Profile updated" value={utc(detail.updated_at)}/>
                <Data label="Last sign-in" value={utc(auth?.last_sign_in_at??null)}/>
                <Data label="Last operational activity" value={utc(detail.last_operational_activity)}/>
                <Data label="Credentials issued" value={utc(detail.credentials_issued_at)}/>
                <Data label="Last password reset" value={utc(detail.password_reset_at)}/>
                <Data label="Suspended" value={utc(detail.suspended_at)}/>
                <Data label="Reactivated" value={utc(detail.reactivated_at)}/>
              </div>
              {detail.suspension_reason&&<div style={{borderLeft:'3px solid #ff5a64',paddingLeft:'10px',fontSize:'10px',lineHeight:1.5,color:'#ffc0c4'}}>Suspension reason: {detail.suspension_reason}</div>}
              <div>
                <div style={subhead}>Current Danger Area authority</div>
                <div style={{display:'flex',gap:'6px',flexWrap:'wrap',marginTop:'7px'}}>
                  {assigned.length===0?<span style={{fontSize:'10px',color:'#91a6b8'}}>None</span>:assigned.map(p=><span key={p.danger_area_id} style={pill}>{areas.find(a=>a.id===p.danger_area_id)?.code??'Unknown'}</span>)}
                </div>
              </div>
              <div>
                <div style={subhead}>Administrative history</div>
                <div style={{marginTop:'7px',display:'grid',gap:'6px'}}>
                  {history.length===0?<span style={{fontSize:'10px',color:'#91a6b8'}}>No account-management history.</span>:history.map(a=><div key={a.id} style={{border:'1px solid #203746',background:'#08131c',borderRadius:'8px',padding:'8px'}}><strong style={{fontSize:'9px'}}>{a.action_type}</strong><div style={{marginTop:'3px',fontSize:'9px',color:'#91a6b8'}}>{a.summary}</div><div style={{marginTop:'3px',fontSize:'8px',color:'#607888'}}>{utc(a.created_at)}</div></div>)}
                </div>
              </div>
              <div style={{borderLeft:'3px solid #d97706',paddingLeft:'10px',fontSize:'10px',lineHeight:1.5,color:'#cfbf9d'}}>DASS preserves operator accounts and historical attribution. There is intentionally no Delete Operator control.</div>
            </>
          })()}
        </Modal>
      )}

      {showCreate&&(
        <Modal title="Create Range Operator" onClose={()=>setShowCreate(false)}>
          <Field label="Operator name"><input value={displayName} onChange={e=>setDisplayName(e.target.value)} style={input}/></Field>
          <Field label="Login email"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={input}/></Field>
          <Field label="Organisation"><select value={organisationId} onChange={e=>setOrganisationId(e.target.value)} style={input}><option value="">Select organisation…</option>{organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></Field>
          <Field label="Authorised Danger Areas"><div style={{display:'grid',gap:'7px'}}>{areas.map(a=><label key={a.id} style={checkRow}><input type="checkbox" checked={selectedAreas.includes(a.id)} onChange={()=>toggle(selectedAreas,a.id,setSelectedAreas)}/><strong>{a.code}</strong><span style={{color:'#849bab'}}>{a.name}</span></label>)}</div></Field>
          <div style={notice}>DASS generates a one-time temporary password. The operator must change it before accessing operational controls.</div>
          <button disabled={working} onClick={createOperator} style={primaryButton}>{working?'Creating…':'Create operator & generate credentials'}</button>
        </Modal>
      )}

      {editingUser&&(
        <Modal title={`Danger Area Assignments — ${operators.find(o=>o.user_id===editingUser)?.display_name??'Operator'}`} onClose={()=>setEditingUser(null)}>
          <div style={{fontSize:'10px',lineHeight:1.5,color:'#91a6b8'}}>The complete previous and new assignment sets will be written to the Admin Audit Log.</div>
          <div style={{display:'grid',gap:'7px'}}>{areas.map(a=><label key={a.id} style={checkRow}><input type="checkbox" checked={editingAreas.includes(a.id)} onChange={()=>toggle(editingAreas,a.id,setEditingAreas)}/><strong>{a.code}</strong><span style={{color:'#849bab'}}>{a.name}</span></label>)}</div>
          <button disabled={working} onClick={saveAssignments} style={primaryButton}>{working?'Saving…':'Save assignments'}</button>
        </Modal>
      )}

      {suspendingUser&&(
        <Modal title={`Suspend — ${operators.find(o=>o.user_id===suspendingUser)?.display_name??'Operator'}`} onClose={()=>setSuspendingUser(null)}>
          <div style={{fontSize:'11px',lineHeight:1.55,color:'#ffb8bd'}}>Suspension immediately removes operational authority at the DASS database boundary. Existing historical actions and audit attribution are preserved.</div>
          <Field label="Suspension reason">
            <textarea value={suspensionReason} onChange={e=>setSuspensionReason(e.target.value.slice(0,300))} maxLength={300} rows={4} style={{...input,resize:'vertical'}}/>
          </Field>
          <button disabled={working} onClick={suspendOperator} style={{...primaryButton,background:'#8f2932',borderColor:'#d2545e'}}>{working?'Suspending…':'Confirm suspension'}</button>
        </Modal>
      )}

      {credentials&&(
        <div role="dialog" aria-modal="true" style={overlay}><div style={modal}>
          <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#84e8b0'}}>ONE-TIME CREDENTIAL DISPLAY</div>
          <h2 style={{margin:'7px 0 6px'}}>{credentials.heading}</h2>
          <p style={{fontSize:'11px',lineHeight:1.5,color:'#91a6b8'}}>Copy these credentials now and provide them securely to the operator. DASS will not display this temporary password again.</p>
          {credentials.email&&<Credential label="Username / email" value={credentials.email}/>}
          <Credential label="Temporary password" value={credentials.temporaryPassword}/>
          <div style={notice}>The operator must set a private password before entering the operational dashboard.</div>
          <button onClick={()=>{setCredentials(null);window.location.reload()}} style={primaryButton}>I have securely copied the credentials</button>
        </div></div>
      )}
    </>
  )
}

const input:React.CSSProperties={width:'100%',boxSizing:'border-box',background:'#08131c',border:'1px solid #2a4050',borderRadius:'8px',color:'#edf5fb',padding:'10px'}
const primaryButton:React.CSSProperties={marginTop:'4px',width:'100%',background:'#17657a',border:'1px solid #41849a',color:'white',borderRadius:'9px',padding:'11px',fontWeight:850,cursor:'pointer'}
const primaryCompact:React.CSSProperties={background:'#17657a',border:'1px solid #4a8ca0',color:'white',fontWeight:850,borderRadius:'9px',padding:'11px 14px',cursor:'pointer'}
const smallButton:React.CSSProperties={background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'8px',padding:'8px 10px',fontSize:'10px',cursor:'pointer'}
const overlay:React.CSSProperties={position:'fixed',inset:0,zIndex:7000,background:'rgba(2,8,13,.84)',display:'grid',placeItems:'center',padding:'18px'}
const modal:React.CSSProperties={width:'min(620px,100%)',maxHeight:'90dvh',overflowY:'auto',background:'#0b1722',border:'1px solid #334b5b',borderRadius:'16px',padding:'20px',boxShadow:'0 30px 90px rgba(0,0,0,.65)'}
const checkRow:React.CSSProperties={display:'flex',alignItems:'center',gap:'8px',border:'1px solid #243b49',background:'#08131c',padding:'9px',borderRadius:'8px',fontSize:'11px'}
const pill:React.CSSProperties={fontSize:'9px',border:'1px solid #2c4858',background:'#091720',borderRadius:'7px',padding:'5px 7px',color:'#bcd1dc'}
const notice:React.CSSProperties={borderLeft:'3px solid #d97706',paddingLeft:'10px',fontSize:'10px',lineHeight:1.5,color:'#cfbf9d'}
const errorBox:React.CSSProperties={marginTop:'10px',borderLeft:'3px solid #ff5a64',background:'rgba(255,90,100,.07)',padding:'10px 12px',fontSize:'11px',color:'#ffc0c4'}
const subhead:React.CSSProperties={fontSize:'9px',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:900,color:'#7f9db0'}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  return <div role="dialog" aria-modal="true" style={overlay}><div style={modal}><div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'center'}}><h2 style={{margin:0,fontSize:'19px'}}>{title}</h2><button onClick={onClose} style={smallButton}>Close</button></div><div style={{display:'grid',gap:'12px',marginTop:'16px'}}>{children}</div></div></div>
}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label style={{display:'grid',gap:'6px',fontSize:'11px',color:'#a9bbc7'}}>{label}{children}</label>}
function Credential({label,value}:{label:string;value:string}){async function copy(){await navigator.clipboard.writeText(value)}return <div style={{marginTop:'10px',border:'1px solid #294253',background:'#08131c',borderRadius:'9px',padding:'11px'}}><div style={{fontSize:'8px',textTransform:'uppercase',letterSpacing:'.12em',color:'#7892a4'}}>{label}</div><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px',marginTop:'6px'}}><code style={{fontSize:'13px',wordBreak:'break-all'}}>{value}</code><button onClick={copy} style={smallButton}>Copy</button></div></div>}
function StateBadge({label,tone}:{label:string;tone:'green'|'red'|'amber'}){const c=tone==='green'?'#84e8b0':tone==='red'?'#ff9299':'#fbbf24';return <span style={{fontSize:'8px',fontWeight:900,letterSpacing:'.07em',border:`1px solid ${c}55`,color:c,borderRadius:'999px',padding:'4px 6px'}}>{label}</span>}
function Data({label,value}:{label:string;value:string}){return <div style={{border:'1px solid #1d3341',background:'#091720',borderRadius:'8px',padding:'9px'}}><div style={{fontSize:'8px',color:'#708998',textTransform:'uppercase',letterSpacing:'.11em',fontWeight:850}}>{label}</div><div style={{marginTop:'4px',fontSize:'10px',color:'#c4d3dc',lineHeight:1.3,wordBreak:'break-word'}}>{value}</div></div>}
