'use client'

import { FormEvent, useMemo, useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

export default function ChangeTemporaryPasswordPage(){
  const supabase=useMemo(()=>createClient(),[])
  const [password,setPassword]=useState('')
  const [confirm,setConfirm]=useState('')
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(false)

  async function submit(event:FormEvent){
    event.preventDefault()
    setMessage('')
    if(password.length<14){setMessage('Your new password must be at least 14 characters.');return}
    if(password!==confirm){setMessage('The two passwords do not match.');return}
    setLoading(true)
    const {data,error}=await supabase.functions.invoke('admin-operator-management',{body:{action:'CHANGE_TEMP_PASSWORD',newPassword:password}})
    setLoading(false)
    if(error||data?.error){setMessage(data?.error||error?.message||'Unable to change password.');return}
    await supabase.auth.signOut({scope:'local'})
    window.location.href='/operator/login'
  }

  return <main style={{minHeight:'100vh',background:'#071019',color:'#edf5fb',display:'grid',placeItems:'center',padding:'24px'}}>
    <section style={{width:'100%',maxWidth:'460px',background:'#0b1722',border:'1px solid #203243',borderRadius:'16px',padding:'28px',boxShadow:'0 18px 50px rgba(0,0,0,.35)'}}>
      <div style={{fontSize:'10px',letterSpacing:'.15em',textTransform:'uppercase',color:'#fbbf24',fontWeight:900}}>Temporary credentials</div>
      <h1 style={{margin:'8px 0',fontSize:'27px'}}>Set your DASS password</h1>
      <p style={{color:'#91a6b8',fontSize:'13px',lineHeight:1.6}}>Your administrator-issued password is temporary. You must set a private password before DASS will allow access to operational controls.</p>
      <form onSubmit={submit} style={{display:'grid',gap:'13px',marginTop:'20px'}}>
        <label style={label}>New password<input type="password" autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={14} style={input}/></label>
        <label style={label}>Confirm new password<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={14} style={input}/></label>
        <div style={{fontSize:'10px',lineHeight:1.5,color:'#718a9a'}}>Minimum 14 characters. Use a unique password that is not used for any other account.</div>
        {message&&<div style={{borderLeft:'3px solid #ff5a64',background:'rgba(255,90,100,.07)',padding:'10px 12px',fontSize:'11px',color:'#ffc0c4'}}>{message}</div>}
        <button disabled={loading} type="submit" style={{background:'#17657a',border:'1px solid #41849a',color:'white',borderRadius:'9px',padding:'12px',fontWeight:850}}>{loading?'Updating…':'Set password and continue'}</button>
      </form>
    </section>
  </main>
}
const label:React.CSSProperties={display:'grid',gap:'7px',fontSize:'11px',color:'#b8c8d6'}
const input:React.CSSProperties={background:'#08131c',border:'1px solid #2a4050',color:'#edf5fb',borderRadius:'9px',padding:'12px'}
