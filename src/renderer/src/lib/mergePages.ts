import { diffArrays, diffWordsWithSpace } from 'diff'
import type { JSONContent } from '@tiptap/core'
import { docToMarkdown, markdownToDoc } from './markdown'

/**
 * F-51 step 2: how a chapter changed on two computers is laid out for the
 * writer to put back together — pure and DOM-free, so all of it is tested
 * without a screen.
 *
 * The unit is the **paragraph with words in it**: the merge already compares
 * by line, a stored paragraph is one line (hard breaks aside), and writers
 * think in paragraphs. Blank lines (empty paragraphs) are not lined up as if
 * they were prose — a side that only added a blank line must not turn the
 * other side's change into a dispute — but they are not dropped either: each
 * paragraph carries the blank lines before it (`blanks`), they travel with
 * it, and a change to them is spacing, taken from whichever side made it.
 *
 * The three versions — before either computer changed it, this computer's,
 * the other one's — are lined up paragraph by paragraph (`threeWay`):
 *
 *  - what neither changed, or both changed alike, is fixed text on the page;
 *  - a change only one side made is already on the page, paragraph by
 *    paragraph (`pairUp`): an edited paragraph is a card that brings its own
 *    earlier text back if taken off, an added one is a card that brings
 *    nothing back, and a deleted one is a struck "removed there" line that
 *    can be put back;
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

/** A paragraph with words in it, and the blank lines before it. */
export interface Para {
  markdown: string
  blanks: number
}

/** A stretch of a card's text, styled as the page styles it, and whether
 *  this side changed it (drawn underlined). A hard break is a run of its
 *  own. */
export interface CardRun {
  text: string
  bold?: true
  italic?: true
  highlight?: true
  /** Words (or a hard break) this side changed or added. */
  changed?: true
  /** A hard line break (`text` is "\n"). */
  break?: true
}

export interface MergeCard {
  id: string
  side: MergeSide | 'both'
  /** One paragraph, stored Markdown. */
  markdown: string
  /** Blank lines before it, which travel with it. */
  blanks: number
  runs: CardRun[]
  /** Nothing like it was there before: tagged New rather than underlined. */
  isNew: boolean
  /** The same words as the paragraph it replaced, styled differently. */
  restyled: boolean
  /** Words the paragraph it replaced had, taken out. */
  cut: boolean
  /** A change only this side made, placed on the page from the start. */
  only?: true
  /** What comes back to the page when this card is taken off: the paragraph
   *  it replaced, as the other side has it. Used once. */
  restore?: Para[]
}

export type MergeItem =
  /** A paragraph both computers agree on. Never moves. */
  | { kind: 'text'; id: string; markdown: string; blanks: number }
  /** A card on the page. */
  | { kind: 'card'; id: string }
  /** Where a disputed passage was. Never moves; never part of the text. */
  | { kind: 'gap'; id: string; dispute: string; before: string[] }
  /** A paragraph only one side deleted: gone from the text unless put back. */
  | { kind: 'removed'; id: string; side: MergeSide; before: Para[] }

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

/** A blank line as markdown-it reads one: spaces and tabs only. A line of
 *  non-breaking spaces is a paragraph, and the editor keeps it as one. */
const BLANK = /^[ \t]*$/

/**
 * A stored body as its paragraphs, in the stored Markdown, an empty one as
 * "". The inverse of `bodyOf` for every body `docToMarkdown` writes: one
 * blank line separates paragraphs, and each blank line beyond it is an
 * empty paragraph; a hard break stays inside its paragraph. Windows line
 * endings read as the editor reads them.
 */
