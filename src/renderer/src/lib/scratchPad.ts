import type { Editor } from '@tiptap/core'
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
    case 'both':
      return `Kept from ${from}, both computers' edits combined`
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

/**
 * Whether the page has a selection the writer can see, for Move to Scratch
 * Pad: the page has focus, or the document's selection still lies in it (a
 * menu opened over it keeps it showing). A tag or rename field takes the
 * visible selection while the page keeps its own, hidden — and a cut of
 * text nobody can see is not one the writer chose.
 */
export function selectionOnScreen(editor: Editor): boolean {
  if (editor.isDestroyed || editor.state.selection.empty) return false
  if (editor.isFocused) return true
  const shown = document.getSelection()
  return (
    shown != null &&
    !shown.isCollapsed &&
    shown.anchorNode != null &&
    editor.view.dom.contains(shown.anchorNode)
  )
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
