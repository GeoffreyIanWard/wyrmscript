/**
 * Guided help: what each part of WyrmStar is for.
 *
 * Turn the mode on and hovering a marked control explains it. The copy lives
 * here, in one place, rather than in `title` attributes scattered through the
 * tree — a `title` cannot be styled to match the app, does not appear on a
 * deliberate gesture, and is impossible to review as a body of writing.
 *
 * An element opts in with `data-help="<id>"`. `tests/guided-help.test.tsx`
 * reads the source for every one of those attributes and fails if the id has
 * no entry here, or if an entry here is used nowhere — an explanation that
 * explains nothing is as bad as a control with no explanation.
 *
 * What gets an entry: the things that are **WyrmStar's own** and that a
 * writer coming from another word processor would not guess. Not Save, not
 * Bold. The binder, checkpoints, variants, the board, the story bible — the
 * vocabulary this app made up.
 */
export interface HelpTopic {
  title: string
  body: string
}

export const HELP_TOPICS: Record<string, HelpTopic> = {
  binder: {
    title: 'The binder',
    body: 'Your manuscript as a tree of documents and folders. A novel is written in pieces here rather than as one long file, and the order of this list is the order of the book. Drag a row to move a scene.'
  },
  trash: {
    title: 'Trash',
    body: 'Deleted documents wait here rather than leaving. Nothing in WyrmStar is ever truly lost: even emptying this keeps the text in the project history, where it can still be recovered.'
  },
  'entity-panel': {
    title: 'The story bible',
    body: 'Characters, places and terms, each its own entry. Anything you name here is found automatically in your prose and quietly linked — the link is drawn over the text, never written into it, so your manuscript stays plain words.'
  },
  'scene-tag': {
    title: 'Marking a scene',
    body: 'Tagging a document as a scene is what puts it on the corkboard, the timeline, the plot graph and the map. They all read the same tag, so a document is a scene everywhere or nowhere.'
  },
  'doc-pins': {
    title: 'Pins',
    body: 'Small marks for your own purposes — a scene to revisit, a thread to pick up. Pins are yours and are never interpreted by the app.'
  },
  'word-count': {
    title: 'Word count',
    body: 'Words in the document you are writing. If you would rather not watch a number climb, Preferences turns every ambient counter off at once.'
  },
  'save-state': {
    title: 'Saved',
    body: 'Your words are written to disk as you type, so this rarely says anything else. Saving is not the same as a checkpoint: this is the file, a checkpoint is a moment in the history.'
  },
  'last-commit': {
    title: 'Last checkpoint',
    body: 'How long since a version of the whole project was recorded. Checkpoints happen on their own as you write, and ⌘S makes one with a note of your choosing. Any of them can be returned to.'
  },
  place: {
    title: 'Where this project lives',
    body: 'Whether this project is only on this machine, backed up to a second place, or synced with a remote. Hover the words for the actual location.'
  },
  'zoom-box': {
    title: 'Focus mode',
    body: 'Hides the binder, the story bible and everything else, leaving the page. ⌥⌘F does the same from the keyboard, and Esc comes back.'
  },
  'minimize-box': {
    title: 'Minimise',
    body: 'Puts this project down on the desktop as an icon without closing it. It keeps checkpointing, backing up and syncing while it is down there.'
  },
  corkboard: {
    title: 'The corkboard',
    body: 'Every scene as an index card. Drag a card and it stays where you put it — the board is for arranging your thinking, so a card sits where you leave it rather than snapping into a row. ⌥⌘B switches between the board and the manuscript.'
  },
  'scene-card': {
    title: 'A scene card',
    body: 'The scene, its folder, its opening and its length. Click it to start writing, and Esc brings you back to the board, to this card. Drag it to move it on the board. Moving a card does not reorder the manuscript; Apply Order does that, when you ask.'
  },
  'bible-card': {
    title: 'A character or location card',
    body: 'An entry from the story bible, on the board because you put it there. Click it to open the entry; drag it like any other card. A square pin is a character, a diamond is a location.'
  },
  'card-off': {
    title: 'Take off the board',
    body: 'Removes this card from the board and nothing else — the character or location stays in its book, and Add Card can bring it back.'
  },
  'card-turn': {
    title: 'Turn the card over',
    body: 'The folded corner turns a scene card over to its back: synopsis, act, scene type, where it happens, the conflict and who is in it — the scene outlined before a word of it is written. The corner stays dark on a card whose back has something on it.'
  },
  'card-back': {
    title: 'The back of the card',
    body: 'Every field is optional. Enter saves and turns to the next scene in the book; Shift+Enter starts a new line in the synopsis. There is no Cancel — however you close it, what you wrote is kept, and only what you changed is written, so a card you turn past leaves the scene as it was. If a save fails you can try again or close without saving. An unwritten scene shows its synopsis on the front.'
  },
  'board-add': {
    title: 'Add a card',
    body: 'A new scene, character or location — made for real, as a document in the manuscript or an entry in the story bible, with its card here. Or an entry that already exists, put on the board.'
  },
  'entity-portrait': {
    title: 'Portrait',
    body: "A picture for this character or place, kept inside the project beside the entry so it travels with it — to a backup, to GitHub, to another machine. It shows on the entry's card on the corkboard."
  },
  'board-order': {
    title: "Apply the board's order",
    body: 'Reads the scene cards row by row, left to right, and puts the scenes in that order in the manuscript — within their own folders, never across them. Every scene card ends up pinned where it sits, so the board keeps reading in the order you applied. Not offered while stacked.'
  },
  'board-undo': {
    title: 'Undo the last Apply',
    body: 'Puts back the order of the folders the last Apply changed — only those, and only the scenes still in them. Anything added, renamed, moved or synced since stays as it is, and the cards stay where they are. One step, kept until you leave the project.'
  },
  'board-string': {
    title: 'String',
    body: 'Red string between cards, pin to pin. With the tool up, click a card to push a pin in where you clicked, then click a second card to run the string. Esc pulls a waiting pin, or puts the tool down. The string follows the cards wherever they go.'
  },
  'board-pin': {
    title: 'A pin',
    body: 'One end of a string. While the string tool is up, click a pin to pull it and the string comes away with it. Pins stay put when the tool is down, so a card can still be dragged from under one.'
  },
  'board-stack': {
    title: 'Stack',
    body: 'Gathers the cards into three piles — scenes, characters, locations — each cascading so every title shows, like a hand of patience. A way of looking rather than an arrangement: Unstack puts every card back where it was. Drag a card out of its pile to keep it out.'
  },
  'board-tidy': {
    title: 'Tidy',
    body: 'Puts every card back into a grid in binder order and forgets where they were. The way back from an arrangement that has stopped helping.'
  },
  'board-tools': {
    title: "The board's tools",
    body: 'The same scenes seen other ways — a timeline, a plot graph, your plotlines, your cast and a map — pinned here because they are the same material, not five separate features. Beside them, the tools for the board itself: Add Card, Apply Order and its Undo, String, Stack and Tidy.'
  }
}

