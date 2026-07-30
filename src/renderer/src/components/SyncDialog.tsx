import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DeviceCodeInfo, SyncOutcome, SyncStatus } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { useWyrm } from '../store'

type Screen =
  'loading' | 'picker' | 'local-only' | 'client-id' | 'sign-in' | 'connect-project' | 'connected'

/**
 * Which panel to show, derived entirely from persisted status plus one
 * in-session flag: whether the writer has clicked "Sync with GitHub" this
 * time the dialog is open. `mode` itself only becomes 'github' once a
 * project is actually connected (state 6) — clientIdSet and login are
 * app-level, so a writer who already set up a previous project sails
 * straight through states 3/4 into 5.
 */
function computeScreen(status: SyncStatus | null, githubChosen: boolean): Screen {
  if (status == null) return 'loading'
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

export function SyncDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const project = useWyrm((s) => s.project)
  const syncStatus = useWyrm((s) => s.syncStatus)
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
    const timer = setInterval(() => {
      if (!active) return
      if (Date.now() >= deadline) {
        active = false
        clearInterval(timer)
        setExpired(true)
        setDeviceInfo(null)
        return
      }
      void signInPoll()
        .then((result) => {
          if (!active) return
          if (result.state === 'ok') {
            // The store's signInPoll() already refreshes syncStatus on ok —
            // clearing deviceInfo is enough to move the screen on.
            active = false
            clearInterval(timer)
            setDeviceInfo(null)
          } else if (result.state === 'error') {
            active = false
            clearInterval(timer)
            setDeviceInfo(null)
            setError(result.detail)
          }
        })
        .catch((e: unknown) => {
          if (!active) return
          active = false
          clearInterval(timer)
          setDeviceInfo(null)
          setError(errorMessage(e))
        })
    }, 5000)
    return () => {
      active = false
      clearInterval(timer)
    }
  }, [deviceInfo, signInPoll])

  const screen = computeScreen(syncStatus, githubChosen)

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
    void signInStart()
      .then(setDeviceInfo)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
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
    void signOutGithub()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const confirmDisabled = connectMode === 'create' ? repoName.trim() === '' : repoUrl.trim() === ''

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Sync</span>
        </div>
        <div className="dialog-body">
          {error != null && <div className="error-text">{error}</div>}

          {screen === 'loading' && <div className="dialog-hint">Reading sync settings…</div>}

          {screen === 'picker' && (
            <>
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                Local-only means this machine is the only copy of “
                {project?.data.title ?? 'this project'}” — unless a Backup is also set (Project →
                Backup…).
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
              <div className="dialog-hint" style={{ marginTop: 0 }}>
                “{project?.data.title ?? 'This project'}” stays on this machine only — unless a
                Backup is also set (Project → Backup…).
              </div>
              <div className="control-row">
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
                  <div
                    style={{
                      fontFamily: 'var(--font-prose)',
                      fontSize: 28,
                      letterSpacing: 6,
                      textAlign: 'center',
                      margin: '14px 0'
                    }}
                  >
                    {deviceInfo.userCode}
                  </div>
                  <div className="dialog-hint" style={{ marginTop: 0 }}>
                    enter it at {deviceInfo.verificationUri}
                  </div>
                  <div className="dialog-hint">Waiting for approval…</div>
                </>
              )}
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
              <div className="control-row" style={{ marginTop: 8 }}>
                <button type="button" className="btn" disabled={busy != null} onClick={disconnect}>
                  {busy === 'disconnect' ? 'Disconnecting…' : 'Disconnect…'}
                </button>
                <button type="button" className="btn" disabled={busy != null} onClick={signOut}>
                  {busy === 'signout' ? 'Signing Out…' : 'Sign Out'}
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
