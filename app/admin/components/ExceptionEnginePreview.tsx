'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type ExceptionRow={
  id:string
  exception_type:string
  severity:'ADVISORY'|'WARNING'|'CRITICAL'
  lifecycle_status:'OPEN'|'ACKNOWLEDGED'|'RESOLVED'
  title:string
  detail:string
  detected_at:string
  last_detected_at:string
  resolved_at:string|null
  resolution_reason:string|null
  danger_area_id:string|null
  operational_period_id:string|null
}

function utc(value:string|null){
  if(!value)return'—'
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'UTC',
    day:'2-digit',
    month:'short',
    year:'numeric',
    hour:'2-digit',
    minute:'2-digit',
    second:'2-digit',
    hour12:false
  }).format(new Date(value))+' UTC'
}

function tone(severity:string,status:string){
  if(status==='RESOLVED')return{fg:'#91a6b8',border:'rgba(145,166,184,.28)',bg:'rgba(145,166,184,.05)'}
  if(severity==='CRITICAL')return{fg:'#ff9299',border:'rgba(255,90,100,.42)',bg:'rgba(255,90,100,.07)'}
  if(severity==='WARNING')return{fg:'#fbbf24',border:'rgba(245,158,11,.38)',bg:'rgba(217,119,6,.06)'}
  return{fg:'#8fdaf0',border:'rgba(89,208,240,.35)',bg:'rgba(89,208,240,.05)'}
}

export default function ExceptionEnginePreview(){
  const supabase=useMemo(()=>createClient(),[])
  const [rows,setRows]=useState<ExceptionRow[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  async function load(){
    const {data,error}=await supabase
      .from('operational_exceptions')
      .select('id,exception_type,severity,lifecycle_status,title,detail,detected_at,last_detected_at,resolved_at,resolution_reason,danger_area_id,operational_period_id')
      .order('detected_at',{ascending:false})
      .limit(30)

    if(error){
      setError('Unable to load operational exceptions.')
      setLoading(false)
      return
    }

    setRows((data??[]) as ExceptionRow[])
    setError('')
    setLoading(false)
  }

  useEffect(()=>{
    load()

    const channel=supabase
      .channel('dass-admin-exceptions')
      .on('postgres_changes',{event:'*',schema:'public',table:'operational_exceptions'},()=>load())
      .subscribe()

    const timer=window.setInterval(load,60000)

    return()=>{
      window.clearInterval(timer)
      supabase.removeChannel(channel)
    }
  },[supabase])

  const open=rows.filter(r=>r.lifecycle_status!=='RESOLVED')
  const critical=open.filter(r=>r.severity==='CRITICAL').length
  const warning=open.filter(r=>r.severity==='WARNING').length

  return(
    <section style={{
      width:'calc(100% - 28px)',
      maxWidth:'1280px',
      margin:'14px auto 0',
      border:'1px solid #203243',
      background:'#0b1722',
      borderRadius:'13px',
      overflow:'hidden'
    }}>
      <div style={{padding:'12px 14px',display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'center',flexWrap:'wrap'}}>
        <div>
          <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>
            ALPHA 0.7.0 · EXCEPTION ENGINE
          </div>
          <div style={{marginTop:'4px',fontSize:'14px',fontWeight:850}}>Operational Exceptions</div>
          <div style={{marginTop:'3px',fontSize:'10px',lineHeight:1.45,color:'#7892a4'}}>
            Read-only engine preview. Exceptions identify abnormal operational or technical conditions; acknowledgement and resolution controls arrive in later 0.7 releases.
          </div>
        </div>
        <div style={{display:'flex',gap:'7px',flexWrap:'wrap'}}>
          <Badge label={`${critical} CRITICAL`} colour={critical?'#ff9299':'#84e8b0'}/>
          <Badge label={`${warning} WARNING`} colour={warning?'#fbbf24':'#84e8b0'}/>
          <Badge label={`${open.length} OPEN`} colour={open.length?'#fbbf24':'#84e8b0'}/>
        </div>
      </div>

      <div style={{borderTop:'1px solid #203243',padding:'10px 12px'}}>
        {loading&&<div style={{padding:'8px',fontSize:'10px',color:'#91a6b8'}}>Loading exception engine state…</div>}
        {error&&<div style={{padding:'8px',fontSize:'10px',color:'#ffb1b6'}}>{error}</div>}

        {!loading&&!error&&rows.length===0&&(
          <div style={{padding:'10px',fontSize:'10px',lineHeight:1.5,color:'#91a6b8'}}>
            No operational exceptions have been detected. The exception evaluator continues to run automatically once per minute.
          </div>
        )}

        {!loading&&!error&&rows.length>0&&(
          <div style={{display:'grid',gap:'8px'}}>
            {rows.map(row=>{
              const t=tone(row.severity,row.lifecycle_status)
              return(
                <article key={row.id} style={{border:`1px solid ${t.border}`,background:t.bg,borderRadius:'9px',padding:'10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'flex-start',flexWrap:'wrap'}}>
                    <div>
                      <strong style={{fontSize:'11px'}}>{row.title}</strong>
                      <div style={{marginTop:'4px',fontSize:'9px',lineHeight:1.45,color:'#a3b6c2'}}>{row.detail}</div>
                    </div>
                    <div style={{display:'flex',gap:'6px'}}>
                      <Badge label={row.severity} colour={t.fg}/>
                      <Badge label={row.lifecycle_status} colour={row.lifecycle_status==='RESOLVED'?'#91a6b8':'#8fdaf0'}/>
                    </div>
                  </div>
                  <div style={{marginTop:'8px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:'6px'}}>
                    <Data label="Type" value={row.exception_type.replaceAll('_',' ')}/>
                    <Data label="Detected" value={utc(row.detected_at)}/>
                    <Data label="Last detected" value={utc(row.last_detected_at)}/>
                    <Data label="Resolved" value={utc(row.resolved_at)}/>
                  </div>
                  {row.resolution_reason&&(
                    <div style={{marginTop:'7px',fontSize:'9px',lineHeight:1.45,color:'#91a6b8'}}>
                      Resolution: {row.resolution_reason}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function Badge({label,colour}:{label:string;colour:string}){
  return <span style={{fontSize:'8px',fontWeight:900,color:colour,border:`1px solid ${colour}55`,borderRadius:'999px',padding:'4px 6px'}}>{label}</span>
}

function Data({label,value}:{label:string;value:string}){
  return <div style={{border:'1px solid #1d3341',background:'#08131c',borderRadius:'7px',padding:'7px'}}><div style={{fontSize:'7px',color:'#708998',textTransform:'uppercase',letterSpacing:'.10em',fontWeight:850}}>{label}</div><div style={{marginTop:'3px',fontSize:'9px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div></div>
}
