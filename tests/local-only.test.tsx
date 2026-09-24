// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { SyncStatus } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'
import { MenuBar } from '../src/renderer/src/components/MenuBar'
import { SyncDialog } from '../src/renderer/src/components/SyncDialog'
import { hasSecondCopy, isConnected, isRemoteMissing } from '../src/renderer/src/lib/syncState'

/**
 * F-01: a writer who never wants a GitHub account must get the whole app,
 * quietly. Two things are being pinned here.
 *
 * First, that local-only degrades cleanly — no dead buttons, no nagging.
 * Nothing asserted this before, which is how the second problem survived.
 *
 * Second, the drift case. `mode` is stored intent; `remoteUrl` is read live
 * from `.git/config`, so a remote removed outside the app leaves
 * `mode: 'github'` with no URL. The menu gated Sync Now on `mode` alone and
 * left it live; the status bar read `mode` alone and said `◆ SYNCED`. The app
 * claimed the work was safely off the machine while having nowhere to send
 * it — the one lie an app promising "nothing is ever lost" must not tell.
 */

const LOCAL_ONLY: SyncStatus = {
  mode: 'local-only',
  remoteUrl: null,
  login: null,
  clientIdSet: false,
  lastSyncAt: null,
  pendingSync: false
}

const UNSET: SyncStatus = { ...LOCAL_ONLY, mode: 'unset' }

/** Intent says GitHub, but the remote is gone. */
const DRIFTED: SyncStatus = { ...LOCAL_ONLY, mode: 'github', login: 'someone', clientIdSet: true }

const CONNECTED: SyncStatus = { ...DRIFTED, remoteUrl: 'https://github.com/x/y.git' }

async function openProject(): Promise<void> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved' })
}

const noop = (): void => {}

function renderMenuBar(): void {
  render(
    <MenuBar
      onAbout={noop}
      onPreferences={noop}
      onVersionDialog={noop}
      onCompile={noop}
      onBackup={noop}
      onSyncSettings={noop}
      onSearch={noop}
      onPalette={noop}
      focusMode={false}
      onFocusMode={noop}
    />
  )
}

/** Opens the Project menu so its items render. */
async function openProjectMenu(): Promise<void> {
  renderMenuBar()
  fireEvent.keyDown(screen.getByText('Project'), { key: 'ArrowDown' })
  await waitFor(() => expect(screen.queryByText('Sync Now')).toBeTruthy())
}

/** The Sync Now item is a real <button disabled>, not aria-disabled. */
function syncNowItem(): HTMLButtonElement {
  const item = screen.getByText('Sync Now').closest('button')
  if (!item) throw new Error('Sync Now menu item not found')
  return item as HTMLButtonElement
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await openProject()
})

afterEach(() => {
  useWyrm.setState({
    project: null,
    booted: false,
    syncStatus: null,
    syncConflicts: null,
    syncNeedsAttention: false,
    backupSettings: null
  })
  cleanup()
})

describe('the connected predicate', () => {
  it('requires both the stored intent and a live remote', () => {
    expect(isConnected(CONNECTED)).toBe(true)
    expect(isConnected(DRIFTED)).toBe(false)
    expect(isConnected(LOCAL_ONLY)).toBe(false)
    expect(isConnected(UNSET)).toBe(false)
    expect(isConnected(null)).toBe(false)
  })

  it('tells a broken connection apart from a deliberate local choice', () => {
    // These must not collapse into one state: one is a fault to surface, the
    // other is a choice to respect silently.
    expect(isRemoteMissing(DRIFTED)).toBe(true)
    expect(isRemoteMissing(LOCAL_ONLY)).toBe(false)
    expect(isRemoteMissing(UNSET)).toBe(false)
  })

  it('counts a backup as a second copy, and a dead remote as none', () => {
    expect(hasSecondCopy(LOCAL_ONLY, { path: '/Volumes/ext/novel' } as never)).toBe(true)
    expect(hasSecondCopy(CONNECTED, null)).toBe(true)
    expect(hasSecondCopy(LOCAL_ONLY, null)).toBe(false)
    // Intent alone is not a copy.
    expect(hasSecondCopy(DRIFTED, null)).toBe(false)
  })
})

