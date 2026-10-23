import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import type { DeviceCodeInfo } from '../../../shared/types'
import { api } from '../lib/api'
import { errorMessage } from '../lib/errors'

/**
 * Signing in to GitHub: the one-time client id, then the device code. Shared
 * by the Sync dialog and Bring Down from GitHub, because the account is the
 * app's, not a project's — and a new computer, with no project open, is
 * exactly where a writer bringing a novel down has to sign in first. It used
 * to live only in Sync, which needs an open project, so that writer was told
 * to sign in with nowhere to do it.
 *
 * `onSaveClientId` is the caller's, since Sync records it against the open
 * project's status and Bring Down against the account alone; everything else
 * is the same flow. It refreshes nobody's status itself: `onSignedIn` is where
 * the caller does, and doing it here first swapped the panel away before it
 * could say the sign-in had worked.
 */
export function GitHubSignIn({
  clientIdSet,
  onSaveClientId,
  onSignedIn
}: {
  clientIdSet: boolean
  onSaveClientId: (clientId: string) => Promise<void>
  onSignedIn: (login: string) => void
}): JSX.Element {
  const [busy, setBusy] = useState<'clientId' | 'signin' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const clientIdRef = useRef<HTMLInputElement>(null)
  const [deviceInfo, setDeviceInfo] = useState<DeviceCodeInfo | null>(null)
  const [expired, setExpired] = useState(false)
  const [copied, setCopied] = useState(false)
  /** Rises while waiting so the panel is visibly alive, not frozen. */
  const [checks, setChecks] = useState(0)

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
      void api
        .signInPoll()
        .then((result) => {
          if (!active) return
          if (result.state === 'ok') {
            stop()
            setDeviceInfo(null)
            // Said out loud by the caller: silently swapping to the next
            // panel is what made a working sign-in look like a hang.
            onSignedIn(result.login)
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
    // onSignedIn is the caller's and may be a fresh function each render;
    // restarting the poll for that would reset the waiting count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceInfo])

  const saveClientId = (): void => {
    const value = clientIdRef.current?.value.trim()
    if (!value) {
      // Said, not silently refused (the house rule for dead buttons).
      setError('Paste the Client ID first.')
      return
    }
    setBusy('clientId')
    setError(null)
    void onSaveClientId(value)
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setBusy(null))
  }

  const startSignIn = (): void => {
    setBusy('signin')
    setError(null)
    setExpired(false)
    setChecks(0)
    setCopied(false)
    void api
      .signInStart()
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

  if (!clientIdSet)
    return (
      <fieldset className="fieldset">
        <legend>CONNECT TO GITHUB</legend>
        {error != null && <div className="error-text">{error}</div>}
        <div className="dialog-hint" style={{ marginTop: 0 }}>
          One-time setup for this app: create an OAuth App at github.com → Settings → Developer
          settings → OAuth Apps → New OAuth App, turn on Device Flow, then paste its Client ID
          below. The Client ID is public, not a secret — no client secret is needed.
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
    )

  return (
    <fieldset className="fieldset">
      <legend>SIGN IN</legend>
      {error != null && <div className="error-text">{error}</div>}
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
            {checks === 1 ? ' time' : ' times'}) — this panel changes by itself the moment GitHub
            says yes.
          </div>
        </>
      )}
    </fieldset>
  )
}
