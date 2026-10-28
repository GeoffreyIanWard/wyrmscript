// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SyncStatus } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { __disposeAll, __ensureRuntime, useWyrm } from '../src/renderer/src/store'
import { SaveDrawer } from '../src/renderer/src/components/SaveDrawer'
import { MenuBar } from '../src/renderer/src/components/MenuBar'

/**
 * F-50 step 3: the drawer's Settings and GitHub tabs, which replaced the
 * Backup and Sync dialogs, and the menu that no longer offers them.
 */

const SIGNED_IN: SyncStatus = {
  mode: 'local-only',
  remoteUrl: null,
  login: 'someone',
  clientIdSet: true,
  lastSyncAt: null,
  pendingSync: false
}
const LINKED: SyncStatus = {
  ...SIGNED_IN,
  mode: 'github',
  remoteUrl: 'https://github.com/someone/winter.git',
  lastSyncAt: Date.now() - 10 * 60_000
}

let path = ''

async function openDemo(): Promise<void> {
  path = (await api.getLastProjectPath())!
  await act(async () => {
    await useWyrm.getState().openRecentProject(path)
  })
}

function renderTab(tab: 'settings' | 'github'): void {
  render(<SaveDrawer initialTab={tab} onClose={() => {}} />)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await openDemo()
})

afterEach(async () => {
  cleanup()
  vi.useRealTimers()
  for (const t of (await api.getBackupSettings(path)).targets) {
    await api.removeBackupTarget(path, t.id)
  }
  await api.setSaveSettings(path, { auto: false, everyMinutes: 5, sendToGithub: true })
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [] })
  __disposeAll()
})

describe('the Settings tab', () => {
  it('sets how often a save point is made, and the timer follows', async () => {
    const write = vi.spyOn(api, 'setSaveSettings')
    renderTab('settings')
    const every = await screen.findByRole('combobox', { name: 'Minutes between save points' })
    expect((every as HTMLSelectElement).value).toBe('5')

    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    await act(async () => {
      fireEvent.change(every, { target: { value: '1' } })
    })
    expect(write).toHaveBeenCalledWith(path, { everyMinutes: 1 })
    await waitFor(() => expect(useWyrm.getState().backupSettings?.everyMinutes).toBe(1))

    // Unsaved work: one minute later, not five, a save point is made.
    const commit = vi.spyOn(api, 'commit').mockResolvedValue(false)
    __ensureRuntime(path).commitDirty = true
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(commit).toHaveBeenCalledWith(path, 'Autosave')
  })

  it('copies to the drives after each save point only when asked', async () => {
    await api.chooseBackupLocation(path)
    renderTab('settings')
    const copy = await screen.findByRole('checkbox', {
      name: 'Copy each save point to your drives and cards'
    })
    expect(copy.getAttribute('aria-checked')).toBe('false')
    await act(async () => {
      fireEvent.click(copy)
    })
    await waitFor(() => expect(useWyrm.getState().backupSettings?.auto).toBe(true))
  })

  it('says when there is no drive yet', async () => {
    renderTab('settings')
    expect(await screen.findByText(/There is no drive or card yet/)).toBeTruthy()
  })

  it('stops sending save points to GitHub when turned off', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(LINKED)
    renderTab('settings')
    const send = await screen.findByRole('checkbox', { name: 'Send each save point to GitHub' })
    expect(send.getAttribute('aria-checked')).toBe('true')
    await act(async () => {
      fireEvent.click(send)
    })
    await waitFor(() => expect(useWyrm.getState().backupSettings?.sendToGithub).toBe(false))

    // A save point now stays here; Save Now is the way to send it.
    const sync = vi.spyOn(api, 'syncNow')
    vi.spyOn(api, 'commit').mockResolvedValue(true)
    await act(async () => {
      await useWyrm.getState().commitNow('Checkpoint')
    })
    expect(sync).not.toHaveBeenCalled()
  })

  it('offers sending to GitHub only to a project linked to it', async () => {
    renderTab('settings')
    await screen.findByRole('combobox', { name: 'Minutes between save points' })
    expect(screen.queryByRole('checkbox', { name: 'Send each save point to GitHub' })).toBeNull()
  })
})

