'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabase/client'

type Period={
  id:string
  danger_area_id:string
  starts_at:string
  ends_at:string
  reference:string|null
  source:'MANUAL'|'NOTAM_IMPORT'|'SYSTEM'
  period_status:'PLANNED'|'CANCELLED'|'COMPLETED'
  notes:string|null
  created_at:string
  updated_at:string
  cancelled_at:string|null
  danger_areas:{code:string;name:string}|null
}

type PeriodEvent={
  id:number
  operational_period_id:string
  danger_area_id:string
  event_type:'CREATED'|'AMENDED'|'CANCELLED'
  changed_at:string
  summary:string
}

type Area={id:string;code:string;name:string}

type Props={mode:'admin'|'operator'}

function utc(value:string|null){
  if(!value)return'—'
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'UTC',
    day:'2-digit',
    month:'short',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit',
    hour12:false
  }).format(new Date(value))+' UTC'
}

function toUtcInput(value:string){
  return new Date(value).toISOString().slice(0,16)
}

function utcInputToIso(value:string){
  if(!value)throw new Error('UTC date/time is required')
  const iso=value.length===16?`${value}:00Z`:`${value}Z`
  const date=new Date(iso)
  if(Number.isNaN(date.getTime()))throw new Error('Invalid UTC date/time')
  return date.toISOString()
}

function statusStyle(status:string){
  if(status==='CANCELLED')return{color:'#ff9299',border:'rgba(255,90,100,.38)',bg:'rgba(255,90,100,.08)'}
  if(status==='COMPLETED')return{color:'#91a6b8',border:'rgba(145,166,184,.30)',bg:'rgba(145,166,184,.06)'}
  return{color:'#8fdaf0',border:'rgba(89,208,240,.38)',bg:'rgba(89,208,240,.07)'}
}

