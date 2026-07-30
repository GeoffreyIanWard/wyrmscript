import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { BackupOutcome } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'

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

export function BackupDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const project = useWyrm((s) => s.project)
  const backupSettings = useWyrm((s) => s.backupSettings)
  const loadBackupSettings = useWyrm((s) => s.loadBackupSettings)
  const chooseBackupLocation = useWyrm((s) => s.chooseBackupLocation)
  const setBackupAuto = useWyrm((s) => s.setBackupAuto)
  const clearBackupLocation = useWyrm((s) => s.clearBackupLocation)
  const backupNow = useWyrm((s) => s.backupNow)
  const restoreFromBackup = useWyrm((s) => s.restoreFromBackup)

  const [busy, setBusy] = useState<'location' | 'forget' | 'backup' | 'restore' | null>(null)
  const [outcome, setOutcome] = useState<BackupOutcome | null>(null)
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

  const forget = (): void => {
    setBusy('forget')
    setError(null)
    setOutcome(null)
    void clearBackupLocation()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const toggleAuto = (auto: boolean): void => {
    void setBackupAuto(auto).catch((e: unknown) => setError(errorMessage(e)))
  }

  const runBackup = (): void => {
    setBusy('backup')
    setError(null)
    setOutcome(null)
    void backupNow()
      .then(setOutcome)
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
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Backup</span>
        </div>
        <div className="dialog-body">
          {error != null && <div className="error-text">{error}</div>}

          {backupSettings == null ? (
            <div className="dialog-hint">Reading backup settings…</div>
          ) : backupSettings.path == null ? (
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
              <legend>BACKUP LOCATION</legend>
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                {backupSettings.path}
              </div>
              <div className="control-row">
                <button type="button" className="btn" disabled={busy != null} onClick={choose}>
                  {busy === 'location' ? 'Choosing…' : 'Change…'}
                </button>
                <button type="button" className="btn" disabled={busy != null} onClick={forget}>
                  {busy === 'forget' ? 'Forgetting…' : 'Forget'}
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
                <span>
                  {backupSettings.lastBackupAt != null
                    ? `Last backup ${timeAgo(backupSettings.lastBackupAt)}.`
                    : 'Never backed up.'}
                </span>
              </div>
              {outcome != null && <OutcomeView outcome={outcome} />}
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
