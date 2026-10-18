import { describe, expect, it } from 'vitest'
import type { BinderNode, DocFile, Entity } from '../src/shared/types'
import { SCENE_TAG } from '../src/shared/types'
import {
  boardCards,
  boardHeight,
  CARD_GAP,
  CARD_H,
  CARD_W,
  columnsFor,
  countWords,
  entityCards,
  tidyColumns,
  excerptOf,
  layoutCards,
  sceneCards,
  pinOffset,
  STACK_STEP,
  stackLayout,
  STRING_MAX_SAG,
  STRING_SAG,
  stringPath,
  stringPoints
} from '../src/renderer/src/lib/corkboard'
import type { SceneCard } from '../src/renderer/src/lib/corkboard'

/**
 * The corkboard's card model (Phase 6).
 *
 * The property that matters most here is **binder order**. F-02 settled that
 * narrative order and chronology are different questions and gave the timeline
 * its own `timelineOrder`; the corkboard is the binder seen as cards, so it
 * must never quietly sort by anything else. A board that agreed with the
 * timeline would make rearranging cards mean something different from
 * rearranging the manuscript, which is the opposite of what index cards are.
 */

function doc(id: string, title: string, body = '', tags: string[] = [SCENE_TAG]): DocFile {
  return {
    meta: { id, title, tags, created: '2026-01-01', modified: '2026-01-01' },
    body
  } as DocFile
}

const BINDER: BinderNode[] = [
  {
    id: 'ms',
    type: 'folder',
    title: 'Manuscript',
    children: [
      {
        id: 'part1',
        type: 'folder',
        title: 'Part One',
        children: [
          // Deliberately not in alphabetical order: binder order has to be
          // distinguishable from any other sort, or a test asserting it
          // passes against code that sorts by something else entirely.
          { id: 'a', type: 'doc', title: 'Zulu' },
          { id: 'b', type: 'doc', title: 'Mike' }
        ]
      },
      { id: 'c', type: 'doc', title: 'Alpha' }
    ]
  }
]

describe('which documents become cards', () => {
  it('takes scene-tagged documents only', () => {
    // Scenes are identified by the tag everywhere else, so deciding it a
    // second way here is how views drift apart.
    const docs = [doc('a', 'Zulu'), doc('b', 'Mike', '', ['note']), doc('c', 'Alpha')]

    expect(sceneCards(docs, BINDER).map((s) => s.id)).toEqual(['a', 'c'])
  })

  it('ignores a scene with no document behind it', () => {
    expect(sceneCards([doc('a', 'Zulu')], BINDER).map((s) => s.id)).toEqual(['a'])
  })

  it('returns nothing when no document is tagged', () => {
    const docs = [doc('a', 'Alpha', '', []), doc('b', 'Mike', '', ['draft'])]

    expect(sceneCards(docs, BINDER)).toEqual([])
  })
})

describe('order', () => {
  it('follows the binder, not the order documents were read', () => {
    // The documents arrive in a different order than the binder lists them,
    // which is exactly what `readAllDocs` may do.
    const docs = [doc('c', 'Alpha'), doc('a', 'Zulu'), doc('b', 'Mike')]

    expect(sceneCards(docs, BINDER).map((s) => s.title)).toEqual(['Zulu', 'Mike', 'Alpha'])
  })

  it('ignores timelineOrder entirely', () => {
    // The timeline answers chronology; the board answers the manuscript. If
    // this ever started honouring timelineOrder, dragging a card would stop
    // meaning "move the scene in the book".
    const a = doc('a', 'Zulu')
    const c = doc('c', 'Alpha')
    a.meta.timelineOrder = 900
    c.meta.timelineOrder = 1

    expect(sceneCards([a, c], BINDER).map((s) => s.title)).toEqual(['Zulu', 'Alpha'])
  })
})

describe('what a card carries', () => {
  it('names the folder it lives under', () => {
    const cards = sceneCards([doc('a', 'Zulu'), doc('c', 'Alpha')], BINDER)

    expect(cards[0].folder).toBe('Manuscript / Part One')
    expect(cards[1].folder).toBe('Manuscript')
  })

  it('marks a scene with no prose as not written', () => {
    // The state an outlined scene starts in (F-42), so the board has to show
    // it as a real card rather than an accidentally blank one.
    const cards = sceneCards([doc('a', 'Alpha', '   \n\n  ')], BINDER)

    expect(cards[0].empty).toBe(true)
    expect(cards[0].wordCount).toBe(0)
  })

  it('counts words of the prose, not the markup', () => {
    const cards = sceneCards([doc('a', 'Alpha', 'The **harbor** glass, ==pane by pane==.')], BINDER)

    // "The harbor glass, pane by pane." — six.
    expect(cards[0].wordCount).toBe(6)
  })
})

