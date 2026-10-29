import { describe, expect, it } from 'vitest'
import {
  CONTEXT,
  bodyOf,
  bothEdits,
  composeChapter,
  isPlaced,
  layoutChapter,
  liftCard,
  pageItems,
  pairUp,
  paragraphsOf,
  placeCards,
  plainOf,
  restoreRemoved,
  threeWay,
  type ChapterMerge,
  type MergeCard,
  type MergeItem,
  type Region
} from '../src/renderer/src/lib/mergePages'
import { docToMarkdown, markdownToDoc } from '../src/renderer/src/lib/markdown'

/**
 * F-51 step 2: laying out a chapter changed on two computers — pure, so the
 * whole of it is tested here, before any screen exists. The unit is the
 * paragraph with words in it; what neither changed is fixed text, a change
 * only one side made is placed already and marked, a passage both changed
 * differently is a dispute with a page of its own, and the arrangement
 * composes back to the chapter's stored text exactly as the editor would
 * write it, blank lines and all.
 */

const body = (...paragraphs: string[]): string => bodyOf(paragraphs)

const lay = (before: string, local: string, incoming: string): ChapterMerge =>
  layoutChapter({ path: 'documents/ch.md', title: 'The Ferry', before, local, incoming })

const composed = (m: ChapterMerge): string => composeChapter(m.items, m.cards)

const card = (m: ChapterMerge, id: string): MergeCard => m.cards[id]
const kinds = (items: MergeItem[]): string[] =>
  items.map((i) => (i.kind === 'text' ? `text:${i.markdown}` : `${i.kind}:${i.id}`))

/** Regions without where they start, for comparing shapes. */
const shapes = (regions: Region[]): Omit<Region, 'at'>[] =>
  regions.map((r) => {
    const rest: Partial<Region> = { ...r }
    delete rest.at
    return rest as Omit<Region, 'at'>
  })

/** The words of a card that are drawn underlined. */
const underlined = (c: MergeCard): string =>
  c.runs
    .filter((r) => r.changed)
    .map((r) => r.text)
    .join('|')

describe('paragraphs', () => {
  it('splits a stored body into paragraphs and writes it back byte for byte', () => {
    const stored = 'One.\n\nTwo, with a hard\\\nbreak.\n\n\n\nFour, after two empty paragraphs.\n'
    const paragraphs = paragraphsOf(stored)
    expect(paragraphs).toEqual([
      'One.',
      'Two, with a hard\\\nbreak.',
      '',
      '',
      'Four, after two empty paragraphs.'
    ])
    expect(bodyOf(paragraphs)).toBe(stored)
  })

  it('agrees with the editor: any body it writes splits and joins back to itself', () => {
    for (const markdown of [
      'Plain.',
      'A **bold** and *italic* and ==marked== line.',
      'First.\n\nSecond.',
      'Gap before.\n\n\n\n\nAfter three empties.',
      'Line one\\\nline two\\\nline three.',
      '',
      'A.\n\n \n\nB.',
      'A.\n\n　\n\nB.'
    ]) {
      const stored = docToMarkdown(markdownToDoc(markdown))
      expect(bodyOf(paragraphsOf(stored))).toBe(stored)
    }
  })

  it('keeps a line of non-breaking spaces as the paragraph the editor keeps it as', () => {
    expect(paragraphsOf('A.\n\n \n\nB.\n')).toEqual(['A.', ' ', 'B.'])
  })

  it('reads Windows line endings as the editor does', () => {
    expect(paragraphsOf('A.\r\n\r\nB.\r\n')).toEqual(['A.', 'B.'])
    const m = lay(body('A.', 'B.', 'C.'), 'A.\r\n\r\nB.\r\n\r\nC.\r\n', body('A.', 'Bee.', 'C.'))
    expect(m.disputes).toEqual([])
    expect(composed(m)).toBe(body('A.', 'Bee.', 'C.'))
  })

  it('reads an empty body as no paragraphs, and drops empty ones at either end on the way back', () => {
    expect(paragraphsOf('')).toEqual([])
    expect(paragraphsOf('\n')).toEqual([])
    expect(bodyOf(['', 'Middle.', ''])).toBe('Middle.\n')
    expect(bodyOf([])).toBe('')
  })
})

