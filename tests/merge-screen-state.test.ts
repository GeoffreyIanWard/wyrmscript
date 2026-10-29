import { describe, expect, it } from 'vitest'
import type { SyncConflict } from '../src/shared/types'
import { bodyOf } from '../src/renderer/src/lib/mergePages'
import {
  answerOf,
  arrange,
  canArrange,
  choose,
  dropIndex,
  forget,
  gapIndex,
  intoGap,
  leftovers,
  pagesOf,
  placeOn,
  putBack,
  recall,
  remember,
  stackOf,
  takeOff,
  tray,
  unchosen,
  whenWritten,
  type ProseChapter
} from '../src/renderer/src/lib/mergeScreen'

/**
 * F-51 step 4: the merge screen's state, without a screen. A conflicted
 * chapter is laid out with cards, a file that is not prose is a choice, the
 * moves keep every card somewhere (on the page, its stack, the bin or the
 * pad), and the answer is each chapter as arranged plus every card the
 * writer kept or left — nothing is lost by finishing.
 */

const body = (...ps: string[]): string => bodyOf(ps)

function doc(path: string, before: string, local: string, remote: string): SyncConflict {
  return {
    path,
    kind: 'doc',
    title: 'The Ferry',
    baseBody: before,
    localBody: local,
    remoteBody: remote,
    localAt: null,
    remoteAt: null
  }
}

/** One dispute (paragraph 2), and a change only the other computer made (4). */
const FERRY = doc(
  'documents/ferry.md',
  body('One.', 'Two was here.', 'Three.', 'Four was here.', 'Five.'),
  body('One.', 'Two, as I had it.', 'Three.', 'Four was here.', 'Five.'),
  body('One.', 'Two, as they had it.', 'Three.', 'Four, as they had it.', 'Five.')
)

const prose = (arr: ReturnType<typeof arrange>, i = 0): ProseChapter => arr[i] as ProseChapter

describe('arranging conflicts', () => {
  it('lays prose out with cards, and anything else as a choice', () => {
    const arr = arrange([
      FERRY,
      { ...doc('documents/gone.md', 'A.\n', 'A, edited.\n', 'x'), remoteBody: null },
      {
        path: 'project.json',
        kind: 'project',
        title: 'Binder & project settings',
        localBody: '{}',
        remoteBody: '{ }',
        baseBody: null,
        localAt: null,
        remoteAt: null
      },
      {
        ...doc('characters/x.png', '', '', ''),
        kind: 'file',
        localBody: '(not text — an image or other file)'
      }
    ])
    expect(arr.map((c) => c.kind)).toEqual(['prose', 'choice', 'choice', 'choice'])
    expect(canArrange(FERRY)).toBe(true)
  })

  it('offers keeping both only for a document both sides still have', () => {
    const arr = arrange([
      { ...doc('documents/a.md', 'A.\n', 'B.\n', 'C.\n'), kind: 'doc', localBody: null },
      {
        path: 'project.json',
        kind: 'project',
        title: 'B',
        localBody: '{}',
        remoteBody: '{ }',
        baseBody: null,
        localAt: null,
        remoteAt: null
      }
    ])
    expect(arr.map((c) => c.kind === 'choice' && c.both)).toEqual([false, false])
    expect(choose(arr, 0, 'both')).toBe(arr)
  })

  it('starts every dispute card on its stack and every one-sided change on the page', () => {
    const ch = prose(arrange([FERRY]))
    const [d] = ch.merge.disputes
    for (const id of [...d.local, ...d.incoming]) expect(ch.off[id]).toBe('stack')
    const only = Object.values(ch.cards).find((c) => c.only)!
    expect(ch.off[only.id]).toBeUndefined()
    expect(ch.items.some((i) => i.kind === 'card' && i.id === only.id)).toBe(true)
  })

  it('keeps each page’s stacks to its own cards, with two disputes in a chapter', () => {
    const lines = (f: (i: number) => string): string =>
      bodyOf(Array.from({ length: 12 }, (_, i) => f(i)))
    const ch = prose(
      arrange([
        doc(
          'documents/two.md',
          lines((i) => `P${i}.`),
          lines((i) => (i === 1 || i === 9 ? `Mine ${i}.` : `P${i}.`)),
          lines((i) => (i === 1 || i === 9 ? `Theirs ${i}.` : `P${i}.`))
        )
      ])
    )
    const [first, second] = ch.merge.pages
    expect(ch.merge.disputes).toHaveLength(2)
    expect(stackOf(ch, first.id, 'local')).toEqual(ch.merge.disputes[0].local)
    expect(stackOf(ch, second.id, 'local')).toEqual(ch.merge.disputes[1].local)
  })

  it('gives every card a home page whose stacks it goes back to', () => {
    const ch = prose(arrange([FERRY]))
    const disputePage = ch.merge.pages.find((p) => p.dispute)!.id
    expect(stackOf(ch, disputePage, 'local')).toEqual(ch.merge.disputes[0].local)
    expect(stackOf(ch, disputePage, 'incoming')).toEqual(ch.merge.disputes[0].incoming)
    for (const id of Object.keys(ch.cards)) expect(ch.home[id]).toBeTruthy()
  })

  it('keeps a chapter as the writer arranged it when it comes back unchanged, and starts a changed one again', () => {
    let arr = arrange([FERRY])
    arr = intoGap(arr, 0, prose(arr).merge.pages[0].id, 'local')
    const again = arrange([FERRY], arr)
    expect(again[0]).toBe(arr[0])
    const typed = arrange([{ ...FERRY, localBody: body('One.', 'Typed since.', 'Three.') }], arr)
    expect(typed[0]).not.toBe(arr[0])
  })
})