describe('the GitHub tab', () => {
  it('shows where the work goes, and sends it on Sync Now', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(LINKED)
    const sync = vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pushed', at: Date.now() })
    renderTab('github')
    expect(await screen.findByText(/Your work goes to github.com\/someone\/winter/)).toBeTruthy()
    expect(screen.getByText(/Last sent 10 min ago/)).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Sync Now' }))
    })
    expect(sync).toHaveBeenCalledWith(path)
    expect(await screen.findByText('Sent to GitHub.')).toBeTruthy()
  })

  it('says why the last sync did not get through', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(LINKED)
    useWyrm.setState({ syncProblem: 'GitHub unreachable' })
    renderTab('github')
    expect(
      await screen.findByText('The last try could not get through: GitHub unreachable')
    ).toBeTruthy()
  })

  it('disconnects only after asking, and never deletes the copy', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(LINKED)
    const disconnect = vi.spyOn(api, 'disconnectSync').mockResolvedValue(SIGNED_IN)
    renderTab('github')
    fireEvent.click(await screen.findByRole('button', { name: 'Disconnect…' }))
    const ask = screen.getByRole('alertdialog')
    expect(ask.textContent).toMatch(/nothing on GitHub is deleted/)
    expect(disconnect).not.toHaveBeenCalled()
    await act(async () => {
      fireEvent.click(within(ask).getByRole('button', { name: 'Disconnect' }))
    })
    expect(disconnect).toHaveBeenCalledWith(path)
  })

  it('asks to reconnect a project whose link was lost', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ ...LINKED, remoteUrl: null })
    renderTab('github')
    expect(await screen.findByText('RECONNECT THIS PROJECT')).toBeTruthy()
    expect(screen.getByText(/lost its link to GitHub/)).toBeTruthy()
  })

  it('asks a signed-out writer to sign in again before anything can be sent', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ ...LINKED, login: null })
    renderTab('github')
    expect(await screen.findByText(/Signed out of GitHub, so nothing can be sent/)).toBeTruthy()
    expect(screen.getByText('Sign in with GitHub')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Sync Now' })).toBeNull()
  })

  it('switches account by signing out, then asking for the other one', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(LINKED)
    const signOut = vi.spyOn(api, 'signOut').mockResolvedValue({ ...LINKED, login: null })
    renderTab('github')
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Switch Account…' }))
    })
    expect(signOut).toHaveBeenCalled()
    expect(await screen.findByText(/Sign in with the account you want to use/)).toBeTruthy()
  })

  it('connects a new private space', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SIGNED_IN)
    const connect = vi.spyOn(api, 'connectSync').mockResolvedValue(LINKED)
    renderTab('github')
    expect(await screen.findByText('CONNECT THIS PROJECT')).toBeTruthy()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    })
    expect(connect).toHaveBeenCalledWith(path, { create: true, name: expect.any(String) })
  })

  it('says why GitHub cannot be added when three places are kept already', async () => {
    await api.chooseBackupLocation(path)
    await api.chooseBackupLocation(path)
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue(SIGNED_IN)
    const connect = vi.spyOn(api, 'connectSync')
    renderTab('github')
    await screen.findByText('CONNECT THIS PROJECT')
    await waitFor(() => expect(useWyrm.getState().backupSettings?.targets).toHaveLength(2))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(screen.getByRole('alert').textContent).toMatch(/3 locations at most/)
    expect(connect).not.toHaveBeenCalled()
  })
})

describe('the menus', () => {
  it('offer Save To and Restore From, and none of the dialogs they replaced', () => {
    const noop = (): void => {}
    render(
      <MenuBar
        onAbout={noop}
        onPreferences={noop}
        onVersionDialog={noop}
        onCompile={noop}
        onSaveTo={noop}
        onRestoreFrom={noop}
        onSearch={noop}
        onPalette={noop}
        focusMode={false}
        onFocusMode={noop}
        onFullScreen={noop}
        fullScreen={false}
        onShortcuts={noop}
        onPrint={noop}
        onStats={noop}
        onBrowseTags={noop}
        onTimeline={noop}
        onPlotGraph={noop}
        onPlotlines={noop}
        onCharacterGraph={noop}
        onWorldMap={noop}
      />
    )
    const all: string[] = []
    for (const menu of ['File', 'Project']) {
      fireEvent.mouseDown(screen.getByText(menu))
      all.push(...[...document.querySelectorAll('.menu-item')].map((el) => el.textContent ?? ''))
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    }
    const text = all.join('\n')
    expect(text).toContain('Save To…')
    expect(text).toContain('Restore From…')
    expect(text).toContain('Create Save Point…')
    expect(text).not.toMatch(/Backup…|Sync Settings…|Bring Down from GitHub…|Commit Checkpoint/)
  })
})
