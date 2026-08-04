import { useEffect, useRef, useState } from 'react'
import type { JSX, DragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent } from 'react'
import type { BinderNode, EntityType } from '../../../shared/types'
import type { DropPosition } from '../lib/tree'
import { useWyrm } from '../store'
import { CharacterIcon, DocIcon, FolderIcon, GlossaryIcon, TrashIcon, WorldIcon } from './icons'

interface MenuState {
  x: number
  y: number
  node: BinderNode | null
  inTrash: boolean
}

interface DropHint {
  id: string
  position: DropPosition
}

function RowTitle({ node }: { node: BinderNode }): JSX.Element {
  const renamingId = useWyrm((s) => s.renamingId)
  const finishRename = useWyrm((s) => s.finishRename)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renamingId === node.id) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [renamingId, node.id])

  if (renamingId !== node.id) return <span className="row-title">{node.title}</span>
  return (
    <input
      ref={inputRef}
      className="rename-input"
      defaultValue={node.title}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => void finishRename(node.id, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') void finishRename(node.id, e.currentTarget.value)
        if (e.key === 'Escape') void finishRename(node.id, node.title)
      }}
    />
  )
}

function BinderRow({
  node,
  depth,
  inTrash,
  collapsed,
  onToggle,
  onMenu,
  dropHint,
  setDropHint,
  cursorId
}: {
  node: BinderNode
  depth: number
  inTrash: boolean
  collapsed: boolean
  onToggle: (id: string) => void
  onMenu: (e: MouseEvent, node: BinderNode, inTrash: boolean) => void
  dropHint: DropHint | null
  setDropHint: (hint: DropHint | null) => void
  cursorId: string | null
}): JSX.Element {
  const activeId = useWyrm((s) => s.activeId)
  const mainView = useWyrm((s) => s.mainView)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const startRename = useWyrm((s) => s.startRename)
  const moveBinderNode = useWyrm((s) => s.moveBinderNode)
  const showFolder = useWyrm((s) => s.showFolder)

  const isFolder = node.type === 'folder'
  const isOpenFolder = isFolder && mainView.kind === 'folder' && mainView.id === node.id
  const hint = dropHint?.id === node.id ? dropHint.position : null

  const positionFor = (e: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    if (isFolder && y > 0.3 && y < 0.7) return 'inside'
    return y < 0.5 ? 'before' : 'after'
  }

  return (
    <div
      data-node-id={node.id}
      data-node-type={node.type}
      className={[
        'binder-row',
        node.id === activeId || isOpenFolder ? 'selected' : '',
        node.id === cursorId ? 'cursor' : '',
        hint ? `drop-${hint}` : ''
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: 8 + depth * 16 }}
      draggable={!inTrash}
      onClick={() => {
        if (node.type === 'doc' && !inTrash) void selectDoc(node.id)
        // F-08: the twist is the collapse/expand control now; clicking the
        // rest of a folder row opens its contents (Finder's own split, and
        // less surprising than a click doing two different things at once).
        // Trash keeps the old combined behaviour — there is no folder view
        // for a trashed folder's contents.
        if (isFolder && inTrash) onToggle(node.id)
        else if (isFolder) showFolder(node.id)
      }}
      onDoubleClick={(e) => {
        e.stopPropagation()
        if (!inTrash) startRename(node.id)
      }}
      onContextMenu={(e) => onMenu(e, node, inTrash)}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/wyrm-node', node.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
      onDragOver={(e) => {
        if (inTrash || !e.dataTransfer.types.includes('text/wyrm-node')) return
        e.preventDefault()
        setDropHint({ id: node.id, position: positionFor(e) })
      }}
      onDragLeave={() => setDropHint(null)}
      onDrop={(e) => {
        e.preventDefault()
        const dragId = e.dataTransfer.getData('text/wyrm-node')
        setDropHint(null)
        if (dragId && !inTrash) void moveBinderNode(dragId, node.id, positionFor(e))
      }}
    >
      {isFolder && (
        <span
          className={`twist${collapsed ? '' : ' open'}`}
          aria-hidden
          onClick={(e) => {
            e.stopPropagation()
            onToggle(node.id)
          }}
        >
          ▸
        </span>
      )}
      <span className="glyph">{isFolder ? <FolderIcon /> : <DocIcon />}</span>
      <RowTitle node={node} />
    </div>
  )
}

