'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/operator/login')
}

export async function changeDangerAreaStatus(formData: FormData) {
  const areaId = String(formData.get('area_id') ?? '')
  const newStatus = String(formData.get('new_status') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!areaId) throw new Error('Missing Danger Area identifier.')
  if (!['ACTIVE', 'INACTIVE'].includes(newStatus)) {
    throw new Error('Invalid Danger Area status.')
  }

  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()
  if (!claimsData?.claims?.sub) {
    redirect('/operator/login')
  }

  const { error } = await supabase.rpc('request_danger_area_status_change', {
    p_danger_area_id: areaId,
    p_new_status: newStatus,
    p_note: note || null,
  })

  if (error) {
    throw new Error(error.message || 'Unable to update Danger Area status.')
  }

  revalidatePath('/operator')
}