export default function OperationalPeriodsPreview({mode}:Props){
  const supabase=useMemo(()=>createClient(),[])
  const [periods,setPeriods]=useState<Period[]>([])
  const [events,setEvents]=useState<PeriodEvent[]>([])
  const [areas,setAreas]=useState<Area[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [working,setWorking]=useState(false)
  const [showCreate,setShowCreate]=useState(false)
  const [editing,setEditing]=useState<Period|null>(null)
  const [cancelling,setCancelling]=useState<Period|null>(null)
  const [areaId,setAreaId]=useState('')
  const [startsAt,setStartsAt]=useState('')
  const [endsAt,setEndsAt]=useState('')
  const [reference,setReference]=useState('')
  const [notes,setNotes]=useState('')
  const [cancelReason,setCancelReason]=useState('')

  async function load(){
    setLoading(true)
    setError('')

    const periodQuery=supabase
      .from('operational_periods')
      .select('id,danger_area_id,starts_at,ends_at,reference,source,period_status,notes,created_at,updated_at,cancelled_at,danger_areas(code,name)')
      .order('starts_at',{ascending:true})
      .limit(50)

    const eventQuery=supabase
      .from('operational_period_events')
      .select('id,operational_period_id,danger_area_id,event_type,changed_at,summary')
      .order('changed_at',{ascending:false})
      .limit(100)

    const areaQuery=mode==='admin'
      ? supabase.from('danger_areas').select('id,code,name').order('code',{ascending:true})
      : Promise.resolve({data:[],error:null})

    const [periodResult,eventResult,areaResult]=await Promise.all([periodQuery,eventQuery,areaQuery])

    if(periodResult.error||eventResult.error||('error' in areaResult&&areaResult.error)){
      setError('Unable to load operational-period data.')
      setLoading(false)
      return
    }

    setPeriods((periodResult.data??[]) as unknown as Period[])
    setEvents((eventResult.data??[]) as PeriodEvent[])
    if(mode==='admin')setAreas(((areaResult as {data:Area[]|null}).data??[]) as Area[])
    setLoading(false)
  }

  useEffect(()=>{load()},[])

  async function invoke(body:Record<string,unknown>){
    setWorking(true)
    setError('')
    const {data,error}=await supabase.functions.invoke('admin-operational-period-management',{body})
    setWorking(false)
    if(error){
      setError(error.message||'Operational period request failed.')
      return null
    }
    if(data?.error){
      setError(String(data.error))
      return null
    }
    return data
  }

  function openCreate(){
    setAreaId(areas[0]?.id??'')
    setStartsAt('')
    setEndsAt('')
    setReference('')
    setNotes('')
    setShowCreate(true)
    setError('')
  }

  function openEdit(period:Period){
    setEditing(period)
    setStartsAt(toUtcInput(period.starts_at))
    setEndsAt(toUtcInput(period.ends_at))
    setReference(period.reference??'')
    setNotes(period.notes??'')
    setError('')
  }

  async function createPeriod(){
    try{
      if(!areaId)throw new Error('Select a Danger Area.')
      const start=utcInputToIso(startsAt)
      const end=utcInputToIso(endsAt)
      const data=await invoke({
        action:'CREATE_PERIOD',
        dangerAreaId:areaId,
        startsAt:start,
        endsAt:end,
        reference:reference.trim(),
        notes:notes.trim(),
      })
      if(!data)return
      setShowCreate(false)
      await load()
    }catch(err){
      setError(err instanceof Error?err.message:'Invalid operational period.')
    }
  }

  async function amendPeriod(){
    if(!editing)return
    try{
      const start=utcInputToIso(startsAt)
      const end=utcInputToIso(endsAt)
      const data=await invoke({
        action:'AMEND_PERIOD',
        periodId:editing.id,
        startsAt:start,
        endsAt:end,
        reference:reference.trim(),
        notes:notes.trim(),
      })
      if(!data)return
      setEditing(null)
      await load()
    }catch(err){
      setError(err instanceof Error?err.message:'Invalid operational period.')
    }
  }

  async function cancelPeriod(){
    if(!cancelling)return
    const reason=cancelReason.trim()
    if(reason.length<5){
      setError('Enter a meaningful cancellation reason.')
      return
    }
    const data=await invoke({
      action:'CANCEL_PERIOD',
      periodId:cancelling.id,
      reason,
    })
    if(!data)return
    setCancelling(null)
    setCancelReason('')
    await load()
  }

  const visible=periods.filter(p=>{
    if(p.period_status==='CANCELLED')return true
    return new Date(p.ends_at).getTime()>=Date.now()-86400000
  })

  return(
    <>
      <section style={{
        margin:'14px auto 0',
        width:'calc(100% - 28px)',
        maxWidth:mode==='admin'?'1280px':'1180px',
        border:'1px solid rgba(89,208,240,.25)',
        background:'#0b1722',
        borderRadius:'13px',
        overflow:'hidden'
      }}>
        <div style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'center',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>
              ALPHA 0.6.1 · OPERATIONAL PERIOD MANAGEMENT
            </div>
            <div style={{marginTop:'4px',fontWeight:850,fontSize:'14px'}}>Operational Periods</div>
            <div style={{marginTop:'3px',fontSize:'10px',lineHeight:1.45,color:'#7892a4'}}>
              {mode==='admin'
                ? 'Administrative promulgation records. Creating or amending a period does not activate a Danger Area.'
                : 'Read-only promulgation records for your assigned Danger Areas. These records do not themselves declare a DA ACTIVE.'}
            </div>
          </div>
          <div style={{display:'flex',gap:'8px',alignItems:'center',flexWrap:'wrap'}}>
            <span style={{fontSize:'9px',fontWeight:900,color:'#fbbf24',border:'1px solid rgba(245,158,11,.35)',background:'rgba(217,119,6,.06)',padding:'5px 7px',borderRadius:'999px'}}>NOT STATUS AUTHORITY</span>
            {mode==='admin'&&<button onClick={openCreate} style={primaryCompact}>+ Create period</button>}
          </div>
        </div>

        <div style={{borderTop:'1px solid #203243',padding:'10px 12px'}}>
          {loading&&<div style={{padding:'8px',fontSize:'10px',color:'#91a6b8'}}>Loading operational periods…</div>}
          {error&&<div style={errorBox}>{error}</div>}

          {!loading&&!error&&visible.length===0&&(
            <div style={{padding:'10px',fontSize:'10px',lineHeight:1.5,color:'#91a6b8'}}>
              No operational periods are currently recorded.
            </div>
          )}

          {!loading&&visible.length>0&&(
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(280px,1fr))',gap:'8px'}}>
              {visible.map(period=>{
                const s=statusStyle(period.period_status)
                const history=events.filter(e=>e.operational_period_id===period.id)
                return(
                  <article key={period.id} style={{border:'1px solid #203746',background:'#091720',borderRadius:'9px',padding:'10px'}}>
                    <div style={{display:'flex',justifyContent:'space-between',gap:'9px',alignItems:'flex-start'}}>
                      <div>
                        <strong style={{fontSize:'11px',color:'#edf5fb'}}>{period.danger_areas?.code??'Danger Area'}</strong>
                        <div style={{marginTop:'2px',fontSize:'9px',color:'#7892a4'}}>{period.danger_areas?.name??''}</div>
                      </div>
                      <span style={{fontSize:'8px',fontWeight:900,color:s.color,border:`1px solid ${s.border}`,background:s.bg,borderRadius:'999px',padding:'4px 6px'}}>{period.period_status}</span>
                    </div>

                    <div style={{marginTop:'9px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                      <Data label="Starts" value={utc(period.starts_at)}/>
                      <Data label="Ends" value={utc(period.ends_at)}/>
                      <Data label="Reference" value={period.reference??'—'}/>
                      <Data label="Source" value={period.source}/>
                    </div>

                    {period.notes&&<div style={{marginTop:'7px',fontSize:'9px',lineHeight:1.45,color:'#91a6b8'}}>{period.notes}</div>}

                    {history.length>0&&(
                      <details style={{marginTop:'8px'}}>
                        <summary style={{cursor:'pointer',fontSize:'9px',color:'#8fdaf0'}}>History ({history.length})</summary>
                        <div style={{display:'grid',gap:'5px',marginTop:'6px'}}>
                          {history.map(event=><div key={event.id} style={{borderLeft:'2px solid #294b5d',paddingLeft:'7px',fontSize:'8px',lineHeight:1.4,color:'#8097a7'}}><strong style={{color:'#a8c7d6'}}>{event.event_type}</strong> · {utc(event.changed_at)}<div>{event.summary}</div></div>)}
                        </div>
                      </details>
                    )}

                    {mode==='admin'&&period.period_status==='PLANNED'&&(
                      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px',marginTop:'9px'}}>
                        <button onClick={()=>openEdit(period)} style={smallButton}>Amend</button>
                        <button onClick={()=>{setCancelling(period);setCancelReason('');setError('')}} style={{...smallButton,borderColor:'rgba(255,90,100,.45)',color:'#ffb1b6'}}>Cancel</button>
                      </div>
                    )}
                  </article>
                )
              })}
            </div>
          )}
        </div>
      </section>

      {showCreate&&(
        <Modal title="Create Operational Period" onClose={()=>setShowCreate(false)}>
          <Field label="Danger Area">
            <select value={areaId} onChange={e=>setAreaId(e.target.value)} style={input}>
              <option value="">Select Danger Area…</option>
              {areas.map(a=><option key={a.id} value={a.id}>{a.code} — {a.name}</option>)}
            </select>
          </Field>
          <UtcFields startsAt={startsAt} endsAt={endsAt} setStartsAt={setStartsAt} setEndsAt={setEndsAt}/>
          <Field label="Reference / NOTAM identifier (optional)"><input value={reference} onChange={e=>setReference(e.target.value.slice(0,120))} style={input}/></Field>
          <Field label="Administrative notes (optional)"><textarea value={notes} onChange={e=>setNotes(e.target.value.slice(0,1000))} rows={3} style={{...input,resize:'vertical'}}/></Field>
          <div style={notice}><strong>Important:</strong> creating this record establishes a promulgated operational period in DASS only. It does not declare the Danger Area ACTIVE.</div>
          <button disabled={working} onClick={createPeriod} style={primaryButton}>{working?'Creating…':'Create operational period'}</button>
        </Modal>
      )}

      {editing&&(
        <Modal title={`Amend Operational Period — ${editing.danger_areas?.code??'DA'}`} onClose={()=>setEditing(null)}>
          <UtcFields startsAt={startsAt} endsAt={endsAt} setStartsAt={setStartsAt} setEndsAt={setEndsAt}/>
          <Field label="Reference / NOTAM identifier (optional)"><input value={reference} onChange={e=>setReference(e.target.value.slice(0,120))} style={input}/></Field>
          <Field label="Administrative notes (optional)"><textarea value={notes} onChange={e=>setNotes(e.target.value.slice(0,1000))} rows={3} style={{...input,resize:'vertical'}}/></Field>
          <div style={notice}>The previous values will be retained in the immutable Operational Period history. Amendment does not change DA operational state.</div>
          <button disabled={working} onClick={amendPeriod} style={primaryButton}>{working?'Saving…':'Save amendment'}</button>
        </Modal>
      )}

      {cancelling&&(
        <Modal title={`Cancel Operational Period — ${cancelling.danger_areas?.code??'DA'}`} onClose={()=>setCancelling(null)}>
          <div style={{fontSize:'10px',lineHeight:1.5,color:'#ffb5ba'}}>Cancellation marks this promulgation record CANCELLED. It does not issue a STAND DOWN command and does not alter any current Danger Area declaration.</div>
          <Field label="Cancellation reason">
            <textarea value={cancelReason} onChange={e=>setCancelReason(e.target.value.slice(0,500))} rows={4} style={{...input,resize:'vertical'}}/>
          </Field>
          <button disabled={working} onClick={cancelPeriod} style={{...primaryButton,background:'#8f2932',borderColor:'#d2545e'}}>{working?'Cancelling…':'Confirm cancellation'}</button>
        </Modal>
      )}
    </>
  )
}

function UtcFields({startsAt,endsAt,setStartsAt,setEndsAt}:{startsAt:string;endsAt:string;setStartsAt:(v:string)=>void;setEndsAt:(v:string)=>void}){
  return(
    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
      <Field label="Starts (UTC)"><input type="datetime-local" value={startsAt} onChange={e=>setStartsAt(e.target.value)} style={input}/></Field>
      <Field label="Ends (UTC)"><input type="datetime-local" value={endsAt} onChange={e=>setEndsAt(e.target.value)} style={input}/></Field>
    </div>
  )
}

function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}){
  return <div role="dialog" aria-modal="true" style={overlay}><div style={modal}><div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'center'}}><h2 style={{margin:0,fontSize:'18px'}}>{title}</h2><button onClick={onClose} style={smallButton}>Close</button></div><div style={{display:'grid',gap:'11px',marginTop:'15px'}}>{children}</div></div></div>
}

