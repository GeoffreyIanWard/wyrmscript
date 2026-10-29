import { diffArrays, diffWords } from 'diff'
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown, markdownToDoc } from './markdown'

/**
 * F-51 step 2: how a chapter changed on two computers is laid out for the
 * writer to put back together — pure and DOM-free, so all of it is tested
 * without a screen.
 *
 * The unit is the **paragraph**: the merge already compares by line, a
 * stored paragraph is one line (hard breaks aside), and writers think in
 * paragraphs. The three versions — before either computer changed it, this
 * computer's, the other one's — are lined up paragraph by paragraph
 * (`threeWay`):
 *
 *  - what neither changed, or both changed alike, is fixed text on the page;
 *  - a change only one side made is already on the page as cards marked
 *    "only changed there", which can be taken off (and the text from before
 *    comes back), or, for a passage one side deleted, a struck "removed
 *    there" line that can be put back;
 *  - where both changed the same passage differently there is a **dispute**:
 *    a gap on the page where it was, a stack of cards for each side, and,
 *    when each side changed different words of one paragraph, a card with
 *    both edits.
 *
 * Every dispute is a page of its own, with a few paragraphs either side, and
 * any change only one side made that no dispute's page shows gets a page of
 * its own to be looked over: prose never merges unseen.
 *
 * The page is a list of items. Text, gaps and removed lines never move;
 * cards are placed and taken off between them; `composeChapter` turns the
 * list back into the chapter's stored text.
 */

export type MergeSide = 'local' | 'incoming'

/** A stretch of a card's text, styled as the page styles it, and whether
 *  its words changed from before (drawn underlined). A hard break is a run
 *  of its own. */
export interface CardRun {
  text: string
  bold?: true
  italic?: true
  highlight?: true
  /** Words this side changed or added. */
  changed?: true
  /** A hard line break (`text` is "\n"). */
  break?: true
}

export interface MergeCard {
  id: string
  side: MergeSide | 'both'
  /** One paragraph, stored Markdown. */
  markdown: string
  runs: CardRun[]
  /** None of its words were there before: tagged New rather than underlined. */
  isNew: boolean
  /** The same words as before, styled differently (bold, italic, highlight). */
  restyled: boolean
  /** A change only this side made, placed on the page from the start. */
  only?: true
  /** What comes back to the page when this card is taken off: the text the
   *  passage had before (the other side's, unchanged). Carried by the first
   *  card of a change, and used once. */
  restore?: string[]
}

export type MergeItem =
  /** A paragraph both computers agree on. Never moves. */
  | { kind: 'text'; id: string; markdown: string }
  /** A card on the page. */
  | { kind: 'card'; id: string }
  /** Where a disputed passage was. Never moves; never part of the text. */
  | { kind: 'gap'; id: string; dispute: string; before: string[] }
  /** A passage only one side deleted: gone from the text unless put back. */
  | { kind: 'removed'; id: string; side: MergeSide; before: string[] }

export interface Dispute {
  id: string
  /** The gap item marking its place. */
  gap: string
  /** The passage before either computer changed it. */
  before: string[]
  /** Card ids, in order. */
  local: string[]
  incoming: string[]
  /** Both edits combined, when each side changed different words. */
  both: string | null
  /** The side that deleted the passage outright. */
  deleted: MergeSide | null
}

/** A window onto the chapter: the items strictly between two that never
 *  move (or the chapter's ends), so cards placed on it stay on it. */
export interface MergePage {
  id: string
  /** A dispute to settle, or changes only one side made, to look over. */
  kind: 'dispute' | 'review'
  dispute?: string
  after: string | null
  before: string | null
}

export interface ChapterMerge {
  path: string
  title: string
  items: MergeItem[]
  cards: Record<string, MergeCard>
  disputes: Dispute[]
  pages: MergePage[]
}

/** Paragraphs of context either side of a change. */
export const CONTEXT = 2

/* ---------- paragraphs ---------- */

