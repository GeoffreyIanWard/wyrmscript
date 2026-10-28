import { useEffect, useId, useRef, useState } from 'react'
import type {
  JSX,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent
} from 'react'
import type { SyncOutcome } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import {
  brokenReason,
  conflictsWaiting,
  describeLocation,
  DIVERGED,
  driveName,
  removableWarning,
  canBeRemoved,
  MAX_LOCATIONS,
  moveLocation,
  removedBySingle,
  saveLocations,
  savesToMultiple,
  timeAgo,
  type SaveLocation
} from '../lib/saveLocations'
import { useFocusTrap } from '../lib/useFocusTrap'
import { guessRemovable } from '../../../shared/removable'
import { useWyrm } from '../store'
import { BringDownPanel } from './BringDownPanel'
import { SaveDrawerConflicts } from './SaveDrawerConflicts'
import { SaveDrawerGitHub } from './SaveDrawerGitHub'
import { SaveDrawerSettings } from './SaveDrawerSettings'

export type SaveDrawerTab = 'save' | 'restore' | 'settings' | 'github' | 'conflicts'
type Tab = SaveDrawerTab

const TABS: { id: Tab; label: string }[] = [
  { id: 'save', label: 'Save to' },
  { id: 'restore', label: 'Restore from' },
  { id: 'settings', label: 'Settings' },
  { id: 'github', label: 'GitHub' },
  { id: 'conflicts', label: 'Conflicts' }
]

/** How far a press must travel before it is a drag rather than a click. */
const DRAG_THRESHOLD = 4

/** A slight, fixed tilt per card — chosen from the id so it never jumps. */
const TILTS = [-0.8, 0.6, -0.5, 0.7]
function tiltOf(id: string): number {
  let hash = 0
  for (const ch of id) hash = (hash * 31 + ch.charCodeAt(0)) | 0
  return TILTS[Math.abs(hash) % TILTS.length]
}

/**
 * The paper clip on the default card, drawn in whole pixels. Four wires two
 * pixels thick with two pixels of paper between any that run side by side,
 * and a one-pixel paper outline so the clip stays clear of the card's border.
 */
const CLIP_WIRES: [number, number, number, number][] = [
  [4, 14, 2, 22],
  [6, 35, 2, 2],
  [8, 4, 2, 31],
  [2, 2, 6, 2],
  [0, 4, 2, 39],
  [2, 42, 10, 2],
  [12, 12, 2, 30]
]

function PaperClip(): JSX.Element {
  return (
    <svg
      className="paper-clip"
      width="16"
      height="46"
      viewBox="-1 -1 16 46"
      shapeRendering="crispEdges"
      aria-hidden="true"
    >
      {CLIP_WIRES.map(([x, y, w, h], i) => (
        <rect key={`h${i}`} x={x - 1} y={y - 1} width={w + 2} height={h + 2} fill="var(--paper)" />
      ))}
      {CLIP_WIRES.map(([x, y, w, h], i) => (
        <rect key={`w${i}`} x={x} y={y} width={w} height={h} fill="var(--ink)" />
      ))}
    </svg>
  )
}

/** "Broken connection!" with the particular cause on hover or focus. */
function Broken({ reason }: { reason: string }): JSX.Element {
  const tipId = useId()
  return (
    <span
      className="broken-connection"
      tabIndex={0}
      aria-describedby={tipId}
      data-help="broken-connection"
    >
      Broken connection!
      <span role="tooltip" id={tipId} className="save-tip">
        {reason}
      </span>
    </span>
  )
}

/** What a sync outcome means for the GitHub card, or null when all is well. */
function syncProblem(outcome: SyncOutcome): string | null {
  if (outcome.status === 'offline' || outcome.status === 'error') return outcome.detail
  if (outcome.status === 'conflicts')
    return 'Some passages need your eye before this copy is up to date.'
  if ((outcome.status === 'pulled' || outcome.status === 'merged') && !outcome.pushed)
    return 'Brought in work from your other device. It has not gone back up yet.'
  return null
}

