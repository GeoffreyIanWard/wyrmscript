// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { Corkboard } from '../src/renderer/src/components/Corkboard'

/**
 * The corkboard view (Phase 6).
 *
 * Two things are worth pinning beyond "it renders". Clicking a card has to
 * open that scene — the board is a way into the writing, not a read-only
 * poster. And dragging a card has to go through `moveBinderNode`, the same
 * action the binder's own drag uses, because the board rearranging the
 * manuscript differently from the binder would be two meanings for one
 * gesture.
 */

let demoPath: string | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  await clearScenes(demoPath!)
  return demoPath!
}

/**
 * Clears every scene tag **and every stored card position**. The mock keeps
 * documents in a module-level map that outlives a test, so without this each
 * test inherits whatever the previous one tagged — the empty-board and
 * unwritten-scene cases become unreachable — and, once cards could be placed,
 * each drag started from wherever the last test dropped that card, so the
 * positions silently accumulated across the file.
 */
async function clearScenes(path: string): Promise<void> {
  for (const d of await api.readAllDocs(path)) {
    const meta = { ...d.meta, tags: [] }
    delete meta.boardX
    delete meta.boardY
    await api.writeDoc(path, { ...d, meta })
  }
  // F-45: entities outlive a test the same way, so a character put on the
  // board by one test would still be there for the next.
  for (const e of await api.listEntities(path)) {
    if (e.onBoard == null && e.boardX == null) continue
    const clean = { ...e }
    delete clean.onBoard
    delete clean.boardX
    delete clean.boardY
    await api.writeEntity(path, clean)
  }
  await useWyrm.getState().loadEntities()
}

/** Puts a story-bible entry on the board the way the store would, by name. */
async function putOnBoard(path: string, name: string): Promise<Entity> {
  const entity = (await api.listEntities(path)).find((e) => e.name === name)
  if (!entity) throw new Error(`no entity named ${name} in the demo project`)
  await api.writeEntity(path, { ...entity, onBoard: true })
  await act(async () => {
    await useWyrm.getState().loadEntities()
  })
  return entity
}

/** Tags the project's documents as scenes, which is what puts them on the board. */
async function tagScenes(path: string, howMany = 3): Promise<string[]> {
  const docs = await api.readAllDocs(path)
  const ids = docs.slice(0, howMany).map((d) => d.meta.id)
  for (const d of docs.slice(0, howMany)) {
    await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
  }
  return ids
}

const tools = {
  onTimeline: vi.fn(),
  onPlotGraph: vi.fn(),
  onPlotlines: vi.fn(),
  onCharacterGraph: vi.fn(),
  onWorldMap: vi.fn()
}

async function renderBoard(): Promise<void> {
  await act(async () => {
    render(
      <Corkboard
        onTimeline={tools.onTimeline}
        onPlotGraph={tools.onPlotGraph}
        onPlotlines={tools.onPlotlines}
        onCharacterGraph={tools.onCharacterGraph}
        onWorldMap={tools.onWorldMap}
      />
    )
  })
  await waitFor(() => expect(document.querySelector('.corkboard')).toBeTruthy())
}

const titles = (): string[] =>
  [...document.querySelectorAll('.scene-card-title')].map((t) => t.textContent ?? '')

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  cleanup()
  useWyrm.setState({ project: null, booted: false, parked: {}, openPaths: [], editor: null })
  __disposeAll()
})

describe('the board', () => {
  it('shows a card for each scene', async () => {
    const path = await openDemo()
    await tagScenes(path)

    await renderBoard()

    await waitFor(() => expect(titles().length).toBe(3))
  })

  it('says so plainly when nothing is tagged yet', async () => {
    // Rather than an empty board, which looks broken and says nothing about
    // how scenes come to exist.
    await openDemo()

    await renderBoard()

    await waitFor(() => expect(screen.getByText(/No cards yet/i)).toBeTruthy())
  })

  it('marks an unwritten scene rather than showing a blank card', async () => {
    const path = await openDemo()
    const docs = await api.readAllDocs(path)
    await api.writeDoc(path, { ...docs[0], body: '', meta: { ...docs[0].meta, tags: ['scene'] } })

    await renderBoard()

    await waitFor(() => expect(titles().length).toBe(1))
    expect(screen.getByText(/Not written yet/i)).toBeTruthy()
  })
})