function Field({label,children}:{label:string;children:React.ReactNode}){
  return <label style={{display:'grid',gap:'6px',fontSize:'10px',color:'#a9bbc7'}}>{label}{children}</label>
}

function Data({label,value}:{label:string;value:string}){
  return <div style={{border:'1px solid #1d3341',background:'#08131c',borderRadius:'7px',padding:'7px'}}><div style={{fontSize:'7px',color:'#708998',textTransform:'uppercase',letterSpacing:'.10em',fontWeight:850}}>{label}</div><div style={{marginTop:'3px',fontSize:'9px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div></div>
}

const input:React.CSSProperties={width:'100%',boxSizing:'border-box',background:'#08131c',border:'1px solid #2a4050',borderRadius:'8px',color:'#edf5fb',padding:'10px'}
const primaryCompact:React.CSSProperties={background:'#17657a',border:'1px solid #4a8ca0',color:'white',fontWeight:850,borderRadius:'8px',padding:'8px 10px',fontSize:'10px',cursor:'pointer'}
const primaryButton:React.CSSProperties={width:'100%',background:'#17657a',border:'1px solid #41849a',color:'white',borderRadius:'9px',padding:'11px',fontWeight:850,cursor:'pointer'}
const smallButton:React.CSSProperties={background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'7px',padding:'7px 8px',fontSize:'9px',cursor:'pointer'}
const overlay:React.CSSProperties={position:'fixed',inset:0,zIndex:8000,background:'rgba(2,8,13,.86)',display:'grid',placeItems:'center',padding:'18px'}
const modal:React.CSSProperties={width:'min(580px,100%)',maxHeight:'90dvh',overflowY:'auto',background:'#0b1722',border:'1px solid #334b5b',borderRadius:'15px',padding:'19px',boxShadow:'0 30px 90px rgba(0,0,0,.65)'}
const notice:React.CSSProperties={borderLeft:'3px solid #d97706',paddingLeft:'10px',fontSize:'9px',lineHeight:1.5,color:'#cfbf9d'}
const errorBox:React.CSSProperties={marginBottom:'8px',borderLeft:'3px solid #ff5a64',background:'rgba(255,90,100,.07)',padding:'8px 10px',fontSize:'9px',color:'#ffc0c4'}
