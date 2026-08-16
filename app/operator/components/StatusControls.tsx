'use client'

import { useState, useTransition } from 'react'
import {
  cancelDangerAreaActivation,
  changeDangerAreaStatus,
  scheduleDangerAreaActivation,
} from '../actions'

type Props = {
  areaId: string
  code: string
  currentStatus: 'ACTIVE' | 'INACTIVE' | 'UNVERIFIED'
  canChangeStatus: boolean
  reportingWindowOpen: boolean
  reportingWindowLabel: string
  preActivationWindowOpen: boolean
  preActivationLeadMinutes: number
  activationScheduled: boolean
  scheduledActivationAt: string | null
}

function formatUtc(value: string | null) {
  if (!value) return '—'
  return (
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(value)) + ' UTC'
  )
}

export default function StatusControls({
  areaId,
  code,
  currentStatus,
  canChangeStatus,
  reportingWindowOpen,
  reportingWindowLabel,
  preActivationWindowOpen,
  preActivationLeadMinutes,
  activationScheduled,
  scheduledActivationAt,
}: Props) {
  const [intent, setIntent] = useState<
    'ACTIVE' | 'INACTIVE' | 'SCHEDULE' | 'CANCEL_SCHEDULE' | null
  >(null)
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

  function reset() {
    setIntent(null)
    setNote('')
    setError('')
  }

  function submitStatus() {
    if (intent !== 'ACTIVE' && intent !== 'INACTIVE') return

    const formData = new FormData()
    formData.set('area_id', areaId)
    formData.set('new_status', intent)
    formData.set('note', note)

    setError('')
    startTransition(async () => {
      const result = await changeDangerAreaStatus(formData)
      if (!result.ok) {
        setError(result.message ?? 'Unable to update status.')
        return
      }
      reset()
    })
  }

  function submitSchedule() {
    const formData = new FormData()
    formData.set('area_id', areaId)
    formData.set('note', note)

    setError('')
    startTransition(async () => {
      const result = await scheduleDangerAreaActivation(formData)
      if (!result.ok) {
        setError(result.message ?? 'Unable to schedule activation.')
        return
      }
      reset()
    })
  }

  function submitCancelSchedule() {
    const formData = new FormData()
    formData.set('area_id', areaId)
    formData.set('note', note)

    setError('')
    startTransition(async () => {
      const result = await cancelDangerAreaActivation(formData)
      if (!result.ok) {
        setError(result.message ?? 'Unable to cancel scheduled activation.')
        return
      }
      reset()
    })
  }

  if (activationScheduled && !reportingWindowOpen) {
    return (
      <div
        style={{
          marginTop: '15px',
          border: '1px solid rgba(89,208,240,.34)',
          background: 'rgba(89,208,240,.055)',
          borderRadius: '11px',
          padding: '14px',
        }}
      >
        <div
          style={{
            color: '#8fdaf0',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '.12em',
            fontWeight: 900,
          }}
        >
          Activation scheduled
        </div>

        <div
          style={{
            marginTop: '7px',
            color: '#d8e8ef',
            fontSize: '13px',
            lineHeight: 1.5,
          }}
        >
          {code} is scheduled to become ACTIVE at{' '}
          <strong>{formatUtc(scheduledActivationAt)}</strong>.
        </div>

        <div
          style={{
            marginTop: '7px',
            color: '#8fa8b7',
            fontSize: '11px',
            lineHeight: 1.5,
          }}
        >
          The scheduled activation does not change the current public DASS status
          before its effective time.
        </div>

        {intent !== 'CANCEL_SCHEDULE' ? (
          <button
            type="button"
            onClick={() => setIntent('CANCEL_SCHEDULE')}
            style={{
              marginTop: '12px',
              width: '100%',
              background: '#10212d',
              border: '1px solid #516a79',
              color: '#dceef7',
              borderRadius: '9px',
              padding: '10px 12px',
              fontWeight: 800,
            }}
          >
            CANCEL SCHEDULED ACTIVATION
          </button>
        ) : (
          <div style={{ marginTop: '12px' }}>
            <label
              style={{
                display: 'grid',
                gap: '6px',
                color: '#91a6b8',
                fontSize: '11px',
              }}
            >
              Cancellation note{' '}
              <span style={{ color: '#607888' }}>(optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 240))}
                maxLength={240}
                rows={2}
                placeholder="e.g. Range activity no longer required"
                style={{
                  width: '100%',
                  resize: 'vertical',
                  background: '#08131c',
                  border: '1px solid #2a4050',
                  borderRadius: '8px',
                  color: '#edf5fb',
                  padding: '10px',
                  font: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </label>

            <div
              style={{
                marginTop: '10px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}
            >
              <button
                type="button"
                disabled={isPending}
                onClick={reset}
                style={{
                  background: '#10212d',
                  border: '1px solid #385267',
                  color: '#dceef7',
                  borderRadius: '8px',
                  padding: '9px',
                }}
              >
                Keep schedule
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={submitCancelSchedule}
                style={{
                  background: '#432328',
                  border: '1px solid #92535a',
                  color: '#ffc0c4',
                  borderRadius: '8px',
                  padding: '9px',
                  fontWeight: 850,
                }}
              >
                {isPending ? 'Cancelling…' : 'Confirm cancellation'}
              </button>
            </div>
          </div>
        )}

        {error && <ErrorMessage message={error} />}
      </div>
    )
  }

  if (!reportingWindowOpen && preActivationWindowOpen) {
    return (
      <div
        style={{
          marginTop: '15px',
          border: '1px solid rgba(89,208,240,.34)',
          background: 'rgba(89,208,240,.055)',
          borderRadius: '11px',
          padding: '14px',
        }}
      >
        <div
          style={{
            color: '#8fdaf0',
            fontSize: '10px',
            textTransform: 'uppercase',
            letterSpacing: '.12em',
            fontWeight: 900,
          }}
        >
          Pre-activation window open
        </div>

        <div
          style={{
            marginTop: '7px',
            color: '#d6e3eb',
            fontSize: '12px',
            lineHeight: 1.55,
          }}
        >
          An authorised operator may schedule {code} to become ACTIVE at the
          reporting-window start. This records future intent only; the current
          DASS status remains {currentStatus}.
        </div>

        {intent !== 'SCHEDULE' ? (
          <button
            type="button"
            onClick={() => setIntent('SCHEDULE')}
            style={{
              marginTop: '12px',
              width: '100%',
              border: '1px solid rgba(89,208,240,.48)',
              background: 'rgba(89,208,240,.13)',
              color: '#a8e7f8',
              borderRadius: '9px',
              padding: '11px',
              fontWeight: 900,
            }}
          >
            SCHEDULE ACTIVATION
          </button>
        ) : (
          <div style={{ marginTop: '12px' }}>
            <div
              style={{
                borderLeft: '3px solid #59d0f0',
                paddingLeft: '10px',
                color: '#b9dce7',
                fontSize: '11px',
                lineHeight: 1.55,
                marginBottom: '11px',
              }}
            >
              Confirm {code} is planned to become ACTIVE at{' '}
              {formatUtc(scheduledActivationAt ?? null) !== '—'
                ? formatUtc(scheduledActivationAt)
                : 'the promulgated start time'}
              . DASS will not report it ACTIVE before that time.
            </div>

            <label
              style={{
                display: 'grid',
                gap: '6px',
                color: '#91a6b8',
                fontSize: '11px',
              }}
            >
              Operational note{' '}
              <span style={{ color: '#607888' }}>(optional)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 240))}
                maxLength={240}
                rows={3}
                placeholder="e.g. Planned range activity confirmed"
                style={{
                  width: '100%',
                  resize: 'vertical',
                  background: '#08131c',
                  border: '1px solid #2a4050',
                  borderRadius: '8px',
                  color: '#edf5fb',
                  padding: '10px',
                  font: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </label>

            <div
              style={{
                marginTop: '10px',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: '8px',
              }}
            >
              <button
                type="button"
                disabled={isPending}
                onClick={reset}
                style={{
                  background: '#10212d',
                  border: '1px solid #385267',
                  color: '#dceef7',
                  borderRadius: '8px',
                  padding: '9px',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={submitSchedule}
                style={{
                  background: '#17384b',
                  border: '1px solid #3e718b',
                  color: '#e5f8ff',
                  borderRadius: '8px',
                  padding: '9px',
                  fontWeight: 850,
                }}
              >
                {isPending ? 'Scheduling…' : 'Confirm schedule'}
              </button>
            </div>
          </div>
        )}

        <div
          style={{
            marginTop: '10px',
            color: '#6f8998',
            fontSize: '10px',
            lineHeight: 1.45,
          }}
        >
          Pre-activation lead time: {preActivationLeadMinutes} minutes.
          Scheduled stand-down is not supported.
        </div>

        {error && <ErrorMessage message={error} />}
      </div>
    )
  }

  if (!reportingWindowOpen) {
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
          The reporting window ({reportingWindowLabel}) is not open. The
          pre-activation option becomes available {preActivationLeadMinutes}{' '}
          minutes before the planned start.
        </div>
      </div>
    )
  }

  const standingDown = intent === 'INACTIVE'

  return (
    <div style={{ marginTop: '15px' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '9px',
        }}
      >
        <button
          type="button"
          disabled={isPending || currentStatus === 'ACTIVE'}
          onClick={() => setIntent('ACTIVE')}
          style={{
            border: '1px solid rgba(255,90,100,.42)',
            background:
              currentStatus === 'ACTIVE'
                ? 'rgba(255,90,100,.08)'
                : 'rgba(255,90,100,.15)',
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
            background:
              currentStatus === 'INACTIVE'
                ? 'rgba(79,209,139,.07)'
                : 'rgba(79,209,139,.14)',
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

      {(intent === 'ACTIVE' || intent === 'INACTIVE') && (
        <div
          style={{
            marginTop: '12px',
            border: `1px solid ${
              standingDown
                ? 'rgba(255,186,74,.38)'
                : 'rgba(89,208,240,.32)'
            }`,
            background: standingDown
              ? 'rgba(255,186,74,.06)'
              : 'rgba(89,208,240,.05)',
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

          <p
            style={{
              margin: '7px 0 12px',
              lineHeight: 1.5,
              fontSize: '13px',
              color: '#d6e3eb',
            }}
          >
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
              This action reports the area as inactive in DASS. It does not
              cancel or amend the promulgated NOTAM and does not supersede
              established ATC or Danger Area procedures.
            </div>
          )}

          <label
            style={{
              display: 'grid',
              gap: '6px',
              color: '#91a6b8',
              fontSize: '11px',
            }}
          >
            Operational note <span style={{ color: '#607888' }}>(optional)</span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value.slice(0, 240))}
              maxLength={240}
              rows={3}
              style={{
                width: '100%',
                resize: 'vertical',
                background: '#08131c',
                border: '1px solid #2a4050',
                borderRadius: '8px',
                color: '#edf5fb',
                padding: '10px',
                font: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </label>

          <div
            style={{
              marginTop: '11px',
              display: 'flex',
              justifyContent: 'flex-end',
              gap: '8px',
            }}
          >
            <button
              type="button"
              disabled={isPending}
              onClick={reset}
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
              onClick={submitStatus}
              style={{
                background: standingDown ? '#4b3820' : '#17384b',
                border: standingDown
                  ? '1px solid #a9792c'
                  : '1px solid #3e718b',
                color: '#f6f0e6',
                borderRadius: '8px',
                padding: '9px 12px',
                fontWeight: 850,
              }}
            >
              {isPending
                ? 'Updating…'
                : standingDown
                ? 'Confirm STAND DOWN'
                : 'Confirm ACTIVATE'}
            </button>
          </div>

          {error && <ErrorMessage message={error} />}
        </div>
      )}
    </div>
  )
}

function ErrorMessage({ message }: { message: string }) {
  return (
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
      {message}
    </div>
  )
}
