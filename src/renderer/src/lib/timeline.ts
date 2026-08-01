import type { BinderNode, DocFile } from '../../../shared/types'
import { SCENE_TAG } from '../../../shared/types'
import { walk } from './tree'

/** One card on the F-02 timeline: a scene-tagged document, ordered. */
export interface TimelineCard {
  id: string
  title: string
  date?: string
  order: number
}

/** A document's index in binder traversal order — the fallback sort key for
 *  any scene that has never been manually repositioned on the timeline. */
function binderRanks(binder: BinderNode[]): Map<string, number> {
  const ranks = new Map<string, number>()
  let i = 0
  walk(binder, (node) => {
    if (node.type === 'doc') ranks.set(node.id, i++)
  })
  return ranks
}

/**
 * Scene-tagged documents (`SCENE_TAG`) in timeline order. A document with an
 * explicit `timelineOrder` sorts by that; everything else falls back to its
 * position in the binder, so a freshly tagged scene lands somewhere sensible
 * before a writer ever drags it (design decision: one timeline per project,
 * cards are scene-tagged documents, not a separate entity — see F-02).
 */
export function timelineCards(docs: DocFile[], binder: BinderNode[]): TimelineCard[] {
  const ranks = binderRanks(binder)
  return docs
    .filter((d) => d.meta.tags?.includes(SCENE_TAG))
    .map((d) => ({
      id: d.meta.id,
      title: d.meta.title,
      date: d.meta.timelineDate,
      order: d.meta.timelineOrder ?? ranks.get(d.meta.id) ?? Number.MAX_SAFE_INTEGER
    }))
    .sort((a, b) => a.order - b.order)
}

/**
 * The `timelineOrder` for a card dropped between `before` and `after` (either
 * may be absent at an end of the list). The fractional midpoint means
 * reordering one card never has to touch any other card's stored value.
 */
export function orderBetween(before: number | undefined, after: number | undefined): number {
  if (before === undefined && after === undefined) return 0
  if (before === undefined) return after! - 1
  if (after === undefined) return before + 1
  return (before + after) / 2
}
