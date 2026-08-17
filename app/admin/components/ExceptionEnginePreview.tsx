'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type LifecycleStatus='OPEN'|'ACKNOWLEDGED'|'RESOLVED'
type Severity='ADVISORY'|'WARNING'|'CRITICAL'
type Filter='ACTIVE'|LifecycleStatus|'ALL'
type ExceptionRow={id:string;exception_type:string;severity:Severity;lifecycle_status:LifecycleStatus;title:string;detail:string;detected_at:string;last_detected_at:string;acknowledged_at:string|null;acknowledgement_note:string|null;resolved_at:string|null;resolution_reason:string|null;danger_area_id:string|null;operational_period_id:string|null}
type ExceptionEvent={id:number;exception_id:string;event_type:string;occurred_at:string;note:string|null}

function utc(value:string|null){if(!value)return'—';return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(value))+' UTC'}
function tone(severity:Severity,status:LifecycleStatus){if(status==='RESOLVED')return{fg:'#91a6b8',bg:'rgba(145,166,184,.05)'};if(severity==='CRITICAL')return{fg:'#ff9299',bg:'rgba(255,90,100,.07)'};if(severity==='WARNING')return{fg:'#fbbf24',bg:'rgba(217,119,6,.06)'};return{fg:'#8fdaf0',bg:'rgba(89,208,240,.05)'}}

