// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __runtimeFor } from '../src/renderer/src/store'
import type { MapPin, MapStampKind } from '../src/shared/types'

/**
 * A place drawn as a stamp: `styleMapPinAt` is path-addressed like
 * `moveMapPinAt`, and the two are serialized per pin so a move and a style
 * change compose instead of overwriting each other.
 */

const OTHER = '/novels/Other Project.wyrm'

let demoPath: string | null = null

function pin(overrides: Partial<MapPin> = {}): MapPin {
  const now = new Date().toISOString()
  return { id: 'p1', entityId: 'e1', x: 5, y: 6, created: now, modified: now, ...overrides }
}

async function openDemo(pins: MapPin[] = [pin()]): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  const info = (await api.openProjectPath(demoPath))!
  useWyrm.setState({ project: info, booted: true, mapPins: pins, parked: {} })
  for (const p of pins) await api.writeMapPin(demoPath, p)
  return demoPath
}

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const stored = async (path: string): Promise<MapPin> =>
  (await api.listMapPins(path)).find((p) => p.id === 'p1')!
const settle = (): Promise<void> => new Promise((r) => setTimeout(r, 0))
const style = (path: string, s: { stamp?: MapStampKind | null; size?: number }): Promise<void> =>
  useWyrm.getState().styleMapPinAt(path, 'p1', s)

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(async () => {
  if (demoPath) {
    for (const p of await api.listMapPins(demoPath)) await api.deleteMapPin(demoPath, p.id)
  }
  useWyrm.setState({ mapPins: [], parked: {} })
})

describe('styleMapPinAt', () => {
  it('sets a stamp: store, disk and dirty', async () => {
    const path = await openDemo()
    const runtime = __runtimeFor(path)
    if (runtime) runtime.commitDirty = false
    await style(path, { stamp: 'castle' })
    expect(useWyrm.getState().mapPins[0]).toMatchObject({ stamp: 'castle', x: 5, y: 6 })
    expect((await stored(path)).stamp).toBe('castle')
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
  })

  it('sets a size on a stamp, and size 1 deletes the key', async () => {
    const path = await openDemo([pin({ stamp: 'town' })])
    await style(path, { size: 2.2 })
    expect(useWyrm.getState().mapPins[0].size).toBe(2.2)
    const write = vi.spyOn(api, 'writeMapPin')
    await style(path, { size: 1 })
    expect(write).toHaveBeenCalledTimes(1)
    expect('size' in write.mock.calls[0][1]).toBe(false)
    expect('size' in useWyrm.getState().mapPins[0]).toBe(false)
    expect('size' in (await stored(path))).toBe(false)
    expect(useWyrm.getState().mapPins[0].stamp).toBe('town')
  })

  it('a stamp and a size together are one write', async () => {
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeMapPin')
    await style(path, { stamp: 'tower', size: 1.5 })
    expect(write).toHaveBeenCalledTimes(1)
    expect(useWyrm.getState().mapPins[0]).toMatchObject({ stamp: 'tower', size: 1.5 })
  })

  it('stamp: null turns it back into a pin, deleting stamp and size', async () => {
    const path = await openDemo([pin({ stamp: 'castle', size: 1.5 })])
    const write = vi.spyOn(api, 'writeMapPin')
    await style(path, { stamp: null })
    expect(write).toHaveBeenCalledTimes(1)
    expect('stamp' in write.mock.calls[0][1]).toBe(false)
    expect('size' in write.mock.calls[0][1]).toBe(false)
    const got = useWyrm.getState().mapPins[0]
    expect('stamp' in got).toBe(false)
    expect('size' in got).toBe(false)
    const stored1 = await stored(path)
    expect('stamp' in stored1).toBe(false)
    expect('size' in stored1).toBe(false)
  })

  it('ignores an invalid stamp or size, writing nothing', async () => {
    const path = await openDemo([pin({ stamp: 'castle', size: 0.6 })])
    __runtimeFor(path)!.commitDirty = false
    const write = vi.spyOn(api, 'writeMapPin')
    await style(path, { stamp: 'spaceship' as MapStampKind })
    for (const size of [0, 3, -1, NaN]) await style(path, { size })
    expect(write).not.toHaveBeenCalled()
    expect(useWyrm.getState().mapPins[0]).toMatchObject({ stamp: 'castle', size: 0.6 })
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
    // An invalid size beside a real stamp change still changes the stamp only.
    await style(path, { stamp: 'town', size: 3 })
    expect(write).toHaveBeenCalledTimes(1)
    expect(useWyrm.getState().mapPins[0]).toMatchObject({ stamp: 'town', size: 0.6 })
  })

  it('ignores a size on a pin with no stamp', async () => {
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeMapPin')
    await style(path, { size: 2.2 })
    expect(write).not.toHaveBeenCalled()
    expect('size' in useWyrm.getState().mapPins[0]).toBe(false)
  })

  it('writes nothing when nothing changed', async () => {
    const path = await openDemo([pin({ stamp: 'castle', size: 1.5 })])
    __runtimeFor(path)!.commitDirty = false
    const write = vi.spyOn(api, 'writeMapPin')
    await style(path, {})
    await style(path, { stamp: 'castle' })
    await style(path, { size: 1.5 })
    await style(path, { stamp: 'castle', size: 1.5 })
    expect(write).not.toHaveBeenCalled()
    expect(__runtimeFor(path)!.commitDirty).toBe(false)
    // A pin turned to a pin again is no change either.
    useWyrm.setState({ mapPins: [pin()] })
    await style(path, { stamp: null })
    expect(write).not.toHaveBeenCalled()
  })

  it('does nothing for a missing pin or a project that is not open', async () => {
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeMapPin')
    await useWyrm.getState().styleMapPinAt(path, 'gone', { stamp: 'castle' })
    await useWyrm.getState().styleMapPinAt('/not/open', 'p1', { stamp: 'castle' })
    expect(write).not.toHaveBeenCalled()
    expect('stamp' in useWyrm.getState().mapPins[0]).toBe(false)
  })

  it('restyles a pin in a parked project, leaving the one in front alone', async () => {
    const path = await openDemo()
    const runtime = __runtimeFor(path)
    if (runtime) runtime.commitDirty = false
    const front = pin({ x: 100, y: 200 })
    const parked = pin({ x: 7, y: 8 })
    const write = vi.spyOn(api, 'writeMapPin').mockResolvedValue()
    useWyrm.setState({
      mapPins: [front],
      parked: { [OTHER]: { ...useWyrm.getState(), mapPins: [parked] } as never }
    })
    await style(OTHER, { stamp: 'ruins', size: 0.6 })
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][0]).toBe(OTHER)
    expect(write.mock.calls[0][1]).toMatchObject({ x: 7, y: 8, stamp: 'ruins', size: 0.6 })
    expect(useWyrm.getState().parked[OTHER].mapPins[0]).toMatchObject({ stamp: 'ruins' })
    expect(useWyrm.getState().mapPins).toEqual([front])
    expect(__runtimeFor(OTHER)?.commitDirty).toBe(true)
    expect(__runtimeFor(path)?.commitDirty ?? false).toBe(false)
  })
})