/**
 * A stored body as its paragraphs, in the stored Markdown, an empty one as
 * "". The inverse of `bodyOf` for every body `docToMarkdown` writes: one
 * blank line separates paragraphs, and each blank line beyond it is an
 * empty paragraph; a hard break stays inside its paragraph.
 */
export function paragraphsOf(body: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let blanks = 0
  for (const line of body.split('\n')) {
    if (line.trim() === '') {
      if (current.length > 0) {
        paragraphs.push(current.join('\n'))
        current = []
      }
      blanks++
      continue
    }
    if (current.length === 0 && paragraphs.length > 0) {
      for (let i = 1; i < blanks; i++) paragraphs.push('')
    }
    blanks = 0
    current.push(line)
  }
  if (current.length > 0) paragraphs.push(current.join('\n'))
  return paragraphs
}

/** Paragraphs back into a stored body, exactly as `docToMarkdown` writes one:
 *  empty paragraphs at either end dropped, each one between as one more
 *  newline, and a final newline. */
export function bodyOf(paragraphs: string[]): string {
  const texts: string[] = []
  const gaps: number[] = []
  let pending = 0
  for (const p of paragraphs) {
    if (p === '') {
      pending++
      continue
    }
    texts.push(p)
    gaps.push(pending)
    pending = 0
  }
  if (texts.length === 0) return ''
  let out = texts[0]
  for (let i = 1; i < texts.length; i++) out += '\n\n' + '\n'.repeat(gaps[i]) + texts[i]
  return out + '\n'
}

/* ---------- lining up three versions ---------- */

export type Region =
  /** Neither side changed it. */
  | { kind: 'same'; lines: string[] }
  /** Only one side changed it. */
  | { kind: 'one'; side: MergeSide; before: string[]; after: string[] }
  /** Both sides made the same change. */
  | { kind: 'agreed'; before: string[]; after: string[] }
  /** Both sides changed it, differently. */
  | { kind: 'conflict'; before: string[]; local: string[]; incoming: string[] }

interface Hunk {
  side: MergeSide
  /** The lines of `before` it replaces: [start, end). */
  start: number
  end: number
  lines: string[]
}

function hunksOf(before: string[], after: string[], side: MergeSide): Hunk[] {
  const hunks: Hunk[] = []
  let at = 0
  let open: Hunk | null = null
  for (const part of diffArrays(before, after)) {
    if (!part.added && !part.removed) {
      if (open) hunks.push(open)
      open = null
      at += part.value.length
      continue
    }
    open ??= { side, start: at, end: at, lines: [] }
    if (part.removed) {
      at += part.value.length
      open.end = at
    } else {
      open.lines.push(...part.value)
    }
  }
  if (open) hunks.push(open)
  return hunks
}

/** `before[start, end)` with one side's hunks in it applied. */
function applied(before: string[], start: number, end: number, hunks: Hunk[]): string[] {
  const out: string[] = []
  let at = start
  for (const h of hunks) {
    out.push(...before.slice(at, h.start), ...h.lines)
    at = h.end
  }
  out.push(...before.slice(at, end))
  return out
}

const sameLines = (a: string[], b: string[]): boolean =>
  a.length === b.length && a.every((line, i) => line === b[i])

/**
 * Three versions lined up: what neither changed, what one changed, what both
 * changed alike, and what both changed differently. Two changes belong to
 * one passage when they overlap, or start at the same place (two insertions
 * there have no order of their own); a change that only touches another,
 * end to start, is a separate one.
 */