describe('the excerpt', () => {
  it('shows short prose whole', () => {
    expect(excerptOf('The last of the wyrmlight.')).toBe('The last of the wyrmlight.')
  })

  it('strips the storage markup', () => {
    // A card showing `**harbor**` would be showing the file, not the writing.
    expect(excerptOf('The **harbor** glass')).toBe('The harbor glass')
  })

  it('collapses line breaks, so a card is not mostly whitespace', () => {
    expect(excerptOf('One.\n\nTwo.\n\n\nThree.')).toBe('One. Two. Three.')
  })

  it('cuts long prose at a word boundary', () => {
    const long = 'word '.repeat(80).trim()
    const cut = excerptOf(long)

    expect(cut.endsWith('…')).toBe(true)
    expect(cut).not.toMatch(/wor…$/)
  })

  it('is empty for an unwritten scene', () => {
    expect(excerptOf('')).toBe('')
  })
})

describe('countWords', () => {
  it('is zero for nothing', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n ')).toBe(0)
  })

  it('does not count whitespace runs as words', () => {
    expect(countWords('one   two\n\nthree')).toBe(3)
  })
})

describe('where a card sits on the board', () => {
  const card = (id: string, boardX?: number, boardY?: number): SceneCard => ({
    kind: 'scene',
    id,
    title: id,
    folder: '',
    wordCount: 0,
    excerpt: '',
    empty: true,
    boardX,
    boardY
  })

  it('arranges a tidy board as a grid, not a single row', () => {
    // Three cards across a board four wide used to land in one row, which
    // reads as cards snapped into a line rather than a board laid out.
    const wide = 6 * (CARD_W + CARD_GAP)
    expect(tidyColumns(3, wide)).toBe(2)
    expect(tidyColumns(9, wide)).toBe(3)
    expect(tidyColumns(12, wide)).toBe(4)
    const laid = layoutCards([card('a'), card('b'), card('c')], wide)
    expect(laid.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [CARD_W + CARD_GAP, 0],
      [0, CARD_H + CARD_GAP]
    ])
  })

  it('never makes the tidy grid wider than the board', () => {
    // Balance is a preference, not a licence to put cards off the edge.
    expect(tidyColumns(16, 2 * (CARD_W + CARD_GAP))).toBe(2)
    expect(tidyColumns(16, 10)).toBe(1)
  })

  it('leaves a single card alone', () => {
    expect(tidyColumns(1, 10000)).toBe(1)
    expect(tidyColumns(0, 10000)).toBe(1)
  })

  it('puts an untouched card in its binder slot', () => {
    // Three columns' worth of width. Binder order is still what an unplaced
    // board shows, so a project that has never used the board is unchanged.
    const laid = layoutCards([card('a'), card('b'), card('c'), card('d')], 3 * (CARD_W + CARD_GAP))
    expect(laid.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [CARD_W + CARD_GAP, 0],
      [0, CARD_H + CARD_GAP],
      [CARD_W + CARD_GAP, CARD_H + CARD_GAP]
    ])
    expect(laid.every((c) => !c.placed)).toBe(true)
  })

  it('wraps to the next row when the board runs out of width', () => {
    const laid = layoutCards([card('a'), card('b'), card('c')], 2 * (CARD_W + CARD_GAP))
    expect(laid[2]).toMatchObject({ x: 0, y: CARD_H + CARD_GAP })
  })

  it('keeps a card exactly where the writer put it', () => {
    // The whole point of free placement: a placed card ignores the grid, and
    // ignores what the cards around it are doing.
    const laid = layoutCards([card('a', 417, 263), card('b')], 3 * (CARD_W + CARD_GAP))
    expect(laid[0]).toMatchObject({ x: 417, y: 263, placed: true })
    expect(laid[1]).toMatchObject({ x: CARD_W + CARD_GAP, y: 0, placed: false })
  })

  it('never puts a card off the board for want of width', () => {
    // A board narrower than one card still has to show it.
    expect(layoutCards([card('a'), card('b')], 10).map((c) => c.x)).toEqual([0, 0])
    expect(columnsFor(0)).toBe(1)
  })

  it('grows the board to hold the lowest card', () => {
    const laid = layoutCards([card('a', 0, 900)], 3 * (CARD_W + CARD_GAP))
    expect(boardHeight(laid)).toBe(900 + CARD_H)
  })
})