describe('pages', () => {
  it('numbers each chapter’s pages, and gives a choice one page', () => {
    const far = doc(
      'documents/far.md',
      bodyOf(Array.from({ length: 12 }, (_, i) => `P${i}.`)),
      bodyOf(Array.from({ length: 12 }, (_, i) => (i === 1 ? 'Mine.' : `P${i}.`))),
      bodyOf(
        Array.from({ length: 12 }, (_, i) =>
          i === 1 ? 'Theirs.' : i === 10 ? 'Only theirs.' : `P${i}.`
        )
      )
    )
    const pages = pagesOf(
      arrange([far, { ...doc('documents/gone.md', 'A.\n', 'B.\n', 'C.\n'), localBody: null }])
    )
    expect(pages.map((p) => [p.chapter, p.page?.kind ?? 'choice', p.n, p.of])).toEqual([
      [0, 'dispute', 1, 2],
      [0, 'review', 2, 2],
      [1, 'choice', 1, 1]
    ])
  })
})

describe('moves', () => {
  it('puts a stack into the gap, in order, after anything already put there', () => {
    let arr = arrange([FERRY])
    const page = prose(arr).merge.pages[0].id
    arr = intoGap(arr, 0, page, 'incoming')
    arr = intoGap(arr, 0, page, 'local')
    const ch = prose(arr)
    const gap = ch.items.findIndex((i) => i.kind === 'gap')
    expect(ch.items.slice(gap + 1, gap + 3).map((i) => i.id)).toEqual([
      ...ch.merge.disputes[0].incoming,
      ...ch.merge.disputes[0].local
    ])
    expect(stackOf(ch, page, 'local')).toEqual([])
    expect(gapIndex(ch, 'd0')).toBe(gap + 3)
  })

  it('moves a card between the page, its stack, the bin and the pad, one place at a time', () => {
    let arr = arrange([FERRY])
    const id = prose(arr).merge.disputes[0].local[0]
    arr = placeOn(arr, 0, 0, [id])
    expect(prose(arr).items[0]).toEqual({ kind: 'card', id })
    expect(prose(arr).off[id]).toBeUndefined()
    arr = takeOff(arr, 0, id, 'bin')
    expect(prose(arr).items.some((i) => i.id === id)).toBe(false)
    expect(tray(arr, 'bin')).toEqual([{ chapter: 0, id }])
    arr = takeOff(arr, 0, id, 'pad')
    expect(tray(arr, 'bin')).toEqual([])
    expect(tray(arr, 'pad')).toEqual([{ chapter: 0, id }])
    arr = takeOff(arr, 0, id, 'stack')
    expect(tray(arr, 'pad')).toEqual([])
  })

  it('brings back what a one-sided change replaced when its card comes off, and nothing more', () => {
    let arr = arrange([FERRY])
    const only = Object.values(prose(arr).cards).find((c) => c.only)!
    arr = takeOff(arr, 0, only.id, 'bin')
    const texts = prose(arr).items.flatMap((i) => (i.kind === 'text' ? [i.markdown] : []))
    expect(texts).toContain('Four was here.')
    arr = placeOn(arr, 0, 0, [only.id])
    arr = takeOff(arr, 0, only.id, 'stack')
    const again = prose(arr).items.filter(
      (i) => i.kind === 'text' && i.markdown === 'Four was here.'
    )
    expect(again).toHaveLength(1)
  })

  it('puts a paragraph only one side deleted back', () => {
    let arr = arrange([
      doc('documents/d.md', body('A.', 'B.', 'C.'), body('A.', 'B.', 'C.'), body('A.', 'C.'))
    ])
    const removed = prose(arr).items.find((i) => i.kind === 'removed')!
    arr = putBack(arr, 0, removed.id)
    expect(answerOf(arr, 'now', () => 'x').choices[0]).toMatchObject({
      body: body('A.', 'B.', 'C.')
    })
  })

  it('changes nothing for a card or chapter that is not there', () => {
    const arr = arrange([FERRY])
    expect(placeOn(arr, 0, 0, ['nope'])).toBe(arr)
    expect(takeOff(arr, 0, 'nope', 'bin')).toBe(arr)
    expect(placeOn(arr, 5, 0, ['x'])).toBe(arr)
  })
})

