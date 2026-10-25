import type {
  BinderNode,
  BoardString,
  DocFile,
  DocStatus,
  Entity,
  MapSheet,
  Relationship,
  StringEnd
} from '../../../shared/types'
import { SCENE_TAG } from '../../../shared/types'
import { walk } from './tree'
import { folderPaths, plainTextOf } from './search'
import { locationChain } from './locations'
import { hasBack, outlineLine } from './cardBack'

/**
 * The corkboard: the story's pieces as index cards.
 *
 * Three kinds of card. **Scenes** are every scene-tagged document, in binder
 * order, exactly as the board has always shown them. **Characters** and
 * **locations** are story-bible entries that have been put on the board
 * deliberately (`entity.onBoard`) — the World Map's "Place on Map" model
 * rather than the scenes' automatic one, so a big cast does not flood the
 * board and a card can come off it without deleting the entry behind it
 * (F-45).
 *
 * Scenes are identified the same way everywhere else identifies them — the
 * `scene` tag, not a document type — so a writer who tags a note as a scene
 * sees it here, and one who untags it does not. Deciding that twice is how
 * views drift apart.
 */
export type CardKind = 'scene' | 'character' | 'location' | 'map'

export interface BoardCard {
  kind: CardKind
  id: string
  title: string
  status?: DocStatus
  /** Writer's own label, shown as-is. */
  label?: string
  /** Where it lives: a scene's folder path, or the book an entry is in. */
  folder: string
  wordCount: number
  /** The opening of the scene or entry, for one that has been written into. */
  excerpt: string
  /** No prose yet — an outlined scene, or an entry not started. */
  empty: boolean
  /** Stored board position, unset until the writer moves this card. */
  boardX?: number
  boardY?: number
  /** A character's or location's portrait, as the project-relative file (F-47). */
  portrait?: string
  /**
   * The folder a scene sits in ('' at the binder root). Apply Order reorders
   * scenes within their own folder and never across, so whether the board
   * differs from the book is a per-folder question — a Part Two scene placed
   * above Part One is not an order applying could give the book.
   */
  parentId?: string
  /**
   * F-42, from the back of the card: the synopsis, cut like an excerpt, and
   * the act and scene type as one line. An unwritten scene shows its
   * synopsis where the opening would be, so an outlined board reads as an
   * outline rather than a wall of "Not written yet."
   */
  synopsis?: string
  outline?: string
  /** Something is written on the back. */
  back?: boolean
}

/** The board's original card type; a scene is one kind of card now. */
export type SceneCard = BoardCard

/**
 * How much of the opening a card shows before it stops being a card.
 *
 * Cut back from 140 when the card type grew 25%: the card is a fixed size and
 * the face clips, so the choice is fewer words or a card that keeps part of a
 * sentence it never shows. Fewer words — the excerpt is there to remind a
 * writer which scene this is, not to be read.
 */
const EXCERPT_CHARS = 90

export function excerptOf(body: string): string {
  const text = plainTextOf(body).replace(/\s+/g, ' ').trim()
  if (text.length <= EXCERPT_CHARS) return text
  // Cut at a word boundary so a card never ends mid-word.
  const cut = text.slice(0, EXCERPT_CHARS)
  const lastSpace = cut.lastIndexOf(' ')
  return `${lastSpace > 40 ? cut.slice(0, lastSpace) : cut}…`
}

export function countWords(text: string): number {
  const trimmed = text.trim()
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length
}

/**
 * Every scene-tagged document, as cards, in binder order.
 *
 * Scenes are identified the same way everywhere else identifies them — the
 * `scene` tag, not a document type — so a writer who tags a note as a scene
 * sees it here, and one who untags it does not. Deciding that twice is how
 * views drift apart.
 */
/** A card's own size and the spacing of the tidy grid, in board pixels. */
export const CARD_W = 210
export const CARD_H = 200
export const CARD_GAP = 24

export interface PlacedCard extends SceneCard {
  x: number
  y: number
  /** Where the writer put it, rather than where binder order would put it. */
  placed: boolean
}

/** The slot a card occupies when nobody has moved it. */
export function gridSlot(index: number, columns: number): { x: number; y: number } {
  const cols = Math.max(1, columns)
  return {
    x: (index % cols) * (CARD_W + CARD_GAP),
    y: Math.floor(index / cols) * (CARD_H + CARD_GAP)
  }
}