/** A story-bible entry, on the board or not. */
function entity(
  id: string,
  type: Entity['type'],
  name: string,
  extra: Partial<Entity> = {}
): Entity {
  return {
    id,
    type,
    name,
    aliases: [],
    body: '',
    created: '2026-01-01',
    modified: '2026-01-01',
    ...extra
  }
}

describe('characters and locations as cards', () => {
  it('shows only the entries that were put on the board', () => {
    // The World Map's model, not the scenes': membership is deliberate, so a
    // forty-strong cast does not flood the board the first time it opens.
    const cards = entityCards([
      entity('e1', 'character', 'Elara', { onBoard: true }),
      entity('e2', 'character', 'Marten'),
      entity('w1', 'world', 'Harrowgate', { onBoard: true })
    ])
    expect(cards.map((c) => c.id)).toEqual(['e1', 'w1'])
  })

  it('never makes a card of a glossary entry, on the board or not', () => {
    // onBoard is meaningless on a glossary entry; a stray flag must not grow
    // a fourth kind of card the rest of the board does not know about.
    const cards = entityCards([entity('g1', 'glossary', 'wyrmlight', { onBoard: true })])
    expect(cards).toEqual([])
  })

  it('names the kind, so the board can tell them apart', () => {
    const cards = entityCards([
      entity('e1', 'character', 'Elara', { onBoard: true }),
      entity('w1', 'world', 'Harrowgate', { onBoard: true })
    ])
    expect(cards.map((c) => c.kind)).toEqual(['character', 'location'])
  })

  it('reads a cast in alphabetical order, whatever order the book holds them in', () => {
    const cards = entityCards([
      entity('e3', 'character', 'Zara', { onBoard: true }),
      entity('e1', 'character', 'Elara', { onBoard: true }),
      entity('e2', 'character', 'Marten', { onBoard: true })
    ])
    expect(cards.map((c) => c.title)).toEqual(['Elara', 'Marten', 'Zara'])
  })

  it('says which book an entry is in, and for a location what it is inside', () => {
    // A tavern's card says which city it is in, the way a scene card says
    // which part it is in (F-13 nesting).
    const cards = entityCards([
      entity('e1', 'character', 'Elara', { onBoard: true }),
      entity('city', 'world', 'Harrowgate'),
      entity('tavern', 'world', 'The Drowned Bell', { onBoard: true, parentId: 'city' })
    ])
    expect(cards.find((c) => c.id === 'e1')?.folder).toBe('Character Book')
    expect(cards.find((c) => c.id === 'tavern')?.folder).toBe('World Book / Harrowgate')
  })

  it("carries the entry's opening and position like a scene does", () => {
    const [card] = entityCards([
      entity('e1', 'character', 'Elara', {
        onBoard: true,
        body: 'Captain of the harbour watch.',
        boardX: 40,
        boardY: 60
      })
    ])
    expect(card.excerpt).toBe('Captain of the harbour watch.')
    expect(card.empty).toBe(false)
    expect(card.wordCount).toBe(5)
    expect(card.boardX).toBe(40)
    expect(card.boardY).toBe(60)
  })

  it('puts scenes first, in binder order, then characters, then locations', () => {
    const docs = [doc('a', 'Zulu'), doc('b', 'Mike'), doc('c', 'Alpha')]
    const cards = boardCards(docs, BINDER, [
      entity('w1', 'world', 'Harrowgate', { onBoard: true }),
      entity('e1', 'character', 'Elara', { onBoard: true })
    ])
    expect(cards.map((c) => c.title)).toEqual(['Zulu', 'Mike', 'Alpha', 'Elara', 'Harrowgate'])
  })
})