describe('the pinned tools', () => {
  it('are on the board, since it replaces the manuscript view', async () => {
    // The binder is hidden while the board is up, so these are also what
    // takes its place — leaving them in a menu would strand the writer.
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()

    expect(screen.getByText('Timeline')).toBeTruthy()
    expect(screen.getByText('Plot Graph')).toBeTruthy()
    expect(screen.getByText('World Map')).toBeTruthy()
  })

  it('open the view they name', async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()

    await act(async () => {
      fireEvent.click(screen.getByText('Plot Graph'))
    })

    expect(tools.onPlotGraph).toHaveBeenCalled()
    expect(tools.onTimeline).not.toHaveBeenCalled()
  })

  it('are still there with no scenes, so an empty board is not a dead end', async () => {
    await openDemo()
    await renderBoard()

    await waitFor(() => expect(screen.getByText(/No cards yet/i)).toBeTruthy())
    expect(screen.getByText('Timeline')).toBeTruthy()
  })
})

describe('a card is a way into the scene', () => {
  it('opens that document when clicked', async () => {
    const path = await openDemo()
    const ids = await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))

    const second = document.querySelectorAll('.scene-card-face')[1] as HTMLElement
    await act(async () => {
      fireEvent.click(second)
    })

    expect(useWyrm.getState().activeId).toBe(ids[1])
  })
})

/**
 * Dragging is pointer-based, so these drive pointer events.
 *
 * The board first shipped on HTML5 drag-and-drop and cards would not drop.
 * What made that bug survive two fixes is that **nothing available here can
 * drive native drag-and-drop**: jsdom has no DragEvent, and the browser
 * preview's remote-debugging mouse input does not start one either — a real
 * drag on a *binder* row, which works in the app, moved nothing under it. So
 * every check short of launching Electron by hand reported success. Pointer
 * events are real input in both places.
 */
function pointer(el: HTMLElement, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  // jsdom has no PointerEvent; React reads `pointerId` off the event object.
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

const cardEls = (): HTMLElement[] => [...document.querySelectorAll('.scene-card')] as HTMLElement[]
const posOf = (el: HTMLElement): { x: string; y: string } => ({ x: el.style.left, y: el.style.top })

describe('dragging a card', () => {
  beforeEach(async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
  })

  it('leaves the card where the writer dropped it', async () => {
    // The bug this replaces: the card reordered the manuscript and then
    // snapped into the grid, so it never stayed where it was put.
    const cards = cardEls()
    const before = posOf(cards[0])

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 350, 420))
    await act(async () => pointer(cards[0], 'pointerup', 350, 420))

    await waitFor(() => expect(posOf(cardEls()[0])).not.toEqual(before))
    const after = posOf(cardEls()[0])
    expect(after).toEqual({ x: '300px', y: '370px' })
  })

  it('writes the position to the scene, so it survives a reopen', async () => {
    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 250, 300))
    await act(async () => pointer(cards[0], 'pointerup', 250, 300))

    const path = useWyrm.getState().project?.path as string
    await waitFor(async () => {
      const docs = await api.readAllDocs(path)
      const moved = docs.find((d) => d.meta.boardX != null)
      expect(moved?.meta.boardX).toBe(200)
      expect(moved?.meta.boardY).toBe(250)
    })
  })

  it('does not drag a card off the top-left of the board', async () => {
    // A card dragged past the corner would otherwise be positioned negative
    // and sit outside the board, unreachable.
    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', -500, -500))
    await act(async () => pointer(cards[0], 'pointerup', -500, -500))

    await waitFor(() => expect(posOf(cardEls()[0])).toEqual({ x: '0px', y: '0px' }))
  })

  it('leaves the manuscript order alone — the binder is still the book', async () => {
    const before = titles()
    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    await act(async () => pointer(cards[0], 'pointerup', 600, 50))

    await waitFor(() => expect(cardEls()[0].style.left).toBe('550px'))
    expect(titles()).toEqual(before)
  })

  it('carries the card even when the first move lands nowhere near it', async () => {
    // A fast flick, or any pointer that jumps further than the card in one
    // event, delivers its first move to whatever is under the pointer — not
    // the card. Tracking the gesture on the card meant that move was never
    // heard and the card never moved; the writer saw a press and nothing
    // else. The gesture is tracked on the document from the press, so the
    // move and the release are dispatched here on the body, deliberately
    // not on the card.
    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(document.body, 'pointermove', 600, 50))
    await act(async () => pointer(document.body, 'pointerup', 600, 50))

    expect(posOf(cardEls()[0])).toEqual({ x: '550px', y: '0px' })
  })

  it('does not count a press that never moved as a drag', async () => {
    const cards = cardEls()
    const before = posOf(cards[0])

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 52, 51))
    await act(async () => pointer(cards[0], 'pointerup', 52, 51))

    expect(posOf(cardEls()[0])).toEqual(before)
    expect(document.querySelector('.scene-card.dragging')).toBeNull()
  })

  it('does not open the scene it just moved', async () => {
    // The card's whole face is a button, so the pointerup that ends a drag is
    // also a click on it. Without suppression, moving a card yanks the writer
    // into that scene.
    const cards = cardEls()
    const activeBefore = useWyrm.getState().activeId

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    await act(async () => pointer(cards[0], 'pointerup', 600, 50))
    await act(async () => {
      fireEvent.click(cards[0].querySelector('.scene-card-face') as HTMLElement)
    })

    expect(useWyrm.getState().activeId).toBe(activeBefore)
  })

  it('still opens a scene on the next click after a move', async () => {
    // The click that ends a drag lands on the nearest common ancestor of the
    // press and the release — the board, not the button — whenever the card
    // was dropped somewhere else. So nothing consumes the suppression, and
    // leaving it set swallows the next real click: move a card, then click
    // any card, and it refuses to open.
    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    await act(async () => pointer(cards[0], 'pointerup', 600, 50))

    const target = cardEls()[1]
    await act(async () => pointer(target, 'pointerdown', 300, 50))
    await act(async () => pointer(target, 'pointerup', 300, 50))
    await act(async () => {
      fireEvent.click(target.querySelector('.scene-card-face') as HTMLElement)
    })

    await waitFor(() => expect(useWyrm.getState().activeId).toBeTruthy())
  })
})

