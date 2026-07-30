// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { SyncDialog } from '../src/renderer/src/components/SyncDialog'

/**
 * Regression tests for I-06 and I-07: the sign-in code could not be selected
 * or copied, and a successful sign-in was never acknowledged — the panel sat
 * on "Waiting for approval…" reading exactly like a hang.
 */

async function openProject(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved', syncStatus: null })
}

async function openSignIn(): Promise<void> {
  await openProject()
  render(<SyncDialog onClose={() => {}} />)
  await waitFor(() => expect(screen.getByText('Sync with GitHub')).toBeTruthy())
  fireEvent.click(screen.getByText('Sync with GitHub'))
  // The client id is app-level and survives between projects, so this step
  // only appears the first time it is needed.
  const clientIdField = screen.queryByPlaceholderText('Paste the Client ID here')
  if (clientIdField) {
    fireEvent.change(clientIdField, { target: { value: 'Iv1.test' } })
    fireEvent.click(screen.getByText('Save'))
  }
  await waitFor(() => expect(screen.getByText('Sign in with GitHub')).toBeTruthy())
}

/** Render with the account already signed in, as a later visit would find it. */
async function openAlreadySignedIn(): Promise<void> {
  vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
    mode: 'unset',
    remoteUrl: null,
    login: 'geoffrey',
    clientIdSet: true,
    lastSyncAt: null,
    pendingSync: false
  })
  await openProject()
  render(<SyncDialog onClose={() => {}} />)
}

beforeEach(() => {
  vi.restoreAllMocks()
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, syncStatus: null })
})

describe('the sign-in code', () => {
  it('is selectable rather than locked by the chrome-wide user-select', async () => {
    await openSignIn()
    fireEvent.click(screen.getByText('Sign in with GitHub'))

    await waitFor(() => expect(screen.getByText('WYRM-1234')).toBeTruthy())
    // The class is what opts this one string out of the chrome's
    // user-select:none; without it the code cannot be highlighted at all.
    expect(screen.getByText('WYRM-1234').className).toContain('device-code')
  })

  it('can be copied to the clipboard, and says so', async () => {
    await openSignIn()
    fireEvent.click(screen.getByText('Sign in with GitHub'))
    await waitFor(() => expect(screen.getByText('Copy Code')).toBeTruthy())

    fireEvent.click(screen.getByText('Copy Code'))

    await waitFor(() => expect(screen.getByText('Copied')).toBeTruthy())
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('WYRM-1234')
  })

  it('shows the waiting panel is alive rather than frozen', async () => {
    await openSignIn()
    fireEvent.click(screen.getByText('Sign in with GitHub'))

    // Polling starts immediately, so a count is visible without waiting 5s.
    await waitFor(() => expect(screen.getByText(/checked 1 time/)).toBeTruthy())
  })
})

describe('acknowledging a successful sign-in', () => {
  /** Approve on the first poll — the mock's real cadence is 3 polls at 5s. */
  function approveImmediately(): void {
    vi.spyOn(api, 'signInPoll').mockResolvedValue({ state: 'ok', login: 'demo-writer' })
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      mode: 'unset',
      remoteUrl: null,
      login: 'demo-writer',
      clientIdSet: true,
      lastSyncAt: null,
      pendingSync: false
    })
  }

  it('says so out loud instead of silently swapping panels', async () => {
    await openSignIn()
    approveImmediately()
    fireEvent.click(screen.getByText('Sign in with GitHub'))

    await waitFor(() => expect(screen.getByText('SIGNED IN')).toBeTruthy())
    expect(screen.getByText(/You are signed in to GitHub as/)).toBeTruthy()
    expect(screen.getByText('demo-writer')).toBeTruthy()
    // The waiting panel must be gone — leaving it up is the reported bug.
    expect(screen.queryByText(/Waiting for approval/)).toBeNull()
  })

  it('moves on to connecting the project only when acknowledged', async () => {
    await openSignIn()
    approveImmediately()
    fireEvent.click(screen.getByText('Sign in with GitHub'))
    await waitFor(() => expect(screen.getByText('Continue')).toBeTruthy())

    fireEvent.click(screen.getByText('Continue'))

    await waitFor(() =>
      expect(screen.getByText('Create a private space on GitHub for this project')).toBeTruthy()
    )
  })
})

describe('reopening the dialog when already signed in', () => {
  it('states the account without making the writer sign in again', async () => {
    await openAlreadySignedIn()

    await waitFor(() => expect(screen.getByText('SIGNED IN AS GEOFFREY')).toBeTruthy())
    expect(screen.queryByText('Sign in with GitHub')).toBeNull()
  })

  it('still offers a way out — the account line carries its own Sign Out', async () => {
    await openAlreadySignedIn()
    await waitFor(() => expect(screen.getByText('SIGNED IN AS GEOFFREY')).toBeTruthy())

    const signOut = screen.getByText('Sign Out')
    expect(signOut.closest('.account-line')).not.toBeNull()

    vi.spyOn(api, 'signOut').mockResolvedValue({
      mode: 'unset',
      remoteUrl: null,
      login: null,
      clientIdSet: true,
      lastSyncAt: null,
      pendingSync: false
    })
    await act(async () => {
      fireEvent.click(signOut)
    })

    await waitFor(() => expect(screen.queryByText(/SIGNED IN AS/)).toBeNull())
  })
})
