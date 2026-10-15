/**
 * Every keyboard shortcut the app answers to, in one list.
 *
 * This exists because a shortcut is currently stated in two places that can
 * disagree — the menu item that advertises it and the handler that implements
 * it — and a legend would be a third. A legend that drifts is worse than no
 * legend: it teaches a key that does nothing, and the writer blames their
 * keyboard. `tests/shortcuts-legend.test.tsx` reads the menu bar's own source
 * and fails if a `shortcut:` it advertises is missing from this list, so the
 * two cannot part company quietly.
 *
 * Several keys are deliberately *not* in any menu — ⌘Y, ⌘P, ⌥F, Esc — which
 * is the other half of why this is worth having: before the legend, nothing
 * in the app told a writer they existed.
 */
export interface Shortcut {
  /** As written on a Mac keyboard, matching the menu bar's own notation. */
  keys: string
  what: string
}

export interface ShortcutGroup {
  title: string
  items: Shortcut[]
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Writing',
    items: [
      { keys: '⌘B', what: 'Bold' },
      { keys: '⌘I', what: 'Italic' },
      { keys: '⇧⌘H', what: 'Highlight' },
      { keys: '⌘Z', what: 'Undo' },
      { keys: '⇧⌘Z', what: 'Redo' },
      { keys: '⌘S', what: 'Commit a checkpoint' },
      { keys: '⌘Y', what: 'History of this document' }
    ]
  },
  {
    title: 'Moving around',
    items: [
      { keys: '⌥⌘B', what: 'Corkboard and back' },
      { keys: '⌘K', what: 'Go to anything' },
      { keys: '⇧⌘F', what: 'Search the project' },
      { keys: 'Esc', what: 'Back, or close what is open' },
      { keys: '⌥F', what: 'Into the menu bar (F10 as well)' }
    ]
  },
  {
    title: 'The page',
    items: [
      { keys: '⌥⌘F', what: 'Focus mode' },
      { keys: '⌥⌘T', what: 'Typewriter scrolling' },
      { keys: 'F11', what: 'Full screen' },
      { keys: '⌘,', what: 'Preferences' },
      { keys: '⌘/', what: 'This list' }
    ]
  },
  {
    title: 'Project',
    items: [
      { keys: '⌘N', what: 'New document' },
      { keys: '⇧⌘N', what: 'New folder' },
      { keys: '⌘O', what: 'Open a project' },
      { keys: '⇧⌘O', what: 'Open another alongside' },
      { keys: '⇧⌘E', what: 'Compile the manuscript' },
      { keys: '⌘P', what: 'Print' },
      { keys: '⇧⌘S', what: 'Writing stats' }
    ]
  }
]

/** Flat, for anything that needs to look one up or check coverage. */
export const ALL_SHORTCUTS: Shortcut[] = SHORTCUT_GROUPS.flatMap((g) => g.items)
