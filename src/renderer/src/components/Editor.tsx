import { useEffect, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import type { EntityType } from '../../../shared/types'
import { markdownToDoc } from '../lib/markdown'
import { EntityLinks } from '../lib/entityLinks'
import { ENTITY_COLLECTIONS } from '../lib/entities'
import { useWyrm } from '../store'
import { NewEntityDialog } from './EntityPanel'

interface AddMenu {
  x: number
  y: number
  selection: string
}

/**
 * The writing terminal. Deliberately quiet: no spellcheck, no suggestions,
 * no toolbar. Formatting is bold / italic / highlight only (§3 of the brief).
 */
export function Editor(): JSX.Element {
  const activeId = useWyrm((s) => s.activeId)
  const activeDoc = useWyrm((s) => s.activeDoc)
  const wordCount = useWyrm((s) => s.wordCount)
  const setEditor = useWyrm((s) => s.setEditor)
  const editorChanged = useWyrm((s) => s.editorChanged)
  const openEntityPanel = useWyrm((s) => s.openEntityPanel)

  const [addMenu, setAddMenu] = useState<AddMenu | null>(null)
  const [creating, setCreating] = useState<{ type: EntityType; name: string } | null>(null)

  // Recreated per document (deps: [activeId]) so undo history never crosses
  // documents — ⌘Z in one scene must not resurrect another scene's text.
  const editor = useEditor(
    {
      content: activeDoc ? markdownToDoc(activeDoc.body) : undefined,
      extensions: [
        StarterKit.configure({
          blockquote: false,
          bulletList: false,
          orderedList: false,
          listItem: false,
          listKeymap: false,
          heading: false,
          codeBlock: false,
          code: false,
          horizontalRule: false,
          strike: false,
          underline: false,
          link: false
        }),
        Highlight,
        EntityLinks.configure({
          // Read from the store at scan time so adding an entry re-links the
          // open scene without recreating the editor.
          getIndex: () => useWyrm.getState().entityIndex,
          onClickEntity: (id) => openEntityPanel(id),
          debounceMs: 350
        })
      ],
      editorProps: {
        attributes: {
          class: 'page',
          spellcheck: 'false',
          autocorrect: 'off',
          autocapitalize: 'off'
        }
      },
      onUpdate: () => editorChanged()
    },
    [activeId]
  )

  useEffect(() => {
    setEditor(editor ?? null)
    // Focus the page on doc switch — but never steal focus from an active
    // inline rename (the field would blur and the rename silently cancel).
    if (editor && !useWyrm.getState().renamingId) {
      editor.commands.focus('end')
    }
    return () => setEditor(null)
  }, [editor, setEditor])

  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selection = editor.state.doc.textBetween(from, to, ' ').trim()
    if (!selection) return // nothing selected: leave the native menu alone
    event.preventDefault()
    setAddMenu({ x: event.clientX, y: event.clientY, selection })
  }

  return (
    <div className="terminal">
      <div className="terminal-top">
        <span>{activeDoc?.meta.title ?? ''}</span>
        <span>{wordCount.toLocaleString()} words</span>
      </div>
      <div className="terminal-scroll" onContextMenu={onContextMenu}>
        <EditorContent editor={editor} className="editor-host" />
      </div>

      {addMenu && (
        <>
          <div className="menu-overlay" onMouseDown={() => setAddMenu(null)} />
          <div
            className="menu-drop context-menu"
            style={{ left: addMenu.x, top: addMenu.y }}
            role="menu"
          >
            {(['glossary', 'character', 'world'] as EntityType[]).map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  setCreating({ type, name: addMenu.selection })
                  setAddMenu(null)
                }}
              >
                <span>Add to {ENTITY_COLLECTIONS[type]}…</span>
              </button>
            ))}
          </div>
        </>
      )}

      {creating && (
        <NewEntityDialog
          type={creating.type}
          initialName={creating.name}
          onClose={() => setCreating(null)}
        />
      )}
    </div>
  )
}