describe('tidying the board', () => {
  beforeEach(async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
  })

  it('is offered only once something has actually been moved', async () => {
    const tidy = (): HTMLButtonElement =>
      [...document.querySelectorAll('.board-tool')].find((b) =>
        b.textContent?.includes('Tidy')
      ) as HTMLButtonElement
    expect(tidy().disabled).toBe(true)

    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 400, 400))
    await act(async () => pointer(cards[0], 'pointerup', 400, 400))

    await waitFor(() => expect(tidy().disabled).toBe(false))
  })

  it('tidies a board whose positions were stored in an earlier session', async () => {
    // The bug this exists for: documents are read once when the board opens,
    // so tidying wrote the cleared positions to disk and then fell back to
    // the *stale* docs still held in the view — every card that already had a
    // position sprang back to it, while cards that had never been moved went
    // to their slots correctly. "The first card snaps to the right spot, the
    // second snaps to the middle."
    //
    // Positions are written before the board renders, which is what makes
    // this the real case: the earlier test dragged a card first, so the
    // stale docs predated the drag and happened to be right.
    const path = useWyrm.getState().project?.path as string
    const docs = await api.readAllDocs(path)
    const scene = docs.find((d) => d.meta.tags?.includes('scene')) as (typeof docs)[number]
    await act(async () => {
      await api.writeDoc(path, { ...scene, meta: { ...scene.meta, boardX: 480, boardY: 300 } })
    })
    cleanup()
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
    const placed = (): HTMLElement =>
      [...document.querySelectorAll('.scene-card')].find(
        (c) => c.querySelector('.scene-card-title')?.textContent === scene.meta.title
      ) as HTMLElement
    expect(placed().style.left).toBe('480px')

    const tidy = [...document.querySelectorAll('.board-tool')].find((b) =>
      b.textContent?.includes('Tidy')
    ) as HTMLButtonElement
    await act(async () => {
      fireEvent.click(tidy)
    })

    await waitFor(() => expect(placed().style.left).not.toBe('480px'))
    expect(placed().style.top).not.toBe('300px')
  })

  it('returns every card to its slot in binder order', async () => {
    const cards = cardEls()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 400, 400))
    await act(async () => pointer(cards[0], 'pointerup', 400, 400))
    await waitFor(() => expect(cardEls()[0].style.top).toBe('350px'))

    const tidy = [...document.querySelectorAll('.board-tool')].find((b) =>
      b.textContent?.includes('Tidy')
    ) as HTMLButtonElement
    await act(async () => {
      fireEvent.click(tidy)
    })

    await waitFor(() => expect(cardEls()[0].style.top).toBe('0px'))
    // And the position is gone from the file, not merely ignored by the view.
    const path = useWyrm.getState().project?.path as string
    const docs = await api.readAllDocs(path)
    expect(docs.every((d) => d.meta.boardX == null)).toBe(true)
  })
})

