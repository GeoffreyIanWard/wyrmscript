// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { SyncConflict, SyncOutcome, SyncStatus } from '../src/shared/types'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { conflictsWaiting } from '../src/renderer/src/lib/saveLocations'
import { __disposeAll, __ensureRuntime, useWyrm } from '../src/renderer/src/store'
import { SaveDrawer } from '../src/renderer/src/components/SaveDrawer'
import { SaveLine } from '../src/renderer/src/components/SaveLine'

/**
 * F-50 step 5: the drawer's Conflicts tab — the way into resolving passages
 * changed one way here and another on a second computer.
 */

const LINKED: SyncStatus = {
  mode: 'github',
  remoteUrl: 'https://github.com/someone/winter.git',
  login: 'someone',
  clientIdSet: true,
  lastSyncAt: Date.now() - 60_000,
  pendingSync: false
}

const CONFLICTS: SyncConflict[] = [
  {
    path: 'documents/a.md',
    kind: 'doc',
    title: 'The Wyrmlight Fades',
    localBody: 'Here.',
    remoteBody: 'There.'
  },
  {
    path: 'documents/b.md',
    kind: 'doc',
    title: 'A Knock at Night',
    localBody: 'Knock.',
    remoteBody: 'Knock knock.'
  }
]

let path = ''
// Captured once: the mock's "last project" becomes whatever a test opened
// last, and a test that opens a second novel would otherwise make it the demo.
let demoPath: string | null = null

async function openDemo(): Promise<void> {
  demoPath ??= await api.getLastProjectPath()
  path = demoPath!
  await act(async () => {
    await useWyrm.getState().openRecentProject(path)
  })
  vi.spyOn(api, 'getSyncStatus').mockResolvedValue(LINKED)
  useWyrm.setState({ syncStatus: LINKED })
}

function renderConflicts(): void {
  render(<SaveDrawer initialTab="conflicts" onClose={() => {}} />)
}

beforeEach(async () => {
  vi.restoreAllMocks()
  await openDemo()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    syncConflicts: null,
    waitingConflicts: null,
    syncNeedsAttention: false,
    syncProblem: null
  })
  __disposeAll()
})

