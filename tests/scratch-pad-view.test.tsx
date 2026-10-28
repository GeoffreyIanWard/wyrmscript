// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import type { Scrap } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { padOrder, scrapOrigin, scrapSource } from '../src/renderer/src/lib/scratchPad'
import { searchProject } from '../src/renderer/src/lib/search'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { ScratchPad } from '../src/renderer/src/components/ScratchPad'
import { Binder } from '../src/renderer/src/components/Binder'

/**
 * F-51, the scratch pad as the writer meets it: a binder entry with a count,
 * the pad itself (newest on top, each scrap saying where it came from, every
 * one writable and copyable), New Note, Throw Away after asking, and the two
 * ways in from the page — Edit → Move to Scratch Pad and ⇧⌘X.
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

async function keep(fields: Partial<Scrap> & { body: string }, created?: string): Promise<Scrap> {
  const scrap = await act(() => state().addScrapAt(state().project!.path, fields))
  if (!created) return scrap
  // An older scrap, for ordering.
  const dated = { ...scrap, created }
  await api.writeScrap(state().project!.path, dated)
  await act(() => state().loadScraps())
  return dated
}

/** The editor inside a sheet (TipTap hangs it on its own DOM). */
function sheetEditor(id: string): Editor {
  const dom = document.querySelector(`[data-scrap="${id}"] .scrap-text`) as HTMLElement & {
    editor: Editor
  }
  return dom.editor
}

const sheetIds = (): string[] =>
  [...document.querySelectorAll('[data-scrap]')].map((el) => (el as HTMLElement).dataset.scrap!)

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
    scraps: [],
    mainView: { kind: 'doc' },
    viewHistory: []
  })
  __disposeAll()
})

describe('the words for a scrap', () => {
  const base: Scrap = { id: 'a', body: 'x', created: '2026-10-28T10:00:00.000Z', modified: '' }

  it('says how it came to the pad', () => {
    expect(scrapOrigin({ ...base, how: 'cut', fromTitle: 'The Ferry' })).toBe(
      'Cut from “The Ferry”'
    )
    expect(scrapOrigin({ ...base, how: 'local', fromTitle: 'The Ferry' })).toBe(
      'Kept from “The Ferry”, as written on this computer'
    )
    expect(scrapOrigin({ ...base, how: 'incoming', fromTitle: 'The Ferry' })).toBe(
      'Kept from “The Ferry”, as written on your other computer'
    )
    expect(scrapOrigin({ ...base, how: 'cut' })).toBe('Cut from a chapter')
    expect(scrapOrigin(base)).toBe('A note')
  })

  it('puts the newest on top, and two from one moment in a stable order', () => {
    const older = { ...base, id: 'b', created: '2026-10-27T10:00:00.000Z' }
    const twinA = { ...base, id: 'c', created: '2026-10-28T11:00:00.000Z' }
    const twinB = { ...base, id: 'd', created: '2026-10-28T11:00:00.000Z' }
    expect(padOrder([older, twinB, base, twinA]).map((s) => s.id)).toEqual(['c', 'd', 'a', 'b'])
  })

  it('offers the way back only to a document still in the binder', () => {
    const binder = [{ id: 'here', type: 'doc' as const, title: 'Here' }]
    expect(scrapSource({ ...base, fromDoc: 'here' }, binder)).toBe('here')
    expect(scrapSource({ ...base, fromDoc: 'trashed' }, binder)).toBeNull()
    expect(scrapSource(base, binder)).toBeNull()
  })
})

describe('the binder entry', () => {
  it('sits in the binder with a count, and opens the pad as a detour', async () => {
    await openDemo()
    render(<Binder />)
    const row = document.querySelector('[data-node-type="scratch"]') as HTMLElement
    expect(row.textContent).toBe('Scratch Pad')
    await keep({ body: 'One.\n' })
    await keep({ body: 'Two.\n' })
    expect(row.querySelector('.entity-count')?.textContent).toBe('2')
    act(() => fireEvent.click(row))
    expect(state().mainView.kind).toBe('scratch')
    expect(row.classList.contains('selected')).toBe(true)
    expect(state().viewHistory.at(-1)?.kind).toBe('doc')
  })
})

