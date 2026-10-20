// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocFile, DocMeta } from '../src/shared/types'
import { DEFAULT_APPEARANCE, DEFAULT_STATS } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { Corkboard } from '../src/renderer/src/components/Corkboard'
import { CARD_W, NUDGE, NUDGE_BIG, nearestCard } from '../src/renderer/src/lib/corkboard'

/**
 * The corkboard from the keyboard. It was mouse-only: cards could be
 * reached with Tab but not moved, the string tool had no key path, and Add
 * Card had no shortcut. jsdom lays nothing out, so the board is one column
 * here — cards at y 0, 224, 448 — which is enough to drive every key.
 */

let demoPath: string | null = null
let seeded: DocFile[] | null = null

async function openDemo(): Promise<string> {
  demoPath ??= (await api.getLastProjectPath())!
  seeded ??= await api.readAllDocs(demoPath)
  for (const d of seeded) {
    const meta: DocMeta = { ...d.meta, tags: [] }
    delete meta.boardX
    delete meta.boardY
    await api.writeDoc(demoPath, { ...d, meta })
  }
  for (const s of await api.listBoardStrings(demoPath)) await api.deleteBoardString(demoPath, s.id)
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  useWyrm.setState({ activeId: null, activeDoc: null })
  return demoPath
}

async function tagScenes(path: string, howMany: number): Promise<string[]> {
  const docs = (await api.readAllDocs(path)).slice(0, howMany)
  for (const d of docs) await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: ['scene'] } })
  return docs.map((d) => d.meta.title)
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
  await waitFor(() => expect(document.querySelectorAll('.scene-card').length).toBeGreaterThan(0))
}

const face = (title: string): HTMLElement => screen.getByRole('button', { name: `Open ${title}` })
const cardOf = (title: string): HTMLElement => face(title).closest('.scene-card') as HTMLElement
const pos = (title: string): { x: string; y: string } => ({
  x: cardOf(title).style.left,
  y: cardOf(title).style.top
})
const key = async (
  el: HTMLElement,
  k: string,
  mods: Partial<KeyboardEventInit> = {}
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(el, { key: k, ...mods })
  })
}
const tool = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll('.board-tool')].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement

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
    addCardFor: null,
    mainView: { kind: 'doc' },
    viewHistory: []
  })
  __disposeAll()
})

describe('the nearest card in a direction', () => {
  const at = (id: string, x: number, y: number): { id: string; x: number; y: number } => ({
    id,
    x,
    y
  })

  it('goes to the card that way, not the next one in the list', () => {
    const cards = [at('a', 0, 0), at('far', 900, 0), at('b', 234, 0), at('c', 0, 224)]
    expect(nearestCard(cards, 'a', 'right')).toBe('b')
    expect(nearestCard(cards, 'a', 'down')).toBe('c')
    expect(nearestCard(cards, 'b', 'left')).toBe('a')
    expect(nearestCard(cards, 'c', 'up')).toBe('a')
  })

  it('never lands on a card beside it when going down, nor below it when going right', () => {
    const cards = [at('a', 0, 0), at('beside', 234, 10), at('below', 30, 300)]
    expect(nearestCard(cards, 'a', 'down')).toBe('below')
    expect(nearestCard(cards, 'a', 'right')).toBe('beside')
  })

  it('prefers the card straight ahead to a nearer one far to the side', () => {
    const cards = [at('a', 0, 0), at('aside', 150, 140), at('ahead', 0, 224)]
    expect(nearestCard(cards, 'a', 'down')).toBe('ahead')
  })

  it('stops at the edge of the board', () => {
    const cards = [at('a', 0, 0), at('b', 234, 0)]
    expect(nearestCard(cards, 'a', 'left')).toBeNull()
    expect(nearestCard(cards, 'a', 'up')).toBeNull()
    expect(nearestCard(cards, 'missing', 'up')).toBeNull()
  })
})