/** One story-bible collection in the binder, expanding to its entries. */
function BibleSection({
  type,
  icon,
  label
}: {
  type: EntityType
  icon: JSX.Element
  label: string
}): JSX.Element {
  // Select the stable array and derive during render: a selector that returns a
  // fresh array (.filter/.map) makes zustand's snapshot differ every read, which
  // re-renders forever.
  const allEntities = useWyrm((s) => s.entities)
  const createEntity = useWyrm((s) => s.createEntity)
  const showEntity = useWyrm((s) => s.showEntity)
  const mainView = useWyrm((s) => s.mainView)
  const [open, setOpen] = useState(false)

  const entities = allEntities.filter((e) => e.type === type)
  const sorted = [...entities].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <>
      <div className="binder-row" data-entity-type={type} onClick={() => setOpen((v) => !v)}>
        <span className={`twist${open ? ' open' : ''}`} aria-hidden>
          ▸
        </span>
        <span className="glyph">{icon}</span>
        <span className="row-title">{label}</span>
        {entities.length > 0 && <span className="entity-count">{entities.length}</span>}
      </div>
      {open && (
        <>
          {sorted.map((entity) => (
            <div
              key={entity.id}
              className={`binder-row${
                mainView.kind === 'entity' && mainView.id === entity.id ? ' selected' : ''
              }`}
              data-entity-type={type}
              style={{ paddingLeft: 8 + 16 }}
              onClick={() => showEntity(entity.id)}
            >
              <span className="glyph">{icon}</span>
              <span className="row-title">{entity.name}</span>
            </div>
          ))}
          <button
            type="button"
            className="binder-row add-entry"
            style={{ paddingLeft: 8 + 16 }}
            onClick={() => {
              void createEntity(type, 'Untitled').then((created) => {
                if (created) showEntity(created.id)
              })
            }}
          >
            <span className="row-title">+ New entry</span>
          </button>
        </>
      )}
    </>
  )
}