/** How many cards fit across a board of this width. */
export function columnsFor(boardWidth: number): number {
  return Math.max(1, Math.floor((boardWidth + CARD_GAP) / (CARD_W + CARD_GAP)))
}

/**
 * The column count a tidy board uses: as square as the cards allow, rather
 * than as many as will fit.
 *
 * Filling the width first means a handful of scenes lands in a single row,
 * which reads as cards snapped into a line rather than a board that has been
 * arranged — the grid is there, but nothing about the result shows it. A
 * balanced grid looks deliberate at any number of cards, and still reads
 * left-to-right in binder order.
 */
export function tidyColumns(count: number, boardWidth: number): number {
  if (count <= 1) return 1
  return Math.max(1, Math.min(columnsFor(boardWidth), Math.ceil(Math.sqrt(count))))
}

/**
 * Every card's position on the board.
 *
 * A card the writer has moved keeps the position they gave it; one they have
 * not falls back to its slot in **binder order**, so a project that has never
 * used the board looks exactly as it did before free placement existed, with
 * nothing written to any file until a card is actually moved.
 *
 * Pure and DOM-free for the same reason `windowGeometry.ts` is: jsdom has no
 * layout engine, so geometry asserted through a rendered component is
 * asserted against zeroes.
 */
export function layoutCards(cards: SceneCard[], boardWidth: number): PlacedCard[] {
  const cols = tidyColumns(cards.length, boardWidth)
  // Dealing never lands a card on one the writer placed, nor on one dealt
  // before it. After Apply Order every card is pinned at the slots of the
  // column count the board had then; a scene added afterwards is dealt at
  // the count the board has now, and once that has changed its slot can be
  // exactly where a pinned card sits. A dealt card whose slot is covered
  // takes the next free one, and the cards dealt after it shift along —
  // as cards do when one is pushed into a row. Covered means more than
  // half under the other card, so a card nudged off its slot does not
  // push its neighbours about.
  const taken: Point[] = cards.flatMap((c) =>
    c.boardX != null && c.boardY != null ? [{ x: c.boardX, y: c.boardY }] : []
  )
  const covered = (slot: Point): boolean =>
    taken.some((p) => Math.abs(p.x - slot.x) < CARD_W / 2 && Math.abs(p.y - slot.y) < CARD_H / 2)
  return cards.map((card, i) => {
    if (card.boardX != null && card.boardY != null)
      return { ...card, x: card.boardX, y: card.boardY, placed: true }
    let k = i
    let slot = gridSlot(k, cols)
    while (covered(slot)) slot = gridSlot(++k, cols)
    taken.push(slot)
    return { ...card, x: slot.x, y: slot.y, placed: false }
  })
}

/** How tall the board must be to hold every card, including placed ones. */
export function boardHeight(placed: PlacedCard[]): number {
  return placed.reduce((tallest, c) => Math.max(tallest, c.y + CARD_H), 0)
}

export function sceneCards(docs: DocFile[], binder: BinderNode[]): BoardCard[] {
  const byId = new Map(docs.map((d) => [d.meta.id, d]))
  const folders = folderPaths(binder)
  // `walk` hands out nodes, not parents; the parent is what Apply Order
  // groups by, so it is carried here.
  const parents = new Map<string, string>()
  const note = (nodes: BinderNode[], parent: string): void => {
    for (const n of nodes) {
      parents.set(n.id, parent)
      if (n.children) note(n.children, n.id)
    }
  }
  note(binder, '')
  const cards: BoardCard[] = []
  walk(binder, (node) => {
    if (node.type !== 'doc') return
    const doc = byId.get(node.id)
    if (!doc?.meta.tags?.includes(SCENE_TAG)) return
    const text = plainTextOf(doc.body).trim()
    cards.push({
      kind: 'scene',
      parentId: parents.get(node.id) ?? '',
      id: doc.meta.id,
      title: doc.meta.title,
      status: doc.meta.status,
      label: doc.meta.label,
      folder: folders.get(node.id) ?? '',
      wordCount: countWords(text),
      excerpt: excerptOf(doc.body),
      empty: text === '',
      boardX: doc.meta.boardX,
      boardY: doc.meta.boardY,
      synopsis: doc.meta.synopsis ? excerptOf(doc.meta.synopsis) : undefined,
      outline: outlineLine(doc.meta) || undefined,
      back: hasBack(doc.meta)
    })
  })
  return cards
}

