import { useEffect, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import { DOC_PINS, SCENE_TAG, type EntityType } from '../../../shared/types'
import { markdownToDoc } from '../lib/markdown'
import { EntityLinks } from '../lib/entityLinks'
import { BlockCursor } from '../lib/blockCursor'
import { ENTITY_COLLECTIONS } from '../lib/entities'
import { addTag, removeTag, togglePin } from '../lib/tags'
import { useWyrm } from '../store'
import { NewEntityDialog } from './EntityPanel'

interface AddMenu {
  x: number
  y: number
  selection: string
}

/**
 * Tags and pins for the active document (F-10). Tags are free-form (the
 * writer types one and presses Enter); pins toggle membership in the closed
 * `DOC_PINS` vocabulary via a small dropdown, the same visual language as
 * the editor's own "add to bible" context menu. `SCENE_TAG` is still just a
 * tag underneath (F-10's design), but a plain checkbox is a much more
 * discoverable way to answer "is this a scene?" than typing the word
 * "scene" into free text — so it gets its own control and is hidden from
 * the ordinary tag-chip list rather than shown twice.
 */
function DocMetaBar(): JSX.Element | null {
  const activeDoc = useWyrm((s) => s.activeDoc)
  const updateDocMeta = useWyrm((s) => s.updateDocMeta)
  const [tagInput, setTagInput] = useState('')
  const [pinMenuOpen, setPinMenuOpen] = useState(false)

  if (!activeDoc) return null
  const tags = activeDoc.meta.tags ?? []
  const pins = activeDoc.meta.pins ?? []
  const isScene = tags.includes(SCENE_TAG)
  const otherTags = tags.filter((t) => t !== SCENE_TAG)

  return (
    <div className="doc-meta-bar">
      <button
        type="button"
        role="checkbox"
        aria-checked={isScene}
        className={isScene ? 'scene-toggle on' : 'scene-toggle'}
        onClick={() =>
          void updateDocMeta({
            tags: isScene ? removeTag(tags, SCENE_TAG) : addTag(tags, SCENE_TAG)
          })
        }
      >
        [{isScene ? 'x' : ' '}] Scene
      </button>
      {pins.map((pin) => (
        <span key={pin} className="pin-chip">
          {pin}
        </span>
      ))}
      {otherTags.map((tag) => (
        <span key={tag} className="tag-chip">
          #{tag}
          <button
            type="button"
            aria-label={`Remove tag ${tag}`}
            onClick={() => void updateDocMeta({ tags: removeTag(tags, tag) })}
          >
            x
          </button>
        </span>
      ))}
      <input
        className="tag-input"
        placeholder="+ tag"
        value={tagInput}
        onChange={(e) => setTagInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return
          e.preventDefault()
          if (!tagInput.trim()) return
          void updateDocMeta({ tags: addTag(tags, tagInput) })
          setTagInput('')
        }}
      />
      <span className="spacer" />
      <div className="pin-menu-anchor">
        <button type="button" className="btn small" onClick={() => setPinMenuOpen((v) => !v)}>
          + Pin
        </button>
        {pinMenuOpen && (
          <>
            <div className="menu-overlay" onMouseDown={() => setPinMenuOpen(false)} />
            <div className="menu-drop pin-menu" role="menu">
              {DOC_PINS.map((pin) => (
                <button
                  key={pin}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={pins.includes(pin)}
                  className="menu-item"
                  onClick={() => void updateDocMeta({ pins: togglePin(pins, pin) })}
                >
                  <span>
                    [{pins.includes(pin) ? 'x' : ' '}] {pin}
                  </span>
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * The writing terminal. Deliberately quiet: no spellcheck, no suggestions,
 * no toolbar. Formatting is bold / italic / highlight only (§3 of the brief).
 */
export function Editor(): JSX.Element {
  const activeId = useWyrm((s) => s.activeId)
  const activeDoc = useWyrm((s) => s.activeDoc)
  const wordCount = useWyrm((s) => s.wordCount)
  // See StatsSettings.showCounter — the ambient counters hide together.
  const showCounter = useWyrm((s) => s.statsSettings?.showCounter) ?? true
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
        BlockCursor,
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
      <div className="terminal-chrome">
        <div className="terminal-top">
          <span>{activeDoc?.meta.title ?? ''}</span>
          {showCounter && <span>{wordCount.toLocaleString()} words</span>}
        </div>
        <DocMetaBar />
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
