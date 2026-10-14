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

/** A drag event carrying a real `clientX`.
 *
 *  `fireEvent.dragOver(el, { clientX })` does not deliver one — jsdom has no
 *  DragEvent, so the coordinate is dropped and every drop reads as "before".
 *  A MouseEvent of the same type is what React's synthetic handler sees. */
function dragOverAt(el: HTMLElement, clientX: number): void {
  el.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX }))
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

describe('dragging a card', () => {
  it('reorders the manuscript through the binder, not a second mechanism', async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
    // Asserted on the outcome rather than a spy: the component captured
    // `moveBinderNode` from the store when it rendered, so a spy installed
    // afterwards would never be the function it calls.
    const before = titles()
    const cards = [...document.querySelectorAll('.scene-card')] as HTMLElement[]
    cards[2].getBoundingClientRect = () =>
      ({ left: 100, width: 200, top: 0, height: 100 }) as DOMRect

    // Each event in its own act: React batches within one, so a single act
    // would leave the drop handler's closure still seeing `dragging` as null.
    await act(async () => {
      fireEvent.dragStart(cards[0])
    })
    await act(async () => {
      dragOverAt(cards[2], 250)
    })
    await act(async () => {
      fireEvent.drop(cards[2])
    })

    await waitFor(() => expect(titles()).not.toEqual(before))
    expect(titles()[titles().length - 1]).toBe(before[0])
  })

  it('drops before or after depending on which half of the card is under the pointer', async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
    const cards = [...document.querySelectorAll('.scene-card')] as HTMLElement[]
    // jsdom has no layout, so the card is given a real box — the midpoint is
    // the entire thing under test.
    cards[2].getBoundingClientRect = () =>
      ({ left: 100, width: 200, top: 0, height: 100 }) as DOMRect

    await act(async () => {
      fireEvent.dragStart(cards[0])
    })
    await act(async () => {
      dragOverAt(cards[2], 250)
    })
    expect(cards[2].className).toContain('drop-after')

    await act(async () => {
      dragOverAt(cards[2], 150)
    })
    expect(cards[2].className).toContain('drop-before')
  })

  it('does nothing when a card is dropped on itself', async () => {
    const path = await openDemo()
    await tagScenes(path)
    await renderBoard()
    await waitFor(() => expect(titles().length).toBe(3))
    const before = titles()
    const cards = [...document.querySelectorAll('.scene-card')] as HTMLElement[]

    await act(async () => {
      fireEvent.dragStart(cards[0])
    })
    await act(async () => {
      dragOverAt(cards[0], 0)
    })
    await act(async () => {
      fireEvent.drop(cards[0])
    })

    expect(titles()).toEqual(before)
  })
})