describe('cards from the keyboard', () => {
  let path: string
  let scenes: string[]
  beforeEach(async () => {
    path = await openDemo()
    scenes = await tagScenes(path, 3)
    await renderBoard()
  })

  it('moves focus to the nearest card with the arrows, and no further than the edge', async () => {
    const [first, second] = scenes
    face(first).focus()
    await key(face(first), 'ArrowDown')
    expect(document.activeElement).toBe(face(second))
    await key(face(second), 'ArrowUp')
    expect(document.activeElement).toBe(face(first))
    await key(face(first), 'ArrowUp')
    expect(document.activeElement).toBe(face(first))
    // Moving focus moves nothing.
    expect(pos(first)).toEqual({ x: '0px', y: '0px' })
  })

  it('nudges a card with ⌥+arrows, further with ⇧⌥, and writes where it lands', async () => {
    const [, second] = scenes
    face(second).focus()
    await key(face(second), 'ArrowRight', { altKey: true })
    expect(pos(second)).toEqual({ x: `${NUDGE}px`, y: '224px' })
    await key(face(second), 'ArrowDown', { altKey: true, shiftKey: true })
    expect(pos(second)).toEqual({ x: `${NUDGE}px`, y: `${224 + NUDGE_BIG}px` })
    // Focus stays on the card being moved.
    expect(document.activeElement).toBe(face(second))
    await waitFor(async () => {
      const doc = (await api.readAllDocs(path)).find((d) => d.meta.title === second)!
      expect([doc.meta.boardX, doc.meta.boardY]).toEqual([NUDGE, 224 + NUDGE_BIG])
    })
  })

  it('does not nudge a card off the top-left of the board', async () => {
    const [first] = scenes
    await key(face(first), 'ArrowLeft', { altKey: true })
    await key(face(first), 'ArrowUp', { altKey: true })
    expect(pos(first)).toEqual({ x: '0px', y: '0px' })
  })

  it('pulls a nudged card out of its pile, as a drag does', async () => {
    const [first] = scenes
    await act(async () => {
      fireEvent.click(tool('Stack'))
    })
    const piled = pos(first)
    await key(face(first), 'ArrowRight', { altKey: true })
    expect(pos(first)).toEqual({ x: `${parseInt(piled.x) + NUDGE}px`, y: piled.y })
    expect(document.querySelector('.corkboard-board.stacked')).toBeTruthy()
  })

  it('leaves ⇧+arrows and ⌘+arrows alone, for the page and the system', async () => {
    const [first] = scenes
    face(first).focus()
    await key(face(first), 'ArrowDown', { shiftKey: true })
    expect(document.activeElement).toBe(face(first))
    let handled = true
    await act(async () => {
      handled = !fireEvent.keyDown(face(first), { key: 'ArrowUp', metaKey: true })
    })
    expect(handled).toBe(false)
  })

  it('nudges left and up by the same steps as right and down', async () => {
    const [, second] = scenes
    await key(face(second), 'ArrowRight', { altKey: true, shiftKey: true })
    await key(face(second), 'ArrowRight', { altKey: true })
    await key(face(second), 'ArrowLeft', { altKey: true })
    expect(pos(second)).toEqual({ x: `${NUDGE_BIG}px`, y: '224px' })
    await key(face(second), 'ArrowLeft', { altKey: true, shiftKey: true })
    expect(pos(second)).toEqual({ x: '0px', y: '224px' })
    await key(face(second), 'ArrowUp', { altKey: true })
    expect(pos(second)).toEqual({ x: '0px', y: `${224 - NUDGE}px` })
    await key(face(second), 'ArrowUp', { altKey: true, shiftKey: true })
    expect(pos(second)).toEqual({ x: '0px', y: `${224 - NUDGE - NUDGE_BIG}px` })
  })

  it('writes a burst of nudges once, where the card ends up', async () => {
    const [, second] = scenes
    const write = vi.spyOn(useWyrm.getState(), 'setCardPosition')
    for (let i = 0; i < 5; i++) await key(face(second), 'ArrowRight', { altKey: true })
    expect(pos(second).x).toBe(`${5 * NUDGE}px`)
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1))
    expect(write).toHaveBeenCalledWith(expect.any(String), 5 * NUDGE, 224)
  })

  it('opens the card on a plain Return — ⇧Return alone turns it over', async () => {
    const [first] = scenes
    let notPrevented = false
    await act(async () => {
      notPrevented = fireEvent.keyDown(face(first), { key: 'Enter' })
    })
    // Left to the button, whose click opens the scene.
    expect(notPrevented).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not turn a card over with the string tool up', async () => {
    const [first] = scenes
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await key(face(first), 'Enter', { shiftKey: true })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('turns a scene card over on ⇧Return', async () => {
    const [first] = scenes
    await key(face(first), 'Enter', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: `Back of ${first}` })).toBeTruthy()
  })
})

describe('a character card from the keyboard', () => {
  it('has no back to turn to', async () => {
    const path = await openDemo()
    await tagScenes(path, 1)
    const elara = (await api.listEntities(path)).find((e) => e.name === 'Elara Voss')!
    await api.writeEntity(path, { ...elara, onBoard: true })
    try {
      await act(async () => {
        await useWyrm.getState().loadEntities()
      })
      await renderBoard()
      await key(face('Elara Voss'), 'Enter', { shiftKey: true })
      expect(screen.queryByRole('dialog')).toBeNull()
    } finally {
      await api.writeEntity(path, { ...elara, onBoard: undefined })
    }
  })
})

