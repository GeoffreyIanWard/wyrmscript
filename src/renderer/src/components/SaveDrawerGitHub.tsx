import { useState } from 'react'
import type { JSX } from 'react'
import type { SyncOutcome } from '../../../shared/types'
import { errorMessage } from '../lib/errors'
import { MAX_LOCATIONS, timeAgo } from '../lib/saveLocations'
import { isConnected, isRemoteMissing } from '../lib/syncState'
import { useWyrm } from '../store'
import { GitHubSignIn } from './GitHubSignIn'

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

/** The last Sync Now, in the writer's words — never "push", "pull" or "merge". */
function outcomeWords(outcome: SyncOutcome): { text: string; bad: boolean } {
  switch (outcome.status) {
    case 'up-to-date':
      return { text: 'Already up to date.', bad: false }
    case 'pushed':
      return { text: 'Sent to GitHub.', bad: false }
    case 'pulled':
      return {
        text: `Brought in work from your other device.${outcome.pushed ? '' : ' It has not gone back up yet.'}`,
        bad: false
      }
    case 'merged':
      return {
        text: `Combined work from two devices.${outcome.pushed ? '' : ' It has not gone back up yet.'}`,
        bad: false
      }
    case 'conflicts':
      return { text: 'Some passages need your eye — the resolution screen has opened.', bad: false }
    default:
      return { text: outcome.detail, bad: true }
  }
}

/**
 * F-50 step 3: everything about GitHub on one screen — the account, whether
 * this project is linked and how that link is doing, linking it to a new or
 * existing space, sending now, and unlinking. It replaces the Sync dialog.
 *
 * Signing in is app-level (`GitHubSignIn`); linking is this project's. The
 * old dialog's first screen, choosing between "keep it on this machine" and
 * GitHub, is gone: in the drawer that choice is simply whether there is a
 * GitHub card, and keeping only this computer needs no ceremony (F-01).
 */
