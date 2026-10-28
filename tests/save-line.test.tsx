// @vitest-environment jsdom
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { BackupRun, SyncStatus } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { __disposeAll, useWyrm } from '../src/renderer/src/store'
import { REACH_CHECK_MS, SaveLine } from '../src/renderer/src/components/SaveLine'
import { SaveDrawer } from '../src/renderer/src/components/SaveDrawer'

/**
 * F-50 step 2: the status line's envelopes — one per place the work is kept,
 * default first, saying what is true about each and nothing more.
 */

const SYNCED: SyncStatus = {
  mode: 'github',
  remoteUrl: 'https://github.com/someone/winter.git',
  login: 'someone',
  clientIdSet: true,
  lastSyncAt: Date.now() - 2 * 60_000,
  pendingSync: false
}

let path = ''

async function openDemo(): Promise<void> {
  path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({
    project: info,
    booted: true,
    saveState: 'saved',
    backupSettings: { targets: [], auto: false },
    syncStatus: null,
    unreachable: [],
    savingTo: [],
    syncProblem: null,
    syncNeedsAttention: false,
    lastCommitAt: Date.now() - 2 * 60_000
  })
}

function renderLine(onOpen = vi.fn()): typeof onOpen {
  render(<SaveLine now={Date.now()} onOpen={onOpen} />)
  return onOpen
}

const envelopes = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.save-envelope')]
const stateOf = (el: HTMLElement): string =>
  [...(el.querySelector('svg')?.classList ?? [])].filter((c) => c !== 'envelope').join(' ')

beforeEach(async () => {
  vi.restoreAllMocks()
  await openDemo()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [] })
  __disposeAll()
})

describe('the envelopes', () => {
  it('shows this computer alone for a project kept nowhere else', () => {
    renderLine()
    expect(envelopes().map((e) => e.getAttribute('aria-label'))).toEqual(['This computer: saved'])
    expect(screen.getByRole('button', { name: '2 MIN AGO' })).toBeTruthy()
    expect(document.querySelector('.save-line-bang')).toBeNull()
  })

  it('follows the drawer order, default first, and times the default', () => {
    useWyrm.setState({
      backupSettings: {
        targets: [{ id: 't1', path: '/Volumes/CARD/W.wyrm.git', lastBackupAt: Date.now() }],
        auto: true,
        order: ['github', 't1']
      },
      syncStatus: { ...SYNCED, lastSyncAt: Date.now() - 3 * 3_600_000 }
    })
    renderLine()
    expect(envelopes().map((e) => e.getAttribute('aria-label'))).toEqual([
      'GitHub: saved',
      'CARD: saved',
      'This computer: saved'
    ])
    // The time is the default's: GitHub's last sync, not the folder's save.
    expect(screen.getByRole('button', { name: '3 H AGO' })).toBeTruthy()
  })

  it('dashes a missing drive without raising the alarm', () => {
    useWyrm.setState({
      backupSettings: {
        targets: [{ id: 't1', path: '/Volumes/CARD/W.wyrm.git', lastBackupAt: Date.now() }],
        auto: true
      },
      unreachable: ['t1']
    })
    renderLine()
    const card = envelopes()[1]
    expect(stateOf(card)).toBe('missing')
    expect(card.querySelector('rect')?.getAttribute('stroke-dasharray')).toBe('2 2')
    expect(within(card).getByText(/Drive not connected/)).toBeTruthy()
    expect(document.querySelector('.save-line-bang')).toBeNull()
  })

  it('marks GitHub and ends the line in ! when it needs the writer', () => {
    useWyrm.setState({ syncStatus: SYNCED, syncProblem: 'GitHub unreachable' })
    renderLine()
    const github = envelopes()[1]
    expect(stateOf(github)).toBe('attention')
    expect(github.getAttribute('aria-label')).toBe('GitHub: needs attention. GitHub unreachable')
    expect(document.querySelector('.save-line-bang')?.textContent).toBe('!')
  })

  it('never fills GitHub when its link has gone from the project', () => {
    // The one lie this bar must never tell (F-01): a copy that is not there.
    useWyrm.setState({ syncStatus: { ...SYNCED, remoteUrl: null } })
    renderLine()
    expect(stateOf(envelopes()[1])).toBe('attention')
    expect(document.querySelector('.save-line-bang')).not.toBeNull()
  })

  it('leaves an envelope empty while it is behind', () => {
    useWyrm.setState({ syncStatus: { ...SYNCED, pendingSync: true } })
    renderLine()
    expect(stateOf(envelopes()[1])).toBe('behind')
  })
})

