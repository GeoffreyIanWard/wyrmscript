import { useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Highlight from '@tiptap/extension-highlight'
import type { Entity } from '../../../shared/types'
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

/** F-30: hovering an auto-linked mention. Reveal is delayed so passing the
 *  mouse over a name mid-sentence doesn't flash a tooltip on every read. */
const HOVER_DELAY_MS = 400

interface HoverTip {
  entityId: string
  x: number
  y: number
}

/**
 * F-30: pins/tags for the hovered entity, positioned just under the mention.
 * `pointer-events: none` (see `retro.css`) so it can never itself be
 * hovered, clicked, or steal focus — informational only, per the page-is-
 * sacred house rule. Suppressed entirely when the entity carries neither,
 * same "only what is set is listed" discipline as the side panel (F-31).
 */
function EntityHoverTip({
  tip,
  entities
}: {
  tip: HoverTip
  entities: Entity[]
}): JSX.Element | null {
  const entity = entities.find((e) => e.id === tip.entityId)
  const tags = entity?.tags ?? []
  const pins = entity?.pins ?? []
  if (!entity || (tags.length === 0 && pins.length === 0)) return null
  return (
    <div className="entity-hover-tip" style={{ left: tip.x, top: tip.y }} aria-hidden>
      {tags.length > 0 && (
        <div className="entity-tags">
          {tags.map((tag) => (
            <span key={tag} className="tag-chip on-paper">
              #{tag}
            </span>
          ))}
        </div>
      )}
      {pins.length > 0 && (
        <div className="entity-tags">
          {pins.map((pin) => (
            <span key={pin} className="pin-toggle on">
              {pin}
            </span>
          ))}
        </div>
      )}
    </div>
  )
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
  const entities = useWyrm((s) => s.entities)

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

  return (
    <div className="terminal">
      <div className="terminal-chrome">
        <div className="terminal-top">
          <span>{activeDoc?.meta.title ?? ''}</span>
          {showCounter && <span>{wordCount.toLocaleString()} words</span>}
        </div>
        <DocMetaBar />
      </div>
      {/* Keyed by document: the context menu, "add to bible" flow and hover
          tooltip are all transient UI tied to one document's screen content.
          Remounting on switch resets them for free — no manual "is this
          still valid" reset logic needed, and no stale tooltip pointing at a
          mention from the document just left. */}
      <TerminalContent key={activeId} editor={editor} entities={entities} />
    </div>
  )
}

function TerminalContent({
  editor,
  entities
}: {
  editor: ReturnType<typeof useEditor>
  entities: Entity[]
}): JSX.Element {
  const [addMenu, setAddMenu] = useState<AddMenu | null>(null)
  const [creating, setCreating] = useState<{ type: EntityType; name: string } | null>(null)
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current)
    }
  }, [])

  const onContextMenu = (event: MouseEvent<HTMLDivElement>): void => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const selection = editor.state.doc.textBetween(from, to, ' ').trim()
    if (!selection) return // nothing selected: leave the native menu alone
    event.preventDefault()
    setAddMenu({ x: event.clientX, y: event.clientY, selection })
  }

  // F-30: delegated rather than attached per-mention, since entity links are
  // redrawn on every re-scan (`lib/entityLinks.ts`) and per-node listeners
  // would need re-binding on each pass.
  const onMouseOver = (event: MouseEvent<HTMLDivElement>): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-entity]')
    const entityId = target?.dataset.entity
    if (!entityId || hoverTip?.entityId === entityId) return
    const entity = entities.find((e) => e.id === entityId)
    // Nothing to show — never start a timer for a reveal that would be empty.
    if (!entity || ((entity.tags?.length ?? 0) === 0 && (entity.pins?.length ?? 0) === 0)) return
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    const rect = target.getBoundingClientRect()
    hoverTimer.current = setTimeout(() => {
      hoverTimer.current = null
      setHoverTip({ entityId, x: rect.left, y: rect.bottom + 4 })
    }, HOVER_DELAY_MS)
  }

  const onMouseOut = (event: MouseEvent<HTMLDivElement>): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-entity]')
    if (!target) return
    // Moving within the same mention (e.g. onto a child node) isn't leaving it.
    const related = event.relatedTarget as Node | null
    if (related && target.contains(related)) return
    if (hoverTimer.current) {
      clearTimeout(hoverTimer.current)
      hoverTimer.current = null
    }
    // Dismisses instantly, no fade — informational only, per the page-is-sacred
    // house rule; it must never linger once the mouse has moved on.
    setHoverTip(null)
  }

  return (
    <>
      <div
        className="terminal-scroll"
        onContextMenu={onContextMenu}
        onMouseOver={onMouseOver}
        onMouseOut={onMouseOut}
      >
        <EditorContent editor={editor} className="editor-host" />
      </div>
      {hoverTip && <EntityHoverTip tip={hoverTip} entities={entities} />}

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
    </>
  )
}
