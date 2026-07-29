import { useEffect, useRef, useState } from 'react'
import type { JSX, DragEvent, MouseEvent } from 'react'
import type { BinderNode } from '../../../shared/types'
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
  setDropHint
}: {
  node: BinderNode
  depth: number
  inTrash: boolean
  collapsed: boolean
  onToggle: (id: string) => void
  onMenu: (e: MouseEvent, node: BinderNode, inTrash: boolean) => void
  dropHint: DropHint | null
  setDropHint: (hint: DropHint | null) => void
}): JSX.Element {
  const activeId = useWyrm((s) => s.activeId)
  const selectDoc = useWyrm((s) => s.selectDoc)
  const startRename = useWyrm((s) => s.startRename)
  const moveBinderNode = useWyrm((s) => s.moveBinderNode)

  const isFolder = node.type === 'folder'
  const hint = dropHint?.id === node.id ? dropHint.position : null

  const positionFor = (e: DragEvent<HTMLDivElement>): DropPosition => {
    const rect = e.currentTarget.getBoundingClientRect()
    const y = (e.clientY - rect.top) / rect.height
    if (isFolder && y > 0.3 && y < 0.7) return 'inside'
    return y < 0.5 ? 'before' : 'after'
  }

  return (
    <div
      className={['binder-row', node.id === activeId ? 'selected' : '', hint ? `drop-${hint}` : '']
        .filter(Boolean)
        .join(' ')}
      style={{ paddingLeft: 8 + depth * 16 }}
      draggable={!inTrash}
      onClick={() => {
        if (node.type === 'doc' && !inTrash) void selectDoc(node.id)
        if (isFolder) onToggle(node.id)
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
        <span className={`twist${collapsed ? '' : ' open'}`} aria-hidden>
          ▸
        </span>
      )}
      <span className="glyph">{isFolder ? <FolderIcon /> : <DocIcon />}</span>
      <RowTitle node={node} />
    </div>
  )
}

export function Binder(): JSX.Element {
  const project = useWyrm((s) => s.project)
  const addDoc = useWyrm((s) => s.addDoc)
  const addFolder = useWyrm((s) => s.addFolder)
  const startRename = useWyrm((s) => s.startRename)
  const moveToTrash = useWyrm((s) => s.moveToTrash)
  const restoreFromTrash = useWyrm((s) => s.restoreFromTrash)

  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set())
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dropHint, setDropHint] = useState<DropHint | null>(null)
  const [trashOpen, setTrashOpen] = useState(false)

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
        />
      )
      const children =
        node.children && !collapsed ? renderNodes(node.children, depth + 1, inTrash) : []
      return [row, ...children]
    })

  return (
    <div className="binder" onContextMenu={(e) => openMenu(e, null, false)}>
      <div className="binder-scroll">
        {renderNodes(project.data.binder, 0, false)}
        <div className="binder-sep" />
        <div className="binder-row" onClick={() => setTrashOpen((v) => !v)}>
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
        <div className="binder-row dim">
          <span className="glyph">
            <GlossaryIcon />
          </span>
          <span className="row-title">Glossary</span>
        </div>
        <div className="binder-row dim">
          <span className="glyph">
            <CharacterIcon />
          </span>
          <span className="row-title">Character Book</span>
        </div>
        <div className="binder-row dim">
          <span className="glyph">
            <WorldIcon />
          </span>
          <span className="row-title">World Book</span>
        </div>
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
