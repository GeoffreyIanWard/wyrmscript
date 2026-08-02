// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-14: Esc unwinds story-bible detours one hop at a time. These drive the
 * store's real navigation actions — the stack only exists as a consequence of
 * `showEntity`/`showDoc`/`selectDoc`, so exercising those is the only honest
 * way to assert what Esc will actually do.
 */

function entity(id: string, name: string): Entity {
  const now = new Date().toISOString()
  return { id, type: 'glossary', name, aliases: [], body: '', created: now, modified: now }
}

afterEach(() => {
  vi.restoreAllMocks()
  useWyrm.setState({
    project: null,
    entities: [],
    mainView: { kind: 'doc' },
    viewHistory: [],
    panelEntityId: null
  })
})

describe('goBack', () => {
  it('does nothing, and reports so, with no history', () => {
    expect(useWyrm.getState().goBack()).toBe(false)
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('returns from an entry to the document it was opened from', () => {
    useWyrm.getState().showEntity('a')
    expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: 'a' })

    expect(useWyrm.getState().goBack()).toBe(true)
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('unwinds a chain one step at a time rather than jumping to the start', () => {
    const { showEntity } = useWyrm.getState()
    showEntity('a')
    showEntity('b')
    showEntity('c')

    useWyrm.getState().goBack()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: 'b' })
    useWyrm.getState().goBack()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: 'a' })
    useWyrm.getState().goBack()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    expect(useWyrm.getState().goBack()).toBe(false)
  })

  it('does not stack a duplicate when the entry already on screen is reopened', () => {
    const { showEntity } = useWyrm.getState()
    showEntity('a')
    showEntity('a')

    expect(useWyrm.getState().viewHistory).toHaveLength(1)
    useWyrm.getState().goBack()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('caps the stack rather than growing without bound', () => {
    const { showEntity } = useWyrm.getState()
    for (let i = 0; i < 50; i++) showEntity(`e${i}`)
    expect(useWyrm.getState().viewHistory.length).toBeLessThanOrEqual(20)
  })
})

describe('what clears the back-stack', () => {
  it('"Back to Manuscript" clears it, so Esc does not bounce into the entry just left', () => {
    const { showEntity } = useWyrm.getState()
    showEntity('a')
    showEntity('b')

    useWyrm.getState().showDoc()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    expect(useWyrm.getState().goBack()).toBe(false)
  })

  it('choosing a scene in the binder clears it — binder nav is not history', async () => {
    const now = new Date().toISOString()
    vi.spyOn(api, 'readDoc').mockResolvedValue({
      meta: { id: 'doc-2', title: 'Scene Two', created: now, modified: now },
      body: ''
    })
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } }
    })
    useWyrm.getState().showEntity('a')

    await useWyrm.getState().selectDoc('doc-2')

    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    expect(useWyrm.getState().goBack()).toBe(false)
  })
})

describe('pruning', () => {
  it('drops a deleted entry from the history so Esc never lands on a dead entry', async () => {
    const gone = entity('a', 'Wyrmlight')
    vi.spyOn(api, 'deleteEntity').mockResolvedValue(undefined)
    useWyrm.setState({
      project: { path: '/demo', data: { version: 1, title: 'T', binder: [], trash: [] } },
      entities: [gone, entity('b', 'Drowned Saints')]
    })

    const { showEntity } = useWyrm.getState()
    showEntity('a')
    showEntity('b')
    expect(useWyrm.getState().viewHistory).toContainEqual({ kind: 'entity', id: 'a' })

    await useWyrm.getState().deleteEntity(gone)

    expect(useWyrm.getState().viewHistory).not.toContainEqual({ kind: 'entity', id: 'a' })
    // Still viewing b, and going back now skips straight past the dead entry.
    useWyrm.getState().goBack()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })
})