export function threeWay(before: string[], local: string[], incoming: string[]): Region[] {
  const hunks = [...hunksOf(before, local, 'local'), ...hunksOf(before, incoming, 'incoming')].sort(
    (x, y) => x.start - y.start || x.end - y.end
  )
  const regions: Region[] = []
  let at = 0
  let i = 0
  while (i < hunks.length) {
    const group = [hunks[i]]
    const start = hunks[i].start
    let end = hunks[i].end
    i++
    while (i < hunks.length && (hunks[i].start < end || hunks[i].start === start)) {
      group.push(hunks[i])
      end = Math.max(end, hunks[i].end)
      i++
    }
    if (at < start) regions.push({ kind: 'same', lines: before.slice(at, start) })
    const was = before.slice(start, end)
    const ours = group.filter((h) => h.side === 'local')
    const theirs = group.filter((h) => h.side === 'incoming')
    const l = applied(before, start, end, ours)
    const r = applied(before, start, end, theirs)
    if (ours.length > 0 && theirs.length > 0) {
      regions.push(
        sameLines(l, r)
          ? { kind: 'agreed', before: was, after: l }
          : { kind: 'conflict', before: was, local: l, incoming: r }
      )
    } else {
      const side: MergeSide = ours.length > 0 ? 'local' : 'incoming'
      regions.push({ kind: 'one', side, before: was, after: side === 'local' ? l : r })
    }
    at = end
  }
  if (at < before.length) regions.push({ kind: 'same', lines: before.slice(at) })
  return regions
}

/* ---------- cards ---------- */

type Mark = 'bold' | 'italic' | 'highlight'

/** A paragraph's runs as the page draws it, before any change marks. */
function styledRuns(markdown: string): CardRun[] {
  const paragraph = markdownToDoc(markdown).content?.[0] as JSONContent | undefined
  const runs: CardRun[] = []
  for (const node of paragraph?.content ?? []) {
    if (node.type === 'hardBreak') {
      runs.push({ text: '\n', break: true })
      continue
    }
    const run: CardRun = { text: node.text ?? '' }
    for (const mark of node.marks ?? []) {
      if (mark.type === 'bold' || mark.type === 'italic' || mark.type === 'highlight') {
        run[mark.type as Mark] = true
      }
    }
    if (run.text) runs.push(run)
  }
  return runs
}

/** A paragraph's words as read, without its Markdown. */
export function plainOf(markdown: string): string {
  return styledRuns(markdown)
    .map((r) => r.text)
    .join('')
}

/** `runs` split wherever a changed range starts or ends, the changed ones
 *  flagged. Ranges are offsets into the runs' joined text. */
function markRuns(runs: CardRun[], changed: [number, number][]): CardRun[] {
  const out: CardRun[] = []
  let offset = 0
  for (const run of runs) {
    const end = offset + run.text.length
    const cuts = new Set([offset, end])
    for (const [a, b] of changed) {
      if (a > offset && a < end) cuts.add(a)
      if (b > offset && b < end) cuts.add(b)
    }
    const points = [...cuts].sort((x, y) => x - y)
    for (let k = 0; k < points.length - 1; k++) {
      const [from, to] = [points[k], points[k + 1]]
      const piece: CardRun = { ...run, text: run.text.slice(from - offset, to - offset) }
      if (changed.some(([a, b]) => a <= from && to <= b)) piece.changed = true
      out.push(piece)
    }
    offset = end
  }
  return out
}

/** Where each of `after`'s paragraphs changed words from `before`'s, as
 *  ranges into each paragraph's plain text. Diffed as one passage, so a
 *  sentence moved between paragraphs is not counted twice. */
function changedRanges(before: string[], after: string[]): [number, number][][] {
  const plains = after.map(plainOf)
  const SEP = '\n\n'
  const diffed = diffWords(before.map(plainOf).join(SEP), plains.join(SEP))
  const ranges: [number, number][] = []
  let at = 0
  for (const part of diffed) {
    if (part.removed) continue
    if (part.added) {
      // The words, not the spaces either side of them.
      const lead = part.value.length - part.value.trimStart().length
      const trail = part.value.length - part.value.trimEnd().length
      if (lead + trail < part.value.length) ranges.push([at + lead, at + part.value.length - trail])
    }
    at += part.value.length
  }
  let start = 0
  return plains.map((plain) => {
    const end = start + plain.length
    const own = ranges
      .filter(([a, b]) => a < end && b > start)
      .map(([a, b]): [number, number] => [Math.max(a, start) - start, Math.min(b, end) - start])
    start = end + SEP.length
    return own
  })
}