/** The entity types that can be cards, and what the card calls them. */
const ENTITY_KINDS: Partial<Record<Entity['type'], CardKind>> = {
  character: 'character',
  world: 'location'
}

/**
 * Story-bible entries that have been put on the board, as cards.
 *
 * Alphabetical within a kind: entries have no manuscript order to speak of,
 * and a cast list is what a writer expects to read in. A location's "folder"
 * is the chain it is nested in (F-13), so a card for a tavern says which city
 * it is in, the way a scene card says which part it is in.
 */
export function entityCards(entities: Entity[]): BoardCard[] {
  const cards: BoardCard[] = []
  for (const kind of ['character', 'location'] as const) {
    const type = kind === 'character' ? 'character' : 'world'
    const book = kind === 'character' ? 'Character Book' : 'World Book'
    const onBoard = entities
      .filter((e) => e.type === type && e.onBoard && ENTITY_KINDS[e.type] === kind)
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const e of onBoard) {
      const text = plainTextOf(e.body).trim()
      const within =
        kind === 'location'
          ? locationChain(entities, e.id)
              .slice(0, -1)
              .map((l) => l.name)
          : []
      cards.push({
        kind,
        id: e.id,
        title: e.name,
        folder: [book, ...within].join(' / '),
        wordCount: countWords(text),
        excerpt: excerptOf(e.body),
        empty: text === '',
        boardX: e.boardX,
        boardY: e.boardY,
        portrait: e.portrait
      })
    }
  }
  return cards
}

/**
 * F-12: the maps put on the board, as minimap cards — a map is one of the
 * story's pieces too, and a string from a scene to the city it happens in
 * is a thing a plotter pins up. Put on deliberately, like an entry
 * (`MapSheet.onBoard`), in tab order; the card is the map, shrunk.
 */
export function mapCards(sheets: MapSheet[]): BoardCard[] {
  return sheets
    .filter((m) => m.onBoard)
    .map((m) => ({
      kind: 'map' as const,
      id: m.id,
      title: m.name,
      folder: 'Maps',
      wordCount: 0,
      excerpt: '',
      empty: false,
      boardX: m.boardX,
      boardY: m.boardY
    }))
}

/** Every card on the board: scenes in binder order, then characters, then
 *  locations, then maps. */
export function boardCards(
  docs: DocFile[],
  binder: BinderNode[],
  entities: Entity[],
  sheets: MapSheet[] = []
): BoardCard[] {
  return [...sceneCards(docs, binder), ...entityCards(entities), ...mapCards(sheets)]
}

/**
 * Stacking: the cards gathered into piles, one per kind, solitaire style.
 *
 * Each pile cascades by `STACK_STEP` so every card's title line shows above
 * the card on top of it — the tableau in a game of patience, which is the
 * look a writer reaches for when they say "stack them". Piles sit side by
 * side in kind order, and a kind with no cards leaves no gap. This is a way
 * of *looking* at the board, not an arrangement: nothing here is written
 * anywhere, and unstacking returns every card to wherever it was.
 */
export const STACK_STEP = 24

export function stackLayout(cards: BoardCard[]): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  let pile = 0
  for (const kind of ['scene', 'character', 'location', 'map'] as const) {
    const inPile = cards.filter((c) => c.kind === kind)
    if (inPile.length === 0) continue
    inPile.forEach((c, i) => out.set(c.id, { x: pile * (CARD_W + CARD_GAP), y: i * STACK_STEP }))
    pile += 1
  }
  return out
}

/**
 * Strings (F-46): a length of red string between two pins, each pin pushed
 * into a card.
 *
 * An end is anchored to a **card**, as an offset from its top-left, rather
 * than to a point on the board: a string between two cards has to survive
 * either card being dragged, stacked or tidied, and a point on the cork
 * would be left behind by all three. The geometry here turns those anchors
 * into board coordinates for the card positions of the moment, which is
 * what makes a string follow a card mid-drag.
 */
export interface Point {
  x: number
  y: number
}