describe('lining up three versions', () => {
  const o = ['a', 'b', 'c', 'd']

  it('keeps what neither side changed', () => {
    expect(shapes(threeWay(o, o, o))).toEqual([{ kind: 'same', lines: o }])
  })

  it('names the side that made a change only it made', () => {
    expect(shapes(threeWay(o, ['a', 'B', 'c', 'd'], o))).toEqual([
      { kind: 'same', lines: ['a'] },
      { kind: 'one', side: 'local', before: ['b'], after: ['B'] },
      { kind: 'same', lines: ['c', 'd'] }
    ])
    expect(shapes(threeWay(o, o, ['a', 'b', 'c', 'd', 'e']))).toEqual([
      { kind: 'same', lines: o },
      { kind: 'one', side: 'incoming', before: [], after: ['e'] }
    ])
  })

  it('says where each region starts in each version', () => {
    const regions = threeWay(o, ['a', 'X', 'Y', 'c', 'd'], ['a', 'b', 'c'])
    expect(regions.map((r) => [r.kind, r.at])).toEqual([
      ['same', { before: 0, local: 0, incoming: 0 }],
      ['one', { before: 1, local: 1, incoming: 1 }],
      ['same', { before: 2, local: 3, incoming: 2 }],
      ['one', { before: 3, local: 4, incoming: 3 }]
    ])
  })

  it('treats the same change made on both sides as agreed', () => {
    expect(shapes(threeWay(o, ['a', 'X', 'c', 'd'], ['a', 'X', 'c', 'd']))[1]).toEqual({
      kind: 'agreed',
      before: ['b'],
      after: ['X']
    })
  })

  it('makes a conflict of one passage changed differently on both sides', () => {
    expect(shapes(threeWay(o, ['a', 'L', 'c', 'd'], ['a', 'I', 'c', 'd']))[1]).toEqual({
      kind: 'conflict',
      before: ['b'],
      local: ['L'],
      incoming: ['I']
    })
  })

  it('keeps edits to neighbouring paragraphs apart: their order is plain', () => {
    expect(threeWay(o, ['a', 'B', 'c', 'd'], ['a', 'b', 'C', 'd']).map((r) => r.kind)).toEqual([
      'same',
      'one',
      'one',
      'same'
    ])
  })

  it('makes a conflict of two insertions at the same place, which have no order of their own', () => {
    expect(shapes(threeWay(o, ['a', 'L', 'b', 'c', 'd'], ['a', 'I', 'b', 'c', 'd']))[1]).toEqual({
      kind: 'conflict',
      before: [],
      local: ['L'],
      incoming: ['I']
    })
  })

  it('joins an edit that also adds and an addition meeting it end to start: both add there', () => {
    // Incoming edits A and adds N after it; this computer adds the same N.
    const regions = threeWay(
      ['A.', 'B.', 'C.'],
      ['A.', 'N.', 'B.', 'C.'],
      ['A, edited.', 'N.', 'B.', 'C.']
    )
    expect(shapes(regions)[0]).toEqual({
      kind: 'conflict',
      before: ['A.'],
      local: ['A.', 'N.'],
      incoming: ['A, edited.', 'N.']
    })
    // And two additions after B, one with B edited: no order picked by the arithmetic.
    expect(
      threeWay(['A.', 'B.'], ['A.', 'B.', 'L.'], ['A.', 'B, edited.', 'I.']).map((r) => r.kind)
    ).toEqual(['same', 'conflict'])
  })

  it('keeps a deletion beside an edit apart: nothing is added where they meet', () => {
    expect(threeWay(o, ['a', 'c', 'd'], ['a', 'b', 'C', 'd']).map((r) => r.kind)).toEqual([
      'same',
      'one',
      'one',
      'same'
    ])
  })

  it('makes a conflict of a deletion on one side and an edit on the other', () => {
    expect(shapes(threeWay(o, ['a', 'c', 'd'], ['a', 'B', 'c', 'd']))[1]).toEqual({
      kind: 'conflict',
      before: ['b'],
      local: [],
      incoming: ['B']
    })
  })

  it('takes in a whole overlapping run, however the changes chain', () => {
    // Local changes b–c, incoming changes c–d: one passage, b to d.
    expect(shapes(threeWay(o, ['a', 'B', 'C', 'd'], ['a', 'b', 'Cx', 'Dx']))[1]).toEqual({
      kind: 'conflict',
      before: ['b', 'c', 'd'],
      local: ['B', 'C', 'd'],
      incoming: ['b', 'Cx', 'Dx']
    })
  })
})

describe('pairing paragraphs', () => {
  it('pairs each new paragraph with the old one it edits, however they shifted', () => {
    expect(pairUp(['The wind rose.'], ['The rain fell harder.', 'The wind rose.'])).toEqual([
      { kind: 'insert', after: 0 },
      { kind: 'edit', before: 0, after: 1 }
    ])
  })

  it('pairs a rewrite past recognition with the paragraph it replaced, in order', () => {
    expect(pairUp(['She watched Callow shrink.'], ['Nothing like it.'])).toEqual([
      { kind: 'edit', before: 0, after: 0 }
    ])
    expect(pairUp(['One.', 'Two.'], ['Uno.'])).toEqual([
      { kind: 'edit', before: 0, after: 0 },
      { kind: 'delete', before: 1 }
    ])
  })
})