describe('a move and a style change on one pin', () => {
  function gated(): { writes: MapPin[]; gates: ReturnType<typeof deferred<void>>[] } {
    const writes: MapPin[] = []
    const gates: ReturnType<typeof deferred<void>>[] = []
    vi.spyOn(api, 'writeMapPin').mockImplementation((_path, p) => {
      writes.push({ ...p })
      const gate = deferred<void>()
      gates.push(gate)
      return gate.promise
    })
    return { writes, gates }
  }

  it.each([['style first'], ['move first']])('compose (%s)', async (order) => {
    const path = await openDemo()
    const { writes, gates } = gated()
    const { moveMapPinAt, styleMapPinAt } = useWyrm.getState()
    const doStyle = (): Promise<void> => styleMapPinAt(path, 'p1', { stamp: 'castle', size: 2.2 })
    const doMove = (): Promise<void> => moveMapPinAt(path, 'p1', 40, 50)
    const a = order === 'style first' ? doStyle() : doMove()
    const b = order === 'style first' ? doMove() : doStyle()
    await settle()
    expect(writes).toHaveLength(1) // the second waits for the first
    gates[0].resolve()
    await vi.waitFor(() => expect(writes).toHaveLength(2))
    gates[1].resolve()
    await Promise.all([a, b])
    expect(writes[1]).toMatchObject({ stamp: 'castle', size: 2.2, x: 40, y: 50 })
    expect(useWyrm.getState().mapPins[0]).toMatchObject({
      stamp: 'castle',
      size: 2.2,
      x: 40,
      y: 50
    })
  })
})

describe('a stamp survives the other pin writes', () => {
  it('moveMapPinAt keeps stamp and size', async () => {
    const path = await openDemo([pin({ stamp: 'city', size: 1.5 })])
    await useWyrm.getState().moveMapPinAt(path, 'p1', 9, 10)
    expect(useWyrm.getState().mapPins[0]).toMatchObject({ x: 9, y: 10, stamp: 'city', size: 1.5 })
    expect(await stored(path)).toMatchObject({ stamp: 'city', size: 1.5 })
  })

  it('setMapPin on a placed location keeps stamp and size', async () => {
    const path = await openDemo([pin({ stamp: 'city', size: 1.5 })])
    await useWyrm.getState().setMapPin('e1', 30, 31)
    expect(useWyrm.getState().mapPins[0]).toMatchObject({ x: 30, y: 31, stamp: 'city', size: 1.5 })
    expect(await stored(path)).toMatchObject({ stamp: 'city', size: 1.5 })
  })
})
