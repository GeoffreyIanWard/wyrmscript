import type { WindowGeometry } from '../../../shared/types'

/**
 * F-41 step 4: where a project window sits, and the rules that keep it
 * reachable.
 *
 * Deliberately pure and free of the DOM. Dragging and resizing are the two
 * places where a small arithmetic slip strands a window somewhere the writer
 * cannot click — off the top of the desktop, or shrunk past the point where
 * its close box exists — and jsdom has no layout engine, so a test that went
 * through elements could not check any of it. Everything here takes numbers
 * and returns numbers, and the pointer handlers in `App.tsx` do nothing but
 * feed deltas in.
 */

export interface Size {
  width: number
  height: number
}

/** Smaller than this and the binder and the page stop being usable together. */
export const MIN_WIDTH = 420
export const MIN_HEIGHT = 260

/** The desktop's inset from the app frame, matching `.desktop`'s padding. */
export const DESKTOP_PADDING = 14

/**
 * How much of a window must stay inside the desktop horizontally. A window
 * dragged mostly off the side is fine and often useful — what must never
 * happen is losing the last grab handle, so a slice wide enough to hold the
 * close box and some title stays put.
 */
const KEEP_VISIBLE = 96

/** Title bar height; a window may never be dragged above the desktop, because
 *  the bar is the only thing you can drag it back by. */
const TITLE_BAR = 22

/** Where the nth window opens when it has no remembered position. */
export function cascadeFor(index: number, desktop: Size): WindowGeometry {
  const step = 28
  // Wrap the cascade rather than marching off the desktop: after a handful of
  // projects the offsets would otherwise put a new window past the edge.
  const offset = (index % 8) * step
  const width = Math.max(MIN_WIDTH, Math.round(desktop.width * 0.82))
  const height = Math.max(MIN_HEIGHT, Math.round(desktop.height * 0.86))
  return clampToDesktop({ x: offset, y: offset, width, height }, desktop)
}

/** A single window filling the desktop, which is what one open project gets. */
export function fullBleed(desktop: Size): WindowGeometry {
  return { x: 0, y: 0, width: desktop.width, height: desktop.height }
}

/**
 * Forces a geometry back inside the rules: never taller or wider than the
 * desktop, never smaller than the minimum, never above the top edge, and
 * never dragged so far that no grab handle is left.
 */
export function clampToDesktop(geometry: WindowGeometry, desktop: Size): WindowGeometry {
  const width = Math.min(Math.max(geometry.width, MIN_WIDTH), Math.max(desktop.width, MIN_WIDTH))
  const height = Math.min(
    Math.max(geometry.height, MIN_HEIGHT),
    Math.max(desktop.height, MIN_HEIGHT)
  )
  // The left edge may go negative — a window part-way off the side is normal —
  // but never so far that less than KEEP_VISIBLE of it remains, in either
  // direction. The top edge is hard: above it there is no title bar to drag
  // the window back by.
  const x = Math.min(Math.max(geometry.x, KEEP_VISIBLE - width), desktop.width - KEEP_VISIBLE)
  const y = Math.min(Math.max(geometry.y, 0), Math.max(desktop.height - TITLE_BAR, 0))
  return { x, y, width, height }
}

/** Drag: move the whole window, keeping its size. */
export function moveBy(
  start: WindowGeometry,
  dx: number,
  dy: number,
  desktop: Size
): WindowGeometry {
  return clampToDesktop({ ...start, x: start.x + dx, y: start.y + dy }, desktop)
}

/**
 * Resize from the bottom-right grow box: the top-left corner stays put, which
 * is what makes a grow box feel like a grow box rather than a move.
 */
export function resizeBy(
  start: WindowGeometry,
  dx: number,
  dy: number,
  desktop: Size
): WindowGeometry {
  // The cap is "the desktop edge", but it may never shrink the window. A
  // window dragged mostly off the right side is a legitimate position that
  // `clampToDesktop` allows, and its width already extends past the edge —
  // grabbing the grow box there must not yank it narrower, and must never
  // fight the minimum size either.
  const maxWidth = Math.max(start.width, desktop.width - start.x, MIN_WIDTH)
  const maxHeight = Math.max(start.height, desktop.height - start.y, MIN_HEIGHT)
  return {
    ...start,
    width: Math.min(Math.max(MIN_WIDTH, start.width + dx), maxWidth),
    height: Math.min(Math.max(MIN_HEIGHT, start.height + dy), maxHeight)
  }
}

/** Two geometries the same? Used to avoid persisting a drag that went nowhere. */
export function sameGeometry(a: WindowGeometry | undefined, b: WindowGeometry): boolean {
  return a != null && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}
