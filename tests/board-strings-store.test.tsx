// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { BoardString, StringEnd } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll, SLICE_KEYS } from '../src/renderer/src/store'

/**
 * F-46, the store side: red strings between corkboard cards, driven through
 * the real store against the mock.
 *
 * Two things are worth pinning beyond "it writes". A string from a card to
 * itself is refused before anything reaches the api, because the view would
 * draw it as a dot. And `boardStrings` has to be in `SLICE_KEYS` — nothing
 * typechecks a per-project field left out of that list, and one left out
 * leaks between open projects, so the one-line assertion at the end is the
 * only thing that would notice.
 */

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  await clearStrings(demoPath!)
  return demoPath!
}

/**
 * The mock keeps strings in a module-level map that outlives a test, so
 * without this each test inherits whatever the previous one drew and the
 * counts below drift by one per test.
 */
async function clearStrings(path: string): Promise<void> {
  for (const s of await api.listBoardStrings(path)) await api.deleteBoardString(path, s.id)
  await act(async () => {
    await useWyrm.getState().loadBoardStrings()
  })
}

const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()

const end = (cardId: string, dx = 10, dy = 20): StringEnd => ({ cardId, dx, dy })

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
    boardStrings: []
  })
  __disposeAll()
})

describe('loadBoardStrings', () => {
  it('fills the array from the project', async () => {
    const path = await openDemo()
    const now = new Date().toISOString()
    await api.writeBoardString(path, {
      id: 'seeded',
      from: end('a'),
      to: end('b'),
      created: now,
      modified: now
    })
    expect(state().boardStrings).toEqual([])

    await act(async () => state().loadBoardStrings())

    expect(state().boardStrings.map((s) => s.id)).toEqual(['seeded'])
  })
})

describe('createBoardString', () => {
  it('persists the string with both ends intact, in the project and the store', async () => {
    const path = await openDemo()

    let created: BoardString | null = null
    await act(async () => {
      created = await state().createBoardString(end('scene-1', 0, 32), end('elara', 96, 4))
    })

    expect(created).not.toBeNull()
    const stored = await api.listBoardStrings(path)
    expect(stored).toHaveLength(1)
    expect(stored[0].from).toEqual({ cardId: 'scene-1', dx: 0, dy: 32 })
    expect(stored[0].to).toEqual({ cardId: 'elara', dx: 96, dy: 4 })
    expect(state().boardStrings).toHaveLength(1)
    expect(state().boardStrings[0].id).toBe(stored[0].id)
    expect(state().boardStrings[0].from).toEqual({ cardId: 'scene-1', dx: 0, dy: 32 })
  })

  it('refuses both ends on the same card: returns null and writes nothing', async () => {
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeBoardString')

    let created: unknown = 'unset'
    await act(async () => {
      created = await state().createBoardString(end('scene-1', 0, 0), end('scene-1', 50, 50))
    })

    expect(created).toBeNull()
    expect(write).not.toHaveBeenCalled()
    expect(await api.listBoardStrings(path)).toEqual([])
    expect(state().boardStrings).toEqual([])
  })
})

describe('deleteBoardString', () => {
  it('removes the string from the project and the store', async () => {
    const path = await openDemo()
    let keep: BoardString | null = null
    let gone: BoardString | null = null
    await act(async () => {
      keep = await state().createBoardString(end('a'), end('b'))
      gone = await state().createBoardString(end('b'), end('c'))
    })

    await act(async () => state().deleteBoardString(gone!.id))

    expect((await api.listBoardStrings(path)).map((s) => s.id)).toEqual([keep!.id])
    expect(state().boardStrings.map((s) => s.id)).toEqual([keep!.id])
  })
})

describe('the project slice', () => {
  it('includes boardStrings, so strings never leak between open projects', () => {
    expect(SLICE_KEYS).toContain('boardStrings')
  })
})