describe('a chapter with a dispute', () => {
  // The deckhand line is a paragraph away from the disputed one: a change
  // touching it would join the same passage.
  const before = body(
    'The ferry left at dusk.',
    'She watched the lights of Callow shrink.',
    'The wind came up off the water.',
    'The deckhand offered her tea from a flask.',
    'She took it.'
  )
  const local = body(
    'The ferry left at dusk.',
    'She watched the lights of Callow shrink to nothing.',
    'Somewhere below, the engine coughed.',
    'The wind came up off the water.',
    'The deckhand offered her tea from a flask.',
    'She took it.'
  )
  const incoming = body(
    'The ferry left at dusk.',
    'She did not look back at Callow.',
    'The wind came up off the water.',
    'The deckhand offered her tea from a dented flask.',
    'She took it.'
  )

  it('puts a gap where the passage was, and each side’s paragraphs on its own stack', () => {
    const m = lay(before, local, incoming)
    expect(m.disputes).toHaveLength(1)
    const [d] = m.disputes
    expect(d.before).toEqual(['She watched the lights of Callow shrink.'])
    expect(d.local.map((id) => card(m, id).markdown)).toEqual([
      'She watched the lights of Callow shrink to nothing.',
      'Somewhere below, the engine coughed.'
    ])
    expect(d.incoming.map((id) => card(m, id).markdown)).toEqual([
      'She did not look back at Callow.'
    ])
    expect(d.deleted).toBeNull()
    expect(kinds(m.items)).toEqual([
      'text:The ferry left at dusk.',
      'gap:d0.gap',
      'text:The wind came up off the water.',
      'card:c0',
      'text:She took it.'
    ])
  })

  it('places a change only one side made, marked, carrying the paragraph it replaced', () => {
    const m = lay(before, local, incoming)
    const only = card(m, 'c0')
    expect(only).toMatchObject({
      side: 'incoming',
      only: true,
      markdown: 'The deckhand offered her tea from a dented flask.',
      restore: [{ markdown: 'The deckhand offered her tea from a flask.', blanks: 0 }]
    })
    expect(underlined(only)).toBe('dented')
  })

  it('underlines the words each side changed, and tags a paragraph that had no before as New', () => {
    const m = lay(before, local, incoming)
    const [l0, l1] = m.disputes[0].local.map((id) => card(m, id))
    expect(underlined(l0)).toBe('to nothing')
    expect(l0.isNew).toBe(false)
    expect(l1.isNew).toBe(true)
    // New instead of underlined, as the design has it.
    expect(l1.runs.some((r) => r.changed)).toBe(false)
    const [i0] = m.disputes[0].incoming.map((id) => card(m, id))
    expect(i0.isNew).toBe(false)
    expect(underlined(i0).split('|')).toEqual(
      expect.arrayContaining(['did', 'not', 'look', 'back', 'at'])
    )
  })

  it('composes with the gap left empty as the chapter without the passage', () => {
    expect(composed(lay(before, local, incoming))).toBe(
      body(
        'The ferry left at dusk.',
        'The wind came up off the water.',
        'The deckhand offered her tea from a dented flask.',
        'She took it.'
      )
    )
  })

  it('composes both stacks dropped into the gap, in order, as the writer arranged them', () => {
    const m = lay(before, local, incoming)
    const gap = m.items.findIndex((i) => i.kind === 'gap')
    let items = placeCards(m.items, gap + 1, m.disputes[0].local)
    items = placeCards(items, gap + 1, m.disputes[0].incoming)
    expect(composeChapter(items, m.cards)).toBe(
      body(
        'The ferry left at dusk.',
        'She did not look back at Callow.',
        'She watched the lights of Callow shrink to nothing.',
        'Somewhere below, the engine coughed.',
        'The wind came up off the water.',
        'The deckhand offered her tea from a dented flask.',
        'She took it.'
      )
    )
  })

  it('gives the dispute a page showing a few paragraphs either side', () => {
    const m = lay(before, local, incoming)
    expect(m.pages).toHaveLength(1)
    const [page] = m.pages
    expect(page).toMatchObject({ kind: 'dispute', dispute: 'd0', after: null, before: null })
    expect(kinds(pageItems(m.items, page).shown)).toEqual(kinds(m.items))
  })
})

