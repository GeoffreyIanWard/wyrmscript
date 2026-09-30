// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncStatus } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll, __ensureRuntime } from '../src/renderer/src/store'

/**
 * F-41: a project open in a background window still reaches its drives and
 * its remote.
 *
 * Step 2 gave a parked project its own checkpoint. It did not give it backup
 * or sync, which meant two novels could sit open all day and only the focused
 * one would ever leave the machine — a data-safety gap that stays invisible
 * until the disk dies.
 *
 * Syncing a background project introduces a second hazard, and most of this
 * file is about that one. Sync is bidirectional, so a background sync can
 * *pull*: the files change on disk while the parked slice still holds the
 * binder and open document from before. Focusing that project and typing
 * would write stale text over work that had just arrived from another device.
 */

const CONNECTED: SyncStatus = {
  mode: 'github',
  remoteUrl: 'https://github.com/x/y.git',
  login: 'someone',
  clientIdSet: true,
  lastSyncAt: null,
  pendingSync: false
}

let demoPath: string | null = null

async function openTwo(): Promise<{ parked: string; focused: string }> {
  const first = demoPath!
  await useWyrm.getState().openRecentProject(first)
  const info = await api.createProject('Second Novel')
  await useWyrm.getState().openAdditionalProject(info.path)
  return { parked: first, focused: info.path }
}

/**
 * Puts the parked project in a state where its interval will checkpoint, and
 * makes that checkpoint report that it wrote something — the backup and sync
 * only follow a commit that actually happened.
 */
function makeParkedDirty(path: string): void {
  __ensureRuntime(path).commitDirty = true
  vi.spyOn(api, 'commit').mockResolvedValue(true)
}

/** Gives the parked project settings worth acting on. */
function configureParked(
  path: string,
  patch: { backup?: boolean; sync?: boolean; targets?: number }
): void {
  const state = useWyrm.getState()
  const slice = state.parked[path]
  useWyrm.setState({
    parked: {
      ...state.parked,
      [path]: {
        ...slice,
        backupSettings: {
          auto: patch.backup ?? false,
          targets: Array.from({ length: patch.targets ?? 1 }, (_, i) => ({
            id: `t${i}`,
            path: `/Volumes/Drive${i}`,
            lastBackupAt: null
          }))
        },
        syncStatus: patch.sync ? CONNECTED : null
      }
    }
  })
}

beforeEach(async () => {
  vi.restoreAllMocks()
  demoPath ??= await api.getLastProjectPath()
})

afterEach(() => {
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    windowGeometry: {},
    editor: null,
    stale: false
  })
  __disposeAll()
})

describe('a background project reaches its drives', () => {
  it('backs up after its own checkpoint', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { backup: true })
    makeParkedDirty(parked)
    const backup = vi.spyOn(api, 'backupNow').mockResolvedValue({ at: 1, results: [] })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(backup).toHaveBeenCalledWith(parked)
    vi.useRealTimers()
  })

  it('does not back up when the project has automatic backup switched off', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { backup: false })
    makeParkedDirty(parked)
    const backup = vi.spyOn(api, 'backupNow').mockResolvedValue({ at: 1, results: [] })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(backup).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('syncs after its own checkpoint when it has a remote', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: true })
    makeParkedDirty(parked)
    const sync = vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pushed', at: 1 })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(sync).toHaveBeenCalledWith(parked)
    vi.useRealTimers()
  })

  it('does not sync a local-only project', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: false })
    makeParkedDirty(parked)
    const sync = vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pushed', at: 1 })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(sync).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('a background sync that pulls', () => {
  it('marks the project stale', async () => {
    // The files on disk no longer match the state held for this project.
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: true })
    makeParkedDirty(parked)
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pulled', at: 1, pushed: false })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(useWyrm.getState().parked[parked].stale).toBe(true)
    vi.useRealTimers()
  })

  it('marks it stale after a merge too', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: true })
    makeParkedDirty(parked)
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'merged', at: 1, pushed: true })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(useWyrm.getState().parked[parked].stale).toBe(true)
    vi.useRealTimers()
  })

  it('leaves it alone when nothing came down', async () => {
    // A push changes nothing on disk, so there is nothing to re-read.
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: true })
    makeParkedDirty(parked)
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pushed', at: 1 })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(useWyrm.getState().parked[parked].stale).toBe(false)
    vi.useRealTimers()
  })

  it('re-reads from disk when the project comes forward', async () => {
    // The whole point of the flag: never let the writer type into state that
    // no longer matches the files.
    const { parked } = await openTwo()
    useWyrm.setState({
      parked: {
        ...useWyrm.getState().parked,
        [parked]: { ...useWyrm.getState().parked[parked], stale: true }
      }
    })
    const reread = vi.spyOn(api, 'openProjectPath')

    await useWyrm.getState().focusProject(parked)

    expect(reread).toHaveBeenCalledWith(parked)
    expect(useWyrm.getState().stale).toBe(false)
  })

  it('does not re-read a project that is still current', async () => {
    const { parked } = await openTwo()
    const reread = vi.spyOn(api, 'openProjectPath')

    await useWyrm.getState().focusProject(parked)

    expect(reread).not.toHaveBeenCalled()
  })
})

describe('a background sync that conflicts', () => {
  it('raises the quiet flag rather than putting a dialog on screen', async () => {
    // The page is sacred: only a sync the writer asked for may interrupt.
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: true })
    makeParkedDirty(parked)
    vi.spyOn(api, 'syncNow').mockResolvedValue({
      status: 'conflicts',
      conflicts: [
        { path: 'documents/a.md', kind: 'doc', title: 'A', localBody: 'x', remoteBody: 'y' }
      ]
    })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    const slice = useWyrm.getState().parked[parked]
    expect(slice.syncNeedsAttention).toBe(true)
    expect(slice.syncConflicts).toBeNull()
    // And nothing was put in front of the writer of the *focused* project.
    expect(useWyrm.getState().syncConflicts).toBeNull()
    vi.useRealTimers()
  })
})

describe('failures never block a checkpoint', () => {
  it('survives a backup that throws', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { backup: true, sync: true })
    makeParkedDirty(parked)
    vi.spyOn(api, 'backupNow').mockRejectedValue(new Error('drive unplugged'))
    const sync = vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pushed', at: 1 })

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    // The sync still ran, and nothing was thrown out of the interval.
    expect(sync).toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('survives a sync that throws', async () => {
    vi.useFakeTimers()
    const { parked } = await openTwo()
    configureParked(parked, { sync: true })
    makeParkedDirty(parked)
    vi.spyOn(api, 'syncNow').mockRejectedValue(new Error('network is down'))

    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 100)

    expect(useWyrm.getState().parked[parked].stale).toBe(false)
    vi.useRealTimers()
  })
})