function makeCards(
  ids: string[],
  side: MergeCard['side'],
  before: string[],
  after: string[]
): MergeCard[] {
  const ranges = changedRanges(before, after)
  const was = new Set(before)
  return after.map((markdown, k) => {
    const runs = markRuns(styledRuns(markdown), ranges[k])
    const words = runs.filter((r) => r.text.trim() !== '')
    const isNew = words.length > 0 && words.every((r) => r.changed)
    const restyled = !isNew && !runs.some((r) => r.changed) && !was.has(markdown)
    return { id: ids[k], side, markdown, runs, isNew, restyled }
  })
}

/* ---------- both edits ---------- */

/** A paragraph's Markdown as words and the spaces between them. A word keeps
 *  its own Markdown (`**word**`), so formatting moves with it. */
function tokens(markdown: string): string[] {
  return markdown.split(/(\s+)/).filter((t) => t !== '')
}

/**
 * Both edits in one paragraph, when each side changed different words of it:
 * the same three-way line-up, word by word. Null when the changes touch the
 * same words, or the result is just one side's paragraph. Only ever offered
 * as a card: nothing is combined unless the writer places it.
 */
export function bothEdits(before: string, local: string, incoming: string): string | null {
  const regions = threeWay(tokens(before), tokens(local), tokens(incoming))
  if (regions.some((r) => r.kind === 'conflict')) return null
  const merged = regions
    .flatMap((r) => (r.kind === 'same' ? r.lines : r.kind === 'conflict' ? [] : r.after))
    .join('')
  if (merged === local || merged === incoming || merged.trim() === '') return null
  // A word's Markdown travels whole, but a run of bold over several words
  // does not, and two hard breaks can meet as a blank line: a combination
  // that does not read back as exactly itself, one paragraph, is not one to
  // offer.
  if (paragraphsOf(merged).length !== 1) return null
  return docToMarkdown(markdownToDoc(merged)) === merged + '\n' ? merged : null
}

/* ---------- laying out a chapter ---------- */

export interface ChapterVersions {
  path: string
  title: string
  /** Bodies as stored. A chapter deleted on one side is not laid out here:
   *  that is a keep-this-or-that choice, not a merge. */
  before: string
  local: string
  incoming: string
}

const filled = (paragraphs: string[]): string[] => paragraphs.filter((p) => p !== '')

/** Changes that are only one side's, for review pages: a card group's first
 *  card or a removed line, by item index. */
interface Spot {
  index: number
}

