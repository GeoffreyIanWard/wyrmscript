import { describe, expect, it } from 'vitest'
import {
  MIN_HEIGHT,
  MIN_WIDTH,
  cascadeFor,
  clampToDesktop,
  fullBleed,
  moveBy,
  resizeBy,
  sameGeometry
} from '../src/renderer/src/lib/windowGeometry'

/**
 * F-41 step 4: the arithmetic behind dragging and resizing a project window.
 *
 * The failure this is really guarding against is a window the writer cannot
 * get back. Dragged above the top edge there is no title bar left to grab;
 * dragged far enough sideways there is nothing to grab either; resized small
 * enough the close box stops existing. None of those are recoverable by the
 * writer, and all of them are one sign error away.
 *
 * Pure numbers, deliberately — jsdom has no layout engine, so a test that
 * went through real elements could not check any of this.
 */

const DESKTOP = { width: 1000, height: 800 }

describe('clamping', () => {
  it('keeps a window inside the desktop', () => {
    const g = clampToDesktop({ x: 10, y: 10, width: 400, height: 300 }, DESKTOP)

    expect(g).toEqual({ x: 10, y: 10, width: Math.max(400, MIN_WIDTH), height: 300 })
  })

  it('never lets a window go above the top edge', () => {
    // Above the desktop there is no title bar to drag it back by.
    expect(clampToDesktop({ x: 10, y: -200, width: 500, height: 300 }, DESKTOP).y).toBe(0)
  })

  it('never lets a window drop entirely below the desktop', () => {
    const g = clampToDesktop({ x: 10, y: 5000, width: 500, height: 300 }, DESKTOP)

    expect(g.y).toBeLessThan(DESKTOP.height)
  })

  it('leaves a grabbable strip when dragged off the left', () => {
    const g = clampToDesktop({ x: -100000, y: 10, width: 500, height: 300 }, DESKTOP)

    // Some of the window is still on screen.
    expect(g.x + g.width).toBeGreaterThan(0)
  })

  it('leaves a grabbable strip when dragged off the right', () => {
    const g = clampToDesktop({ x: 100000, y: 10, width: 500, height: 300 }, DESKTOP)

    expect(g.x).toBeLessThan(DESKTOP.width)
  })

  it('refuses to shrink a window below the minimum', () => {
    const g = clampToDesktop({ x: 0, y: 0, width: 10, height: 10 }, DESKTOP)

    expect(g.width).toBe(MIN_WIDTH)
    expect(g.height).toBe(MIN_HEIGHT)
  })

  it('does not grow a window past the desktop', () => {
    const g = clampToDesktop({ x: 0, y: 0, width: 99999, height: 99999 }, DESKTOP)

    expect(g.width).toBe(DESKTOP.width)
    expect(g.height).toBe(DESKTOP.height)
  })

  it('survives a desktop smaller than the minimum window', () => {
    // A very short window, or a mid-resize measurement. Must not produce a
    // negative size, which would make the window vanish.
    const tiny = { width: 200, height: 120 }
    const g = clampToDesktop({ x: 0, y: 0, width: 500, height: 400 }, tiny)

    expect(g.width).toBeGreaterThan(0)
    expect(g.height).toBeGreaterThan(0)
  })
})

describe('dragging', () => {
  it('moves by the pointer delta', () => {
    const start = { x: 100, y: 100, width: 500, height: 400 }

    expect(moveBy(start, 40, -30, DESKTOP)).toMatchObject({ x: 140, y: 70 })
  })

  it('keeps the size while moving', () => {
    const start = { x: 100, y: 100, width: 500, height: 400 }
    const moved = moveBy(start, 200, 200, DESKTOP)

    expect(moved.width).toBe(500)
    expect(moved.height).toBe(400)
  })

  it('is clamped, so a throw toward the corner cannot lose the window', () => {
    const start = { x: 100, y: 100, width: 500, height: 400 }
    const moved = moveBy(start, -9999, -9999, DESKTOP)

    expect(moved.y).toBe(0)
    expect(moved.x + moved.width).toBeGreaterThan(0)
  })
})

describe('resizing', () => {
  it('grows from the bottom-right, leaving the top-left where it was', () => {
    // What makes a grow box feel like a grow box rather than a move.
    const start = { x: 120, y: 90, width: 500, height: 400 }
    const resized = resizeBy(start, 60, 40, DESKTOP)

    expect(resized).toEqual({ x: 120, y: 90, width: 560, height: 440 })
  })

  it('will not shrink below the minimum', () => {
    const start = { x: 0, y: 0, width: 500, height: 400 }
    const resized = resizeBy(start, -9999, -9999, DESKTOP)

    expect(resized.width).toBe(MIN_WIDTH)
    expect(resized.height).toBe(MIN_HEIGHT)
  })

  it('will not grow past the desktop edge from where the window sits', () => {
    const start = { x: 200, y: 150, width: 500, height: 400 }
    const resized = resizeBy(start, 9999, 9999, DESKTOP)

    expect(start.x + resized.width).toBeLessThanOrEqual(DESKTOP.width)
    expect(start.y + resized.height).toBeLessThanOrEqual(DESKTOP.height)
  })

  it('does not shrink a window that already overhangs the edge', () => {
    // A window dragged mostly off the right is a position clamping allows, so
    // its width legitimately extends past the desktop. Grabbing the grow box
    // there must not yank it narrower.
    const start = { x: 880, y: 600, width: 600, height: 400 }
    const resized = resizeBy(start, 50, 50, DESKTOP)

    expect(resized.width).toBeGreaterThanOrEqual(start.width)
    expect(resized.height).toBeGreaterThanOrEqual(start.height)
  })
})

describe('defaults', () => {
  it('fills the desktop for a lone project', () => {
    expect(fullBleed(DESKTOP)).toEqual({ x: 0, y: 0, width: 1000, height: 800 })
  })

  it('steps each new window down and across', () => {
    const a = cascadeFor(0, DESKTOP)
    const b = cascadeFor(1, DESKTOP)

    expect(b.x).toBeGreaterThan(a.x)
    expect(b.y).toBeGreaterThan(a.y)
  })

  it('wraps rather than marching a tenth window off the desktop', () => {
    const tenth = cascadeFor(9, DESKTOP)

    expect(tenth.x).toBeLessThan(DESKTOP.width)
    expect(tenth.y).toBeLessThan(DESKTOP.height)
  })

  it('always produces something inside the rules', () => {
    for (let i = 0; i < 20; i++) {
      const g = cascadeFor(i, DESKTOP)
      expect(g).toEqual(clampToDesktop(g, DESKTOP))
    }
  })
})

describe('sameGeometry', () => {
  it('is false against nothing, so a first position always persists', () => {
    expect(sameGeometry(undefined, { x: 0, y: 0, width: 1, height: 1 })).toBe(false)
  })

  it('spots an unchanged position, so a click that did not drag writes nothing', () => {
    const g = { x: 5, y: 6, width: 700, height: 500 }

    expect(sameGeometry({ ...g }, g)).toBe(true)
    expect(sameGeometry({ ...g, x: 6 }, g)).toBe(false)
  })
})
