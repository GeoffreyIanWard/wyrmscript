// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { Editor } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'
import { api } from '../src/renderer/src/lib/api'
import { markdownToDoc } from '../src/renderer/src/lib/markdown'
import { proseExtensions } from '../src/renderer/src/lib/proseKit'
import { useWyrm, __disposeAll, __runtimeFor } from '../src/renderer/src/store'

/**
 * F-51, the store side of the scratch pad: scraps written to the project
 * they belong to, a pad read as each project opens, a throw-away that makes
 * a save point first, and Move to Scratch Pad — which keeps the passage on
 * the page until it is safely on the pad.
 */

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  for (const s of await api.listScraps(demoPath)) await api.deleteScrap(demoPath, s.id)
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  return demoPath
}

const state = (): ReturnType<typeof useWyrm.getState> => useWyrm.getState()

let editor: Editor | null = null

/** A real page editor over `markdown`, put in the store as the page's. */
function mountPage(markdown: string): Editor {
  const element = document.createElement('div')
  document.body.appendChild(element)
  editor = new Editor({ element, extensions: proseExtensions(), content: markdownToDoc(markdown) })
  useWyrm.setState({ editor })
  return editor
}

/** Select the first occurrence of `text` on the page. */
function select(ed: Editor, text: string, through?: string): void {
  let from = -1
  let to = -1
  ed.state.doc.descendants((node, pos) => {
    if (!node.isText || node.text == null) return
    const at = node.text.indexOf(text)
    if (from === -1 && at !== -1) from = pos + at
    if (through) {
      const end = node.text.indexOf(through)
      if (end !== -1) to = pos + end + through.length
    } else if (from !== -1 && to === -1) to = from + text.length
  })
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, from, to)))
}

const pageText = (ed: Editor): string => ed.state.doc.textBetween(0, ed.state.doc.content.size, '|')

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  editor?.destroy()
  editor = null
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    editor: null,
    scraps: []
  })
  __disposeAll()
})

