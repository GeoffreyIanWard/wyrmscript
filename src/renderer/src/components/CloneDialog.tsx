import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import type { GithubRepo } from '../../../shared/types'
import { api } from '../lib/api'
import { useWyrm } from '../store'
import { useFocusTrap } from '../lib/useFocusTrap'
import { errorMessage } from '../lib/errors'

/**
 * Bring a project down from GitHub (F-43).
 *
 * **A list and a field**, with the list first. The list is friendlier and
 * needs no new permission — `createPrivateRepo` already used this endpoint —
 * but it can only ever show the signed-in account's own repositories, so the
 * field is what covers a novel shared by a collaborator, or an account the
 * writer is not signed into here. Neither alone is enough.
 *
 * The folder is chosen *after* this dialog, by the native picker in the main
 * process, because that is the only picker that can offer the real
 * filesystem — the same split restore uses.
 */
export function CloneDialog({ onClose }: { onClose: () => void }): JSX.Element {
  const trapRef = useFocusTrap<HTMLDivElement>(onClose)
  const cloneFromGithub = useWyrm((s) => s.cloneFromGithub)
  const [repos, setRepos] = useState<GithubRepo[] | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void api
      .listGithubRepos()
      .then((list) => live && setRepos(list))
      // Not being signed in is the ordinary case here, not a failure: the
      // field below still works, so this reports and carries on rather than
      // taking the dialog down.
      .catch((err) => live && setListError(errorMessage(err)))
    return () => {
      live = false
    }
  }, [])

  const bringDown = async (address: string): Promise<void> => {
    if (!address.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const opened = await cloneFromGithub(address.trim())
      // Cancelling the folder picker is not a failure — it leaves the dialog
      // exactly as it was, ready for another go.
      if (opened) onClose()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="dialog-overlay" onMouseDown={onClose}>
      <div className="dialog wide" ref={trapRef} onMouseDown={(e) => e.stopPropagation()}>
        <div className="title-bar">
          <button type="button" aria-label="Close" className="close-box" onClick={onClose} />
          <span className="title">Bring Down from GitHub</span>
        </div>
        <div className="dialog-body">
          <fieldset>
            <legend>Your spaces on GitHub</legend>
            {repos == null && listError == null && <div className="dialog-hint">Looking…</div>}
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
              You will be asked where to keep it. It arrives already connected, so it syncs from
              then on.
            </div>
          </fieldset>
          {error != null && <div className="dialog-error">{error}</div>}
        </div>
        <div className="dialog-buttons">
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
