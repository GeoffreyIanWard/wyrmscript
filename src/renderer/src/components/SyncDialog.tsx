import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DeviceCodeInfo, SyncOutcome, SyncStatus } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'

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
  const signInStart = useWyrm((s) => s.signInStart)
  const signInPoll = useWyrm((s) => s.signInPoll)
  const signOutGithub = useWyrm((s) => s.signOutGithub)
  const connectSync = useWyrm((s) => s.connectSync)
  const disconnectSync = useWyrm((s) => s.disconnectSync)
  const setLocalOnly = useWyrm((s) => s.setLocalOnly)
  const syncNow = useWyrm((s) => s.syncNow)

  // True once the writer has picked the GitHub path this time the dialog is
  // open — see computeScreen. Not persisted; a fresh mount re-asks.
  const [githubChosen, setGithubChosen] = useState(false)
  const [busy, setBusy] = useState<
    'local' | 'clientId' | 'signin' | 'connect' | 'sync' | 'disconnect' | 'signout' | null
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)

  const clientIdRef = useRef<HTMLInputElement>(null)

  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null)
  const [expired, setExpired] = useState(false)
  const [justSignedIn, setJustSignedIn] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Rises while waiting so the panel is visibly alive, not frozen. */
  const [checks, setChecks] = useState(0)

  const [connectMode, setConnectMode] = useState<'create' | 'existing'>('create')
  const [repoName, setRepoName] = useState(() => slugify(project?.data.title ?? ''))
  const [repoUrl, setRepoUrl] = useState('')

  useEffect(() => {
    void loadSyncStatus().catch((e: unknown) => setError(errorMessage(e)))
  }, [loadSyncStatus])

  // Device-flow polling: every 5s until the code is approved, rejected, or
  // its own clock runs out. Always cleaned up (unmount, or a fresh code
  // replacing this one) so a closed dialog never keeps polling in the
  // background — `active` guards state updates from a tick already in
  // flight when that cleanup runs.
  useEffect(() => {
    if (!deviceInfo) return
    const deadline = Date.now() + deviceInfo.expiresIn * 1000
    let active = true
    let timer: ReturnType<typeof setInterval> | null = null

    const stop = (): void => {
      active = false
      if (timer) clearInterval(timer)
    }

    const check = (): void => {
      if (!active) return
      if (Date.now() >= deadline) {
        stop()
        setExpired(true)
        setDeviceInfo(null)
        return
      }
      setChecks((n) => n + 1)
      void signInPoll()
        .then((result) => {
          if (!active) return
          if (result.state === 'ok') {
            stop()
            setDeviceInfo(null)
            // Say so out loud. Silently swapping to the next panel is what
            // made a working sign-in look like a hang.
            setJustSignedIn(true)
          } else if (result.state === 'error') {
            stop()
            setDeviceInfo(null)
            setError(result.detail)
          }
        })
        .catch((e: unknown) => {
          if (!active) return
          stop()
          setDeviceInfo(null)
          setError(errorMessage(e))
        })
    }

    // Check straight away rather than after a first blind 5s: approval is
    // often already done by the time the writer looks back at the app.
    check()
    timer = setInterval(check, 5000)
    return stop
  }, [deviceInfo, signInPoll])

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

  const saveClientId = (): void => {
    const value = clientIdRef.current?.value.trim()
    if (!value) return
    setBusy('clientId')
    setError(null)
    void setSyncClientId(value)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const startSignIn = (): void => {
    setBusy('signin')
    setError(null)
    setExpired(false)
    setChecks(0)
    setCopied(false)
    void signInStart()
      .then(setDeviceInfo)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const copyCode = (): void => {
    if (!deviceInfo) return
    void navigator.clipboard
      .writeText(deviceInfo.userCode)
      .then(() => setCopied(true))
      // Clipboard access can be refused; the code is selectable either way,
      // so say what happened rather than failing silently.
      .catch(() => setError('Could not reach the clipboard — select the code and copy it by hand.'))
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

          {screen === 'client-id' && (
            <fieldset className="fieldset">
              <legend>CONNECT TO GITHUB</legend>
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                One-time setup for this app: create an OAuth App at github.com → Settings →
                Developer settings → OAuth Apps → New OAuth App, turn on Device Flow, then paste its
                Client ID below. The Client ID is public, not a secret — no client secret is needed.
              </div>
              <div className="field-name" style={{ marginBottom: 6 }}>
                CLIENT ID
              </div>
              <div className="control-row">
                <input
                  ref={clientIdRef}
                  className="text-field"
                  placeholder="Paste the Client ID here"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveClientId()
                  }}
                />
                <button
                  type="button"
                  className="btn default"
                  disabled={busy != null}
                  onClick={saveClientId}
                >
                  {busy === 'clientId' ? 'Saving…' : 'Save'}
                </button>
              </div>
            </fieldset>
          )}

          {screen === 'sign-in' && (
            <fieldset className="fieldset">
              <legend>SIGN IN</legend>
              {deviceInfo == null ? (
                <>
                  {expired && (
                    <div className="dialog-hint" style={{ marginTop: 0 }}>
                      That code expired — start again.
                    </div>
                  )}
                  <div className="control-row">
                    <button
                      type="button"
                      className="btn default"
                      disabled={busy != null}
                      onClick={startSignIn}
                    >
                      {busy === 'signin' ? 'Starting…' : 'Sign in with GitHub'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* Selectable on purpose: the chrome sets user-select:none
                      globally, which silently made the one string the writer
                      must reproduce by hand impossible to copy. */}
                  <div className="device-code">{deviceInfo.userCode}</div>
                  <div className="control-row" style={{ justifyContent: 'center' }}>
                    <button type="button" className="btn" onClick={copyCode}>
                      {copied ? 'Copied' : 'Copy Code'}
                    </button>
                  </div>
                  <div className="dialog-hint" style={{ marginTop: 8 }}>
                    enter it at {deviceInfo.verificationUri}
                  </div>
                  <div className="dialog-hint">
                    Waiting for approval{'.'.repeat((checks % 3) + 1)} (checked {checks}
                    {checks === 1 ? ' time' : ' times'}) — this panel changes by itself the moment
                    GitHub says yes.
                  </div>
                </>
              )}
            </fieldset>
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
