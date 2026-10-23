// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/renderer/src/lib/api'
import { SLICE_KEYS, useWyrm, __runtimeFor } from '../src/renderer/src/store'
import type { MapMark } from '../src/shared/types'

/**
 * F-12 part 4: map marks in the store, against the demo project through the
 * in-memory mock. `updateMapMarkAt` is path-addressed like
 * `updateMapShapeAt`: an edit written after a focus change must land in the
 * project it was made in, never the one in front.
 */

const OTHER = '/novels/Other Project.wyrm'

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(demoPath))!
  useWyrm.setState({ project: info, booted: true, mapMarks: [], parked: {} })
  return demoPath
}

function mark(overrides: Partial<MapMark> = {}): MapMark {
  const now = new Date().toISOString()
  return { id: 'm1', kind: 'forest', x: 5, y: 6, created: now, modified: now, ...overrides }
}

/** A parked project OTHER holding `parkedMark`, with `front` in front. */
function parkWith(parkedMark: MapMark, front: MapMark[]): void {
  useWyrm.setState({
    mapMarks: front,
    parked: { [OTHER]: { ...useWyrm.getState(), mapMarks: [parkedMark] } as never }
  })
}

const T0 = new Date('2030-01-01T00:00:00.000Z')

function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: Error) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/**
 * Mid-await, the writer focuses another window: PATH's slice is parked and a
 * different project (`frontPath`, holding `front` — often a clone with the
 * same ids) takes the flat fields.
 */
