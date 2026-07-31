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

    root.addEventListener('keydown', onKeyDown)
    return () => {
      root.removeEventListener('keydown', onKeyDown)
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
