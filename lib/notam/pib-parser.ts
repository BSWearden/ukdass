export type PibEventKind='ACTIVATION'|'DEACTIVATION'|'TDA_INSTALLATION'|'REFERENCE'|'UNSUPPORTED'
export type PibScheduleStatus='RESOLVED'|'REVIEW_REQUIRED'|'NOT_APPLICABLE'

export type ParsedPibItem={
  notam_number:string;q_code:string;event_kind:PibEventKind;designator:string|null
  valid_from:string|null;valid_until:string|null;lower_limit:string|null;upper_limit:string|null
  schedule_status:PibScheduleStatus;included:boolean;review_note:string|null;raw_text:string
}
export type ParsedPib={
  manifest:{source_name:'NATS_PIB';pib_reference:string;report_reference:string;coverage_start:string;coverage_end:string;firs:string[];parser_version:string;warning_count:number}
  items:ParsedPibItem[];warnings:string[]
}

const MONTHS:Record<string,number>={JAN:0,FEB:1,MAR:2,APR:3,MAY:4,JUN:5,JUL:6,AUG:7,SEP:8,OCT:9,NOV:10,DEC:11}
const PARSER_VERSION='1.0.1'

function compactUtc(value:string){
 const m=value.match(/^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/);if(!m)return null
 return new Date(Date.UTC(2000+Number(m[1]),Number(m[2])-1,Number(m[3]),Number(m[4]),Number(m[5])))
}
function writtenUtc(value:string){
 const m=value.trim().toUpperCase().match(/^(\d{2})\s+([A-Z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})$/);if(!m||MONTHS[m[2]]===undefined)return null
 return new Date(Date.UTC(Number(m[3]),MONTHS[m[2]],Number(m[1]),Number(m[4]),Number(m[5])))
}
function field(block:string,key:string,next:string){
 const match=block.match(new RegExp(`(?:^|\\s)${key}\\)\\s*([\\s\\S]*?)(?=\\s+(?:${next})\\)|$)`,'i'))
 return match?.[1]?.replace(/\s+/g,' ').trim()??''
}
function notamLimits(block:string){
 const lower=field(block,'F','G')||block.match(/\bLOWER:\s*([^\n]+?)(?=\s+UPPER:|$)/i)?.[1]?.trim()||null
 const upper=block.match(/(?:^|\n)G\)\s*([^\n]+)/i)?.[1]?.trim()??block.match(/\bUPPER:\s*([^\n]+)/i)?.[1]?.trim()??null
 return {lower_limit:lower,upper_limit:upper}
}
function atUtc(day:Date,hhmm:string){return new Date(Date.UTC(day.getUTCFullYear(),day.getUTCMonth(),day.getUTCDate(),Number(hhmm.slice(0,2)),Number(hhmm.slice(2))))}
function clipInterval(start:Date,end:Date,min:Date,max:Date){const a=new Date(Math.max(start.getTime(),min.getTime())),b=new Date(Math.min(end.getTime(),max.getTime()));return b>a?[a,b] as const:null}
function resolvedItem(base:Omit<ParsedPibItem,'valid_from'|'valid_until'|'schedule_status'|'included'|'review_note'>,start:Date,end:Date,min:Date,max:Date){
 const clipped=clipInterval(start,end,min,max);if(!clipped)return null
 return {...base,valid_from:clipped[0].toISOString(),valid_until:clipped[1].toISOString(),schedule_status:'RESOLVED' as const,included:true,review_note:null}
}

