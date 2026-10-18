// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { BinderNode, Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { findNode, removeNode, walk } from '../src/renderer/src/lib/tree'

/**
 * F-45, the store side: characters and locations on the corkboard, and
 * making a scene without leaving the board.
 *
 * Membership is explicit — an entry has a card iff `onBoard` is true — and
 * it lives on the entry beside its position, exactly as a scene's lives in
 * its frontmatter. So what is worth pinning is what reaches the file: a card
 * taken off the board must leave the entry behind with the keys *gone*
 * rather than set to undefined (gray-matter refuses the latter), a position
 * of 0 must survive (truthiness would drop a card at the board's edge), and
 * Tidy must forget where cards sit without forgetting which cards there are.
 *
 * `addSceneDoc` is `addDoc` without the doc switch, so the thing to prove is
 * the negative: making a scene from the board leaves the board up.
 */

let demoPath: string | null = null
/** What the demo ships with, captured on first open; anything else is ours. */
let seededNodes: Map<string, string> | null = null
let seededEntityIds: Set<string> | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await resetDemo(demoPath)
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  return demoPath
}

/**
 * The mock keeps documents and entities in module-level maps that outlive a
 * test, so without this each test inherits the last one's board: an entry
 * already on it, a position already set, a scene already appended, a folder
 * still renamed. Runs *before* the project is opened, so the store loads the
 * clean state rather than a copy taken before the reset.
 */
async function resetDemo(path: string): Promise<void> {
  const info = (await api.openProjectPath(path))!
  const present: BinderNode[] = []
  walk(info.data.binder, (n) => present.push(n))
  seededNodes ??= new Map(present.map((n) => [n.id, n.title]))
  for (const node of present) {
    const title = seededNodes.get(node.id)
    if (title === undefined) removeNode(info.data.binder, node.id)
    else node.title = title
  }
  await api.saveProject(path, info.data)
  for (const d of await api.readAllDocs(path)) {
    const meta = { ...d.meta }
    delete meta.boardX
    delete meta.boardY
    await api.writeDoc(path, { ...d, meta })
  }
  const entities = await api.listEntities(path)
  seededEntityIds ??= new Set(entities.map((e) => e.id))
  for (const e of entities) {
    if (!seededEntityIds.has(e.id)) {
      await api.deleteEntity(path, e.type, e.id)
      continue
    }
    const clean = { ...e }
    delete clean.onBoard
    delete clean.boardX
    delete clean.boardY
    await api.writeEntity(path, clean)
  }
}

const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()

const binder = (): BinderNode[] => state().project!.data.binder

const manuscript = (): BinderNode =>
  binder().find((n) => n.type === 'folder' && n.title === 'Manuscript')!

const lastChild = (folder: BinderNode): BinderNode => folder.children![folder.children!.length - 1]

const entityNamed = (name: string): Entity => state().entities.find((e) => e.name === name)!

const stored = async (path: string, id: string): Promise<Entity> =>
  (await api.listEntities(path)).find((e) => e.id === id)!

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
    mainView: { kind: 'doc' },
    viewHistory: []
  })
  __disposeAll()
})

