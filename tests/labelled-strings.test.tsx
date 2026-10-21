// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { DocFile, DocMeta, Entity, Relationship } from '../src/shared/types'
import { api } from '../src/renderer/src/lib/api'
import { useWyrm, __disposeAll } from '../src/renderer/src/store'
import { Corkboard } from '../src/renderer/src/components/Corkboard'
import {
  PARALLEL_SPACING,
  SHORT_SPAN,
  tagPlace,
  cardPin,
  CARD_H,
  CARD_W,
  directedLabel,
  relationshipStrings,
  STRING_MAX_SAG,
  STRING_SAG,
  stringMidpoint
} from '../src/renderer/src/lib/corkboard'

/**
 * Labelled strings. A string can say what it means, on a tag at its middle;
 * and between two characters a string *is* a relationship from the Character
 * Graph — the same data as the cast graph, seen as string on a board, so a
 * change in either place is a change in both.
 */

describe('where a label sits', () => {
  it('halfway along the hanging curve: the midpoint, lowered by half the sag', () => {
    const span = 300
    const sag = Math.min(STRING_MAX_SAG, span * STRING_SAG)
    expect(stringMidpoint({ x: 0, y: 100 }, { x: span, y: 100 })).toEqual({
      x: 150,
      y: 100 + sag / 2
    })
  })

  it('caps the droop on a long string, as the curve does', () => {
    expect(stringMidpoint({ x: 0, y: 0 }, { x: 2000, y: 0 }).y).toBe(STRING_MAX_SAG / 2)
  })
})

describe('where a tag goes on a short string', () => {
  it('sits at the middle of a string long enough to clear its pins', () => {
    expect(tagPlace({ x: 0, y: 0 }, { x: SHORT_SPAN + 50, y: 0 }).anchor).toBe('centre')
  })

  it('goes beside a short string that runs down, clear of both pins', () => {
    const at = tagPlace({ x: 105, y: 200 }, { x: 105, y: 224 })
    expect(at.anchor).toBe('left')
    expect(at.x).toBeGreaterThan(105 + 5)
  })

  it('sends the tags of two close strings to opposite sides', () => {
    const left = tagPlace({ x: 85, y: 200 }, { x: 85, y: 224 }, -1)
    const right = tagPlace({ x: 125, y: 200 }, { x: 125, y: 224 }, 1)
    expect([left.anchor, right.anchor]).toEqual(['right', 'left'])
    expect(left.x).toBeLessThan(85)
    expect(right.x).toBeGreaterThan(125)
    const above = tagPlace({ x: 210, y: 80 }, { x: 234, y: 80 }, 1)
    const below = tagPlace({ x: 210, y: 120 }, { x: 234, y: 120 }, -1)
    expect([above.anchor, below.anchor]).toEqual(['bottom', 'top'])
  })

  it('goes above the cards for a short string that runs across', () => {
    // Facing edges of two cards side by side, a gap apart, at mid-height.
    const at = tagPlace({ x: 210, y: 100 }, { x: 234, y: 100 })
    expect(at.anchor).toBe('bottom')
    expect(at.y).toBeLessThan(0)
  })
})

