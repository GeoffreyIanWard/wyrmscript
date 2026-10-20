// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'

/**
 * The board→scene→board loop. Opening a card used to be an arrival, like
 * picking a scene in the binder, so Esc from the scene did nothing and the
 * writer had to find their way back to the board and then to the card they
 * were on. Since outline mode (F-42), the board is where a story is worked
 * through card by card: a card opened from the board is a detour, and Esc
 * comes back to the board — scrolled where it was, with that card focused.
 * Driven through the real App, so the real Esc handler is the one pressed.
 */

let path: string

async function renderApp(): Promise<void> {
  vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
  vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
  vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
  const { default: App } = await import('../src/renderer/src/App')
  await act(async () => {
    render(<App />)
  })
}

/** The demo, open, with its first three documents tagged as scenes. */
async function openWithScenes(): Promise<string[]> {
  path = (await api.getLastProjectPath())!
  const docs = (await api.readAllDocs(path)).slice(0, 3)
  for (const d of docs) await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
  await act(async () => {
    await useWyrm.getState().openRecentProject(path)
  })
  return docs.map((d) => d.meta.title)
}

const esc = async (): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(window, { key: 'Escape' })
  })
}

const faceOf = (title: string): HTMLElement => screen.getByRole('button', { name: `Open ${title}` })

async function toBoard(): Promise<void> {
  await act(async () => {
    useWyrm.getState().showCorkboard()
  })
  await waitFor(() => expect(document.querySelector('.corkboard .scene-card')).toBeTruthy())
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({
    mainView: { kind: 'doc' },
    viewHistory: [],
    statsSettings: null,
    dailyStats: [],
    appearance: null,
    project: null,
    parked: {},
    openPaths: [],
    booted: false
  })
  __disposeAll()
})