export default function ExceptionEnginePreview(){
  const supabase=useMemo(()=>createClient(),[])
  const [rows,setRows]=useState<ExceptionRow[]>([])
  const [events,setEvents]=useState<ExceptionEvent[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [filter,setFilter]=useState<Filter>('ACTIVE')
  const [selectedId,setSelectedId]=useState<string|null>(null)
  const [action,setAction]=useState<'ACKNOWLEDGE'|'RESOLVE'|null>(null)
  const [note,setNote]=useState('')
  const [saving,setSaving]=useState(false)

  const load=useCallback(async()=>{
    const [exceptionResult,eventResult]=await Promise.all([
      supabase.from('operational_exceptions').select('id,exception_type,severity,lifecycle_status,title,detail,detected_at,last_detected_at,acknowledged_at,acknowledgement_note,resolved_at,resolution_reason,danger_area_id,operational_period_id').order('detected_at',{ascending:false}).limit(100),
      supabase.from('operational_exception_events').select('id,exception_id,event_type,occurred_at,note').order('occurred_at',{ascending:false}).limit(300)
    ])
    if(exceptionResult.error||eventResult.error)setError('Unable to load operational exceptions or their history.')
    else{setRows((exceptionResult.data??[]) as ExceptionRow[]);setEvents((eventResult.data??[]) as ExceptionEvent[]);setError('')}
    setLoading(false)
  },[supabase])

  useEffect(()=>{
    void load()
    const channel=supabase.channel('dass-admin-exceptions').on('postgres_changes',{event:'*',schema:'public',table:'operational_exceptions'},()=>void load()).on('postgres_changes',{event:'*',schema:'public',table:'operational_exception_events'},()=>void load()).subscribe()
    const timer=window.setInterval(()=>void load(),60000)
    return()=>{window.clearInterval(timer);void supabase.removeChannel(channel)}
  },[load,supabase])

  const open=rows.filter(row=>row.lifecycle_status!=='RESOLVED')
  const visible=rows.filter(row=>filter==='ALL'||(filter==='ACTIVE'?row.lifecycle_status!=='RESOLVED':row.lifecycle_status===filter))
  const counts={critical:open.filter(row=>row.severity==='CRITICAL').length,warning:open.filter(row=>row.severity==='WARNING').length,active:open.length}
  function begin(nextAction:'ACKNOWLEDGE'|'RESOLVE',id:string){setSelectedId(id);setAction(nextAction);setNote('');setError('')}
  function cancel(){setSelectedId(null);setAction(null);setNote('')}

  async function submit(){
    if(!selectedId||!action||!note.trim())return
    setSaving(true)
    const rpc=action==='ACKNOWLEDGE'?'admin_acknowledge_operational_exception':'admin_resolve_operational_exception'
    const args=action==='ACKNOWLEDGE'?{p_exception_id:selectedId,p_note:note.trim()}:{p_exception_id:selectedId,p_reason:note.trim()}
    const {error:mutationError}=await supabase.rpc(rpc,args)
    if(mutationError){setError(mutationError.message||'Unable to update the operational exception.');setSaving(false);return}
    cancel();await load();setSaving(false)
  }

  return <section style={{marginTop:'26px'}} aria-labelledby="operational-exceptions-title">
    <div style={{display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'end',flexWrap:'wrap',marginBottom:'10px'}}>
      <div><div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>ALPHA 0.7.1 · OPERATIONAL OVERSIGHT</div><h2 id="operational-exceptions-title" style={{margin:'4px 0 0',fontSize:'19px'}}>Operational Exceptions</h2><div style={{marginTop:'4px',fontSize:'10px',lineHeight:1.45,color:'#7892a4'}}>Abnormal conditions requiring administrator awareness, acknowledgement or resolution.</div></div>
      <div style={{display:'flex',gap:'7px',flexWrap:'wrap'}}><Badge label={`${counts.critical} CRITICAL`} colour={counts.critical?'#ff9299':'#84e8b0'}/><Badge label={`${counts.warning} WARNING`} colour={counts.warning?'#fbbf24':'#84e8b0'}/><Badge label={`${counts.active} ACTIVE`} colour={counts.active?'#fbbf24':'#84e8b0'}/></div>
    </div>
    <div style={{border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',overflow:'hidden'}}>
      <div style={{padding:'10px 12px',display:'flex',gap:'7px',flexWrap:'wrap',borderBottom:'1px solid #203243'}} role="group" aria-label="Filter operational exceptions">
        {(['ACTIVE','OPEN','ACKNOWLEDGED','RESOLVED','ALL'] as Filter[]).map(value=><button key={value} type="button" onClick={()=>setFilter(value)} aria-pressed={filter===value} style={{...filterButton,...(filter===value?activeFilterButton:{})}}>{value}</button>)}
      </div>
      <div aria-live="polite">
        {loading&&<Empty text="Loading exception oversight state…"/>}
        {error&&<div role="alert" style={{padding:'12px',fontSize:'10px',color:'#ffb1b6'}}>{error}</div>}
        {!loading&&!error&&rows.length===0&&<Empty text="No operational exceptions have been detected. The evaluator continues to run automatically once per minute."/>}
        {!loading&&!error&&rows.length>0&&visible.length===0&&<Empty text={`No ${filter.toLowerCase()} operational exceptions.`}/>} 
        {!loading&&visible.map(row=>{
          const t=tone(row.severity,row.lifecycle_status),rowEvents=events.filter(event=>event.exception_id===row.id),formOpen=selectedId===row.id&&action!==null
          return <article key={row.id} style={{padding:'13px',borderTop:'1px solid #182b38',background:t.bg}}>
            <div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'flex-start',flexWrap:'wrap'}}><div style={{maxWidth:'780px'}}><strong style={{fontSize:'12px'}}>{row.title}</strong><div style={{marginTop:'4px',fontSize:'10px',lineHeight:1.5,color:'#a3b6c2'}}>{row.detail}</div></div><div style={{display:'flex',gap:'6px'}}><Badge label={row.severity} colour={t.fg}/><Badge label={row.lifecycle_status} colour={row.lifecycle_status==='RESOLVED'?'#91a6b8':'#8fdaf0'}/></div></div>
            <div style={{marginTop:'9px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(155px,1fr))',gap:'6px'}}><Data label="Type" value={row.exception_type.replaceAll('_',' ')}/><Data label="Detected" value={utc(row.detected_at)}/><Data label="Last detected" value={utc(row.last_detected_at)}/><Data label="Acknowledged" value={utc(row.acknowledged_at)}/><Data label="Resolved" value={utc(row.resolved_at)}/></div>
            {row.acknowledgement_note&&<Note label="Acknowledgement" value={row.acknowledgement_note}/>} {row.resolution_reason&&<Note label="Resolution" value={row.resolution_reason}/>} 
            {row.lifecycle_status!=='RESOLVED'&&!formOpen&&<div style={{marginTop:'10px',display:'flex',gap:'7px',flexWrap:'wrap'}}>{row.lifecycle_status==='OPEN'&&<button type="button" style={actionButton} onClick={()=>begin('ACKNOWLEDGE',row.id)}>Acknowledge</button>}<button type="button" style={resolveButton} onClick={()=>begin('RESOLVE',row.id)}>Resolve</button></div>}
            {formOpen&&<div style={{marginTop:'10px',border:'1px solid #2b4556',borderRadius:'9px',padding:'10px',background:'#08131c'}}><label htmlFor={`exception-note-${row.id}`} style={{display:'block',fontSize:'9px',fontWeight:850,color:'#c4d3dc'}}>{action==='ACKNOWLEDGE'?'Acknowledgement note':'Resolution reason'} <span style={{color:'#ff9299'}}>*</span></label><textarea id={`exception-note-${row.id}`} value={note} onChange={event=>setNote(event.target.value)} maxLength={500} rows={3} autoFocus style={textarea}/><div style={{display:'flex',justifyContent:'space-between',gap:'8px',alignItems:'center',flexWrap:'wrap'}}><span style={{fontSize:'8px',color:'#708998'}}>{note.length}/500</span><div style={{display:'flex',gap:'7px'}}><button type="button" style={secondaryButton} onClick={cancel} disabled={saving}>Cancel</button><button type="button" style={actionButton} onClick={()=>void submit()} disabled={saving||!note.trim()}>{saving?'Saving…':action==='ACKNOWLEDGE'?'Confirm acknowledgement':'Confirm resolution'}</button></div></div></div>}
            <details style={{marginTop:'10px'}}><summary style={{cursor:'pointer',fontSize:'9px',color:'#8fdaf0',fontWeight:800}}>Exception history ({rowEvents.length})</summary><div style={{marginTop:'7px',borderLeft:'1px solid #294050',paddingLeft:'10px'}}>{rowEvents.length===0?<span style={{fontSize:'9px',color:'#708998'}}>No history events recorded.</span>:rowEvents.map(event=><div key={event.id} style={{padding:'5px 0'}}><div style={{fontSize:'9px',fontWeight:850,color:'#c4d3dc'}}>{event.event_type.replaceAll('_',' ')} · {utc(event.occurred_at)}</div>{event.note&&<div style={{marginTop:'2px',fontSize:'9px',lineHeight:1.4,color:'#91a6b8'}}>{event.note}</div>}</div>)}</div></details>
          </article>
        })}
      </div>
    </div>
  </section>
}

const filterButton:React.CSSProperties={border:'1px solid #2b4556',background:'#0a1822',color:'#91a6b8',borderRadius:'999px',padding:'6px 9px',fontSize:'8px',fontWeight:900,cursor:'pointer'}
const activeFilterButton:React.CSSProperties={borderColor:'#59d0f0',color:'#dff7ff',background:'rgba(89,208,240,.10)'}
const actionButton:React.CSSProperties={border:'1px solid #3b7187',background:'#123247',color:'#dff7ff',borderRadius:'8px',padding:'7px 10px',fontSize:'9px',fontWeight:850,cursor:'pointer'}
const resolveButton:React.CSSProperties={...actionButton,borderColor:'#5a6170',background:'#202935',color:'#d7e0e6'}
const secondaryButton:React.CSSProperties={...actionButton,borderColor:'#344654',background:'transparent',color:'#aabcc8'}
const textarea:React.CSSProperties={display:'block',width:'100%',margin:'7px 0',resize:'vertical',border:'1px solid #385267',borderRadius:'7px',background:'#0b1722',color:'#edf5fb',padding:'8px',fontSize:'10px',lineHeight:1.45}
function Badge({label,colour}:{label:string;colour:string}){return <span style={{fontSize:'8px',fontWeight:900,color:colour,border:`1px solid ${colour}55`,borderRadius:'999px',padding:'4px 6px'}}>{label}</span>}
function Data({label,value}:{label:string;value:string}){return <div style={{border:'1px solid #1d3341',background:'#08131c',borderRadius:'7px',padding:'7px'}}><div style={{fontSize:'7px',color:'#708998',textTransform:'uppercase',letterSpacing:'.10em',fontWeight:850}}>{label}</div><div style={{marginTop:'3px',fontSize:'9px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div></div>}
function Note({label,value}:{label:string;value:string}){return <div style={{marginTop:'8px',fontSize:'9px',lineHeight:1.45,color:'#91a6b8'}}><strong style={{color:'#b8c9d4'}}>{label}:</strong> {value}</div>}
function Empty({text}:{text:string}){return <div style={{padding:'15px',fontSize:'10px',lineHeight:1.5,color:'#91a6b8'}}>{text}</div>}