export function paragraphsOf(body: string): string[] {
  const paragraphs: string[] = []
  let current: string[] = []
  let blanks = 0
  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (BLANK.test(line)) {
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

/** A body's paragraphs with words in them, each with the blank lines before it. */
export function parasOf(body: string): Para[] {
  const paras: Para[] = []
  let blanks = 0
  for (const p of paragraphsOf(body)) {
    if (p === '') blanks++
    else {
      paras.push({ markdown: p, blanks })
      blanks = 0
    }
  }
  return paras
}

/** Paragraphs with their blank lines back into a stored body. */
export function bodyOfParas(paras: Para[]): string {
  return bodyOf(paras.flatMap((p) => [...Array<string>(p.blanks).fill(''), p.markdown]))
}

/* ---------- lining up three versions ---------- */

/** Where a region starts in each version. */
export interface Starts {
  before: number
  local: number
  incoming: number
}

export type Region =
  /** Neither side changed it. */
  | { kind: 'same'; lines: string[]; at: Starts }
  /** Only one side changed it. */
  | { kind: 'one'; side: MergeSide; before: string[]; after: string[]; at: Starts }
  /** Both sides made the same change. */
  | { kind: 'agreed'; before: string[]; after: string[]; at: Starts }
  /** Both sides changed it, differently. */
  | { kind: 'conflict'; before: string[]; local: string[]; incoming: string[]; at: Starts }

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

/** A hunk that adds more than it takes away, so may add at either edge. */
const grows = (h: Hunk): boolean => h.lines.length > h.end - h.start

/**
 * Three versions lined up: what neither changed, what one changed, what both
 * changed alike, and what both changed differently. Two changes belong to
 * one passage when they overlap, or start at the same place, or meet end to
 * start with both adding there: two additions at one place have no order of
 * their own, and taking both would double whatever both added. Changes that
 * meet without both adding there (an edit beside an edit, a deletion beside
 * anything) are separate: their order is plain.
 */
export function threeWay(before: string[], local: string[], incoming: string[]): Region[] {
  const hunks = [...hunksOf(before, local, 'local'), ...hunksOf(before, incoming, 'incoming')].sort(
    (x, y) => x.start - y.start || x.end - y.end
  )
  const regions: Region[] = []
  const at: Starts = { before: 0, local: 0, incoming: 0 }
  const same = (lines: string[]): void => {
    if (lines.length === 0) return
    regions.push({ kind: 'same', lines, at: { ...at } })
    at.before += lines.length
    at.local += lines.length
    at.incoming += lines.length
  }
  let i = 0
  while (i < hunks.length) {
    const group = [hunks[i]]
    const start = hunks[i].start
    let end = hunks[i].end
    i++
    while (i < hunks.length) {
      const h = hunks[i]
      const meets = h.start === end && grows(h) && group.some((g) => g.end === end && grows(g))
      if (!(h.start < end || h.start === start || meets)) break
      group.push(h)
      end = Math.max(end, h.end)
      i++
    }
    same(before.slice(at.before, start))
    const was = before.slice(start, end)
    const ours = group.filter((h) => h.side === 'local')
    const theirs = group.filter((h) => h.side === 'incoming')
    const l = applied(before, start, end, ours)
    const r = applied(before, start, end, theirs)
    const here = { ...at }
    if (ours.length > 0 && theirs.length > 0) {
      regions.push(
        sameLines(l, r)
          ? { kind: 'agreed', before: was, after: l, at: here }
          : { kind: 'conflict', before: was, local: l, incoming: r, at: here }
      )
    } else {
      const side: MergeSide = ours.length > 0 ? 'local' : 'incoming'
      regions.push({ kind: 'one', side, before: was, after: side === 'local' ? l : r, at: here })
    }
    at.before = end
    at.local += l.length
    at.incoming += r.length
  }
  same(before.slice(at.before))
  return regions
}

/* ---------- pairing paragraphs ---------- */

const wordsOf = (markdown: string): string[] =>
  plainOf(markdown)
    .toLowerCase()
    .match(/[\p{L}\p{N}’']+/gu) ?? []

/** How alike two paragraphs' words are, 0 to 1 (Dice, over word sets). */
function likeness(a: string, b: string): number {
  if (a === b) return 1
  const wa = new Set(wordsOf(a))
  const wb = new Set(wordsOf(b))
  if (wa.size === 0 || wb.size === 0) return 0
  let common = 0
  for (const w of wa) if (wb.has(w)) common++
  return (2 * common) / (wa.size + wb.size)
}

/** Alike enough to be the same paragraph, edited. */
const ALIKE = 0.5

export type PairOp =
  | { kind: 'edit'; before: number; after: number }
  | { kind: 'insert'; after: number }
  | { kind: 'delete'; before: number }

/**
 * A changed passage paragraph by paragraph: which new paragraph is an edit of
 * which old one (in order, the most alike overall), which is new, and which
 * old one is gone. So a card brings back exactly the paragraph it replaced,
 * and is underlined against that one, not against whatever came first.
 */
export function pairUp(before: string[], after: string[]): PairOp[] {
  const n = before.length
  const m = after.length
  // best[i][j]: the most likeness pairing before[i..] with after[j..] can have.
  const best = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  const like = before.map((b) => after.map((a) => likeness(b, a)))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const paired = like[i][j] >= ALIKE ? like[i][j] + best[i + 1][j + 1] : -1
      best[i][j] = Math.max(paired, best[i + 1][j], best[i][j + 1])
    }
  }
  const raw: PairOp[] = []
  let i = 0
  let j = 0
  while (i < n || j < m) {
    if (i < n && j < m && like[i][j] >= ALIKE && best[i][j] === like[i][j] + best[i + 1][j + 1]) {
      raw.push({ kind: 'edit', before: i++, after: j++ })
    } else if (i < n && (j === m || best[i][j] === best[i + 1][j])) {
      raw.push({ kind: 'delete', before: i++ })
    } else {
      raw.push({ kind: 'insert', after: j++ })
    }
  }
  // Between two alike pairs, old paragraphs gone and new ones come in the
  // same place are rewrites, paired in order, as a diff's replace would be:
  // a paragraph rewritten past recognition is still the one it replaced,
  // and taking its card off should bring that one back.
  const ops: PairOp[] = []
  let k = 0
  while (k < raw.length) {
    if (raw[k].kind === 'edit') {
      ops.push(raw[k++])
      continue
    }
    const gone: number[] = []
    const come: number[] = []
    while (k < raw.length && raw[k].kind !== 'edit') {
      const op = raw[k++]
      if (op.kind === 'delete') gone.push(op.before)
      else if (op.kind === 'insert') come.push(op.after)
    }
    const pairs = Math.min(gone.length, come.length)
    for (let p = 0; p < pairs; p++) ops.push({ kind: 'edit', before: gone[p], after: come[p] })
    for (const after of come.slice(pairs)) ops.push({ kind: 'insert', after })
    for (const before of gone.slice(pairs)) ops.push({ kind: 'delete', before })
  }
  return ops
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

/**
 * A card for `para`, compared with the paragraph it replaced (`was`), or
 * with nothing when it is new. The added words are underlined — the words,
 * not the spaces at their edges — and so is a hard break that took the
 * place of a space; words the old paragraph had and this one lacks make it
 * `cut`.
 */
function makeCard(id: string, side: MergeCard['side'], para: Para, was: string | null): MergeCard {
  const styled = styledRuns(para.markdown)
  if (was == null) {
    return {
      id,
      side,
      markdown: para.markdown,
      blanks: para.blanks,
      // Tagged New instead: underlining every word would say nothing more.
      runs: styled,
      isNew: true,
      restyled: false,
      cut: false
    }
  }
  const ranges: [number, number][] = []
  let cut = false
  let at = 0
  for (const part of diffWordsWithSpace(plainOf(was), plainOf(para.markdown))) {
    if (part.removed) {
      if (part.value.trim() !== '') cut = true
      continue
    }
    if (part.added) {
      const lead = part.value.length - part.value.trimStart().length
      const trail = part.value.length - part.value.trimEnd().length
      if (lead + trail < part.value.length) {
        ranges.push([at + lead, at + part.value.length - trail])
      } else {
        // Whitespace only: a hard break counts, a space does not.
        for (let k = 0; k < part.value.length; k++) {
          if (part.value[k] === '\n') ranges.push([at + k, at + k + 1])
        }
      }
    }
    at += part.value.length
  }
  return {
    id,
    side,
    markdown: para.markdown,
    blanks: para.blanks,
    runs: markRuns(styled, ranges),
    isNew: false,
    restyled: ranges.length === 0 && !cut && para.markdown !== was,
    cut
  }
}

/** Cards for one side's paragraphs of a passage, each compared with the old
 *  paragraph it pairs with. */
function cardsFor(
  ids: (k: number) => string,
  side: MergeSide,
  before: string[],
  paras: Para[]
): MergeCard[] {
  const was = new Map<number, string>()
  for (const op of pairUp(
    before,
    paras.map((p) => p.markdown)
  )) {
    if (op.kind === 'edit') was.set(op.after, before[op.before])
  }
  return paras.map((p, k) => makeCard(ids(k), side, p, was.get(k) ?? null))
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

export function layoutChapter(v: ChapterVersions): ChapterMerge {
  const B = parasOf(v.before)
  const L = parasOf(v.local)
  const I = parasOf(v.incoming)
  const sides = { local: L, incoming: I }
  const items: MergeItem[] = []
  const cards: Record<string, MergeCard> = {}
  const disputes: Dispute[] = []
  /** Item indexes of changes only one side made, for review pages. */
  const spots: number[] = []
  let text = 0
  let change = 0

  const pushText = (para: Para): void => {
    items.push({ kind: 'text', id: `t${text++}`, markdown: para.markdown, blanks: para.blanks })
  }
  const keep = (card: MergeCard): void => {
    cards[card.id] = card
  }

  for (const region of threeWay(
    B.map((p) => p.markdown),
    L.map((p) => p.markdown),
    I.map((p) => p.markdown)
  )) {
    const { at } = region
    if (region.kind === 'same') {
      region.lines.forEach((markdown, j) => {
        // Spacing is merged too: this computer's where it changed it, else
        // the other one's (which is before's where neither did).
        const was = B[at.before + j].blanks
        const ours = L[at.local + j].blanks
        pushText({ markdown, blanks: ours !== was ? ours : I[at.incoming + j].blanks })
      })
    } else if (region.kind === 'agreed') {
      region.after.forEach((_, j) => pushText(L[at.local + j]))
    } else if (region.kind === 'one') {
      const side = region.side
      const other: MergeSide = side === 'local' ? 'incoming' : 'local'
      const after = sides[side].slice(at[side], at[side] + region.after.length)
      // The passage as the other side still has it: before's words, its spacing.
      const kept = sides[other].slice(at[other], at[other] + region.before.length)
      for (const op of pairUp(
        region.before,
        after.map((p) => p.markdown)
      )) {
        const id = `c${change++}`
        spots.push(items.length)
        if (op.kind === 'delete') {
          items.push({ kind: 'removed', id, side, before: [kept[op.before]] })
          continue
        }
        const was = op.kind === 'edit' ? region.before[op.before] : null
        // An edited paragraph's spacing merges like any other: this side's
        // where it changed it, else the other side's.
        const para =
          op.kind === 'edit' && after[op.after].blanks === B[at.before + op.before].blanks
            ? { ...after[op.after], blanks: kept[op.before].blanks }
            : after[op.after]
        keep({
          ...makeCard(id, side, para, was),
          only: true,
          restore: op.kind === 'edit' ? [kept[op.before]] : []
        })
        items.push({ kind: 'card', id })
      }
    } else {
      const d = `d${disputes.length}`
      const local = L.slice(at.local, at.local + region.local.length)
      const incoming = I.slice(at.incoming, at.incoming + region.incoming.length)
      cardsFor((k) => `${d}.l${k}`, 'local', region.before, local).forEach(keep)
      cardsFor((k) => `${d}.i${k}`, 'incoming', region.before, incoming).forEach(keep)
      let both: string | null = null
      if (region.before.length === 1 && local.length === 1 && incoming.length === 1) {
        const merged = bothEdits(region.before[0], local[0].markdown, incoming[0].markdown)
        if (merged != null) {
          both = `${d}.both`
          keep(
            makeCard(both, 'both', { markdown: merged, blanks: local[0].blanks }, region.before[0])
          )
        }
      }
      disputes.push({
        id: d,
        gap: `${d}.gap`,
        before: region.before,
        local: local.map((_, k) => `${d}.l${k}`),
        incoming: incoming.map((_, k) => `${d}.i${k}`),
        both,
        deleted:
          region.before.length === 0
            ? null
            : local.length === 0
              ? 'local'
              : incoming.length === 0
                ? 'incoming'
                : null
      })
      items.push({ kind: 'gap', id: `${d}.gap`, dispute: d, before: region.before })
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
    if (items[from].kind === 'text') seen++
  }
  while (from > 0 && !fixed(items[from - 1])) from--
  let to = index
  seen = 0
  while (to < items.length - 1 && items[to + 1].kind !== 'gap' && seen < CONTEXT) {
    to++
    if (items[to].kind === 'text') seen++
  }
  while (to < items.length - 1 && !fixed(items[to + 1])) to++
  return [from, to]
}

function pagesFor(items: MergeItem[], disputes: Dispute[], spots: number[]): MergePage[] {
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
    if (windows.some((w) => spot >= w.from && spot <= w.to)) continue
    const [from, to] = windowAround(items, spot)
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
 * not copied; `index` counts the page as the writer saw it, with the card
 * still where it was.
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
 * A card off the page. If it replaced a paragraph (a change only one side
 * made), that paragraph comes back where the card was — once: the card no
 * longer carries it.
 */
export function liftCard(
  items: MergeItem[],
  cards: Record<string, MergeCard>,
  cardId: string
): { items: MergeItem[]; cards: Record<string, MergeCard> } {
  const at = items.findIndex((i) => i.kind === 'card' && i.id === cardId)
  if (at === -1) return { items, cards }
  const card = cards[cardId]
  const back: MergeItem[] = (card?.restore ?? []).map((para, k) => ({
    kind: 'text',
    id: `${cardId}.back${k}`,
    markdown: para.markdown,
    blanks: para.blanks
  }))
  const next = [...items.slice(0, at), ...back, ...items.slice(at + 1)]
  if (!card?.restore) return { items: next, cards }
  const rest = { ...card }
  delete rest.restore
  return { items: next, cards: { ...cards, [cardId]: rest } }
}

/** A paragraph one side deleted, put back as text where it was. */
export function restoreRemoved(items: MergeItem[], removedId: string): MergeItem[] {
  const at = items.findIndex((i) => i.kind === 'removed' && i.id === removedId)
  if (at === -1) return items
  const removed = items[at] as Extract<MergeItem, { kind: 'removed' }>
  const back: MergeItem[] = removed.before.map((para, k) => ({
    kind: 'text',
    id: `${removedId}.back${k}`,
    markdown: para.markdown,
    blanks: para.blanks
  }))
  return [...items.slice(0, at), ...back, ...items.slice(at + 1)]
}

/** The chapter's stored text, as arranged: text and placed cards in order,
 *  each with the blank lines before it; gaps and removed paragraphs are not
 *  part of it. */
export function composeChapter(items: MergeItem[], cards: Record<string, MergeCard>): string {
  const paras: Para[] = []
  for (const item of items) {
    if (item.kind === 'text') paras.push(item)
    else if (item.kind === 'card' && cards[item.id]) paras.push(cards[item.id])
  }
  return bodyOfParas(paras)
}
