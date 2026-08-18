export type AlertSeverity='CRITICAL'|'WARNING'|'ADVISORY'

export type OperationalAlert={
  id:string
  severity:AlertSeverity
  title:string
  detail:string
  dueAt:string|null
  href?:string
}

type AdminRun={id:string;report_reference:string|null;coverage_end:string|null;sync_status:string}
type ReviewItem={id:string;import_run_id:string;schedule_status:string;designator:string|null}
type AdminNotam={id:string;notam_number:string;valid_until:string|null;danger_areas:{code:string}|null}

type OperatorArea={
  id:string;code:string;effective_status:string;status_valid_until:string|null
  notam_feed_state:string;has_live_notam:boolean;notam_number:string|null
  notam_valid_until:string|null;activation_scheduled:boolean;scheduled_activation_at:string|null
}

const HOUR=60*60*1000
function ms(value:string|null){return value?Date.parse(value):Number.NaN}
function within(value:string|null,now:number,hours:number){const time=ms(value);return Number.isFinite(time)&&time>now&&time<=now+hours*HOUR}

export function buildAdminAlerts(run:AdminRun|null,items:ReviewItem[],notams:AdminNotam[],now=Date.now()):OperationalAlert[]{
  const alerts:OperationalAlert[]=[]
  if(!run){
    alerts.push({id:'no-pib',severity:'CRITICAL',title:'No published PIB coverage',detail:'DASS has no published NATS PIB coverage against which to assure the NOTAM picture.',dueAt:null,href:'/admin/notam'})
  }else{
    const coverage=ms(run.coverage_end)
    if(!Number.isFinite(coverage)||coverage<=now)alerts.push({id:`pib-expired-${run.id}`,severity:'CRITICAL',title:'PIB coverage expired',detail:`${run.report_reference??'The latest published PIB'} no longer covers the current time. Import and publish a current briefing.`,dueAt:run.coverage_end,href:'/admin/notam'})
    else if(within(run.coverage_end,now,2))alerts.push({id:`pib-critical-${run.id}`,severity:'CRITICAL',title:'PIB coverage expires within 2 hours',detail:'Generate, review and merge the replacement PIB before the current coverage window closes.',dueAt:run.coverage_end,href:'/admin/notam'})
    else if(within(run.coverage_end,now,6))alerts.push({id:`pib-warning-${run.id}`,severity:'WARNING',title:'PIB coverage expires within 6 hours',detail:'A replacement PIB should now be prepared to avoid a gap in assured coverage.',dueAt:run.coverage_end,href:'/admin/notam'})

    const unresolved=items.filter(item=>item.import_run_id===run.id&&item.schedule_status==='REVIEW_REQUIRED')
    if(unresolved.length)alerts.push({id:`review-${run.id}`,severity:'CRITICAL',title:`${unresolved.length} NOTAM schedule${unresolved.length===1?' requires':'s require'} review`,detail:`Publication remains blocked for ${[...new Set(unresolved.map(x=>x.designator??'unmatched area'))].join(', ')}.`,dueAt:run.coverage_end,href:'/admin/notam'})
  }

  for(const notam of notams){
    if(within(notam.valid_until,now,1))alerts.push({id:`notam-${notam.id}`,severity:'WARNING',title:`${notam.danger_areas?.code??'Danger Area'} NOTAM expires within 60 minutes`,detail:`${notam.notam_number} is approaching the end of its promulgated validity.`,dueAt:notam.valid_until,href:'/admin/notam'})
  }
  return sortAlerts(alerts)
}

export function buildOperatorAlerts(areas:OperatorArea[],now=Date.now()):OperationalAlert[]{
  const alerts:OperationalAlert[]=[]
  const feedState=areas.find(a=>['FAILED','STALE','PARTIAL','UNINITIALISED'].includes(a.notam_feed_state))?.notam_feed_state
  if(feedState)alerts.push({id:`feed-${feedState}`,severity:feedState==='PARTIAL'?'WARNING':'CRITICAL',title:`Effective NOTAM feed state: ${feedState}`,detail:'Treat the displayed NOTAM picture with caution and follow local assurance procedures.',dueAt:null})

  for(const area of areas){
    if(area.has_live_notam&&within(area.notam_valid_until,now,1))alerts.push({id:`notam-${area.id}`,severity:'WARNING',title:`${area.code} NOTAM expires within 60 minutes`,detail:`${area.notam_number??'The matched NOTAM'} will cease to support activation at the displayed validity time.`,dueAt:area.notam_valid_until})
    if(area.activation_scheduled&&within(area.scheduled_activation_at,now,.5))alerts.push({id:`scheduled-${area.id}`,severity:'ADVISORY',title:`${area.code} activation begins within 30 minutes`,detail:'Review the planned activation and confirm the current NOTAM and operational period before action.',dueAt:area.scheduled_activation_at})
    if(area.effective_status==='ACTIVE'&&within(area.status_valid_until,now,.5))alerts.push({id:`status-${area.id}`,severity:'CRITICAL',title:`${area.code} active declaration expires within 30 minutes`,detail:'The declared status will become UNVERIFIED when its validity ends unless correctly updated.',dueAt:area.status_valid_until})
  }
  return sortAlerts(alerts)
}

function sortAlerts(alerts:OperationalAlert[]){
  const rank:Record<AlertSeverity,number>={CRITICAL:0,WARNING:1,ADVISORY:2}
  return alerts.sort((a,b)=>rank[a.severity]-rank[b.severity]||(a.dueAt?ms(a.dueAt):Infinity)-(b.dueAt?ms(b.dueAt):Infinity))
}
