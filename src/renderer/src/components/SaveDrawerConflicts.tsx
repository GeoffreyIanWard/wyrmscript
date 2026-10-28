import { useState } from 'react'
import type { JSX } from 'react'
import type { SyncOutcome } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { conflictsWaiting } from '../lib/saveLocations'
import { useWyrm } from '../store'

/** What a fresh look found when it turned out nothing was waiting after all. */
function settledWords(outcome: SyncOutcome): string {
  switch (outcome.status) {
    case 'up-to-date':
    case 'pushed':
      return 'Nothing is waiting any more: both computers agree.'
    case 'pulled':
    case 'merged':
      return 'Nothing is waiting any more: the work from both computers is in.'
    case 'conflicts':
      return ''
    default:
      return outcome.detail
  }
}

/**
 * F-50 step 5: the way into resolving sync conflicts — passages changed
 * differently here and on another computer, which never merge on their own
 * (prose is the writer's to decide).
 *
 * It names what is waiting, from the last background sync that found it, and
 * Resolve… syncs again for a fresh list and opens the existing resolution
 * screen (`ConflictDialog`), which App puts up whenever `syncConflicts` is
 * set and which closes this drawer as it does. A visual merge, laying the
 * two versions out as cards to drag into place, is still being designed.
 */
export function SaveDrawerConflicts({ onShowGitHub }: { onShowGitHub: () => void }): JSX.Element {
  const syncStatus = useWyrm((s) => s.syncStatus)
  const syncNeedsAttention = useWyrm((s) => s.syncNeedsAttention)
  const syncProblem = useWyrm((s) => s.syncProblem)
  const waitingConflicts = useWyrm((s) => s.waitingConflicts)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const linked = syncStatus?.mode === 'github'
  const waiting = conflictsWaiting(syncNeedsAttention, syncProblem, waitingConflicts)

  const resolve = (): void => {
    setBusy(true)
    setNote(null)
    setError(null)
    void useWyrm
      .getState()
      .syncNow(true)
      // Conflicts open the resolution screen (and App closes this drawer);
      // anything else is said here.
      .then((outcome) => {
        if (outcome.status !== 'conflicts') setNote(settledWords(outcome))
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(false))
  }

  return (
    <fieldset className="fieldset drawer-paper drawer-wide">
      <legend>{waiting ? 'WAITING FOR YOU' : 'CONFLICTS'}</legend>
      {error != null && (
        <div className="error-text" role="alert">
          {error}
        </div>
      )}
      {!linked ? (
        <div className="dialog-hint" style={{ marginTop: 0 }}>
          A conflict is a passage changed one way on this computer and another way on a second one.
          This project is not linked to GitHub, so there is nowhere for that to happen.
        </div>
      ) : waiting ? (
        <>
          <div className="dialog-hint" style={{ marginTop: 0 }}>
            {waitingConflicts?.length
              ? 'These changed one way here and another way on your other computer. Nothing has been lost: both versions are kept until you choose.'
              : 'Some passages changed one way here and another way on your other computer. Nothing has been lost: both versions are kept until you choose.'}
          </div>
          {waitingConflicts != null && waitingConflicts.length > 0 && (
            <ul className="conflict-waiting">
              {waitingConflicts.map((c) => (
                <li key={c.path}>{c.title}</li>
              ))}
            </ul>
          )}
          <div className="control-row" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="btn default"
              disabled={busy}
              data-help="resolve-conflicts"
              onClick={resolve}
            >
              {busy ? 'Looking…' : 'Resolve…'}
            </button>
          </div>
        </>
      ) : (
        <div className="dialog-hint" style={{ marginTop: 0 }}>
          Nothing to resolve. When a passage changes one way here and another way on your other
          computer, it waits here for you to choose.
        </div>
      )}
      {note != null && <div className="dialog-hint">{note}</div>}
      {linked && syncProblem != null && (
        <div className="dialog-hint">
          The last sync could not get through, so there may be more to see.{' '}
          <button type="button" className="btn small" onClick={onShowGitHub}>
            GitHub…
          </button>
        </div>
      )}
    </fieldset>
  )
}
