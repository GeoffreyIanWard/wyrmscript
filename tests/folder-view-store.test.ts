// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { ProjectInfo } from '../src/shared/types'
import { useWyrm } from '../src/renderer/src/store'

/**
 * F-08: the folder-view listing is reached through `showFolder`, a binder
 * navigation action like `selectDoc`/`showDoc` — an arrival, not a hop Esc
 * should unwind (F-14's own scope). These drive the store directly; the
 * component itself (rendering, word counts) is covered in
 * `folder-view.test.tsx`.
 */

function project(): ProjectInfo {
  return {
    path: '/demo',
    data: {
      version: 1,
      title: 'T',
      binder: [
        {
          id: 'part-one',
          type: 'folder',
          title: 'Part One',
          children: [
            {
              id: 'chapter-1',
              type: 'folder',
              title: 'Chapter 1',
              children: [{ id: 'scene-a', type: 'doc', title: 'Scene A' }]
            }
          ]
        },
        { id: 'notes', type: 'folder', title: 'Notes', children: [] }
      ],
      trash: []
    }
  }
}

afterEach(() => {
  useWyrm.setState({
    project: null,
    mainView: { kind: 'doc' },
    viewHistory: [],
    activeId: null,
    activeDoc: null
  })
})

describe('showFolder', () => {
  it('opens the folder-view listing', () => {
    useWyrm.setState({ project: project() })
    useWyrm.getState().showFolder('notes')
    expect(useWyrm.getState().mainView).toEqual({ kind: 'folder', id: 'notes' })
  })

  it('is an arrival, not a hop — it clears the Esc back-stack (F-14)', () => {
    useWyrm.setState({ project: project(), viewHistory: [{ kind: 'entity', id: 'a' }] })
    useWyrm.getState().showFolder('notes')
    expect(useWyrm.getState().viewHistory).toEqual([])
    expect(useWyrm.getState().goBack()).toBe(false)
  })
})

describe('moveToTrash and the open folder view', () => {
  it('falls back to the manuscript when the open folder itself is trashed', async () => {
    useWyrm.setState({ project: project(), mainView: { kind: 'folder', id: 'notes' } })
    await useWyrm.getState().moveToTrash('notes')
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('falls back when an ancestor of the open folder is trashed', async () => {
    useWyrm.setState({ project: project(), mainView: { kind: 'folder', id: 'chapter-1' } })
    // Trashing "Part One" takes "Chapter 1" — the folder currently open — with it.
    await useWyrm.getState().moveToTrash('part-one')
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('leaves an unrelated open folder view alone', async () => {
    useWyrm.setState({ project: project(), mainView: { kind: 'folder', id: 'notes' } })
    await useWyrm.getState().moveToTrash('part-one')
    expect(useWyrm.getState().mainView).toEqual({ kind: 'folder', id: 'notes' })
  })
})
