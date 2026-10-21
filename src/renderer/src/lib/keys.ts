/**
 * Waiting for the keyboard to let go.
 *
 * Moving focus onto a button while the key that caused the move is still
 * down lets Chromium deliver that same Return or Space to the new button:
 * the Return that made a card on the corkboard opened it the moment it had
 * focus. Anything that hands focus to a button after a keypress goes
 * through `afterKeysUp`.
 */

/** Keys held right now, for `afterKeysUp`. One listener for the app's life:
 *  cheap, and a component-scoped one would miss a key pressed before it
 *  mounted — exactly the Return that opened what is now closing. */
const keysDown = new Set<string>()
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => keysDown.add(e.code), true)
  window.addEventListener('keyup', (e) => keysDown.delete(e.code), true)
  window.addEventListener('blur', () => keysDown.clear())
}

/** Runs `fn` once no key is held, and after the current event has finished. */
export function afterKeysUp(fn: () => void): void {
  if (keysDown.size === 0) {
    setTimeout(fn, 0)
    return
  }
  const onUp = (): void => {
    if (keysDown.size > 0) return
    window.removeEventListener('keyup', onUp)
    setTimeout(fn, 0)
  }
  window.addEventListener('keyup', onUp)
}
