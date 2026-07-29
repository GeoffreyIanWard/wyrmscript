import { useState } from 'react'
import type { JSX } from 'react'
import { WyrmIcon } from './icons'

type MenuItem =
  | { kind: 'sep' }
  | { kind: 'item'; label: string; shortcut?: string; disabled?: boolean; action?: () => void }

type Menu = { title: string | JSX.Element; key: string; items: MenuItem[] }

type MenuBarProps = {
  onAbout: () => void
  onPreferences: () => void
}

export function MenuBar({ onAbout, onPreferences }: MenuBarProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)

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
        { kind: 'item', label: 'New Document', shortcut: '⌘N', disabled: true },
        { kind: 'item', label: 'New Folder', shortcut: '⇧⌘N', disabled: true },
        { kind: 'sep' },
        { kind: 'item', label: 'Commit…', shortcut: '⌘S', disabled: true },
        { kind: 'item', label: 'History', shortcut: '⌘Y', disabled: true },
        { kind: 'item', label: 'Save As Variant…', disabled: true },
        { kind: 'sep' },
        { kind: 'item', label: 'Compile Manuscript…', shortcut: '⇧⌘E', disabled: true }
      ]
    },
    {
      key: 'edit',
      title: 'Edit',
      items: [
        { kind: 'item', label: 'Undo', shortcut: '⌘Z', disabled: true },
        { kind: 'item', label: 'Redo', shortcut: '⇧⌘Z', disabled: true },
        { kind: 'sep' },
        { kind: 'item', label: 'Cut', shortcut: '⌘X', disabled: true },
        { kind: 'item', label: 'Copy', shortcut: '⌘C', disabled: true },
        { kind: 'item', label: 'Paste', shortcut: '⌘V', disabled: true },
        { kind: 'sep' },
        { kind: 'item', label: 'Bold', shortcut: '⌘B', disabled: true },
        { kind: 'item', label: 'Italic', shortcut: '⌘I', disabled: true },
        { kind: 'item', label: 'Highlight', shortcut: '⇧⌘H', disabled: true }
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
        { kind: 'item', label: 'Glossary', disabled: true },
        { kind: 'item', label: 'Character Book', disabled: true },
        { kind: 'item', label: 'World Book', disabled: true },
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
