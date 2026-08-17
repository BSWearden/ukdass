import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { logout } from './actions'
import OperationalDashboard from './components/OperationalDashboard'
import OperatorPeriodBasis from './components/OperatorPeriodBasis'
import OperationalPeriodsPreview from '../components/OperationalPeriodsPreview'

type Status='ACTIVE'|'INACTIVE'|'UNVERIFIED'

export type AssignedArea={
  user_id:string
  can_change_status:boolean
  id:string
  code:string
  name:string
  lower_limit:string
  upper_limit:string
  promulgated_period:string
  authority:string
  airspace_when_inactive:string
  declared_status:Status
  effective_status:Status
  status_updated_at:string|null
  status_valid_until:string|null
  reporting_window_start_at:string|null
  reporting_window_end_at:string|null
  reporting_window_open:boolean
  pre_activation_lead_minutes:number
  pre_activation_window_open:boolean
  scheduled_activation_at:string|null
  scheduled_activation_created_at:string|null
  scheduled_activation_note:string|null
  activation_scheduled:boolean
  scheduled_activation_period_id:string|null
  operational_period_id:string|null
  operational_period_reference:string|null
  operational_period_source:'MANUAL'|'NOTAM_IMPORT'|'SYSTEM'|null
  operational_period_status:'PLANNED'|'CANCELLED'|'COMPLETED'|null
}

export type StatusEvent={
  id:number
  previous_status:string|null
  new_status:string|null
  changed_at:string
  note:string|null
  valid_until:string|null
  event_source:'OPERATOR'|'SYSTEM'
  event_type:'STATUS_CHANGE'|'ACTIVATION_SCHEDULED'|'ACTIVATION_CANCELLED'|'SCHEDULED_ACTIVATION_EFFECTIVE'|'SCHEDULED_ACTIVATION_EXPIRED'
  effective_at:string|null
  danger_areas:{code:string}|null
}

export type OperationalNotification={
  id:string
  danger_area_id:string
  notification_type:'PRE_START_15M'|'OPEN_UNVERIFIED'
  reporting_window_start_at:string
  scheduled_for:string
  status:'PENDING'|'SENDING'|'SENT'|'FAILED'
  attempts:number
  sent_at:string|null
  seen_at:string|null
  acknowledged_at:string|null
  acknowledgement_note:string|null
  created_at:string
  danger_areas:{code:string;name:string}|null
}

export const dynamic='force-dynamic'

export default async function OperatorPage(){
  const supabase=await createClient()
  const {data:userData,error:userError}=await supabase.auth.getUser()
  if(userError||!userData.user)redirect('/operator/login')

  const {data:profile,error:profileError}=await supabase
    .from('operator_profiles')
    .select('display_name,account_status,must_change_password,organisations(name)')
    .eq('user_id',userData.user.id)
    .maybeSingle()

  if(profileError)throw new Error('Unable to load operator profile.')

  if(!profile||profile.account_status!=='ACTIVE'){
    return(
      <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'32px'}}>
        <div style={{maxWidth:'760px',margin:'0 auto'}}>
          <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Operator Access</div>
          <h1>Operator access unavailable</h1>
          <p style={{color:'#91a6b8'}}>Your identity is authenticated, but there is no active DASS operator profile assigned to this account.</p>
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </main>
    )
  }

  if(profile.must_change_password)redirect('/operator/change-password')

  const {data:assignedData,error:assignedError}=await supabase
    .from('operator_effective_danger_areas')
    .select(`user_id,can_change_status,id,code,name,lower_limit,upper_limit,
      promulgated_period,authority,airspace_when_inactive,declared_status,
      effective_status,status_updated_at,status_valid_until,
      reporting_window_start_at,reporting_window_end_at,reporting_window_open,
      pre_activation_lead_minutes,pre_activation_window_open,
      scheduled_activation_at,scheduled_activation_created_at,
      scheduled_activation_note,activation_scheduled,
      scheduled_activation_period_id,operational_period_id,
      operational_period_reference,operational_period_source,
      operational_period_status`)
    .eq('user_id',userData.user.id)
    .order('code',{ascending:true})

  if(assignedError)throw new Error('Unable to load assigned Danger Areas.')
  const assigned=(assignedData??[]) as AssignedArea[]

  const {data:eventData,error:eventError}=await supabase
    .from('status_events')
    .select(`id,previous_status,new_status,changed_at,note,valid_until,
      event_source,event_type,effective_at,danger_areas(code)`)
    .order('changed_at',{ascending:false})
    .limit(20)

  if(eventError)throw new Error('Unable to load status audit history.')
  const events=(eventData??[]) as unknown as StatusEvent[]

  const {data:notificationData,error:notificationError}=await supabase
    .from('operational_notifications')
    .select(`id,danger_area_id,notification_type,reporting_window_start_at,
      scheduled_for,status,attempts,sent_at,seen_at,acknowledged_at,
      acknowledgement_note,created_at,danger_areas(code,name)`)
    .eq('user_id',userData.user.id)
    .order('created_at',{ascending:false})
    .limit(30)

  if(notificationError)throw new Error('Unable to load operational notifications.')
  const notifications=(notificationData??[]) as unknown as OperationalNotification[]

  const organisation=(profile.organisations as {name?:string}|null)?.name??'No organisation'

  return(
    <>
      <OperationalPeriodsPreview mode="operator"/>
      <OperatorPeriodBasis assigned={assigned}/>
      <OperationalDashboard
        operatorName={profile.display_name}
        organisation={organisation}
        assigned={assigned}
        events={events}
        notifications={notifications}
      />
    </>
  )
}