function park(path: string, parkedMarks: MapMark[], frontPath: string, front: MapMark[]): void {
  const state = useWyrm.getState()
  useWyrm.setState({
    parked: { [path]: { ...state, mapMarks: parkedMarks } as never },
    project: { ...state.project!, path: frontPath },
    mapMarks: front
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
  // Only the clock: the mock api's promises must keep running.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(T0)
})

afterEach(async () => {
  vi.useRealTimers()
  if (demoPath) {
    for (const m of await api.listMapMarks(demoPath)) await api.deleteMapMark(demoPath, m.id)
  }
  useWyrm.setState({ mapMarks: [], parked: {} })
})

describe('map marks in the store', () => {
  it('is part of the project slice', () => {
    expect(SLICE_KEYS).toContain('mapMarks')
  })

  it('creates a stamp: rounded, appended, written, dirty, no name key', async () => {
    const path = await openDemo()
    const runtime = __runtimeFor(path)
    if (runtime) runtime.commitDirty = false
    const m = await useWyrm.getState().createMapMark('mountain', 10.4, -2.5)
    expect(m).not.toBeNull()
    expect(m!.kind).toBe('mountain')
    expect([m!.x, m!.y]).toEqual([10, -2])
    expect('name' in m!).toBe(false)
    expect(useWyrm.getState().mapMarks).toEqual([m])
    expect(await api.listMapMarks(path)).toEqual([m])
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    const second = await useWyrm.getState().createMapMark('town', 1, 1)
    expect(useWyrm.getState().mapMarks.map((x) => x.id)).toEqual([m!.id, second!.id])
    expect(second!.id).not.toBe(m!.id)
  })

  it('creates a mark with a size, and omits the key at size 1 or an invalid size', async () => {
    const path = await openDemo()
    const big = await useWyrm.getState().createMapMark('mountain', 1, 1, undefined, 2.2)
    expect(big!.size).toBe(2.2)
    expect((await api.listMapMarks(path)).find((m) => m.id === big!.id)!.size).toBe(2.2)
    const viaAt = await useWyrm.getState().createMapMarkAt(path, 'hills', 1, 1, 'Hi', 0.6)
    expect(viaAt).toMatchObject({ name: 'Hi', size: 0.6 })
    for (const size of [1, 3, 0, -1, NaN]) {
      const m = await useWyrm.getState().createMapMark('town', 1, 1, undefined, size)
      expect('size' in m!).toBe(false)
    }
  })

  it('updates a size, and size 1 deletes the key rather than assigning it', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('town', 5, 6))!
    await useWyrm.getState().updateMapMarkAt(path, m.id, { size: 1.5 })
    expect(useWyrm.getState().mapMarks[0].size).toBe(1.5)
    expect((await api.listMapMarks(path))[0].size).toBe(1.5)
    const write = vi.spyOn(api, 'writeMapMark')
    await useWyrm.getState().updateMapMarkAt(path, m.id, { size: 1 })
    expect(write).toHaveBeenCalledTimes(1)
    expect('size' in write.mock.calls[0][1]).toBe(false)
    expect('size' in useWyrm.getState().mapMarks[0]).toBe(false)
    expect('size' in (await api.listMapMarks(path))[0]).toBe(false)
  })

  it('ignores an invalid size, writing nothing', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('town', 5, 6, undefined, 0.6))!
    const write = vi.spyOn(api, 'writeMapMark')
    for (const size of [0, 3, -1, NaN]) {
      await useWyrm.getState().updateMapMarkAt(path, m.id, { size })
    }
    // Same size again, and size 1 on a mark already at 1, are no changes either.
    await useWyrm.getState().updateMapMarkAt(path, m.id, { size: 0.6 })
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapMarks[0].size).toBe(0.6)
    // An invalid size beside a real move still moves, leaving the size alone.
    await useWyrm.getState().updateMapMarkAt(path, m.id, { x: 9, size: 3 })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][1]).toMatchObject({ x: 9, size: 0.6 })
  })

  it('keeps a stamp’s trimmed name, and drops a blank one', async () => {
    await openDemo()
    const named = await useWyrm.getState().createMapMark('town', 1, 1, '  Ashford ')
    expect(named!.name).toBe('Ashford')
    const blank = await useWyrm.getState().createMapMark('hills', 1, 1, '   ')
    expect('name' in blank!).toBe(false)
  })

  it('creates a label with its trimmed name', async () => {
    const path = await openDemo()
    const m = await useWyrm.getState().createMapMark('label', 3, 4, ' The Sea ')
    expect(m!.kind).toBe('label')
    expect(m!.name).toBe('The Sea')
    expect((await api.listMapMarks(path))[0].name).toBe('The Sea')
  })

  it('refuses a label with an empty or blank name, writing nothing', async () => {
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeMapMark')
    expect(await useWyrm.getState().createMapMark('label', 1, 1)).toBeNull()
    expect(await useWyrm.getState().createMapMark('label', 1, 1, '')).toBeNull()
    expect(await useWyrm.getState().createMapMark('label', 1, 1, '   ')).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapMarks).toEqual([])
    expect(await api.listMapMarks(path)).toEqual([])
  })

  it('refuses with no project open', async () => {
    useWyrm.setState({ project: null })
    expect(await useWyrm.getState().createMapMark('forest', 1, 1)).toBeNull()
  })

  it('loads the focused project’s marks', async () => {
    const path = await openDemo()
    await api.writeMapMark(path, mark({ id: 'l1' }))
    await useWyrm.getState().loadMapMarks()
    expect(useWyrm.getState().mapMarks.map((m) => m.id)).toEqual(['l1'])
  })

  it('moves a mark in the focused project: rounded, written, modified, dirty', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    __runtimeFor(path)!.commitDirty = false
    const later = new Date('2030-01-01T00:05:00.000Z')
    vi.setSystemTime(later)
    await useWyrm.getState().updateMapMarkAt(path, m.id, { x: 20.6, y: -4.4 })
    const got = useWyrm.getState().mapMarks[0]
    expect([got.x, got.y]).toEqual([21, -4])
    expect(m.modified).toBe(T0.toISOString())
    expect(got.modified).toBe(later.toISOString())
    expect(got.created).toBe(T0.toISOString())
    expect(got.modified).toBe((await api.listMapMarks(path))[0].modified)
    expect((await api.listMapMarks(path))[0].x).toBe(21)
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
  })

  it('updates only the fields given', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('town', 5, 6, 'Ashford'))!
    await useWyrm.getState().updateMapMarkAt(path, m.id, { x: 9 })
    expect(useWyrm.getState().mapMarks[0]).toMatchObject({ x: 9, y: 6, name: 'Ashford' })
    await useWyrm.getState().updateMapMarkAt(path, m.id, { y: 0 })
    expect(useWyrm.getState().mapMarks[0]).toMatchObject({ x: 9, y: 0, name: 'Ashford' })
  })

  it('renames with a trimmed name', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('town', 5, 6))!
    await useWyrm.getState().updateMapMarkAt(path, m.id, { name: '  Ashford ' })
    expect(useWyrm.getState().mapMarks[0].name).toBe('Ashford')
    expect((await api.listMapMarks(path))[0].name).toBe('Ashford')
  })

  it('an empty name deletes a stamp’s key rather than assigning it', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('town', 5, 6, 'Ashford'))!
    const write = vi.spyOn(api, 'writeMapMark')
    await useWyrm.getState().updateMapMarkAt(path, m.id, { name: '   ' })
    expect(write).toHaveBeenCalledTimes(1)
    expect('name' in write.mock.calls[0][1]).toBe(false)
    expect('name' in useWyrm.getState().mapMarks[0]).toBe(false)
    expect('name' in (await api.listMapMarks(path))[0]).toBe(false)
  })

  it('refuses to blank a label, writing nothing', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('label', 5, 6, 'The Sea'))!
    const write = vi.spyOn(api, 'writeMapMark')
    await useWyrm.getState().updateMapMarkAt(path, m.id, { name: '' })
    await useWyrm.getState().updateMapMarkAt(path, m.id, { name: '  ' })
    // Even alongside a real move: the whole patch is refused.
    await useWyrm.getState().updateMapMarkAt(path, m.id, { x: 99, name: '' })
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapMarks).toEqual([m])
    expect(await api.listMapMarks(path)).toEqual([m])
  })

  it('writes nothing when nothing changed', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('town', 5, 6, 'Ashford'))!
    const stamp = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    __runtimeFor(path)!.commitDirty = false
    const write = vi.spyOn(api, 'writeMapMark')
    await useWyrm.getState().updateMapMarkAt(path, m.id, {})
    await useWyrm.getState().updateMapMarkAt(path, m.id, { x: 5, y: 6, name: 'Ashford' })
    await useWyrm.getState().updateMapMarkAt(path, m.id, { x: 5.4, name: ' Ashford ' })
    await useWyrm.getState().updateMapMarkAt(path, stamp.id, { name: '' })
    expect(write).not.toHaveBeenCalled()
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
  })

  it('does nothing for a missing mark or a project that is not open', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    __runtimeFor(path)!.commitDirty = false
    const write = vi.spyOn(api, 'writeMapMark')
    await useWyrm.getState().updateMapMarkAt(path, 'gone', { x: 5 })
    await useWyrm.getState().updateMapMarkAt('/not/open', m.id, { x: 5 })
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapMarks).toEqual([m])
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
  })

  it('updates a mark in a parked project, leaving the one in front alone', async () => {
    await openDemo()
    const parked = mark({ id: 'p1', kind: 'town', name: 'Far' })
    // Same id, but different in every field the write copies from the found mark.
    const front = mark({ id: 'p1', kind: 'hills', x: 100, y: 200, created: 'x', name: 'Near' })
    const write = vi.spyOn(api, 'writeMapMark').mockResolvedValue()
    parkWith(parked, [front])
    __runtimeFor(OTHER)
    await useWyrm.getState().updateMapMarkAt(OTHER, 'p1', { x: 50 })
    expect(write).toHaveBeenCalledTimes(1)
    const [writtenPath, written] = write.mock.calls[0]
    expect(writtenPath).toBe(OTHER)
    expect(written).toMatchObject({
      id: 'p1',
      kind: 'town',
      x: 50,
      y: 6,
      name: 'Far',
      created: parked.created
    })
    expect(useWyrm.getState().parked[OTHER].mapMarks).toEqual([written])
    expect(useWyrm.getState().mapMarks).toEqual([front])
    expect(__runtimeFor(OTHER)?.commitDirty).toBe(true)
  })

  it('finds a parked mark when the front project has none with that id', async () => {
    const path = await openDemo()
    __runtimeFor(path)!.commitDirty = false
    const parked = mark({ id: 'p2' })
    const write = vi.spyOn(api, 'writeMapMark').mockResolvedValue()
    parkWith(parked, [])
    await useWyrm.getState().updateMapMarkAt(OTHER, 'p2', { name: 'Elmwood' })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(OTHER)
    expect(useWyrm.getState().parked[OTHER].mapMarks[0].name).toBe('Elmwood')
    expect(useWyrm.getState().mapMarks).toEqual([])
    // The front project was not marked dirty by the parked write.
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
  })

  it('refuses to blank a parked label too', async () => {
    await openDemo()
    const parked = mark({ id: 'p3', kind: 'label', name: 'Sea' })
    const write = vi.spyOn(api, 'writeMapMark').mockResolvedValue()
    parkWith(parked, [])
    await useWyrm.getState().updateMapMarkAt(OTHER, 'p3', { name: '' })
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().parked[OTHER].mapMarks).toEqual([parked])
  })

  it('deletes a mark', async () => {
    const path = await openDemo()
    const a = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    const b = (await useWyrm.getState().createMapMark('hills', 2, 2))!
    __runtimeFor(path)!.commitDirty = false
    await useWyrm.getState().deleteMapMark(a)
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    expect(useWyrm.getState().mapMarks).toEqual([b])
    expect((await api.listMapMarks(path)).map((m) => m.id)).toEqual([b.id])
  })

  it('creates a mark in a parked project, leaving the one in front alone', async () => {
    const path = await openDemo()
    __runtimeFor(path)!.commitDirty = false
    __runtimeFor(OTHER).commitDirty = false
    const write = vi.spyOn(api, 'writeMapMark').mockResolvedValue()
    parkWith(mark({ id: 'p1' }), [])
    const m = await useWyrm.getState().createMapMarkAt(OTHER, 'town', 3.4, 4.6, ' Far ')
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(OTHER)
    expect(m).toMatchObject({ kind: 'town', x: 3, y: 5, name: 'Far' })
    expect(useWyrm.getState().parked[OTHER].mapMarks.map((x) => x.id)).toEqual(['p1', m!.id])
    expect(useWyrm.getState().mapMarks).toEqual([])
    expect(__runtimeFor(OTHER).commitDirty).toBe(true)
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
  })

  it('createMapMarkAt refuses a path that is not open, and a nameless label', async () => {
    await openDemo()
    const write = vi.spyOn(api, 'writeMapMark').mockResolvedValue()
    expect(await useWyrm.getState().createMapMarkAt('/not/open', 'forest', 1, 1)).toBeNull()
    expect(await useWyrm.getState().createMapMarkAt(demoPath!, 'label', 1, 1, '  ')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('deletes a mark from a parked project, leaving the one in front alone', async () => {
    // Not reachable from the UI today (delete acts on the focused project),
    // but the write is path-addressed, so its bookkeeping must be too.
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    __runtimeFor(path)!.commitDirty = false
    const gate = deferred<void>()
    vi.spyOn(api, 'deleteMapMark').mockImplementation(() => gate.promise)
    const pending = useWyrm.getState().deleteMapMark(m)
    park(path, [m], 'clone-front', [{ ...m, x: 77 }])
    gate.resolve()
    await pending
    expect(useWyrm.getState().parked[path].mapMarks).toEqual([])
    expect(useWyrm.getState().mapMarks.map((x) => x.x)).toEqual([77])
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    expect(__runtimeFor('clone-front')?.commitDirty ?? false).toBe(false)
  })

  it('an update that lands after a focus change goes to the parked slice', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    __runtimeFor(path)!.commitDirty = false
    const gate = deferred<void>()
    vi.spyOn(api, 'writeMapMark').mockImplementation(() => gate.promise)
    const pending = useWyrm.getState().updateMapMarkAt(path, m.id, { x: 50 })
    park(path, [m], 'clone-front', [{ ...m }])
    gate.resolve()
    await pending
    expect(useWyrm.getState().parked[path].mapMarks[0].x).toBe(50)
    expect(useWyrm.getState().mapMarks[0].x).toBe(1)
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    expect(__runtimeFor('clone-front')?.commitDirty ?? false).toBe(false)
  })

  it('a create that lands after a focus change goes to the parked slice', async () => {
    const path = await openDemo()
    __runtimeFor(path)!.commitDirty = false
    const gate = deferred<void>()
    vi.spyOn(api, 'writeMapMark').mockImplementation(() => gate.promise)
    const pending = useWyrm.getState().createMapMark('forest', 1, 1)
    park(path, [], 'clone-front', [])
    gate.resolve()
    const m = await pending
    expect(useWyrm.getState().parked[path].mapMarks).toEqual([m])
    expect(useWyrm.getState().mapMarks).toEqual([])
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    expect(__runtimeFor('clone-front')?.commitDirty ?? false).toBe(false)
  })

  it('re-reads the marks after a sync pulls other-device work', async () => {
    const path = await openDemo()
    expect(useWyrm.getState().mapMarks).toEqual([])
    await api.writeMapMark(path, mark({ id: 'remote', name: 'Arrived' }))
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'pulled', at: 1, pushed: false })
    await useWyrm.getState().syncNow(false)
    expect(useWyrm.getState().mapMarks.map((x) => x.id)).toEqual(['remote'])
  })

  it('keeps the marks it had when the re-read fails', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    const list = vi.spyOn(api, 'listMapMarks').mockRejectedValue(new Error('disk'))
    vi.spyOn(api, 'syncNow').mockResolvedValue({ status: 'merged', at: 1, pushed: true })
    await useWyrm.getState().syncNow(false)
    list.mockRestore()
    expect(useWyrm.getState().mapMarks).toEqual([m])
    expect(path).toBe(useWyrm.getState().project!.path)
  })

  it('clones records into the mock, so a caller cannot mutate stored state', async () => {
    const path = await openDemo()
    const m = (await useWyrm.getState().createMapMark('forest', 1, 1))!
    const [listed] = await api.listMapMarks(path)
    listed.x = 999
    expect((await api.listMapMarks(path))[0].x).toBe(1)
    expect(m.x).toBe(1)
  })
})

