// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

const tools = { onTimeline: vi.fn(), onPlotGraph: vi.fn(), onWorldMap: vi.fn() }

async function renderBoard(): Promise<void> {
  await act(async () => {
    render(
      <Corkboard
        onTimeline={tools.onTimeline}
        onPlotGraph={tools.onPlotGraph}
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

    await waitFor(() => expect(screen.getByText(/No scenes yet/i)).toBeTruthy())
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

    await waitFor(() => expect(screen.getByText(/No scenes yet/i)).toBeTruthy())
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

  it('does not capture the pointer until the card actually moves', async () => {
    // jsdom cannot model pointer capture, so this asserts *when* capture is
    // taken rather than what it does. It is worth the implementation detail:
    // capturing on the press redirects the rest of the gesture to the card
    // wrapper, and the card's own button then never receives pointerup or
    // click — pressing a card did nothing at all. Only a real click in the
    // browser showed it.
    const taken: string[] = []
    HTMLElement.prototype.setPointerCapture = function () {
      taken.push('captured')
    }
    const cards = cardEls()

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    expect(taken).toEqual([])

    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    expect(taken).toEqual(['captured'])
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
