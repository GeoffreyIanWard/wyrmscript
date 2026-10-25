// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocFile, DocMeta } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll, __runtimeFor } from '../src/renderer/src/store'
import { Corkboard } from '../src/renderer/src/components/Corkboard'

/**
 * F-42, the back of the card, on the board: turning a card over, Enter
 * turning to the next one, closing never losing anything, and the front of
 * the card showing what the back says.
 */

const BACK_KEYS = ['synopsis', 'act', 'sceneType', 'location', 'conflict', 'cast'] as const

let demoPath: string | null = null
/** Every document as the demo shipped it, taken on first open. */
let seeded: DocFile[] | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  // Documents outlive a test in the mock, and these tests blank bodies and
  // write backs, so every document is put back as the demo shipped it —
  // body and all — and then untagged, before the project opens.
  seeded ??= await api.readAllDocs(demoPath)
  for (const d of seeded) {
    const meta: DocMeta = { ...d.meta, tags: [] }
    for (const k of BACK_KEYS) delete meta[k]
    await api.writeDoc(demoPath, { ...d, meta })
  }
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  // No active document: the open document's in-memory copy would otherwise
  // be the store's source for it, stale against the api writes above.
  useWyrm.setState({ activeId: null, activeDoc: null })
  return demoPath
}

async function tagScenes(path: string, howMany: number): Promise<DocFile[]> {
  const docs = (await api.readAllDocs(path)).slice(0, howMany)
  for (const d of docs) await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
  return docs
}

async function renderBoard(): Promise<void> {
  const noop = (): void => {}
  await act(async () => {
    render(
      <Corkboard
        onTimeline={noop}
        onPlotGraph={noop}
        onPlotlines={noop}
        onCharacterGraph={noop}
        onWorldMap={noop}
      />
    )
  })
  await waitFor(() => expect(document.querySelector('.corkboard')).toBeTruthy())
}

const titles = (): string[] =>
  [...document.querySelectorAll('.scene-card-title')].map((t) => t.textContent ?? '')

