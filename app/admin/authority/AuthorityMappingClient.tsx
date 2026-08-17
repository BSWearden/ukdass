'use client'

import { useMemo,useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type Area={id:string;code:string;name:string;organisation_id:string|null;aip_current:boolean}
type Organisation={id:string;name:string}
type Operator={user_id:string;display_name:string;organisation_id:string|null;account_status:string}
type Permission={user_id:string;danger_area_id:string;can_change_status:boolean}
type Props={initialAreas:Area[];initialOrganisations:Organisation[];initialOperators:Operator[];initialPermissions:Permission[];archivedPermissionCount:number}
type Coverage='ALL'|'UNOWNED'|'NO_OPERATOR'|'COVERED'

export default function AuthorityMappingClient({initialAreas,initialOrganisations,initialOperators,initialPermissions,archivedPermissionCount}:Props){
  const supabase=useMemo(()=>createClient(),[])
  const [query,setQuery]=useState('')
  const [coverage,setCoverage]=useState<Coverage>('ALL')
  const [orgFilter,setOrgFilter]=useState('ALL')
  const [selected,setSelected]=useState<string[]>([])
  const [organisationId,setOrganisationId]=useState('')
  const [operatorIds,setOperatorIds]=useState<string[]>([])
  const [newOrganisation,setNewOrganisation]=useState('')
  const [working,setWorking]=useState(false)
  const [message,setMessage]=useState('')
  const [error,setError]=useState('')

  const orgMap=useMemo(()=>new Map(initialOrganisations.map(item=>[item.id,item.name])),[initialOrganisations])
  const operatorMap=useMemo(()=>new Map(initialOperators.map(item=>[item.user_id,item])),[initialOperators])
  const areaPermissions=useMemo(()=>{
    const map=new Map<string,Permission[]>()
    for(const permission of initialPermissions)map.set(permission.danger_area_id,[...(map.get(permission.danger_area_id)??[]),permission])
    return map
  },[initialPermissions])

  const counts=useMemo(()=>{
    let owned=0,covered=0
    for(const area of initialAreas){
      if(area.organisation_id)owned++
      if((areaPermissions.get(area.id)?.length??0)>0)covered++
    }
    return {owned,covered,unowned:initialAreas.length-owned,noOperator:initialAreas.length-covered}
  },[initialAreas,areaPermissions])

  const filtered=useMemo(()=>initialAreas.filter(area=>{
    const q=query.trim().toLowerCase()
    const permissions=areaPermissions.get(area.id)??[]
    const searchable=[area.code,area.name,area.organisation_id?orgMap.get(area.organisation_id)??'':'',...permissions.map(p=>operatorMap.get(p.user_id)?.display_name??'')].join(' ').toLowerCase()
    const queryMatch=!q||searchable.includes(q)
    const orgMatch=orgFilter==='ALL'||(orgFilter==='UNASSIGNED'?!area.organisation_id:area.organisation_id===orgFilter)
    const coverageMatch=coverage==='ALL'||(coverage==='UNOWNED'&&!area.organisation_id)||(coverage==='NO_OPERATOR'&&permissions.length===0)||(coverage==='COVERED'&&permissions.length>0)
    return queryMatch&&orgMatch&&coverageMatch
  }),[initialAreas,query,orgFilter,coverage,areaPermissions,orgMap,operatorMap])

  const eligibleOperators=initialOperators.filter(operator=>operator.account_status==='ACTIVE'&&operator.organisation_id===organisationId)
  const selectedVisible=filtered.length>0&&filtered.every(area=>selected.includes(area.id))

  function toggleArea(id:string){setSelected(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id])}
  function toggleOperator(id:string){setOperatorIds(current=>current.includes(id)?current.filter(item=>item!==id):[...current,id])}
  function setSelectedOrganisation(id:string){setOrganisationId(id);setOperatorIds([])}

  async function applyMapping(){
    setError('');setMessage('')
    if(selected.length===0){setError('Select at least one Danger Area.');return}
    if(!organisationId){setError('Select the responsible organisation.');return}
    const orgName=orgMap.get(organisationId)??'the selected organisation'
    if(!window.confirm('Replace the organisation and operator authority for '+selected.length+' selected Danger Area(s) with '+orgName+'?'))return
    setWorking(true)
    const {data,error:rpcError}=await supabase.rpc('admin_bulk_map_authority',{p_area_ids:selected,p_organisation_id:organisationId,p_operator_user_ids:operatorIds})
    setWorking(false)
    if(rpcError){setError(rpcError.message);return}
    const result=data as {mapped_areas?:number;new_permissions?:number}
    setMessage('Mapped '+(result.mapped_areas??selected.length)+' Danger Areas and created '+(result.new_permissions??0)+' operator permissions.')
    window.location.reload()
  }

  async function createOrganisation(){
    setError('');setMessage('')
    const name=newOrganisation.trim()
    if(name.length<3){setError('Enter an organisation name of at least three characters.');return}
    setWorking(true)
    const {error:rpcError}=await supabase.rpc('admin_create_authority_organisation',{p_name:name})
    setWorking(false)
    if(rpcError){setError(rpcError.message);return}
    setMessage('Organisation created successfully.')
    window.location.reload()
  }

  async function cleanupArchived(){
    if(!window.confirm('Remove all obsolete operator permissions attached to archived demonstration areas? Historical status and audit records will remain intact.'))return
    setError('');setMessage('');setWorking(true)
    const {data,error:rpcError}=await supabase.rpc('admin_cleanup_archived_authority')
    setWorking(false)
    if(rpcError){setError(rpcError.message);return}
    const result=data as {removed_archived_permissions?:number}
    setMessage('Removed '+(result.removed_archived_permissions??0)+' archived permissions.')
    window.location.reload()
  }

  return <>
    <section style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'10px'}}>
      <Summary label="Current Danger Areas" value={initialAreas.length} tone="#d7e5ed"/>
      <Summary label="Organisation assigned" value={counts.owned} tone={counts.owned===initialAreas.length?'#84e8b0':'#fbbf24'}/>
      <Summary label="Unassigned ownership" value={counts.unowned} tone={counts.unowned?'#ff9299':'#84e8b0'}/>
      <Summary label="Operator covered" value={counts.covered} tone={counts.covered===initialAreas.length?'#84e8b0':'#fbbf24'}/>
      <Summary label="No active authority" value={counts.noOperator} tone={counts.noOperator?'#ff9299':'#84e8b0'}/>
    </section>

    <section style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,420px),1fr))',gap:'14px',alignItems:'start'}}>
      <div>
        <div style={panel}>
          <div style={{display:'grid',gridTemplateColumns:'minmax(180px,2fr) minmax(140px,1fr) minmax(150px,1fr)',gap:'8px'}}>
            <input value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search code, name, organisation or operator…" style={input}/>
            <select value={coverage} onChange={event=>setCoverage(event.target.value as Coverage)} style={input}><option value="ALL">All coverage states</option><option value="UNOWNED">No organisation</option><option value="NO_OPERATOR">No operator authority</option><option value="COVERED">Operator covered</option></select>
            <select value={orgFilter} onChange={event=>setOrgFilter(event.target.value)} style={input}><option value="ALL">All organisations</option><option value="UNASSIGNED">Unassigned</option>{initialOrganisations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select>
          </div>
          <div style={{marginTop:'10px',display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'center',flexWrap:'wrap'}}>
            <label style={{fontSize:'10px',color:'#a9bdc9',display:'flex',gap:'7px',alignItems:'center'}}><input type="checkbox" checked={selectedVisible} onChange={()=>setSelected(current=>selectedVisible?current.filter(id=>!filtered.some(area=>area.id===id)):[...new Set([...current,...filtered.map(area=>area.id)])])}/>Select all {filtered.length} filtered areas</label>
            <span style={{fontSize:'10px',color:selected.length?'#8fdaf0':'#7892a4',fontWeight:850}}>{selected.length} selected</span>
          </div>
        </div>

        <div style={{...panel,marginTop:'10px',padding:0,overflow:'hidden'}}>
          <div style={{maxHeight:'64vh',overflow:'auto'}}>
            {filtered.map(area=>{
              const permissions=areaPermissions.get(area.id)??[]
              return <label key={area.id} style={{display:'grid',gridTemplateColumns:'24px minmax(90px,.6fr) minmax(180px,1.4fr) minmax(150px,1fr) minmax(170px,1.2fr)',minWidth:'780px',gap:'10px',alignItems:'center',padding:'10px 12px',borderTop:'1px solid #182b38',cursor:'pointer',fontSize:'10px'}}>
                <input type="checkbox" checked={selected.includes(area.id)} onChange={()=>toggleArea(area.id)}/>
                <strong style={{color:'#8fdaf0'}}>{area.code}</strong>
                <span style={{color:'#c4d3dc'}}>{area.name}</span>
                <span style={{color:area.organisation_id?'#a9bdc9':'#ff9299'}}>{area.organisation_id?orgMap.get(area.organisation_id)??'Unknown organisation':'UNASSIGNED'}</span>
                <span style={{color:permissions.length?'#84e8b0':'#ff9299'}}>{permissions.length?permissions.map(permission=>operatorMap.get(permission.user_id)?.display_name??'Unknown operator').join(', '):'NO OPERATOR AUTHORITY'}</span>
              </label>
            })}
            {filtered.length===0?<div style={{padding:'18px',fontSize:'11px',color:'#91a6b8'}}>No Danger Areas match the current filters.</div>:null}
          </div>
        </div>
      </div>

      <div style={{display:'grid',gap:'12px',position:'sticky',top:'14px'}}>
        <section style={panel}>
          <div style={eyebrow}>Bulk authority assignment</div>
          <h2 style={{margin:'5px 0 12px',fontSize:'18px'}}>Map selected areas</h2>
          <Field label="Responsible organisation"><select value={organisationId} onChange={event=>setSelectedOrganisation(event.target.value)} style={input}><option value="">Select organisation…</option>{initialOrganisations.map(org=><option key={org.id} value={org.id}>{org.name}</option>)}</select></Field>
          <div style={{marginTop:'12px'}}>
            <div style={{fontSize:'10px',color:'#a9bdc9',marginBottom:'7px'}}>Authorised active operators</div>
            {!organisationId?<div style={empty}>Select an organisation first.</div>:eligibleOperators.length===0?<div style={empty}>No active operators belong to this organisation. Ownership can still be saved without operator authority.</div>:<div style={{display:'grid',gap:'7px'}}>{eligibleOperators.map(operator=><label key={operator.user_id} style={checkRow}><input type="checkbox" checked={operatorIds.includes(operator.user_id)} onChange={()=>toggleOperator(operator.user_id)}/><span>{operator.display_name}</span></label>)}</div>}
          </div>
          <div style={{marginTop:'12px',fontSize:'10px',lineHeight:1.5,color:'#cfbf9d',borderLeft:'3px solid #d97706',paddingLeft:'9px'}}>Saving replaces the complete organisation and operator-authority set for the selected Danger Areas. Every change is audited.</div>
          <button disabled={working||selected.length===0||!organisationId} onClick={()=>void applyMapping()} style={primary}>{working?'Applying…':'Apply authority mapping'}</button>
        </section>

        <section style={panel}>
          <div style={eyebrow}>Organisation register</div>
          <Field label="New organisation name"><input value={newOrganisation} maxLength={120} onChange={event=>setNewOrganisation(event.target.value)} style={input}/></Field>
          <button disabled={working||newOrganisation.trim().length<3} onClick={()=>void createOrganisation()} style={secondary}>Create organisation</button>
        </section>

        {archivedPermissionCount>0?<section style={{...panel,borderColor:'rgba(255,90,100,.35)'}}><div style={eyebrow}>Archived authority cleanup</div><p style={{fontSize:'10px',lineHeight:1.5,color:'#c7a9ac'}}>{archivedPermissionCount} obsolete permission(s) remain attached to archived demonstration areas.</p><button disabled={working} onClick={()=>void cleanupArchived()} style={{...secondary,borderColor:'#8f4249',color:'#ffc0c4'}}>Remove archived permissions</button></section>:null}
      </div>
    </section>

    {error?<div role="alert" style={errorBox}>{error}</div>:null}
    {message?<div role="status" style={successBox}>{message}</div>:null}
  </>
}