describe('scraps on the pad', () => {
  it('adds one to the project at its path, says where it came from, and marks that project unsaved', async () => {
    const path = await openDemo()
    __runtimeFor(path)!.commitDirty = false
    const scrap = await act(() =>
      state().addScrapAt(path, { body: 'Kept.\n', how: 'cut', fromDoc: 'd1', fromTitle: 'Ch' })
    )
    expect(scrap).toMatchObject({ body: 'Kept.\n', how: 'cut', fromDoc: 'd1', fromTitle: 'Ch' })
    expect((await api.listScraps(path)).map((s) => s.id)).toEqual([scrap.id])
    expect(state().scraps.map((s) => s.id)).toEqual([scrap.id])
    expect(__runtimeFor(path)!.commitDirty).toBe(true)
  })

  it('writes a note with no how and no source', async () => {
    const path = await openDemo()
    const scrap = await act(() => state().addScrapAt(path, { body: '' }))
    expect('how' in scrap).toBe(false)
    expect('fromDoc' in scrap).toBe(false)
    expect('fromTitle' in scrap).toBe(false)
  })

  it('reads the pad as a project opens, and the next project opened has its own', async () => {
    const path = await openDemo()
    const now = new Date().toISOString()
    await api.writeScrap(path, {
      id: 'waiting',
      body: 'Here before.\n',
      created: now,
      modified: now
    })
    await act(async () => {
      await state().openRecentProject(path)
    })
    expect(state().scraps.map((s) => s.id)).toEqual(['waiting'])

    await act(() => state().openAnotherProject())
    expect(state().project!.path).not.toBe(path)
    expect(state().scraps).toEqual([])
    // The demo's pad went with its parked slice.
    expect(state().parked[path].scraps.map((s) => s.id)).toEqual(['waiting'])
  })

  it('re-reads the pad after a sync brings work in, so a scrap kept on the other computer shows', async () => {
    await openDemo()
    vi.spyOn(api, 'getSyncStatus').mockResolvedValue({
      mode: 'github',
      remoteUrl: 'https://github.com/someone/novel.git',
      lastSyncAt: null,
      login: 'someone',
      clientIdSet: true
    } as Awaited<ReturnType<typeof api.getSyncStatus>>)
    vi.spyOn(api, 'syncNow').mockImplementation(async (p) => {
      const now = new Date().toISOString()
      await api.writeScrap(p, {
        id: 'arrived',
        body: 'From the laptop.\n',
        created: now,
        modified: now
      })
      return { status: 'pulled', at: Date.now(), pushed: true }
    })
    await act(async () => {
      await state().loadSyncStatus()
      await state().syncNow(true)
    })
    expect(state().scraps.map((s) => s.id)).toEqual(['arrived'])
  })

  it('rewrites a scrap’s text, and writes nothing when only the final newline differs', async () => {
    const path = await openDemo()
    const scrap = await act(() => state().addScrapAt(path, { body: 'Same words.\n' }))
    const writes = vi.spyOn(api, 'writeScrap')
    await act(() => state().updateScrapAt(path, scrap.id, 'Same words.'))
    expect(writes).not.toHaveBeenCalled()
    await act(() => state().updateScrapAt(path, scrap.id, 'New words.'))
    expect(writes).toHaveBeenCalledTimes(1)
    expect((await api.listScraps(path))[0].body).toBe('New words.\n')
    expect(state().scraps[0].body).toBe('New words.')
  })

  it('never brings a scrap back by writing it after it was thrown away', async () => {
    const path = await openDemo()
    const scrap = await act(() => state().addScrapAt(path, { body: 'Going.\n' }))
    await act(() => state().throwAwayScrapAt(path, scrap.id))
    await act(() => state().updateScrapAt(path, scrap.id, 'A late save.'))
    expect(await api.listScraps(path)).toEqual([])
    expect(state().scraps).toEqual([])
  })

  it('keeps a save that was already queued from landing after the throw-away', async () => {
    const path = await openDemo()
    const scrap = await act(() => state().addScrapAt(path, { body: 'Going.\n' }))
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const real = api.writeScrap.bind(api)
    vi.spyOn(api, 'writeScrap').mockImplementation(async (p, s) => {
      await held
      await real(p, s)
    })
    const saving = state().updateScrapAt(path, scrap.id, 'Edited just before.')
    const throwing = state().throwAwayScrapAt(path, scrap.id)
    await act(async () => {
      release()
      await Promise.all([saving, throwing])
    })
    expect(await api.listScraps(path)).toEqual([])
  })

  it('never writes a save that queued behind the throw-away once the scrap is gone', async () => {
    const path = await openDemo()
    const scrap = await act(() => state().addScrapAt(path, { body: 'Going.\n' }))
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    let deleting!: () => void
    const started = new Promise<void>((r) => (deleting = r))
    const real = api.deleteScrap.bind(api)
    vi.spyOn(api, 'deleteScrap').mockImplementation(async (p, id) => {
      deleting()
      await held
      await real(p, id)
    })
    const throwing = state().throwAwayScrapAt(path, scrap.id)
    await started
    // The scrap is still on the pad while it is being taken off, so this
    // save passes its first look and waits its turn behind the delete.
    const saving = state().updateScrapAt(path, scrap.id, 'Typed as it went.')
    await act(async () => {
      release()
      await Promise.all([throwing, saving])
    })
    expect(await api.listScraps(path)).toEqual([])
  })

  it('makes a save point before throwing a scrap away, so it stays in the history', async () => {
    const path = await openDemo()
    const scrap = await act(() => state().addScrapAt(path, { body: 'Keep me in history.\n' }))
    const order: string[] = []
    const realCommit = api.commit.bind(api)
    vi.spyOn(api, 'commit').mockImplementation(async (p, m) => {
      order.push(`commit:${(await api.listScraps(p)).length}`)
      return realCommit(p, m)
    })
    const realDelete = api.deleteScrap.bind(api)
    vi.spyOn(api, 'deleteScrap').mockImplementation(async (p, id) => {
      order.push('delete')
      return realDelete(p, id)
    })
    await act(() => state().throwAwayScrapAt(path, scrap.id))
    // The save point was made while the scrap was still on the pad.
    expect(order).toEqual(['commit:1', 'delete'])
    expect(state().scraps).toEqual([])
  })

  it('drops a blank New Note without a save point, and leaves a scrap with words alone', async () => {
    const path = await openDemo()
    const blank = await act(() => state().addScrapAt(path, { body: '' }))
    const worded = await act(() => state().addScrapAt(path, { body: 'Words.\n' }))
    const commits = vi.spyOn(api, 'commit')
    await act(() => state().discardEmptyScrapAt(path, blank.id))
    await act(() => state().discardEmptyScrapAt(path, worded.id))
    expect(commits).not.toHaveBeenCalled()
    expect((await api.listScraps(path)).map((s) => s.id)).toEqual([worded.id])
  })
})

