import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import AipImportClient from './AipImportClient'

type ImportRun={id:string;source_file:string;source_sha256:string;airac_effective_date:string;record_count:number;import_status:string;validation_summary:Record<string,number>;created_at:string;completed_at:string|null}
type StagedArea={id:string;designator:string;name:string;lower_limit:string;upper_limit:string;promulgated_period:string;authority:string|null;geometry_segment_types:string[];rendered_vertex_count:number;validation_status:string}

export const dynamic='force-dynamic'

function utc(value:string|null){if(!value)return'—';return new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(value))+' UTC'}

export default async function AipImportPage(){
  const supabase=await createClient()
  const {data:userData,error:userError}=await supabase.auth.getUser()
  if(userError||!userData.user)redirect('/admin/login')
  const {data:admin}=await supabase.from('admin_profiles').select('display_name,admin_role,account_status').eq('user_id',userData.user.id).maybeSingle()
  if(!admin||admin.account_status!=='ACTIVE')redirect('/admin')

  const {data:runData,error:runError}=await supabase.from('aip_import_runs').select('id,source_file,source_sha256,airac_effective_date,record_count,import_status,validation_summary,created_at,completed_at').order('created_at',{ascending:false}).limit(10)
  if(runError)throw new Error('Unable to load AIP import history.')
  const runs=(runData??[]) as ImportRun[]
  const latest=runs[0]??null
  let areas:StagedArea[]=[]
  if(latest){
    const {data,error}=await supabase.from('aip_danger_areas_staging').select('id,designator,name,lower_limit,upper_limit,promulgated_period,authority,geometry_segment_types,rendered_vertex_count,validation_status').eq('import_run_id',latest.id).order('designator')
    if(error)throw new Error('Unable to load staged Danger Areas.')
    areas=(data??[]) as StagedArea[]
  }

  const notam=areas.filter(area=>area.promulgated_period.toUpperCase().includes('NOTAM')).length
  const unstructured=areas.filter(area=>area.promulgated_period.startsWith('Not stated')).length

  return <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(14px,3vw,26px)'}}><div style={{maxWidth:'1280px',margin:'0 auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px',flexWrap:'wrap',paddingBottom:'18px',borderBottom:'1px solid #203243'}}>
      <div><div style={{fontSize:'10px',letterSpacing:'.16em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>DASS Alpha 1.0.0 · Aeronautical data assurance</div><h1 style={{margin:'5px 0 4px',fontSize:'clamp(25px,5vw,32px)'}}>AIP Import Management</h1><div style={{fontSize:'13px',color:'#91a6b8'}}>{admin.display_name} · {admin.admin_role}</div></div>
      <div style={{display:'flex',gap:'9px'}}><a href="/admin" style={nav}>Administrator dashboard</a><a href="/" style={nav}>Live map</a></div>
    </header>

    <div style={{marginTop:'18px'}}><AipImportClient/></div>

    <section style={{marginTop:'18px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:'10px'}}>
      <Summary label="Latest status" value={latest?.import_status??'NO IMPORT'}/><Summary label="Staged areas" value={String(areas.length)}/><Summary label="NOTAM activated" value={String(notam)}/><Summary label="Schedule not structured" value={String(unstructured)}/><Summary label="Rendered vertices" value={String(areas.reduce((sum,area)=>sum+area.rendered_vertex_count,0))}/>
    </section>

    <section style={{marginTop:'24px'}}><h2 style={{fontSize:'19px',margin:'0 0 10px'}}>Import history</h2><div style={box}>{runs.length===0?<Empty text="No AIP datasets have been staged yet."/>:runs.map((run,index)=><div key={run.id} style={{padding:'12px 14px',borderTop:index?'1px solid #182b38':0}}><div style={{display:'flex',justifyContent:'space-between',gap:'12px',flexWrap:'wrap'}}><strong style={{fontSize:'12px'}}>{run.source_file}</strong><span style={{fontSize:'10px',color:run.import_status==='VALIDATED'?'#84e8b0':'#fbbf24',fontWeight:900}}>{run.import_status}</span></div><div style={{marginTop:'5px',fontSize:'10px',color:'#91a6b8'}}>AIRAC {run.airac_effective_date} · {run.record_count} expected records · created {utc(run.created_at)}</div><div style={{marginTop:'4px',fontSize:'9px',color:'#607888',wordBreak:'break-all'}}>SHA-256: {run.source_sha256}</div></div>)}</div></section>

    <section style={{marginTop:'24px'}}><h2 style={{fontSize:'19px',margin:'0 0 10px'}}>Latest staged Danger Areas</h2><div style={{...box,overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',minWidth:'820px',fontSize:'10px'}}><thead><tr>{['Designator','Name','Vertical limits','Promulgated period','Geometry','Validation'].map(item=><th key={item} style={th}>{item}</th>)}</tr></thead><tbody>{areas.map(area=><tr key={area.id}><td style={{...td,color:'#8fdaf0',fontWeight:900}}>{area.designator}</td><td style={td}>{area.name}</td><td style={td}>{area.lower_limit} – {area.upper_limit}</td><td style={{...td,maxWidth:'330px'}}>{area.promulgated_period}</td><td style={td}>{area.geometry_segment_types.join(', ')} · {area.rendered_vertex_count} points</td><td style={{...td,color:area.validation_status==='VALID'?'#84e8b0':'#ff9299',fontWeight:900}}>{area.validation_status}</td></tr>)}</tbody></table>{areas.length===0&&<Empty text="Upload the validated staging JSON to review the official dataset."/>}</div></section>
  </div></main>
}

const nav:React.CSSProperties={textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}
const box:React.CSSProperties={border:'1px solid #203243',background:'#0b1722',borderRadius:'13px',overflow:'hidden'}
const th:React.CSSProperties={textAlign:'left',padding:'10px 12px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.09em',fontSize:'8px',borderBottom:'1px solid #274052'}
const td:React.CSSProperties={padding:'10px 12px',verticalAlign:'top',borderTop:'1px solid #182b38',color:'#c4d3dc',lineHeight:1.45}
function Summary({label,value}:{label:string;value:string}){return <div style={{border:'1px solid #203746',background:'#0a1822',borderRadius:'11px',padding:'11px 12px'}}><div style={{fontSize:'8px',color:'#7892a4',textTransform:'uppercase',letterSpacing:'.12em',fontWeight:850}}>{label}</div><div style={{marginTop:'5px',fontSize:'17px',fontWeight:900,color:'#d7e5ed'}}>{value}</div></div>}
function Empty({text}:{text:string}){return <div style={{padding:'15px',fontSize:'11px',color:'#91a6b8'}}>{text}</div>}
