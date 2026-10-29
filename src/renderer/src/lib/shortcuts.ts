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
  /** Keys that mean this in one view only, so another view's group may use
   *  the same key for something else there. Never a key the app answers to
   *  everywhere. */
  view?: boolean
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
      { keys: '⇧⌘X', what: 'Move the selection to the scratch pad' },
      { keys: '⌘S', what: 'Create a save point' },
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
    title: 'On the corkboard',
    view: true,
    items: [
      { keys: '⌥⌘N', what: 'Add a card' },
      { keys: '← → ↑ ↓', what: 'To the nearest card that way' },
      { keys: '⌥ + arrows', what: 'Nudge the card (⇧ for a bigger step)' },
      { keys: 'Return', what: 'Open the card, or pin it with the string tool up' },
      { keys: '⇧Return', what: 'Turn a scene card over' },
      { keys: 'Delete', what: 'Pull the focused pin, with the string tool up' }
    ]
  },
  {
    title: 'Combining changes',
    view: true,
    items: [
      { keys: 'Tab', what: 'Between the stacks and the page' },
      { keys: '↑ ↓', what: 'To the next card, or move the cursor with a card in hand' },
      { keys: 'Return', what: 'Pick up the card, or put it at the cursor (Esc puts it back)' },
      { keys: 'Delete', what: 'Into the bin' },
      { keys: 'S', what: 'Onto the scratch pad' }
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
      { keys: '⇧⌘S', what: 'Writing stats' },
      { keys: '⌘Q', what: 'Quit, saving everything first' }
    ]
  }
]

/** Flat, for anything that needs to look one up or check coverage. */
export const ALL_SHORTCUTS: Shortcut[] = SHORTCUT_GROUPS.flatMap((g) => g.items)