/** Where a pin sits on the board, given where its card is now. */
export function pinPoint(end: StringEnd, cards: Map<string, Point>): Point | null {
  const card = cards.get(end.cardId)
  if (!card) return null
  return { x: card.x + end.dx, y: card.y + end.dy }
}

/**
 * Both ends of a string, or null if either card is not on the board.
 *
 * A string whose card has been taken off the board, trashed or deleted is
 * **hidden rather than removed**: the card may come back (a bible entry
 * returns with Add Card; a document can be restored from the trash) and the
 * string with it. Cascading the delete would turn a reversible action into
 * one that quietly lost the writer's connections.
 */
export function stringPoints(s: BoardString, cards: Map<string, Point>): [Point, Point] | null {
  const a = pinPoint(s.from, cards)
  const b = pinPoint(s.to, cards)
  return a && b ? [a, b] : null
}

/**
 * The string's path: a shallow curve rather than a ruled line.
 *
 * Real string hangs. The sag is a fraction of the span, capped, so a short
 * string between neighbours is nearly straight and a long one across the
 * board droops visibly but never into another row of cards. Pure so the
 * droop can be tested as a number rather than eyeballed.
 */
export const STRING_SAG = 0.08
export const STRING_MAX_SAG = 36

export function stringPath(a: Point, b: Point): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const span = Math.hypot(dx, dy)
  const sag = Math.min(STRING_MAX_SAG, span * STRING_SAG)
  // The control point sits below the midpoint: the curve hangs, whichever
  // way round the pins were placed.
  const cx = a.x + dx / 2
  const cy = a.y + dy / 2 + sag
  return `M ${r(a.x)} ${r(a.y)} Q ${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`
}

function r(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Where a pin goes when a card is clicked at a board point: the click's
 * offset within the card, kept inside the card. A pin pushed in at the very
 * edge is still a pin in that card, not one hanging in the cork beside it.
 */
export function pinOffset(card: Point, at: Point): { dx: number; dy: number } {
  return {
    dx: Math.round(Math.min(CARD_W, Math.max(0, at.x - card.x))),
    dy: Math.round(Math.min(CARD_H, Math.max(0, at.y - card.y)))
  }
}

/**
 * The scenes in the order the board *reads*: row by row, left to right.
 *
 * This is the other half of free placement. Dragging a card stopped
 * reordering the manuscript (a card that reordered and then snapped into the
 * grid never stayed where it was put), which left the board with no way to
 * write back at all. Arrange, then apply: the board's reading order becomes
 * the binder's order, on request, never on its own.
 *
 * Rows are found by clustering, not by a grid: cards are placed freely, so a
 * row is any set of cards whose tops lie within `ROW_TOLERANCE` of the first
 * card in it. Two cards side by side with one a little lower are one row,
 * which is how a hand lays cards out; a card a full card-height down is the
 * next row. Only scenes take part — a character or location card has no
 * place in the manuscript to be given.
 */
export const ROW_TOLERANCE = CARD_H * 0.6

export function boardOrder(placed: PlacedCard[]): string[] {
  const scenes = placed.filter((c) => c.kind === 'scene').sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: PlacedCard[][] = []
  for (const card of scenes) {
    const row = rows[rows.length - 1]
    if (row && card.y - row[0].y <= ROW_TOLERANCE) row.push(card)
    else rows.push([card])
  }
  return rows.flatMap((row) => row.sort((a, b) => a.x - b.x || a.y - b.y).map((c) => c.id))
}

/**
 * Whether applying the board's order would change anything.
 *
 * Asked **per folder**, because that is all applying can do: a scene is
 * reordered among the scenes of its own folder, never moved to another. So
 * the board's reading order is compared against the binder's (the order
 * `boardCards` emits scenes in) one folder at a time, and a board that
 * differs only *across* folders — a Part Two scene set above Part One — is
 * a board applying would leave exactly as it is. A button that offers to
 * apply an order the book already has, or one it cannot give it, is a button
 * that lies about having something to do.
 */
export function boardOrderDiffers(placed: PlacedCard[]): boolean {
  const board = boardOrder(placed)
  const rank = new Map(board.map((id, i) => [id, i]))
  const byParent = new Map<string, string[]>()
  for (const c of placed) {
    if (c.kind !== 'scene') continue
    const key = c.parentId ?? ''
    byParent.set(key, [...(byParent.get(key) ?? []), c.id])
  }
  for (const ids of byParent.values()) {
    const read = [...ids].sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0))
    if (ids.some((id, i) => id !== read[i])) return true
  }
  return false
}

