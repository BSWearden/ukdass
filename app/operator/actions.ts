'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'

export type StatusChangeResult = {
  ok: boolean
  message?: string
}

export async function logout() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/operator/login')
}

export async function changeDangerAreaStatus(
  formData: FormData
): Promise<StatusChangeResult> {
  const areaId = String(formData.get('area_id') ?? '')
  const newStatus = String(formData.get('new_status') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!areaId) return { ok: false, message: 'Missing Danger Area identifier.' }

  if (!['ACTIVE', 'INACTIVE'].includes(newStatus)) {
    return { ok: false, message: 'Invalid Danger Area status.' }
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
    const raw = error.message || ''

    if (raw.includes('Promulgated end time has already passed')) {
      return {
        ok: false,
        message:
          'This Danger Area is outside its current promulgated reporting window. A new ACTIVE or INACTIVE declaration cannot be made until the next promulgated period.',
      }
    }

    if (raw.includes('Not authorised')) {
      return {
        ok: false,
        message: 'Your account is not authorised to change this Danger Area.',
      }
    }

    if (raw.includes('Authentication required')) {
      return {
        ok: false,
        message: 'Your operator session is no longer valid. Please sign in again.',
      }
    }

    return {
      ok: false,
      message: 'DASS could not record the status change. No status has been changed.',
    }
  }

  revalidatePath('/operator')
  return { ok: true }
}
