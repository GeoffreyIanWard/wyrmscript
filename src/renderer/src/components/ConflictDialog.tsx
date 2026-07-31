import { useState } from 'react'
import type { JSX } from 'react'
import type { ConflictResolution, SyncConflict } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'
import { DiffView } from './VersionDialogs'

/**
 * The merge-conflict resolution screen (brief §7): the same passage changed on
 * two devices, and choosing is the writer's job — never diff3's, never ours.
 * Raw conflict markers must never appear anywhere near this dialog.
 */

const CHOICE_LABELS: { value: ConflictResolution; label: string }[] = [
  { value: 'mine', label: 'Keep this device’s version' },
  { value: 'theirs', label: 'Take the other device’s version' },
  { value: 'both', label: 'Keep mine — shelve theirs as a variant' }
]

function kindLabel(kind: SyncConflict['kind']): string {
  switch (kind) {
    case 'doc':
      return 'DOCUMENT'
    case 'entity':
      return 'STORY BIBLE'
    case 'project':
      return 'BINDER'
    default:
      return 'FILE'
  }
}

export function ConflictDialog(): JSX.Element | null {
  const dismiss = useWyrm((s) => s.dismissConflicts)
  const trapRef = useFocusTrap<HTMLDivElement>(dismiss)
  const conflicts = useWyrm((s) => s.syncConflicts)
  const resolveConflicts = useWyrm((s) => s.resolveConflicts)
  const dismissConflicts = useWyrm((s) => s.dismissConflicts)

  const [selected, setSelected] = useState(0)
  const [choices, setChoices] = useState<Map<string, ConflictResolution>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!conflicts || conflicts.length === 0) return null
  const current = conflicts[Math.min(selected, conflicts.length - 1)]
  const allChosen = conflicts.every((c) => choices.has(c.path))

  const choose = (path: string, resolution: ConflictResolution): void => {
    setChoices((prev) => new Map(prev).set(path, resolution))
    // Deciding one moves the eye to the next undecided — the common case is
    // working straight down the list.
    const nextUndecided = conflicts.findIndex((c, i) => i > selected && !choices.has(c.path))
    if (nextUndecided !== -1) setSelected(nextUndecided)
  }

  const resolve = (): void => {
    setBusy(true)
    setError(null)
    void resolveConflicts(
      conflicts.map((c) => ({ path: c.path, resolution: choices.get(c.path)! }))
    )
      .then((outcome) => {
        if (outcome.status === 'error' || outcome.status === 'offline') {
          setError(outcome.detail)
        }
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="dialog-overlay">
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button
            type="button"
            aria-label="Close"
            className="close-box"
            onClick={dismissConflicts}
          />
          <span className="title">Two Versions — Yours to Decide</span>
        </div>
        <div className="dialog-body">
          <div className="dialog-hint" style={{ marginTop: 0, marginBottom: 8 }}>
            These passages changed on two devices in ways that cannot both stay current. Nothing has
            been changed yet. Whichever way you decide, every version remains in history — and “keep
            both” shelves the other device’s text as a variant of the document.
          </div>
          {error != null && <div className="error-text">{error}</div>}
          <div className="version-body">
            <div className="version-list" aria-label="Changed on both devices">
              {conflicts.map((conflict, i) => (
                <button
                  type="button"
                  key={conflict.path}
                  className={`version-row${i === selected ? ' selected' : ''}`}
                  onClick={() => setSelected(i)}
                >
                  <span className="row-title">
                    {choices.has(conflict.path) ? '◆ ' : '◇ '}
                    {conflict.title}
                  </span>
                  <span className="version-when">{kindLabel(conflict.kind)}</span>
                </button>
              ))}
            </div>
            <div className="version-detail">
              {current.localBody == null ? (
                <div className="dialog-hint">
                  Deleted on this device — the other device rewrote it instead. Take theirs to bring
                  it back, or keep this device’s deletion.
                </div>
              ) : current.remoteBody == null ? (
                <div className="dialog-hint">
                  Deleted on the other device — this device edited it instead. Keeping this device’s
                  version keeps the text.
                </div>
              ) : (
                <>
                  <div className="field-name" style={{ marginBottom: 6 }}>
                    STRUCK OUT = THIS DEVICE · UNDERLINED = OTHER DEVICE
                  </div>
                  <DiffView oldText={current.localBody} newText={current.remoteBody} />
                </>
              )}
            </div>
          </div>
          <fieldset className="fieldset" style={{ marginTop: 12 }}>
            <legend>FOR “{current.title.toUpperCase()}”</legend>
            {CHOICE_LABELS.filter(
              (option) =>
                option.value !== 'both' ||
                (current.kind === 'doc' && current.localBody != null && current.remoteBody != null)
            ).map((option) => (
              <button
                type="button"
                key={option.value}
                role="radio"
                aria-checked={choices.get(current.path) === option.value}
                className="control-row"
                onClick={() => choose(current.path, option.value)}
              >
                <span
                  className={`radio${choices.get(current.path) === option.value ? ' on' : ''}`}
                />
                <span>{option.label}</span>
              </button>
            ))}
          </fieldset>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn" onClick={dismissConflicts}>
            Decide Later
          </button>
          <button
            type="button"
            className="btn default"
            disabled={!allChosen || busy}
            onClick={resolve}
          >
            {busy ? 'Combining…' : `Combine (${choices.size}/${conflicts.length} decided)`}
          </button>
        </div>
      </div>
    </div>
  )
}
