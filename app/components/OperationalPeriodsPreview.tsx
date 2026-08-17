'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '../../lib/supabase/client'

type Period = {
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
  danger_areas:{code:string;name:string}|null
}

type Props = {
  mode:'admin'|'operator'
}

function utc(value:string){
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

function statusStyle(status:string){
  if(status==='CANCELLED') return {color:'#ff9299',border:'rgba(255,90,100,.38)',bg:'rgba(255,90,100,.08)'}
  if(status==='COMPLETED') return {color:'#91a6b8',border:'rgba(145,166,184,.30)',bg:'rgba(145,166,184,.06)'}
  return {color:'#8fdaf0',border:'rgba(89,208,240,.38)',bg:'rgba(89,208,240,.07)'}
}

export default function OperationalPeriodsPreview({mode}:Props){
  const supabase=useMemo(()=>createClient(),[])
  const [periods,setPeriods]=useState<Period[]>([])
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  useEffect(()=>{
    let cancelled=false
    async function load(){
      const {data,error}=await supabase
        .from('operational_periods')
        .select('id,danger_area_id,starts_at,ends_at,reference,source,period_status,notes,created_at,updated_at,danger_areas(code,name)')
        .order('starts_at',{ascending:true})
        .limit(20)

      if(cancelled)return

      if(error){
        setError('Unable to load operational-period records.')
        setLoading(false)
        return
      }

      setPeriods((data??[]) as unknown as Period[])
      setLoading(false)
    }

    load()
    return()=>{cancelled=true}
  },[supabase])

  const currentOrFuture=periods.filter(p=>{
    if(p.period_status==='CANCELLED')return true
    return new Date(p.ends_at).getTime() >= Date.now()-86400000
  })

  return(
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
            ALPHA 0.6.0 · OPERATIONAL PERIOD MODEL
          </div>
          <div style={{marginTop:'4px',fontWeight:850,fontSize:'14px'}}>
            Operational Periods
          </div>
          <div style={{marginTop:'3px',fontSize:'10px',lineHeight:1.45,color:'#7892a4'}}>
            Read-only preview. These records do not yet control DA status, reporting windows or notifications.
          </div>
        </div>
        <span style={{fontSize:'9px',fontWeight:900,color:'#fbbf24',border:'1px solid rgba(245,158,11,.35)',background:'rgba(217,119,6,.06)',padding:'5px 7px',borderRadius:'999px'}}>
          MODEL ONLY
        </span>
      </div>

      <div style={{borderTop:'1px solid #203243',padding:'10px 12px'}}>
        {loading&&<div style={{padding:'8px',fontSize:'10px',color:'#91a6b8'}}>Loading operational periods…</div>}
        {error&&<div style={{padding:'8px',fontSize:'10px',color:'#ffb1b6'}}>{error}</div>}

        {!loading&&!error&&currentOrFuture.length===0&&(
          <div style={{padding:'10px',fontSize:'10px',lineHeight:1.5,color:'#91a6b8'}}>
            No operational periods have been created yet. This is expected in Alpha 0.6.0: the data model is live, but period creation is intentionally reserved for Alpha 0.6.1.
          </div>
        )}

        {!loading&&!error&&currentOrFuture.length>0&&(
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))',gap:'8px'}}>
            {currentOrFuture.map(period=>{
              const s=statusStyle(period.period_status)
              return(
                <article key={period.id} style={{border:'1px solid #203746',background:'#091720',borderRadius:'9px',padding:'10px'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'9px',alignItems:'flex-start'}}>
                    <div>
                      <strong style={{fontSize:'11px',color:'#edf5fb'}}>
                        {period.danger_areas?.code??'Danger Area'}
                      </strong>
                      <div style={{marginTop:'2px',fontSize:'9px',color:'#7892a4'}}>
                        {period.danger_areas?.name??''}
                      </div>
                    </div>
                    <span style={{fontSize:'8px',fontWeight:900,color:s.color,border:`1px solid ${s.border}`,background:s.bg,borderRadius:'999px',padding:'4px 6px'}}>
                      {period.period_status}
                    </span>
                  </div>

                  <div style={{marginTop:'9px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                    <Data label="Starts" value={utc(period.starts_at)}/>
                    <Data label="Ends" value={utc(period.ends_at)}/>
                    <Data label="Reference" value={period.reference??'—'}/>
                    <Data label="Source" value={period.source}/>
                  </div>

                  {period.notes&&(
                    <div style={{marginTop:'7px',fontSize:'9px',lineHeight:1.45,color:'#91a6b8'}}>
                      {period.notes}
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

function Data({label,value}:{label:string;value:string}){
  return(
    <div style={{border:'1px solid #1d3341',background:'#08131c',borderRadius:'7px',padding:'7px'}}>
      <div style={{fontSize:'7px',color:'#708998',textTransform:'uppercase',letterSpacing:'.10em',fontWeight:850}}>
        {label}
      </div>
      <div style={{marginTop:'3px',fontSize:'9px',color:'#c4d3dc',lineHeight:1.3}}>
        {value}
      </div>
    </div>
  )
}
