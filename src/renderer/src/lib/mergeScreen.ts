import type {
  ConflictChoice,
  ConflictResolution,
  Scrap,
  ScrapHow,
  SyncConflict
} from '../../../shared/types'
import {
  composeChapter,
  layoutChapter,
  liftCard,
  pageItems,
  placeCards,
  restoreRemoved,
  type ChapterMerge,
  type MergeCard,
  type MergeItem,
  type MergePage,
  type MergeSide
} from './mergePages'

/**
 * F-51 step 4: the merge screen's state — what the writer has arranged, and
 * the moves that change it — kept pure so every rule is tested without a
 * screen. `components/MergeScreen.tsx` draws it and turns drags into moves.
 *
 * A conflicted file is a chapter of the arrangement. Prose both computers
 * still have (a document, story-bible entry or scrap) is laid out by
 * `layoutChapter` and arranged with cards; anything else — a chapter one side
 * deleted, the binder, an image — is a keep-this-or-that choice.
 *
 * A card is either on the page (in the chapter's items) or off it: on its
 * stack, in the bin, or on the scratch pad (`off`). Every card has a home
 * page (`home`), whose stacks it sits on when it is off the page: a
 * dispute's cards the dispute's page, a change only one side made the first
 * page that shows it.
 */

export type CardPlace = 'stack' | 'bin' | 'pad'

export interface ProseChapter {
  kind: 'prose'
  path: string
  title: string
  /** The three versions it was laid out from, so a fresh list that has not
   *  changed this chapter keeps what the writer arranged. */
  key: string
  merge: ChapterMerge
  items: MergeItem[]
  cards: Record<string, MergeCard>
  /** Where each card that is not on the page is. */
  off: Record<string, CardPlace>
  /** The page each card's stack is on. */
  home: Record<string, string>
}

export interface ChoiceChapter {
  kind: 'choice'
  path: string
  title: string
  key: string
  choice: ConflictResolution | null
  /** Whether "keep both" is on offer: a document both sides still have. */
  both: boolean
}

export type Chapter = ProseChapter | ChoiceChapter
export type Arrangement = Chapter[]

/** One page of the screen: a page of a prose chapter, or a chapter's choice. */
export interface ScreenPage {
  chapter: number
  /** Null for a choice. */
  page: MergePage | null
  /** Its place among its chapter's pages, from 1. */
  n: number
  of: number
}

/** What the engine puts in place of a file that is not text. */
const NOT_TEXT = '(not text — an image or other file)'

/** Whether a conflict is prose the writer can arrange with cards. */
export function canArrange(c: SyncConflict): boolean {
  return (
    (c.kind === 'doc' || c.kind === 'entity' || c.kind === 'scrap') &&
    c.localBody != null &&
    c.remoteBody != null &&
    c.localBody !== NOT_TEXT &&
    c.remoteBody !== NOT_TEXT
  )
}

const keyOf = (c: SyncConflict): string =>
  JSON.stringify([c.kind, c.baseBody, c.localBody, c.remoteBody])

function proseChapter(c: SyncConflict): ProseChapter {
  const merge = layoutChapter({
    path: c.path,
    title: c.title,
    before: c.baseBody ?? '',
    local: c.localBody!,
    incoming: c.remoteBody!
  })
  const off: Record<string, CardPlace> = {}
  const home: Record<string, string> = {}
  for (const d of merge.disputes) {
    const page = merge.pages.find((p) => p.dispute === d.id)!
    for (const id of [...d.local, ...d.incoming, ...(d.both ? [d.both] : [])]) {
      off[id] = 'stack'
      home[id] = page.id
    }
  }
  // A change only one side made is on the page already; its stack, should it
  // be taken off, is on the first page that shows it.
  for (const card of Object.values(merge.cards)) {
    if (!card.only) continue
    const page = merge.pages.find((p) =>
      pageItems(merge.items, p).shown.some((i) => i.kind === 'card' && i.id === card.id)
    )
    home[card.id] = (page ?? merge.pages[0])?.id ?? ''
  }
  return {
    kind: 'prose',
    path: c.path,
    title: c.title,
    key: keyOf(c),
    merge,
    items: merge.items,
    cards: merge.cards,
    off,
    home
  }
}

/**
 * The arrangement for a list of conflicts. A chapter `previous` already
 * arranged against the same three versions is kept as the writer left it —
 * after Later and Resolve…, or a fresh list after the versions moved — and
 * only a chapter that changed starts again.
 */
