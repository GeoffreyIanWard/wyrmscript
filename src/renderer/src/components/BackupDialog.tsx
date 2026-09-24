import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { BackupOutcome, BackupRun, BackupTarget, TargetResult } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'

function timeAgo(timestamp: number): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

function Check({
  label,
  on,
  disabled,
  onToggle
}: {
  label: string
  on: boolean
  disabled?: boolean
  onToggle: (value: boolean) => void
}): JSX.Element {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on}
      disabled={disabled}
      className="control-row"
      onClick={() => onToggle(!on)}
    >
      <span className={`check${on ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )
}

/** Reports the last `backupNow()` result honestly — including the one outcome
 *  that must not read like a crash (see the comment below). */
function OutcomeView({ outcome }: { outcome: BackupOutcome }): JSX.Element {
  if (outcome.status === 'backed-up') {
    return (
      <div className="dialog-hint">
        Backed up. {outcome.filesVerified} {outcome.filesVerified === 1 ? 'file' : 'files'} verified
        readable from the backup.
      </div>
    )
  }
  if (outcome.status === 'up-to-date') {
    return <div className="dialog-hint">Already up to date.</div>
  }
  // 'diverged': the backup holds writing this project doesn't have, so nothing was written.
  // That is the backup doing its job, not a failure — no force/overwrite button exists here
  // on purpose.
  return (
    <div className="error-text">
      The backup was left untouched — it holds writing this project does not have, on branch “
      {outcome.branch}”. {outcome.detail}
    </div>
  )
}

/** What happened at one target during the last run, in the writer's words. */
function ResultLine({ result }: { result: TargetResult }): JSX.Element {
  if (result.status === 'unreachable') {
    // Deliberately not styled as an error. An unplugged card is the normal
    // state of removable media, and the row already shows how long it has
    // been since this target was written (F-40).
    return <div className="dialog-hint">Not connected — skipped.</div>
  }
  if (result.status === 'failed') {
    return <div className="error-text">{result.message}</div>
  }
  return <OutcomeView outcome={result.outcome} />
}

/** One configured destination, with how stale it is and how to remove it. */
function TargetRow({
  target,
  result,
  busy,
  onForget
}: {
  target: BackupTarget
  result: TargetResult | undefined
  busy: boolean
  onForget: () => void
}): JSX.Element {
  return (
    <div className="backup-target">
      <div className="dialog-hint" style={{ marginTop: 0 }}>
        {target.path}
      </div>
      <div className="control-row">
        <span>
          {target.lastBackupAt != null
            ? `Last backup ${timeAgo(target.lastBackupAt)}.`
            : 'Never backed up.'}
        </span>
        <span className="spacer" />
        <button type="button" className="btn" disabled={busy} onClick={onForget}>
          Forget
        </button>
      </div>
      {result != null && <ResultLine result={result} />}
    </div>
  )
}

export function BackupDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const backupSettings = useWyrm((s) => s.backupSettings)
  const loadBackupSettings = useWyrm((s) => s.loadBackupSettings)
  const chooseBackupLocation = useWyrm((s) => s.chooseBackupLocation)
  const setBackupAuto = useWyrm((s) => s.setBackupAuto)
  const removeBackupTarget = useWyrm((s) => s.removeBackupTarget)
  const backupNow = useWyrm((s) => s.backupNow)
  const restoreFromBackup = useWyrm((s) => s.restoreFromBackup)

  const [busy, setBusy] = useState<'location' | 'forget' | 'backup' | 'restore' | null>(null)
  const [run, setRun] = useState<BackupRun | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadBackupSettings().catch((e: unknown) => setError(errorMessage(e)))
  }, [loadBackupSettings])

  const choose = (): void => {
    setBusy('location')
    setError(null)
    void chooseBackupLocation()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const forget = (targetId: string): void => {
    setBusy('forget')
    setError(null)
    setRun(null)
    void removeBackupTarget(targetId)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const toggleAuto = (auto: boolean): void => {
    void setBackupAuto(auto).catch((e: unknown) => setError(errorMessage(e)))
  }

  const runBackup = (): void => {
    setBusy('backup')
    setError(null)
    setRun(null)
    void backupNow()
      .then(setRun)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const restore = (): void => {
    setBusy('restore')
    setError(null)
    void restoreFromBackup()
      .then((opened) => {
        // A restore always lands in a fresh project folder — onClose only when one was
        // actually opened, i.e. the user didn't cancel the native pickers.
        if (opened) onClose()
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Backup</span>
        </div>
        <div className="dialog-body">
          {error != null && <div className="error-text">{error}</div>}

          {backupSettings == null ? (
            <div className="dialog-hint">Reading backup settings…</div>
          ) : backupSettings.targets.length === 0 ? (
            <>
              <div className="dialog-hint">
                Local version history protects {project?.data.title ?? 'this project'} against
                editing mistakes — every checkpoint is kept, forever. But every one of those
                versions still lives on this one disk. A backup on another drive is what protects
                against that disk dying.
              </div>
              <div className="control-row">
                <button
                  type="button"
                  className="btn default"
                  disabled={busy === 'location'}
                  onClick={choose}
                >
                  {busy === 'location' ? 'Choosing…' : 'Choose Location…'}
                </button>
              </div>
            </>
          ) : (
            <fieldset className="fieldset">
              <legend>
                {backupSettings.targets.length === 1 ? 'BACKUP LOCATION' : 'BACKUP LOCATIONS'}
              </legend>
              {backupSettings.targets.map((target) => (
                <TargetRow
                  key={target.id}
                  target={target}
                  result={run?.results.find((r) => r.targetId === target.id)}
                  busy={busy != null}
                  onForget={() => forget(target.id)}
                />
              ))}
              <div className="control-row">
                <button type="button" className="btn" disabled={busy != null} onClick={choose}>
                  {busy === 'location' ? 'Choosing…' : 'Add Another Location…'}
                </button>
              </div>
              <Check
                label="Back up after every checkpoint"
                on={backupSettings.auto}
                disabled={busy != null}
                onToggle={toggleAuto}
              />
              <div className="control-row">
                <button
                  type="button"
                  className="btn default"
                  disabled={busy != null}
                  onClick={runBackup}
                >
                  {busy === 'backup' ? 'Backing Up…' : 'Back Up Now'}
                </button>
              </div>
              {backupSettings.targets.length > 1 && (
                <div className="dialog-hint">
                  Every location is written on each backup. One that is not connected is skipped,
                  not an error — the times above are how you tell which copies are current.
                </div>
              )}
            </fieldset>
          )}

          <fieldset className="fieldset">
            <legend>RESTORE</legend>
            <div className="control-row">
              <button type="button" className="btn" disabled={busy != null} onClick={restore}>
                {busy === 'restore' ? 'Restoring…' : 'Restore from Backup…'}
              </button>
            </div>
            <div className="dialog-hint">
              Restoring always creates a new project folder — it never overwrites the project you
              have open.
            </div>
          </fieldset>
        </div>
        <div className="dialog-buttons">
          <button type="button" className="btn default" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