describe('Sync Now', () => {
  it('is disabled for a local-only project', async () => {
    useWyrm.setState({ syncStatus: LOCAL_ONLY })
    await openProjectMenu()

    expect(syncNowItem().disabled).toBe(true)
  })

  it('is disabled before the writer has chosen at all', async () => {
    useWyrm.setState({ syncStatus: UNSET })
    await openProjectMenu()

    expect(syncNowItem().disabled).toBe(true)
  })

  it('is disabled when the remote has gone missing', async () => {
    // The regression: gating on `mode` alone left this live, and clicking it
    // threw "This project is not connected to GitHub" as an unhandled
    // rejection.
    useWyrm.setState({ syncStatus: DRIFTED })
    await openProjectMenu()

    expect(syncNowItem().disabled).toBe(true)
  })

  it('is enabled only when there is somewhere to push', async () => {
    useWyrm.setState({ syncStatus: CONNECTED })
    await openProjectMenu()

    expect(syncNowItem().disabled).toBe(false)
  })
})

describe('a failing sync', () => {
  it('raises the quiet flag instead of reporting success', async () => {
    // Callers fire this with `void`, so a swallowed rejection would leave the
    // writer believing their work had reached GitHub.
    useWyrm.setState({ syncStatus: CONNECTED, syncNeedsAttention: false })
    vi.spyOn(api, 'syncNow').mockRejectedValue(new Error('network is down'))

    await expect(useWyrm.getState().syncNow(true)).rejects.toThrow('network is down')
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })
})

describe('the local-only panel', () => {
  it('says plainly that one disk holds everything', async () => {
    useWyrm.setState({ syncStatus: LOCAL_ONLY, backupSettings: null })
    render(<SyncDialog onClose={() => {}} />)

    expect(screen.getByText(/lives on this machine and nowhere else/i)).toBeTruthy()
    expect(screen.getByText(/a disk that dies takes it with it/i)).toBeTruthy()
  })

  it('offers the backup control rather than naming a menu item', async () => {
    // "go to Project → Backup…" is an instruction; a button is a door.
    const onOpenBackup = vi.fn()
    useWyrm.setState({ syncStatus: LOCAL_ONLY, backupSettings: null })
    render(<SyncDialog onClose={() => {}} onOpenBackup={onOpenBackup} />)

    fireEvent.click(screen.getByText('Set Up a Backup…'))

    expect(onOpenBackup).toHaveBeenCalled()
  })

  it('does not warn a writer who already has a backup', async () => {
    // Telling someone who is covered that they have only one copy is both
    // false and exactly the nagging F-01 forbids.
    useWyrm.setState({
      syncStatus: LOCAL_ONLY,
      backupSettings: { path: '/Volumes/ext/novel' } as never
    })
    render(<SyncDialog onClose={() => {}} onOpenBackup={() => {}} />)

    expect(screen.queryByText(/lives on this machine and nowhere else/i)).toBeNull()
    expect(screen.getByText(/copied to your backup location/i)).toBeTruthy()
  })

  it('is honest that a backup on the same disk does not count', async () => {
    useWyrm.setState({
      syncStatus: LOCAL_ONLY,
      backupSettings: { path: '/Users/x/novel-backup' } as never
    })
    render(<SyncDialog onClose={() => {}} onOpenBackup={() => {}} />)

    expect(screen.getByText(/if it is a folder on this same disk, it is not/i)).toBeTruthy()
  })

  it('never pushes GitHub as the remedy', async () => {
    // Local-only is a peer choice (PR #11), not a lesser path being corrected.
    useWyrm.setState({ syncStatus: LOCAL_ONLY, backupSettings: null })
    const { container } = render(<SyncDialog onClose={() => {}} onOpenBackup={() => {}} />)

    expect(container.textContent).not.toMatch(/you should|we recommend|instead,? sync/i)
  })
})