const cardByTitle = (title: string): HTMLElement =>
  [...document.querySelectorAll('.scene-card')].find(
    (c) => c.querySelector('.scene-card-title')?.textContent === title
  ) as HTMLElement

const tool = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll('.board-tool')].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement

describe('characters and locations on the board (F-45)', () => {
  let path: string
  beforeEach(async () => {
    path = await openDemo()
    await tagScenes(path, 2)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(2))
  })

  it('shows an entry that was put on the board, and says what it is', async () => {
    await putOnBoard(path, 'Elara Voss')
    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeTruthy())

    const card = cardByTitle('Elara Voss')
    expect(card.className).toContain('kind-character')
    expect(card.querySelector('.scene-card-folder')?.textContent).toBe('Character Book')
    expect(card.querySelector('.scene-card-kind')?.textContent).toBe('character')
  })

  it('shows nothing for an entry that was not', async () => {
    // Membership is deliberate: the demo has six entries and none of them
    // appear until they are added.
    expect(titles()).toHaveLength(2)
    expect(cardByTitle('Marten')).toBeUndefined()
  })

  it('opens the entry when its card is clicked, as a detour Esc returns from', async () => {
    await putOnBoard(path, 'Harrowgate')
    await waitFor(() => expect(cardByTitle('Harrowgate')).toBeTruthy())
    act(() => useWyrm.getState().showCorkboard())

    await act(async () => {
      fireEvent.click(cardByTitle('Harrowgate').querySelector('.scene-card-face') as HTMLElement)
    })

    const { mainView, viewHistory } = useWyrm.getState()
    expect(mainView.kind).toBe('entity')
    // Unlike a scene, which is an arrival: the board is still on the stack.
    expect(viewHistory.at(-1)?.kind).toBe('corkboard')
  })

  it('drags like any other card, and writes the position to the entry', async () => {
    await putOnBoard(path, 'Elara Voss')
    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeTruthy())
    const card = cardByTitle('Elara Voss')

    await act(async () => pointer(card, 'pointerdown', 50, 50))
    await act(async () => pointer(card, 'pointermove', 350, 420))
    await act(async () => pointer(card, 'pointerup', 350, 420))

    await waitFor(async () => {
      const saved = (await api.listEntities(path)).find((e) => e.name === 'Elara Voss')
      expect(saved?.boardX).toBe(300)
      // Third card in jsdom's single column (y = 448), carried 370 further down.
      expect(saved?.boardY).toBe(818)
    })
    expect(posOf(cardByTitle('Elara Voss')).x).toBe('300px')
  })

  it('can be taken off the board without losing the entry', async () => {
    await putOnBoard(path, 'Elara Voss')
    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeTruthy())

    await act(async () => {
      fireEvent.click(cardByTitle('Elara Voss').querySelector('.scene-card-off') as HTMLElement)
    })

    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeUndefined())
    const still = (await api.listEntities(path)).find((e) => e.name === 'Elara Voss')
    expect(still).toBeTruthy()
    expect(still?.onBoard).toBeUndefined()
  })

  it('gives a scene card no way off the board, since scenes are always on it', () => {
    expect(cardEls()[0].querySelector('.scene-card-off')).toBeNull()
  })
})

