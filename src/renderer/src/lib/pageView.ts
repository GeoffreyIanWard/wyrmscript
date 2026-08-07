import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

export interface PageViewOptions {
  getEnabled: () => boolean
  getLinesPerPage: () => number
}

/**
 * F-27: a dotted rule every `getLinesPerPage()` *visual* lines, standing in
 * for an approximate page break — deliberately not called a page break
 * anywhere in the UI (see Preferences), since real pagination depends on a
 * paper size and font metrics this app does not model, and will not match
 * what the compiled `.docx`/PDF actually paginates to.
 *
 * Unlike F-27's line numbers, this has no choice but to count wrapped visual
 * lines rather than paragraphs: a page is a unit of screen space, and a
 * single long paragraph can span several of them on its own. Measured with
 * `Range.getClientRects()` on each paragraph's contents — one client rect
 * per wrapped line, the same trick a "jump to visual line" editor feature
 * would use — rather than a ProseMirror decoration, since a rule needs to
 * draw *between* lines, a position decorations have no way to express.
 */
export const PageView = Extension.create<PageViewOptions>({
  name: 'wyrmPageView',

  addOptions() {
    return { getEnabled: () => false, getLinesPerPage: () => 25 }
  },

  addProseMirrorPlugins() {
    const { getEnabled, getLinesPerPage } = this.options

    return [
      new Plugin({
        view(editorView) {
          const overlay = document.createElement('div')
          overlay.className = 'page-view-rules'
          overlay.setAttribute('aria-hidden', 'true')
          editorView.dom.parentElement?.appendChild(overlay)

          const render = (view: EditorView): void => {
            if (!getEnabled()) {
              overlay.style.display = 'none'
              return
            }
            const scrollEl = view.dom.closest<HTMLElement>('.terminal-scroll')
            if (!scrollEl) {
              overlay.style.display = 'none'
              return
            }
            const scrollRect = scrollEl.getBoundingClientRect()
            const pageRect = view.dom.getBoundingClientRect()
            const linesPerPage = Math.max(1, Math.round(getLinesPerPage()))

            overlay.innerHTML = ''
            overlay.style.display = 'block'
            overlay.style.left = `${pageRect.left - scrollRect.left + scrollEl.scrollLeft}px`
            overlay.style.width = `${pageRect.width}px`

            let lineCount = 0
            const paragraphs = view.dom.querySelectorAll('p')
            paragraphs.forEach((p) => {
              const range = document.createRange()
              range.selectNodeContents(p)
              const rects = Array.from(range.getClientRects())
              // An empty paragraph's range yields no rects at all (nothing to
              // measure), but it is still one visual line on screen — fall
              // back to the paragraph element's own box so it still counts.
              const lineRects = rects.length > 0 ? rects : [p.getBoundingClientRect()]
              for (const rect of lineRects) {
                lineCount += 1
                if (lineCount % linesPerPage === 0) {
                  const rule = document.createElement('div')
                  rule.className = 'page-view-rule'
                  rule.style.top = `${rect.bottom - scrollRect.top + scrollEl.scrollTop}px`
                  overlay.appendChild(rule)
                }
              }
            })
          }

          // See lineNumbers.ts: a ResizeObserver on the page element catches
          // real edits, window resizes, and Preferences geometry changes
          // (font size, measure, line height) through one mechanism, none of
          // which alone would otherwise trigger a re-measure.
          const observer = new ResizeObserver(() => render(editorView))
          observer.observe(editorView.dom)
          render(editorView)

          return {
            update: render,
            destroy() {
              overlay.remove()
              observer.disconnect()
            }
          }
        }
      })
    ]
  }
})
