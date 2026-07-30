// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SyncConflict } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * The renderer-side promises of the sync layer: a checkpoint is never blocked
 * by sync, and the page is sacred — background conflicts must not put a
 * dialog on screen, only a person asking for a sync may.
 */

const CONFLICT: SyncConflict = {
  path: 'documents/abc.md',
  kind: 'doc',
  title: 'First Scene',
  localBody: 'mine',
  remoteBody: 'theirs'
}

async function openConnected(): Promise<string> {
  const path = (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(path))!
  useWyrm.setState({ project: info, booted: true, saveState: 'saved' })
  await api.setSyncClientId('client-x')
  await useWyrm.getState().connectSync({ create: true, name: 'novel' })
  return path
}

async function dirty(path: string): Promise<void> {
  const docs = await api.readAllDocs(path)
  await api.writeDoc(path, { ...docs[0], body: `${docs[0].body}\nLine ${Math.random()}.` })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  useWyrm.setState({
    project: null,
    booted: false,
    syncStatus: null,
    syncConflicts: null,
    syncNeedsAttention: false
  })
})

describe('sync in the store', () => {
  it('syncs quietly after a checkpoint once connected', async () => {
    const path = await openConnected()
    const syncNow = vi.spyOn(api, 'syncNow')

    await dirty(path)
    await useWyrm.getState().commitNow('A checkpoint')

    await vi.waitFor(() => expect(syncNow).toHaveBeenCalledWith(path))
  })

  it('a failing sync never breaks the checkpoint', async () => {
    const path = await openConnected()
    vi.spyOn(api, 'syncNow').mockRejectedValue(new Error('GitHub is unreachable'))

    await dirty(path)
    await expect(useWyrm.getState().commitNow('Still saves')).resolves.toBeUndefined()
    expect(useWyrm.getState().lastCommitAt).toBeGreaterThan(0)
  })

  it('background conflicts raise the quiet flag and never open the dialog', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: [CONFLICT] })

    await useWyrm.getState().syncNow(false)

    expect(useWyrm.getState().syncConflicts).toBeNull()
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })

  it('a sync the writer asked for opens the resolution screen', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: [CONFLICT] })

    await useWyrm.getState().syncNow(true)

    expect(useWyrm.getState().syncConflicts).toEqual([CONFLICT])
    expect(useWyrm.getState().syncNeedsAttention).toBe(false)
  })

  it('deciding later keeps the door open without touching anything', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: [CONFLICT] })
    await useWyrm.getState().syncNow(true)

    useWyrm.getState().dismissConflicts()

    expect(useWyrm.getState().syncConflicts).toBeNull()
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })

  it('resolving clears the conflict state and reloads the project', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'conflicts', conflicts: [CONFLICT] })
    await useWyrm.getState().syncNow(true)
    const reload = vi.spyOn(api, 'openProjectPath')

    const outcome = await useWyrm
      .getState()
      .resolveConflicts([{ path: CONFLICT.path, resolution: 'mine' }])

    expect(outcome.status).toBe('merged')
    expect(useWyrm.getState().syncConflicts).toBeNull()
    expect(reload).toHaveBeenCalled()
  })

  it('retries quietly when the network comes back with work waiting', async () => {
    await openConnected()
    useWyrm.setState({
      syncStatus: { ...useWyrm.getState().syncStatus!, pendingSync: true }
    })
    const syncNow = vi.spyOn(api, 'syncNow')

    window.dispatchEvent(new Event('online'))

    await vi.waitFor(() => expect(syncNow).toHaveBeenCalled())
  })
})
