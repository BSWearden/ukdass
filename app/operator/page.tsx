import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'
import { logout } from './actions'

export default async function OperatorPage() {
  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  const claims = claimsData?.claims

  if (!claims?.sub) redirect('/operator/login')

  const { data: profile } = await supabase
    .from('operator_profiles')
    .select('display_name, account_status, organisations(name)')
    .eq('user_id', claims.sub)
    .maybeSingle()

  if (!profile || profile.account_status !== 'ACTIVE') {
    return (
      <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'32px'}}>
        <h1>Operator access unavailable</h1>
        <p style={{color:'#91a6b8'}}>Your identity is authenticated, but there is no active DASS operator profile assigned to this account.</p>
        <form action={logout}><button type="submit">Sign out</button></form>
      </main>
    )
  }

  return (
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',padding:'28px'}}>
      <div style={{maxWidth:'1000px',margin:'0 auto'}}>
        <div style={{display:'flex',justifyContent:'space-between',gap:'18px',alignItems:'center',borderBottom:'1px solid #203243',paddingBottom:'18px'}}>
          <div>
            <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Alpha 0.2</div>
            <h1 style={{margin:'5px 0'}}>Range Operator</h1>
            <div style={{color:'#91a6b8',fontSize:'13px'}}>Signed in as {profile.display_name}</div>
          </div>
          <form action={logout}><button type="submit" style={{background:'#10212d',border:'1px solid #385267',color:'#dceef7',borderRadius:'9px',padding:'10px 13px'}}>Sign out</button></form>
        </div>

        <section style={{marginTop:'28px',background:'#0b1722',border:'1px solid #203243',borderRadius:'14px',padding:'22px'}}>
          <div style={{fontSize:'11px',letterSpacing:'.12em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>Authentication complete</div>
          <h2 style={{marginBottom:'8px'}}>Operator account verified</h2>
          <p style={{color:'#91a6b8',lineHeight:1.6}}>Your account is authenticated and active. The next Alpha 0.2 increment will populate this dashboard only with Danger Areas explicitly assigned to your individual account.</p>
        </section>
      </div>
    </main>
  )
}