export function SaveDrawerGitHub({ locationCount }: { locationCount: number }): JSX.Element {
  const project = useWyrm((s) => s.project)
  const syncStatus = useWyrm((s) => s.syncStatus)
  const syncProblem = useWyrm((s) => s.syncProblem)
  const syncNeedsAttention = useWyrm((s) => s.syncNeedsAttention)

  const [busy, setBusy] = useState<'connect' | 'sync' | 'disconnect' | 'signout' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [outcome, setOutcome] = useState<SyncOutcome | null>(null)
  const [justSignedIn, setJustSignedIn] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [connectMode, setConnectMode] = useState<'create' | 'existing'>('create')
  const [repoName, setRepoName] = useState(() => slugify(project?.data.title ?? ''))
  const [repoUrl, setRepoUrl] = useState('')

  const run = (kind: NonNullable<typeof busy>, work: () => Promise<unknown>): void => {
    setBusy(kind)
    setError(null)
    void work()
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  if (syncStatus == null) {
    return <div className="drawer-hint drawer-paper">Reading GitHub settings…</div>
  }

  const login = syncStatus.login
  const linked = isConnected(syncStatus)
  const linkLost = isRemoteMissing(syncStatus)
  // GitHub would be a new card; the drawer keeps three at most.
  const noRoom = !linked && !linkLost && locationCount >= MAX_LOCATIONS

  const connect = (): void => {
    if (noRoom) {
      setError(`${MAX_LOCATIONS} locations at most. Remove one on the Save to tab to add GitHub.`)
      return
    }
    const options =
      connectMode === 'create'
        ? { create: true, name: repoName.trim() }
        : { create: false, url: repoUrl.trim() }
    run('connect', () => useWyrm.getState().connectSync(options))
  }

  const syncNow = (): void => {
    setOutcome(null)
    run('sync', () => useWyrm.getState().syncNow(true).then(setOutcome))
  }

  const signOut = (thenSwitch: boolean): void => {
    setJustSignedIn(false)
    setSwitching(thenSwitch)
    run('signout', () => useWyrm.getState().signOutGithub())
  }

  const confirmDisabled = connectMode === 'create' ? repoName.trim() === '' : repoUrl.trim() === ''

  return (
    <div className="drawer-github">
      {error != null && (
        <div className="error-text drawer-paper" role="alert">
          {error}
        </div>
      )}

      {/* The account: the standing answer to "am I signed in?" */}
      {login != null && !justSignedIn && (
        <div className="account-line drawer-paper">
          <span>SIGNED IN AS {login.toUpperCase()}</span>
          <span className="spacer" />
          <button
            type="button"
            className="btn small"
            disabled={busy != null}
            onClick={() => signOut(true)}
          >
            Switch Account…
          </button>
          <button
            type="button"
            className="btn small"
            disabled={busy != null}
            onClick={() => signOut(false)}
          >
            {busy === 'signout' ? 'Signing Out…' : 'Sign Out'}
          </button>
        </div>
      )}

      {login == null && (
        <fieldset className="fieldset drawer-paper drawer-wide">
          <legend>GITHUB ACCOUNT</legend>
          <div className="dialog-hint" style={{ marginTop: 0 }}>
            {switching
              ? 'Signed out. Sign in with the account you want to use.'
              : linked || linkLost
                ? 'Signed out of GitHub, so nothing can be sent there. Sign in again to carry on.'
                : 'Sign in to keep a copy of this project on GitHub. This computer remembers the account for every project until you sign out.'}
          </div>
          <GitHubSignIn
            clientIdSet={syncStatus.clientIdSet}
            onSaveClientId={(clientId) => useWyrm.getState().setSyncClientId(clientId)}
            // Said out loud: silently swapping to the next screen is what
            // made a working sign-in look like a hang.
            onSignedIn={() => {
              setJustSignedIn(true)
              setSwitching(false)
              void useWyrm
                .getState()
                .loadSyncStatus()
                .catch((e: unknown) => setError(errorMessage(e)))
            }}
          />
        </fieldset>
      )}

      {login != null && justSignedIn && (
        <fieldset className="fieldset drawer-paper drawer-wide">
          <legend>SIGNED IN</legend>
          <div className="dialog-hint" style={{ marginTop: 0 }}>
            You are signed in to GitHub as <strong>{login}</strong>. This account is remembered for
            every project until you sign out.
          </div>
          <div className="control-row">
            <button type="button" className="btn default" onClick={() => setJustSignedIn(false)}>
              Continue
            </button>
          </div>
        </fieldset>
      )}

      {/* This project's link, once there is an account to link with. */}
      {login != null && !justSignedIn && linked && (
        <fieldset className="fieldset drawer-paper drawer-wide">
          <legend>THIS PROJECT</legend>
          <div className="dialog-hint" style={{ marginTop: 0 }}>
            Your work goes to{' '}
            {syncStatus.remoteUrl?.replace(/^https?:\/\//, '').replace(/\.git$/, '')}.{' '}
            {syncStatus.lastSyncAt != null
              ? `Last sent ${timeAgo(syncStatus.lastSyncAt)}.`
              : 'Nothing sent yet.'}
          </div>
          {syncStatus.pendingSync && (
            <div className="dialog-hint">Some work is still waiting to go up.</div>
          )}
          {syncProblem != null && (
            <div className="dialog-hint">The last try could not get through: {syncProblem}</div>
          )}
          {syncNeedsAttention && (
            <div className="dialog-hint">
              Some passages need your eye before this copy is current.
            </div>
          )}
          {outcome != null && (
            <div className={outcomeWords(outcome).bad ? 'error-text' : 'dialog-hint'}>
              {outcomeWords(outcome).text}
            </div>
          )}
          <div className="control-row" style={{ marginTop: 8 }}>
            <button type="button" className="btn default" disabled={busy != null} onClick={syncNow}>
              {busy === 'sync' ? 'Syncing…' : 'Sync Now'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy != null}
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect…
            </button>
          </div>
          {confirmDisconnect && (
            <div className="save-confirm" role="alertdialog" aria-label="Disconnect from GitHub?">
              <span>
                Stop saving to GitHub? Your copy there stays, and nothing on GitHub is deleted.
              </span>
              <span className="control-row">
                <button
                  type="button"
                  className="btn small default"
                  onClick={() => {
                    setConfirmDisconnect(false)
                    setOutcome(null)
                    run('disconnect', () => useWyrm.getState().disconnectSync())
                  }}
                >
                  Disconnect
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => setConfirmDisconnect(false)}
                >
                  Keep
                </button>
              </span>
            </div>
          )}
        </fieldset>
      )}

      {login != null && !justSignedIn && !linked && (
        <fieldset className="fieldset drawer-paper drawer-wide">
          <legend>{linkLost ? 'RECONNECT THIS PROJECT' : 'CONNECT THIS PROJECT'}</legend>
          {linkLost && (
            <div className="dialog-hint" style={{ marginTop: 0 }}>
              This project lost its link to GitHub, so nothing is being sent. Connect it again
              below.
            </div>
          )}
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
    </div>
  )
}