describe('the pad', () => {
  it('says what it is for when there is nothing on it', async () => {
    await openDemo()
    render(<ScratchPad />)
    expect(document.querySelector('.scratch-empty')?.textContent).toMatch(/Move to Scratch Pad/)
  })

  it('shows every scrap, newest on top, saying where it came from', async () => {
    await openDemo()
    const old = await keep(
      { body: 'Old cut.\n', how: 'cut', fromTitle: 'Chapter One' },
      '2020-01-01T00:00:00.000Z'
    )
    const recent = await keep({ body: 'A newer **note**.\n' })
    render(<ScratchPad />)
    expect(sheetIds()).toEqual([recent.id, old.id])
    const top = document.querySelector(`[data-scrap="${recent.id}"]`)!
    expect(top.querySelector('.scrap-head')?.textContent).toMatch(/^A note/)
    // The text is the page's own kind: bold is bold, ready to copy back.
    expect(top.querySelector('.scrap-text strong')?.textContent).toBe('note')
    expect(document.querySelector(`[data-scrap="${old.id}"] .scrap-head`)?.textContent).toMatch(
      /^Cut from “Chapter One”/
    )
  })

  it('writes what is typed on a sheet, to the project it was typed in, as the sheet goes', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'Before.\n' })
    const { unmount } = render(<ScratchPad />)
    act(() => {
      sheetEditor(scrap.id).commands.setContent('<p>After, typed on the pad.</p>')
    })
    // Not yet written (the save waits for typing to settle)…
    expect((await api.listScraps(path))[0].body).toBe('Before.\n')
    // …but leaving the pad writes it at once, not when the wait is up: quitting
    // waits only for writes already under way, and a timer is not one.
    await act(async () => unmount())
    await act(async () => {})
    expect((await api.listScraps(path))[0].body).toBe('After, typed on the pad.\n')
  })

  it('writes typing once it settles, without leaving', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'Before.\n' })
    render(<ScratchPad />)
    act(() => {
      sheetEditor(scrap.id).commands.setContent('<p>Settled.</p>')
    })
    await waitFor(async () => expect((await api.listScraps(path))[0].body).toBe('Settled.\n'))
  })

  it('New Note puts a blank sheet on top with the caret in it, and drops it if left blank', async () => {
    const path = await openDemo()
    const kept = await keep({ body: 'Already here.\n' })
    render(<ScratchPad />)
    await act(async () => fireEvent.click(screen.getByText('New Note')))
    const [top] = sheetIds()
    expect(top).not.toBe(kept.id)
    await waitFor(() => expect(sheetEditor(top).isFocused).toBe(true))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    await act(async () => {
      sheetEditor(top).commands.blur()
    })
    await waitFor(() => expect(sheetIds()).toEqual([kept.id]))
    expect((await api.listScraps(path)).map((s) => s.id)).toEqual([kept.id])
  })

  it('leaves the caret where the writer clicked when a blank New Note is dropped', async () => {
    await openDemo()
    const kept = await keep({ body: 'Already here.\n' })
    render(<ScratchPad />)
    await act(async () => fireEvent.click(screen.getByText('New Note')))
    const [top] = sheetIds()
    await waitFor(() => expect(sheetEditor(top).isFocused).toBe(true))
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    // Chromium lets a focus() made during the blur win (the preview showed
    // New Note taking it); jsdom finishes the writer's own change last. So
    // the test asks the question directly: New Note is never focused.
    const stolen = vi.spyOn(screen.getByText('New Note'), 'focus')
    // The writer clicks into the other sheet to write there.
    await act(async () => {
      sheetEditor(kept.id).view.focus()
    })
    await waitFor(() => expect(sheetIds()).toEqual([kept.id]))
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(stolen).not.toHaveBeenCalled()
    expect(sheetEditor(kept.id).isFocused).toBe(true)
  })

  it('keeps a New Note once it has words in it', async () => {
    const path = await openDemo()
    render(<ScratchPad />)
    await act(async () => fireEvent.click(screen.getByText('New Note')))
    const [top] = sheetIds()
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    act(() => {
      sheetEditor(top).commands.setContent('<p>A thought.</p>')
    })
    await act(async () => {
      sheetEditor(top).commands.blur()
    })
    await waitFor(async () => expect((await api.listScraps(path))[0].body).toBe('A thought.\n'))
    expect(sheetIds()).toEqual([top])
  })

  it('does not drop a blank New Note when the window loses focus — the writer is coming back', async () => {
    const path = await openDemo()
    render(<ScratchPad />)
    await act(async () => fireEvent.click(screen.getByText('New Note')))
    const [top] = sheetIds()
    await waitFor(() => expect(sheetEditor(top).isFocused).toBe(true))
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await act(async () => {
      sheetEditor(top).commands.blur()
    })
    // TipTap blurs a frame later; let it, and anything it set off, land.
    await waitFor(() => expect(sheetEditor(top).isFocused).toBe(false))
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect(sheetIds()).toEqual([top])
    expect(await api.listScraps(path)).toHaveLength(1)
  })

  it('lets New Note make another once the last one has words in it', async () => {
    const path = await openDemo()
    render(<ScratchPad />)
    await act(async () => fireEvent.click(screen.getByText('New Note')))
    const [first] = sheetIds()
    act(() => {
      sheetEditor(first).commands.setContent('<p>A thought.</p>')
    })
    await act(async () => fireEvent.click(screen.getByText('New Note')))
    await waitFor(() => expect(sheetIds()).toHaveLength(2))
    expect(sheetIds()[1]).toBe(first)
    await waitFor(async () => expect(await api.listScraps(path)).toHaveLength(2))
  })

  it('takes the other computer’s version of a scrap even with the caret in it, and the blur never writes the old one back', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'Old words.\n' })
    render(<ScratchPad />)
    act(() => {
      sheetEditor(scrap.id).commands.focus()
    })
    await waitFor(() => expect(sheetEditor(scrap.id).isFocused).toBe(true))
    // A sync brings the laptop's version in.
    await api.writeScrap(path, { ...scrap, body: 'Laptop words.\n' })
    await act(() => state().loadScraps())
    expect(sheetEditor(scrap.id).getText()).toBe('Laptop words.')
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    await act(async () => {
      sheetEditor(scrap.id).commands.blur()
    })
    await waitFor(() => expect(sheetEditor(scrap.id).isFocused).toBe(false))
    await act(() => new Promise((r) => setTimeout(r, 30)))
    expect((await api.listScraps(path))[0].body).toBe('Laptop words.\n')
  })

  it('never shows its own older write as it lands under newer typing', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'Start.\n' })
    render(<ScratchPad />)
    const gates: (() => void)[] = []
    const real = api.writeScrap.bind(api)
    vi.spyOn(api, 'writeScrap').mockImplementation(async (p, s) => {
      await new Promise<void>((r) => gates.push(r))
      await real(p, s)
    })
    act(() => {
      sheetEditor(scrap.id).commands.setContent('<p>First.</p>')
    })
    const one = state().flushSave()
    act(() => {
      sheetEditor(scrap.id).commands.setContent('<p>First. Second.</p>')
    })
    const two = state().flushSave()
    await waitFor(() => expect(gates).toHaveLength(1))
    // The first write lands while the second still waits its turn.
    await act(async () => {
      gates[0]()
      await one
    })
    expect(sheetEditor(scrap.id).getText()).toBe('First. Second.')
    await waitFor(() => expect(gates).toHaveLength(2))
    await act(async () => {
      gates[1]()
      await two
    })
    expect(sheetEditor(scrap.id).getText()).toBe('First. Second.')
    expect((await api.listScraps(path))[0].body).toBe('First. Second.\n')
  })

  it('writes waiting typing whenever the page is flushed, so a sync never runs ahead of it', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'Before.\n' })
    render(<ScratchPad />)
    act(() => {
      sheetEditor(scrap.id).commands.setContent('<p>Typed just now.</p>')
    })
    await act(() => state().flushSave())
    expect((await api.listScraps(path))[0].body).toBe('Typed just now.\n')
  })

  it('keeps a scrap whose newest text failed to write, rather than throwing it away', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'On disk.\n' })
    render(<ScratchPad />)
    act(() => {
      sheetEditor(scrap.id).commands.setContent('<p>Only on screen.</p>')
    })
    vi.spyOn(api, 'writeScrap').mockRejectedValue(new Error('disk full'))
    const commits = vi.spyOn(api, 'commit')
    fireEvent.click(screen.getByText('Throw Away…'))
    await act(async () => fireEvent.click(screen.getByText('Throw Away')))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/disk full/))
    expect(sheetIds()).toEqual([scrap.id])
    expect(commits).not.toHaveBeenCalled()
    expect(await api.listScraps(path)).toHaveLength(1)
    expect(sheetEditor(scrap.id).getText()).toBe('Only on screen.')
  })

  it('throws a scrap away only after asking, and Keep keeps it', async () => {
    const path = await openDemo()
    const scrap = await keep({ body: 'Maybe.\n' })
    render(<ScratchPad />)
    fireEvent.click(screen.getByText('Throw Away…'))
    expect(screen.getByRole('group', { name: 'Throw this away?' }).textContent).toMatch(/history/)
    fireEvent.click(screen.getByText('Keep'))
    expect(screen.queryByRole('group', { name: 'Throw this away?' })).toBeNull()
    expect(sheetIds()).toEqual([scrap.id])

    const commits = vi.spyOn(api, 'commit')
    fireEvent.click(screen.getByText('Throw Away…'))
    await act(async () => fireEvent.click(screen.getByText('Throw Away')))
    await waitFor(() => expect(sheetIds()).toEqual([]))
    expect(commits).toHaveBeenCalled()
    expect(await api.listScraps(path)).toEqual([])
  })

  it('goes back to the chapter a scrap was cut from, while it is in the binder', async () => {
    await openDemo()
    const docs = state().project!.data.binder.flatMap(function all(n): (typeof n)[] {
      return [n, ...(n.children ?? []).flatMap(all)]
    })
    const target = docs.filter((n) => n.type === 'doc').at(-1)!
    await keep({ body: 'From there.\n', how: 'cut', fromDoc: target.id, fromTitle: target.title })
    await keep({ body: 'From nowhere.\n', how: 'cut', fromDoc: 'gone', fromTitle: 'Gone' })
    render(<ScratchPad />)
    expect(screen.queryByText('Go to “Gone”')).toBeNull()
    await act(async () => fireEvent.click(screen.getByText(`Go to “${target.title}”`)))
    expect(state().activeId).toBe(target.id)
    expect(state().mainView.kind).toBe('doc')
  })

  it('brings a scrap a search found into view, with the caret in it, once', async () => {
    await openDemo()
    const a = await keep({ body: 'First.\n' })
    const b = await keep({ body: 'Second.\n' })
    act(() => state().showScratchPad(a.id))
    render(<ScratchPad />)
    await waitFor(() => expect(sheetEditor(a.id).isFocused).toBe(true))
    expect(sheetEditor(b.id).isFocused).toBe(false)
    expect(state().mainView).toEqual({ kind: 'scratch' })
  })
})