export function arrange(conflicts: SyncConflict[], previous: Arrangement = []): Arrangement {
  return conflicts.map((c) => {
    const kept = previous.find((p) => p.path === c.path && p.key === keyOf(c))
    if (kept) return kept
    if (canArrange(c)) return proseChapter(c)
    return {
      kind: 'choice',
      path: c.path,
      title: c.title,
      key: keyOf(c),
      choice: null,
      both: c.kind === 'doc' && c.localBody != null && c.remoteBody != null
    }
  })
}

/** Every page of the screen, in order. A prose chapter whose changes need
 *  no one's eye (blank lines only) has none. */
export function pagesOf(arr: Arrangement): ScreenPage[] {
  return arr.flatMap((ch, chapter): ScreenPage[] =>
    ch.kind === 'choice'
      ? [{ chapter, page: null, n: 1, of: 1 }]
      : ch.merge.pages.map((page, k) => ({ chapter, page, n: k + 1, of: ch.merge.pages.length }))
  )
}

/* ---------- moves ---------- */

function withChapter(
  arr: Arrangement,
  chapter: number,
  change: (ch: ProseChapter) => ProseChapter
): Arrangement {
  const ch = arr[chapter]
  if (!ch || ch.kind !== 'prose') return arr
  const next = change(ch)
  return next === ch ? arr : arr.map((c, i) => (i === chapter ? next : c))
}

const isOn = (ch: ProseChapter, id: string): boolean =>
  ch.items.some((i) => i.kind === 'card' && i.id === id)

/** Cards onto the page at `index` (an index into the chapter's items, as the
 *  writer saw them). Each comes off whatever stack, bin or pad it was on. */
export function placeOn(
  arr: Arrangement,
  chapter: number,
  index: number,
  ids: string[]
): Arrangement {
  return withChapter(arr, chapter, (ch) => {
    const known = ids.filter((id) => ch.cards[id])
    if (known.length === 0) return ch
    const off = { ...ch.off }
    for (const id of known) delete off[id]
    return { ...ch, items: placeCards(ch.items, index, known), off }
  })
}

/** A card off the page (or moved between stack, bin and pad). Taken off the
 *  page, a change only one side made puts back what it replaced, once. */
export function takeOff(arr: Arrangement, chapter: number, id: string, to: CardPlace): Arrangement {
  return withChapter(arr, chapter, (ch) => {
    if (!ch.cards[id] || (!isOn(ch, id) && ch.off[id] === to)) return ch
    const lifted = isOn(ch, id) ? liftCard(ch.items, ch.cards, id) : ch
    return { ...ch, items: lifted.items, cards: lifted.cards, off: { ...ch.off, [id]: to } }
  })
}

/** A paragraph one side deleted, put back on the page. */
export function putBack(arr: Arrangement, chapter: number, removedId: string): Arrangement {
  return withChapter(arr, chapter, (ch) => {
    const items = restoreRemoved(ch.items, removedId)
    return items === ch.items ? ch : { ...ch, items }
  })
}

/** Which version of a file that is not prose to keep. */
export function choose(
  arr: Arrangement,
  chapter: number,
  resolution: ConflictResolution
): Arrangement {
  const ch = arr[chapter]
  if (!ch || ch.kind !== 'choice' || ch.choice === resolution) return arr
  if (resolution === 'both' && !ch.both) return arr
  return arr.map((c, i) => (i === chapter ? { ...ch, choice: resolution } : c))
}

/** A side's stack on a page: its cards there that are off the page, in order. */
export function stackOf(ch: ProseChapter, pageId: string, side: MergeSide | 'both'): string[] {
  return Object.values(ch.cards)
    .filter((c) => c.side === side && ch.home[c.id] === pageId && ch.off[c.id] === 'stack')
    .map((c) => c.id)
}

/** Where on the page a stack dropped "into the gap" lands: just after the
 *  gap and after any cards already placed right after it. */
export function gapIndex(ch: ProseChapter, disputeId: string): number {
  const dispute = ch.merge.disputes.find((d) => d.id === disputeId)
  let at = dispute ? ch.items.findIndex((i) => i.id === dispute.gap) : -1
  if (at === -1) return ch.items.length
  at++
  while (at < ch.items.length && ch.items[at].kind === 'card') at++
  return at
}

/** A whole stack into its dispute's gap, in order. */
export function intoGap(
  arr: Arrangement,
  chapter: number,
  pageId: string,
  side: MergeSide | 'both'
): Arrangement {
  const ch = arr[chapter]
  if (!ch || ch.kind !== 'prose') return arr
  const page = ch.merge.pages.find((p) => p.id === pageId)
  if (!page?.dispute) return arr
  const ids = stackOf(ch, pageId, side)
  return ids.length === 0 ? arr : placeOn(arr, chapter, gapIndex(ch, page.dispute), ids)
}

