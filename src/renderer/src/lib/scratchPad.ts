import type { BinderNode, Scrap } from '../../../shared/types'
import { walk } from './tree'

/**
 * F-51: the words the scratch pad uses for a scrap — where it came from, and
 * when. Kept here, not in the component, because search names its hits the
 * same way.
 */
export function scrapOrigin(scrap: Scrap): string {
  const from = scrap.fromTitle ? `“${scrap.fromTitle}”` : 'a chapter'
  switch (scrap.how) {
    case 'cut':
      return `Cut from ${from}`
    case 'local':
      return `Kept from ${from}, as written on this computer`
    case 'incoming':
      return `Kept from ${from}, as written on your other computer`
    default:
      return 'A note'
  }
}

/** "28 Oct 2026, 2:14 pm" — when a scrap went onto the pad. */
export function scrapWhen(scrap: Scrap): string {
  const at = new Date(scrap.created)
  if (Number.isNaN(at.getTime())) return ''
  return at.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

/** Newest first, as a pad is read: the latest scrap on top. Ties (two kept in
 *  one merge) keep a stable order by id. */
export function padOrder(scraps: Scrap[]): Scrap[] {
  return [...scraps].sort((a, b) => b.created.localeCompare(a.created) || a.id.localeCompare(b.id))
}

/** The document a scrap came from, when it is still in the binder (not the
 *  Trash) to go back to. */
export function scrapSource(scrap: Scrap, binder: BinderNode[]): string | null {
  if (!scrap.fromDoc) return null
  let found = false
  walk(binder, (node) => {
    if (node.type === 'doc' && node.id === scrap.fromDoc) found = true
  })
  return found ? scrap.fromDoc : null
}
