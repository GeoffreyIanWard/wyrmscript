import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export interface AutoPrintOptions {
  getEnabled: () => boolean
  getLinesPerPage: () => number
  /** Called once per newly-completed page, with that page's doc range. */
  onPageComplete: (from: number, to: number) => void
}

/**
 * F-38 part 2: fire when a page fills, the way a sheet comes off a typewriter
 * platen.
 *
 * A "page" here is F-27's lines-per-page count, reusing the visual-line
 * measurement `pageView.ts` already does. That is a deliberate, documented
 * approximation: the boundary is line-count-defined, not paper-metric
 * defined, so a printed sheet may not be exactly full. It is the only page
 * boundary the *editor* knows about at all — print-side pagination lives in
 * Chromium and cannot tell the editor anything while the writer is typing.
 *
 * **The safety property is that a page is never printed twice.** Paper is
 * physical and a runaway trigger is expensive, so this tracks the highest
 * page number ever completed for the open document and only fires strictly
 * above it. Deleting text lowers the live page count; retyping raises it back
 * through boundaries that have already printed, and those must stay silent.
 * Nothing lowers the mark: the editor is recreated per document
 * (`Editor.tsx` keys it on `activeId`), so a new document starts at page zero
 * with a fresh plugin instance rather than needing an explicit reset.
 */
export const AutoPrint = Extension.create<AutoPrintOptions>({
  name: 'wyrmAutoPrint',

  addOptions() {
    return {
      getEnabled: () => false,
      getLinesPerPage: () => 25,
      onPageComplete: () => {}
    }
  },

  addProseMirrorPlugins() {
    const { getEnabled, getLinesPerPage, onPageComplete } = this.options

    return [
      new Plugin({
        view() {
          /** Highest page number already handed to the printer. */
          let highestPrinted = 0

          const check = (view: EditorView): void => {
            if (!getEnabled()) return
            const linesPerPage = Math.max(1, Math.round(getLinesPerPage()))

            // Same measurement as pageView.ts: one client rect per wrapped
            // line, walked in document order.
            const lineTops: { bottom: number; left: number }[] = []
            view.dom.querySelectorAll('p').forEach((p) => {
              const range = document.createRange()
              range.selectNodeContents(p)
              const rects = Array.from(range.getClientRects())
              const lines = rects.length > 0 ? rects : [p.getBoundingClientRect()]
              for (const rect of lines) lineTops.push({ bottom: rect.bottom, left: rect.left })
            })

            const completed = Math.floor(lineTops.length / linesPerPage)
            if (completed <= highestPrinted) return

            // Emit every page that became complete since the last check —
            // a paste can cross several boundaries at once, and skipping the
            // intermediate ones would silently drop pages from the printout.
            for (let page = highestPrinted + 1; page <= completed; page++) {
              const startLine = (page - 1) * linesPerPage
              const endLine = page * linesPerPage
              const from = posAtLineStart(view, lineTops, startLine)
              const to =
                endLine < lineTops.length
                  ? posAtLineStart(view, lineTops, endLine)
                  : view.state.doc.content.size
              if (from != null && to != null && to > from) onPageComplete(from, to)
            }
            highestPrinted = completed
          }

          return {
            update: check,
            destroy() {
              // Nothing to tear down; the mark dies with the editor, which is
              // recreated per document (see Editor.tsx), so a new document
              // starts at page zero without an explicit reset.
              highestPrinted = 0
            }
          }
        }
      })
    ]
  }
})

/** Document position at the start of a measured visual line. */
function posAtLineStart(
  view: EditorView,
  lines: { bottom: number; left: number }[],
  index: number
): number | null {
  const line = lines[index]
  if (!line) return null
  // A hair above the line's bottom edge lands inside it rather than in the
  // gap below, which can resolve into the following block.
  const found = view.posAtCoords({ left: line.left + 1, top: line.bottom - 2 })
  return found ? found.pos : null
}