/** The cards in the bin or on the pad, across every chapter. */
export function tray(arr: Arrangement, place: 'bin' | 'pad'): { chapter: number; id: string }[] {
  return arr.flatMap((ch, chapter) =>
    ch.kind === 'prose'
      ? Object.keys(ch.off)
          .filter((id) => ch.off[id] === place)
          .map((id) => ({ chapter, id }))
      : []
  )
}

/** Cards still on a stack, which Finish keeps on the scratch pad: nothing is
 *  lost by finishing early. A Both edits card is not one of them — it is the
 *  other two put together, and they are kept. */
export function leftovers(arr: Arrangement): { chapter: number; id: string }[] {
  return arr.flatMap((ch, chapter) =>
    ch.kind === 'prose'
      ? Object.keys(ch.off)
          .filter((id) => ch.off[id] === 'stack' && ch.cards[id].side !== 'both')
          .map((id) => ({ chapter, id }))
      : []
  )
}

/** The first chapter whose choice has not been made, if any. */
export function unchosen(arr: Arrangement): number | null {
  const at = arr.findIndex((ch) => ch.kind === 'choice' && ch.choice == null)
  return at === -1 ? null : at
}

/** The document id a conflicted path names, for a scrap's way back. */
function docIdOf(path: string): string | undefined {
  const m = /^documents\/([^/]+)\.md$/.exec(path)
  return m ? m[1] : undefined
}

/**
 * The writer's answer: each prose chapter's text as arranged, each other
 * file's choice, and the scraps — every card put on the pad, and every card
 * still on a stack. Every choice must be made first (`unchosen`).
 */
export function answerOf(
  arr: Arrangement,
  now: string,
  newId: () => string
): { choices: ConflictChoice[]; scraps: Scrap[] } {
  const choices: ConflictChoice[] = arr.map((ch) =>
    ch.kind === 'prose'
      ? { path: ch.path, resolution: 'arranged', body: composeChapter(ch.items, ch.cards) }
      : { path: ch.path, resolution: ch.choice ?? 'mine' }
  )
  const scraps: Scrap[] = [...tray(arr, 'pad'), ...leftovers(arr)].map(({ chapter, id }) => {
    const ch = arr[chapter] as ProseChapter
    const card = ch.cards[id]
    const fromDoc = docIdOf(ch.path)
    return {
      id: newId(),
      body: card.markdown,
      created: now,
      modified: now,
      how: card.side as ScrapHow,
      ...(fromDoc ? { fromDoc } : {}),
      fromTitle: ch.title
    }
  })
  return { choices, scraps }
}

/* ---------- the drop cursor ---------- */

/**
 * Where a card dropped at `y` lands among items drawn at `rects`: the
 * boundary nearest the pointer — before the first, between two, or after the
 * last — as an index from 0 to `rects.length`. Pure, because jsdom has no
 * layout to measure.
 */
export function dropIndex(rects: { top: number; bottom: number }[], y: number): number {
  if (rects.length === 0) return 0
  let best = 0
  let distance = Infinity
  for (let k = 0; k <= rects.length; k++) {
    const at =
      k === 0
        ? rects[0].top
        : k === rects.length
          ? rects[k - 1].bottom
          : (rects[k - 1].bottom + rects[k].top) / 2
    const d = Math.abs(y - at)
    if (d < distance) {
      best = k
      distance = d
    }
  }
  return best
}

/* ---------- when each side was written ---------- */

/**
 * "today 2:14 pm", "yesterday 9:40 pm", or "28 Oct, 2:14 pm": when a side
 * last changed the file, as the stack's label says it.
 */
export function whenWritten(ms: number | null, now: number = Date.now()): string {
  if (ms == null) return ''
  const at = new Date(ms)
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const day = (d: Date): string => d.toDateString()
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  if (day(at) === day(new Date(now))) return `today ${time}`
  if (day(at) === day(yesterday)) return `yesterday ${time}`
  return `${at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`
}

/* ---------- remembered while the app is open ---------- */

/**
 * What the writer had arranged, per project, kept while the app is open:
 * Later leaves the screen without losing it, and Resolve… brings it back for
 * every chapter that has not changed since. Never written anywhere.
 */
const remembered = new Map<string, Arrangement>()

export function remember(projectPath: string, arr: Arrangement): void {
  remembered.set(projectPath, arr)
}

export function recall(projectPath: string): Arrangement | undefined {
  return remembered.get(projectPath)
}

export function forget(projectPath: string): void {
  remembered.delete(projectPath)
}
