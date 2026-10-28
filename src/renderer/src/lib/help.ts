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
  'save-location': {
    title: 'A place your work is kept',
    body: 'The top card is the default. Drag a card, or press ⌥↑ and ⌥↓ on it, to change the order. This computer is always here; the others can be removed, and removing one never deletes the copy.'
  },
  'resolve-conflicts': {
    title: 'Resolve',
    body: 'Looks again for passages changed one way here and another way on your other computer, and opens them side by side so you can choose. Nothing is lost while they wait: both versions are kept.'
  },
  'save-removable': {
    title: 'Removable drive',
    body: 'A card or a stick that is not always plugged in. Saves skip it while it is out, and its envelope is dashed, not an alarm. A drive that is not removable should always be there, so if it goes missing its envelope is marked !.'
  },
  'save-add-location': {
    title: 'Add Location',
    body: 'Keep another copy on a drive, a card, or GitHub. Up to three places, counting this computer.'
  },
  'save-multiple': {
    title: 'Save to multiple locations',
    body: 'Turning this off stops saving everywhere but the default. This computer always stays, and the copies already made are left where they are.'
  },
  'save-now': {
    title: 'Save Now',
    body: 'Makes a save point, then copies it to every location. A drive that is not connected is skipped.'
  },
  'broken-connection': {
    title: 'Broken connection',
    body: 'This location could not be reached. Point at it to see why.'
  },
  'exit-full-screen': {
    title: 'Exit Full Screen',
    body: 'Back to the ordinary window. F11 or View → Full Screen does the same.'
  },
  trash: {
    title: 'Trash',
    body: 'Deleted documents wait here rather than leaving. Nothing in WyrmStar is ever truly lost: even emptying this keeps the text in the project history, where it can still be recovered.'
  },
  'scratch-pad': {
    title: 'Scratch Pad',
    body: 'Text you want to keep but not in the book: passages moved here with Edit → Move to Scratch Pad (⇧⌘X), and notes. It is never compiled, counted or put on the corkboard, but Find in Project searches it. The number is how many scraps are on it.'
  },
  'scratch-pad-view': {
    title: 'The scratch pad',
    body: 'Each sheet is one scrap, newest on top, saying where it came from and when. Write on any of them, and copy from them back onto the page: bold, italic and highlight come with the text. Esc goes back to where you were.'
  },
  'scratch-new-note': {
    title: 'New Note',
    body: 'A blank sheet at the top of the pad, to write on. A note left without a word in it is not kept.'
  },
  'scratch-go-to': {
    title: 'Go to the chapter',
    body: 'Opens the document this scrap was cut from, to put it back. Shown while that document is still in the binder.'
  },
  'scratch-throw-away': {
    title: 'Throw Away',
    body: 'Takes the scrap off the pad, after asking. A save point is made first, so its text stays in the project’s history.'
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
  'save-line': {
    title: 'Where your work is saved',
    body: 'One envelope for each place your work is kept, the default first, then how long since it was saved. A filled envelope holds your latest save; an empty one is behind; a dashed one is a drive that is not connected; one marked ! needs you. Point at an envelope to see why. Click an envelope to open its card, or the time to open Save To.'
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
    body: 'The scene, its folder, its opening and its length. Click it to start writing, and Esc brings you back to the board, to this card. Drag it to move it on the board, or from the keyboard: arrows go to the nearest card, ⌥+arrows nudge it, ⇧Return turns it over. Moving a card does not reorder the manuscript; Apply Order does that, when you ask.'
  },
  'map-card': {
    title: 'A map card',
    body: 'One of your maps, shrunk to a card: put it on the board with Add Card, drag it anywhere, and run strings from it to the scenes and people it matters to. Click it to open that map.'
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
    body: 'The bent corner turns a scene card over to its back: synopsis, act, scene type, where it happens, the conflict and who is in it — the scene outlined before a word of it is written. A card whose back has something on it shows a line or two of writing on its turned-up corner. The back has the same corner, to turn it back.'
  },
  'card-turn-back': {
    title: 'Turn back to the front',
    body: 'The corner of the back, bent up like the front’s: click it to turn the card back over. What you wrote is kept — every way off the back saves it.'
  },
  'card-back': {
    title: 'The back of the card',
    body: 'Every field is optional. Enter saves and turns to the next scene in the book; Shift+Enter starts a new line in the synopsis. There is no Cancel — however you close it, what you wrote is kept, and only what you changed is written, so a card you turn past leaves the scene as it was. If a save fails you can try again or close without saving. An unwritten scene shows its synopsis on the front.'
  },
  'world-map': {
    title: 'The world map',
    body: "Your World Book's places, laid out. Drag the map to move around it, or scroll. It is as big as you need: More map adds room on any side, and nothing already on it moves. Esc goes back to where you were."
  },
  'map-places': {
    title: 'Places',
    body: 'Every World Book entry is a place. Place puts one on the map, in the middle of what you are looking at; click a placed one to find it on the map. Remove takes it off the map and leaves the entry alone.'
  },
  'map-pin': {
    title: 'A place on the map',
    body: 'A place, drawn as a pin or as a stamp (Show as… in the list changes which). Drag it to move it, or Option and the arrow keys (Shift for a bigger step). Click it, or Return, to open the place — Esc brings you back to the map, just as you left it. When it is a stamp, [ and ] size it while it has focus.'
  },
  'map-zoom': {
    title: 'Zoom',
    body: 'Half size, actual size or double. Only whole and half steps, so the drawing stays crisp; the middle of what you are looking at stays in the middle.'
  },
  'map-draw': {
    title: 'Drawing the map',
    body: 'Every tool but the Hand draws point by point: click to put each point down. Land and Area are outlines — click the first point (or press Return) to close one. Border, River, Road, Railway and Wall are lines — Return finishes one; a river bends through its points. Backspace takes the last point back; Esc drops the shape. From the keyboard, Option and the arrows move a cursor and Space puts a point down. Dragging still moves the map, and pins stay out of the way while you draw. The Hand selects a shape to change it: drag a corner (or Option and the arrows), click a dotted dot to add one, Delete to take one out, or Delete on the shape to remove it.'
  },
  'map-marks': {
    title: 'Stamps and labels',
    body: 'Stamps opens a palette of mountains, mesas, woods, waterfalls, ships, castles, ruins and more, grouped by kind: choose one, and each click on the map puts one down (or Space at the keyboard cursor). Label puts words anywhere — a sea, a region — typed in place: Return keeps them, Esc drops them. With the Hand, drag a stamp or a label to move it (or Option and the arrows), [ and ] to size it, and Delete to take it off. To name anything — a coast, a river, a forest — choose it with the Hand and press Return again, or double-click it.'
  },
  'map-place-style': {
    title: 'Show as',
    body: 'How this place is drawn on the map: a pin, or any stamp — a castle for a castle, a city for a city — at the size you choose here. It still opens its World Book entry when clicked, and still moves when dragged. To size a stamped place on the map itself, Tab to it (or Find it in this list) and press [ or ].'
  },
  'map-scale': {
    title: 'Scale and travel',
    body: 'What a distance on the map is in your story — miles, leagues, days’ sail — and how far a day’s travel goes on foot, on horseback and by ship. Set it from a route you have just measured between two places whose distance you know, or from one square of the grid. Then Measure tells you how far a route is, and how long it takes.'
  },
  'plot-graph-acts': {
    title: 'Scenes in each act',
    body: 'How many scenes each act has, from the Act on the back of every scene card — so a crowded act and a thin one show at a glance. On the graph, each run of scenes in one act is ruled off and named.'
  },
  'map-scenes': {
    title: 'Scenes here',
    body: 'How many scenes happen at this place, from where each scene card says it happens (the back of the card). A scene set somewhere inside a place with no pin of its own on this map counts at the place it is inside. Click to list them; click one to start writing it.'
  },
  'map-tabs': {
    title: 'Maps',
    body: 'Every map in this story, as folder tabs: the world, a city, a coast drawn closer. Click one to see it, or use the arrow keys along them; double-click to rename it. + makes a new map. Each map has its own size, scale, drawing and places — and a place can be on as many maps as it stands on.'
  },
  'map-sheet-actions': {
    title: 'This map',
    body: 'Rename the map in view, clear everything off it, or delete it (not World, which is cleared instead). Clearing and deleting ask first, keep the places in the World Book, and make a checkpoint before they do anything, so the map can be got back from History.'
  },
  'map-export': {
    title: 'Export map image',
    body: 'A clean copy of the map for the book: black on white whatever the palette, with none of the tools on it. PNG is a picture drawn at print size; SVG stays sharp at any size. To put the map at the front of the book itself, tick Map at the front when you compile to .docx or PDF.'
  },
  'map-size': {
    title: 'Size',
    body: 'How large a stamp or a label is drawn: small, medium, large or extra large. With a stamp or Label in hand it sets the size of the next one; with a stamp or label chosen, it changes that one.'
  },
  'map-grow': {
    title: 'More map',
    body: 'Adds room on that side. Growing north or west moves the edge of the map, not the places on it.'
  },
  'board-add': {
    title: 'Add a card',
    body: 'A new scene, character or location — made for real, as a document in the manuscript or an entry in the story bible, with its card here. Or an entry that already exists, put on the board. ⌥⌘N opens this from anywhere.'
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
    body: 'String between cards, pin to pin, in the colour chosen beside it. With the tool up, click a card to push a pin in where you clicked, then click a second card to run the string — or press Return on each, which pins at the top. Esc pulls a waiting pin, or puts the tool down. The string follows the cards wherever they go. After the second pin, give it a label, or Return to leave it plain. Between two characters it is a relationship, and goes in the Character Graph — so it needs a name.'
  },
  'board-colour': {
    title: 'Colour',
    body: 'Red, blue, orange, yellow or green — the colour of the next string and the next sticker. What each colour means is yours to decide. A string already up changes colour from its label field. On a one-colour screen the five are told apart by their dashes instead.'
  },
  'board-sticker-tool': {
    title: 'Sticker',
    body: 'Pick a star, a heart, a dot, a question mark, an exclamation mark, a tick, a cross or an arrow, then click anywhere to stick one down — on the cork, or on a card, where it goes wherever the card goes. Each lands a little crooked, as a sticker put down by hand does. Press the button again, or Esc, to put the sheet away.'
  },
  'board-sticker': {
    title: 'A sticker',
    body: 'Drag it to move it. Let go over a card and it sticks to that card; over the cork, it stays where you left it. Tab to it and press Delete to peel it off.'
  },
  'string-label': {
    title: "A string's label",
    body: 'What the string means, on a tag at its middle. Click it with the string tool up to change it. Between two characters a string is a relationship from the Character Graph, labelled with what one is to the other, and the arrow shows which way it reads; change it here and it changes there.'
  },
  'board-pin': {
    title: 'A pin',
    body: 'One end of a string. While the string tool is up, click a pin to pull it and the string comes away with it — or Tab to it and press Delete. Pins stay put when the tool is down, so a card can still be dragged from under one.'
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
