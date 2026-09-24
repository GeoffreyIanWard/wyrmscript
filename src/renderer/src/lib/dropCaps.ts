import { Extension } from '@tiptap/core'
import { Plugin } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'

/**
 * F-15: marks the paragraphs that get an illuminated capital.
 *
 * The rule is the writer's, not ours: the opening paragraph always gets one,
 * and so does any paragraph that follows a deliberate gap — an empty
 * paragraph, which is what an extra blank line becomes now that authored
 * spacing survives the round trip (see `markdown.ts`). So a writer sprinkles
 * as many or as few as they like by pressing Return an extra time, and never
 * has to learn a syntax for it.
 *
 * A decoration rather than CSS, because the rule is structural and CSS cannot
 * express it: `p:empty + p` fails outright, since ProseMirror renders an
 * empty paragraph as `<p><br></p>` rather than a genuinely empty element.
 *
 * Runs for every palette and is gated entirely in CSS — the same reasoning as
 * F-23's block cursor. Recreating the editor on a palette switch would throw
 * away undo history, and the decoration is cheap; `.page p` only grows a drop
 * cap under `[data-palette='manuscript']`.
 */
export const DropCaps = Extension.create({
  name: 'wyrmDropCaps',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          decorations(state: EditorState) {
            const decorations: Decoration[] = []
            let previousWasEmpty = false
            let seenText = false

            state.doc.forEach((node, offset) => {
              if (node.type.name !== 'paragraph') return
              const isEmpty = node.content.size === 0

              if (!isEmpty) {
                // The first paragraph with words in it opens the manuscript,
                // even if blank lines happen to precede it.
                if (!seenText || previousWasEmpty) {
                  decorations.push(
                    Decoration.node(offset, offset + node.nodeSize, { class: 'drop-cap' })
                  )
                }
                seenText = true
              }

              previousWasEmpty = isEmpty
            })

            return DecorationSet.create(state.doc, decorations)
          }
        }
      })
    ]
  }
})