describe('cards', () => {
  it('keep the page’s styling, split where the changed words start and end', () => {
    const m = lay(body('A quiet night.'), body('A **very** quiet *night*.'), body('A quiet day.'))
    expect(card(m, m.disputes[0].local[0]).runs).toEqual([
      { text: 'A ' },
      { text: 'very', bold: true, changed: true },
      { text: ' quiet ' },
      { text: 'night', italic: true },
      { text: '.' }
    ])
  })

  it('say a paragraph was restyled when its words are the same and its styling is not', () => {
    const m = lay(body('Keep this.'), body('Keep **this**.'), body('Keep that.'))
    const restyled = card(m, m.disputes[0].local[0])
    expect(restyled).toMatchObject({ restyled: true, isNew: false, cut: false })
    expect(restyled.runs.some((r) => r.changed)).toBe(false)
    expect(card(m, m.disputes[0].incoming[0]).restyled).toBe(false)
  })

  it('say words were cut from a paragraph split or shortened, never that it was restyled', () => {
    const split = lay(
      body('A.', 'She left. He stayed.', 'D.'),
      body('A.', 'She left.', 'He stayed.', 'D.'),
      body('A.', 'She left. He stayed.', 'D.')
    )
    const halves = Object.values(split.cards)
    expect(halves.map((c) => c.markdown)).toEqual(['She left.', 'He stayed.'])
    expect(halves[0]).toMatchObject({ cut: true, restyled: false })
    for (const c of halves) expect(c.restyled).toBe(false)
  })

  it('never call an ordinary edit cut: its new words are underlined instead', () => {
    const m = lay(body('A quiet night.'), body('A still night.'), body('A quiet day.'))
    expect(card(m, m.disputes[0].local[0])).toMatchObject({ cut: false, restyled: false })
  })

  it('underline a hard break put where a space was', () => {
    const m = lay(
      body('A.', 'Line one line two.', 'D.'),
      body('A.', 'Line one\\\nline two.', 'D.'),
      body('A.', 'Line one line two.', 'D.')
    )
    const c = Object.values(m.cards)[0]
    expect(c.restyled).toBe(false)
    expect(c.runs.find((r) => r.break)).toEqual({ text: '\n', break: true, changed: true })
  })

  it('show a paragraph a side kept as it was as unchanged, wherever it moved in the passage', () => {
    const m = lay(
      body('The wind rose.'),
      body('The rain fell harder.', 'The wind rose.'),
      body('The wind rose high.')
    )
    const [added, kept] = m.disputes[0].local.map((id) => card(m, id))
    expect(added.isNew).toBe(true)
    expect(kept).toMatchObject({ isNew: false, restyled: false, cut: false })
    expect(kept.runs.some((r) => r.changed)).toBe(false)
  })

  it('show a paragraph a side left as it was, inside a disputed passage, as unchanged', () => {
    const m = lay(
      body('a.', 'b.', 'c.', 'd.'),
      body('a.', 'B.', 'C.', 'd.'),
      body('a.', 'b.', 'Cx.', 'Dx.')
    )
    const [d] = m.disputes
    expect(d.before).toEqual(['b.', 'c.', 'd.'])
    const kept = d.local.map((id) => card(m, id)).find((c) => c.markdown === 'd.')!
    expect(kept).toMatchObject({ isNew: false, restyled: false })
    expect(kept.runs.some((r) => r.changed)).toBe(false)
  })

  it('keep a hard break as a run of its own', () => {
    const m = lay(body('Old.'), body('Line one\\\nline two'), body('Other.'))
    const runs = card(m, m.disputes[0].local[0]).runs
    expect(runs.find((r) => r.break)).toMatchObject({ text: '\n', break: true })
    expect(plainOf('Line one\\\nline two')).toBe('Line one\nline two')
  })
})

describe('both edits', () => {
  it('combines a typo fixed on one side with a sentence rewritten on the other', () => {
    expect(
      bothEdits(
        'She watched the ligths fade. Then she slept.',
        'She watched the lights fade. Then she slept.',
        'She watched the ligths fade. Then she wept.'
      )
    ).toBe('She watched the lights fade. Then she wept.')
  })

  it('is not offered when the two changed the same words', () => {
    expect(bothEdits('The cat sat.', 'The dog sat.', 'The bird sat.')).toBeNull()
  })

  it('is not offered when both added words where they meet, which would double them', () => {
    expect(
      bothEdits(
        'She closed the door',
        'She closed the door behind her',
        'She closed the gate behind her'
      )
    ).toBeNull()
    expect(bothEdits('He left', 'He left quietly', 'He went quietly')).toBeNull()
  })

  it('is not offered when combining comes out as one side’s paragraph', () => {
    expect(bothEdits('One two.', 'One two three.', 'One two three.')).toBeNull()
  })

  it('carries a word’s styling with it, and is not offered when styling would come apart', () => {
    expect(bothEdits('a b c', 'a **b** c', 'a b d')).toBe('a **b** d')
    expect(bothEdits('a b c d', 'a **b c** d', 'a b x d')).toBeNull()
  })

  it('is not offered when the combination would not read back as itself (a hand-edited stray marker)', () => {
    expect(bothEdits('a b', 'a **b', 'x b')).toBeNull()
  })

  it('comes as a card on a dispute of one paragraph a side, underlined against before', () => {
    const m = lay(
      body('Intro.', 'She watched the ligths fade. Then she slept.', 'End.'),
      body('Intro.', 'She watched the lights fade. Then she slept.', 'End.'),
      body('Intro.', 'She watched the ligths fade. Then she wept.', 'End.')
    )
    const both = card(m, m.disputes[0].both!)
    expect(both.side).toBe('both')
    expect(both.markdown).toBe('She watched the lights fade. Then she wept.')
    expect(underlined(both)).toBe('lights|wept')
  })

  it('is not made for a dispute of more than one paragraph on a side', () => {
    const m = lay(body('A b.'), body('A c.', 'More.'), body('X b.'))
    expect(m.disputes[0].both).toBeNull()
  })
})