export function layoutChapter(v: ChapterVersions): ChapterMerge {
  const items: MergeItem[] = []
  const cards: Record<string, MergeCard> = {}
  const disputes: Dispute[] = []
  const spots: Spot[] = []
  let text = 0
  let change = 0

  const pushText = (paragraphs: string[]): void => {
    for (const markdown of paragraphs) items.push({ kind: 'text', id: `t${text++}`, markdown })
  }

  for (const region of threeWay(
    paragraphsOf(v.before),
    paragraphsOf(v.local),
    paragraphsOf(v.incoming)
  )) {
    if (region.kind === 'same') {
      pushText(region.lines)
    } else if (region.kind === 'agreed') {
      pushText(region.after)
    } else if (region.kind === 'one') {
      const c = `c${change++}`
      const after = filled(region.after)
      const before = filled(region.before)
      if (after.length === 0) {
        // A passage this side deleted, or only blank lines changed (which
        // are spacing, not prose, and need no one's eye).
        if (before.length > 0) {
          spots.push({ index: items.length })
          items.push({ kind: 'removed', id: `${c}.removed`, side: region.side, before })
        }
        pushText(region.after)
        continue
      }
      spots.push({ index: items.length })
      const made = makeCards(
        after.map((_, k) => `${c}.${k}`),
        region.side,
        before,
        after
      )
      made[0].restore = before
      let k = 0
      for (const markdown of region.after) {
        if (markdown === '') {
          pushText([''])
          continue
        }
        const card = { ...made[k++], only: true as const }
        cards[card.id] = card
        items.push({ kind: 'card', id: card.id })
      }
    } else {
      const d = `d${disputes.length}`
      const before = filled(region.before)
      const local = filled(region.local)
      const incoming = filled(region.incoming)
      if (local.length === 0 && incoming.length === 0) {
        // Both took the passage away, one leaving a blank line: nothing to choose.
        pushText(region.local)
        continue
      }
      for (const card of [
        ...makeCards(
          local.map((_, k) => `${d}.l${k}`),
          'local',
          before,
          local
        ),
        ...makeCards(
          incoming.map((_, k) => `${d}.i${k}`),
          'incoming',
          before,
          incoming
        )
      ]) {
        cards[card.id] = card
      }
      let both: string | null = null
      if (before.length === 1 && local.length === 1 && incoming.length === 1) {
        const merged = bothEdits(before[0], local[0], incoming[0])
        if (merged != null) {
          both = `${d}.both`
          cards[both] = makeCards([both], 'both', before, [merged])[0]
        }
      }
      disputes.push({
        id: d,
        gap: `${d}.gap`,
        before,
        local: local.map((_, k) => `${d}.l${k}`),
        incoming: incoming.map((_, k) => `${d}.i${k}`),
        both,
        deleted:
          before.length === 0
            ? null
            : local.length === 0
              ? 'local'
              : incoming.length === 0
                ? 'incoming'
                : null
      })
      items.push({ kind: 'gap', id: `${d}.gap`, dispute: d, before })
    }
  }

  return {
    path: v.path,
    title: v.title,
    items,
    cards,
    disputes,
    pages: pagesFor(items, disputes, spots)
  }
}

/** Whether an item stays where it is: a page's edges are only ever these. */
const fixed = (item: MergeItem): boolean => item.kind === 'text' || item.kind === 'gap'

/** A blank line kept as an empty paragraph: not context worth counting, and
 *  never where a page should end, between the cards of one change. */
const blank = (item: MergeItem): boolean => item.kind === 'text' && item.markdown === ''

/** What a page's edge widens past: anything that moves, and blank lines. */
const loose = (item: MergeItem): boolean => !fixed(item) || blank(item)

/**
 * The window around `index`: `CONTEXT` paragraphs either way, stopping at
 * another dispute's gap, and widened past anything movable so its edges are
 * items that never move. Inclusive item indexes.
 */
function windowAround(items: MergeItem[], index: number): [number, number] {
  let from = index
  let seen = 0
  while (from > 0 && items[from - 1].kind !== 'gap' && seen < CONTEXT) {
    from--
    if (items[from].kind === 'text' && !blank(items[from])) seen++
  }
  while (from > 0 && loose(items[from - 1])) from--
  let to = index
  seen = 0
  while (to < items.length - 1 && items[to + 1].kind !== 'gap' && seen < CONTEXT) {
    to++
    if (items[to].kind === 'text' && !blank(items[to])) seen++
  }
  while (to < items.length - 1 && loose(items[to + 1])) to++
  return [from, to]
}

function pagesFor(items: MergeItem[], disputes: Dispute[], spots: Spot[]): MergePage[] {
  const windows: { kind: MergePage['kind']; dispute?: string; from: number; to: number }[] = []
  for (const d of disputes) {
    const at = items.findIndex((item) => item.kind === 'gap' && item.dispute === d.id)
    const [from, to] = windowAround(items, at)
    windows.push({ kind: 'dispute', dispute: d.id, from, to })
  }
  // Changes only one side made that no dispute's page shows: pages of their
  // own, one for each run of them close enough to share one.
  const reviews: { from: number; to: number }[] = []
  for (const spot of spots) {
    if (windows.some((w) => spot.index > w.from - 1 && spot.index < w.to + 1)) continue
    if (spot.index >= items.length) continue
    const [from, to] = windowAround(items, spot.index)
    const last = reviews.at(-1)
    if (
      last &&
      from <= last.to + 1 &&
      !items.slice(last.to + 1, from).some((i) => i.kind === 'gap')
    ) {
      last.to = Math.max(last.to, to)
    } else {
      reviews.push({ from, to })
    }
  }
  for (const r of reviews) windows.push({ kind: 'review', ...r })
  windows.sort((a, b) => a.from - b.from)
  return windows.map((w, n) => ({
    id: `p${n}`,
    kind: w.kind,
    ...(w.dispute ? { dispute: w.dispute } : {}),
    after: w.from > 0 ? items[w.from - 1].id : null,
    before: w.to < items.length - 1 ? items[w.to + 1].id : null
  }))
}

