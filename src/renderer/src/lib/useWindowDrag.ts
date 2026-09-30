import { useCallback, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { WindowGeometry } from '../../../shared/types'
import type { Size } from './windowGeometry'

/**
 * F-41 step 4: the pointer half of dragging and resizing a project window.
 *
 * Delta-based on purpose — it records the pointer position and the geometry
 * at pointer-down, then applies `(current - start)` through a pure function
 * from `windowGeometry.ts`. Nothing here reads element positions, so the
 * behaviour is identical whether or not a layout engine exists, and the
 * arithmetic stays testable.
 *
 * Pointer capture is what makes a drag survive the cursor leaving the window,
 * which it always does the moment you throw a window toward an edge. Without
 * it the window sticks halfway and the writer is left holding a mouse button
 * that no longer does anything.
 */
export function useWindowDrag({
  getGeometry,
  getDesktop,
  apply,
  onCommit
}: {
  /** Geometry at the moment the drag starts. */
  getGeometry: () => WindowGeometry
  getDesktop: () => Size
  /** Pure transform: start geometry plus the pointer delta. */
  apply: (start: WindowGeometry, dx: number, dy: number, desktop: Size) => WindowGeometry
  /** Called on every move with done=false, and once at the end with done=true. */
  onCommit: (geometry: WindowGeometry, done: boolean) => void
}): (event: ReactPointerEvent) => void {
  const state = useRef<{ x: number; y: number; start: WindowGeometry } | null>(null)

  return useCallback(
    (event: ReactPointerEvent) => {
      // Only the primary button drags. A right-click on a title bar should
      // never move the window out from under the context menu.
      if (event.button !== 0) return
      event.preventDefault()
      const element = event.currentTarget as HTMLElement
      state.current = { x: event.clientX, y: event.clientY, start: getGeometry() }
      element.setPointerCapture(event.pointerId)

      const move = (e: PointerEvent): void => {
        const from = state.current
        if (!from) return
        onCommit(apply(from.start, e.clientX - from.x, e.clientY - from.y, getDesktop()), false)
      }

      const end = (e: PointerEvent): void => {
        const from = state.current
        state.current = null
        element.releasePointerCapture?.(e.pointerId)
        element.removeEventListener('pointermove', move)
        element.removeEventListener('pointerup', end)
        element.removeEventListener('pointercancel', end)
        if (!from) return
        // `done` tells the caller to write the position to disk. Doing that on
        // every pointermove would hit the settings file a hundred times a drag.
        onCommit(apply(from.start, e.clientX - from.x, e.clientY - from.y, getDesktop()), true)
      }

      element.addEventListener('pointermove', move)
      element.addEventListener('pointerup', end)
      // A cancelled pointer (the OS taking over, a touch interrupted) must end
      // the drag too, or the window follows the cursor forever afterwards.
      element.addEventListener('pointercancel', end)
    },
    [getGeometry, getDesktop, apply, onCommit]
  )
}
