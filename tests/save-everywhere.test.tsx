// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, waitFor } from '@testing-library/react'
import type { SyncStatus } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { __disposeAll, __ensureRuntime, useWyrm } from '../src/renderer/src/store'

/**
 * F-50: the store side of the Save To drawer — Save Now acting on the novel
 * it was pressed for and no other, restores opening beside the work already
 * open, and the GitHub card's "Broken connection!" telling the truth.
 */

const SYNCED: SyncStatus = {
  mode: 'github',
  remoteUrl: 'https://github.com/someone/winter.git',
  login: 'someone',
  clientIdSet: true,
  lastSyncAt: null,
  pendingSync: false
}

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= await api.getLastProjectPath()
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  return demoPath!
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(async () => {
  if (demoPath) {
    for (const t of (await api.getBackupSettings(demoPath)).targets) {
      await api.removeBackupTarget(demoPath, t.id)
    }
  }
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('Save Now when another novel comes to the front', () => {
  it('does not sync the novel that came forward while a drive was being written', async () => {
    const first = await openDemo()
    await api.chooseBackupLocation(first)
    await useWyrm.getState().loadBackupSettings()
    useWyrm.setState({ syncStatus: SYNCED })
    const sync = vi.spyOn(api, 'syncNow')
    vi.spyOn(api, 'backupNow').mockImplementation(async () => {
      // Slow removable media; the writer brings another novel forward, which
      // is also linked to GitHub.
      const project = useWyrm.getState().project!
      useWyrm.setState({
        project: { ...project, path: '/elsewhere/Other.wyrm' },
        syncStatus: SYNCED
      })
      return { at: Date.now(), results: [] }
    })
    await act(async () => {
      await useWyrm.getState().saveEverywhere()
    })
    expect(sync).not.toHaveBeenCalled()
  })

  it("leaves the other novel's unsaved changes marked as unsaved", async () => {
    await openDemo()
    const other = '/elsewhere/Other.wyrm'
    vi.spyOn(api, 'commit').mockImplementation(async () => {
      const project = useWyrm.getState().project!
      useWyrm.setState({ project: { ...project, path: other } })
      __ensureRuntime(other).commitDirty = true
      return true
    })
    await act(async () => {
      await useWyrm.getState().saveEverywhere()
    })
    // Clearing it would make the other novel's Autosave and quit skip work
    // that has no save point yet.
    expect(__ensureRuntime(other).commitDirty).toBe(true)
  })
})

describe('a project in a background window', () => {
  it('has its drives re-read after a backup it made on its own', async () => {
    const first = await openDemo()
    await api.chooseBackupLocation(first)
    await useWyrm.getState().loadBackupSettings()
    const second = await api.createProject('Second Novel')
    await act(async () => {
      await useWyrm.getState().openAdditionalProject(second.path)
    })
    expect(useWyrm.getState().parked[first].backupSettings?.targets[0].lastBackupAt).toBeNull()
    // The background project's own checkpoint backs it up, in main; its slice
    // holds the settings from before.
    await api.backupNow(first)
    await act(async () => {
      await useWyrm.getState().checkLocations(first)
    })
    const parked = useWyrm.getState().parked[first]
    expect(parked.backupSettings?.targets[0].lastBackupAt).not.toBeNull()
    expect(parked.behind).toEqual([])
    // And the project in front is left alone.
    expect(useWyrm.getState().project?.path).toBe(second.path)
    expect(useWyrm.getState().backupSettings?.targets ?? []).toEqual([])
  })
})

describe('a background checkpoint', () => {
  it("re-reads that project's drives after its own backup", async () => {
    // Only the interval is faked: the five-minute checkpoint is what runs here.
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const first = await openDemo()
      await api.chooseBackupLocation(first)
      await api.setBackupAuto(first, true)
      await useWyrm.getState().loadBackupSettings()
      const second = await api.createProject('Second Novel')
      await act(async () => {
        await useWyrm.getState().openAdditionalProject(second.path)
      })
      // Work in the background project that has no save point yet.
      const [doc] = await api.readAllDocs(first)
      await api.writeDoc(first, { ...doc, body: `${doc.body}\nMore, in the background.` })
      __ensureRuntime(first).commitDirty = true
      expect(useWyrm.getState().parked[first].backupSettings?.targets[0].lastBackupAt).toBeNull()

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
      })
      await waitFor(() =>
        expect(
          useWyrm.getState().parked[first].backupSettings?.targets[0].lastBackupAt
        ).not.toBeNull()
      )
      expect(useWyrm.getState().parked[first].behind).toEqual([])
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('save points the main process makes on its own', () => {
  it('asks again after reading the stats, which commits first', async () => {
    const path = await openDemo()
    const check = vi
      .spyOn(api, 'checkSaveLocations')
      .mockResolvedValue({ unreachable: [], behind: ['github'] })
    check.mockClear()
    await act(async () => {
      await useWyrm.getState().refreshStats()
    })
    await waitFor(() => expect(check).toHaveBeenCalledWith(path))
    await waitFor(() => expect(useWyrm.getState().behind).toEqual(['github']))
  })
})

describe('restoring opens beside what is open', () => {
  it('keeps the open novel open when a backup is restored', async () => {
    const first = await openDemo()
    const restored = await api.createProject('Restored Copy')
    vi.spyOn(api, 'restoreFromBackup').mockResolvedValue(restored)
    await act(async () => {
      await useWyrm.getState().restoreFromBackup()
    })
    const state = useWyrm.getState()
    expect(state.project?.path).toBe(restored.path)
    expect(state.openPaths).toEqual([first, restored.path])
    expect(state.parked[first]).toBeTruthy()
  })

  it('keeps the open novel open when one is brought down from GitHub', async () => {
    const first = await openDemo()
    const cloned = await api.createProject('Cloned Copy')
    vi.spyOn(api, 'cloneProject').mockResolvedValue(cloned)
    await act(async () => {
      await useWyrm.getState().cloneFromGithub('https://github.com/someone/winter')
    })
    expect(useWyrm.getState().openPaths).toEqual([first, cloned.path])
  })
})

describe('why the last sync could not reach GitHub', () => {
  it('records an offline sync without calling it a conflict', async () => {
    await openDemo()
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'offline', detail: 'No connection.' })
    await act(async () => {
      await useWyrm.getState().syncNow(false)
    })
    expect(useWyrm.getState().syncProblem).toBe('GitHub unreachable')
    expect(useWyrm.getState().syncNeedsAttention).toBe(false)
  })

  it('keeps the detail of an error, and clears it once a sync gets through', async () => {
    await openDemo()
    const sync = vi
      .spyOn(api, 'syncNow')
      .mockResolvedValueOnce({ status: 'error', detail: 'GitHub refused the sign-in.' })
      .mockResolvedValueOnce({ status: 'pushed', at: Date.now() })
    await act(async () => {
      await useWyrm.getState().syncNow(false)
    })
    expect(useWyrm.getState().syncProblem).toBe('GitHub refused the sign-in.')
    await act(async () => {
      await useWyrm.getState().syncNow(false)
    })
    expect(sync).toHaveBeenCalledTimes(2)
    expect(useWyrm.getState().syncProblem).toBeNull()
  })

  it('does not call conflicts a connection problem', async () => {
    await openDemo()
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: [] })
    await act(async () => {
      await useWyrm.getState().syncNow(false)
    })
    expect(useWyrm.getState().syncProblem).toBeNull()
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })

  it('records a sync that threw', async () => {
    await openDemo()
    vi.spyOn(api, 'syncNow').mockRejectedValue(new Error('Something broke.'))
    await act(async () => {
      await useWyrm
        .getState()
        .syncNow(false)
        .catch(() => {})
    })
    expect(useWyrm.getState().syncProblem).toBe('Something broke.')
  })

  it('is forgotten when the project stops saving to GitHub', async () => {
    await openDemo()
    useWyrm.setState({ syncProblem: 'GitHub unreachable' })
    vi.spyOn(api, 'disconnectSync').mockResolvedValue({ ...SYNCED, mode: 'local-only' })
    await act(async () => {
      await useWyrm.getState().disconnectSync()
    })
    expect(useWyrm.getState().syncProblem).toBeNull()
  })
})
