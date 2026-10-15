import { describe, expect, it } from 'vitest'
import type { BinderNode, DocFile } from '../src/shared/types'
import { SCENE_TAG } from '../src/shared/types'
import {
  boardHeight,
  CARD_GAP,
  CARD_H,
  CARD_W,
  columnsFor,
  countWords,
  tidyColumns,
  excerptOf,
  layoutCards,
  sceneCards
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
