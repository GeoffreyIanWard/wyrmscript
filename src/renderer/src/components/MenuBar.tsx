import { useEffect, useRef, useState } from 'react'
import type { JSX, KeyboardEvent as ReactKeyboardEvent } from 'react'
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
  onCompile: () => void
  onBackup: () => void
  onStats: () => void
  onTimeline: () => void
  onPlotGraph: () => void
  onPlotlines: () => void
  onCharacterGraph: () => void
  onSyncSettings: () => void
  onSearch: () => void
  onPalette: () => void
  focusMode: boolean
  onFocusMode: () => void
  /** Set by App to a function that moves keyboard focus into the menu bar (F-07). */
  registerFocusMenus?: (focus: () => void) => void
}

export function MenuBar({
  onAbout,
  onPreferences,
  onVersionDialog,
  onCompile,
  onBackup,
  onStats,
  onTimeline,
  onPlotGraph,
  onPlotlines,
  onCharacterGraph,
  onSyncSettings,
  onSearch,
  onPalette,
  focusMode,
  onFocusMode,
  registerFocusMenus
}: MenuBarProps): JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  /** Index of the highlighted item in the open menu; -1 when none. */
  const [activeItem, setActiveItem] = useState(-1)
  /** Which title holds the bar's single tab stop (roving tabindex). */
  const [focusedMenu, setFocusedMenu] = useState('wyrm')
  const barRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    registerFocusMenus?.(() => {
      const first = barRef.current?.querySelector<HTMLElement>('.menu-title')
      first?.focus()
    })
  }, [registerFocusMenus])
  const project = useWyrm((s) => s.project)
  const editor = useWyrm((s) => s.editor)
  const newProjectAction = (): void => {
    void useWyrm.getState().newProject('')
  }
  const hasProject = Boolean(project)
  const hasDoc = Boolean(useWyrm((s) => s.activeDoc))
  const syncMode = useWyrm((s) => s.syncStatus?.mode)
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
        { kind: 'item', label: 'About WyrmStar…', action: onAbout },
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
        {
          kind: 'item',
          label: 'Compile Manuscript…',
          shortcut: '⇧⌘E',
          disabled: !hasProject,
          action: onCompile
        }
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
        {
          kind: 'item',
          label: focusMode ? 'Exit Focus Mode' : 'Focus Mode',
          shortcut: '⌥⌘F',
          disabled: !hasProject,
          action: onFocusMode
        },
        { kind: 'sep' },
        { kind: 'item', label: 'Corkboard', disabled: true },
        {
          kind: 'item',
          label: 'Command Palette…',
          shortcut: '⌘K',
          disabled: !hasProject,
          action: onPalette
        }
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
        { kind: 'item', label: 'Writing Stats…', disabled: !hasProject, action: onStats },
        { kind: 'item', label: 'Timeline…', disabled: !hasProject, action: onTimeline },
        { kind: 'item', label: 'Plot Graph…', disabled: !hasProject, action: onPlotGraph },
        { kind: 'item', label: 'Plotlines…', disabled: !hasProject, action: onPlotlines },
        {
          kind: 'item',
          label: 'Character Graph…',
          disabled: !hasProject,
          action: onCharacterGraph
        },
        { kind: 'sep' },
        { kind: 'item', label: 'Backup…', disabled: !hasProject, action: onBackup },
        {
          kind: 'item',
          label: 'Sync Now',
          disabled: syncMode !== 'github',
          action: () => void useWyrm.getState().syncNow(true)
        },
        { kind: 'item', label: 'Sync Settings…', disabled: !hasProject, action: onSyncSettings },
        {
          kind: 'item',
          label: 'Project Search…',
          shortcut: '⇧⌘F',
          disabled: !hasProject,
          action: onSearch
        }
      ]
    }
  ]

  const runItem = (item: MenuItem): void => {
    if (item.kind !== 'item' || item.disabled) return
    setOpen(null)
    setActiveItem(-1)
    barRef.current?.querySelector<HTMLElement>('.menu-title')?.blur()
    item.action?.()
  }

  /** Enabled items only — arrow keys must skip what cannot be chosen. */
  const enabledIndexes = (key: string): number[] => {
    const menu = menus.find((m) => m.key === key)
    if (!menu) return []
    return menu.items.flatMap((item, i) => (item.kind === 'item' && !item.disabled ? [i] : []))
  }

  const openMenu = (key: string, land: 'first' | 'last' | 'none' = 'none'): void => {
    setOpen(key)
    const enabled = enabledIndexes(key)
    setActiveItem(
      land === 'first'
        ? (enabled[0] ?? -1)
        : land === 'last'
          ? (enabled[enabled.length - 1] ?? -1)
          : -1
    )
  }

  const step = (delta: number): void => {
    if (open === null) return
    const enabled = enabledIndexes(open)
    if (enabled.length === 0) return
    const at = enabled.indexOf(activeItem)
    // Wraps at both ends: a menu is a ring, not a list with dead stops.
    const next =
      at === -1
        ? delta > 0
          ? 0
          : enabled.length - 1
        : (at + delta + enabled.length) % enabled.length
    setActiveItem(enabled[next])
  }

  const siblingMenu = (delta: number): void => {
    const at = menus.findIndex((m) => m.key === open)
    if (at === -1) return
    const next = menus[(at + delta + menus.length) % menus.length]
    openMenu(next.key, 'none')
  }

  /** The WAI-ARIA menubar keys, implemented on the bar rather than invented. */
  const onBarKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (open === null) {
      const key = (e.target as HTMLElement).closest('.menu-slot')?.getAttribute('data-menu')
      if (!key) return
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        openMenu(key, 'first')
        return
      }
      // Walking the bar without opening anything is half the ARIA menubar
      // pattern; without it, F10 then → does nothing at all.
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const at = menus.findIndex((m) => m.key === key)
        const delta = e.key === 'ArrowRight' ? 1 : -1
        const next = menus[(at + delta + menus.length) % menus.length]
        setFocusedMenu(next.key)
        barRef.current?.querySelector<HTMLElement>(`[data-menu="${next.key}"] .menu-title`)?.focus()
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        step(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        step(-1)
        break
      case 'ArrowRight':
        e.preventDefault()
        siblingMenu(1)
        break
      case 'ArrowLeft':
        e.preventDefault()
        siblingMenu(-1)
        break
      case 'Home':
        e.preventDefault()
        setActiveItem(enabledIndexes(open)[0] ?? -1)
        break
      case 'End': {
        e.preventDefault()
        const enabled = enabledIndexes(open)
        setActiveItem(enabled[enabled.length - 1] ?? -1)
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const menu = menus.find((m) => m.key === open)
        if (menu && activeItem >= 0) runItem(menu.items[activeItem])
        break
      }
      case 'Escape':
        e.preventDefault()
        setOpen(null)
        setActiveItem(-1)
        break
      default: {
        // Type-ahead: jump to the next enabled item starting with that letter,
        // wrapping past the current one so repeats cycle synonyms.
        if (e.key.length !== 1 || e.metaKey || e.ctrlKey || e.altKey) return
        const menu = menus.find((m) => m.key === open)
        if (!menu) return
        const letter = e.key.toLowerCase()
        const enabled = enabledIndexes(open)
        const from = enabled.indexOf(activeItem)
        const ordered = [...enabled.slice(from + 1), ...enabled.slice(0, from + 1)]
        const hit = ordered.find((i) => {
          const item = menu.items[i]
          return item.kind === 'item' && item.label.toLowerCase().startsWith(letter)
        })
        if (hit !== undefined) {
          e.preventDefault()
          setActiveItem(hit)
        }
      }
    }
  }

  return (
    <>
      <div className="menu-bar" role="menubar" ref={barRef} onKeyDown={onBarKeyDown}>
        {menus.map((menu) => (
          <div
            key={menu.key}
            className="menu-slot"
            data-menu={menu.key}
            onMouseEnter={() => open !== null && openMenu(menu.key, 'none')}
          >
            <button
              type="button"
              role="menuitem"
              aria-haspopup="menu"
              aria-expanded={open === menu.key}
              aria-label={menu.key === 'wyrm' ? 'WyrmStar menu' : undefined}
              // Roving tabindex: the bar is one tab stop, arrows move within.
              tabIndex={menu.key === focusedMenu ? 0 : -1}
              onFocus={() => setFocusedMenu(menu.key)}
              className={`menu-title${menu.key === 'wyrm' ? ' wyrm-mark' : ''}${open === menu.key ? ' open' : ''}`}
              onMouseDown={() => (open === menu.key ? setOpen(null) : openMenu(menu.key, 'none'))}
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
                      data-active={i === activeItem ? 'true' : undefined}
                      className={`menu-item${item.disabled ? ' disabled' : ''}${i === activeItem ? ' active' : ''}`}
                      onMouseEnter={() => !item.disabled && setActiveItem(i)}
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