export function Binder(): JSX.Element {
  const project = useWyrm((s) => s.project)
  const addDoc = useWyrm((s) => s.addDoc)
  const addFolder = useWyrm((s) => s.addFolder)
  const startRename = useWyrm((s) => s.startRename)
  const moveToTrash = useWyrm((s) => s.moveToTrash)
  const restoreFromTrash = useWyrm((s) => s.restoreFromTrash)
  const activeId = useWyrm((s) => s.activeId)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const showFolder = useWyrm((s) => s.showFolder)
  const renamingId = useWyrm((s) => s.renamingId)

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)
  /** Keyboard cursor; follows the open document until the arrows move it. */
  const [cursorId, setCursorId] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  if (!project) return <div className="binder" />

  const toggle = (id: string): void =>
    setCollapsedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const openMenu = (e: MouseEvent, node: BinderNode | null, inTrash: boolean): void => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, node, inTrash })
  }

  const renderNodes = (nodes: BinderNode[], depth: number, inTrash: boolean): JSX.Element[] =>
    nodes.flatMap((node) => {
      const collapsed = collapsedIds.has(node.id)
      const row = (
        <BinderRow
          key={node.id}
          node={node}
          depth={depth}
          inTrash={inTrash}
          collapsed={collapsed}
          onToggle={toggle}
          onMenu={openMenu}
          dropHint={dropHint}
          setDropHint={setDropHint}
          cursorId={cursorId}
        />
      )
      const children =
        node.children && !collapsed ? renderNodes(node.children, depth + 1, inTrash) : []
      return [row, ...children]
    })

  /** Rows the arrows walk: the visible binder, in the order it is drawn. */
  const visibleRows = (): BinderNode[] => {
    const rows: BinderNode[] = []
    const descend = (nodes: BinderNode[]): void => {
      for (const node of nodes) {
        rows.push(node)
        if (node.children && !collapsedIds.has(node.id)) descend(node.children)
      }
    }
    descend(project.data.binder)
    return rows
  }

  const cursor = cursorId ?? activeId
  const moveCursor = (delta: number): void => {
    const rows = visibleRows()
    if (rows.length === 0) return
    const at = rows.findIndex((n) => n.id === cursor)
    const next = at === -1 ? 0 : Math.min(rows.length - 1, Math.max(0, at + delta))
    const node = rows[next]
    setCursorId(node.id)
    // Selecting as the cursor moves would open every document it passes over,
    // so movement is separate from opening (Enter) — arrowing is browsing.
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const onBinderKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    // A rename field owns every key while it is open.
    if (renamingId !== null) return
    const rows = visibleRows()
    const node = rows.find((n) => n.id === cursor)
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        moveCursor(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        moveCursor(-1)
        break
      case 'ArrowRight':
        if (!node || node.type !== 'folder') return
        e.preventDefault()
        if (collapsedIds.has(node.id)) toggle(node.id)
        else moveCursor(1)
        break
      case 'ArrowLeft':
        if (!node) return
        e.preventDefault()
        if (node.type === 'folder' && !collapsedIds.has(node.id)) toggle(node.id)
        break
      case 'Enter':
        if (!node) return
        e.preventDefault()
        // Enter opens, same as clicking a row's body (F-08) — ArrowRight
        // already covers "expand a collapsed folder to browse its children".
        if (node.type === 'doc') void selectDoc(node.id)
        else showFolder(node.id)
        break
      case 'F2':
        if (!node) return
        e.preventDefault()
        startRename(node.id)
        break
      case 'Backspace':
      case 'Delete':
        if (!node) return
        e.preventDefault()
        // Trash is reversible (and the roadmap's "nothing is ever lost"), so
        // this needs no confirmation — Restore is a right-click away.
        setCursorId(null)
        void moveToTrash(node.id)
        break
    }
  }

  return (
    <div className="binder" onContextMenu={(e) => openMenu(e, null, false)}>
      <div
        className="binder-scroll"
        ref={scrollRef}
        role="tree"
        aria-label="Binder"
        tabIndex={0}
        onKeyDown={onBinderKeyDown}
        data-cursor={cursor ?? undefined}
      >
        {renderNodes(project.data.binder, 0, false)}
        <div className="binder-sep" />
        <div className="binder-row" data-node-type="trash" onClick={() => setTrashOpen((v) => !v)}>
          <span className={`twist${trashOpen ? ' open' : ''}`} aria-hidden>
            ▸
          </span>
          <span className="glyph">
            <TrashIcon />
          </span>
          <span className="row-title">Trash</span>
        </div>
        {trashOpen && renderNodes(project.data.trash, 1, true)}
        <div className="binder-sep" />
        <BibleSection type="glossary" icon={<GlossaryIcon />} label="Glossary" />
        <BibleSection type="character" icon={<CharacterIcon />} label="Character Book" />
        <BibleSection type="world" icon={<WorldIcon />} label="World Book" />
      </div>
      <div className="binder-footer">
        <button type="button" className="btn small" onClick={() => void addDoc(null)}>
          + Doc
        </button>
        <button type="button" className="btn small" onClick={() => void addFolder(null)}>
          + Folder
        </button>
      </div>

      {menu && (
        <>
          <div
            className="menu-overlay"
            onMouseDown={() => setMenu(null)}
            onContextMenu={(e) => {
              e.preventDefault()
              setMenu(null)
            }}
          />
          <div className="menu-drop context-menu" style={{ left: menu.x, top: menu.y }} role="menu">
            {menu.inTrash && menu.node ? (
              <button
                type="button"
                role="menuitem"
                className="menu-item"
                onClick={() => {
                  void restoreFromTrash(menu.node!.id)
                  setMenu(null)
                }}
              >
                <span>Restore</span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    void addDoc(menu.node?.type === 'folder' ? menu.node.id : null)
                    setMenu(null)
                  }}
                >
                  <span>New Document</span>
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="menu-item"
                  onClick={() => {
                    void addFolder(menu.node?.type === 'folder' ? menu.node.id : null)
                    setMenu(null)
                  }}
                >
                  <span>New Folder</span>
                </button>
                {menu.node && (
                  <>
                    <div className="menu-sep" />
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        startRename(menu.node!.id)
                        setMenu(null)
                      }}
                    >
                      <span>Rename</span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="menu-item"
                      onClick={() => {
                        void moveToTrash(menu.node!.id)
                        setMenu(null)
                      }}
                    >
                      <span>Move to Trash</span>
                    </button>
                  </>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