describe('stacking', () => {
  const scene = (id: string): SceneCard => ({
    kind: 'scene',
    id,
    title: id,
    folder: '',
    wordCount: 0,
    excerpt: '',
    empty: true
  })
  const bible = (id: string, kind: 'character' | 'location'): SceneCard => ({ ...scene(id), kind })

  it('gathers each kind into its own pile, cascading so every title shows', () => {
    // The tableau in a game of patience: each card sits STACK_STEP below the
    // one before, which is the strip a title line needs.
    const piles = stackLayout([scene('s1'), scene('s2'), scene('s3')])
    expect(piles.get('s1')).toEqual({ x: 0, y: 0 })
    expect(piles.get('s2')).toEqual({ x: 0, y: STACK_STEP })
    expect(piles.get('s3')).toEqual({ x: 0, y: 2 * STACK_STEP })
  })

  it('sets the piles side by side in kind order', () => {
    const piles = stackLayout([bible('w1', 'location'), scene('s1'), bible('e1', 'character')])
    expect(piles.get('s1')?.x).toBe(0)
    expect(piles.get('e1')?.x).toBe(CARD_W + CARD_GAP)
    expect(piles.get('w1')?.x).toBe(2 * (CARD_W + CARD_GAP))
  })

  it('leaves no gap for a kind with no cards', () => {
    // A board with scenes and locations but no characters should not have an
    // empty pile's worth of cork between them.
    const piles = stackLayout([scene('s1'), bible('w1', 'location')])
    expect(piles.get('w1')?.x).toBe(CARD_W + CARD_GAP)
  })

  it('writes nothing — it is a layout, not an arrangement', () => {
    // The cards passed in are untouched: unstacking is "forget the piles",
    // and that only works if stacking never changed anything.
    const cards = [scene('s1'), bible('e1', 'character')]
    const before = JSON.stringify(cards)
    stackLayout(cards)
    expect(JSON.stringify(cards)).toBe(before)
  })
})

describe('strings between cards', () => {
  const cards = new Map([
    ['a', { x: 0, y: 0 }],
    ['b', { x: 500, y: 300 }]
  ])
  const string = {
    id: 's1',
    from: { cardId: 'a', dx: 100, dy: 20 },
    to: { cardId: 'b', dx: 10, dy: 190 },
    created: '2026-01-01',
    modified: '2026-01-01'
  }

  it('anchors each end to its card, by offset', () => {
    // The whole point of anchoring to cards: move the card and the pin goes
    // with it, because the pin is an offset into the card, not a place on
    // the cork.
    expect(stringPoints(string, cards)).toEqual([
      { x: 100, y: 20 },
      { x: 510, y: 490 }
    ])
    const moved = new Map(cards)
    moved.set('b', { x: 50, y: 50 })
    expect(stringPoints(string, moved)?.[1]).toEqual({ x: 60, y: 240 })
  })

  it('is hidden, not broken, when either card is gone', () => {
    // A card taken off the board or trashed may come back, and the string
    // with it. Hiding is reversible; cascading a delete is not.
    expect(stringPoints(string, new Map([['a', { x: 0, y: 0 }]]))).toBeNull()
  })

  it('hangs: the curve dips below the straight line between its pins', () => {
    const d = stringPath({ x: 0, y: 100 }, { x: 400, y: 100 })
    // The control point: midpoint x, and below the pins by the sag.
    expect(d).toBe(`M 0 100 Q 200 ${100 + 400 * STRING_SAG} 400 100`)
  })

  it('never sags into the next row of cards', () => {
    const d = stringPath({ x: 0, y: 0 }, { x: 2000, y: 0 })
    expect(d).toBe(`M 0 0 Q 1000 ${STRING_MAX_SAG} 2000 0`)
  })

  it('hangs the same way whichever end was pinned first', () => {
    const one = stringPath({ x: 0, y: 0 }, { x: 300, y: 0 })
    const other = stringPath({ x: 300, y: 0 }, { x: 0, y: 0 })
    expect(one).toContain(`Q 150 ${300 * STRING_SAG}`)
    expect(other).toContain(`Q 150 ${300 * STRING_SAG}`)
  })

  it('pins where the card was clicked, and inside the card at the edges', () => {
    const card = { x: 100, y: 200 }
    expect(pinOffset(card, { x: 150, y: 260 })).toEqual({ dx: 50, dy: 60 })
    // A click that lands a pixel outside the card still pins in the card.
    expect(pinOffset(card, { x: 90, y: 450 })).toEqual({ dx: 0, dy: CARD_H })
  })
})
