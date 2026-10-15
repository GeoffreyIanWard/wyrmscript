import { describe, expect, it } from 'vitest'
import type { BinderNode, DocFile } from '../src/shared/types'
import { SCENE_TAG } from '../src/shared/types'
import { countWords, dropTargetAt, excerptOf, sceneCards } from '../src/renderer/src/lib/corkboard'
import type { CardBox } from '../src/renderer/src/lib/corkboard'

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

describe('where a dragged card lands', () => {
  // A row of three 200px cards with 20px gutters, which is what the board
  // draws. jsdom has no layout engine, so this arithmetic is only honestly
  // testable away from the DOM — the same reason `windowGeometry.ts` is pure.
  const row: CardBox[] = [
    { id: 'a', left: 0, top: 0, width: 200, height: 100 },
    { id: 'b', left: 220, top: 0, width: 200, height: 100 },
    { id: 'c', left: 440, top: 0, width: 200, height: 100 }
  ]

  it('lands before the card when the pointer is on its left half', () => {
    expect(dropTargetAt(row, 480, 50)).toEqual({ id: 'c', after: false })
  })

  it('lands after the card when the pointer is on its right half', () => {
    expect(dropTargetAt(row, 600, 50)).toEqual({ id: 'c', after: true })
  })

  it('resolves a release in the gutter to the nearer card', () => {
    // The gap between a and b. Rejecting this is the snap-back the board
    // already got wrong once: a writer aiming between two cards means it.
    expect(dropTargetAt(row, 205, 50)).toEqual({ id: 'a', after: true })
    expect(dropTargetAt(row, 215, 50)).toEqual({ id: 'b', after: false })
  })

  it('prefers a card on the same row to a nearer one a row down', () => {
    const grid: CardBox[] = [
      { id: 'a', left: 0, top: 0, width: 200, height: 100 },
      { id: 'below', left: 0, top: 120, width: 200, height: 100 }
    ]
    // Horizontally 260px from a's centre but vertically only 70 from below's:
    // weighted, the card on the same row still wins, because the eye reads
    // the board in rows.
    expect(dropTargetAt(grid, 360, 50)).toEqual({ id: 'a', after: true })
  })

  it('has nowhere to land on an empty board', () => {
    expect(dropTargetAt([], 10, 10)).toBeNull()
  })
})