describe('what the store keeps', () => {
  it('keeps the list a background sync found, without opening anything', async () => {
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: CONFLICTS })
    await act(async () => {
      await useWyrm.getState().syncNow(false)
    })
    const state = useWyrm.getState()
    expect(state.syncConflicts).toBeNull()
    expect(state.syncNeedsAttention).toBe(true)
    expect(state.waitingConflicts?.map((c) => c.title)).toEqual([
      'The Wyrmlight Fades',
      'A Knock at Night'
    ])
  })

  it('forgets it once a sync gets through without any', async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'up-to-date', at: Date.now() })
    await act(async () => {
      await useWyrm.getState().syncNow(false)
    })
    expect(useWyrm.getState().waitingConflicts).toBeNull()
  })

  it('keeps the list when the writer closes the resolution screen undecided', () => {
    useWyrm.setState({ syncConflicts: CONFLICTS })
    useWyrm.getState().dismissConflicts()
    expect(useWyrm.getState().waitingConflicts).toEqual(CONFLICTS)
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })

  it('forgets it once they are resolved, or the project leaves GitHub', async () => {
    useWyrm.setState({ syncConflicts: CONFLICTS, waitingConflicts: CONFLICTS })
    vi.spyOn(api, 'resolveSyncConflicts').mockResolvedValue({
      status: 'merged',
      at: Date.now(),
      pushed: true
    })
    await act(async () => {
      await useWyrm.getState().resolveConflicts([])
    })
    expect(useWyrm.getState().waitingConflicts).toBeNull()

    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    vi.spyOn(api, 'disconnectSync').mockResolvedValue({ ...LINKED, mode: 'local-only' })
    await act(async () => {
      await useWyrm.getState().disconnectSync()
    })
    expect(useWyrm.getState().waitingConflicts).toBeNull()
  })

  it("keeps a background project's list on its own slice", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      // Re-arm this project's checkpoint under the fake clock.
      await act(async () => {
        await useWyrm.getState().setSaveSettings({ everyMinutes: 5 })
      })
      const second = await api.createProject('Second Novel')
      await act(async () => {
        await useWyrm.getState().openAdditionalProject(second.path)
      })
      vi.spyOn(api, 'commit').mockResolvedValue(true)
      vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: CONFLICTS })
      __ensureRuntime(path).commitDirty = true
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60_000)
      })
      await waitFor(() =>
        expect(useWyrm.getState().parked[path]?.waitingConflicts).toEqual(CONFLICTS)
      )
      // Nothing opened over the novel in front.
      expect(useWyrm.getState().syncConflicts).toBeNull()
      expect(useWyrm.getState().waitingConflicts).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the list when the sync could not get through', async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    for (const outcome of [
      { status: 'offline', detail: 'No network.' } as const,
      { status: 'error', detail: 'GitHub said no.' } as const
    ]) {
      vi.spyOn(api, 'syncNow').mockResolvedValue(outcome)
      await act(async () => {
        await useWyrm.getState().syncNow(true)
      })
      expect(useWyrm.getState().waitingConflicts).toEqual(CONFLICTS)
      expect(
        conflictsWaiting(
          useWyrm.getState().syncNeedsAttention,
          useWyrm.getState().syncProblem,
          useWyrm.getState().waitingConflicts
        )
      ).toBe(true)
    }
  })

  describe('when another novel comes to the front during the sync', () => {
    async function syncThenSwitch(
      interactive: boolean
    ): Promise<{ finish: (o: SyncOutcome) => Promise<void>; second: string }> {
      let resolve: (o: SyncOutcome) => void = () => {}
      vi.spyOn(api, 'syncNow').mockImplementation(
        () => new Promise<SyncOutcome>((r) => (resolve = r))
      )
      let running: Promise<unknown> = Promise.resolve()
      act(() => {
        running = useWyrm
          .getState()
          .syncNow(interactive)
          .catch(() => {})
      })
      await waitFor(() => expect(useWyrm.getState().savingTo).toContain('github'))
      const second = await api.createProject('Second Novel')
      await act(async () => {
        await useWyrm.getState().openAdditionalProject(second.path)
      })
      return {
        second: second.path,
        finish: async (o) => {
          await act(async () => {
            resolve(o)
            await running
          })
        }
      }
    }

    it("puts this novel's conflicts on this novel, not the one in front", async () => {
      const { finish, second } = await syncThenSwitch(false)
      await finish({ status: 'conflicts', conflicts: CONFLICTS })
      expect(useWyrm.getState().project?.path).toBe(second)
      expect(useWyrm.getState().waitingConflicts).toBeNull()
      expect(useWyrm.getState().syncNeedsAttention).toBe(false)
      expect(useWyrm.getState().parked[path].waitingConflicts).toEqual(CONFLICTS)
      expect(useWyrm.getState().parked[path].syncNeedsAttention).toBe(true)
    })

    it("does not clear the front novel's list with this one's clean sync", async () => {
      const { finish } = await syncThenSwitch(false)
      useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
      await finish({ status: 'pushed', at: Date.now() })
      expect(useWyrm.getState().waitingConflicts).toEqual(CONFLICTS)
      expect(useWyrm.getState().syncNeedsAttention).toBe(true)
    })

    it('never opens the resolution screen over the other novel', async () => {
      const { finish } = await syncThenSwitch(true)
      await finish({ status: 'conflicts', conflicts: CONFLICTS })
      expect(useWyrm.getState().syncConflicts).toBeNull()
      expect(useWyrm.getState().parked[path].waitingConflicts).toEqual(CONFLICTS)
    })

    it('marks this novel to be re-read when the sync brought work in', async () => {
      const { finish } = await syncThenSwitch(false)
      await finish({ status: 'pulled', at: Date.now(), pushed: true })
      expect(useWyrm.getState().parked[path].stale).toBe(true)
    })
  })

  it('does not call a sync that failed a conflict', () => {
    expect(conflictsWaiting(true, 'GitHub unreachable', null)).toBe(false)
    expect(conflictsWaiting(true, null, null)).toBe(true)
    expect(conflictsWaiting(false, null, CONFLICTS)).toBe(true)
    expect(conflictsWaiting(false, null, [])).toBe(false)
  })
})

