'use client'

import { useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type Props={
  runId:string
  sourceFile:string
  airacEffectiveDate:string
  recordCount:number
}

export default function AipPublishClient({runId,sourceFile,airacEffectiveDate,recordCount}:Props){
  const [confirmed,setConfirmed]=useState(false)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState<string|null>(null)
  const [error,setError]=useState<string|null>(null)

  async function publish(){
    if(!confirmed||busy)return
    setBusy(true);setError(null);setMessage('Publishing the validated dataset…')
    try{
      const supabase=createClient()
      const {data,error:publishError}=await supabase.rpc('admin_publish_aip_import',{p_import_run_id:runId})
      if(publishError)throw new Error(publishError.message)
      const result=data as {published_records?:number}
      setMessage('Published '+(result.published_records??recordCount)+' Danger Areas successfully. Refreshing…')
      window.location.reload()
    }catch(cause){
      setError(cause instanceof Error?cause.message:'The AIP dataset could not be published.')
      setMessage(null)
    }finally{setBusy(false)}
  }

  return <section style={{marginTop:'18px',border:'1px solid #8a611d',background:'rgba(217,119,6,.07)',borderRadius:'14px',padding:'18px'}}>
    <div style={{fontSize:'10px',letterSpacing:'.14em',textTransform:'uppercase',color:'#fbbf24',fontWeight:900}}>Publication approval required</div>
    <h2 style={{margin:'5px 0 7px',fontSize:'20px'}}>Publish validated AIP dataset</h2>
    <p style={{margin:'0 0 12px',fontSize:'12px',lineHeight:1.6,color:'#c7bda9'}}>This will make all {recordCount} validated Danger Areas from <strong>{sourceFile}</strong> current on the live map. AIRAC effective date: <strong>{airacEffectiveDate}</strong>.</p>
    <p style={{margin:'0 0 14px',fontSize:'11px',lineHeight:1.55,color:'#a99b81'}}>Existing operational declarations are preserved when a designator already exists. Records absent from this dataset are archived, not deleted.</p>
    <label style={{display:'flex',alignItems:'flex-start',gap:'9px',fontSize:'11px',lineHeight:1.45,color:'#e4d7bd',marginBottom:'14px',cursor:busy?'not-allowed':'pointer'}}>
      <input type="checkbox" checked={confirmed} disabled={busy} onChange={event=>setConfirmed(event.target.checked)} style={{marginTop:'2px'}}/>
      I have reviewed the validation summary and authorise publication of this AIRAC dataset.
    </label>
    <button type="button" disabled={!confirmed||busy} onClick={()=>void publish()} style={{border:'1px solid #d99a29',background:!confirmed||busy?'#3c3528':'#9a5a08',color:!confirmed||busy?'#8e8575':'#fff7e7',borderRadius:'9px',padding:'10px 14px',fontSize:'12px',fontWeight:900,cursor:!confirmed||busy?'not-allowed':'pointer'}}>
      {busy?'Publishing…':'Publish AIP dataset'}
    </button>
    {(message||error)&&<div role={error?'alert':'status'} aria-live="polite" style={{marginTop:'12px',fontSize:'11px',color:error?'#ff9299':'#84e8b0'}}>{error??message}</div>}
  </section>
}
