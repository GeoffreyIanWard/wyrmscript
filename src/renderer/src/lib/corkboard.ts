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
      empty: text === ''
    })
  })
  return cards
}
