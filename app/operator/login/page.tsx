'use client'

import { FormEvent, useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

export default function OperatorLoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setLoading(true)
    setMessage('')

    const supabase = createClient()
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      setMessage('Unable to sign in. Check your credentials or contact the DASS administrator.')
      setLoading(false)
      return
    }

    window.location.href = '/operator'
  }

  return (
    <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',display:'grid',placeItems:'center',padding:'24px'}}>
      <section style={{width:'100%',maxWidth:'440px',background:'#0b1722',border:'1px solid #203243',borderRadius:'16px',padding:'28px',boxShadow:'0 18px 50px rgba(0,0,0,.35)'}}>
        <div style={{fontSize:'11px',letterSpacing:'.15em',textTransform:'uppercase',color:'#7f9db0',fontWeight:800}}>DASS Operator Access</div>
        <h1 style={{margin:'8px 0 8px',fontSize:'30px'}}>Sign in</h1>
        <p style={{color:'#91a6b8',lineHeight:1.6,fontSize:'14px'}}>Access is restricted to individually authorised Danger Area operators. Accounts are provisioned by the DASS administrator.</p>

        <form onSubmit={handleSubmit} style={{display:'grid',gap:'14px',marginTop:'22px'}}>
          <label style={{display:'grid',gap:'7px',fontSize:'12px',color:'#b8c8d6'}}>
            Email
            <input value={email} onChange={e=>setEmail(e.target.value)} type="email" autoComplete="username" required
              style={{background:'#08131c',border:'1px solid #2a4050',color:'#edf5fb',borderRadius:'9px',padding:'13px'}} />
          </label>
          <label style={{display:'grid',gap:'7px',fontSize:'12px',color:'#b8c8d6'}}>
            Password
            <input value={password} onChange={e=>setPassword(e.target.value)} type="password" autoComplete="current-password" required
              style={{background:'#08131c',border:'1px solid #2a4050',color:'#edf5fb',borderRadius:'9px',padding:'13px'}} />
          </label>

          {message && <div style={{borderLeft:'3px solid #ffba4a',background:'rgba(255,186,74,.08)',padding:'11px 12px',fontSize:'12px',lineHeight:1.5}}>{message}</div>}

          <button disabled={loading} type="submit"
            style={{marginTop:'4px',background:'#17384b',border:'1px solid #3e718b',color:'#e8f7ff',fontWeight:800,borderRadius:'9px',padding:'13px',cursor:'pointer'}}>
            {loading ? 'Signing in…' : 'Sign in to DASS'}
          </button>
        </form>

        <div style={{marginTop:'18px',fontSize:'11px',lineHeight:1.5,color:'#718a9a'}}>No public registration is available. If access is required, contact your organisation's nominated DASS administrator.</div>
        <a href="/" style={{display:'inline-block',marginTop:'20px',color:'#8fdaf0',fontSize:'12px'}}>← Return to live map</a>
      </section>
    </main>
  )
}
