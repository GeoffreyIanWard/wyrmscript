import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { Node as PMNode } from '@tiptap/pm/model'
import type { Editor } from '@tiptap/core'
import { findEntityMatches, type EntityIndex } from './entities'

/**
 * Draws story-bible links in the writing terminal as ProseMirror *decorations*
 * rather than marks: auto-linking is derived from the entity index, so it must
 * never be written into the manuscript file. The page stays plain Markdown.
 */

export const entityLinkKey = new PluginKey<EntityLinkState>('wyrmEntityLinks')

interface EntityLinkState {
  decorations: DecorationSet
}

export interface EntityLinkOptions {
  /** Read the current index at scan time, so it can change without re-creating the editor. */
  getIndex: () => EntityIndex
  onClickEntity: (entityId: string) => void
  debounceMs: number
}

/**
 * Collect a textblock's plain text alongside a map back to document positions.
 * Marks split a paragraph into several text nodes, so a name written as
 * "Elara **Voss**" must still be found — hence per-block text, not per-node.
 */
function blockText(
  node: PMNode,
  blockPos: number
): {
  text: string
  segments: { textStart: number; docStart: number }[]
} {
  let text = ''
  const segments: { textStart: number; docStart: number }[] = []
  node.forEach((child, offset) => {
    segments.push({ textStart: text.length, docStart: blockPos + 1 + offset })
    // Non-text inline nodes (hard breaks) occupy one position; standing in a
    // newline keeps offsets aligned and stops matches running across the break.
    text += child.isText ? (child.text ?? '') : '\n'
  })
  return { text, segments }
}

function toDocPos(offset: number, segments: { textStart: number; docStart: number }[]): number {
  let seg = segments[0]
  for (const candidate of segments) {
    if (candidate.textStart > offset) break
    seg = candidate
  }
  return seg.docStart + (offset - seg.textStart)
}

function computeDecorations(doc: PMNode, index: EntityIndex): DecorationSet {
  if (!index.pattern) return DecorationSet.empty
  const decorations: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true
    const { text, segments } = blockText(node, pos)
    if (!text) return false
    for (const match of findEntityMatches(text, index)) {
      decorations.push(
        Decoration.inline(
          toDocPos(match.start, segments),
          toDocPos(match.end, segments),
          { class: `entity ${match.type}`, 'data-entity': match.entityId },
          { entityId: match.entityId }
        )
      )
    }
    return false
  })
  return DecorationSet.create(doc, decorations)
}

/** Force a re-scan — call after the entity index changes. */
export function refreshEntityLinks(editor: Editor | null): void {
  if (!editor || editor.isDestroyed) return
  editor.view.dispatch(editor.state.tr.setMeta(entityLinkKey, { recompute: true }))
}

export const EntityLinks = Extension.create<EntityLinkOptions>({
  name: 'wyrmEntityLinks',

  addOptions() {
    return {
      getIndex: () => ({ terms: new Map(), byId: new Map(), pattern: null, collisions: [] }),
      onClickEntity: () => {},
      debounceMs: 350
    }
  },

  addProseMirrorPlugins() {
    const { getIndex, onClickEntity, debounceMs } = this.options

    return [
      new Plugin<EntityLinkState>({
        key: entityLinkKey,

        state: {
          init: (_config, state: EditorState) => ({
            decorations: computeDecorations(state.doc, getIndex())
          }),
          apply: (tr: Transaction, value: EntityLinkState) => {
            if (tr.getMeta(entityLinkKey)) {
              return { decorations: computeDecorations(tr.doc, getIndex()) }
            }
            if (tr.docChanged) {
              // Shift existing decorations with the text until the debounced
              // re-scan lands, so links don't visibly lag behind typing.
              return { decorations: value.decorations.map(tr.mapping, tr.doc) }
            }
            return value
          }
        },

        // Re-scanning on every keystroke would fight the typist; the brief asks
        // for a debounce, which also keeps long scenes cheap.
        view: (editorView) => {
          let timer: ReturnType<typeof setTimeout> | null = null
          const schedule = (): void => {
            if (timer) clearTimeout(timer)
            timer = setTimeout(() => {
              timer = null
              editorView.dispatch(editorView.state.tr.setMeta(entityLinkKey, { recompute: true }))
            }, debounceMs)
          }
          return {
            update: (view, prevState) => {
              if (!view.state.doc.eq(prevState.doc)) schedule()
            },
            destroy: () => {
              if (timer) clearTimeout(timer)
            }
          }
        },

        props: {
          decorations: (state) => entityLinkKey.getState(state)?.decorations ?? DecorationSet.empty,
          handleClick: (_view, _pos, event) => {
            const target = event.target as HTMLElement | null
            const span = target?.closest?.('[data-entity]') as HTMLElement | null
            const id = span?.dataset.entity
            if (!id) return false
            onClickEntity(id)
            // Returning false lets the click also place the caret, so clicking a
            // linked name never costs the writer their place.
            return false
          }
        }
      })
    ]
  }
})