interface Drag {
  id: string
  pointerId: number
  /** Where the press was, moved by a slot each time the card swaps places. */
  originY: number
  /** Distance between one card's top and the next one's. */
  slot: number
  moved: boolean
  /** The order when the press began, to tell whether the drop changed it. */
  before: string[]
}

export function SaveDrawer({
  focusId,
  initialTab = 'save',
  onClose
}: {
  /** The card to put focus on as the drawer opens — an envelope's location. */
  focusId?: string
  /** The tab to open on — a palette item may ask for GitHub or Restore from. */
  initialTab?: Tab
  onClose: () => void
}): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const backupSettings = useWyrm((s) => s.backupSettings)
  const syncStatus = useWyrm((s) => s.syncStatus)
  const syncNeedsAttention = useWyrm((s) => s.syncNeedsAttention)
  const lastSyncProblem = useWyrm((s) => s.syncProblem)
  const waitingConflicts = useWyrm((s) => s.waitingConflicts)
  const lastCommitAt = useWyrm((s) => s.lastCommitAt)
  // Which drives are missing lives in the store, so the status line's
  // envelopes and these cards always agree (F-50 step 2).
  const unreachable = useWyrm((s) => s.unreachable)
  const diverged = useWyrm((s) => s.diverged)

  const [tab, setTab] = useState<Tab>(initialTab)
  const [bringDownOpen, setBringDownOpen] = useState(false)
  const [busy, setBusy] = useState<'save' | 'add' | 'remove' | 'restore' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [confirm, setConfirm] = useState<
    { kind: 'remove'; id: string } | { kind: 'single' } | null
  >(null)
  const [addOpen, setAddOpen] = useState(false)
  // The order shown while a drag is under way or a reorder is being written,
  // so the cards do not jump back while the store catches up.
  const [pending, setPending] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [dragDy, setDragDy] = useState(0)
  const drag = useRef<Drag | null>(null)
  const listRef = useRef<HTMLOListElement>(null)

  const conflictsHere = conflictsWaiting(syncNeedsAttention, lastSyncProblem, waitingConflicts)
  const path = project?.path ?? ''
  const stored = project ? saveLocations(path, lastCommitAt, backupSettings, syncStatus) : []
  const locations = pending
    ? (pending.map((id) => stored.find((l) => l.id === id)).filter(Boolean) as SaveLocation[])
    : stored
  const pendingRef = useRef<string[] | null>(null)
  const locationsRef = useRef(locations)

  useEffect(() => {
    const { loadBackupSettings, loadSyncStatus, checkLocations } = useWyrm.getState()
    void loadBackupSettings()
      .then(() => checkLocations())
      .catch((e: unknown) => setError(errorMessage(e)))
    void loadSyncStatus().catch(() => {})
  }, [])

  // Opened from an envelope: land on that location's card, once, as soon as
  // it is on screen (the cards wait for the settings to load).
  const focused = useRef(false)
  // StrictMode mounts twice, and the focus trap's second mount puts focus
  // back on its first control; a flag that outlived the first mount would
  // then never focus the card again.
  useEffect(
    () => () => {
      focused.current = false
    },
    []
  )
  useEffect(() => {
    // A card to focus belongs to the Save to tab it was opened on.
    if (focused.current || !focusId || initialTab !== 'save') return
    // Compared rather than put in a selector: an id is the writer's data.
    const card = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[data-location-id]') ?? [])
    ].find((el) => el.dataset.locationId === focusId)
    if (!card) return
    focused.current = true
    card.focus()
  })

  /* ---------- order ---------- */

  const writeOrder = (order: string[]): void => {
    setNote(null)
    const same = order.join('\n') === stored.map((l) => l.id).join('\n')
    if (same) {
      setPending(null)
      return
    }
    setPending(order)
    pendingRef.current = order
    void useWyrm
      .getState()
      .setSaveOrder(order)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => {
        // Only the latest write clears the hold; an older one finishing late
        // must not snap the cards back to the order it wrote.
        if (pendingRef.current === order) {
          pendingRef.current = null
          setPending(null)
        }
      })
  }

  // The document listeners are bound once, so they reach this render's
  // locations and writer through refs rather than a stale closure.
  const writeRef = useRef(writeOrder)
  useEffect(() => {
    locationsRef.current = locations
    writeRef.current = writeOrder
  })

  const onCardKey = (e: ReactKeyboardEvent<HTMLLIElement>, id: string): void => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const at = locations.findIndex((l) => l.id === id)
    writeOrder(moveLocation(locations, id, at + (e.key === 'ArrowUp' ? -1 : 1)))
  }

  // The gesture is tracked on the document from the press, never with
  // pointer capture: a first move that lands off the card is otherwise lost,
  // and capture redirects the click the card's own buttons need (see the
  // corkboard's cards, which learned both the hard way).
  const onCardDown = (e: ReactPointerEvent<HTMLLIElement>, id: string): void => {
    if (e.button !== 0 || locations.length < 2) return
    if ((e.target as HTMLElement).closest('button, .broken-connection')) return
    const cards = listRef.current?.querySelectorAll<HTMLElement>('.save-card')
    const slot =
      cards && cards.length > 1
        ? cards[1].getBoundingClientRect().top - cards[0].getBoundingClientRect().top
        : 0
    drag.current = {
      id,
      pointerId: e.pointerId,
      originY: e.clientY,
      slot: slot > 0 ? slot : 80,
      moved: false,
      before: locations.map((l) => l.id)
    }
  }

  useEffect(() => {
    const move = (e: PointerEvent): void => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      let dy = e.clientY - d.originY
      if (!d.moved) {
        if (Math.abs(dy) < DRAG_THRESHOLD) return
        d.moved = true
        setDragId(d.id)
        setPending(d.before)
      }
      const order = pendingRef.current ?? locationsRef.current.map((l) => l.id)
      const at = order.indexOf(d.id)
      if (dy > d.slot / 2 && at < order.length - 1) {
        const next = [...order]
        next.splice(at, 1)
        next.splice(at + 1, 0, d.id)
        pendingRef.current = next
        setPending(next)
        d.originY += d.slot
        dy -= d.slot
      } else if (dy < -d.slot / 2 && at > 0) {
        const next = [...order]
        next.splice(at, 1)
        next.splice(at - 1, 0, d.id)
        pendingRef.current = next
        setPending(next)
        d.originY -= d.slot
        dy += d.slot
      }
      // Whole pixels in steps of two, like everything else in the 1-bit chrome.
      setDragDy(Math.round(dy / 2) * 2)
    }
    const up = (e: PointerEvent): void => {
      const d = drag.current
      if (!d || e.pointerId !== d.pointerId) return
      drag.current = null
      if (!d.moved) return
      setDragId(null)
      setDragDy(0)
      const order = pendingRef.current ?? d.before
      pendingRef.current = null
      if (order.join('\n') === d.before.join('\n')) setPending(null)
      else writeRef.current(order)
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', up)
    return () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', up)
    }
  }, [])

  /* ---------- adding and removing ---------- */

  const atMax = locations.length >= MAX_LOCATIONS
  const hasGithub = locations.some((l) => l.kind === 'github')

  const openAdd = (): void => {
    setError(null)
    if (atMax) {
      setAddOpen(false)
      setNote(`${MAX_LOCATIONS} locations at most. Remove one to add another.`)
      return
    }
    setNote(null)
    setAddOpen((open) => !open)
  }

  const addDisk = (): void => {
    setNote(null)
    setAddOpen(false)
    setBusy('add')
    const before = new Set((backupSettings?.targets ?? []).map((t) => t.id))
    void useWyrm
      .getState()
      .chooseBackupLocation()
      .then(() => {
        // Said as the drive arrives, when the guess is that it is removable;
        // the switch on its card is there if the guess is wrong (F-50 step 4).
        const added = useWyrm.getState().backupSettings?.targets.find((t) => !before.has(t.id))
        if (added && (added.removable ?? guessRemovable(added.path))) {
          setNote(removableWarning(driveName(added.path)))
        }
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const toggleRemovable = (targetId: string, removable: boolean, name: string): void => {
    setError(null)
    void useWyrm
      .getState()
      .setTargetRemovable(targetId, removable)
      .then(() => setNote(removable ? removableWarning(name) : null))
      .catch((e: unknown) => setError(errorMessage(e)))
  }

  const remove = async (location: SaveLocation): Promise<void> => {
    const state = useWyrm.getState()
    if (location.kind === 'disk') await state.removeBackupTarget(location.id)
    else if (location.kind === 'github') await state.disconnectSync()
  }

  const confirmRemove = (ids: string[]): void => {
    setNote(null)
    setConfirm(null)
    setBusy('remove')
    setError(null)
    const doomed = locations.filter((l) => ids.includes(l.id))
    void (async () => {
      for (const location of doomed) await remove(location)
    })()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const toggleMultiple = (): void => {
    if (!savesToMultiple(locations)) openAdd()
    else if (removedBySingle(locations).length > 0) setConfirm({ kind: 'single' })
    // Only the folder is left beside the default, and it is never removed.
    else setNote('This computer always keeps a copy, so it stays beside the default.')
  }

  /* ---------- saving ---------- */

  const saveNow = (): void => {
    setNote(null)
    setBusy('save')
    setError(null)
    setProblems({})
    void useWyrm
      .getState()
      .saveEverywhere()
      .then(({ backup, sync }) => {
        const found: Record<string, string> = {}
        if (backup && 'error' in backup) {
          for (const l of locations) if (l.kind === 'disk') found[l.id] = backup.error
        } else if (backup) {
          // The store has already marked the drives this run could not reach.
          for (const r of backup.results) if (r.status === 'failed') found[r.targetId] = r.message
        }
        const problem = sync && syncProblem(sync)
        if (problem) found.github = problem
        setProblems(found)
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const restoreBackup = (): void => {
    setBusy('restore')
    setError(null)
    void useWyrm
      .getState()
      .restoreFromBackup()
      .then((opened) => {
        if (opened) onClose()
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  /* ---------- rendering ---------- */

  const onTabKey = (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const at = TABS.findIndex((t) => t.id === tab)
    const next = TABS[(at + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
    setTab(next.id)
    document.getElementById(`save-tab-${next.id}`)?.focus()
  }

  const single = removedBySingle(locations)

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div
        className="dialog save-drawer"
        role="dialog"
        aria-label="Save To"
        ref={trapRef}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Save To</span>
        </div>
        <div className="dialog-body">
          <div className="drawer-tabs" role="tablist" aria-label="Save To">
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`save-tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`save-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className={`drawer-tab${tab === t.id ? ' on' : ''}`}
                onClick={() => setTab(t.id)}
                onKeyDown={onTabKey}
              >
                <span>
                  {t.label}
                  {/* Waiting passages mark their tab, as they mark the line. */}
                  {t.id === 'conflicts' && conflictsHere && (
                    <span className="drawer-tab-bang" aria-label=", waiting">
                      !
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
          <div
            className="drawer-folder"
            role="tabpanel"
            id={`save-panel-${tab}`}
            aria-labelledby={`save-tab-${tab}`}
          >
            {error != null && (
              <div className="error-text drawer-paper" role="alert">
                {error}
              </div>
            )}

            {tab === 'save' && (
              <>
                <ol className="save-cards" ref={listRef} aria-label="Save locations, default first">
                  {locations.map((location, index) => {
                    const { name, detail } = describeLocation(location)
                    const reason = brokenReason(location, syncStatus, unreachable, lastSyncProblem)
                    const problem = problems[location.id]
                    const lifted = dragId === location.id
                    const isDefault = index === 0
                    return (
                      <li
                        key={location.id}
                        data-location-id={location.id}
                        className={`save-card${lifted ? ' lifted' : ''}${isDefault ? ' default' : ''}`}
                        style={{
                          transform: lifted
                            ? `translate(-2px, ${dragDy - 2}px)`
                            : `rotate(${tiltOf(location.id)}deg)`
                        }}
                        tabIndex={0}
                        aria-label={`${name}${isDefault ? ', default' : ''}`}
                        aria-describedby={`save-card-${location.id}`}
                        data-help="save-location"
                        onPointerDown={(e) => onCardDown(e, location.id)}
                        onKeyDown={(e) => onCardKey(e, location.id)}
                      >
                        {isDefault && <PaperClip />}
                        <div className="save-card-text" id={`save-card-${location.id}`}>
                          <div className="save-card-name">
                            {name}
                            {isDefault && <span className="save-card-default">Default</span>}
                          </div>
                          <div className="save-card-detail" title={detail}>
                            {detail}
                          </div>
                          {location.kind === 'disk' && (
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={location.removable}
                              className="control-row save-card-removable"
                              data-help="save-removable"
                              disabled={busy != null}
                              onClick={() =>
                                toggleRemovable(location.id, !location.removable, name)
                              }
                            >
                              <span className={`check${location.removable ? ' on' : ''}`} />
                              <span>Removable drive</span>
                            </button>
                          )}
                          {problem != null && <div className="error-text">{problem}</div>}
                          {diverged.includes(location.id) && (
                            <div className="error-text">{DIVERGED}</div>
                          )}
                        </div>
                        <div className="save-card-side">
                          {reason != null ? (
                            <Broken reason={reason} />
                          ) : location.kind === 'github' && syncNeedsAttention ? (
                            // Reached, but passages are waiting: not a broken
                            // connection, and not "saved" either.
                            <button
                              type="button"
                              className="btn small"
                              onClick={() => setTab('conflicts')}
                            >
                              Needs your eye
                            </button>
                          ) : (
                            <span className="save-card-when">
                              {location.lastSavedAt != null
                                ? `Saved ${timeAgo(location.lastSavedAt)}`
                                : 'Never saved'}
                            </span>
                          )}
                          {canBeRemoved(location) && (
                            <button
                              type="button"
                              className="btn small"
                              disabled={busy != null}
                              aria-label={`Remove ${name}`}
                              onClick={() => setConfirm({ kind: 'remove', id: location.id })}
                            >
                              Remove
                            </button>
                          )}
                        </div>
                        {confirm?.kind === 'remove' && confirm.id === location.id && (
                          <div
                            className="save-confirm"
                            role="alertdialog"
                            aria-label={`Remove ${name}?`}
                          >
                            <span>
                              {location.kind === 'github'
                                ? 'Stop saving to GitHub? Your copy there stays, and nothing on GitHub is deleted.'
                                : `Stop saving to ${name}? The copy already there stays where it is.`}
                            </span>
                            <span className="control-row">
                              <button
                                type="button"
                                className="btn small default"
                                onClick={() => confirmRemove([location.id])}
                              >
                                Remove
                              </button>
                              <button
                                type="button"
                                className="btn small"
                                onClick={() => setConfirm(null)}
                              >
                                Keep
                              </button>
                            </span>
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ol>
                <div className="drawer-hint drawer-paper">
                  Drag a card to the top, or press ⌥↑, to make it the default.
                </div>
                {/* Said plainly and once, never as a nag: keeping only this
                    computer is a real choice (F-01), and GitHub is never
                    offered as the remedy. */}
                {locations.length === 1 && (
                  <div className="drawer-hint drawer-paper">
                    This computer holds the only copy. Every version is kept, but all of it lives on
                    one disk, and a disk that dies takes it with it. Another location is what
                    protects against that.
                  </div>
                )}
                {locations.some((l) => l.kind === 'disk') && (
                  <div className="drawer-hint drawer-paper">
                    A drive or card protects against this disk dying. A folder on this same disk
                    does not — nothing here can tell which, so it is worth knowing yourself.
                  </div>
                )}

                {confirm?.kind === 'single' && (
                  <div
                    className="save-confirm drawer-paper"
                    role="alertdialog"
                    aria-label="Save to one location?"
                  >
                    <span>
                      Stop saving to {single.map((l) => describeLocation(l).name).join(' and ')}?
                      The copies already there stay
                      {single.some((l) => l.kind === 'github')
                        ? ', and nothing on GitHub is deleted'
                        : ''}
                      .
                    </span>
                    <span className="control-row">
                      <button
                        type="button"
                        className="btn small default"
                        onClick={() => confirmRemove(single.map((l) => l.id))}
                      >
                        Remove
                      </button>
                      <button type="button" className="btn small" onClick={() => setConfirm(null)}>
                        Keep
                      </button>
                    </span>
                  </div>
                )}

                <div className="drawer-actions">
                  <span className="drawer-add">
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={addOpen}
                      disabled={busy === 'add'}
                      data-help="save-add-location"
                      onClick={openAdd}
                    >
                      {busy === 'add' ? 'Choosing…' : 'Add Location…'}
                    </button>
                    {addOpen && (
                      <span className="drawer-add-menu" role="menu">
                        <button type="button" role="menuitem" className="btn" onClick={addDisk}>
                          A Drive or Card…
                        </button>
                        {!hasGithub && (
                          <button
                            type="button"
                            role="menuitem"
                            className="btn"
                            onClick={() => {
                              // Linking a project to GitHub is the GitHub tab's.
                              setAddOpen(false)
                              setTab('github')
                            }}
                          >
                            GitHub…
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={savesToMultiple(locations)}
                    className="control-row drawer-paper"
                    disabled={busy != null}
                    data-help="save-multiple"
                    onClick={toggleMultiple}
                  >
                    <span className={`check${savesToMultiple(locations) ? ' on' : ''}`} />
                    <span>Save to multiple locations</span>
                  </button>
                  <span className="spacer" />
                  <button
                    type="button"
                    className="btn default"
                    disabled={busy != null}
                    data-help="save-now"
                    onClick={saveNow}
                  >
                    {busy === 'save' ? 'Saving…' : 'Save Now'}
                  </button>
                </div>
                {note != null && (
                  <div className="drawer-hint drawer-paper" role="alert">
                    {note}
                  </div>
                )}
              </>
            )}

            {tab === 'restore' && (
              <ol className="save-cards">
                <li className="save-card" style={{ transform: `rotate(${tiltOf('backup')}deg)` }}>
                  <div className="save-card-text">
                    <div className="save-card-name">From a backup</div>
                    <div className="save-card-detail wraps">
                      A copy on a drive or card. It opens as a new project, beside this one.
                    </div>
                  </div>
                  <div className="save-card-side">
                    <button
                      type="button"
                      className="btn"
                      disabled={busy != null}
                      onClick={restoreBackup}
                    >
                      {busy === 'restore' ? 'Restoring…' : 'Choose…'}
                    </button>
                  </div>
                </li>
                <li className="save-card" style={{ transform: `rotate(${tiltOf('github')}deg)` }}>
                  <div className="save-card-text">
                    <div className="save-card-name">From GitHub</div>
                    <div className="save-card-detail wraps">
                      A project you keep on GitHub, brought down to this computer.
                    </div>
                  </div>
                  <div className="save-card-side">
                    <button
                      type="button"
                      className="btn"
                      aria-expanded={bringDownOpen}
                      disabled={busy != null}
                      onClick={() => setBringDownOpen((open) => !open)}
                    >
                      Choose…
                    </button>
                  </div>
                </li>
              </ol>
            )}
            {tab === 'restore' && bringDownOpen && (
              <div className="drawer-paper drawer-wide drawer-bring-down">
                <BringDownPanel
                  onBroughtDown={onClose}
                  onBusy={(on) => setBusy(on ? 'restore' : null)}
                />
              </div>
            )}

            {tab === 'settings' && <SaveDrawerSettings />}
            {tab === 'github' && <SaveDrawerGitHub locationCount={stored.length} />}
            {tab === 'conflicts' && <SaveDrawerConflicts onShowGitHub={() => setTab('github')} />}
          </div>
        </div>
      </div>
    </div>
  )
}