describe('adding a scene from the board', () => {
  it('leaves the board up, with no doc switch and no rename mode', async () => {
    // What `addDoc` would do instead: open the new document and start a
    // rename in the binder — which is hidden while the board is up. The
    // writer would be yanked off the board onto an empty page, with the
    // rename field focused somewhere they cannot see.
    const path = await openDemo()
    await act(async () => state().showCorkboard())
    const activeBefore = state().activeId
    const save = vi.spyOn(api, 'saveProject')

    const id = await act(() => state().addSceneDoc('The Night Market'))

    expect(id).toBeTruthy()
    expect(state().mainView.kind).toBe('corkboard')
    expect(state().viewHistory).toEqual([])
    expect(state().renamingId).toBeNull()
    expect(state().activeId).toBe(activeBefore)
    // At the end of the Manuscript folder, not wherever the selection was.
    expect(lastChild(manuscript())).toEqual({ id, type: 'doc', title: 'The Night Market' })
    expect(save).toHaveBeenCalled()
    // Tagged as a scene from birth: the tag is what puts it on the board.
    const doc = await api.readDoc(path, id!)
    expect(doc.meta.title).toBe('The Night Market')
    expect(doc.meta.tags).toEqual(['scene'])
    expect(doc.body).toBe('')
  })

  it('falls back to Untitled for a blank name', async () => {
    const path = await openDemo()

    const id = await act(() => state().addSceneDoc('   '))

    expect(lastChild(manuscript()).title).toBe('Untitled')
    expect((await api.readDoc(path, id!)).meta.title).toBe('Untitled')
  })

  it('still lands in the first root folder when none is titled Manuscript', async () => {
    // The writer can rename root folders, so "Manuscript" is a convention,
    // not a guarantee. A missing folder must not throw after the document
    // has already been written to disk — that leaves a file no binder lists.
    await openDemo()
    const root = binder()
    expect(root[0].type).toBe('folder')
    root[0].title = 'Book One'

    const id = await act(() => state().addSceneDoc('Orphan'))

    expect(findNode(root, id!)).toBeTruthy()
    expect(lastChild(root[0]).id).toBe(id)
  })

  it('lands at the binder root when there is no root folder at all', async () => {
    await openDemo()
    const root = binder()
    const original = root.splice(0, root.length, { id: 'loose', type: 'doc', title: 'Loose' })
    try {
      const id = await act(() => state().addSceneDoc('Rootless'))

      expect(root[root.length - 1]).toEqual({ id, type: 'doc', title: 'Rootless' })
    } finally {
      root.splice(0, root.length, ...original)
    }
  })

  it('does nothing without a project', async () => {
    useWyrm.setState({ project: null })
    const write = vi.spyOn(api, 'writeDoc')

    expect(await state().addSceneDoc('Nowhere')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })
})

describe('an entry on the board', () => {
  it('gets there by onBoard on the entry, in the file and in the store', async () => {
    const path = await openDemo()
    const elara = entityNamed('Elara Voss')
    expect(elara.onBoard).toBeUndefined()

    await act(() => state().addEntityToBoard(elara.id))

    expect((await stored(path, elara.id)).onBoard).toBe(true)
    expect(entityNamed('Elara Voss').onBoard).toBe(true)
  })

  it('is not re-written when already there, nor when it does not exist', async () => {
    await openDemo()
    const elara = entityNamed('Elara Voss')
    await act(() => state().addEntityToBoard(elara.id))
    const write = vi.spyOn(api, 'writeEntity')

    await act(() => state().addEntityToBoard(elara.id))
    await act(() => state().addEntityToBoard('no-such-entry'))

    expect(write).not.toHaveBeenCalled()
  })

  it('comes off with the entry left behind and the keys gone, not undefined', async () => {
    const path = await openDemo()
    const elara = entityNamed('Elara Voss')
    await act(() => state().addEntityToBoard(elara.id))
    await act(() => state().setEntityPosition(elara.id, 120, 80))
    const write = vi.spyOn(api, 'writeEntity')

    await act(() => state().removeEntityFromBoard(elara.id))

    const after = await stored(path, elara.id)
    expect(after.name).toBe('Elara Voss')
    expect(after.body).toBe(elara.body)
    expect(after.aliases).toEqual(elara.aliases)
    expect(after.onBoard).toBeUndefined()
    expect(after.boardX).toBeUndefined()
    expect(after.boardY).toBeUndefined()
    expect(entityNamed('Elara Voss').onBoard).toBeUndefined()
    // The shape handed to the write is what matters, not only what reads
    // back: gray-matter throws on an explicit undefined frontmatter value.
    expect(write).toHaveBeenCalledTimes(1)
    const written = write.mock.calls[0][1]
    expect('onBoard' in written).toBe(false)
    expect('boardX' in written).toBe(false)
    expect('boardY' in written).toBe(false)
  })

  it('is left alone by a removal when it does not exist', async () => {
    await openDemo()
    const write = vi.spyOn(api, 'writeEntity')

    await act(() => state().removeEntityFromBoard('no-such-entry'))

    expect(write).not.toHaveBeenCalled()
  })
})

describe("an entry's position", () => {
  it('is written to the entry', async () => {
    const path = await openDemo()
    const harrowgate = entityNamed('Harrowgate')
    await act(() => state().addEntityToBoard(harrowgate.id))

    await act(() => state().setEntityPosition(harrowgate.id, 240, 160))

    const after = await stored(path, harrowgate.id)
    expect(after.boardX).toBe(240)
    expect(after.boardY).toBe(160)
    expect(after.onBoard).toBe(true)
    expect(entityNamed('Harrowgate').boardX).toBe(240)
    expect(entityNamed('Harrowgate').boardY).toBe(160)
  })

  it('keeps 0, which is a real coordinate', async () => {
    // A truthiness check anywhere on the way would drop a card dragged to
    // the top-left corner back into its grid slot.
    const path = await openDemo()
    const harrowgate = entityNamed('Harrowgate')
    await act(() => state().addEntityToBoard(harrowgate.id))

    await act(() => state().setEntityPosition(harrowgate.id, 0, 0))

    const after = await stored(path, harrowgate.id)
    expect(after.boardX).toBe(0)
    expect(after.boardY).toBe(0)
    expect(entityNamed('Harrowgate').boardX).toBe(0)
    expect(entityNamed('Harrowgate').boardY).toBe(0)
  })
})

describe('tidying the board', () => {
  it('forgets where entries sit but not that they are on the board', async () => {
    const path = await openDemo()
    const elara = entityNamed('Elara Voss')
    await act(() => state().addEntityToBoard(elara.id))
    await act(() => state().setEntityPosition(elara.id, 300, 200))
    const [scene] = await api.readAllDocs(path)
    await act(() => state().setCardPosition(scene.meta.id, 400, 400))

    await act(() => state().tidyBoard())

    const after = await stored(path, elara.id)
    expect(after.onBoard).toBe(true)
    expect(after.boardX).toBeUndefined()
    expect(after.boardY).toBeUndefined()
    expect(entityNamed('Elara Voss').onBoard).toBe(true)
    expect(entityNamed('Elara Voss').boardX).toBeUndefined()
    // And it still does what it always did for scenes.
    const tidied = await api.readDoc(path, scene.meta.id)
    expect(tidied.meta.boardX).toBeUndefined()
    expect(tidied.meta.boardY).toBeUndefined()
  })

  it('writes only the entries that had a position', async () => {
    // An entry on the board that was never moved has nothing to clear;
    // re-saving it would bump `modified` on an entry nothing happened to.
    await openDemo()
    const elara = entityNamed('Elara Voss')
    const marten = entityNamed('Marten')
    await act(() => state().addEntityToBoard(elara.id))
    await act(() => state().addEntityToBoard(marten.id))
    await act(() => state().setEntityPosition(elara.id, 50, 60))
    const write = vi.spyOn(api, 'writeEntity')

    await act(() => state().tidyBoard())

    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][1].id).toBe(elara.id)
    expect('boardX' in write.mock.calls[0][1]).toBe(false)
  })
})