describe('the answer', () => {
  it('is each chapter as arranged, and each choice', () => {
    let arr = arrange([
      FERRY,
      { ...doc('documents/gone.md', 'A.\n', 'B.\n', 'C.\n'), remoteBody: null }
    ])
    arr = intoGap(arr, 0, prose(arr).merge.pages[0].id, 'local')
    expect(unchosen(arr)).toBe(1)
    arr = choose(arr, 1, 'theirs')
    expect(unchosen(arr)).toBeNull()
    const { choices } = answerOf(arr, 'now', () => 'x')
    expect(choices).toEqual([
      {
        path: 'documents/ferry.md',
        resolution: 'arranged',
        body: body('One.', 'Two, as I had it.', 'Three.', 'Four, as they had it.', 'Five.')
      },
      { path: 'documents/gone.md', resolution: 'theirs' }
    ])
  })

  it('keeps every card put on the pad, and every card left on a stack, as scraps that say where they came from', () => {
    let arr = arrange([FERRY])
    const [mine] = prose(arr).merge.disputes[0].local
    const [theirs] = prose(arr).merge.disputes[0].incoming
    arr = takeOff(arr, 0, mine, 'pad')
    expect(leftovers(arr)).toEqual([{ chapter: 0, id: theirs }])
    let n = 0
    const { scraps } = answerOf(arr, '2026-10-29T10:00:00.000Z', () => `s${n++}`)
    expect(scraps).toEqual([
      {
        id: 's0',
        body: 'Two, as I had it.',
        created: '2026-10-29T10:00:00.000Z',
        modified: '2026-10-29T10:00:00.000Z',
        how: 'local',
        fromDoc: 'ferry',
        fromTitle: 'The Ferry'
      },
      expect.objectContaining({ id: 's1', body: 'Two, as they had it.', how: 'incoming' })
    ])
  })

  it('never keeps the bin, nor a Both edits card left where it was', () => {
    let arr = arrange([
      doc(
        'documents/b.md',
        body('She watched the ligths fade. Then she slept.'),
        body('She watched the lights fade. Then she slept.'),
        body('She watched the ligths fade. Then she wept.')
      )
    ])
    const d = prose(arr).merge.disputes[0]
    expect(d.both).not.toBeNull()
    arr = takeOff(arr, 0, d.local[0], 'bin')
    arr = takeOff(arr, 0, d.incoming[0], 'bin')
    const { scraps, choices } = answerOf(arr, 'now', () => 'x')
    expect(scraps).toEqual([])
    // Nothing placed: the passage is left out (both versions are in the history).
    expect(choices[0]).toMatchObject({ body: '' })
  })

  it('keeps a Both edits card put on the pad, as both edits combined', () => {
    let arr = arrange([
      doc(
        'documents/b.md',
        body('She watched the ligths fade. Then she slept.'),
        body('She watched the lights fade. Then she slept.'),
        body('She watched the ligths fade. Then she wept.')
      )
    ])
    arr = takeOff(arr, 0, prose(arr).merge.disputes[0].both!, 'pad')
    expect(answerOf(arr, 'now', () => 'x').scraps.find((s) => s.how === 'both')).toBeTruthy()
  })
})

describe('the drop cursor', () => {
  const rects = [
    { top: 0, bottom: 20 },
    { top: 30, bottom: 50 },
    { top: 60, bottom: 80 }
  ]

  it('lands on the boundary nearest the pointer: before, between or after', () => {
    expect(dropIndex(rects, -5)).toBe(0)
    expect(dropIndex(rects, 24)).toBe(1)
    expect(dropIndex(rects, 56)).toBe(2)
    expect(dropIndex(rects, 200)).toBe(3)
    expect(dropIndex([], 10)).toBe(0)
  })
})

describe('when each side was written', () => {
  const now = new Date(2026, 9, 29, 15, 0).getTime()

  it('says today, yesterday or the date', () => {
    expect(whenWritten(new Date(2026, 9, 29, 14, 14).getTime(), now)).toMatch(/^today /)
    expect(whenWritten(new Date(2026, 9, 28, 21, 40).getTime(), now)).toMatch(/^yesterday /)
    expect(whenWritten(new Date(2026, 9, 20, 9, 0).getTime(), now)).toMatch(/20/)
    expect(whenWritten(null, now)).toBe('')
  })
})

describe('remembered while the app is open', () => {
  it('keeps an arrangement per project until it is forgotten', () => {
    const arr = arrange([FERRY])
    remember('/novel', arr)
    expect(recall('/novel')).toBe(arr)
    forget('/novel')
    expect(recall('/novel')).toBeUndefined()
  })
})