export function parseNatsPib(text:string):ParsedPib{
 // PDF.js emits a separate text item for many words, which can leave several
 // spaces between visually adjacent words. Preserve line boundaries used for
 // NOTAM fields, but canonicalise horizontal whitespace before matching.
 const normal=text.replace(/\r/g,'').replace(/[ \t]+/g,' ').replace(/ *\n */g,'\n')
 if(!/UK Aeronautical Information Service \(NATS\)/i.test(normal)||!/Pre-Flight Information Bulletin/i.test(normal))throw new Error('This is not a recognised NATS PIB PDF.')
 const validity=normal.match(/VALIDITY\s*\(UTC\)\s*:[\s\S]{0,120}?(\d{2}\s+[A-Z]{3}\s+\d{4}\s+\d{2}:\d{2})\s*-\s*(\d{2}\s+[A-Z]{3}\s+\d{4}\s+\d{2}:\d{2})/i)
 if(!validity)throw new Error('The PIB validity period could not be read.')
 const coverageStart=writtenUtc(validity[1]),coverageEnd=writtenUtc(validity[2]);if(!coverageStart||!coverageEnd||coverageEnd<=coverageStart)throw new Error('The PIB validity period is invalid.')
 const header=normal.slice(0,3500)
 const reportReference=header.match(/Report reference no:\s*([A-Z0-9]+)/i)?.[1]??''
 const pibReference=header.match(/PIB Reference:\s*([^\n]+)/i)?.[1]?.trim()??''
 const firLine=header.match(/FIR:\s*([^\n]+)/i)?.[1]?.toUpperCase()??''
 const firs=Array.from(new Set(firLine.match(/EGTT|EGPX/g)??[]))
 if(!reportReference)throw new Error('The NATS report reference could not be read.')
 if(!firs.includes('EGTT')||!firs.includes('EGPX'))throw new Error('The PIB must include both EGTT and EGPX.')

 const warnings:string[]=[];const items:ParsedPibItem[]=[]
 for(const blockText of normal.split(/(?=^Q\))/m).slice(1)){
  const block=blockText.replace(/\n\s*Page \d+ of \d+\s*\n/g,'\n').trim()
  const qLine=block.split('\n')[0].replace(/\s+/g,' ')
  const qCode=qLine.match(/\/(Q[A-Z]{4})\//)?.[1]??''
  const notamNumber=block.slice(0,500).match(/\b([A-Z]\d{4}\/\d{2})\b/)?.[1]??''
  const bValue=field(block,'B','C').match(/\d{10}/)?.[0]??''
  const cValue=field(block,'C','D|E').match(/\d{10}|PERM/i)?.[0]??''
  const dValue=field(block,'D','E')
  const eValue=field(block,'E','F')||field(block,'E','G')
  if(!notamNumber||!qCode||!eValue)continue
  const designators=Array.from(new Set(eValue.toUpperCase().match(/\bEGD\d{3}[A-Z]*\b/g)??[]))
  if(!qCode.startsWith('QRD')&&designators.length===0)continue
  let eventKind:PibEventKind='REFERENCE'
  if(qCode==='QRDCA'&&/\bACTIVATED\b/i.test(eValue))eventKind='ACTIVATION'
  else if(qCode==='QRDCD'||/\bDEACTIVATED\b/i.test(eValue))eventKind='DEACTIVATION'
  else if(qCode==='QRDCS'&&/\b(?:INSTALLED|ESTABLISHED)\b/i.test(eValue))eventKind='TDA_INSTALLATION'
  else if(qCode.startsWith('QRD')&&!designators.length)eventKind='UNSUPPORTED'
  if(eventKind==='ACTIVATION'&&designators.length===0&&/\bEKD\d{3}[A-Z]*\b/i.test(eValue))eventKind='REFERENCE'
  const baseStart=compactUtc(bValue),baseEnd=cValue.toUpperCase()==='PERM'?null:compactUtc(cValue)
  const raw=block.slice(0,8000)
  const limits=notamLimits(block)

  if(eventKind!=='ACTIVATION'){
   for(const designator of designators.length?designators:[null])items.push({notam_number:notamNumber,q_code:qCode,event_kind:eventKind,designator,valid_from:baseStart?.toISOString()??null,valid_until:baseEnd?.toISOString()??null,lower_limit:null,upper_limit:null,schedule_status:'NOT_APPLICABLE',included:false,review_note:eventKind==='DEACTIVATION'?'Deactivation record - not published as activation':eventKind==='TDA_INSTALLATION'?'TDA definition only - no activation asserted':'Danger Area reference only',raw_text:raw})
   continue
  }
  if(!baseStart||!baseEnd||designators.length===0){
   warnings.push(`${notamNumber}: incomplete activation dates or designator.`)
   items.push({notam_number:notamNumber,q_code:qCode,event_kind:'ACTIVATION',designator:designators[0]??null,valid_from:baseStart?.toISOString()??null,valid_until:baseEnd?.toISOString()??null,...limits,schedule_status:'REVIEW_REQUIRED',included:false,review_note:'Incomplete activation dates or designator',raw_text:raw});continue
  }

  const explicit=[...eValue.toUpperCase().matchAll(/\b(EGD\d{3}[A-Z]*)\s+(\d{4})-(\d{4})\s+([^\s]+)-([^\s]+)/g)]
  if(explicit.length){
   for(const match of explicit){let start=atUtc(baseStart,match[2]),end=atUtc(baseStart,match[3]);if(end<=start)end=new Date(end.getTime()+86400000);const item=resolvedItem({notam_number:notamNumber,q_code:qCode,event_kind:'ACTIVATION',designator:match[1],lower_limit:match[4],upper_limit:match[5],raw_text:raw},start,end,coverageStart,coverageEnd);if(item)items.push(item)}
   continue
  }
  if(!dValue){
   for(const designator of designators){const item=resolvedItem({notam_number:notamNumber,q_code:qCode,event_kind:'ACTIVATION',designator,...limits,raw_text:raw},baseStart,baseEnd,coverageStart,coverageEnd);if(item)items.push(item)}
   continue
  }
  const daily=dValue.match(/^\s*(\d{4})-(\d{4})\s*$/)
  if(daily){
   const firstDay=new Date(Date.UTC(coverageStart.getUTCFullYear(),coverageStart.getUTCMonth(),coverageStart.getUTCDate()))
   const last=Math.min(baseEnd.getTime(),coverageEnd.getTime())
   for(let day=new Date(firstDay);day.getTime()<=last;day=new Date(day.getTime()+86400000)){
    let start=atUtc(day,daily[1]),end=atUtc(day,daily[2]);if(end<=start)end=new Date(end.getTime()+86400000)
    for(const designator of designators){const clipped=clipInterval(start,end,new Date(Math.max(baseStart.getTime(),coverageStart.getTime())),new Date(Math.min(baseEnd.getTime(),coverageEnd.getTime())));if(clipped)items.push({notam_number:notamNumber,q_code:qCode,event_kind:'ACTIVATION',designator,valid_from:clipped[0].toISOString(),valid_until:clipped[1].toISOString(),...limits,schedule_status:'RESOLVED',included:true,review_note:null,raw_text:raw})}
   }
   continue
  }
  const datedOvernight=dValue.match(/^\s*(\d{1,2})-(\d{1,2})\s+(\d{4})-(\d{4})(?:\s*,.*)?$/)
  if(datedOvernight){
   const fromDay=Number(datedOvernight[1]),toDay=Number(datedOvernight[2]);const firstDay=new Date(Date.UTC(coverageStart.getUTCFullYear(),coverageStart.getUTCMonth(),coverageStart.getUTCDate()))
   const last=Math.min(baseEnd.getTime(),coverageEnd.getTime())
   for(let day=new Date(firstDay);day.getTime()<=last;day=new Date(day.getTime()+86400000)){
    if(day.getUTCDate()<fromDay||day.getUTCDate()>toDay)continue
    let start=atUtc(day,datedOvernight[3]),end=atUtc(day,datedOvernight[4]);if(end<=start)end=new Date(end.getTime()+86400000)
    for(const designator of designators){const clipped=clipInterval(start,end,new Date(Math.max(baseStart.getTime(),coverageStart.getTime())),new Date(Math.min(baseEnd.getTime(),coverageEnd.getTime())));if(clipped)items.push({notam_number:notamNumber,q_code:qCode,event_kind:'ACTIVATION',designator,valid_from:clipped[0].toISOString(),valid_until:clipped[1].toISOString(),...limits,schedule_status:'RESOLVED',included:true,review_note:null,raw_text:raw})}
   }
   continue
  }
  warnings.push(`${notamNumber}: schedule “${dValue}” requires review.`)
  for(const designator of designators)items.push({notam_number:notamNumber,q_code:qCode,event_kind:'ACTIVATION',designator,valid_from:baseStart.toISOString(),valid_until:baseEnd.toISOString(),...limits,schedule_status:'REVIEW_REQUIRED',included:false,review_note:`Unsupported Item D schedule: ${dValue}`,raw_text:raw})
 }
 if(!items.some(item=>item.event_kind==='ACTIVATION'))warnings.push('No Danger Area activation records were found in the PIB.')
 return {manifest:{source_name:'NATS_PIB',pib_reference:pibReference,report_reference:reportReference,coverage_start:coverageStart.toISOString(),coverage_end:coverageEnd.toISOString(),firs,parser_version:PARSER_VERSION,warning_count:warnings.length},items,warnings}
}
