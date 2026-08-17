'use client'

import { useState } from 'react'
import { createClient } from '../../../lib/supabase/client'

type AipArea = {
  aixm_identifier:string
  designator:string
  name:string
  valid_from:string|null
  lower_limit:string
  upper_limit:string
  promulgated_period:string
  authority:string|null
  remarks:string|null
  geometry:[number,number][]
  geometry_segment_types:string[]
  source_vertex_count:number
  rendered_vertex_count:number
}

type AipDocument = {
  source_file:string
  source_sha256:string
  airac_effective_date:string
  danger_area_count:number
  areas:AipArea[]
}

function validateDocument(value:unknown):AipDocument {
  if(!value||typeof value!=='object')throw new Error('The selected file is not a DASS AIP staging document.')
  const document=value as Partial<AipDocument>
  if(document.danger_area_count!==220||!Array.isArray(document.areas)||document.areas.length!==220)throw new Error('The document must contain exactly 220 Danger Areas.')
  if(!document.source_file||!document.source_sha256?.match(/^[0-9a-f]{64}$/))throw new Error('The document does not contain valid source metadata.')
  if(!document.airac_effective_date?.match(/^\d{4}-\d{2}-\d{2}$/))throw new Error('The AIRAC effective date is missing or invalid.')
  const codes=new Set<string>()
  for(const area of document.areas){
    if(!area.designator?.match(/^EGD\d{3}[A-Z]*$/))throw new Error(`Invalid Danger Area designator: ${area.designator??'unknown'}`)
    if(codes.has(area.designator))throw new Error(`Duplicate Danger Area: ${area.designator}`)
    codes.add(area.designator)
    if(!Array.isArray(area.geometry)||area.geometry.length<4)throw new Error(`Invalid geometry: ${area.designator}`)
  }
  return document as AipDocument
}

export default function AipImportClient(){
  const [busy,setBusy]=useState(false)
  const [progress,setProgress]=useState('No file selected.')
  const [error,setError]=useState<string|null>(null)

  async function upload(file:File){
    setBusy(true);setError(null);setProgress('Reading and validating staging document…')
    try{
      if(file.size>10*1024*1024)throw new Error('The staging document exceeds the 10 MB safety limit.')
      const document=validateDocument(JSON.parse(await file.text()))
      const supabase=createClient()
      setProgress('Creating protected import run…')
      const {data:runId,error:beginError}=await supabase.rpc('admin_begin_aip_import',{p_manifest:{
        source_file:document.source_file,
        source_sha256:document.source_sha256,
        airac_effective_date:document.airac_effective_date,
        danger_area_count:document.danger_area_count
      }})
      if(beginError||!runId)throw new Error(beginError?.message??'Unable to create the import run.')

      for(let index=0;index<document.areas.length;index+=20){
        const batch=document.areas.slice(index,index+20)
        setProgress(`Staging areas ${index+1}–${Math.min(index+batch.length,document.areas.length)} of ${document.areas.length}…`)
        const {error:batchError}=await supabase.rpc('admin_stage_aip_danger_area_batch',{
          p_import_run_id:runId,p_areas:batch
        })
        if(batchError)throw new Error(`Batch ${Math.floor(index/20)+1} failed: ${batchError.message}`)
      }

      setProgress('Performing final database validation…')
      const {error:finalError}=await supabase.rpc('admin_finalize_aip_import',{p_import_run_id:runId})
      if(finalError)throw new Error(finalError.message)
      setProgress('Import validated successfully. Refreshing review data…')
      window.location.reload()
    }catch(cause){
      setError(cause instanceof Error?cause.message:'The import failed unexpectedly.')
      setProgress('Import stopped without affecting the live map.')
    }finally{setBusy(false)}
  }

  return <section style={{border:'1px solid #274052',background:'#0b1722',borderRadius:'14px',padding:'18px'}}>
    <div style={{fontSize:'10px',letterSpacing:'.14em',textTransform:'uppercase',color:'#7f9db0',fontWeight:850}}>Protected staging upload</div>
    <h2 style={{margin:'5px 0 7px',fontSize:'20px'}}>Load validated AIP extraction</h2>
    <p style={{margin:'0 0 14px',fontSize:'12px',lineHeight:1.6,color:'#91a6b8'}}>Select the DASS-generated JSON extraction. Records are uploaded in protected batches and remain invisible to the public map.</p>
    <label style={{display:'inline-flex',cursor:busy?'not-allowed':'pointer',background:busy?'#263744':'#0f6680',border:'1px solid #3b8297',color:'#effbff',borderRadius:'9px',padding:'10px 14px',fontSize:'12px',fontWeight:850}}>
      {busy?'Import in progress…':'Choose AIP staging file'}
      <input type="file" accept="application/json,.json" disabled={busy} style={{display:'none'}} onChange={event=>{const input=event.currentTarget;const file=input.files?.[0];if(file)void upload(file).finally(()=>{input.value=''})}}/>
    </label>
    <div role={error?'alert':'status'} aria-live="polite" style={{marginTop:'12px',fontSize:'11px',color:error?'#ff9299':'#a9bdc9'}}>{error??progress}</div>
    <div style={{marginTop:'13px',borderLeft:'3px solid #d97706',background:'rgba(217,119,6,.06)',padding:'9px 11px',fontSize:'10px',lineHeight:1.5,color:'#cfbf9d'}}><strong>Safety boundary:</strong> Validation does not publish, promote or replace any live Danger Area.</div>
  </section>
}
