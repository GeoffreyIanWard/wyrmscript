import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

/**
 * F-23: a classic block-shaped text caret, BIOS-palette only. Browsers do
 * not reliably support a block-shaped `caret-color`/`caret-shape` (the
 * experimental `caret-shape` property has no meaningful stable support), so
 * this is a positioned overlay tracking the real cursor rather than a CSS
 * tweak — `caret-color: transparent` hides the native thin caret under BIOS
 * (see `retro.css`) and this element stands in for it.
 *
 * The extension itself is palette-agnostic and always active; it is cheap
 * (one `coordsAtPos` per selection/doc update) and recreating the editor on
 * every palette switch would lose undo history, so gating happens entirely
 * in CSS (`.block-cursor` paints nothing outside `[data-palette='bios']`).
 */
export const BlockCursor = Extension.create({
  name: 'wyrmBlockCursor',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view(editorView) {
          const cursorEl = document.createElement('div')
          cursorEl.className = 'block-cursor'
          cursorEl.setAttribute('aria-hidden', 'true')
          // A real DOM sibling of ProseMirror's own root, not a child of it —
          // `view.dom`'s children are strictly reconciled against the doc
          // model, and a foreign node inside it would be fought over or
          // silently removed on the next render.
          editorView.dom.parentElement?.appendChild(cursorEl)

          const update = (view: EditorView): void => {
            const { selection } = view.state
            const scrollEl = view.dom.closest<HTMLElement>('.terminal-scroll')
            if (!selection.empty || !view.hasFocus() || !scrollEl) {
              cursorEl.style.display = 'none'
              return
            }
            const pos = selection.head
            const coords = view.coordsAtPos(pos)
            const scrollRect = scrollEl.getBoundingClientRect()

            // A precise block matches the width of the character it sits in
            // front of; at a position with no next character (end of a line
            // or the document) there is nothing to measure, so fall back to
            // an approximate width rather than a zero-width sliver.
            let width = 8
            const atEnd = pos >= view.state.doc.content.size
            const nextChar = atEnd ? '' : view.state.doc.textBetween(pos, pos + 1)
            if (nextChar && nextChar !== '\n') {
              const nextCoords = view.coordsAtPos(pos + 1)
              width = Math.max(4, nextCoords.left - coords.left)
            }

            cursorEl.style.left = `${coords.left - scrollRect.left + scrollEl.scrollLeft}px`
            cursorEl.style.top = `${coords.top - scrollRect.top + scrollEl.scrollTop}px`
            cursorEl.style.width = `${width}px`
            cursorEl.style.height = `${coords.bottom - coords.top}px`
            cursorEl.style.display = 'block'
          }

          // ProseMirror's own `update` hook fires on selection/doc
          // transactions, but focus/blur can change with no transaction at
          // all (clicking away to a dialog, tabbing out) — those need their
          // own listeners so the block doesn't linger somewhere focus left.
          const onFocus = (): void => update(editorView)
          const onBlur = (): void => update(editorView)
          editorView.dom.addEventListener('focus', onFocus)
          editorView.dom.addEventListener('blur', onBlur)
          const onResize = (): void => update(editorView)
          window.addEventListener('resize', onResize)

          update(editorView)

          return {
            update,
            destroy() {
              cursorEl.remove()
              editorView.dom.removeEventListener('focus', onFocus)
              editorView.dom.removeEventListener('blur', onBlur)
              window.removeEventListener('resize', onResize)
            }
          }
        }
      })
    ]
  }
})