describe('stacking the board', () => {
  let path: string
  beforeEach(async () => {
    path = await openDemo()
    await tagScenes(path, 2)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(2))
    await putOnBoard(path, 'Elara Voss')
    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeTruthy())
  })

  it('gathers the cards into piles by kind, cascading, and puts them back', async () => {
    // jsdom lays the grid in one column (no width), so the character sits
    // under the two scenes before stacking.
    expect(posOf(cardByTitle('Elara Voss'))).toEqual({ x: '0px', y: '448px' })

    await act(async () => {
      fireEvent.click(tool('Stack'))
    })
    expect(posOf(cardEls()[0])).toEqual({ x: '0px', y: '0px' })
    expect(posOf(cardEls()[1])).toEqual({ x: '0px', y: '24px' })
    expect(posOf(cardByTitle('Elara Voss'))).toEqual({ x: '234px', y: '0px' })
    expect(tool('Unstack')).toBeTruthy()

    await act(async () => {
      fireEvent.click(tool('Unstack'))
    })
    expect(posOf(cardEls()[1])).toEqual({ x: '0px', y: '224px' })
    expect(posOf(cardByTitle('Elara Voss'))).toEqual({ x: '0px', y: '448px' })
  })

  it('writes nothing while stacked', async () => {
    const before = await api.listEntities(path)
    await act(async () => {
      fireEvent.click(tool('Stack'))
    })
    await act(async () => {
      fireEvent.click(tool('Unstack'))
    })
    expect(await api.listEntities(path)).toEqual(before)
    expect((await api.readAllDocs(path)).every((d) => d.meta.boardX == null)).toBe(true)
  })

  it('lets a card be pulled out of its pile, and keeps it out until unstacked', async () => {
    await act(async () => {
      fireEvent.click(tool('Stack'))
    })
    const card = cardByTitle('Elara Voss')
    await act(async () => pointer(card, 'pointerdown', 50, 50))
    await act(async () => pointer(card, 'pointermove', 450, 350))
    await act(async () => pointer(card, 'pointerup', 450, 350))

    // Out of the pile, where it was dropped — not snapped back into it.
    expect(posOf(cardByTitle('Elara Voss'))).toEqual({ x: '634px', y: '300px' })
    // The other cards are still stacked.
    expect(posOf(cardEls()[1])).toEqual({ x: '0px', y: '24px' })

    await act(async () => {
      fireEvent.click(tool('Unstack'))
    })
    // Unstacked, it stays where the writer put it: the pull was a real move.
    expect(posOf(cardByTitle('Elara Voss'))).toEqual({ x: '634px', y: '300px' })
  })

  it('is undone by Tidy', async () => {
    await act(async () => {
      fireEvent.click(tool('Stack'))
    })
    const card = cardEls()[0]
    await act(async () => pointer(card, 'pointerdown', 50, 50))
    await act(async () => pointer(card, 'pointermove', 400, 400))
    await act(async () => pointer(card, 'pointerup', 400, 400))
    await waitFor(() => expect(tool('Tidy').disabled).toBe(false))

    await act(async () => {
      fireEvent.click(tool('Tidy'))
    })

    await waitFor(() => expect(tool('Stack')).toBeTruthy())
    await waitFor(() => expect(posOf(cardByTitle('Elara Voss'))).toEqual({ x: '0px', y: '448px' }))
  })
})

describe('adding a card', () => {
  let path: string
  beforeEach(async () => {
    path = await openDemo()
    await tagScenes(path, 1)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(1))
    await act(async () => {
      fireEvent.click(tool('Add Card'))
    })
    await waitFor(() => expect(document.querySelector('.dialog')).toBeTruthy())
  })

  const choose = async (kind: string): Promise<void> => {
    const radio = [...document.querySelectorAll('[role="radio"]')].find((r) =>
      r.textContent?.includes(kind)
    ) as HTMLElement
    await act(async () => {
      fireEvent.click(radio)
    })
  }

  const typeTitle = async (title: string): Promise<void> => {
    await act(async () => {
      fireEvent.change(document.querySelector('.dialog .text-field') as HTMLInputElement, {
        target: { value: title }
      })
    })
  }

  it('makes a new scene as a real document, tagged, without leaving the board', async () => {
    act(() => useWyrm.getState().showCorkboard())
    await choose('Scene')
    await typeTitle('The Long Night')
    await act(async () => {
      fireEvent.keyDown(document.querySelector('.dialog .text-field') as HTMLElement, {
        key: 'Enter'
      })
    })

    await waitFor(() => expect(cardByTitle('The Long Night')).toBeTruthy())
    expect(document.querySelector('.dialog')).toBeNull()
    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
    const docs = await api.readAllDocs(path)
    const made = docs.find((d) => d.meta.title === 'The Long Night')
    expect(made?.meta.tags).toEqual(['scene'])
  })

  it('makes a new character in the story bible, already on the board', async () => {
    await choose('Character')
    await typeTitle('Old Pell')
    await act(async () => {
      fireEvent.click(
        [...document.querySelectorAll('.dialog .btn')].find(
          (b) => b.textContent === 'Add'
        ) as HTMLElement
      )
    })

    await waitFor(() => expect(cardByTitle('Old Pell')).toBeTruthy())
    const made = (await api.listEntities(path)).find((e) => e.name === 'Old Pell')
    expect(made?.type).toBe('character')
    expect(made?.onBoard).toBe(true)
  })

  it('offers the entries not yet on the board, and puts one on', async () => {
    await choose('Location')
    const row = [...document.querySelectorAll('.dialog .version-row')].find((r) =>
      r.textContent?.includes('Harrowgate')
    ) as HTMLElement
    expect(row).toBeTruthy()

    await act(async () => {
      fireEvent.click(row)
    })

    await waitFor(() => expect(cardByTitle('Harrowgate')).toBeTruthy())
    expect(cardByTitle('Harrowgate').className).toContain('kind-location')
    // One Harrowgate, not two: it was put on, not duplicated.
    expect((await api.listEntities(path)).filter((e) => e.name === 'Harrowgate')).toHaveLength(1)
  })

  it('does not offer an entry that is already on the board', async () => {
    await act(async () => {
      fireEvent.click(document.querySelector('.dialog .close-box') as HTMLElement)
    })
    await putOnBoard(path, 'Harrowgate')
    await act(async () => {
      fireEvent.click(tool('Add Card'))
    })
    await choose('Location')

    const rows = [...document.querySelectorAll('.dialog .version-row')].map((r) => r.textContent)
    expect(rows).not.toContain('Harrowgate')
    expect(rows).toContain('Winter Court')
  })

  it('will not add a card with no name', async () => {
    await choose('Character')
    const add = [...document.querySelectorAll('.dialog .btn')].find(
      (b) => b.textContent === 'Add'
    ) as HTMLButtonElement
    expect(add.disabled).toBe(true)
  })
})