describe('an entry made from the board', () => {
  it('is born on it, in one write', async () => {
    // Create-then-save would be two writes, and a window in which the entry
    // exists but is not yet on the board the writer just added it from.
    const path = await openDemo()
    const write = vi.spyOn(api, 'writeEntity')

    const created = await act(() =>
      state().createEntity('character', 'The Envoy', { onBoard: true })
    )

    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0][1]).toMatchObject({
      type: 'character',
      name: 'The Envoy',
      onBoard: true
    })
    expect(created?.onBoard).toBe(true)
    expect((await stored(path, created!.id)).onBoard).toBe(true)
    expect(entityNamed('The Envoy').onBoard).toBe(true)
  })

  it('still answers the callers that pass no extra', async () => {
    await openDemo()

    const created = await act(() => state().createEntity('glossary', 'tidewater'))

    expect(created).toMatchObject({ type: 'glossary', name: 'tidewater', aliases: [], body: '' })
    expect(created?.onBoard).toBeUndefined()
  })

  it('cannot have its identity forged through extra', async () => {
    await openDemo()

    const created = await act(() =>
      state().createEntity('world', 'The Narrows', { id: 'forged', type: 'glossary' })
    )

    expect(created?.id).not.toBe('forged')
    expect(created?.type).toBe('world')
  })
})
