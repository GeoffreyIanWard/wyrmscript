// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import type { BinderNode, DocFile, ProjectData } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { SLICE_KEYS, useWyrm, __disposeAll, __runtimeFor } from '../src/renderer/src/store'
import { findNode, walk } from '../src/renderer/src/lib/tree'

/**
 * F-45, "Apply board order": the store side of writing the board's
 * arrangement back into the binder.
 *
 * Dragging a card places it and reorders nothing, so this is the one step by
 * which the board becomes the book's order — and the thing to prove is what
 * it must *not* do on the way. The board hands over a flat list of scene ids
 * with no folder structure in it, so the rules are about the structure the
 * list cannot see: a sub-folder or an untagged note between two scenes keeps
 * its exact index, a scene never leaves its chapter however the list
 * interleaves two folders' ids, and a list the binder already matches writes
 * nothing at all (the button disables on that, and a no-op save would still
 * bump the checkpoint dirt).
 */

let demoPath: string | null = null
/** The binder the demo ships with, captured on first open. */
let seededBinder: BinderNode[] | null = null

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await resetDemo(demoPath)
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  return demoPath
}

/**
 * The mock keeps the project in a module-level map that outlives a test, and
 * every test here reorders the binder, so without this each test would start
 * from the last one's arrangement — and "already in that order" would pass
 * or fail by accident. Restores the seeded tree wholesale (order included,
 * which is why a title-and-membership reset is not enough) and runs *before*
 * the project is opened, so the store loads the clean state.
 */
async function resetDemo(path: string): Promise<void> {
  const info = (await api.openProjectPath(path))!
  seededBinder ??= clone(info.data.binder)
  const data: ProjectData = { ...info.data, binder: clone(seededBinder), trash: [] }
  await api.saveProject(path, data)
}

const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()

const binder = (): BinderNode[] => state().project!.data.binder

function nodeTitled(title: string, nodes: BinderNode[] = binder()): BinderNode {
  const hits: BinderNode[] = []
  walk(nodes, (n) => {
    if (n.title === title) hits.push(n)
  })
  if (hits.length === 0) throw new Error(`No binder node titled ${title}`)
  return hits[0]
}

const idOf = (title: string): string => nodeTitled(title).id

const childTitles = (folder: BinderNode): string[] => (folder.children ?? []).map((n) => n.title)

const PART_ONE = 'Part One — The Harbor'
const SCENES = ['The Wyrmlight Fades', 'A Knock at Night', 'Ashes on the Tide']
const REVERSED = [...SCENES].reverse()

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
    viewHistory: [],
    boardUndo: null
  })
  __disposeAll()
})