describe('finding a scrap', () => {
  it('searches the pad, naming each hit by where it came from', () => {
    const scrap: Scrap = {
      id: 's1',
      body: 'The lantern **swung** low.\n',
      created: '2026-10-28T10:00:00.000Z',
      modified: '',
      how: 'cut',
      fromTitle: 'Saltmarsh'
    }
    const hits = searchProject('lantern swung', [], [], [], [scrap])
    expect(hits).toEqual([
      expect.objectContaining({
        kind: 'scrap',
        id: 's1',
        title: 'Cut from “Saltmarsh”',
        subtitle: 'Scratch Pad',
        total: 1
      })
    ])
  })
})

describe('from the page', () => {
  async function renderApp(): Promise<void> {
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
    await waitFor(() => expect(state().editor).not.toBeNull())
    // The page puts the caret at the end a frame after it opens; selecting
    // before that frame would be undone by it.
    await act(() => new Promise((r) => setTimeout(r, 50)))
  }

  const pageText = (): string => state().editor!.state.doc.textContent

  /** Select the page's first `n` characters. */
  function selectStart(n: number): string {
    const editor = state().editor!
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 1 + n })
    })
    return editor.state.doc.textBetween(1, 1 + n)
  }

  const editItem = (): HTMLButtonElement | undefined =>
    [...document.querySelectorAll<HTMLButtonElement>('.menu-drop .menu-item')].find((i) =>
      i.textContent?.startsWith('Move to Scratch Pad')
    )

  async function openEdit(): Promise<void> {
    const overlay = document.querySelector('.menu-overlay')
    if (overlay) await act(async () => fireEvent.mouseDown(overlay))
    const title = [...document.querySelectorAll('.menu-title')].find(
      (t) => t.textContent === 'Edit'
    ) as HTMLElement
    await act(async () => fireEvent.mouseDown(title))
  }

  it('Edit → Move to Scratch Pad is live exactly when there is a selection', async () => {
    const path = await openDemo()
    await renderApp()
    await openEdit()
    expect(editItem()?.disabled).toBe(true)
    const taken = selectStart(5)
    await openEdit()
    expect(editItem()?.disabled).toBe(false)
    // Menu items run on the press, as the bar's do.
    await act(async () => fireEvent.mouseDown(editItem()!))
    await waitFor(async () => expect(await api.listScraps(path)).toHaveLength(1))
    expect((await api.listScraps(path))[0].body.trim()).toBe(taken.trim())
  })

  it('⇧⌘X moves the selection; ⌘X with Caps Lock (an "X" without Shift) never does', async () => {
    const path = await openDemo()
    await renderApp()
    selectStart(5)
    await act(async () => {
      fireEvent.keyDown(window, { key: 'X', code: 'KeyX', metaKey: true })
    })
    expect(await api.listScraps(path)).toHaveLength(0)
    await act(async () => {
      fireEvent.keyDown(window, { key: 'x', metaKey: true, shiftKey: true })
    })
    await waitFor(async () => expect(await api.listScraps(path)).toHaveLength(1))
    expect((await api.listScraps(path))[0].how).toBe('cut')
  })

  it('does nothing from a tag field, where the page keeps a selection nobody can see', async () => {
    const path = await openDemo()
    await renderApp()
    const before = pageText()
    selectStart(5)
    const tag = document.querySelector('.tag-input') as HTMLInputElement
    act(() => tag.focus())
    await act(async () => {
      fireEvent.keyDown(tag, { key: 'x', metaKey: true, shiftKey: true })
    })
    expect(await api.listScraps(path)).toHaveLength(0)
    expect(pageText()).toBe(before)
    expect(document.activeElement).toBe(tag)
    // Nor from the menu: with the selection hidden, the item is off.
    await openEdit()
    expect(editItem()?.disabled).toBe(true)
  })

  it('moves once for a held key, not once per repeat', async () => {
    const path = await openDemo()
    await renderApp()
    selectStart(5)
    await act(async () => {
      fireEvent.keyDown(window, { key: 'x', metaKey: true, shiftKey: true, repeat: true })
    })
    expect(await api.listScraps(path)).toHaveLength(0)
  })

  it('Edit → Bold, Undo and the rest act on the pad’s sheet while the pad is up, and are off elsewhere', async () => {
    await openDemo()
    const scrap = await keep({ body: 'Make me bold.\n' })
    await renderApp()
    act(() => state().showCorkboard())
    await openEdit()
    const item = (label: string): HTMLButtonElement | undefined =>
      [...document.querySelectorAll<HTMLButtonElement>('.menu-drop .menu-item')].find((i) =>
        i.textContent?.startsWith(label)
      )
    // Nothing to act on here, and the menu says so.
    expect(item('Bold')?.disabled).toBe(true)
    expect(item('Undo')?.disabled).toBe(true)

    act(() => state().showScratchPad())
    await waitFor(() => expect(document.querySelector(`[data-scrap="${scrap.id}"]`)).not.toBeNull())
    const sheet = sheetEditor(scrap.id)
    act(() => {
      sheet.commands.focus()
      sheet.commands.setTextSelection({ from: 1, to: 5 })
    })
    // TipTap focuses a frame later; the sheet becomes Edit's when it does.
    await waitFor(() => expect(state().padEditor).toBe(sheet))
    await openEdit()
    expect(item('Bold')?.disabled).toBe(false)
    await act(async () => fireEvent.mouseDown(item('Bold')!))
    expect(
      document.querySelector(`[data-scrap="${scrap.id}"] .scrap-text strong`)?.textContent
    ).toBe('Make')
  })
})