describe('Esc from a scene opened on the board', () => {
  it('goes back to the board, onto the card it was opened from, scrolled where it was', async () => {
    const [, second] = await openWithScenes()
    await renderApp()
    await toBoard()
    const scroller = document.querySelector('.corkboard') as HTMLElement
    scroller.scrollTop = 140

    await act(async () => {
      fireEvent.click(faceOf(second))
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    await waitFor(() => expect(useWyrm.getState().activeDoc?.meta.title).toBe(second))

    await esc()

    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
    await waitFor(() => expect(document.activeElement).toBe(faceOf(second)))
    expect((document.querySelector('.corkboard') as HTMLElement).scrollTop).toBe(140)
    // One step: a second Esc has nowhere further to go — and the place was
    // a one-off, gone from the view once used.
    expect(useWyrm.getState().viewHistory).toEqual([])
    expect(useWyrm.getState().mainView).toEqual({ kind: 'corkboard' })
  })

  it('works the same for a character card, through the entry', async () => {
    await openWithScenes()
    const elara = (await api.listEntities(path)).find((e) => e.name === 'Elara Voss')!
    await api.writeEntity(path, { ...elara, onBoard: true })
    try {
      await act(async () => {
        await useWyrm.getState().loadEntities()
      })
      await renderApp()
      await toBoard()
      ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 140

      await act(async () => {
        fireEvent.click(faceOf('Elara Voss'))
      })
      expect(useWyrm.getState().mainView).toEqual({ kind: 'entity', id: elara.id })
      // One step back, and it is the board as it was — nothing else stacked.
      expect(useWyrm.getState().viewHistory).toEqual([
        { kind: 'corkboard', cardId: elara.id, scrollTop: 140 }
      ])
      await esc()
      await waitFor(() => expect(document.activeElement).toBe(faceOf('Elara Voss')))
      expect((document.querySelector('.corkboard') as HTMLElement).scrollTop).toBe(140)
      expect(useWyrm.getState().viewHistory).toEqual([])
    } finally {
      await api.writeEntity(path, { ...elara, onBoard: undefined })
    }
  })

  it('stops coming back once the writer picks another scene in the binder', async () => {
    const [first, , third] = await openWithScenes()
    await renderApp()
    await toBoard()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    // Moving on through the binder is an arrival, as it always was.
    const thirdId = (await api.readAllDocs(path)).find((d) => d.meta.title === third)!.meta.id
    await act(async () => {
      await useWyrm.getState().selectDoc(thirdId)
    })

    await esc()

    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
  })

  it('still lands on the board when the card has gone since, scrolled where it was', async () => {
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 140
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    // The scene is untagged while open: no card to come back to.
    const doc = useWyrm.getState().activeDoc!
    await act(async () => {
      await useWyrm.getState().updateDocMeta({ tags: [] })
    })
    expect(doc.meta.title).toBe(first)

    await esc()

    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
    await waitFor(() => expect(document.querySelector('.corkboard .scene-card')).toBeTruthy())
    expect(screen.queryByRole('button', { name: `Open ${first}` })).toBeNull()
    await waitFor(() =>
      expect((document.querySelector('.corkboard') as HTMLElement).scrollTop).toBe(140)
    )
    expect(document.activeElement?.classList.contains('scene-card-face')).toBe(false)
  })
  it('uses the remembered place once: a later trip away and back keeps where the writer is now', async () => {
    const [first, second] = await openWithScenes()
    await renderApp()
    await toBoard()
    ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 140
    await act(async () => {
      fireEvent.click(faceOf(second))
    })
    await esc()
    await waitFor(() => expect(document.activeElement).toBe(faceOf(second)))
    // The writer moves on, on the board: further down, another card.
    ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 600
    faceOf(first).focus()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'corkboard' })

    // Writing Stats and back: the board must not snap to the old card.
    await act(async () => {
      useWyrm.getState().showStats()
    })
    await esc()
    await waitFor(() => expect(document.querySelector('.corkboard .scene-card')).toBeTruthy())
    expect(document.activeElement).not.toBe(faceOf(second))
    expect((document.querySelector('.corkboard') as HTMLElement).scrollTop).not.toBe(140)
  })

  it('does not snap back when the board re-reads its documents', async () => {
    const [first, second] = await openWithScenes()
    await renderApp()
    await toBoard()
    ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 140
    await act(async () => {
      fireEvent.click(faceOf(second))
    })
    await esc()
    await waitFor(() => expect(document.activeElement).toBe(faceOf(second)))
    ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 500
    faceOf(first).focus()

    // Tidy re-reads every document.
    await act(async () => {
      fireEvent.click(
        [...document.querySelectorAll('.board-tool')].find((b) => b.textContent?.includes('Tidy'))!
      )
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect((document.querySelector('.corkboard') as HTMLElement).scrollTop).toBe(500)
    expect(document.activeElement).toBe(faceOf(first))
  })

  it('comes back to a stacked board still stacked', async () => {
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    const tool = (label: string): HTMLButtonElement =>
      [...document.querySelectorAll('.board-tool')].find((b) =>
        b.textContent?.includes(label)
      ) as HTMLButtonElement
    await act(async () => {
      fireEvent.click(tool('Stack'))
    })
    expect(document.querySelector('.corkboard-board.stacked')).toBeTruthy()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    expect(useWyrm.getState().viewHistory[0]).toMatchObject({ stacked: true, pulled: [] })
    await esc()
    await waitFor(() => expect(document.activeElement).toBe(faceOf(first)))
    expect(document.querySelector('.corkboard-board.stacked')).toBeTruthy()
  })
})

describe('restoring the scroll', () => {
  it('waits until the board has measured itself, so unplaced cards are in their final columns', async () => {
    // jsdom lays nothing out, so the width is stubbed, and the scroll setter
    // records where the second card was at the moment the scroll was put
    // back. Restoring before the measurement would catch it in the
    // one-column layout of the first render.
    const width = Object.getOwnPropertyDescriptor(Element.prototype, 'clientWidth')!
    const scroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
    const seenAt: string[] = []
    Object.defineProperty(Element.prototype, 'clientWidth', {
      configurable: true,
      get(this: Element) {
        return this.classList.contains('corkboard-board') ? 900 : 0
      }
    })
    Object.defineProperty(Element.prototype, 'scrollTop', {
      configurable: true,
      get(this: Element) {
        return scroll.get!.call(this)
      },
      set(this: Element, v: number) {
        if (this.classList.contains('corkboard') && v === 140) {
          const second = document.querySelectorAll<HTMLElement>('.scene-card')[1]
          seenAt.push(second?.style.left ?? '')
        }
        scroll.set!.call(this, v)
      }
    })
    try {
      const [first] = await openWithScenes()
      await renderApp()
      await toBoard()
      ;(document.querySelector('.corkboard') as HTMLElement).scrollTop = 140
      seenAt.length = 0
      await act(async () => {
        fireEvent.click(faceOf(first))
      })
      await esc()
      await waitFor(() => expect(document.activeElement).toBe(faceOf(first)))
      // Two columns at 900px for three cards: the second card sits beside
      // the first, not under it.
      expect(seenAt).toEqual(['234px'])
    } finally {
      Object.defineProperty(Element.prototype, 'clientWidth', width)
      Object.defineProperty(Element.prototype, 'scrollTop', scroll)
    }
  })
})

describe('Esc that something else has used', () => {
  it('cancels a binder rename without also leaving the scene for the board', async () => {
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    // The scene finishes opening before its row is renamed — read too early,
    // activeId is still the document that was open before.
    await waitFor(() => expect(useWyrm.getState().activeDoc?.meta.title).toBe(first))
    const id = useWyrm.getState().activeId!
    await act(async () => {
      useWyrm.getState().startRename(id)
    })
    await waitFor(() => expect(document.querySelector('.rename-input')).toBeTruthy())
    const input = document.querySelector('.rename-input') as HTMLInputElement
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Escape' })
    })
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    // The board is still one Esc away, once the rename is out of the way.
    expect(useWyrm.getState().viewHistory).toHaveLength(1)
  })

  it('still goes back when Esc is pressed inside the editor, which marks every Esc handled', async () => {
    // ProseMirror calls preventDefault on every Esc, used or not, so the
    // back key cannot be gated on defaultPrevented — that stopped Esc going
    // anywhere from the page the moment the caret was in the text.
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    const page = await waitFor(() => {
      const el = document.querySelector('.ProseMirror')
      expect(el).toBeTruthy()
      return el as HTMLElement
    })
    page.focus()
    await act(async () => {
      fireEvent.keyDown(page, { key: 'Escape', keyCode: 27 })
    })
    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
  })

  it('closes a menu without also leaving the scene for the board', async () => {
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    const file = screen.getByRole('menuitem', { name: 'File' })
    // The bar opens on mousedown, not click.
    await act(async () => {
      fireEvent.mouseDown(file)
    })
    expect(document.querySelector('.menu-drop')).toBeTruthy()
    // Esc inside the menu bar, where its keyboard handling lives.
    await act(async () => {
      fireEvent.keyDown(file, { key: 'Escape' })
    })
    expect(document.querySelector('.menu-drop')).toBeNull()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    // The board is still one Esc away once the menu is shut.
    expect(useWyrm.getState().viewHistory).toHaveLength(1)
  })

  it('leaves Focus Mode first on the page, keeping the way back to the board', async () => {
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Enter Focus Mode' }))
    })
    expect(screen.getByRole('button', { name: 'Exit Focus Mode' })).toBeTruthy()

    await esc()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    expect(screen.getByRole('button', { name: 'Enter Focus Mode' })).toBeTruthy()

    await esc()
    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
  })
})