describe('applying the board order', () => {
  it("reorders a folder's scenes and persists the binder", async () => {
    const path = await openDemo()
    const before = state().project
    // Captured at call time, as a copy: the store reorders the binder in
    // place and hands the same object to the save, so reading the spy's
    // argument afterwards would read the array the test already checked.
    const saved: ProjectData[] = []
    const save = vi
      .spyOn(api, 'saveProject')
      .mockImplementation(async (_p: string, data: ProjectData) => {
        saved.push(JSON.parse(JSON.stringify(data)) as ProjectData)
      })

    const changed = await act(() => state().applyBoardOrder(REVERSED.map(idOf)))

    expect(changed).not.toBeNull()
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(REVERSED)
    // A new project object, or nothing subscribed to the binder re-renders.
    expect(state().project).not.toBe(before)
    // What reached the write is what matters: the binder handed to the
    // save. (Not what the mock hands back on re-open — it keeps the very
    // object the store holds, so that would read the array just checked.)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(path, expect.anything())
    expect(childTitles(nodeTitled(PART_ONE, saved[0].binder))).toEqual(REVERSED)
  })

  it('keeps a sub-folder and an untagged doc at their exact indices', async () => {
    // The board shows scenes only, so its list says nothing about the folder
    // and the note sitting between them. Sorting the whole children array
    // would sweep both to one end; dealing into the scenes' own slots does
    // not touch them.
    await openDemo()
    const partOne = nodeTitled(PART_ONE)
    const [first, second, third] = SCENES.map(idOf)
    await act(() => state().addFolder(partOne.id))
    const folder = partOne.children![partOne.children!.length - 1]
    await act(() => state().moveBinderNode(folder.id, second, 'before'))
    await act(() => state().addDoc(partOne.id))
    const note = partOne.children![partOne.children!.length - 1]
    await act(() => state().moveBinderNode(note.id, third, 'before'))
    expect(partOne.children!.map((n) => n.id)).toEqual([first, folder.id, second, note.id, third])

    const changed = await act(() => state().applyBoardOrder([third, second, first]))

    expect(changed).not.toBeNull()
    const after = nodeTitled(PART_ONE).children!
    expect(after.map((n) => n.id)).toEqual([third, folder.id, second, note.id, first])
    expect(after[1]).toBe(folder)
    expect(after[3]).toBe(note)
  })

  it('reorders each folder independently and never moves a doc between them', async () => {
    // One flat list, two folders' worth of ids, interleaved: the Notes doc
    // listed first must not be carried to the front of the Manuscript, and
    // the position of Part One's scenes relative to Notes' docs means
    // nothing — only each folder's own docs' order among themselves.
    await openDemo()
    const notes = nodeTitled('Notes')
    const timeline = idOf('Timeline')
    await act(() => state().addDoc(notes.id))
    const untitled = notes.children![1].id
    const [first, second, third] = SCENES.map(idOf)

    const changed = await act(() =>
      state().applyBoardOrder([untitled, third, timeline, second, first])
    )

    expect(changed).not.toBeNull()
    const notesAfter = nodeTitled('Notes').children!
    const partOneAfter = nodeTitled(PART_ONE).children!
    expect(notesAfter.map((n) => n.id)).toEqual([untitled, timeline])
    expect(partOneAfter.map((n) => n.id)).toEqual([third, second, first])
    expect(findNode(partOneAfter, timeline)).toBeNull()
    expect(findNode(partOneAfter, untitled)).toBeNull()
    expect(findNode(notesAfter, first)).toBeNull()
    // The root and the Manuscript folder, which hold only folders, are as
    // they were.
    expect(binder().map((n) => n.title)).toEqual(['Manuscript', 'Notes'])
    expect(childTitles(nodeTitled('Manuscript'))).toEqual([PART_ONE])
  })

  it('writes nothing when the binder is already in that order — no save, no pins', async () => {
    await openDemo()
    const before = state().project
    const save = vi.spyOn(api, 'saveProject')
    const write = vi.spyOn(api, 'writeDoc')
    const [first] = SCENES.map(idOf)

    const changed = await act(() =>
      state().applyBoardOrder(SCENES.map(idOf), [{ id: first, x: 40, y: 50 }])
    )

    expect(changed).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
    expect(state().project).toBe(before)
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(SCENES)
  })

  it('ignores ids the binder does not carry', async () => {
    // A card can outlive its node within one session — the board read its
    // scenes before the writer trashed one — and the trash is not a place
    // this writes to.
    const path = await openDemo()
    const [first, second, third] = SCENES.map(idOf)
    await act(() => state().moveToTrash(first))
    const save = vi.spyOn(api, 'saveProject')

    const changed = await act(() =>
      state().applyBoardOrder(['no-such-card', third, first, 'ghost', second])
    )

    expect(changed).not.toBeNull()
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(['Ashes on the Tide', 'A Knock at Night'])
    expect(state().project!.data.trash.map((n) => n.id)).toEqual([first])
    expect(save).toHaveBeenCalledTimes(1)
    expect(findNode((await api.openProjectPath(path))!.data.binder, first)).toBeNull()
  })

  it('writes nothing for a list of only unknown ids', async () => {
    await openDemo()
    const save = vi.spyOn(api, 'saveProject')

    expect(await act(() => state().applyBoardOrder(['no-such-card', 'ghost']))).toBeNull()
    expect(await act(() => state().applyBoardOrder([]))).toBeNull()
    expect(save).not.toHaveBeenCalled()
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(SCENES)
  })

  it('does nothing without a project', async () => {
    useWyrm.setState({ project: null })
    const save = vi.spyOn(api, 'saveProject')

    expect(await state().applyBoardOrder(['anything'])).toBeNull()
    expect(save).not.toHaveBeenCalled()
  })
})

