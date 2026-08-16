'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '../../lib/supabase/server'

export type OperatorActionResult = {
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
): Promise<OperatorActionResult> {
  const areaId = String(formData.get('area_id') ?? '')
  const newStatus = String(formData.get('new_status') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!areaId) return { ok: false, message: 'Missing Danger Area identifier.' }

  if (!['ACTIVE', 'INACTIVE'].includes(newStatus)) {
    return { ok: false, message: 'Invalid Danger Area status.' }
  }

  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()

  if (!claimsData?.claims?.sub) redirect('/operator/login')

  const { error } = await supabase.rpc('request_danger_area_status_change', {
    p_danger_area_id: areaId,
    p_new_status: newStatus,
    p_note: note || null,
  })

  if (error) {
    const raw = error.message || ''

    if (raw.includes('Reporting window is closed')) {
      return {
        ok: false,
        message:
          'This Danger Area is outside its current reporting window. No ACTIVE or INACTIVE declaration has been recorded.',
      }
    }

    if (raw.includes('Reporting window unavailable')) {
      return {
        ok: false,
        message:
          'DASS does not currently hold a valid machine-readable reporting window for this Danger Area.',
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

export async function scheduleDangerAreaActivation(
  formData: FormData
): Promise<OperatorActionResult> {
  const areaId = String(formData.get('area_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!areaId) return { ok: false, message: 'Missing Danger Area identifier.' }

  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()

  if (!claimsData?.claims?.sub) redirect('/operator/login')

  const { error } = await supabase.rpc(
    'request_schedule_danger_area_activation',
    {
      p_danger_area_id: areaId,
      p_note: note || null,
    }
  )

  if (error) {
    const raw = error.message || ''

    if (raw.includes('Pre-activation window is closed')) {
      return {
        ok: false,
        message:
          'The pre-activation window is not currently open. No activation has been scheduled.',
      }
    }

    if (raw.includes('Activation already scheduled')) {
      return {
        ok: false,
        message: 'An activation is already scheduled for this Danger Area.',
      }
    }

    if (raw.includes('Reporting window unavailable')) {
      return {
        ok: false,
        message:
          'DASS does not currently hold a valid machine-readable reporting window for this Danger Area.',
      }
    }

    if (raw.includes('Not authorised')) {
      return {
        ok: false,
        message: 'Your account is not authorised to schedule this Danger Area.',
      }
    }

    return {
      ok: false,
      message: 'DASS could not schedule the activation. No status has been changed.',
    }
  }

  revalidatePath('/operator')
  return { ok: true }
}

export async function cancelDangerAreaActivation(
  formData: FormData
): Promise<OperatorActionResult> {
  const areaId = String(formData.get('area_id') ?? '')
  const note = String(formData.get('note') ?? '').trim()

  if (!areaId) return { ok: false, message: 'Missing Danger Area identifier.' }

  const supabase = await createClient()
  const { data: claimsData } = await supabase.auth.getClaims()

  if (!claimsData?.claims?.sub) redirect('/operator/login')

  const { error } = await supabase.rpc(
    'request_cancel_danger_area_activation',
    {
      p_danger_area_id: areaId,
      p_note: note || null,
    }
  )

  if (error) {
    const raw = error.message || ''

    if (raw.includes('No activation is scheduled')) {
      return {
        ok: false,
        message: 'There is no scheduled activation to cancel.',
      }
    }

    if (raw.includes('can no longer be cancelled')) {
      return {
        ok: false,
        message:
          'The scheduled activation has reached its effective time and can no longer be cancelled. Use the normal STAND DOWN procedure if the area is now ACTIVE.',
      }
    }

    if (raw.includes('Not authorised')) {
      return {
        ok: false,
        message: 'Your account is not authorised to cancel this scheduled activation.',
      }
    }

    return {
      ok: false,
      message: 'DASS could not cancel the scheduled activation.',
    }
  }

  revalidatePath('/operator')
  return { ok: true }
}
