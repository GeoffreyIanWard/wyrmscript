import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/** Gutter column width and its gap from the page's left edge, in px. */
const GUTTER_WIDTH = 36
const GUTTER_GAP = 8

export interface LineNumbersOptions {
  getEnabled: () => boolean
}

/**
 * F-27: paragraph numbers in a gutter left of the page, off by default — the
 * page is sacred, and gutter furniture is not a writer's default view.
 * Deliberately counts *paragraphs*, not wrapped visual lines: a paragraph is
 * a stable unit that survives a resize or a font-size change without
 * remeasuring, unlike a "visual line", which is a wrapped-text artefact of
 * the current measure/size/window width (see `pageView.ts`, which has no
 * choice but to count visual lines for its own, different reason).
 *
 * Same positioned-overlay technique as F-23's block cursor: the gutter is a
 * real DOM sibling of the editor root, placed with `coordsAtPos`, never a
 * ProseMirror decoration — a decoration lives inside the reconciled content
 * and numbering the *outside* of it needs a mechanism decorations don't
 * offer.
 */
export const LineNumbers = Extension.create<LineNumbersOptions>({
  name: 'wyrmLineNumbers',

  addOptions() {
    return { getEnabled: () => false }
  },

  addProseMirrorPlugins() {
    const { getEnabled } = this.options

    return [
      new Plugin({
        view(editorView) {
          const gutter = document.createElement('div')
          gutter.className = 'line-number-gutter'
          gutter.setAttribute('aria-hidden', 'true')
          editorView.dom.parentElement?.appendChild(gutter)

          const render = (view: EditorView): void => {
            if (!getEnabled()) {
              gutter.style.display = 'none'
              return
            }
            const scrollEl = view.dom.closest<HTMLElement>('.terminal-scroll')
            if (!scrollEl) {
              gutter.style.display = 'none'
              return
            }
            const scrollRect = scrollEl.getBoundingClientRect()
            const pageRect = view.dom.getBoundingClientRect()

            gutter.innerHTML = ''
            gutter.style.display = 'block'
            gutter.style.width = `${GUTTER_WIDTH}px`
            gutter.style.left = `${
              pageRect.left - scrollRect.left + scrollEl.scrollLeft - GUTTER_WIDTH - GUTTER_GAP
            }px`

            let index = 0
            view.state.doc.forEach((node, offset) => {
              index += 1
              // A position inside the paragraph's content, not its boundary —
              // `offset` itself sits between nodes and can resolve to either
              // side of it. Clamped so a genuinely empty paragraph (size 2:
              // open + close) still resolves inside it rather than past it.
              const pos = Math.min(offset + 1, offset + node.nodeSize - 1)
              const coords = view.coordsAtPos(pos)
              const number = document.createElement('div')
              number.className = 'line-number'
              number.textContent = String(index)
              number.style.top = `${coords.top - scrollRect.top + scrollEl.scrollTop}px`
              gutter.appendChild(number)
            })
          }

          // Paragraph position on screen shifts on any reflow — a real edit,
          // but also a font-size/measure/line-height change from Preferences
          // or the window resizing, none of which fire a ProseMirror
          // transaction. Observing the page element itself catches all of
          // them through one mechanism rather than three separate listeners.
          const observer = new ResizeObserver(() => render(editorView))
          observer.observe(editorView.dom)
          render(editorView)

          return {
            update: render,
            destroy() {
              gutter.remove()
              observer.disconnect()
            }
          }
        }
      })
    ]
  }
})
