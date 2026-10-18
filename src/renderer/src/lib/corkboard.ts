import type {
  BinderNode,
  BoardString,
  DocFile,
  DocStatus,
  Entity,
  StringEnd
} from '../../../shared/types'
import { SCENE_TAG } from '../../../shared/types'
import { walk } from './tree'
import { folderPaths, plainTextOf } from './search'
import { locationChain } from './locations'

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
export type CardKind = 'scene' | 'character' | 'location'

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
  return cards.map((card, i) => {
    const placed = card.boardX != null && card.boardY != null
    const slot = gridSlot(i, cols)
    return {
      ...card,
      x: placed ? (card.boardX as number) : slot.x,
      y: placed ? (card.boardY as number) : slot.y,
      placed
    }
  })
}

/** How tall the board must be to hold every card, including placed ones. */
export function boardHeight(placed: PlacedCard[]): number {
  return placed.reduce((tallest, c) => Math.max(tallest, c.y + CARD_H), 0)
}

export function sceneCards(docs: DocFile[], binder: BinderNode[]): BoardCard[] {
  const byId = new Map(docs.map((d) => [d.meta.id, d]))
  const folders = folderPaths(binder)
  const cards: BoardCard[] = []
  walk(binder, (node) => {
    if (node.type !== 'doc') return
    const doc = byId.get(node.id)
    if (!doc?.meta.tags?.includes(SCENE_TAG)) return
    const text = plainTextOf(doc.body).trim()
    cards.push({
      kind: 'scene',
      id: doc.meta.id,
      title: doc.meta.title,
      status: doc.meta.status,
      label: doc.meta.label,
      folder: folders.get(node.id) ?? '',
      wordCount: countWords(text),
      excerpt: excerptOf(doc.body),
      empty: text === '',
      boardX: doc.meta.boardX,
      boardY: doc.meta.boardY
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

/** Every card on the board: scenes in binder order, then characters, then locations. */
export function boardCards(docs: DocFile[], binder: BinderNode[], entities: Entity[]): BoardCard[] {
  return [...sceneCards(docs, binder), ...entityCards(entities)]
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
  for (const kind of ['scene', 'character', 'location'] as const) {
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
