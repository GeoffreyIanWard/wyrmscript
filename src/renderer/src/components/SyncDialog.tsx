import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { SyncOutcome, SyncStatus } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'
import { GitHubSignIn } from './GitHubSignIn'

type Screen =
  | 'loading'
  | 'picker'
  | 'local-only'
  | 'client-id'
  | 'sign-in'
  | 'signed-in'
  | 'connect-project'
  | 'connected'

/**
 * Which panel to show, derived entirely from persisted status plus two
 * in-session flags: whether the writer has clicked "Sync with GitHub" this
 * time the dialog is open, and whether a sign-in just completed and has not
 * been acknowledged yet. `mode` itself only becomes 'github' once a project
 * is actually connected — clientIdSet and login are app-level, so a writer
 * who already set up a previous project sails straight through into
 * connect-project.
 *
 * `justSignedIn` exists because sign-in previously succeeded *silently*: the
 * panel swapped to the connect form with nothing confirming the account had
 * been reached, which reads exactly like a hang.
 */
function computeScreen(
  status: SyncStatus | null,
  githubChosen: boolean,
  justSignedIn: boolean
): Screen {
  if (status == null) return 'loading'
  if (justSignedIn && status.login != null) return 'signed-in'
  if (status.mode === 'github' && status.remoteUrl != null) return 'connected'
  if (status.mode === 'local-only' && !githubChosen) return 'local-only'
  if (status.mode === 'unset' && !githubChosen) return 'picker'
  if (!status.clientIdSet) return 'client-id'
  if (status.login == null) return 'sign-in'
  if (status.remoteUrl == null) return 'connect-project'
  return 'connected'
}

