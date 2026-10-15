import type { BinderNode, DocFile, DocStatus } from '../../../shared/types'
import { SCENE_TAG } from '../../../shared/types'
import { walk } from './tree'
import { folderPaths, plainTextOf } from './search'

/**
 * The corkboard: every scene in the project as an index card.
 *
 * **Binder order, not timeline order**, and that is the whole point of the
 * view existing alongside the timeline. F-02 settled that narrative order and
 * chronology are different things — flashbacks, parallel threads — and gave
 * the timeline its own `timelineOrder`. The corkboard is the *binder* seen as
 * cards, so moving a card moves the scene in the manuscript, which is what a
 * writer means when they rearrange index cards. The timeline keeps answering
 * the other question.
 *
 * A card therefore carries no ordering of its own: the binder is the order.
 */
export interface SceneCard {
  id: string
  title: string
  status?: DocStatus
  /** Writer's own label, shown as-is. */
  label?: string
  /** The folder path it lives under, so a card says where it belongs. */
  folder: string
  wordCount: number
  /** The opening of the scene, for a card that has been written into. */
  excerpt: string
  /** No prose yet — an outlined scene, or one not started. */
  empty: boolean
  /** Stored board position, unset until the writer moves this card. */
  boardX?: number
  boardY?: number
}

/** How much of the opening a card shows before it stops being a card. */
const EXCERPT_CHARS = 140

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

export function sceneCards(docs: DocFile[], binder: BinderNode[]): SceneCard[] {
  const byId = new Map(docs.map((d) => [d.meta.id, d]))
  const folders = folderPaths(binder)
  const cards: SceneCard[] = []
  walk(binder, (node) => {
    if (node.type !== 'doc') return
    const doc = byId.get(node.id)
    if (!doc?.meta.tags?.includes(SCENE_TAG)) return
    const text = plainTextOf(doc.body).trim()
    cards.push({
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
