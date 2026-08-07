import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'

/**
 * F-37: keeps the active line centered while the writer is actively
 * extending the manuscript, the way paper feeds through a typewriter platen
 * as the carriage advances. Deliberately narrow about when it fires — three
 * conditions, all required, straight from the request itself:
 *
 * 1. The document actually changed (typing), not just the selection moving —
 *    clicking around or arrowing through old text must never trigger a jump.
 * 2. The cursor sits in the document's last paragraph — editing anywhere
 *    else (a writer scrolled up to fix an earlier line) must never scroll
 *    the view out from under them. A typewriter's carriage cannot reach
 *    backward into text already typed.
 * 3. The cursor's line has reached the viewport's vertical midpoint — until
 *    then there is nothing to feed forward; the view holds still.
 *
 * Runs for every document regardless of the toggle, same reasoning as
 * `blockCursor.ts`: recreating the editor to gate this would lose undo
 * history, so `getEnabled` is read fresh on every check instead.
 */
export interface TypewriterScrollOptions {
  getEnabled: () => boolean
}

export const TypewriterScroll = Extension.create<TypewriterScrollOptions>({
  name: 'wyrmTypewriterScroll',

  addOptions() {
    return { getEnabled: () => false }
  },

  addProseMirrorPlugins() {
    const { getEnabled } = this.options

    return [
      new Plugin({
        view() {
          return {
            update(view, prevState) {
              if (!getEnabled()) return
              if (view.state.doc.eq(prevState.doc)) return

              const { selection } = view.state
              if (!selection.empty) return

              const $pos = view.state.doc.resolve(selection.head)
              const lastTopLevelIndex = view.state.doc.childCount - 1
              if ($pos.index(0) !== lastTopLevelIndex) return

              const scrollEl = view.dom.closest<HTMLElement>('.terminal-scroll')
              if (!scrollEl) return

              const coords = view.coordsAtPos(selection.head)
              const scrollRect = scrollEl.getBoundingClientRect()
              const midpoint = scrollRect.top + scrollRect.height / 2
              if (coords.top < midpoint) return

              scrollEl.scrollTop += coords.top - midpoint
            }
          }
        }
      })
    ]
  }
})