describe('strings between cards (F-46)', () => {
  let path: string
  const stringsDrawn = (): number => document.querySelectorAll('.board-string').length
  const faceOf = (title: string): HTMLElement =>
    cardByTitle(title).querySelector('.scene-card-face') as HTMLElement
  /** A click at a point: the face handler reads clientX/Y to place the pin. */
  const clickAt = async (el: HTMLElement, x: number, y: number): Promise<void> => {
    await act(async () => {
      fireEvent.click(el, { clientX: x, clientY: y })
    })
  }

  beforeEach(async () => {
    path = await openDemo()
    for (const str of await api.listBoardStrings(path)) await api.deleteBoardString(path, str.id)
    await tagScenes(path, 3)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
    await act(async () => {
      fireEvent.click(tool('String'))
    })
  })

  it('runs a string from the first pin to the second, where each card was clicked', async () => {
    const [a, b] = titles()
    await clickAt(faceOf(a), 40, 30)
    // One pin waiting: drawn, but no string yet.
    expect(document.querySelector('.board-pin.pending')).toBeTruthy()
    expect(stringsDrawn()).toBe(0)

    await clickAt(faceOf(b), 60, 234)

    await waitFor(() => expect(stringsDrawn()).toBe(1))
    expect(document.querySelector('.board-pin.pending')).toBeNull()
    const [saved] = await api.listBoardStrings(path)
    // Card b sits at (0, 224) in jsdom's single column, so a click at y=234
    // is 10px into it.
    expect(saved.from).toEqual({ cardId: expect.any(String), dx: 40, dy: 30 })
    expect(saved.to.dy).toBe(10)
    // And the string is a curve between those two points.
    expect(document.querySelector('.board-string path')?.getAttribute('d')).toMatch(/^M 40 30 Q/)
  })

  it('does not open the card while the tool is up', async () => {
    const before = useWyrm.getState().mainView
    await clickAt(faceOf(titles()[0]), 40, 30)
    expect(useWyrm.getState().mainView).toEqual(before)
  })

  it('ignores a second pin on the same card, and keeps the first waiting', async () => {
    const a = titles()[0]
    await clickAt(faceOf(a), 40, 30)
    await clickAt(faceOf(a), 100, 100)

    expect(stringsDrawn()).toBe(0)
    expect(document.querySelector('.board-pin.pending')).toBeTruthy()
    expect(await api.listBoardStrings(path)).toHaveLength(0)
  })

  it('pulls a waiting pin on Esc, and puts the tool down on a second Esc', async () => {
    await clickAt(faceOf(titles()[0]), 40, 30)
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(document.querySelector('.board-pin.pending')).toBeNull()
    expect(tool('String').getAttribute('aria-pressed')).toBe('true')

    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(tool('String').getAttribute('aria-pressed')).toBe('false')
  })

  it('follows a card that is dragged', async () => {
    const [a, b] = titles()
    await clickAt(faceOf(a), 40, 30)
    await clickAt(faceOf(b), 60, 234)
    await waitFor(() => expect(stringsDrawn()).toBe(1))

    const card = cardByTitle(b)
    await act(async () => pointer(card, 'pointerdown', 50, 250))
    await act(async () => pointer(card, 'pointermove', 350, 450))
    await act(async () => pointer(card, 'pointerup', 350, 450))

    // The second pin moved with its card: 300 right, 200 down.
    await waitFor(() =>
      expect(document.querySelector('.board-string path')?.getAttribute('d')).toMatch(/ 360 434$/)
    )
  })

  it('comes away when a pin is pulled', async () => {
    const [a, b] = titles()
    await clickAt(faceOf(a), 40, 30)
    await clickAt(faceOf(b), 60, 234)
    await waitFor(() => expect(stringsDrawn()).toBe(1))

    await act(async () => {
      fireEvent.click(document.querySelector('.board-string .board-pin') as Element)
    })

    await waitFor(() => expect(stringsDrawn()).toBe(0))
    expect(await api.listBoardStrings(path)).toHaveLength(0)
  })

  it('leaves pins alone when the tool is down', async () => {
    const [a, b] = titles()
    await clickAt(faceOf(a), 40, 30)
    await clickAt(faceOf(b), 60, 234)
    await waitFor(() => expect(stringsDrawn()).toBe(1))
    await act(async () => {
      fireEvent.click(tool('String'))
    })

    await act(async () => {
      fireEvent.click(document.querySelector('.board-string .board-pin') as Element)
    })

    expect(stringsDrawn()).toBe(1)
  })

  it('hides a string whose card has left the board rather than losing it', async () => {
    // Strings need two cards; a third scene plus a character give the
    // character a string, then the character comes off the board.
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await putOnBoard(path, 'Elara Voss')
    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeTruthy())
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await clickAt(faceOf(titles()[0]), 40, 30)
    await clickAt(faceOf('Elara Voss'), 60, 700)
    await waitFor(() => expect(stringsDrawn()).toBe(1))

    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await act(async () => {
      fireEvent.click(cardByTitle('Elara Voss').querySelector('.scene-card-off') as HTMLElement)
    })

    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeUndefined())
    expect(stringsDrawn()).toBe(0)
    // Still on disk: Add Card can bring the character back, and the string
    // with it.
    expect(await api.listBoardStrings(path)).toHaveLength(1)
  })
})

