import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { GithubAccount, GithubRepo } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import { errorMessage } from '../lib/errors'
import { GitHubSignIn } from './GitHubSignIn'

/**
 * Bring a project down from GitHub (F-43): the account's spaces as a list,
 * and a field for an address. Shared by the welcome screen's dialog (a new
 * computer has no project open, so no Save To drawer) and the drawer's
 * Restore from tab (F-50 step 3).
 *
 * **A list and a field**, with the list first. The list is friendlier and
 * needs no new permission — `createPrivateRepo` already used this endpoint —
 * but it can only ever show the signed-in account's own repositories, so the
 * field is what covers a novel shared by a collaborator, or an account the
 * writer is not signed into here. Neither alone is enough.
 *
 * **Signing in happens here.** This is the panel of a new computer, with no
 * project open, and signing in used to live only in Sync, which needs one:
 * the list said "Sign in with GitHub first" with nowhere to do it, and the
 * address field could not reach a private novel either, because cloning
 * goes through the same account (and every space this app makes is private).
 *
 * The folder is chosen *after* this, by the native picker in the main
 * process, because that is the only picker that can offer the real
 * filesystem — the same split restore uses.
 */
export function BringDownPanel({
  onBroughtDown,
  onBusy
}: {
  /** A project arrived (the writer did not cancel the folder picker). */
  onBroughtDown: () => void
  /** Told while a project is being brought down, so the host can hold its own buttons. */
  onBusy?: (busy: boolean) => void
}): JSX.Element {
  const cloneFromGithub = useWyrm((s) => s.cloneFromGithub)
  const [account, setAccount] = useState<GithubAccount | null>(null)
  const [justSignedIn, setJustSignedIn] = useState(false)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusyState] = useState(false)
  const setBusy = (value: boolean): void => {
    setBusyState(value)
    onBusy?.(value)
  }
  const [error, setError] = useState<string | null>(null)

  // The account first; the list only once there is one to list.
  // Set on every mount, not just at creation: StrictMode mounts, cleans up
  // and mounts again, and a flag only ever cleared left the dialog showing
  // "Looking…" for good.
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const loadRepos = (): void => {
    setRepos(null)
    setListError(null)
    void api
      .listGithubRepos()
      .then((list) => live.current && setRepos(list))
      // A failed list is reported, not fatal: the field below still works.
      .catch((err) => live.current && setListError(errorMessage(err)))
  }
  useEffect(() => {
    void api
      .getGithubAccount()
      .then((a) => {
        if (!live.current) return
        setAccount(a)
        if (a.login) loadRepos()
      })
      .catch((err) => live.current && setListError(errorMessage(err)))
  }, [])

  const bringDown = async (address: string): Promise<void> => {
    if (!address.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const opened = await cloneFromGithub(address.trim())
      // Cancelling the folder picker is not a failure — it leaves the dialog
      // exactly as it was, ready for another go.
      if (opened) onBroughtDown()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <fieldset>
        <legend>Your spaces on GitHub</legend>
        {account == null && listError == null && <div className="dialog-hint">Looking…</div>}
        {account != null && account.login == null && (
          <>
            <div className="dialog-hint" style={{ marginTop: 0 }}>
              Sign in to see your spaces here. It is also how this computer reaches a private one —
              and every space WyrmStar makes is private.
            </div>
            <GitHubSignIn
              clientIdSet={account.clientIdSet}
              onSaveClientId={async (clientId) => {
                const next = await api.setGithubClientId(clientId)
                if (live.current) setAccount(next)
              }}
              onSignedIn={(login) => {
                setAccount({ clientIdSet: true, login })
                setJustSignedIn(true)
                loadRepos()
              }}
            />
          </>
        )}
        {account?.login != null && (
          <div className="dialog-hint" style={{ marginTop: 0 }}>
            Signed in to GitHub as <strong>{account.login}</strong>
            {justSignedIn ? ' — this computer will remember it.' : '.'}
          </div>
        )}
        {account?.login != null && repos == null && listError == null && (
          <div className="dialog-hint">Looking…</div>
        )}
        {listError != null && (
          <div className="dialog-hint">{listError} You can still paste an address below.</div>
        )}
        {repos != null && repos.length === 0 && (
          <div className="dialog-hint">
            This account has no spaces in it yet. Paste an address below instead.
          </div>
        )}
        {repos != null && repos.length > 0 && (
          <div className="version-list">
            {repos.map((repo) => (
              <button
                key={repo.cloneUrl}
                type="button"
                className="version-row"
                disabled={busy}
                onClick={() => void bringDown(repo.cloneUrl)}
              >
                <span className="row-title">{repo.fullName}</span>
                <span className="version-when">{repo.private ? 'PRIVATE' : 'PUBLIC'}</span>
              </button>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset>
        <legend>Or an address</legend>
        <div className="field-row">
          <input
            className="text-field"
            placeholder="https://github.com/someone/their-novel.git"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void bringDown(url)
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || url.trim() === ''}
            onClick={() => void bringDown(url)}
          >
            {busy ? 'Bringing…' : 'Bring It Down…'}
          </button>
        </div>
        <div className="dialog-hint">
          You will be asked where to keep it. It arrives already connected, so it syncs from then
          on.
          {account != null &&
            account.login == null &&
            ' A private one needs you signed in above first.'}
        </div>
      </fieldset>
      {error != null && <div className="dialog-error">{error}</div>}
    </>
  )
}
