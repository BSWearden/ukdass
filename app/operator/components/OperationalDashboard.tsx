'use client'

import { useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import StatusControls from './StatusControls'
import { acknowledgeOperationalNotification, logout, markOperationalNotificationSeen } from '../actions'
import type { AssignedArea, OperationalNotification, StatusEvent } from '../page'

type Props={
  operatorName:string
  organisation:string
  assigned:AssignedArea[]
  events:StatusEvent[]
  notifications:OperationalNotification[]
}

function formatUtc(value:string|null,seconds=false){
  if(!value)return'—'
  return new Intl.DateTimeFormat('en-GB',{
    timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',
    hour:'2-digit',minute:'2-digit',second:seconds?'2-digit':undefined,hour12:false
  }).format(new Date(value))+' UTC'
}
function formatClock(date:Date){
  return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(date)+'Z'
}
function durationUntil(target:string|null,now:number){
  if(!target)return null
  const ms=new Date(target).getTime()-now
  if(ms<=0)return'now'
  const t=Math.floor(ms/1000),h=Math.floor(t/3600),m=Math.floor((t%3600)/60),s=t%60
  return h>0?`${h}h ${m}m`:`${m}m ${String(s).padStart(2,'0')}s`
}
function statusPalette(status:string){
  if(status==='ACTIVE')return{fg:'#ff9299',bg:'rgba(255,90,100,.13)',border:'rgba(255,90,100,.40)'}
  if(status==='INACTIVE')return{fg:'#84e8b0',bg:'rgba(79,209,139,.12)',border:'rgba(79,209,139,.36)'}
  return{fg:'#fbbf24',bg:'rgba(217,119,6,.12)',border:'rgba(245,158,11,.42)'}
}
function notificationTitle(n:OperationalNotification){
  return n.notification_type==='PRE_START_15M'
    ? `${n.danger_areas?.code??'Danger Area'} activity period approaching`
    : `${n.danger_areas?.code??'Danger Area'} verification required`
}
function notificationBody(n:OperationalNotification){
  return n.notification_type==='PRE_START_15M'
    ? `Promulgated activity begins at ${formatUtc(n.reporting_window_start_at)}. Verify the current or planned Danger Area state.`
    : `The reporting period is open and DASS has generated an UNVERIFIED escalation. Verify the current Danger Area state.`
}

export default function OperationalDashboard({operatorName,organisation,assigned,events,notifications}:Props){
  const router=useRouter()
  const [clock,setClock]=useState(new Date())
  const [online,setOnline]=useState(true)
  const [lastSync,setLastSync]=useState(Date.now())
  const [refreshing,setRefreshing]=useState(false)
  const [showHistory,setShowHistory]=useState(false)
  const [showNotifications,setShowNotifications]=useState(true)
  const [selected,setSelected]=useState<OperationalNotification|null>(null)
  const [ackNote,setAckNote]=useState('')
  const [actionError,setActionError]=useState('')
  const [isPending,startTransition]=useTransition()
  const mounted=useRef(false)

  useEffect(()=>{
    mounted.current=true
    setOnline(navigator.onLine)
    const tick=window.setInterval(()=>setClock(new Date()),1000)
    const onOnline=()=>{setOnline(true);setRefreshing(true);router.refresh();setLastSync(Date.now());window.setTimeout(()=>setRefreshing(false),1200)}
    const onOffline=()=>setOnline(false)
    window.addEventListener('online',onOnline);window.addEventListener('offline',onOffline)
    return()=>{mounted.current=false;window.clearInterval(tick);window.removeEventListener('online',onOnline);window.removeEventListener('offline',onOffline)}
  },[router])

  useEffect(()=>{
    if(!online)return
    const poll=window.setInterval(()=>{
      setRefreshing(true);router.refresh();setLastSync(Date.now())
      window.setTimeout(()=>mounted.current&&setRefreshing(false),1200)
    },30000)
    return()=>window.clearInterval(poll)
  },[online,router])

  const now=clock.getTime()
  const stale=!online||now-lastSync>90000
  const connectionLabel=!online?'OFFLINE':stale?'STALE':refreshing?'SYNCING':'LIVE'
  const connectionColour=!online||stale?'#ff9299':refreshing?'#fbbf24':'#7be3a9'

  const activeCount=assigned.filter(a=>a.effective_status==='ACTIVE').length
  const openUnverified=assigned.filter(a=>a.reporting_window_open&&a.effective_status==='UNVERIFIED').length
  const unack=notifications.filter(n=>!n.acknowledged_at&&n.status==='SENT')
  const unseen=notifications.filter(n=>!n.seen_at&&n.status==='SENT')

  const criticalPopup=useMemo(()=>{
    const n=unack.find(x=>x.notification_type==='OPEN_UNVERIFIED') ?? unack[0] ?? null
    return n
  },[notifications])

  function openNotification(n:OperationalNotification){
    setSelected(n);setAckNote(n.acknowledgement_note??'');setActionError('')
    if(!n.seen_at){
      startTransition(async()=>{
        await markOperationalNotificationSeen(n.id)
        router.refresh()
      })
    }
  }

  function acknowledge(){
    if(!selected)return
    const fd=new FormData()
    fd.set('notification_id',selected.id)
    fd.set('note',ackNote)
    setActionError('')
    startTransition(async()=>{
      const result=await acknowledgeOperationalNotification(fd)
      if(!result.ok){setActionError(result.message??'Unable to acknowledge notification.');return}
      setSelected(null);setAckNote('');router.refresh()
    })
  }

  return(
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(14px,3vw,24px)'}}>
      {criticalPopup&&!selected&&(
        <div style={{position:'fixed',right:'16px',bottom:'16px',zIndex:4500,width:'min(390px,calc(100vw - 32px))',background:'#0b1722',border:'1px solid rgba(255,186,74,.48)',borderRadius:'13px',padding:'14px',boxShadow:'0 20px 55px rgba(0,0,0,.45)'}}>
          <div style={{fontSize:'9px',fontWeight:900,letterSpacing:'.12em',color:criticalPopup.notification_type==='OPEN_UNVERIFIED'?'#ff9299':'#8fdaf0'}}>UNACKNOWLEDGED OPERATIONAL NOTIFICATION</div>
          <div style={{marginTop:'5px',fontWeight:850,fontSize:'14px'}}>{notificationTitle(criticalPopup)}</div>
          <div style={{marginTop:'5px',fontSize:'11px',lineHeight:1.5,color:'#a9bac5'}}>{notificationBody(criticalPopup)}</div>
          <button onClick={()=>openNotification(criticalPopup)} style={{marginTop:'10px',width:'100%',border:'1px solid #49687a',background:'#17384b',color:'#e5f8ff',borderRadius:'8px',padding:'9px',fontWeight:850}}>Review notification</button>
        </div>
      )}

      {selected&&(
        <div role="dialog" aria-modal="true" style={{position:'fixed',inset:0,zIndex:5000,background:'rgba(2,8,13,.80)',display:'grid',placeItems:'center',padding:'18px'}}>
          <div style={{width:'min(560px,100%)',background:'#0b1722',border:'1px solid #334b5b',borderRadius:'16px',padding:'20px',boxShadow:'0 30px 90px rgba(0,0,0,.6)'}}>
            <div style={{fontSize:'9px',fontWeight:900,letterSpacing:'.14em',color:selected.notification_type==='OPEN_UNVERIFIED'?'#ff9299':'#8fdaf0'}}>DASS NOTIFICATION RECORD</div>
            <h2 style={{margin:'7px 0 8px',fontSize:'20px'}}>{notificationTitle(selected)}</h2>
            <p style={{margin:0,color:'#afc1cc',fontSize:'12px',lineHeight:1.6}}>{notificationBody(selected)}</p>
            <div style={{marginTop:'14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <Data label="Delivery" value={selected.status}/>
              <Data label="Sent" value={formatUtc(selected.sent_at,true)}/>
              <Data label="Seen" value={formatUtc(selected.seen_at,true)}/>
              <Data label="Acknowledged" value={formatUtc(selected.acknowledged_at,true)}/>
            </div>
            {!selected.acknowledged_at&&(
              <>
                <label style={{display:'grid',gap:'6px',marginTop:'14px',fontSize:'11px',color:'#91a6b8'}}>
                  Acknowledgement note <span style={{color:'#607888'}}>(optional)</span>
                  <textarea value={ackNote} onChange={e=>setAckNote(e.target.value.slice(0,240))} maxLength={240} rows={3} style={{width:'100%',boxSizing:'border-box',resize:'vertical',background:'#08131c',border:'1px solid #2a4050',borderRadius:'8px',color:'#edf5fb',padding:'10px',font:'inherit'}}/>
                </label>
                <div style={{marginTop:'10px',borderLeft:'3px solid #d97706',paddingLeft:'10px',color:'#cfbf9d',fontSize:'10px',lineHeight:1.5}}>
                  Acknowledgement confirms the operator has received and reviewed this notification. It does not verify or change the Danger Area status.
                </div>
              </>
            )}
            {actionError&&<div style={{marginTop:'10px',color:'#ffb1b6',fontSize:'11px'}}>{actionError}</div>}
            <div style={{marginTop:'16px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
              <button onClick={()=>{setSelected(null);setActionError('')}} style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'8px',padding:'10px'}}>Close</button>
              {!selected.acknowledged_at&&<button disabled={isPending||!online||stale} onClick={acknowledge} style={{background:'#17657a',border:'1px solid #41849a',color:'white',borderRadius:'8px',padding:'10px',fontWeight:850}}>{isPending?'Recording…':'Acknowledge'}</button>}
            </div>
          </div>
        </div>
      )}

      <div style={{maxWidth:'1180px',margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:'18px',alignItems:'center',borderBottom:'1px solid #203243',paddingBottom:'18px',flexWrap:'wrap'}}>
          <div>
            <div style={{fontSize:'10px',letterSpacing:'.16em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>DASS Alpha 0.4.2 · Operator awareness</div>
            <h1 style={{margin:'5px 0 4px',fontSize:'clamp(25px,5vw,32px)'}}>Operational Status</h1>
            <div style={{color:'#91a6b8',fontSize:'13px'}}>{operatorName} · {organisation}</div>
          </div>
          <div style={{display:'flex',gap:'9px'}}>
            <a href="/" style={{textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}}>Live map</a>
            <form action={logout}><button type="submit" style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px'}}>Sign out</button></form>
          </div>
        </div>

        {(!online||stale)&&<div style={{marginTop:'14px',border:'1px solid rgba(255,90,100,.48)',background:'rgba(255,90,100,.08)',borderRadius:'11px',padding:'12px 14px',fontSize:'11px',lineHeight:1.5,color:'#ffc0c4'}}><strong>{!online?'CONNECTION LOST':'DATA MAY BE STALE'}.</strong> Displayed information may not represent current DASS state.</div>}

        <div style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(145px,1fr))',gap:'10px'}}>
          <Summary label="UTC" value={formatClock(clock)} accent="#8fdaf0"/>
          <Summary label="Assigned" value={String(assigned.length)} accent="#d7e5ed"/>
          <Summary label="Active" value={String(activeCount)} accent={activeCount?'#ff9299':'#7be3a9'}/>
          <Summary label="Open + unverified" value={String(openUnverified)} accent={openUnverified?'#ff9299':'#7be3a9'}/>
          <Summary label="Unacknowledged" value={String(unack.length)} accent={unack.length?'#fbbf24':'#7be3a9'}/>
          <Summary label="System" value={connectionLabel} accent={connectionColour}/>
        </div>

        <section style={{marginTop:'20px',border:'1px solid #203243',background:'#0b1722',borderRadius:'14px',overflow:'hidden'}}>
          <button onClick={()=>setShowNotifications(v=>!v)} style={{width:'100%',background:'transparent',border:0,color:'#edf5fb',padding:'15px 17px',display:'flex',justifyContent:'space-between',alignItems:'center',textAlign:'left'}}>
            <span><span style={{display:'block',fontSize:'9px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.13em',fontWeight:850}}>Operator awareness</span><strong style={{display:'block',marginTop:'3px',fontSize:'17px'}}>Notification Centre</strong></span>
            <span style={{fontSize:'11px',color:unack.length?'#fbbf24':'#8fa5b4'}}>{unseen.length} unseen · {unack.length} unacknowledged</span>
          </button>
          {showNotifications&&(
            <div style={{borderTop:'1px solid #203243',padding:'12px',display:'grid',gap:'8px'}}>
              {notifications.length===0?<div style={{padding:'8px',color:'#91a6b8',fontSize:'12px'}}>No operational notifications recorded yet.</div>:
              notifications.map(n=>{
                const ack=!!n.acknowledged_at,seen=!!n.seen_at
                return <button key={n.id} onClick={()=>openNotification(n)} style={{textAlign:'left',border:ack?'1px solid #203746':'1px solid rgba(245,158,11,.35)',background:ack?'#091720':'rgba(217,119,6,.05)',borderRadius:'9px',padding:'11px',color:'#edf5fb'}}>
                  <div style={{display:'flex',justifyContent:'space-between',gap:'10px',flexWrap:'wrap'}}>
                    <strong style={{fontSize:'12px'}}>{notificationTitle(n)}</strong>
                    <span style={{fontSize:'9px',fontWeight:900,color:ack?'#7be3a9':seen?'#8fdaf0':'#fbbf24'}}>{ack?'ACKNOWLEDGED':seen?'SEEN':'DELIVERED'}</span>
                  </div>
                  <div style={{marginTop:'4px',fontSize:'10px',color:'#7892a4'}}>{formatUtc(n.sent_at??n.created_at,true)}</div>
                  <div style={{marginTop:'5px',fontSize:'10px',color:'#a4b7c3',lineHeight:1.4}}>{notificationBody(n)}</div>
                </button>
              })}
            </div>
          )}
        </section>

        <section style={{marginTop:'24px'}}>
          <div style={{fontSize:'10px',color:'#7f9db0',textTransform:'uppercase',letterSpacing:'.14em',fontWeight:850}}>Assigned airspace</div>
          <h2 style={{margin:'4px 0 12px',fontSize:'20px'}}>Danger Areas</h2>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(310px,1fr))',gap:'14px'}}>
            {assigned.map(area=>{
              const p=statusPalette(area.effective_status)
              const next=area.activation_scheduled?area.scheduled_activation_at:area.reporting_window_open?area.reporting_window_end_at:area.reporting_window_start_at
              return <article key={area.id} style={{background:'linear-gradient(180deg,#0b1722,#08131c)',border:'1px solid #203243',borderRadius:'15px',padding:'18px'}}>
                <div style={{display:'flex',justifyContent:'space-between',gap:'12px'}}>
                  <div><div style={{color:'#8fdaf0',fontWeight:900,fontSize:'17px'}}>{area.code}</div><div style={{marginTop:'4px',color:'#b8c9d5',fontSize:'12px'}}>{area.name}</div></div>
                  <span style={{color:p.fg,background:p.bg,border:`1px solid ${p.border}`,padding:'6px 9px',borderRadius:'999px',fontSize:'10px',fontWeight:900}}>{area.effective_status}</span>
                </div>
                <div style={{marginTop:'15px',padding:'12px 13px',background:'#091720',border:'1px solid #203746',borderRadius:'10px'}}>
                  <div style={{fontSize:'9px',color:'#7892a4',textTransform:'uppercase'}}>Next operational event</div>
                  <div style={{marginTop:'4px',fontSize:'18px',fontWeight:850}}>{next?durationUntil(next,now):'—'}</div>
                  <div style={{marginTop:'3px',fontSize:'10px',color:'#7892a4'}}>{formatUtc(next)}</div>
                </div>
                <div style={{marginTop:'10px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'8px'}}>
                  <Data label="Reporting" value={area.reporting_window_open?'OPEN':'CLOSED'}/>
                  <Data label="Promulgated" value={area.promulgated_period}/>
                  <Data label="Valid until" value={formatUtc(area.status_valid_until)}/>
                  <Data label="Last update" value={formatUtc(area.status_updated_at)}/>
                </div>
                {!online||stale?<div style={{marginTop:'14px',border:'1px solid rgba(255,90,100,.35)',background:'rgba(255,90,100,.06)',borderRadius:'9px',padding:'10px',fontSize:'10px',color:'#ffc0c4'}}>Operational controls withheld until DASS data is confirmed current.</div>:
                <StatusControls areaId={area.id} code={area.code} currentStatus={area.effective_status} canChangeStatus={area.can_change_status} reportingWindowOpen={area.reporting_window_open} reportingWindowLabel={area.reporting_window_start_at&&area.reporting_window_end_at?`${formatUtc(area.reporting_window_start_at)} – ${formatUtc(area.reporting_window_end_at)}`:'Unavailable'} preActivationWindowOpen={area.pre_activation_window_open} preActivationLeadMinutes={area.pre_activation_lead_minutes} activationScheduled={area.activation_scheduled} scheduledActivationAt={area.scheduled_activation_at??area.reporting_window_start_at}/>}
              </article>
            })}
          </div>
        </section>

        <section style={{marginTop:'22px',border:'1px solid #203243',background:'#0b1722',borderRadius:'14px',overflow:'hidden'}}>
          <button onClick={()=>setShowHistory(v=>!v)} style={{width:'100%',background:'transparent',border:0,color:'#edf5fb',padding:'15px 17px',display:'flex',justifyContent:'space-between',textAlign:'left'}}>
            <span><span style={{display:'block',fontSize:'9px',color:'#7f9db0',textTransform:'uppercase'}}>Audit trail</span><strong style={{display:'block',marginTop:'3px',fontSize:'15px'}}>Recent status activity</strong></span>
            <span style={{fontSize:'12px',color:'#8fa5b4'}}>{showHistory?'Hide':`Show ${events.length}`}</span>
          </button>
          {showHistory&&<div style={{borderTop:'1px solid #203243',padding:'12px',display:'grid',gap:'8px'}}>{events.map(e=><div key={e.id} style={{border:'1px solid #203746',background:'#091720',borderRadius:'9px',padding:'10px'}}><strong style={{fontSize:'11px'}}>{e.danger_areas?.code??'Danger Area'} · {e.previous_status??'—'} → {e.new_status??'—'}</strong><div style={{marginTop:'4px',fontSize:'10px',color:'#7892a4'}}>{formatUtc(e.changed_at,true)}</div></div>)}</div>}
        </section>

        <section style={{marginTop:'18px',borderLeft:'3px solid #d97706',background:'rgba(217,119,6,.055)',padding:'11px 13px',color:'#cfbf9d',fontSize:'10px',lineHeight:1.5}}>
          <strong>Demonstration system:</strong> Notification acknowledgement confirms receipt only. It does not verify, activate or stand down a Danger Area.
        </section>
      </div>
    </main>
  )
}

function Summary({label,value,accent}:{label:string,value:string,accent:string}){
  return <div style={{border:'1px solid #203746',background:'#0a1822',borderRadius:'11px',padding:'11px 12px'}}><div style={{fontSize:'8px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>{label}</div><div style={{marginTop:'5px',fontSize:'17px',fontWeight:900,color:accent}}>{value}</div></div>
}
function Data({label,value}:{label:string,value:string}){
  return <div style={{border:'1px solid #1d3341',background:'#091720',borderRadius:'8px',padding:'9px'}}><div style={{fontSize:'8px',color:'#708998',textTransform:'uppercase',letterSpacing:'.11em',fontWeight:850}}>{label}</div><div style={{marginTop:'4px',fontSize:'10px',color:'#c4d3dc',lineHeight:1.3}}>{value}</div></div>
}
