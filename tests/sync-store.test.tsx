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

/** The versions a list of conflicts was made from (F-51). */
const HEADS = { local: 'l0cal', remote: 'rem0te' }

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
    conflictHeads: null,
    syncNeedsAttention: false,
    parked: {},
    openPaths: [],
    stale: false
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
    vi.spyOn(api, 'syncNow').mockResolvedValue({
      status: 'conflicts',
      conflicts: [CONFLICT],
      heads: HEADS
    })

    await useWyrm.getState().syncNow(false)

    expect(useWyrm.getState().syncConflicts).toBeNull()
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })

  it('a sync the writer asked for opens the resolution screen', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({
      status: 'conflicts',
      conflicts: [CONFLICT],
      heads: HEADS
    })

    await useWyrm.getState().syncNow(true)

    expect(useWyrm.getState().syncConflicts).toEqual([CONFLICT])
    expect(useWyrm.getState().syncNeedsAttention).toBe(false)
  })

  it('deciding later keeps the door open without touching anything', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({
      status: 'conflicts',
      conflicts: [CONFLICT],
      heads: HEADS
    })
    await useWyrm.getState().syncNow(true)

    useWyrm.getState().dismissConflicts()

    expect(useWyrm.getState().syncConflicts).toBeNull()
    expect(useWyrm.getState().syncNeedsAttention).toBe(true)
  })

  it('resolving clears the conflict state and reloads the project', async () => {
    await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValue({
      status: 'conflicts',
      conflicts: [CONFLICT],
      heads: HEADS
    })
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

describe('while the resolution screen is up (F-51)', () => {
  async function screenUp(): Promise<string> {
    const path = await openConnected()
    vi.spyOn(api, 'syncNow').mockResolvedValueOnce({
      status: 'conflicts',
      conflicts: [CONFLICT],
      heads: HEADS
    })
    await useWyrm.getState().syncNow(true)
    expect(useWyrm.getState().syncConflicts).toEqual([CONFLICT])
    expect(useWyrm.getState().conflictHeads).toEqual(HEADS)
    return path
  }

  it('never fetches: a sync, asked for or automatic, answers with the list already on screen', async () => {
    const path = await screenUp()
    const network = vi.spyOn(api, 'syncNow')
    network.mockClear()
    expect(await useWyrm.getState().syncNow(true)).toEqual({
      status: 'conflicts',
      conflicts: [CONFLICT],
      heads: HEADS
    })
    await dirty(path)
    await useWyrm.getState().commitNow('A checkpoint while arranging')
    await new Promise((r) => setTimeout(r, 20))
    expect(network).not.toHaveBeenCalled()
    // And nothing about it moved the screen or raised the quiet flag.
    expect(useWyrm.getState().syncConflicts).toEqual([CONFLICT])
    expect(useWyrm.getState().syncNeedsAttention).toBe(false)
  })

  it('answers against the versions the list came from, with the scraps to keep', async () => {
    const path = await screenUp()
    const resolve = vi
      .spyOn(api, 'resolveSyncConflicts')
      .mockResolvedValue({ status: 'merged', at: Date.now(), pushed: true })
    const scrap = {
      id: 'k1',
      body: 'Kept.\n',
      created: 'c',
      modified: 'm',
      how: 'incoming' as const
    }
    await useWyrm
      .getState()
      .resolveConflicts([{ path: CONFLICT.path, resolution: 'arranged', body: 'Mine.\n' }], [scrap])
    expect(resolve).toHaveBeenCalledWith(path, {
      choices: [{ path: CONFLICT.path, resolution: 'arranged', body: 'Mine.\n' }],
      pinned: HEADS,
      scraps: [scrap]
    })
    expect(useWyrm.getState().syncConflicts).toBeNull()
    expect(useWyrm.getState().conflictHeads).toBeNull()
  })

  it('puts the fresh list on screen when the versions moved under the answer', async () => {
    await screenUp()
    const fresh = { ...CONFLICT, localBody: 'typed since' }
    const moved = { local: 'newer', remote: 'rem0te' }
    vi.spyOn(api, 'resolveSyncConflicts').mockResolvedValue({
      status: 'conflicts',
      conflicts: [fresh],
      heads: moved,
      moved: true
    })
    const outcome = await useWyrm
      .getState()
      .resolveConflicts([{ path: CONFLICT.path, resolution: 'mine' }])
    expect(outcome).toMatchObject({ status: 'conflicts', moved: true })
    expect(useWyrm.getState().syncConflicts).toEqual([fresh])
    expect(useWyrm.getState().conflictHeads).toEqual(moved)
  })

  it('keeps the screen up when the answer fails, so nothing the writer arranged is dropped', async () => {
    await screenUp()
    vi.spyOn(api, 'resolveSyncConflicts').mockResolvedValue({
      status: 'error',
      detail: 'disk full'
    })
    await useWyrm.getState().resolveConflicts([{ path: CONFLICT.path, resolution: 'mine' }])
    expect(useWyrm.getState().syncConflicts).toEqual([CONFLICT])
    expect(useWyrm.getState().conflictHeads).toEqual(HEADS)
  })

  it('records the answer on the novel that gave it, when another came forward meanwhile', async () => {
    const path = await screenUp()
    useWyrm.setState({ openPaths: [path] })
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    vi.spyOn(api, 'resolveSyncConflicts').mockImplementation(async () => {
      await held
      return { status: 'merged', at: Date.now(), pushed: true }
    })
    const answering = useWyrm
      .getState()
      .resolveConflicts([{ path: CONFLICT.path, resolution: 'mine' }])
    await new Promise((r) => setTimeout(r, 0))
    await useWyrm.getState().openAnotherProject()
    const other = useWyrm.getState().project!.path
    expect(other).not.toBe(path)
    useWyrm.setState({ syncConflicts: [CONFLICT], conflictHeads: { local: 'x', remote: 'y' } })
    release()
    await answering
    // The novel in front keeps its own screen; the one that answered is done,
    // and re-read when it comes back.
    expect(useWyrm.getState().syncConflicts).toEqual([CONFLICT])
    const answered = useWyrm.getState().parked[path]
    expect(answered.syncConflicts).toBeNull()
    expect(answered.conflictHeads).toBeNull()
    expect(answered.stale).toBe(true)
  })

  it('syncs again once the screen is answered or set aside', async () => {
    await screenUp()
    useWyrm.getState().dismissConflicts()
    expect(useWyrm.getState().conflictHeads).toBeNull()
    const network = vi
      .spyOn(api, 'syncNow')
      .mockResolvedValue({ status: 'up-to-date', at: Date.now() })
    await useWyrm.getState().syncNow(true)
    expect(network).toHaveBeenCalled()
  })
})