/* ---------- arranging ---------- */

/** The items a page shows, and the index in `items` its first one has (where
 *  a card dropped at the top of the page goes). */
export function pageItems(
  items: MergeItem[],
  page: MergePage
): { start: number; shown: MergeItem[] } {
  const start = page.after == null ? 0 : items.findIndex((i) => i.id === page.after) + 1
  const end = page.before == null ? items.length : items.findIndex((i) => i.id === page.before)
  return { start, shown: items.slice(start, end) }
}

export function isPlaced(items: MergeItem[], cardId: string): boolean {
  return items.some((i) => i.kind === 'card' && i.id === cardId)
}

/**
 * Cards onto the page at `index`, between two items — never inside one, so
 * never inside another card's text. A card already on the page is moved,
 * not copied.
 */
export function placeCards(items: MergeItem[], index: number, cardIds: string[]): MergeItem[] {
  const moving = new Set(cardIds)
  let at = index
  const kept: MergeItem[] = []
  items.forEach((item, i) => {
    if (item.kind === 'card' && moving.has(item.id)) {
      if (i < index) at--
      return
    }
    kept.push(item)
  })
  const clamped = Math.max(0, Math.min(at, kept.length))
  return [
    ...kept.slice(0, clamped),
    ...cardIds.map((id) => ({ kind: 'card' as const, id })),
    ...kept.slice(clamped)
  ]
}

/**
 * A card off the page. If it carries the passage's earlier text (a change
 * only one side made), that text comes back where the card was — once: the
 * card no longer carries it.
 */
export function liftCard(
  items: MergeItem[],
  cards: Record<string, MergeCard>,
  cardId: string
): { items: MergeItem[]; cards: Record<string, MergeCard> } {
  const at = items.findIndex((i) => i.kind === 'card' && i.id === cardId)
  if (at === -1) return { items, cards }
  const card = cards[cardId]
  const back: MergeItem[] = (card?.restore ?? []).map((markdown, k) => ({
    kind: 'text',
    id: `${cardId}.back${k}`,
    markdown
  }))
  const next = [...items.slice(0, at), ...back, ...items.slice(at + 1)]
  if (!card?.restore) return { items: next, cards }
  const rest = { ...card }
  delete rest.restore
  return { items: next, cards: { ...cards, [cardId]: rest } }
}

/** A passage one side deleted, put back as text where it was. */
export function restoreRemoved(items: MergeItem[], removedId: string): MergeItem[] {
  const at = items.findIndex((i) => i.kind === 'removed' && i.id === removedId)
  if (at === -1) return items
  const removed = items[at] as Extract<MergeItem, { kind: 'removed' }>
  const back: MergeItem[] = removed.before.map((markdown, k) => ({
    kind: 'text',
    id: `${removedId}.back${k}`,
    markdown
  }))
  return [...items.slice(0, at), ...back, ...items.slice(at + 1)]
}

/** The chapter's stored text, as arranged: text and placed cards in order;
 *  gaps and removed passages are not part of it. */
export function composeChapter(items: MergeItem[], cards: Record<string, MergeCard>): string {
  const paragraphs: string[] = []
  for (const item of items) {
    if (item.kind === 'text') paragraphs.push(item.markdown)
    else if (item.kind === 'card' && cards[item.id]) paragraphs.push(cards[item.id].markdown)
  }
  return bodyOf(paragraphs)
}