describe('the pad as a view', () => {
  it('is a detour: Esc’s goBack returns to the page it was opened from', async () => {
    await openDemo()
    expect(state().mainView.kind).toBe('doc')
    act(() => state().showScratchPad())
    expect(state().mainView).toEqual({ kind: 'scratch' })
    let went = false
    act(() => {
      went = state().goBack()
    })
    expect(went).toBe(true)
    expect(state().mainView.kind).toBe('doc')
  })

  it('carries a scrap to bring into view once, without stacking another visit to the pad', async () => {
    await openDemo()
    act(() => state().showScratchPad())
    const depth = state().viewHistory.length
    act(() => state().showScratchPad('abc'))
    expect(state().mainView).toEqual({ kind: 'scratch', focus: 'abc' })
    expect(state().viewHistory).toHaveLength(depth)
    act(() => state().settleScratchFocus())
    expect(state().mainView).toEqual({ kind: 'scratch' })
  })
})

describe('Move to Scratch Pad', () => {
  it('does nothing without a selection', async () => {
    const path = await openDemo()
    const ed = mountPage('One two three.')
    const writes = vi.spyOn(api, 'writeScrap')
    expect(await act(() => state().moveToScratchPad())).toBe('empty')
    expect(writes).not.toHaveBeenCalled()
    expect(pageText(ed)).toBe('One two three.')
    expect(await api.listScraps(path)).toEqual([])
  })

  it('puts the selection on the pad as stored Markdown, then takes it off the page', async () => {
    const path = await openDemo()
    const ed = mountPage('One **two** three four.')
    select(ed, 'two', 'three')
    expect(await act(() => state().moveToScratchPad())).toBe('moved')
    const [scrap] = await api.listScraps(path)
    expect(scrap.body).toBe('**two** three\n')
    expect(scrap).toMatchObject({
      how: 'cut',
      fromDoc: state().activeDoc!.meta.id,
      fromTitle: state().activeDoc!.meta.title
    })
    expect(pageText(ed)).toBe('One  four.')
  })

  it('keeps paragraphs as paragraphs', async () => {
    const path = await openDemo()
    const ed = mountPage('First para.\n\nSecond para.\n\nThird.')
    select(ed, 'First', 'Second para.')
    expect(await act(() => state().moveToScratchPad())).toBe('moved')
    expect((await api.listScraps(path))[0].body).toBe('First para.\n\nSecond para.\n')
    expect(pageText(ed)).toContain('Third.')
    expect(pageText(ed)).not.toContain('First')
  })

  it('leaves the passage on the page when it cannot be put on the pad', async () => {
    await openDemo()
    const ed = mountPage('Do not lose this.')
    select(ed, 'lose')
    vi.spyOn(api, 'writeScrap').mockRejectedValue(new Error('disk full'))
    await expect(act(() => state().moveToScratchPad())).rejects.toThrow('disk full')
    expect(pageText(ed)).toBe('Do not lose this.')
  })

  it('takes off the same passage when the writer typed before it during the write', async () => {
    const path = await openDemo()
    const ed = mountPage('Keep this. Cut this. Keep that.')
    select(ed, 'Cut this.')
    const real = api.writeScrap.bind(api)
    vi.spyOn(api, 'writeScrap').mockImplementation(async (p, s) => {
      ed.commands.insertContentAt(1, 'Typed. ')
      await real(p, s)
    })
    expect(await act(() => state().moveToScratchPad())).toBe('moved')
    expect((await api.listScraps(path))[0].body).toBe('Cut this.\n')
    expect(pageText(ed)).toBe('Typed. Keep this.  Keep that.')
  })

  it('leaves the page alone when the passage itself was edited during the write', async () => {
    const path = await openDemo()
    const ed = mountPage('Keep this. Cut this. Keep that.')
    select(ed, 'Cut this.')
    const real = api.writeScrap.bind(api)
    vi.spyOn(api, 'writeScrap').mockImplementation(async (p, s) => {
      // "Cut this." becomes "Cut all this." — what is on the pad is no
      // longer what is on the page.
      let at = -1
      ed.state.doc.descendants((n, pos) => {
        if (n.isText && n.text && at === -1) at = pos + n.text.indexOf('this.', 12)
      })
      ed.commands.insertContentAt(at, 'all ')
      await real(p, s)
    })
    expect(await act(() => state().moveToScratchPad())).toBe('kept')
    expect((await api.listScraps(path))[0].body).toBe('Cut this.\n')
    expect(pageText(ed)).toBe('Keep this. Cut all this. Keep that.')
  })

  it('leaves the page alone when another document came forward during the write', async () => {
    const path = await openDemo()
    const ed = mountPage('Keep this. Cut this.')
    select(ed, 'Cut this.')
    const real = api.writeScrap.bind(api)
    vi.spyOn(api, 'writeScrap').mockImplementation(async (p, s) => {
      useWyrm.setState({ editor: null })
      await real(p, s)
    })
    expect(await act(() => state().moveToScratchPad())).toBe('kept')
    expect(await api.listScraps(path)).toHaveLength(1)
    expect(pageText(ed)).toBe('Keep this. Cut this.')
  })
})
