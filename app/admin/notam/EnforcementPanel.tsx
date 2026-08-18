import {createClient} from '../../../lib/supabase/server'
import EnforcementControls from './EnforcementControls'
import type {EnforcementReadiness} from './actions'

export default async function EnforcementPanel(){const supabase=await createClient();const {data,error}=await supabase.rpc('admin_notam_enforcement_readiness');if(error)return <section style={{marginTop:'18px',border:'1px solid rgba(255,90,100,.4)',borderRadius:'12px',padding:'14px',color:'#ffc0c4'}}>Unable to calculate enforcement readiness.</section>;return <EnforcementControls readiness={data as EnforcementReadiness}/>}
