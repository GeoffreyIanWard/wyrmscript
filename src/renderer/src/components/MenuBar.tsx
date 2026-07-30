import { useState } from 'react'
import type { JSX } from 'react'
import type { EntityType } from '../../../shared/types'
import { useWyrm } from '../store'
import { WyrmIcon } from './icons'

type MenuItem =
  | { kind: 'sep' }
  | { kind: 'item'; label: string; shortcut?: string; disabled?: boolean; action?: () => void }

type Menu = { title: string | JSX.Element; key: string; items: MenuItem[] }

type MenuBarProps = {
  onAbout: () => void
  onPreferences: () => void
  onVersionDialog: (dialog: 'commit' | 'history' | 'variants') => void
}

export function MenuBar({ onAbout, onPreferences, onVersionDialog }: MenuBarProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  const project = useWyrm((s) => s.project)
  const editor = useWyrm((s) => s.editor)
  const newProjectAction = (): void => {
    void useWyrm.getState().newProject('')
  }
  const hasProject = Boolean(project)
  const hasDoc = Boolean(useWyrm((s) => s.activeDoc))
  const createEntry = (type: EntityType): void => {
    const state = useWyrm.getState()
    void state.createEntity(type, 'Untitled').then((created) => {
      if (created) state.showEntity(created.id)
    })
  }

  const menus: Menu[] = [
    {
      key: 'wyrm',
      title: <WyrmIcon />,
      items: [
        { kind: 'item', label: 'About Wyrmscript…', action: onAbout },
        { kind: 'sep' },
        { kind: 'item', label: 'Preferences…', shortcut: '⌘,', action: onPreferences }
      ]
    },
    {
      key: 'file',
      title: 'File',
      items: [
        {
          kind: 'item',
          label: 'New Document',
          shortcut: '⌘N',
          disabled: !hasProject,
          action: () => void useWyrm.getState().addDoc(null)
        },
        {
          kind: 'item',
          label: 'New Folder',
          shortcut: '⇧⌘N',
          disabled: !hasProject,
          action: () => void useWyrm.getState().addFolder(null)
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Commit Checkpoint…',
          shortcut: '⌘S',
          disabled: !hasProject,
          action: () => onVersionDialog('commit')
        },
        {
          kind: 'item',
          label: 'History',
          shortcut: '⌘Y',
          disabled: !hasDoc,
          action: () => onVersionDialog('history')
        },
        {
          kind: 'item',
          label: 'Variants…',
          disabled: !hasDoc,
          action: () => onVersionDialog('variants')
        },
        { kind: 'sep' },
        { kind: 'item', label: 'New Project…', action: newProjectAction },
        {
          kind: 'item',
          label: 'Open Project…',
          shortcut: '⌘O',
          action: () => void useWyrm.getState().openProject()
        },
        { kind: 'sep' },
        { kind: 'item', label: 'Compile Manuscript…', shortcut: '⇧⌘E', disabled: true }
      ]
    },
    {
      key: 'edit',
      title: 'Edit',
      items: [
        {
          kind: 'item',
          label: 'Undo',
          shortcut: '⌘Z',
          disabled: !hasDoc,
          action: () => editor?.chain().focus().undo().run()
        },
        {
          kind: 'item',
          label: 'Redo',
          shortcut: '⇧⌘Z',
          disabled: !hasDoc,
          action: () => editor?.chain().focus().redo().run()
        },
        { kind: 'sep' },
        {
          kind: 'item',
          label: 'Bold',
          shortcut: '⌘B',
          disabled: !hasDoc,
          action: () => editor?.chain().focus().toggleBold().run()
        },
        {
          kind: 'item',
          label: 'Italic',
          shortcut: '⌘I',
          disabled: !hasDoc,
          action: () => editor?.chain().focus().toggleItalic().run()
        },
        {
          kind: 'item',
          label: 'Highlight',
          shortcut: '⇧⌘H',
          disabled: !hasDoc,
          action: () => editor?.chain().focus().toggleHighlight().run()
        }
      ]
    },
    {
      key: 'view',
      title: 'View',
      items: [
        { kind: 'item', label: 'Typewriter Scrolling', disabled: true },
        { kind: 'item', label: 'Composition Mode', shortcut: '⌥⌘F', disabled: true },
        { kind: 'sep' },
        { kind: 'item', label: 'Corkboard', disabled: true },
        { kind: 'item', label: 'Command Palette…', shortcut: '⌘K', disabled: true }
      ]
    },
    {
      key: 'project',
      title: 'Project',
      items: [
        {
          kind: 'item',
          label: 'New Glossary Entry…',
          disabled: !hasProject,
          action: () => createEntry('glossary')
        },
        {
          kind: 'item',
          label: 'New Character…',
          disabled: !hasProject,
          action: () => createEntry('character')
        },
        {
          kind: 'item',
          label: 'New World Entry…',
          disabled: !hasProject,
          action: () => createEntry('world')
        },
        { kind: 'sep' },
        { kind: 'item', label: 'Sync Now', disabled: true },
        { kind: 'item', label: 'Project Search…', shortcut: '⇧⌘F', disabled: true }
      ]
    }
  ]

  const runItem = (item: MenuItem): void => {
    if (item.kind !== 'item' || item.disabled) return
    setOpen(null)
    item.action?.()
  }

  return (
    <>
      <div className="menu-bar">
        {menus.map((menu) => (
          <div
            key={menu.key}
            className="menu-slot"
            onMouseEnter={() => open !== null && setOpen(menu.key)}
          >
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={open === menu.key}
              aria-label={menu.key === 'wyrm' ? 'Wyrmscript menu' : undefined}
              className={`menu-title${menu.key === 'wyrm' ? ' wyrm-mark' : ''}${open === menu.key ? ' open' : ''}`}
              onMouseDown={() => setOpen(open === menu.key ? null : menu.key)}
            >
              {menu.title}
            </button>
            {open === menu.key && (
              <div className="menu-drop" role="menu">
                {menu.items.map((item, i) =>
                  item.kind === 'sep' ? (
                    <div key={i} className="menu-sep" />
                  ) : (
                    <button
                      key={i}
                      type="button"
                      role="menuitem"
                      disabled={item.disabled}
                      className={`menu-item${item.disabled ? ' disabled' : ''}`}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        runItem(item)
                      }}
                    >
                      <span>{item.label}</span>
                      {item.shortcut && <span className="shortcut">{item.shortcut}</span>}
                    </button>
                  )
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      {open !== null && <div className="menu-overlay" onMouseDown={() => setOpen(null)} />}
    </>
  )
}
