import type { BinderNode, DocFile } from '../../../shared/types'
import { SCENE_TAG } from '../../../shared/types'
import { walk } from './tree'

/** One card on the F-02 timeline: a scene-tagged document, ordered. */
export interface TimelineCard {
  id: string
  title: string
  date?: string
  order: number
  /** F-03's tension value, carried here since the plot graph shares this
   *  same scene-tagged, timeline-ordered card list rather than its own. */
  tension?: number
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
      order: d.meta.timelineOrder ?? ranks.get(d.meta.id) ?? Number.MAX_SAFE_INTEGER,
      tension: d.meta.tension
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

/**
 * F-29: the line-graphic view. `timelineOrder` doubles as a literal
 * coordinate here rather than just a sort rank — dragging on the line sets
 * a real position, snapped to this grid so a drop settles on one of a small
 * number of readable gaps rather than an arbitrary pixel value. Two cards
 * landing on the exact same grid position is how a stack (simultaneous
 * events) gets made — a deliberate visual coincidence, not a stored
 * relationship (see F-29's design notes in the roadmap).
 *
 * One grid unit is deliberately the *only* non-zero gap: `TimelineLineView`
 * renders each card `PX_PER_UNIT` pixels wide apart at minimum, sized so a
 * single grid step never overlaps a card. A finer grid (e.g. quarter-steps)
 * sounds more precise but actually breaks the picture — two cards that
 * snap close together but not to the exact same spot render as an
 * unreadable partial overlap that reads as neither a stack nor a gap.
 */
export const TIMELINE_GRID = 1

export function snapToGrid(value: number, grid: number = TIMELINE_GRID): number {
  // Math.round can land on -0 for small negative inputs (e.g. -0.1 at the
  // default grid) — normalize it away rather than writing "-0" to frontmatter.
  return Math.round(value / grid) * grid || 0
}

/**
 * Cards grouped by grid position, ascending, each group being one stack
 * (a group of one is just a normal, unstacked card). Order within a group
 * is preserved from the input array so a stack doesn't visibly shuffle
 * itself on every render.
 */
export function stackByPosition(
  cards: TimelineCard[],
  grid: number = TIMELINE_GRID
): TimelineCard[][] {
  const groups = new Map<number, TimelineCard[]>()
  for (const card of cards) {
    const key = snapToGrid(card.order, grid)
    const group = groups.get(key)
    if (group) group.push(card)
    else groups.set(key, [card])
  }
  return [...groups.entries()].sort(([a], [b]) => a - b).map(([, group]) => group)
}