export const HELP_IDS = Object.keys(HELP_TOPICS)

/** The tip's own size, which the placement has to assume before it renders. */
export const TIP_W = 280
export const TIP_MAX_H = 170
/** Past this, a control is tall enough that its bottom edge is nowhere near
 *  the thing the writer is actually pointing at. */
const TALL = 220

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * Where to put the explanation.
 *
 * Pure for the same reason the rest of this app's geometry is: jsdom has no
 * layout engine, so this is only honestly testable away from the DOM. Three
 * rules, each of which was a tip you could not read:
 *
 * - Anchored to the **control**, not the pointer, so it holds still enough to
 *   read — except for a very tall control like the binder, where the bottom
 *   edge is nowhere near the pointer and the tip follows the cursor instead.
 * - Clamped at the right so a control near the edge does not push its own
 *   explanation off the screen.
 * - Flipped **above** the control when there is no room below, rather than
 *   running off the bottom, which is what the binder did.
 */
export function tipPosition(
  box: Box,
  pointer: { x: number; y: number },
  viewport: { width: number; height: number }
): { x: number; y: number } {
  const tall = box.height > TALL
  const anchorTop = tall ? pointer.y : box.top
  const below = tall ? pointer.y + 18 : box.top + box.height + 6
  const x = Math.max(8, Math.min(box.left, viewport.width - TIP_W - 8))
  if (below + TIP_MAX_H <= viewport.height) return { x, y: below }
  // No room below: sit above the anchor, and never above the screen either.
  return { x, y: Math.max(8, anchorTop - TIP_MAX_H - 6) }
}