describe('leaving the page right after typing', () => {
  it('saves the last words typed, instead of dropping them with the editor (I-15)', async () => {
    // The save runs 800ms after the last keystroke and reads the text from
    // the editor. Leaving the page inside that window — Esc back to the
    // board, ⌥⌘B, opening an entry — unmounted the editor first, the save
    // found none, and the words were gone.
    const [first] = await openWithScenes()
    await renderApp()
    await toBoard()
    await act(async () => {
      fireEvent.click(faceOf(first))
    })
    const id = (await api.readAllDocs(path)).find((d) => d.meta.title === first)!.meta.id
    await waitFor(() => expect(useWyrm.getState().editor).toBeTruthy())
    await act(async () => {
      useWyrm.getState().editor!.chain().focus('start').insertContent('Reed knocks twice. ').run()
    })
    expect(useWyrm.getState().saveState).toBe('dirty')

    // Straight back, well inside the 800ms — with the save held on its way
    // to disk, as a slow drive would, so the board reads the scene before it
    // lands.
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const realWrite = api.writeDoc.bind(api)
    vi.spyOn(api, 'writeDoc').mockImplementationOnce(async (p, d) => {
      await held
      await realWrite(p, d)
    })
    await esc()

    // The board has read the scene while the save was still on its way.
    await waitFor(() => expect(document.querySelector('.scene-card-excerpt')).toBeTruthy())
    expect(document.querySelector('.scene-card-excerpt')?.textContent).not.toContain('Reed knocks')
    await act(async () => {
      release()
      await held
    })
    // The words reached the file...
    await waitFor(async () =>
      expect((await api.readDoc(path, id)).body).toContain('Reed knocks twice.')
    )
    // ...and the card shows them, though the board does not read again.
    await waitFor(() =>
      expect(document.querySelector('.scene-card-excerpt')?.textContent).toContain(
        'Reed knocks twice.'
      )
    )
  })
})

describe('the store side of the loop', () => {
  it('makes the place given to selectDoc the one step back, and a plain selectDoc clears it', async () => {
    await openWithScenes()
    const [a, b] = (await api.readAllDocs(path)).map((d) => d.meta.id)
    const here = { kind: 'corkboard' as const, cardId: a, scrollTop: 10 }
    await act(() => useWyrm.getState().selectDoc(a, here))
    expect(useWyrm.getState().viewHistory).toEqual([here])
    await act(() => useWyrm.getState().selectDoc(b))
    expect(useWyrm.getState().viewHistory).toEqual([])
  })

  it('pushes the place given to showEntity in place of what is on screen', async () => {
    await openWithScenes()
    const here = { kind: 'corkboard' as const, cardId: 'x', scrollTop: 0 }
    act(() => {
      useWyrm.getState().showEntity('e1', here)
    })
    expect(useWyrm.getState().viewHistory).toEqual([here])
    expect(useWyrm.getState().goBack()).toBe(true)
    expect(useWyrm.getState().mainView).toEqual(here)
  })
})
