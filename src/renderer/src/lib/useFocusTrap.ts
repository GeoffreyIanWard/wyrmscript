import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

/**
 * Keyboard containment for a dialog (F-07): focus moves inside on open, Tab
 * and ⇧Tab cycle within, Esc closes, and focus returns to whatever opened it.
 *
 * Trapping matters beyond tidiness — without it, Tab walks out of a modal
 * into the binder and editor behind it, so a keyboard-only writer can put the
 * caret in the manuscript while a dialog is still covering it, and type into
 * a document they cannot see.
 */

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',')

// Open traps, innermost last. A dialog opened from another dialog stacks on
// top, and only the top one may act on a key that never reached any dialog at
// all — otherwise a single Esc would close the whole stack at once.
const stack: HTMLElement[] = []

function focusableIn(root: HTMLElement): HTMLElement[] {
  // Attribute-based rather than layout-based on purpose: these dialogs render
  // controls conditionally instead of hiding them, so nothing here is
  // display:none, and querying layout would tie the trap to a real engine.
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true'
  )
}

export function useFocusTrap<T extends HTMLElement>(onClose?: () => void): RefObject<T | null> {
  const ref = useRef<T | null>(null)
  // Held in a ref so changing the handler identity never re-runs the trap
  // effect and steals focus back to the top of the dialog mid-interaction.
  // Written in its own effect rather than during render — a render-time ref
  // write is exactly what React's rules warn about.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    const root = ref.current
    if (!root) return
    const returnTo = document.activeElement as HTMLElement | null

    // Prefer a text field: dialogs that ask for typing should be typeable
    // immediately, and the rest land on their first control.
    const initial =
      root.querySelector<HTMLElement>('input:not([disabled]), textarea:not([disabled])') ??
      focusableIn(root)[0]
    initial?.focus()

    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        closeRef.current?.()
        return
      }
      if (e.key !== 'Tab') return
      const items = focusableIn(root)
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      // Wrap at both ends, and pull focus back in if it somehow escaped.
      if (!active || !root.contains(active)) {
        e.preventDefault()
        first.focus()
      } else if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    // Two listeners, on purpose. The root one is the normal path: focus is
    // inside the dialog, the key is handled, and `stopPropagation` keeps it
    // from ever reaching the document listener below or App's Esc-as-back.
    //
    // The document one is for loose focus — Esc did nothing at all when
    // `document.activeElement` was <body>, which is not a corner case: a
    // dialog that mounts with no focusable control yet (anything showing a
    // loading state first) never gets focus on open, and clicking the
    // backdrop drops it too. The writer was left with a dialog only the mouse
    // could dismiss (I-10). It fires only for the topmost trap, and only for
    // a key that no dialog has already consumed.
    const onDocumentKeyDown = (e: KeyboardEvent): void => {
      if (stack[stack.length - 1] !== root) return
      // Focus inside means the root listener already ran; Tab doesn't stop
      // propagation there, so without this it would run twice per key.
      const active = document.activeElement
      if (active && root.contains(active)) return
      onKeyDown(e)
    }

    root.addEventListener('keydown', onKeyDown)
    document.addEventListener('keydown', onDocumentKeyDown)
    stack.push(root)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('keydown', onDocumentKeyDown)
      const at = stack.indexOf(root)
      if (at !== -1) stack.splice(at, 1)
      // Restore only when focus is loose. By the time this runs the dialog is
      // usually already detached, so focus has fallen to <body> — that is the
      // normal close. If something else has claimed it (a dialog opened from
      // this one), leave it alone rather than yanking focus out of a successor.
      const active = document.activeElement
      const loose = active === null || active === document.body || root.contains(active)
      if (returnTo && loose) returnTo.focus()
    }
  }, [])

  return ref
}