describe('the pins', () => {
  it('writes each position after the binder, and keeps the open document fresh in memory', async () => {
    const path = await openDemo()
    const [first, second] = SCENES.map(idOf)
    await act(() => state().selectDoc(first))
    const open = state().activeDoc!
    const calls: string[] = []
    vi.spyOn(api, 'saveProject').mockImplementation(async () => {
      calls.push('save')
    })
    const realWrite = api.writeDoc.bind(api)
    vi.spyOn(api, 'writeDoc').mockImplementation(async (p, doc) => {
      calls.push(`write ${doc.meta.id}`)
      await realWrite(p, doc)
    })

    await act(() =>
      state().applyBoardOrder(REVERSED.map(idOf), [
        { id: first, x: 40, y: 50 },
        { id: second, x: 300, y: 50 }
      ])
    )

    expect(calls).toEqual(['save', `write ${first}`, `write ${second}`])
    expect((await api.readDoc(path, first)).meta).toMatchObject({ boardX: 40, boardY: 50 })
    expect((await api.readDoc(path, second)).meta).toMatchObject({ boardX: 300, boardY: 50 })
    // The open document's in-memory copy carries the pin too: the next
    // save writes that copy, and a stale one would put the card back.
    expect(state().activeDoc).not.toBe(open)
    expect(state().activeDoc?.meta).toMatchObject({ boardX: 40, boardY: 50 })
    expect(state().activeDoc?.body).toBe(open.body)
  })

  it('go to the project the order was applied to, even when another is focused before the save lands', async () => {
    // A clone or a restored backup shares the original's ids, so this is
    // the case where "whichever project is in front" is not merely the
    // wrong runtime to dirty but the wrong document to write: the other
    // novel's open text, into this one's file.
    const path = await openDemo()
    // Resolved now: once another novel is in front, titles resolve there.
    const seeded = SCENES.map(idOf)
    const [first] = seeded
    const partOneId = nodeTitled(PART_ONE).id
    await act(() => state().selectDoc(first))
    const original = (await api.readDoc(path, first)).body
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realSave = api.saveProject.bind(api)
    vi.spyOn(api, 'saveProject').mockImplementationOnce(async (p, data) => {
      await held
      await realSave(p, data)
    })
    const writes = vi.spyOn(api, 'writeDoc')

    const applying = state().applyBoardOrder(REVERSED.map(idOf), [{ id: first, x: 40, y: 50 }])
    // Save in flight; the writer clicks another novel's window...
    await act(() => state().openAnotherProject())
    const other = state().project!.path
    expect(other).not.toBe(path)
    // ...a clone, with the same scene open and its own text in it.
    const theirs: DocFile = { ...(await api.readDoc(path, first)), body: 'Their text, not ours' }
    useWyrm.setState({ activeId: first, activeDoc: theirs })
    await act(async () => {
      release()
      await applying
    })

    // Every write went to the project the order was applied to...
    expect(writes.mock.calls.map(([p]) => p)).toEqual([path])
    // ...carrying its own text, with the pin on it...
    const ours = await api.readDoc(path, first)
    expect(ours.body).toBe(original)
    expect(ours.meta).toMatchObject({ boardX: 40, boardY: 50 })
    // ...and the novel in front was not touched: not its open document...
    expect(state().activeDoc).toBe(theirs)
    // ...nor its checkpoint dirt, which belongs to the project saved.
    expect(__runtimeFor(path)?.commitDirty).toBe(true)
    expect(__runtimeFor(other)?.commitDirty).toBe(false)
    // The parked project's open document carries the pin, so refocusing
    // and saving does not put the old position back...
    expect(state().parked[path].activeDoc?.meta).toMatchObject({ boardX: 40, boardY: 50 })
    // ...and its undo was parked with it.
    expect(state().parked[path].boardUndo).toEqual([{ parentId: partOneId, ids: seeded }])
    expect(state().boardUndo).toBeNull()

    // Coming back restores both — SLICE_KEYS, demonstrated rather than
    // asserted as a constant.
    await act(() => state().focusProject(path))
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(REVERSED)
    expect(state().boardUndo).toEqual([{ parentId: partOneId, ids: seeded }])
    expect(state().activeDoc?.meta).toMatchObject({ boardX: 40, boardY: 50 })
  })
})