describe('relationships as string', () => {
  it('draws two relationships between the same pair apart, so each can be reached', () => {
    const cards = [
      { id: 'elara', kind: 'character' as const, x: 0, y: 0 },
      { id: 'marten', kind: 'character' as const, x: 0, y: 400 }
    ]
    const [one, two] = relationshipStrings(
      [
        {
          id: 'r1',
          fromId: 'elara',
          toId: 'marten',
          label: 'sister of',
          created: '',
          modified: ''
        },
        {
          id: 'r2',
          fromId: 'marten',
          toId: 'elara',
          label: 'brother of',
          created: '',
          modified: ''
        }
      ],
      cards
    )
    // Separate lines, PARALLEL_SPACING apart, across the way they run.
    expect(Math.abs(one.a.x - two.b.x)).toBe(PARALLEL_SPACING)
    expect(stringMidpoint(one.a, one.b)).not.toEqual(stringMidpoint(two.a, two.b))
  })

  type Card = { id: string; kind: 'scene' | 'character' | 'location'; x: number; y: number }
  const card = (id: string, kind: Card['kind'], x = 0, y = 0): Card => ({
    id,
    kind,
    x,
    y
  })
  const rel = (fromId: string, toId: string, label = 'sister of'): Relationship => ({
    id: `${fromId}-${toId}`,
    fromId,
    toId,
    label,
    created: '',
    modified: ''
  })

  it('draws one for each relationship whose two characters are both on the board, edge to edge', () => {
    // Side by side: from the right edge of one to the left edge of the other.
    const side = [card('elara', 'character', 0, 0), card('marten', 'character', 300, 0)]
    const [s] = relationshipStrings([rel('elara', 'marten')], side)
    expect(s.a).toEqual({ x: CARD_W, y: CARD_H / 2 })
    expect(s.b).toEqual({ x: 300, y: CARD_H / 2 })
    // In a column: from the bottom of the upper card to the top of the lower,
    // so the string hangs in the gap rather than running through a card.
    const column = [card('elara', 'character', 0, 0), card('marten', 'character', 0, 224)]
    const [t] = relationshipStrings([rel('elara', 'marten')], column)
    expect(t.a).toEqual({ x: CARD_W / 2, y: CARD_H })
    expect(t.b).toEqual({ x: CARD_W / 2, y: 224 })
    // And the other way round, the ends swap edges.
    const [u] = relationshipStrings([rel('marten', 'elara')], column)
    expect(u.a).toEqual({ x: CARD_W / 2, y: 224 })
    expect(u.b).toEqual({ x: CARD_W / 2, y: CARD_H })
  })

  it("keeps a keyboard pin at the card's own pin, top centre", () => {
    expect(cardPin({ x: 0, y: 0 })).toEqual({ x: CARD_W / 2, y: 10 })
  })

  it('hides one whose other character is off the board, and ignores scene and location cards', () => {
    const cards = [card('elara', 'character'), card('harbor', 'location'), card('s1', 'scene')]
    expect(relationshipStrings([rel('elara', 'marten')], cards)).toEqual([])
    expect(relationshipStrings([rel('elara', 'harbor')], cards)).toEqual([])
    expect(relationshipStrings([rel('elara', 's1')], cards)).toEqual([])
  })

  it('reads the way the relationship goes, along the string, whichever way round the cards are', () => {
    expect(directedLabel('sister of', { x: 0, y: 0 }, { x: 300, y: 0 })).toBe('sister of →')
    expect(directedLabel('sister of', { x: 300, y: 0 }, { x: 0, y: 0 })).toBe('← sister of')
    // A string that mostly runs down or up does not get a sideways arrow.
    expect(directedLabel('sister of', { x: 0, y: 0 }, { x: 20, y: 200 })).toBe('sister of ↓')
    expect(directedLabel('sister of', { x: 0, y: 200 }, { x: 20, y: 0 })).toBe('↑ sister of')
  })
})

/* ---------- on the board ---------- */

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
  for (const e of await api.listEntities(demoPath)) {
    const clean: Entity = { ...e }
    delete clean.onBoard
    delete clean.boardX
    delete clean.boardY
    await api.writeEntity(demoPath, clean)
  }
  await act(async () => {
    await useWyrm.getState().openRecentProject(demoPath!)
  })
  useWyrm.setState({ activeId: null, activeDoc: null })
  return demoPath
}

async function onBoard(path: string, ...names: string[]): Promise<Entity[]> {
  const all = await api.listEntities(path)
  const put = names.map((n) => all.find((e) => e.name === n)!)
  for (const e of put) await api.writeEntity(path, { ...e, onBoard: true })
  await act(async () => {
    await useWyrm.getState().loadEntities()
  })
  return put
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
const tool = (label: string): HTMLButtonElement =>
  [...document.querySelectorAll('.board-tool')].find((b) =>
    b.textContent?.includes(label)
  ) as HTMLButtonElement
const toolUp = async (): Promise<void> => {
  await act(async () => {
    fireEvent.click(tool('String'))
  })
}
/** A mouse click on a card at a board point (detail 1, as real clicks are). */
const pinAt = async (title: string, x: number, y: number): Promise<void> => {
  await act(async () => {
    fireEvent.click(face(title), { clientX: x, clientY: y, detail: 1 })
  })
}
const field = (): HTMLInputElement =>
  document.querySelector('.string-label-input') as HTMLInputElement
const write = async (text: string, k = 'Enter'): Promise<void> => {
  await act(async () => {
    fireEvent.change(field(), { target: { value: text } })
    fireEvent.keyDown(field(), { key: k })
  })
}
/** What each tag shows on screen — not its screen-reader name. */
const tags = (): string[] =>
  [...document.querySelectorAll('.string-label')].map(
    (t) => (t.querySelector('[aria-hidden="true"]') ?? t).textContent ?? ''
  )

function pointer(el: Element, type: string, x: number, y: number): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y })
  Object.defineProperty(e, 'pointerId', { value: 1 })
  el.dispatchEvent(e)
}

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
    mainView: { kind: 'doc' },
    viewHistory: []
  })
  __disposeAll()
})

