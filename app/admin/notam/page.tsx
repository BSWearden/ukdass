import {redirect} from 'next/navigation'
import {createClient} from '../../../lib/supabase/server'

export const dynamic='force-dynamic'
function utc(v:string|null){return v?new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',dateStyle:'medium',timeStyle:'medium'}).format(new Date(v))+' UTC':'—'}

export default async function NotamAssurancePage(){
 const supabase=await createClient();const {data:u}=await supabase.auth.getUser();if(!u.user)redirect('/admin/login')
 const {data:admin}=await supabase.from('admin_profiles').select('account_status').eq('user_id',u.user.id).maybeSingle();if(!admin||admin.account_status!=='ACTIVE')redirect('/admin')
 const [stateResult,assuranceResult,runsResult,overridesResult]=await Promise.all([
  supabase.from('notam_system_state').select('*').single(),supabase.from('notam_assurance_state').select('*'),
  supabase.from('notam_sync_runs').select('*').order('started_at',{ascending:false}).limit(10),
  supabase.from('notam_activation_overrides').select('id,danger_area_id,operator_user_id,reason,feed_state_at_override,created_at').order('created_at',{ascending:false}).limit(10)
 ])
 if(stateResult.error||assuranceResult.error)throw new Error('Unable to load NOTAM assurance state.')
 const state=stateResult.data;const rows=assuranceResult.data??[];const matched=rows.filter(r=>r.has_live_notam).length
 return <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(16px,3vw,28px)'}}><div style={{maxWidth:'1100px',margin:'0 auto'}}>
  <header style={{display:'flex',justifyContent:'space-between',gap:'12px',alignItems:'center',flexWrap:'wrap',borderBottom:'1px solid #203243',paddingBottom:'17px'}}><div><div style={{fontSize:'10px',letterSpacing:'.15em',color:'#8fdaf0',fontWeight:900}}>ALPHA 1.2.0 · STAGE 1</div><h1 style={{margin:'6px 0'}}>NOTAM Assurance</h1></div><a href="/admin" style={{color:'#dceef7',textDecoration:'none',border:'1px solid #385267',borderRadius:'8px',padding:'9px 12px'}}>Admin dashboard</a></header>
  <section style={{marginTop:'18px',border:'1px solid rgba(255,186,74,.4)',background:'rgba(255,186,74,.06)',borderRadius:'12px',padding:'14px',color:'#e1cfa8',fontSize:'12px',lineHeight:1.6}}><strong>Monitor mode is active.</strong> Existing Danger Areas remain visible until an automated source completes a fresh verified sync. Enforcement cannot be inferred from an empty, failed or stale feed.</section>
  <section style={{marginTop:'14px',display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(170px,1fr))',gap:'10px'}}><Card label="Visibility mode" value={state.visibility_mode}/><Card label="Feed state" value={state.last_sync_status}/><Card label="Live matches" value={`${matched} / ${rows.length}`}/><Card label="Last successful sync" value={utc(state.last_successful_sync_at)}/></section>
  <section style={{marginTop:'20px'}}><h2>Feed readiness</h2><div style={box}><Row k="Configured source" v={state.source_name??'Not connected'}/><Row k="Freshness threshold" v={`${state.freshness_minutes} minutes`}/><Row k="Last attempt" v={utc(state.last_attempt_at)}/><Row k="Public filtering" v={state.visibility_mode==='ENFORCED'?'Enabled with fail-safe':'Not yet enabled'}/></div></section>
  <section style={{marginTop:'20px'}}><h2>Recent sync runs</h2><div style={box}>{(runsResult.data??[]).length?(runsResult.data??[]).map(r=><Row key={r.id} k={`${r.sync_status} · ${r.source_name}`} v={`${utc(r.started_at)} · ${r.matched_count}/${r.received_count} matched`}/>):<Row k="No sync runs" v="The automatic connector is the next stage."/>}</div></section>
  <section style={{marginTop:'20px'}}><h2>Activation overrides</h2><div style={box}>{(overridesResult.data??[]).length?(overridesResult.data??[]).map(r=><Row key={r.id} k={utc(r.created_at)} v={`${r.reason} · Feed ${r.feed_state_at_override}`}/>):<Row k="No overrides recorded" v="Activations without a verified NOTAM require an explicit audited override."/>}</div></section>
 </div></main>
}
const box:React.CSSProperties={border:'1px solid #203243',background:'#0b1722',borderRadius:'12px',overflow:'hidden'}
function Card({label,value}:{label:string;value:string}){return <div style={{...box,padding:'13px'}}><div style={{fontSize:'9px',color:'#7892a4',textTransform:'uppercase'}}>{label}</div><strong style={{display:'block',marginTop:'6px',fontSize:'14px'}}>{value}</strong></div>}
function Row({k,v}:{k:string;v:string}){return <div style={{padding:'12px 14px',borderBottom:'1px solid #182b38',display:'flex',justifyContent:'space-between',gap:'14px',flexWrap:'wrap'}}><strong style={{fontSize:'11px'}}>{k}</strong><span style={{fontSize:'10px',color:'#91a6b8'}}>{v}</span></div>}