describe('deletions', () => {
  it('says which side deleted a disputed passage, and gives it no stack', () => {
    const m = lay(
      body('Before.', 'The harbourmaster was waiting.', 'After.'),
      body('Before.', 'The harbourmaster was waiting with a lantern.', 'After.'),
      body('Before.', 'After.')
    )
    const [d] = m.disputes
    expect(d.deleted).toBe('incoming')
    expect(d.incoming).toEqual([])
    expect(d.local).toHaveLength(1)
  })

  it('shows a paragraph only one side deleted as removed there, and can put it back', () => {
    const m = lay(
      body('One.', 'Two.', 'Three.'),
      body('One.', 'Two.', 'Three.'),
      body('One.', 'Three.')
    )
    expect(kinds(m.items)).toEqual(['text:One.', 'removed:c0', 'text:Three.'])
    expect(m.items[1]).toMatchObject({
      side: 'incoming',
      before: [{ markdown: 'Two.', blanks: 0 }]
    })
    expect(composed(m)).toBe(body('One.', 'Three.'))
    expect(composeChapter(restoreRemoved(m.items, 'c0'), m.cards)).toBe(
      body('One.', 'Two.', 'Three.')
    )
  })

  it('puts a removed paragraph back with the blank lines it had', () => {
    const kept = bodyOf(['A.', 'B.', '', '', 'X.', 'C.'])
    const m = lay(kept, kept, body('A.', 'B.', 'C.'))
    const removed = m.items.find((i) => i.kind === 'removed')!
    expect(composeChapter(restoreRemoved(m.items, removed.id), m.cards)).toBe(kept)
  })
})

describe('blank lines', () => {
  it('never turn the other side’s change into a dispute', () => {
    // Incoming only added a blank line before X; this computer edited X.
    const m = lay(
      body('A.', 'X.', 'B.'),
      body('A.', 'X, edited.', 'B.'),
      bodyOf(['A.', '', 'X.', 'B.'])
    )
    expect(m.disputes).toEqual([])
    expect(composed(m)).toBe(bodyOf(['A.', '', 'X, edited.', 'B.']))
  })

  it('never empty a stack: a blank line on one side and a new paragraph on the other is the new paragraph', () => {
    const m = lay(body('A.', 'B.'), bodyOf(['A.', '', 'B.']), body('A.', 'X.', 'B.'))
    expect(m.disputes).toEqual([])
    expect(composed(m)).toContain('X.')
  })

  it('never ask the writer to choose between the same words', () => {
    const m = lay(
      body('A.', 'The cat sat.', 'B.'),
      bodyOf(['A.', 'The cat sat down.', '', 'B.']),
      body('A.', 'The cat sat down.', 'B.')
    )
    expect(m.disputes).toEqual([])
    expect(composed(m)).toBe(bodyOf(['A.', 'The cat sat down.', '', 'B.']))
  })

  it('travel with the paragraph after them, and come back with a paragraph a card replaced', () => {
    const spaced = bodyOf(['A.', '', '', 'B.', 'C.'])
    const m = lay(spaced, spaced, bodyOf(['A.', '', '', 'Bee.', 'C.']))
    expect(composed(m)).toBe(bodyOf(['A.', '', '', 'Bee.', 'C.']))
    const off = liftCard(m.items, m.cards, 'c0')
    expect(composeChapter(off.items, off.cards)).toBe(spaced)
  })

  it('merge as spacing: this computer’s where both changed them, else whoever did', () => {
    const before = body('A.', 'B.', 'C.')
    const apart = lay(before, bodyOf(['A.', '', 'B.', 'C.']), bodyOf(['A.', 'B.', '', '', 'C.']))
    expect(composed(apart)).toBe(bodyOf(['A.', '', 'B.', '', '', 'C.']))
    const both = lay(before, bodyOf(['A.', '', 'B.', 'C.']), bodyOf(['A.', '', '', 'B.', 'C.']))
    expect(composed(both)).toBe(bodyOf(['A.', '', 'B.', 'C.']))
  })

  it('need no page when they are all that changed', () => {
    const m = lay(body('One.', 'Two.'), body('One.', 'Two.'), bodyOf(['One.', '', '', 'Two.']))
    expect(m.pages).toEqual([])
  })
})