export type Direction = 'up' | 'down' | 'left' | 'right'

/**
 * The card an arrow key goes to from this one: the nearest in that
 * direction, as the eye reads the board — not the next in the list, which
 * on a free-form board is binder order and can be anywhere on screen.
 *
 * Centres are compared. A card counts as being in the direction only if it
 * is further along that axis than it is off to the side (a 90° cone), so ↓
 * from a card does not land on the one beside it; among those, distance
 * along the axis plus twice the sideways offset decides, so a card straight
 * below beats a nearer one far to the side. Null at the edge of the board.
 */
export function nearestCard(
  cards: { id: string; x: number; y: number }[],
  fromId: string,
  dir: Direction
): string | null {
  const from = cards.find((c) => c.id === fromId)
  if (!from) return null
  let best: { id: string; score: number } | null = null
  for (const c of cards) {
    if (c.id === fromId) continue
    const dx = c.x - from.x
    const dy = c.y - from.y
    const along = dir === 'right' ? dx : dir === 'left' ? -dx : dir === 'down' ? dy : -dy
    const aside = Math.abs(dir === 'left' || dir === 'right' ? dy : dx)
    if (along <= 0 || aside > along) continue
    const score = along + 2 * aside
    if (!best || score < best.score) best = { id: c.id, score }
  }
  return best?.id ?? null
}

/** How far one press of ⌥+arrow moves a card, and ⇧⌥+arrow. */
export const NUDGE = 8
export const NUDGE_BIG = CARD_GAP + 16
/** How long after the last nudge the card's position is written, in ms. */
export const NUDGE_SETTLE = 300

/**
 * Where a string's label sits: halfway along the hanging curve — the
 * midpoint of the span, lowered by half the sag (a quadratic curve at its
 * middle is a quarter of the way from the chord to its control point, and
 * the control point is a full sag below).
 */
export function stringMidpoint(a: Point, b: Point): Point {
  const span = Math.hypot(b.x - a.x, b.y - a.y)
  const sag = Math.min(STRING_MAX_SAG, span * STRING_SAG)
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag / 2 }
}

/** Where a string meets a card when nobody chose the spot: its own pin. */
export function cardPin(card: Point): Point {
  return { x: card.x + CARD_W / 2, y: card.y + 10 }
}

export interface RelationshipString {
  relationship: Relationship
  a: Point
  b: Point
  /** Which side its tag goes on a short string: -1 for the one drawn first
   *  of a pair, so two tags beside two close strings face away from each
   *  other rather than landing on top of one another. */
  side: -1 | 1
}

/**
 * The Character Graph's relationships, as string on the board: one for every
 * relationship whose two characters both have a card here, pin to pin. Not
 * stored as board strings — they are the relationships themselves, seen a
 * second way, so a change in either place is a change in both. A
 * relationship with a character off the board is hidden, never removed.
 */
export function relationshipStrings(
  relationships: Relationship[],
  cards: { id: string; kind: CardKind; x: number; y: number }[]
): RelationshipString[] {
  const at = new Map(cards.filter((c) => c.kind === 'character').map((c) => [c.id, c]))
  const shown = relationships.filter((r) => {
    const from = at.get(r.fromId)
    const to = at.get(r.toId)
    return from && to && from !== to
  })
  // Two characters can be joined more than once — "sister of" one way and
  // "brother of" the other is the ordinary case for a cast. Drawn on the same
  // two points they were one string with stacked tags, only the top one
  // reachable; each is moved off the shared line by its place in the pair,
  // so every string, pin and tag has its own spot.
  const pairOf = (r: Relationship): string => [r.fromId, r.toId].sort().join('|')
  const groups = new Map<string, Relationship[]>()
  for (const r of shown) groups.set(pairOf(r), [...(groups.get(pairOf(r)) ?? []), r])
  return shown.map((relationship) => {
    const from = at.get(relationship.fromId)!
    const to = at.get(relationship.toId)!
    const [a, b] = facingPins(from, to)
    const group = groups.get(pairOf(relationship))!
    const k = group.indexOf(relationship) - (group.length - 1) / 2
    const side: -1 | 1 = k < 0 ? -1 : 1
    if (k === 0) return { relationship, a, b, side }
    // Sideways to the line between the cards — not to this string's own
    // direction, which flips for the reverse relationship and would send
    // the two strings back onto each other.
    const across = Math.abs(b.y - a.y) >= Math.abs(b.x - a.x) ? { x: 1, y: 0 } : { x: 0, y: 1 }
    const d = k * PARALLEL_SPACING
    return {
      relationship,
      a: { x: a.x + across.x * d, y: a.y + across.y * d },
      b: { x: b.x + across.x * d, y: b.y + across.y * d },
      side
    }
  })
}

