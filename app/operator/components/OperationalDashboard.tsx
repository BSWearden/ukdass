'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import StatusControls from './StatusControls'
import { logout } from '../actions'
import type { AssignedArea, StatusEvent } from '../page'

type Props = {
  operatorName: string
  organisation: string
  assigned: AssignedArea[]
  events: StatusEvent[]
}

type Attention = {
  priority: number
  tone: 'red' | 'amber' | 'cyan' | 'green'
  label: string
  title: string
  detail: string
  area: AssignedArea
}

function formatUtc(value: string | null, seconds = false) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC', day:'2-digit', month:'short', year:'numeric',
    hour:'2-digit', minute:'2-digit',
    second:seconds ? '2-digit' : undefined, hour12:false
  }).format(new Date(value)) + ' UTC'
}

function formatClock(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone:'UTC', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false
  }).format(date) + 'Z'
}

function durationUntil(target: string | null, now: number) {
  if (!target) return null
  const ms = new Date(target).getTime() - now
  if (ms <= 0) return 'now'
  const totalSeconds = Math.floor(ms / 1000)
  const days = Math.floor(totalSeconds / 86400)
  const hours = Math.floor((totalSeconds % 86400) / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${String(seconds).padStart(2,'0')}s`
}

function statusPalette(status: string) {
  if (status === 'ACTIVE') return {fg:'#ff9299',bg:'rgba(255,90,100,.13)',border:'rgba(255,90,100,.40)'}
  if (status === 'INACTIVE') return {fg:'#84e8b0',bg:'rgba(79,209,139,.12)',border:'rgba(79,209,139,.36)'}
  return {fg:'#fbbf24',bg:'rgba(217,119,6,.12)',border:'rgba(245,158,11,.42)'}
}

function attentionFor(area: AssignedArea, now: number): Attention | null {
  if (area.reporting_window_open && area.effective_status === 'UNVERIFIED') {
    return {priority:0,tone:'red',label:'ATTENTION',title:`${area.code} reporting period is open`,
      detail:'No valid operator declaration exists. Public DASS status is UNVERIFIED.',area}
  }
  if (area.activation_scheduled && !area.reporting_window_open) {
    return {priority:1,tone:'cyan',label:'SCHEDULED',title:`${area.code} activation pending`,
      detail:`Becomes ACTIVE in ${durationUntil(area.scheduled_activation_at,now) ?? '—'} at ${formatUtc(area.scheduled_activation_at)}.`,area}
  }
  if (area.pre_activation_window_open && !area.activation_scheduled) {
    return {priority:2,tone:'cyan',label:'ACTION AVAILABLE',title:`${area.code} pre-activation available`,
      detail:`Reporting period opens in ${durationUntil(area.reporting_window_start_at,now) ?? '—'}.`,area}
  }
  if (area.effective_status === 'ACTIVE') {
    return {priority:3,tone:'red',label:'ACTIVE',title:`${area.code} currently ACTIVE`,
      detail:area.status_valid_until ? `Declaration valid for ${durationUntil(area.status_valid_until,now) ?? '—'}.` : 'Active declaration has no current validity timestamp.',area}
  }
  if (area.status_valid_until &&
      new Date(area.status_valid_until).getTime()-now <= 15*60*1000 &&
      new Date(area.status_valid_until).getTime()>now) {
    return {priority:4,tone:'amber',label:'EXPIRY APPROACHING',title:`${area.code} declaration nearing expiry`,
      detail:`Current declaration expires in ${durationUntil(area.status_valid_until,now) ?? '—'}.`,area}
  }
  return null
}

function tone(t: Attention['tone']) {
  if (t==='red') return {border:'rgba(255,90,100,.42)',bg:'rgba(255,90,100,.07)',fg:'#ff9299'}
  if (t==='amber') return {border:'rgba(245,158,11,.42)',bg:'rgba(217,119,6,.08)',fg:'#fbbf24'}
  if (t==='green') return {border:'rgba(79,209,139,.35)',bg:'rgba(79,209,139,.07)',fg:'#84e8b0'}
  return {border:'rgba(89,208,240,.38)',bg:'rgba(89,208,240,.06)',fg:'#8fdaf0'}
}

function eventTitle(event: StatusEvent) {
  if (event.event_type==='ACTIVATION_SCHEDULED') return 'Activation scheduled'
  if (event.event_type==='ACTIVATION_CANCELLED') return 'Scheduled activation cancelled'
  if (event.event_type==='SCHEDULED_ACTIVATION_EFFECTIVE') return `${event.previous_status ?? 'UNVERIFIED'} → ACTIVE`
  if (event.event_type==='SCHEDULED_ACTIVATION_EXPIRED') return 'Scheduled activation expired'
  return `${event.previous_status ?? '—'} → ${event.new_status ?? '—'}`
}

export default function OperationalDashboard({operatorName,organisation,assigned,events}:Props) {
  const router=useRouter()
  const [clock,setClock]=useState(new Date())
  const [showHistory,setShowHistory]=useState(false)
  const [online,setOnline]=useState(true)
  const [lastSync,setLastSync]=useState(Date.now())
  const [refreshing,setRefreshing]=useState(false)
  const [dismissed,setDismissed]=useState<Record<string,boolean>>({})
  const mounted=useRef(false)

  useEffect(()=>{
    mounted.current=true
    setOnline(navigator.onLine)
    const tick=window.setInterval(()=>setClock(new Date()),1000)
    const onOnline=()=>{setOnline(true); setRefreshing(true); router.refresh(); setLastSync(Date.now()); window.setTimeout(()=>setRefreshing(false),1200)}
    const onOffline=()=>setOnline(false)
    window.addEventListener('online',onOnline)
    window.addEventListener('offline',onOffline)
    return ()=>{mounted.current=false;window.clearInterval(tick);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline)}
  },[router])

  useEffect(()=>{
    if(!online) return
    const poll=window.setInterval(()=>{
      setRefreshing(true)
      router.refresh()
      setLastSync(Date.now())
      window.setTimeout(()=>mounted.current && setRefreshing(false),1200)
    },30000)
    return ()=>window.clearInterval(poll)
  },[online,router])

  const now=clock.getTime()
  const stale=!online || now-lastSync>90000
  const connectionLabel=!online?'OFFLINE':stale?'STALE':refreshing?'SYNCING':'LIVE'
  const connectionColour=!online||stale?'#ff9299':refreshing?'#fbbf24':'#7be3a9'

  const attention=useMemo(()=>assigned.map(a=>attentionFor(a,now)).filter((x):x is Attention=>x!==null).sort((a,b)=>a.priority-b.priority),[assigned,now])
  const activeCount=assigned.filter(a=>a.effective_status==='ACTIVE').length
  const unverifiedOpenCount=assigned.filter(a=>a.reporting_window_open&&a.effective_status==='UNVERIFIED').length

  const popup=useMemo(()=>{
    const candidates=assigned.flatMap(area=>{
      const items:{key:string;severity:'red'|'cyan';title:string;body:string}[]=[]
      if(area.reporting_window_open && area.effective_status==='UNVERIFIED'){
        items.push({key:`open-${area.id}-${area.reporting_window_start_at}`,severity:'red',
          title:`${area.code} — OPERATOR ACTION REQUIRED`,
          body:'The promulgated reporting period is OPEN and no valid operator declaration exists. Public DASS status is UNVERIFIED. Verify the Danger Area state.'})
      } else if(area.pre_activation_window_open && !area.activation_scheduled){
        items.push({key:`pre-${area.id}-${area.reporting_window_start_at}`,severity:'cyan',
          title:`${area.code} — VERIFY PLANNED STATE`,
          body:`Promulgated activity begins at ${formatUtc(area.reporting_window_start_at)}. The pre-activation window is open. Verify the intended Danger Area state.`})
      }
      return items
    })
    return candidates.find(x=>!dismissed[x.key]) ?? null
  },[assigned,dismissed])

  return (
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(14px,3vw,24px)'}}>
      {popup && (
        <div role="dialog" aria-modal="true" style={{position:'fixed',inset:0,zIndex:5000,background:'rgba(2,8,13,.78)',display:'grid',placeItems:'center',padding:'18px'}}>
          <div style={{width:'min(520px,100%)',background:'#0b1722',border:`1px solid ${popup.severity==='red'?'rgba(255,90,100,.65)':'rgba(89,208,240,.55)'}`,borderRadius:'16px',boxShadow:'0 28px 90px rgba(0,0,0,.55)',padding:'20px'}}>
            <div style={{fontSize:'9px',fontWeight:900,letterSpacing:'.14em',color:popup.severity==='red'?'#ff9299':'#8fdaf0'}}>DASS OPERATIONAL NOTIFICATION</div>
            <h2 style={{margin:'7px 0 8px',fontSize:'20px'}}>{popup.title}</h2>
            <p style={{margin:0,color:'#afc1cc',fontSize:'12px',lineHeight:1.6}}>{popup.body}</p>
            {!online && <p style={{color:'#ff9299',fontSize:'11px',fontWeight:800}}>DASS is offline. Do not rely on the displayed state until connectivity is restored.</p>}
            <button onClick={()=>setDismissed(d=>({...d,[popup.key]:true}))} style={{marginTop:'16px',width:'100%',border:0,borderRadius:'9px',padding:'11px 12px',background:popup.severity==='red'?'#a92d37':'#17657a',color:'white',fontWeight:850,cursor:'pointer'}}>Acknowledge notification</button>
          </div>
        </div>
      )}

      <div style={{maxWidth:'1180px',margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:'18px',alignItems:'center',borderBottom:'1px solid #203243',paddingBottom:'18px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'10px',letterSpacing:'.16em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>DASS Alpha 0.4.1 · Operator dashboard</div>
            <h1 style={{margin:'5px 0 4px',fontSize:'clamp(25px,5vw,32px)'}}>Operational Status</h1>
            <div style={{color:'#91a6b8',fontSize:'13px'}}>{operatorName} · {organisation}</div>
          </div>
          <div style={{display:'flex',gap:'9px'}}>
            <a href="/" style={{textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}}>Live map</a>
            <form action={logout}><button type="submit" style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px'}}>Sign out</button></form>
          </div>
        </div>

        {(!online||stale) && <div style={{marginTop:'14px',border:'1px solid rgba(255,90,100,.48)',background:'rgba(255,90,100,.08)',borderRadius:'11px',padding:'12px 14px',fontSize:'11px',lineHeight:1.5,color:'#ffc0c4'}}>
          <strong>{!online?'CONNECTION LOST':'DATA MAY BE STALE'}.</strong> Displayed information may not represent the current DASS state. Last successful refresh: {formatClock(new Date(lastSync))}. Re-establish a current connection before relying on the dashboard or submitting an operational action.
        </div>}

        <div style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'10px'}}>
          <Summary label="UTC" value={formatClock(clock)} accent="#8fdaf0"/>
          <Summary label="Assigned" value={String(assigned.length)} accent="#d7e5ed"/>
          <Summary label="Active" value={String(activeCount)} accent={activeCount?'#ff9299':'#7be3a9'}/>
          <Summary label="Action required" value={String(attention.length)} accent={attention.length?'#fbbf24':'#7be3a9'}/>
          <Summary label="Open + unverified" value={String(unverifiedOpenCount)} accent={unverifiedOpenCount?'#ff9299':'#7be3a9'}/>
          <Summary label="System" value={connectionLabel} accent={connectionColour}/>
        </div>
        <div style={{marginTop:'7px',textAlign:'right',fontSize:'9px',color:'#607888'}}>Last synchronised {formatClock(new Date(lastSync))} · automatic refresh every 30s</div>

        <section style={{marginTop:'18px'}}>
          <div style={{display:'flex',justifyContent:'space-between',gap:'10px',alignItems:'end',marginBottom:'10px'}}>
            <div><div style={{fontSize:'10px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.14em',fontWeight:850}}>Operational attention</div><h2 style={{margin:'4px 0 0',fontSize:'20px'}}>Action Required</h2></div>
            <div style={{fontSize:'11px',color:'#718a9a'}}>{attention.length} item{attention.length===1?'':'s'}</div>
          </div>
          {attention.length===0 ? <div style={{border:'1px solid rgba(79,209,139,.26)',background:'rgba(79,209,139,.05)',borderRadius:'12px',padding:'14px 16px',color:'#bfe9d1',fontSize:'12px'}}><strong>No immediate operator action identified.</strong> Assigned Danger Areas remain visible below.</div> :
          <div style={{display:'grid',gap:'9px'}}>{attention.map(item=>{const c=tone(item.tone);return <div key={`${item.area.id}-${item.label}`} style={{border:`1px solid ${c.border}`,background:c.bg,borderRadius:'12px',padding:'13px 14px',display:'flex',justifyContent:'space-between',gap:'14px',flexWrap:'wrap'}}><div><div style={{fontSize:'9px',fontWeight:900,letterSpacing:'.12em',color:c.fg}}>{item.label}</div><div style={{marginTop:'4px',fontWeight:850,fontSize:'14px'}}>{item.title}</div><div style={{marginTop:'4px',fontSize:'11px',color:'#a8bac6'}}>{item.detail}</div></div><div style={{fontSize:'11px',fontWeight:850,color:c.fg}}>{item.area.effective_status}</div></div>})}</div>}
        </section>

        <section style={{marginTop:'24px'}}>
          <div style={{fontSize:'10px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.14em',fontWeight:850}}>Assigned airspace</div>
          <h2 style={{margin:'4px 0 12px',fontSize:'20px'}}>Danger Areas</h2>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:'14px'}}>
            {assigned.map(area=>{
              const palette=statusPalette(area.effective_status)
              const nextTime=area.activation_scheduled?area.scheduled_activation_at:area.reporting_window_open?area.reporting_window_end_at:area.reporting_window_start_at
              const nextLabel=area.activation_scheduled?'Scheduled activation':area.reporting_window_open?'Window closes':'Next window opens'
              return <article key={area.id} style={{background:'linear-gradient(180deg,#0b1722,#08131c)',border:'1px solid #203243',borderRadius:'15px',padding:'18px'}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:'12px'}}><div><div style={{color:'#8fdaf0',fontWeight:900,fontSize:'17px'}}>{area.code}</div><div style={{marginTop:'4px',color:'#b8c9d5',fontSize:'12px'}}>{area.name}</div></div><span style={{color:palette.fg,background:palette.bg,border:`1px solid ${palette.border}`,padding:'6px 9px',borderRadius:'999px',fontSize:'10px',fontWeight:900}}>{area.effective_status}</span></div>
                <div style={{marginTop:'15px',padding:'12px 13px',background:'#091720',border:'1px solid #203746',borderRadius:'10px'}}><div style={{fontSize:'9px',color:'#7892a4',textTransform:'uppercase'}}>{nextLabel}</div><div style={{marginTop:'4px',fontSize:'18px',fontWeight:850}}>{nextTime?durationUntil(nextTime,now):'—'}</div><div style={{marginTop:'3px',fontSize:'10px',color:'#7892a4'}}>{formatUtc(nextTime)}</div></div>
                <div style={{marginTop:'10px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}><CompactData label="Reporting" value={area.reporting_window_open?'OPEN':'CLOSED'}/><CompactData label="Promulgated" value={area.promulgated_period}/><CompactData label="Valid until" value={area.status_valid_until?formatUtc(area.status_valid_until):'—'}/><CompactData label="Last update" value={formatUtc(area.status_updated_at)}/></div>
                {area.activation_scheduled&&<div style={{marginTop:'10px',borderLeft:'3px solid #59d0f0',background:'rgba(89,208,240,.05)',padding:'9px 10px',fontSize:'10px'}}>Future intent recorded. Public status remains {area.effective_status} until {formatUtc(area.scheduled_activation_at)}.</div>}
                {!online||stale ? <div style={{marginTop:'14px',border:'1px solid rgba(255,90,100,.35)',background:'rgba(255,90,100,.06)',borderRadius:'9px',padding:'10px',fontSize:'10px',color:'#ffc0c4'}}><strong>Operational controls withheld while DASS data is not confirmed current.</strong> Restore connectivity and allow the dashboard to synchronise.</div> :
                <StatusControls areaId={area.id} code={area.code} currentStatus={area.effective_status} canChangeStatus={area.can_change_status} reportingWindowOpen={area.reporting_window_open} reportingWindowLabel={area.reporting_window_start_at&&area.reporting_window_end_at?`${formatUtc(area.reporting_window_start_at)} – ${formatUtc(area.reporting_window_end_at)}`:'Unavailable'} preActivationWindowOpen={area.pre_activation_window_open} preActivationLeadMinutes={area.pre_activation_lead_minutes} activationScheduled={area.activation_scheduled} scheduledActivationAt={area.scheduled_activation_at??area.reporting_window_start_at}/>}
              </article>
            })}
          </div>
        </section>

        <section style={{marginTop:'22px',border:'1px solid #203243',background:'#0b1722',borderRadius:'14px',overflow:'hidden'}}>
          <button type="button" onClick={()=>setShowHistory(v=>!v)} style={{width:'100%',background:'transparent',border:0,color:'#edf5fb',padding:'15px 17px',display:'flex',justifyContent:'space-between',cursor:'pointer',textAlign:'left'}}><span><span style={{display:'block',fontSize:'9px',color:'#7f9db0',textTransform:'uppercase'}}>Audit trail</span><strong style={{display:'block',marginTop:'3px',fontSize:'15px'}}>Recent activity</strong></span><span style={{fontSize:'12px',color:'#8fa5b4'}}>{showHistory?'Hide':`Show ${Math.min(events.length,20)}`}</span></button>
          {showHistory&&<div style={{borderTop:'1px solid #203243',padding:'12px',display:'grid',gap:'8px'}}>{events.length===0?<div style={{padding:'8px',color:'#91a6b8',fontSize:'12px'}}>No recent events.</div>:events.map(event=><div key={event.id} style={{border:'1px solid #203746',background:'#091720',borderRadius:'9px',padding:'10px 11px'}}><div style={{display:'flex',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}><strong style={{fontSize:'12px'}}>{event.danger_areas?.code??'Danger Area'} · {eventTitle(event)}</strong><span style={{fontSize:'9px',fontWeight:900,color:event.event_source==='SYSTEM'?'#fbbf24':'#8fdaf0'}}>{event.event_source==='SYSTEM'?'DASS SYSTEM':'OPERATOR'}</span></div><div style={{marginTop:'4px',fontSize:'10px',color:'#7892a4'}}>{formatUtc(event.changed_at,true)}</div>{event.note&&<div style={{marginTop:'5px',fontSize:'10px',color:'#91a6b8'}}>{event.note}</div>}</div>)}</div>}
        </section>

        <section style={{marginTop:'18px',borderLeft:'3px solid #d97706',background:'rgba(217,119,6,.055)',padding:'11px 13px',color:'#cfbf9d',fontSize:'10px',lineHeight:1.5}}>
          <strong>Demonstration system:</strong> DASS does not cancel or amend a NOTAM and does not supersede the UK AIP, ATC instructions or established Danger Area crossing procedures.
        </section>
      </div>
    </main>
  )
}

function Summary({label,value,accent}:{label:string,value:string,accent:string}) {
  return <div style={{border:'1px solid #203746',background:'#0a1822',borderRadius:'11px',padding:'11px 12px'}}><div style={{fontSize:'8px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>{label}</div><div style={{marginTop:'5px',fontSize:'17px',fontWeight:900,color:accent}}>{value}</div></div>
}
function CompactData({label,value}:{label:string,value:string}) {
  return <div style={{border:'1px solid #1d3341',background:'#091720',borderRadius:'8px',padding:'9px'}}><div style={{fontSize:'8px',color:'#708998',textTransform:'uppercase',letterSpacing:'.11em',fontWeight:850}}>{label}</div><div style={{marginTop:'4px',fontSize:'10px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div></div>
}