function timeAgo(timestamp: number): string {
  const mins = Math.floor((Date.now() - timestamp) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** "My First Novel" → "my-first-novel": lowercase, dashed, never empty. */
function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'project'
}

function Radio({
  label,
  on,
  onPick
}: {
  label: string
  on: boolean
  onPick: () => void
}): JSX.Element {
  return (
    <button type="button" role="radio" aria-checked={on} className="control-row" onClick={onPick}>
      <span className={`radio${on ? ' on' : ''}`} />
      <span>{label}</span>
    </button>
  )
}

/** Reports the last `syncNow()` result honestly, in the app's own words —
 *  the house rules say the UI never speaks git, so no "push"/"pull"/"merge". */
function OutcomeView({ outcome }: { outcome: SyncOutcome }): JSX.Element {
  if (outcome.status === 'up-to-date') {
    return <div className="dialog-hint">Already up to date.</div>
  }
  if (outcome.status === 'pushed') {
    return <div className="dialog-hint">Sent to GitHub.</div>
  }
  if (outcome.status === 'pulled') {
    return (
      <div className="dialog-hint">
        Brought in work from your other device.
        {!outcome.pushed && ' It has not gone back up yet.'}
      </div>
    )
  }
  if (outcome.status === 'merged') {
    return (
      <div className="dialog-hint">
        Combined work from two devices.
        {!outcome.pushed && ' It has not gone back up yet.'}
      </div>
    )
  }
  if (outcome.status === 'conflicts') {
    return (
      <div className="dialog-hint">
        Some passages need the writer’s eye — the resolution screen has opened.
      </div>
    )
  }
  // 'offline' | 'error'
  return <div className="error-text">{outcome.detail}</div>
}

export function SyncDialog({
  onClose,
  onOpenBackup
}: {
  onClose: () => void
  /** Opens the Backup dialog. The local-only panel offers it directly rather
   *  than telling the writer to go and find a menu item (F-01). */
  onOpenBackup?: () => void
}): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const project = useWyrm((s) => s.project)
  const syncStatus = useWyrm((s) => s.syncStatus)
  const backupSettings = useWyrm((s) => s.backupSettings)
  const backupCount = backupSettings?.targets.length ?? 0
  const backedUp = backupCount > 0
  const loadSyncStatus = useWyrm((s) => s.loadSyncStatus)
  const setSyncClientId = useWyrm((s) => s.setSyncClientId)
  const signOutGithub = useWyrm((s) => s.signOutGithub)
  const connectSync = useWyrm((s) => s.connectSync)
  const disconnectSync = useWyrm((s) => s.disconnectSync)
  const setLocalOnly = useWyrm((s) => s.setLocalOnly)
  const syncNow = useWyrm((s) => s.syncNow)

  // True once the writer has picked the GitHub path this time the dialog is
  // open — see computeScreen. Not persisted; a fresh mount re-asks.
  const [githubChosen, setGithubChosen] = useState(false)
  const [busy, setBusy] = useState<'local' | 'connect' | 'sync' | 'disconnect' | 'signout' | null>(
    null
  )
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)

  const [justSignedIn, setJustSignedIn] = useState(false)

  const [connectMode, setConnectMode] = useState<'create' | 'existing'>('create')
  const [repoName, setRepoName] = useState(() => slugify(project?.data.title ?? ''))
  const [repoUrl, setRepoUrl] = useState('')

  useEffect(() => {
    void loadSyncStatus().catch((e: unknown) => setError(errorMessage(e)))
  }, [loadSyncStatus])

  const screen = computeScreen(syncStatus, githubChosen, justSignedIn)

  const pickLocalOnly = (): void => {
    setBusy('local')
    setError(null)
    void setLocalOnly()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const pickGithub = (): void => {
    setGithubChosen(true)
  }

  const connect = (): void => {
    setBusy('connect')
    setError(null)
    const options =
      connectMode === 'create'
        ? { create: true, name: repoName.trim() }
        : { create: false, url: repoUrl.trim() }
    void connectSync(options)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const runSync = (): void => {
    setBusy('sync')
    setError(null)
    setOutcome(null)
    void syncNow()
      .then(setOutcome)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const disconnect = (): void => {
    setBusy('disconnect')
    setError(null)
    setOutcome(null)
    void disconnectSync()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const signOut = (): void => {
    setBusy('signout')
    setError(null)
    setJustSignedIn(false)
    void signOutGithub()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const confirmDisabled = connectMode === 'create' ? repoName.trim() === '' : repoUrl.trim() === ''

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Sync</span>
        </div>
        <div className="dialog-body">
          {error != null && <div className="error-text">{error}</div>}

          {/* Standing answer to "am I signed in?" — visible on every GitHub
              screen, including when the dialog is reopened later. */}
          {syncStatus?.login != null && screen !== 'signed-in' && (
            <div className="account-line">
              <span>SIGNED IN AS {syncStatus.login.toUpperCase()}</span>
              <span className="spacer" />
              <button type="button" className="btn small" disabled={busy != null} onClick={signOut}>
                {busy === 'signout' ? 'Signing Out…' : 'Sign Out'}
              </button>
            </div>
          )}

          {screen === 'loading' && <div className="dialog-hint">Reading sync settings…</div>}

          {screen === 'picker' && (
            <>
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                Keeping “{project?.data.title ?? 'this project'}” on this machine is a real choice,
                and nothing here will nag you about it. What it means: this computer holds the only
                copy. Every version is kept forever, but all of that history lives on one disk, and
                a disk that dies takes it with it.
              </div>
              <div className="control-row">
                <button
                  type="button"
                  className="btn"
                  disabled={busy != null}
                  onClick={pickLocalOnly}
                >
                  {busy === 'local' ? 'Keeping It Local…' : 'Keep everything on this machine'}
                </button>
                <button type="button" className="btn" disabled={busy != null} onClick={pickGithub}>
                  Sync with GitHub
                </button>
              </div>
            </>
          )}

          {screen === 'local-only' && (
            <>
              {backedUp ? (
                <div className="dialog-hint" style={{ marginTop: 0 }}>
                  “{project?.data.title ?? 'This project'}” stays on this machine, and is copied to
                  your backup {backupCount === 1 ? 'location' : 'locations'}. If a copy is on a
                  different drive, or somewhere that leaves this building, you are covered for a
                  disk failure. If it is a folder on this same disk, it is not — nothing here can
                  tell which, so it is worth knowing yourself.
                </div>
              ) : (
                <div className="dialog-hint" style={{ marginTop: 0 }}>
                  “{project?.data.title ?? 'This project'}” lives on this machine and nowhere else.
                  Every version is kept forever, but all of that history is on one disk, and a disk
                  that dies takes it with it. A backup on another drive is what protects against
                  that.
                </div>
              )}
              <div className="control-row">
                {onOpenBackup && (
                  <button
                    type="button"
                    className={backedUp ? 'btn' : 'btn default'}
                    disabled={busy != null}
                    onClick={onOpenBackup}
                  >
                    {backedUp ? 'Backup Settings…' : 'Set Up a Backup…'}
                  </button>
                )}
                <button type="button" className="btn" disabled={busy != null} onClick={pickGithub}>
                  Sync with GitHub
                </button>
              </div>
            </>
          )}

          {(screen === 'client-id' || screen === 'sign-in') && (
            <GitHubSignIn
              clientIdSet={syncStatus?.clientIdSet ?? false}
              onSaveClientId={setSyncClientId}
              // Said out loud: silently swapping to the connect form is what
              // made a working sign-in look like a hang.
              onSignedIn={() => {
                setJustSignedIn(true)
                void loadSyncStatus().catch((e: unknown) => setError(errorMessage(e)))
              }}
            />
          )}

          {screen === 'signed-in' && (
            <fieldset className="fieldset">
              <legend>SIGNED IN</legend>
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                You are signed in to GitHub as <strong>{syncStatus?.login}</strong>. This account is
                remembered for every project until you sign out.
              </div>
              <div className="control-row">
                <button
                  type="button"
                  className="btn default"
                  onClick={() => setJustSignedIn(false)}
                >
                  Continue
                </button>
              </div>
            </fieldset>
          )}

          {screen === 'connect-project' && (
            <fieldset className="fieldset">
              <legend>CONNECT THIS PROJECT</legend>
              <Radio
                label="Create a private space on GitHub for this project"
                on={connectMode === 'create'}
                onPick={() => setConnectMode('create')}
              />
              <input
                className="text-field"
                aria-label="Project name"
                value={repoName}
                disabled={connectMode !== 'create'}
                onChange={(e) => setRepoName(e.target.value)}
              />
              <Radio
                label="Use an existing address"
                on={connectMode === 'existing'}
                onPick={() => setConnectMode('existing')}
              />
              <input
                className="text-field"
                aria-label="Existing address"
                placeholder="https://github.com/username/project"
                value={repoUrl}
                disabled={connectMode !== 'existing'}
                onChange={(e) => setRepoUrl(e.target.value)}
              />
              <div className="control-row" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="btn default"
                  disabled={busy != null || confirmDisabled}
                  onClick={connect}
                >
                  {busy === 'connect' ? 'Connecting…' : 'Confirm'}
                </button>
              </div>
            </fieldset>
          )}

          {screen === 'connected' && syncStatus && (
            <fieldset className="fieldset">
              <legend>GITHUB SYNC</legend>
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                Your GitHub copy: {syncStatus.remoteUrl}
              </div>
              <div className="control-row">
                <button
                  type="button"
                  className="btn default"
                  disabled={busy != null}
                  onClick={runSync}
                >
                  {busy === 'sync' ? 'Syncing…' : 'Sync Now'}
                </button>
                <span>
                  {syncStatus.lastSyncAt != null
                    ? `Last sync ${timeAgo(syncStatus.lastSyncAt)}.`
                    : 'Never synced.'}
                </span>
              </div>
              {syncStatus.pendingSync && (
                <div className="dialog-hint">Some work is still waiting to sync.</div>
              )}
              {outcome != null && <OutcomeView outcome={outcome} />}
              {/* Sign Out lives in the account line above, next to the name
                  it acts on — repeating it here would be two doors to one room. */}
              <div className="control-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" disabled={busy != null} onClick={disconnect}>
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect…'}
                </button>
              </div>
            </fieldset>
          )}
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