describe('concurrent updates to one mark', () => {
  /** Every write waits on its own gate, so a test decides when each lands. */
  function gated(): {
    writes: MapMark[]
    gates: ReturnType<typeof deferred<void>>[]
  } {
    const writes: MapMark[] = []
    const gates: ReturnType<typeof deferred<void>>[] = []
    vi.spyOn(api, 'writeMapMark').mockImplementation((_path, m) => {
      writes.push({ ...m })
      const gate = deferred<void>()
      gates.push(gate)
      return gate.promise
    })
    return { writes, gates }
  }

  async function seed(over: Partial<MapMark> = {}): Promise<string> {
    const path = await openDemo()
    useWyrm.setState({ mapMarks: [mark({ id: 'a', kind: 'town', ...over })] })
    return path
  }

  const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))

  it.each([['in order'], ['reversed']])(
    'a rename then a size click keeps both (%s)',
    async (order) => {
      const path = await seed()
      const { writes, gates } = gated()
      const { updateMapMarkAt } = useWyrm.getState()
      const a = updateMapMarkAt(path, 'a', { name: 'Ironhold' })
      const b = updateMapMarkAt(path, 'a', { size: 2.2 })
      await settle()
      expect(writes).toHaveLength(1) // the second waits for the first
      if (order === 'in order') {
        gates[0].resolve()
        await vi.waitFor(() => expect(writes).toHaveLength(2))
        gates[1].resolve()
      } else {
        // Landing out of order is impossible once serialized: resolving the
        // second gate early changes nothing.
        gates[0].resolve()
        await vi.waitFor(() => expect(gates).toHaveLength(2))
        gates[1].resolve()
      }
      await Promise.all([a, b])
      expect(writes[writes.length - 1]).toMatchObject({ name: 'Ironhold', size: 2.2 })
      expect(useWyrm.getState().mapMarks[0]).toMatchObject({ name: 'Ironhold', size: 2.2 })
    }
  )

  it('a move then a size keeps both', async () => {
    const path = await seed()
    const { writes, gates } = gated()
    const { updateMapMarkAt } = useWyrm.getState()
    const a = updateMapMarkAt(path, 'a', { x: 40.4, y: 50.6 })
    const b = updateMapMarkAt(path, 'a', { size: 1.5 })
    await settle()
    gates[0].resolve()
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1].resolve()
    await Promise.all([a, b])
    expect(writes[writes.length - 1]).toMatchObject({ x: 40, y: 51, size: 1.5 })
    expect(useWyrm.getState().mapMarks[0]).toMatchObject({ x: 40, y: 51, size: 1.5 })
  })

  it('a failed write does not block the next update for that mark', async () => {
    const path = await seed()
    const { writes, gates } = gated()
    const { updateMapMarkAt } = useWyrm.getState()
    const a = updateMapMarkAt(path, 'a', { name: 'Doomed' })
    const aOutcome = a.then(
      () => 'ok',
      () => 'failed'
    )
    const b = updateMapMarkAt(path, 'a', { size: 2.2 })
    await settle()
    gates[0].reject(new Error('disk'))
    await vi.waitFor(() => expect(gates).toHaveLength(2))
    gates[1].resolve()
    await b
    expect(await aOutcome).toBe('failed')
    // The failed rename never reached the store, so the size write is the
    // whole truth and carries no name.
    expect(writes[1]).toMatchObject({ size: 2.2 })
    expect(writes[1].name).toBeUndefined()
    expect(useWyrm.getState().mapMarks[0].size).toBe(2.2)
  })

  it('updates to different marks are not serialized against each other', async () => {
    const path = await openDemo()
    useWyrm.setState({ mapMarks: [mark({ id: 'a' }), mark({ id: 'b' })] })
    const { writes } = gated()
    const { updateMapMarkAt } = useWyrm.getState()
    void updateMapMarkAt(path, 'a', { size: 2.2 })
    void updateMapMarkAt(path, 'b', { size: 1.5 })
    await settle()
    expect(writes.map((w) => w.id).sort()).toEqual(['a', 'b'])
  })
})