describe('the way back', () => {
  it('records only the folders Apply changed, each in its pre-apply order', async () => {
    await openDemo()
    const partOne = nodeTitled(PART_ONE)

    const record = await act(() => state().applyBoardOrder(REVERSED.map(idOf)))

    expect(record).toEqual([{ parentId: partOne.id, ids: SCENES.map(idOf) }])
    expect(state().boardUndo).toEqual(record)
  })

  it('is recorded before the write, so a save that throws still leaves one', async () => {
    await openDemo()
    vi.spyOn(api, 'saveProject').mockRejectedValueOnce(new Error('disk full'))
    const write = vi.spyOn(api, 'writeDoc')
    const [first] = SCENES.map(idOf)

    await expect(
      state().applyBoardOrder(REVERSED.map(idOf), [{ id: first, x: 40, y: 50 }])
    ).rejects.toThrow('disk full')

    // The binder is reordered in memory — and the way back is there.
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(REVERSED)
    expect(state().boardUndo?.[0]?.ids).toEqual(SCENES.map(idOf))
    // Nothing pinned for an order that never reached disk.
    expect(write).not.toHaveBeenCalled()
  })

  it('puts back the folder Apply changed and leaves one reordered by hand since alone', async () => {
    await openDemo()
    // Notes gets a second doc so it has an order of its own to keep.
    const notes = nodeTitled('Notes')
    await act(() => state().addDoc(notes.id))
    const added = state().activeId as string
    const timeline = idOf('Timeline')
    await act(() => state().applyBoardOrder(REVERSED.map(idOf)))
    // The writer reorders Notes by hand in between: Apply never touched it.
    await act(() => state().moveBinderNode(added, timeline, 'before'))
    expect((nodeTitled('Notes').children ?? []).map((n) => n.id)).toEqual([added, timeline])

    await act(() => state().undoBoardOrder())

    expect(childTitles(nodeTitled(PART_ONE))).toEqual(SCENES)
    expect((nodeTitled('Notes').children ?? []).map((n) => n.id)).toEqual([added, timeline])
    expect(state().boardUndo).toBeNull()
  })

  it('leaves scenes moved to another folder since where they were put', async () => {
    // Two of them, in the opposite order from the one Apply recorded: one
    // moved scene alone cannot tell the filter from its absence, since a
    // single ranked doc in a folder is dealt back into its own slot.
    await openDemo()
    const [a, b, c] = SCENES.map(idOf)
    const timeline = idOf('Timeline')
    await act(() => state().applyBoardOrder(REVERSED.map(idOf)))
    // Both dragged into Notes in between, b landing ahead of a.
    await act(() => state().moveBinderNode(a, timeline, 'after'))
    await act(() => state().moveBinderNode(b, timeline, 'after'))
    expect((nodeTitled('Notes').children ?? []).map((n) => n.id)).toEqual([timeline, b, a])

    await act(() => state().undoBoardOrder())

    // Part One has only its remaining scene...
    expect((nodeTitled(PART_ONE).children ?? []).map((n) => n.id)).toEqual([c])
    // ...and Notes keeps the order the writer gave it, not the pre-apply
    // a-before-b of a folder both have left.
    expect((nodeTitled('Notes').children ?? []).map((n) => n.id)).toEqual([timeline, b, a])
    expect(state().boardUndo).toBeNull()
  })

  it('leaves no redo behind when its own save throws', async () => {
    // Undo forgets the step before it applies, and the apply records its
    // own way back — a redo. One step is the promise, so that record has
    // to go whether or not the save landed; left behind, the button
    // offered an Undo that would have put the applied order back.
    await openDemo()
    await act(() => state().applyBoardOrder(REVERSED.map(idOf)))
    vi.spyOn(api, 'saveProject').mockRejectedValueOnce(new Error('disk full'))

    await expect(state().undoBoardOrder()).rejects.toThrow('disk full')

    expect(state().boardUndo).toBeNull()
    expect(childTitles(nodeTitled(PART_ONE))).toEqual(SCENES)
  })

  it('forgets the step on the project it undid, whichever is in front when the save lands', async () => {
    const path = await openDemo()
    const seeded = SCENES.map(idOf)
    await act(() => state().applyBoardOrder([...seeded].reverse()))
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realSave = api.saveProject.bind(api)
    vi.spyOn(api, 'saveProject').mockImplementationOnce(async (p, data) => {
      await held
      await realSave(p, data)
    })

    const undoing = state().undoBoardOrder()
    // Save in flight; another novel comes to the front, with an undo of
    // its own on the button.
    await act(() => state().openAnotherProject())
    const theirs = [{ parentId: '', ids: ['x', 'y'] }]
    useWyrm.setState({ boardUndo: theirs })
    await act(async () => {
      release()
      await undoing
    })

    // Theirs is untouched; the step is forgotten where it belongs.
    expect(state().boardUndo).toBe(theirs)
    expect(state().parked[path].boardUndo).toBeNull()
    const binder = state().parked[path].project!.data.binder
    expect(childTitles(nodeTitled(PART_ONE, binder))).toEqual(SCENES)
  })

  it('does not follow the writer into the next project', async () => {
    // A different project is a different undo. Left over, the record lit
    // the button in a novel nothing had been applied to — and in a clone or
    // a restored backup, which share the original's ids, pressing it would
    // have rewritten that copy's binder.
    const path = await openDemo()
    await act(() => state().applyBoardOrder(REVERSED.map(idOf)))
    expect(state().boardUndo).not.toBeNull()

    await act(() => state().newProject('Another Novel'))
    expect(state().project?.path).not.toBe(path)
    expect(state().boardUndo).toBeNull()

    await act(() => state().openRecentProject(path))
    expect(state().boardUndo).toBeNull()
  })

  it('is per project, parked and restored with the rest of its state', () => {
    // The one line nothing typechecks: a field left out of SLICE_KEYS is
    // shared between open projects instead of parked with its own.
    expect(SLICE_KEYS).toContain('boardUndo')
  })

  it('never reaches into the trash, even for two trashed scenes listed in reverse', async () => {
    await openDemo()
    const [a, b] = SCENES.map(idOf)
    await act(() => state().moveToTrash(a))
    await act(() => state().moveToTrash(b))
    const trashBefore = clone(state().project!.data.trash)
    const save = vi.spyOn(api, 'saveProject')

    expect(await act(() => state().applyBoardOrder([b, a]))).toBeNull()

    expect(state().project!.data.trash).toEqual(trashBefore)
    expect(save).not.toHaveBeenCalled()
  })
})