describe('labelling a string between scenes', () => {
  let path: string
  let scenes: string[]
  beforeEach(async () => {
    path = await openDemo()
    scenes = await tagScenes(path, 2)
    await renderBoard()
    await toolUp()
  })

  it('asks for a label at the middle of the string, and keeps it on the string', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    // Not made yet: drawn as a draft, with the field where the tag will be.
    expect(document.querySelector('.board-string-draft')).toBeTruthy()
    expect(await api.listBoardStrings(path)).toHaveLength(0)
    expect(document.activeElement).toBe(field())
    const box = field().closest('.string-label-field') as HTMLElement
    const mid = stringMidpoint({ x: 40, y: 30 }, { x: 60, y: 234 })
    expect([parseFloat(box.style.left), parseFloat(box.style.top)]).toEqual([mid.x, mid.y])

    await write('  same night ')

    const [s] = await api.listBoardStrings(path)
    expect(s.label).toBe('same night')
    expect(tags()).toEqual(['same night'])
    expect(document.querySelector('.board-string-draft')).toBeNull()
  })

  it('makes a plain string on a bare Return, with no label key at all', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await write('')
    const [s] = await api.listBoardStrings(path)
    expect('label' in s).toBe(false)
    // With the tool up there is room to add one; with it down, no tag.
    expect(tags()).toEqual(['+ label'])
    await toolUp()
    expect(tags()).toEqual([])
  })

  it('makes nothing on Esc, and keeps the tool up', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await write('never mind', 'Escape')
    expect(field()).toBeNull()
    expect(await api.listBoardStrings(path)).toEqual([])
    expect(document.querySelector('.board-pin.pending')).toBeNull()
    expect(tool('String').classList.contains('on')).toBe(true)
  })

  it('keeps the label when the writer clicks away instead of pressing Return', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await act(async () => {
      fireEvent.change(field(), { target: { value: 'echoes' } })
      fireEvent.blur(field())
    })
    expect((await api.listBoardStrings(path))[0].label).toBe('echoes')
  })

  it('changes a label from its tag, and takes it away when emptied', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await write('same night')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change the label "same night"' }))
    })
    expect(field().value).toBe('same night')
    await write('the morning after')
    expect((await api.listBoardStrings(path))[0].label).toBe('the morning after')

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change the label "the morning after"' }))
    })
    await write('')
    const [s] = await api.listBoardStrings(path)
    expect('label' in s).toBe(false)
  })

  it('puts the tag where the field was, and hides the old tag while it is being changed', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await write('same night')
    const tag = screen.getByRole('button', { name: 'Change the label "same night"' })
    const at = tagPlace({ x: 40, y: 30 }, { x: 60, y: 234 })
    expect([parseFloat(tag.style.left), parseFloat(tag.style.top)]).toEqual([at.x, at.y])
    await act(async () => {
      fireEvent.click(tag)
    })
    expect(screen.queryByRole('button', { name: 'Change the label "same night"' })).toBeNull()
  })

  it('writes nothing when a label is opened and left as it was', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await write('same night')
    const writes = vi.spyOn(api, 'writeBoardString')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Change the label "same night"' }))
    })
    await write('same night')
    expect(writes).not.toHaveBeenCalled()
  })

  it('keeps Esc in the field: it never reaches the window, where it would mean "back"', async () => {
    const [a, b] = scenes
    const back = vi.fn()
    window.addEventListener('keydown', back)
    try {
      await pinAt(a, 40, 30)
      await pinAt(b, 60, 234)
      await write('x', 'Escape')
      expect(field()).toBeNull()
      expect(back).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', back)
    }
  })

  it('leaves the field alone when the window loses focus, rather than keeping half a label', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    vi.spyOn(document, 'hasFocus').mockReturnValue(false)
    await act(async () => {
      fireEvent.change(field(), { target: { value: 'sam' } })
      fireEvent.blur(field())
    })
    expect(field()).toBeTruthy()
    expect(await api.listBoardStrings(path)).toEqual([])
  })

  it('goes back to the card after Return, once the key is up', async () => {
    const [a, b] = scenes
    window.dispatchEvent(new Event('blur'))
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await act(async () => {
      fireEvent.keyDown(field(), { key: 'Enter', code: 'Enter' })
    })
    await act(async () => {
      fireEvent.keyUp(window, { key: 'Enter', code: 'Enter' })
    })
    await waitFor(() => expect(document.activeElement).toBe(face(b)))
  })

  it('does not pull focus back to the last card when the writer clicked another', async () => {
    const [a, b] = scenes
    window.dispatchEvent(new Event('blur'))
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    face(a).focus()
    await act(async () => {
      fireEvent.change(field(), { target: { value: 'echoes' } })
      fireEvent.blur(field(), { relatedTarget: face(a) })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect((await api.listBoardStrings(path))[0].label).toBe('echoes')
    expect(document.activeElement).toBe(face(a))
  })

  it('shows the label as text, not a control, with the tool down', async () => {
    const [a, b] = scenes
    await pinAt(a, 40, 30)
    await pinAt(b, 60, 234)
    await write('same night')
    await toolUp()
    const tag = document.querySelector('.string-label') as HTMLElement
    expect(tag.tagName).toBe('SPAN')
    expect(tags()).toEqual(['same night'])
    // A screen reader hears who it joins, not a bare word.
    expect(tag.querySelector('.sr-only')?.textContent).toBe(
      `"same night", a string between ${a} and ${b}`
    )
  })
})