describe('the Conflicts tab', () => {
  it('names the passages waiting, and marks its tab', async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    renderConflicts()
    expect(await screen.findByText('WAITING FOR YOU')).toBeTruthy()
    expect(screen.getByText('The Wyrmlight Fades')).toBeTruthy()
    expect(screen.getByText('A Knock at Night')).toBeTruthy()
    expect(screen.getByText(/Nothing has been lost/)).toBeTruthy()
    const tab = screen.getByRole('tab', { name: /Conflicts/ })
    expect(within(tab).getByText('!')).toBeTruthy()
  })

  it('looks again and opens the resolution screen on Resolve', async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    const sync = vi
      .spyOn(api, 'syncNow')
      .mockResolvedValue({ status: 'conflicts', conflicts: CONFLICTS })
    renderConflicts()
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Resolve…' }))
    })
    expect(sync).toHaveBeenCalledWith(path)
    // A fresh list, which is what App puts the resolution screen up for.
    await waitFor(() => expect(useWyrm.getState().syncConflicts).toEqual(CONFLICTS))
  })

  it('says so when, looking again, nothing is waiting any more', async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pulled', at: Date.now(), pushed: true })
    renderConflicts()
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Resolve…' }))
    })
    expect(
      await screen.findByText('Nothing is waiting any more: the work from both computers is in.')
    ).toBeTruthy()
    expect(useWyrm.getState().syncConflicts).toBeNull()
  })

  it('says there is nothing to resolve, without a mark', async () => {
    renderConflicts()
    expect(await screen.findByText(/Nothing to resolve/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Resolve…' })).toBeNull()
    expect(within(screen.getByRole('tab', { name: /Conflicts/ })).queryByText('!')).toBeNull()
  })

  it('explains conflicts cannot happen without GitHub', async () => {
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({ ...LINKED, mode: 'local-only' })
    useWyrm.setState({ syncStatus: { ...LINKED, mode: 'local-only' } })
    renderConflicts()
    expect(await screen.findByText(/not linked to GitHub/)).toBeTruthy()
  })

  it('points to GitHub when the last sync could not get through', async () => {
    useWyrm.setState({ syncProblem: 'GitHub unreachable', syncNeedsAttention: true })
    renderConflicts()
    expect(await screen.findByText(/Nothing to resolve/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'GitHub…' }))
    expect(screen.getByRole('tab', { name: 'GitHub' }).getAttribute('aria-selected')).toBe('true')
  })
})

describe('the ways in', () => {
  it("goes from the GitHub card's Needs your eye to the Conflicts tab", async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    render(<SaveDrawer onClose={() => {}} />)
    const github = await screen.findByRole('listitem', { name: 'GitHub' })
    fireEvent.click(within(github).getByRole('button', { name: 'Needs your eye' }))
    expect(screen.getByRole('tab', { name: /Conflicts/ }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('opens the drawer on Conflicts from the GitHub envelope when passages wait', () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    const onOpen = vi.fn()
    render(<SaveLine now={Date.now()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /^GitHub:/ }))
    expect(onOpen).toHaveBeenCalledWith(undefined, 'conflicts')
  })

  it('opens the GitHub card instead when the trouble is the connection', () => {
    useWyrm.setState({ syncProblem: 'GitHub unreachable', syncNeedsAttention: true })
    const onOpen = vi.fn()
    render(<SaveLine now={Date.now()} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button', { name: /^GitHub:/ }))
    expect(onOpen).toHaveBeenCalledWith('github')
  })
})

describe('the GitHub envelope in the app', () => {
  it('opens the drawer on Conflicts, and focus stays in the tabs after', async () => {
    cleanup()
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
    await waitFor(() => expect(useWyrm.getState().booted).toBe(true))
    await openDemo()
    act(() => {
      useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    })
    fireEvent.click(await screen.findByRole('button', { name: /^GitHub:/ }))
    const conflicts = await screen.findByRole('tab', { name: /Conflicts/ })
    expect(conflicts.getAttribute('aria-selected')).toBe('true')
    // Round to Save to from the keyboard: focus stays on the tab.
    act(() => {
      conflicts.focus()
    })
    fireEvent.keyDown(conflicts, { key: 'ArrowRight' })
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Save to' }).getAttribute('aria-selected')).toBe(
        'true'
      )
    )
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
    expect(document.activeElement?.getAttribute('role')).toBe('tab')
  })
})

describe('a card to focus', () => {
  it('belongs to the Save to tab: opening elsewhere never pulls focus onto it', async () => {
    useWyrm.setState({ waitingConflicts: CONFLICTS, syncNeedsAttention: true })
    render(<SaveDrawer initialTab="conflicts" focusId="github" onClose={() => {}} />)
    const conflicts = await screen.findByRole('tab', { name: /Conflicts/ })
    act(() => {
      conflicts.focus()
    })
    fireEvent.keyDown(conflicts, { key: 'ArrowRight' })
    await screen.findByRole('listitem', { name: 'GitHub' })
    expect(document.activeElement?.getAttribute('role')).toBe('tab')
  })
})

describe('the drawer and the resolution screen', () => {
  it('steps aside when conflicts come up, rather than stack two dialogs', async () => {
    cleanup()
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
    await waitFor(() => expect(useWyrm.getState().booted).toBe(true))
    await openDemo()
    fireEvent.click(await screen.findByRole('button', { name: /^This computer:/ }))
    await waitFor(() => expect(document.querySelector('.save-drawer')).not.toBeNull())
    act(() => {
      useWyrm.setState({ syncConflicts: CONFLICTS })
    })
    await waitFor(() => expect(document.querySelector('.save-drawer')).toBeNull())
    expect(screen.getByText('Two Versions — Yours to Decide')).toBeTruthy()
    // Exactly one dialog up: the resolution screen.
    expect(document.querySelectorAll('.dialog-overlay')).toHaveLength(1)
  })
})