describe('portraits on cards (F-47)', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

  it('shows the portrait beside the title of a card that has one', async () => {
    const path = await openDemo()
    await tagScenes(path, 1)
    const elara = (await api.listEntities(path)).find((e) => e.name === 'Elara Voss')!
    await api.writeEntity(path, { ...elara, onBoard: true, portrait: `characters/${elara.id}.png` })
    vi.spyOn(api, 'readPortrait').mockResolvedValue(PNG)
    await act(async () => {
      await useWyrm.getState().loadEntities()
    })
    await renderBoard()
    await waitFor(() => expect(cardByTitle('Elara Voss')).toBeTruthy())

    await waitFor(() =>
      expect(cardByTitle('Elara Voss').querySelector('.scene-card-portrait')).toBeTruthy()
    )
    const img = cardByTitle('Elara Voss').querySelector('.scene-card-portrait') as HTMLImageElement
    // A data: URL, never a path: the renderer names an entry, not a file.
    expect(img.src.startsWith('data:image/png')).toBe(true)
    // Read by id through the bridge, once.
    expect(api.readPortrait).toHaveBeenCalledWith(path, elara.id)
  })

  it('shows no portrait on a card that has none, and never asks for one', async () => {
    const path = await openDemo()
    await tagScenes(path, 1)
    await putOnBoard(path, 'Marten')
    const read = vi.spyOn(api, 'readPortrait')
    await renderBoard()
    await waitFor(() => expect(cardByTitle('Marten')).toBeTruthy())

    expect(cardByTitle('Marten').querySelector('.scene-card-portrait')).toBeNull()
    expect(read).not.toHaveBeenCalled()
  })
})
