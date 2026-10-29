// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocFile, DocMeta, Entity } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { Corkboard } from '../src/renderer/src/components/Corkboard'
import { CARD_W } from '../src/renderer/src/lib/corkboard'

/**
 * F-45 on the board: the colour swatches, strings drawn in a colour, and
 * stickers — picked from the Sticker sheet, stuck where the board is
 * clicked, carried by the card they are on, moved by dragging, peeled off
 * with Delete. jsdom has no layout, so the board's corner is the client
 * origin and a click's clientX/Y is a board point.
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
  for (const s of await api.listBoardStickers(demoPath))
    await api.deleteBoardSticker(demoPath, s.id)
  for (const r of await api.listRelationships(demoPath))
    await api.deleteRelationship(demoPath, r.id)
  for (const e of await api.listEntities(demoPath)) {
    const clean: Entity = { ...e }
    delete clean.onBoard
    delete clean.boardX
    delete clean.boardY
    await api.writeEntity(demoPath, clean)
  }
  const docs = (await api.readAllDocs(demoPath)).slice(0, 2)
  for (const d of docs) await api.writeDoc(demoPath, { ...d, meta: { ...d.meta, tags: ['scene'] } })
  scenes = docs.map((d) => d.meta.title)
  sceneIds = docs.map((d) => d.meta.id)
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  useWyrm.setState({ activeId: null, activeDoc: null })
  return demoPath
}

let scenes: string[] = []
let sceneIds: string[] = []

async function renderBoard(cards = 2): Promise<void> {
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
  await waitFor(() => expect(document.querySelectorAll('.scene-card').length).toBe(cards))
}

const face = (title: string): HTMLElement => screen.getByRole('button', { name: `Open ${title}` })
const card = (title: string): HTMLElement => face(title).closest('.scene-card') as HTMLElement
const at = (el: HTMLElement): { x: number; y: number } => ({
  x: parseFloat(el.style.left),
  y: parseFloat(el.style.top)
})
const tool = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll('.board-tool')].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement
const board = (): HTMLElement => document.querySelector('.corkboard-board') as HTMLElement
const stickers = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.board-sticker')]

const pick = async (name: string): Promise<void> => {
  await act(async () => {
    fireEvent.click(tool('Sticker'))
  })
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name }))
  })
}
const swatch = (group: string, colour: string): HTMLElement =>
  screen
    .getByRole('radiogroup', { name: group })
    .querySelector(`[aria-label="${colour}"]`) as HTMLElement

function pointer(el: Element | Document, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

let path: string
beforeEach(async () => {
  vi.restoreAllMocks()
  path = await openDemo()
  await renderBoard()
})

afterEach(() => {
  // A sticker drag that ended without a click leaves its click-swallower
  // waiting for the next press; a test's drag must not eat the next test's.
  pointer(document, 'pointerdown', 0, 0)
  cleanup()
  useWyrm.setState({
    project: null,
    booted: false,
    parked: {},
    openPaths: [],
    editor: null,
    mainView: { kind: 'doc' },
    viewHistory: [],
    boardStickers: []
  })
  __disposeAll()
})

describe('stickers', () => {
  it('sticks the one picked where a card is clicked, on that card, in the colour chosen', async () => {
    await act(async () => {
      fireEvent.click(swatch('Colour of strings and stickers', 'Blue'))
    })
    await pick('Question mark')
    expect(tool('Sticker').classList.contains('on')).toBe(true)
    expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull()
    const b = card(scenes[1])
    const c = at(b)
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    await act(async () => {
      fireEvent.click(face(scenes[1]), { clientX: c.x + 50, clientY: c.y + 40, detail: 1 })
    })
    const [s] = await api.listBoardStickers(path)
    expect(s).toMatchObject({ kind: 'question', colour: 'blue', cardId: sceneIds[1] })
    expect([s.x, s.y]).toEqual([50, 40])
    // Drawn inside the card, so wherever the card goes the sticker goes.
    const [el] = stickers()
    expect(el.closest('.scene-card')).toBe(b)
    expect(el.classList.contains('colour-blue')).toBe(true)
    expect(el.style.transform).toContain(`rotate(${s.rotation}deg)`)
    // Clicking a card with a sticker in hand did not open it.
    expect(useWyrm.getState().activeId).toBeNull()
  })

  it('goes with its card when the card moves, and stays on the card', async () => {
    await pick('Star')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
    })
    const before = (await api.listBoardStickers(path))[0]
    await act(async () => {
      fireEvent.click(tool('Sticker'))
    })
    // Dragged across the board, as a writer drags a card.
    const from = at(card(scenes[0]))
    await act(async () => {
      pointer(face(scenes[0]), 'pointerdown', from.x + 100, from.y + 100)
      pointer(document, 'pointermove', from.x + 400, from.y + 300)
      pointer(document, 'pointerup', from.x + 400, from.y + 300)
    })
    await waitFor(() => expect(at(card(scenes[0]))).toEqual({ x: from.x + 300, y: from.y + 200 }))
    const el = stickers()[0]
    expect(el.closest('.scene-card')).toBe(card(scenes[0]))
    // Nothing about the sticker itself changed: its place is on the card.
    expect((await api.listBoardStickers(path))[0]).toEqual(before)
  })

  it('sticks to the cork where the cork is clicked, under the cards, and stays there', async () => {
    await pick('Heart')
    await act(async () => {
      fireEvent.click(board(), { clientX: 900, clientY: 700, detail: 1 })
    })
    const [s] = await api.listBoardStickers(path)
    expect('cardId' in s).toBe(false)
    expect(Math.abs(s.x - 900)).toBeLessThanOrEqual(2)
    const el = stickers()[0]
    expect(el.closest('.scene-card')).toBeNull()
    // Before the first card: a card put down over it covers it.
    expect(
      el.compareDocumentPosition(card(scenes[0])) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('sticks to the cork below the cards too, and never in the margin out of reach', async () => {
    await pick('Dot')
    // The board is only as tall as its cards; the cork goes on below it.
    const view = document.querySelector('.corkboard') as HTMLElement
    await act(async () => {
      fireEvent.click(view, { clientX: 300, clientY: 2000, detail: 1 })
      fireEvent.click(view, { clientX: -40, clientY: -40, detail: 1 })
    })
    const [low, corner] = await api.listBoardStickers(path)
    expect(Math.abs(low.y - 2000)).toBeLessThanOrEqual(2)
    expect(Math.min(corner.x, corner.y)).toBeGreaterThanOrEqual(12)
    // The tools are not cork.
    await act(async () => {
      fireEvent.click(document.querySelector('.corkboard-tools')!, { detail: 1 })
    })
    expect(await api.listBoardStickers(path)).toHaveLength(2)
  })

  it('keeps the colours where they are when a sticker is picked', async () => {
    const slot = (): HTMLElement => tool('Sticker').querySelector('.sticker-in-hand') as HTMLElement
    expect(slot().querySelector('.board-tool-pin')).not.toBeNull()
    await pick('Star')
    // The sticker in hand takes the pin's slot, not a new one.
    expect(slot().querySelector('.sticker-glyph')).not.toBeNull()
    expect(tool('Sticker').children).toHaveLength(2)
  })

  it("from the keyboard, sticks it at the card's top right", async () => {
    await pick('Tick')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { detail: 0 })
    })
    const [s] = await api.listBoardStickers(path)
    expect(Math.abs(s.x - (CARD_W - 22))).toBeLessThanOrEqual(2)
    expect(Math.abs(s.y - 22)).toBeLessThanOrEqual(2)
  })

  it('puts the sticker down on Esc, without leaving the board, and on pressing the button', async () => {
    await pick('Dot')
    const back = vi.fn()
    window.addEventListener('keydown', back)
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    window.removeEventListener('keydown', back)
    expect(back).not.toHaveBeenCalled()
    expect(tool('Sticker').classList.contains('on')).toBe(false)
    await pick('Dot')
    await act(async () => {
      fireEvent.click(tool('Sticker'))
    })
    expect(tool('Sticker').classList.contains('on')).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull()
    // With nothing in hand, a card opens again.
    await act(async () => {
      fireEvent.click(board(), { clientX: 900, clientY: 700, detail: 1 })
    })
    expect(await api.listBoardStickers(path)).toEqual([])
  })

  it('closes the sheet on its own Esc, back to the button, staying on the board', async () => {
    await act(async () => {
      fireEvent.click(tool('Sticker'))
    })
    const sheet = screen.getByRole('dialog', { name: 'Stickers' })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Star' }))
    const back = vi.fn()
    window.addEventListener('keydown', back)
    await act(async () => {
      fireEvent.keyDown(sheet, { key: 'Escape' })
      fireEvent.keyUp(document.body, { key: 'Escape' })
    })
    window.removeEventListener('keydown', back)
    expect(back).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: 'Stickers' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(tool('Sticker')))
  })

  it('puts the string tool down when a sticker is picked, and the sticker down for the string', async () => {
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await pick('Cross')
    expect(tool('String').classList.contains('on')).toBe(false)
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    expect(tool('Sticker').classList.contains('on')).toBe(false)
  })

  it('moves by dragging: off a card onto the cork, and onto the other card', async () => {
    await pick('Star')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
      fireEvent.click(tool('Sticker'))
    })
    const id = (await api.listBoardStickers(path))[0].id
    const drag = async (
      from: { x: number; y: number },
      to: { x: number; y: number }
    ): Promise<void> => {
      await act(async () => {
        pointer(stickers()[0], 'pointerdown', from.x, from.y)
        pointer(document, 'pointermove', to.x, to.y)
        pointer(document, 'pointerup', to.x, to.y)
      })
    }
    const s0 = (await api.listBoardStickers(path))[0]
    const a = at(card(scenes[0]))
    // From its centre to a point well clear of both cards.
    const start = { x: a.x + s0.x, y: a.y + s0.y }
    await drag(start, { x: 1200, y: 900 })
    let s = (await api.listBoardStickers(path)).find((x) => x.id === id)!
    expect('cardId' in s).toBe(false)
    expect([s.x, s.y]).toEqual([1200, 900])
    expect(stickers()[0].closest('.scene-card')).toBeNull()
    // And onto the second card, where it sticks at its place on that card.
    const b = at(card(scenes[1]))
    await drag({ x: 1200, y: 900 }, { x: b.x + 60, y: b.y + 50 })
    s = (await api.listBoardStickers(path)).find((x) => x.id === id)!
    expect(s).toMatchObject({ cardId: sceneIds[1], x: 60, y: 50 })
    expect(stickers()[0].closest('.scene-card')).toBe(card(scenes[1]))
    // Dragging a sticker never drags the card it was on.
    expect(at(card(scenes[1]))).toEqual(b)
  })

  it('peels off with Delete, and the keyboard goes back to its card', async () => {
    await pick('Arrow')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
    })
    const el = stickers()[0]
    el.focus()
    await act(async () => {
      fireEvent.keyDown(el, { key: 'Delete' })
      fireEvent.keyUp(document.body, { key: 'Delete' })
    })
    expect(stickers()).toEqual([])
    expect(await api.listBoardStickers(path)).toEqual([])
    await waitFor(() => expect(document.activeElement).toBe(face(scenes[0])))
  })

  it("hides a sticker whose card has left the board, and keeps it for the card's return", async () => {
    await pick('Star')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
    })
    cleanup()
    const doc = (await api.readAllDocs(path)).find((d) => d.meta.id === sceneIds[0])!
    await api.writeDoc(path, { ...doc, meta: { ...doc.meta, tags: [] } })
    await act(async () => {
      await useWyrm.getState().openRecentProject(path)
    })
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
    await waitFor(() => expect(document.querySelectorAll('.scene-card').length).toBe(1))
    expect(stickers()).toEqual([])
    expect(await api.listBoardStickers(path)).toHaveLength(1)
  })
})

describe('string colours', () => {
  const field = (): HTMLInputElement =>
    document.querySelector('.string-label-input') as HTMLInputElement
  const string = async (): Promise<void> => {
    const a = at(card(scenes[0]))
    const b = at(card(scenes[1]))
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: a.x + 40, clientY: a.y + 30, detail: 1 })
    })
    await act(async () => {
      fireEvent.click(face(scenes[1]), { clientX: b.x + 60, clientY: b.y + 30, detail: 1 })
    })
  }

  it('draws the string, its draft and its pins in the colour chosen, and keeps it', async () => {
    await act(async () => {
      fireEvent.click(swatch('Colour of strings and stickers', 'Green'))
    })
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await string()
    expect(document.querySelector('.board-string-draft')!.classList.contains('colour-green')).toBe(
      true
    )
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    const [s] = await api.listBoardStrings(path)
    expect(s.colour).toBe('green')
    expect(document.querySelector('.board-string')!.classList.contains('colour-green')).toBe(true)
  })

  it('makes red strings as before, writing no colour', async () => {
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await string()
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    const [s] = await api.listBoardStrings(path)
    expect('colour' in s).toBe(false)
    expect(document.querySelector('.board-string')!.classList.contains('colour-red')).toBe(true)
  })

  it("changes a new string's colour from its label field without closing it", async () => {
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await string()
    const input = field()
    const yellow = swatch('Colour of this string', 'Yellow')
    // A press on a swatch keeps the caret in the label…
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    yellow.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    // …and a blur onto it, should one happen, does not make the string.
    await act(async () => {
      fireEvent.change(input, { target: { value: 'twins' } })
      fireEvent.blur(input, { relatedTarget: yellow })
      fireEvent.click(yellow)
    })
    expect(await api.listBoardStrings(path)).toEqual([])
    expect(field()).toBe(input)
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    const [s] = await api.listBoardStrings(path)
    expect(s).toMatchObject({ label: 'twins', colour: 'yellow' })
  })

  it('lets go of a chosen string on Esc before putting a sticker down', async () => {
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await string()
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    await pick('Dot')
    await act(async () => {
      fireEvent.click(document.querySelector('.board-string .board-pin')!, { detail: 1 })
    })
    expect(document.querySelector('.board-string.chosen')).toBeTruthy()
    await act(async () => {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    })
    expect(document.querySelector('.board-string.chosen')).toBeNull()
    expect(tool('Sticker').classList.contains('on')).toBe(true)
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'Escape' })
    })
    expect(tool('Sticker').classList.contains('on')).toBe(false)
  })

  it('recolours a string already up from its tag', async () => {
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    await string()
    await act(async () => {
      fireEvent.change(field(), { target: { value: 'echo' } })
      fireEvent.keyDown(field(), { key: 'Enter' })
    })
    // The first click chooses the string (I-23); the second opens its tag.
    await act(async () => {
      fireEvent.click(document.querySelector('button.string-label')!, { detail: 1 })
    })
    await act(async () => {
      fireEvent.click(document.querySelector('button.string-label')!, { detail: 2 })
    })
    const group = screen.getByRole('radiogroup', { name: 'Colour of this string' })
    expect(group.querySelector('[aria-checked="true"]')!.getAttribute('aria-label')).toBe('Red')
    await act(async () => {
      fireEvent.click(swatch('Colour of this string', 'Orange'))
    })
    const [s] = await api.listBoardStrings(path)
    expect(s).toMatchObject({ label: 'echo', colour: 'orange' })
    expect(document.querySelector('.board-string')!.classList.contains('colour-orange')).toBe(true)
  })
})

describe('a sticker in hand, and everything else on the board', () => {
  const dragCard = async (title: string, dx: number, dy: number): Promise<void> => {
    const from = at(card(title))
    await act(async () => {
      pointer(face(title), 'pointerdown', from.x + 100, from.y + 100)
      pointer(document, 'pointermove', from.x + 100 + dx, from.y + 100 + dy)
      pointer(document, 'pointerup', from.x + 100 + dx, from.y + 100 + dy)
      // The click a real drag ends with, on the card it was dropped on.
      fireEvent.click(face(title), { clientX: from.x + 100 + dx, detail: 1 })
    })
  }

  it('drags a card without sticking anything', async () => {
    await pick('Star')
    await dragCard(scenes[0], 300, 200)
    expect(await api.listBoardStickers(path)).toEqual([])
  })

  it('sticks nothing for a click in Add Card or on the back of a card', async () => {
    await pick('Star')
    await act(async () => {
      fireEvent.click(tool('Add Card'), { detail: 1 })
    })
    const overlay = await waitFor(() => {
      const o = document.querySelector('.dialog-overlay')
      expect(o).not.toBeNull()
      return o as HTMLElement
    })
    await act(async () => {
      fireEvent.click(overlay, { clientX: 400, clientY: 300, detail: 1 })
      fireEvent.click(overlay.querySelector('input, button')!, { detail: 1 })
    })
    expect(await api.listBoardStickers(path)).toEqual([])
  })

  it('sticks nothing for a click on a string tag or the colours in its field', async () => {
    await act(async () => {
      fireEvent.click(tool('String'))
    })
    const a = at(card(scenes[0]))
    const b = at(card(scenes[1]))
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: a.x + 40, clientY: a.y + 30, detail: 1 })
    })
    await act(async () => {
      fireEvent.click(face(scenes[1]), { clientX: b.x + 60, clientY: b.y + 30, detail: 1 })
    })
    // The label field is open over the cork when a sticker is picked.
    await pick('Dot')
    await act(async () => {
      fireEvent.click(swatch('Colour of this string', 'Blue'), { detail: 1 })
      fireEvent.click(document.querySelector('.string-label-field')!, { detail: 1 })
    })
    await act(async () => {
      const f = document.querySelector('.string-label-input') as HTMLInputElement
      fireEvent.change(f, { target: { value: 'echo' } })
      fireEvent.keyDown(f, { key: 'Enter' })
    })
    // And the tag it leaves on the string.
    await act(async () => {
      fireEvent.click(document.querySelector('.string-label')!, { detail: 1 })
    })
    expect(await api.listBoardStickers(path)).toEqual([])
    expect((await api.listBoardStrings(path))[0]).toMatchObject({ label: 'echo', colour: 'blue' })
  })

  it('swallows the click a sticker drag ends with, over another card', async () => {
    await pick('Star')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
    })
    const [first] = await api.listBoardStickers(path)
    const a = at(card(scenes[0]))
    const b = at(card(scenes[1]))
    await act(async () => {
      pointer(stickers()[0], 'pointerdown', a.x + first.x, a.y + first.y)
      pointer(document, 'pointermove', b.x + 50, b.y + 50)
      pointer(document, 'pointerup', b.x + 50, b.y + 50)
      // Pressed on one card, let go on another: the click goes to the board.
      fireEvent.click(board(), { clientX: b.x + 50, clientY: b.y + 50, detail: 1 })
    })
    const all = await api.listBoardStickers(path)
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ cardId: sceneIds[1], x: 50, y: 50 })
    // And the next click on the cork is a click again.
    await act(async () => {
      pointer(board(), 'pointerdown', 900, 700)
      fireEvent.click(board(), { clientX: 900, clientY: 700, detail: 1 })
    })
    expect(await api.listBoardStickers(path)).toHaveLength(2)
  })

  it('swallows nothing after a drag that ended without a click, however long timers wait', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await pick('Star')
      await act(async () => {
        fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
      })
      const [first] = await api.listBoardStickers(path)
      const a = at(card(scenes[0]))
      const b = at(card(scenes[1]))
      await act(async () => {
        pointer(stickers()[0], 'pointerdown', a.x + first.x, a.y + first.y)
        pointer(document, 'pointermove', b.x + 50, b.y + 50)
        pointer(document, 'pointerup', b.x + 50, b.y + 50)
      })
      // No click came; timers never ran. The writer's next click is theirs.
      const addCard = vi.fn()
      tool('Add Card').addEventListener('click', addCard)
      await act(async () => {
        pointer(tool('Add Card'), 'pointerdown', 10, 10)
        fireEvent.click(tool('Add Card'), { detail: 1 })
      })
      expect(addCard).toHaveBeenCalled()
      // And from the keyboard, with no press at all.
      await act(async () => {
        pointer(stickers()[0], 'pointerdown', b.x + 50, b.y + 50)
        pointer(document, 'pointermove', b.x + 80, b.y + 80)
        pointer(document, 'pointerup', b.x + 80, b.y + 80)
        fireEvent.keyDown(tool('Sticker'), { key: 'Enter' })
        fireEvent.keyUp(tool('Sticker'), { key: 'Enter' })
        fireEvent.click(tool('Sticker'), { detail: 0 })
      })
      expect(tool('Sticker').classList.contains('on')).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('moves within its own card by how far it was dragged', async () => {
    await pick('Heart')
    await act(async () => {
      fireEvent.click(face(scenes[0]), { clientX: 30, clientY: 30, detail: 1 })
      fireEvent.click(tool('Sticker'))
    })
    const [s] = await api.listBoardStickers(path)
    const a = at(card(scenes[0]))
    await act(async () => {
      pointer(stickers()[0], 'pointerdown', a.x + s.x, a.y + s.y)
      pointer(document, 'pointermove', a.x + s.x + 20, a.y + s.y + 15)
      pointer(document, 'pointerup', a.x + s.x + 20, a.y + s.y + 15)
    })
    expect((await api.listBoardStickers(path))[0]).toMatchObject({
      cardId: sceneIds[0],
      x: s.x + 20,
      y: s.y + 15
    })
  })

  it('sticks a dropped sticker to the card on top where two overlap', async () => {
    // The first card placed (an unplaced card is dealt clear of one put
    // over its slot), then the second over it, partly.
    await dragCard(scenes[0], 10, 10)
    const a = at(card(scenes[0]))
    const b = at(card(scenes[1]))
    await dragCard(scenes[1], a.x + 60 - b.x, a.y + 40 - b.y)
    expect(at(card(scenes[0]))).toEqual(a)
    expect(at(card(scenes[1]))).toEqual({ x: a.x + 60, y: a.y + 40 })
    await pick('Cross')
    await act(async () => {
      fireEvent.click(board(), { clientX: 1100, clientY: 900, detail: 1 })
      fireEvent.click(tool('Sticker'))
    })
    const [s] = await api.listBoardStickers(path)
    // Inside both cards.
    const to = { x: a.x + 100, y: a.y + 100 }
    await act(async () => {
      pointer(stickers()[0], 'pointerdown', s.x, s.y)
      pointer(document, 'pointermove', to.x, to.y)
      pointer(document, 'pointerup', to.x, to.y)
    })
    expect((await api.listBoardStickers(path))[0].cardId).toBe(sceneIds[1])
  })
})

describe('an empty board', () => {
  it('offers no sticker, as it offers no string', async () => {
    cleanup()
    for (const d of await api.readAllDocs(path))
      await api.writeDoc(path, { ...d, meta: { ...d.meta, tags: [] } })
    await act(async () => {
      await useWyrm.getState().openRecentProject(path)
    })
    await renderBoard(0).catch(() => undefined)
    await waitFor(() => expect(document.querySelector('.corkboard-empty')).not.toBeNull())
    expect(tool('Sticker').disabled).toBe(true)
  })
})

describe('relationship colours', () => {
  it('makes a relationship in the colour chosen, and recolours it from its tag', async () => {
    cleanup()
    const chars = (await api.listEntities(path)).filter((e) => e.type === 'character').slice(0, 2)
    for (const e of chars) await api.writeEntity(path, { ...e, onBoard: true })
    await act(async () => {
      await useWyrm.getState().loadEntities()
    })
    await renderBoard(4)
    await act(async () => {
      fireEvent.click(swatch('Colour of strings and stickers', 'Blue'))
      fireEvent.click(tool('String'))
    })
    const [one, two] = chars.map((c) => c.name)
    await act(async () => {
      fireEvent.click(face(one), { detail: 0 })
    })
    await act(async () => {
      fireEvent.click(face(two), { detail: 0 })
    })
    await act(async () => {
      const f = document.querySelector('.string-label-input') as HTMLInputElement
      fireEvent.change(f, { target: { value: 'sister of' } })
      fireEvent.keyDown(f, { key: 'Enter' })
    })
    let [rel] = await api.listRelationships(path)
    expect(rel).toMatchObject({ label: 'sister of', colour: 'blue' })
    expect(document.querySelector('.board-string.relationship')!.classList).toContain('colour-blue')
    // From its tag: to red, which is written as no colour at all.
    for (const detail of [1, 2])
      await act(async () => {
        fireEvent.click(document.querySelector('button.string-label.relationship')!, { detail })
      })
    await act(async () => {
      fireEvent.click(swatch('Colour of this string', 'Red'))
    })
    ;[rel] = await api.listRelationships(path)
    expect('colour' in rel).toBe(false)
    expect(rel.label).toBe('sister of')
    expect(document.querySelector('.board-string.relationship')!.classList).toContain('colour-red')
  })
})
