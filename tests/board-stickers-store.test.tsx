// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll, SLICE_KEYS } from '../src/renderer/src/store'

/**
 * F-45, the store side: stickers and string colours through the real store
 * against the mock. A sticker lands with a hand's inaccuracy — a tilt of up
 * to twelve degrees and a pixel or two off — and a move that changes
 * nothing writes nothing.
 */

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  for (const s of await api.listBoardStickers(demoPath!))
    await api.deleteBoardSticker(demoPath!, s.id)
  for (const s of await api.listBoardStrings(demoPath!))
    await api.deleteBoardString(demoPath!, s.id)
  await act(async () => {
    await useWyrm.getState().loadBoardStickers()
    await useWyrm.getState().loadBoardStrings()
  })
  return demoPath!
}

const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    editor: null,
    boardStrings: [],
    boardStickers: []
  })
  __disposeAll()
})

describe('sticking a sticker down', () => {
  it('tilts it up to twelve degrees either way and puts it a pixel or two off', async () => {
    const path = await openDemo()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const left = await act(async () => state().createBoardSticker('star', 'red', { x: 100, y: 50 }))
    vi.spyOn(Math, 'random').mockReturnValue(0.9999)
    const right = await act(async () =>
      state().createBoardSticker('heart', 'blue', { x: 100, y: 50, cardId: 'c1' })
    )
    expect(left!.rotation).toBe(-12)
    expect([left!.x, left!.y]).toEqual([98, 48])
    expect(right!.rotation).toBe(12)
    expect([right!.x, right!.y]).toEqual([102, 52])
    expect(right).toMatchObject({ colour: 'blue', cardId: 'c1' })
    // Red is not written; nor is a card for one on the cork.
    expect('colour' in left!).toBe(false)
    expect('cardId' in left!).toBe(false)
    expect((await api.listBoardStickers(path)).map((s) => s.kind).sort()).toEqual(['heart', 'star'])
    expect(state().boardStickers).toHaveLength(2)
  })

  it('is not quite square, nor quite where it was aimed, from one sticker to the next', async () => {
    await openDemo()
    const tilts = new Set<number>()
    for (let i = 0; i < 8; i++) {
      const s = await act(async () => state().createBoardSticker('dot', 'red', { x: 0, y: 0 }))
      expect(Math.abs(s!.rotation)).toBeLessThanOrEqual(12)
      expect(Math.abs(s!.x)).toBeLessThanOrEqual(2)
      tilts.add(s!.rotation)
    }
    expect(tilts.size).toBeGreaterThan(1)
  })
})

describe('moving and peeling one off', () => {
  it('re-anchors a moved sticker, onto a card or off it onto the cork', async () => {
    const path = await openDemo()
    const s = await act(async () =>
      state().createBoardSticker('check', 'green', { x: 10, y: 10, cardId: 'c1' })
    )
    await act(async () => state().moveBoardSticker(s!.id, { x: 400, y: 300 }))
    let [disk] = await api.listBoardStickers(path)
    expect([disk.x, disk.y, 'cardId' in disk]).toEqual([400, 300, false])
    await act(async () => state().moveBoardSticker(s!.id, { x: 5, y: 6, cardId: 'c2' }))
    ;[disk] = await api.listBoardStickers(path)
    expect(disk).toMatchObject({ x: 5, y: 6, cardId: 'c2', colour: 'green', kind: 'check' })
    // Its tilt is its own: a move never straightens it.
    expect(disk.rotation).toBe(s!.rotation)
  })

  it('writes nothing for a move that ends where it started', async () => {
    await openDemo()
    const s = await act(async () =>
      state().createBoardSticker('cross', 'red', { x: 10, y: 10, cardId: 'c1' })
    )
    const write = vi.spyOn(api, 'writeBoardSticker')
    await act(async () => state().moveBoardSticker(s!.id, { x: s!.x, y: s!.y, cardId: 'c1' }))
    expect(write).not.toHaveBeenCalled()
  })

  it('deletes one', async () => {
    const path = await openDemo()
    const s = await act(async () => state().createBoardSticker('arrow', 'red', { x: 1, y: 1 }))
    await act(async () => state().deleteBoardSticker(s!.id))
    expect(state().boardStickers).toEqual([])
    expect(await api.listBoardStickers(path)).toEqual([])
  })

  it('keeps stickers with their own project', () => {
    expect(SLICE_KEYS).toContain('boardStickers')
  })
})

describe("a string's colour", () => {
  const end = (cardId: string): { cardId: string; dx: number; dy: number } => ({
    cardId,
    dx: 5,
    dy: 5
  })

  it('is made in the colour chosen, and changed later without touching anything else', async () => {
    const path = await openDemo()
    const s = await act(async () => state().createBoardString(end('a'), end('b'), 'owes', 'orange'))
    expect(s!.colour).toBe('orange')
    await act(async () => state().recolourBoardString(s!.id, 'red'))
    let [disk] = await api.listBoardStrings(path)
    expect('colour' in disk).toBe(false)
    expect(disk.label).toBe('owes')
    await act(async () => state().recolourBoardString(s!.id, 'yellow'))
    ;[disk] = await api.listBoardStrings(path)
    expect(disk.colour).toBe('yellow')
    // The same colour again writes nothing.
    const write = vi.spyOn(api, 'writeBoardString')
    await act(async () => state().recolourBoardString(s!.id, 'yellow'))
    expect(write).not.toHaveBeenCalled()
  })
})
