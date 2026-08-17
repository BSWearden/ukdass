import { redirect } from 'next/navigation'
import { createClient } from '../../../lib/supabase/server'
import AuthorityMappingClient from './AuthorityMappingClient'

type Area={id:string;code:string;name:string;organisation_id:string|null;aip_current:boolean}
type Organisation={id:string;name:string}
type Operator={user_id:string;display_name:string;organisation_id:string|null;account_status:string}
type Permission={user_id:string;danger_area_id:string;can_change_status:boolean}

export const dynamic='force-dynamic'

export default async function AuthorityMappingPage(){
  const supabase=await createClient()
  const {data:userData,error:userError}=await supabase.auth.getUser()
  if(userError||!userData.user)redirect('/admin/login')
  const {data:admin,error:adminError}=await supabase.from('admin_profiles').select('display_name,admin_role,account_status').eq('user_id',userData.user.id).maybeSingle()
  if(adminError||!admin||admin.account_status!=='ACTIVE')redirect('/admin')

  const [areaResult,organisationResult,operatorResult,permissionResult]=await Promise.all([
    supabase.from('danger_areas').select('id,code,name,organisation_id,aip_current').order('code'),
    supabase.from('organisations').select('id,name').order('name'),
    supabase.from('operator_profiles').select('user_id,display_name,organisation_id,account_status').order('display_name'),
    supabase.from('operator_permissions').select('user_id,danger_area_id,can_change_status'),
  ])
  if(areaResult.error||organisationResult.error||operatorResult.error||permissionResult.error)throw new Error('Unable to load authority-mapping data.')

  const allAreas=(areaResult.data??[]) as Area[]
  const currentAreas=allAreas.filter(area=>area.aip_current)
  const archivedIds=new Set(allAreas.filter(area=>!area.aip_current).map(area=>area.id))
  const permissions=(permissionResult.data??[]) as Permission[]

  return <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'clamp(14px,3vw,26px)'}}><div style={{maxWidth:'1380px',margin:'0 auto'}}>
    <header style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:'16px',flexWrap:'wrap',paddingBottom:'18px',borderBottom:'1px solid #203243'}}>
      <div><div style={{fontSize:'10px',letterSpacing:'.16em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>DASS Alpha 1.1.0 · Controlled Authority Mapping</div><h1 style={{margin:'5px 0 4px',fontSize:'clamp(25px,5vw,32px)'}}>Operator Authority Mapping</h1><div style={{fontSize:'13px',color:'#91a6b8'}}>{admin.display_name} · {admin.admin_role}</div></div>
      <div style={{display:'flex',gap:'9px',flexWrap:'wrap'}}><a href="/admin" style={nav}>Administrator dashboard</a><a href="/admin/aip-import" style={nav}>AIP imports</a><a href="/" style={nav}>Live map</a></div>
    </header>
    <AuthorityMappingClient
      initialAreas={currentAreas}
      initialOrganisations={(organisationResult.data??[]) as Organisation[]}
      initialOperators={(operatorResult.data??[]) as Operator[]}
      initialPermissions={permissions.filter(permission=>currentAreas.some(area=>area.id===permission.danger_area_id))}
      archivedPermissionCount={permissions.filter(permission=>archivedIds.has(permission.danger_area_id)).length}
    />
  </div></main>
}

const nav:React.CSSProperties={textDecoration:'none',background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px',fontSize:'13px'}
