'use client'

import { useMemo, useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type Organisation = { id:string; name:string }
type Area = { id:string; code:string; name:string }
type Operator = {
  user_id:string
  display_name:string
  organisation_id:string|null
  account_status:string
  must_change_password:boolean
}
type Permission = { user_id:string; danger_area_id:string; can_change_status:boolean }

type Props = {
  organisations: Organisation[]
  areas: Area[]
  operators: Operator[]
  permissions: Permission[]
}

type Credentials = {
  email?: string
  temporaryPassword: string
  heading: string
}

export default function AdminOperatorControls({organisations,areas,operators,permissions}:Props){
  const supabase = useMemo(()=>createClient(),[])
  const [showCreate,setShowCreate]=useState(false)
  const [working,setWorking]=useState(false)
  const [message,setMessage]=useState('')
  const [credentials,setCredentials]=useState<Credentials|null>(null)
  const [displayName,setDisplayName]=useState('')
  const [email,setEmail]=useState('')
  const [organisationId,setOrganisationId]=useState('')
  const [selectedAreas,setSelectedAreas]=useState<string[]>([])
  const [editingUser,setEditingUser]=useState<string|null>(null)
  const [editingAreas,setEditingAreas]=useState<string[]>([])

  async function invoke(body:Record<string,unknown>){
    setWorking(true); setMessage('')
    const {data,error}=await supabase.functions.invoke('admin-operator-management',{body})
    setWorking(false)
    if(error){
      setMessage(error.message || 'DASS administration request failed.')
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
    setCredentials({
      email:data.email,
      temporaryPassword:data.temporaryPassword,
      heading:'Range operator account created'
    })
    setShowCreate(false)
    setDisplayName('');setEmail('');setOrganisationId('');setSelectedAreas([])
  }

  async function setStatus(userId:string,status:'SUSPEND_OPERATOR'|'REACTIVATE_OPERATOR'){
    if(!window.confirm(status==='SUSPEND_OPERATOR'
      ? 'Suspend this operator? Their DASS operational authority will be removed immediately.'
      : 'Reactivate this operator and restore their assigned DASS permissions?')) return
    const data=await invoke({action:status,targetUserId:userId})
    if(data)window.location.reload()
  }

  async function resetPassword(operator:Operator){
    if(!window.confirm(`Issue a new temporary password for ${operator.display_name}? Their previous password will stop working.`))return
    const data=await invoke({action:'RESET_PASSWORD',targetUserId:operator.user_id})
    if(!data)return
    setCredentials({
      temporaryPassword:data.temporaryPassword,
      heading:`Temporary credentials reset — ${operator.display_name}`
    })
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

  return(
    <>
      <section style={{marginTop:'22px',border:'1px solid rgba(89,208,240,.28)',background:'rgba(89,208,240,.04)',borderRadius:'14px',padding:'16px'}}>
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'12px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>ALPHA 0.5.1 · ACCOUNT GOVERNANCE</div>
            <h2 style={{margin:'5px 0 4px',fontSize:'18px'}}>Range Operator Administration</h2>
            <div style={{fontSize:'11px',lineHeight:1.5,color:'#91a6b8'}}>Create accounts, manage DA assignments, suspend/reactivate access and issue temporary credential resets. These controls cannot change a Danger Area operational state.</div>
          </div>
          <button onClick={()=>{setShowCreate(true);setMessage('')}} style={{background:'#17657a',border:'1px solid #4a8ca0',color:'white',fontWeight:850,borderRadius:'9px',padding:'11px 14px',cursor:'pointer'}}>+ Create Range Operator</button>
        </div>
        {message&&<div style={{marginTop:'12px',borderLeft:'3px solid #ff5a64',background:'rgba(255,90,100,.07)',padding:'10px 12px',fontSize:'11px',color:'#ffc0c4'}}>{message}</div>}
      </section>

      <section style={{marginTop:'14px',display:'grid',gap:'10px'}}>
        {operators.map(operator=>{
          const org=organisations.find(o=>o.id===operator.organisation_id)
          const assigned=permissions.filter(p=>p.user_id===operator.user_id)
          return(
            <article key={operator.user_id} style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',padding:'14px'}}>
              <div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap',alignItems:'center'}}>
                <div>
                  <strong style={{fontSize:'13px'}}>{operator.display_name}</strong>
                  <div style={{marginTop:'3px',fontSize:'10px',color:'#849bab'}}>{org?.name??'No organisation'} · {assigned.length} assigned DA{assigned.length===1?'':'s'}</div>
                  {operator.must_change_password&&<div style={{marginTop:'5px',fontSize:'9px',fontWeight:900,color:'#fbbf24'}}>TEMPORARY PASSWORD CHANGE REQUIRED</div>}
                </div>
                <div style={{display:'flex',gap:'7px',flexWrap:'wrap'}}>
                  <button onClick={()=>beginAssignments(operator)} style={smallButton}>Assignments</button>
                  <button onClick={()=>resetPassword(operator)} style={smallButton}>Reset password</button>
                  {operator.account_status==='ACTIVE'
                    ? <button onClick={()=>setStatus(operator.user_id,'SUSPEND_OPERATOR')} style={{...smallButton,borderColor:'rgba(255,90,100,.5)',color:'#ffb3b8'}}>Suspend</button>
                    : <button onClick={()=>setStatus(operator.user_id,'REACTIVATE_OPERATOR')} style={{...smallButton,borderColor:'rgba(79,209,139,.5)',color:'#9ae9bc'}}>Reactivate</button>}
                </div>
              </div>
            </article>
          )
        })}
      </section>

      {showCreate&&(
        <Modal title="Create Range Operator" onClose={()=>setShowCreate(false)}>
          <Field label="Operator name"><input value={displayName} onChange={e=>setDisplayName(e.target.value)} style={input}/></Field>
          <Field label="Login email"><input type="email" value={email} onChange={e=>setEmail(e.target.value)} style={input}/></Field>
          <Field label="Organisation">
            <select value={organisationId} onChange={e=>setOrganisationId(e.target.value)} style={input}>
              <option value="">Select organisation…</option>
              {organisations.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </Field>
          <Field label="Authorised Danger Areas">
            <div style={{display:'grid',gap:'7px'}}>
              {areas.map(a=><label key={a.id} style={{display:'flex',alignItems:'center',gap:'8px',border:'1px solid #243b49',background:'#08131c',padding:'9px',borderRadius:'8px',fontSize:'11px'}}>
                <input type="checkbox" checked={selectedAreas.includes(a.id)} onChange={()=>toggle(selectedAreas,a.id,setSelectedAreas)}/>
                <strong>{a.code}</strong><span style={{color:'#849bab'}}>{a.name}</span>
              </label>)}
            </div>
          </Field>
          <div style={{borderLeft:'3px solid #d97706',paddingLeft:'10px',fontSize:'10px',lineHeight:1.5,color:'#cfbf9d'}}>DASS will generate a strong temporary password. The operator must change it before accessing operational controls.</div>
          <button disabled={working} onClick={createOperator} style={primaryButton}>{working?'Creating…':'Create operator & generate credentials'}</button>
        </Modal>
      )}

      {editingUser&&(
        <Modal title={`Danger Area Assignments — ${operators.find(o=>o.user_id===editingUser)?.display_name??'Operator'}`} onClose={()=>setEditingUser(null)}>
          <div style={{fontSize:'10px',lineHeight:1.5,color:'#91a6b8',marginBottom:'10px'}}>Selected Danger Areas grant STATUS CONTROL authority. Removing an assignment immediately removes authority for that DA.</div>
          <div style={{display:'grid',gap:'7px'}}>
            {areas.map(a=><label key={a.id} style={{display:'flex',alignItems:'center',gap:'8px',border:'1px solid #243b49',background:'#08131c',padding:'9px',borderRadius:'8px',fontSize:'11px'}}>
              <input type="checkbox" checked={editingAreas.includes(a.id)} onChange={()=>toggle(editingAreas,a.id,setEditingAreas)}/>
              <strong>{a.code}</strong><span style={{color:'#849bab'}}>{a.name}</span>
            </label>)}
          </div>
          <button disabled={working} onClick={saveAssignments} style={primaryButton}>{working?'Saving…':'Save assignments'}</button>
        </Modal>
      )}

      {credentials&&(
        <div role="dialog" aria-modal="true" style={overlay}>
          <div style={modal}>
            <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#84e8b0'}}>ONE-TIME CREDENTIAL DISPLAY</div>
            <h2 style={{margin:'7px 0 6px'}}>{credentials.heading}</h2>
            <p style={{fontSize:'11px',lineHeight:1.5,color:'#91a6b8'}}>Copy these credentials now and provide them securely to the operator. DASS will not display this temporary password again.</p>
            {credentials.email&&<Credential label="Username / email" value={credentials.email}/>}
            <Credential label="Temporary password" value={credentials.temporaryPassword}/>
            <div style={{marginTop:'12px',borderLeft:'3px solid #fbbf24',paddingLeft:'10px',fontSize:'10px',lineHeight:1.5,color:'#dfcea5'}}>The operator will be forced to set a new password before entering the operational dashboard.</div>
            <button onClick={()=>{setCredentials(null);window.location.reload()}} style={primaryButton}>I have securely copied the credentials</button>
          </div>
        </div>
      )}
    </>
  )
}

const input:React.CSSProperties={width:'100%',boxSizing:'border-box',background:'#08131c',border:'1px solid #2a4050',borderRadius:'8px',color:'#edf5fb',padding:'10px'}
const primaryButton:React.CSSProperties={marginTop:'14px',width:'100%',background:'#17657a',border:'1px solid #41849a',color:'white',borderRadius:'9px',padding:'11px',fontWeight:850,cursor:'pointer'}
const smallButton:React.CSSProperties={background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'8px',padding:'8px 10px',fontSize:'10px',cursor:'pointer'}
const overlay:React.CSSProperties={position:'fixed',inset:0,zIndex:7000,background:'rgba(2,8,13,.84)',display:'grid',placeItems:'center',padding:'18px'}
const modal:React.CSSProperties={width:'min(580px,100%)',maxHeight:'90dvh',overflowY:'auto',background:'#0b1722',border:'1px solid #334b5b',borderRadius:'16px',padding:'20px',boxShadow:'0 30px 90px rgba(0,0,0,.65)'}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  return <div role="dialog" aria-modal="true" style={overlay}><div style={modal}><div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'center'}}><h2 style={{margin:0,fontSize:'19px'}}>{title}</h2><button onClick={onClose} style={smallButton}>Close</button></div><div style={{display:'grid',gap:'12px',marginTop:'16px'}}>{children}</div></div></div>
}
function Field({label,children}:{label:string;children:React.ReactNode}){
  return <label style={{display:'grid',gap:'6px',fontSize:'11px',color:'#a9bbc7'}}>{label}{children}</label>
}
function Credential({label,value}:{label:string;value:string}){
  async function copy(){await navigator.clipboard.writeText(value)}
  return <div style={{marginTop:'10px',border:'1px solid #294253',background:'#08131c',borderRadius:'9px',padding:'11px'}}><div style={{fontSize:'8px',textTransform:'uppercase',letterSpacing:'.12em',color:'#7892a4'}}>{label}</div><div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'10px',marginTop:'6px'}}><code style={{fontSize:'13px',wordBreak:'break-all'}}>{value}</code><button onClick={copy} style={smallButton}>Copy</button></div></div>
}