describe('taking a card off and putting it on', () => {
  const m = lay(body('A.', 'B.', 'C.'), body('A.', 'B.', 'C.'), body('A.', 'Bee.', 'C.'))

  it('puts back the paragraph a change replaced when its card comes off, once', () => {
    const { items, cards } = liftCard(m.items, m.cards, 'c0')
    expect(composeChapter(items, cards)).toBe(body('A.', 'B.', 'C.'))
    expect(isPlaced(items, 'c0')).toBe(false)
    expect(cards.c0.restore).toBeUndefined()
    // On again somewhere else, and off again: nothing more comes back.
    const moved = placeCards(items, 0, ['c0'])
    const again = liftCard(moved, cards, 'c0')
    expect(composeChapter(again.items, again.cards)).toBe(body('A.', 'B.', 'C.'))
  })

  it('brings back exactly the paragraph each card replaced, in a change of several', () => {
    // Incoming added a paragraph and edited the next one.
    const before = body('Intro.', 'P is here.', 'End.')
    const two = lay(before, before, body('Intro.', 'New para.', 'P is here now.', 'End.'))
    const ids = Object.keys(two.cards)
    expect(ids.map((id) => two.cards[id].markdown)).toEqual(['New para.', 'P is here now.'])
    const offNew = liftCard(two.items, two.cards, ids[0])
    expect(composeChapter(offNew.items, offNew.cards)).toBe(
      body('Intro.', 'P is here now.', 'End.')
    )
    const offEdit = liftCard(two.items, two.cards, ids[1])
    expect(composeChapter(offEdit.items, offEdit.cards)).toBe(
      body('Intro.', 'New para.', 'P is here.', 'End.')
    )
  })

  it('moves a card already on the page rather than copying it', () => {
    const moved = placeCards(m.items, m.items.length, ['c0'])
    expect(moved.filter((i) => i.kind === 'card')).toHaveLength(1)
    expect(composeChapter(moved, m.cards)).toBe(body('A.', 'C.', 'Bee.'))
  })

  it('moves a card forward to where it was dropped, counting from the page as it was', () => {
    const items: MergeItem[] = [
      { kind: 'text', id: 'a', markdown: 'A.', blanks: 0 },
      { kind: 'card', id: 'k' },
      { kind: 'text', id: 'b', markdown: 'B.', blanks: 0 },
      { kind: 'text', id: 'c', markdown: 'C.', blanks: 0 }
    ]
    // Dropped between B and C: index 3 on the page the writer saw.
    expect(kinds(placeCards(items, 3, ['k']))).toEqual(['text:A.', 'text:B.', 'card:k', 'text:C.'])
  })

  it('places between items only, at either end as well', () => {
    expect(kinds(placeCards(m.items, 0, ['x']))[0]).toBe('card:x')
    expect(kinds(placeCards(m.items, 99, ['x'])).at(-1)).toBe('card:x')
  })

  it('leaves the page as it was when the card is not on it', () => {
    expect(liftCard(m.items, m.cards, 'nope').items).toBe(m.items)
  })
})