const panel:React.CSSProperties={border:'1px solid #203746',background:'#0b1722',borderRadius:'13px',padding:'14px'}
const input:React.CSSProperties={width:'100%',boxSizing:'border-box',background:'#08131c',border:'1px solid #2a4050',borderRadius:'8px',color:'#edf5fb',padding:'10px',fontSize:'11px'}
const checkRow:React.CSSProperties={display:'flex',alignItems:'center',gap:'8px',border:'1px solid #243b49',background:'#08131c',padding:'9px',borderRadius:'8px',fontSize:'11px'}
const primary:React.CSSProperties={marginTop:'14px',width:'100%',background:'#17657a',border:'1px solid #41849a',color:'white',borderRadius:'9px',padding:'11px',fontWeight:850,cursor:'pointer'}
const secondary:React.CSSProperties={marginTop:'10px',width:'100%',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px',fontWeight:850,cursor:'pointer'}
const eyebrow:React.CSSProperties={fontSize:'9px',letterSpacing:'.13em',textTransform:'uppercase',color:'#7f9db0',fontWeight:900}
const empty:React.CSSProperties={fontSize:'10px',lineHeight:1.45,color:'#7892a4',padding:'9px',border:'1px dashed #2a4050',borderRadius:'8px'}
const errorBox:React.CSSProperties={position:'fixed',left:'50%',bottom:'18px',transform:'translateX(-50%)',zIndex:5000,width:'min(620px,calc(100% - 28px))',boxSizing:'border-box',border:'1px solid rgba(255,90,100,.5)',background:'#39151c',borderRadius:'10px',padding:'12px',fontSize:'11px',color:'#ffc0c4'}
const successBox:React.CSSProperties={...errorBox,border:'1px solid rgba(79,209,139,.5)',background:'#0d3224',color:'#a7efc7'}
function Summary({label,value,tone}:{label:string;value:number;tone:string}){return <div style={{border:'1px solid #203746',background:'#0a1822',borderRadius:'11px',padding:'11px 12px'}}><div style={{fontSize:'8px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>{label}</div><div style={{marginTop:'5px',fontSize:'18px',fontWeight:900,color:tone}}>{value}</div></div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <label style={{display:'grid',gap:'6px',fontSize:'10px',color:'#a9bdc9'}}>{label}{children}</label>}