const cardByTitle = (title: string): HTMLElement =>
  [...document.querySelectorAll('.scene-card')].find(
    (c) => c.querySelector('.scene-card-title')?.textContent === title
  ) as HTMLElement

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** The dog-ear: "Turn X over", or "Turn X over, outlined" once it has a back. */
const turnButton = (title: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^Turn ${escape(title)} over`) })

const turnOver = async (title: string): Promise<HTMLElement> => {
  await act(async () => {
    fireEvent.click(turnButton(title))
  })
  return screen.getByRole('dialog', { name: `Back of ${title}` })
}

const field = (label: string): HTMLInputElement =>
  screen.getByLabelText(label, { selector: 'input, textarea, select' })

const type = (el: HTMLElement, value: string): void => {
  fireEvent.change(el, { target: { value } })
}

const metaOf = async (path: string, title: string): Promise<DocMeta> =>
  (await api.readAllDocs(path)).find((d) => d.meta.title === title)!.meta

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('the back of the card', () => {
  let path: string
  let scenes: string[]
  beforeEach(async () => {
    path = await openDemo()
    scenes = (await tagScenes(path, 3)).map((d) => d.meta.title)
    await renderBoard()
    await waitFor(() => expect(titles()).toHaveLength(3))
  })

  it('turns a card over, and writes what is on its back to the scene', async () => {
    const [first] = scenes
    const back = await turnOver(first)
    expect(back.textContent).toContain(`1 of 3`)

    type(field('Synopsis'), 'Reed comes for the ledger.')
    type(field('Act'), 'II')
    type(field('Scene type'), 'Confrontation')
    type(field('Conflict'), 'Reed wants it; Maren will not open.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(await metaOf(path, first)).toMatchObject({
      synopsis: 'Reed comes for the ledger.',
      act: 'II',
      sceneType: 'Confrontation',
      conflict: 'Reed wants it; Maren will not open.'
    })
    // The front says so: the line, and a dark corner.
    await waitFor(() =>
      expect(cardByTitle(first).querySelector('.scene-card-outline')?.textContent).toBe(
        'Act II · Confrontation'
      )
    )
    expect(cardByTitle(first).querySelector('.scene-card-turn.written')).toBeTruthy()
  })

  it('shows an unwritten scene its synopsis where the opening would be', async () => {
    // The demo's third scene has prose; give the board an empty one.
    const [first] = scenes
    const doc = (await api.readAllDocs(path)).find((d) => d.meta.title === first)!
    await api.writeDoc(path, { ...doc, body: '' })
    cleanup()
    await renderBoard()
    await waitFor(() => expect(cardByTitle(first).textContent).toContain('Not written yet.'))

    await turnOver(first)
    type(field('Synopsis'), 'Reed comes for the ledger.')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })

    await waitFor(() =>
      expect(cardByTitle(first).querySelector('.scene-card-synopsis')?.textContent).toBe(
        'Reed comes for the ledger.'
      )
    )
    expect(cardByTitle(first).textContent).not.toContain('Not written yet.')
  })

  it('saves and turns to the next card on Enter, in binder order, and closes after the last', async () => {
    const [first, second, third] = scenes
    await turnOver(first)
    type(field('Act'), 'I')
    await act(async () => {
      fireEvent.keyDown(field('Act'), { key: 'Enter' })
    })

    expect(screen.getByRole('dialog', { name: `Back of ${second}` }).textContent).toContain(
      '2 of 3'
    )
    expect((await metaOf(path, first)).act).toBe('I')
    // The next card starts from its own back, not the one just written...
    expect(field('Act').value).toBe('')
    // ...and the act just used is remembered as a suggestion.
    expect(
      [...document.querySelectorAll('#card-back-acts option')].map((o) => o.getAttribute('value'))
    ).toEqual(['I'])

    await act(async () => {
      fireEvent.keyDown(field('Synopsis'), { key: 'Enter' })
    })
    expect(screen.getByRole('dialog', { name: `Back of ${third}` })).toBeTruthy()
    // The last card offers no Next, and Enter there saves and closes.
    expect(screen.queryByRole('button', { name: 'Next Card' })).toBeNull()
    type(field('Act'), 'III')
    await act(async () => {
      fireEvent.keyDown(field('Act'), { key: 'Enter' })
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await metaOf(path, third)).act).toBe('III')
  })

  it('breaks a line in the synopsis on Shift+Enter, without turning the card', async () => {
    const [first] = scenes
    await turnOver(first)
    await act(async () => {
      fireEvent.keyDown(field('Synopsis'), { key: 'Enter', shiftKey: true })
    })
    expect(screen.getByRole('dialog', { name: `Back of ${first}` })).toBeTruthy()
  })

  it('keeps what was written however it is closed — Esc included', async () => {
    const [first] = scenes
    await turnOver(first)
    type(field('Conflict'), 'Written, then Esc.')
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await metaOf(path, first)).conflict).toBe('Written, then Esc.')
  })

  it('turns back to the front from the back’s own bent corner, keeping what was written', async () => {
    const [first] = scenes
    await turnOver(first)
    type(field('Synopsis'), 'Turned back by the corner.')
    // The back's corner, the front's twin: a bent-up flap, no writing on it.
    const corner = screen.getByRole('button', { name: 'Turn back to the front' })
    expect(corner.classList.contains('card-corner')).toBe(true)
    expect(corner.getAttribute('data-help')).toBe('card-turn-back')
    await act(async () => {
      fireEvent.click(corner)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect((await metaOf(path, first)).synopsis).toBe('Turned back by the corner.')
    // The front's corner now shows writing through it.
    await waitFor(() =>
      expect(
        cardByTitle(first).querySelector('.card-corner.written .card-corner-writing')
      ).toBeTruthy()
    )
    // And it turns the card over again, as before.
    await turnOver(first)
    expect(field('Synopsis').value).toBe('Turned back by the corner.')
  })

  it('never starts a drag from its corner: the card stays where it is', async () => {
    const [first] = scenes
    const card = cardByTitle(first)
    const before = { x: card.style.left, y: card.style.top }
    const corner = turnButton(first)
    const pointer = (el: Element, type: string, x: number, y: number): void => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
      Object.defineProperty(e, 'pointerId', { value: 1 })
      el.dispatchEvent(e)
    }
    await act(async () => pointer(corner, 'pointerdown', 200, 190))
    await act(async () => pointer(document.body, 'pointermove', 300, 320))
    await act(async () => pointer(document.body, 'pointerup', 300, 320))
    expect({ x: cardByTitle(first).style.left, y: cardByTitle(first).style.top }).toEqual(before)
    expect((await metaOf(path, first)).boardX).toBeUndefined()
  })

  it('comes last to Tab on the back, as it sits last on the card', async () => {
    const back = await turnOver(scenes[0])
    const order = [...back.querySelectorAll<HTMLElement>('button, input, textarea, select')]
    expect(order.at(-1)?.getAttribute('aria-label')).toBe('Turn back to the front')
  })

  it('draws the front’s corner bent up, with no writing showing on an empty back', async () => {
    const [first] = scenes
    const corner = turnButton(first)
    expect(corner.classList.contains('card-corner')).toBe(true)
    expect(corner.getAttribute('data-help')).toBe('card-turn')
    expect(corner.querySelector('.card-corner-under')).not.toBeNull()
    expect(corner.querySelector('.card-corner-writing')).toBeNull()
  })

  it('writes nothing for a card that was only looked at', async () => {
    const [first] = scenes
    const write = vi.spyOn(api, 'writeDoc')
    await turnOver(first)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(write).not.toHaveBeenCalled()
  })

  it('casts characters from the book, and keeps one deleted since without showing it', async () => {
    const [first] = scenes
    await turnOver(first)
    const elara = useWyrm.getState().entities.find((e) => e.name === 'Elara Voss')!
    const marten = useWyrm.getState().entities.find((e) => e.name === 'Marten')!
    const harrowgate = useWyrm.getState().entities.find((e) => e.name === 'Harrowgate')!
    const cast = async (entityId: string): Promise<void> => {
      type(screen.getByLabelText('Character to add to this scene'), entityId)
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Add' }))
      })
    }
    await cast(elara.id)
    // The caret goes to the motivation of whoever was just added.
    expect(document.activeElement).toBe(field('Elara Voss: motivation'))
    await cast(marten.id)
    type(field('Elara Voss: motivation'), 'Owes the debt')
    type(field('Location'), harrowgate.id)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(await metaOf(path, first)).toMatchObject({
      location: harrowgate.id,
      cast: [{ entityId: elara.id, motivation: 'Owes the debt' }, { entityId: marten.id }]
    })

    // Marten leaves the book. His place in the scene is kept, not shown.
    await act(async () => {
      useWyrm.setState({ entities: useWyrm.getState().entities.filter((e) => e.id !== marten.id) })
    })
    await turnOver(first)
    expect(screen.queryByRole('group', { name: 'Marten' })).toBeNull()
    expect(screen.getByRole('dialog').textContent).toContain('One character no longer in the')
    // Taking Elara out and saving still keeps him.
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Take Elara Voss out of this scene' }))
    })
    // Not dropped to <body> with the button that was pressed.
    expect(document.activeElement).toBe(screen.getByLabelText('Character to add to this scene'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect((await metaOf(path, first)).cast).toEqual([{ entityId: marten.id }])
  })

  it('keeps the dialog open with the error when the write fails, then saves on a retry', async () => {
    const [first] = scenes
    await turnOver(first)
    type(field('Act'), 'II')
    vi.spyOn(api, 'writeDoc').mockRejectedValueOnce(new Error('disk full'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(screen.getByRole('alert').textContent).toContain('disk full')
    // Nothing lost, nothing locked: the field still holds the value and
    // still takes typing.
    expect(field('Act').value).toBe('II')
    expect(field('Act').readOnly).toBe(false)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await metaOf(path, first)).act).toBe('II')
  })

  it('offers a way out of a save that keeps failing, and writes nothing on it', async () => {
    const [first] = scenes
    await turnOver(first)
    type(field('Act'), 'II')
    const write = vi.spyOn(api, 'writeDoc').mockRejectedValue(new Error('read-only volume'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try Again' }))
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(write).toHaveBeenCalledTimes(2)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close Without Saving' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(write).toHaveBeenCalledTimes(2)
  })

  it("keeps the caret in the form on every turn — in the next card's synopsis", async () => {
    const [first, second] = scenes
    await turnOver(first)
    field('Conflict').focus()
    type(field('Conflict'), 'Something')
    // Held mid-save: a disabled field would lose focus to <body> right here,
    // in the browser, and the next keystroke would go nowhere.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realWrite = api.writeDoc.bind(api)
    vi.spyOn(api, 'writeDoc').mockImplementationOnce(async (p, d) => {
      await held
      await realWrite(p, d)
    })
    await act(async () => {
      fireEvent.keyDown(field('Conflict'), { key: 'Enter' })
    })
    for (const el of document.querySelectorAll(
      // Add is disabled until someone is picked, which is not the save.
      '.card-back input, .card-back textarea, .card-back select, .card-back button:not(.card-back-add button)'
    ))
      expect((el as HTMLInputElement).disabled, el.outerHTML.slice(0, 80)).toBe(false)
    expect(field('Conflict').readOnly).toBe(true)
    await act(async () => {
      release()
      await held
    })
    await waitFor(() => screen.getByRole('dialog', { name: `Back of ${second}` }))
    // ...and the turn lands the caret where the next card starts.
    expect(document.activeElement).toBe(field('Synopsis'))
    expect(field('Synopsis').readOnly).toBe(false)
  })

  it('returns focus to the corner it was turned over from', async () => {
    const [first] = scenes
    const corner = turnButton(first)
    corner.focus()
    await act(async () => {
      fireEvent.click(corner)
    })
    expect(document.activeElement).toBe(field('Synopsis'))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(document.activeElement).toBe(turnButton(first))
  })

  it('saves from the close box, a click outside, and Next Card — and not from a click inside', async () => {
    const [first, second, third] = scenes
    await turnOver(first)
    type(field('Synopsis'), 'From the close box')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await metaOf(path, first)).synopsis).toBe('From the close box')

    await turnOver(second)
    type(field('Synopsis'), 'From outside')
    await act(async () => {
      fireEvent.mouseDown(document.querySelector('.card-back')!)
    })
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((await metaOf(path, second)).synopsis).toBeUndefined()
    await act(async () => {
      fireEvent.mouseDown(document.querySelector('.dialog-overlay')!)
    })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect((await metaOf(path, second)).synopsis).toBe('From outside')

    await turnOver(second)
    type(field('Act'), 'II')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Next Card' }))
    })
    expect(screen.getByRole('dialog', { name: `Back of ${third}` })).toBeTruthy()
    expect((await metaOf(path, second)).act).toBe('II')
  })

  it('turns in binder order, not in the order the files come back in', async () => {
    const [first, second, third] = scenes
    // Third before first in the book; the files still list first first.
    const ids = Object.fromEntries(
      (await api.readAllDocs(path)).map((d) => [d.meta.title, d.meta.id])
    )
    await act(() => useWyrm.getState().moveBinderNode(ids[third], ids[first], 'before'))
    await waitFor(() => expect(titles()).toEqual([third, first, second]))
    expect((await api.readAllDocs(path)).map((d) => d.meta.title).slice(0, 3)).toEqual(scenes)

    await turnOver(third)
    expect(screen.getByRole('dialog').textContent).toContain('1 of 3')
    await act(async () => {
      fireEvent.keyDown(field('Synopsis'), { key: 'Enter' })
    })
    expect(screen.getByRole('dialog', { name: `Back of ${first}` })).toBeTruthy()
  })

  it("keeps showing a written scene's opening, synopsis or not", async () => {
    const [first] = scenes
    const opening = cardByTitle(first).querySelector('.scene-card-excerpt')!.textContent
    expect(opening).not.toBe('')
    expect(opening).not.toContain('Not written yet.')
    await turnOver(first)
    type(field('Synopsis'), 'Reed comes for the ledger.')
    type(field('Act'), 'I')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    await waitFor(() =>
      expect(cardByTitle(first).querySelector('.scene-card-outline')).toBeTruthy()
    )
    expect(cardByTitle(first).querySelector('.scene-card-synopsis')).toBeNull()
    expect(cardByTitle(first).querySelector('.scene-card-excerpt')!.textContent).toBe(opening)
  })

  it('tells a screen reader what the front says from the back', async () => {
    const [first] = scenes
    const doc = (await api.readAllDocs(path)).find((d) => d.meta.title === first)!
    await api.writeDoc(path, { ...doc, body: '' })
    cleanup()
    await renderBoard()
    await waitFor(() => expect(cardByTitle(first).textContent).toContain('Not written yet.'))
    await turnOver(first)
    type(field('Synopsis'), 'Reed comes.')
    type(field('Act'), 'II')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: `Open ${first}` }).getAttribute('aria-describedby')
      ).toBeTruthy()
    )
    const face = screen.getByRole('button', { name: `Open ${first}` })
    const described = face
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((ref) => document.getElementById(ref)?.textContent)
    expect(described).toEqual(['Act II', 'Reed comes.'])
    expect(turnButton(first).getAttribute('aria-label')).toBe(`Turn ${first} over, outlined`)
  })

  it('never writes over a field another device changed, unless the writer changed it', async () => {
    const [first] = scenes
    await turnOver(first)
    type(field('Act'), 'I')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    // Another device syncs in a synopsis and a new act while the board holds
    // its copy. The board is not told.
    const doc = (await api.readAllDocs(path)).find((d) => d.meta.title === first)!
    await api.writeDoc(path, {
      ...doc,
      meta: { ...doc.meta, synopsis: 'From the other machine', act: 'III' }
    })
    const write = vi.spyOn(api, 'writeDoc')

    // Turned past without a keystroke: nothing written at all.
    await turnOver(first)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(write).not.toHaveBeenCalled()

    // One field edited: that field is written, the other device's stay.
    await turnOver(first)
    type(field('Conflict'), 'Ours')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    })
    expect(await metaOf(path, first)).toMatchObject({
      synopsis: 'From the other machine',
      act: 'III',
      conflict: 'Ours'
    })
  })

  it('adds a character only on Add, never on landing in the list', async () => {
    const [first] = scenes
    await turnOver(first)
    const elara = useWyrm.getState().entities.find((e) => e.name === 'Elara Voss')!
    type(screen.getByLabelText('Character to add to this scene'), elara.id)
    expect(screen.queryByRole('group', { name: 'Elara Voss' })).toBeNull()
    // Enter on the picker adds, and does not turn the card.
    await act(async () => {
      fireEvent.keyDown(screen.getByLabelText('Character to add to this scene'), { key: 'Enter' })
    })
    expect(screen.getByRole('group', { name: 'Elara Voss' })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: `Back of ${first}` })).toBeTruthy()
  })

  it('saves what was typed when another project comes to the front, into the project it was typed in', async () => {
    const [first] = scenes
    await turnOver(first)
    type(field('Synopsis'), 'Typed, then another window')
    const writes = vi.spyOn(api, 'writeDoc')
    await act(() => useWyrm.getState().openAnotherProject())
    const other = useWyrm.getState().project!.path
    expect(other).not.toBe(path)
    // The board is still mounted; the back is not, since it belongs to the
    // project that just went to the back.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(async () =>
      expect((await metaOf(path, first)).synopsis).toBe('Typed, then another window')
    )
    expect(writes.mock.calls.every(([p]) => p === path)).toBe(true)
  })

  it('cannot be turned over while the string tool is up', async () => {
    await act(async () => {
      fireEvent.click(
        [...document.querySelectorAll('.board-tool')].find((b) =>
          b.textContent?.includes('String')
        )!
      )
    })
    expect(screen.queryByRole('button', { name: /^Turn .* over$/ })).toBeNull()
  })
})

describe('writing the back, in the store', () => {
  it('writes to the project it was called in, even when another is in front when the read lands', async () => {
    const path = await openDemo()
    const [doc] = await tagScenes(path, 1)
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realRead = api.readDoc.bind(api)
    vi.spyOn(api, 'readDoc').mockImplementationOnce(async (p, id) => {
      await held
      return realRead(p, id)
    })
    const writes = vi.spyOn(api, 'writeDoc')

    const writing = useWyrm.getState().setCardBack(path, doc.meta.id, { synopsis: 'Ours' })
    await act(() => useWyrm.getState().openAnotherProject())
    const other = useWyrm.getState().project!.path
    expect(other).not.toBe(path)
    await act(async () => {
      release()
      await writing
    })

    expect(writes.mock.calls.map(([p]) => p)).toEqual([path])
    expect((await api.readDoc(path, doc.meta.id)).meta.synopsis).toBe('Ours')
    expect(__runtimeFor(path)?.commitDirty).toBe(true)
  })
})

describe('writing the back of the open scene', () => {
  const open = async (): Promise<{ path: string; id: string }> => {
    const path = await openDemo()
    const [doc] = await tagScenes(path, 1)
    await act(() => useWyrm.getState().selectDoc(doc.meta.id))
    return { path, id: doc.meta.id }
  }

  it('carries the back onto the open document, so the next autosave keeps it', async () => {
    const { path, id } = await open()
    const body = useWyrm.getState().activeDoc!.body
    await act(() => useWyrm.getState().setCardBack(path, id, { synopsis: 'S', act: 'II' }))
    expect(useWyrm.getState().activeDoc!.meta).toMatchObject({ synopsis: 'S', act: 'II' })
    expect(useWyrm.getState().activeDoc!.body).toBe(body)
    // What an autosave writes: the open document as the store holds it.
    await api.writeDoc(path, useWyrm.getState().activeDoc!)
    expect((await api.readDoc(path, id)).meta).toMatchObject({ synopsis: 'S', act: 'II' })
  })

  it('keeps text saved into the open document while the back was being written', async () => {
    const { path, id } = await open()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realWrite = api.writeDoc.bind(api)
    vi.spyOn(api, 'writeDoc').mockImplementationOnce(async (p, d) => {
      await held
      await realWrite(p, d)
    })
    const writing = useWyrm.getState().setCardBack(path, id, { synopsis: 'S' })
    // An autosave lands meanwhile and updates the open document's body.
    const now = useWyrm.getState().activeDoc!
    useWyrm.setState({ activeDoc: { ...now, body: 'typed meanwhile\n' } })
    await act(async () => {
      release()
      await writing
    })
    expect(useWyrm.getState().activeDoc).toMatchObject({
      body: 'typed meanwhile\n',
      meta: { synopsis: 'S' }
    })
  })

  it('updates the parked copy of the open document when its project has gone to the back', async () => {
    const { path, id } = await open()
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realWrite = api.writeDoc.bind(api)
    vi.spyOn(api, 'writeDoc').mockImplementationOnce(async (p, d) => {
      await held
      await realWrite(p, d)
    })
    const writing = useWyrm.getState().setCardBack(path, id, { synopsis: 'S' })
    await act(() => useWyrm.getState().openAnotherProject())
    const parked = useWyrm.getState().parked[path]
    useWyrm.setState({
      parked: {
        ...useWyrm.getState().parked,
        [path]: { ...parked, activeDoc: { ...parked.activeDoc!, body: 'flushed before parking\n' } }
      }
    })
    const theirs = useWyrm.getState().activeDoc
    await act(async () => {
      release()
      await writing
    })
    expect(useWyrm.getState().parked[path].activeDoc).toMatchObject({
      body: 'flushed before parking\n',
      meta: { synopsis: 'S' }
    })
    expect(useWyrm.getState().activeDoc).toBe(theirs)
  })
})