/** How far apart two strings joining the same two cards are drawn. */
export const PARALLEL_SPACING = 40

/** Below this span a tag at the middle would cover the pins at either end. */
export const SHORT_SPAN = 100

export interface TagPlace {
  x: number
  y: number
  /** Which point of the tag sits at (x, y): its centre, or the middle of
   *  the edge nearest the string. */
  anchor: 'centre' | 'left' | 'right' | 'bottom' | 'top'
}

/**
 * Where a string's tag goes. At the middle of the string, normally — but a
 * short string between neighbouring cards has its two pins only a gap apart,
 * and a tag centred there covered both: with the tool up, clicking a pin
 * opened the label instead of pulling the string, and with it down the tag
 * sat on both cards' text. A short string that runs down gets its tag beside
 * it; one that runs across gets it above the cards' tops.
 */
export function tagPlace(a: Point, b: Point, side: -1 | 1 = 1): TagPlace {
  const mid = stringMidpoint(a, b)
  if (Math.hypot(b.x - a.x, b.y - a.y) >= SHORT_SPAN) return { ...mid, anchor: 'centre' }
  if (Math.abs(b.y - a.y) >= Math.abs(b.x - a.x))
    return side > 0
      ? { x: mid.x + 10, y: mid.y, anchor: 'left' }
      : { x: mid.x - 10, y: mid.y, anchor: 'right' }
  return side > 0
    ? { x: mid.x, y: Math.min(a.y, b.y) - CARD_H / 2 - 4, anchor: 'bottom' }
    : { x: mid.x, y: Math.max(a.y, b.y) + CARD_H / 2 + 4, anchor: 'top' }
}

/**
 * Where a string between two cards meets each one when nobody chose the
 * spot: the middles of the edges that face each other. Pinned top to top, a
 * string between two cards in a column ran down through the upper card, and
 * its label sat on that card's text; edge to edge, it hangs in the gap
 * between them, label and all.
 */
export function facingPins(p: Point, q: Point): [Point, Point] {
  const dx = q.x - p.x
  const dy = q.y - p.y
  if (Math.abs(dy) >= Math.abs(dx)) {
    // One above the other: bottom of the upper, top of the lower.
    return dy >= 0
      ? [
          { x: p.x + CARD_W / 2, y: p.y + CARD_H },
          { x: q.x + CARD_W / 2, y: q.y }
        ]
      : [
          { x: p.x + CARD_W / 2, y: p.y },
          { x: q.x + CARD_W / 2, y: q.y + CARD_H }
        ]
  }
  // Side by side: the facing sides, at mid-height.
  return dx >= 0
    ? [
        { x: p.x + CARD_W, y: p.y + CARD_H / 2 },
        { x: q.x, y: q.y + CARD_H / 2 }
      ]
    : [
        { x: p.x, y: p.y + CARD_H / 2 },
        { x: q.x + CARD_W, y: q.y + CARD_H / 2 }
      ]
}

/**
 * A label's text with the way it reads: a relationship has a direction
 * ("Elara — sister of → Marten"), and the board can be laid out any way
 * round, so the arrow points along the string from the `from` card's end —
 * down or up when the string mostly runs that way, not sideways.
 */
export function directedLabel(label: string, a: Point, b: Point): string {
  const dx = b.x - a.x
  const dy = b.y - a.y
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? `${label} ↓` : `↑ ${label}`
  return dx >= 0 ? `${label} →` : `← ${label}`
}
