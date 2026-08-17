'use client'

import { useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '../../../lib/supabase/client'
import type { AssignedArea } from '../page'

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

export default function OperatorPeriodBasis({assigned}:{assigned:AssignedArea[]}){
  const supabase=useMemo(()=>createClient(),[])
  const router=useRouter()

  useEffect(()=>{
    const channel=supabase
      .channel('dass-operator-period-basis')
      .on('postgres_changes',{event:'*',schema:'public',table:'operational_periods'},()=>{
        router.refresh()
      })
      .subscribe()

    return()=>{supabase.removeChannel(channel)}
  },[router,supabase])

  return(
    <section style={{
      width:'calc(100% - 28px)',
      maxWidth:'1180px',
      margin:'14px auto 0',
      border:'1px solid #203243',
      background:'#0b1722',
      borderRadius:'13px',
      padding:'13px'
    }}>
      <div style={{fontSize:'9px',letterSpacing:'.13em',fontWeight:900,color:'#8fdaf0'}}>
        ALPHA 0.6.2 · OPERATIONAL CONTROL BASIS
      </div>
      <div style={{marginTop:'4px',fontSize:'11px',lineHeight:1.5,color:'#91a6b8'}}>
        DASS now associates reporting windows and operational actions with a specific PLANNED operational period where one exists.
      </div>

      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(270px,1fr))',gap:'8px',marginTop:'10px'}}>
        {assigned.map(area=>{
          const periodBacked=!!area.operational_period_id
          return(
            <article key={area.id} style={{
              border:periodBacked?'1px solid rgba(89,208,240,.35)':'1px solid rgba(245,158,11,.38)',
              background:periodBacked?'rgba(89,208,240,.04)':'rgba(217,119,6,.055)',
              borderRadius:'9px',
              padding:'10px'
            }}>
              <div style={{display:'flex',justifyContent:'space-between',gap:'9px',alignItems:'flex-start',flexWrap:'wrap'}}>
                <div>
                  <strong style={{fontSize:'11px'}}>{area.code}</strong>
                  <div style={{marginTop:'2px',fontSize:'9px',color:'#7892a4'}}>{area.name}</div>
                </div>
                <span style={{
                  fontSize:'8px',
                  fontWeight:900,
                  color:periodBacked?'#8fdaf0':'#fbbf24',
                  border:`1px solid ${periodBacked?'rgba(89,208,240,.38)':'rgba(245,158,11,.40)'}`,
                  borderRadius:'999px',
                  padding:'4px 6px'
                }}>
                  {periodBacked?'OPERATIONAL PERIOD':'LEGACY FALLBACK'}
                </span>
              </div>

              <div style={{marginTop:'9px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'6px'}}>
                <Data label="Window starts" value={utc(area.reporting_window_start_at)}/>
                <Data label="Window ends" value={utc(area.reporting_window_end_at)}/>
                <Data label="Reference" value={periodBacked?(area.operational_period_reference||'No reference entered'):'Legacy DA configuration'}/>
                <Data label="Source" value={periodBacked?(area.operational_period_source||'—'):'TRANSITIONAL'}/>
              </div>

              {!periodBacked&&(
                <div style={{marginTop:'8px',fontSize:'9px',lineHeight:1.45,color:'#d6bd83'}}>
                  Transitional safeguard: no PLANNED operational period currently governs this DA, so DASS is retaining the pre-0.6 reporting window. This fallback will be removed after live period integration is proven.
                </div>
              )}
            </article>
          )
        })}
      </div>
    </section>
  )
}

function Data({label,value}:{label:string;value:string}){
  return(
    <div style={{border:'1px solid #1d3341',background:'#08131c',borderRadius:'7px',padding:'7px'}}>
      <div style={{fontSize:'7px',color:'#708998',textTransform:'uppercase',letterSpacing:'.10em',fontWeight:850}}>{label}</div>
      <div style={{marginTop:'3px',fontSize:'9px',lineHeight:1.3,color:'#c4d3dc'}}>{value}</div>
    </div>
  )
}
