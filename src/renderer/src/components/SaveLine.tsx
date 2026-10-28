import { useEffect, useId } from 'react'
import type { JSX } from 'react'
import {
  describeLocation,
  envelopeOf,
  saveLocations,
  timeAgo,
  type EnvelopeState
} from '../lib/saveLocations'
import { useWyrm } from '../store'

/** How often the line asks whether a card has been plugged in or taken out. */
export const REACH_CHECK_MS = 30_000

const STATE_WORDS: Record<EnvelopeState, string> = {
  saved: 'saved',
  behind: 'not up to date',
  saving: 'saving',
  missing: 'not connected',
  attention: 'needs attention'
}

/**
 * One envelope, drawn in whole pixels: filled when the location holds the
 * latest save, empty when it is behind, dithered while it is being written,
 * dashed when its drive is missing, and marked with "!" when it needs the
 * writer.
 */
function Envelope({ state }: { state: EnvelopeState }): JSX.Element {
  const dither = useId()
  const filled = state === 'saved'
  return (
    <svg
      className={`envelope ${state}`}
      width="18"
      height="13"
      viewBox="0 0 18 13"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {state === 'saving' && (
        <defs>
          <pattern id={dither} width="2" height="2" patternUnits="userSpaceOnUse">
            <rect width="1" height="1" fill="var(--ink)" />
            <rect x="1" y="1" width="1" height="1" fill="var(--ink)" />
          </pattern>
        </defs>
      )}
      <rect
        x="1"
        y="1"
        width="16"
        height="11"
        fill={filled ? 'var(--ink)' : state === 'saving' ? `url(#${dither})` : 'var(--paper)'}
        stroke="var(--ink)"
        strokeWidth="2"
        strokeDasharray={state === 'missing' ? '2 2' : undefined}
      />
      {state === 'attention' ? (
        <>
          <rect x="8" y="3" width="2" height="5" fill="var(--ink)" />
          <rect x="8" y="9" width="2" height="2" fill="var(--ink)" />
        </>
      ) : (
        <path
          d="M2 2l7 5 7-5"
          fill="none"
          stroke={filled ? 'var(--paper)' : 'var(--ink)'}
          strokeWidth="2"
        />
      )}
    </svg>
  )
}

/**
 * F-50 step 2: the status line — one envelope per place the work is kept, in
 * the drawer's order, default first, then how long since the default was
 * last saved. The whole line opens the drawer; an envelope opens it on that
 * location's card.
 */
export function SaveLine({
  now,
  onOpen
}: {
  /** The status bar's clock, so "2 MIN AGO" ticks with the rest of it. */
  now: number
  onOpen: (locationId?: string) => void
}): JSX.Element | null {
  const project = useWyrm((s) => s.project)
  const backupSettings = useWyrm((s) => s.backupSettings)
  const syncStatus = useWyrm((s) => s.syncStatus)
  const lastCommitAt = useWyrm((s) => s.lastCommitAt)
  const unreachable = useWyrm((s) => s.unreachable)
  const syncProblem = useWyrm((s) => s.syncProblem)
  const syncNeedsAttention = useWyrm((s) => s.syncNeedsAttention)
  const savingTo = useWyrm((s) => s.savingTo)
  const behind = useWyrm((s) => s.behind)

  // A card comes and goes without the app being told, so ask as the line
  // appears (a project brought forward may hold an old answer), now and
  // then, and whenever the window comes back to the front.
  useEffect(() => {
    const check = (): void => {
      void useWyrm
        .getState()
        .checkLocations()
        .catch(() => {})
    }
    check()
    const timer = setInterval(check, REACH_CHECK_MS)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', check)
    }
  }, [])

  if (!project) return null
  const locations = saveLocations(project.path, lastCommitAt, backupSettings, syncStatus)
  const ctx = { sync: syncStatus, unreachable, behind, syncProblem, syncNeedsAttention, savingTo }
  const envelopes = locations.map((location) => ({ location, ...envelopeOf(location, ctx) }))
  const attention = envelopes.some((e) => e.state === 'attention')
  const last = locations[0]?.lastSavedAt ?? null

  return (
    <span className="save-line" data-help="save-line">
      {envelopes.map(({ location, state, reason }) => {
        const { name } = describeLocation(location)
        return (
          <button
            key={location.id}
            type="button"
            className="save-envelope"
            aria-label={`${name}: ${STATE_WORDS[state]}${reason && state !== 'saving' ? `. ${reason}` : ''}`}
            onClick={() => onOpen(location.id)}
          >
            <Envelope state={state} />
            {reason != null && (
              <span className="save-tip" aria-hidden="true">
                {name}: {reason}
              </span>
            )}
          </button>
        )
      })}
      <button type="button" className="save-line-time" onClick={() => onOpen()}>
        {last != null ? timeAgo(last, now).toUpperCase() : 'NOT SAVED YET'}
        {attention && <span className="save-line-bang">!</span>}
      </button>
    </span>
  )
}