describe('pages', () => {
  const para = (n: number): string => `Paragraph ${n}.`
  const long = Array.from({ length: 20 }, (_, n) => para(n))
  const edit = (from: string[], at: number, to: string): string[] =>
    from.map((p, i) => (i === at ? to : p))

  it(`shows ${CONTEXT} paragraphs either side of a dispute, ended by things that never move`, () => {
    const m = lay(bodyOf(long), bodyOf(edit(long, 10, 'L.')), bodyOf(edit(long, 10, 'I.')))
    const [page] = m.pages
    expect(kinds(pageItems(m.items, page).shown)).toEqual([
      'text:Paragraph 8.',
      'text:Paragraph 9.',
      'gap:d0.gap',
      'text:Paragraph 11.',
      'text:Paragraph 12.'
    ])
    // Paragraph 7 and paragraph 13: t10 onwards come after the gap.
    expect(page.after).toBe('t7')
    expect(page.before).toBe('t12')
  })

  it('counts paragraphs of context, not the blank lines between them', () => {
    const spaced = [
      'Far.',
      'Near one.',
      '',
      '',
      'Near two.',
      'Disputed.',
      'After one.',
      '',
      'After two.',
      'Far after.'
    ]
    const m = lay(bodyOf(spaced), bodyOf(edit(spaced, 5, 'L.')), bodyOf(edit(spaced, 5, 'I.')))
    expect(kinds(pageItems(m.items, m.pages[0]).shown)).toEqual([
      'text:Near one.',
      'text:Near two.',
      'gap:d0.gap',
      'text:After one.',
      'text:After two.'
    ])
  })

  it('gives each dispute its own page, each stopping at the other’s gap', () => {
    const local = edit(edit(long, 5, 'L5.'), 7, 'L7.')
    const incoming = edit(edit(long, 5, 'I5.'), 7, 'I7.')
    const m = lay(bodyOf(long), bodyOf(local), bodyOf(incoming))
    expect(m.pages.map((p) => p.dispute)).toEqual(['d0', 'd1'])
    const first = kinds(pageItems(m.items, m.pages[0]).shown)
    expect(first).toContain('gap:d0.gap')
    expect(first).not.toContain('gap:d1.gap')
    const second = kinds(pageItems(m.items, m.pages[1]).shown)
    expect(second).toContain('gap:d1.gap')
    expect(second).not.toContain('gap:d0.gap')
  })

  it('keeps cards placed at a page’s top or bottom on that page', () => {
    const m = lay(bodyOf(long), bodyOf(edit(long, 10, 'L.')), bodyOf(edit(long, 10, 'I.')))
    const [page] = m.pages
    const { start, shown } = pageItems(m.items, page)
    const atTop = placeCards(m.items, start, ['d0.l0'])
    expect(kinds(pageItems(atTop, page).shown)[0]).toBe('card:d0.l0')
    const atBottom = placeCards(m.items, start + shown.length, ['d0.i0'])
    expect(kinds(pageItems(atBottom, page).shown).at(-1)).toBe('card:d0.i0')
  })

  it('gives a change only one side made, far from any dispute, a page to be looked over', () => {
    const local = edit(long, 2, 'L.')
    const incoming = edit(edit(long, 2, 'I.'), 15, 'Only theirs.')
    const m = lay(bodyOf(long), bodyOf(local), bodyOf(incoming))
    expect(m.pages.map((p) => p.kind)).toEqual(['dispute', 'review'])
    expect(kinds(pageItems(m.items, m.pages[1]).shown)).toContain('card:c0')
  })

  it('shows a change near a dispute on the dispute’s page, with no page of its own', () => {
    // Paragraph 12, one away: a change touching the disputed paragraph would
    // join its passage.
    const local = edit(long, 10, 'L.')
    const incoming = edit(edit(long, 10, 'I.'), 12, 'Only theirs.')
    const m = lay(bodyOf(long), bodyOf(local), bodyOf(incoming))
    expect(m.pages).toHaveLength(1)
    expect(kinds(pageItems(m.items, m.pages[0]).shown)).toContain('card:c0')
  })

  it('reaches past a change just beyond the context, so its edges are text that never moves', () => {
    // The incoming change at 13 starts right where the context ends.
    const local = edit(long, 10, 'L.')
    const incoming = edit(edit(long, 10, 'I.'), 13, 'Only theirs.')
    const m = lay(bodyOf(long), bodyOf(local), bodyOf(incoming))
    const [page] = m.pages
    expect(m.pages).toHaveLength(1)
    expect(kinds(pageItems(m.items, page).shown)).toContain('card:c0')
    for (const edge of [page.after, page.before]) {
      expect(m.items.find((i) => i.id === edge)?.kind).toBe('text')
    }
    // Taking that card off leaves the page whole.
    const off = liftCard(m.items, m.cards, 'c0')
    expect(kinds(pageItems(off.items, page).shown)).toContain('text:Paragraph 13.')
  })

  it('makes one review page of changes close together', () => {
    const incoming = edit(edit(long, 4, 'Four.'), 6, 'Six.')
    const m = lay(bodyOf(long), bodyOf(long), bodyOf(incoming))
    expect(m.pages).toEqual([expect.objectContaining({ kind: 'review' })])
  })
})

/* ---------- invariants, over many random edits ---------- */

/** A small seeded generator, so a failure names the case that made it. */
function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

function mutate(from: string[], rand: () => number, tag: string): string[] {
  const out = [...from]
  const edits = 1 + Math.floor(rand() * 4)
  for (let e = 0; e < edits; e++) {
    const at = Math.floor(rand() * (out.length + 1))
    const what = rand()
    if (what < 0.35 && at < out.length && out[at] !== '') {
      out[at] = `${out[at].slice(0, -1)} ${tag}${e}.`
    } else if (what < 0.55) {
      out.splice(at, 0, `${tag} new ${e}.`)
    } else if (what < 0.65) {
      // Sometimes the very paragraph the other side may also add.
      out.splice(at, 0, 'Both thought of this.')
    } else if (what < 0.85 && at < out.length) {
      out.splice(at, 1)
    } else {
      out.splice(at, 0, '')
    }
  }
  return out
}

const filled = (ps: string[]): string[] => ps.filter((p) => p !== '')
const count = (ps: string[], p: string): number => ps.filter((x) => x === p).length