describe('strings from the keyboard', () => {
  let path: string
  let scenes: string[]
  beforeEach(async () => {
    path = await openDemo()
    scenes = await tagScenes(path, 3)
    await renderBoard()
    await act(async () => {
      fireEvent.click(tool('String'))
    })
  })

  /** Return on a button is a click with no pointer: detail 0. */
  const press = async (title: string): Promise<void> => {
    await act(async () => {
      fireEvent.click(face(title), { detail: 0 })
    })
  }

  it('pins each card at its top centre on Return, says so, and runs the string', async () => {
    const [first, second] = scenes
    await press(first)
    expect(screen.getByRole('status').textContent).toContain(`Pinned to ${first}`)
    await press(second)

    await waitFor(() => expect(document.querySelectorAll('.board-string').length).toBe(1))
    const [s] = await api.listBoardStrings(path)
    // The card's own pin: top centre.
    expect(s.from).toMatchObject({ dx: CARD_W / 2, dy: 10 })
    expect(s.to).toMatchObject({ dx: CARD_W / 2, dy: 10 })
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('lets a pin be reached with Tab and pulled with Delete — only while the tool is up', async () => {
    const [first, second] = scenes
    await press(first)
    await press(second)
    const pin = await waitFor(() =>
      screen.getAllByRole('button', { name: `Pull the string from ${first} to ${second}` })
    )
    expect(pin[0].getAttribute('tabindex')).toBe('0')

    // Put the tool down: the pins are decoration again — out of the tab
    // order, not announced as buttons, and deaf to the keys.
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    for (const p of document.querySelectorAll('.board-pin')) {
      expect(p.getAttribute('tabindex')).toBeNull()
      expect(p.getAttribute('role')).toBeNull()
      expect(p.getAttribute('aria-label')).toBeNull()
    }
    await key(document.querySelector('.board-pin') as HTMLElement, 'Delete')
    await key(document.querySelector('.board-pin') as HTMLElement, 'Enter')
    expect(await api.listBoardStrings(path)).toHaveLength(1)
    await act(async () => {
      fireEvent.click(tool('String'))
    })

    const again = screen.getAllByRole('button', {
      name: `Pull the string from ${first} to ${second}`
    })
    await key(again[0] as HTMLElement, 'Delete')
    await waitFor(() => expect(document.querySelectorAll('.board-string').length).toBe(0))
    expect(await api.listBoardStrings(path)).toEqual([])
    // Not dropped to <body> with the pin.
    expect(document.activeElement).toBe(face(first))
  })
})

describe('pulling a pin', () => {
  it('answers to Return, Space and Backspace as well as Delete', async () => {
    const path = await openDemo()
    const scenes = await tagScenes(path, 2)
    await renderBoard()
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    for (const k of ['Enter', ' ', 'Backspace']) {
      for (const t of scenes) {
        await act(async () => {
          fireEvent.click(face(t), { detail: 0 })
        })
      }
      await waitFor(() => expect(document.querySelectorAll('.board-string').length).toBe(1))
      await key(document.querySelector('.board-pin') as HTMLElement, k)
      await waitFor(() => expect(document.querySelectorAll('.board-string').length).toBe(0))
    }
  })
})

describe('Add Card from anywhere', () => {
  async function renderApp(): Promise<void> {
    vi.spyOn(api, 'getStatsSettings').mockResolvedValue(DEFAULT_STATS)
    vi.spyOn(api, 'getAppearance').mockResolvedValue(DEFAULT_APPEARANCE)
    vi.spyOn(api, 'getDailyStats').mockResolvedValue([])
    const { default: App } = await import('../src/renderer/src/App')
    await act(async () => {
      render(<App />)
    })
  }

  it('opens the board with Add Card up on ⌥⌘N, from the manuscript', async () => {
    await openDemo()
    await renderApp()
    expect(useWyrm.getState().mainView).toEqual({ kind: 'doc' })
    await act(async () => {
      fireEvent.keyDown(window, { key: '˜', code: 'KeyN', altKey: true, metaKey: true })
    })
    expect(useWyrm.getState().mainView.kind).toBe('corkboard')
    await waitFor(() => expect(screen.getByText('What kind of card?')).toBeTruthy())
  })

  it('does not take Ctrl+Alt+N on Windows, which reports the key as "n", for New Document', async () => {
    await openDemo()
    await renderApp()
    const addDoc = vi.spyOn(useWyrm.getState(), 'addDoc')
    await act(async () => {
      fireEvent.keyDown(window, { key: 'n', code: 'KeyN', altKey: true, ctrlKey: true })
    })
    // Not a new document. (Not Add Card either: like every ⌥⌘ shortcut it
    // answers to ⌘ only, since Ctrl+Alt is AltGr on many Windows layouts and
    // types characters.)
    expect(addDoc).not.toHaveBeenCalled()
  })

  it('closes when another open project is focused, and stays closed coming back', async () => {
    const a = await openDemo()
    await act(() => useWyrm.getState().openAnotherProject())
    const b = useWyrm.getState().project!.path
    // Both on their boards: switching between them never leaves a board, so
    // only the focus change itself can close the dialog.
    act(() => {
      useWyrm.getState().showCorkboard()
    })
    await act(() => useWyrm.getState().focusProject(a))
    act(() => {
      useWyrm.getState().showCorkboard()
    })
    act(() => {
      useWyrm.getState().openAddCard()
    })
    expect(useWyrm.getState().addCardFor).toBe(a)
    await act(() => useWyrm.getState().focusProject(b))
    expect(useWyrm.getState().addCardFor).toBeNull()
    await act(() => useWyrm.getState().focusProject(a))
    expect(useWyrm.getState().addCardFor).toBeNull()
  })

  it('closes when another project is opened', async () => {
    await openDemo()
    act(() => {
      useWyrm.getState().openAddCard()
    })
    await act(() => useWyrm.getState().openAnotherProject())
    expect(useWyrm.getState().addCardFor).toBeNull()
  })

  it('closes when the writer leaves the board, rather than popping up on the next visit', async () => {
    await openDemo()
    await renderApp()
    act(() => {
      useWyrm.getState().openAddCard()
    })
    await waitFor(() => expect(screen.getByText('What kind of card?')).toBeTruthy())
    act(() => {
      useWyrm.getState().toggleCorkboard()
    })
    expect(useWyrm.getState().addCardFor).toBeNull()
    act(() => {
      useWyrm.getState().toggleCorkboard()
    })
    await waitFor(() => expect(document.querySelector('.corkboard')).toBeTruthy())
    expect(screen.queryByText('What kind of card?')).toBeNull()
  })

  it('does not open over another dialog', async () => {
    const path = await openDemo()
    const [first] = await tagScenes(path, 1)
    await renderApp()
    act(() => {
      useWyrm.getState().showCorkboard()
    })
    await waitFor(() => expect(document.querySelector('.scene-card')).toBeTruthy())
    await key(face(first), 'Enter', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: `Back of ${first}` })).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(window, { key: '˜', code: 'KeyN', altKey: true, metaKey: true })
    })
    expect(useWyrm.getState().addCardFor).toBeNull()
    expect(screen.queryByText('What kind of card?')).toBeNull()
  })

  it('closes on Esc even with the string tool up, which keeps the tool up', async () => {
    const path = await openDemo()
    await tagScenes(path, 2)
    await renderBoard()
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    // (The tool needs two cards to be offered at all.)
    expect(tool('String').classList.contains('on')).toBe(true)
    act(() => {
      useWyrm.getState().openAddCard()
    })
    await waitFor(() => expect(screen.getByText('What kind of card?')).toBeTruthy())
    await act(async () => {
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    })
    expect(screen.queryByText('What kind of card?')).toBeNull()
    expect(tool('String').classList.contains('on')).toBe(true)
  })

  it('puts the keyboard on the card it made', async () => {
    const path = await openDemo()
    await tagScenes(path, 1)
    await renderBoard()
    act(() => {
      useWyrm.getState().openAddCard()
    })
    const title = await waitFor(() => screen.getByPlaceholderText('Title of the scene'))
    fireEvent.change(title, { target: { value: 'Made Here' } })
    // Earlier tests press keys without releasing them; start with none held.
    window.dispatchEvent(new Event('blur'))
    await act(async () => {
      fireEvent.keyDown(title, { key: 'Enter', code: 'Enter' })
    })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Open Made Here' })).toBeTruthy())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    // Not while Return is still down: moved onto the card's button then, that
    // same Return opened the new card and the board was gone.
    expect(document.activeElement).not.toBe(face('Made Here'))
    await act(async () => {
      fireEvent.keyUp(window, { key: 'Enter', code: 'Enter' })
    })
    await waitFor(() => expect(document.activeElement).toBe(face('Made Here')))
  })

  it('puts the keyboard back on the tool when nothing was made', async () => {
    const path = await openDemo()
    await tagScenes(path, 1)
    await renderBoard()
    act(() => {
      useWyrm.getState().openAddCard()
    })
    await waitFor(() => expect(screen.getByText('What kind of card?')).toBeTruthy())
    ;(document.activeElement as HTMLElement | null)?.blur()
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    })
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Add Card'))
  })

  it('does not take Ctrl+Shift+Alt+N for New Folder either', async () => {
    await openDemo()
    await renderApp()
    const addFolder = vi.spyOn(useWyrm.getState(), 'addFolder')
    await act(async () => {
      fireEvent.keyDown(window, {
        key: 'N',
        code: 'KeyN',
        altKey: true,
        shiftKey: true,
        ctrlKey: true
      })
    })
    expect(addFolder).not.toHaveBeenCalled()
  })
})