describe('a string between two characters is a relationship', () => {
  let path: string
  let elara: Entity
  let marten: Entity
  let saved: ReturnType<typeof structuredClone>
  beforeEach(async () => {
    path = await openDemo()
    saved = structuredClone(await api.listRelationships(path))
    await tagScenes(path, 1)
    ;[elara, marten] = await onBoard(path, 'Elara Voss', 'Marten')
  })
  afterEach(async () => {
    for (const r of await api.listRelationships(path)) await api.deleteRelationship(path, r.id)
    for (const r of saved as Awaited<ReturnType<typeof api.listRelationships>>)
      await api.writeRelationship(path, r)
  })

  it("shows the Character Graph's relationship as a labelled string, which way it reads", async () => {
    await renderBoard()
    await waitFor(() =>
      expect(document.querySelectorAll('.board-string.relationship')).toHaveLength(1)
    )
    // Elara is placed first, so the arrow runs left to right — or the other
    // way, depending on where jsdom's single column puts them.
    // jsdom's single column puts Marten below Elara.
    expect(tags()[0]).toBe('sister of ↓')
    const tag = document.querySelector('.string-label') as HTMLElement
    expect(tag.querySelector('[aria-hidden="true"]')).toBeTruthy()
    expect(tag.querySelector('.sr-only')?.textContent).toBe('Elara Voss is "sister of" Marten')
    // Nothing was written to the board's own strings to show it.
    expect(await api.listBoardStrings(path)).toEqual([])
  })

  it('hides it when one of them leaves the board, without touching the relationship', async () => {
    await api.writeEntity(path, { ...marten, onBoard: undefined })
    await act(async () => {
      await useWyrm.getState().loadEntities()
    })
    await renderBoard()
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(document.querySelectorAll('.board-string.relationship')).toHaveLength(0)
    expect(await api.listRelationships(path)).toHaveLength(1)
  })

  it('asks for a name, and puts a new one in the Character Graph — not on the board', async () => {
    for (const r of await api.listRelationships(path)) await api.deleteRelationship(path, r.id)
    await renderBoard()
    await toolUp()
    await pinAt('Elara Voss', 20, 20)
    await pinAt('Marten', 20, 300)
    expect(field().getAttribute('aria-label')).toBe('Name the relationship')

    // A relationship is a named thing: an empty Return says so, makes nothing.
    await write('')
    expect(screen.getByRole('alert').textContent).toContain('Name the relationship')
    expect(field()).toBeTruthy()
    expect(await api.listRelationships(path)).toEqual([])

    await write('sister of')
    const [r] = await api.listRelationships(path)
    expect(r).toMatchObject({ fromId: elara.id, toId: marten.id, label: 'sister of' })
    expect(await api.listBoardStrings(path)).toEqual([])
    await waitFor(() =>
      expect(document.querySelectorAll('.board-string.relationship')).toHaveLength(1)
    )
  })

  it('keeps an unnamed one open, saying why, when the writer clicks away', async () => {
    for (const r of await api.listRelationships(path)) await api.deleteRelationship(path, r.id)
    await renderBoard()
    await toolUp()
    await pinAt('Elara Voss', 20, 20)
    await pinAt('Marten', 20, 300)
    await act(async () => {
      fireEvent.blur(field())
    })
    // Not thrown away with both pins and no word: open, with the reason.
    expect(field()).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Name the relationship')
    expect(await api.listRelationships(path)).toEqual([])
    // A click on a card goes back to the field rather than pinning the card.
    await pinAt('Elara Voss', 20, 20)
    expect(document.activeElement).toBe(field())
    expect(document.querySelector('.board-pin.pending')).toBeNull()
  })

  it('renames the relationship from its tag, in the Character Graph too', async () => {
    await renderBoard()
    await toolUp()
    const tag = await waitFor(() =>
      screen.getByRole('button', {
        name: 'Change the relationship "sister of" from Elara Voss to Marten'
      })
    )
    await act(async () => {
      fireEvent.click(tag)
    })
    await write('estranged sister of')
    const [r] = await api.listRelationships(path)
    expect(r.label).toBe('estranged sister of')
    expect(useWyrm.getState().relationships[0].label).toBe('estranged sister of')
  })

  it('will not rename a relationship to nothing', async () => {
    await renderBoard()
    await toolUp()
    const tag = await waitFor(() =>
      screen.getByRole('button', {
        name: 'Change the relationship "sister of" from Elara Voss to Marten'
      })
    )
    await act(async () => {
      fireEvent.click(tag)
    })
    await write('')
    expect(screen.getByRole('alert')).toBeTruthy()
    expect(field()).toBeTruthy()
    expect((await api.listRelationships(path))[0].label).toBe('sister of')
  })

  it('will not make the same relationship twice, and says where the first one is', async () => {
    await renderBoard()
    await toolUp()
    await pinAt('Elara Voss', 20, 20)
    await pinAt('Marten', 20, 300)
    await write('Sister of')
    expect(screen.getByRole('alert').textContent).toContain('already "sister of"')
    expect(await api.listRelationships(path)).toHaveLength(1)
    // The other direction is a relationship of its own, and both can be
    // reached: two tags, in two places.
    await write('', 'Escape')
    await pinAt('Marten', 20, 300)
    await pinAt('Elara Voss', 20, 20)
    await write('brother of')
    expect(await api.listRelationships(path)).toHaveLength(2)
    await waitFor(() =>
      expect(document.querySelectorAll('.board-string.relationship')).toHaveLength(2)
    )
    const places = [...document.querySelectorAll<HTMLElement>('.string-label.relationship')].map(
      (t) => `${t.style.left},${t.style.top}`
    )
    expect(new Set(places).size).toBe(2)
  })

  it('follows a character card while it is being dragged', async () => {
    await renderBoard()
    const tag = await waitFor(() => document.querySelector('.string-label') as HTMLElement)
    const before = tag.style.left
    const card = face('Elara Voss').closest('.scene-card') as HTMLElement
    await act(async () => pointer(card, 'pointerdown', 50, 50))
    await act(async () => pointer(card, 'pointermove', 650, 50))
    const moved = (document.querySelector('.string-label') as HTMLElement).style.left
    expect(moved).not.toBe(before)
    await act(async () => pointer(card, 'pointerup', 650, 50))
  })

  it('removes the relationship when its pin is pulled', async () => {
    await renderBoard()
    await toolUp()
    const pin = await waitFor(
      () =>
        screen.getAllByRole('button', {
          name: /^Pull the relationship "sister of" from Elara Voss to Marten/
        })[0]
    )
    await act(async () => {
      fireEvent.click(pin)
    })
    await waitFor(async () => expect(await api.listRelationships(path)).toEqual([]))
    expect(document.querySelectorAll('.board-string.relationship')).toHaveLength(0)
  })

  it('makes an ordinary string between a character and a scene', async () => {
    await renderBoard()
    await toolUp()
    const scene = document.querySelector('.scene-card.kind-scene .scene-card-title')!.textContent!
    await pinAt('Elara Voss', 20, 20)
    await pinAt(scene, 20, 470)
    expect(field().getAttribute('aria-label')).toBe('Label the string, or leave it blank')
    await write('')
    expect(await api.listBoardStrings(path)).toHaveLength(1)
    expect(await api.listRelationships(path)).toHaveLength(1)
  })
})
