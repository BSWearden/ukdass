'use client'

import { useState, useTransition } from 'react'
import { changeDangerAreaStatus } from '../actions'

type Props = {
  areaId: string
  code: string
  currentStatus: 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED'
  canChangeStatus: boolean
  declarationAllowed: boolean
  reportingWindowLabel: string
}

export default function StatusControls({
  areaId,
  code,
  currentStatus,
  canChangeStatus,
  declarationAllowed,
  reportingWindowLabel,
}: Props) {
  const [intent, setIntent] = useState<'ACTIVE' | 'INACTIVE' | null>(null)
  const [note, setNote] = useState('')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  if (!canChangeStatus) {
    return (
      <div style={{ marginTop: '15px', fontSize: '11px', color: '#9aabba' }}>
        Read-only permission
      </div>
    )
  }

  if (!declarationAllowed) {
    return (
      <div
        style={{
          marginTop: '15px',
          border: '1px solid rgba(255,186,74,.30)',
          background: 'rgba(255,186,74,.06)',
          borderRadius: '10px',
          padding: '12px',
        }}
      >
        <div
          style={{
            color: '#ffd07d',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '.12em',
            fontWeight: 850,
          }}
        >
          Status controls locked
        </div>
        <div
          style={{
            marginTop: '6px',
            color: '#cbbd9d',
            fontSize: '11px',
            lineHeight: 1.55,
          }}
        >
          The current promulgated reporting window ({reportingWindowLabel}) is not open.
          DASS will remain UNVERIFIED until an authorised operator makes a declaration
          during a valid reporting period.
        </div>
      </div>
    )
  }

  function submit() {
    if (!intent) return

    setError('')

    const formData = new FormData()
    formData.set('area_id', areaId)
    formData.set('new_status', intent)
    formData.set('note', note)

    startTransition(async () => {
      const result = await changeDangerAreaStatus(formData)

      if (!result.ok) {
        setError(result.message ?? 'Unable to update status.')
        return
      }

      setIntent(null)
      setNote('')
      setError('')
    })
  }

  const standingDown = intent === 'INACTIVE'

  return (
    <div style={{ marginTop: '15px' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '9px' }}>
        <button
          type="button"
          disabled={isPending || currentStatus === 'ACTIVE'}
          onClick={() => setIntent('ACTIVE')}
          style={{
            border: '1px solid rgba(255,90,100,.42)',
            background: currentStatus === 'ACTIVE' ? 'rgba(255,90,100,.08)' : 'rgba(255,90,100,.15)',
            color: currentStatus === 'ACTIVE' ? '#8d5960' : '#ff9299',
            borderRadius: '9px',
            padding: '11px',
            fontWeight: 850,
            cursor: currentStatus === 'ACTIVE' ? 'not-allowed' : 'pointer',
          }}
        >
          ACTIVATE
        </button>

        <button
          type="button"
          disabled={isPending || currentStatus === 'INACTIVE'}
          onClick={() => setIntent('INACTIVE')}
          style={{
            border: '1px solid rgba(79,209,139,.40)',
            background: currentStatus === 'INACTIVE' ? 'rgba(79,209,139,.07)' : 'rgba(79,209,139,.14)',
            color: currentStatus === 'INACTIVE' ? '#537763' : '#84e8b0',
            borderRadius: '9px',
            padding: '11px',
            fontWeight: 850,
            cursor: currentStatus === 'INACTIVE' ? 'not-allowed' : 'pointer',
          }}
        >
          STAND DOWN
        </button>
      </div>

      {intent && (
        <div
          style={{
            marginTop: '12px',
            border: `1px solid ${standingDown ? 'rgba(255,186,74,.38)' : 'rgba(89,208,240,.32)'}`,
            background: standingDown ? 'rgba(255,186,74,.06)' : 'rgba(89,208,240,.05)',
            borderRadius: '11px',
            padding: '14px',
          }}
        >
          <div
            style={{
              fontSize: '10px',
              textTransform: 'uppercase',
              letterSpacing: '.13em',
              color: standingDown ? '#ffd07d' : '#8fdaf0',
              fontWeight: 850,
            }}
          >
            Confirmation required
          </div>

          <p style={{ margin: '7px 0 12px', lineHeight: 1.5, fontSize: '13px', color: '#d6e3eb' }}>
            {standingDown
              ? `Confirm ${code} is no longer active and may be reported by DASS as INACTIVE?`
              : `Confirm ${code} is active and may be reported by DASS as ACTIVE?`}
          </p>

          {standingDown && (
            <div
              style={{
                borderLeft: '3px solid #ffba4a',
                paddingLeft: '10px',
                marginBottom: '12px',
                color: '#d7c79f',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              This action reports the area as inactive in DASS. It does not cancel or amend
              the promulgated NOTAM and does not supersede established ATC or Danger Area procedures.
            </div>
          )}

          <label style={{ display: 'grid', gap: '6px', color: '#91a6b8', fontSize: '11px' }}>
            Operational note <span style={{ color: '#607888' }}>(optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 240))}
              maxLength={240}
              rows={3}
              placeholder="e.g. Live firing complete for the day"
              style={{
                width: '100%',
                resize: 'vertical',
                background: '#08131c',
                border: '1px solid #2a4050',
                borderRadius: '8px',
                color: '#edf5fb',
                padding: '10px',
                font: 'inherit',
              }}
            />
          </label>

          <div style={{ marginTop: '11px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setIntent(null)
                setNote('')
                setError('')
              }}
              style={{
                background: '#10212d',
                border: '1px solid #385267',
                color: '#dceef7',
                borderRadius: '8px',
                padding: '9px 11px',
              }}
            >
              Cancel
            </button>

            <button
              type="button"
              disabled={isPending}
              onClick={submit}
              style={{
                background: standingDown ? '#4b3820' : '#17384b',
                border: standingDown ? '1px solid #a9792c' : '1px solid #3e718b',
                color: '#f6f0e6',
                borderRadius: '8px',
                padding: '9px 12px',
                fontWeight: 850,
              }}
            >
              {isPending ? 'Updating…' : standingDown ? 'Confirm STAND DOWN' : 'Confirm ACTIVATE'}
            </button>
          </div>

          {error && (
            <div
              style={{
                marginTop: '10px',
                borderLeft: '3px solid #ff5a64',
                background: 'rgba(255,90,100,.07)',
                padding: '9px 10px',
                color: '#ffb1b6',
                fontSize: '11px',
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
