// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/renderer/src/lib/api'
import { SLICE_KEYS, useWyrm, __runtimeFor } from '../src/renderer/src/store'
import type { MapShape } from '../src/shared/types'

/**
 * F-12: drawn map shapes in the store, against the demo project through the
 * in-memory mock. `updateMapShapeAt` is path-addressed like `moveMapPinAt`:
 * an edit written after a focus change must land in the project it was made
 * in, never the one in front.
 */

const OTHER = '/novels/Other Project.wyrm'

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(demoPath))!
  useWyrm.setState({ project: info, booted: true, mapShapes: [], parked: {} })
  return demoPath
}

const tri = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 5, y: 8 }
]

beforeEach(() => {
  vi.restoreAllMocks()
  // One clock for the store and the mock: the mock stamps \`modified\` when it
  // saves, and a millisecond ticking between the two made comparisons of the
  // stored shape fail now and then.
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
})

afterEach(async () => {
  vi.useRealTimers()
  // Leave the mock's demo project as we found it.
  if (demoPath) {
    for (const s of await api.listMapShapes(demoPath)) await api.deleteMapShape(demoPath, s.id)
  }
  useWyrm.setState({ mapShapes: [], parked: {} })
})

describe('map shapes in the store', () => {
  it('is part of the project slice', () => {
    expect(SLICE_KEYS).toContain('mapShapes')
  })

  it('creates a shape: rounded, appended, written, dirty', async () => {
    const path = await openDemo()
    const runtime = __runtimeFor(path)
    if (runtime) runtime.commitDirty = false
    const shape = await useWyrm.getState().createMapShape('land', [
      { x: 0.4, y: 0.6 },
      { x: 10.5, y: -2.5 },
      { x: 5, y: 8.49 }
    ])
    expect(shape).not.toBeNull()
    expect(shape!.kind).toBe('land')
    expect(shape!.points).toEqual([
      { x: 0, y: 1 },
      { x: 11, y: -2 },
      { x: 5, y: 8 }
    ])
    expect(useWyrm.getState().mapShapes).toEqual([shape])
    const stored = await api.listMapShapes(path)
    expect(stored.map((s) => s.id)).toEqual([shape!.id])
    expect(stored[0].points).toEqual(shape!.points)
    expect(__runtimeFor(path)?.commitDirty).toBe(true)

    const second = await useWyrm.getState().createMapShape('border', [
      { x: 1, y: 1 },
      { x: 2, y: 2 }
    ])
    expect(useWyrm.getState().mapShapes.map((s) => s.id)).toEqual([shape!.id, second!.id])
  })

  it('refuses too few points for the kind, writing nothing', async () => {
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeMapShape')
    const two = tri.slice(0, 2)
    expect(await useWyrm.getState().createMapShape('land', two)).toBeNull()
    expect(await useWyrm.getState().createMapShape('area', two)).toBeNull()
    expect(await useWyrm.getState().createMapShape('border', tri.slice(0, 1))).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapShapes).toEqual([])
    expect(await api.listMapShapes(path)).toEqual([])
  })

  it('refuses with no project open', async () => {
    useWyrm.setState({ project: null })
    expect(await useWyrm.getState().createMapShape('land', tri)).toBeNull()
  })

  it('loads the focused project’s shapes', async () => {
    const path = await openDemo()
    const now = new Date().toISOString()
    await api.writeMapShape(path, {
      id: 's1',
      kind: 'area',
      points: tri,
      created: now,
      modified: now
    })
    await useWyrm.getState().loadMapShapes()
    expect(useWyrm.getState().mapShapes.map((s) => s.id)).toEqual(['s1'])
  })

  it('updates a shape in the focused project', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('area', tri))!
    __runtimeFor(path)!.commitDirty = false
    await useWyrm.getState().updateMapShapeAt(path, shape.id, [
      { x: 1.2, y: 1 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20.7 }
    ])
    const expected = [
      { x: 1, y: 1 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 21 }
    ]
    expect(useWyrm.getState().mapShapes).toEqual([{ ...shape, points: expected }])
    expect((await api.listMapShapes(path))[0].points).toEqual(expected)
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
  })

  it('updates a shape in a parked project, leaving the one in front alone', async () => {
    await openDemo()
    const now = new Date().toISOString()
    const parkedShape: MapShape = {
      id: 'p1',
      kind: 'land',
      points: tri,
      created: now,
      modified: now
    }
    const write = vi.spyOn(api, 'writeMapShape').mockResolvedValue()
    // Same id, but different in every field the write copies from the found shape.
    const front: MapShape = {
      ...parkedShape,
      kind: 'border',
      created: 'x',
      points: tri.slice(0, 2)
    }
    useWyrm.setState({
      mapShapes: [front],
      parked: { [OTHER]: { ...useWyrm.getState(), mapShapes: [parkedShape] } as never }
    })
    const moved = tri.map((p) => ({ x: p.x + 100, y: p.y }))
    await useWyrm.getState().updateMapShapeAt(OTHER, 'p1', moved)
    expect(write).toHaveBeenCalledWith(OTHER, { ...parkedShape, points: moved })
    expect(useWyrm.getState().parked[OTHER].mapShapes).toEqual([{ ...parkedShape, points: moved }])
    // A clone shares ids: the front project's shape with the same id is untouched.
    expect(useWyrm.getState().mapShapes).toEqual([front])
    expect(__runtimeFor(OTHER)?.commitDirty).toBe(true)
  })

  it('finds a parked shape even when the front project has no shape with that id', async () => {
    await openDemo()
    const now = new Date().toISOString()
    const parkedShape: MapShape = {
      id: 'p2',
      kind: 'area',
      points: tri,
      created: now,
      modified: now
    }
    const write = vi.spyOn(api, 'writeMapShape').mockResolvedValue()
    useWyrm.setState({
      mapShapes: [],
      parked: { [OTHER]: { ...useWyrm.getState(), mapShapes: [parkedShape] } as never }
    })
    const moved = tri.map((p) => ({ x: p.x + 7, y: p.y }))
    await useWyrm.getState().updateMapShapeAt(OTHER, 'p2', moved)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(OTHER, {
      ...parkedShape,
      kind: 'area',
      created: now,
      points: moved
    })
    expect(useWyrm.getState().mapShapes).toEqual([])
  })

  it.each(['land', 'area'] as const)(
    'refuses a 2-point update of a %s shape, writing nothing',
    async (kind) => {
      const path = await openDemo()
      const shape = (await useWyrm.getState().createMapShape(kind, tri))!
      const write = vi.spyOn(api, 'writeMapShape')
      await useWyrm.getState().updateMapShapeAt(path, shape.id, tri.slice(0, 2))
      expect(write).not.toHaveBeenCalled()
      expect(useWyrm.getState().mapShapes).toEqual([shape])
      expect(await api.listMapShapes(path)).toEqual([shape])
    }
  )

  it('lets a border be updated to exactly 2 points', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('border', tri))!
    const write = vi.spyOn(api, 'writeMapShape')
    const two = [
      { x: 1, y: 1 },
      { x: 9, y: 9 }
    ]
    await useWyrm.getState().updateMapShapeAt(path, shape.id, two)
    expect(write).toHaveBeenCalledTimes(1)
    expect(useWyrm.getState().mapShapes[0].points).toEqual(two)
  })

  it('does nothing for a missing shape or too few points', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('border', tri.slice(0, 2)))!
    const write = vi.spyOn(api, 'writeMapShape')
    await useWyrm.getState().updateMapShapeAt(path, 'gone', tri)
    await useWyrm.getState().updateMapShapeAt(path, shape.id, tri.slice(0, 1))
    await useWyrm.getState().updateMapShapeAt('/not/open', shape.id, tri)
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapShapes).toEqual([shape])
  })

  it.each(['river', 'road', 'rail'] as const)(
    'creates a %s line from exactly 2 points',
    async (kind) => {
      const path = await openDemo()
      const write = vi.spyOn(api, 'writeMapShape')
      const two = tri.slice(0, 2)
      const shape = await useWyrm.getState().createMapShape(kind, two)
      expect(shape).not.toBeNull()
      expect(shape!.kind).toBe(kind)
      expect(shape!.points).toEqual(two)
      expect(write).toHaveBeenCalledTimes(1)
      expect((await api.listMapShapes(path))[0].points).toEqual(two)
    }
  )

  it.each(['river', 'road', 'rail'] as const)(
    'refuses a 1-point %s line, writing nothing',
    async (kind) => {
      const path = await openDemo()
      const write = vi.spyOn(api, 'writeMapShape')
      expect(await useWyrm.getState().createMapShape(kind, tri.slice(0, 1))).toBeNull()
      expect(write).not.toHaveBeenCalled()
      expect(useWyrm.getState().mapShapes).toEqual([])
      expect(await api.listMapShapes(path)).toEqual([])
    }
  )

  it.each(['river', 'road', 'rail'] as const)(
    'lets a %s line be updated to exactly 2 points, but not 1',
    async (kind) => {
      const path = await openDemo()
      const shape = (await useWyrm.getState().createMapShape(kind, tri))!
      const write = vi.spyOn(api, 'writeMapShape')
      await useWyrm.getState().updateMapShapeAt(path, shape.id, tri.slice(0, 1))
      expect(write).not.toHaveBeenCalled()
      expect(useWyrm.getState().mapShapes).toEqual([shape])
      const two = [
        { x: 1, y: 1 },
        { x: 9, y: 9 }
      ]
      await useWyrm.getState().updateMapShapeAt(path, shape.id, two)
      expect(write).toHaveBeenCalledTimes(1)
      expect(useWyrm.getState().mapShapes[0].points).toEqual(two)
      expect((await api.listMapShapes(path))[0].points).toEqual(two)
    }
  )

  it('deletes a shape', async () => {
    const path = await openDemo()
    const a = (await useWyrm.getState().createMapShape('land', tri))!
    const b = (await useWyrm.getState().createMapShape('area', tri))!
    __runtimeFor(path)!.commitDirty = false
    await useWyrm.getState().deleteMapShape(a)
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    expect(useWyrm.getState().mapShapes).toEqual([b])
    expect((await api.listMapShapes(path)).map((s) => s.id)).toEqual([b.id])
  })

  it('renames a shape in the focused project: trimmed, written, dirty', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('land', tri))!
    __runtimeFor(path)!.commitDirty = false
    await useWyrm.getState().renameMapShapeAt(path, shape.id, '  The Saltmarsh  ')
    expect(useWyrm.getState().mapShapes[0].name).toBe('The Saltmarsh')
    expect((await api.listMapShapes(path))[0].name).toBe('The Saltmarsh')
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
  })

  it('an empty or blank name deletes the key rather than assigning it', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('land', tri))!
    await useWyrm.getState().renameMapShapeAt(path, shape.id, 'Named')
    const write = vi.spyOn(api, 'writeMapShape')
    await useWyrm.getState().renameMapShapeAt(path, shape.id, '   ')
    expect(write).toHaveBeenCalledTimes(1)
    expect('name' in write.mock.calls[0][1]).toBe(false)
    expect('name' in useWyrm.getState().mapShapes[0]).toBe(false)
    expect('name' in (await api.listMapShapes(path))[0]).toBe(false)
  })

  it('writes nothing when the name is unchanged', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('land', tri))!
    const write = vi.spyOn(api, 'writeMapShape')
    await useWyrm.getState().renameMapShapeAt(path, shape.id, '')
    await useWyrm.getState().renameMapShapeAt(path, shape.id, '   ')
    await useWyrm.getState().renameMapShapeAt(path, 'gone', 'X')
    await useWyrm.getState().renameMapShapeAt('/not/open', shape.id, 'X')
    expect(write).not.toHaveBeenCalled()
    await useWyrm.getState().renameMapShapeAt(path, shape.id, 'Same')
    await useWyrm.getState().renameMapShapeAt(path, shape.id, ' Same ')
    expect(write).toHaveBeenCalledTimes(1)
  })

  it('renames a parked project’s shape, leaving the one in front alone', async () => {
    await openDemo()
    const now = new Date().toISOString()
    const parkedShape: MapShape = {
      id: 'r1',
      kind: 'land',
      points: tri,
      created: now,
      modified: now
    }
    const front: MapShape = { ...parkedShape, kind: 'border', created: 'x', name: 'Front' }
    const write = vi.spyOn(api, 'writeMapShape').mockResolvedValue()
    useWyrm.setState({
      mapShapes: [front],
      parked: { [OTHER]: { ...useWyrm.getState(), mapShapes: [parkedShape] } as never }
    })
    await useWyrm.getState().renameMapShapeAt(OTHER, 'r1', 'Far Shore')
    expect(write).toHaveBeenCalledWith(OTHER, { ...parkedShape, name: 'Far Shore' })
    expect(useWyrm.getState().parked[OTHER].mapShapes).toEqual([
      { ...parkedShape, name: 'Far Shore' }
    ])
    expect(useWyrm.getState().mapShapes).toEqual([front])
    expect(__runtimeFor(OTHER)?.commitDirty).toBe(true)
  })

  it('a rename that lands after a focus change goes to the parked slice', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('land', tri))!
    __runtimeFor(path)!.commitDirty = false
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    vi.spyOn(api, 'writeMapShape').mockImplementation(() => gate)
    const pending = useWyrm.getState().renameMapShapeAt(path, shape.id, 'Far Shore')
    // The writer focuses a clone (same shape id) while the write is in flight.
    const state = useWyrm.getState()
    useWyrm.setState({
      parked: { [path]: { ...state, mapShapes: [shape] } as never },
      project: { ...state.project!, path: '/novels/Clone.wyrm' },
      mapShapes: [{ ...shape }]
    })
    release()
    await pending
    expect(useWyrm.getState().parked[path].mapShapes[0].name).toBe('Far Shore')
    expect('name' in useWyrm.getState().mapShapes[0]).toBe(false)
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
    expect(__runtimeFor('/novels/Clone.wyrm')?.commitDirty ?? false).toBe(false)
  })

  it('keeps a shape’s name through a points update', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('land', tri))!
    await useWyrm.getState().renameMapShapeAt(path, shape.id, 'Named')
    await useWyrm.getState().updateMapShapeAt(
      path,
      shape.id,
      tri.map((p) => ({ ...p, x: p.x + 1 }))
    )
    expect(useWyrm.getState().mapShapes[0].name).toBe('Named')
  })

  it('clones points into the mock, so a caller cannot mutate stored state', async () => {
    const path = await openDemo()
    const shape = (await useWyrm.getState().createMapShape('land', tri))!
    shape.points[0].x = 999
    const [stored] = await api.listMapShapes(path)
    expect(stored.points[0].x).toBe(0)
    stored.points[0].x = 555
    expect((await api.listMapShapes(path))[0].points[0].x).toBe(0)
  })
})
