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
 * Clears every scene tag. The mock keeps documents in a module-level map that
 * outlives a test, so without this each test inherits whatever the previous
 * one tagged — and the empty-board and unwritten-scene cases become
 * unreachable.
 */
async function clearScenes(path: string): Promise<void> {
  for (const d of await api.readAllDocs(path)) {
    await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: [] } })
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

/** jsdom has no layout engine, so the cards are given real boxes: a row of
 *  three 200px cards with 20px gutters between them. The geometry is the
 *  entire thing under test, so it has to be stated rather than measured. */
function layOutCards(): HTMLElement[] {
  const cards = [...document.querySelectorAll('.scene-card')] as HTMLElement[]
  cards.forEach((card, i) => {
    const left = i * 220
    card.getBoundingClientRect = () =>
      ({ left, width: 200, top: 0, height: 100, right: left + 200, bottom: 100 }) as DOMRect
  })
  return cards
}

describe('dragging a card', () => {
  beforeEach(async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
  })

  it('reorders the manuscript through the binder, not a second mechanism', async () => {
    // Asserted on the outcome rather than a spy: the component captured
    // `moveBinderNode` from the store when it rendered, so a spy installed
    // afterwards would never be the function it calls.
    const before = titles()
    const cards = layOutCards()

    // Each event in its own act: React batches within one, so a single act
    // would leave the later handlers seeing stale state.
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    await act(async () => pointer(cards[0], 'pointerup', 600, 50))

    await waitFor(() => expect(titles()).not.toEqual(before))
    // Dropped on the right half of the last card, so it lands last.
    expect(titles()[2]).toBe(before[0])
  })

  it('lands before or after depending on which half of the card is under it', async () => {
    const before = titles()
    const cards = layOutCards()

    // 490 is the left half of the third card (440–640).
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 490, 50))
    await act(async () => pointer(cards[0], 'pointerup', 490, 50))

    await waitFor(() => expect(titles()).not.toEqual(before))
    expect(titles()).toEqual([before[1], before[0], before[2]])
  })

  it('lands in the gutter between two cards rather than snapping back', async () => {
    // A writer aiming at the space between two cards means to put it there.
    const before = titles()
    const cards = layOutCards()

    await act(async () => pointer(cards[2], 'pointerdown', 500, 50))
    await act(async () => pointer(cards[2], 'pointermove', 205, 50))
    await act(async () => pointer(cards[2], 'pointerup', 205, 50))

    await waitFor(() => expect(titles()).not.toEqual(before))
    expect(titles()).toEqual([before[0], before[2], before[1]])
  })

  it('shows which side the card will land on while it is being carried', async () => {
    const cards = layOutCards()

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    expect(cards[2].className).toContain('drop-after')

    await act(async () => pointer(cards[0], 'pointermove', 460, 50))
    expect(cards[2].className).toContain('drop-before')
  })

  it('does not count a press that never moved as a drag', async () => {
    // Below the threshold the card has not been picked up at all, so the
    // click underneath it must still reach the scene.
    const before = titles()
    const cards = layOutCards()

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 52, 51))
    await act(async () => pointer(cards[0], 'pointerup', 52, 51))

    expect(titles()).toEqual(before)
    expect(document.querySelector('.scene-card.dragging')).toBeNull()
  })

  it('does not open the scene it just moved', async () => {
    // The card's whole face is a button, so the pointerup that ends a drag is
    // also a click on it. Without suppression, moving a card yanks the writer
    // into that scene.
    const cards = layOutCards()
    const activeBefore = useWyrm.getState().activeId

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    await act(async () => pointer(cards[0], 'pointerup', 600, 50))
    await act(async () => {
      fireEvent.click(cards[0].querySelector('.scene-card-face') as HTMLElement)
    })

    expect(useWyrm.getState().activeId).toBe(activeBefore)
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
    const cards = layOutCards()

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    expect(taken).toEqual([])

    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    expect(taken).toEqual(['captured'])
  })

  it('still opens a scene on the next click after a move', async () => {
    // The click that ends a drag lands on the nearest common ancestor of the
    // press and the release — the board, not the button — whenever the card
    // was dropped somewhere else. So nothing consumes the suppression, and
    // leaving it set swallows the next real click: move a card, then click
    // any card, and it refuses to open. Caught by clicking in the preview,
    // not by a test.
    const cards = layOutCards()
    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 600, 50))
    await act(async () => pointer(cards[0], 'pointerup', 600, 50))

    const target = [...document.querySelectorAll('.scene-card')][1] as HTMLElement
    const id = useWyrm.getState().project?.data.binder[0].children?.[0].children?.[1].id
    await act(async () => pointer(target, 'pointerdown', 300, 50))
    await act(async () => pointer(target, 'pointerup', 300, 50))
    await act(async () => {
      fireEvent.click(target.querySelector('.scene-card-face') as HTMLElement)
    })

    await waitFor(() => expect(useWyrm.getState().activeId).toBeTruthy())
    expect(useWyrm.getState().activeId).toBe(id)
  })

  it('does nothing when a card is released where it started', async () => {
    const before = titles()
    const cards = layOutCards()

    await act(async () => pointer(cards[0], 'pointerdown', 50, 50))
    await act(async () => pointer(cards[0], 'pointermove', 60, 55))
    await act(async () => pointer(cards[0], 'pointerup', 60, 55))

    expect(titles()).toEqual(before)
  })
})