describe('for any edits on the two computers', () => {
  const cases = Array.from({ length: 300 }, (_, n) => n)

  it.each(cases)('case %i: every change is on some page, and every arrangement composes', (n) => {
    const rand = seeded(n + 1)
    const base = Array.from({ length: 4 + Math.floor(rand() * 12) }, (_, i) =>
      // Some lines repeat, as a refrain does, to test the line-up.
      rand() < 0.15 ? 'Again.' : `Line ${i} of it.`
    )
    const local = mutate(base, rand, 'mine')
    const incoming = mutate(base, rand, 'theirs')
    const m = lay(bodyOf(base), bodyOf(local), bodyOf(incoming))

    // The line-up accounts for every line of every version, once.
    const regions = threeWay(filled(base), filled(local), filled(incoming))
    const rebuild = (pick: (r: Region) => string[]): string[] => regions.flatMap(pick)
    expect(rebuild((r) => (r.kind === 'same' ? r.lines : r.before))).toEqual(filled(base))
    expect(
      rebuild((r) =>
        r.kind === 'same'
          ? r.lines
          : r.kind === 'conflict'
            ? r.local
            : r.kind === 'agreed' || r.side === 'local'
              ? r.after
              : r.before
      )
    ).toEqual(filled(local))
    expect(
      rebuild((r) =>
        r.kind === 'same'
          ? r.lines
          : r.kind === 'conflict'
            ? r.incoming
            : r.kind === 'agreed' || r.side === 'incoming'
              ? r.after
              : r.before
      )
    ).toEqual(filled(incoming))

    // Every gap, card and removed line is on at least one page.
    const onPages = new Set(m.pages.flatMap((p) => pageItems(m.items, p).shown.map((i) => i.id)))
    for (const item of m.items) {
      if (item.kind !== 'text') expect(onPages.has(item.id), `${item.id} on no page`).toBe(true)
    }
    // Each dispute has exactly one page, which shows its gap, and an empty
    // stack only for the side that deleted the passage.
    for (const d of m.disputes) {
      const pages = m.pages.filter((p) => p.dispute === d.id)
      expect(pages).toHaveLength(1)
      expect(pageItems(m.items, pages[0]).shown.some((i) => i.id === d.gap)).toBe(true)
      if (d.local.length === 0) expect(d.deleted).toBe('local')
      if (d.incoming.length === 0) expect(d.deleted).toBe('incoming')
    }

    // A paragraph neither had before appears no more often than the sides
    // added it between them. (The same paragraph added in two places is
    // shown twice, each on its page; added at the same place it is one
    // passage, tested above. Paragraphs before already had can repeat, as a
    // refrain does, and are not counted.)
    const laid = filled(paragraphsOf(composed(m)))
    for (const p of new Set(laid)) {
      if (count(filled(base), p) > 0) continue
      expect(count(laid, p), `"${p}" doubled`).toBeLessThanOrEqual(
        count(filled(local), p) + count(filled(incoming), p)
      )
    }

    // With one side unchanged, nothing is disputed and the page is the other side.
    if (bodyOf(local) === bodyOf(base)) {
      expect(m.disputes).toEqual([])
      expect(composed(m)).toBe(bodyOf(incoming))
    }
    // With both the same, there is nothing to do at all.
    if (bodyOf(local) === bodyOf(incoming)) {
      expect(m.disputes).toEqual([])
      expect(Object.keys(m.cards)).toEqual([])
      expect(composed(m)).toBe(bodyOf(local))
    }

    // Each gap filled with this computer's cards, and every change only the
    // other made taken off (and every paragraph it removed put back), is this
    // computer's chapter in words.
    const words = (s: string): string[] => filled(paragraphsOf(s))
    let items = m.items
    let cards = m.cards
    for (const d of m.disputes) {
      const gap = items.findIndex((i) => i.id === d.gap)
      items = placeCards(items, gap + 1, d.local)
    }
    for (const c of Object.values(m.cards)) {
      if (c.only && c.side === 'incoming') ({ items, cards } = liftCard(items, cards, c.id))
    }
    for (const item of [...items]) {
      if (item.kind === 'removed' && item.side === 'incoming')
        items = restoreRemoved(items, item.id)
    }
    expect(words(composeChapter(items, cards))).toEqual(words(bodyOf(local)))

    // And the other way round.
    items = m.items
    cards = m.cards
    for (const d of m.disputes) {
      const gap = items.findIndex((i) => i.id === d.gap)
      items = placeCards(items, gap + 1, d.incoming)
    }
    for (const c of Object.values(m.cards)) {
      if (c.only && c.side === 'local') ({ items, cards } = liftCard(items, cards, c.id))
    }
    for (const item of [...items]) {
      if (item.kind === 'removed' && item.side === 'local') items = restoreRemoved(items, item.id)
    }
    expect(words(composeChapter(items, cards))).toEqual(words(bodyOf(incoming)))

    // Every card is one paragraph with words in it.
    for (const c of Object.values(m.cards)) {
      expect(paragraphsOf(c.markdown)).toEqual([c.markdown])
      expect(c.markdown.trim()).not.toBe('')
    }
  })
})
