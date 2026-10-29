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
  paragraphsOf,
  placeCards,
  plainOf,
  restoreRemoved,
  threeWay,
  type ChapterMerge,
  type MergeCard,
  type MergeItem
} from '../src/renderer/src/lib/mergePages'
import { docToMarkdown, markdownToDoc } from '../src/renderer/src/lib/markdown'

/**
 * F-51 step 2: laying out a chapter changed on two computers — pure, so the
 * whole of it is tested here, before any screen exists. The unit is the
 * paragraph; what neither changed is fixed text, a change only one side made
 * is placed already and marked, a passage both changed differently is a
 * dispute with a page of its own, and the arrangement composes back to the
 * chapter's stored text exactly as the editor would write it.
 */

const body = (...paragraphs: string[]): string => bodyOf(paragraphs)

const lay = (before: string, local: string, incoming: string): ChapterMerge =>
  layoutChapter({ path: 'documents/ch.md', title: 'The Ferry', before, local, incoming })

const card = (m: ChapterMerge, id: string): MergeCard => m.cards[id]
const kinds = (items: MergeItem[]): string[] =>
  items.map((i) => (i.kind === 'text' ? `text:${i.markdown}` : `${i.kind}:${i.id}`))

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
      ''
    ]) {
      const stored = docToMarkdown(markdownToDoc(markdown))
      expect(bodyOf(paragraphsOf(stored))).toBe(stored)
    }
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
    expect(threeWay(o, o, o)).toEqual([{ kind: 'same', lines: o }])
  })

  it('names the side that made a change only it made', () => {
    expect(threeWay(o, ['a', 'B', 'c', 'd'], o)).toEqual([
      { kind: 'same', lines: ['a'] },
      { kind: 'one', side: 'local', before: ['b'], after: ['B'] },
      { kind: 'same', lines: ['c', 'd'] }
    ])
    expect(threeWay(o, o, ['a', 'b', 'c', 'd', 'e'])).toEqual([
      { kind: 'same', lines: o },
      { kind: 'one', side: 'incoming', before: [], after: ['e'] }
    ])
  })

  it('treats the same change made on both sides as agreed', () => {
    expect(threeWay(o, ['a', 'X', 'c', 'd'], ['a', 'X', 'c', 'd'])[1]).toEqual({
      kind: 'agreed',
      before: ['b'],
      after: ['X']
    })
  })

  it('makes a conflict of one passage changed differently on both sides', () => {
    expect(threeWay(o, ['a', 'L', 'c', 'd'], ['a', 'I', 'c', 'd'])[1]).toEqual({
      kind: 'conflict',
      before: ['b'],
      local: ['L'],
      incoming: ['I']
    })
  })

  it('keeps changes to neighbouring paragraphs apart: end to start is not an overlap', () => {
    expect(threeWay(o, ['a', 'B', 'c', 'd'], ['a', 'b', 'C', 'd']).map((r) => r.kind)).toEqual([
      'same',
      'one',
      'one',
      'same'
    ])
  })

  it('makes a conflict of two insertions at the same place, which have no order of their own', () => {
    expect(threeWay(o, ['a', 'L', 'b', 'c', 'd'], ['a', 'I', 'b', 'c', 'd'])[1]).toEqual({
      kind: 'conflict',
      before: [],
      local: ['L'],
      incoming: ['I']
    })
  })

  it('makes a conflict of a deletion on one side and an edit on the other', () => {
    expect(threeWay(o, ['a', 'c', 'd'], ['a', 'B', 'c', 'd'])[1]).toEqual({
      kind: 'conflict',
      before: ['b'],
      local: [],
      incoming: ['B']
    })
  })

  it('takes in a whole overlapping run, however the changes chain', () => {
    // Local changes b–c, incoming changes c–d: one passage, b to d.
    expect(threeWay(o, ['a', 'B', 'C', 'd'], ['a', 'b', 'Cx', 'Dx'])[1]).toEqual({
      kind: 'conflict',
      before: ['b', 'c', 'd'],
      local: ['B', 'C', 'd'],
      incoming: ['b', 'Cx', 'Dx']
    })
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
      'card:c0.0',
      'text:She took it.'
    ])
  })

  it('places a change only one side made, marked, carrying the text it replaced', () => {
    const m = lay(before, local, incoming)
    const only = card(m, 'c0.0')
    expect(only).toMatchObject({
      side: 'incoming',
      only: true,
      markdown: 'The deckhand offered her tea from a dented flask.',
      restore: ['The deckhand offered her tea from a flask.']
    })
    expect(underlined(only)).toBe('dented')
  })

  it('underlines the words each side changed, and tags a paragraph that had no before as New', () => {
    const m = lay(before, local, incoming)
    const [l0, l1] = m.disputes[0].local.map((id) => card(m, id))
    expect(underlined(l0)).toBe('to nothing')
    expect(l0.isNew).toBe(false)
    expect(l1.isNew).toBe(true)
    const [i0] = m.disputes[0].incoming.map((id) => card(m, id))
    expect(i0.isNew).toBe(false)
    expect(underlined(i0)).toContain('did not look back at')
  })

  it('composes with the gap left empty as the chapter without the passage', () => {
    const m = lay(before, local, incoming)
    expect(composeChapter(m.items, m.cards)).toBe(
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
    const c = card(m, m.disputes[0].local[0])
    expect(c.runs).toEqual([
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
    expect(restyled.restyled).toBe(true)
    expect(restyled.isNew).toBe(false)
    expect(restyled.runs.some((r) => r.changed)).toBe(false)
    expect(card(m, m.disputes[0].incoming[0]).restyled).toBe(false)
  })

  it('show a paragraph a side left as it was, inside a disputed passage, as unchanged and not restyled', () => {
    const m = lay(
      body('a.', 'b.', 'c.', 'd.'),
      body('a.', 'B.', 'C.', 'd.'),
      body('a.', 'b.', 'Cx.', 'Dx.')
    )
    const [d] = m.disputes
    expect(d.before).toEqual(['b.', 'c.', 'd.'])
    const kept = d.local.map((id) => card(m, id)).find((c) => c.markdown === 'd.')!
    expect(kept.restyled).toBe(false)
    expect(kept.isNew).toBe(false)
    expect(kept.runs.some((r) => r.changed)).toBe(false)
  })

  it('keep a hard break as a run of its own', () => {
    const m = lay(body('Old.'), body('Line one\\\nline two'), body('Other.'))
    const runs = card(m, m.disputes[0].local[0]).runs
    expect(runs.find((r) => r.break)).toEqual({ text: '\n', break: true, changed: true })
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

  it('is not offered when combining comes out as one side’s paragraph', () => {
    expect(bothEdits('One two.', 'One two three.', 'One two three.')).toBeNull()
  })

  it('carries a word’s styling with it, and is not offered when styling would come apart', () => {
    expect(bothEdits('a b c', 'a **b** c', 'a b d')).toBe('a **b** d')
    // Bold over two words on one side, a word inside it changed on the other:
    // the word-by-word result would not read back as itself.
    expect(bothEdits('a b c d', 'a **b c** d', 'a b x d')).toBeNull()
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

  it('is not offered when the combination would not read back as itself (a hand-edited stray marker)', () => {
    expect(bothEdits('a b', 'a **b', 'x b')).toBeNull()
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

  it('shows a passage only one side deleted as removed there, and can put it back', () => {
    const m = lay(
      body('One.', 'Two.', 'Three.'),
      body('One.', 'Two.', 'Three.'),
      body('One.', 'Three.')
    )
    expect(kinds(m.items)).toEqual(['text:One.', 'removed:c0.removed', 'text:Three.'])
    expect(m.items[1]).toMatchObject({ side: 'incoming', before: ['Two.'] })
    expect(composeChapter(m.items, m.cards)).toBe(body('One.', 'Three.'))
    const back = restoreRemoved(m.items, 'c0.removed')
    expect(composeChapter(back, m.cards)).toBe(body('One.', 'Two.', 'Three.'))
  })
})

describe('taking a card off and putting it on', () => {
  const m = lay(body('A.', 'B.', 'C.'), body('A.', 'B.', 'C.'), body('A.', 'Bee.', 'C.'))

  it('puts back the text a change replaced when its card comes off, once', () => {
    const { items, cards } = liftCard(m.items, m.cards, 'c0.0')
    expect(composeChapter(items, cards)).toBe(body('A.', 'B.', 'C.'))
    expect(isPlaced(items, 'c0.0')).toBe(false)
    expect(cards['c0.0'].restore).toBeUndefined()
    // On again somewhere else, and off again: nothing more comes back.
    const moved = placeCards(items, 0, ['c0.0'])
    const again = liftCard(moved, cards, 'c0.0')
    expect(composeChapter(again.items, again.cards)).toBe(body('A.', 'B.', 'C.'))
  })

  it('moves a card already on the page rather than copying it', () => {
    const moved = placeCards(m.items, m.items.length, ['c0.0'])
    expect(moved.filter((i) => i.kind === 'card')).toHaveLength(1)
    expect(composeChapter(moved, m.cards)).toBe(body('A.', 'C.', 'Bee.'))
  })

  it('moves a card forward to where it was dropped, counting from the page as it was', () => {
    const items: MergeItem[] = [
      { kind: 'text', id: 'a', markdown: 'A.' },
      { kind: 'card', id: 'k' },
      { kind: 'text', id: 'b', markdown: 'B.' },
      { kind: 'text', id: 'c', markdown: 'C.' }
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
    const shown = pageItems(m.items, page).shown
    expect(kinds(shown)).toEqual([
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
    const shown = kinds(pageItems(m.items, m.pages[0]).shown).filter((k) => k !== 'text:')
    expect(shown).toEqual([
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
    expect(kinds(pageItems(m.items, m.pages[1]).shown)).toContain('card:c0.0')
  })

  it('shows a change near a dispute on the dispute’s page, with no page of its own', () => {
    // Paragraph 12, one away: a change touching the disputed paragraph would
    // join its passage.
    const local = edit(long, 10, 'L.')
    const incoming = edit(edit(long, 10, 'I.'), 12, 'Only theirs.')
    const m = lay(bodyOf(long), bodyOf(local), bodyOf(incoming))
    expect(m.pages).toHaveLength(1)
    expect(kinds(pageItems(m.items, m.pages[0]).shown)).toContain('card:c0.0')
  })

  it('reaches past a change just beyond the context, so its edges are text that never moves', () => {
    // The incoming change at 13 starts right where the context ends.
    const local = edit(long, 10, 'L.')
    const incoming = edit(edit(long, 10, 'I.'), 13, 'Only theirs.')
    const m = lay(bodyOf(long), bodyOf(local), bodyOf(incoming))
    const [page] = m.pages
    expect(m.pages).toHaveLength(1)
    expect(kinds(pageItems(m.items, page).shown)).toContain('card:c0.0')
    for (const edge of [page.after, page.before]) {
      expect(m.items.find((i) => i.id === edge)?.kind).toBe('text')
    }
    // Taking that card off leaves the page whole.
    const off = liftCard(m.items, m.cards, 'c0.0')
    expect(kinds(pageItems(off.items, page).shown)).toContain('text:Paragraph 13.')
  })

  it('makes one review page of changes close together, and none for blank lines alone', () => {
    const incoming = edit(edit(long, 4, 'Four.'), 6, 'Six.')
    const m = lay(bodyOf(long), bodyOf(long), bodyOf(incoming))
    expect(m.pages).toEqual([expect.objectContaining({ kind: 'review' })])
    const spaced = lay(body('One.', 'Two.'), body('One.', 'Two.'), bodyOf(['One.', '', '', 'Two.']))
    expect(spaced.pages).toEqual([])
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
    if (what < 0.4 && at < out.length) out[at] = `${out[at].slice(0, -1)} ${tag}${e}.`
    else if (what < 0.65) out.splice(at, 0, `${tag} new ${e}.`)
    else if (what < 0.85 && at < out.length) out.splice(at, 1)
    else out.splice(at, 0, '')
  }
  return out
}

describe('for any edits on the two computers', () => {
  const cases = Array.from({ length: 300 }, (_, n) => n)

  it.each(cases)('case %i: every change is on some page, and every arrangement composes', (n) => {
    const rand = seeded(n + 1)
    const base = Array.from({ length: 4 + Math.floor(rand() * 12) }, (_, i) => `Line ${i} of it.`)
    const local = mutate(base, rand, 'mine')
    const incoming = mutate(base, rand, 'theirs')
    const m = lay(bodyOf(base), bodyOf(local), bodyOf(incoming))

    // Every gap, card and removed line is on at least one page.
    const onPages = new Set(m.pages.flatMap((p) => pageItems(m.items, p).shown.map((i) => i.id)))
    for (const item of m.items) {
      if (item.kind !== 'text') expect(onPages.has(item.id), `${item.id} on no page`).toBe(true)
    }
    // Each dispute has exactly one page, which shows its gap.
    for (const d of m.disputes) {
      const pages = m.pages.filter((p) => p.dispute === d.id)
      expect(pages).toHaveLength(1)
      expect(pageItems(m.items, pages[0]).shown.some((i) => i.id === d.gap)).toBe(true)
    }

    // With one side unchanged, nothing is disputed and the page is the other side.
    if (bodyOf(local) === bodyOf(base)) {
      expect(m.disputes).toEqual([])
      expect(composeChapter(m.items, m.cards)).toBe(bodyOf(incoming))
    }

    // Each gap filled with this computer's cards, and every change only the
    // other made taken off (and every passage it removed put back), is this
    // computer's chapter, give or take blank lines in disputed passages.
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
    const words = (s: string): string[] => paragraphsOf(s).filter((p) => p !== '')
    expect(words(composeChapter(items, cards))).toEqual(words(bodyOf(local)))

    // And the other way round: their cards in every gap, this computer's own
    // changes taken off and its removals put back, is the other chapter.
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

    // Every card is one paragraph with words in it, never a blank line.
    for (const c of Object.values(m.cards)) {
      expect(paragraphsOf(c.markdown)).toEqual([c.markdown])
      expect(c.markdown.trim()).not.toBe('')
    }
  })
})