describe('opening the drawer', () => {
  it('opens on the card of the envelope clicked', () => {
    useWyrm.setState({ syncStatus: SYNCED })
    const onOpen = renderLine()
    fireEvent.click(envelopes()[1])
    expect(onOpen).toHaveBeenCalledWith('github')
  })

  it('opens on its own from the time', () => {
    const onOpen = renderLine()
    fireEvent.click(screen.getByRole('button', { name: '2 MIN AGO' }))
    expect(onOpen).toHaveBeenCalledWith()
  })

  it('puts focus on that card in the drawer', async () => {
    await api.chooseBackupLocation(path)
    await useWyrm.getState().loadBackupSettings()
    const target = useWyrm.getState().backupSettings!.targets[0].id
    // StrictMode, as the app runs in development: the focus trap's second
    // mount must not leave focus on the close box.
    render(
      <StrictMode>
        <SaveDrawer focusId={target} onClose={() => {}} />
      </StrictMode>
    )
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('data-location-id')).toBe(target)
    )
    await api.removeBackupTarget(path, target)
  })
})

describe('keeping up with drives that come and go', () => {
  it('asks as it appears, every so often, and when the window comes back', async () => {
    vi.useFakeTimers()
    const ask = vi
      .spyOn(api, 'checkSaveLocations')
      .mockResolvedValue({ unreachable: [], behind: [], diverged: [] })
    renderLine()
    expect(ask).toHaveBeenCalledTimes(1)
    await act(async () => {
      vi.advanceTimersByTime(REACH_CHECK_MS)
    })
    expect(ask).toHaveBeenCalledTimes(2)
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    expect(ask).toHaveBeenCalledTimes(3)
  })
})

describe('filling in as each place is written', () => {
  it('dithers the drives while a backup runs, then fills them', async () => {
    await api.chooseBackupLocation(path)
    await useWyrm.getState().loadBackupSettings()
    let finish: (run: BackupRun) => void = () => {}
    vi.spyOn(api, 'backupNow').mockImplementation(
      () => new Promise<BackupRun>((resolve) => (finish = resolve))
    )
    // The card is taken out while the backup runs; the main process's next
    // answer says so.
    let pulled = false
    vi.spyOn(api, 'checkSaveLocations').mockImplementation(async () => ({
      unreachable: pulled ? [useWyrm.getState().backupSettings!.targets[0].id] : [],
      behind: [],
      diverged: []
    }))
    renderLine()
    let running: Promise<unknown> = Promise.resolve()
    act(() => {
      running = useWyrm.getState().backupNow()
    })
    await waitFor(() => expect(stateOf(envelopes()[1])).toBe('saving'))
    const target = useWyrm.getState().backupSettings!.targets[0].id
    await act(async () => {
      pulled = true
      finish({
        at: Date.now(),
        results: [{ targetId: target, status: 'unreachable' }]
      })
      await running
    })
    // Finished: no longer saving, and what the run found is shown.
    expect(useWyrm.getState().savingTo).toEqual([])
    expect(stateOf(envelopes()[1])).toBe('missing')
    await api.removeBackupTarget(path, target)
  })

  it('dithers GitHub while it syncs', async () => {
    useWyrm.setState({ syncStatus: SYNCED })
    let finish: () => void = () => {}
    vi.spyOn(api, 'syncNow').mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve({ status: 'pushed', at: Date.now() })
        })
    )
    let running: Promise<unknown> = Promise.resolve()
    act(() => {
      running = useWyrm.getState().syncNow(false)
    })
    await waitFor(() => expect(useWyrm.getState().savingTo).toEqual(['github']))
    await act(async () => {
      finish()
      await running
    })
    expect(useWyrm.getState().savingTo).toEqual([])
  })

  it("marks this computer while Save Now's save point is being made", async () => {
    let seen: string[] = []
    vi.spyOn(api, 'commit').mockImplementation(async () => {
      seen = useWyrm.getState().savingTo
      return true
    })
    await act(async () => {
      await useWyrm.getState().saveEverywhere()
    })
    expect(seen).toEqual(['folder'])
    expect(useWyrm.getState().savingTo).toEqual([])
  })

  it('stops showing a write as saving even when it fails', async () => {
    vi.spyOn(api, 'syncNow').mockRejectedValue(new Error('No.'))
    await act(async () => {
      await useWyrm
        .getState()
        .syncNow(false)
        .catch(() => {})
    })
    expect(useWyrm.getState().savingTo).toEqual([])
  })

  it('clears the mark on the right novel after another comes forward', async () => {
    const other = '/elsewhere/Other.wyrm'
    vi.spyOn(api, 'commit').mockImplementation(async () => {
      const state = useWyrm.getState()
      expect(state.savingTo).toEqual(['folder'])
      // Park this one (with its mark) and bring another forward.
      useWyrm.setState({
        parked: { [path]: { ...(state as never), savingTo: ['folder'] } },
        project: { ...state.project!, path: other },
        savingTo: []
      })
      return true
    })
    await act(async () => {
      await useWyrm.getState().commitNow('Checkpoint')
    })
    expect(useWyrm.getState().parked[path].savingTo).toEqual([])
    expect(useWyrm.getState().savingTo).toEqual([])
  })
})
